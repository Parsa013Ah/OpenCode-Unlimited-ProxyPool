import test from "node:test";
import assert from "node:assert/strict";
import { parseV2rayLink, tryParseV2rayLink, decodeSubscription, isV2rayLink } from "../src/proxy/v2ray/links.mjs";
import { nodeToOutbound, buildXrayConfig, nodesFromJson } from "../src/proxy/v2ray/xray-config.mjs";
import { parseProxyLine } from "../src/proxy/parser.mjs";

const b64 = (s) => Buffer.from(s).toString("base64");

test("vmess base64-JSON (v2rayN)", () => {
  const j = { v: "2", ps: "Germany 1", add: "example.com", port: "443", id: "b831381d-6324-4d53-ad4f-8cda48b30811", aid: "0", scy: "auto", net: "ws", type: "none", host: "cdn.example.com", path: "/ws", tls: "tls", sni: "sni.example.com", alpn: "h2,http/1.1", fp: "chrome" };
  const n = parseV2rayLink("vmess://" + b64(JSON.stringify(j)));
  assert.equal(n.protocol, "vmess");
  assert.equal(n.address, "example.com");
  assert.equal(n.port, 443);
  assert.equal(n.network, "ws");
  assert.equal(n.tls, "tls");
  assert.deepEqual(n.alpn, ["h2", "http/1.1"]);
  const o = nodeToOutbound(n, "t");
  assert.equal(o.settings.vnext[0].users[0].id, j.id);
  assert.equal(o.streamSettings.wsSettings.headers.Host, "cdn.example.com");
  assert.equal(o.streamSettings.tlsSettings.serverName, "sni.example.com");
});

test("vless + REALITY + vision", () => {
  const l = "vless://11111111-2222-3333-4444-555555555555@1.2.3.4:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=PUBKEY&sid=ab12&spx=%2F&type=tcp#My%20Reality";
  const n = parseV2rayLink(l);
  assert.equal(n.tls, "reality");
  assert.equal(n.name, "My Reality");
  assert.equal(n.flow, "xtls-rprx-vision");
  const o = nodeToOutbound(n, "t");
  assert.equal(o.streamSettings.realitySettings.publicKey, "PUBKEY");
  assert.equal(o.streamSettings.realitySettings.shortId, "ab12");
  assert.equal(o.streamSettings.realitySettings.spiderX, "/");
});

test("vless ws+tls with comma alpn stays intact", () => {
  const l = "vless://uuid-1@host.example.com:8443?security=tls&type=ws&host=h.example.com&path=%2Fabc%3Fed%3D2048&alpn=h2,http/1.1&sni=s.example.com#x";
  const n = parseV2rayLink(l);
  assert.equal(n.path, "/abc?ed=2048");
  assert.deepEqual(n.alpn, ["h2", "http/1.1"]);
});

test("vless grpc", () => {
  const n = parseV2rayLink("vless://u@h.com:443?type=grpc&serviceName=svc&security=tls&mode=multi#g");
  const o = nodeToOutbound(n, "t");
  assert.equal(o.streamSettings.network, "grpc");
  assert.equal(o.streamSettings.grpcSettings.serviceName, "svc");
  assert.equal(o.streamSettings.grpcSettings.multiMode, true);
});

test("trojan defaults to tls", () => {
  const n = parseV2rayLink("trojan://p%40ss@t.example.com:443?sni=t.example.com#tj");
  assert.equal(n.tls, "tls");
  assert.equal(n.password, "p@ss");
  assert.equal(nodeToOutbound(n, "t").settings.servers[0].password, "p@ss");
});

test("shadowsocks SIP002 / legacy / plain", () => {
  const cred = b64("aes-256-gcm:secret");
  const a = parseV2rayLink(`ss://${cred}@1.2.3.4:8388#ss-a`);
  assert.equal(a.method, "aes-256-gcm");
  assert.equal(a.password, "secret");
  assert.equal(a.name, "ss-a");
  const legacy = parseV2rayLink("ss://" + b64("chacha20-ietf-poly1305:pw@5.6.7.8:1234") + "#ss-b");
  assert.equal(legacy.address, "5.6.7.8");
  assert.equal(legacy.port, 1234);
  const plain = parseV2rayLink("ss://aes-128-gcm:pw%3A1@9.9.9.9:80#c");
  assert.equal(plain.password, "pw:1");
});

test("unsupported / malformed links give a reason, never throw from tryParse", () => {
  assert.match(tryParseV2rayLink("hysteria2://x@h:443").error, /not supported/);
  assert.match(tryParseV2rayLink("ss://" + b64("aes-256-gcm:x") + "@h:1/?plugin=obfs-local").error, /plugin/);
  assert.match(tryParseV2rayLink("vless://@h:443").error, /uuid|malformed/);
  assert.match(tryParseV2rayLink("vmess://!!!notbase64").error, /vmess/);
  assert.match(tryParseV2rayLink("vless://u@h:443?security=reality").error, /public key/);
  assert.match(tryParseV2rayLink("vless://u@h:99999").error, /malformed|port/);
});

test("subscription: base64 blob and plain list", () => {
  const links = ["vless://u@h.com:443?security=tls#a", "trojan://p@t.com:443#b", "not a link"];
  assert.equal(decodeSubscription(b64(links.join("\n"))).length, 2);
  assert.equal(decodeSubscription(links.join("\r\n")).length, 2);
  assert.deepEqual(decodeSubscription("<html>nope</html>"), []);
});

test("nodesFromJson: full config, outbound array, single outbound", () => {
  const ob = { protocol: "vless", tag: "proxy", settings: { vnext: [{ address: "a.com", port: 443, users: [{ id: "u", encryption: "none" }] }] }, streamSettings: { network: "ws", security: "tls" } };
  const direct = { protocol: "freedom", tag: "direct" };
  assert.equal(nodesFromJson({ inbounds: [], outbounds: [ob, direct] }).length, 1);
  assert.equal(nodesFromJson([ob]).length, 1);
  assert.equal(nodesFromJson(ob).length, 1);
  assert.equal(nodesFromJson({ outbounds: [direct] }).length, 0);
  assert.equal(nodeToOutbound(nodesFromJson(ob)[0], "new-tag").tag, "new-tag");
});

test("buildXrayConfig: local-only inbounds, one route per node, blackhole fallback", () => {
  const n = parseV2rayLink("vless://u@h.com:443?security=tls#a");
  const cfg = buildXrayConfig([{ tag: n.uid, port: 10808, node: n }]);
  assert.equal(cfg.inbounds[0].listen, "127.0.0.1");
  assert.equal(cfg.routing.rules[0].outboundTag, `out-${n.uid}`);
  assert.ok(cfg.outbounds.some((o) => o.protocol === "blackhole"));
});

test("isV2rayLink", () => {
  assert.ok(isV2rayLink(" vless://x"));
  assert.ok(!isV2rayLink("socks5://1.2.3.4:1080"));
  assert.ok(!isV2rayLink("1.2.3.4:80"));
});

test("classic parser: domains, IPv6, creds, formats", () => {
  assert.deepEqual(parseProxyLine("1.2.3.4:8080"), { host: "1.2.3.4", port: 8080, type: "http", user: null, pass: null, custom: true });
  const a = parseProxyLine("socks5://user:pa:ss@proxy.example.com:1080");
  assert.equal(a.host, "proxy.example.com"); assert.equal(a.type, "socks5"); assert.equal(a.pass, "pa:ss");
  const b = parseProxyLine("1.2.3.4:1080:me:secret");
  assert.equal(b.user, "me"); assert.equal(b.pass, "secret");
  assert.equal(parseProxyLine("socks5:1.2.3.4:1080").type, "socks5");
  assert.equal(parseProxyLine("http|1.2.3.4:3128").type, "http");
  assert.equal(parseProxyLine("[2001:db8::1]:8080").host, "2001:db8::1");
  assert.equal(parseProxyLine("1.2.3.4 8080").port, 8080);
  assert.equal(parseProxyLine("# comment"), null);
  assert.equal(parseProxyLine("1.2.3.4:99999"), null);
  assert.equal(parseProxyLine("garbage"), null);
});

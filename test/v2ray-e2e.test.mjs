/**
 * End-to-end: a real Xray SERVER on localhost (vmess / vless-ws / vless-grpc / trojan / ss)
 * and our manager acting as the CLIENT. Needs an xray binary:  XRAY_PATH=/path/to/xray npm test
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { spawn, spawnSync } from "child_process";

const XRAY = process.env.XRAY_PATH;
const haveXray = XRAY && fs.existsSync(XRAY);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ocfp-"));
process.env.DATA_DIR = tmp;
process.env.CONFIG_DIR = path.join(tmp, "config");
process.env.V2RAY_BASE_PORT = "22100";

const UUID = "b831381d-6324-4d53-ad4f-8cda48b30811";
const P = { vmess: 21001, vlessWs: 21002, ss: 21003, trojan: 21004, grpc: 21005 };

let target, server;
let TARGET_PORT;

before(async () => {
  if (!haveXray) return;
  target = http.createServer((req, res) => res.end("hello-from-target"));
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  TARGET_PORT = target.address().port;

  const cfg = {
    log: { loglevel: "warning" },
    inbounds: [
      { port: P.vmess, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID }] } },
      { port: P.vlessWs, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "ws", wsSettings: { path: "/ws" } } },
      { port: P.ss, listen: "127.0.0.1", protocol: "shadowsocks", settings: { method: "aes-256-gcm", password: "pw123456", network: "tcp,udp" } },
      { port: P.trojan, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: "trojan-pw" }] } },
      { port: P.grpc, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "grpc", grpcSettings: { serviceName: "gsvc" } } },
    ],
    outbounds: [{ protocol: "freedom" }],
  };
  const f = path.join(tmp, "server.json");
  fs.writeFileSync(f, JSON.stringify(cfg));
  server = spawn(XRAY, ["run", "-c", f], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1200));
});

after(async () => {
  const { stopV2ray } = await import("../src/proxy/v2ray/manager.mjs");
  stopV2ray();
  try { server?.kill(); } catch {}
  try { target?.close(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function viaSocks(port) {
  const { SocksProxyAgent } = await import("socks-proxy-agent");
  const agent = new SocksProxyAgent(`socks5://127.0.0.1:${port}`);
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: TARGET_PORT, path: "/", agent, timeout: 8000 }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve(b));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

const b64 = (s) => Buffer.from(s).toString("base64");

test("all protocols tunnel real traffic through a real Xray server", { skip: !haveXray && "set XRAY_PATH" }, async () => {
  const { parseV2rayLink } = await import("../src/proxy/v2ray/links.mjs");
  const { syncV2ray, getV2rayInfo } = await import("../src/proxy/v2ray/manager.mjs");

  const links = {
    vmess: "vmess://" + b64(JSON.stringify({ v: "2", ps: "vm", add: "127.0.0.1", port: String(P.vmess), id: UUID, aid: "0", scy: "auto", net: "tcp", tls: "" })),
    "vmess-url": `vmess://${UUID}@127.0.0.1:${P.vmess}?type=tcp&security=none#vm-url`,
    "vless-ws": `vless://${UUID}@127.0.0.1:${P.vlessWs}?type=ws&path=%2Fws&security=none#vl-ws`,
    "vless-grpc": `vless://${UUID}@127.0.0.1:${P.grpc}?type=grpc&serviceName=gsvc&security=none#vl-grpc`,
    trojan: `trojan://trojan-pw@127.0.0.1:${P.trojan}?security=none#tj`,
    ss: `ss://${b64("aes-256-gcm:pw123456")}@127.0.0.1:${P.ss}#ss`,
  };
  const nodes = Object.values(links).map(parseV2rayLink);

  // both vmess formats describe the same server → identical uid → collapsed into one
  assert.equal(parseV2rayLink(links.vmess).uid, parseV2rayLink(links["vmess-url"]).uid);

  const entries = await syncV2ray(nodes);
  assert.equal(entries.length, nodes.length - 1, "one local port per UNIQUE node");
  assert.ok(getV2rayInfo().running);
  for (const e of entries) {
    assert.equal(e.host, "127.0.0.1");
    assert.equal(e.type, "socks5");
    assert.equal(e.v2ray, true);
  }

  const results = await Promise.allSettled(entries.map((e) => viaSocks(e.port)));
  results.forEach((r, i) => {
    assert.equal(r.status, "fulfilled", `${entries[i].label}: ${r.reason?.message}`);
    assert.equal(r.value, "hello-from-target", entries[i].label);
  });
});

test("unchanged node set does not restart xray; ports are stable", { skip: !haveXray && "set XRAY_PATH" }, async () => {
  const { parseV2rayLink } = await import("../src/proxy/v2ray/links.mjs");
  const { syncV2ray } = await import("../src/proxy/v2ray/manager.mjs");
  const nodes = [parseV2rayLink(`vless://${UUID}@127.0.0.1:${P.vlessWs}?type=ws&path=%2Fws&security=none#a`)];
  const a = await syncV2ray(nodes);
  const b = await syncV2ray(nodes);
  assert.equal(a, b, "same array instance → no restart");
  assert.equal(await viaSocks(a[0].port), "hello-from-target");
});

test("one invalid node is dropped, the rest keep working", { skip: !haveXray && "set XRAY_PATH" }, async () => {
  const { parseV2rayLink } = await import("../src/proxy/v2ray/links.mjs");
  const { syncV2ray, getV2rayInfo } = await import("../src/proxy/v2ray/manager.mjs");
  const good = parseV2rayLink(`trojan://trojan-pw@127.0.0.1:${P.trojan}?security=none#good`);
  const bad = parseV2rayLink(`ss://${b64("rc4-md5:pw")}@127.0.0.1:${P.ss}#bad-cipher`);
  const entries = await syncV2ray([bad, good]);
  assert.equal(entries.length, 1);
  assert.equal(getV2rayInfo().dropped, 1);
  assert.equal(await viaSocks(entries[0].port), "hello-from-target");
});

test("empty node list stops xray", { skip: !haveXray && "set XRAY_PATH" }, async () => {
  const { syncV2ray, getV2rayInfo } = await import("../src/proxy/v2ray/manager.mjs");
  assert.deepEqual(await syncV2ray([]), []);
  assert.equal(getV2rayInfo().running, false);
});

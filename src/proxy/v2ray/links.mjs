/**
 * links.mjs — Parse V2Ray-style share links into a normalized "node" object.
 *
 * Supported schemes:
 *   vmess://   (base64-JSON "v2rayN" format  AND  vmess://uuid@host:port?… URL format)
 *   vless://   (incl. REALITY, xtls-rprx-vision, ws / grpc / tcp / httpupgrade / xhttp …)
 *   trojan://
 *   ss://      (SIP002, legacy base64 and plain forms)
 *
 * Not supported (skipped with a clear reason): hysteria/hysteria2/tuic/wireguard,
 * shadowsocks plugins, QUIC transport.
 */
import crypto from "crypto";

const SCHEME_RE = /^(vmess|vless|trojan|ss|hysteria2?|hy2|tuic|wireguard|ssr):\/\//i;

export function isV2rayLink(line) {
  return SCHEME_RE.test(String(line || "").trim());
}

// ─── helpers ────────────────────────────────────────────────────────

export function b64decode(input) {
  let s = String(input || "").trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

const truthy = (v) => v === true || v === "1" || v === 1 || String(v).toLowerCase() === "true";

const csv = (v) =>
  String(v || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function normalizeNetwork(n) {
  const v = String(n || "tcp").toLowerCase();
  if (v === "raw") return "tcp";
  if (v === "http") return "h2";
  if (v === "splithttp") return "xhttp";
  if (v === "mkcp") return "kcp";
  return v;
}

function assertPort(p) {
  const port = parseInt(p, 10);
  if (!(port >= 1 && port <= 65535)) throw new Error(`bad port "${p}"`);
  return port;
}

/** Stable short id for a node (used for de-dup + stable local ports). */
export function nodeId(node) {
  const core = [
    node.protocol, node.address, node.port,
    node.id || node.password || "", node.method || "",
    node.network, node.tls, node.path || "", node.host || "", node.serviceName || "",
  ].join("|");
  return crypto.createHash("sha1").update(core).digest("hex").slice(0, 12);
}

// ─── per-protocol parsers ───────────────────────────────────────────

function parseVmessJson(b64) {
  let j;
  try {
    j = JSON.parse(b64decode(b64));
  } catch {
    throw new Error("vmess: invalid base64/JSON");
  }
  if (!j.add || !j.id) throw new Error("vmess: missing address or id");
  const net = normalizeNetwork(j.net);
  return {
    protocol: "vmess",
    name: j.ps || "",
    address: String(j.add),
    port: assertPort(j.port),
    id: String(j.id),
    alterId: parseInt(j.aid || "0", 10) || 0,
    cipher: j.scy || "auto",
    network: net,
    headerType: j.type && j.type !== "none" ? j.type : "",
    host: j.host || "",
    path: j.path || "",
    serviceName: net === "grpc" ? j.path || "" : "",
    tls: String(j.tls || "").toLowerCase() === "tls" ? "tls" : "none",
    sni: j.sni || "",
    alpn: csv(j.alpn),
    fingerprint: j.fp || "",
    allowInsecure: truthy(j.allowInsecure ?? j.insecure),
  };
}

function parseUrlLike(link, protocol) {
  let u;
  try {
    u = new URL(link);
  } catch {
    throw new Error(`${protocol}: malformed link`);
  }
  const q = (k) => u.searchParams.get(k) || "";
  const net = normalizeNetwork(q("type"));
  let security = (q("security") || (protocol === "trojan" ? "tls" : "none")).toLowerCase();
  if (security === "xtls") security = "tls";
  if (!["none", "tls", "reality"].includes(security)) {
    throw new Error(`${protocol}: unsupported security "${security}"`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Error(`${protocol}: missing host`);

  const node = {
    protocol,
    name: safeDecode(u.hash.replace(/^#/, "")),
    address: host,
    port: assertPort(u.port),
    network: net,
    headerType: q("headerType") && q("headerType") !== "none" ? q("headerType") : "",
    host: q("host"),
    path: safeDecode(q("path")),
    serviceName: q("serviceName") || q("service_name") || "",
    grpcMode: q("mode"),
    seed: q("seed"),
    tls: security,
    sni: q("sni") || q("peer"),
    alpn: csv(q("alpn")),
    fingerprint: q("fp"),
    allowInsecure: truthy(q("allowInsecure")) || truthy(q("insecure")),
    publicKey: q("pbk"),
    shortId: q("sid"),
    spiderX: safeDecode(q("spx")),
  };

  const user = safeDecode(u.username);
  if (protocol === "vless") {
    if (!user) throw new Error("vless: missing uuid");
    node.id = user;
    node.flow = q("flow");
    node.encryption = q("encryption") || "none";
  } else if (protocol === "vmess") {
    if (!user) throw new Error("vmess: missing uuid");
    node.id = user;
    node.alterId = parseInt(q("aid") || "0", 10) || 0;
    node.cipher = q("scy") || q("encryption") || "auto";
  } else if (protocol === "trojan") {
    const pass = user + (u.password ? ":" + safeDecode(u.password) : "");
    if (!pass) throw new Error("trojan: missing password");
    node.password = pass;
    node.flow = q("flow");
  }

  if (security === "reality" && !node.publicKey) {
    throw new Error(`${protocol}: REALITY link without public key (pbk)`);
  }
  return node;
}

function parseShadowsocks(link) {
  let rest = link.replace(/^ss:\/\//i, "");
  let name = "";
  const hashAt = rest.indexOf("#");
  if (hashAt !== -1) {
    name = safeDecode(rest.slice(hashAt + 1));
    rest = rest.slice(0, hashAt);
  }
  let query = "";
  const qAt = rest.indexOf("?");
  if (qAt !== -1) {
    query = rest.slice(qAt + 1);
    rest = rest.slice(0, qAt);
  }
  rest = rest.replace(/\/+$/, "");
  if (new URLSearchParams(query).get("plugin")) {
    throw new Error("ss: plugins (obfs / v2ray-plugin) are not supported");
  }

  let method, password, hostport;
  const at = rest.lastIndexOf("@");
  if (at !== -1) {
    const userinfo = rest.slice(0, at);
    hostport = rest.slice(at + 1);
    const plain = safeDecode(userinfo);
    const decoded = plain.includes(":") ? plain : b64decode(userinfo);
    const i = decoded.indexOf(":");
    if (i < 1) throw new Error("ss: cannot read method:password");
    method = decoded.slice(0, i);
    password = decoded.slice(i + 1);
  } else {
    const decoded = b64decode(rest);
    const a = decoded.lastIndexOf("@");
    if (a === -1) throw new Error("ss: malformed legacy link");
    const cred = decoded.slice(0, a);
    hostport = decoded.slice(a + 1);
    const i = cred.indexOf(":");
    if (i < 1) throw new Error("ss: cannot read method:password");
    method = cred.slice(0, i);
    password = cred.slice(i + 1);
  }

  const m = hostport.match(/^(\[[^\]]+\]|[^:]+):(\d{1,5})$/);
  if (!m) throw new Error("ss: cannot read host:port");

  return {
    protocol: "shadowsocks",
    name,
    address: m[1].replace(/^\[|\]$/g, ""),
    port: assertPort(m[2]),
    method,
    password,
    network: "tcp",
    tls: "none",
  };
}

// ─── public API ─────────────────────────────────────────────────────

/** Parse one share link. Throws Error(reason) when unsupported / malformed. */
export function parseV2rayLink(link) {
  const l = String(link || "").trim();
  const m = l.match(SCHEME_RE);
  if (!m) throw new Error("not a V2Ray link");
  const scheme = m[1].toLowerCase();

  let node;
  if (scheme === "vmess") {
    const body = l.slice(m[0].length);
    // v2rayN base64-JSON has no "@" and no "?" before decoding; URL style has "@"
    node = body.includes("@") ? parseUrlLike(l, "vmess") : parseVmessJson(body.split("#")[0]);
  } else if (scheme === "vless") {
    node = parseUrlLike(l, "vless");
  } else if (scheme === "trojan") {
    node = parseUrlLike(l, "trojan");
  } else if (scheme === "ss") {
    node = parseShadowsocks(l);
  } else {
    throw new Error(`${scheme}:// is not supported by Xray-core`);
  }

  if (node.network === "quic") throw new Error("QUIC transport is not supported by current Xray");
  node.uid = nodeId(node);
  node.link = l;
  return node;
}

/** Non-throwing variant → { node } or { error }. */
export function tryParseV2rayLink(link) {
  try {
    return { node: parseV2rayLink(link) };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Decode a subscription body.
 * Handles: base64 blob of links, plain link list, or mixed text.
 * Returns an array of link strings (only lines that look like V2Ray links).
 */
export function decodeSubscription(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const pick = (body) =>
    body
      .split(/[\r\n]+/)
      .map((x) => x.trim())
      .filter((x) => SCHEME_RE.test(x));

  const direct = pick(raw);
  if (direct.length) return direct;

  // whole body is base64
  if (/^[A-Za-z0-9+/_=\s-]+$/.test(raw)) {
    try {
      const decoded = pick(b64decode(raw));
      if (decoded.length) return decoded;
    } catch { /* ignore */ }
  }
  return [];
}

/** Short human label used in logs / dashboard. */
export function nodeLabel(node) {
  const proto = node.protocol === "shadowsocks" ? "ss" : node.protocol;
  const name = (node.name || `${node.address}:${node.port}`).replace(/\s+/g, " ").trim();
  return `v2ray·${proto}·${name.length > 32 ? name.slice(0, 31) + "…" : name}`;
}

/**
 * xray-config.mjs — Turn parsed V2Ray nodes into an Xray-core config.
 *
 * Strategy: ONE xray process, N local SOCKS5 inbounds (127.0.0.1 only),
 * each inbound routed to exactly one outbound (= one V2Ray node).
 * The pool then treats every inbound as an ordinary `socks5://127.0.0.1:PORT` proxy.
 */

import crypto from "crypto";

const PROXY_PROTOCOLS = new Set(["vmess", "vless", "trojan", "shadowsocks"]);

// ─── stream settings ────────────────────────────────────────────────

function buildStreamSettings(n) {
  const s = { network: n.network || "tcp", security: n.tls || "none" };

  // transport
  switch (s.network) {
    case "tcp":
      if (n.headerType === "http") {
        s.tcpSettings = {
          header: {
            type: "http",
            request: {
              path: (n.path || "/").split(","),
              headers: n.host ? { Host: n.host.split(",") } : {},
            },
          },
        };
      }
      break;
    case "ws":
      s.wsSettings = { path: n.path || "/", headers: n.host ? { Host: n.host } : {} };
      break;
    case "grpc":
      s.grpcSettings = {
        serviceName: n.serviceName || "",
        multiMode: n.grpcMode === "multi",
      };
      break;
    case "h2":
      s.network = "h2";
      s.httpSettings = { path: n.path || "/", host: n.host ? n.host.split(",") : [] };
      break;
    case "httpupgrade":
      s.httpupgradeSettings = { path: n.path || "/", host: n.host || "" };
      break;
    case "xhttp":
      s.xhttpSettings = { path: n.path || "/", host: n.host || "", mode: n.grpcMode || "auto" };
      break;
    case "kcp":
      s.kcpSettings = { header: { type: n.headerType || "none" }, seed: n.seed || undefined };
      break;
    default:
      throw new Error(`unsupported transport "${s.network}"`);
  }

  // security
  if (s.security === "tls") {
    s.tlsSettings = {
      serverName: n.sni || n.host || n.address,
      allowInsecure: !!n.allowInsecure,
    };
    if (n.alpn?.length) s.tlsSettings.alpn = n.alpn;
    if (n.fingerprint) s.tlsSettings.fingerprint = n.fingerprint;
  } else if (s.security === "reality") {
    s.realitySettings = {
      serverName: n.sni || n.address,
      fingerprint: n.fingerprint || "chrome",
      publicKey: n.publicKey,
      shortId: n.shortId || "",
      spiderX: n.spiderX || "",
    };
  }
  return s;
}

// ─── outbound ───────────────────────────────────────────────────────

/** Convert a parsed node into an Xray outbound object (with the given tag). */
export function nodeToOutbound(n, tag) {
  // Raw outbound taken from a user-supplied JSON config → only re-tag it.
  if (n.rawOutbound) {
    return { ...JSON.parse(JSON.stringify(n.rawOutbound)), tag };
  }

  const out = { tag, protocol: n.protocol };

  if (n.protocol === "vmess") {
    out.settings = {
      vnext: [{
        address: n.address,
        port: n.port,
        users: [{ id: n.id, alterId: n.alterId || 0, security: n.cipher || "auto" }],
      }],
    };
  } else if (n.protocol === "vless") {
    const user = { id: n.id, encryption: n.encryption || "none" };
    if (n.flow) user.flow = n.flow;
    out.settings = { vnext: [{ address: n.address, port: n.port, users: [user] }] };
  } else if (n.protocol === "trojan") {
    out.settings = { servers: [{ address: n.address, port: n.port, password: n.password }] };
  } else if (n.protocol === "shadowsocks") {
    out.settings = {
      servers: [{ address: n.address, port: n.port, method: n.method, password: n.password }],
    };
    return out; // SS has no stream settings here
  } else {
    throw new Error(`unsupported protocol "${n.protocol}"`);
  }

  out.streamSettings = buildStreamSettings(n);
  return out;
}

// ─── whole config ───────────────────────────────────────────────────

/**
 * @param {Array<{tag:string, port:number, node:object}>} entries
 * @param {{logLevel?:string}} [opts]
 */
export function buildXrayConfig(entries, opts = {}) {
  const inbounds = [];
  const outbounds = [];
  const rules = [];

  for (const e of entries) {
    const inTag = `in-${e.tag}`;
    const outTag = `out-${e.tag}`;
    inbounds.push({
      tag: inTag,
      listen: "127.0.0.1", // never expose these to the LAN
      port: e.port,
      protocol: "socks",
      settings: { auth: "noauth", udp: false },
      sniffing: { enabled: false },
    });
    outbounds.push(nodeToOutbound(e.node, outTag));
    rules.push({ type: "field", inboundTag: [inTag], outboundTag: outTag });
  }

  // Safety net: anything that doesn't match a rule is dropped, never sent direct.
  outbounds.push({ tag: "block", protocol: "blackhole" });

  return {
    log: { loglevel: opts.logLevel || "warning" },
    inbounds,
    outbounds,
    routing: { domainStrategy: "AsIs", rules },
  };
}

// ─── user-supplied JSON configs (v2rayN / Xray exports) ────────────

/**
 * Extract proxy outbounds from an arbitrary user JSON:
 *   - full Xray/V2Ray config  ({ outbounds: [...] })
 *   - array of configs / outbounds
 *   - a single outbound object
 * Returns array of pseudo-nodes { protocol, name, address, port, rawOutbound }.
 */
export function nodesFromJson(json, fileLabel = "json") {
  const nodes = [];
  const visit = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) return obj.forEach(visit);
    if (Array.isArray(obj.outbounds)) return obj.outbounds.forEach((o) => pushOutbound(o, obj.remarks));
    if (obj.protocol) return pushOutbound(obj);
  };
  const pushOutbound = (o, remarks) => {
    if (!o || !PROXY_PROTOCOLS.has(String(o.protocol).toLowerCase())) return;
    const protocol = String(o.protocol).toLowerCase();
    const s = o.settings || {};
    const first = (s.vnext && s.vnext[0]) || (s.servers && s.servers[0]) || {};
    if (!first.address || !first.port) return;
    const node = {
      protocol,
      name: remarks || o.tag || fileLabel,
      address: String(first.address),
      port: parseInt(first.port, 10),
      network: o.streamSettings?.network || "tcp",
      tls: o.streamSettings?.security || "none",
      rawOutbound: o,
    };
    node.uid = "j" + crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 11);
    nodes.push(node);
  };
  visit(json);
  return nodes;
}

/**
 * proxy-pool.mjs — Auto-rotating free/private proxy pool for OpenCode Zen API.
 *
 * Features:
 *  - 60+ public list sources (HTTP / SOCKS4 / SOCKS5)
 *  - Disk cache of known-good proxies (survives restarts)
 *  - Round-robin + ban/cooldown on rate-limit or failure
 *  - Prefer cached + HTTP proxies when sampling
 *  - Configurable via env (PROXY_*)
 */

import https from "https";
import fs from "fs";
import path from "path";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { log, color, Spinner } from "./banner.mjs";

// ═══════════════════════════════════════════════════════════════════
// Sources — as many live public lists as practical (Aug 2026)
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_SOURCES = [
  // ── TheSpeedX ────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt" },

  // ── monosans (hourly verified, sorted by speed) ──────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt" },

  // ── iplocate ─────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/protocols/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/protocols/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/protocols/socks4.txt" },

  // ── Proxifly (jsDelivr CDN) ──────────────────────────────────────
  { type: "http",   url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt" },
  { type: "socks5", url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.txt" },
  { type: "socks4", url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks4/data.txt" },

  // ── ProxyScrape CDN ──────────────────────────────────────────────
  { type: "http",   url: "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/http/data.txt" },
  { type: "socks5", url: "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/socks5/data.txt" },
  { type: "socks4", url: "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/socks4/data.txt" },

  // ── ProxyScrape API ──────────────────────────────────────────────
  { type: "http",   url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all" },
  { type: "socks5", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all" },
  { type: "socks4", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=10000&country=all" },

  // ── openproxylist.xyz ────────────────────────────────────────────
  { type: "http",   url: "https://api.openproxylist.xyz/http.txt" },
  { type: "socks5", url: "https://api.openproxylist.xyz/socks5.txt" },
  { type: "socks4", url: "https://api.openproxylist.xyz/socks4.txt" },

  // ── roosterkid / openproxylist ───────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS4_RAW.txt" },

  // ── jetkai ───────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks4.txt" },

  // ── mmpx12 ───────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks4.txt" },

  // ── ShiftyTR ─────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks4.txt" },

  // ── clarketm ─────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt" },

  // ── gproxynet ────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/gproxynet/free-proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/gproxynet/free-proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/gproxynet/free-proxy-list/main/socks4.txt" },

  // ── Thordata ─────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/socks4.txt" },

  // ── ProxyScraper ─────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/ProxyScraper/ProxyScraper/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/ProxyScraper/ProxyScraper/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/ProxyScraper/ProxyScraper/main/socks4.txt" },

  // ── zevtyardt aggregate ──────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/socks4.txt" },

  // ── stormsia ─────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/stormsia/proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/stormsia/proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/stormsia/proxy-list/main/socks4.txt" },

  // ── hookzof socks5 ───────────────────────────────────────────────
  { type: "socks5", url: "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt" },

  // ── prxchk ───────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/prxchk/proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/prxchk/proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/prxchk/proxy-list/main/socks4.txt" },

  // ── ALIILAPRO ────────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks4.txt" },

  // ── hproxy-com ───────────────────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/socks4.txt" },

  // ── fyvri fresh-proxy-list ───────────────────────────────────────
  { type: "http",   url: "https://raw.githubusercontent.com/fyvri/fresh-proxy-list/main/archive/classic/txt/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/fyvri/fresh-proxy-list/main/archive/classic/txt/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/fyvri/fresh-proxy-list/main/archive/classic/txt/socks4.txt" },
];

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

const TEST_HOST = "opencode.ai";
const TEST_PORT = 443;
const FETCH_TIMEOUT_MS = 12_000;
const CACHE_FILE = process.env.PROXY_CACHE_FILE || "./proxy-cache.json";
const CACHE_MAX_AGE_MS = parseInt(process.env.PROXY_CACHE_MAX_AGE_MS || String(2 * 60 * 60 * 1000), 10);
const CACHE_MAX_ENTRIES = 300;

const config = {
  enabled: (process.env.PROXY_ENABLED ?? "1") !== "0",
  sampleSize: parseInt(process.env.PROXY_SAMPLE_SIZE || "350", 10),
  poolSize: parseInt(process.env.PROXY_POOL_SIZE || "30", 10),
  concurrency: parseInt(process.env.PROXY_CONCURRENCY || "60", 10),
  testTimeoutMs: parseInt(process.env.PROXY_TEST_TIMEOUT_MS || "5500", 10),
  cooldownMs: parseInt(process.env.PROXY_COOLDOWN_MS || String(10 * 60 * 1000), 10),
  failCooldownMs: parseInt(process.env.PROXY_FAIL_COOLDOWN_MS || String(60 * 1000), 10),
  refreshMs: parseInt(process.env.PROXY_REFRESH_MS || String(25 * 60 * 1000), 10),
  maxAttempts: parseInt(process.env.PROXY_MAX_ATTEMPTS || "6", 10),
  sources: loadSources(),
};

function loadSources() {
  const raw = process.env.PROXY_SOURCES;
  if (!raw) return DEFAULT_SOURCES;
  return raw
    .split(",")
    .map((e) => {
      const [type, url] = e.trim().split("=", 2);
      return { type, url };
    })
    .filter((s) => s.type && s.url);
}

// ═══════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════

let working = [];
let retired = [];
let banned = new Map();
let cursor = 0;
let lastRefresh = 0;
let lastError = null;
let lastCounts = null;
let refreshing = false;

// ═══════════════════════════════════════════════════════════════════
// Disk cache
// ═══════════════════════════════════════════════════════════════════

function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (!Array.isArray(data.proxies)) return [];
    const cutoff = Date.now() - CACHE_MAX_AGE_MS;
    return data.proxies.filter(
      (p) => p.ts > cutoff && p.host && p.port && p.type
    );
  } catch {
    return [];
  }
}

function saveCache(entries) {
  try {
    const existing = loadCache();
    const map = new Map();
    for (const p of existing) map.set(`${p.host}:${p.port}`, p);
    for (const p of entries) {
      const host = p.host || String(p.key || "").split(":")[0];
      const port = p.port || parseInt(String(p.key || "").split(":")[1], 10);
      if (!host || !port) continue;
      map.set(`${host}:${port}`, {
        host,
        port,
        type: p.type || "http",
        latency: p.latency || 0,
        ts: Date.now(),
      });
    }
    const proxies = [...map.values()]
      .sort((a, b) => (a.latency || 99999) - (b.latency || 99999))
      .slice(0, CACHE_MAX_ENTRIES);
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ updated: Date.now(), count: proxies.length, proxies }, null, 2)
    );
    log("PROXY", `cache → ${color.bold(String(proxies.length))} entries saved`, "ok");
  } catch (e) {
    log("PROXY", `cache save error: ${e.message}`, "error");
  }
}

// ═══════════════════════════════════════════════════════════════════
// Agent factory
// ═══════════════════════════════════════════════════════════════════

function makeAgent(proxy) {
  const hostport = `${proxy.host}:${proxy.port}`;
  try {
    if (proxy.type === "http" || proxy.type === "https") {
      return {
        key: hostport,
        agent: new HttpsProxyAgent(`http://${hostport}`),
        type: proxy.type,
      };
    }
    if (proxy.type === "socks5") {
      return {
        key: hostport,
        agent: new SocksProxyAgent(`socks5://${hostport}`),
        type: "socks5",
      };
    }
    if (proxy.type === "socks4") {
      return {
        key: hostport,
        agent: new SocksProxyAgent(`socks4://${hostport}`),
        type: "socks4",
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Fetch candidate lists
// ═══════════════════════════════════════════════════════════════════

async function fetchCandidates() {
  const all = new Map();
  lastCounts = {};

  const cached = loadCache();
  for (const p of cached) {
    const key = `${p.host}:${p.port}`;
    if (!all.has(key)) {
      all.set(key, { host: p.host, port: p.port, type: p.type || "http", fromCache: true });
    }
  }
  if (cached.length) {
    lastCounts.cache = cached.length;
    log("PROXY", `cache loaded: ${color.bold(String(cached.length))} proxies`, "proxy");
  }

  await Promise.all(
    config.sources.map(async (src) => {
      try {
        const res = await fetch(src.url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { "User-Agent": "opencode-free-proxy/1.0" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        let n = 0;
        for (const line of text.split("\n")) {
          let l = line.trim();
          if (!l || l.startsWith("#")) continue;
          l = l.replace(/^(https?|socks[45]?):\/\//i, "");
          const m = l.match(/^([0-9a-fA-F:.]+):(\d{1,5})/);
          if (!m) continue;
          const port = parseInt(m[2], 10);
          if (port < 1 || port > 65535) continue;
          const host = m[1];
          const key = `${host}:${port}`;
          if (!all.has(key)) {
            all.set(key, { host, port, type: src.type });
            n++;
          }
        }
        lastCounts[src.type] = (lastCounts[src.type] || 0) + n;
      } catch {
        /* source flaky */
      }
    })
  );

  return [...all.values()];
}

// ═══════════════════════════════════════════════════════════════════
// Live test against Zen API
// ═══════════════════════════════════════════════════════════════════

const TEST_BODY = JSON.stringify({
  model: "deepseek-v4-flash-free",
  messages: [{ role: "user", content: "hi" }],
  stream: false,
});

function testProxy(proxy) {
  return new Promise((resolve) => {
    const made = makeAgent(proxy);
    if (!made) return resolve(null);

    let done = false;
    let req = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { req?.destroy(); } catch {}
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), config.testTimeoutMs);
    const start = Date.now();

    req = https.request(
      {
        hostname: TEST_HOST,
        port: TEST_PORT,
        agent: made.agent,
        path: "/zen/v1/chat/completions",
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(TEST_BODY),
          Authorization: "Bearer public",
          "User-Agent":
            "opencode/1.15.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13",
          "x-opencode-client": "cli",
          "x-opencode-project": "global",
          "x-opencode-request": `msg_test_${Math.random().toString(36).slice(2, 10)}`,
          "x-opencode-session": `ses_test_${Math.random().toString(36).slice(2, 10)}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const latency = Date.now() - start;
          const body = Buffer.concat(chunks).toString().trim();
          let ok = false;
          // STRICT: only accept real model output OR a clear rate-limit JSON.
          // Random JSON / HTML / empty / connection-ish 200s cause false positives
          // (proxies that later ECONNRESET on real traffic).
          if (body.startsWith("{")) {
            try {
              const j = JSON.parse(body);
              if (j?.choices?.[0]?.message?.content) ok = true;
              else if (j?.choices?.[0]?.delta?.content) ok = true;
              else {
                const msg = String(j?.error?.message || j?.message || "").toLowerCase();
                const typ = String(j?.error?.type || j?.type || "").toLowerCase();
                if (
                  msg.includes("rate limit") ||
                  msg.includes("freeusagelimit") ||
                  msg.includes("quota") ||
                  typ.includes("rate_limit")
                ) {
                  ok = true;
                }
              }
            } catch {}
          }
          if (!ok && res.statusCode === 429) ok = true;
          finish(
            ok
              ? {
                  key: made.key,
                  agent: made.agent,
                  latency,
                  type: made.type || proxy.type,
                  host: proxy.host,
                  port: proxy.port,
                }
              : null
          );
        });
      }
    );
    req.on("error", () => finish(null));
    req.end(TEST_BODY);
  });
}

// ═══════════════════════════════════════════════════════════════════
// Refresh
// ═══════════════════════════════════════════════════════════════════

export async function refresh() {
  if (!config.enabled || refreshing) return;
  refreshing = true;
  lastRefresh = Date.now();

  try {
    const candidates = await fetchCandidates();
    if (!candidates.length) throw new Error("no proxies fetched from any source");

    candidates.sort((a, b) => {
      const rank = (p) =>
        (p.fromCache ? -20 : 0) +
        (p.type === "http" || p.type === "https" ? 0 : p.type === "socks5" ? 1 : 2);
      return rank(a) - rank(b);
    });

    const sample = candidates.slice(0, config.sampleSize);
    const results = [];
    const queue = [...sample];

    const worker = async () => {
      while (queue.length) {
        const proxy = queue.shift();
        const r = await testProxy(proxy);
        if (r) results.push(r);
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(config.concurrency, sample.length) },
        worker
      )
    );

    results.sort((a, b) => a.latency - b.latency);
    const pool = results.slice(0, config.poolSize);

    if (pool.length > 0) {
      retired.push(...working);
      working = pool;
      for (const p of retired) {
        setTimeout(() => {
          try { p.agent.destroy(); } catch {}
        }, 30_000);
      }
      retired = [];
      saveCache(pool);
    } else if (working.length === 0) {
      log("PROXY", "0 working proxies — using direct only", "warn");
    } else {
      log("PROXY", `0 new working; keeping previous pool of ${working.length}`, "warn");
    }

    const countsStr = lastCounts
      ? Object.entries(lastCounts)
          .map(([t, n]) => `${t}:${n}`)
          .join(" ")
      : "";
    log("PROXY", `refreshed: ${color.bold(String(working.length))}/${results.length} kept of ${sample.length} tested (${countsStr}) in ${Date.now() - lastRefresh}ms`, "ok");
    if (working.length) {
      log("PROXY", `top: ${working.slice(0, 6).map((p) => color.bCyan(p.key) + color.dim(`(${p.latency}ms)`)).join(", ")}`, "proxy");
    }
  } catch (e) {
    lastError = e.message;
    log("PROXY", `refresh error: ${e.message}`, "error");
  } finally {
    refreshing = false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

export function getProxyAgents() {
  if (!config.enabled || !working.length) return [];
  const now = Date.now();
  for (const [key, until] of banned) {
    if (now > until) banned.delete(key);
  }
  const avail = working.filter((p) => !banned.has(p.key));
  if (!avail.length) return [];
  const n = Math.min(config.maxAttempts, avail.length);
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push(avail[(cursor + i) % avail.length].agent);
  }
  cursor = (cursor + n) % avail.length;
  return list;
}

export function banProxy(agent, ms) {
  const p = working.find((x) => x.agent === agent);
  if (!p) return;
  const duration = ms ?? config.cooldownMs;
  banned.set(p.key, Date.now() + duration);
  const left = working.filter((x) => !banned.has(x.key)).length;
  log("PROXY", `banned ${color.bYellow(p.key)} for ${duration / 1000}s (available: ${left})`, "warn");
}

export function banProxySoft(agent) {
  banProxy(agent, config.failCooldownMs);
}

export function getPoolInfo() {
  return {
    enabled: config.enabled,
    attemptsPerRequest: config.maxAttempts,
    working: working.map((p) => ({
      proxy: p.key,
      latency: p.latency,
      type: p.type,
    })),
    workingCount: working.length,
    bannedCount: banned.size,
    sources: config.sources.length,
    cacheFile: CACHE_FILE,
    lastRefresh,
    lastError,
  };
}

export function initProxyPool() {
  if (!config.enabled) {
    log("PROXY", "disabled (PROXY_ENABLED=0)", "warn");
    return;
  }
  const cached = loadCache();
  if (cached.length) {
    log("PROXY", `${cached.length} cached proxies will be re-tested`, "proxy");
  }
  refresh();
  setInterval(refresh, config.refreshMs);
  log("PROXY", `enabled · ${color.bold(String(config.sources.length))} sources · sample ${config.sampleSize} · pool ${config.poolSize}`, "ok");
}

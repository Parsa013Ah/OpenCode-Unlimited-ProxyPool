/**
 * pool.mjs — Auto-rotating proxy pool for the OpenCode Zen API.
 *
 * Features:
 *  - 350+ public list sources (HTTP / SOCKS4 / SOCKS5)          → ./sources.mjs
 *  - Personal proxies: classic (host:port…) AND V2Ray nodes     → ./custom.mjs, ./v2ray/
 *  - Disk cache of known-good proxies (survives restarts)
 *  - Round-robin + ban/cooldown on rate-limit or failure
 *  - Prefer cached + HTTP proxies when sampling
 *  - Configurable via env (PROXY_*, V2RAY_*)
 */

import https from "https";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { log, color } from "../ui/banner.mjs";
import { PATHS } from "../paths.mjs";
import { loadSources } from "./sources.mjs";
import { loadCustomProxies } from "./custom.mjs";
import { getV2rayInfo, isV2rayEnabled } from "./v2ray/index.mjs";

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

// Target used by the scanner (override only for tests / mirrors)
const TEST_HOST = process.env.PROXY_TEST_HOST || "opencode.ai";
const TEST_PORT = parseInt(process.env.PROXY_TEST_PORT || "443", 10);
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_FILE = PATHS.proxyCache;
const CACHE_MAX_AGE_MS = parseInt(process.env.PROXY_CACHE_MAX_AGE_MS || String(2 * 60 * 60 * 1000), 10);
const CACHE_MAX_ENTRIES = parseInt(process.env.PROXY_CACHE_MAX || "2000", 10);

const config = {
  enabled: (process.env.PROXY_ENABLED ?? "1") !== "0",
  sampleSize: parseInt(process.env.PROXY_SAMPLE_SIZE || "2500", 10),
  poolSize: parseInt(process.env.PROXY_POOL_SIZE || "50", 10),
  concurrency: parseInt(process.env.PROXY_CONCURRENCY || "200", 10),
  testTimeoutMs: parseInt(process.env.PROXY_TEST_TIMEOUT_MS || "3500", 10),
  // V2Ray tunnels add a TLS/transport handshake on top → give them more time
  v2rayTimeoutMs: parseInt(process.env.V2RAY_TEST_TIMEOUT_MS || "10000", 10),
  cooldownMs: parseInt(process.env.PROXY_COOLDOWN_MS || String(10 * 60 * 1000), 10),
  failCooldownMs: parseInt(process.env.PROXY_FAIL_COOLDOWN_MS || String(60 * 1000), 10),
  refreshMs: parseInt(process.env.PROXY_REFRESH_MS || String(25 * 60 * 1000), 10),
  maxAttempts: parseInt(process.env.PROXY_MAX_ATTEMPTS || "8", 10),
  deepScan: (process.env.PROXY_DEEP_SCAN ?? "1") !== "0",
  maxScan: parseInt(process.env.PROXY_MAX_SCAN || "5000", 10),
  // normal = sampled | super = every unique proxy from every source (slow, thorough)
  scanMode: (process.env.PROXY_SCAN_MODE || "normal").toLowerCase() === "super" ? "super" : "normal",
  sources: loadSources(),
};

export function setScanMode(mode) {
  config.scanMode = mode === "super" ? "super" : "normal";
  log("PROXY", `scan mode → ${color.bold(config.scanMode)}`, "ok");
}

export function getScanMode() {
  return config.scanMode;
}

// ═══════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════

let working = [];
let personalWorking = []; // always tried first
let retired = [];
let banned = new Map();
let lastBgScan = 0;
const BG_SCAN_COOLDOWN_MS = parseInt(process.env.PROXY_BG_SCAN_MS || String(3 * 60 * 1000), 10);
const successScore = new Map(); // host:port → real API success count
const rateLimitUntil = new Map(); // host:port → skip until ts
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
  const auth =
    proxy.user && proxy.pass
      ? `${encodeURIComponent(proxy.user)}:${encodeURIComponent(proxy.pass)}@`
      : proxy.user
        ? `${encodeURIComponent(proxy.user)}@`
        : "";
  const label = proxy.label || (proxy.user ? `${proxy.user}@${hostport}` : hostport);
  try {
    if (proxy.type === "http" || proxy.type === "https") {
      return {
        key: label,
        agent: new HttpsProxyAgent(`http://${auth}${hostport}`),
        type: proxy.type,
      };
    }
    if (proxy.type === "socks5") {
      return {
        key: label,
        agent: new SocksProxyAgent(`socks5://${auth}${hostport}`),
        type: "socks5",
      };
    }
    if (proxy.type === "socks4") {
      return {
        key: label,
        agent: new SocksProxyAgent(`socks4://${auth}${hostport}`),
        type: "socks4",
      };
    }
  } catch {
    return null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Fetch candidate lists
// ═══════════════════════════════════════════════════════════════════

async function fetchCandidates() {
  const all = new Map();
  lastCounts = {};

  // Personal proxies always first (highest priority)
  const { proxies: custom, counts } = await loadCustomProxies();
  for (const p of custom) {
    const key = `${p.host}:${p.port}`;
    all.set(key, { ...p, fromCustom: true });
  }
  if (custom.length) {
    if (counts.plain) lastCounts.custom = counts.plain;
    if (counts.v2ray) lastCounts.v2ray = counts.v2ray;
    log(
      "PROXY",
      `personal proxies: ${color.bold(String(custom.length))}` +
        (counts.v2ray ? color.dim(` (${counts.plain} classic + ${counts.v2ray} v2ray)`) : ""),
      "ok"
    );
  }

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

  let srcDone = 0;
  const srcTotal = config.sources.length;
  log("PROXY", `fetching ${srcTotal} sources…`, "proxy");
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
        const addOne = (host, port, type) => {
          const p = parseInt(port, 10);
          if (!host || !(p >= 1 && p <= 65535)) return;
          const key = `${host}:${p}`;
          if (!all.has(key)) {
            all.set(key, { host, port: p, type: type || src.type });
            n++;
          }
        };
        // Geonode / JSON lists
        if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
          try {
            const j = JSON.parse(text);
            const arr = Array.isArray(j) ? j : j.data || j.proxies || j.list || [];
            for (const item of arr) {
              if (!item) continue;
              if (typeof item === "string") {
                let l = item.replace(/^(https?|socks[45]?):\/\//i, "");
                const m = l.match(/^([0-9a-fA-F:.]+):(\d{1,5})/);
                if (m) addOne(m[1], m[2], src.type);
                continue;
              }
              const host = item.ip || item.host || item.addr || item.address;
              const port = item.port;
              let type = src.type;
              const proto = String(item.protocols?.[0] || item.protocol || item.type || "").toLowerCase();
              if (proto.includes("socks5")) type = "socks5";
              else if (proto.includes("socks4")) type = "socks4";
              else if (proto.includes("http")) type = "http";
              addOne(host, port, type);
            }
          } catch { /* fall through to line parse */ }
        }
        for (const line of text.split("\n")) {
          let l = line.trim();
          if (!l || l.startsWith("#") || l.startsWith("{") || l.startsWith("[")) continue;
          l = l.replace(/^(https?|socks[45]?):\/\//i, "");
          // user:pass@host:port
          const auth = l.match(/@([0-9a-fA-F:.]+):(\d{1,5})/);
          if (auth) {
            addOne(auth[1], auth[2], src.type);
            continue;
          }
          const m = l.match(/^([0-9a-fA-F:.]+):(\d{1,5})/);
          if (m) addOne(m[1], m[2], src.type);
        }
        lastCounts[src.type] = (lastCounts[src.type] || 0) + n;
      } catch {
        /* source flaky */
      } finally {
        srcDone++;
        if (srcDone % 40 === 0 || srcDone === srcTotal) {
          log("PROXY", `sources ${srcDone}/${srcTotal} · unique ${all.size}`, "info");
        }
      }
    })
  );

  return [...all.values()];
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: connectivity probe  |  Phase 2: strict Zen API test
// ═══════════════════════════════════════════════════════════════════

const TEST_BODY = JSON.stringify({
  model: "deepseek-v4-flash-free",
  messages: [{ role: "user", content: "hi" }],
  stream: false,
});

/** Phase 1 — does the proxy reach the internet / opencode.ai at all? */
function probeConnect(proxy) {
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
    const timer = setTimeout(
      () => finish(null),
      proxy.v2ray ? config.v2rayTimeoutMs : Math.min(config.testTimeoutMs, 2500)
    );
    const start = Date.now();

    try {
      req = https.request(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          agent: made.agent,
          path: "/",
          method: "HEAD",
          rejectUnauthorized: false,
        },
        (res) => {
          res.resume();
          finish({
            host: proxy.host,
            port: proxy.port,
            type: proxy.type || made.type,
            user: proxy.user,
            pass: proxy.pass,
            fromCustom: !!proxy.fromCustom,
            fromCache: !!proxy.fromCache,
            v2ray: !!proxy.v2ray,
            label: proxy.label,
            latency: Date.now() - start,
            agent: made.agent,
            key: made.key,
          });
        }
      );
      req.on("error", () => finish(null));
      req.end();
    } catch {
      finish(null);
    }
  });
}

/**
 * Phase 2 — real chat request to Zen.
 * Only SUCCESS with model content counts. Rate-limit / ban / empty = fail (null).
 */
function testProxyZen(proxy) {
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
    const timer = setTimeout(
      () => finish(null),
      proxy.v2ray ? config.v2rayTimeoutMs * 2 : config.testTimeoutMs
    );
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
          // STRICT success only — rate-limit / ban / html / empty do NOT pass
          if (res.statusCode === 429) return finish(null);
          if (!body.startsWith("{")) return finish(null);
          try {
            const j = JSON.parse(body);
            const msg = String(j?.error?.message || j?.message || "").toLowerCase();
            const typ = String(j?.error?.type || j?.type || "").toLowerCase();
            if (
              msg.includes("rate limit") ||
              msg.includes("freeusagelimit") ||
              msg.includes("quota") ||
              msg.includes("banned") ||
              msg.includes("blocked") ||
              typ.includes("rate_limit")
            ) {
              return finish(null);
            }
            const hasContent =
              !!j?.choices?.[0]?.message?.content ||
              !!j?.choices?.[0]?.delta?.content;
            if (!hasContent) return finish(null);
            finish({
              key: made.key,
              agent: made.agent,
              latency,
              type: made.type || proxy.type,
              host: proxy.host,
              port: proxy.port,
              user: proxy.user,
              pass: proxy.pass,
              fromCustom: !!proxy.fromCustom,
              v2ray: !!proxy.v2ray,
              label: proxy.label,
            });
          } catch {
            finish(null);
          }
        });
      }
    );
    req.on("error", () => finish(null));
    req.end(TEST_BODY);
  });
}

async function runPool(items, workerFn, concurrency, label) {
  const queue = [...items];
  const results = [];
  let tested = 0;
  let found = 0;
  const total = queue.length;
  const reportEvery = Math.max(25, Math.floor(total / 10) || 1);

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      const r = await workerFn(item);
      tested++;
      if (r) {
        results.push(r);
        found++;
      }
      if (tested % reportEvery === 0 || tested === total) {
        log(
          "SCAN",
          `${label} ${tested}/${total} · live ${found} · ${Math.round((tested / total) * 100)}%`,
          "info"
        );
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(total, 1)) }, worker)
  );
  return results;
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

    // Order: personal → cache → shuffled public
    const customOnes = candidates.filter((p) => p.fromCustom);
    const cachedOnes = candidates.filter((p) => p.fromCache && !p.fromCustom);
    const freshOnes = candidates.filter((p) => !p.fromCache && !p.fromCustom);
    for (let i = freshOnes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [freshOnes[i], freshOnes[j]] = [freshOnes[j], freshOnes[i]];
    }
    const rank = (p) =>
      (p.type === "http" || p.type === "https" ? 0 : p.type === "socks5" ? 1 : 2);
    freshOnes.sort((a, b) => rank(a) - rank(b));

    const isSuper = config.scanMode === "super";
    let sample;
    if (isSuper) {
      // SUPER: every unique proxy, no sampling cap — may take a long time
      sample = [...customOnes, ...cachedOnes, ...freshOnes];
      log(
        "PROXY",
        `SUPER scan · ${color.bold(String(sample.length))} unique from all sources (no limit)`,
        "warn"
      );
    } else {
      const limit = config.deepScan
        ? Math.min(candidates.length, config.maxScan)
        : config.sampleSize;
      sample = [...customOnes, ...cachedOnes, ...freshOnes].slice(
        0,
        Math.max(limit, config.sampleSize)
      );
      log(
        "PROXY",
        `NORMAL scan · sample ${color.bold(String(sample.length))} / ${candidates.length}`,
        "proxy"
      );
    }

    // ── Phase 1: alive? (no chat API) ─────────────────────────────
    const conc1 = isSuper ? Math.max(config.concurrency, 250) : config.concurrency;
    log(
      "PROXY",
      `phase1 connect ${color.bold(String(sample.length))} · conc ${conc1}`,
      "proxy"
    );
    let alive = await runPool(sample, probeConnect, conc1, "connect");
    log("PROXY", `phase1 done · ${color.bold(String(alive.length))} reachable`, "ok");

    // Personal always enter phase2 even if connect was flaky —
    // EXCEPT V2Ray nodes: a subscription can hold dozens of dead servers, so
    // only the ones that really reach opencode.ai stay in the personal tier.
    const aliveKeys = new Set(alive.map((p) => `${p.host}:${p.port}`));
    const reachableV2ray = new Set(alive.filter((p) => p.v2ray).map((p) => `${p.host}:${p.port}`));
    const v2rayTotal = customOnes.filter((c) => c.v2ray).length;
    if (v2rayTotal) {
      log(
        "V2RAY",
        `${color.bold(String(reachableV2ray.size))}/${v2rayTotal} node(s) reach opencode.ai`,
        reachableV2ray.size ? "ok" : "warn"
      );
    }
    for (const c of customOnes) {
      if (c.v2ray) continue;
      if (!aliveKeys.has(`${c.host}:${c.port}`)) {
        alive.unshift({ ...c, latency: 99999, fromCustom: true });
        aliveKeys.add(`${c.host}:${c.port}`);
      }
    }

    if (!alive.length) throw new Error("phase1: nobody reachable");

    alive.sort((a, b) => {
      const sa = successScore.get(`${a.host}:${a.port}`) || 0;
      const sb = successScore.get(`${b.host}:${b.port}`) || 0;
      if (sb !== sa) return sb - sa;
      return (a.latency || 99999) - (b.latency || 99999);
    });

    // ── Phase 2: real OpenCode request — only CLEAN enter pool ────
    // Reject rate-limit / ban / empty. Only real model content = pass.
    // SUPER: test ALL reachable; NORMAL: cap by maxScan
    const phase2List = isSuper
      ? alive
      : alive.slice(0, Math.min(alive.length, config.maxScan));
    const zenConc = isSuper
      ? Math.min(60, Math.max(config.concurrency, 40))
      : Math.min(40, config.concurrency);
    log(
      "PROXY",
      `phase2 zen-clean ${color.bold(String(phase2List.length))} · conc ${zenConc} · mode=${config.scanMode}`,
      "proxy"
    );
    const results = await runPool(phase2List, testProxyZen, zenConc, "zen");
    log(
      "PROXY",
      `phase2 done · ${color.bold(String(results.length))} clean for real use`,
      "ok"
    );

    // Personal always available for real use even if phase2 was rate-limited
    const resultKeys = new Set(results.map((r) => `${r.host}:${r.port}`));
    for (const c of customOnes) {
      const ck = `${c.host}:${c.port}`;
      if (resultKeys.has(ck)) continue;
      if (c.v2ray && !reachableV2ray.has(ck)) continue; // dead tunnel → not "personal always-on"
      const made = makeAgent(c);
      if (!made) continue;
      results.unshift({
        v2ray: !!c.v2ray,
        key: made.key,
        agent: made.agent,
        latency: 99999,
        type: made.type,
        host: c.host,
        port: c.port,
        user: c.user,
        pass: c.pass,
        fromCustom: true,
      });
    }

    results.sort((a, b) => {
      if (!!b.fromCustom !== !!a.fromCustom) return a.fromCustom ? -1 : 1;
      const sa = successScore.get(`${a.host}:${a.port}`) || 0;
      const sb = successScore.get(`${b.host}:${b.port}`) || 0;
      if (sb !== sa) return sb - sa;
      return (a.latency || 99999) - (b.latency || 99999);
    });

    // Tag results that came from personal candidates
    const customKeys = new Set(
      candidates.filter((c) => c.fromCustom).map((c) => `${c.host}:${c.port}`)
    );
    for (const r of results) {
      const host = r.host || String(r.key).split("@").pop().split(":")[0];
      const port = r.port || parseInt(String(r.key).split(":").pop(), 10);
      if (customKeys.has(`${host}:${port}`)) r.fromCustom = true;
    }

    const personalHits = results.filter((r) => r.fromCustom);
    const publicHits = results.filter((r) => !r.fromCustom);
    const pool = [
      ...personalHits,
      ...publicHits.slice(0, Math.max(0, config.poolSize - personalHits.length)),
    ];

    // Always (re)build personalWorking from live custom hits; keep previous personal if retest failed temporarily
    if (personalHits.length) {
      personalWorking = personalHits;
    } else {
      personalWorking = personalWorking.filter((p) => !p.v2ray);
    }
    if (!personalHits.length && customOnes.length && !personalWorking.length) {
      // Build agents for custom even if strict test failed — still try them at request time
      const built = [];
      for (const c of customOnes) {
        if (c.v2ray) continue;
        const made = makeAgent(c);
        if (made) {
          built.push({
            key: made.key,
            agent: made.agent,
            latency: 99999,
            type: made.type,
            host: c.host,
            port: c.port,
            fromCustom: true,
            user: c.user,
            pass: c.pass,
          });
        }
      }
      if (built.length) personalWorking = built;
    }

    if (pool.length > 0 || personalWorking.length > 0) {
      retired.push(...working);
      working = pool.length ? pool : [...personalWorking];
      for (const p of retired) {
        setTimeout(() => {
          try { p.agent.destroy(); } catch {}
        }, 30_000);
      }
      retired = [];
      saveCache(working.filter((p) => !p.fromCustom).slice(0, config.poolSize));
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
  const now = Date.now();
  for (const [key, until] of banned) {
    if (now > until) banned.delete(key);
  }
  for (const [k, until] of rateLimitUntil) {
    if (now > until) rateLimitUntil.delete(k);
  }

  // Personal first ALWAYS. Public skips banned + short rate-limit cooldown.
  const personal = personalWorking.filter((p) => p.agent);
  const publicAvail = working.filter((p) => {
    if (!p.agent || p.fromCustom) return false;
    if (banned.has(p.key)) return false;
    const until = rateLimitUntil.get(`${p.host}:${p.port}`);
    if (until && now < until) return false;
    return true;
  });

  const ordered = [...personal, ...publicAvail];
  if (!ordered.length) return [];

  const n = Math.min(config.maxAttempts, ordered.length);
  const list = [];
  // Always include all personal first, then fill with public round-robin
  for (const p of personal) {
    if (list.length >= n) break;
    list.push(p.agent);
  }
  const need = n - list.length;
  for (let i = 0; i < need; i++) {
    if (!publicAvail.length) break;
    list.push(publicAvail[(cursor + i) % publicAvail.length].agent);
  }
  if (publicAvail.length) cursor = (cursor + Math.max(need, 1)) % publicAvail.length;
  return list;
}

/** Call when a request succeeded via direct or a personal proxy — kick a background full scan. */
export function scheduleBackgroundScan(reason = "ok-path") {
  const now = Date.now();
  if (refreshing) return;
  if (now - lastBgScan < BG_SCAN_COOLDOWN_MS) return;
  lastBgScan = now;
  log("PROXY", `background scan queued (${reason})`, "proxy");
  setImmediate(() => {
    refresh().catch(() => {});
  });
}

/** True if this agent belongs to a personal proxy entry. */
export function isPersonalAgent(agent) {
  if (!agent) return false;
  return personalWorking.some((p) => p.agent === agent);
}

export function banProxy(agent, ms) {
  if (!agent) return;
  // Never ban personal proxies — those are the user's own servers
  if (isPersonalAgent(agent)) {
    log("PROXY", "skip ban (personal proxy)", "info");
    return;
  }
  const p = working.find((x) => x.agent === agent);
  if (!p) return;
  const duration = ms ?? config.cooldownMs;
  banned.set(p.key, Date.now() + duration);
  const left = working.filter((x) => !banned.has(x.key)).length;
  log("PROXY", `banned ${color.bYellow(p.key)} for ${duration / 1000}s (available: ${left})`, "warn");
}

export function banProxySoft(agent) {
  if (!agent || isPersonalAgent(agent)) return;
  banProxy(agent, config.failCooldownMs);
}

/** Real traffic success — promote proxy for next picks */
export function markProxySuccess(agent) {
  const p =
    working.find((x) => x.agent === agent) ||
    personalWorking.find((x) => x.agent === agent);
  if (!p) return;
  const k = `${p.host}:${p.port}`;
  successScore.set(k, (successScore.get(k) || 0) + 1);
  rateLimitUntil.delete(k);
  // Move to front of working (public) or personal list
  if (p.fromCustom) {
    personalWorking = [p, ...personalWorking.filter((x) => x !== p)];
  } else {
    working = [p, ...working.filter((x) => x !== p)];
  }
}

/** Real traffic rate-limit on this path — soft skip briefly (not a dead proxy) */
export function markProxyRateLimit(agent, ms = 30_000) {
  if (!agent || isPersonalAgent(agent)) return; // never sideline personal
  const p = working.find((x) => x.agent === agent);
  if (!p) return;
  rateLimitUntil.set(`${p.host}:${p.port}`, Date.now() + ms);
  log("PROXY", `rate-limit skip ${p.key} for ${ms / 1000}s`, "warn");
}


export function getPoolInfo() {
  return {
    enabled: config.enabled,
    attemptsPerRequest: config.maxAttempts,
    working: working.map((p) => ({
      proxy: p.key,
      latency: p.latency,
      type: p.type,
      personal: !!p.fromCustom,
      v2ray: !!p.v2ray,
    })),
    personalCount: personalWorking.length,
    v2ray: { enabled: isV2rayEnabled(), ...getV2rayInfo(), reachable: personalWorking.filter((p) => p.v2ray).length },
    workingCount: working.length,
    bannedCount: banned.size,
    sources: config.sources.length,
    scanMode: config.scanMode,
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
  log("PROXY", `enabled · ${color.bold(String(config.sources.length))} sources · mode=${config.scanMode} · sample ${config.sampleSize} · pool ${config.poolSize}`, "ok");
}

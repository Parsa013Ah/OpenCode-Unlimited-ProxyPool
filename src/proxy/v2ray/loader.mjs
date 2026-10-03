/**
 * loader.mjs — Collect V2Ray nodes from every supported input.
 *
 * Inputs (all optional, merged, de-duplicated):
 *   • config/v2ray.txt            one item per line: share link  OR  http(s):// subscription URL
 *   • config/v2ray/*.json         Xray / V2Ray / v2rayN JSON configs (proxy outbounds are extracted)
 *   • config/custom-proxies.txt   vmess:// vless:// trojan:// ss:// lines are routed here automatically
 *   • env V2RAY_LINKS             share links, whitespace / newline separated
 *   • env V2RAY_SUBS              subscription URLs, whitespace / newline separated
 *
 * Subscription bodies are cached on disk, so a temporarily unreachable
 * subscription (common under filtering) does not empty the pool.
 */
import fs from "fs";
import path from "path";
import { PATHS, ensureDirs } from "../../paths.mjs";
import { log, color } from "../../ui/banner.mjs";
import { tryParseV2rayLink, isV2rayLink, decodeSubscription } from "./links.mjs";
import { nodesFromJson } from "./xray-config.mjs";

const SUBS_CACHE = path.join(PATHS.xrayDir, "subs-cache.json");
const SUB_TIMEOUT_MS = parseInt(process.env.V2RAY_SUB_TIMEOUT_MS || "20000", 10);
export const MAX_NODES = parseInt(process.env.V2RAY_MAX_NODES || "64", 10);

const isHttpUrl = (s) => /^https?:\/\//i.test(s);
const words = (text) => String(text || "").split(/\s+/).map((x) => x.trim()).filter(Boolean);

function readLines(file) {
  try {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  } catch (e) {
    log("V2RAY", `cannot read ${file}: ${e.message}`, "warn");
    return [];
  }
}

function loadSubsCache() {
  try { return JSON.parse(fs.readFileSync(SUBS_CACHE, "utf8")); } catch { return {}; }
}

function saveSubsCache(cache) {
  try {
    ensureDirs();
    fs.writeFileSync(SUBS_CACHE, JSON.stringify(cache, null, 2));
  } catch { /* best effort */ }
}

async function fetchSubscription(url, cache) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(SUB_TIMEOUT_MS),
      headers: { "User-Agent": "v2rayN/7.0 (opencode-free-proxy)", Accept: "*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const links = decodeSubscription(await res.text());
    if (!links.length) throw new Error("no supported links in response");
    cache[url] = { ts: Date.now(), links };
    return { links, fromCache: false };
  } catch (e) {
    const hit = cache[url];
    if (hit?.links?.length) {
      log("V2RAY", `subscription unreachable (${e.message}) — using cache from ${new Date(hit.ts).toISOString().slice(0, 16)}`, "warn");
      return { links: hit.links, fromCache: true };
    }
    log("V2RAY", `subscription failed: ${e.message}`, "warn");
    return { links: [], fromCache: false };
  }
}

/**
 * @param {string[]} [extraLinks] V2Ray links found in other files (e.g. custom-proxies.txt)
 * @returns {Promise<{nodes:object[], skipped:{what:string, reason:string}[], subs:number}>}
 */
export async function collectV2rayNodes(extraLinks = []) {
  const links = [...extraLinks];
  const subs = [];

  const route = (item) => {
    if (isHttpUrl(item)) subs.push(item);
    else if (isV2rayLink(item)) links.push(item);
  };

  readLines(PATHS.v2rayLinks).forEach(route);
  words(process.env.V2RAY_LINKS).forEach(route);
  words(process.env.V2RAY_SUBS).filter(isHttpUrl).forEach((u) => subs.push(u));

  // subscriptions
  const cache = loadSubsCache();
  let subCount = 0;
  for (const url of [...new Set(subs)]) {
    const r = await fetchSubscription(url, cache);
    if (r.links.length) subCount++;
    links.push(...r.links);
  }
  if (subs.length) saveSubsCache(cache);

  const nodes = [];
  const skipped = [];
  const seen = new Set();
  const add = (n) => {
    if (seen.has(n.uid)) return;
    seen.add(n.uid);
    nodes.push(n);
  };

  for (const link of links) {
    const { node, error } = tryParseV2rayLink(link);
    if (node) add(node);
    else skipped.push({ what: link.slice(0, 40) + (link.length > 40 ? "…" : ""), reason: error });
  }

  // JSON configs
  try {
    if (fs.existsSync(PATHS.v2rayConfigDir)) {
      for (const f of fs.readdirSync(PATHS.v2rayConfigDir).filter((x) => /\.json$/i.test(x))) {
        try {
          const json = JSON.parse(fs.readFileSync(path.join(PATHS.v2rayConfigDir, f), "utf8"));
          const found = nodesFromJson(json, f);
          if (!found.length) skipped.push({ what: f, reason: "no vmess/vless/trojan/shadowsocks outbound found" });
          found.forEach(add);
        } catch (e) {
          skipped.push({ what: f, reason: `invalid JSON (${e.message})` });
        }
      }
    }
  } catch { /* ignore */ }

  if (skipped.length) {
    const sample = skipped.slice(0, 3).map((s) => `${s.what} → ${s.reason}`).join(" | ");
    log("V2RAY", `skipped ${color.bold(String(skipped.length))} unsupported/invalid: ${sample}${skipped.length > 3 ? " …" : ""}`, "warn");
  }

  if (nodes.length > MAX_NODES) {
    log("V2RAY", `${nodes.length} nodes found — using the first ${MAX_NODES} (raise V2RAY_MAX_NODES to change)`, "warn");
    nodes.length = MAX_NODES;
  }

  return { nodes, skipped, subs: subCount };
}

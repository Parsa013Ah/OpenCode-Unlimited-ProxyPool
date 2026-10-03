/**
 * paths.mjs — Single source of truth for every file/dir the app touches.
 *
 * Layout:
 *   config/  user-editable input   (custom-proxies.txt, v2ray.txt, ...)
 *   data/    runtime state         (config.json, api-keys.json, proxy-cache.json, xray/)
 *
 * All paths can still be overridden with env vars (CONFIG_FILE, KEYS_FILE, ...).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG_DIR = process.env.CONFIG_DIR || path.join(ROOT, "config");
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");

export const PATHS = {
  configJson: process.env.CONFIG_FILE || path.join(DATA_DIR, "config.json"),
  apiKeys: process.env.KEYS_FILE || path.join(DATA_DIR, "api-keys.json"),
  proxyCache: process.env.PROXY_CACHE_FILE || path.join(DATA_DIR, "proxy-cache.json"),

  customProxies: process.env.PROXY_CUSTOM_FILE || path.join(CONFIG_DIR, "custom-proxies.txt"),
  v2rayLinks: process.env.V2RAY_FILE || path.join(CONFIG_DIR, "v2ray.txt"),
  v2rayConfigDir: process.env.V2RAY_CONFIG_DIR || path.join(CONFIG_DIR, "v2ray"),

  xrayDir: path.join(DATA_DIR, "xray"),
  xrayRuntimeConfig: path.join(DATA_DIR, "xray", "runtime-config.json"),
};

export function ensureDirs() {
  for (const d of [CONFIG_DIR, DATA_DIR, PATHS.xrayDir]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  }
}

/**
 * Older versions kept everything in the project root.
 * Move those files into the new layout once, so upgrades keep working.
 */
export function migrateLegacyFiles() {
  ensureDirs();
  const moves = [
    ["config.json", PATHS.configJson],
    ["api-keys.json", PATHS.apiKeys],
    ["proxy-cache.json", PATHS.proxyCache],
    ["custom-proxies.txt", PATHS.customProxies],
  ];
  const moved = [];
  for (const [legacyName, target] of moves) {
    const legacy = path.join(ROOT, legacyName);
    try {
      if (fs.existsSync(legacy) && !fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(legacy, target);
        moved.push(legacyName);
      }
    } catch { /* best effort */ }
  }
  return moved;
}

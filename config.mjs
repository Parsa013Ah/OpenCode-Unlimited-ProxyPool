/**
 * config.mjs — Simple JSON settings (auto-created on first run)
 */
import fs from "fs";
import { log, color } from "./banner.mjs";

export const CONFIG_FILE = process.env.CONFIG_FILE || "./config.json";

export const DEFAULTS = {
  // Network
  port: 8787,
  // "localhost" = only this PC | "network" = all interfaces (LAN)
  bind: "network",

  // Tray
  tray: true,
  hideConsole: false,

  // Proxy pool
  proxyEnabled: true,

  // UI / stats
  dashboard: true,

  // Accept any API key (handy for Hermes / local tools)
  openAuth: true,
};

let config = { ...DEFAULTS };

/** Coerce bad values back to defaults (protects against hand-edited config.json). */
function sanitize(cfg) {
  const p = parseInt(cfg.port, 10);
  cfg.port = Number.isInteger(p) && p >= 1 && p <= 65535 ? p : DEFAULTS.port;
  if (cfg.bind !== "localhost" && cfg.bind !== "network") cfg.bind = DEFAULTS.bind;
  for (const k of ["tray", "hideConsole", "proxyEnabled", "dashboard", "openAuth"]) {
    if (typeof cfg[k] !== "boolean") cfg[k] = DEFAULTS[k];
  }
  return cfg;
}

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      config = sanitize({ ...DEFAULTS, ...raw });
    } else {
      config = sanitize({ ...DEFAULTS });
      saveConfig(config);
      log("CFG", `created ${color.bCyan(CONFIG_FILE)} with defaults`, "ok");
    }
  } catch (e) {
    log("CFG", `load failed, using defaults: ${e.message}`, "warn");
    config = sanitize({ ...DEFAULTS });
  }

  // Env overrides (highest priority)
  if (process.env.PROXY_PORT) config.port = parseInt(process.env.PROXY_PORT, 10) || config.port;
  if (process.env.PROXY_BIND === "localhost" || process.env.PROXY_BIND === "127.0.0.1") config.bind = "localhost";
  if (process.env.PROXY_BIND === "network" || process.env.PROXY_BIND === "0.0.0.0") config.bind = "network";
  if (process.env.PROXY_TRAY === "0") config.tray = false;
  if (process.env.PROXY_TRAY === "1") config.tray = true;
  if (process.env.PROXY_HIDE_CONSOLE === "1") config.hideConsole = true;
  if (process.env.PROXY_ENABLED === "0") config.proxyEnabled = false;
  if (process.env.PROXY_ENABLED === "1") config.proxyEnabled = true;
  if (process.env.PROXY_DASHBOARD === "0") config.dashboard = false;
  if (process.env.PROXY_DASHBOARD === "1") config.dashboard = true;
  if (process.env.PROXY_OPEN_AUTH === "0") config.openAuth = false;
  if (process.env.PROXY_OPEN_AUTH === "1") config.openAuth = true;
  if (process.argv.includes("--tray")) config.tray = true;
  if (process.argv.includes("--hide")) config.hideConsole = true;
  if (process.argv.includes("--no-tray")) config.tray = false;

  return config;
}

export function saveConfig(next) {
  config = sanitize({ ...config, ...next });
  const toSave = { ...DEFAULTS, ...config };
  // don't persist pure runtime noise
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2));
  return config;
}

/** Restore every setting to its default and persist. */
export function resetConfig() {
  config = sanitize({ ...DEFAULTS });
  saveConfig(config);
  return config;
}

export function getConfig() {
  return config;
}

export function hostFromBind(bind) {
  return bind === "localhost" || bind === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0";
}
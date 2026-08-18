/**
 * config.mjs — Simple JSON settings (auto-created on first run)
 */
import fs from "fs";
import path from "path";
import { log, color } from "./banner.mjs";

const CONFIG_FILE = process.env.CONFIG_FILE || "./config.json";

const DEFAULTS = {
  // Network
  port: 8787,
  // "localhost" = only this PC | "network" = all interfaces (LAN)
  bind: "network",

  // Tray
  tray: true,
  hideConsole: false,

  // Proxy pool
  proxyEnabled: true,
  // "normal" = sampled scan | "super" = all unique proxies (slow)
  scanMode: "normal",

  // UI / stats
  dashboard: true,

  // Accept any API key (handy for Hermes / local tools)
  openAuth: true,
};

let config = { ...DEFAULTS };

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      config = { ...DEFAULTS, ...raw };
    } else {
      saveConfig(DEFAULTS);
      config = { ...DEFAULTS };
      log("CFG", `created ${color.bCyan(CONFIG_FILE)} with defaults`, "ok");
    }
  } catch (e) {
    log("CFG", `load failed, using defaults: ${e.message}`, "warn");
    config = { ...DEFAULTS };
  }

  // Env overrides (highest priority)
  if (process.env.PROXY_PORT) config.port = parseInt(process.env.PROXY_PORT, 10) || config.port;
  if (process.env.PROXY_BIND === "localhost" || process.env.PROXY_BIND === "127.0.0.1") config.bind = "localhost";
  if (process.env.PROXY_BIND === "network" || process.env.PROXY_BIND === "0.0.0.0") config.bind = "network";
  if (process.env.PROXY_TRAY === "0") config.tray = false;
  if (process.env.PROXY_TRAY === "1") config.tray = true;
  if (process.env.PROXY_HIDE_CONSOLE === "1") config.hideConsole = true;
  if (process.env.PROXY_ENABLED === "0") config.proxyEnabled = false;
  if (process.env.PROXY_SCAN_MODE === "super" || process.env.PROXY_SCAN_MODE === "normal") {
    config.scanMode = process.env.PROXY_SCAN_MODE;
  }
  if (process.argv.includes("--tray")) config.tray = true;
  if (process.argv.includes("--hide")) config.hideConsole = true;
  if (process.argv.includes("--no-tray")) config.tray = false;

  return config;
}

export function saveConfig(next) {
  config = { ...config, ...next };
  const toSave = { ...DEFAULTS, ...config };
  // don't persist pure runtime noise
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2));
  return config;
}

export function getConfig() {
  return config;
}

export function hostFromBind(bind) {
  return bind === "localhost" || bind === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0";
}

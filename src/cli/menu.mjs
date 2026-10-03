/**
 * menu.mjs — Interactive settings menu (run: npm run config)
 * No extra dependencies — pure readline.
 */
import fs from "fs";
import readline from "readline";
import { loadConfig, saveConfig, getConfig, resetConfig, hostFromBind } from "../config.mjs";
import { color, hr } from "../ui/banner.mjs";
import { PATHS } from "../paths.mjs";
import { findXray, xrayVersion } from "../proxy/v2ray/installer.mjs";
import { isV2rayLink, tryParseV2rayLink } from "../proxy/v2ray/links.mjs";

loadConfig();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q) {
  return new Promise((resolve) => rl.question(q, (a) => resolve(String(a || "").trim())));
}

function clear() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[0f");
}

function pause() {
  return ask(color.dim("\n  Press Enter to continue…"));
}

function showHeader(cfg) {
  console.log("");
  console.log(color.bCyan("  ╔══════════════════════════════════════════╗"));
  console.log(color.bCyan("  ║") + color.bold("     OpenCode Proxy · Settings Menu     ") + color.bCyan("║"));
  console.log(color.bCyan("  ╚══════════════════════════════════════════╝"));
  console.log("");
  console.log(color.dim("  Current config (data/config.json)"));
  console.log(color.dim("  " + "─".repeat(42)));
  console.log(`  ${color.bold("Port")}           ${color.bGreen(String(cfg.port))}`);
  console.log(`  ${color.bold("Bind")}           ${color.bGreen(cfg.bind)}  ${color.dim(`(${hostFromBind(cfg.bind)})`)}`);
  console.log(`  ${color.bold("Tray")}           ${cfg.tray ? color.bGreen("on") : color.gray("off")}`);
  console.log(`  ${color.bold("Hide console")}   ${cfg.hideConsole ? color.bGreen("on") : color.gray("off")}`);
  console.log(`  ${color.bold("Proxy pool")}     ${cfg.proxyEnabled ? color.bGreen("on") : color.gray("off")}`);
  console.log(`  ${color.bold("V2Ray")}          ${cfg.v2rayEnabled !== false ? color.bGreen("on") : color.gray("off")}`);
  console.log(`  ${color.bold("Scan mode")}      ${color.bGreen(cfg.scanMode || "normal")}`);
  console.log(`  ${color.bold("Dashboard")}      ${cfg.dashboard !== false ? color.bGreen("on") : color.gray("off")}`);
  console.log(color.dim("  " + "─".repeat(42)));
  console.log("");
}

async function setPort() {
  const cfg = getConfig();
  const v = await ask(`  New port [${cfg.port}]: `);
  if (!v) return;
  const p = parseInt(v, 10);
  if (!(p >= 1 && p <= 65535)) {
    console.log(color.error("  ✖ Invalid port (1–65535)"));
    await pause();
    return;
  }
  saveConfig({ port: p });
  console.log(color.success(`  ✔ Port set to ${p}`) + color.dim("  (restart server to apply)"));
  await pause();
}

async function setBind() {
  console.log("");
  console.log(`  ${color.bCyan("1")}  localhost  ${color.dim("— only this PC")}`);
  console.log(`  ${color.bCyan("2")}  network    ${color.dim("— LAN access (0.0.0.0)")}`);
  const v = await ask("  Choose [1/2]: ");
  if (v === "1") {
    saveConfig({ bind: "localhost" });
    console.log(color.success("  ✔ Bind = localhost") + color.dim("  (restart to apply)"));
  } else if (v === "2") {
    saveConfig({ bind: "network" });
    console.log(color.success("  ✔ Bind = network") + color.dim("  (restart to apply)"));
  }
  await pause();
}

async function toggle(key, label) {
  const cfg = getConfig();
  const next = !cfg[key];
  saveConfig({ [key]: next });
  console.log(color.success(`  ✔ ${label} → ${next ? "on" : "off"}`));
  if (key === "tray" || key === "hideConsole") {
    console.log(color.dim("    Applies on next server start"));
  }
  if (key === "proxyEnabled" || key === "v2rayEnabled") {
    console.log(color.dim("    Restart server to apply"));
  }
  await pause();
}

async function setScanModeMenu() {
  console.log("");
  console.log(`  ${color.bCyan("1")}  normal  ${color.dim("— sample + capped zen test (fast)")}`);
  console.log(`  ${color.bCyan("2")}  super   ${color.dim("— ALL unique proxies, full zen test (slow)")}`);
  const v = await ask("  Choose [1/2]: ");
  if (v === "1") {
    saveConfig({ scanMode: "normal" });
    console.log(color.success("  ✔ Scan mode = normal") + color.dim("  (restart to apply)"));
  } else if (v === "2") {
    saveConfig({ scanMode: "super" });
    console.log(color.success("  ✔ Scan mode = super") + color.dim("  (restart — may take a long time)"));
  }
  await pause();
}

/** Static overview of the V2Ray setup (no network, no subscription fetching). */
async function v2rayInfo() {
  console.log("");
  console.log(color.bold("  V2Ray / Xray"));
  console.log(color.dim("  " + "─".repeat(42)));

  const bin = findXray();
  if (bin) {
    console.log(`  Xray-core   ${color.bGreen("found")}  ${color.dim(`v${xrayVersion(bin) || "?"} · ${bin}`)}`);
  } else {
    console.log(`  Xray-core   ${color.warn("not installed")}  ${color.dim("(downloaded automatically on first start)")}`);
  }

  const readLines = (f) => {
    try {
      return fs.readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    } catch { return []; }
  };
  const fromCustom = readLines(PATHS.customProxies).filter(isV2rayLink);
  const fromV2 = readLines(PATHS.v2rayLinks);
  const links = [...fromCustom, ...fromV2.filter(isV2rayLink)];
  const subs = fromV2.filter((l) => /^https?:\/\//i.test(l));
  const ok = links.filter((l) => tryParseV2rayLink(l).node).length;
  let jsonCount = 0;
  try { jsonCount = fs.readdirSync(PATHS.v2rayConfigDir).filter((f) => /\.json$/i.test(f)).length; } catch {}

  console.log(`  Share links ${color.bold(String(ok))} valid / ${links.length} total  ${color.dim(`(${PATHS.v2rayLinks})`)}`);
  console.log(`  Subscriptions ${color.bold(String(subs.length))}  ${color.dim("(http/https lines in v2ray.txt or V2RAY_SUBS)")}`);
  console.log(`  JSON configs  ${color.bold(String(jsonCount))}  ${color.dim(`(${PATHS.v2rayConfigDir}/*.json)`)}`);
  console.log("");
  await pause();
}

async function editRaw() {
  const cfg = getConfig();
  console.log("");
  console.log(color.dim("  Full JSON will open as text path:"));
  console.log(`  ${color.bCyan(PATHS.configJson)}`);
  console.log("");
  console.log(JSON.stringify(cfg, null, 2));
  console.log("");
  console.log(color.dim("  Edit the file in any editor, then restart the server."));
  await pause();
}

async function main() {
  while (true) {
    clear();
    const cfg = loadConfig();
    showHeader(cfg);
    console.log(`  ${color.bCyan("1")}  Change port`);
    console.log(`  ${color.bCyan("2")}  Bind address  (localhost / network)`);
    console.log(`  ${color.bCyan("3")}  Toggle system tray`);
    console.log(`  ${color.bCyan("4")}  Toggle hide console`);
    console.log(`  ${color.bCyan("5")}  Toggle proxy pool`);
    console.log(`  ${color.bCyan("6")}  Scan mode  (normal / super)`);
    console.log(`  ${color.bCyan("7")}  Toggle dashboard`);
    console.log(`  ${color.bCyan("8")}  Show data/config.json`);
    console.log(`  ${color.bCyan("9")}  Reset to defaults`);
    console.log(`  ${color.bCyan("10")} Toggle V2Ray support`);
    console.log(`  ${color.bCyan("11")} V2Ray status`);
    console.log(`  ${color.bCyan("0")}  Exit`);
    console.log("");
    const choice = await ask(color.bold("  Select: "));

    if (choice === "1") await setPort();
    else if (choice === "2") await setBind();
    else if (choice === "3") await toggle("tray", "Tray");
    else if (choice === "4") await toggle("hideConsole", "Hide console");
    else if (choice === "5") await toggle("proxyEnabled", "Proxy pool");
    else if (choice === "6") await setScanModeMenu();
    else if (choice === "7") await toggle("dashboard", "Dashboard");
    else if (choice === "8") await editRaw();
    else if (choice === "9") {
      const ok = await ask(color.warn("  Reset all settings? [y/N]: "));
      if (ok.toLowerCase() === "y") {
        resetConfig();
        console.log(color.success("  ✔ Defaults restored"));
      }
      await pause();
    } else if (choice === "10") {
      await toggle("v2rayEnabled", "V2Ray support");
    } else if (choice === "11") {
      await v2rayInfo();
    } else if (choice === "0" || choice === "q" || choice === "exit") {
      console.log(color.dim("\n  Bye.\n"));
      break;
    }
  }
  rl.close();
}

main().catch((e) => {
  console.error(e);
  rl.close();
  process.exit(1);
});

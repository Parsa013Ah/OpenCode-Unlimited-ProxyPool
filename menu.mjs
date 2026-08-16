/**
 * menu.mjs — Interactive settings menu (run: node menu.mjs  |  npm run config)
 * No extra dependencies — pure readline.
 */
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { platform } from "os";
import readline from "readline";
import { loadConfig, saveConfig, getConfig, resetConfig, hostFromBind, CONFIG_FILE } from "./config.mjs";
import { color, box } from "./banner.mjs";

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

const on = () => color.success("● on");
const off = () => color.gray("○ off");
const badge = (v) => (v ? on() : off());

function section(title) {
  console.log("");
  console.log(`  ${color.bMagenta("◆")} ${color.bold(title)}`);
  console.log("  " + color.dim("─".repeat(46)));
}

function row(n, label, state) {
  const base = `  ${color.bCyan(String(n).padStart(2))}   ${label}`;
  return base.padEnd(34 - 4) + (state ? "  " + state : "");
}

function showHeader(cfg) {
  console.log("");
  console.log(
    box("OpenCode Proxy · Settings", [
      color.dim("file ") + color.bCyan(CONFIG_FILE),
      color.dim("node ") + process.version + color.dim("  ·  changes apply per setting (see notes)"),
    ], { width: 54, colorFn: color.bCyan })
  );
  console.log("");
  console.log(color.dim("  Current values"));
  console.log("  " + color.dim("─".repeat(46)));
  console.log(`  ${color.bold("Port").padEnd(16)} ${color.bGreen(String(cfg.port))}`);
  console.log(`  ${color.bold("Bind").padEnd(16)} ${color.bGreen(cfg.bind)} ${color.dim(`(${hostFromBind(cfg.bind)})`)}`);
  console.log(`  ${color.bold("Tray").padEnd(16)} ${badge(cfg.tray)}`);
  console.log(`  ${color.bold("Hide console").padEnd(16)} ${badge(cfg.hideConsole)}`);
  console.log(`  ${color.bold("Proxy pool").padEnd(16)} ${badge(cfg.proxyEnabled)}`);
  console.log(`  ${color.bold("Dashboard").padEnd(16)} ${badge(cfg.dashboard)}`);
  console.log(`  ${color.bold("Open auth").padEnd(16)} ${badge(cfg.openAuth !== false)}`);
  console.log("  " + color.dim("─".repeat(46)));
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

const TOGGLE_NOTES = {
  tray: "Applies on next server start",
  hideConsole: "Applies on next server start",
  proxyEnabled: "Restart server to apply",
  dashboard: "Applies immediately",
  openAuth: "Applies immediately",
};

async function toggle(key, label) {
  const cfg = getConfig();
  const next = !cfg[key];
  saveConfig({ [key]: next });
  console.log(color.success(`  ✔ ${label} → ${next ? "on" : "off"}`));
  const note = TOGGLE_NOTES[key];
  if (note) console.log(color.dim(`    ${note}`));
  await pause();
}

async function showRaw() {
  const cfg = getConfig();
  console.log("");
  console.log(color.dim("  Full config") + color.dim(`  (${CONFIG_FILE})`));
  console.log("");
  console.log(JSON.stringify(cfg, null, 2));
  console.log("");
  console.log(color.dim("  Edit the file in any editor, or use option 9 to open it."));
  await pause();
}

async function openInEditor() {
  const file = path.resolve(CONFIG_FILE);
  console.log(color.dim(`  Opening ${file} …`));
  const p = platform();
  const cmd =
    p === "win32" ? `start "" "${file}"` :
    p === "darwin" ? `open "${file}"` :
    `xdg-open "${file}"`;
  exec(cmd, (err) => {
    if (err) console.log(color.error(`  ✖ Could not open editor: ${err.message}`));
  });
  await pause();
}

async function resetAll() {
  const ok = await ask(color.warn("  Reset ALL settings to defaults? [y/N]: "));
  if (ok.toLowerCase() !== "y") return;
  resetConfig();
  console.log(color.success("  ✔ Defaults restored") + color.dim("  (restart server to apply port/bind)"));
  await pause();
}

async function main() {
  while (true) {
    clear();
    const cfg = loadConfig();
    showHeader(cfg);

    section("Network");
    console.log(row(1, "Change port", color.dim(`current: ${color.bGreen(String(cfg.port))}`)));
    console.log(row(2, "Bind address (localhost / network)", color.dim(`current: ${color.bGreen(cfg.bind)}`)));

    section("Behaviour");
    console.log(row(3, "System tray icon", badge(cfg.tray)));
    console.log(row(4, "Hide console on start", badge(cfg.hideConsole)));
    console.log(row(5, "Proxy pool", badge(cfg.proxyEnabled)));
    console.log(row(6, "Dashboard", badge(cfg.dashboard)));

    section("Security");
    console.log(row(7, "Open auth (accept any API key)", badge(cfg.openAuth !== false)));

    section("Tools");
    console.log(row(8, "Show config.json", ""));
    console.log(row(9, "Open config.json in editor", ""));
    console.log(row(0, "Reset to defaults", ""));
    console.log(row("q", "Exit", ""));

    console.log("");
    const choice = await ask(color.bold("  Select: "));

    if (choice === "1") await setPort();
    else if (choice === "2") await setBind();
    else if (choice === "3") await toggle("tray", "System tray");
    else if (choice === "4") await toggle("hideConsole", "Hide console");
    else if (choice === "5") await toggle("proxyEnabled", "Proxy pool");
    else if (choice === "6") await toggle("dashboard", "Dashboard");
    else if (choice === "7") await toggle("openAuth", "Open auth");
    else if (choice === "8") await showRaw();
    else if (choice === "9") await openInEditor();
    else if (choice === "0") await resetAll();
    else if (choice.toLowerCase() === "q" || choice.toLowerCase() === "exit") {
      console.log(color.dim("\n  Bye.\n"));
      break;
    } else {
      console.log(color.warn(`  ✖ Unknown choice: ${choice}`));
      await pause();
    }
  }
  rl.close();
}

main().catch((e) => {
  console.error(e);
  rl.close();
  process.exit(1);
});
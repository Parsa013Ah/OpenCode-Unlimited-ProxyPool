/**
 * manager.mjs — Runs ONE Xray-core process that exposes every V2Ray node
 * as a local SOCKS5 proxy (127.0.0.1:<port>), and reports them to the pool
 * as ordinary proxy entries.
 *
 *   syncV2ray(nodes)  → proxy entries  (starts / restarts xray only when the node set changed)
 *   stopV2ray()       → kill xray
 *   getV2rayInfo()    → status for /health and the dashboard
 */
import fs from "fs";
import net from "net";
import crypto from "crypto";
import { spawn, execFile } from "child_process";
import { PATHS, ensureDirs } from "../../paths.mjs";
import { log, color } from "../../ui/banner.mjs";
import { ensureXray, xrayVersion } from "./installer.mjs";
import { buildXrayConfig } from "./xray-config.mjs";
import { nodeLabel } from "./links.mjs";

const BASE_PORT = parseInt(process.env.V2RAY_BASE_PORT || "10808", 10);
const READY_TIMEOUT_MS = 12_000;
const MAX_RESTARTS = 5;
const DEBUG = process.env.V2RAY_DEBUG === "1";

const state = {
  proc: null,
  signature: "",
  entries: [],
  nodes: [],
  bin: null,
  version: null,
  lastError: null,
  restarts: 0,
  stopping: false,
  startedAt: 0,
  dropped: 0,
  restartTimer: null,
};
const portByUid = new Map(); // uid → local port (stays stable across restarts)
const tail = []; // last xray output lines (for error messages)
let hooksInstalled = false;
let syncing = null;

// ─── ports ──────────────────────────────────────────────────────────

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function allocatePorts(nodes) {
  const used = new Set();
  const out = new Map();
  let next = BASE_PORT;
  for (const n of nodes) {
    let port = portByUid.get(n.uid);
    if (port && !used.has(port) && (await isPortFree(port))) {
      // keep the previous port
    } else {
      port = null;
      while (!port) {
        if (next > 65000) throw new Error("no free local ports for V2Ray inbounds");
        if (!used.has(next) && (await isPortFree(next))) port = next;
        next++;
      }
      portByUid.set(n.uid, port);
    }
    used.add(port);
    out.set(n.uid, port);
  }
  return out;
}

// ─── config validation ──────────────────────────────────────────────

function runTest(bin, cfgObj) {
  return new Promise((resolve) => {
    const file = `${PATHS.xrayRuntimeConfig}.test-${crypto.randomBytes(4).toString("hex")}.json`;
    try {
      fs.writeFileSync(file, JSON.stringify(cfgObj));
    } catch (e) {
      return resolve({ ok: false, reason: e.message });
    }
    execFile(bin, ["run", "-test", "-c", file], { timeout: 15_000, windowsHide: true }, (err, stdout, stderr) => {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
      if (!err) return resolve({ ok: true });
      const lines = String(stderr || stdout || err.message).trim().split(/\r?\n/).filter(Boolean);
      const key = lines.filter((l) => /fail|error|invalid|unknown/i.test(l)).pop() || lines.pop() || "invalid config";
      const msg = key
        .replace(/^Failed to start:\s*/i, "")
        .replace(/main: failed to load config files: \[[^\]]*\]\s*>\s*/i, "")
        .replace(/infra\/conf:\s*/i, "");
      resolve({ ok: false, reason: msg.slice(0, 200) });
    });
  });
}

/** Validate the whole config; if it fails, drop the individual bad nodes. */
async function validateEntries(bin, entries) {
  const whole = await runTest(bin, buildXrayConfig(entries));
  if (whole.ok) return { good: entries, bad: [] };

  const good = [];
  const bad = [];
  const queue = [...entries];
  const worker = async () => {
    while (queue.length) {
      const e = queue.shift();
      const r = await runTest(bin, buildXrayConfig([e]));
      if (r.ok) good.push(e);
      else bad.push({ entry: e, reason: r.reason });
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, worker));
  // keep original order
  good.sort((a, b) => entries.indexOf(a) - entries.indexOf(b));
  return { good, bad };
}

// ─── process control ────────────────────────────────────────────────

function pushTail(chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line.trim()) continue;
    tail.push(line.trim());
    if (tail.length > 30) tail.shift();
    if (DEBUG) log("XRAY", line.trim(), "info");
  }
}

function waitReady(port, child) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let exited = false;
    child.once("exit", () => { exited = true; });
    const tick = () => {
      if (exited) return reject(new Error(`xray exited during startup: ${tail.slice(-3).join(" · ") || "no output"}`));
      if (Date.now() - started > READY_TIMEOUT_MS) return reject(new Error("xray did not open its ports in time"));
      const s = net.connect({ host: "127.0.0.1", port });
      s.once("connect", () => { s.destroy(); resolve(); });
      s.once("error", () => { s.destroy(); setTimeout(tick, 120); });
    };
    tick();
  });
}

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  const kill = () => { try { state.proc?.kill(); } catch { /* ignore */ } };
  process.on("exit", kill);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => { kill(); process.exit(0); });
  }
}

export function stopV2ray() {
  state.stopping = true;
  clearTimeout(state.restartTimer);
  const p = state.proc;
  state.proc = null;
  state.entries = [];
  state.signature = "";
  if (p) {
    try { p.kill(); } catch { /* ignore */ }
    log("V2RAY", "xray stopped", "info");
  }
}

function scheduleRestart() {
  if (state.stopping || state.restarts >= MAX_RESTARTS || !state.nodes.length) return;
  state.restarts++;
  const delay = Math.min(30_000, 2000 * state.restarts);
  log("V2RAY", `xray died — restarting in ${delay / 1000}s (${state.restarts}/${MAX_RESTARTS})`, "warn");
  clearTimeout(state.restartTimer);
  state.restartTimer = setTimeout(() => {
    state.signature = ""; // force a fresh start
    syncV2ray(state.nodes).catch((e) => log("V2RAY", `restart failed: ${e.message}`, "error"));
  }, delay);
}

async function startProcess(bin, entries) {
  ensureDirs();
  fs.writeFileSync(PATHS.xrayRuntimeConfig, JSON.stringify(buildXrayConfig(entries), null, 2));

  tail.length = 0;
  const child = spawn(bin, ["run", "-c", PATHS.xrayRuntimeConfig], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", pushTail);
  child.stderr.on("data", pushTail);
  child.on("error", (e) => { state.lastError = e.message; });
  child.on("exit", (code, sig) => {
    if (state.proc === child) {
      state.proc = null;
      state.entries = [];
      state.signature = "";
      state.lastError = `xray exited (${sig || code})`;
      // a long healthy run resets the crash counter
      if (Date.now() - state.startedAt > 120_000) state.restarts = 0;
      if (!state.stopping) scheduleRestart();
    }
  });

  state.proc = child;
  state.stopping = false;
  try {
    await waitReady(entries[0].port, child);
  } catch (e) {
    try { child.kill(); } catch { /* ignore */ }
    if (state.proc === child) state.proc = null;
    throw e;
  }
  state.startedAt = Date.now();
}

// ─── public API ─────────────────────────────────────────────────────

/**
 * Make sure xray is running exactly for `nodes`.
 * @returns proxy entries: {host,port,type,custom,v2ray,label,remark,protocol,uid}
 */
export function syncV2ray(nodes) {
  // serialize concurrent calls (pool refresh + restart timer)
  const run = (syncing || Promise.resolve()).catch(() => {}).then(() => doSync(nodes));
  syncing = run;
  return run;
}

async function doSync(input) {
  // identical servers (same uid) would create duplicate xray tags — collapse them
  const nodes = [...new Map(input.map((n) => [n.uid, n])).values()];
  if (!nodes.length) {
    if (state.proc) stopV2ray();
    state.nodes = [];
    return [];
  }
  state.nodes = nodes;

  const signature = crypto
    .createHash("sha1")
    .update(nodes.map((n) => n.uid).sort().join(",") + `|${BASE_PORT}`)
    .digest("hex");

  if (state.proc && state.signature === signature) return state.entries; // unchanged & alive

  if (state.proc) stopV2ray();
  state.stopping = false;
  ensureDirs(); // data/xray must exist before we write test / runtime configs
  installHooks();

  const bin = await ensureXray();
  state.bin = bin;
  state.version = xrayVersion(bin);

  const ports = await allocatePorts(nodes);
  const candidates = nodes.map((n) => ({
    tag: n.uid,
    port: ports.get(n.uid),
    node: n,
  }));

  const { good, bad } = await validateEntries(bin, candidates);
  state.dropped = bad.length;
  for (const b of bad.slice(0, 5)) {
    log("V2RAY", `dropped ${color.bYellow(nodeLabel(b.entry.node))}: ${b.reason}`, "warn");
  }
  if (bad.length > 5) log("V2RAY", `…and ${bad.length - 5} more invalid nodes`, "warn");
  if (!good.length) {
    state.lastError = "no valid V2Ray node left after validation";
    throw new Error(state.lastError);
  }

  await startProcess(bin, good);

  state.signature = signature;
  state.lastError = null;
  state.entries = good.map((g) => ({
    host: "127.0.0.1",
    port: g.port,
    type: "socks5",
    custom: true,
    v2ray: true,
    uid: g.node.uid,
    protocol: g.node.protocol,
    remark: g.node.name || `${g.node.address}:${g.node.port}`,
    label: nodeLabel(g.node),
  }));

  log(
    "V2RAY",
    `xray ${color.bold(state.version || "?")} up · ${color.bold(String(state.entries.length))} node(s) on 127.0.0.1:${state.entries[0].port}…${state.entries.at(-1).port}`,
    "ok"
  );
  return state.entries;
}

export function getV2rayInfo() {
  return {
    running: !!state.proc,
    nodes: state.entries.length,
    dropped: state.dropped,
    binary: state.bin,
    version: state.version,
    restarts: state.restarts,
    lastError: state.lastError,
    uptimeSec: state.proc ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
  };
}

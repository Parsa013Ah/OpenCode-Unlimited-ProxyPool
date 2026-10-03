/**
 * installer.mjs — Locate (or auto-download) the Xray-core binary.
 *
 * Lookup order:
 *   1. XRAY_PATH env var
 *   2. data/xray/xray(.exe)   (previously downloaded by this app)
 *   3. `xray` on PATH
 *   4. Auto-download from GitHub releases (disable with V2RAY_AUTO_DOWNLOAD=0)
 *      → override the URL with XRAY_DOWNLOAD_URL (e.g. a mirror)
 *
 * The download is verified against the release's .dgst SHA2-256 file when available.
 * No third-party dependency: the zip is unpacked with a tiny reader built on zlib.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { PATHS, ensureDirs } from "../../paths.mjs";
import { log, color } from "../../ui/banner.mjs";

const IS_WIN = process.platform === "win32";
const BIN_NAME = IS_WIN ? "xray.exe" : "xray";
const LOCAL_BIN = path.join(PATHS.xrayDir, BIN_NAME);

const RELEASE_BASE = "https://github.com/XTLS/Xray-core/releases/latest/download";

/** Name of the release asset for this OS / CPU, or null if unsupported. */
export function assetName(platform = process.platform, arch = process.arch) {
  const map = {
    "win32:x64": "Xray-windows-64.zip",
    "win32:ia32": "Xray-windows-32.zip",
    "win32:arm64": "Xray-windows-arm64-v8a.zip",
    "linux:x64": "Xray-linux-64.zip",
    "linux:ia32": "Xray-linux-32.zip",
    "linux:arm64": "Xray-linux-arm64-v8a.zip",
    "linux:arm": "Xray-linux-arm32-v7a.zip",
    "darwin:x64": "Xray-macos-64.zip",
    "darwin:arm64": "Xray-macos-arm64-v8a.zip",
    "freebsd:x64": "Xray-freebsd-64.zip",
  };
  return map[`${platform}:${arch}`] || null;
}

// ─── minimal ZIP reader ─────────────────────────────────────────────

/** Extract a single file (matched by basename) from a zip buffer. */
export function unzipEntry(buf, wantedBasename) {
  // End Of Central Directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("not a zip file (no end-of-central-directory)");

  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (path.posix.basename(name) !== wantedBasename) continue;

    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error("corrupt zip local header");
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return zlib.inflateRawSync(data);
    throw new Error(`unsupported zip compression method ${method}`);
  }
  throw new Error(`${wantedBasename} not found inside zip`);
}

// ─── locate ─────────────────────────────────────────────────────────

function which(cmd) {
  try {
    const r = spawnSync(IS_WIN ? "where" : "which", [cmd], { encoding: "utf8", windowsHide: true });
    if (r.status === 0) return r.stdout.split(/\r?\n/)[0].trim() || null;
  } catch { /* ignore */ }
  return null;
}

function isRunnable(bin) {
  try {
    const r = spawnSync(bin, ["version"], { encoding: "utf8", timeout: 8000, windowsHide: true });
    return r.status === 0 && /xray/i.test(r.stdout || "");
  } catch {
    return false;
  }
}

export function xrayVersion(bin) {
  try {
    const r = spawnSync(bin, ["version"], { encoding: "utf8", timeout: 8000, windowsHide: true });
    const m = (r.stdout || "").match(/Xray\s+([\d.]+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Find an existing Xray binary without downloading anything. */
export function findXray() {
  const candidates = [
    process.env.XRAY_PATH,
    fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : null,
    which("xray"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c) && isRunnable(c)) return c;
  }
  return null;
}

// ─── download ───────────────────────────────────────────────────────

async function fetchBuffer(url, timeoutMs) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "opencode-free-proxy" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function verifyChecksum(zipBuf, url) {
  try {
    const dgst = (await fetchBuffer(url + ".dgst", 20_000)).toString("utf8");
    const m = dgst.match(/SHA2-256=\s*([0-9a-f]{64})/i);
    if (!m) return "unavailable";
    const actual = crypto.createHash("sha256").update(zipBuf).digest("hex");
    if (actual.toLowerCase() !== m[1].toLowerCase()) {
      throw new Error("checksum mismatch — download is corrupt or tampered, aborting");
    }
    return "ok";
  } catch (e) {
    if (/checksum mismatch/.test(e.message)) throw e;
    return "unavailable";
  }
}

let installing = null;

/**
 * Returns a path to a working xray binary, downloading it if needed.
 * Throws with an actionable message if it cannot.
 */
export function ensureXray() {
  if (installing) return installing;
  installing = (async () => {
    const found = findXray();
    if (found) return found;

    if (process.env.V2RAY_AUTO_DOWNLOAD === "0") {
      throw new Error(
        "Xray-core not found. Install it and set XRAY_PATH, or drop the binary into data/xray/."
      );
    }

    const asset = assetName();
    const url = process.env.XRAY_DOWNLOAD_URL || (asset ? `${RELEASE_BASE}/${asset}` : null);
    if (!url) {
      throw new Error(
        `No prebuilt Xray-core for ${process.platform}/${process.arch}. Install it manually and set XRAY_PATH.`
      );
    }

    ensureDirs();
    log("V2RAY", `Xray-core not found — downloading ${color.bCyan(url)}`, "proxy");
    let zip;
    try {
      zip = await fetchBuffer(url, 5 * 60_000);
    } catch (e) {
      throw new Error(
        `download failed (${e.message}). If GitHub is blocked, download the zip by hand, ` +
        `extract "${BIN_NAME}" into ${PATHS.xrayDir}, or set XRAY_DOWNLOAD_URL to a mirror.`
      );
    }

    const check = await verifyChecksum(zip, url);
    if (check === "ok") log("V2RAY", "checksum verified (SHA2-256)", "ok");
    else log("V2RAY", "checksum file unavailable — skipped verification", "warn");

    const bin = unzipEntry(zip, BIN_NAME);
    fs.writeFileSync(LOCAL_BIN, bin);
    if (!IS_WIN) fs.chmodSync(LOCAL_BIN, 0o755);

    if (!isRunnable(LOCAL_BIN)) {
      try { fs.unlinkSync(LOCAL_BIN); } catch { /* ignore */ }
      throw new Error("downloaded Xray binary does not run on this system");
    }
    log("V2RAY", `installed Xray ${color.bold(xrayVersion(LOCAL_BIN) || "?")} → ${LOCAL_BIN}`, "ok");
    return LOCAL_BIN;
  })();
  // allow a retry on the next refresh if it failed
  installing.catch(() => { installing = null; });
  return installing;
}

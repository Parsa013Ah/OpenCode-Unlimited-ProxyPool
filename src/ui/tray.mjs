/**
 * tray.mjs — Optional system-tray integration (Windows / macOS / Linux).
 * Enabled when PROXY_TRAY=1 (default on win32) or --tray CLI flag.
 * Requires optional dependency: npm i systray
 */

import { exec } from "child_process";
import { platform } from "os";
import { log, color } from "./banner.mjs";

// Tiny 16×16 cyan PNG (valid)
const ICON_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAjElEQVQ4T2NkoBAwUqifYdQABgaG/0D8n4GB4T8Q/2dgYPhPrGH/oRqAYv+R+D8Dw39iDPsP1AAU+4/E/xkY/hNr2H+oBqDYfyT+z8Dwn1jD/kM1AMX+I/F/Bob/xBr2H6oBKPYfif8zMPwn1rD/UA1Asf9I/J+B4T+xhv2HagCK/Ufi/wwM/4k17D9UA1DsPxL/Z2D4T6xh/6EagGL/kfg/A8N/Yg37T1ADAMzyG5o0cQ0yAAAAAElFTkSuQmCC";

function openUrl(url) {
  const p = platform();
  const cmd =
    p === "win32" ? `start "" "${url}"` :
    p === "darwin" ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function hideConsoleWindow() {
  if (platform() !== "win32") return;
  try {
    // Best-effort: detach from console so window can be closed without killing process.
    // Full hide usually needs a native addon; tray still works without it.
    const ps = `Add-Type -Name Win -Namespace N -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);'; [N.Win]::ShowWindow([N.Win]::GetConsoleWindow(),0)`;
    exec(`powershell -NoProfile -Command "${ps}"`, () => {});
  } catch {
    /* ignore */
  }
}

export async function initTray({ port, version }) {
  const want =
    process.env.PROXY_TRAY === "1" ||
    process.argv.includes("--tray") ||
    (process.env.PROXY_TRAY !== "0" && platform() === "win32");

  if (!want) {
    log("TRAY", "disabled (set PROXY_TRAY=1 or pass --tray)", "info");
    return null;
  }

  let SysTray;
  try {
    const mod = await import("systray");
    SysTray = mod.default?.default || mod.default || mod.SysTray || mod;
  } catch {
    log(
      "TRAY",
      color.warn("systray not installed") +
        color.dim(" — run: npm i systray   then restart with --tray"),
      "warn"
    );
    return null;
  }

  const base = `http://localhost:${port}`;
  const items = [
    { title: `OpenCode Proxy v${version}`, tooltip: "Running", checked: false, enabled: false },
    { title: "─────", tooltip: "", checked: false, enabled: false },
    { title: "Open Health", tooltip: `${base}/health`, checked: false, enabled: true },
    { title: "Open Proxies", tooltip: `${base}/proxies`, checked: false, enabled: true },
    { title: "Open Models", tooltip: `${base}/v1/models`, checked: false, enabled: true },
    { title: "─────", tooltip: "", checked: false, enabled: false },
    { title: "Open Settings UI", tooltip: `${base}/`, checked: false, enabled: true },
    { title: "Copy Base URL", tooltip: base, checked: false, enabled: true },
    { title: "Hide Console", tooltip: "Hide terminal window (Windows)", checked: false, enabled: platform() === "win32" },
    { title: "Quit", tooltip: "Stop server", checked: false, enabled: true },
  ];

  const systray = new SysTray({
    menu: {
      icon: ICON_PNG_B64,
      title: "OpenCode Proxy",
      tooltip: `OpenCode Free Proxy :${port}`,
      items,
    },
    debug: false,
    copyDir: true,
  });

  systray.onClick((action) => {
    const title = action?.item?.title;
    if (title === "Open Health") openUrl(`${base}/health`);
    else if (title === "Open Settings UI") openUrl(`${base}/`);
    else if (title === "Open Proxies") openUrl(`${base}/proxies`);
    else if (title === "Open Models") openUrl(`${base}/v1/models`);
    else if (title === "Copy Base URL") {
      const p = platform();
      if (p === "win32") exec(`cmd /c echo ${base}| clip`);
      else if (p === "darwin") exec(`printf %s '${base}' | pbcopy`);
      else exec(`printf %s '${base}' | xclip -selection clipboard 2>/dev/null || printf %s '${base}' | xsel -ib 2>/dev/null`);
      log("TRAY", `copied ${base}`, "ok");
    } else if (title === "Hide Console") {
      hideConsoleWindow();
      log("TRAY", "console hidden — use tray menu to quit", "ok");
    } else if (title === "Quit") {
      log("TRAY", "quit requested", "warn");
      try { systray.kill(true); } catch {}
      process.exit(0);
    }
  });

  log("TRAY", color.success("system tray active") + color.dim("  · right-click icon for menu"), "ok");

  if (process.env.PROXY_HIDE_CONSOLE === "1" || process.argv.includes("--hide")) {
    hideConsoleWindow();
    log("TRAY", "console auto-hidden (PROXY_HIDE_CONSOLE=1)", "ok");
  }

  return systray;
}

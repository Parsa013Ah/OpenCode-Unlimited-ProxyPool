/**
 * banner.mjs — Terminal UI helpers (colors, spinner, boxes)
 * Zero dependencies — pure ANSI.
 */

const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  italic: "\x1b[3m",
  under:  "\x1b[4m",
  blink:  "\x1b[5m",

  black:   "\x1b[30m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  white:   "\x1b[37m",
  gray:    "\x1b[90m",

  bgBlack:   "\x1b[40m",
  bgRed:     "\x1b[41m",
  bgGreen:   "\x1b[42m",
  bgYellow:  "\x1b[43m",
  bgBlue:    "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan:    "\x1b[46m",
  bgWhite:   "\x1b[47m",

  // bright
  bRed:     "\x1b[91m",
  bGreen:   "\x1b[92m",
  bYellow:  "\x1b[93m",
  bBlue:    "\x1b[94m",
  bMagenta: "\x1b[95m",
  bCyan:    "\x1b[96m",
  bWhite:   "\x1b[97m",
};

function paint(codes, text) {
  if (!isTTY) return String(text);
  return `${codes}${text}${c.reset}`;
}

export const color = {
  bold:   (t) => paint(c.bold, t),
  dim:    (t) => paint(c.dim, t),
  italic: (t) => paint(c.italic, t),
  under:  (t) => paint(c.under, t),

  red:     (t) => paint(c.red, t),
  green:   (t) => paint(c.green, t),
  yellow:  (t) => paint(c.yellow, t),
  blue:    (t) => paint(c.blue, t),
  magenta: (t) => paint(c.magenta, t),
  cyan:    (t) => paint(c.cyan, t),
  white:   (t) => paint(c.white, t),
  gray:    (t) => paint(c.gray, t),

  bRed:     (t) => paint(c.bRed, t),
  bGreen:   (t) => paint(c.bGreen, t),
  bYellow:  (t) => paint(c.bYellow, t),
  bBlue:    (t) => paint(c.bBlue, t),
  bMagenta: (t) => paint(c.bMagenta, t),
  bCyan:    (t) => paint(c.bCyan, t),
  bWhite:   (t) => paint(c.bWhite, t),

  success: (t) => paint(c.bold + c.bGreen, t),
  error:   (t) => paint(c.bold + c.bRed, t),
  warn:    (t) => paint(c.bold + c.bYellow, t),
  info:    (t) => paint(c.bold + c.bCyan, t),
  accent:  (t) => paint(c.bold + c.bMagenta, t),
};

// ── Spinner ────────────────────────────────────────────────────────

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  constructor(label = "") {
    this.label = label;
    this.i = 0;
    this.timer = null;
    this.active = false;
  }

  start(label) {
    if (label) this.label = label;
    if (!isTTY) {
      console.log(`  … ${this.label}`);
      return this;
    }
    if (this.active) return this;
    this.active = true;
    this.timer = setInterval(() => {
      const frame = FRAMES[this.i % FRAMES.length];
      process.stdout.write(`\r  ${color.bCyan(frame)} ${color.dim(this.label)}   `);
      this.i++;
    }, 80);
    return this;
  }

  update(label) {
    this.label = label;
    return this;
  }

  succeed(msg) {
    this.stop();
    console.log(`  ${color.success("✔")} ${msg || this.label}`);
  }

  fail(msg) {
    this.stop();
    console.log(`  ${color.error("✖")} ${msg || this.label}`);
  }

  warn(msg) {
    this.stop();
    console.log(`  ${color.warn("⚠")} ${msg || this.label}`);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    clearInterval(this.timer);
    if (isTTY) process.stdout.write("\r\x1b[K");
  }
}

// ── Box / lines ────────────────────────────────────────────────────

export function hr(char = "─", width = 56) {
  return color.dim(char.repeat(width));
}

export function box(title, lines = [], { width = 56, colorFn = color.bCyan } = {}) {
  const inner = width - 2;
  const top = colorFn("╭" + "─".repeat(inner) + "╮");
  const bot = colorFn("╰" + "─".repeat(inner) + "╯");
  const mid = (text) => {
    const plain = stripAnsi(String(text));
    const pad = Math.max(0, inner - 2 - plain.length);
    return colorFn("│") + " " + text + " ".repeat(pad) + colorFn("│");
  };
  const out = [top];
  if (title) {
    out.push(mid(color.bold(colorFn(title))));
    out.push(colorFn("├" + "─".repeat(inner) + "┤"));
  }
  for (const line of lines) out.push(mid(line));
  out.push(bot);
  return out.join("\n");
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── Startup banner ─────────────────────────────────────────────────

export function printBanner(version, port) {
  const logo = [
    color.bCyan("   ██████╗ ██████╗ ███████╗███╗   ██╗"),
    color.bCyan("  ██╔═══██╗██╔══██╗██╔════╝████╗  ██║"),
    color.cyan( "  ██║   ██║██████╔╝█████╗  ██╔██╗ ██║") + color.dim("  ██████╗ ██████╗  ██████╗ ██╗  ██╗"),
    color.cyan( "  ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║") + color.dim("  ██╔══██╗██╔══██╗██╔═══██╗╚██╗██╔╝"),
    color.blue( "  ╚██████╔╝██║     ███████╗██║ ╚████║") + color.dim("  ██████╔╝██████╔╝██║   ██║ ╚███╔╝ "),
    color.blue( "   ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝") + color.dim("  ██╔═══╝ ██╔══██╗██║   ██║ ██╔██╗ "),
    color.dim(  "                                        ██████║ ██║  ██║╚██████╔╝██╔╝ ██╗"),
    color.dim(  "                                        ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝"),
  ];

  console.log("");
  for (const line of logo) console.log(line);
  console.log("");
  console.log(
    `  ${color.accent("◆")} ${color.bold("OpenCode Free Proxy")} ${color.dim(`v${version}`)}`
  );
  console.log(
    `  ${color.dim("→")} ${color.bGreen(`http://0.0.0.0:${port}`)}  ${color.dim("· OpenAI + Anthropic compatible")}`
  );
  console.log("");
}

export function printEndpoints(port) {
  const rows = [
    ["Dashboard", `GET   http://localhost:${port}/`],
    ["OpenAI",    `POST  http://localhost:${port}/v1/chat/completions`],
    ["Anthropic", `POST  http://localhost:${port}/v1/messages`],
    ["Models",    `GET   http://localhost:${port}/v1/models`],
    ["Proxies",   `GET   http://localhost:${port}/proxies`],
    ["Health",    `GET   http://localhost:${port}/health`],
  ];
  console.log(`  ${color.bold(color.bWhite("Endpoints"))}`);
  for (const [name, path] of rows) {
    console.log(`    ${color.bCyan("●")} ${color.bold(name.padEnd(10))} ${color.dim(path)}`);
  }
  console.log("");
}

export function printModels(models) {
  console.log(`  ${color.bold(color.bWhite("Models"))} ${color.dim(`(${models.length})`)}`);
  for (const m of models) {
    console.log(`    ${color.bMagenta("▸")} ${m}`);
  }
  console.log("");
}

export function printKeys(apiKeys) {
  console.log(`  ${color.bold(color.bWhite("API Keys"))} ${color.dim("(api-keys.json)")}`);
  for (const [name, key] of Object.entries(apiKeys)) {
    const short = key.length > 28 ? key.slice(0, 12) + "…" + key.slice(-8) : key;
    console.log(`    ${color.bYellow("🔑")} ${color.bold(name.padEnd(14))} ${color.dim(short)}`);
  }
  console.log("");
}

export function log(tag, msg, level = "info") {
  const ts = new Date().toISOString().slice(11, 19);
  const tags = {
    info:  color.bCyan(`[${tag}]`),
    ok:    color.bGreen(`[${tag}]`),
    warn:  color.bYellow(`[${tag}]`),
    error: color.bRed(`[${tag}]`),
    proxy: color.bMagenta(`[${tag}]`),
    zen:   color.bBlue(`[${tag}]`),
  };
  const prefix = tags[level] || tags.info;
  console.log(`${color.dim(ts)} ${prefix} ${msg}`);
}

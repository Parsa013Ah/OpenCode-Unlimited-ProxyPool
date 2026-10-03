/**
 * custom.mjs — Load the user's PERSONAL proxies.
 *
 * Sources:
 *   • env PROXY_CUSTOM              (comma / newline separated, classic proxies)
 *   • config/custom-proxies.txt     (or PROXY_CUSTOM_FILE)
 *   • V2Ray nodes                   (see ./v2ray — links in custom-proxies.txt are picked up too)
 */
import fs from "fs";
import { PATHS } from "../paths.mjs";
import { log, color } from "../ui/banner.mjs";
import { parseProxyLine } from "./parser.mjs";
import { isV2rayLink, loadV2rayProxies } from "./v2ray/index.mjs";

/** Read classic proxies + collect V2Ray links out of free-form text. */
function splitText(text, plain, v2rayLinks) {
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    if (isV2rayLink(line)) {
      v2rayLinks.push(line); // never split V2Ray links on "," (alpn=h2,http/1.1 …)
      continue;
    }
    // classic proxies may be comma / semicolon separated on one line
    for (const part of line.split(/[,;]+/)) {
      const p = parseProxyLine(part);
      if (p) plain.push(p);
    }
  }
}

/**
 * @returns {Promise<{proxies:object[], counts:{plain:number, v2ray:number}}>}
 */
export async function loadCustomProxies() {
  const plain = [];
  const v2rayLinks = [];

  if (process.env.PROXY_CUSTOM) splitText(process.env.PROXY_CUSTOM, plain, v2rayLinks);

  const file = PATHS.customProxies;
  try {
    if (fs.existsSync(file)) {
      splitText(fs.readFileSync(file, "utf8"), plain, v2rayLinks);
    }
  } catch (e) {
    log("PROXY", `custom file error: ${e.message}`, "warn");
  }

  // de-dup classic proxies
  const seen = new Set();
  const proxies = [];
  for (const p of plain) {
    const key = `${p.type}:${p.host}:${p.port}:${p.user || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    proxies.push(p);
  }
  if (proxies.length) {
    log("PROXY", `custom proxies → ${color.bold(String(proxies.length))} (${file})`, "ok");
  }

  const v2 = await loadV2rayProxies(v2rayLinks);
  proxies.push(...v2.proxies);

  return { proxies, counts: { plain: plain.length, v2ray: v2.proxies.length } };
}

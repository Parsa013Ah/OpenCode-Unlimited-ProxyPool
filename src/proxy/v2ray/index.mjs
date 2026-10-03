/**
 * V2Ray / Xray integration — public entry point.
 *
 *   loadV2rayProxies(extraLinks) → local SOCKS5 proxy entries (one per V2Ray node)
 */
import { collectV2rayNodes } from "./loader.mjs";
import { syncV2ray, stopV2ray, getV2rayInfo } from "./manager.mjs";
import { log } from "../../ui/banner.mjs";

export { isV2rayLink } from "./links.mjs";
export { stopV2ray, getV2rayInfo };

let enabled = (process.env.V2RAY_ENABLED ?? "1") !== "0";
export function setV2rayEnabled(v) { enabled = !!v; if (!enabled) stopV2ray(); }
export function isV2rayEnabled() { return enabled; }

/**
 * @param {string[]} extraLinks V2Ray links found in other files (custom-proxies.txt)
 * @returns {Promise<{proxies:object[], found:number}>}
 */
export async function loadV2rayProxies(extraLinks = []) {
  if (!enabled) {
    if (extraLinks.length) log("V2RAY", "V2Ray links found but V2RAY support is disabled", "warn");
    return { proxies: [], found: 0 };
  }
  const { nodes } = await collectV2rayNodes(extraLinks);
  if (!nodes.length) {
    stopV2ray();
    return { proxies: [], found: 0 };
  }
  try {
    const proxies = await syncV2ray(nodes);
    return { proxies, found: nodes.length };
  } catch (e) {
    log("V2RAY", `cannot start V2Ray: ${e.message}`, "error");
    return { proxies: [], found: nodes.length };
  }
}

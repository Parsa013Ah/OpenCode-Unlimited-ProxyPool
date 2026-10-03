/**
 * parser.mjs — Parse a single "classic" proxy line (HTTP / SOCKS4 / SOCKS5).
 *
 * V2Ray-style links (vmess:// vless:// trojan:// ss://) are handled by
 * ./v2ray/links.mjs — use `isV2rayLink()` from there to route a line first.
 *
 * Supported formats:
 *   host:port
 *   host:port:user:pass
 *   user:pass@host:port
 *   http://host:port            http://user:pass@host:port
 *   socks5://host:port          socks5://user:pass@host:port
 *   socks4://host:port
 *   http|host:port              socks5:host:port
 *   host port                   (space separated)
 *
 * `host` may be an IPv4, IPv6 (optionally in [brackets]) or a domain name.
 */

const HOST = "(?:\\[[0-9a-fA-F:.]+\\]|[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)";
const RE_HOST_PORT = new RegExp(`^(${HOST}):(\\d{1,5})$`);
const RE_HOST_SPACE_PORT = new RegExp(`^(${HOST})\\s+(\\d{1,5})$`);
const RE_HOST_PORT_CRED = new RegExp(`^(${HOST}):(\\d{1,5}):([^:\\s]+):(.+)$`);

const validPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;
const stripBrackets = (h) => h.replace(/^\[|\]$/g, "");

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Parse a single proxy line into {host,port,type,user,pass,custom} or null. */
export function parseProxyLine(line, defaultType = "http") {
  let l = String(line || "").trim();
  if (!l || l.startsWith("#") || l.startsWith("//")) return null;

  let type = defaultType;
  let user = null;
  let pass = null;

  // protocol://…
  const proto = l.match(/^(https?|socks5h?|socks4a?|socks):\/\//i);
  if (proto) {
    const p = proto[1].toLowerCase();
    type =
      p === "https" ? "http" :
      p === "socks" || p === "socks5h" ? "socks5" :
      p === "socks4a" ? "socks4" : p;
    l = l.slice(proto[0].length).replace(/\/+$/, "");
  }

  // type|host:port  or  type:host:port
  const typed = l.match(/^(http|https|socks5|socks4)[|:](.+)$/i);
  if (typed) {
    const t = typed[1].toLowerCase();
    type = t === "https" ? "http" : t;
    l = typed[2];
  }

  // user:pass@host:port
  const at = l.lastIndexOf("@");
  if (at !== -1) {
    const cred = l.slice(0, at);
    l = l.slice(at + 1);
    const i = cred.indexOf(":");
    if (i > 0) {
      user = decodeURIComponentSafe(cred.slice(0, i));
      pass = decodeURIComponentSafe(cred.slice(i + 1));
    } else if (cred) {
      user = decodeURIComponentSafe(cred);
    }
  }

  // host:port:user:pass  (common export format)
  let m = l.match(RE_HOST_PORT_CRED);
  if (m && !user) {
    const port = parseInt(m[2], 10);
    if (validPort(port)) {
      return { host: stripBrackets(m[1]), port, type, user: m[3], pass: m[4], custom: true };
    }
  }

  // host:port   |   host port
  m = l.match(RE_HOST_PORT) || l.match(RE_HOST_SPACE_PORT);
  if (m) {
    const port = parseInt(m[2], 10);
    if (validPort(port)) {
      return { host: stripBrackets(m[1]), port, type, user, pass, custom: true };
    }
  }

  return null;
}

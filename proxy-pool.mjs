/**
 * proxy-pool.mjs — Auto-rotating free/private proxy pool for OpenCode Zen API.
 *
 * Features:
 *  - 350+ public list sources (HTTP / SOCKS4 / SOCKS5)
 *  - Personal proxies via custom-proxies.txt or PROXY_CUSTOM
 *  - Disk cache of known-good proxies (survives restarts)
 *  - Round-robin + ban/cooldown on rate-limit or failure
 *  - Prefer cached + HTTP proxies when sampling
 *  - Configurable via env (PROXY_*)
 */

import https from "https";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { log, color, Spinner } from "./banner.mjs";
import path from "path";

// ═══════════════════════════════════════════════════════════════════
// Sources — as many live public lists as practical (Aug 2026)
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_SOURCES = [
  { type: "http", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/protocols/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/protocols/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/protocols/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS4_RAW.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTP_RAW.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/https.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/proxy.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/gproxynet/free-proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/gproxynet/free-proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/gproxynet/free-proxy-list/main/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/gproxynet/free-proxy-list/main/all.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/https.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/all.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/top-http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ProxyScraper/ProxyScraper/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/ProxyScraper/ProxyScraper/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/ProxyScraper/ProxyScraper/main/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/all.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/mzyui/proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/mzyui/proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/mzyui/proxy-list/main/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/mzyui/proxy-list/main/all.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/stormsia/proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/stormsia/proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/stormsia/proxy-list/main/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/stormsia/proxy-list/main/working_proxies.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/prxchk/proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/prxchk/proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/prxchk/proxy-list/main/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/https.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/all.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/fyvri/fresh-proxy-list/main/archive/classic/txt/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/fyvri/fresh-proxy-list/main/archive/classic/txt/https.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/fyvri/fresh-proxy-list/main/archive/classic/txt/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/fyvri/fresh-proxy-list/main/archive/classic/txt/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/r00tee/Proxy-List/main/Https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/r00tee/Proxy-List/main/Socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/r00tee/Proxy-List/main/Socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/dinoz0rg/proxy-list/main/scraped_proxies/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/dinoz0rg/proxy-list/main/scraped_proxies/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/dinoz0rg/proxy-list/main/scraped_proxies/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/dinoz0rg/proxy-list/main/checked_proxies/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/dinoz0rg/proxy-list/main/checked_proxies/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/dinoz0rg/proxy-list/main/checked_proxies/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/allproxy.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/SevenworksDev/proxy-list/main/proxies/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/SevenworksDev/proxy-list/main/proxies/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/SevenworksDev/proxy-list/main/proxies/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/SevenworksDev/proxy-list/main/proxies/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/http_proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/https_proxies.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/socks4_proxies.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/socks5_proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/http/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/https/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks4/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks5/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/HyperBeats/proxy-list/main/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/HyperBeats/proxy-list/main/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/HyperBeats/proxy-list/main/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/HyperBeats/proxy-list/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/UptimerBot/proxy-list/main/proxies/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/UptimerBot/proxy-list/main/proxies/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/UptimerBot/proxy-list/main/proxies/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/caliphdev/Proxy-List/master/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/caliphdev/Proxy-List/master/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/caliphdev/Proxy-List/master/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/zloi-user/cache/main/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/zloi-user/cache/main/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/zloi-user/cache/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/yemixuanyan/proxy-list/main/proxies/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/yemixuanyan/proxy-list/main/proxies/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/yemixuanyan/proxy-list/main/proxies/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ObcbO/getproxy/master/file/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ObcbO/getproxy/master/file/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/ObcbO/getproxy/master/file/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/ObcbO/getproxy/master/file/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/saisuiu/Lionkings-Http-Proxys-Proxies/main/free.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/saisuiu/Lionkings-Http-Proxys-Proxies/main/cnfree.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/TuanMinPay/live-proxy/master/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/TuanMinPay/live-proxy/master/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/TuanMinPay/live-proxy/master/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Vann-Dev/proxy-list/main/proxies/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Vann-Dev/proxy-list/main/proxies/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/Vann-Dev/proxy-list/main/proxies/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/Vann-Dev/proxy-list/main/proxies/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxilist/proxy-list/main/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/proxilist/proxy-list/main/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/proxilist/proxy-list/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/im-razvan/proxy_list/main/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/im-razvan/proxy_list/main/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/im-razvan/proxy_list/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/aslisk/proxyhttps/main/https.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/B4RC0DE-TM/proxy-list/main/HTTP.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/B4RC0DE-TM/proxy-list/main/SOCKS4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/B4RC0DE-TM/proxy-list/main/SOCKS5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/rdavydov/proxy-list/main/proxies/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/rdavydov/proxy-list/main/proxies/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/rdavydov/proxy-list/main/proxies/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/hanwayTech/free-proxy-list/main/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/hanwayTech/free-proxy-list/main/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/hanwayTech/free-proxy-list/main/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/hanwayTech/free-proxy-list/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/proxy/clash.yaml" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt" },
  { type: "socks5", url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.txt" },
  { type: "socks4", url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks4/data.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/all/data.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/http/data.txt" },
  { type: "socks5", url: "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/socks5/data.txt" },
  { type: "socks4", url: "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/socks4/data.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/all/data.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/monosans/proxy-list@main/proxies/http.txt" },
  { type: "socks5", url: "https://cdn.jsdelivr.net/gh/monosans/proxy-list@main/proxies/socks5.txt" },
  { type: "socks4", url: "https://cdn.jsdelivr.net/gh/monosans/proxy-list@main/proxies/socks4.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/hproxy-com/free-proxy-list@main/http.txt" },
  { type: "socks5", url: "https://cdn.jsdelivr.net/gh/hproxy-com/free-proxy-list@main/socks5.txt" },
  { type: "socks4", url: "https://cdn.jsdelivr.net/gh/hproxy-com/free-proxy-list@main/socks4.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/xyzs996/free-proxy-health-list@main/proxies/all/data.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/xyzs996/free-proxy-health-list@main/proxies/protocols/http/data.txt" },
  { type: "socks5", url: "https://cdn.jsdelivr.net/gh/xyzs996/free-proxy-health-list@main/proxies/protocols/socks5/data.txt" },
  { type: "socks4", url: "https://cdn.jsdelivr.net/gh/xyzs996/free-proxy-health-list@main/proxies/protocols/socks4/data.txt" },
  { type: "http", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all" },
  { type: "socks5", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all" },
  { type: "socks4", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=10000&country=all" },
  { type: "http", url: "https://api.proxyscrape.com/?request=displayproxies&proxytype=http" },
  { type: "socks5", url: "https://api.proxyscrape.com/?request=displayproxies&proxytype=socks5" },
  { type: "socks4", url: "https://api.proxyscrape.com/?request=displayproxies&proxytype=socks4" },
  { type: "http", url: "https://api.openproxylist.xyz/http.txt" },
  { type: "socks5", url: "https://api.openproxylist.xyz/socks5.txt" },
  { type: "socks4", url: "https://api.openproxylist.xyz/socks4.txt" },
  { type: "http", url: "https://www.proxy-list.download/api/v1/get?type=http" },
  { type: "socks5", url: "https://www.proxy-list.download/api/v1/get?type=socks5" },
  { type: "socks4", url: "https://www.proxy-list.download/api/v1/get?type=socks4" },
  { type: "http", url: "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http" },
  { type: "socks5", url: "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=socks5" },
  { type: "socks4", url: "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=socks4" },
  { type: "http", url: "https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc&protocols=http%2Chttps" },
  { type: "socks5", url: "https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc&protocols=socks5" },
  { type: "socks4", url: "https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc&protocols=socks4" },
  { type: "http", url: "https://raw.githubusercontent.com/gfpcom/free-proxy-list/wiki/lists/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/gfpcom/free-proxy-list/wiki/lists/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/gfpcom/free-proxy-list/wiki/lists/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/wiki/gfpcom/free-proxy-list/lists/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/wiki/gfpcom/free-proxy-list/lists/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/wiki/gfpcom/free-proxy-list/lists/socks4.txt" },
  { type: "http", url: "https://vakhov.github.io/fresh-proxy-list/http.txt" },
  { type: "http", url: "https://vakhov.github.io/fresh-proxy-list/https.txt" },
  { type: "socks4", url: "https://vakhov.github.io/fresh-proxy-list/socks4.txt" },
  { type: "socks5", url: "https://vakhov.github.io/fresh-proxy-list/socks5.txt" },
  { type: "http", url: "https://proxyspace.pro/http.txt" },
  { type: "http", url: "https://proxyspace.pro/https.txt" },
  { type: "socks4", url: "https://proxyspace.pro/socks4.txt" },
  { type: "socks5", url: "https://proxyspace.pro/socks5.txt" },
  { type: "http", url: "https://www.proxyscan.io/download?type=http" },
  { type: "socks4", url: "https://www.proxyscan.io/download?type=socks4" },
  { type: "socks5", url: "https://www.proxyscan.io/download?type=socks5" },
  { type: "http", url: "https://multiproxy.org/txt_all/proxy.txt" },
  { type: "http", url: "http://rootjazz.com/proxies/proxies.txt" },
  { type: "http", url: "https://sheesh.rip/http.txt" },
  { type: "socks5", url: "https://sheesh.rip/socks5.txt" },
  { type: "http", url: "https://proxy-spider.com/api/proxies.example.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/almroot/proxylist/master/list.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/parserpp/proxy-list/main/proxies.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/parserpp/proxy-list/main/proxies-socks.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/http_proxies.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/socks4_proxies.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/socks5_proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ManuSMZ/Proxy-List/main/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/ManuSMZ/Proxy-List/main/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/ManuSMZ/Proxy-List/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/elliottophellia/yakuhally/master/results/http/global/http_checked.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/elliottophellia/yakuhally/master/results/socks4/global/socks4_checked.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/elliottophellia/yakuhally/master/results/socks5/global/socks5_checked.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/zrfan/proxy-list/main/proxy-list/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/fahimscirex/proxyme/main/openproxylist.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/VolkanSah/Auto-Proxy-Fetcher/main/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Noctiro/proxy-list/master/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/Noctiro/proxy-list/master/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/Noctiro/proxy-list/master/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks4/data.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxyscrape/free-proxy-list/main/proxies/protocols/http/data.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/proxyscrape/free-proxy-list/main/proxies/protocols/socks4/data.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/proxyscrape/free-proxy-list/main/proxies/protocols/socks5/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/xyzs996/free-proxy-health-list/main/proxies/all/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/xyzs996/free-proxy-health-list/main/proxies/protocols/http/data.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/xyzs996/free-proxy-health-list/main/proxies/protocols/socks4/data.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/xyzs996/free-proxy-health-list/main/proxies/protocols/socks5/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Mohammedcha/ProxRipper/main/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Mohammedcha/ProxRipper/main/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/Mohammedcha/ProxRipper/main/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/Mohammedcha/ProxRipper/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/US/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/US/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/US/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/DE/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/DE/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/DE/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/GB/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/GB/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/GB/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/FR/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/FR/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/FR/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/NL/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/NL/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/NL/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/CA/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/CA/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/CA/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/SG/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/SG/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/SG/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/JP/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/JP/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/JP/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/BR/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/BR/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/BR/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/IN/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/IN/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/IN/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/RU/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/RU/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/RU/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/TR/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/TR/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/TR/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/ID/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/ID/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/ID/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/VN/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/VN/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/VN/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/PL/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/PL/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/Country/PL/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/mertguvencli/http-proxy-list/main/proxy-list/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/rxnpro/proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/rxnpro/proxy-list/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/rxnpro/proxy-list/main/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxylist-to/proxy-list/main/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/proxylist-to/proxy-list/main/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/proxylist-to/proxy-list/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/saschazesiger/Free-Proxies/master/proxies/http.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/saschazesiger/Free-Proxies/master/proxies/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/saschazesiger/Free-Proxies/master/proxies/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/UserR3X/proxy-list/main/online/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/UserR3X/proxy-list/main/online/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/UserR3X/proxy-list/main/online/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/UserR3X/proxy-list/main/online/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/https.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks4.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/databay-labs/free-proxy-list/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/databay-labs/free-proxy-list/main/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/berkay-digital/Proxy-Scraper/main/proxies.txt" },
  { type: "http", url: "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=protocolipport&format=text" },
  { type: "socks5", url: "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=protocolipport&format=text" },
  { type: "socks4", url: "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks4&proxy_format=protocolipport&format=text" },
  { type: "http", url: "https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc" },
  { type: "http", url: "https://proxylist.geonode.com/api/proxy-list?limit=500&page=2&sort_by=lastChecked&sort_type=desc" },
  { type: "http", url: "https://proxylist.geonode.com/api/proxy-list?limit=500&page=3&sort_by=lastChecked&sort_type=desc" },
  { type: "http", url: "https://www.proxy-list.download/api/v1/get?type=https" },
  { type: "http", url: "https://api.good-proxies.ru/export.php?type=http&key=free" },
  { type: "socks5", url: "https://openproxylist.xyz/socks5.txt" },
  { type: "http", url: "https://openproxylist.xyz/http.txt" },
  { type: "socks4", url: "https://openproxylist.xyz/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/gfpcom/free-proxy-list/main/lists/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/gfpcom/free-proxy-list/main/lists/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/gfpcom/free-proxy-list/main/lists/socks4.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/Thordata/awesome-free-proxy-list@main/proxies/all.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/Thordata/awesome-free-proxy-list@main/proxies/http.txt" },
  { type: "socks5", url: "https://cdn.jsdelivr.net/gh/Thordata/awesome-free-proxy-list@main/proxies/socks5.txt" },
  { type: "socks4", url: "https://cdn.jsdelivr.net/gh/Thordata/awesome-free-proxy-list@main/proxies/socks4.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/monosans/proxy-list@main/proxies/all.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/all.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/all-proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxyscrape/free-proxy-list/main/proxies/all/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/xyzs996/free-proxy-health-list/main/proxies/fast/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/xyzs996/free-proxy-health-list/main/proxies/stable/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/xyzs996/free-proxy-health-list/main/proxies/elite/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/xyzs996/free-proxy-health-list/main/proxies/top-1000/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/AU/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/AT/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/BE/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/CH/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/CZ/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/DK/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/ES/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/FI/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/GR/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/HK/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/HU/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/IE/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/IL/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/IT/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/KR/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/MX/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/MY/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/NO/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/NZ/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/PH/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/PT/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/RO/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/SE/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/TH/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/TW/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/UA/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/ZA/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/AR/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/CL/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/CO/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/EG/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/PK/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/SA/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/AE/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/http_checked.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/socks5_checked.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/socks4_checked.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/US/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/DE/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/GB/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/NL/data.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/FR/data.txt" },
  { type: "http", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=US" },
  { type: "socks5", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=5000&country=US" },
  { type: "http", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=DE" },
  { type: "socks5", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=5000&country=DE" },
  { type: "http", url: "https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/xResults/RAW.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/fate0/getproxy/master/proxy.list" },
  { type: "http", url: "https://raw.githubusercontent.com/a2u/free-proxy-list/master/free-proxy-list.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/opsxcq/proxy-list/master/list.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/scidroid/proxy-list/main/proxy.json" },
  { type: "http", url: "https://raw.githubusercontent.com/KUTlime/ProxyList/main/ProxyList.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/rdavydov/proxy-list/main/proxies_anonymous/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/rdavydov/proxy-list/main/proxies_anonymous/socks5.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/ObcbO/getproxy/master/file/all.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/zloi-user/cache/main/all.txt" },
  { type: "http", url: "https://spys.one/proxy.txt" },
  { type: "http", url: "https://www.proxy-list.download/api/v2/get?l=en&t=http" },
  { type: "http", url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt" },
  { type: "socks5", url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt" },
  { type: "socks4", url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks4.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/obnoxiousnerd/proxy-list/main/proxies.txt" },
  { type: "http", url: "https://cdn.jsdelivr.net/gh/TheSpeedX/PROXY-List@master/http.txt" },
  { type: "socks5", url: "https://cdn.jsdelivr.net/gh/TheSpeedX/PROXY-List@master/socks5.txt" },
  { type: "socks4", url: "https://cdn.jsdelivr.net/gh/TheSpeedX/PROXY-List@master/socks4.txt" },
  { type: "http", url: "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&proxy_format=ipport&format=text" },
  { type: "socks5", url: "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=socks5&proxy_format=ipport&format=text" },
  { type: "socks4", url: "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=socks4&proxy_format=ipport&format=text" },
  { type: "http", url: "https://proxylist.geonode.com/api/proxy-list?limit=500&page=4&sort_by=lastChecked&sort_type=desc" },
  { type: "http", url: "https://proxylist.geonode.com/api/proxy-list?limit=500&page=5&sort_by=lastChecked&sort_type=desc" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/CN/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/IR/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/BD/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/NG/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/KE/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/SK/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/BG/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/HR/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/RS/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/SI/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/LT/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/LV/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/EE/proxies.txt" },
  { type: "http", url: "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/IS/proxies.txt" },
];

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

const TEST_HOST = "opencode.ai";
const TEST_PORT = 443;
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_FILE = process.env.PROXY_CACHE_FILE || "./proxy-cache.json";
const CACHE_MAX_AGE_MS = parseInt(process.env.PROXY_CACHE_MAX_AGE_MS || String(2 * 60 * 60 * 1000), 10);
const CACHE_MAX_ENTRIES = parseInt(process.env.PROXY_CACHE_MAX || "2000", 10);

const config = {
  enabled: (process.env.PROXY_ENABLED ?? "1") !== "0",
  sampleSize: parseInt(process.env.PROXY_SAMPLE_SIZE || "2500", 10),
  poolSize: parseInt(process.env.PROXY_POOL_SIZE || "50", 10),
  concurrency: parseInt(process.env.PROXY_CONCURRENCY || "200", 10),
  testTimeoutMs: parseInt(process.env.PROXY_TEST_TIMEOUT_MS || "3500", 10),
  cooldownMs: parseInt(process.env.PROXY_COOLDOWN_MS || String(10 * 60 * 1000), 10),
  failCooldownMs: parseInt(process.env.PROXY_FAIL_COOLDOWN_MS || String(60 * 1000), 10),
  refreshMs: parseInt(process.env.PROXY_REFRESH_MS || String(25 * 60 * 1000), 10),
  maxAttempts: parseInt(process.env.PROXY_MAX_ATTEMPTS || "8", 10),
  deepScan: (process.env.PROXY_DEEP_SCAN ?? "1") !== "0",
  maxScan: parseInt(process.env.PROXY_MAX_SCAN || "5000", 10),
  // normal = sampled | super = every unique proxy from every source (slow, thorough)
  scanMode: (process.env.PROXY_SCAN_MODE || "normal").toLowerCase() === "super" ? "super" : "normal",
  sources: loadSources(),
};

export function setScanMode(mode) {
  config.scanMode = mode === "super" ? "super" : "normal";
  log("PROXY", `scan mode → ${color.bold(config.scanMode)}`, "ok");
}

export function getScanMode() {
  return config.scanMode;
}

function loadSources() {
  const raw = process.env.PROXY_SOURCES;
  if (!raw) return DEFAULT_SOURCES;
  return raw
    .split(",")
    .map((e) => {
      const [type, url] = e.trim().split("=", 2);
      return { type, url };
    })
    .filter((s) => s.type && s.url);
}

/** Parse a single proxy line into {host,port,type,auth?} — many formats. */
export function parseProxyLine(line, defaultType = "http") {
  let l = String(line || "").trim();
  if (!l || l.startsWith("#") || l.startsWith("//")) return null;

  let type = defaultType;
  let user = null;
  let pass = null;

  // protocol://user:pass@host:port  OR  protocol://host:port
  const proto = l.match(/^(https?|socks5|socks4|socks):\/\//i);
  if (proto) {
    const p = proto[1].toLowerCase();
    type = p === "https" ? "http" : p === "socks" ? "socks5" : p;
    l = l.slice(proto[0].length);
  }

  // type|host:port or type:host:port (explicit)
  const typed = l.match(/^(http|https|socks5|socks4)[|:](.+)$/i);
  if (typed) {
    type = typed[1].toLowerCase() === "https" ? "http" : typed[1].toLowerCase();
    l = typed[2];
  }

  // user:pass@host:port
  const at = l.lastIndexOf("@");
  if (at !== -1) {
    const cred = l.slice(0, at);
    l = l.slice(at + 1);
    const c = cred.split(":");
    if (c.length >= 2) {
      user = c[0];
      pass = c.slice(1).join(":");
    }
  }

  // host:port:user:pass  (common export format)
  const parts = l.split(":");
  if (parts.length >= 4 && /^\d+$/.test(parts[1])) {
    const host = parts[0];
    const port = parseInt(parts[1], 10);
    user = parts[2];
    pass = parts.slice(3).join(":");
    if (port >= 1 && port <= 65535) {
      return { host, port, type, user, pass, custom: true };
    }
  }

  // host:port
  const m = l.match(/^([0-9a-fA-F:.]+):(\d{1,5})\s*$/);
  if (m) {
    const port = parseInt(m[2], 10);
    if (port >= 1 && port <= 65535) {
      return { host: m[1], port, type, user, pass, custom: true };
    }
  }

  // host port (space)
  const sp = l.match(/^([0-9a-fA-F:.]+)\s+(\d{1,5})\s*$/);
  if (sp) {
    const port = parseInt(sp[2], 10);
    if (port >= 1 && port <= 65535) {
      return { host: sp[1], port, type, user, pass, custom: true };
    }
  }

  return null;
}

/**
 * Load personal proxies from:
 *  - env PROXY_CUSTOM (comma or newline separated)
 *  - file custom-proxies.txt (or PROXY_CUSTOM_FILE)
 * Formats supported:
 *   host:port
 *   host:port:user:pass
 *   user:pass@host:port
 *   http://host:port
 *   socks5://user:pass@host:port
 *   http|host:port
 *   socks5:host:port
 */
function loadCustomProxies() {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (!p) return;
    const key = `${p.type}:${p.host}:${p.port}:${p.user || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };

  const fromText = (text, defaultType = "http") => {
    for (const line of String(text || "").split(/[\n,;]+/)) {
      add(parseProxyLine(line, defaultType));
    }
  };

  if (process.env.PROXY_CUSTOM) fromText(process.env.PROXY_CUSTOM);

  const file =
    process.env.PROXY_CUSTOM_FILE ||
    path.join(process.cwd(), "custom-proxies.txt");
  try {
    if (fs.existsSync(file)) {
      fromText(fs.readFileSync(file, "utf8"));
      log("PROXY", `custom file → ${color.bold(String(out.length))} proxies (${file})`, "ok");
    }
  } catch (e) {
    log("PROXY", `custom file error: ${e.message}`, "warn");
  }

  return out;
}



// ═══════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════

let working = [];
let personalWorking = []; // always tried first
let retired = [];
let banned = new Map();
let lastBgScan = 0;
const BG_SCAN_COOLDOWN_MS = parseInt(process.env.PROXY_BG_SCAN_MS || String(3 * 60 * 1000), 10);
const successScore = new Map(); // host:port → real API success count
const rateLimitUntil = new Map(); // host:port → skip until ts
let cursor = 0;
let lastRefresh = 0;
let lastError = null;
let lastCounts = null;
let refreshing = false;

// ═══════════════════════════════════════════════════════════════════
// Disk cache
// ═══════════════════════════════════════════════════════════════════

function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (!Array.isArray(data.proxies)) return [];
    const cutoff = Date.now() - CACHE_MAX_AGE_MS;
    return data.proxies.filter(
      (p) => p.ts > cutoff && p.host && p.port && p.type
    );
  } catch {
    return [];
  }
}

function saveCache(entries) {
  try {
    const existing = loadCache();
    const map = new Map();
    for (const p of existing) map.set(`${p.host}:${p.port}`, p);
    for (const p of entries) {
      const host = p.host || String(p.key || "").split(":")[0];
      const port = p.port || parseInt(String(p.key || "").split(":")[1], 10);
      if (!host || !port) continue;
      map.set(`${host}:${port}`, {
        host,
        port,
        type: p.type || "http",
        latency: p.latency || 0,
        ts: Date.now(),
      });
    }
    const proxies = [...map.values()]
      .sort((a, b) => (a.latency || 99999) - (b.latency || 99999))
      .slice(0, CACHE_MAX_ENTRIES);
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ updated: Date.now(), count: proxies.length, proxies }, null, 2)
    );
    log("PROXY", `cache → ${color.bold(String(proxies.length))} entries saved`, "ok");
  } catch (e) {
    log("PROXY", `cache save error: ${e.message}`, "error");
  }
}

// ═══════════════════════════════════════════════════════════════════
// Agent factory
// ═══════════════════════════════════════════════════════════════════

function makeAgent(proxy) {
  const hostport = `${proxy.host}:${proxy.port}`;
  const auth =
    proxy.user && proxy.pass
      ? `${encodeURIComponent(proxy.user)}:${encodeURIComponent(proxy.pass)}@`
      : proxy.user
        ? `${encodeURIComponent(proxy.user)}@`
        : "";
  const label = proxy.user ? `${proxy.user}@${hostport}` : hostport;
  try {
    if (proxy.type === "http" || proxy.type === "https") {
      return {
        key: label,
        agent: new HttpsProxyAgent(`http://${auth}${hostport}`),
        type: proxy.type,
      };
    }
    if (proxy.type === "socks5") {
      return {
        key: label,
        agent: new SocksProxyAgent(`socks5://${auth}${hostport}`),
        type: "socks5",
      };
    }
    if (proxy.type === "socks4") {
      return {
        key: label,
        agent: new SocksProxyAgent(`socks4://${auth}${hostport}`),
        type: "socks4",
      };
    }
  } catch {
    return null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Fetch candidate lists
// ═══════════════════════════════════════════════════════════════════

async function fetchCandidates() {
  const all = new Map();
  lastCounts = {};

  // Personal proxies always first (highest priority)
  const custom = loadCustomProxies();
  for (const p of custom) {
    const key = `${p.host}:${p.port}`;
    all.set(key, { ...p, fromCustom: true });
  }
  if (custom.length) {
    lastCounts.custom = custom.length;
    log("PROXY", `personal proxies: ${color.bold(String(custom.length))}`, "ok");
  }

  const cached = loadCache();
  for (const p of cached) {
    const key = `${p.host}:${p.port}`;
    if (!all.has(key)) {
      all.set(key, { host: p.host, port: p.port, type: p.type || "http", fromCache: true });
    }
  }
  if (cached.length) {
    lastCounts.cache = cached.length;
    log("PROXY", `cache loaded: ${color.bold(String(cached.length))} proxies`, "proxy");
  }

  let srcDone = 0;
  const srcTotal = config.sources.length;
  log("PROXY", `fetching ${srcTotal} sources…`, "proxy");
  await Promise.all(
    config.sources.map(async (src) => {
      try {
        const res = await fetch(src.url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { "User-Agent": "opencode-free-proxy/1.0" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        let n = 0;
        const addOne = (host, port, type) => {
          const p = parseInt(port, 10);
          if (!host || !(p >= 1 && p <= 65535)) return;
          const key = `${host}:${p}`;
          if (!all.has(key)) {
            all.set(key, { host, port: p, type: type || src.type });
            n++;
          }
        };
        // Geonode / JSON lists
        if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
          try {
            const j = JSON.parse(text);
            const arr = Array.isArray(j) ? j : j.data || j.proxies || j.list || [];
            for (const item of arr) {
              if (!item) continue;
              if (typeof item === "string") {
                let l = item.replace(/^(https?|socks[45]?):\/\//i, "");
                const m = l.match(/^([0-9a-fA-F:.]+):(\d{1,5})/);
                if (m) addOne(m[1], m[2], src.type);
                continue;
              }
              const host = item.ip || item.host || item.addr || item.address;
              const port = item.port;
              let type = src.type;
              const proto = String(item.protocols?.[0] || item.protocol || item.type || "").toLowerCase();
              if (proto.includes("socks5")) type = "socks5";
              else if (proto.includes("socks4")) type = "socks4";
              else if (proto.includes("http")) type = "http";
              addOne(host, port, type);
            }
          } catch { /* fall through to line parse */ }
        }
        for (const line of text.split("\n")) {
          let l = line.trim();
          if (!l || l.startsWith("#") || l.startsWith("{") || l.startsWith("[")) continue;
          l = l.replace(/^(https?|socks[45]?):\/\//i, "");
          // user:pass@host:port
          const auth = l.match(/@([0-9a-fA-F:.]+):(\d{1,5})/);
          if (auth) {
            addOne(auth[1], auth[2], src.type);
            continue;
          }
          const m = l.match(/^([0-9a-fA-F:.]+):(\d{1,5})/);
          if (m) addOne(m[1], m[2], src.type);
        }
        lastCounts[src.type] = (lastCounts[src.type] || 0) + n;
      } catch {
        /* source flaky */
      } finally {
        srcDone++;
        if (srcDone % 40 === 0 || srcDone === srcTotal) {
          log("PROXY", `sources ${srcDone}/${srcTotal} · unique ${all.size}`, "info");
        }
      }
    })
  );

  return [...all.values()];
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: connectivity probe  |  Phase 2: strict Zen API test
// ═══════════════════════════════════════════════════════════════════

const TEST_BODY = JSON.stringify({
  model: "deepseek-v4-flash-free",
  messages: [{ role: "user", content: "hi" }],
  stream: false,
});

/** Phase 1 — does the proxy reach the internet / opencode.ai at all? */
function probeConnect(proxy) {
  return new Promise((resolve) => {
    const made = makeAgent(proxy);
    if (!made) return resolve(null);

    let done = false;
    let req = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { req?.destroy(); } catch {}
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), Math.min(config.testTimeoutMs, 2500));
    const start = Date.now();

    try {
      req = https.request(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          agent: made.agent,
          path: "/",
          method: "HEAD",
          rejectUnauthorized: false,
        },
        (res) => {
          res.resume();
          finish({
            host: proxy.host,
            port: proxy.port,
            type: proxy.type || made.type,
            user: proxy.user,
            pass: proxy.pass,
            fromCustom: !!proxy.fromCustom,
            fromCache: !!proxy.fromCache,
            latency: Date.now() - start,
            agent: made.agent,
            key: made.key,
          });
        }
      );
      req.on("error", () => finish(null));
      req.end();
    } catch {
      finish(null);
    }
  });
}

/**
 * Phase 2 — real chat request to Zen.
 * Only SUCCESS with model content counts. Rate-limit / ban / empty = fail (null).
 */
function testProxyZen(proxy) {
  return new Promise((resolve) => {
    const made = makeAgent(proxy);
    if (!made) return resolve(null);

    let done = false;
    let req = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { req?.destroy(); } catch {}
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), config.testTimeoutMs);
    const start = Date.now();

    req = https.request(
      {
        hostname: TEST_HOST,
        port: TEST_PORT,
        agent: made.agent,
        path: "/zen/v1/chat/completions",
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(TEST_BODY),
          Authorization: "Bearer public",
          "User-Agent":
            "opencode/1.15.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13",
          "x-opencode-client": "cli",
          "x-opencode-project": "global",
          "x-opencode-request": `msg_test_${Math.random().toString(36).slice(2, 10)}`,
          "x-opencode-session": `ses_test_${Math.random().toString(36).slice(2, 10)}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const latency = Date.now() - start;
          const body = Buffer.concat(chunks).toString().trim();
          // STRICT success only — rate-limit / ban / html / empty do NOT pass
          if (res.statusCode === 429) return finish(null);
          if (!body.startsWith("{")) return finish(null);
          try {
            const j = JSON.parse(body);
            const msg = String(j?.error?.message || j?.message || "").toLowerCase();
            const typ = String(j?.error?.type || j?.type || "").toLowerCase();
            if (
              msg.includes("rate limit") ||
              msg.includes("freeusagelimit") ||
              msg.includes("quota") ||
              msg.includes("banned") ||
              msg.includes("blocked") ||
              typ.includes("rate_limit")
            ) {
              return finish(null);
            }
            const hasContent =
              !!j?.choices?.[0]?.message?.content ||
              !!j?.choices?.[0]?.delta?.content;
            if (!hasContent) return finish(null);
            finish({
              key: made.key,
              agent: made.agent,
              latency,
              type: made.type || proxy.type,
              host: proxy.host,
              port: proxy.port,
              user: proxy.user,
              pass: proxy.pass,
              fromCustom: !!proxy.fromCustom,
            });
          } catch {
            finish(null);
          }
        });
      }
    );
    req.on("error", () => finish(null));
    req.end(TEST_BODY);
  });
}

async function runPool(items, workerFn, concurrency, label) {
  const queue = [...items];
  const results = [];
  let tested = 0;
  let found = 0;
  const total = queue.length;
  const reportEvery = Math.max(25, Math.floor(total / 10) || 1);

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      const r = await workerFn(item);
      tested++;
      if (r) {
        results.push(r);
        found++;
      }
      if (tested % reportEvery === 0 || tested === total) {
        log(
          "SCAN",
          `${label} ${tested}/${total} · live ${found} · ${Math.round((tested / total) * 100)}%`,
          "info"
        );
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(total, 1)) }, worker)
  );
  return results;
}

// ═══════════════════════════════════════════════════════════════════
// Refresh
// ═══════════════════════════════════════════════════════════════════

export async function refresh() {
  if (!config.enabled || refreshing) return;
  refreshing = true;
  lastRefresh = Date.now();

  try {
    const candidates = await fetchCandidates();
    if (!candidates.length) throw new Error("no proxies fetched from any source");

    // Order: personal → cache → shuffled public
    const customOnes = candidates.filter((p) => p.fromCustom);
    const cachedOnes = candidates.filter((p) => p.fromCache && !p.fromCustom);
    const freshOnes = candidates.filter((p) => !p.fromCache && !p.fromCustom);
    for (let i = freshOnes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [freshOnes[i], freshOnes[j]] = [freshOnes[j], freshOnes[i]];
    }
    const rank = (p) =>
      (p.type === "http" || p.type === "https" ? 0 : p.type === "socks5" ? 1 : 2);
    freshOnes.sort((a, b) => rank(a) - rank(b));

    const isSuper = config.scanMode === "super";
    let sample;
    if (isSuper) {
      // SUPER: every unique proxy, no sampling cap — may take a long time
      sample = [...customOnes, ...cachedOnes, ...freshOnes];
      log(
        "PROXY",
        `SUPER scan · ${color.bold(String(sample.length))} unique from all sources (no limit)`,
        "warn"
      );
    } else {
      const limit = config.deepScan
        ? Math.min(candidates.length, config.maxScan)
        : config.sampleSize;
      sample = [...customOnes, ...cachedOnes, ...freshOnes].slice(
        0,
        Math.max(limit, config.sampleSize)
      );
      log(
        "PROXY",
        `NORMAL scan · sample ${color.bold(String(sample.length))} / ${candidates.length}`,
        "proxy"
      );
    }

    // ── Phase 1: alive? (no chat API) ─────────────────────────────
    const conc1 = isSuper ? Math.max(config.concurrency, 250) : config.concurrency;
    log(
      "PROXY",
      `phase1 connect ${color.bold(String(sample.length))} · conc ${conc1}`,
      "proxy"
    );
    let alive = await runPool(sample, probeConnect, conc1, "connect");
    log("PROXY", `phase1 done · ${color.bold(String(alive.length))} reachable`, "ok");

    // Personal always enter phase2 even if connect was flaky
    const aliveKeys = new Set(alive.map((p) => `${p.host}:${p.port}`));
    for (const c of customOnes) {
      if (!aliveKeys.has(`${c.host}:${c.port}`)) {
        alive.unshift({ ...c, latency: 99999, fromCustom: true });
        aliveKeys.add(`${c.host}:${c.port}`);
      }
    }

    if (!alive.length) throw new Error("phase1: nobody reachable");

    alive.sort((a, b) => {
      const sa = successScore.get(`${a.host}:${a.port}`) || 0;
      const sb = successScore.get(`${b.host}:${b.port}`) || 0;
      if (sb !== sa) return sb - sa;
      return (a.latency || 99999) - (b.latency || 99999);
    });

    // ── Phase 2: real OpenCode request — only CLEAN enter pool ────
    // Reject rate-limit / ban / empty. Only real model content = pass.
    // SUPER: test ALL reachable; NORMAL: cap by maxScan
    const phase2List = isSuper
      ? alive
      : alive.slice(0, Math.min(alive.length, config.maxScan));
    const zenConc = isSuper
      ? Math.min(60, Math.max(config.concurrency, 40))
      : Math.min(40, config.concurrency);
    log(
      "PROXY",
      `phase2 zen-clean ${color.bold(String(phase2List.length))} · conc ${zenConc} · mode=${config.scanMode}`,
      "proxy"
    );
    const results = await runPool(phase2List, testProxyZen, zenConc, "zen");
    log(
      "PROXY",
      `phase2 done · ${color.bold(String(results.length))} clean for real use`,
      "ok"
    );

    // Personal always available for real use even if phase2 was rate-limited
    const resultKeys = new Set(results.map((r) => `${r.host}:${r.port}`));
    for (const c of customOnes) {
      if (resultKeys.has(`${c.host}:${c.port}`)) continue;
      const made = makeAgent(c);
      if (!made) continue;
      results.unshift({
        key: made.key,
        agent: made.agent,
        latency: 99999,
        type: made.type,
        host: c.host,
        port: c.port,
        user: c.user,
        pass: c.pass,
        fromCustom: true,
      });
    }

    results.sort((a, b) => {
      if (!!b.fromCustom !== !!a.fromCustom) return a.fromCustom ? -1 : 1;
      const sa = successScore.get(`${a.host}:${a.port}`) || 0;
      const sb = successScore.get(`${b.host}:${b.port}`) || 0;
      if (sb !== sa) return sb - sa;
      return (a.latency || 99999) - (b.latency || 99999);
    });

    // Tag results that came from personal candidates
    const customKeys = new Set(
      candidates.filter((c) => c.fromCustom).map((c) => `${c.host}:${c.port}`)
    );
    for (const r of results) {
      const host = r.host || String(r.key).split("@").pop().split(":")[0];
      const port = r.port || parseInt(String(r.key).split(":").pop(), 10);
      if (customKeys.has(`${host}:${port}`)) r.fromCustom = true;
    }

    const personalHits = results.filter((r) => r.fromCustom);
    const publicHits = results.filter((r) => !r.fromCustom);
    const pool = [
      ...personalHits,
      ...publicHits.slice(0, Math.max(0, config.poolSize - personalHits.length)),
    ];

    // Always (re)build personalWorking from live custom hits; keep previous personal if retest failed temporarily
    if (personalHits.length) {
      personalWorking = personalHits;
    } else if (customOnes.length && !personalWorking.length) {
      // Build agents for custom even if strict test failed — still try them at request time
      const built = [];
      for (const c of customOnes) {
        const made = makeAgent(c);
        if (made) {
          built.push({
            key: made.key,
            agent: made.agent,
            latency: 99999,
            type: made.type,
            host: c.host,
            port: c.port,
            fromCustom: true,
            user: c.user,
            pass: c.pass,
          });
        }
      }
      if (built.length) personalWorking = built;
    }

    if (pool.length > 0 || personalWorking.length > 0) {
      retired.push(...working);
      working = pool.length ? pool : [...personalWorking];
      for (const p of retired) {
        setTimeout(() => {
          try { p.agent.destroy(); } catch {}
        }, 30_000);
      }
      retired = [];
      saveCache(working.filter((p) => !p.fromCustom).slice(0, config.poolSize));
    } else if (working.length === 0) {
      log("PROXY", "0 working proxies — using direct only", "warn");
    } else {
      log("PROXY", `0 new working; keeping previous pool of ${working.length}`, "warn");
    }

    const countsStr = lastCounts
      ? Object.entries(lastCounts)
          .map(([t, n]) => `${t}:${n}`)
          .join(" ")
      : "";
    log("PROXY", `refreshed: ${color.bold(String(working.length))}/${results.length} kept of ${sample.length} tested (${countsStr}) in ${Date.now() - lastRefresh}ms`, "ok");
    if (working.length) {
      log("PROXY", `top: ${working.slice(0, 6).map((p) => color.bCyan(p.key) + color.dim(`(${p.latency}ms)`)).join(", ")}`, "proxy");
    }
  } catch (e) {
    lastError = e.message;
    log("PROXY", `refresh error: ${e.message}`, "error");
  } finally {
    refreshing = false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

export function getProxyAgents() {
  const now = Date.now();
  for (const [key, until] of banned) {
    if (now > until) banned.delete(key);
  }
  for (const [k, until] of rateLimitUntil) {
    if (now > until) rateLimitUntil.delete(k);
  }

  // Personal first ALWAYS. Public skips banned + short rate-limit cooldown.
  const personal = personalWorking.filter((p) => p.agent);
  const publicAvail = working.filter((p) => {
    if (!p.agent || p.fromCustom) return false;
    if (banned.has(p.key)) return false;
    const until = rateLimitUntil.get(`${p.host}:${p.port}`);
    if (until && now < until) return false;
    return true;
  });

  const ordered = [...personal, ...publicAvail];
  if (!ordered.length) return [];

  const n = Math.min(config.maxAttempts, ordered.length);
  const list = [];
  // Always include all personal first, then fill with public round-robin
  for (const p of personal) {
    if (list.length >= n) break;
    list.push(p.agent);
  }
  const need = n - list.length;
  for (let i = 0; i < need; i++) {
    if (!publicAvail.length) break;
    list.push(publicAvail[(cursor + i) % publicAvail.length].agent);
  }
  if (publicAvail.length) cursor = (cursor + Math.max(need, 1)) % publicAvail.length;
  return list;
}

/** Call when a request succeeded via direct or a personal proxy — kick a background full scan. */
export function scheduleBackgroundScan(reason = "ok-path") {
  const now = Date.now();
  if (refreshing) return;
  if (now - lastBgScan < BG_SCAN_COOLDOWN_MS) return;
  lastBgScan = now;
  log("PROXY", `background scan queued (${reason})`, "proxy");
  setImmediate(() => {
    refresh().catch(() => {});
  });
}

/** True if this agent belongs to a personal proxy entry. */
export function isPersonalAgent(agent) {
  if (!agent) return false;
  return personalWorking.some((p) => p.agent === agent);
}

export function banProxy(agent, ms) {
  if (!agent) return;
  // Never ban personal proxies — those are the user's own servers
  if (isPersonalAgent(agent)) {
    log("PROXY", "skip ban (personal proxy)", "info");
    return;
  }
  const p = working.find((x) => x.agent === agent);
  if (!p) return;
  const duration = ms ?? config.cooldownMs;
  banned.set(p.key, Date.now() + duration);
  const left = working.filter((x) => !banned.has(x.key)).length;
  log("PROXY", `banned ${color.bYellow(p.key)} for ${duration / 1000}s (available: ${left})`, "warn");
}

export function banProxySoft(agent) {
  if (!agent || isPersonalAgent(agent)) return;
  banProxy(agent, config.failCooldownMs);
}

/** Real traffic success — promote proxy for next picks */
export function markProxySuccess(agent) {
  const p =
    working.find((x) => x.agent === agent) ||
    personalWorking.find((x) => x.agent === agent);
  if (!p) return;
  const k = `${p.host}:${p.port}`;
  successScore.set(k, (successScore.get(k) || 0) + 1);
  rateLimitUntil.delete(k);
  // Move to front of working (public) or personal list
  if (p.fromCustom) {
    personalWorking = [p, ...personalWorking.filter((x) => x !== p)];
  } else {
    working = [p, ...working.filter((x) => x !== p)];
  }
}

/** Real traffic rate-limit on this path — soft skip briefly (not a dead proxy) */
export function markProxyRateLimit(agent, ms = 30_000) {
  if (!agent || isPersonalAgent(agent)) return; // never sideline personal
  const p = working.find((x) => x.agent === agent);
  if (!p) return;
  rateLimitUntil.set(`${p.host}:${p.port}`, Date.now() + ms);
  log("PROXY", `rate-limit skip ${p.key} for ${ms / 1000}s`, "warn");
}


export function getPoolInfo() {
  return {
    enabled: config.enabled,
    attemptsPerRequest: config.maxAttempts,
    working: working.map((p) => ({
      proxy: p.key,
      latency: p.latency,
      type: p.type,
    })),
    workingCount: working.length,
    bannedCount: banned.size,
    sources: config.sources.length,
    scanMode: config.scanMode,
    cacheFile: CACHE_FILE,
    lastRefresh,
    lastError,
  };
}

export function initProxyPool() {
  if (!config.enabled) {
    log("PROXY", "disabled (PROXY_ENABLED=0)", "warn");
    return;
  }
  const cached = loadCache();
  if (cached.length) {
    log("PROXY", `${cached.length} cached proxies will be re-tested`, "proxy");
  }
  refresh();
  setInterval(refresh, config.refreshMs);
  log("PROXY", `enabled · ${color.bold(String(config.sources.length))} sources · mode=${config.scanMode} · sample ${config.sampleSize} · pool ${config.poolSize}`, "ok");
}

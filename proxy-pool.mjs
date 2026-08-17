/**
 * proxy-pool.mjs — Auto-rotating free/private proxy pool for OpenCode Zen API.
 *
 * Features:
 *  - 60+ public list sources (HTTP / SOCKS4 / SOCKS5)
 *  - Disk cache of known-good proxies (survives restarts)
 *  - Round-robin + ban/cooldown on rate-limit or failure
 *  - Prefer cached + HTTP proxies when sampling
 *  - Configurable via env (PROXY_*)
 */

import https from "https";
import fs from "fs";
import path from "path";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { log, color, Spinner } from "./banner.mjs";

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
];

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

const TEST_HOST = "opencode.ai";
const TEST_PORT = 443;
const FETCH_TIMEOUT_MS = 12_000;
const CACHE_FILE = process.env.PROXY_CACHE_FILE || "./proxy-cache.json";
const CACHE_MAX_AGE_MS = parseInt(process.env.PROXY_CACHE_MAX_AGE_MS || String(2 * 60 * 60 * 1000), 10);
const CACHE_MAX_ENTRIES = 300;

const config = {
  enabled: (process.env.PROXY_ENABLED ?? "1") !== "0",
  sampleSize: parseInt(process.env.PROXY_SAMPLE_SIZE || "500", 10),
  poolSize: parseInt(process.env.PROXY_POOL_SIZE || "40", 10),
  concurrency: parseInt(process.env.PROXY_CONCURRENCY || "80", 10),
  testTimeoutMs: parseInt(process.env.PROXY_TEST_TIMEOUT_MS || "5500", 10),
  cooldownMs: parseInt(process.env.PROXY_COOLDOWN_MS || String(10 * 60 * 1000), 10),
  failCooldownMs: parseInt(process.env.PROXY_FAIL_COOLDOWN_MS || String(60 * 1000), 10),
  refreshMs: parseInt(process.env.PROXY_REFRESH_MS || String(25 * 60 * 1000), 10),
  maxAttempts: parseInt(process.env.PROXY_MAX_ATTEMPTS || "6", 10),
  sources: loadSources(),
};

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

// ═══════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════

let working = [];
let retired = [];
let banned = new Map();
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
  try {
    if (proxy.type === "http" || proxy.type === "https") {
      return {
        key: hostport,
        agent: new HttpsProxyAgent(`http://${hostport}`),
        type: proxy.type,
      };
    }
    if (proxy.type === "socks5") {
      return {
        key: hostport,
        agent: new SocksProxyAgent(`socks5://${hostport}`),
        type: "socks5",
      };
    }
    if (proxy.type === "socks4") {
      return {
        key: hostport,
        agent: new SocksProxyAgent(`socks4://${hostport}`),
        type: "socks4",
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Fetch candidate lists
// ═══════════════════════════════════════════════════════════════════

async function fetchCandidates() {
  const all = new Map();
  lastCounts = {};

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
        for (const line of text.split("\n")) {
          let l = line.trim();
          if (!l || l.startsWith("#")) continue;
          l = l.replace(/^(https?|socks[45]?):\/\//i, "");
          const m = l.match(/^([0-9a-fA-F:.]+):(\d{1,5})/);
          if (!m) continue;
          const port = parseInt(m[2], 10);
          if (port < 1 || port > 65535) continue;
          const host = m[1];
          const key = `${host}:${port}`;
          if (!all.has(key)) {
            all.set(key, { host, port, type: src.type });
            n++;
          }
        }
        lastCounts[src.type] = (lastCounts[src.type] || 0) + n;
      } catch {
        /* source flaky */
      }
    })
  );

  return [...all.values()];
}

// ═══════════════════════════════════════════════════════════════════
// Live test against Zen API
// ═══════════════════════════════════════════════════════════════════

const TEST_BODY = JSON.stringify({
  model: "deepseek-v4-flash-free",
  messages: [{ role: "user", content: "hi" }],
  stream: false,
});

function testProxy(proxy) {
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
          let ok = false;
          // STRICT: only accept real model output OR a clear rate-limit JSON.
          // Random JSON / HTML / empty / connection-ish 200s cause false positives
          // (proxies that later ECONNRESET on real traffic).
          if (body.startsWith("{")) {
            try {
              const j = JSON.parse(body);
              if (j?.choices?.[0]?.message?.content) ok = true;
              else if (j?.choices?.[0]?.delta?.content) ok = true;
              else {
                const msg = String(j?.error?.message || j?.message || "").toLowerCase();
                const typ = String(j?.error?.type || j?.type || "").toLowerCase();
                if (
                  msg.includes("rate limit") ||
                  msg.includes("freeusagelimit") ||
                  msg.includes("quota") ||
                  typ.includes("rate_limit")
                ) {
                  ok = true;
                }
              }
            } catch {}
          }
          if (!ok && res.statusCode === 429) ok = true;
          finish(
            ok
              ? {
                  key: made.key,
                  agent: made.agent,
                  latency,
                  type: made.type || proxy.type,
                  host: proxy.host,
                  port: proxy.port,
                }
              : null
          );
        });
      }
    );
    req.on("error", () => finish(null));
    req.end(TEST_BODY);
  });
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

    candidates.sort((a, b) => {
      const rank = (p) =>
        (p.fromCache ? -20 : 0) +
        (p.type === "http" || p.type === "https" ? 0 : p.type === "socks5" ? 1 : 2);
      return rank(a) - rank(b);
    });

    const sample = candidates.slice(0, config.sampleSize);
    const results = [];
    const queue = [...sample];

    const worker = async () => {
      while (queue.length) {
        const proxy = queue.shift();
        const r = await testProxy(proxy);
        if (r) results.push(r);
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(config.concurrency, sample.length) },
        worker
      )
    );

    results.sort((a, b) => a.latency - b.latency);
    const pool = results.slice(0, config.poolSize);

    if (pool.length > 0) {
      retired.push(...working);
      working = pool;
      for (const p of retired) {
        setTimeout(() => {
          try { p.agent.destroy(); } catch {}
        }, 30_000);
      }
      retired = [];
      saveCache(pool);
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
  if (!config.enabled || !working.length) return [];
  const now = Date.now();
  for (const [key, until] of banned) {
    if (now > until) banned.delete(key);
  }
  const avail = working.filter((p) => !banned.has(p.key));
  if (!avail.length) return [];
  const n = Math.min(config.maxAttempts, avail.length);
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push(avail[(cursor + i) % avail.length].agent);
  }
  cursor = (cursor + n) % avail.length;
  return list;
}

export function banProxy(agent, ms) {
  const p = working.find((x) => x.agent === agent);
  if (!p) return;
  const duration = ms ?? config.cooldownMs;
  banned.set(p.key, Date.now() + duration);
  const left = working.filter((x) => !banned.has(x.key)).length;
  log("PROXY", `banned ${color.bYellow(p.key)} for ${duration / 1000}s (available: ${left})`, "warn");
}

export function banProxySoft(agent) {
  banProxy(agent, config.failCooldownMs);
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
  log("PROXY", `enabled · ${color.bold(String(config.sources.length))} sources · sample ${config.sampleSize} · pool ${config.poolSize}`, "ok");
}

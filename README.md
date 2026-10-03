# OpenCode Free Proxy

🌐 **English** | [فارسی](README.fa.md)

Local OpenAI / Anthropic-compatible proxy in front of [OpenCode Zen](https://opencode.ai) free models.

- Rotating **public + personal** proxies (HTTP / SOCKS4 / SOCKS5)
- **V2Ray / Xray support** — `vmess://`, `vless://` (REALITY too), `trojan://`, `ss://`, subscriptions and JSON configs
- Live dashboard (requests, tokens, settings), system tray, terminal config menu
- Disk cache of working proxies

## Quick start

```bash
npm install
npm start
```

- Dashboard: `http://127.0.0.1:8787/`
- OpenAI base URL: `http://127.0.0.1:8787/v1`
- Models: `http://127.0.0.1:8787/v1/models`
- Health: `http://127.0.0.1:8787/health`

API key: any string is accepted by default (`openAuth`).

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer local" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-free","messages":[{"role":"user","content":"hi"}]}'
```

## Project layout

```text
├── config/                      ← files YOU edit
│   ├── custom-proxies.example.txt   (copy → custom-proxies.txt)
│   ├── v2ray.example.txt            (copy → v2ray.txt)
│   └── v2ray/                       (optional: drop *.json configs here)
├── data/                        ← runtime state (auto-created, git-ignored)
│   ├── config.json, api-keys.json, proxy-cache.json
│   └── xray/                        (downloaded Xray-core + generated config)
├── src/
│   ├── server.mjs               HTTP server + routes (OpenAI / Anthropic)
│   ├── config.mjs, paths.mjs, stats.mjs
│   ├── cli/menu.mjs             terminal settings menu
│   ├── ui/                      banner, dashboard, tray
│   └── proxy/
│       ├── pool.mjs             scan / rotate / ban logic
│       ├── sources.mjs          public proxy lists
│       ├── parser.mjs, custom.mjs
│       └── v2ray/               links, xray-config, installer, manager, loader
└── test/                        npm test
```

> **Upgrading from ≤ 1.6?** Old `config.json`, `api-keys.json`, `proxy-cache.json` and
> `custom-proxies.txt` in the project root are moved into `data/` / `config/` automatically on first start.

## Personal proxies (recommended)

Free public proxies rarely work against OpenCode. Add your own:

```bash
cp config/custom-proxies.example.txt config/custom-proxies.txt
```

One proxy per line (host can be an IP or a domain):

```text
host:port
host:port:user:pass
user:pass@host:port
http://host:port            http://user:pass@host:port
socks5://host:port          socks5://user:pass@host:port
socks4://host:port
http|host:port              socks5:host:port
```

Or via env (comma / newline separated):

```bash
export PROXY_CUSTOM="socks5://user:pass@1.2.3.4:1080,http://5.6.7.8:8080"
export PROXY_CUSTOM_FILE="/path/to/my-proxies.txt"
```

Personal proxies are tested **first** and always preferred in the pool.

## V2Ray / Xray

Use your own V2Ray servers as personal proxies.

```bash
cp config/v2ray.example.txt config/v2ray.txt
```

Put **any mix** of these in `config/v2ray.txt` (one per line):

| Input | Example |
|-------|---------|
| Share link | `vless://UUID@host:443?security=reality&pbk=…&sid=…&flow=xtls-rprx-vision#name` |
| Share link | `vmess://eyJ2Ij…` (v2rayN base64) or `vmess://UUID@host:443?type=ws…` |
| Share link | `trojan://password@host:443?sni=host#name` |
| Share link | `ss://BASE64(method:pass)@host:8388#name` |
| Subscription URL | `https://provider.example/sub/TOKEN` |

Also supported: links pasted into `config/custom-proxies.txt`, full Xray / V2Ray / v2rayN **JSON configs** in
`config/v2ray/*.json` (every vmess / vless / trojan / shadowsocks outbound becomes a node), and env vars
`V2RAY_LINKS` / `V2RAY_SUBS`.

**How it works.** The app runs one [Xray-core](https://github.com/XTLS/Xray-core) process and exposes each node as a local
SOCKS5 proxy on `127.0.0.1` (never reachable from your LAN). The pool treats them like any other personal proxy:

1. Nodes are tested against OpenCode; **dead nodes are dropped**, working ones are kept in the personal tier.
2. Xray is **downloaded automatically** on first use (SHA-256 verified) into `data/xray/`.
   Use your own binary with `XRAY_PATH`, or a mirror with `XRAY_DOWNLOAD_URL` (useful if GitHub is blocked).
3. Invalid nodes are skipped individually with a reason in the log — one bad link never breaks the rest.
4. Subscriptions are cached on disk; if the provider is unreachable the last good list is used.
5. Xray is restarted automatically if it crashes, and stopped when the server exits.

Supported transports: tcp (incl. http header), ws, grpc, h2, httpupgrade, xhttp, kcp.
Security: none, tls, **reality**. Flow: `xtls-rprx-vision`.
**Not supported:** hysteria / hysteria2 / tuic / wireguard, Shadowsocks plugins (obfs, v2ray-plugin), QUIC.
Such links are skipped with a clear message.

| Variable | Default | Description |
|----------|---------|-------------|
| `V2RAY_ENABLED` | `1` | Turn V2Ray support on / off (also in dashboard & menu) |
| `V2RAY_LINKS` | — | Share links, whitespace / newline separated |
| `V2RAY_SUBS` | — | Subscription URLs, whitespace / newline separated |
| `V2RAY_FILE` | `config/v2ray.txt` | Links / subscriptions file |
| `V2RAY_CONFIG_DIR` | `config/v2ray` | Folder with `*.json` configs |
| `XRAY_PATH` | auto | Path to your own `xray` binary |
| `XRAY_DOWNLOAD_URL` | GitHub latest | Custom download URL (zip) |
| `V2RAY_AUTO_DOWNLOAD` | `1` | `0` = never download, require `XRAY_PATH` / `data/xray/` |
| `V2RAY_BASE_PORT` | `10808` | First local SOCKS port (next free ports are used after it) |
| `V2RAY_MAX_NODES` | `64` | Max nodes loaded (large subscriptions are truncated) |
| `V2RAY_TEST_TIMEOUT_MS` | `10000` | Connect timeout when testing a V2Ray node |
| `V2RAY_SUB_TIMEOUT_MS` | `20000` | Subscription download timeout |
| `V2RAY_DEBUG` | `0` | `1` = print Xray's own log lines |

> **Security note:** `config/custom-proxies.txt`, `config/v2ray.txt` and `config/v2ray/*.json` contain credentials /
> server addresses. They are git-ignored — never commit them.

## Settings

### Terminal menu

```bash
npm run config
```

### Web dashboard

`http://127.0.0.1:8787/` → Settings panel (V2Ray status is shown next to the proxy pool).

### `data/config.json` (auto-created)

```json
{
  "port": 8787,
  "bind": "network",
  "tray": true,
  "hideConsole": false,
  "proxyEnabled": true,
  "v2rayEnabled": true,
  "scanMode": "normal",
  "dashboard": true,
  "openAuth": true
}
```

| Key | Meaning |
|-----|---------|
| `port` | Listen port |
| `bind` | `localhost` or `network` (0.0.0.0) |
| `tray` | System tray icon |
| `hideConsole` | Hide terminal on Windows |
| `proxyEnabled` | Proxy pool on/off |
| `v2rayEnabled` | V2Ray / Xray support on/off |
| `scanMode` | `normal` (fast sample) or `super` (all unique proxies, full zen test) |
| `dashboard` | Web UI at `/` |
| `openAuth` | Accept any API key |

## Proxy pool & scanner

On start (and on a timer) the pool:

1. Loads **personal** proxies (classic + V2Ray nodes)
2. Loads the disk cache of previously working public proxies
3. Fetches **350+ public list sources** (HTTP / SOCKS4 / SOCKS5)
4. **Phase 1** — connectivity (alive?)
5. **Phase 2** — real Zen chat on alive proxies only; **rate-limit / ban / empty are rejected**
6. Only **clean** proxies enter the pool (personal classic proxies are always kept; V2Ray nodes must actually connect)
7. During real traffic: success → promote; rate-limit → short skip (public); hard fail → soft-ban (public)

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_ENABLED` | `1` | Enable pool |
| `PROXY_SAMPLE_SIZE` | `2500` | Soft sample size |
| `PROXY_MAX_SCAN` | `5000` | Deep-scan limit |
| `PROXY_DEEP_SCAN` | `1` | Scan hard on refresh |
| `PROXY_POOL_SIZE` | `50` | Keep N fastest |
| `PROXY_CONCURRENCY` | `200` | Parallel tests |
| `PROXY_CUSTOM` | — | Inline personal proxies |
| `PROXY_CUSTOM_FILE` | `config/custom-proxies.txt` | Personal proxy file |
| `PROXY_SCAN_MODE` | `normal` | `normal` or `super` |
| `PROXY_SOURCES` | built-in | Override public sources (`type=url,type=url`) |
| `PROXY_CACHE_FILE` | `data/proxy-cache.json` | Cache file |
| `PROXY_PORT` / config `port` | `8787` | Listen port |

```bash
# wipe bad cache after upgrades
rm -f data/proxy-cache.json
npm start
```

## Models

Free models are synced from upstream on startup (and every 30 min). Typical IDs:

`deepseek-v4-flash-free`, `big-pickle`, `mimo-v2.5-free`, `hy3-free`, `nemotron-3-ultra-free`,
`nemotron-3.5-lightning-free`, `laguna-s-2.1-free`

```bash
curl http://127.0.0.1:8787/v1/models
curl http://127.0.0.1:8787/v1/models?all=1
```

## Clients

**Hermes / Cursor / any OpenAI client** — Base URL `http://127.0.0.1:8787/v1`, API key `local` (or anything).
**Anthropic-style** — `POST /v1/messages`

## Scripts

```bash
npm start          # run server
npm run config     # settings menu
npm run tray       # with tray
npm run tray:hide  # tray + hide console (Windows)
npm test           # unit tests (+ end-to-end V2Ray tests when XRAY_PATH is set)
```

```bash
XRAY_PATH=/path/to/xray npm test   # also runs the real-tunnel tests (needs openssl)
```

## License

MIT

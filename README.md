# opencode-free-proxy

**Local OpenAI + Anthropic compatible gateway for OpenCode free-tier models.**

One small Node server. Works with Cursor, Continue, Cline, Claude Code, aider, opencode CLI, or plain `curl`.

---

## Quick start

```bash
git clone <this-repo>
cd opencode-free-proxy
npm install
node server.mjs
```

Server listens on `http://localhost:8787`.

Open the **dashboard** in your browser: [http://localhost:8787/](http://localhost:8787/)  
— live request/token stats + settings (port, localhost/network, tray, hide console).

Settings are saved to `config.json` next to the server (auto-created).  
API keys are auto-generated in `api-keys.json` on first run.

---

---

## Settings (`config.json`)

Created automatically on first run. Edit the file **or** use the web dashboard.

```json
{
  "port": 8787,
  "bind": "network",
  "tray": true,
  "hideConsole": false,
  "proxyEnabled": true,
  "dashboard": true
}
```

| Key | Values | Meaning |
|-----|--------|---------|
| `port` | `1–65535` | Listen port |
| `bind` | `localhost` / `network` | Only this PC, or LAN access |
| `tray` | `true` / `false` | System tray icon |
| `hideConsole` | `true` / `false` | Hide terminal (Windows, with tray) |
| `proxyEnabled` | `true` / `false` | Free-proxy rotation pool |
| `dashboard` | `true` / `false` | Web UI at `/` |

### Settings menu (in project)

```bash
npm run config
# or
node menu.mjs
```

Interactive terminal menu: port, bind (localhost/network), tray, hide console, proxy pool, dashboard.

**Just run:**

```bash
npm install
npm start
```

Then open `http://localhost:8787/` — no extra steps.

---

## Models

Free models are synced from OpenCode on startup (and every 30 min).

| Model ID | Notes |
|----------|--------|
| `deepseek-v4-flash-free` | DeepSeek V4 Flash (free) |
| `big-pickle` | Free alias |
| `mimo-v2.5-free` | MiMo 2.5 free |
| `hy3-free` | HY3 free |
| `nemotron-3-ultra-free` | Nemotron 3 Ultra free |
| `nemotron-3.5-lightning-free` | Nemotron 3.5 Lightning free |
| `laguna-s-2.1-free` | Laguna free |

```bash
curl http://localhost:8787/v1/models
curl http://localhost:8787/v1/models?all=1   # full upstream catalogue
```

All support streaming, tool calls, and system messages.

---

## API

### OpenAI — `POST /v1/chat/completions`

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash-free",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### Anthropic — `POST /v1/messages`

```bash
curl http://localhost:8787/v1/messages \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash-free",
    "system": "You are helpful.",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 1024,
    "stream": true
  }'
```

### Other endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/models` | List available models |
| `GET` | `/proxies` | Live proxy pool status |
| `GET` | `/health` | Health, version, pool summary |

Auth: both `Authorization: Bearer KEY` and `x-api-key: KEY` work everywhere.

---

## Use with tools

### Cursor / Continue / Cline

- **Base URL:** `http://localhost:8787/v1`
- **API Key:** from `api-keys.json`
- **Model:** `deepseek-v4-flash-free`

### Claude Code (Anthropic)

- **Base URL:** `http://localhost:8787`
- **API Key:** from `api-keys.json`

### opencode CLI

Add to `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "free": {
      "name": "free",
      "type": "openai",
      "apiKey": "YOUR_KEY",
      "baseURL": "http://localhost:8787/v1",
      "models": {
        "free/deepseek-v4-flash-free": {
          "id": "deepseek-v4-flash-free",
          "name": "free/deepseek-v4-flash-free",
          "attachment": true,
          "reasoning": true
        }
      }
    }
  }
}
```

---

## Proxy pool

When the free tier rate-limits a request, the server automatically falls back through a rotating pool of proxies.

### How it works

1. On startup (and every ~25 min) fetches **60+ public proxy lists** (HTTP, SOCKS4, SOCKS5).
2. Speed-tests candidates against the real Zen API.
3. Keeps the fastest ones that actually reach the API (success **or** rate-limit JSON).
4. Saves winners to `proxy-cache.json` so restarts are faster.
5. On rate-limit / failure: ban that proxy (long or soft cooldown) and try the next.

Watch status:

```bash
curl http://localhost:8787/proxies
curl http://localhost:8787/health
```

### Important reality check

OpenCode’s edge (Cloudflare) blocks most free datacenter proxies.  
The stock pool often ends up **empty** — the server then uses the **direct** route, which is fine until you hit rate limits.

For reliable rotation, point it at **your own** proxies:

```bash
# Linux / macOS
export PROXY_SOURCES="http=https://example.com/my-http.txt,socks5=https://example.com/my-socks5.txt"
node server.mjs

# Windows PowerShell
$env:PROXY_SOURCES="http=https://example.com/my-http.txt,socks5=https://example.com/my-socks5.txt"
node server.mjs
```

Or a local proxy (Clash / V2Ray / etc.):

```bash
export PROXY_SOURCES="http=http://127.0.0.1:7890"
node server.mjs
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_PORT` | `8787` | Listen port |
| `KEYS_FILE` | `./api-keys.json` | API keys path |
| `PROXY_ENABLED` | `1` | Set `0` to disable pool (direct only) |
| `PROXY_SOURCES` | (built-in 60+) | `type=url,type=url,...` override |
| `PROXY_SAMPLE_SIZE` | `350` | Candidates tested per refresh |
| `PROXY_POOL_SIZE` | `30` | Max working proxies kept |
| `PROXY_CONCURRENCY` | `60` | Parallel tests |
| `PROXY_TEST_TIMEOUT_MS` | `5500` | Per-proxy test timeout |
| `PROXY_MAX_ATTEMPTS` | `6` | Proxies tried per request (after direct) |
| `PROXY_COOLDOWN_MS` | `600000` | Ban duration on rate-limit (10 min) |
| `PROXY_FAIL_COOLDOWN_MS` | `60000` | Soft ban on network errors (1 min) |
| `PROXY_REFRESH_MS` | `1500000` | Re-fetch interval (~25 min) |
| `PROXY_CACHE_FILE` | `./proxy-cache.json` | Disk cache path |
| `PROXY_CACHE_MAX_AGE_MS` | `86400000` | Cache entry max age (24 h) |

---

## Deploy on a VPS

```bash
git clone <repo>
cd opencode-free-proxy
npm install
nohup node server.mjs > proxy.log 2>&1 &
```

SSH tunnel if the port is not public:

```bash
ssh -L 8787:127.0.0.1:8787 user@your-vps
```

### systemd (optional)

```ini
# /etc/systemd/system/opencode-proxy.service
[Unit]
Description=OpenCode Free Proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/opencode-proxy
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5
Environment=PROXY_PORT=8787

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now opencode-proxy
```

---

## How the Zen auth works

OpenCode’s free endpoint expects special headers (reverse-engineered from the official CLI):

```
Authorization: Bearer public
User-Agent: opencode/1.15.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13
x-opencode-client: cli
x-opencode-project: global
x-opencode-request: msg_<unique>
x-opencode-session: ses_<unique>
```

Without these, even a valid-looking request gets `AuthError`.

---

---

## System tray (hide to tray)

Run with a system-tray icon (Windows / macOS / Linux):

```bash
npm i          # installs systray
npm run tray           # tray icon + visible console
npm run tray:hide      # tray icon + hide console (Windows)
# or
node server.mjs --tray --hide
```

Tray menu:

| Item | Action |
|------|--------|
| Open Health / Proxies / Models | Opens in browser |
| Copy Base URL | Copies `http://localhost:8787` |
| Hide Console | Hides the terminal window (Windows) |
| Quit | Stops the server |

Env:

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_TRAY` | `1` on Windows, else off | Force tray on/off (`0`/`1`) |
| `PROXY_HIDE_CONSOLE` | off | Auto-hide console when tray starts |

---

## License

MIT

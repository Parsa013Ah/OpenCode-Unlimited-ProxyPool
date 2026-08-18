# OpenCode Free Proxy

Local OpenAI / Anthropic-compatible proxy in front of [OpenCode Zen](https://opencode.ai) free models.

- Rotating **public + personal** proxies
- Live dashboard (requests, tokens, settings)
- System tray, config menu, disk cache of working proxies

## Quick start

```bash
npm install
npm start
```

Open:

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

## Personal proxies (recommended)

Free public proxies rarely work against OpenCode. Add your own:

1. Copy the example file:

```bash
cp custom-proxies.example.txt custom-proxies.txt
```

2. Put one proxy per line. Supported formats:

```text
host:port
host:port:user:pass
user:pass@host:port
http://host:port
http://user:pass@host:port
socks5://host:port
socks5://user:pass@host:port
socks4://host:port
http|host:port
socks5:host:port
```

3. Restart the server. Personal proxies are tested **first** and preferred in the pool.

Or via env (comma / newline separated):

```bash
export PROXY_CUSTOM="socks5://user:pass@1.2.3.4:1080,http://5.6.7.8:8080"
export PROXY_CUSTOM_FILE="/path/to/my-proxies.txt"
```

## Settings

### Terminal menu

```bash
npm run config
```

### Web dashboard

`http://127.0.0.1:8787/` → Settings panel.

### `config.json` (auto-created)

```json
{
  "port": 8787,
  "bind": "network",
  "tray": true,
  "hideConsole": false,
  "proxyEnabled": true,
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
| `proxyEnabled` | Public proxy pool on/off |
| `scanMode` | `normal` (fast sample) or `super` (all unique proxies, full zen test) |
| `openAuth` | Accept any API key |

## Proxy pool & scanner

On start (and on a timer) the pool:

1. Loads **personal** proxies from `custom-proxies.txt` / `PROXY_CUSTOM`
2. Loads disk cache of previously working proxies
3. Fetches **350+ public list sources** (HTTP / SOCKS4 / SOCKS5)
4. **Phase 1** — connectivity (alive?)
5. **Phase 2** — real Zen chat on alive proxies only; **rate-limit / ban / empty are rejected**
6. Only **clean** proxies enter the pool for your real API usage (personal always kept)
7. During real traffic: success → promote; rate-limit → short skip public; hard fail → soft-ban public

Useful env vars:

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_ENABLED` | `1` | Enable pool |
| `PROXY_SAMPLE_SIZE` | `2000` | Soft sample size |
| `PROXY_MAX_SCAN` | `5000` | Deep-scan limit |
| `PROXY_DEEP_SCAN` | `1` | Scan hard on refresh |
| `PROXY_POOL_SIZE` | `50` | Keep N fastest |
| `PROXY_CONCURRENCY` | `120` | Parallel tests |
| `PROXY_CUSTOM` | — | Inline personal proxies |
| `PROXY_CUSTOM_FILE` | `./custom-proxies.txt` | Personal proxy file |
| `PROXY_SCAN_MODE` | `normal` | `normal` or `super` |
| `PROXY_SOURCES` | built-in | Override public sources (`type=url,type=url`) |
| `PROXY_PORT` / config `port` | `8787` | Listen port |

```bash
# wipe bad cache after upgrades
rm -f proxy-cache.json
npm start
```

## Models

Free models are synced from upstream on startup (and every 30 min). Typical IDs:

- `deepseek-v4-flash-free`
- `big-pickle`
- `mimo-v2.5-free`
- `hy3-free`
- `nemotron-3-ultra-free`
- `nemotron-3.5-lightning-free`
- `laguna-s-2.1-free`

```bash
curl http://127.0.0.1:8787/v1/models
curl http://127.0.0.1:8787/v1/models?all=1
```

## Clients

**Hermes / Cursor / any OpenAI client**

- Base URL: `http://127.0.0.1:8787/v1`
- API key: `local` (or anything)

**Anthropic-style**

- `POST /v1/messages`

## Scripts

```bash
npm start          # run server
npm run config     # settings menu
npm run tray       # with tray
npm run tray:hide  # tray + hide console (Windows)
```

## License

MIT

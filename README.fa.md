# opencode-free-proxy

🌐 [**English**](README.md) | **فارسی**

**درگاه محلی سازگار با OpenAI + Anthropic برای مدل‌های رایگان OpenCode.**

یک سرور Node کوچک که با Cursor، Continue، Cline، Claude Code، aider، opencode CLI یا حتی `curl` ساده کار می‌کند.

> 🙏 **تشکر ویژه:** از [bigdata2211it-web](https://github.com/bigdata2211it-web) بابت پروژه‌ی اصلی [opencode-free-proxy](https://github.com/bigdata2211it-web/opencode-free-proxy) — این مخزن یک فورک با تجربه‌ی کانفیگ بهینه‌شده (منوی ترمینال + داشبورد) و رفع باگ‌هاست.

---

## شروع سریع

```bash
git clone <this-repo>
cd opencode-free-proxy
npm install
node server.mjs
```

سرور روی `http://localhost:8787` گوش می‌دهد.

**داشبورد** را در مرورگر باز کنید: [http://localhost:8787/](http://localhost:8787/)  
— آمار زنده‌ی درخواست/توکن + تنظیمات (پورت، localhost/network، tray، مخفی‌سازی کنسول، استخر پروکسی، open auth).

تنظیمات در `config.json` کنار سرور ذخیره می‌شوند (به‌صورت خودکار ساخته می‌شود).  
کلیدهای API در اولین اجرا به‌صورت خودکار در `api-keys.json` ساخته می‌شوند.

---

## تنظیمات (`config.json`)

در اولین اجرا به‌صورت خودکار ساخته می‌شود. فایل را ویرایش کنید **یا** از داشبورد وب استفاده کنید.

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

| کلید | مقادیر | توضیح |
|------|--------|-------|
| `port` | `1–65535` | پورت گوش دادن |
| `bind` | `localhost` / `network` | فقط همین PC، یا دسترسی شبکه‌ی محلی |
| `tray` | `true` / `false` | آیکون سینی سیستم (System tray) |
| `hideConsole` | `true` / `false` | مخفی کردن ترمینال (ویندوز، همراه با tray) |
| `proxyEnabled` | `true` / `false` | استخر چرخش رایگان پروکسی |
| `dashboard` | `true` / `false` | رابط وب در `/` |
| `openAuth` | `true` / `false` | پذیرفتن هر کلید API (مناسب برای Hermes / ابزارهای محلی) |

**💡 نکته:** مقادیر نامعتبر (مثل پورت بیرون از بازه) هنگام بارگذاری خودکار به پیش‌فرض برمی‌گردند، پس ویرایش دستی `config.json` نمی‌تواند سرور را از کار بیندازد.

### منوی تنظیمات (داخل پروژه)

```bash
npm run config
# یا
node menu.mjs
```

منوی ترمینال تعاملی: پورت، bind (localhost/network)، tray، مخفی‌سازی کنسول، استخر پروکسی، داشبورد، open auth — هر گزینه **مقدار فعلی** خودش را نشان می‌دهد و می‌توانید `config.json` را مستقیم در ویرایشگر پیش‌فرض باز کنید (گزینه‌ی ۹). تغییر **open auth** بلافاصله اعمال می‌شود، بقیه بعد از ری‌استارت.

**فقط اجرا کنید:**

```bash
npm install
npm start
```

سپس `http://localhost:8787/` را باز کنید — بدون قدم اضافه.

---

## مدل‌ها

مدل‌های رایگان هنگام راه‌اندازی از OpenCode همگام می‌شوند (و هر ۳۰ دقیقه).

| شناسه‌ی مدل | توضیحات |
|-------------|---------|
| `deepseek-v4-flash-free` | DeepSeek V4 Flash (رایگان) |
| `big-pickle` | نام مستعار رایگان |
| `mimo-v2.5-free` | MiMo 2.5 رایگان |
| `hy3-free` | HY3 رایگان |
| `nemotron-3-ultra-free` | Nemotron 3 Ultra رایگان |
| `nemotron-3.5-lightning-free` | Nemotron 3.5 Lightning رایگان |
| `laguna-s-2.1-free` | Laguna رایگان |

```bash
curl http://localhost:8787/v1/models
curl http://localhost:8787/v1/models?all=1   # کل کاتالوگ بالادست
```

همه از استریم (streaming)، فراخوانی ابزار (tool calls) و پیام‌های سیستم پشتیبانی می‌کنند.

---

## API

### OpenAI — `POST /v1/chat/completions`

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer ***" \
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
  -H "x-api-key: ***" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash-free",
    "system": "You are helpful.",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 1024,
    "stream": true
  }'
```

### سایر نقاط پایانی

| متد | مسیر | توضیح |
|-----|------|-------|
| `GET` | `/v1/models` | فهرست مدل‌های موجود |
| `GET` | `/proxies` | وضعیت زنده‌ی استخر پروکسی |
| `GET` | `/health` | سلامت، نسخه، خلاصه‌ی استخر |

احراز هویت: هر دو `Authorization: Bearer ***` و `x-api-key: ***` همه‌جا کار می‌کنند.

---

## استفاده با ابزارها

### Cursor / Continue / Cline

- **Base URL:** `http://localhost:8787/v1`
- **API Key:** از `api-keys.json`
- **Model:** `deepseek-v4-flash-free`

### Claude Code (Anthropic)

- **Base URL:** `http://localhost:8787`
- **API Key:** از `api-keys.json`

### opencode CLI

به `~/.config/opencode/opencode.json` اضافه کنید:

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

## استخر پروکسی

وقتی سقف رایگان (rate limit) یک درخواست را رد می‌کند، سرور به‌صورت خودکار از میان استخر چرخشی پروکسی‌ها تلاش می‌کند.

### طرز کار

1. هنگام راه‌اندازی (و هر ~۲۵ دقیقه) **۶۰+ فهرست عمومی پروکسی** (HTTP، SOCKS4، SOCKS5) را دریافت می‌کند.
2. نامزدها را در برابر API واقعی Zen از نظر سرعت تست می‌کند.
3. سریع‌ترین‌هایی را که واقعاً به API می‌رسند نگه می‌دارد (موفق **یا** JSON خطای rate-limit).
4. برنده‌ها را در `proxy-cache.json` ذخیره می‌کند تا راه‌اندازی‌های بعدی سریع‌تر باشند.
5. در صورت rate-limit / خطا: آن پروکسی را بن می‌کند (کول‌داون طولانی یا کوتاه) و بعدی را امتحان می‌کند.

مشاهده‌ی وضعیت:

```bash
curl http://localhost:8787/proxies
curl http://localhost:8787/health
```

### واقعیت مهم

لبه‌ی OpenCode (Cloudflare) بیشتر پروکسی‌های رایگان دیتاسنتر را مسدود می‌کند.  
استخر پیش‌فرض اغلب **خالی** تمام می‌شود — سپس سرور از مسیر **مستقیم** استفاده می‌کند که تا وقتی rate-limit نخورید مشکلی نیست.

برای چرخش قابل‌اعتماد، به **پروکسی‌های خودتان** اشاره دهید:

```bash
# Linux / macOS
export PROXY_SOURCES="http=https://example.com/my-http.txt,socks5=https://example.com/my-socks5.txt"
node server.mjs

# Windows PowerShell
$env:PROXY_SOURCES="http=https://example.com/my-http.txt,socks5=https://example.com/my-socks5.txt"
node server.mjs
```

یا یک پروکسی محلی (Clash / V2Ray / و غیره):

```bash
export PROXY_SOURCES="http=http://127.0.0.1:7890"
node server.mjs
```

---

## متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
|-------|---------|-------|
| `PROXY_PORT` | `8787` | پورت گوش دادن |
| `KEYS_FILE` | `./api-keys.json` | مسیر کلیدهای API |
| `PROXY_ENABLED` | `1` | با `0` استخر غیرفعال می‌شود (فقط مستقیم) |
| `PROXY_DASHBOARD` | `1` | با `0` داشبورد وب غیرفعال می‌شود |
| `PROXY_OPEN_AUTH` | `1` | با `0` کلید معتبر از `api-keys.json` الزامی می‌شود |
| `PROXY_SOURCES` | (۶۰+ داخلی) | جایگزین `type=url,type=url,...` |
| `PROXY_SAMPLE_SIZE` | `350` | نامزدهای تست‌شده در هر بار به‌روزرسانی |
| `PROXY_POOL_SIZE` | `30` | حداکثر پروکسی‌های کاری نگه‌داری‌شده |
| `PROXY_CONCURRENCY` | `60` | تست‌های موازی |
| `PROXY_TEST_TIMEOUT_MS` | `5500` | مهلت تست هر پروکسی |
| `PROXY_MAX_ATTEMPTS` | `6` | پروکسی‌های امتحان‌شده در هر درخواست (بعد از مستقیم) |
| `PROXY_COOLDOWN_MS` | `600000` | مدت بن در rate-limit (۱۰ دقیقه) |
| `PROXY_FAIL_COOLDOWN_MS` | `60000` | بن نرم در خطاهای شبکه (۱ دقیقه) |
| `PROXY_REFRESH_MS` | `1500000` | فاصله‌ی دریافت دوباره (~۲۵ دقیقه) |
| `PROXY_CACHE_FILE` | `./proxy-cache.json` | مسیر کش روی دیسک |
| `PROXY_CACHE_MAX_AGE_MS` | `86400000` | حداکثر عمر ورودی کش (۲۴ ساعت) |

---

## استقرار روی VPS

```bash
git clone <repo>
cd opencode-free-proxy
npm install
nohup node server.mjs > proxy.log 2>&1 &
```

اگر پورت عمومی نیست، تونل SSH:

```bash
ssh -L 8787:127.0.0.1:8787 user@your-vps
```

### systemd (اختیاری)

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

## طرز کار احراز هویت Zen

نقطه‌ی پایانی رایگان OpenCode هدرهای خاصی انتظار دارد (مهندسی معکوس از CLI رسمی):

```
Authorization: Bearer ***
User-Agent: opencode/1.15.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13
x-opencode-client: cli
x-opencode-project: global
x-opencode-request: msg_<unique>
x-opencode-session: ses_<unique>
```

بدون این‌ها، حتی یک درخواست به‌ظاهر معتبر `AuthError` می‌گیرد.

---

## سینی سیستم (مخفی کردن در Tray)

اجرا با آیکون سینی سیستم (ویندوز / مک / لینوکس):

```bash
npm i          # نصب systray
npm run tray           # آیکون tray + کنسول قابل مشاهده
npm run tray:hide      # آیکون tray + مخفی کردن کنسول (ویندوز)
# یا
node server.mjs --tray --hide
```

منوی tray:

| گزینه | عملکرد |
|-------|--------|
| Open Health / Proxies / Models | باز کردن در مرورگر |
| Copy Base URL | کپی `http://localhost:8787` |
| Hide Console | مخفی کردن پنجره‌ی ترمینال (ویندوز) |
| Quit | توقف سرور |

متغیرها:

| متغیر | پیش‌فرض | توضیح |
|-------|---------|-------|
| `PROXY_TRAY` | `1` در ویندوز، در غیر این صورت خاموش | اجبار tray روشن/خاموش (`0`/`1`) |
| `PROXY_HIDE_CONSOLE` | خاموش | مخفی‌سازی خودکار کنسول وقتی tray شروع می‌شود |

---

## مجوز

MIT
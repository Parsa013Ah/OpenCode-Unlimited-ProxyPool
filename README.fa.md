# OpenCode Free Proxy

🌐 [English](README.md) | **فارسی**

پروکسی محلی سازگار با OpenAI و Anthropic که جلوی مدل‌های رایگان [OpenCode Zen](https://opencode.ai) قرار می‌گیره.

- چرخش خودکار پروکسی‌های **عمومی و شخصی** (HTTP / SOCKS4 / SOCKS5)
- **پشتیبانی از V2Ray / Xray**: لینک‌های `vmess://`، `vless://` (از جمله REALITY)، `trojan://`، `ss://`، سابسکریپشن و کانفیگ JSON
- داشبورد زنده (درخواست‌ها، توکن‌ها، تنظیمات)، آیکن سیستم‌تری، منوی تنظیمات ترمینال
- کش دیسکی پروکسی‌های سالم

## شروع سریع

```bash
npm install
npm start
```

- داشبورد: `http://127.0.0.1:8787/`
- آدرس پایه OpenAI: `http://127.0.0.1:8787/v1`
- لیست مدل‌ها: `http://127.0.0.1:8787/v1/models`
- سلامت سرویس: `http://127.0.0.1:8787/health`

به‌صورت پیش‌فرض هر متنی به‌عنوان API key قبول می‌شه (`openAuth`).

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer local" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-free","messages":[{"role":"user","content":"hi"}]}'
```

## ساختار پروژه

```text
├── config/                      ← فایل‌هایی که خودتان ویرایش می‌کنید
│   ├── custom-proxies.example.txt   (کپی کنید به custom-proxies.txt)
│   ├── v2ray.example.txt            (کپی کنید به v2ray.txt)
│   └── v2ray/                       (اختیاری: فایل‌های *.json اینجا)
├── data/                        ← وضعیت زمان اجرا (خودکار ساخته می‌شه، توی git نیست)
│   ├── config.json, api-keys.json, proxy-cache.json
│   └── xray/                        (Xray-core دانلودشده + کانفیگ تولیدشده)
├── src/
│   ├── server.mjs               سرور HTTP و مسیرها (OpenAI / Anthropic)
│   ├── config.mjs, paths.mjs, stats.mjs
│   ├── cli/menu.mjs             منوی تنظیمات ترمینال
│   ├── ui/                      banner، dashboard، tray
│   └── proxy/
│       ├── pool.mjs             منطق اسکن / چرخش / بن
│       ├── sources.mjs          لیست‌های عمومی پروکسی
│       ├── parser.mjs, custom.mjs
│       └── v2ray/               links، xray-config، installer، manager، loader
└── test/                        npm test
```

> **آپدیت از نسخه ۱.۶ یا قدیمی‌تر؟** فایل‌های `config.json`، `api-keys.json`، `proxy-cache.json` و
> `custom-proxies.txt` که کنار پروژه بودن، در اولین اجرا خودکار به `data/` و `config/` منتقل می‌شن.

## پروکسی شخصی (پیشنهادی)

پروکسی‌های عمومی رایگان معمولاً با OpenCode کار نمی‌کنن. پروکسی خودتون رو اضافه کنید:

```bash
cp config/custom-proxies.example.txt config/custom-proxies.txt
```

هر خط یک پروکسی (host می‌تونه IP یا دامنه باشه):

```text
host:port
host:port:user:pass
user:pass@host:port
http://host:port            http://user:pass@host:port
socks5://host:port          socks5://user:pass@host:port
socks4://host:port
http|host:port              socks5:host:port
```

یا با متغیر محیطی (جداشده با کاما یا خط جدید):

```bash
export PROXY_CUSTOM="socks5://user:pass@1.2.3.4:1080,http://5.6.7.8:8080"
export PROXY_CUSTOM_FILE="/path/to/my-proxies.txt"
```

پروکسی‌های شخصی **اول از همه** تست می‌شن و همیشه در pool اولویت دارن.

## V2Ray / Xray

سرورهای V2Ray خودتون رو به‌عنوان پروکسی شخصی استفاده کنید.

```bash
cp config/v2ray.example.txt config/v2ray.txt
```

هر ترکیبی از این‌ها رو توی `config/v2ray.txt` بذارید (هر خط یک مورد):

| ورودی | نمونه |
|-------|-------|
| لینک | `vless://UUID@host:443?security=reality&pbk=…&sid=…&flow=xtls-rprx-vision#name` |
| لینک | `vmess://eyJ2Ij…` (فرمت base64 نرم‌افزار v2rayN) یا `vmess://UUID@host:443?type=ws…` |
| لینک | `trojan://password@host:443?sni=host#name` |
| لینک | `ss://BASE64(method:pass)@host:8388#name` |
| آدرس سابسکریپشن | `https://provider.example/sub/TOKEN` |

این روش‌ها هم کار می‌کنن: چسباندن لینک‌ها داخل `config/custom-proxies.txt`، **کانفیگ JSON** کامل Xray / V2Ray / v2rayN
داخل `config/v2ray/*.json` (هر outbound از نوع vmess / vless / trojan / shadowsocks یک نود حساب می‌شه)،
و متغیرهای `V2RAY_LINKS` و `V2RAY_SUBS`.

**طرز کار:** برنامه یک پروسه [Xray-core](https://github.com/XTLS/Xray-core) اجرا می‌کنه و هر نود رو به‌صورت یک
SOCKS5 محلی روی `127.0.0.1` در دسترس می‌ذاره (از شبکه‌ی LAN قابل دسترسی نیست). pool با این نودها مثل بقیه‌ی پروکسی‌های شخصی رفتار می‌کنه:

1. نودها روی OpenCode تست می‌شن؛ **نودهای مرده حذف می‌شن** و فقط سالم‌ها در دسته‌ی شخصی می‌مونن.
2. Xray در اولین استفاده **خودکار دانلود می‌شه** (با تأیید SHA-256) و داخل `data/xray/` ذخیره می‌شه.
   می‌تونید باینری خودتون رو با `XRAY_PATH` یا یک mirror رو با `XRAY_DOWNLOAD_URL` بدید (اگر GitHub فیلتره).
3. نودهای نامعتبر جداگانه رد می‌شن و دلیلش توی لاگ نوشته می‌شه؛ یک لینک خراب بقیه رو خراب نمی‌کنه.
4. سابسکریپشن روی دیسک کش می‌شه؛ اگر سرور سابسکریپشن در دسترس نبود از آخرین لیست سالم استفاده می‌شه.
5. اگر Xray کرش کنه خودکار دوباره اجرا می‌شه و با خروج برنامه بسته می‌شه.

ترنسپورت‌های پشتیبانی‌شده: tcp (با header از نوع http)، ws، grpc، h2، httpupgrade، xhttp، kcp.
امنیت: none، tls، **reality**. جریان (flow): `xtls-rprx-vision`.
**پشتیبانی نمی‌شه:** hysteria / hysteria2 / tuic / wireguard، پلاگین‌های Shadowsocks (obfs و v2ray-plugin)، QUIC.
این لینک‌ها با پیام مشخص نادیده گرفته می‌شن.

| متغیر | پیش‌فرض | توضیح |
|-------|---------|-------|
| `V2RAY_ENABLED` | `1` | روشن/خاموش کردن V2Ray (در داشبورد و منو هم هست) |
| `V2RAY_LINKS` | — | لینک‌ها، جداشده با فاصله یا خط جدید |
| `V2RAY_SUBS` | — | آدرس سابسکریپشن‌ها، جداشده با فاصله یا خط جدید |
| `V2RAY_FILE` | `config/v2ray.txt` | فایل لینک‌ها / سابسکریپشن‌ها |
| `V2RAY_CONFIG_DIR` | `config/v2ray` | پوشه‌ی کانفیگ‌های `*.json` |
| `XRAY_PATH` | خودکار | مسیر باینری `xray` خودتان |
| `XRAY_DOWNLOAD_URL` | آخرین نسخه‌ی GitHub | آدرس دلخواه دانلود (zip) |
| `V2RAY_AUTO_DOWNLOAD` | `1` | `0` یعنی هرگز دانلود نکن و `XRAY_PATH` یا `data/xray/` لازم باشه |
| `V2RAY_BASE_PORT` | `10808` | اولین پورت SOCKS محلی (بعدش پورت‌های آزاد بعدی) |
| `V2RAY_MAX_NODES` | `64` | حداکثر تعداد نود (سابسکریپشن‌های بزرگ بریده می‌شن) |
| `V2RAY_TEST_TIMEOUT_MS` | `10000` | تایم‌اوت تست اتصال نود |
| `V2RAY_SUB_TIMEOUT_MS` | `20000` | تایم‌اوت دانلود سابسکریپشن |
| `V2RAY_DEBUG` | `0` | با `1` لاگ خود Xray هم چاپ می‌شه |

> **نکته‌ی امنیتی:** فایل‌های `config/custom-proxies.txt`، `config/v2ray.txt` و `config/v2ray/*.json` شامل
> رمز و آدرس سرور هستن. توی `.gitignore` قرار دارن؛ هرگز کامیتشون نکنید.

## تنظیمات

### منوی ترمینال

```bash
npm run config
```

### داشبورد وب

`http://127.0.0.1:8787/` ← بخش Settings (وضعیت V2Ray کنار pool نمایش داده می‌شه).

### `data/config.json` (خودکار ساخته می‌شه)

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

| کلید | معنی |
|------|------|
| `port` | پورت سرور |
| `bind` | `localhost` یا `network` (همان 0.0.0.0) |
| `tray` | آیکن سیستم‌تری |
| `hideConsole` | مخفی کردن ترمینال در ویندوز |
| `proxyEnabled` | روشن/خاموش pool پروکسی |
| `v2rayEnabled` | روشن/خاموش پشتیبانی V2Ray / Xray |
| `scanMode` | `normal` (نمونه‌ی سریع) یا `super` (همه‌ی پروکسی‌های یکتا با تست کامل zen) |
| `dashboard` | رابط وب روی `/` |
| `openAuth` | قبول هر API key |

## pool پروکسی و اسکنر

موقع شروع (و به‌صورت زمان‌بندی‌شده) pool این کارها رو انجام می‌ده:

1. پروکسی‌های **شخصی** (کلاسیک و نودهای V2Ray) رو لود می‌کنه
2. کش دیسکی پروکسی‌های عمومیِ سالمِ قبلی رو لود می‌کنه
3. بیش از **۳۵۰ منبع لیست عمومی** (HTTP / SOCKS4 / SOCKS5) رو می‌گیره
4. **فاز ۱:** تست اتصال (زنده هست؟)
5. **فاز ۲:** چت واقعی با Zen فقط روی پروکسی‌های زنده؛ **rate-limit، بن و پاسخ خالی رد می‌شن**
6. فقط پروکسی‌های **تمیز** وارد pool می‌شن (پروکسی‌های شخصی کلاسیک همیشه می‌مونن؛ نودهای V2Ray باید واقعاً وصل بشن)
7. حین ترافیک واقعی: موفقیت ← ارتقا؛ rate-limit ← رد موقت (عمومی)؛ خطای جدی ← بن نرم (عمومی)

| متغیر | پیش‌فرض | توضیح |
|-------|---------|-------|
| `PROXY_ENABLED` | `1` | فعال‌سازی pool |
| `PROXY_SAMPLE_SIZE` | `2500` | اندازه‌ی نمونه |
| `PROXY_MAX_SCAN` | `5000` | سقف اسکن عمیق |
| `PROXY_DEEP_SCAN` | `1` | اسکن سخت‌گیرانه در refresh |
| `PROXY_POOL_SIZE` | `50` | نگه داشتن N پروکسی سریع‌تر |
| `PROXY_CONCURRENCY` | `200` | تست‌های موازی |
| `PROXY_CUSTOM` | — | پروکسی‌های شخصی به‌صورت درون‌خطی |
| `PROXY_CUSTOM_FILE` | `config/custom-proxies.txt` | فایل پروکسی‌های شخصی |
| `PROXY_SCAN_MODE` | `normal` | `normal` یا `super` |
| `PROXY_SOURCES` | داخلی | جایگزینی منابع عمومی (`type=url,type=url`) |
| `PROXY_CACHE_FILE` | `data/proxy-cache.json` | فایل کش |
| `PROXY_PORT` / کلید `port` | `8787` | پورت سرور |

```bash
# پاک کردن کش خراب بعد از آپدیت
rm -f data/proxy-cache.json
npm start
```

## مدل‌ها

مدل‌های رایگان موقع شروع (و هر ۳۰ دقیقه) از upstream همگام می‌شن. شناسه‌های رایج:

`deepseek-v4-flash-free`, `big-pickle`, `mimo-v2.5-free`, `hy3-free`, `nemotron-3-ultra-free`,
`nemotron-3.5-lightning-free`, `laguna-s-2.1-free`

```bash
curl http://127.0.0.1:8787/v1/models
curl http://127.0.0.1:8787/v1/models?all=1
```

## کلاینت‌ها

**Hermes / Cursor / هر کلاینت OpenAI:** آدرس پایه `http://127.0.0.1:8787/v1` و API key برابر `local` (یا هر چیز دیگه).
**سبک Anthropic:** `POST /v1/messages`

## اسکریپت‌ها

```bash
npm start          # اجرای سرور
npm run config     # منوی تنظیمات
npm run tray       # با آیکن سیستم‌تری
npm run tray:hide  # تری + مخفی کردن کنسول (ویندوز)
npm test           # تست‌های واحد (و تست‌های سرتاسری V2Ray وقتی XRAY_PATH تنظیم باشه)
```

```bash
XRAY_PATH=/path/to/xray npm test   # تست‌های تونل واقعی هم اجرا می‌شن (به openssl نیاز دارن)
```

## لایسنس

MIT

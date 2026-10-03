/**
 * Integration: real pool.refresh() + real Xray tunnels + a fake "Zen" HTTPS server.
 *   live V2Ray node  → must end up in the personal tier and carry a real chat request
 *   dead V2Ray node  → must be rejected (not "always-on")
 *   hysteria2 link   → skipped with a reason
 * Needs: XRAY_PATH=/path/to/xray and `openssl` (skipped otherwise).
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import { spawn, spawnSync } from "child_process";

const XRAY = process.env.XRAY_PATH;
const haveOpenssl = spawnSync("openssl", ["version"]).status === 0;
const ok = XRAY && fs.existsSync(XRAY) && haveOpenssl;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ocfp-int-"));
const UUID = "b831381d-6324-4d53-ad4f-8cda48b30811";
const ZEN_PORT = 24443, LIVE = 24001, DEAD = 24999;

let zen, xs;
after(async () => {
  const { stopV2ray } = await import("../src/proxy/v2ray/manager.mjs");
  stopV2ray();
  try { zen?.close(); } catch {}
  try { xs?.kill(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 200).unref();
});

test("pool keeps the live V2Ray node, rejects the dead one", { skip: !ok && "needs XRAY_PATH + openssl", timeout: 90_000 }, async () => {
  fs.mkdirSync(path.join(tmp, "config"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
  spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${tmp}/k.pem`, "-out", `${tmp}/c.pem`, "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });

  zen = https.createServer({ key: fs.readFileSync(`${tmp}/k.pem`), cert: fs.readFileSync(`${tmp}/c.pem`) }, (req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: "hi" } }] }));
    });
  });
  await new Promise((r) => zen.listen(ZEN_PORT, "127.0.0.1", r));

  fs.writeFileSync(`${tmp}/xs.json`, JSON.stringify({
    log: { loglevel: "none" },
    inbounds: [{ port: LIVE, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "ws", wsSettings: { path: "/ws" } } }],
    outbounds: [{ protocol: "freedom" }],
  }));
  xs = spawn(XRAY, ["run", "-c", `${tmp}/xs.json`], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1200));

  fs.writeFileSync(`${tmp}/config/v2ray.txt`, [
    `vless://${UUID}@127.0.0.1:${LIVE}?type=ws&path=%2Fws&security=none#live`,
    `vless://${UUID}@127.0.0.1:${DEAD}?type=ws&path=%2Fws&security=none#dead`,
    "hysteria2://x@h:443#nope",
  ].join("\n"));

  Object.assign(process.env, {
    DATA_DIR: `${tmp}/data`, CONFIG_DIR: `${tmp}/config`, XRAY_PATH: XRAY,
    PROXY_TEST_HOST: "127.0.0.1", PROXY_TEST_PORT: String(ZEN_PORT),
    PROXY_SOURCES: "http=http://127.0.0.1:1/none", V2RAY_BASE_PORT: "22300",
  });

  const pool = await import("../src/proxy/pool.mjs");
  await pool.refresh();
  const info = pool.getPoolInfo();

  assert.equal(info.v2ray.running, true);
  assert.equal(info.v2ray.nodes, 2, "both valid nodes get a local port");
  assert.equal(info.v2ray.reachable, 1, "only the live node is kept as personal");
  assert.equal(info.personalCount, 1);
  const live = info.working.find((w) => w.v2ray);
  assert.ok(live && live.personal);
  assert.match(live.proxy, /^v2ray·vless·live/);

  const agents = pool.getProxyAgents();
  assert.equal(agents.length, 1);
  assert.ok(pool.isPersonalAgent(agents[0]));

  // a real request through pool agent → xray → vless/ws → fake zen
  const body = await new Promise((resolve, reject) => {
    const req = https.request({ host: "127.0.0.1", port: ZEN_PORT, path: "/", method: "POST", agent: agents[0], rejectUnauthorized: false }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve(b));
    });
    req.on("error", reject);
    req.end("{}");
  });
  assert.match(body, /"content":"hi"/);
});

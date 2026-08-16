/**
 * dashboard.mjs — Beautiful live stats + settings page at GET /
 */
import { getStats } from "./stats.mjs";
import { getConfig, saveConfig, hostFromBind } from "./config.mjs";
import { getPoolInfo } from "./proxy-pool.mjs";

export function mountDashboard(app) {
  app.get("/", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(htmlPage());
  });

  app.get("/api/stats", (_req, res) => {
    res.json({ stats: getStats(), proxy: getPoolInfo(), config: publicConfig() });
  });

  app.get("/api/config", (_req, res) => {
    res.json(publicConfig());
  });

  app.post("/api/config", (req, res) => {
    const body = req.body || {};
    const next = {};
    if (body.port != null) {
      const p = parseInt(body.port, 10);
      if (p >= 1 && p <= 65535) next.port = p;
    }
    if (body.bind === "localhost" || body.bind === "network") next.bind = body.bind;
    if (typeof body.tray === "boolean") next.tray = body.tray;
    if (typeof body.hideConsole === "boolean") next.hideConsole = body.hideConsole;
    if (typeof body.proxyEnabled === "boolean") next.proxyEnabled = body.proxyEnabled;
    if (typeof body.dashboard === "boolean") next.dashboard = body.dashboard;
    const cfg = saveConfig(next);
    res.json({
      ok: true,
      config: publicConfig(),
      note: "Port / bind changes apply after restart. Tray/hide apply next launch.",
      restartRequired: next.port != null || next.bind != null,
    });
  });
}

function publicConfig() {
  const c = getConfig();
  return {
    port: c.port,
    bind: c.bind,
    host: hostFromBind(c.bind),
    tray: c.tray,
    hideConsole: c.hideConsole,
    proxyEnabled: c.proxyEnabled,
    dashboard: c.dashboard,
  };
}

function htmlPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>OpenCode Proxy</title>
<style>
  :root {
    --bg: #0b0f14;
    --panel: #121821;
    --panel2: #18212d;
    --border: #243041;
    --text: #e8eef7;
    --muted: #8b9bb0;
    --cyan: #3de0ff;
    --magenta: #c084fc;
    --green: #34d399;
    --yellow: #fbbf24;
    --red: #f87171;
    --blue: #60a5fa;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    background: radial-gradient(1200px 600px at 10% -10%, #1a2740 0%, transparent 50%),
                radial-gradient(900px 500px at 100% 0%, #1b1530 0%, transparent 45%),
                var(--bg);
    color: var(--text); min-height: 100vh;
  }
  header {
    padding: 28px 28px 12px; display: flex; flex-wrap: wrap; gap: 12px;
    align-items: center; justify-content: space-between;
  }
  h1 { margin: 0; font-size: 1.35rem; letter-spacing: 0.02em; }
  h1 span { color: var(--cyan); }
  .badge {
    font-size: 12px; padding: 4px 10px; border-radius: 999px;
    background: var(--panel2); border: 1px solid var(--border); color: var(--muted);
  }
  .badge.live { color: var(--green); border-color: #1f3d32; }
  main { padding: 8px 28px 40px; max-width: 1200px; margin: 0 auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 18px; }
  .card {
    background: linear-gradient(180deg, var(--panel) 0%, var(--panel2) 100%);
    border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px;
  }
  .card .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .card .value { font-size: 1.7rem; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .card .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .cyan { color: var(--cyan); } .green { color: var(--green); } .yellow { color: var(--yellow); }
  .magenta { color: var(--magenta); } .red { color: var(--red); } .blue { color: var(--blue); }
  .row { display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px; }
  @media (max-width: 860px) { .row { grid-template-columns: 1fr; } }
  h2 { font-size: 0.95rem; margin: 0 0 12px; color: var(--muted); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; }
  .ok { color: var(--green); } .err { color: var(--red); }
  .settings label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; }
  .settings .field { margin-bottom: 14px; }
  input[type=number], select {
    width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border);
    background: var(--bg); color: var(--text); font-size: 14px;
  }
  .checks { display: flex; flex-direction: column; gap: 10px; margin: 8px 0 16px; }
  .checks label { display: flex; align-items: center; gap: 10px; color: var(--text); cursor: pointer; }
  button {
    background: linear-gradient(135deg, #1e90ff, #7c3aed); color: white; border: none;
    padding: 11px 18px; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 14px;
  }
  button:hover { filter: brightness(1.08); }
  .note { font-size: 12px; color: var(--muted); margin-top: 10px; line-height: 1.45; }
  .note strong { color: var(--yellow); }
  footer { text-align: center; color: var(--muted); font-size: 12px; padding: 20px; }
</style>
</head>
<body>
<header>
  <div>
    <h1>OpenCode <span>Proxy</span></h1>
    <div style="margin-top:6px;color:var(--muted);font-size:13px">Live dashboard · settings · stats</div>
  </div>
  <div style="display:flex;gap:8px;align-items:center">
    <span class="badge live" id="live">● live</span>
    <span class="badge" id="uptime">uptime —</span>
  </div>
</header>
<main>
  <div class="grid">
    <div class="card"><div class="label">Requests</div><div class="value cyan" id="req">0</div><div class="sub" id="reqSub">ok 0 · err 0</div></div>
    <div class="card"><div class="label">Tokens in</div><div class="value blue" id="tin">0</div><div class="sub">prompt</div></div>
    <div class="card"><div class="label">Tokens out</div><div class="value magenta" id="tout">0</div><div class="sub">completion</div></div>
    <div class="card"><div class="label">Tokens total</div><div class="value green" id="ttot">0</div><div class="sub">in + out</div></div>
    <div class="card"><div class="label">Streaming</div><div class="value yellow" id="stream">0</div><div class="sub">stream requests</div></div>
    <div class="card"><div class="label">Proxy pool</div><div class="value" id="pool">0</div><div class="sub" id="poolSub">working</div></div>
  </div>

  <div class="row">
    <div class="card">
      <h2>Recent requests</h2>
      <div style="overflow:auto;max-height:340px">
        <table>
          <thead><tr><th>Time</th><th>User</th><th>Model</th><th>Tok</th><th>ms</th><th>Status</th></tr></thead>
          <tbody id="recent"></tbody>
        </table>
      </div>
    </div>
    <div class="card settings">
      <h2>Settings</h2>
      <div class="field">
        <label>Port</label>
        <input type="number" id="port" min="1" max="65535" />
      </div>
      <div class="field">
        <label>Bind address</label>
        <select id="bind">
          <option value="localhost">Localhost only (this PC)</option>
          <option value="network">Network (LAN access)</option>
        </select>
      </div>
      <div class="checks">
        <label><input type="checkbox" id="tray"/> System tray icon</label>
        <label><input type="checkbox" id="hideConsole"/> Hide console on start (Windows)</label>
        <label><input type="checkbox" id="proxyEnabled"/> Proxy pool enabled</label>
      </div>
      <button id="save">Save settings</button>
      <div class="note" id="saveNote">
        Port &amp; bind need a <strong>restart</strong> to apply. Tray / hide apply on next launch.
        Edit <strong>config.json</strong> next to the server if you prefer.
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h2>By model</h2>
    <table>
      <thead><tr><th>Model</th><th>Requests</th><th>Tokens in</th><th>Tokens out</th><th>Errors</th></tr></thead>
      <tbody id="models"></tbody>
    </table>
  </div>
</main>
<footer>OpenCode Free Proxy · open <code>/health</code> · <code>/proxies</code> · <code>/v1/models</code></footer>
<script>
const $ = (id) => document.getElementById(id);
function fmt(n){ return (n||0).toLocaleString(); }
function time(ts){ return new Date(ts).toLocaleTimeString(); }

async function refresh(){
  try{
    const r = await fetch('/api/stats');
    const d = await r.json();
    const s = d.stats, p = d.proxy, c = d.config;
    $('req').textContent = fmt(s.requestsTotal);
    $('reqSub').textContent = 'ok '+fmt(s.requestsOk)+' · err '+fmt(s.requestsErr);
    $('tin').textContent = fmt(s.tokensIn);
    $('tout').textContent = fmt(s.tokensOut);
    $('ttot').textContent = fmt(s.tokensTotal);
    $('stream').textContent = fmt(s.requestsStream);
    $('pool').textContent = fmt(p.workingCount||0);
    $('poolSub').textContent = (p.enabled===false?'disabled':((p.workingCount||0)+' working · '+(p.bannedCount||0)+' banned'));
    $('uptime').textContent = 'uptime '+s.uptime;
    $('live').textContent = '● live';

    // settings form (only fill if not focused)
    if(document.activeElement?.id !== 'port') $('port').value = c.port;
    if(document.activeElement?.id !== 'bind') $('bind').value = c.bind;
    $('tray').checked = !!c.tray;
    $('hideConsole').checked = !!c.hideConsole;
    $('proxyEnabled').checked = !!c.proxyEnabled;

    const tb = $('recent');
    tb.innerHTML = (s.lastRequests||[]).map(x => '<tr>'+
      '<td>'+time(x.ts)+'</td>'+
      '<td>'+x.user+'</td>'+
      '<td>'+x.model+'</td>'+
      '<td>'+fmt(x.tokensIn)+'→'+fmt(x.tokensOut)+'</td>'+
      '<td>'+fmt(x.ms)+'</td>'+
      '<td class="'+(x.ok?'ok':'err')+'">'+(x.ok?'OK':'ERR')+'</td>'+
      '</tr>').join('') || '<tr><td colspan="6" style="color:var(--muted)">No requests yet</td></tr>';

    const mb = $('models');
    const models = Object.entries(s.byModel||{});
    mb.innerHTML = models.map(([m,v]) => '<tr><td>'+m+'</td><td>'+fmt(v.n)+'</td><td>'+fmt(v.tokensIn)+'</td><td>'+fmt(v.tokensOut)+'</td><td>'+fmt(v.err)+'</td></tr>').join('')
      || '<tr><td colspan="5" style="color:var(--muted)">—</td></tr>';
  }catch(e){
    $('live').textContent = '● offline';
  }
}

$('save').onclick = async () => {
  const body = {
    port: parseInt($('port').value,10),
    bind: $('bind').value,
    tray: $('tray').checked,
    hideConsole: $('hideConsole').checked,
    proxyEnabled: $('proxyEnabled').checked,
  };
  const r = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json();
  $('saveNote').innerHTML = d.restartRequired
    ? 'Saved. <strong>Restart the server</strong> for port/bind to take effect.'
    : 'Saved.';
  refresh();
};

refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}

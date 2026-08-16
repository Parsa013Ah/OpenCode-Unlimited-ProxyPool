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
      if (Math.floor(p) === p && p >= 1 && p <= 65535) next.port = p;
    }
    if (body.bind === "localhost" || body.bind === "network") next.bind = body.bind;
    for (const k of ["tray", "hideConsole", "proxyEnabled", "dashboard", "openAuth"]) {
      if (typeof body[k] === "boolean") next[k] = body[k];
    }
    saveConfig(next);
    res.json({
      ok: true,
      config: publicConfig(),
      note: restartNote(next),
      restartRequired: next.port != null || next.bind != null || next.proxyEnabled != null,
    });
  });
}

function restartNote(next) {
  const parts = [];
  if (next.port != null || next.bind != null || next.proxyEnabled != null)
    parts.push("Restart required for port / bind / proxy pool");
  if (next.tray != null || next.hideConsole != null)
    parts.push("Tray &amp; hide apply on next launch");
  if (next.openAuth != null || next.dashboard != null)
    parts.push("Open auth &amp; dashboard apply immediately");
  return parts.join(" · ");
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
    openAuth: c.openAuth,
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
    --accent1: #1e90ff;
    --accent2: #7c3aed;
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

  /* ── Settings ─────────────────────────────────────────────── */
  .settings .field { margin-bottom: 14px; }
  .settings .field > label { display: block; font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
  .settings .hint { font-size: 12px; color: var(--muted); margin-top: 6px; line-height: 1.45; }
  .settings .hint code { color: var(--cyan); background: rgba(61,224,255,.08); padding: 1px 6px; border-radius: 6px; font-size: 12px; }
  input[type=number], select {
    width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border);
    background: var(--bg); color: var(--text); font-size: 14px; outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  input[type=number]:focus, select:focus { border-color: var(--accent1); box-shadow: 0 0 0 3px rgba(30,144,255,.15); }
  .divider { border: none; border-top: 1px dashed var(--border); margin: 14px 0; }

  .toggle-row {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 9px 0; border-bottom: 1px dashed var(--border);
  }
  .toggle-row:last-of-type { border-bottom: none; }
  .toggle-row .ctl { display: flex; flex-direction: column; gap: 2px; }
  .toggle-row .ctl b { font-size: 13.5px; font-weight: 600; }
  .toggle-row .ctl span { font-size: 12px; color: var(--muted); }

  .switch { position: relative; width: 42px; height: 23px; flex: none; }
  .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
  .slider {
    position: absolute; inset: 0; background: #2a3547; border-radius: 999px;
    transition: background .18s; cursor: pointer;
  }
  .slider::before {
    content: ""; position: absolute; width: 17px; height: 17px; left: 3px; top: 3px;
    background: #8b9bb0; border-radius: 50%; transition: transform .18s, background .18s;
  }
  .switch input:checked + .slider { background: linear-gradient(135deg, var(--accent1), var(--accent2)); }
  .switch input:checked + .slider::before { transform: translateX(19px); background: #fff; }
  .switch input:focus-visible + .slider { box-shadow: 0 0 0 3px rgba(30,144,255,.25); }

  button {
    background: linear-gradient(135deg, var(--accent1), var(--accent2)); color: white; border: none;
    padding: 11px 18px; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 14px;
    width: 100%; transition: filter .15s, opacity .15s;
  }
  button:hover:not(:disabled) { filter: brightness(1.08); }
  button:disabled { opacity: .55; cursor: default; }

  .note { font-size: 12px; color: var(--muted); margin-top: 12px; line-height: 1.5; border-radius: 10px; padding: 10px 12px; background: rgba(255,255,255,.03); border: 1px solid var(--border); }
  .note.ok { color: var(--green); border-color: #1f3d32; background: rgba(52,211,153,.06); }
  .note.warn { color: var(--yellow); border-color: #4d3b14; background: rgba(251,191,36,.06); }
  .note.err { color: var(--red); border-color: #4d1f1f; background: rgba(248,113,113,.06); }
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
      <form id="cfgForm" autocomplete="off">
        <div class="field">
          <label for="port">Port</label>
          <input type="number" id="port" min="1" max="65535" />
          <div class="hint">Needs a <strong style="color:var(--yellow)">restart</strong> to take effect.</div>
        </div>
        <div class="field">
          <label for="bind">Bind address</label>
          <select id="bind">
            <option value="localhost">Localhost only (this PC)</option>
            <option value="network">Network (LAN access)</option>
          </select>
          <div class="hint">Effective host: <code id="bindHost">—</code></div>
        </div>
        <hr class="divider"/>
        <div class="toggle-row">
          <div class="ctl"><b>System tray icon</b><span>Next launch</span></div>
          <label class="switch"><input type="checkbox" id="sw_tray"/><span class="slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="ctl"><b>Hide console on start</b><span>Windows · next launch</span></div>
          <label class="switch"><input type="checkbox" id="sw_hideConsole"/><span class="slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="ctl"><b>Proxy pool enabled</b><span>Auto-rotate proxies · restart</span></div>
          <label class="switch"><input type="checkbox" id="sw_proxyEnabled"/><span class="slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="ctl"><b>Dashboard page</b><span>This page · immediate</span></div>
          <label class="switch"><input type="checkbox" id="sw_dashboard"/><span class="slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="ctl"><b>Open auth</b><span>Accept any API key · immediate</span></div>
          <label class="switch"><input type="checkbox" id="sw_openAuth"/><span class="slider"></span></label>
        </div>
        <hr class="divider"/>
        <button type="submit" id="save">Save settings</button>
        <div class="note" id="saveNote">
          Port, bind &amp; proxy pool need a <strong>restart</strong>; tray / hide apply on next launch.
          Edit <strong>config.json</strong> beside the server — or <strong>npm run config</strong> — if you prefer the CLI.
        </div>
      </form>
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

// ── Dirty tracking: once the user touches the form, stop overwriting it
//    with server values until a save succeeds (fixes the 2s-poll reset bug).
let dirty = false;
const formEls = [...document.querySelectorAll('#cfgForm input, #cfgForm select')];
function markDirty(){ dirty = true; }
formEls.forEach(el => { el.addEventListener('input', markDirty); el.addEventListener('change', markDirty); });

function fillForm(c){
  $('port').value = c.port;
  $('bind').value = c.bind;
  $('bindHost').textContent = c.host || '-';
  for (const k of ['tray','hideConsole','proxyEnabled','dashboard','openAuth'])
    $('sw_'+k).checked = !!c[k];
}

function setNote(kind, html){
  const el = $('saveNote');
  el.className = 'note ' + kind;
  el.innerHTML = html;
}

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

    if (!dirty) fillForm(c);

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

$('cfgForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const body = {
    port: parseInt($('port').value,10),
    bind: $('bind').value,
    tray: $('sw_tray').checked,
    hideConsole: $('sw_hideConsole').checked,
    proxyEnabled: $('sw_proxyEnabled').checked,
    dashboard: $('sw_dashboard').checked,
    openAuth: $('sw_openAuth').checked,
  };
  const btn = $('save');
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    const r = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok) throw new Error('bad response');
    dirty = false;             // re-sync form from server
    setNote(d.restartRequired ? 'warn' : 'ok', d.note || (d.restartRequired ? 'Saved — restart the server to apply.' : 'Saved.'));
    refresh();
  }catch(e){
    setNote('err', 'Save failed — is the server running? (status: '+e.message+')');
  }
  btn.disabled = false; btn.textContent = 'Save settings';
});

refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}
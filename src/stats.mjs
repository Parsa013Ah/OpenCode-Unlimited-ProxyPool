/**
 * stats.mjs — In-memory live counters (requests, tokens, latency)
 */
const startedAt = Date.now();

const stats = {
  requestsTotal: 0,
  requestsOk: 0,
  requestsErr: 0,
  requestsStream: 0,
  tokensIn: 0,
  tokensOut: 0,
  byModel: {},
  byUser: {},
  lastRequests: [], // ring buffer of recent
};

const MAX_RECENT = 40;

export function recordRequest({ user, model, stream, ok, tokensIn = 0, tokensOut = 0, ms = 0, error = null }) {
  stats.requestsTotal++;
  if (ok) stats.requestsOk++;
  else stats.requestsErr++;
  if (stream) stats.requestsStream++;
  stats.tokensIn += tokensIn || 0;
  stats.tokensOut += tokensOut || 0;

  if (model) {
    if (!stats.byModel[model]) stats.byModel[model] = { n: 0, tokensIn: 0, tokensOut: 0, err: 0 };
    stats.byModel[model].n++;
    stats.byModel[model].tokensIn += tokensIn || 0;
    stats.byModel[model].tokensOut += tokensOut || 0;
    if (!ok) stats.byModel[model].err++;
  }
  if (user) {
    if (!stats.byUser[user]) stats.byUser[user] = { n: 0, tokensIn: 0, tokensOut: 0 };
    stats.byUser[user].n++;
    stats.byUser[user].tokensIn += tokensIn || 0;
    stats.byUser[user].tokensOut += tokensOut || 0;
  }

  stats.lastRequests.unshift({
    ts: Date.now(),
    user: user || "-",
    model: model || "-",
    stream: !!stream,
    ok: !!ok,
    tokensIn: tokensIn || 0,
    tokensOut: tokensOut || 0,
    ms: ms || 0,
    error: error || null,
  });
  if (stats.lastRequests.length > MAX_RECENT) stats.lastRequests.length = MAX_RECENT;
}

export function getStats() {
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
  return {
    startedAt,
    uptimeSec,
    uptime: formatUptime(uptimeSec),
    requestsTotal: stats.requestsTotal,
    requestsOk: stats.requestsOk,
    requestsErr: stats.requestsErr,
    requestsStream: stats.requestsStream,
    tokensIn: stats.tokensIn,
    tokensOut: stats.tokensOut,
    tokensTotal: stats.tokensIn + stats.tokensOut,
    byModel: stats.byModel,
    byUser: stats.byUser,
    lastRequests: stats.lastRequests,
  };
}

function formatUptime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

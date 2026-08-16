import express from "express";
import crypto from "crypto";
import https from "https";
import fs from "fs";
import { initProxyPool, getProxyAgents, banProxy, banProxySoft, getPoolInfo } from "./proxy-pool.mjs";
import {
  printBanner, printEndpoints, printModels, printKeys, log, color, Spinner,
} from "./banner.mjs";
import { initTray } from "./tray.mjs";
import { loadConfig, getConfig, hostFromBind } from "./config.mjs";
import { recordRequest, getStats } from "./stats.mjs";
import { mountDashboard } from "./dashboard.mjs";

const app = express();
app.use(express.json({ limit: "10mb" }));

// CORS — needed for browser UIs (Hermes, Continue web, etc.)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version, OpenAI-Organization");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

const cfg = loadConfig();
// sync proxy pool switch into env before initProxyPool reads it
if (cfg.proxyEnabled === false) process.env.PROXY_ENABLED = "0";
else if (process.env.PROXY_ENABLED == null) process.env.PROXY_ENABLED = "1";
const PORT = cfg.port;
const HOST = hostFromBind(cfg.bind);
const OC_VERSION = "1.15.0";
const PROXY_VERSION = "14";

// ── API Keys ───────────────────────────────────────────────────────
const keysFile = process.env.KEYS_FILE || "./api-keys.json";
let apiKeys = {};
function loadKeys() {
  try { apiKeys = JSON.parse(fs.readFileSync(keysFile, "utf8")); } catch {}
  if (Object.keys(apiKeys).length === 0) {
    apiKeys = {
      admin: "oc-" + crypto.randomBytes(20).toString("hex"),
      "user-default": "oc-" + crypto.randomBytes(20).toString("hex"),
    };
    fs.writeFileSync(keysFile, JSON.stringify(apiKeys, null, 2));
    log("INIT", `generated new API keys → ${keysFile}`, "ok");
  }
}
loadKeys();

function auth(req) {
  const hdr = req.headers.authorization || req.headers["x-api-key"] || "";
  const tok = (hdr.startsWith("Bearer ") ? hdr.slice(7) : hdr).trim();
  if (!tok) {
    // allow missing key for local tools if openAuth
    if (cfg.openAuth !== false) return "anonymous";
    return null;
  }
  for (const [name, key] of Object.entries(apiKeys)) {
    if (tok === key) return name;
  }
  // Local convenience: accept any non-empty key (Hermes / Cursor often send dummy keys)
  if (cfg.openAuth !== false) return "local";
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────
function ocId(prefix) {
  const ts = Date.now().toString(16);
  const rnd = crypto.randomBytes(12).toString("base64url").slice(0, 16);
  return `${prefix}_${ts}${rnd}`;
}

// Free-tier models (fallback if upstream /models is unreachable)
const FALLBACK_MODELS = [
  "deepseek-v4-flash-free",
  "big-pickle",
  "mimo-v2.5-free",
  "hy3-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "laguna-s-2.1-free",
];

// Aliases → upstream id
const MODEL_ALIASES = {
  "minimax-m2.5-free": "minimax-m2.5",
  "qwen3.6-plus-free": "qwen3.6-plus",
  "nemotron-3-super-free": "nemotron-3-ultra-free",
  "deepseek-v4-flash": "deepseek-v4-flash-free",
};

let MODELS = [...FALLBACK_MODELS];
let ALL_UPSTREAM_MODELS = [];
let modelsLastFetch = 0;

async function refreshModels() {
  try {
    const res = await fetch("https://opencode.ai/zen/v1/models", {
      signal: AbortSignal.timeout(12000),
      headers: {
        Authorization: "Bearer public",
        "User-Agent": `opencode/${OC_VERSION} ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13`,
        "x-opencode-client": "cli",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const ids = (data.data || []).map((m) => m.id).filter(Boolean);
    if (!ids.length) throw new Error("empty list");
    ALL_UPSTREAM_MODELS = ids;
    const free = ids.filter(
      (id) =>
        id.endsWith("-free") ||
        id === "big-pickle" ||
        id.includes("free")
    );
    // Keep known free models first, then any new free ones from upstream
    const merged = [];
    for (const id of FALLBACK_MODELS) if (ids.includes(id) && !merged.includes(id)) merged.push(id);
    for (const id of free) if (!merged.includes(id)) merged.push(id);
    if (merged.length) MODELS = merged;
    modelsLastFetch = Date.now();
    log("MODELS", `synced ${MODELS.length} free / ${ids.length} total from upstream`, "ok");
  } catch (e) {
    log("MODELS", `upstream sync failed, using fallback (${MODELS.length}): ${e.message}`, "warn");
  }
}

function resolveModel(model) {
  if (!model) return model;
  if (MODEL_ALIASES[model]) return MODEL_ALIASES[model];
  return model;
}

function isAllowedModel(model) {
  if (!model) return false;
  if (MODELS.includes(model)) return true;
  if (ALL_UPSTREAM_MODELS.includes(model)) return true;
  if (model.endsWith("-free") || model === "big-pickle") return true;
  return false;
}

// Track sessions per user (rotate every 30 min)
const userSessions = {};
function getSession(user) {
  const now = Date.now();
  if (!userSessions[user] || now - userSessions[user].ts > 30 * 60 * 1000) {
    userSessions[user] = { id: ocId("ses"), ts: now };
  }
  return userSessions[user].id;
}

// ── Zen API transport ──────────────────────────────────────────────
function zenRequest(model, messages, stream, tools, tool_choice, sessionId, agent) {
  const reqBody = { model, messages, stream: !!stream };
  if (tools?.length) reqBody.tools = tools;
  if (tool_choice) reqBody.tool_choice = tool_choice;
  const body = JSON.stringify(reqBody);
  const requestId = ocId("msg");

  const options = {
    hostname: "opencode.ai",
    port: 443,
    path: "/zen/v1/chat/completions",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Authorization": "Bearer public",
      "User-Agent": `opencode/${OC_VERSION} ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13`,
      "x-opencode-client": "cli",
      "x-opencode-project": "global",
      "x-opencode-request": requestId,
      "x-opencode-session": sessionId,
    },
    timeout: 120000,
  };
  if (agent) {
    options.agent = agent;
    options.rejectUnauthorized = false;
  }

  return { body, options };
}

// Pipe Zen response to client (OpenAI format passthrough).
// Resolves with { kind: "ok" } once the response is streaming to the client,
// { kind: "rate_limit" } if Zen refused before anything was sent (retryable),
// or { kind: "error" | "timeout" } on upstream failure (retryable).
function pipeZenResponse(zenOpts, body, stream, res) {
  return new Promise((resolve) => {
    let finished = false;
    let req = null;
    const deadline = setTimeout(() => {
      log("ZEN", "upstream timeout", "warn");
      finish({ kind: "timeout", msg: "Upstream timeout" });
    }, zenOpts.timeout || 120000);
    const finish = (outcome) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      if (outcome.kind !== "ok") { try { req.destroy(); } catch {} }
      resolve(outcome);
    };

    req = https.request(zenOpts, (zenRes) => {
      let firstChunk = null;
      let headersSent = false;

      zenRes.on("data", (chunk) => {
        if (!firstChunk) {
          firstChunk = chunk;
          const str = chunk.toString().trim();

          // Edge/WAF block (HTML error page, e.g. openresty 400) → retryable
          if (zenRes.statusCode >= 400 && !str.startsWith("{")) {
            log("ZEN", `HTTP ${zenRes.statusCode} upstream/edge rejection`, "warn");
            zenRes.resume();
            finish({ kind: "error", msg: `Upstream HTTP ${zenRes.statusCode}` });
            return;
          }

          if (str.startsWith("{") && (str.includes("FreeUsageLimitError") || str.includes('"error"'))) {
            try {
              const parsed = JSON.parse(str);
              if (parsed.error || parsed.type === "error") {
                const errMsg = parsed.error?.message || parsed.message || "Rate limit exceeded";
                log("ZEN", `rate limited: ${errMsg}`, "warn");
                zenRes.resume();
                finish({ kind: "rate_limit", msg: errMsg });
                return;
              }
            } catch {}
          }

          headersSent = true;
          if (stream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              "Connection": "keep-alive",
              "X-Accel-Buffering": "no",
              "Transfer-Encoding": "chunked",
            });
            res.flushHeaders();
          } else {
            res.writeHead(zenRes.statusCode, { "Content-Type": "application/json" });
          }
          res.write(firstChunk);
          if (res.flush) res.flush();
          finish({ kind: "ok" });
          return;
        }
        if (headersSent) {
          res.write(chunk);
          if (res.flush) res.flush();
        }
      });

      zenRes.on("end", () => {
        if (!headersSent && !firstChunk) {
          log("ZEN", "empty response from upstream", "error");
          finish({ kind: "error", msg: "Empty response from upstream" });
          return;
        }
        if (headersSent) res.end();
      });
    });

    req.on("error", (e) => {
      log("ZEN", e.message, "error");
      finish({ kind: "error", msg: e.message });
    });

    req.on("timeout", () => {
      req.destroy();
      log("ZEN", "upstream timeout", "warn");
      finish({ kind: "timeout", msg: "Upstream timeout" });
    });

    req.write(body);
    req.end();
  });
}

// Collect full Zen response (non-streaming) and return an outcome object
function zenRequestFull(zenOpts, body) {
  return new Promise((resolve) => {
    let req = null;
    let finished = false;
    const deadline = setTimeout(() => {
      log("ZEN", "upstream timeout", "warn");
      finish({ kind: "timeout", msg: "Upstream timeout" });
    }, zenOpts.timeout || 120000);
    const finish = (outcome) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      try { req.destroy(); } catch {}
      resolve(outcome);
    };

    req = https.request(zenOpts, (zenRes) => {
      const chunks = [];
      zenRes.on("data", (c) => chunks.push(c));
      zenRes.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let data = null;
        try { data = JSON.parse(raw); } catch {}
        if (zenRes.statusCode === 429 || data?.error) {
          const errMsg = data?.error?.message || "Rate limit exceeded";
          finish({ kind: "rate_limit", msg: errMsg, status: zenRes.statusCode, data, raw });
          return;
        }
        if (!data?.choices) {
          finish({ kind: "error", msg: "Invalid upstream response", status: zenRes.statusCode, data, raw });
          return;
        }
        finish({ kind: "ok", status: zenRes.statusCode, data, raw });
      });
    });
    req.on("error", (e) => finish({ kind: "error", msg: e.message }));
    req.on("timeout", () => { req.destroy(); finish({ kind: "timeout", msg: "Upstream timeout" }); });
    req.write(body);
    req.end();
  });
}

// ── Anthropic Messages → OpenAI conversion ─────────────────────────
function anthropicToOpenAI(body) {
  const messages = [];
  if (body.system) {
    const sys = typeof body.system === "string" ? body.system
      : Array.isArray(body.system) ? body.system.map(b => b.text || "").join("\n") : "";
    if (sys) messages.push({ role: "system", content: sys });
  }
  for (const msg of body.messages || []) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("\n");
      // tool_use blocks → assistant tool_calls
      const toolUses = msg.content.filter(b => b.type === "tool_use");
      if (toolUses.length && msg.role === "assistant") {
        messages.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUses.map(t => ({
            id: t.id,
            type: "function",
            function: { name: t.name, arguments: JSON.stringify(t.input || {}) },
          })),
        });
      } else if (msg.content.some(b => b.type === "tool_result")) {
        for (const b of msg.content.filter(b => b.type === "tool_result")) {
          const resultText = typeof b.content === "string" ? b.content
            : Array.isArray(b.content) ? b.content.map(c => c.text || "").join("\n") : "";
          messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: resultText });
        }
      } else {
        messages.push({ role: msg.role, content: text });
      }
    }
  }

  const tools = (body.tools || []).map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.input_schema || {},
    },
  }));

  return { messages, tools: tools.length ? tools : undefined };
}

// OpenAI response → Anthropic Messages format
function openAIToAnthropic(oaiResp, model, inputTokens) {
  const choice = oaiResp.choices?.[0];
  if (!choice) {
    return {
      id: ocId("msg"),
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "" }],
      model,
      stop_reason: "end_turn",
      usage: { input_tokens: inputTokens || 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
  }

  const content = [];
  if (choice.message?.content) {
    content.push({ type: "text", text: choice.message.content });
  }
  if (choice.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input = {};
      try { input = JSON.parse(tc.function.arguments); } catch {}
      content.push({
        type: "tool_use",
        id: tc.id || ocId("toolu"),
        name: tc.function.name,
        input,
      });
    }
  }
  if (!content.length) content.push({ type: "text", text: "" });

  let stopReason = "end_turn";
  if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
  else if (choice.finish_reason === "length") stopReason = "max_tokens";
  else if (choice.finish_reason === "stop") stopReason = "end_turn";

  return {
    id: ocId("msg"),
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: stopReason,
    usage: {
      input_tokens: oaiResp.usage?.prompt_tokens || inputTokens || 0,
      output_tokens: oaiResp.usage?.completion_tokens || 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

// Stream OpenAI SSE → Anthropic SSE. Resolves with an outcome object.
function pipeZenAsAnthropic(zenOpts, body, model, res, inputTokens) {
  return new Promise((resolve) => {
    let finished = false;
    let req = null;
    const deadline = setTimeout(() => {
      log("ZEN", "upstream timeout", "warn");
      finish({ kind: "timeout", msg: "Upstream timeout" });
    }, zenOpts.timeout || 120000);
    const finish = (outcome) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      if (outcome.kind !== "ok") { try { req.destroy(); } catch {} }
      resolve(outcome);
    };
    const msgId = ocId("msg");

    req = https.request(zenOpts, (zenRes) => {
      let headersSent = false;
      let buffer = "";
      let outputTokens = 0;
      let contentIdx = 0;
      let toolIdx = -1;
      let firstChunkHandled = false;

      function sendSSE(event, data) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (res.flush) res.flush();
      }

      function sendHeaders() {
        if (headersSent) return;
        headersSent = true;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();

        sendSSE("message_start", {
          type: "message_start",
          message: {
            id: msgId, type: "message", role: "assistant", content: [],
            model, stop_reason: null,
            usage: { input_tokens: inputTokens || 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        });
        finish({ kind: "ok" });
      }

      zenRes.on("data", (chunk) => {
        const str = chunk.toString();

        // Check for errors on first chunk
        if (!firstChunkHandled) {
          firstChunkHandled = true;
          const trimmed = str.trim();

          // Edge/WAF block (HTML error page, e.g. openresty 400) → retryable
          if (zenRes.statusCode >= 400 && !trimmed.startsWith("{")) {
            log("ZEN", `HTTP ${zenRes.statusCode} upstream/edge rejection`, "warn");
            zenRes.resume();
            finish({ kind: "error", msg: `Upstream HTTP ${zenRes.statusCode}` });
            return;
          }

          if (trimmed.startsWith("{") && (trimmed.includes("FreeUsageLimitError") || trimmed.includes('"error"'))) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.error || parsed.type === "error") {
                const errMsg = parsed.error?.message || parsed.message || "Rate limit";
                log("ZEN", `rate limited: ${errMsg}`, "warn");
                zenRes.resume();
                finish({ kind: "rate_limit", msg: errMsg });
                return;
              }
            } catch {}
          }
        }

        buffer += str;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          let parsed;
          try { parsed = JSON.parse(payload); } catch { continue; }
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          sendHeaders();

          // Text content
          if (delta.content) {
            if (contentIdx === 0 && toolIdx === -1) {
              sendSSE("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
              contentIdx = 1;
            }
            sendSSE("content_block_delta", {
              type: "content_block_delta", index: 0,
              delta: { type: "text_delta", text: delta.content },
            });
            outputTokens += Math.ceil(delta.content.length / 4);
          }

          // Tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (idx > toolIdx) {
                // Close previous text block if open
                if (toolIdx === -1 && contentIdx > 0) {
                  sendSSE("content_block_stop", { type: "content_block_stop", index: 0 });
                }
                toolIdx = idx;
                const blockIdx = contentIdx > 0 ? idx + 1 : idx;
                sendSSE("content_block_start", {
                  type: "content_block_start", index: blockIdx,
                  content_block: { type: "tool_use", id: tc.id || ocId("toolu"), name: tc.function?.name || "" },
                });
              }
              if (tc.function?.arguments) {
                const blockIdx = contentIdx > 0 ? idx + 1 : idx;
                sendSSE("content_block_delta", {
                  type: "content_block_delta", index: blockIdx,
                  delta: { type: "input_json_delta", partial_json: tc.function.arguments },
                });
                outputTokens += Math.ceil(tc.function.arguments.length / 4);
              }
            }
          }

          // Finish
          if (parsed.choices?.[0]?.finish_reason) {
            const fr = parsed.choices[0].finish_reason;
            // Close open blocks
            const totalBlocks = (contentIdx > 0 ? 1 : 0) + (toolIdx >= 0 ? toolIdx + 1 : 0);
            for (let i = 0; i < totalBlocks; i++) {
              sendSSE("content_block_stop", { type: "content_block_stop", index: i });
            }

            let stopReason = "end_turn";
            if (fr === "tool_calls") stopReason = "tool_use";
            else if (fr === "length") stopReason = "max_tokens";

            sendSSE("message_delta", {
              type: "message_delta",
              delta: { stop_reason: stopReason },
              usage: { output_tokens: outputTokens },
            });
            sendSSE("message_stop", { type: "message_stop" });
          }
        }
      });

      zenRes.on("end", () => {
        if (!headersSent) {
          finish({ kind: "error", msg: "Empty response from upstream" });
          return;
        }
        res.end();
      });
    });

    req.on("error", (e) => {
      log("ZEN", e.message, "error");
      finish({ kind: "error", msg: e.message });
    });

    req.on("timeout", () => {
      req.destroy();
      finish({ kind: "timeout", msg: "Upstream timeout" });
    });

    req.write(body);
    req.end();
  });
}

// Unified runner: try direct first, then fall back to proxies on rate
// limit / upstream failure. Each proxy that is rate limited is banned and
// the next one is tried.
async function sendZenRequest({ model, messages, stream, tools, tool_choice, sessionId, res, format = "openai", inputTokens = 0 }) {
  const agents = [null, ...getProxyAgents()];
  let lastMsg = "All upstream attempts failed";
  let hadRateLimit = false;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const label = agent ? `proxy ${i}/${agents.length - 1}` : "direct";
    const { body, options } = zenRequest(model, messages, stream, tools, tool_choice, sessionId, agent);
    log("TRY", `${i + 1}/${agents.length} via ${label}`, "info");

    let outcome;
    if (format === "anthropic" && stream) {
      outcome = await pipeZenAsAnthropic(options, body, model, res, inputTokens);
    } else if (format === "anthropic") {
      outcome = await zenRequestFull(options, body);
    } else {
      outcome = await pipeZenResponse(options, body, stream, res);
    }

    if (outcome.kind === "ok") {
      if (format === "anthropic" && !stream) {
        res.json(openAIToAnthropic(outcome.data, model, inputTokens));
      }
      const tin = outcome.data?.usage?.prompt_tokens || inputTokens || 0;
      const tout = outcome.data?.usage?.completion_tokens || 0;
      recordRequest({
        user: res.locals?.user, model, stream, ok: true,
        tokensIn: tin, tokensOut: tout, ms: Date.now() - (res.locals?.t0 || Date.now()),
      });
      return;
    }

    lastMsg = outcome.msg || "Upstream error";
    if (outcome.kind === "rate_limit") {
      hadRateLimit = true;
      log("LIMIT", `via ${label}: ${outcome.msg}`, "warn");
      if (agent) banProxy(agent); // long cooldown
    } else {
      log("FAIL", `via ${label}: ${outcome.msg}`, "error");
      if (agent) banProxySoft(agent); // short cooldown for transient errors
    }
  }

  const code = hadRateLimit ? 429 : 502;
  const type = hadRateLimit ? "rate_limit_error" : "upstream_error";
  const message = hadRateLimit ? `${lastMsg} (free model rate limit)` : lastMsg;

  recordRequest({
    user: res.locals?.user, model, stream, ok: false,
    tokensIn: inputTokens || 0, tokensOut: 0,
    ms: Date.now() - (res.locals?.t0 || Date.now()),
    error: message,
  });

  if (format === "anthropic") {
    res.status(code).json({ type: "error", error: { type, message } });
  } else {
    res.status(code).json({
      error: { message, type, code: hadRateLimit ? "rate_limit_exceeded" : undefined },
    });
  }
}

// ── Routes: OpenAI format ──────────────────────────────────────────
app.get("/v1/models", (_req, res) => {
  // Also accept ?all=1 for full upstream catalogue
  const all = String(_req.query.all || "") === "1";
  const list = all && ALL_UPSTREAM_MODELS.length ? ALL_UPSTREAM_MODELS : MODELS;
  res.json({
    object: "list",
    data: list.map((id) => ({
      id,
      object: "model",
      created: Math.floor((modelsLastFetch || Date.now()) / 1000),
      owned_by: id.endsWith("-free") || id === "big-pickle" ? "opencode-free" : "opencode",
    })),
  });
});

app.post("/v1/chat/completions", (req, res) => {
  const user = auth(req);
  if (!user) return res.status(401).json({ error: { message: "Invalid API key" } });

  let { model, messages, stream, tools, tool_choice } = req.body;
  model = resolveModel(model);
  if (!isAllowedModel(model)) {
    return res.status(400).json({
      error: {
        message: `Unknown model: ${req.body?.model}. Free models: ${MODELS.join(", ")}. Tip: GET /v1/models`,
      },
    });
  }

  const sessionId = getSession(user);
  const msgSummary = (messages || []).map(m => ({ role: m.role, len: (typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")).length }));
  log("OAI", `${user} · ${model} · ${stream ? "stream" : "sync"} · msgs ${JSON.stringify(msgSummary)}`, "info");
  res.locals.user = user;
  res.locals.t0 = Date.now();

  sendZenRequest({ model, messages, stream, tools, tool_choice, sessionId, res, format: "openai" });
});

// ── Routes: Anthropic Messages format ──────────────────────────────
app.post("/v1/messages", (req, res) => {
  const user = auth(req);
  if (!user) {
    return res.status(401).json({ type: "error", error: { type: "authentication_error", message: "Invalid API key" } });
  }

  let { model, stream } = req.body;
  model = resolveModel(model);
  if (!isAllowedModel(model)) {
    return res.status(400).json({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: `Unknown model: ${req.body?.model}. Free models: ${MODELS.join(", ")}`,
      },
    });
  }

  const sessionId = getSession(user);
  const { messages, tools } = anthropicToOpenAI(req.body);
  const inputTokens = JSON.stringify(messages).length / 4 | 0;

  log("ANT", `${user} · ${model} · ${stream ? "stream" : "sync"} · msgs ${messages.length}`, "info");
  res.locals.user = user;
  res.locals.t0 = Date.now();

  sendZenRequest({ model, messages, stream, tools, tool_choice: undefined, sessionId, res, format: "anthropic", inputTokens });
});

// ── Proxy pool status ───────────────────────────────────────────────
app.get("/proxies", (_req, res) => res.json(getPoolInfo()));

// ── Health ──────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({
  status: "ok", version: `v${PROXY_VERSION}`, models: MODELS.length, modelIds: MODELS,
  proxy: getPoolInfo(),
  stats: getStats(),
  config: { port: PORT, bind: cfg.bind, host: HOST },
  endpoints: ["/", "/v1/chat/completions", "/v1/messages", "/v1/models", "/proxies", "/api/stats"],
}));

// ── Start ──────────────────────────────────────────────────────────
printBanner(PROXY_VERSION, PORT);
printEndpoints(PORT);
printModels(MODELS);
printKeys(apiKeys);

const bootSpin = new Spinner("warming proxy pool…");
bootSpin.start();

initProxyPool();

const server = app.listen(PORT, HOST, async () => {
  bootSpin.succeed(
    color.success("server online") +
    color.dim(`  ·  ${HOST}:${PORT}`) +
    color.dim(`  ·  bind=${cfg.bind}`)
  );
  console.log(color.dim("  ────────────────────────────────────────────────────────"));
  console.log(`  ${color.dim("dashboard:")} ${color.bCyan(`http://127.0.0.1:${PORT}/`)}`);
  console.log(`  ${color.dim("openai:")}    ${color.bCyan(`http://127.0.0.1:${PORT}/v1`)}`);
  console.log(`  ${color.dim("health:")}    ${color.bCyan(`http://127.0.0.1:${PORT}/health`)}`);
  console.log(`  ${color.dim("models:")}    ${color.bCyan(`http://127.0.0.1:${PORT}/v1/models`)}`);
  console.log("");
  console.log(`  ${color.warn("Hermes / Cursor base URL:")} ${color.bold(`http://127.0.0.1:${PORT}/v1`)}`);
  console.log(`  ${color.dim("API key: any text is OK (openAuth)")}`);
  console.log("");
  if (cfg.tray) {
    if (cfg.hideConsole) process.env.PROXY_HIDE_CONSOLE = "1";
    process.env.PROXY_TRAY = "1";
    await initTray({ port: PORT, version: PROXY_VERSION });
  } else {
    log("TRAY", "off (enable in config.json or dashboard)", "info");
  }
});

server.on("error", (err) => {
  bootSpin.fail(`listen failed: ${err.message}`);
  if (err.code === "EADDRINUSE") {
    log("HTTP", `port ${PORT} already in use — change port in config.json or: npm run config`, "error");
  } else {
    log("HTTP", err.message, "error");
  }
  process.exit(1);
});

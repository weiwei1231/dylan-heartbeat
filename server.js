require("dotenv").config({ quiet: true });

const Fastify = require("fastify");
const fs = require("fs-extra");
const path = require("path");
const {
  PROJECT_DIR,
  ensureDataDir,
  runtimeDirectory,
  runtimeFile,
  writeJsonAtomicSync
} = require("./runtime_paths");
const { isSpecialEventContent } = require("./special_events");
const { decideRequestAccess } = require("./network_access");
const { readEnvValue, readEnvBoolean } = require("./env_config");
const {
  formatDateTimeInTimeZone,
  resolveTimeZone,
  zonedWallTimeToDate
} = require("./time_utils");
const { kelivoCompat } = require("./kelivo_compat");
const { getInjectedMemoryPrompt, extractMemoryAsync } = require("./memory_system");
const { registerChatRoutes, injectSystemPrompt, buildUpstreamBody } = require("./chat_routes");
const { hasTools, getToolDeclarations, handleToolCalls } = require("./tool_runner");
require("./garden_tools").initGardenTools();
const { runToolLoop } = require("./tool_loop");



const DEFAULT_BODY_LIMIT_MB = 50;

function readBodyLimitBytes() {
  const configured = Number(readEnvValue("REQUEST_BODY_LIMIT_MB"));
  const mb = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_BODY_LIMIT_MB;
  return Math.floor(mb * 1024 * 1024);
}

const app = Fastify({
  logger: true,
  bodyLimit: readBodyLimitBytes()
});

app.register(require("@fastify/formbody"));

const PORT = Number(readEnvValue("PORT")) || 3000;
const TIME_ZONE = resolveTimeZone();
const IS_RAILWAY_RUNTIME = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_PROJECT_ID ||
  process.env.RAILWAY_SERVICE_ID
);
const DATA_DIR = ensureDataDir();
const TIMELINE_FILE = runtimeFile("enhanced_messages.json");
const TIMESTAMP_DB_FILE = runtimeFile("message_timestamps.json");
const DEFAULT_RESTART_COMMAND = "pm2 restart gateway wake-up --update-env";

function readBooleanEnv(key, fallback = false) {
  const raw = String(readEnvValue(key)).trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function configuredModelName() {
  return String(readEnvValue("MODEL_NAME") || "gateway-model").trim() || "gateway-model";
}

function shouldForwardMultimodalContent() {
  const mode = (readEnvValue("MULTIMODAL_MODE") || "passthrough").trim().toLowerCase();
  return !["text", "plain", "placeholder", "false", "off", "0"].includes(mode);
}

function isDataImageUrl(value) {
  return typeof value === "string" && /^data:image\//i.test(value);
}

function isImageContentPart(part) {
  if (!part || typeof part !== "object") return false;
  if (part.image_url) return true;
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  return type.includes("image");
}

function isFileContentPart(part) {
  if (!part || typeof part !== "object") return false;
  if (part.file) return true;
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  return type.includes("file");
}

function getTextFromContentPart(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  if (type === "text" || type === "input_text") return part.text || part.content || "";
  if (typeof part.text === "string") return part.text;
  return "";
}

function normalizeContentToText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    const parts = content.map(part => {
      const text = getTextFromContentPart(part).trim();
      if (text) return text;
      if (isImageContentPart(part)) return "[图片]";
      if (isFileContentPart(part)) return "[文件]";
      return "";
    }).filter(Boolean);
    return parts.join("\n");
  }
  if (isImageContentPart(content)) return "[图片]";
  if (isFileContentPart(content)) return "[文件]";
  return "[非文本内容]";
}

function normalizeMessageForTimeline(msg) {
  return { ...msg, content: normalizeContentToText(msg.content) };
}

function prepareMessageForLLM(msg) {
  if (msg.role === "assistant" && msg.tool_calls) return msg;
  if (msg.role === "tool") return msg;
  if (msg.role === "system") return { ...msg, content: normalizeContentToText(msg.content) };
  if (typeof msg.content === "string") return msg;
  if (Array.isArray(msg.content) && shouldForwardMultimodalContent()) return msg;
  const textContent = normalizeContentToText(msg.content);
  if (!textContent) return null;
  return { ...msg, content: textContent };
}

function summarizeMessageForLog(msg) {
  const parts = Array.isArray(msg?.content) ? msg.content : [msg?.content];
  const textChars = parts.reduce((sum, part) => sum + getTextFromContentPart(part).length, 0);
  return {
    role: msg?.role || "",
    content_type: Array.isArray(msg?.content) ? "multimodal" : typeof msg?.content,
    text_chars: textChars || normalizeContentToText(msg?.content).length,
    image_parts: parts.filter(isImageContentPart).length,
    file_parts: parts.filter(isFileContentPart).length,
    tool_calls: Array.isArray(msg?.tool_calls) ? msg.tool_calls.length : 0
  };
}

function summarizeMessagesForLog(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  const roles = {};
  let imageParts = 0, fileParts = 0, textChars = 0;
  for (const msg of list) {
    const item = summarizeMessageForLog(msg);
    roles[item.role] = (roles[item.role] || 0) + 1;
    imageParts += item.image_parts;
    fileParts += item.file_parts;
    textChars += item.text_chars;
  }
  return { total: list.length, roles, text_chars: textChars, image_parts: imageParts, file_parts: fileParts };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function loadTimeline() {
  if (!fs.existsSync(TIMELINE_FILE)) return [];
  try { return fs.readJsonSync(TIMELINE_FILE); } catch { return []; }
}

function saveTimeline(messages) {
  const sp = messages.find(m => m.role === "system");
  const nonSP = messages.filter(m => m.role !== "system");
  const trimmed = nonSP.slice(-49);
  const final = sp ? [sp, ...trimmed] : trimmed;
  writeJsonAtomicSync(TIMELINE_FILE, final);
}

function parseTimestampLabel(value) {
  const text = String(value || "");
  const match = text.match(/（?\s*(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[ T]?)(\d{1,2})[:：](\d{2})/);
  if (!match) return null;
  const [, yyyy, , month, day, hour, minute] = match;
  return zonedWallTimeToDate({ year: yyyy, month, day, hour, minute }, TIME_ZONE);
}

function stripLeadingTimestamp(content) {
  return String(content || "").replace(/^（?\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]?)\d{1,2}[:：]\d{2}[）\s]*/, "").trim();
}

function extractTimestamp(content) { return parseTimestampLabel(content); }

function loadTimestampDB() {
  if (!fs.existsSync(TIMESTAMP_DB_FILE)) return {};
  try { return fs.readJsonSync(TIMESTAMP_DB_FILE); } catch { return {}; }
}

function saveTimestampDB(db) { writeJsonAtomicSync(TIMESTAMP_DB_FILE, db); }

function makeFingerprint(msg) {
  const raw = normalizeContentToText(msg.content);
  return `${msg.role}::${raw.trim().slice(0, 150)}`;
}

function makeFingerprintStripped(msg) {
  const raw = normalizeContentToText(msg.content);
  return `${msg.role}::${stripLeadingTimestamp(raw).slice(0, 150)}`;
}

function extractTimestampWithMemory(msg, tsDB) {
  const fromContent = extractTimestamp(normalizeContentToText(msg.content));
  if (fromContent) return fromContent;
  const fp = makeFingerprint(msg);
  if (tsDB[fp]) return new Date(tsDB[fp]);
  const fpStripped = makeFingerprintStripped(msg);
  if (tsDB[fpStripped]) return new Date(tsDB[fpStripped]);
  return null;
}

function isSpecialEvent(msg) {
  if (msg.role !== "assistant") return false;
  return isSpecialEventContent(normalizeContentToText(msg.content));
}

function isRealMessageForTimeline(msg) {
  if (msg.role === "system") return false;
  if (msg.tool_calls) return false;
  if (isSpecialEvent(msg)) return false;
  const contentText = normalizeContentToText(msg.content);
  if (msg.role === "user" && contentText.trim().startsWith("<system>")) return false;
  return msg.role === "user" || msg.role === "assistant";
}

function buildTimeline(kelivoMessages, tsDB) {
  const oldTimeline = loadTimeline();
  const newSystemMessages = kelivoMessages.filter(msg => msg.role === "system").map(normalizeMessageForTimeline);
  const latestSP = newSystemMessages.length > 0 ? newSystemMessages[newSystemMessages.length - 1] : null;
  const oldSP = oldTimeline.find(msg => msg.role === "system");
  const newRealMessages = kelivoMessages.filter(isRealMessageForTimeline).map(normalizeMessageForTimeline);
  const oldSpecialEvents = oldTimeline.filter(isSpecialEvent).sort((a, b) => {
    const timeA = extractTimestampWithMemory(a, tsDB);
    const timeB = extractTimestampWithMemory(b, tsDB);
    if (timeA && timeB) return timeA - timeB;
    return 0;
  });

  const merged = [...newRealMessages];
  for (const event of oldSpecialEvents) {
    const eventTime = extractTimestampWithMemory(event, tsDB);
    if (!eventTime) { merged.push(event); continue; }
    let inserted = false;
    for (let i = 0; i < merged.length; i++) {
      const msgTime = extractTimestampWithMemory(merged[i], tsDB);
      if (msgTime && msgTime >= eventTime) { merged.splice(i, 0, event); inserted = true; break; }
    }
    if (!inserted) merged.push(event);
  }

  const seen = new Set();
  const unique = merged.filter(msg => {
    const key = JSON.stringify({ role: msg.role, content: msg.content });
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  const result = [];
  if (latestSP) result.push({ ...latestSP, position: 0 });
  else if (oldSP) result.push({ ...oldSP, position: 0 });

  let realPos = 1;
  const finalMessages = [];
  let pendingSpecial = [];
  for (const msg of unique) {
    if (isSpecialEvent(msg)) { pendingSpecial.push(msg); }
    else {
      if (pendingSpecial.length > 0) {
        const prevRealPos = realPos - 1;
        const step = 1 / (pendingSpecial.length + 1);
        for (let i = 0; i < pendingSpecial.length; i++) {
          finalMessages.push({ ...pendingSpecial[i], position: parseFloat((prevRealPos + step * (i + 1)).toFixed(4)) });
        }
        pendingSpecial = [];
      }
      finalMessages.push({ ...msg, position: realPos }); realPos++;
    }
  }
  if (pendingSpecial.length > 0) {
    const lastRealPos = realPos - 1;
    for (let i = 0; i < pendingSpecial.length; i++) {
      finalMessages.push({ ...pendingSpecial[i], position: parseFloat((lastRealPos + 0.3 * (i + 1)).toFixed(4)) });
    }
  }
  result.push(...finalMessages);
  return result;
}

function appendSpecialEvent(content) {
  const timeline = loadTimeline();
  let maxPos = 0;
  for (const msg of timeline) { if (msg.position && msg.position > maxPos) maxPos = msg.position; }
  const newEvent = { role: "assistant", content, position: maxPos + 0.5 };
  timeline.push(newEvent);
  saveTimeline(timeline);
  console.log(`\n已记录特殊事件 (position ${newEvent.position}, chars ${normalizeContentToText(content).length})\n`);
}

function stripPosition(messages) { return messages.map(({ position, ...rest }) => rest); }

let wakeUpLastHeartbeat = null;

const PRESETS_FILE = runtimeFile("presets.json");
const ENV_FILE = path.join(PROJECT_DIR, ".env");
const PREFERRED_ENV_ORDER = ["TARGET_API_URL","TARGET_API_KEY","GATEWAY_API_KEY","MODEL_NAME","MEMORY_MODEL_NAME","BARK_KEY","CUSTOM_ICON_URL","ALLOW_PUBLIC_API","PUSH_PROVIDER","NTFY_SERVER_URL","NTFY_TOPIC","NTFY_TOKEN","NTFY_PRIORITY","NTFY_TAGS","DIARY_ENABLED","DIARY_DIR","DATA_DIR","PUSH_TIMEOUT_MS","WAKE_UPSTREAM_TIMEOUT_MS","REQUEST_BODY_LIMIT_MB","MULTIMODAL_MODE","DAY_WAKE_AFTER_MINUTES","NIGHT_WAKE_AFTER_MINUTES","DAY_CHECK_INTERVAL_MINUTES","NIGHT_CHECK_INTERVAL_MINUTES","WAKE_DAY_START_HOUR","WAKE_DAY_END_HOUR","WEATHER_ENABLED","WEATHER_LOCATION_NAME","WEATHER_LAT","WEATHER_LON","WEATHER_UNITS","PORT","GATEWAY_BASE_URL","TIME_ZONE","RESTART_COMMAND","ADMIN_USER","ADMIN_PASSWORD"];

function loadPresets() { if (!fs.existsSync(PRESETS_FILE)) return []; try { return fs.readJsonSync(PRESETS_FILE); } catch { return []; } }
function savePresets(presets) { writeJsonAtomicSync(PRESETS_FILE, presets); }

function wantsJsonResponse(req) {
  const contentType = req.headers["content-type"] || "";
  const accept = req.headers.accept || "";
  return contentType.includes("application/json") || accept.includes("application/json");
}

function loadEnvFileObject() {
  const result = {};
  try {
    const envContent = fs.readFileSync(ENV_FILE, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      result[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
    }
  } catch {}
  return result;
}

function serializeEnvValue(value) { return String(value ?? "").replace(/\r?\n/g, "\\n"); }

function writeEnvUpdates(updates) {
  const merged = { ...loadEnvFileObject(), ...updates };
  const orderedKeys = [...PREFERRED_ENV_ORDER.filter(key => Object.prototype.hasOwnProperty.call(merged, key)), ...Object.keys(merged).filter(key => !PREFERRED_ENV_ORDER.includes(key)).sort()];
  fs.writeFileSync(ENV_FILE, orderedKeys.map(key => `${key}=${serializeEnvValue(merged[key])}`).join("\n") + "\n");
}

function readRestartCommand() { return readEnvValue("RESTART_COMMAND") || DEFAULT_RESTART_COMMAND; }

app.addHook("onRequest", (req, reply, done) => {
  const requestPath = req.url.split("?")[0];
  const ip = String(req.ip || req.connection.remoteAddress || "");
  const headerKey = String(req.headers["x-gateway-api-key"] || req.headers["x-api-key"] || "").trim();
  const access = decideRequestAccess({ path: requestPath, ip, isRailway: IS_RAILWAY_RUNTIME, allowPublicApi: readBooleanEnv("ALLOW_PUBLIC_API", false), configuredKey: readEnvValue("GATEWAY_API_KEY"), authorization: req.headers.authorization, headerKey });
  if (access.allow) return done();
  if (access.authRejected) { console.warn(JSON.stringify({ event: "gateway_auth_rejected", path: requestPath, auth_source: access.authSource || "missing" })); }
  reply.code(access.status || 403).send(access.status === 401 ? { error: access.error } : access.error);
});

// ========================
// kc 前端路由
// ========================
registerChatRoutes(app);

app.get("/healthz", async () => ({ status: "ok" }));

app.get("/v1/models", async (req, reply) => {
  reply.send({ object: "list", data: [{ id: configuredModelName(), object: "model", created: 0, owned_by: "gateway" }] });
});

// ========================
// Chat Completions
// ========================
app.post("/v1/chat/completions", async (req, reply) => {
  try {
    const body = req.body;
    console.log(JSON.stringify({ event: "kelivo_request", model: body?.model || "", stream: body?.stream === true, messages: summarizeMessagesForLog(body?.messages || []) }));

    const kelivoMessages = body.messages || [];
    const oldTimeline = loadTimeline();
    const tsDB = loadTimestampDB();
    let tsDBDirty = false;
    for (const msg of kelivoMessages) {
      if (msg.role === "system" || msg.role === "tool") continue;
      const ts = extractTimestamp(normalizeContentToText(msg.content));
      if (!ts) continue;
      const fp = makeFingerprint(msg);
      const fpStripped = makeFingerprintStripped(msg);
      if (!tsDB[fp]) { tsDB[fp] = ts.toISOString(); tsDBDirty = true; }
      if (!tsDB[fpStripped]) { tsDB[fpStripped] = ts.toISOString(); tsDBDirty = true; }
    }
    if (tsDBDirty) saveTimestampDB(tsDB);

    const finalTimeline = buildTimeline(kelivoMessages, tsDB);
    saveTimeline(finalTimeline);

    const llmMessages = kelivoMessages.map(prepareMessageForLLM).filter(Boolean);

    const oldEvents = stripPosition(oldTimeline.filter(isSpecialEvent).sort((a, b) => {
      const timeA = extractTimestampWithMemory(a, tsDB);
      const timeB = extractTimestampWithMemory(b, tsDB);
      if (timeA && timeB) return timeA - timeB; return 0;
    }));

    console.log("本次注入的特殊事件数量:", oldEvents.length);

    for (const event of oldEvents) {
      const eventTime = extractTimestampWithMemory(event, tsDB);
      if (!eventTime) { llmMessages.push(event); continue; }
      let inserted = false;
      for (let i = 0; i < llmMessages.length; i++) {
        const msgTime = extractTimestampWithMemory(llmMessages[i], tsDB);
        if (msgTime && msgTime >= eventTime) { llmMessages.splice(i, 0, event); inserted = true; break; }
      }
      if (!inserted) llmMessages.push(event);
    }

    // ===== System Prompt 注入：始终使用后端管理的 prompt =====
    injectSystemPrompt(llmMessages);

    // ===== 记忆注入层 =====
    const memoryContext = getInjectedMemoryPrompt();
    if (memoryContext) {
      const systemMsgIndex = llmMessages.findIndex(m => m.role === "system");
      if (systemMsgIndex !== -1) {
        llmMessages[systemMsgIndex] = { ...llmMessages[systemMsgIndex], content: normalizeContentToText(llmMessages[systemMsgIndex].content) + memoryContext };
      } else {
        llmMessages.unshift({ role: "system", content: memoryContext });
      }
      console.log("[Memory] 已注入记忆上下文");
    }

    console.log(JSON.stringify({ event: "llm_forward_summary", messages: summarizeMessagesForLog(llmMessages) }));

    // ---- 自动修复不完整的 tool 调用 ----
    const removeSet = new Set();
    for (let i = 0; i < llmMessages.length; i++) {
      const msg = llmMessages[i];
      if (msg.role !== "assistant" || !msg.tool_calls) continue;
      const expectedIds = msg.tool_calls.map(tc => tc.id);
      const followingTools = [];
      for (let j = i + 1; j < llmMessages.length; j++) { if (llmMessages[j].role === "tool") followingTools.push(llmMessages[j]); else break; }
      if (!expectedIds.every(id => followingTools.map(t => t.tool_call_id).includes(id))) {
        removeSet.add(i);
        for (let j = i + 1; j < llmMessages.length; j++) { if (llmMessages[j].role === "tool") removeSet.add(j); else break; }
      }
    }
    for (let i = 0; i < llmMessages.length; i++) {
      if (llmMessages[i].role !== "tool") continue;
      let hasMatch = false;
      for (let j = i - 1; j >= 0; j--) {
        const prev = llmMessages[j];
        if (prev.role === "assistant" && prev.tool_calls) { hasMatch = prev.tool_calls.some(tc => tc.id === llmMessages[i].tool_call_id); break; }
        else if (prev.role !== "tool") break;
      }
      if (!hasMatch) removeSet.add(i);
    }
    for (const idx of Array.from(removeSet).sort((a, b) => b - a)) { llmMessages.splice(idx, 1); }

    const upstreamUrl = readEnvValue("TARGET_API_URL").trim();
    const upstreamKey = readEnvValue("TARGET_API_KEY").trim();
    if (!upstreamUrl || !upstreamKey) {
      return reply.code(500).send({ error: "TARGET_API_URL / TARGET_API_KEY 未配置" });
    }

    const requestedStream = body?.stream === true;
    const upstreamBody = buildUpstreamBody(body, llmMessages);
    if (hasTools()) { upstreamBody.tools = getToolDeclarations(); }

    // 获取最后一条用户消息用于记忆提取
    const lastUserMsg = kelivoMessages.filter(m => m.role === "user").slice(-1)[0];
    const lastUserText = lastUserMsg ? normalizeContentToText(lastUserMsg.content) : "";

    // ---- 有工具时：直接走非流式 tool loop，不发起下面的初始请求 ----
    // （原逻辑会先在这里 fetch 一次、再在 runToolLoop 里重复 fetch 一次，
    //   等于每次工具调用都白白多打一次上游 API；现在提前分流，避免重复请求。）
    if (hasTools()) {
      const loopResult = await runToolLoop(upstreamUrl, upstreamKey, upstreamBody);
      if (loopResult.error) {
        return reply.code(loopResult.status || 500).send(loopResult.body || "tool loop error");
      }
      const finalData = loopResult.data;
      const assistantReply = finalData.choices?.[0]?.message?.content || "";
      if (assistantReply && lastUserText) {
        setImmediate(() => { extractMemoryAsync(lastUserText, assistantReply).catch(err => console.error("[Memory] 异步提取失败:", err.message)); });
      }
      return reply.header("Content-Type", "application/json").send(JSON.stringify(finalData));
    }

    // ---- 没有工具：正常请求一次上游 ----
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${upstreamKey}` },
      body: JSON.stringify(upstreamBody)
    });

    const upstreamContentType = response.headers.get("content-type") || "";
    const shouldStreamResponse = requestedStream || upstreamContentType.includes("text/event-stream");

    if (!shouldStreamResponse) {
      // 非流式：response.body 是一次性流，只能读一次
      const responseText = await response.text();
      try {
        const parsed = JSON.parse(responseText);
        const assistantReply = parsed.choices?.[0]?.message?.content || "";
        if (assistantReply && lastUserText) {
          setImmediate(() => { extractMemoryAsync(lastUserText, assistantReply).catch(err => console.error("[Memory] 异步提取失败:", err.message)); });
        }
      } catch {}
      return reply.code(response.status).header("Content-Type", upstreamContentType || "application/json").send(responseText);
    }

    if (!response.body) {
      return reply.code(response.status).send({ error: "上游 API 没有返回可读取的响应体" });
    }

    reply.raw.writeHead(response.status, {
      "Content-Type": upstreamContentType || "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let sseBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reply.raw.write(value);
      try {
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const parsed = JSON.parse(line.slice(6));
              const delta = parsed.choices?.[0]?.delta?.content || "";
              fullContent += delta;
            } catch {}
          }
        }
      } catch {}
    }

    reply.raw.end();

    if (fullContent.trim() && lastUserText) {
      setImmediate(() => {
        extractMemoryAsync(lastUserText, fullContent).catch(err => {
          console.error("[Memory] 流式记忆提取失败:", err.message);
        });
      });
      console.log(`[Memory] 流式响应累加完成，${fullContent.length} 字符，已提交异步提取`);
    }

  } catch (err) {
    console.error(err);
    reply.code(500).send({ error: err.message });
  }
});

kelivoCompat(app);

app.post("/internal/wake-event", async (req, reply) => {
  try {
    const { content } = req.body;
    if (!content) return reply.code(400).send({ error: "content is required" });
    appendSpecialEvent(content);
    reply.send({ success: true });
  } catch (err) { console.error(err); reply.code(500).send({ error: err.message }); }
});


function readEnvValueOrDefault(key, fallback) { const value = readEnvValue(key); return value === "" ? fallback : value; }
function normalizePositiveInteger(value, key, fallback) { const n = Number(value); if (Number.isFinite(n) && n >= 1) return String(Math.floor(n)); return readEnvValueOrDefault(key, fallback); }
function normalizeHour(value, key, fallback, min, max) { const n = Number(value); if (Number.isFinite(n) && n >= min && n <= max) return String(Math.floor(n)); return readEnvValueOrDefault(key, fallback); }
function normalizeBooleanString(value, key, fallback) { const raw = String(value ?? "").trim().toLowerCase(); if (["true","1","yes","on"].includes(raw)) return "true"; if (["false","0","no","off"].includes(raw)) return "false"; return readEnvValueOrDefault(key, fallback); }
function normalizeWeatherUnits(value) { return String(value || "").trim().toLowerCase() === "fahrenheit" ? "fahrenheit" : "metric"; }

function diaryDirectoryPath() { return runtimeDirectory(readEnvValueOrDefault("DIARY_DIR", "diary"), "diary"); }

function readDiaryEntries(limit = 20) {
  const dir = diaryDirectoryPath();
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => /^[^/\\]+\.md$/i.test(name)).sort((a, b) => b.localeCompare(a)).slice(0, limit).map(name => {
      const filePath = path.join(dir, name); const stat = fs.statSync(filePath);
      return { name, updated_at: stat.mtime.toISOString(), content: fs.readFileSync(filePath, "utf-8").slice(0, 24000) };
    });
  } catch (err) { return [{ name: "读取日记失败", updated_at: new Date().toISOString(), content: err.message || String(err) }]; }
}

function basicAuth(req, reply, done) {
  const auth = req.headers.authorization || "";
  const [scheme, encoded] = auth.split(" ");
  if (scheme !== "Basic" || !encoded) { reply.code(401).header("WWW-Authenticate", 'Basic realm="Admin"').send("Unauthorized"); return; }
  const decoded = Buffer.from(encoded, "base64").toString();
  const colonIndex = decoded.indexOf(":");
  if (decoded.substring(0, colonIndex) === readEnvValue("ADMIN_USER") && decoded.substring(colonIndex + 1) === readEnvValue("ADMIN_PASSWORD")) { done(); }
  else { reply.code(401).header("WWW-Authenticate", 'Basic realm="Admin"').send("Unauthorized"); }
}

app.get("/admin", { preHandler: basicAuth }, async (req, reply) => {
  const serverUptime = Math.floor(process.uptime());
  const wakeUpStatus = wakeUpLastHeartbeat ? `在线（上次心跳: ${formatDateTimeInTimeZone(new Date(wakeUpLastHeartbeat), TIME_ZONE)}）` : "离线或未启动";
  reply.type("text/html").send(`<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>HEARTBEAT</title></head><body><h2>HEARTBEAT Runtime</h2><p>Gateway 运行中 (${serverUptime}秒) | Wake-up: ${escapeHtml(wakeUpStatus)}</p><p><a href="/admin">刷新</a></p></body></html>`);
});

app.post("/admin/models", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = req.body || {};
    const baseUrl = String(body.target_url || readEnvValue("TARGET_API_URL")).trim().replace(/\/+$/, "");
    const apiKey = String(body.target_key || readEnvValue("TARGET_API_KEY")).trim();

    if (!baseUrl || !apiKey) {
      return reply.code(400).send({ error: "请先填写中转站 URL / Key" });
    }

    let modelsUrl;
    if (/\/v1\/chat\/completions$/i.test(baseUrl)) {
      modelsUrl = baseUrl.replace(/\/chat\/completions$/i, "/models");
    } else if (/\/v1$/i.test(baseUrl)) {
      modelsUrl = `${baseUrl}/models`;
    } else {
      modelsUrl = `${baseUrl}/v1/models`;
    }

    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(15000)
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: "上游 /v1/models 返回的不是有效 JSON", raw: text.slice(0, 4000) };
    }

    if (!response.ok) return reply.code(response.status).send(payload);
    return reply.send(payload);
  } catch (err) {
    console.error("[Admin Models] 获取模型列表失败:", err);
    return reply.code(502).send({ error: err.message || String(err) });
  }
});

app.post("/admin/save", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const { target_url, target_key, gateway_api_key, model_name, bark_key, custom_icon, day_wake_after, night_wake_after, day_check_interval, night_check_interval, wake_day_start_hour, wake_day_end_hour, weather_enabled, weather_location_name, weather_lat, weather_lon, weather_units } = req.body || {};
    if (!target_url || !model_name) return reply.code(400).send({ error: "target_url / model_name 必填" });
    writeEnvUpdates({ TARGET_API_URL: target_url, TARGET_API_KEY: target_key || readEnvValue("TARGET_API_KEY"), GATEWAY_API_KEY: gateway_api_key || readEnvValue("GATEWAY_API_KEY"), MODEL_NAME: model_name, BARK_KEY: bark_key || readEnvValue("BARK_KEY"), CUSTOM_ICON_URL: custom_icon || "", DAY_WAKE_AFTER_MINUTES: normalizePositiveInteger(day_wake_after, "DAY_WAKE_AFTER_MINUTES", "60"), NIGHT_WAKE_AFTER_MINUTES: normalizePositiveInteger(night_wake_after, "NIGHT_WAKE_AFTER_MINUTES", "120"), DAY_CHECK_INTERVAL_MINUTES: normalizePositiveInteger(day_check_interval, "DAY_CHECK_INTERVAL_MINUTES", "10"), NIGHT_CHECK_INTERVAL_MINUTES: normalizePositiveInteger(night_check_interval, "NIGHT_CHECK_INTERVAL_MINUTES", "120"), WAKE_DAY_START_HOUR: normalizeHour(wake_day_start_hour, "WAKE_DAY_START_HOUR", "10", 0, 23), WAKE_DAY_END_HOUR: normalizeHour(wake_day_end_hour, "WAKE_DAY_END_HOUR", "24", 1, 24), WEATHER_ENABLED: normalizeBooleanString(weather_enabled, "WEATHER_ENABLED", "false"), WEATHER_LOCATION_NAME: weather_location_name || "", WEATHER_LAT: weather_lat || "", WEATHER_LON: weather_lon || "", WEATHER_UNITS: normalizeWeatherUnits(weather_units), ADMIN_USER: readEnvValue("ADMIN_USER"), ADMIN_PASSWORD: readEnvValue("ADMIN_PASSWORD") });
    if (wantsJsonResponse(req)) return reply.send({ success: true });
    reply.type("text/html").send(`<h2>已保存</h2><a href="/admin">返回</a>`);
  } catch (err) { console.error(err); reply.code(500).send({ error: err.message }); }
});

app.post("/admin/presets/save", { preHandler: basicAuth }, async (req, reply) => {
  const { name, target_url, target_key, model_name } = req.body || {};
  if (!name || !target_url || !model_name) return reply.code(400).send({ error: "name / target_url / model_name 必填" });
  const presets = loadPresets(); const existing = presets.findIndex(p => p.name === name);
  const entry = { name, target_url, target_key: target_key || "", model_name };
  if (existing >= 0) presets[existing] = entry; else presets.push(entry);
  savePresets(presets); reply.send({ success: true });
});

app.post("/admin/presets/delete", { preHandler: basicAuth }, async (req, reply) => {
  const { name } = req.body || {};
  savePresets(loadPresets().filter(p => p.name !== name)); reply.send({ success: true });
});

app.post("/internal/heartbeat", async (req, reply) => { wakeUpLastHeartbeat = Date.now(); reply.send({ status: "ok" }); });

app.post("/admin/restart", { preHandler: basicAuth }, async (req, reply) => {
  const restartCommand = readRestartCommand();
  reply.send({ success: true, output: `重启指令已发送：${restartCommand}` });
  const { exec } = require("child_process");
  exec(restartCommand, (err, stdout, stderr) => { if (err) console.error("重启失败:", stderr); else console.log("服务已重启:", stdout); });
});

app.get("/test-bark", { preHandler: basicAuth }, async (req, reply) => {
  const barkKey = readEnvValue("BARK_KEY");
  if (!barkKey) return reply.code(400).send({ error: "BARK_KEY 未配置" });
  const barkUrl = `https://api.day.app/${barkKey}/${encodeURIComponent("Bark 测试")}/${encodeURIComponent("如果你收到这条，说明推送通道正常。")}`;
  try {
    const response = await fetch(barkUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
    const result = await response.text();
    appendSpecialEvent(`（${formatDateTimeInTimeZone(new Date(), TIME_ZONE)} 刚刚给用户发了 Bark 测试推送。）`);
    reply.send({ success: response.ok, result });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.get("/admin/test-bark", { preHandler: basicAuth }, async (req, reply) => {
  const barkKey = readEnvValue("BARK_KEY");
  if (!barkKey) return reply.code(400).send({ error: "BARK_KEY 未配置" });
  const barkUrl = `https://api.day.app/${barkKey}/${encodeURIComponent("Bark 测试")}/${encodeURIComponent("如果你收到这条，说明推送通道正常。")}`;
  try {
    const response = await fetch(barkUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
    const result = await response.text();
    appendSpecialEvent(`（${formatDateTimeInTimeZone(new Date(), TIME_ZONE)} 刚刚给用户发了 Bark 测试推送。）`);
    reply.send({ success: response.ok, result });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(JSON.stringify({ event: "runtime_config_summary", railway: IS_RAILWAY_RUNTIME, persistent_data: Boolean(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH), target_url_configured: Boolean(readEnvValue("TARGET_API_URL")), target_key_configured: Boolean(readEnvValue("TARGET_API_KEY")), model_configured: Boolean(readEnvValue("MODEL_NAME")), gateway_key_configured: Boolean(readEnvValue("GATEWAY_API_KEY")), data_dir_ready: fs.existsSync(DATA_DIR) }));
  console.log(`✅ Gateway 运行在 ${address}`);
});

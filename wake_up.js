require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { buildNtfyPayload } = require("./ntfy_priority");
const { ensureDataDir, runtimeDirectory, runtimeFile } = require("./runtime_paths");
const configStore = require("./config_store");
const { parseChatCompletionResponse } = require("./upstream_response");
const {
  formatDateTimeInTimeZone,
  getDatePartsInTimeZone,
  getHourInTimeZone,
  resolveTimeZone,
  zonedWallTimeToDate
} = require("./time_utils");
const { getInjectedMemoryPrompt, runMemoryMaintenance } = require("./memory_system");
const { checkDiaryCron } = require("./diary_cron");

const DATA_DIR = ensureDataDir();
const TIMELINE_PATH = runtimeFile("enhanced_messages.json");
const PORT = Number(process.env.PORT) || 3000;
const GATEWAY_BASE_URL = (process.env.GATEWAY_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const GATEWAY_URL = `${GATEWAY_BASE_URL}/internal/wake-event`;
const HEARTBEAT_URL = `${GATEWAY_BASE_URL}/internal/heartbeat`;
const TIME_ZONE = resolveTimeZone();
const WEATHER_TIMEOUT_MS = 5000;
const DIARY_DIR_NAME = configStore.getConfigValue("DIARY_DIR") || "diary";
const DIARY_DIR_PATH = runtimeDirectory(DIARY_DIR_NAME, "diary");
const PUSH_TIMEOUT_MS = readPositiveTimeout("PUSH_TIMEOUT_MS", 15_000);
const WAKE_UPSTREAM_TIMEOUT_MS = readPositiveTimeout("WAKE_UPSTREAM_TIMEOUT_MS", 300_000);

// Fallback: 服务启动时间，用于时间线为空时作为"最后活跃时间"
const SERVICE_START_TIME = new Date();

function readPositiveTimeout(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 1000 ? Math.floor(value) : fallback;
}

function readNumberEnv(key, fallback, options = {}) {
  const value = Number(process.env[key]);
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  if (Number.isFinite(value) && value >= min && value <= max) return value;
  return fallback;
}

function readBooleanEnv(key, fallback = false) {
  const raw = String(process.env[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function getDiaryDateString(date = new Date()) {
  const parts = getDatePartsInTimeZone(date, TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getDiaryTimeString(date = new Date()) {
  const parts = getDatePartsInTimeZone(date, TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function extractDiaryFromResponse(text) {
  const diaryBlocks = [];
  const remainingText = String(text || "").replace(/\[DIARY\]([\s\S]*?)\[\/DIARY\]/gi, (_, content) => {
    const diary = String(content || "").trim();
    if (diary) diaryBlocks.push(diary);
    return "";
  }).trim();
  return {
    diaryContent: diaryBlocks.join("\n\n").trim(),
    remainingText
  };
}

function appendDiaryEntry(content) {
  if (!readBooleanEnv("DIARY_ENABLED", true)) {
    console.log("模型写了日记，但 DIARY_ENABLED=false，本次不保存");
    return false;
  }

  const cleanContent = String(content || "").trim();
  if (!cleanContent) return false;

  fs.mkdirSync(DIARY_DIR_PATH, { recursive: true });
  const diaryFile = path.join(DIARY_DIR_PATH, `${getDiaryDateString()}.md`);
  const entry = `\n\n## ${getDiaryTimeString()}\n\n${cleanContent}\n`;
  fs.appendFileSync(diaryFile, entry, "utf-8");
  console.log(`已保存日记：${diaryFile}`);
  return true;
}

async function sendPushNotification({ title, body }) {
  const provider = (process.env.PUSH_PROVIDER || "bark").trim().toLowerCase();

  if (provider === "ntfy") {
    const topic = String(process.env.NTFY_TOPIC || "").trim();
    if (!topic) return { ok: false, providerLabel: "ntfy", reason: "NTFY_TOPIC 未配置" };

    const server = (process.env.NTFY_SERVER_URL || "https://ntfy.sh").replace(/\/+$/, "");
    const headers = { "Content-Type": "application/json" };
    if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
    const payload = buildNtfyPayload({
      topic, title, message: body,
      priority: process.env.NTFY_PRIORITY, tags: process.env.NTFY_TAGS
    });

    const response = await fetch(server, {
      method: "POST", signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      headers, body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    if (!response.ok) return { ok: false, providerLabel: "ntfy", reason: responseText || `HTTP ${response.status}` };
    return { ok: true, providerLabel: "ntfy" };
  }

  if (provider !== "bark") {
    return { ok: false, providerLabel: provider || "未知渠道", reason: `不支持的 PUSH_PROVIDER：${provider}` };
  }

  if (!configStore.getConfigValue("BARK_KEY")) {
    return { ok: false, providerLabel: "Bark", reason: "Bark Key 未配置" };
  }

  const barkKey = configStore.getConfigValue("BARK_KEY");
  const safeTitle = encodeURIComponent(title || "来自伴侣");
  const safeBody = encodeURIComponent(body || "");
  const barkUrl = `https://api.day.app/${barkKey}/${safeTitle}/${safeBody}`;

  try {
    const response = await fetch(barkUrl, {
      method: "GET", signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
    });
    const responseText = await response.text();
    let result = {};
    try { result = JSON.parse(responseText); } catch {}
    console.log("\nBark Result:\n", result || responseText);
    if (!response.ok || (result.code && result.code !== 200)) {
      return { ok: false, providerLabel: "Bark", reason: result.message || `HTTP ${response.status}` };
    }
    return { ok: true, providerLabel: "Bark" };
  } catch (err) {
    return { ok: false, providerLabel: "Bark", reason: err.message || "请求失败" };
  }
}

function isDayTime(date = new Date()) {
  const hour = getHourInTimeZone(date, TIME_ZONE);
  const start = readNumberEnv("WAKE_DAY_START_HOUR", 10, { min: 0, max: 23 });
  const end = readNumberEnv("WAKE_DAY_END_HOUR", 24, { min: 1, max: 24 });
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function getWakeAfterMinutes(date = new Date()) {
  return isDayTime(date)
    ? readNumberEnv("DAY_WAKE_AFTER_MINUTES", 60, { min: 1 })
    : readNumberEnv("NIGHT_WAKE_AFTER_MINUTES", 120, { min: 1 });
}

function getCheckIntervalMinutes(date = new Date()) {
  return isDayTime(date)
    ? readNumberEnv("DAY_CHECK_INTERVAL_MINUTES", 10, { min: 1 })
    : readNumberEnv("NIGHT_CHECK_INTERVAL_MINUTES", 120, { min: 1 });
}

function normalizeContentToText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
      if (type === "text" || type === "input_text") return part.text || part.content || "";
      if (part.image_url || type.includes("image")) return "[图片]";
      if (part.file || type.includes("file")) return "[文件]";
      return "";
    }).filter(Boolean).join("\n");
  }
  if (content && typeof content === "object") {
    const type = typeof content.type === "string" ? content.type.toLowerCase() : "";
    if (content.image_url || type.includes("image")) return "[图片]";
    if (content.file || type.includes("file")) return "[文件]";
  }
  return "[非文本内容]";
}

function summarizeWakeMessages(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  const roles = {};
  let chars = 0;
  for (const msg of list) {
    roles[msg?.role || ""] = (roles[msg?.role || ""] || 0) + 1;
    chars += normalizeContentToText(msg?.content).length;
  }
  return { total: list.length, roles, text_chars: chars };
}

function weatherCodeText(code) {
  const table = {
    0: "晴朗", 1: "大致晴朗", 2: "局部多云", 3: "阴天",
    45: "有雾", 48: "雾凇", 51: "小毛毛雨", 53: "中等毛毛雨", 55: "较强毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨", 71: "小雪", 73: "中雪", 75: "大雪",
    80: "阵雨", 81: "较强阵雨", 82: "强阵雨",
    95: "雷暴", 96: "雷暴伴小冰雹", 99: "雷暴伴大冰雹"
  };
  return table[code] || `天气代码 ${code}`;
}

async function fetchWeatherContext() {
  if (!readBooleanEnv("WEATHER_ENABLED", false)) return "";
  const lat = Number(process.env.WEATHER_LAT);
  const lon = Number(process.env.WEATHER_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.log("已启用 WEATHER_ENABLED，但 WEATHER_LAT / WEATHER_LON 未正确配置，跳过天气注入");
    return "";
  }
  const location = process.env.WEATHER_LOCATION_NAME || "当前位置";
  const units = (process.env.WEATHER_UNITS || "metric").trim().toLowerCase();
  const temperatureUnit = units === "fahrenheit" ? "fahrenheit" : "celsius";
  const windSpeedUnit = units === "fahrenheit" ? "mph" : "kmh";
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("temperature_unit", temperatureUnit);
  url.searchParams.set("wind_speed_unit", windSpeedUnit);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const current = data.current || {};
    const daily = data.daily || {};
    const unitsInfo = data.current_units || {};
    const lines = [
      "## 天气信息",
      `- 位置：${location}`,
      `- 当前：${weatherCodeText(current.weather_code)}，${current.temperature_2m}${unitsInfo.temperature_2m || "°C"}，体感 ${current.apparent_temperature}${unitsInfo.apparent_temperature || "°C"}`,
      `- 湿度：${current.relative_humidity_2m}${unitsInfo.relative_humidity_2m || "%"}`,
      `- 降雨：${current.precipitation}${unitsInfo.precipitation || "mm"}`,
      `- 风速：${current.wind_speed_10m}${unitsInfo.wind_speed_10m || ""}`
    ];
    if (Array.isArray(daily.sunrise) && Array.isArray(daily.sunset)) {
      lines.push(`- 日出/日落：${daily.sunrise[0]} / ${daily.sunset[0]}`);
    }
    return lines.join("\n");
  } catch (err) {
    console.log("天气注入失败，跳过本次天气信息:", err.message);
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function loadTimelineMessages() {
  if (!fs.existsSync(TIMELINE_PATH)) {
    console.log("未找到 enhanced_messages.json，使用服务启动时间作为 fallback");
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(TIMELINE_PATH, "utf-8"));
    if (!Array.isArray(parsed)) {
      console.log("enhanced_messages.json 格式错误：顶层不是数组");
      return null;
    }
    return parsed;
  } catch (err) {
    console.error("读取 enhanced_messages.json 失败:", err.message);
    return null;
  }
}

function getChinaTimeString() {
  return formatDateTimeInTimeZone(new Date(), TIME_ZONE);
}

function getLocalTimeString() {
  return formatDateTimeInTimeZone(new Date(), TIME_ZONE);
}

function shouldWake(lastUserTime) {
  const now = new Date();
  const diffMinutes = Math.floor((now - new Date(lastUserTime)) / 1000 / 60);
  return diffMinutes >= getWakeAfterMinutes(now);
}

function parseTimelineTimestamp(value) {
  const text = String(value || "");
  const match = text.match(/（?\s*(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[ T]?)(\d{1,2})[:：](\d{2})/);
  if (!match) return null;
  const [, yyyy, , month, day, hour, minute] = match;
  return zonedWallTimeToDate({ year: yyyy, month, day, hour, minute }, TIME_ZONE);
}

function getLastUserTime(messages) {
  if (!messages || messages.length === 0) return null;
  const reversed = [...messages].reverse();
  for (const msg of reversed) {
    if (msg.role === "user") {
      const content = normalizeContentToText(msg.content);
      const parsed = parseTimelineTimestamp(content);
      if (parsed) return parsed;
    }
  }
  return null;
}

function stripPosition(messages) {
  return messages.map(({ position, ...rest }) => rest);
}

function buildWakePrompt(currentTime, diffMinutes, weatherContext = "", memoryContext = "") {
  const promptFile = path.join(__dirname, "wake_prompt.txt");
  if (fs.existsSync(promptFile)) {
    let template = fs.readFileSync(promptFile, "utf-8");
    template = template
      .replace(/\$\{currentTime\}/g, currentTime)
      .replace(/\$\{diffMinutes\}/g, diffMinutes)
      .replace(/\$\{weatherContext\}/g, weatherContext)
      .replace(/\$\{weather\}/g, weatherContext)
      .replace(/\$\{memoryContext\}/g, memoryContext);
    if (memoryContext && !template.includes(memoryContext)) {
      template += "\n\n" + memoryContext;
    }
    return template;
  }

  if (process.env.WAKE_PROMPT_TEMPLATE) {
    let template = process.env.WAKE_PROMPT_TEMPLATE
      .replace(/\\n/g, '\n')
      .replace(/\$\{currentTime\}/g, currentTime)
      .replace(/\$\{diffMinutes\}/g, diffMinutes)
      .replace(/\$\{weatherContext\}/g, weatherContext)
      .replace(/\$\{weather\}/g, weatherContext)
      .replace(/\$\{memoryContext\}/g, memoryContext);
    if (memoryContext && !template.includes(memoryContext)) {
      template += "\n\n" + memoryContext;
    }
    return template;
  }

  return `
## 最高优先级规则
1. 这是一次后台自动唤醒，不是用户发起的对话。你没有收到任何新消息。
2. 你的唯一任务是决定是否主动联系用户。不能生成对话回复。
3. 输出格式必须严格遵守以下二选一。

## 唤醒信息
- 当前时间：${currentTime}
- 距离用户最后一条消息：${diffMinutes} 分钟
${weatherContext ? `\n${weatherContext}\n` : ""}
${memoryContext ? `\n${memoryContext}\n` : ""}

## 输出格式
- 如果想联系用户，直接写你想说的话。系统会自动打包成手机推送发送。可以是一句话，也可以第一行作为标题、第二行作为正文。
- 如果不想联系，只输出：[NO_ACTION]，可附带简短原因（10字以内）。
- 如果你想写日记，可以额外输出 [DIARY]...[/DIARY]。只有想写时才写，不必每次都写。
`;
}

async function runWakeUp() {
  console.log("\n==========================");
  console.log("开始自动唤醒");
  console.log("==========================\n");

  // 每次唤醒检查时顺便做记忆维护
  try {
    await runMemoryMaintenance();
  } catch (err) {
    console.error("[Memory] 记忆维护失败（不影响唤醒）:", err.message);
  }

  const messages = loadTimelineMessages();

  // 获取最后用户活跃时间，如果找不到则用服务启动时间作为 fallback
  let lastUserTime = messages ? getLastUserTime(messages) : null;
  if (!lastUserTime) {
    console.log("未找到用户时间戳，使用服务启动时间作为 fallback");
    lastUserTime = SERVICE_START_TIME;
  }

  const now = new Date();
  const diffMinutes = Math.floor((now - lastUserTime) / 1000 / 60);

  if (!shouldWake(lastUserTime)) {
    console.log(`\n暂不需要唤醒（距上次活跃 ${diffMinutes} 分钟）\n`);
    return;
  }

  const weatherContext = await fetchWeatherContext();
  const memoryContext = getInjectedMemoryPrompt();
  const wakePrompt = buildWakePrompt(getChinaTimeString(), diffMinutes, weatherContext, memoryContext);

  // 如果没有时间线消息，构建一个最小化的唤醒请求
  let historyText = "";
  let cleanSP = "";

  if (messages && messages.length > 0) {
    const cleanMessages = stripPosition(messages);
    historyText = cleanMessages
      .filter(msg => msg.role !== "system")
      .filter(msg => {
        const c = normalizeContentToText(msg.content);
        return !c.includes("<memories>") && !c.includes("记忆库使用策略");
      })
      .map(msg => {
        const userDisplay = process.env.USER_DISPLAY_NAME || "用户";
        const aiDisplay = process.env.AI_DISPLAY_NAME || "AI";
        const role = msg.role === "user" ? userDisplay : aiDisplay;
        let content = normalizeContentToText(msg.content);
        if (content.includes("## Memories")) {
          content = content.split("## Memories")[0];
        }
        return `[${role}] ${content}`;
      })
      .join("\n\n");

    const baseSystemPrompt = cleanMessages.find(msg => msg.role === "system");
    cleanSP = baseSystemPrompt
      ? normalizeContentToText(baseSystemPrompt.content).split("## Memories")[0].trim()
      : "";
  } else {
    historyText = "（暂无聊天记录，这是服务重启后的首次唤醒检查）";
  }

  const wakeMessages = [
    {
      role: "system",
      content: [wakePrompt, cleanSP].filter(Boolean).join("\n\n")
    },
    {
      role: "user",
      content: `以下是你与用户最近的聊天记录，仅供回忆和参考。

这些内容不是正在发生的实时对话。
用户并没有给你发消息。

你现在处于后台自主唤醒状态。

最近记录：

${historyText}`
    }
  ];

  console.log("\n===== WAKE MESSAGES SUMMARY =====\n");
  console.log(JSON.stringify(summarizeWakeMessages(wakeMessages)));

  if (!configStore.getChatCompletionsUrl() || !configStore.getConfigValue("TARGET_API_KEY") || !configStore.getConfigValue("MODEL_NAME")) {
    console.log("缺少 TARGET_API_URL / TARGET_API_KEY / MODEL_NAME，跳过本次唤醒");
    return;
  }

  const response = await fetch(configStore.getChatCompletionsUrl(), {
    method: "POST",
    signal: AbortSignal.timeout(WAKE_UPSTREAM_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${configStore.getConfigValue("TARGET_API_KEY")}`
    },
    body: JSON.stringify({
      model: configStore.getConfigValue("MODEL_NAME"),
      messages: wakeMessages,
      temperature: 0.8,
      top_p: 0.95,
      stream: false
    })
  });

  const responseText = await response.text();
  let data;
  try {
    data = parseChatCompletionResponse(responseText, response.headers.get("content-type") || "");
  } catch (error) {
    throw new Error(`模型响应无法解析（HTTP ${response.status}）：${error.message || responseText.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(`模型请求失败（HTTP ${response.status}）：${responseText.slice(0, 300)}`);
  }

  const rawAiText = normalizeContentToText(data.choices?.[0]?.message?.content).trim();
  console.log("\nWake Result Summary:\n");
  console.log(JSON.stringify({ choices: Array.isArray(data.choices) ? data.choices.length : 0, ai_text_chars: rawAiText.length }));

  const diaryResult = extractDiaryFromResponse(rawAiText);
  const diarySaved = appendDiaryEntry(diaryResult.diaryContent);
  const aiText = diaryResult.remainingText;

  let eventContent;

  if (!aiText) {
    console.log("\nAI 未返回推送内容，本次不发送推送\n");
    eventContent = diarySaved
      ? `（${getLocalTimeString()} 自动唤醒：本次未发送推送｜原因：只写日记）`
      : `（${getLocalTimeString()} 自动唤醒：本次未发送推送｜原因：模型空回复）`;
  } else if (aiText.match(/^\[NO_ACTION\]\s*(.{0,20})?/)) {
    const noActionMatch = aiText.match(/^\[NO_ACTION\]\s*(.{0,20})?/);
    console.log("\nAI 选择不发送推送\n");
    let reason = (noActionMatch[1] || "").trim();
    if (reason.startsWith("原因：") || reason.startsWith("原因:")) {
      reason = reason.replace(/^原因[：:]\s*/, "").trim();
    }
    eventContent = reason
      ? `（${getLocalTimeString()} 自动唤醒：本次未发送推送｜原因：${reason}）`
      : `（${getLocalTimeString()} 自动唤醒：本次未发送推送）`;
  } else {
    console.log("\nAI 选择发送推送\n");
    let barkText = aiText;

    const barkMatch = barkText.match(/\[BARK\]([\s\S]*?)\[\/BARK\]/);
    if (barkMatch) {
      barkText = barkMatch[1].trim();
    } else {
      barkText = barkText.replace(/^\[BARK\]\s*/, "").trim();
      barkText = barkText.replace(/\s*\[\/BARK\]$/, "").trim();
    }

    barkText = barkText
      .replace(/^标题[：:]\s*/gm, "")
      .replace(/^正文[：:]\s*/gm, "");

    const lines = barkText.split("\n").filter(line => line.trim() !== "");

    let title, body;
    if (lines.length === 0) {
      console.log("\n推送内容清洗后为空，本次不发送推送\n");
      eventContent = `（${getLocalTimeString()} 自动唤醒：本次未发送推送｜原因：推送内容为空）`;
    } else if (lines.length === 1) {
      title = "来自AI";
      body = lines[0].trim();
    } else if (lines.length === 2) {
      title = lines[0].trim();
      body = lines[1].trim();
    } else {
      title = lines[0].trim();
      body = lines.slice(1).map(l => l.trim()).join(" ");
    }

    if (!eventContent) {
      const safeBody = body.length > 500 ? body.substring(0, 497) + "..." : body;
      let safeTitle = title || "来自伴侣";
      if (/^\d/.test(safeTitle)) safeTitle = "来自伴侣｜" + safeTitle;

      const pushResult = await sendPushNotification({ title: safeTitle, body: safeBody });
      if (!pushResult.ok) {
        console.log(`\n${pushResult.providerLabel} 推送失败\n`);
        eventContent = `（${getLocalTimeString()} 自动唤醒：本次未发送推送｜原因：${pushResult.providerLabel} 推送失败：${pushResult.reason}）`;
      } else {
        eventContent = `（${getLocalTimeString()} 刚刚给用户发了${pushResult.providerLabel}推送：${safeTitle}｜${safeBody}）`;
      }
    }
  }

  try {
    const eventResponse = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: eventContent })
    });
    if (!eventResponse.ok) {
      throw new Error(`Gateway 返回 HTTP ${eventResponse.status}`);
    }
    console.log("\n已通过 Gateway 记录唤醒事件\n");
  } catch (err) {
    console.error("\n记录唤醒事件失败（Gateway 是否运行？）:\n", err.message);
  }
}

function getCheckIntervalMs() {
  return getCheckIntervalMinutes(new Date()) * 60 * 1000;
}

async function scheduleNextCheck() {
  try {
    try {
      await fetch(HEARTBEAT_URL, { method: "POST" });
    } catch {}
    await runWakeUp();
        await checkDiaryCron();

  } catch (err) {
    console.error("唤醒检查出错:", err);
  }
  setTimeout(scheduleNextCheck, getCheckIntervalMs());
}

setTimeout(scheduleNextCheck, 10_000);

console.log("\n==================================");
console.log("Dylan Heartbeat Runtime 已启动（动态间隔）");
console.log(JSON.stringify({
  event: "wake_runtime_config_summary",
  railway: Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID),
  persistent_data: Boolean(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH),
  target_url_configured: Boolean(configStore.getChatCompletionsUrl()),
  target_key_configured: Boolean(configStore.getConfigValue("TARGET_API_KEY")),
  model_configured: Boolean(configStore.getConfigValue("MODEL_NAME")),
  push_provider_configured: Boolean(configStore.getConfigValue("BARK_KEY") || process.env.NTFY_TOPIC),
  data_dir_ready: fs.existsSync(DATA_DIR)
}));
console.log("==================================\n");

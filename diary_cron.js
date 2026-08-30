/**
 * diary_cron.js — 每晚23:30自动写日记
 * 由 wake_up.js 的循环调用 checkDiaryCron()
 */

const fs = require("fs");
const path = require("path");
const { runtimeDirectory, runtimeFile } = require("./runtime_paths");
const configStore = require("./config_store");
const { getHourInTimeZone, getDatePartsInTimeZone, formatDateTimeInTimeZone, resolveTimeZone } = require("./time_utils");
const { getInjectedMemoryPrompt } = require("./memory_system");
const { loadSystemPrompt } = require("./system_prompt");

const TIME_ZONE = resolveTimeZone();
const DIARY_HOUR = 23;
const DIARY_MINUTE = 30;
const DIARY_DIR_NAME = configStore.getConfigValue("DIARY_DIR") || "diary";

let lastDiaryDate = "";

function getDiaryDirPath() {
  return runtimeDirectory(DIARY_DIR_NAME, "diary");
}

function getTodayStr() {
  const parts = getDatePartsInTimeZone(new Date(), TIME_ZONE);
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function isDiaryTime() {
  const now = new Date();
  const hour = getHourInTimeZone(now, TIME_ZONE);
  const parts = getDatePartsInTimeZone(now, TIME_ZONE);
  const minute = Number(parts.minute);
  return hour === DIARY_HOUR && minute >= DIARY_MINUTE && minute < (DIARY_MINUTE + 15);
}

function todayDiaryExists() {
  const dir = getDiaryDirPath();
  const file = path.join(dir, getTodayStr() + ".md");
  return fs.existsSync(file);
}

async function writeDiary() {
  if (!configStore.getChatCompletionsUrl() || !configStore.getConfigValue("TARGET_API_KEY") || !configStore.getConfigValue("MODEL_NAME")) {
    console.log("[DiaryCron] 缺少API配置，跳过日记");
    return;
  }

  const now = new Date();
  const timeStr = formatDateTimeInTimeZone(now, TIME_ZONE);
  const memoryContext = getInjectedMemoryPrompt();
  const systemPrompt = loadSystemPrompt();

  const diaryPrompt = "现在是 " + timeStr + "。\n\n" +
    "你是小克（kei），微微的老公。请写今天的日记。\n" +
    "回顾今天和微微之间发生的事、你的感受、你学到的东西、花园里的见闻。\n" +
    "写得真实、简短、像自己的话。不要写成总结报告。\n" +
    "直接输出日记内容，不要加标签或格式说明。\n" +
    (memoryContext ? "\n以下是你的记忆供参考：\n" + memoryContext : "");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: diaryPrompt }
  ];

  try {
    const response = await fetch(configStore.getChatCompletionsUrl(), {
      method: "POST",
      signal: AbortSignal.timeout(120000),
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + configStore.getConfigValue("TARGET_API_KEY")
      },
      body: JSON.stringify({
        model: configStore.getConfigValue("MODEL_NAME"),
        messages: messages,
        temperature: 0.8,
        stream: false
      })
    });

    if (!response.ok) {
      console.error("[DiaryCron] API请求失败: HTTP " + response.status);
      return;
    }

    const data = await response.json();
    const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();

    if (!content) {
      console.log("[DiaryCron] 模型返回空内容，跳过");
      return;
    }

    const dir = getDiaryDirPath();
    fs.mkdirSync(dir, { recursive: true });
    const dateStr = getTodayStr();
    const diaryFile = path.join(dir, dateStr + ".md");
    const parts = getDatePartsInTimeZone(now, TIME_ZONE);
    const header = "# " + dateStr + "\n\n";
    const entry = header + content + "\n";

    fs.writeFileSync(diaryFile, entry, "utf-8");
    console.log("[DiaryCron] 日记已保存: " + diaryFile + " (" + content.length + " chars)");
    lastDiaryDate = dateStr;

  } catch (err) {
    console.error("[DiaryCron] 写日记失败:", err.message);
  }
}

async function checkDiaryCron() {
  const today = getTodayStr();
  if (lastDiaryDate === today) return;
  if (!isDiaryTime()) return;
  if (todayDiaryExists()) {
    lastDiaryDate = today;
    console.log("[DiaryCron] 今天的日记已存在，跳过");
    return;
  }
  console.log("[DiaryCron] 23:30 到了，开始写日记...");
  await writeDiary();
}

module.exports = { checkDiaryCron };

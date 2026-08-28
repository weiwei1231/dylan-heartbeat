/**
 * memory_system.js — 记忆提取、存储与注入模块
 * 参考 LucieEveille/kiwi-mem 设计思路，适配 dylan-heartbeat Node.js 项目
 */

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { runtimeDirectory, runtimeFile } = require("./runtime_paths");
const {
  formatDateTimeInTimeZone,
  getDatePartsInTimeZone,
  resolveTimeZone
} = require("./time_utils");

const TIME_ZONE = resolveTimeZone();

// 目录结构
const MEMORY_BASE_DIR = runtimeDirectory("memories", "memories");
const RAW_DIR = path.join(MEMORY_BASE_DIR, "raw");
const DIGEST_DIR = path.join(MEMORY_BASE_DIR, "digests");
const DAILY_DIR = path.join(DIGEST_DIR, "daily");
const WEEKLY_DIR = path.join(DIGEST_DIR, "weekly");

// 初始化目录
function initMemoryStorage() {
  [MEMORY_BASE_DIR, RAW_DIR, DIGEST_DIR, DAILY_DIR, WEEKLY_DIR].forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
  });
}
initMemoryStorage();

// 工具函数
function getTodayString() {
  const parts = getDatePartsInTimeZone(new Date(), TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getMemoryModelName() {
  return process.env.MEMORY_MODEL_NAME || process.env.MODEL_NAME || "claude-3-5-haiku-20241022";
}

function readPositiveInt(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

// 每天最多提取的记忆条数上限，防止爆炸
const MAX_RAW_ENTRIES_PER_DAY = readPositiveInt("MEMORY_MAX_RAW_PER_DAY", 100);

/**
 * 调用上游 API（用 fetch，不依赖 OpenAI SDK）
 */
async function callModelForMemory(messages, temperature = 0.1) {
  const apiUrl = process.env.TARGET_API_URL;
  const apiKey = process.env.TARGET_API_KEY;
  const model = getMemoryModelName();

  if (!apiUrl || !apiKey) {
    console.log("[Memory] TARGET_API_URL 或 TARGET_API_KEY 未配置，跳过");
    return null;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      stream: false
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`模型请求失败 (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * 1. 记忆注入：读取最新摘要 + 今天的原始记忆，拼成可注入的文本
 */
function getInjectedMemoryPrompt() {
  try {
    const today = getTodayString();
    const promptParts = [];

    // 读最新的日摘要
    const dailyFiles = fs.existsSync(DAILY_DIR)
      ? fs.readdirSync(DAILY_DIR).filter(f => f.endsWith(".json")).sort().reverse()
      : [];

    if (dailyFiles.length > 0) {
      // 最多注入最近 3 天的摘要
      const recentDigests = dailyFiles.slice(0, 3);
      const digestTexts = [];
      for (const file of recentDigests) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(DAILY_DIR, file), "utf-8"));
          if (data.summary) {
            digestTexts.push(`[${data.date || file.replace(".json", "")}] ${data.summary}`);
          }
        } catch {}
      }
      if (digestTexts.length > 0) {
        promptParts.push(`【近期记忆摘要】\n${digestTexts.join("\n")}`);
      }
    }

    // 读最新的周摘要（如果有）
    const weeklyFiles = fs.existsSync(WEEKLY_DIR)
      ? fs.readdirSync(WEEKLY_DIR).filter(f => f.endsWith(".json")).sort().reverse()
      : [];

    if (weeklyFiles.length > 0) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(WEEKLY_DIR, weeklyFiles[0]), "utf-8"));
        if (data.summary) {
          promptParts.push(`【长期记忆摘要】\n${data.summary}`);
        }
      } catch {}
    }

    // 读今天的原始碎片记忆
    const todayRawPath = path.join(RAW_DIR, `${today}.json`);
    if (fs.existsSync(todayRawPath)) {
      try {
        const todayData = JSON.parse(fs.readFileSync(todayRawPath, "utf-8"));
        if (Array.isArray(todayData) && todayData.length > 0) {
          // 只取最近 20 条避免太长
          const recent = todayData.slice(-20);
          const todayMemories = recent.map(item => `- [${item.category}] ${item.content}`).join("\n");
          promptParts.push(`【今天新记录的记忆】\n${todayMemories}`);
        }
      } catch {}
    }

    if (promptParts.length === 0) return "";

    return `\n\n=== 长期记忆库 ===\n${promptParts.join("\n\n")}\n==================\n自然地结合上述记忆回复，无需刻意声明"我记得"。`;
  } catch (err) {
    console.error("[Memory] 读取记忆失败:", err.message);
    return "";
  }
}

/**
 * 2. 记忆提取：对话完成后异步调用，提取关于用户的长期价值信息
 */
async function extractMemoryAsync(userMessage, assistantMessage) {
  // 忽略太短的无意义发言
  if (!userMessage || userMessage.trim().length < 6) return;
  if (!assistantMessage || assistantMessage.trim().length < 6) return;

  const extractionPrompt = [
    {
      role: "system",
      content: `你是一个专业的记忆提取助手。请分析【用户发言】和【助手回复】，提取出关于用户的**长期价值信息**。
包括：事实（fact）、喜好偏好（preference）、情绪状态（emotion）、重要事件/计划（event）。

要求：
1. 只提取针对"用户"的信息，不要记录 AI 做了什么。
2. 格式必须为 JSON 数组，每个元素包含 "category"（fact/preference/emotion/event）和 "content"（简洁一句话）。
3. 如果本次对话无值得记忆的新信息，严格返回空数组 []。
4. 不要输出除 JSON 以外的任何文字、Markdown 标记或代码块标签。
5. 提取的内容应该有长期参考价值，日常寒暄不需要记录。`
    },
    {
      role: "user",
      content: `用户说：${userMessage.slice(0, 2000)}\n\n助手答：${assistantMessage.slice(0, 2000)}`
    }
  ];

  try {
    const rawText = await callModelForMemory(extractionPrompt, 0.1);
    if (!rawText) return;

    // 清理可能的 markdown 代码块
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    const extracted = JSON.parse(cleaned);

    if (!Array.isArray(extracted) || extracted.length === 0) return;

    const today = getTodayString();
    const todayRawPath = path.join(RAW_DIR, `${today}.json`);

    let currentRecords = [];
    if (fs.existsSync(todayRawPath)) {
      try {
        currentRecords = JSON.parse(fs.readFileSync(todayRawPath, "utf-8"));
      } catch {}
    }

    // 防止当天记录过多
    if (currentRecords.length >= MAX_RAW_ENTRIES_PER_DAY) {
      console.log(`[Memory] 今天已达到 ${MAX_RAW_ENTRIES_PER_DAY} 条上限，跳过`);
      return;
    }

    const now = new Date().toISOString();
    for (const item of extracted) {
      if (!item.content || typeof item.content !== "string") continue;
      currentRecords.push({
        timestamp: now,
        category: item.category || "fact",
        content: item.content.trim()
      });
    }

    fs.writeFileSync(todayRawPath, JSON.stringify(currentRecords, null, 2), "utf-8");
    console.log(`[Memory] 成功写入 ${extracted.length} 条新记忆至 ${today}.json`);
  } catch (err) {
    console.error("[Memory] 记忆提取失败:", err.message);
  }
}

/**
 * 3. 日摘要生成：压缩某一天的原始记忆为精炼文本
 *    建议每天在 wake_up 首次触发时调用一次
 */
async function generateDailyDigest(targetDate) {
  try {
    const dateStr = targetDate || getTodayString();
    const rawPath = path.join(RAW_DIR, `${dateStr}.json`);

    if (!fs.existsSync(rawPath)) {
      console.log(`[Memory] ${dateStr} 无原始记忆，跳过日摘要`);
      return;
    }

    const rawData = JSON.parse(fs.readFileSync(rawPath, "utf-8"));
    if (!Array.isArray(rawData) || rawData.length === 0) return;

    // 检查是否已有该日摘要
    const digestPath = path.join(DAILY_DIR, `${dateStr}.json`);
    if (fs.existsSync(digestPath)) {
      console.log(`[Memory] ${dateStr} 日摘要已存在，跳过`);
      return;
    }

    const digestPrompt = [
      {
        role: "system",
        content: `你是一个记忆整合专家。以下是某一天收集到的关于用户的原始记忆碎片。
请对其进行去重、整合与提炼，生成一份精简的用户当日摘要（3-8 句话）。
重点保留：重要事实变化、情绪状态、关键事件、新发现的偏好。
直接返回摘要文本，不要加标题或格式标记。`
      },
      {
        role: "user",
        content: JSON.stringify(rawData.slice(-50)) // 最多取 50 条
      }
    ];

    const summary = await callModelForMemory(digestPrompt, 0.3);
    if (!summary) return;

    fs.writeFileSync(digestPath, JSON.stringify({
      date: dateStr,
      createdAt: new Date().toISOString(),
      entryCount: rawData.length,
      summary
    }, null, 2), "utf-8");

    console.log(`[Memory] ${dateStr} 日摘要生成成功`);
  } catch (err) {
    console.error("[Memory] 生成日摘要失败:", err.message);
  }
}

/**
 * 4. 周摘要生成：压缩最近 7 天的日摘要为一份长期记忆
 *    建议每周一或累积 7 天日摘要后调用
 */
async function generateWeeklyDigest() {
  try {
    const dailyFiles = fs.existsSync(DAILY_DIR)
      ? fs.readdirSync(DAILY_DIR).filter(f => f.endsWith(".json")).sort().reverse().slice(0, 7)
      : [];

    if (dailyFiles.length < 3) {
      console.log("[Memory] 日摘要不足 3 天，暂不生成周摘要");
      return;
    }

    const dailySummaries = [];
    for (const file of dailyFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(DAILY_DIR, file), "utf-8"));
        if (data.summary) {
          dailySummaries.push(`[${data.date}] ${data.summary}`);
        }
      } catch {}
    }

    if (dailySummaries.length === 0) return;

    const today = getTodayString();
    const weeklyPath = path.join(WEEKLY_DIR, `week_${today}.json`);

    const digestPrompt = [
      {
        role: "system",
        content: `你是一个记忆整合专家。以下是最近一周的每日记忆摘要。
请整合为一份简洁的"用户近期画像与状态"（5-10 句话）。
保留最重要的长期信息，去掉已过时或重复的细节。
直接返回摘要文本。`
      },
      {
        role: "user",
        content: dailySummaries.join("\n\n")
      }
    ];

    const summary = await callModelForMemory(digestPrompt, 0.3);
    if (!summary) return;

    fs.writeFileSync(weeklyPath, JSON.stringify({
      date: today,
      createdAt: new Date().toISOString(),
      coveredDays: dailyFiles.map(f => f.replace(".json", "")),
      summary
    }, null, 2), "utf-8");

    console.log("[Memory] 周摘要生成成功");
  } catch (err) {
    console.error("[Memory] 生成周摘要失败:", err.message);
  }
}

/**
 * 5. 定时维护入口：由 wake_up 调用，自动判断该做哪些摘要任务
 */
async function runMemoryMaintenance() {
  try {
    // 对昨天的记忆生成日摘要
    const yesterday = new Date(Date.now() - 86400000);
    const yesterdayParts = getDatePartsInTimeZone(yesterday, TIME_ZONE);
    const yesterdayStr = `${yesterdayParts.year}-${yesterdayParts.month}-${yesterdayParts.day}`;
    await generateDailyDigest(yesterdayStr);

    // 如果日摘要够多，尝试生成周摘要
    const dailyFiles = fs.existsSync(DAILY_DIR)
      ? fs.readdirSync(DAILY_DIR).filter(f => f.endsWith(".json"))
      : [];

    if (dailyFiles.length >= 7) {
      // 检查最近一次周摘要是否超过 5 天前
      const weeklyFiles = fs.existsSync(WEEKLY_DIR)
        ? fs.readdirSync(WEEKLY_DIR).filter(f => f.endsWith(".json")).sort().reverse()
        : [];

      let shouldGenWeekly = true;
      if (weeklyFiles.length > 0) {
        try {
          const latest = JSON.parse(fs.readFileSync(path.join(WEEKLY_DIR, weeklyFiles[0]), "utf-8"));
          const daysSince = (Date.now() - new Date(latest.createdAt).getTime()) / 86400000;
          if (daysSince < 5) shouldGenWeekly = false;
        } catch {}
      }

      if (shouldGenWeekly) {
        await generateWeeklyDigest();
      }
    }
  } catch (err) {
    console.error("[Memory] 记忆维护任务失败:", err.message);
  }
}

module.exports = {
  getInjectedMemoryPrompt,
  extractMemoryAsync,
  generateDailyDigest,
  generateWeeklyDigest,
  runMemoryMaintenance
};

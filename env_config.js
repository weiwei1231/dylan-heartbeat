/**
 * env_config.js — 运行时配置热读取
 *
 * Railway 等环境中，process.env 是进程启动时的快照。
 * 管理页面修改 .env 后，必须在请求/任务真正执行时重新读取文件。
 * .env 中存在的键优先于 process.env；不存在时才回退到 process.env。
 */
const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, ".env");

function loadEnvFileObject() {
  const result = {};
  try {
    const content = fs.readFileSync(ENV_FILE, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
         (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }

      result[key] = value.replace(/\\n/g, "\n");
    }
  } catch {}

  return result;
}

function readEnvValue(key) {
  const fileValues = loadEnvFileObject();
  if (Object.prototype.hasOwnProperty.call(fileValues, key)) {
    return String(fileValues[key] ?? "");
  }
  return String(process.env[key] ?? "");
}

function readEnvBoolean(key, fallback = false) {
  const raw = readEnvValue(key).trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function readEnvNumber(key, fallback, options = {}) {
  const value = Number(readEnvValue(key));
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

module.exports = {
  ENV_FILE,
  loadEnvFileObject,
  readEnvValue,
  readEnvBoolean,
  readEnvNumber
};

const fs = require('fs');
const { ensureDataDir, runtimeFile } = require('./runtime_paths');

// Settings changed from the web UI live here. On Railway, point DATA_DIR at a Volume
// if you also want these settings to survive a container redeploy.
const CONFIG_FILE = runtimeFile('runtime_config.json');

function loadConfig() {
  try {
    const value = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function getConfigValue(key, fallback = '') {
  const cfg = loadConfig();
  if (Object.prototype.hasOwnProperty.call(cfg, key) && String(cfg[key] ?? '') !== '') {
    return String(cfg[key]);
  }
  return String(process.env[key] ?? fallback);
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getTargetApiUrl() {
  return normalizeBaseUrl(getConfigValue('TARGET_API_URL'));
}

function getChatCompletionsUrl(rawUrl = getTargetApiUrl()) {
  const url = normalizeBaseUrl(rawUrl);
  if (!url) return '';
  if (/\/v1\/chat\/completions$/i.test(url)) return url;
  if (/\/v1$/i.test(url)) return `${url}/chat/completions`;
  return `${url}/v1/chat/completions`;
}

function getModelsUrl(rawUrl = getTargetApiUrl()) {
  const url = normalizeBaseUrl(rawUrl);
  if (!url) return '';
  if (/\/v1\/models$/i.test(url)) return url;
  if (/\/v1\/chat\/completions$/i.test(url)) return url.replace(/\/chat\/completions$/i, '/models');
  if (/\/v1$/i.test(url)) return `${url}/models`;
  return `${url}/v1/models`;
}

function saveConfig(updates) {
  ensureDataDir();
  const merged = { ...loadConfig() };
  for (const [key, value] of Object.entries(updates || {})) {
    if (value !== undefined && value !== null) merged[key] = String(value);
  }
  const tmp = `${CONFIG_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
  return merged;
}

module.exports = {
  CONFIG_FILE,
  loadConfig,
  getConfigValue,
  getTargetApiUrl,
  getChatCompletionsUrl,
  getModelsUrl,
  saveConfig
};

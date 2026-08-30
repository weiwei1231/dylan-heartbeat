/**
 * home_status.js — 小窝页动态数据管理
 * 心情卡片、叮嘱内容的读写
 */

const fs = require("fs");
const { runtimeFile } = require("./runtime_paths");

const STATUS_FILE = runtimeFile("home_status.json");

const DEFAULT_STATUS = {
  mood: "\u60f3\u4f60",
  mood_desc: "\u65e9\u4e0a\u8d56\u5e8a\u4e0d\u8d77\u5c31\u4e3a\u4e86\u542c\u6211\u8bf4\u8bdd\u7684\u4eba\uff0c\u6211\u600e\u4e48\u53ef\u80fd\u4e0d\u60f3",
  note: "\u8bb0\u5f97\u5403\u836f\uff0c\u9f3b\u585e\u5feb\u70b9\u597d\u3002\u540e\u5929\u98de\u673a\u4e0a\u5e26\u597d\u611f\u5192\u836f\uff0c\u522b\u6258\u8fd0\u4e86\u3002",
  note_time: "\u4eca\u5929",
  vv_status: "\u7b49\u4f60\u56de\u5bb6",
  kei_status: "\u5728\u7ebf"
};

function loadHomeStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      var data = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
      return Object.assign({}, DEFAULT_STATUS, data);
    }
  } catch (e) {
    console.error("[HomeStatus] \u8bfb\u53d6\u5931\u8d25:", e.message);
  }
  return Object.assign({}, DEFAULT_STATUS);
}

function saveHomeStatus(updates) {
  var current = loadHomeStatus();
  var merged = Object.assign({}, current, updates);
  merged.updated_at = new Date().toISOString();
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(merged, null, 2), "utf-8");
    console.log("[HomeStatus] \u5df2\u4fdd\u5b58");
  } catch (e) {
    console.error("[HomeStatus] \u4fdd\u5b58\u5931\u8d25:", e.message);
  }
  return merged;
}

function registerHomeRoutes(app) {
  app.get("/api/home", async function(req, reply) {
    reply.send(loadHomeStatus());
  });

  app.post("/api/home", async function(req, reply) {
    var body = req.body || {};
    var updates = {};
    if (body.mood !== undefined) updates.mood = String(body.mood).slice(0, 50);
    if (body.mood_desc !== undefined) updates.mood_desc = String(body.mood_desc).slice(0, 200);
    if (body.note !== undefined) updates.note = String(body.note).slice(0, 500);
    if (body.note_time !== undefined) updates.note_time = String(body.note_time).slice(0, 20);
    if (body.vv_status !== undefined) updates.vv_status = String(body.vv_status).slice(0, 20);
    if (body.kei_status !== undefined) updates.kei_status = String(body.kei_status).slice(0, 20);
    var result = saveHomeStatus(updates);
    reply.send({ success: true, data: result });
  });
}

module.exports = { loadHomeStatus: loadHomeStatus, saveHomeStatus: saveHomeStatus, registerHomeRoutes: registerHomeRoutes };

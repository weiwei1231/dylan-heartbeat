/**
 * chat_routes.js — kc 独立前端路由 + system prompt 注入 + 日记API
 */

var fs = require("fs");
var path = require("path");
var spMod = require("./system_prompt");
var rtPaths = require("./runtime_paths");
var homeMod = require("./home_status");

var PUBLIC_DIR = path.join(__dirname, "public");

var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function getDiaryDir() {
  var dirName = process.env.DIARY_DIR || "diary";
  return rtPaths.runtimeDirectory(dirName, "diary");
}

function registerChatRoutes(app) {
  app.get("/chat", async function(req, reply) {
    var htmlPath = path.join(PUBLIC_DIR, "index.html");
    try {
      var html = fs.readFileSync(htmlPath, "utf-8");
      reply.type("text/html").send(html);
    } catch (err) {
      reply.code(500).send("\u524d\u7aef\u9875\u9762\u672a\u627e\u5230: " + err.message);
    }
  });

  app.get("/", async function(req, reply) {
    reply.redirect("/chat");
  });

  // 静态文件服务
  app.get("/:filename", async function(req, reply) {
    var filename = req.params.filename;
    var ext = path.extname(filename).toLowerCase();
    var mime = MIME_TYPES[ext];
    if (!mime) return;
    var filePath = path.join(PUBLIC_DIR, filename);
    if (!filePath.startsWith(PUBLIC_DIR)) { reply.code(403).send("Forbidden"); return; }
    try { var content = fs.readFileSync(filePath); reply.type(mime).send(content); } catch (err) {}
  });

  // 日记列表API
  app.get("/api/diary", async function(req, reply) {
    var dir = getDiaryDir();
    try {
      if (!fs.existsSync(dir)) { reply.send({ entries: [] }); return; }
      var files = fs.readdirSync(dir).filter(function(n) { return /^\d{4}-\d{2}-\d{2}\.md$/i.test(n); }).sort().reverse().slice(0, 30);
      var entries = files.map(function(name) {
        var filePath = path.join(dir, name);
        var content = fs.readFileSync(filePath, "utf-8").slice(0, 10000);
        return { date: name.replace(".md", ""), content: content };
      });
      reply.send({ entries: entries });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // 小窝动态数据API
  homeMod.registerHomeRoutes(app);
}

function injectSystemPrompt(llmMessages) {
  var prompt = spMod.loadSystemPrompt();
  var idx = llmMessages.findIndex(function(m) { return m.role === "system"; });
  if (idx !== -1) { llmMessages[idx] = { role: "system", content: prompt }; }
  else { llmMessages.unshift({ role: "system", content: prompt }); }
}

function buildUpstreamBody(originalBody, llmMessages) {
  var modelName = String(process.env.MODEL_NAME || "gateway-model").trim() || "gateway-model";
  return Object.assign({}, originalBody, { model: modelName, messages: llmMessages });
}

module.exports = { registerChatRoutes: registerChatRoutes, injectSystemPrompt: injectSystemPrompt, buildUpstreamBody: buildUpstreamBody };

/**
 * chat_routes.js — kc 独立前端路由 + system prompt 注入
 */

const fs = require("fs");
const path = require("path");
const { loadSystemPrompt } = require("./system_prompt");

const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function registerChatRoutes(app) {
  // 聊天页面
  app.get("/chat", async (req, reply) => {
    var htmlPath = path.join(PUBLIC_DIR, "index.html");
    try {
      var html = fs.readFileSync(htmlPath, "utf-8");
      reply.type("text/html").send(html);
    } catch (err) {
      reply.code(500).send("前端页面未找到: " + err.message);
    }
  });

  // 根路径重定向到聊天页
  app.get("/", async (req, reply) => {
    reply.redirect("/chat");
  });

  // 静态文件服务：/style.css, /app.js 等
  app.get("/:filename", async (req, reply) => {
    var filename = req.params.filename;
    var ext = path.extname(filename).toLowerCase();
    var mime = MIME_TYPES[ext];
    if (!mime) return; // 不认识的扩展名跳过，交给后续路由
    var filePath = path.join(PUBLIC_DIR, filename);
    // 防止路径穿越
    if (!filePath.startsWith(PUBLIC_DIR)) {
      reply.code(403).send("Forbidden");
      return;
    }
    try {
      var content = fs.readFileSync(filePath);
      reply.type(mime).send(content);
    } catch (err) {
      // 文件不存在，不处理，让后续路由接手
    }
  });
}

/**
 * 在发往上游之前，替换或插入后端管理的 system prompt
 */
function injectSystemPrompt(llmMessages) {
  var prompt = loadSystemPrompt();
  var idx = llmMessages.findIndex(function(m) { return m.role === "system"; });
  if (idx !== -1) {
    llmMessages[idx] = { role: "system", content: prompt };
  } else {
    llmMessages.unshift({ role: "system", content: prompt });
  }
}

/**
 * 构建发给上游的请求 body，替换 model 为后端配置的 MODEL_NAME
 */
function buildUpstreamBody(originalBody, llmMessages) {
  var modelName = String(process.env.MODEL_NAME || "gateway-model").trim() || "gateway-model";
  return Object.assign({}, originalBody, { model: modelName, messages: llmMessages });
}

module.exports = { registerChatRoutes, injectSystemPrompt, buildUpstreamBody };

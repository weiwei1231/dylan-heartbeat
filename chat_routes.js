/**
 * chat_routes.js — kc 独立前端路由 + system prompt 注入
 */

const fs = require("fs");
const path = require("path");
const { loadSystemPrompt } = require("./system_prompt");

function registerChatRoutes(app) {
  // 聊天页面
  app.get("/chat", async (req, reply) => {
    const htmlPath = path.join(__dirname, "public", "index.html");
    try {
      const html = fs.readFileSync(htmlPath, "utf-8");
      reply.type("text/html").send(html);
    } catch (err) {
      reply.code(500).send("前端页面未找到: " + err.message);
    }
  });

  // 根路径重定向到聊天页
  app.get("/", async (req, reply) => {
    reply.redirect("/chat");
  });
}

/**
 * 在发往上游之前，替换或插入后端管理的 system prompt
 * @param {Array} llmMessages - 准备发给 LLM 的消息数组（会被原地修改）
 */
function injectSystemPrompt(llmMessages) {
  const prompt = loadSystemPrompt();
  const idx = llmMessages.findIndex(m => m.role === "system");
  if (idx !== -1) {
    llmMessages[idx] = { role: "system", content: prompt };
  } else {
    llmMessages.unshift({ role: "system", content: prompt });
  }
}

module.exports = { registerChatRoutes, injectSystemPrompt };

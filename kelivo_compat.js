/**
 * Kelivo URL 兼容补丁
 * Kelivo 拼接 Base URL 和 API 路径时会吃掉中间的斜杠，
 * 导致请求打到 /v1chat/completions 而非 /v1/chat/completions。
 * 直接注册别名路由，让两个路径走同一个处理函数。
 */

function kelivoCompat(app, chatHandler) {
  // 注册别名路由：/v1chat/completions -> 和 /v1/chat/completions 同一个handler
  app.post("/v1chat/completions", chatHandler);
  // /v1models -> 同 /v1/models
  app.get("/v1models", async (req, reply) => {
    const MODEL_NAME = String(process.env.MODEL_NAME || "gateway-model").trim() || "gateway-model";
    reply.send({
      object: "list",
      data: [{ id: MODEL_NAME, object: "model", created: 0, owned_by: "gateway" }]
    });
  });
}

module.exports = { kelivoCompat };

/**
 * Kelivo URL 兼容补丁
 * Kelivo 拼接 Base URL 和 API 路径时会吃掉中间的斜杠，
 * 导致请求打到 /v1chat/completions 而非 /v1/chat/completions。
 *
 * 方案：注册别名路由，用 app.inject() 内部转发。
 * 必须在 /v1/chat/completions 路由注册之后调用。
 */

function kelivoCompat(app) {
  // POST /v1chat/completions -> 内部转发到 /v1/chat/completions
  app.post("/v1chat/completions", async (req, reply) => {
    const payload = JSON.stringify(req.body);
    const forwardHeaders = {
      "content-type": "application/json",
      "authorization": req.headers.authorization || "",
      "x-api-key": req.headers["x-api-key"] || ""
    };

    const result = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: forwardHeaders,
      payload
    });

    // 检查是否是 SSE 流式响应
    const ct = result.headers["content-type"] || "";
    reply.code(result.statusCode).header("content-type", ct);

    if (ct.includes("text/event-stream")) {
      // 流式响应直传
      reply.header("cache-control", "no-cache");
      reply.header("connection", "keep-alive");
    }

    return reply.send(result.rawPayload);
  });

  // GET /v1models -> 内部转发到 /v1/models
  app.get("/v1models", async (req, reply) => {
    const result = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        "authorization": req.headers.authorization || "",
        "x-api-key": req.headers["x-api-key"] || ""
      }
    });
    reply
      .code(result.statusCode)
      .header("content-type", result.headers["content-type"] || "application/json")
      .send(result.rawPayload);
  });
}

module.exports = { kelivoCompat };

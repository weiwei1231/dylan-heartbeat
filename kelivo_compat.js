/**
 * Kelivo URL 兼容补丁
 * Kelivo 拼接 Base URL 和 API 路径时会吃掉中间的斜杠，
 * 导致请求打到 /v1chat/completions 而非 /v1/chat/completions。
 *
 * 方案：注册别名路由，用 app.inject() 内部转发。
 * 注意：必须在 /v1/chat/completions 路由注册之后调用。
 */

function kelivoCompat(app) {
  // POST /v1chat/completions -> 内部转发到 /v1/chat/completions
  app.post("/v1chat/completions", async (req, reply) => {
    const result = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: req.headers,
      payload: req.body
    });
    reply
      .code(result.statusCode)
      .headers(Object.fromEntries(
        Object.entries(result.headers).filter(([k]) =>
          !["transfer-encoding", "content-length", "connection"].includes(k.toLowerCase())
        )
      ))
      .send(result.rawPayload);
  });

  // GET /v1models -> 内部转发到 /v1/models
  app.get("/v1models", async (req, reply) => {
    const result = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: req.headers
    });
    reply
      .code(result.statusCode)
      .headers(Object.fromEntries(
        Object.entries(result.headers).filter(([k]) =>
          !["transfer-encoding", "content-length", "connection"].includes(k.toLowerCase())
        )
      ))
      .send(result.rawPayload);
  });
}

module.exports = { kelivoCompat };

/**
 * Kelivo URL 兼容补丁
 * Kelivo 拼接 Base URL 和 API 路径时会吃掉中间的斜杠，
 * 导致请求打到 /v1chat/completions 而非 /v1/chat/completions。
 * 这个插件注册一个 redirect/rewrite 把错误路径转发到正确路径。
 */

function kelivoCompat(app) {
  // 把 /v1chat/completions 重写到 /v1/chat/completions
  app.post("/v1chat/completions", async (req, reply) => {
    // 内部转发：复用已注册的 /v1/chat/completions 处理器
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: req.headers,
      payload: req.body
    });

    reply
      .code(response.statusCode)
      .headers(response.headers)
      .send(response.payload);
  });

  // 同样处理 /v1models
  app.get("/v1models", async (req, reply) => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: req.headers
    });

    reply
      .code(response.statusCode)
      .headers(response.headers)
      .send(response.payload);
  });
}

module.exports = { kelivoCompat };

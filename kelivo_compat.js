/**
 * Kelivo URL 兼容补丁
 * Kelivo 拼接 Base URL 和 API 路径时会吃掉中间的斜杠，
 * 导致请求打到 /v1chat/completions 而非 /v1/chat/completions。
 * 这里用 Fastify 的 rewrite 钩子在路由匹配前修正 URL。
 */

function kelivoCompat(app) {
  app.addHook("onRequest", (req, reply, done) => {
    // /v1chat/completions -> /v1/chat/completions
    if (req.url === "/v1chat/completions" || req.url.startsWith("/v1chat/completions?")) {
      req.raw.url = req.url.replace("/v1chat/completions", "/v1/chat/completions");
    }
    // /v1models -> /v1/models
    if (req.url === "/v1models" || req.url.startsWith("/v1models?")) {
      req.raw.url = req.url.replace("/v1models", "/v1/models");
    }
    done();
  });
}

module.exports = { kelivoCompat };

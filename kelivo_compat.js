/**
 * Kelivo URL 兼容补丁
 * Kelivo 拼接 Base URL 和 API 路径时会吃掉中间的斜杠，
 * 导致请求打到 /v1chat/completions 而非 /v1/chat/completions。
 * 用 onRequest hook 在路由匹配前重写 URL。
 */

function kelivoCompat(app) {
  app.addHook("onRequest", (req, reply, done) => {
    const url = req.raw.url || "";
    if (url.startsWith("/v1chat/completions")) {
      req.raw.url = url.replace("/v1chat/completions", "/v1/chat/completions");
    } else if (url.startsWith("/v1models")) {
      req.raw.url = url.replace("/v1models", "/v1/models");
    }
    done();
  });
}

module.exports = { kelivoCompat };

/**
 * Kelivo URL 兼容补丁
 * 必须在安全 hook 之前注册，这样 URL 重写先于鉴权检查。
 */

function kelivoCompat(app) {
  app.addHook("onRequest", (req, reply, done) => {
    const url = req.raw.url || req.url;
    if (url.startsWith("/v1chat/completions")) {
      req.raw.url = url.replace("/v1chat/completions", "/v1/chat/completions");
    } else if (url.startsWith("/v1models")) {
      req.raw.url = url.replace("/v1models", "/v1/models");
    }
    done();
  });
}

module.exports = { kelivoCompat };

function normalizedIp(value) {
  return String(value || "").replace(/^::ffff:/, "");
}

function isLoopbackIp(value) {
  var ip = normalizedIp(value);
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

function isPrivateIp(value) {
  var ip = normalizedIp(value);
  return isLoopbackIp(ip) || /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
}

function isPublicStaticFile(requestPath) {
  return /^\/(style\.css|app\.js|favicon\.ico|manifest\.json|icon[^/]*\.png)$/.test(requestPath);
}

function isPublicApiRead(requestPath) {
  return requestPath === "/api/home" || requestPath === "/api/diary";
}

function decideRequestAccess(opts) {
  var requestPath = String(opts.path || "").split("?")[0];
  if (requestPath.startsWith("/admin") || requestPath === "/healthz" || requestPath === "/test-bark" || requestPath === "/chat" || requestPath === "/") return { allow: true };
  if (isPublicStaticFile(requestPath)) return { allow: true };
  if (isPublicApiRead(requestPath)) return { allow: true };

  if (requestPath.startsWith("/internal/")) {
    return isLoopbackIp(opts.ip) ? { allow: true } : { allow: false, status: 403, error: "Forbidden" };
  }

  if (requestPath === "/api/home" && opts.method === "POST") {
    // POST /api/home needs admin auth — handled by admin routes
  }

  if (opts.allowPublicApi && (requestPath.startsWith("/v1/") || requestPath.startsWith("/v1c") || requestPath.startsWith("/v1m") || requestPath.startsWith("/api/"))) {
    if (!opts.configuredKey) return { allow: false, status: 401, error: "GATEWAY_API_KEY \u672a\u914d\u7f6e", authRejected: true };
    var bearer = String(opts.authorization || "").match(/^Bearer\s+(.+)$/i);
    bearer = bearer ? bearer[1].trim() : "";
    var alternate = String(opts.headerKey || "").trim();
    if (bearer === opts.configuredKey || alternate === opts.configuredKey) return { allow: true };
    return {
      allow: false,
      status: 401,
      error: "Gateway API Key \u65e0\u6548\u6216\u7f3a\u5931",
      authRejected: true,
      authSource: bearer ? "bearer" : alternate ? "x-api-key" : "missing"
    };
  }

  if (isLoopbackIp(opts.ip) || (!opts.isRailway && isPrivateIp(opts.ip))) return { allow: true };
  return { allow: false, status: 403, error: "Forbidden" };
}

module.exports = { decideRequestAccess: decideRequestAccess, isLoopbackIp: isLoopbackIp, isPrivateIp: isPrivateIp };

/**
 * Proteções HTTP do painel: cabeçalhos de segurança e bloqueio de requisições vindas de outros sites
 */

/**
 * A requisição veio do próprio painel?
 * Navegadores sempre mandam "Origin" em requisições entre sites; sem ele, é o próprio site ou uma ferramenta (curl).
 */
export function isSameOrigin(req, publicUrl = "") {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (publicUrl && origin === publicUrl) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Cabeçalhos de segurança para todas as respostas
 */
export function securityHeaders({ hsts = false } = {}) {
  return (req, res, next) => {
    const host = req.headers.host ?? "";
    res.set({
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data: blob:",
        `connect-src 'self' wss://${host} ws://${host}`,
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "X-Robots-Tag": "noindex, nofollow",
    });
    if (hsts) res.set("Strict-Transport-Security", "max-age=31536000");
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    next();
  };
}

/**
 * Bloqueia ações (POST/PATCH/PUT/DELETE) vindas de outros sites (CSRF).
 * Além da origem, exige corpo JSON: formulários de outros sites não conseguem enviar JSON.
 */
export function blockCrossSite({ publicUrl = "" } = {}) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (!isSameOrigin(req, publicUrl)) {
      return res.status(403).json({ error: "Requisição de outro site bloqueada" });
    }
    if (req.method !== "DELETE" && !req.is("application/json")) {
      return res.status(415).json({ error: "Envie os dados em JSON" });
    }
    return next();
  };
}

/**
 * Nome amigável do aparelho a partir do User-Agent (ex.: "Chrome no Windows")
 */
export function describeDevice(userAgent = "") {
  const ua = String(userAgent);
  const browser =
    /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const system =
    /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return system ? `${browser} no ${system}` : browser;
}

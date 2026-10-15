import crypto from "crypto";
import logger from "../utils/logger.js";

const COOKIE = "crm_session";
const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest();

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value !== undefined)
      .map(([key, ...rest]) => [key, decodeURIComponent(rest.join("="))])
  );
}

/**
 * Login com senha única + sessão em cookie httpOnly
 */
export function createAuth({ store, password, cookieSecure = false, sessionDays = 30 }) {
  let secret = password;
  if (!secret) {
    secret = store.getSecret("generated_password");
    if (!secret) {
      secret = crypto.randomBytes(9).toString("base64url");
      store.setSecret("generated_password", secret);
    }
    logger.warn(`🔑 Senha do painel: ${secret}  (defina CRM_PASSWORD no arquivo .env para escolher a sua)`);
  }
  const expected = sha256(secret);

  // Bloqueia tentativas de senha em sequência (por IP)
  const attempts = new Map();
  const MAX_ATTEMPTS = 5;
  const LOCK_MS = 5 * 60 * 1000;

  const tokenHash = (token) => sha256(token).toString("hex");
  const sessionFrom = (cookieHeader) => {
    const token = parseCookies(cookieHeader)[COOKIE];
    return token && store.hasWebSession(tokenHash(token)) ? token : null;
  };

  function login(req, res) {
    const ip = req.ip;
    const entry = attempts.get(ip);
    if (entry && entry.count >= MAX_ATTEMPTS && entry.until > Date.now()) {
      return res.status(429).json({ error: "Muitas tentativas. Tente novamente em alguns minutos." });
    }

    const given = sha256(req.body?.password ?? "");
    if (!crypto.timingSafeEqual(given, expected)) {
      const count = (entry && entry.until > Date.now() ? entry.count : 0) + 1;
      attempts.set(ip, { count, until: Date.now() + LOCK_MS });
      logger.warn("Tentativa de login com senha incorreta", { ip });
      return res.status(401).json({ error: "Senha incorreta" });
    }

    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString("base64url");
    const maxAge = sessionDays * 24 * 60 * 60 * 1000;
    store.createWebSession(tokenHash(token), Date.now() + maxAge);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: cookieSecure, maxAge, path: "/" });
    return res.json({ ok: true });
  }

  function logout(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) store.deleteWebSession(tokenHash(token));
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  }

  function requireAuth(req, res, next) {
    if (sessionFrom(req.headers.cookie)) return next();
    return res.status(401).json({ error: "Faça login novamente" });
  }

  function isAuthenticated(req) {
    return Boolean(sessionFrom(req.headers.cookie));
  }

  function socketAuth(socket, next) {
    if (sessionFrom(socket.handshake.headers.cookie)) return next();
    return next(new Error("unauthorized"));
  }

  return { login, logout, requireAuth, isAuthenticated, socketAuth };
}

export default createAuth;

import crypto from "crypto";
import logger from "../utils/logger.js";
import { describeDevice, isSameOrigin } from "./security.js";

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest();
const MIN_PRODUCTION_PASSWORD = 12;

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value !== undefined)
      .map(([key, ...rest]) => {
        try {
          return [key, decodeURIComponent(rest.join("="))];
        } catch {
          return [key, ""];
        }
      })
  );
}

/**
 * Limite de tentativas de senha: por IP e no total (contra ataques vindos de muitos IPs)
 */
function createLoginLimiter({ now = Date.now, perIp = 5, global = 30, windowMs = 15 * 60 * 1000 } = {}) {
  const byIp = new Map();
  let failures = [];

  const prune = () => {
    const limit = now() - windowMs;
    failures = failures.filter((time) => time > limit);
    for (const [ip, times] of byIp) {
      const recent = times.filter((time) => time > limit);
      if (recent.length) byIp.set(ip, recent);
      else byIp.delete(ip);
    }
  };

  return {
    blocked(ip) {
      prune();
      return (byIp.get(ip)?.length ?? 0) >= perIp || failures.length >= global;
    },
    fail(ip) {
      prune();
      failures.push(now());
      byIp.set(ip, [...(byIp.get(ip) ?? []), now()]);
    },
    succeed(ip) {
      byIp.delete(ip);
    },
  };
}

/**
 * Se a senha mudou desde a última execução, encerra todas as sessões abertas com a senha antiga
 */
function invalidateSessionsOnPasswordChange(store, secret) {
  const stored = store.getSecret("password_check");
  const matches = (check) => {
    const hash = crypto.scryptSync(secret, Buffer.from(check.salt, "base64"), 32);
    return crypto.timingSafeEqual(hash, Buffer.from(check.hash, "base64"));
  };

  if (stored && matches(stored)) return;

  if (stored) {
    const closed = store.deleteOtherWebSessions(null).length;
    if (closed) logger.warn(`🔑 A senha do painel mudou: ${closed} sessão(ões) aberta(s) com a senha antiga foram encerradas.`);
  }
  const salt = crypto.randomBytes(16);
  store.setSecret("password_check", {
    salt: salt.toString("base64"),
    hash: crypto.scryptSync(secret, salt, 32).toString("base64"),
  });
}

/**
 * Login com senha única + sessões em cookie HttpOnly (uma por aparelho/navegador)
 */
export function createAuth({ store, password, production = false, cookieSecure = false, sessionDays = 30, publicUrl = "", now = Date.now }) {
  let secret = password;

  if (production && (!secret || secret.length < MIN_PRODUCTION_PASSWORD)) {
    throw new Error(`Em produção, defina CRM_PASSWORD no .env com pelo menos ${MIN_PRODUCTION_PASSWORD} caracteres.`);
  }
  if (!secret) {
    secret = store.getSecret("generated_password");
    if (!secret) {
      secret = crypto.randomBytes(9).toString("base64url");
      store.setSecret("generated_password", secret);
    }
    logger.warn(`🔑 Senha do painel: ${secret}  (defina CRM_PASSWORD no arquivo .env para escolher a sua)`);
  }
  if (production && !cookieSecure) {
    logger.warn("⚠️ Produção sem COOKIE_SECURE=true: o cookie de login pode trafegar sem HTTPS.");
  }

  invalidateSessionsOnPasswordChange(store, secret);
  const expected = sha256(secret);

  // Com HTTPS usa o prefixo __Host-, que impede o cookie de ser alterado por subdomínios
  const cookieName = cookieSecure ? "__Host-crm_session" : "crm_session";
  const cookieOptions = { httpOnly: true, sameSite: "lax", secure: cookieSecure, path: "/" };
  const limiter = createLoginLimiter({ now });
  const tokenHash = (token) => sha256(token).toString("hex");

  const sessionFrom = (cookieHeader, ip) => {
    const token = parseCookies(cookieHeader)[cookieName];
    if (!token) return null;
    const hash = tokenHash(token);
    const session = store.getWebSession(hash, { ip });
    return session ? { ...session, token_hash: hash } : null;
  };

  async function login(req, res) {
    const ip = req.ip;
    if (limiter.blocked(ip)) {
      logger.warn("Login bloqueado por excesso de tentativas", { ip });
      return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos e tente de novo." });
    }

    const given = sha256(req.body?.password ?? "");
    if (!crypto.timingSafeEqual(given, expected)) {
      limiter.fail(ip);
      logger.warn("Tentativa de login com senha incorreta", { ip });
      // Atraso fixo para desacelerar tentativas automáticas
      await new Promise((resolve) => setTimeout(resolve, 400));
      return res.status(401).json({ error: "Senha incorreta" });
    }

    limiter.succeed(ip);
    const token = crypto.randomBytes(32).toString("base64url");
    const maxAge = sessionDays * 24 * 60 * 60 * 1000;
    store.createWebSession(tokenHash(token), now() + maxAge, { userAgent: req.headers["user-agent"], ip });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge });
    logger.info("🔓 Novo login no painel", { ip, device: describeDevice(req.headers["user-agent"]) });
    return res.json({ ok: true });
  }

  function logout(req, res) {
    const session = sessionFrom(req.headers.cookie);
    if (session) store.deleteWebSession(session.token_hash);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  }

  function requireAuth(req, res, next) {
    const session = sessionFrom(req.headers.cookie, req.ip);
    if (!session) return res.status(401).json({ error: "Faça login novamente" });
    req.session = session;
    return next();
  }

  function isAuthenticated(req) {
    return Boolean(sessionFrom(req.headers.cookie));
  }

  function socketAuth(socket, next) {
    if (!isSameOrigin(socket.request, publicUrl)) return next(new Error("forbidden"));
    const session = sessionFrom(socket.handshake.headers.cookie);
    if (!session) return next(new Error("unauthorized"));
    socket.data.sessionHash = session.token_hash;
    return next();
  }

  return { login, logout, requireAuth, isAuthenticated, socketAuth, cookieName };
}

export default createAuth;

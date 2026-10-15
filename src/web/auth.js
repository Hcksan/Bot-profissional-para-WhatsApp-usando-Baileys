import crypto from "crypto";
import logger from "../utils/logger.js";
import { badRequest } from "../utils/errors.js";
import { describeDevice, isSameOrigin } from "./security.js";
import { emailProblem, fakeVerify, hashPassword, normalizeEmail, passwordProblem, verifyPassword } from "./password.js";
import { createAccounts } from "./accounts.js";

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
 * Login com e-mail e senha (contas com Argon2id) + sessões em cookie HttpOnly (uma por aparelho/navegador).
 * A primeira conta é criada pelo próprio painel ("Primeiro acesso"), confirmada pelo código de configuração
 * (CRM_PASSWORD no .env). Depois que existe uma conta, o código não serve mais para entrar.
 */
export function createAuth({ store, password, production = false, cookieSecure = false, sessionDays = 30, publicUrl = "", now = Date.now, workspaces = null }) {
  let setupCode = password;

  if (store.countUsers() === 0) {
    if (production && (!setupCode || setupCode.length < MIN_PRODUCTION_PASSWORD)) {
      throw new Error(`Em produção, defina CRM_PASSWORD no .env com pelo menos ${MIN_PRODUCTION_PASSWORD} caracteres (é o código do primeiro acesso).`);
    }
    if (!setupCode) {
      setupCode = store.getSecret("generated_password");
      if (!setupCode) {
        setupCode = crypto.randomBytes(9).toString("base64url");
        store.setSecret("generated_password", setupCode);
      }
      logger.warn(`🔑 Código do primeiro acesso: ${setupCode}  (defina CRM_PASSWORD no arquivo .env para escolher o seu)`);
    }
    logger.info("👤 Nenhuma conta criada ainda: abra o painel e use \"Primeiro acesso\" para criar a sua.");
  }
  if (production && !cookieSecure) {
    logger.warn("⚠️ Produção sem COOKIE_SECURE=true: o cookie de login pode trafegar sem HTTPS.");
  }

  // Com HTTPS usa o prefixo __Host-, que impede o cookie de ser alterado por subdomínios
  const cookieName = cookieSecure ? "__Host-crm_session" : "crm_session";
  const cookieOptions = { httpOnly: true, sameSite: "lax", secure: cookieSecure, path: "/" };
  const limiter = createLoginLimiter({ now });
  const accounts = createAccounts({ store, now, workspaces });
  const tokenHash = (token) => sha256(token).toString("hex");
  const text = (value, max) => (typeof value === "string" && value.length <= max ? value : "");
  // Atraso fixo depois de um erro, para desacelerar tentativas automáticas
  const slowDown = () => new Promise((resolve) => setTimeout(resolve, 400));

  const sessionFrom = (cookieHeader, ip) => {
    const token = parseCookies(cookieHeader)[cookieName];
    if (!token) return null;
    const hash = tokenHash(token);
    const session = store.getWebSession(hash, { ip });
    return session ? { ...session, token_hash: hash } : null;
  };

  const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });

  function startSession(req, res, user) {
    const token = crypto.randomBytes(32).toString("base64url");
    const maxAge = sessionDays * 24 * 60 * 60 * 1000;
    store.createWebSession(tokenHash(token), now() + maxAge, { userId: user.id, userAgent: req.headers["user-agent"], ip: req.ip });
    store.touchUserLogin(user.id);
    res.cookie(cookieName, token, { ...cookieOptions, maxAge });
    logger.info("🔓 Novo login no painel", { user: user.email, ip: req.ip, device: describeDevice(req.headers["user-agent"]) });
    return res.json({ ok: true, user: publicUser(user) });
  }

  function tooManyAttempts(req, res) {
    if (!limiter.blocked(req.ip)) return false;
    logger.warn("Login bloqueado por excesso de tentativas", { ip: req.ip });
    res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos e tente de novo." });
    return true;
  }

  async function login(req, res) {
    if (tooManyAttempts(req, res)) return;

    const email = normalizeEmail(text(req.body?.email, 254));
    const given = text(req.body?.password, 128);
    const user = email ? store.getUserWithPassword(email) : null;
    // Sem conta com esse e-mail, gasta o mesmo tempo de uma conferência real
    const ok = user ? await verifyPassword(user.password_hash, given) : (await fakeVerify(given), false);

    if (!ok) {
      limiter.fail(req.ip);
      logger.warn("Tentativa de login com e-mail ou senha incorretos", { ip: req.ip });
      await slowDown();
      return res.status(401).json({ error: "E-mail ou senha inválidos" });
    }

    limiter.succeed(req.ip);
    if (user.status !== "active") return res.status(403).json({ error: "Conta bloqueada. Fale com o administrador do CRM." });
    return startSession(req, res, user);
  }

  /**
   * Primeiro acesso com o código do administrador (também serve para redefinir a senha), etapa 1:
   * confere e-mail + código e devolve o nome para a pessoa confirmar
   */
  async function verifyActivation(req, res) {
    if (tooManyAttempts(req, res)) return;
    try {
      const { user } = accounts.checkActivation(text(req.body?.email, 254), text(req.body?.code, 40));
      return res.json({ name: user.name, email: user.email });
    } catch (error) {
      limiter.fail(req.ip);
      await slowDown();
      throw error;
    }
  }

  /**
   * Etapa 2: a pessoa confirma o nome, cria a senha e já entra
   */
  async function completeActivation(req, res) {
    if (tooManyAttempts(req, res)) return;
    let user;
    try {
      user = await accounts.completeActivation({
        email: text(req.body?.email, 254),
        code: text(req.body?.code, 40),
        name: text(req.body?.name, 120),
        password: req.body?.password,
      });
    } catch (error) {
      if (/Código|tentativas/.test(error.message)) {
        limiter.fail(req.ip);
        await slowDown();
      }
      throw error;
    }
    limiter.succeed(req.ip);
    logger.success(`👤 Primeiro acesso concluído: ${user.email}`);
    return startSession(req, res, user);
  }

  /**
   * Primeiro acesso: cria a conta (só enquanto não existe nenhuma) e já entra
   */
  async function setup(req, res) {
    if (store.countUsers() > 0) return res.status(409).json({ error: "A conta já foi criada. Entre com seu e-mail e senha." });
    if (tooManyAttempts(req, res)) return;

    const code = sha256(text(req.body?.code, 200));
    if (!setupCode || !crypto.timingSafeEqual(code, sha256(setupCode))) {
      limiter.fail(req.ip);
      logger.warn("Primeiro acesso com código incorreto", { ip: req.ip });
      await slowDown();
      return res.status(401).json({ error: "Código de primeiro acesso incorreto" });
    }

    const name = text(req.body?.name, 120).trim();
    const email = normalizeEmail(text(req.body?.email, 254));
    const newPassword = req.body?.password;
    const problem = (name.length < 2 && "Informe seu nome") || emailProblem(email) || passwordProblem(newPassword);
    if (problem) return res.status(400).json({ error: problem });

    const passwordHash = await hashPassword(newPassword);
    // Confere de novo depois do hash: outra requisição pode ter criado a conta nesse meio-tempo
    if (store.countUsers() > 0) return res.status(409).json({ error: "A conta já foi criada. Entre com seu e-mail e senha." });
    // A primeira conta fica com o espaço 1 (os dados e o WhatsApp que já existiam)
    const user = store.createUser({ name, email, passwordHash, role: "admin", workspaceId: store.getWorkspace(1) ? 1 : null });
    limiter.succeed(req.ip);
    logger.success(`👤 Conta criada: ${user.email}`);
    return startSession(req, res, user);
  }

  /**
   * Troca a senha da conta logada e encerra as sessões dos outros aparelhos. Devolve os hashes encerrados.
   */
  async function changePassword(session, { currentPassword, newPassword } = {}) {
    const hash = store.getUserPasswordHash(session.user_id);
    if (!hash || !(await verifyPassword(hash, text(currentPassword, 128)))) {
      await slowDown();
      throw badRequest("Senha atual incorreta");
    }
    const problem = passwordProblem(newPassword);
    if (problem) throw badRequest(problem);
    if (newPassword === currentPassword) throw badRequest("A nova senha deve ser diferente da atual");

    store.setUserPassword(session.user_id, await hashPassword(newPassword));
    logger.info("🔑 Senha da conta alterada", { user: session.user_id });
    return store.deleteOtherWebSessions(session.user_id, session.token_hash);
  }

  function logout(req, res) {
    const session = sessionFrom(req.headers.cookie);
    if (session) store.deleteWebSession(session.token_hash);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  }

  function requireAuth(req, res, next) {
    const session = sessionFrom(req.headers.cookie, req.ip);
    const user = session && store.getUser(session.user_id);
    if (!user) return res.status(401).json({ error: "Faça login novamente" });
    req.session = session;
    req.user = user;
    return next();
  }

  /**
   * Situação para a tela inicial: logado? falta criar a primeira conta?
   */
  function status(req) {
    const session = sessionFrom(req.headers.cookie);
    const user = session && store.getUser(session.user_id);
    if (user) return { authenticated: true, user: publicUser(user) };
    return { authenticated: false, setupRequired: store.countUsers() === 0 };
  }

  function socketAuth(socket, next) {
    if (!isSameOrigin(socket.request, publicUrl)) return next(new Error("forbidden"));
    const session = sessionFrom(socket.handshake.headers.cookie);
    const user = session && store.getUser(session.user_id);
    if (!user) return next(new Error("unauthorized"));
    socket.data.sessionHash = session.token_hash;
    socket.data.workspaceId = user.workspace_id;
    return next();
  }

  return { login, setup, verifyActivation, completeActivation, changePassword, logout, requireAuth, status, socketAuth, cookieName, accounts };
}

export default createAuth;

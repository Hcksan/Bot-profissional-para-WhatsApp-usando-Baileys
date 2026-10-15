import crypto from "crypto";
import AppError, { badRequest } from "../utils/errors.js";
import { emailProblem, hashPassword, normalizeEmail, passwordProblem } from "./password.js";

/**
 * Contas criadas pelo administrador e códigos de primeiro acesso (mesmo modelo do MyLife):
 * 8 caracteres legíveis (sem 0/O, 1/I/L), válidos por 7 dias, 5 tentativas erradas.
 * O mesmo código serve para quem esqueceu a senha: o administrador gera um novo.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ACTIVATION_TTL_DAYS = 7;
const MAX_ATTEMPTS = 5;
const ROLES = ["admin", "member"];
const INVALID = "Código inválido ou expirado. Confira o e-mail e o código ou peça um novo ao administrador.";

export const normalizeCode = (code) => String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const forbidden = (message) => new AppError(403, message);

export function createAccounts({ store, now = Date.now }) {
  // Chave do servidor para o HMAC dos códigos (o banco guarda só o hash)
  let key = store.getSecret("activation_key");
  if (!key) {
    key = crypto.randomBytes(32).toString("base64");
    store.setSecret("activation_key", key);
  }
  const hashCode = (code) => crypto.createHmac("sha256", key).update(`activation:${normalizeCode(code)}`).digest("hex");

  function issueCode(userId) {
    const chars = Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
    const code = `${chars.slice(0, 4)}-${chars.slice(4)}`;
    const expiresAt = now() + ACTIVATION_TTL_DAYS * 24 * 60 * 60 * 1000;
    store.saveActivationCode(userId, hashCode(code), expiresAt);
    return { code, expires_at: expiresAt };
  }

  /**
   * Confere e-mail + código. Erros sempre genéricos (não revelam se o e-mail existe).
   */
  function checkActivation(email, code) {
    const user = store.getUserWithPassword(normalizeEmail(email));
    if (!user || user.status === "blocked") throw badRequest(INVALID);
    const active = store.activeActivationCode(user.id);
    if (!active) throw badRequest(INVALID);

    const expected = Buffer.from(active.code_hash, "hex");
    const received = Buffer.from(hashCode(code), "hex");
    if (!crypto.timingSafeEqual(expected, received)) {
      const attempts = store.failActivationCode(active.id, MAX_ATTEMPTS);
      throw badRequest(attempts >= MAX_ATTEMPTS ? "Muitas tentativas com código errado. Peça um novo código ao administrador." : INVALID);
    }
    return { user: store.getUser(user.id), codeId: active.id };
  }

  async function completeActivation({ email, code, name, password }) {
    const { user, codeId } = checkActivation(email, code);
    const cleanName = String(name ?? "").trim();
    const problem = (cleanName.length < 2 && "Informe seu nome") || passwordProblem(password);
    if (problem) throw badRequest(problem);
    const passwordHash = await hashPassword(password);
    if (!store.completeActivation(codeId, user.id, { name: cleanName, passwordHash })) throw badRequest("Este código já foi utilizado");
    return store.getUser(user.id);
  }

  // ───────── Administração (só administradores chegam aqui) ─────────

  function createUser(admin, { name, email, role = "member" } = {}) {
    const cleanName = String(name ?? "").trim();
    const cleanEmail = normalizeEmail(email);
    const problem = (cleanName.length < 2 && "Informe o nome") || emailProblem(cleanEmail) || (!ROLES.includes(role) && "Papel inválido");
    if (problem) throw badRequest(problem);
    const user = store.createUser({ name: cleanName, email: cleanEmail, role, status: "pending", createdBy: admin.id });
    return { user, ...issueCode(user.id) };
  }

  function newCode(userId) {
    const user = store.requireUser(userId);
    if (user.status === "blocked") throw badRequest("Desbloqueie a conta antes de gerar um código");
    return issueCode(user.id);
  }

  /**
   * Muda papel ou situação. Devolve { user, revoked } com as sessões encerradas (bloqueio).
   */
  function updateUser(admin, userId, { role, status } = {}) {
    const user = store.requireUser(userId);
    if (role !== undefined && !ROLES.includes(role)) throw badRequest("Papel inválido");
    if (status !== undefined && !["active", "blocked"].includes(status)) throw badRequest("Situação inválida");
    if (!role && !status) throw badRequest("Nada para alterar");

    const isSelf = user.id === admin.id;
    if (isSelf && status === "blocked") throw badRequest("Você não pode bloquear a própria conta");
    if (isSelf && role === "member") throw badRequest("Você não pode tirar o próprio acesso de administrador");
    const losesAdmin = user.role === "admin" && user.status === "active" && (role === "member" || status === "blocked");
    if (losesAdmin && store.countActiveAdmins() <= 1) throw badRequest("O CRM precisa de pelo menos um administrador ativo");

    // Desbloquear quem nunca criou senha volta para "aguardando primeiro acesso"
    const nextStatus = status === "active" && !store.getUserPasswordHash(user.id) ? "pending" : status;
    const updated = store.updateUser(user.id, { role, status: nextStatus });
    const revoked = status === "blocked" ? store.deleteUserWebSessions(user.id) : [];
    return { user: updated, revoked };
  }

  /**
   * Remove a conta. Devolve as sessões encerradas.
   */
  function deleteUser(admin, userId) {
    const user = store.requireUser(userId);
    if (user.id === admin.id) throw badRequest("Você não pode remover a própria conta");
    if (user.role === "admin" && user.status === "active" && store.countActiveAdmins() <= 1) {
      throw badRequest("O CRM precisa de pelo menos um administrador ativo");
    }
    const revoked = store.deleteUserWebSessions(user.id);
    store.deleteUser(user.id);
    return revoked;
  }

  function requireAdmin(req, res, next) {
    if (req.user?.role !== "admin") return next(forbidden("Só administradores podem gerenciar as contas"));
    return next();
  }

  return { checkActivation, completeActivation, createUser, newCode, updateUser, deleteUser, requireAdmin };
}

export default createAccounts;

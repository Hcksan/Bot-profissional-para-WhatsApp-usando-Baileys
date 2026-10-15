import argon2 from "argon2";

/**
 * Senhas das contas do painel: Argon2id com os parâmetros recomendados pela OWASP
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hashPassword(password) {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Hash "falso" usado para equalizar o tempo de resposta quando o e-mail não existe
// (evita descobrir quais e-mails têm conta pelo tempo da resposta)
let dummyHash = null;
export async function fakeVerify(password) {
  dummyHash ??= argon2.hash("dummy-password-for-timing", OPTIONS);
  await verifyPassword(await dummyHash, password);
}

export const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();

/**
 * Regras de senha (iguais às do MyLife). Devolve a mensagem de erro, ou null se estiver ok.
 */
export function passwordProblem(password) {
  if (typeof password !== "string" || password.length < 8) return "A senha deve ter no mínimo 8 caracteres";
  if (password.length > 128) return "Senha muito longa";
  if (!/[A-Za-z]/.test(password)) return "A senha deve conter letras";
  if (!/\d/.test(password)) return "A senha deve conter números";
  return null;
}

export function emailProblem(email) {
  if (!email || email.length > 254 || !EMAIL.test(email)) return "E-mail inválido";
  return null;
}

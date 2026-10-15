/**
 * Contas do painel pela linha de comando (para quando não dá para entrar pelo navegador).
 *
 * Uso, na VM, dentro de /opt/crm:
 *   sudo runuser -u crm -- node deploy/user.mjs list
 *   sudo runuser -u crm -- node deploy/user.mjs reset-password voce@email.com
 *
 * "reset-password" gera uma senha nova, mostra na tela uma única vez e encerra todas as sessões da conta.
 */
import crypto from "crypto";
import path from "path";
import { openDatabase } from "../src/db/database.js";
import { CrmStore } from "../src/crm/CrmStore.js";
import { hashPassword, normalizeEmail } from "../src/web/password.js";

const [command, emailArg] = process.argv.slice(2);
const store = new CrmStore(openDatabase(path.join(process.env.DATA_DIR || "./data", "crm.db")));
const date = (ms) => (ms ? new Date(ms).toLocaleString("pt-BR") : "nunca");

if (command === "list") {
  const users = store.listUsers();
  if (!users.length) console.log("Nenhuma conta criada ainda. Abra o painel e use \"Primeiro acesso\".");
  for (const user of users) {
    const role = user.role === "admin" ? "administrador" : "membro";
    const status = { active: "ativa", pending: "aguardando primeiro acesso", blocked: "bloqueada" }[user.status];
    console.log(`#${user.id}  ${user.name} <${user.email}>  ${role}, ${status}  último login: ${date(user.last_login_at)}`);
  }
} else if (command === "reset-password" && emailArg) {
  const user = store.getUserWithPassword(normalizeEmail(emailArg));
  if (!user) {
    console.error(`Nenhuma conta com o e-mail ${emailArg}. Veja as contas com: node deploy/user.mjs list`);
    process.exit(1);
  }
  // 16 caracteres com letras e números (atende às regras de senha)
  const password = `${crypto.randomBytes(12).toString("base64url").replace(/[-_]/g, "x").slice(0, 14)}a1`;
  store.setUserPassword(user.id, await hashPassword(password));
  if (user.status === "pending") store.updateUser(user.id, { status: "active" });
  const closed = store.deleteOtherWebSessions(user.id, null).length;
  console.log(`Senha nova de ${user.email}: ${password}`);
  console.log(`(${closed} sessão(ões) encerrada(s). Entre com ela e troque em Configurações → Minha conta.)`);
} else {
  console.log("Uso: node deploy/user.mjs list | reset-password <email>");
  process.exit(command ? 1 : 0);
}

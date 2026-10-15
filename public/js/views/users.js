import { h, fill, icon, button, iconButton, pageHead, person, callout, openModal, field, toast, withBusy, confirmDialog, formatDateTime, timeAgo } from "../dom.js";
import { del, get, patch, post } from "../api.js";

/**
 * Usuários (só administradores): convidar pessoas com código de primeiro acesso, como no MyLife
 */
let root = null;

const ROLE = { admin: ["Administrador", "badge-primary"], member: ["Membro", ""] };

async function load() {
  render(await get("/users"));
}

function statusBadge(user) {
  if (user.status === "blocked") return h("span", { class: "badge badge-danger" }, icon("ban"), "Bloqueada");
  if (user.status === "pending") {
    return h(
      "span",
      { class: "badge badge-warning", title: user.activation_expires_at ? `Código válido até ${formatDateTime(user.activation_expires_at)}` : "Código expirado: gere um novo" },
      icon("hourglass"),
      user.activation_expires_at ? "Aguardando primeiro acesso" : "Código expirado"
    );
  }
  return h("span", { class: "badge badge-success" }, icon("circle-check"), "Ativa");
}

/**
 * Mostra o código gerado (uma única vez) com a mensagem pronta para enviar à pessoa
 */
function showCode(user, { code, expires_at: expiresAt }, { isNew }) {
  const url = location.origin;
  const message =
    `Olá, ${user.name.split(" ")[0]}! ${isNew ? "Criei seu acesso ao CRM." : "Aqui está um novo código de acesso ao CRM."}\n\n` +
    `1. Abra ${url}\n` +
    `2. Clique em "Primeiro acesso com código"\n` +
    `3. Use o e-mail ${user.email} e o código ${code}\n\n` +
    `O código vale até ${formatDateTime(expiresAt)}. Depois é só criar sua senha.`;

  const copy = (text, label) =>
    button(label, {
      icon: "copy",
      size: "sm",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast("Copiado");
        } catch {
          toast("Não foi possível copiar. Selecione o texto e copie manualmente.", "error");
        }
      },
    });

  const modal = openModal({
    title: isNew ? "Convite criado" : "Novo código gerado",
    body: [
      h("p", {}, "Envie o código para ", h("strong", {}, user.name), ". Ele aparece só agora: se perder, gere outro."),
      h("div", { class: "code-box" }, h("code", {}, code), copy(code, "Copiar código")),
      h("div", { class: "row" }, h("strong", { class: "grow" }, "Mensagem pronta"), copy(message, "Copiar mensagem")),
      h("div", { class: "invite-text" }, message),
    ],
    actions: [h("button", { class: "btn btn-primary", type: "button", onClick: () => modal.close() }, "Concluir")],
  });
}

function openInvite() {
  const name = h("input", { required: true, minlength: "2", maxlength: "120", autocomplete: "off", placeholder: "Nome da pessoa" });
  const email = h("input", { type: "email", required: true, maxlength: "254", autocomplete: "off", placeholder: "pessoa@email.com" });
  const roleOption = (value, title, text, checked = false) =>
    h("label", { class: "role-option" }, h("input", { type: "radio", name: "role", value, checked }), h("span", {}, h("strong", {}, title), h("small", {}, text)));
  const roles = h(
    "div",
    { class: "grid-2" },
    roleOption("member", "Membro", "Usa o CRM: contatos, Kanban, campanhas e agendamentos.", true),
    roleOption("admin", "Administrador", "Tudo do membro e também gerencia as contas.")
  );
  const error = h("p", { class: "form-error", role: "alert" });
  const save = button("Criar convite", { icon: "user-plus", variant: "primary", type: "submit", form: "invite-form" });

  const modal = openModal({
    title: "Convidar pessoa",
    body: h(
      "form",
      {
        id: "invite-form",
        class: "stack",
        onSubmit: (event) => {
          event.preventDefault();
          error.textContent = "";
          withBusy(save, async () => {
            try {
              const role = roles.querySelector("input:checked").value;
              const result = await post("/users", { name: name.value, email: email.value, role });
              modal.close();
              showCode(result.user, result, { isNew: true });
              load();
            } catch (err) {
              error.textContent = err.message;
            }
          });
        },
      },
      h("div", { class: "grid-2" }, field("Nome", name), field("E-mail", email, "É com ele que a pessoa vai entrar")),
      field("Permissão", roles),
      callout("A pessoa recebe um código de 8 letras e números, válido por 7 dias. No primeiro acesso ela confirma o nome e cria a própria senha.", { type: "info" }),
      error
    ),
    actions: [h("button", { class: "btn", type: "button", onClick: () => modal.close() }, "Cancelar"), save],
  });
  name.focus();
}

function actionsFor(user) {
  const run = (btn, fn) => withBusy(btn, async () => (await fn(), load()));
  const list = [];

  if (user.status !== "blocked") {
    const code = iconButton("key-round", user.status === "pending" ? "Gerar novo código de primeiro acesso" : "Gerar código para redefinir a senha");
    code.addEventListener("click", async () => {
      if (user.status === "active" && !(await confirmDialog(`Gerar um código para ${user.name} criar uma senha nova? A senha atual continua valendo até o código ser usado.`, { confirmText: "Gerar código" }))) return;
      withBusy(code, async () => {
        showCode(user, await post(`/users/${user.id}/activation-code`), { isNew: false });
        load();
      });
    });
    list.push(code);
  }
  if (user.is_me) return list;

  const promote = iconButton("shield-check", user.role === "admin" ? "Tornar membro" : "Tornar administrador");
  promote.addEventListener("click", () => run(promote, () => patch(`/users/${user.id}`, { role: user.role === "admin" ? "member" : "admin" })));
  list.push(promote);

  const block = iconButton(user.status === "blocked" ? "lock-open" : "ban", user.status === "blocked" ? "Desbloquear" : "Bloquear acesso");
  block.addEventListener("click", async () => {
    if (user.status !== "blocked" && !(await confirmDialog(`Bloquear ${user.name}? A pessoa sai do painel na hora e não consegue entrar até ser desbloqueada.`, { danger: true, confirmText: "Bloquear" }))) return;
    run(block, () => patch(`/users/${user.id}`, { status: user.status === "blocked" ? "active" : "blocked" }));
  });
  list.push(block);

  const remove = iconButton("trash-2", "Remover conta", { danger: true });
  remove.addEventListener("click", async () => {
    if (!(await confirmDialog(`Remover a conta de ${user.name}? Os contatos e campanhas do CRM não são apagados.`, { danger: true, confirmText: "Remover" }))) return;
    run(remove, () => del(`/users/${user.id}`));
  });
  list.push(remove);
  return list;
}

function render(users) {
  if (!root) return;
  const pending = users.filter((user) => user.status === "pending").length;
  fill(root, 
    pageHead("Usuários", `${users.length} conta(s)${pending ? ` · ${pending} aguardando primeiro acesso` : ""}`, button("Convidar pessoa", { icon: "user-plus", variant: "primary", onClick: openInvite })),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, h("th", {}, "Pessoa"), h("th", {}, "Permissão"), h("th", {}, "Situação"), h("th", {}, "Último acesso"), h("th", {}, ""))),
        h(
          "tbody",
          {},
          users.map((user) =>
            h(
              "tr",
              {},
              h("td", {}, h("div", { class: "row" }, person(user.name, user.email, { seed: user.email }), user.is_me ? h("span", { class: "badge" }, "você") : null)),
              h("td", {}, h("span", { class: `badge ${ROLE[user.role][1]}` }, ROLE[user.role][0])),
              h("td", {}, statusBadge(user)),
              h("td", { class: "nowrap muted", title: user.last_login_at ? formatDateTime(user.last_login_at) : "" }, user.last_login_at ? timeAgo(user.last_login_at) : "nunca"),
              h("td", { class: "actions" }, h("div", { class: "user-row-actions" }, actionsFor(user)))
            )
          )
        )
      )
    ),
    h(
      "div",
      { style: { marginTop: "16px" } },
      callout("Esqueceu a senha? Gere um código (ícone de chave) e envie para a pessoa: ela usa “Primeiro acesso com código” na tela de login e cria uma senha nova.", { type: "info", icon: "key-round" })
    )
  );
}

export default {
  async mount(container) {
    root = container;
    await load();
  },
  destroy() {
    root = null;
  },
};

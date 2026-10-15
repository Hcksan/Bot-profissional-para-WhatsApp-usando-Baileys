import { h, fill, icon, button, iconButton, pageHead, person, callout, openModal, field, toast, withBusy, confirmDialog, formatDateTime, timeAgo } from "../dom.js";
import { del, get, patch, post } from "../api.js";

/**
 * Usuários (só administradores): convidar pessoas com código de primeiro acesso, como no MyLife
 */
let root = null;

const ROLE = { admin: ["Administrador", "badge-primary"], member: ["Membro", ""] };
let myWorkspace = null;

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
    `3. Use o e-mail ${user.email} (exatamente assim) e o código ${code}\n\n` +
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
      isNew ? null : callout("Qualquer código enviado antes para esta pessoa deixou de funcionar. Mande só este.", { icon: "triangle-alert" }),
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
  const option = (group, value, title, text, checked = false) =>
    h("label", { class: "role-option" }, h("input", { type: "radio", name: group, value, checked }), h("span", {}, h("strong", {}, title), h("small", {}, text)));
  const spaces = h(
    "div",
    { class: "grid-2" },
    option("space", "own", "Espaço próprio", "Contatos, Kanban, campanhas e WhatsApp só dela. Ela conecta o próprio número.", true),
    option("space", "team", "Minha equipe", "Trabalha junto com você: vê os mesmos contatos e usa o mesmo WhatsApp.")
  );
  const roles = h(
    "div",
    { class: "grid-2" },
    option("role", "member", "Membro", "Usa o CRM normalmente.", true),
    option("role", "admin", "Administrador", "Também convida e gerencia as contas.")
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
              const space = spaces.querySelector("input:checked").value;
              const result = await post("/users", { name: name.value, email: email.value, role, space });
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
      field("Onde a pessoa vai trabalhar", spaces),
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
      const pendingCode = user.activation_expires_at ? ` O código enviado antes (válido até ${formatDateTime(user.activation_expires_at)}) deixa de funcionar.` : "";
      const question =
        user.status === "active"
          ? `Gerar um código para ${user.name} criar uma senha nova? A senha atual continua valendo até o código ser usado.${pendingCode}`
          : pendingCode && `Gerar um código novo para ${user.name}?${pendingCode}`;
      if (question && !(await confirmDialog(question, { title: "Gerar código", confirmText: "Gerar código" }))) return;
      withBusy(code, async () => {
        showCode(user, await post(`/users/${user.id}/activation-code`), { isNew: false });
        load();
      });
    });
    list.push(code);
  }
  if (user.is_me) return list;

  // Espaço de outra pessoa: o administrador pode entrar para ajudar
  if (user.workspace_id && user.workspace_id !== myWorkspace) {
    const enter = iconButton("eye", `Entrar no espaço de ${user.name} para ajudar`);
    enter.addEventListener("click", async () => {
      const ok = await confirmDialog(
        `Você vai ver e poder mexer nos contatos, campanhas, agendamentos e no WhatsApp de ${user.name}. A entrada fica registrada e aparece para ${user.name.split(" ")[0]} em Configurações.`,
        { title: "Entrar no espaço para ajudar", confirmText: "Entrar" }
      );
      if (!ok) return;
      withBusy(enter, async () => {
        await post("/workspace/switch", { workspace_id: user.workspace_id });
        location.hash = "#inicio";
        location.reload();
      });
    });
    list.push(enter);
  }

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
    const ownSpace = user.workspace_id !== myWorkspace && user.workspace_members <= 1;
    const message = ownSpace
      ? `Remover a conta de ${user.name}? O espaço dela é desligado: o WhatsApp dela é desconectado e os contatos e campanhas ficam guardados no servidor (pasta data/removidos).`
      : `Remover a conta de ${user.name}? Os contatos e campanhas da equipe continuam como estão.`;
    if (!(await confirmDialog(message, { danger: true, confirmText: "Remover" }))) return;
    run(remove, () => del(`/users/${user.id}`));
  });
  list.push(remove);
  return list;
}

function render(users) {
  if (!root) return;
  const pending = users.filter((user) => user.status === "pending").length;
  myWorkspace = users.find((user) => user.is_me)?.workspace_id ?? null;
  const spaceLabel = (user) =>
    user.workspace_id === myWorkspace
      ? h("span", { class: "badge badge-info", title: "Vê os mesmos contatos e usa o mesmo WhatsApp que você" }, icon("users-round"), user.is_me ? "Seu espaço" : "Sua equipe")
      : h("span", { class: "badge", title: user.workspace_members > 1 ? `${user.workspace_members} pessoas neste espaço` : "Dados e WhatsApp só desta pessoa" }, icon("lock"), "Espaço próprio");
  fill(root, 
    pageHead("Usuários", `${users.length} conta(s)${pending ? ` · ${pending} aguardando primeiro acesso` : ""}`, button("Convidar pessoa", { icon: "user-plus", variant: "primary", onClick: openInvite })),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, h("th", {}, "Pessoa"), h("th", {}, "Espaço"), h("th", {}, "Permissão"), h("th", {}, "Situação"), h("th", {}, "Último acesso"), h("th", {}, ""))),
        h(
          "tbody",
          {},
          users.map((user) =>
            h(
              "tr",
              {},
              h("td", {}, h("div", { class: "row" }, person(user.name, user.email, { seed: user.email }), user.is_me ? h("span", { class: "badge" }, "você") : null)),
              h("td", {}, spaceLabel(user)),
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
      h(
        "div",
        { class: "stack" },
        callout("Cada pessoa com “Espaço próprio” tem contatos, campanhas, agendamentos e WhatsApp separados: ninguém vê os dados de outro espaço, nem você.", { type: "info", icon: "lock" }),
        callout("Esqueceu a senha? Gere um código (ícone de chave) e envie para a pessoa: ela usa “Primeiro acesso com código” na tela de login e cria uma senha nova.", { type: "info", icon: "key-round" })
      )
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

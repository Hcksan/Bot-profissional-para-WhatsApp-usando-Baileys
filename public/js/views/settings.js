import { h, field, toast, withBusy, confirmDialog, formatDateTime, timeAgo } from "../dom.js";
import { del, get, patch, post } from "../api.js";
import { hooks, state } from "../state.js";

let root = null;

function render() {
  const settings = state.settings;
  const dailyLimit = h("input", { type: "number", min: "1", max: "1000", step: "1", value: String(settings.daily_limit), required: true });
  const keywords = h("input", { value: (settings.opt_out_keywords ?? []).join(", ") });
  const save = h("button", { class: "btn btn-primary", type: "submit" }, "Salvar");

  root.replaceChildren(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Configurações"))),
    h(
      "form",
      {
        class: "card stack",
        style: { maxWidth: "720px" },
        onSubmit: (event) => {
          event.preventDefault();
          withBusy(save, async () => {
            await patch("/settings", { daily_limit: Number(dailyLimit.value), opt_out_keywords: keywords.value });
            await hooks.reload();
            toast("Configurações salvas");
            render();
            root?.append(await sessionsCard());
          });
        },
      },
      h("h2", {}, "Envios"),
      field("Limite diário de mensagens de campanha", dailyLimit, "Somando todas as campanhas. Agendamentos e mensagens avulsas não contam. Comece baixo (30–50) e aumente aos poucos."),
      field("Palavras para sair da lista", keywords, "Se o contato responder exatamente uma destas palavras, ele é marcado como \"não quer receber\" e sai das campanhas."),
      h("div", { class: "row" }, save)
    ),
    h(
      "section",
      { class: "card stack", style: { maxWidth: "720px" } },
      h("h2", {}, "Boas práticas para não ter o número restringido"),
      h(
        "ul",
        { class: "steps" },
        h("li", {}, "Envie para pessoas que conhecem você e têm seu número salvo."),
        h("li", {}, "Use intervalos longos (45 s ou mais) e pausas a cada 10 mensagens."),
        h("li", {}, "Varie o texto com {Oi|Olá} e use o nome da pessoa."),
        h("li", {}, "Evite links logo na primeira mensagem para quem nunca falou com você."),
        h("li", {}, "Se muitas pessoas bloquearem ou denunciarem, o WhatsApp restringe o número. Nenhum intervalo evita isso.")
      ),
      h("p", { class: "muted small", style: { margin: 0 } }, "Este CRM usa a conexão do WhatsApp Web (não oficial). Seus dados ficam só no computador ou servidor onde o CRM roda, na pasta data/.")
    )
  );
}

/**
 * Aparelhos com login no painel (cada navegador tem a sua sessão)
 */
async function sessionsCard() {
  const card = h("section", { class: "card stack", style: { maxWidth: "720px" } });
  const sessions = await get("/sessions");
  const others = sessions.filter((session) => !session.current).length;

  const revokeOthers = h("button", { class: "btn btn-danger btn-sm", type: "button", disabled: others === 0 }, "Sair de todos os outros aparelhos");
  revokeOthers.addEventListener("click", async () => {
    if (!(await confirmDialog(`Encerrar ${others} sessão(ões) em outros aparelhos? Eles vão precisar da senha para entrar de novo.`, { danger: true, confirmText: "Encerrar" }))) return;
    await withBusy(revokeOthers, async () => {
      const { closed } = await post("/sessions/revoke-others");
      toast(`${closed} sessão(ões) encerrada(s)`);
      card.replaceWith(await sessionsCard());
    });
  });

  const rows = sessions.map((session) => {
    const end = h("button", { class: "btn btn-sm btn-ghost", type: "button" }, session.current ? "Sair" : "Encerrar");
    end.addEventListener("click", async () => {
      if (session.current) {
        document.querySelector("#logout-btn").click();
        return;
      }
      await withBusy(end, async () => {
        await del(`/sessions/${session.id}`);
        toast("Sessão encerrada");
        card.replaceWith(await sessionsCard());
      });
    });
    return h(
      "tr",
      {},
      h("td", {}, h("div", {}, session.device, " ", session.current ? h("span", { class: "badge badge-success" }, "este aparelho") : null), h("div", { class: "muted small" }, session.ip || "IP desconhecido")),
      h("td", { class: "nowrap" }, formatDateTime(session.created_at)),
      h("td", { class: "nowrap" }, session.current ? "agora" : timeAgo(session.last_seen_at)),
      h("td", { class: "actions" }, end)
    );
  });

  card.append(
    h("div", { class: "row" }, h("h2", { class: "grow" }, "Aparelhos conectados ao painel"), revokeOthers),
    h("p", { class: "muted small", style: { margin: 0 } }, "Você pode ficar logado em vários aparelhos ao mesmo tempo (PC, celular...). Se não reconhecer algum, encerre e troque a senha."),
    h(
      "div",
      { class: "table-wrap" },
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Aparelho"), h("th", {}, "Entrou em"), h("th", {}, "Último acesso"), h("th", {}, ""))), h("tbody", {}, rows))
    )
  );
  return card;
}

export default {
  async mount(container) {
    root = container;
    render();
    root.append(await sessionsCard());
  },
  destroy() {
    root = null;
  },
};

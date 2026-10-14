import { h, field, toast, withBusy } from "../dom.js";
import { patch } from "../api.js";
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
      h("p", { class: "muted small", style: { margin: 0 } }, "Este CRM usa a conexão do WhatsApp Web (não oficial). Seus dados ficam só neste computador, na pasta data/.")
    )
  );
}

export default {
  async mount(container) {
    root = container;
    render();
  },
  destroy() {
    root = null;
  },
};

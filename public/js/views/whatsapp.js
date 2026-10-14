import { h, withBusy, confirmDialog, formatDateTime, toast } from "../dom.js";
import { post } from "../api.js";
import { hooks, state } from "../state.js";

let root = null;

// O WhatsApp informa datas em segundos; aceita milissegundos também
const toMs = (value) => {
  const number = Number(value);
  return number < 1e12 ? number * 1000 : number;
};

function connectionCard(wa) {
  const restart = h("button", { class: "btn", type: "button" }, "Reconectar");
  restart.addEventListener("click", () => withBusy(restart, () => post("/whatsapp/restart")));

  const logout = h("button", { class: "btn btn-danger", type: "button" }, "Desconectar aparelho");
  logout.addEventListener("click", async () => {
    const ok = await confirmDialog("O CRM sai da lista de \"Aparelhos conectados\" do seu WhatsApp e será preciso ler o QR Code de novo.", {
      title: "Desconectar aparelho",
      danger: true,
      confirmText: "Desconectar",
    });
    if (ok) await withBusy(logout, () => post("/whatsapp/logout"));
  });

  const bodies = {
    open: [
      h("p", { class: "row", style: { margin: 0 } }, h("span", { class: "badge badge-success" }, "Conectado")),
      h("dl", { class: "kv" }, h("dt", {}, "Número"), h("dd", {}, wa.me?.phone ? `+${wa.me.phone}` : "—"), h("dt", {}, "Nome"), h("dd", {}, wa.me?.name || "—")),
      h("p", { class: "muted small", style: { margin: 0 } }, "Você continua usando o WhatsApp normalmente no celular. O CRM aparece como um aparelho conectado (Windows)."),
    ],
    qr: [
      h("p", { style: { margin: 0 } }, "Escaneie com o WhatsApp do celular:"),
      h("div", { class: "qr-box" }, wa.qr ? h("img", { src: wa.qr, alt: "QR Code para conectar o WhatsApp" }) : "Gerando..."),
      h(
        "ol",
        { class: "steps" },
        h("li", {}, "Abra o WhatsApp no celular"),
        h("li", {}, "Toque em ⋮ (Android) ou Configurações (iPhone) → Aparelhos conectados"),
        h("li", {}, "Toque em Conectar um aparelho e aponte para este QR Code")
      ),
    ],
    connecting: [h("p", { style: { margin: 0 } }, "Conectando ao WhatsApp...")],
    disconnected: [
      h("p", { style: { margin: 0 } }, "WhatsApp desconectado."),
      wa.lastError ? h("p", { class: "callout", style: { margin: 0 } }, wa.lastError) : h("p", { class: "muted", style: { margin: 0 } }, "Tentando reconectar automaticamente..."),
    ],
  };

  return h(
    "section",
    { class: "card stack" },
    h("h2", {}, "Conexão"),
    ...(bodies[wa.status] ?? bodies.disconnected),
    h("div", { class: "row" }, restart, wa.status === "open" ? logout : null)
  );
}

function limitsCard(wa) {
  const cap = wa.limits?.cap;
  const lock = wa.limits?.timelock;
  const refresh = h("button", { class: "btn btn-sm", type: "button", disabled: wa.status !== "open" }, "Atualizar");
  refresh.addEventListener("click", () =>
    withBusy(refresh, async () => {
      const limits = await post("/whatsapp/limits");
      state.whatsapp = { ...state.whatsapp, limits };
      render();
      toast("Limites atualizados");
    })
  );

  const sentToday = state.sent_today ?? 0;
  const dailyLimit = state.settings.daily_limit ?? 0;
  const pct = (used, total) => `${total ? Math.min(100, (used / total) * 100) : 0}%`;

  return h(
    "section",
    { class: "card stack" },
    h("div", { class: "row" }, h("h2", { class: "grow" }, "Limites"), refresh),
    h(
      "div",
      { class: "meter" },
      h("div", { class: "row" }, h("span", { class: "grow" }, "Campanhas hoje (seu limite)"), h("b", {}, `${sentToday} / ${dailyLimit}`)),
      h("div", { class: "progress" }, h("span", { class: "p-sent", style: { width: pct(sentToday, dailyLimit) } }))
    ),
    cap?.total_quota
      ? h(
          "div",
          { class: "meter" },
          h("div", { class: "row" }, h("span", { class: "grow" }, "Novas conversas (cota do WhatsApp)"), h("b", {}, `${cap.used_quota ?? 0} / ${cap.total_quota}`)),
          h("div", { class: "progress" }, h("span", { class: "p-sent", style: { width: pct(cap.used_quota ?? 0, cap.total_quota) } })),
          cap.cycle_end_timestamp ? h("span", { class: "muted small" }, `Renova em ${formatDateTime(toMs(cap.cycle_end_timestamp))}`) : null
        )
      : h("p", { class: "muted small", style: { margin: 0 } }, "O WhatsApp não informou cota de novas conversas para este número (normalmente significa que não há limite ativo)."),
    lock?.isActive
      ? h(
          "p",
          { class: "callout", style: { margin: 0 } },
          `⛔ O WhatsApp aplicou um bloqueio temporário para iniciar conversas${lock.timeEnforcementEnds ? ` até ${formatDateTime(new Date(lock.timeEnforcementEnds).getTime())}` : ""}. As campanhas ficam pausadas.`
        )
      : h("p", { class: "muted small", style: { margin: 0 } }, "Nenhum bloqueio temporário de envio informado pelo WhatsApp.")
  );
}

function render() {
  if (!root) return;
  const wa = state.whatsapp ?? { status: "disconnected" };
  root.replaceChildren(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "WhatsApp"), h("p", { class: "muted" }, "Conexão do seu número com o CRM"))),
    h("div", { class: "wa-layout" }, connectionCard(wa), limitsCard(wa))
  );
}

export default {
  async mount(container) {
    root = container;
    await hooks.reload();
    render();
  },
  onWhatsApp() {
    render();
  },
  onChanged() {
    render();
  },
  destroy() {
    root = null;
  },
};

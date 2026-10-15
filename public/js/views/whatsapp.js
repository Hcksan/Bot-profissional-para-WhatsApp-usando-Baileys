import { h, icon, button, pageHead, callout, withBusy, confirmDialog, formatDateTime, toast } from "../dom.js";
import { post } from "../api.js";
import { hooks, state } from "../state.js";

let root = null;

// O WhatsApp informa datas em segundos; aceita milissegundos também
const toMs = (value) => {
  const number = Number(value);
  return number < 1e12 ? number * 1000 : number;
};

function connectionCard(wa) {
  const restart = button("Reconectar", { icon: "refresh-cw" });
  restart.addEventListener("click", () => withBusy(restart, () => post("/whatsapp/restart")));

  const logout = button("Desconectar aparelho", { icon: "log-out", variant: "danger" });
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
      h(
        "div",
        { class: "wa-hero" },
        h("span", { class: "icon-bubble green" }, icon("circle-check")),
        h("div", {}, h("h2", {}, "WhatsApp conectado"), h("p", { class: "muted" }, wa.me?.name || "Tudo funcionando"))
      ),
      h("dl", { class: "kv" }, h("dt", {}, "Número"), h("dd", {}, wa.me?.phone ? `+${wa.me.phone}` : "—"), h("dt", {}, "Nome"), h("dd", {}, wa.me?.name || "—")),
      h("p", { class: "muted small", style: { margin: 0 } }, "Você continua usando o WhatsApp normalmente no celular. O CRM aparece como um aparelho conectado (Windows)."),
    ],
    qr: [
      h(
        "div",
        { class: "wa-hero" },
        h("span", { class: "icon-bubble amber" }, icon("qr-code")),
        h("div", {}, h("h2", {}, "Leia o QR Code"), h("p", { class: "muted" }, "Use o WhatsApp do celular que vai ficar ligado ao CRM"))
      ),
      h("div", { class: "qr-box" }, wa.qr ? h("img", { src: wa.qr, alt: "QR Code para conectar o WhatsApp" }) : "Gerando..."),
      h(
        "ol",
        { class: "steps" },
        h("li", {}, "Abra o WhatsApp no celular"),
        h("li", {}, "Toque em ⋮ (Android) ou Configurações (iPhone) → Aparelhos conectados"),
        h("li", {}, "Toque em Conectar um aparelho e aponte para este QR Code")
      ),
    ],
    connecting: [
      h("div", { class: "wa-hero" }, h("span", { class: "icon-bubble amber" }, icon("loader-circle")), h("div", {}, h("h2", {}, "Conectando..."), h("p", { class: "muted" }, "Isso leva só alguns segundos"))),
    ],
    disconnected: [
      h("div", { class: "wa-hero" }, h("span", { class: "icon-bubble red" }, icon("smartphone")), h("div", {}, h("h2", {}, "WhatsApp desconectado"), h("p", { class: "muted" }, "Tentando reconectar automaticamente..."))),
      wa.lastError ? callout(wa.lastError) : null,
    ],
  };

  return h(
    "section",
    { class: "card stack" },
    ...(bodies[wa.status] ?? bodies.disconnected),
    h("div", { class: "row" }, restart, wa.status === "open" ? logout : null)
  );
}

function limitsCard(wa) {
  const cap = wa.limits?.cap;
  const lock = wa.limits?.timelock;
  const refresh = button("Atualizar", { icon: "refresh-cw", size: "sm", disabled: wa.status !== "open" });
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
    h("div", { class: "card-head", style: { marginBottom: 0 } }, h("span", { class: "icon-bubble" }, icon("send")), h("h2", {}, "Limites de envio"), refresh),
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
      ? callout(`O WhatsApp aplicou um bloqueio temporário para iniciar conversas${lock.timeEnforcementEnds ? ` até ${formatDateTime(new Date(lock.timeEnforcementEnds).getTime())}` : ""}. As campanhas ficam pausadas.`)
      : h("p", { class: "muted small", style: { margin: 0 } }, "Nenhum bloqueio temporário de envio informado pelo WhatsApp.")
  );
}

function render() {
  if (!root) return;
  const wa = state.whatsapp ?? { status: "disconnected" };
  root.replaceChildren(
    pageHead("WhatsApp", "Conexão do seu número com o CRM"),
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

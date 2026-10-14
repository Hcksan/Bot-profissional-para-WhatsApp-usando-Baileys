import { h, withBusy, confirmDialog, formatPhone, formatDateTime } from "../dom.js";
import { del, get, post } from "../api.js";
import { openScheduleModal } from "./contactModal.js";

let root = null;

const STATUS = {
  pending: { label: "Agendada", badge: "badge-info" },
  sent: { label: "Enviada", badge: "badge-success" },
  failed: { label: "Falhou", badge: "badge-danger" },
  canceled: { label: "Cancelada", badge: "" },
};

const RECURRENCE = { none: "—", daily: "Todo dia", weekly: "Toda semana", monthly: "Todo mês" };

async function load() {
  const schedules = await get("/schedules");
  render(schedules);
}

function render(schedules) {
  const rows = schedules.map((schedule) => {
    const late = schedule.status === "pending" && schedule.send_at < Date.now();
    const cancel = h("button", { class: "btn btn-sm", type: "button" }, "Cancelar");
    cancel.addEventListener("click", () => withBusy(cancel, async () => (await post(`/schedules/${schedule.id}/cancel`), load())));
    const remove = h("button", { class: "btn btn-sm btn-ghost", type: "button" }, "Excluir");
    remove.addEventListener("click", async () => {
      if (!(await confirmDialog("Excluir este agendamento?", { danger: true, confirmText: "Excluir" }))) return;
      await withBusy(remove, async () => (await del(`/schedules/${schedule.id}`), load()));
    });

    return h(
      "tr",
      {},
      h("td", {}, h("div", {}, schedule.contact_name || "Sem nome"), h("div", { class: "muted small" }, formatPhone(schedule.contact_phone))),
      h("td", { style: { maxWidth: "380px" } }, h("div", { class: "small", style: { whiteSpace: "pre-wrap" } }, schedule.text)),
      h("td", { class: "nowrap" }, formatDateTime(schedule.send_at), late ? h("div", { class: "small", style: { color: "var(--warning)" } }, "aguardando conexão") : null),
      h("td", { class: "nowrap" }, RECURRENCE[schedule.recurrence], schedule.sent_count ? h("div", { class: "muted small" }, `${schedule.sent_count}× enviada`) : null),
      h(
        "td",
        {},
        h("span", { class: `badge ${STATUS[schedule.status].badge}` }, STATUS[schedule.status].label),
        schedule.last_error ? h("div", { class: "small", style: { color: "var(--danger)" } }, schedule.last_error) : null
      ),
      h("td", { class: "actions" }, schedule.status === "pending" ? cancel : remove)
    );
  });

  root.replaceChildren(
    h(
      "div",
      { class: "page-head" },
      h("div", {}, h("h1", {}, "Agendamentos"), h("p", { class: "muted" }, "Mensagens programadas para um contato, uma vez ou repetindo.")),
      h("span", { class: "spacer" }),
      h("button", { class: "btn btn-primary", type: "button", onClick: () => openScheduleModal({ onSaved: load }) }, "+ Agendar mensagem")
    ),
    schedules.length
      ? h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, h("th", {}, "Contato"), h("th", {}, "Mensagem"), h("th", {}, "Quando"), h("th", {}, "Repetir"), h("th", {}, "Status"), h("th", {}, ""))),
            h("tbody", {}, rows)
          )
        )
      : h(
          "div",
          { class: "empty" },
          h("h2", {}, "Nenhuma mensagem agendada"),
          h("p", {}, "Agende lembretes, cobranças ou felicitações para enviar automaticamente."),
          h("button", { class: "btn btn-primary", type: "button", onClick: () => openScheduleModal({ onSaved: load }) }, "Agendar mensagem")
        )
  );
}

export default {
  async mount(container) {
    root = container;
    await load();
  },
  onChanged(types) {
    if (types.includes("schedules") || types.includes("messages")) load();
  },
  destroy() {
    root = null;
  },
};

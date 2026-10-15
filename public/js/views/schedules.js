import { h, icon, button, pageHead, emptyState, person, withBusy, confirmDialog, formatPhone, formatDateTime } from "../dom.js";
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
    const cancel = button("Cancelar", { icon: "x", size: "sm" });
    cancel.addEventListener("click", () => withBusy(cancel, async () => (await post(`/schedules/${schedule.id}/cancel`), load())));
    const remove = button("Excluir", { icon: "trash-2", size: "sm", variant: "ghost" });
    remove.addEventListener("click", async () => {
      if (!(await confirmDialog("Excluir este agendamento?", { danger: true, confirmText: "Excluir" }))) return;
      await withBusy(remove, async () => (await del(`/schedules/${schedule.id}`), load()));
    });

    return h(
      "tr",
      {},
      h("td", {}, person(schedule.contact_name || "Sem nome", formatPhone(schedule.contact_phone), { seed: schedule.contact_phone })),
      h("td", { style: { maxWidth: "380px" } }, h("div", { class: "small", style: { whiteSpace: "pre-wrap" } }, schedule.text)),
      h("td", { class: "nowrap" }, h("span", { class: "row", style: { gap: "6px" } }, icon("clock", { size: 15 }), formatDateTime(schedule.send_at)), late ? h("div", { class: "small", style: { color: "var(--warning)" } }, "aguardando conexão") : null),
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
    pageHead(
      "Agendamentos",
      "Mensagens programadas para um contato, uma vez ou repetindo.",
      button("Agendar mensagem", { icon: "plus", variant: "primary", onClick: () => openScheduleModal({ onSaved: load }) })
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
      : emptyState({
          icon: "calendar-clock",
          title: "Nenhuma mensagem agendada",
          text: "Agende lembretes, cobranças ou felicitações para enviar automaticamente, uma vez ou repetindo.",
          action: button("Agendar mensagem", { icon: "plus", variant: "primary", onClick: () => openScheduleModal({ onSaved: load }) }),
        })
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

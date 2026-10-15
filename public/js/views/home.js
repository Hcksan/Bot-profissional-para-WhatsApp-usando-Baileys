import { h, icon, button, person, emptyState, formatPhone, formatDateTime, timeAgo } from "../dom.js";
import { get } from "../api.js";
import { state } from "../state.js";
import { openContact, openNewContact } from "./contactModal.js";

/**
 * Início: resumo do dia, funil do Kanban, quem espera resposta, campanhas e próximos agendamentos
 */
let root = null;
let data = null;
let reloadTimer = null;

async function load() {
  data = await get("/dashboard");
  render();
}

const scheduleReload = () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => root && load().catch(() => {}), 500);
};

function greeting() {
  const hour = new Date().getHours();
  const first = (state.user?.name ?? "").split(" ")[0];
  const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return first ? `${hello}, ${first}!` : `${hello}!`;
}

function stat({ label, value, suffix, foot, iconName, tone = "", href }) {
  return h(
    href ? "a" : "div",
    { class: "card stat", href },
    h("div", { class: "stat-top" }, h("span", { class: "stat-label" }, label), h("span", { class: `icon-bubble ${tone}` }, icon(iconName))),
    h("div", { class: "stat-value" }, String(value), suffix ? h("small", {}, ` ${suffix}`) : null),
    foot ? h("div", { class: "stat-foot" }, foot) : null
  );
}

function cardHead(title, iconName, more) {
  return h(
    "div",
    { class: "card-head" },
    h("span", { class: "icon-bubble" }, icon(iconName)),
    h("h2", {}, title),
    more ? h("a", { class: "link-more", href: more.href }, more.label, icon("arrow-right")) : null
  );
}

function whatsappHero(wa) {
  if (wa.status === "open") return null;
  const texts = {
    qr: ["Falta só ler o QR Code", "Abra o WhatsApp no celular e conecte o CRM para enviar e receber mensagens."],
    connecting: ["Conectando ao WhatsApp...", "Isso leva só alguns segundos."],
    disconnected: ["Conecte seu WhatsApp", "Sem a conexão, campanhas e agendamentos ficam parados."],
  };
  const [title, text] = texts[wa.status] ?? texts.disconnected;
  return h(
    "section",
    { class: "hero" },
    h("span", { class: "icon-bubble" }, icon("smartphone")),
    h("div", { class: "hero-text" }, h("h2", {}, title), h("p", {}, text)),
    h("a", { class: "btn", href: "#whatsapp" }, icon("qr-code"), "Conectar agora")
  );
}

function funnelCard() {
  const counts = new Map(data.contacts.by_stage.map((row) => [row.stage_id, row.total]));
  const rows = state.stages.map((stage) => ({ stage, total: counts.get(stage.id) ?? 0 }));
  const noStage = counts.get(null) ?? 0;
  if (noStage) rows.push({ stage: { name: "Sem etapa", color: "var(--muted)" }, total: noStage });
  const max = Math.max(1, ...rows.map((row) => row.total));

  return h(
    "section",
    { class: "card" },
    cardHead("Funil do Kanban", "square-kanban", { href: "#kanban", label: "Abrir Kanban" }),
    data.contacts.total
      ? h(
          "div",
          { class: "funnel" },
          rows.map(({ stage, total }) => {
            const bar = h("span", {});
            bar.style.width = `${(total / max) * 100}%`;
            bar.style.background = stage.color;
            return h(
              "a",
              { class: "funnel-row", href: "#kanban", title: `${total} contato(s) em ${stage.name}` },
              h("span", { class: "funnel-name" }, h("span", { class: "dot", style: { background: stage.color } }), h("span", {}, stage.name)),
              h("span", { class: "funnel-bar" }, bar),
              h("span", { class: "funnel-count" }, String(total))
            );
          })
        )
      : emptyState({ compact: true, title: "Nenhum contato ainda", text: "Cadastre ou importe contatos para ver o funil." })
  );
}

function awaitingCard() {
  return h(
    "section",
    { class: "card" },
    cardHead("Esperando sua resposta", "message-square-reply", data.contacts.awaiting > data.awaiting.length ? { href: "#kanban", label: "Ver todos" } : null),
    data.awaiting.length
      ? h(
          "div",
          { class: "list" },
          data.awaiting.map((contact) =>
            h(
              "button",
              { class: "list-item", type: "button", onClick: () => openContact(contact.id, { onSaved: load }) },
              person(contact.name || formatPhone(contact.phone), contact.name ? formatPhone(contact.phone) : null, { seed: contact.phone }),
              h("span", { class: "meta" }, timeAgo(contact.last_inbound_at))
            )
          )
        )
      : emptyState({ compact: true, title: "Tudo respondido", text: "Quando alguém mandar mensagem e você ainda não tiver respondido, aparece aqui." })
  );
}

function campaignsCard() {
  const LABEL = { running: ["Em andamento", "badge-success"], paused: ["Pausada", "badge-warning"], draft: ["Rascunho", ""] };
  return h(
    "section",
    { class: "card" },
    cardHead("Campanhas", "megaphone", { href: "#campanhas", label: "Ver todas" }),
    data.campaigns.length
      ? h(
          "div",
          { class: "stack" },
          data.campaigns.map((campaign) => {
            const [label, badge] = LABEL[campaign.status];
            const bar = h("span", { class: "p-sent" });
            bar.style.width = `${campaign.total ? (campaign.sent / campaign.total) * 100 : 0}%`;
            return h(
              "a",
              { class: "stack-sm", href: "#campanhas", style: { textDecoration: "none" } },
              h("div", { class: "row" }, h("strong", { class: "grow ellipsis" }, campaign.name), h("span", { class: `badge ${badge}` }, label)),
              h("div", { class: "progress" }, bar),
              h("span", { class: "muted small" }, `${campaign.sent} de ${campaign.total} enviadas`)
            );
          })
        )
      : emptyState({
          compact: true,
          title: "Nenhuma campanha em aberto",
          action: h("a", { class: "btn btn-sm btn-soft", href: "#campanhas" }, icon("plus"), "Criar campanha"),
        })
  );
}

function schedulesCard() {
  return h(
    "section",
    { class: "card" },
    cardHead("Próximos agendamentos", "calendar-clock", { href: "#agendamentos", label: "Ver todos" }),
    data.schedules.next.length
      ? h(
          "div",
          { class: "list" },
          data.schedules.next.map((schedule) =>
            h(
              "button",
              { class: "list-item", type: "button", onClick: () => openContact(schedule.contact_id, { onSaved: load }) },
              h("span", { class: "icon-bubble blue" }, icon("clock")),
              h(
                "span",
                { class: "person-text grow" },
                h("strong", {}, schedule.contact_name || formatPhone(schedule.contact_phone)),
                h("span", { class: "preview-text" }, schedule.text)
              ),
              h("span", { class: "meta" }, formatDateTime(schedule.send_at))
            )
          )
        )
      : emptyState({ compact: true, title: "Nada agendado", text: "Agende lembretes e mensagens a partir de um contato." })
  );
}

function checklist(wa) {
  const steps = [
    { done: wa.status === "open", title: "Conectar o WhatsApp", text: "Ler o QR Code com o celular", href: "#whatsapp" },
    { done: data.contacts.total > 0, title: "Adicionar contatos", text: "Cadastrar ou importar uma planilha", href: "#contatos" },
    { done: data.campaigns.length > 0, title: "Criar a primeira campanha", text: "Uma mensagem para vários contatos", href: "#campanhas" },
  ];
  if (steps.every((step) => step.done)) return null;
  return h(
    "section",
    { class: "card" },
    cardHead("Primeiros passos", "rocket"),
    h(
      "div",
      { class: "checklist" },
      steps.map((step, index) =>
        h(
          "a",
          { href: step.href, class: step.done ? "done" : "" },
          h("span", { class: "step-dot" }, step.done ? icon("check", { size: 14 }) : String(index + 1)),
          h("span", { class: "step-text" }, h("strong", {}, step.title), h("small", {}, step.text)),
          icon("chevron-right")
        )
      )
    )
  );
}

function render() {
  if (!root || !data) return;
  const wa = state.whatsapp ?? data.whatsapp ?? { status: "disconnected" };
  const limit = data.settings.daily_limit ?? 0;
  const sentPct = limit ? Math.min(100, Math.round((data.campaign_sent_today / limit) * 100)) : 0;
  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  root.replaceChildren(
    h(
      "div",
      { class: "page-head" },
      h("div", {}, h("h1", {}, greeting()), h("p", {}, today.charAt(0).toUpperCase() + today.slice(1))),
      h(
        "div",
        { class: "actions" },
        button("Contato", { icon: "user-plus", onClick: () => openNewContact({ stageId: state.stages[0]?.id, onSaved: load }) }),
        h("a", { class: "btn btn-primary", href: "#campanhas" }, icon("megaphone"), "Nova campanha")
      )
    ),
    whatsappHero(wa),
    h(
      "div",
      { class: "stat-grid" },
      stat({
        label: "Contatos",
        value: data.contacts.total,
        iconName: "contact-round",
        href: "#contatos",
        foot: data.contacts.new_week ? h("span", {}, h("b", {}, `+${data.contacts.new_week}`), " nos últimos 7 dias") : "Nenhum novo nos últimos 7 dias",
      }),
      stat({
        label: "Esperando resposta",
        value: data.contacts.awaiting,
        iconName: "message-square-reply",
        tone: data.contacts.awaiting ? "amber" : "green",
        href: "#kanban",
        foot: data.contacts.awaiting ? "Pessoas que falaram por último" : "Ninguém esperando",
      }),
      stat({
        label: "Mensagens hoje",
        value: data.messages_today.received + data.messages_today.sent,
        iconName: "message-circle",
        tone: "blue",
        foot: `${data.messages_today.received} recebidas · ${data.messages_today.sent} enviadas`,
      }),
      stat({
        label: "Limite de campanhas hoje",
        value: data.campaign_sent_today,
        suffix: `/ ${limit}`,
        iconName: "send",
        tone: sentPct >= 90 ? "red" : "green",
        href: "#config",
        foot: h("div", { class: "progress", title: `${sentPct}% do limite diário` }, (() => {
          const bar = h("span", { class: "p-sent" });
          bar.style.width = `${sentPct}%`;
          return bar;
        })()),
      })
    ),
    h(
      "div",
      { class: "dash-grid" },
      h("div", { class: "dash-col" }, checklist(wa), funnelCard(), awaitingCard()),
      h("div", { class: "dash-col" }, campaignsCard(), schedulesCard())
    )
  );
}

export default {
  async mount(container) {
    root = container;
    await load();
  },
  onWhatsApp() {
    render();
  },
  onCampaign: scheduleReload,
  onChanged: scheduleReload,
  destroy() {
    clearTimeout(reloadTimer);
    root = null;
    data = null;
  },
};

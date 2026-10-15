import { h, icon, button, pageHead, emptyState, callout, person, openModal, field, stageOptions, toast, withBusy, confirmDialog, formatPhone, formatDateTime, formatDuration } from "../dom.js";
import { del, get, patch, post, query } from "../api.js";
import { state } from "../state.js";

let root = null;
let campaigns = [];
let runtime = {};
let countdownTimer = null;

const STATUS = {
  draft: { label: "Rascunho", badge: "" },
  running: { label: "Em andamento", badge: "badge-success" },
  paused: { label: "Pausada", badge: "badge-warning" },
  done: { label: "Concluída", badge: "badge-info" },
  canceled: { label: "Cancelada", badge: "badge-danger" },
};

const ITEM_STATUS = {
  pending: { label: "Pendente", badge: "" },
  sent: { label: "Enviada", badge: "badge-success" },
  failed: { label: "Falhou", badge: "badge-danger" },
  skipped: { label: "Ignorada", badge: "badge-warning" },
};

async function load() {
  const data = await get("/campaigns");
  campaigns = data.campaigns;
  runtime = data.runtime;
  render();
}

function progressBar(campaign) {
  const pct = (value) => `${campaign.total ? (value / campaign.total) * 100 : 0}%`;
  return h(
    "div",
    { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(campaign.total), "aria-valuenow": String(campaign.sent) },
    h("span", { class: "p-sent", style: { width: pct(campaign.sent) } }),
    h("span", { class: "p-failed", style: { width: pct(campaign.failed) } }),
    h("span", { class: "p-skipped", style: { width: pct(campaign.skipped) } })
  );
}

function campaignCard(campaign) {
  const status = STATUS[campaign.status];
  const isCurrent = runtime.campaign_id === campaign.id && campaign.status === "running";

  const action = (label, path, { cls = "btn btn-sm", confirmText, iconName } = {}) => {
    const btn = h("button", { class: cls, type: "button" }, iconName ? icon(iconName) : null, label);
    btn.addEventListener("click", async () => {
      if (confirmText && !(await confirmDialog(confirmText, { danger: true, confirmText: label }))) return;
      await withBusy(btn, async () => {
        await post(`/campaigns/${campaign.id}/${path}`);
        await load();
      });
    });
    return btn;
  };

  const remove = h("button", { class: "btn btn-sm btn-ghost", type: "button" }, icon("trash-2"), "Excluir");
  remove.addEventListener("click", async () => {
    if (!(await confirmDialog(`Excluir a campanha "${campaign.name}"? O histórico de envios dela será apagado.`, { danger: true, confirmText: "Excluir" }))) return;
    await withBusy(remove, async () => {
      await del(`/campaigns/${campaign.id}`);
      await load();
    });
  });

  return h(
    "article",
    { class: "card campaign-card" },
    h(
      "div",
      { class: "row" },
      h("span", { class: `icon-bubble${campaign.status === "running" ? " green" : ""}` }, icon("megaphone")),
      h("div", { class: "grow" }, h("h2", { class: "ellipsis" }, campaign.name), h("div", { class: "msg-preview" }, campaign.message)),
      h("span", { class: `badge ${status.badge}` }, status.label)
    ),
    h(
      "div",
      { class: "stack-sm" },
      h(
        "div",
        { class: "row" },
        h("span", { class: "big-number" }, String(campaign.sent)),
        h("span", { class: "muted" }, `de ${campaign.total} enviadas`),
        h("span", { class: "spacer" }),
        h("span", { class: "muted small" }, campaign.total ? `${Math.round((campaign.sent / campaign.total) * 100)}%` : "")
      ),
      progressBar(campaign)
    ),
    h(
      "div",
      { class: "stats" },
      campaign.failed ? h("span", { style: { color: "var(--danger)" } }, icon("circle-x"), h("b", {}, String(campaign.failed)), " falharam") : null,
      campaign.skipped ? h("span", {}, icon("info"), h("b", {}, String(campaign.skipped)), " ignoradas") : null,
      h("span", {}, icon("hourglass"), `${campaign.min_delay_s}–${campaign.max_delay_s}s entre envios`),
      h("span", {}, icon("clock"), `${campaign.window_start}–${campaign.window_end}`)
    ),
    campaign.status_note && !["done", "draft"].includes(campaign.status)
      ? h(
          "div",
          { class: "note" },
          icon(campaign.status === "running" ? "loader-circle" : "info"),
          h("span", { class: "grow" }, campaign.status_note),
          isCurrent && runtime.next_send_at && campaign.status_note.startsWith("Próximo envio")
            ? h("span", { class: "countdown", dataset: { at: runtime.next_send_at } })
            : null
        )
      : null,
    h(
      "div",
      { class: "row" },
      campaign.status === "draft" ? action("Iniciar envio", "start", { cls: "btn btn-sm btn-primary", iconName: "play" }) : null,
      campaign.status === "running" ? action("Pausar", "pause", { iconName: "pause" }) : null,
      campaign.status === "paused" ? action("Retomar", "start", { cls: "btn btn-sm btn-primary", iconName: "play" }) : null,
      ["draft", "paused"].includes(campaign.status) ? button("Editar", { icon: "pencil", size: "sm", onClick: () => openCampaignForm(campaign) }) : null,
      button("Ver envios", { icon: "eye", size: "sm", onClick: () => openDetails(campaign.id) }),
      h("span", { class: "spacer" }),
      ["running", "paused", "draft"].includes(campaign.status) ? action("Cancelar", "cancel", { cls: "btn btn-sm btn-ghost", confirmText: "Cancelar a campanha? Os contatos que ainda não receberam ficam de fora." }) : null,
      campaign.status !== "running" ? remove : null
    )
  );
}

function render() {
  const { daily_limit: limit } = state.settings;
  root.replaceChildren(
    pageHead(
      "Campanhas",
      `Uma mensagem para vários contatos, enviada um de cada vez. Hoje: ${state.sent_today ?? 0} de ${limit} do limite diário.`,
      button("Nova campanha", { icon: "plus", variant: "primary", onClick: () => openCampaignForm() })
    ),
    campaigns.length
      ? h("div", { class: "cards-grid" }, campaigns.map(campaignCard))
      : emptyState({
          icon: "megaphone",
          title: "Nenhuma campanha ainda",
          text: "Escolha os contatos, escreva a mensagem e o CRM envia um por um, com intervalos aleatórios para parecer natural.",
          action: button("Criar campanha", { icon: "plus", variant: "primary", onClick: () => openCampaignForm() }),
        })
  );
  tickCountdown();
}

function tickCountdown() {
  for (const el of root?.querySelectorAll(".countdown") ?? []) {
    const seconds = Math.max(0, Math.round((Number(el.dataset.at) - Date.now()) / 1000));
    el.textContent = seconds > 0 ? ` (em ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})` : "";
  }
}

// ───────── Criar / editar ─────────

function openCampaignForm(campaign = null) {
  const selection = [...state.selection];
  const editing = Boolean(campaign);

  const name = h("input", { required: true, maxlength: 120, value: campaign?.name ?? "", placeholder: "Ex.: Retorno clientes outubro" });
  const message = h("textarea", {
    rows: 5,
    required: true,
    value: campaign?.message ?? "{Oi|Olá} {primeiro_nome}, tudo bem?",
  });
  const samples = h("div", { class: "samples" });

  const audienceType = h(
    "select",
    { value: selection.length ? "selection" : "stage" },
    selection.length ? h("option", { value: "selection" }, `Contatos selecionados (${selection.length})`) : null,
    h("option", { value: "stage" }, "Todos de uma etapa"),
    h("option", { value: "tag" }, "Todos com uma tag")
  );
  const audienceStage = h("select", {}, stageOptions(state.stages));
  const audienceTag = h("select", {}, state.tags.map(({ tag, total }) => h("option", { value: tag }, `${tag} (${total})`)));
  const audienceInfo = h("p", { class: "muted small", style: { margin: 0 } });

  const num = (value, min) => h("input", { type: "number", min: String(min), step: "1", value: String(value), required: true });
  const minDelay = num(campaign?.min_delay_s ?? 45, 10);
  const maxDelay = num(campaign?.max_delay_s ?? 120, 10);
  const pauseEvery = num(campaign?.pause_every ?? 10, 0);
  const pauseMinutes = num(Math.round((campaign?.pause_s ?? 600) / 60), 0);
  const windowStart = h("input", { type: "time", value: campaign?.window_start ?? "08:00", required: true });
  const windowEnd = h("input", { type: "time", value: campaign?.window_end ?? "20:00", required: true });
  const typing = h("input", { type: "checkbox", checked: campaign ? campaign.typing : true });
  const afterSend = h("select", { value: campaign?.after_send_stage_id ? String(campaign.after_send_stage_id) : "" }, stageOptions(state.stages, { empty: "Não mover" }));
  const onReply = h("select", { value: campaign?.on_reply_stage_id ? String(campaign.on_reply_stage_id) : "" }, stageOptions(state.stages, { empty: "Não mover" }));
  const estimate = h("p", { class: "callout info", style: { margin: 0 } });
  const error = h("p", { class: "form-error", role: "alert" });
  let audienceCount = campaign?.total ?? selection.length;

  const updateEstimate = () => {
    const count = editing ? campaign.pending : audienceCount;
    const avg = (Number(minDelay.value) + Number(maxDelay.value)) / 2;
    const pauses = Number(pauseEvery.value) > 0 ? Math.floor(Math.max(0, count - 1) / Number(pauseEvery.value)) : 0;
    const seconds = Math.max(0, count - 1) * avg + pauses * Number(pauseMinutes.value) * 60;
    const limit = state.settings.daily_limit;
    estimate.textContent =
      count > 0
        ? `${count} mensagem(ns) a enviar. Tempo estimado: ~${formatDuration(seconds)} de envio contínuo` +
          (count > limit ? `, divididos em ${Math.ceil(count / limit)} dias pelo limite diário de ${limit}.` : ".")
        : "Nenhum contato no público escolhido.";
  };

  const updateAudience = async () => {
    audienceStage.closest(".field").hidden = audienceType.value !== "stage";
    audienceTag.closest(".field").hidden = audienceType.value !== "tag";
    if (audienceType.value === "selection") audienceCount = selection.length;
    else {
      const filter = audienceType.value === "stage" ? { stage_id: audienceStage.value } : { tag: audienceTag.value };
      const list = (filter.stage_id || filter.tag) ? await get(`/contacts${query(filter)}`) : [];
      audienceCount = list.filter((contact) => !contact.opted_out).length;
      const optedOut = list.length - audienceCount;
      audienceInfo.textContent = optedOut ? `${optedOut} contato(s) que pediram para não receber ficarão de fora.` : "";
    }
    updateEstimate();
  };

  const updatePreview = async () => {
    try {
      const result = await post("/campaigns/preview", { message: message.value });
      samples.replaceChildren(h("span", { class: "muted small" }, "Exemplos (com o nome \"Maria Silva\"):"), ...result.samples.map((text) => h("div", { class: "bubble" }, text)));
    } catch {
      samples.replaceChildren();
    }
  };

  let previewTimer;
  message.addEventListener("input", () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 400);
  });
  [minDelay, maxDelay, pauseEvery, pauseMinutes].forEach((input) => input.addEventListener("input", updateEstimate));
  [audienceType, audienceStage, audienceTag].forEach((input) => input.addEventListener("change", updateAudience));

  const save = h("button", { class: "btn btn-primary", type: "submit", form: "campaign-form" }, editing ? "Salvar" : "Criar campanha");

  const payload = () => ({
    name: name.value,
    message: message.value,
    min_delay_s: Number(minDelay.value),
    max_delay_s: Number(maxDelay.value),
    pause_every: Number(pauseEvery.value),
    pause_s: Number(pauseMinutes.value) * 60,
    window_start: windowStart.value,
    window_end: windowEnd.value,
    typing: typing.checked,
    after_send_stage_id: afterSend.value || null,
    on_reply_stage_id: onReply.value || null,
  });

  const form = h(
    "form",
    {
      id: "campaign-form",
      class: "stack",
      onSubmit: async (event) => {
        event.preventDefault();
        error.textContent = "";
        await withBusy(save, async () => {
          try {
            if (editing) {
              await patch(`/campaigns/${campaign.id}`, payload());
              toast("Campanha atualizada");
            } else {
              const audience =
                audienceType.value === "selection"
                  ? { contact_ids: selection }
                  : audienceType.value === "stage"
                    ? { stage_id: audienceStage.value }
                    : { tag: audienceTag.value };
              await post("/campaigns", { ...payload(), ...audience });
              if (audienceType.value === "selection") state.selection.clear();
              toast("Campanha criada. Clique em \"Iniciar envio\" quando quiser começar.");
            }
            modal.close();
            load();
          } catch (err) {
            error.textContent = err.message;
          }
        });
      },
    },
    field("Nome da campanha", name),
    field("Mensagem", message, "Variáveis: {nome}, {primeiro_nome}. Variações: {Oi|Olá|E aí} escolhe uma por envio, para as mensagens não ficarem idênticas."),
    samples,
    editing
      ? null
      : h(
          "fieldset",
          {},
          h("legend", {}, "Para quem"),
          h("div", { class: "grid-2" }, field("Público", audienceType), field("Etapa", audienceStage), field("Tag", audienceTag)),
          audienceInfo
        ),
    h(
      "fieldset",
      {},
      h("legend", {}, "Ritmo de envio"),
      h("div", { class: "grid-2" }, field("Intervalo mínimo (segundos)", minDelay), field("Intervalo máximo (segundos)", maxDelay)),
      h("div", { class: "grid-2" }, field("Pausa longa a cada X mensagens", pauseEvery, "0 = sem pausa longa"), field("Duração da pausa (minutos)", pauseMinutes)),
      h("div", { class: "grid-2" }, field("Enviar a partir de", windowStart), field("Parar às", windowEnd)),
      h("label", { class: "check" }, typing, "Mostrar \"digitando...\" antes de cada mensagem")
    ),
    h(
      "fieldset",
      {},
      h("legend", {}, "Kanban"),
      h("div", { class: "grid-2" }, field("Depois de enviar, mover para", afterSend), field("Quando a pessoa responder, mover para", onReply))
    ),
    estimate,
    callout("Envie só para quem conhece você. O que mais leva a bloqueio é gente denunciando ou bloqueando seu número. Quem responder \"sair\" ou \"parar\" sai automaticamente das campanhas."),
    error
  );

  const modal = openModal({
    title: editing ? "Editar campanha" : "Nova campanha",
    wide: true,
    body: form,
    actions: [h("button", { class: "btn", type: "button", onClick: () => modal.close() }, "Cancelar"), save],
  });

  updatePreview();
  if (editing) updateEstimate();
  else updateAudience();
  name.focus();
}

// ───────── Detalhes ─────────

async function openDetails(id) {
  const campaign = await get(`/campaigns/${id}`);
  const modal = openModal({
    title: campaign.name,
    wide: true,
    body: [
      h("div", { class: "bubble" }, campaign.message),
      progressBar(campaign),
      h(
        "div",
        { class: "table-wrap", style: { maxHeight: "50vh", overflow: "auto" } },
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, h("th", {}, "Contato"), h("th", {}, "Status"), h("th", {}, "Enviada em"), h("th", {}, "Detalhe"))),
          h(
            "tbody",
            {},
            campaign.items.map((item) =>
              h(
                "tr",
                {},
                h("td", {}, person(item.contact_name || "Sem nome", formatPhone(item.contact_phone), { seed: item.contact_phone, size: "sm" })),
                h("td", {}, h("span", { class: `badge ${ITEM_STATUS[item.status].badge}` }, ITEM_STATUS[item.status].label)),
                h("td", { class: "nowrap" }, formatDateTime(item.sent_at) || "—"),
                h("td", { class: "small" }, item.error ?? item.rendered ?? "")
              )
            )
          )
        )
      ),
    ],
    actions: [h("button", { class: "btn btn-primary", type: "button", onClick: () => modal.close() }, "Fechar")],
  });
}

export default {
  async mount(container) {
    root = container;
    countdownTimer = setInterval(tickCountdown, 1000);
    await load();
    // Vindo de "Criar campanha com selecionados" na tela de contatos
    if (sessionStorage.getItem("crm:new-campaign")) {
      sessionStorage.removeItem("crm:new-campaign");
      openCampaignForm();
    }
  },
  onCampaign(campaign) {
    const index = campaigns.findIndex((item) => item.id === campaign.id);
    if (index === -1) return load();
    campaigns[index] = campaign;
    runtime = { campaign_id: campaign.campaign_id, next_send_at: campaign.next_send_at };
    render();
  },
  onChanged(types) {
    if (types.includes("contacts")) load();
  },
  destroy() {
    clearInterval(countdownTimer);
    root = null;
  },
};

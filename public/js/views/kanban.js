import { h, openModal, field, toast, withBusy, confirmDialog, formatPhone, timeAgo, tagList } from "../dom.js";
import { del, get, patch, post, query } from "../api.js";
import { hooks, state } from "../state.js";
import { openContact, openNewContact } from "./contactModal.js";

let root = null;
let filters = { q: "", tag: "" };
let dragging = null; // { id, from }

async function load() {
  const contacts = await get(`/contacts${query(filters)}`);
  render(contacts);
}

function cardFor(contact) {
  const lastActivity = Math.max(contact.last_inbound_at ?? 0, contact.last_outbound_at ?? 0);
  const open = () => openContact(contact.id, { onSaved: load });
  const card = h(
    "div",
    {
      role: "button",
      tabindex: "0",
      class: "k-card",
      draggable: "true",
      dataset: { id: contact.id },
      onClick: open,
      onKeydown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      },
      onDragstart: (event) => {
        dragging = { id: contact.id };
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(contact.id));
      },
      onDragend: () => {
        card.classList.remove("dragging");
        dragging = null;
        root.querySelectorAll(".drop-placeholder").forEach((el) => el.remove());
        root.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
      },
    },
    h("span", { class: "k-name" }, contact.name || formatPhone(contact.phone)),
    h(
      "span",
      { class: "k-meta" },
      contact.name ? h("span", {}, formatPhone(contact.phone)) : null,
      lastActivity ? h("span", { title: "Última mensagem" }, `💬 ${timeAgo(lastActivity)}`) : null,
      contact.last_inbound_at && contact.last_inbound_at >= (contact.last_outbound_at ?? 0) ? h("span", { class: "badge badge-info" }, "respondeu") : null,
      contact.opted_out ? h("span", { class: "badge badge-danger" }, "não quer receber") : null
    ),
    tagList(contact.tags)
  );
  return card;
}

/**
 * Posição onde o card será solto, a partir da altura do mouse
 */
function dropIndex(body, clientY) {
  const cards = [...body.querySelectorAll(".k-card:not(.dragging)")];
  const index = cards.findIndex((card) => {
    const box = card.getBoundingClientRect();
    return clientY < box.top + box.height / 2;
  });
  return index === -1 ? cards.length : index;
}

function columnFor(stage, contacts) {
  const body = h("div", { class: "column-body", dataset: { stage: stage?.id ?? "" } }, contacts.map(cardFor));

  body.addEventListener("dragover", (event) => {
    if (!dragging) return;
    event.preventDefault();
    body.classList.add("drop-target");
    const index = dropIndex(body, event.clientY);
    const cards = [...body.querySelectorAll(".k-card:not(.dragging)")];
    const marker = body.querySelector(".drop-placeholder") ?? h("div", { class: "drop-placeholder" });
    if (cards[index]) body.insertBefore(marker, cards[index]);
    else body.append(marker);
  });
  body.addEventListener("dragleave", (event) => {
    if (!body.contains(event.relatedTarget)) {
      body.classList.remove("drop-target");
      body.querySelector(".drop-placeholder")?.remove();
    }
  });
  body.addEventListener("drop", async (event) => {
    event.preventDefault();
    if (!dragging) return;
    const index = dropIndex(body, event.clientY);
    const { id } = dragging;
    try {
      await post(`/contacts/${id}/move`, { stage_id: stage?.id ?? null, index });
    } catch (error) {
      toast(error.message, "error");
    }
    load();
  });

  const head = stage
    ? h(
        "div",
        { class: "column-head" },
        h("span", { class: "stage-dot", style: { background: stage.color } }),
        h("h2", { title: stage.name }, stage.name),
        h("span", { class: "column-count" }, String(contacts.length)),
        h("button", { class: "icon-btn", type: "button", title: "Adicionar contato nesta etapa", "aria-label": `Adicionar contato em ${stage.name}`, onClick: () => openNewContact({ stageId: stage.id, onSaved: load }) }, "+"),
        h("button", { class: "icon-btn", type: "button", title: "Editar etapa", "aria-label": `Editar etapa ${stage.name}`, onClick: () => editStage(stage, contacts.length) }, "⋯")
      )
    : h("div", { class: "column-head" }, h("span", { class: "stage-dot", style: { background: "var(--muted)" } }), h("h2", {}, "Sem etapa"), h("span", { class: "column-count" }, String(contacts.length)));

  return h("section", { class: "column", "aria-label": stage?.name ?? "Sem etapa" }, head, body);
}

function render(contacts) {
  const byStage = new Map(state.stages.map((stage) => [stage.id, []]));
  const noStage = [];
  for (const contact of contacts) {
    (byStage.get(contact.stage_id) ?? noStage).push(contact);
  }

  const search = h("input", { type: "search", placeholder: "Buscar nome, telefone ou observação", value: filters.q, "aria-label": "Buscar" });
  let searchTimer;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = search.value;
      load().then(() => {
        const input = root.querySelector("input[type=search]");
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    }, 300);
  });

  const tagSelect = h(
    "select",
    { "aria-label": "Filtrar por tag", value: filters.tag, onChange: (event) => ((filters.tag = event.target.value), load()) },
    h("option", { value: "" }, "Todas as tags"),
    state.tags.map(({ tag, total }) => h("option", { value: tag }, `${tag} (${total})`))
  );

  const board = h(
    "div",
    { class: "board" },
    noStage.length ? columnFor(null, noStage) : null,
    state.stages.map((stage) => columnFor(stage, byStage.get(stage.id))),
    h("button", { class: "add-column", type: "button", onClick: () => editStage(null) }, "+ Nova etapa")
  );

  const scroll = root.querySelector(".board")?.scrollLeft ?? 0;
  root.replaceChildren(
    h(
      "div",
      { class: "page-head" },
      h("div", {}, h("h1", {}, "Kanban"), h("p", { class: "muted" }, `${contacts.length} contato(s). Arraste os cards para mudar de etapa.`)),
      h("span", { class: "spacer" }),
      h("button", { class: "btn btn-primary", type: "button", onClick: () => openNewContact({ stageId: state.stages[0]?.id, onSaved: load }) }, "+ Contato")
    ),
    h("div", { class: "toolbar" }, search, tagSelect),
    board
  );
  board.scrollLeft = scroll;
}

function editStage(stage, total = 0) {
  const name = h("input", { value: stage?.name ?? "", required: true, maxlength: 60 });
  const color = h("input", { type: "color", value: stage?.color ?? "#3b82f6", style: { padding: "2px", width: "64px" } });
  const save = h("button", { class: "btn btn-primary", type: "submit", form: "stage-form" }, "Salvar");
  const position = state.stages.findIndex((item) => item.id === stage?.id);

  const move = async (offset) => {
    const ids = state.stages.map((item) => item.id);
    const [moved] = ids.splice(position, 1);
    ids.splice(position + offset, 0, moved);
    await post("/stages/reorder", { ids });
    await hooks.reload();
    modal.close();
    load();
  };

  const modal = openModal({
    title: stage ? "Editar etapa" : "Nova etapa",
    body: h(
      "form",
      {
        id: "stage-form",
        class: "stack",
        onSubmit: (event) => {
          event.preventDefault();
          withBusy(save, async () => {
            if (stage) await patch(`/stages/${stage.id}`, { name: name.value, color: color.value });
            else await post("/stages", { name: name.value, color: color.value });
            await hooks.reload();
            modal.close();
            load();
          });
        },
      },
      h("div", { class: "row" }, h("div", { class: "grow" }, field("Nome", name)), field("Cor", color)),
      stage
        ? h(
            "div",
            { class: "row" },
            h("button", { class: "btn btn-sm", type: "button", disabled: position <= 0, onClick: () => move(-1) }, "← Mover para a esquerda"),
            h("button", { class: "btn btn-sm", type: "button", disabled: position >= state.stages.length - 1, onClick: () => move(1) }, "Mover para a direita →")
          )
        : null
    ),
    actions: [
      stage
        ? h(
            "button",
            {
              class: "btn btn-danger left",
              type: "button",
              disabled: total > 0,
              title: total > 0 ? "Mova os contatos antes de excluir" : "",
              onClick: async () => {
                if (!(await confirmDialog(`Excluir a etapa "${stage.name}"?`, { danger: true, confirmText: "Excluir" }))) return;
                try {
                  await del(`/stages/${stage.id}`);
                  await hooks.reload();
                  modal.close();
                  load();
                } catch (error) {
                  toast(error.message, "error");
                }
              },
            },
            "Excluir"
          )
        : null,
      h("button", { class: "btn", type: "button", onClick: () => modal.close() }, "Cancelar"),
      save,
    ].filter(Boolean),
  });
  name.focus();
}

export default {
  async mount(container) {
    root = container;
    await load();
  },
  onChanged(types) {
    if (types.includes("contacts") || types.includes("messages")) load();
  },
  destroy() {
    root = null;
  },
};

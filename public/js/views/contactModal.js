import { h, openModal, field, stageOptions, toast, withBusy, confirmDialog, formatPhone, formatDateTime, toLocalInput } from "../dom.js";
import { del, get, patch, post } from "../api.js";
import { state } from "../state.js";

const SOURCE_LABEL = {
  manual: "pelo CRM",
  schedule: "agendada",
  campaign: "campanha",
  phone: "pelo celular",
  contact: "",
};

function contactFields(contact = {}) {
  return {
    name: h("input", { name: "name", value: contact.name ?? "", maxlength: 120, autocomplete: "off" }),
    phone: h("input", { name: "phone", value: contact.phone ?? "", inputmode: "tel", placeholder: "(11) 98765-4321", required: true }),
    stage: h("select", { name: "stage_id", value: contact.stage_id ? String(contact.stage_id) : "" }, stageOptions(state.stages, { empty: "Sem etapa" })),
    tags: h("input", { name: "tags", value: (contact.tags ?? []).join(", "), placeholder: "cliente, indicação", list: "tag-suggestions" }),
    notes: h("textarea", { name: "notes", rows: 3, value: contact.notes ?? "" }),
  };
}

function tagDatalist() {
  return h("datalist", { id: "tag-suggestions" }, state.tags.map(({ tag }) => h("option", { value: tag })));
}

function readFields(fields) {
  return {
    name: fields.name.value,
    phone: fields.phone.value,
    stage_id: fields.stage.value || null,
    tags: fields.tags.value,
    notes: fields.notes.value,
  };
}

/**
 * Novo contato
 */
export function openNewContact({ stageId = null, onSaved } = {}) {
  const fields = contactFields({ stage_id: stageId });
  const error = h("p", { class: "form-error", role: "alert" });

  const save = h("button", { class: "btn btn-primary", type: "submit", form: "new-contact-form" }, "Salvar contato");
  const form = h(
    "form",
    {
      id: "new-contact-form",
      class: "stack",
      onSubmit: async (event) => {
        event.preventDefault();
        error.textContent = "";
        await withBusy(save, async () => {
          try {
            const contact = await post("/contacts", readFields(fields));
            toast("Contato criado");
            modal.close();
            onSaved?.(contact);
          } catch (err) {
            error.textContent = err.message;
          }
        });
      },
    },
    h("div", { class: "grid-2" }, field("Nome", fields.name), field("Telefone (WhatsApp)", fields.phone, "Com DDD. Números de outros países: comece com +")),
    h("div", { class: "grid-2" }, field("Etapa", fields.stage), field("Tags", fields.tags, "Separe por vírgula")),
    field("Observações", fields.notes),
    tagDatalist(),
    error
  );

  const modal = openModal({
    title: "Novo contato",
    body: form,
    actions: [h("button", { class: "btn", type: "button", onClick: () => modal.close() }, "Cancelar"), save],
  });
  fields.name.focus();
}

/**
 * Detalhes do contato: editar, histórico, enviar e agendar mensagem
 */
export async function openContact(id, { onSaved } = {}) {
  const contact = await get(`/contacts/${id}`);
  const fields = contactFields(contact);
  const optedOut = h("input", { type: "checkbox", checked: contact.opted_out });
  const error = h("p", { class: "form-error", role: "alert" });
  let changed = false;

  const chat = h("div", { class: "chat", "aria-label": "Histórico de mensagens" });
  const renderChat = (messages) => {
    chat.replaceChildren(
      ...(messages.length
        ? messages.map((message) =>
            h(
              "div",
              { class: `msg ${message.direction}` },
              message.text,
              h("time", {}, [formatDateTime(message.created_at), SOURCE_LABEL[message.source]].filter(Boolean).join(" · "))
            )
          )
        : [h("p", { class: "muted small", style: { margin: 0 } }, "Nenhuma mensagem registrada ainda. Mensagens trocadas com este contato aparecem aqui.")])
    );
    chat.scrollTop = chat.scrollHeight;
  };
  renderChat(contact.messages);

  const connected = state.whatsapp?.status === "open";
  const sendText = h("textarea", { rows: 2, placeholder: connected ? "Escreva uma mensagem..." : "Conecte o WhatsApp para enviar", disabled: !connected });
  const sendBtn = h("button", { class: "btn btn-primary", type: "button", disabled: !connected }, "Enviar agora");
  sendBtn.addEventListener("click", () =>
    withBusy(sendBtn, async () => {
      if (!sendText.value.trim()) return;
      await post(`/contacts/${id}/send`, { text: sendText.value });
      sendText.value = "";
      changed = true;
      const updated = await get(`/contacts/${id}`);
      renderChat(updated.messages);
      toast("Mensagem enviada");
    })
  );

  const save = h("button", { class: "btn btn-primary", type: "submit", form: "contact-form" }, "Salvar");
  const remove = h("button", { class: "btn btn-danger left", type: "button" }, "Excluir");
  remove.addEventListener("click", async () => {
    if (!(await confirmDialog(`Excluir ${contact.name || formatPhone(contact.phone)}? O histórico também será apagado.`, { danger: true, confirmText: "Excluir" }))) return;
    await withBusy(remove, async () => {
      await del(`/contacts/${id}`);
      toast("Contato excluído");
      changed = true;
      modal.close();
    });
  });

  const form = h(
    "form",
    {
      id: "contact-form",
      class: "stack",
      onSubmit: async (event) => {
        event.preventDefault();
        error.textContent = "";
        await withBusy(save, async () => {
          try {
            await patch(`/contacts/${id}`, { ...readFields(fields), opted_out: optedOut.checked });
            toast("Contato salvo");
            changed = true;
            modal.close();
          } catch (err) {
            error.textContent = err.message;
          }
        });
      },
    },
    h("div", { class: "grid-2" }, field("Nome", fields.name), field("Telefone (WhatsApp)", fields.phone)),
    h("div", { class: "grid-2" }, field("Etapa", fields.stage), field("Tags", fields.tags, "Separe por vírgula")),
    field("Observações", fields.notes),
    h("label", { class: "check" }, optedOut, "Não quer receber mensagens (fica fora das campanhas)"),
    tagDatalist(),
    error
  );

  const modal = openModal({
    title: contact.name || formatPhone(contact.phone),
    wide: true,
    body: [
      form,
      h(
        "fieldset",
        {},
        h("legend", {}, "Conversa"),
        chat,
        sendText,
        h(
          "div",
          { class: "row" },
          sendBtn,
          h(
            "button",
            {
              class: "btn",
              type: "button",
              onClick: () => openScheduleModal({ contact, onSaved: () => toast("Mensagem agendada") }),
            },
            "Agendar mensagem"
          ),
          h("span", { class: "spacer" }),
          h("a", { class: "btn btn-ghost", href: `https://wa.me/${contact.phone}`, target: "_blank", rel: "noopener" }, "Abrir no WhatsApp ↗")
        )
      ),
    ],
    actions: [remove, h("button", { class: "btn", type: "button", onClick: () => modal.close() }, "Fechar"), save],
    onClose: () => changed && onSaved?.(),
  });
}

/**
 * Agendar mensagem (para um contato definido ou escolhido na hora)
 */
export async function openScheduleModal({ contact = null, onSaved } = {}) {
  const contacts = contact ? [contact] : await get("/contacts");
  if (contacts.length === 0) {
    toast("Cadastre um contato primeiro", "error");
    return;
  }

  const select = h(
    "select",
    { required: true, disabled: Boolean(contact) },
    contacts.map((item) => h("option", { value: String(item.id) }, `${item.name || "Sem nome"} — ${formatPhone(item.phone)}`))
  );
  const text = h("textarea", { rows: 4, required: true, placeholder: "Oi {primeiro_nome}, passando para lembrar..." });
  const when = h("input", { type: "datetime-local", required: true, value: toLocalInput(Date.now() + 60 * 60 * 1000) });
  const recurrence = h(
    "select",
    {},
    h("option", { value: "none" }, "Não repetir"),
    h("option", { value: "daily" }, "Todos os dias"),
    h("option", { value: "weekly" }, "Toda semana"),
    h("option", { value: "monthly" }, "Todo mês")
  );
  const error = h("p", { class: "form-error", role: "alert" });
  const save = h("button", { class: "btn btn-primary", type: "submit", form: "schedule-form" }, "Agendar");

  const form = h(
    "form",
    {
      id: "schedule-form",
      class: "stack",
      onSubmit: async (event) => {
        event.preventDefault();
        error.textContent = "";
        const sendAt = new Date(when.value).getTime();
        if (!Number.isFinite(sendAt)) {
          error.textContent = "Escolha a data e a hora";
          return;
        }
        await withBusy(save, async () => {
          try {
            const contactId = contact?.id ?? Number(select.value);
            const target = contacts.find((item) => item.id === contactId);
            // Variáveis são resolvidas na hora de agendar
            const message = text.value
              .replace(/\{nome\}/gi, target?.name ?? "")
              .replace(/\{primeiro_nome\}/gi, (target?.name ?? "").split(/\s+/)[0] ?? "");
            await post("/schedules", { contact_id: contactId, text: message, send_at: sendAt, recurrence: recurrence.value });
            modal.close();
            onSaved?.();
          } catch (err) {
            error.textContent = err.message;
          }
        });
      },
    },
    field("Contato", select),
    field("Mensagem", text, "Você pode usar {nome} e {primeiro_nome}"),
    h("div", { class: "grid-2" }, field("Data e hora", when), field("Repetir", recurrence)),
    h("p", { class: "muted small", style: { margin: 0 } }, "Se o computador estiver desligado no horário, a mensagem sai assim que o CRM voltar a ficar online."),
    error
  );

  const modal = openModal({
    title: "Agendar mensagem",
    body: form,
    actions: [h("button", { class: "btn", type: "button", onClick: () => modal.close() }, "Cancelar"), save],
  });
}

import { h, fill, icon, button, pageHead, emptyState, person, stagePill, openModal, field, stageOptions, toast, withBusy, formatPhone, timeAgo, tagList, readFileBase64 } from "../dom.js";
import { get, post, query } from "../api.js";
import { hooks, state, stageById } from "../state.js";
import { openContact, openNewContact } from "./contactModal.js";

let root = null;
let filters = { q: "", stage_id: "", tag: "" };
let contacts = [];

async function load() {
  contacts = await get(`/contacts${query(filters)}`);
  render();
}

function render() {
  const visibleIds = contacts.map((contact) => contact.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => state.selection.has(id));

  const search = h("input", { type: "search", placeholder: "Buscar nome, telefone ou observação", value: filters.q, "aria-label": "Buscar" });
  const searchBox = h("div", { class: "search-input" }, icon("search"), search);
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.q = search.value;
      load().then(() => {
        const input = root.querySelector("input[type=search]");
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    }, 300);
  });

  const stageFilter = h(
    "select",
    { "aria-label": "Filtrar por etapa", value: filters.stage_id, onChange: (event) => ((filters.stage_id = event.target.value), load()) },
    h("option", { value: "" }, "Todas as etapas"),
    state.stages.map((stage) => h("option", { value: String(stage.id) }, stage.name)),
    h("option", { value: "none" }, "Sem etapa")
  );
  const tagFilter = h(
    "select",
    { "aria-label": "Filtrar por tag", value: filters.tag, onChange: (event) => ((filters.tag = event.target.value), load()) },
    h("option", { value: "" }, "Todas as tags"),
    state.tags.map(({ tag, total }) => h("option", { value: tag }, `${tag} (${total})`))
  );

  const toggleAll = h("input", {
    type: "checkbox",
    checked: allSelected,
    "aria-label": "Selecionar todos",
    onChange: (event) => {
      visibleIds.forEach((id) => (event.target.checked ? state.selection.add(id) : state.selection.delete(id)));
      render();
    },
  });

  const rows = contacts.map((contact) =>
    h(
      "tr",
      { class: state.selection.has(contact.id) ? "selected" : "" },
      h(
        "td",
        {},
        h("input", {
          type: "checkbox",
          checked: state.selection.has(contact.id),
          "aria-label": `Selecionar ${contact.name || contact.phone}`,
          onChange: (event) => {
            if (event.target.checked) state.selection.add(contact.id);
            else state.selection.delete(contact.id);
            render();
          },
        })
      ),
      h(
        "td",
        {},
        h(
          "button",
          { class: "link", type: "button", onClick: () => openContact(contact.id, { onSaved: load }) },
          person(contact.name || "Sem nome", contact.opted_out ? "não quer receber mensagens" : null, { seed: contact.phone, avatarName: contact.name })
        )
      ),
      h("td", { class: "nowrap" }, formatPhone(contact.phone)),
      h("td", {}, stagePill(stageById(contact.stage_id))),
      h("td", {}, tagList(contact.tags)),
      h("td", { class: "nowrap muted" }, timeAgo(Math.max(contact.last_inbound_at ?? 0, contact.last_outbound_at ?? 0)) || "—")
    )
  );

  const selected = state.selection.size;
  fill(root, 
    pageHead(
      "Contatos",
      `${contacts.length} contato(s) nesta lista`,
      button("Importar", { icon: "upload", onClick: openImport }),
      button("Exportar", { icon: "download", onClick: openExport }),
      button("Contato", { icon: "user-plus", variant: "primary", onClick: () => openNewContact({ onSaved: load }) })
    ),
    h("div", { class: "toolbar" }, searchBox, stageFilter, tagFilter),
    contacts.length
      ? h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, h("th", { style: { width: "36px" } }, toggleAll), h("th", {}, "Nome"), h("th", {}, "Telefone"), h("th", {}, "Etapa"), h("th", {}, "Tags"), h("th", {}, "Atividade"))),
            h("tbody", {}, rows)
          )
        )
      : filters.q || filters.stage_id || filters.tag
        ? emptyState({ icon: "search", title: "Nenhum contato encontrado", text: "Tente outra busca ou limpe os filtros." })
        : emptyState({
            icon: "contact-round",
            title: "Nenhum contato ainda",
            text: "Cadastre um contato ou importe uma planilha (.xlsx ou .csv) com nome e telefone.",
            action: h("div", { class: "row" }, button("Importar planilha", { icon: "file-spreadsheet", variant: "primary", onClick: openImport }), button("Cadastrar contato", { icon: "user-plus", onClick: () => openNewContact({ onSaved: load }) })),
          }),
    selected
      ? h(
          "div",
          { class: "selection-bar", role: "region", "aria-label": "Contatos selecionados" },
          h("strong", {}, `${selected} selecionado(s)`),
          h("span", { class: "spacer" }),
          button("Limpar seleção", { icon: "x", size: "sm", onClick: () => (state.selection.clear(), render()) }),
          h("a", { class: "btn btn-sm btn-primary", href: "#campanhas", onClick: () => sessionStorage.setItem("crm:new-campaign", "selection") }, icon("megaphone"), "Criar campanha com selecionados")
        )
      : null
  );
}

// ───────── Importação ─────────

function openImport() {
  let fileData = null;
  const fileInput = h("input", { type: "file", accept: ".xlsx,.xls,.csv,.ods", required: true });
  const preview = h("div", { class: "stack" });
  const error = h("p", { class: "form-error", role: "alert" });
  const importBtn = h("button", { class: "btn btn-primary", type: "button", disabled: true }, "Importar");
  const mapping = {};

  fileInput.addEventListener("change", async () => {
    error.textContent = "";
    preview.replaceChildren();
    importBtn.disabled = true;
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      error.textContent = "Arquivo grande demais (máx. 15 MB)";
      return;
    }

    try {
      fileData = await readFileBase64(file);
      const result = await post("/import/preview", { data: fileData, filename: file.name });
      Object.assign(mapping, { phone: "", name: "", tags: "", notes: "", ...result.mapping });

      const columnSelect = (key, label, required = false) =>
        field(
          label,
          h(
            "select",
            { value: mapping[key] ?? "", onChange: (event) => (mapping[key] = event.target.value) },
            h("option", { value: "" }, required ? "Escolha a coluna" : "(não importar)"),
            result.headers.map((header) => h("option", { value: header }, header))
          )
        );

      preview.replaceChildren(
        h("p", { class: "muted", style: { margin: 0 } }, `${result.total} linha(s) encontradas. Confira quais colunas correspondem a cada campo:`),
        h("div", { class: "grid-2" }, columnSelect("phone", "Telefone *", true), columnSelect("name", "Nome"), columnSelect("tags", "Tags"), columnSelect("notes", "Observações")),
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, result.headers.map((header) => h("th", {}, header)))),
            h("tbody", {}, result.sample.map((row) => h("tr", {}, result.headers.map((header) => h("td", {}, String(row[header] ?? ""))))))
          )
        )
      );
      importBtn.disabled = false;
    } catch (err) {
      error.textContent = err.message;
    }
  });

  const stage = h("select", { value: String(state.stages[0]?.id ?? "") }, stageOptions(state.stages, { empty: "Sem etapa" }));
  const tags = h("input", { placeholder: "ex.: lista-outubro" });
  const updateExisting = h("input", { type: "checkbox", checked: true });

  importBtn.addEventListener("click", () =>
    withBusy(importBtn, async () => {
      error.textContent = "";
      if (!mapping.phone) {
        error.textContent = "Escolha a coluna do telefone";
        return;
      }
      const result = await post("/import/commit", {
        data: fileData,
        mapping,
        stage_id: stage.value || null,
        tags: tags.value,
        update_existing: updateExisting.checked,
      });
      await hooks.reload();
      modal.close();
      showImportResult(result);
      load();
    })
  );

  const modal = openModal({
    title: "Importar contatos",
    wide: true,
    body: [
      field("Planilha", fileInput, "Excel (.xlsx/.xls) ou CSV. A primeira linha deve ter os nomes das colunas."),
      preview,
      h("div", { class: "grid-2" }, field("Colocar novos contatos na etapa", stage), field("Adicionar tags a todos", tags, "Separe por vírgula")),
      h("label", { class: "check" }, updateExisting, "Atualizar contatos que já existem (nome, observações e tags)"),
      error,
    ],
    actions: [h("button", { class: "btn", type: "button", onClick: () => modal.close() }, "Cancelar"), importBtn],
  });
}

function showImportResult(result) {
  const modal = openModal({
    title: "Importação concluída",
    body: [
      h(
        "dl",
        { class: "kv" },
        h("dt", {}, "Novos contatos"),
        h("dd", {}, String(result.created)),
        h("dt", {}, "Atualizados"),
        h("dd", {}, String(result.updated)),
        h("dt", {}, "Linhas ignoradas"),
        h("dd", {}, String(result.invalid.length))
      ),
      result.invalid.length
        ? h(
            "div",
            { class: "table-wrap", style: { maxHeight: "240px", overflow: "auto" } },
            h(
              "table",
              {},
              h("thead", {}, h("tr", {}, h("th", {}, "Linha"), h("th", {}, "Valor"), h("th", {}, "Motivo"))),
              h("tbody", {}, result.invalid.slice(0, 200).map((item) => h("tr", {}, h("td", {}, String(item.line)), h("td", {}, item.value || "(vazio)"), h("td", {}, item.reason))))
            )
          )
        : null,
    ],
    actions: [h("button", { class: "btn btn-primary", type: "button", onClick: () => modal.close() }, "OK")],
  });
  toast(`${result.created} contato(s) importado(s)`);
}

// ───────── Exportação ─────────

function openExport() {
  const format = h("select", {}, h("option", { value: "xlsx" }, "Excel (.xlsx)"), h("option", { value: "csv" }, "CSV (separado por ;)"));
  const modal = openModal({
    title: "Exportar contatos",
    body: [
      h("p", { style: { margin: 0 } }, "Exporta os contatos da lista atual (com os filtros aplicados). O arquivo é gerado no seu computador."),
      field("Formato", format),
    ],
    actions: [
      h("button", { class: "btn", type: "button", onClick: () => modal.close() }, "Cancelar"),
      h(
        "button",
        {
          class: "btn btn-primary",
          type: "button",
          onClick: (event) =>
            withBusy(event.currentTarget, async () => {
              const response = await fetch(`/api/export${query({ ...filters, format: format.value })}`, { credentials: "same-origin" });
              if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || "Não foi possível exportar");
              }
              const disposition = response.headers.get("Content-Disposition") ?? "";
              const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `contatos.${format.value}`;
              const url = URL.createObjectURL(await response.blob());
              const link = h("a", { href: url, download: filename, hidden: true });
              document.body.append(link);
              link.click();
              link.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              modal.close();
            }),
        },
        "Baixar"
      ),
    ],
  });
}

export default {
  async mount(container) {
    root = container;
    await load();
  },
  onChanged(types) {
    if (types.includes("contacts")) load();
  },
  destroy() {
    root = null;
  },
};

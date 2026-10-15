/**
 * Utilitários de interface (sem dependências)
 * Todo texto vindo de dados é inserido com textContent, nunca como HTML.
 */
import { icon } from "./icons.js";

export { icon };

/**
 * Cria um elemento: h("button", { class: "btn", onClick }, "Salvar")
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  let value;

  for (const [key, val] of Object.entries(props ?? {})) {
    if (val === null || val === undefined || val === false) continue;
    if (key === "class") el.className = val;
    else if (key === "style" && typeof val === "object") Object.assign(el.style, val);
    else if (key === "dataset") Object.assign(el.dataset, val);
    else if (key.startsWith("on") && typeof val === "function") el.addEventListener(key.slice(2).toLowerCase(), val);
    else if (key === "value") value = val;
    else if (key === "checked" || key === "selected" || key === "disabled" || key === "hidden") el[key] = Boolean(val);
    else el.setAttribute(key, val === true ? "" : val);
  }

  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  // Depois das <option>, para o <select> aceitar o valor
  if (value !== undefined) el.value = value;
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);

/**
 * Troca o conteúdo de um elemento ignorando itens vazios (null/false), como o h() faz
 */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
}

// ───────── Avisos ─────────

export function toast(message, type = "info") {
  const el = h(
    "div",
    { class: `toast ${type === "error" ? "error" : ""}`, role: type === "error" ? "alert" : "status" },
    icon(type === "error" ? "triangle-alert" : "circle-check"),
    h("span", {}, message)
  );
  $("#toasts").append(el);
  setTimeout(() => el.remove(), type === "error" ? 6000 : 3500);
}

// ───────── Janela modal ─────────

/**
 * Abre uma janela modal
 * @returns {{ close: () => void, dialog: HTMLDialogElement }}
 */
export function openModal({ title, body, actions = [], wide = false, onClose }) {
  const close = () => dialog.close();
  const dialog = h(
    "dialog",
    { class: `modal ${wide ? "wide" : ""}`, "aria-label": title },
    h(
      "div",
      { class: "modal-inner" },
      h("div", { class: "modal-head" }, h("h2", {}, title), h("button", { class: "icon-btn", type: "button", "aria-label": "Fechar", onClick: close }, icon("x"))),
      h("div", { class: "modal-body" }, body),
      actions.length ? h("div", { class: "modal-foot" }, actions) : null
    )
  );

  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose?.();
  });
  // Fecha ao clicar fora
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  document.body.append(dialog);
  dialog.showModal();
  return { close, dialog };
}

/**
 * Pergunta de confirmação. Resolve true/false.
 */
export function confirmDialog(message, { title = "Confirmar", confirmText = "Confirmar", danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const modal = openModal({
      title,
      body: h("p", { style: { margin: 0 } }, message),
      actions: [
        h("button", { class: "btn", type: "button", onClick: () => modal.close() }, "Cancelar"),
        h(
          "button",
          {
            class: `btn ${danger ? "btn-danger" : "btn-primary"}`,
            type: "button",
            onClick: () => {
              answer = true;
              modal.close();
            },
          },
          confirmText
        ),
      ],
      onClose: () => resolve(answer),
    });
  });
}

/**
 * Executa uma ação de botão mostrando estado de "carregando" e erros em aviso
 */
export async function withBusy(button, fn) {
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Aguarde...";
  }
  try {
    return await fn();
  } catch (error) {
    toast(error.message, "error");
    return undefined;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}

// ───────── Campos de formulário ─────────

export function field(label, control, hint) {
  return h("label", { class: "field" }, h("span", {}, label), control, hint ? h("small", { class: "hint" }, hint) : null);
}

export function stageOptions(stages, { empty = null } = {}) {
  return [empty !== null ? h("option", { value: "" }, empty) : null, ...stages.map((stage) => h("option", { value: String(stage.id) }, stage.name))];
}

// ───────── Blocos visuais ─────────

/**
 * Cabeçalho de página: título, descrição e botões à direita
 */
export function pageHead(title, description, ...actions) {
  return h(
    "div",
    { class: "page-head" },
    h("div", {}, h("h1", {}, title), description ? h("p", {}, description) : null),
    actions.length ? h("div", { class: "actions" }, actions) : null
  );
}

/**
 * Botão com ícone: button("Contato", { icon: "plus", variant: "primary", onClick })
 */
export function button(label, { icon: name, variant = "", size = "", onClick, type = "button", title, ...rest } = {}) {
  const cls = ["btn", variant && `btn-${variant}`, size && `btn-${size}`].filter(Boolean).join(" ");
  return h("button", { class: cls, type, title, onClick, ...rest }, name ? icon(name) : null, label);
}

export function iconButton(name, label, { onClick, danger = false, ...rest } = {}) {
  return h("button", { class: `icon-btn${danger ? " danger" : ""}`, type: "button", title: label, "aria-label": label, onClick, ...rest }, icon(name));
}

/**
 * Estado vazio com ícone, título, texto e ação
 */
export function emptyState({ icon: name = "inbox", title, text, action, compact = false }) {
  return h(
    "div",
    { class: `empty${compact ? " compact" : ""}` },
    compact ? null : h("span", { class: "icon-bubble" }, icon(name)),
    h(compact ? "strong" : "h2", {}, title),
    text ? h("p", {}, text) : null,
    action ?? null
  );
}

/**
 * Avatar com as iniciais e uma cor fixa por pessoa
 */
export function avatar(name, seed = name, size = "") {
  // Só letras viram iniciais; sem nome (ou só números) mostra "#"
  const words = String(name || "").trim().split(/\s+/).filter((word) => /\p{L}/u.test(word[0] ?? ""));
  const initials = words.length ? (words[0][0] + (words.length > 1 ? words.at(-1)[0] : "")).toUpperCase() : "#";
  let hash = 0;
  for (const char of String(seed ?? "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const el = h("span", { class: `avatar${size ? ` ${size}` : ""}`, "aria-hidden": "true" }, initials);
  el.style.setProperty("--hue", String(hash % 360));
  return el;
}

/**
 * Pessoa: avatar + nome + linha secundária
 */
export function person(name, secondary, { seed, size = "", avatarName = name } = {}) {
  return h(
    "span",
    { class: "person" },
    avatar(avatarName, seed ?? name, size),
    h("span", { class: "person-text" }, h("strong", {}, name), secondary ? h("small", {}, secondary) : null)
  );
}

export function stagePill(stage) {
  if (!stage) return h("span", { class: "stage-pill" }, h("span", { class: "dot", style: { background: "var(--muted)" } }), "Sem etapa");
  return h("span", { class: "stage-pill" }, h("span", { class: "dot", style: { background: stage.color } }), stage.name);
}

export function callout(text, { type = "", icon: name = type === "info" ? "info" : "triangle-alert" } = {}) {
  return h("div", { class: `callout${type ? ` ${type}` : ""}` }, icon(name), h("div", {}, text));
}

// ───────── Formatação ─────────

export function formatPhone(phone) {
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(phone || "");
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : `+${phone}`;
}

export function formatDateTime(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(ms) {
  if (!ms) return "";
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d` : new Date(ms).toLocaleDateString("pt-BR");
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * Converte ms para o formato do <input type="datetime-local">
 */
export function toLocalInput(ms) {
  const date = new Date(ms);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function tagList(tags) {
  return tags?.length ? h("div", { class: "tags" }, tags.map((tag) => h("span", { class: "tag" }, tag))) : null;
}

/**
 * Lê um arquivo como base64 (sem o prefixo data:)
 */
export function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.readAsDataURL(file);
  });
}

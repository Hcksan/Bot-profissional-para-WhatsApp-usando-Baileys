import { $, toast } from "./dom.js";
import { get, post, setUnauthorizedHandler } from "./api.js";
import { hooks, state } from "./state.js";
import kanban from "./views/kanban.js";
import contacts from "./views/contacts.js";
import campaigns from "./views/campaigns.js";
import schedules from "./views/schedules.js";
import whatsapp from "./views/whatsapp.js";
import settings from "./views/settings.js";

const views = { kanban, contatos: contacts, campanhas: campaigns, agendamentos: schedules, whatsapp, config: settings };

let current = null;
let socket = null;
let refreshTimer = null;
const pendingChanges = new Set();

// ───────── Login e primeiro acesso ─────────

const screens = {
  login: { title: "Entrar", subtitle: "Entre com seu e-mail" },
  setup: { title: "Primeiro acesso", subtitle: "Crie a conta de acesso ao painel" },
};

function showAuthError(message) {
  const box = $("#auth-error");
  box.textContent = message ?? "";
  box.hidden = !message;
}

function showLogin({ setupRequired = false } = {}) {
  socket?.disconnect();
  socket = null;
  state.user = null;
  const screen = setupRequired ? "setup" : "login";
  $("#auth-title").textContent = screens[screen].title;
  $("#auth-subtitle").textContent = screens[screen].subtitle;
  $("#login-form").hidden = setupRequired;
  $("#setup-form").hidden = !setupRequired;
  showAuthError(null);
  $("#app").hidden = true;
  $("#login").hidden = false;
  $(`#${screen}-form input`).focus();
}

setUnauthorizedHandler(() => showLogin());

// Mostrar/ocultar senha
for (const button of document.querySelectorAll(".auth-eye")) {
  button.addEventListener("click", () => {
    const input = button.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
    button.querySelector(".i-eye").toggleAttribute("hidden", show);
    button.querySelector(".i-eye-off").toggleAttribute("hidden", !show);
  });
}
$("#auth-year").textContent = String(new Date().getFullYear());

/**
 * Envia um formulário da tela de acesso: trava o botão, mostra o erro ou entra no painel
 */
function onAuthSubmit(form, { busyText, send }) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const label = button.textContent;
    showAuthError(null);
    button.disabled = true;
    button.textContent = busyText;
    try {
      const { user } = await send(form);
      form.reset();
      await startApp(user);
    } catch (err) {
      // A conta já existe (criada em outra aba): volta para o login
      if (err.status === 409) showLogin();
      showAuthError(err.message);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
}

onAuthSubmit($("#login-form"), {
  busyText: "Entrando...",
  send: (form) => post("/login", { email: form.email.value, password: form.password.value }),
});

onAuthSubmit($("#setup-form"), {
  busyText: "Criando conta...",
  send: (form) => {
    if (form.password.value !== form.confirm.value) throw new Error("As senhas não conferem");
    return post("/setup", { code: form.code.value, name: form.name.value, email: form.email.value, password: form.password.value });
  },
});

$("#logout-btn").addEventListener("click", async () => {
  await post("/logout").catch(() => {});
  showLogin();
});

// ───────── Estado global ─────────

async function loadBootstrap() {
  const data = await get("/bootstrap");
  Object.assign(state, data);
  updatePill();
  return data;
}
hooks.reload = loadBootstrap;

function updatePill() {
  const pill = $("#wa-pill");
  const { status, me } = state.whatsapp ?? {};
  const labels = {
    open: "Conectado",
    qr: "Escaneie o QR Code",
    connecting: "Conectando...",
    disconnected: "Desconectado",
  };
  pill.dataset.status = status ?? "disconnected";
  pill.querySelector(".label").textContent = labels[status] ?? "Desconectado";
  pill.title = status === "open" && me?.phone ? `WhatsApp conectado: +${me.phone}` : "Status do WhatsApp";
}

// ───────── Tempo real ─────────

function connectSocket() {
  socket?.disconnect();
  // eslint-disable-next-line no-undef
  socket = io({ withCredentials: true });

  socket.on("connect_error", (error) => {
    if (error.message === "unauthorized") showLogin();
  });

  socket.on("whatsapp", (wa) => {
    const previous = state.whatsapp?.status;
    state.whatsapp = wa;
    updatePill();
    if (previous && previous !== wa.status && wa.status === "open") toast("WhatsApp conectado");
    current?.onWhatsApp?.(wa);
  });

  socket.on("campaign", (campaign) => {
    current?.onCampaign?.(campaign);
  });

  socket.on("changed", ({ type }) => {
    pendingChanges.add(type);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(flushChanges, 400);
  });
}

async function flushChanges() {
  const types = [...pendingChanges];
  pendingChanges.clear();
  if (types.includes("contacts")) await loadBootstrap().catch(() => {});
  current?.onChanged?.(types);
}

// ───────── Navegação ─────────

async function route() {
  const name = location.hash.slice(1) || "kanban";
  const view = views[name] ?? views.kanban;

  for (const link of document.querySelectorAll("#tabs a")) {
    if (link.dataset.view === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  current?.destroy?.();
  current = view;
  const container = $("#view");
  container.className = `view view-${name}`;
  container.replaceChildren();

  try {
    await view.mount(container);
  } catch (error) {
    toast(error.message, "error");
  }
}

window.addEventListener("hashchange", () => {
  if (!$("#app").hidden) route();
});

async function startApp(user) {
  state.user = user;
  $("#user-name").textContent = user?.name ?? "";
  $("#user-name").title = user?.email ?? "";
  await loadBootstrap();
  $("#login").hidden = true;
  $("#app").hidden = false;
  connectSocket();
  await route();
}

(async () => {
  try {
    const session = await get("/session");
    if (session.authenticated) await startApp(session.user);
    else showLogin(session);
  } catch {
    showLogin();
  }
})();

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

// ───────── Login ─────────

function showLogin() {
  socket?.disconnect();
  socket = null;
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#login-form input[name=password]").focus();
}

setUnauthorizedHandler(showLogin);

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $("#login-error");
  error.textContent = "";
  try {
    await post("/login", { password: form.password.value });
    form.reset();
    await startApp();
  } catch (err) {
    error.textContent = err.message;
  }
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

async function startApp() {
  await loadBootstrap();
  $("#login").hidden = true;
  $("#app").hidden = false;
  connectSocket();
  await route();
}

(async () => {
  try {
    const { authenticated } = await get("/session");
    if (authenticated) await startApp();
    else showLogin();
  } catch {
    showLogin();
  }
})();

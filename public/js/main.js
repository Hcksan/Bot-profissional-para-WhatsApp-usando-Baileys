import { $, avatar, icon, toast } from "./dom.js";
import { get, post, setUnauthorizedHandler } from "./api.js";
import { hooks, state } from "./state.js";
import home from "./views/home.js";
import kanban from "./views/kanban.js";
import contacts from "./views/contacts.js";
import campaigns from "./views/campaigns.js";
import schedules from "./views/schedules.js";
import whatsapp from "./views/whatsapp.js";
import users from "./views/users.js";
import settings from "./views/settings.js";

const views = { inicio: home, kanban, contatos: contacts, campanhas: campaigns, agendamentos: schedules, whatsapp, usuarios: users, config: settings };
const ADMIN_VIEWS = new Set(["usuarios"]);

let current = null;
let socket = null;
let refreshTimer = null;
const pendingChanges = new Set();

// ───────── Login, primeira conta e primeiro acesso com código ─────────

const screens = {
  login: { title: "Entrar", subtitle: "Entre com seu e-mail" },
  setup: { title: "Primeiro acesso", subtitle: "Crie a conta de administrador do painel" },
  activate: { title: "Primeiro acesso", subtitle: "Informe seu e-mail e o código que você recebeu" },
};

function showAuthError(message) {
  const box = $("#auth-error");
  box.textContent = message ?? "";
  box.hidden = !message;
}

function showScreen(screen) {
  $("#auth-title").textContent = screens[screen].title;
  $("#auth-subtitle").textContent = screens[screen].subtitle;
  for (const name of Object.keys(screens)) $(`#${name}-form`).hidden = name !== screen;
  showAuthError(null);
  $(`#${screen}-form input:not([hidden])`)?.focus();
}

function showLogin({ setupRequired = false } = {}) {
  socket?.disconnect();
  socket = null;
  state.user = null;
  current?.destroy?.();
  current = null;
  $("#app").hidden = true;
  $("#login").hidden = false;
  showScreen(setupRequired ? "setup" : "login");
}

setUnauthorizedHandler(() => showLogin());

// Mostrar/ocultar senha
for (const eye of document.querySelectorAll(".auth-eye")) {
  eye.addEventListener("click", () => {
    const input = eye.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    eye.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
    eye.querySelector(".i-eye").toggleAttribute("hidden", show);
    eye.querySelector(".i-eye-off").toggleAttribute("hidden", !show);
  });
}
$("#auth-year").textContent = String(new Date().getFullYear());

/**
 * Envia um formulário da tela de acesso: trava o botão, mostra o erro ou segue em frente
 */
function onAuthSubmit(form, { busyText, send, done = (result) => startApp(result.user) }) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector(".auth-step:not([hidden]) button[type=submit]") ?? form.querySelector("button[type=submit]");
    const label = button.textContent;
    showAuthError(null);
    button.disabled = true;
    button.textContent = busyText();
    try {
      await done(await send(form));
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
  busyText: () => "Entrando...",
  send: (form) => post("/login", { email: form.email.value, password: form.password.value }),
  done: async (result) => {
    $("#login-form").reset();
    await startApp(result.user);
  },
});

onAuthSubmit($("#setup-form"), {
  busyText: () => "Criando conta...",
  send: (form) => {
    if (form.password.value !== form.confirm.value) throw new Error("As senhas não conferem");
    return post("/setup", { code: form.code.value, name: form.name.value, email: form.email.value, password: form.password.value });
  },
  done: async (result) => {
    $("#setup-form").reset();
    await startApp(result.user);
  },
});

// Primeiro acesso com código: 1) e-mail + código → 2) confirmar nome e criar a senha
const activateForm = $("#activate-form");
const activateStep = (step) => {
  for (const el of activateForm.querySelectorAll(".auth-step")) el.hidden = el.dataset.step !== step;
  $("#auth-subtitle").textContent = step === "code" ? screens.activate.subtitle : "Confirme seu nome e crie sua senha";
};
const currentStep = () => activateForm.querySelector(".auth-step:not([hidden])").dataset.step;

onAuthSubmit(activateForm, {
  busyText: () => (currentStep() === "code" ? "Conferindo..." : "Entrando..."),
  send: (form) => {
    const credentials = { email: form.email.value, code: form.code.value };
    if (currentStep() === "code") return post("/activation/verify", credentials);
    if (form.password.value !== form.confirm.value) throw new Error("As senhas não conferem");
    return post("/activation/complete", { ...credentials, name: form.name.value, password: form.password.value });
  },
  done: async (result) => {
    if (currentStep() === "code") {
      $("#activate-welcome").textContent = `Olá, ${result.name}! Sua conta é ${result.email}.`;
      activateForm.name.value = result.name;
      activateStep("profile");
      activateForm.password.focus();
      return;
    }
    activateForm.reset();
    activateStep("code");
    await startApp(result.user);
  },
});

activateForm.code.addEventListener("input", () => {
  const raw = activateForm.code.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  activateForm.code.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
});
$("#activate-link").addEventListener("click", () => {
  activateForm.email.value = $("#login-form").email.value;
  activateStep("code");
  showScreen("activate");
});
activateForm.querySelector("[data-back-to-login]").addEventListener("click", () => {
  activateForm.reset();
  activateStep("code");
  showScreen("login");
});

// ───────── Menu lateral ─────────

for (const link of document.querySelectorAll("#tabs a[data-icon]")) link.prepend(icon(link.dataset.icon));
$("#logout-btn").append(icon("log-out"));
$("#menu-btn").append(icon("menu"));

const setMenu = (open) => {
  $("#app").classList.toggle("menu-open", open);
  $("#menu-btn").setAttribute("aria-expanded", String(open));
};
$("#menu-btn").addEventListener("click", () => setMenu(!$("#app").classList.contains("menu-open")));
$("#sidebar-backdrop").addEventListener("click", () => setMenu(false));
document.addEventListener("keydown", (event) => event.key === "Escape" && setMenu(false));

$("#logout-btn").addEventListener("click", async () => {
  await post("/logout").catch(() => {});
  showLogin();
});

function showUser(user) {
  $("#user-avatar").replaceChildren(avatar(user?.name ?? "", user?.email, "sm"));
  $("#user-name").textContent = user?.name ?? "";
  $("#user-role").textContent = user?.role === "admin" ? "Administrador" : "Membro";
  $("#user-role").title = user?.email ?? "";
  for (const el of document.querySelectorAll("[data-admin]")) el.hidden = user?.role !== "admin";
}

// ───────── Estado global ─────────

async function loadBootstrap() {
  const data = await get("/bootstrap");
  Object.assign(state, data);
  updatePill();
  return data;
}
hooks.reload = loadBootstrap;

const PILL = {
  open: ["Conectado", "WhatsApp funcionando"],
  qr: ["Escaneie o QR Code", "Toque para conectar"],
  connecting: ["Conectando...", "Aguarde um instante"],
  disconnected: ["Desconectado", "Toque para conectar"],
};

function updatePill() {
  const { status, me } = state.whatsapp ?? {};
  const [label, sub] = PILL[status] ?? PILL.disconnected;
  for (const pill of document.querySelectorAll("[data-wa-pill]")) {
    pill.dataset.status = status ?? "disconnected";
    pill.querySelector(".label").textContent = label;
    const small = pill.querySelector("small");
    if (small) small.textContent = status === "open" && me?.phone ? `+${me.phone}` : sub;
  }
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
  let name = location.hash.slice(1) || "inicio";
  if (!views[name] || (ADMIN_VIEWS.has(name) && state.user?.role !== "admin")) name = "inicio";
  const view = views[name];

  for (const link of document.querySelectorAll("#tabs a")) {
    if (link.dataset.view === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  setMenu(false);

  current?.destroy?.();
  current = view;
  const container = $("#view");
  container.className = `view view-${name}`;
  container.replaceChildren();
  window.scrollTo(0, 0);

  try {
    await view.mount(container);
  } catch (error) {
    toast(error.message, "error");
  }
}

window.addEventListener("hashchange", () => {
  if (!$("#app").hidden) route();
});

/**
 * Faixa de aviso quando um administrador está no espaço de outra conta
 */
function showWorkspace(workspace) {
  state.workspace = workspace;
  const helping = Boolean(workspace && !workspace.own);
  $("#support-banner").hidden = !helping;
  $("#support-name").textContent = workspace?.name ?? "";
}

$("#support-banner").prepend(icon("users-round"));
$("#support-exit").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  try {
    await post("/workspace/switch", { workspace_id: null });
  } finally {
    // Recarrega para trocar dados, tempo real e WhatsApp de uma vez
    location.hash = "#inicio";
    location.reload();
  }
});

async function startApp(user) {
  state.user = user;
  showUser(user);
  showWorkspace((await get("/session")).workspace);
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

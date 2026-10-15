import { test } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { setup } from "./helpers.js";
import { CampaignRunner } from "../src/crm/CampaignRunner.js";
import { createAuth } from "../src/web/auth.js";
import { createApp } from "../src/web/app.js";
import { describeDevice } from "../src/web/security.js";
import { hashPassword } from "../src/web/password.js";

const EMAIL = "dono@exemplo.com.br";
const PASSWORD = "uma-senha-bem-forte-1";
const SETUP_CODE = "codigo-do-primeiro-acesso";

async function createUser(store, { name = "Dono", email = EMAIL, password = PASSWORD, role = "admin" } = {}) {
  return store.createUser({ name, email, passwordHash: await hashPassword(password), role });
}

async function startServer({ ctx = setup(), withUser = true, cookieSecure = false, publicUrl = "", revoked = [] } = {}) {
  if (withUser && ctx.store.countUsers() === 0) await createUser(ctx.store);
  const runner = new CampaignRunner({ store: ctx.store, crm: ctx.crm, wa: ctx.wa, now: ctx.now });
  const auth = createAuth({ store: ctx.store, password: SETUP_CODE, cookieSecure, publicUrl, now: Date.now });
  const app = createApp({
    store: ctx.store,
    crm: ctx.crm,
    wa: ctx.wa,
    runner,
    auth,
    config: { cookieSecure, publicUrl },
    onSessionsRevoked: (hashes) => revoked.push(...hashes),
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = (path, { method = "GET", body, cookie, headers = {} } = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const login = async (userAgent = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", { email = EMAIL, password = PASSWORD } = {}) => {
    const response = await request("/api/login", { method: "POST", body: { email, password }, headers: { "User-Agent": userAgent } });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };

  return { ctx, server, base, request, login, close: () => server.close() };
}

test("cabeçalhos de segurança e cookie protegido", async () => {
  const app = await startServer();
  try {
    const page = await app.request("/");
    const csp = page.headers.get("content-security-policy");
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("x-powered-by"), null);

    const response = await app.request("/api/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.equal((await app.request("/api/contacts", { cookie: cookie.split(";")[0] })).headers.get("cache-control"), "no-store");
  } finally {
    app.close();
  }
});

test("com HTTPS o cookie usa __Host- e Secure, e envia HSTS", async () => {
  const app = await startServer({ cookieSecure: true });
  try {
    const response = await app.request("/api/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /^__Host-crm_session=/);
    assert.match(cookie, /Secure/);
    assert.match(response.headers.get("strict-transport-security"), /max-age=31536000/);
  } finally {
    app.close();
  }
});

test("bloqueia ações vindas de outros sites (CSRF)", async () => {
  const app = await startServer({ publicUrl: "https://crm.exemplo.com.br" });
  try {
    const cookie = await app.login();

    const evil = await app.request("/api/contacts", { method: "POST", cookie, body: { phone: "11987654321" }, headers: { Origin: "https://site-malicioso.com" } });
    assert.equal(evil.status, 403);

    const form = await app.request("/api/whatsapp/logout", {
      method: "POST",
      cookie,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assert.equal(form.status, 415);

    const evilDelete = await app.request("/api/sessions/1", { method: "DELETE", cookie, headers: { Origin: "https://site-malicioso.com" } });
    assert.equal(evilDelete.status, 403);

    // O próprio domínio público é aceito
    const ok = await app.request("/api/contacts", { method: "POST", cookie, body: { phone: "11987654321" }, headers: { Origin: "https://crm.exemplo.com.br" } });
    assert.equal(ok.status, 201);
  } finally {
    app.close();
  }
});

test("bloqueia tentativas de senha em sequência", async () => {
  const app = await startServer();
  try {
    for (let i = 0; i < 5; i++) {
      const wrong = await app.request("/api/login", { method: "POST", body: { email: EMAIL, password: `errada-${i}` } });
      assert.equal(wrong.status, 401);
    }
    // Mesmo com a senha certa, fica bloqueado
    const blocked = await app.request("/api/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
    assert.equal(blocked.status, 429);
  } finally {
    app.close();
  }
});

test("várias sessões ao mesmo tempo: listar e encerrar", async () => {
  const revoked = [];
  const app = await startServer({ revoked });
  try {
    const pc = await app.login("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0");
    const phone = await app.login("Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile");

    // Os dois aparelhos funcionam ao mesmo tempo
    assert.equal((await app.request("/api/contacts", { cookie: pc })).status, 200);
    assert.equal((await app.request("/api/contacts", { cookie: phone })).status, 200);

    const sessions = await (await app.request("/api/sessions", { cookie: pc })).json();
    assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map((s) => s.device).sort(), ["Chrome no Android", "Chrome no Windows"]);
    assert.equal(sessions.filter((s) => s.current).length, 1);
    assert.ok(sessions.every((s) => !("token_hash" in s)), "não expõe o hash do token");

    // Encerra o celular a partir do PC
    const phoneSession = sessions.find((s) => !s.current);
    assert.equal((await app.request(`/api/sessions/${phoneSession.id}`, { method: "DELETE", cookie: pc })).status, 204);
    assert.equal((await app.request("/api/contacts", { cookie: phone })).status, 401);
    assert.equal((await app.request("/api/contacts", { cookie: pc })).status, 200);
    assert.equal(revoked.length, 1);

    // "Sair de todos os outros"
    const tablet = await app.login("Mozilla/5.0 (iPad; CPU OS 17) Safari/604.1");
    const result = await (await app.request("/api/sessions/revoke-others", { method: "POST", cookie: pc, body: {} })).json();
    assert.equal(result.closed, 1);
    assert.equal((await app.request("/api/contacts", { cookie: tablet })).status, 401);
    assert.equal((await app.request("/api/contacts", { cookie: pc })).status, 200);

    // Logout encerra a própria sessão
    await app.request("/api/logout", { method: "POST", cookie: pc, body: {} });
    assert.equal((await app.request("/api/contacts", { cookie: pc })).status, 401);
  } finally {
    app.close();
  }
});

test("login: e-mail sem diferença de maiúsculas, mensagem igual para e-mail ou senha errados", async () => {
  const app = await startServer();
  try {
    const unknown = await app.request("/api/login", { method: "POST", body: { email: "ninguem@exemplo.com", password: PASSWORD } });
    const wrong = await app.request("/api/login", { method: "POST", body: { email: EMAIL, password: "errada-123" } });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(await unknown.json(), await wrong.json());

    const ok = await app.request("/api/login", { method: "POST", body: { email: `  ${EMAIL.toUpperCase()} `, password: PASSWORD } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual(body.user, { id: 1, name: "Dono", email: EMAIL, role: "admin" });
    assert.ok(!("password_hash" in body.user));

    const cookie = ok.headers.get("set-cookie").split(";")[0];
    const session = await (await app.request("/api/session", { cookie })).json();
    assert.deepEqual(session, { authenticated: true, user: { id: 1, name: "Dono", email: EMAIL, role: "admin" }, workspace: null });
    assert.deepEqual(await (await app.request("/api/session")).json(), { authenticated: false, setupRequired: false });
  } finally {
    app.close();
  }
});

test("primeiro acesso: cria a conta com o código e só uma vez", async () => {
  const app = await startServer({ withUser: false });
  try {
    assert.deepEqual(await (await app.request("/api/session")).json(), { authenticated: false, setupRequired: true });
    // Sem conta, ninguém entra
    assert.equal((await app.request("/api/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } })).status, 401);

    const account = { name: "Gabriel", email: "Gabriel@Exemplo.com", password: "senha-forte-123" };
    assert.equal((await app.request("/api/setup", { method: "POST", body: { ...account, code: "codigo-errado" } })).status, 401);
    const weak = await app.request("/api/setup", { method: "POST", body: { ...account, code: SETUP_CODE, password: "semnumeros" } });
    assert.equal(weak.status, 400);
    assert.match((await weak.json()).error, /números/);
    assert.equal((await app.request("/api/setup", { method: "POST", body: { ...account, code: SETUP_CODE, email: "invalido" } })).status, 400);
    assert.equal(app.ctx.store.countUsers(), 0);

    const created = await app.request("/api/setup", { method: "POST", body: { ...account, code: SETUP_CODE } });
    assert.equal(created.status, 200);
    const cookie = created.headers.get("set-cookie").split(";")[0];
    assert.equal((await app.request("/api/contacts", { cookie })).status, 200);
    assert.equal(app.ctx.store.getUser(1).email, "gabriel@exemplo.com");
    assert.equal(app.ctx.store.getUser(1).role, "admin", "a primeira conta é administradora");
    assert.match(app.ctx.store.getUserWithPassword("gabriel@exemplo.com").password_hash, /^\$argon2id\$/);

    // Depois de criada, o código não cria outra conta nem serve como senha
    assert.equal((await app.request("/api/setup", { method: "POST", body: { ...account, email: "outro@exemplo.com", code: SETUP_CODE } })).status, 409);
    assert.equal((await app.request("/api/login", { method: "POST", body: { email: "gabriel@exemplo.com", password: SETUP_CODE } })).status, 401);
    assert.equal((await app.login(undefined, { email: "gabriel@exemplo.com", password: "senha-forte-123" })).startsWith("crm_session="), true);
  } finally {
    app.close();
  }
});

test("trocar a senha encerra as sessões dos outros aparelhos", async () => {
  const revoked = [];
  const app = await startServer({ revoked });
  try {
    const pc = await app.login();
    const phone = await app.login("Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile");
    const change = (body) => app.request("/api/account/password", { method: "POST", cookie: pc, body });

    assert.equal((await change({ currentPassword: "errada", newPassword: "nova-senha-123" })).status, 400);
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: "curta1" })).status, 400);
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: PASSWORD })).status, 400);

    const ok = await change({ currentPassword: PASSWORD, newPassword: "nova-senha-123" });
    assert.deepEqual(await ok.json(), { ok: true, closed: 1 });
    assert.equal(revoked.length, 1);
    assert.equal((await app.request("/api/contacts", { cookie: phone })).status, 401);
    assert.equal((await app.request("/api/contacts", { cookie: pc })).status, 200);

    assert.equal((await app.request("/api/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } })).status, 401);
    await app.login(undefined, { password: "nova-senha-123" });
  } finally {
    app.close();
  }
});

test("cada conta só vê e encerra as próprias sessões", async () => {
  const ctx = setup();
  await createUser(ctx.store);
  await createUser(ctx.store, { name: "Outra", email: "outra@exemplo.com", password: "outra-senha-123", role: "member" });
  const app = await startServer({ ctx });
  try {
    const mine = await app.login();
    const theirs = await app.login(undefined, { email: "outra@exemplo.com", password: "outra-senha-123" });

    const sessions = await (await app.request("/api/sessions", { cookie: mine })).json();
    assert.equal(sessions.length, 1);
    const [theirSession] = await (await app.request("/api/sessions", { cookie: theirs })).json();
    assert.equal((await app.request(`/api/sessions/${theirSession.id}`, { method: "DELETE", cookie: mine })).status, 404);

    await app.request("/api/sessions/revoke-others", { method: "POST", cookie: mine, body: {} });
    assert.equal((await app.request("/api/contacts", { cookie: theirs })).status, 200);
    assert.deepEqual(await (await app.request("/api/account", { cookie: theirs })).json().then(({ name, email }) => ({ name, email })), { name: "Outra", email: "outra@exemplo.com" });
  } finally {
    app.close();
  }
});

test("administrador convida uma conta e a pessoa entra com o código", async () => {
  const revoked = [];
  const app = await startServer({ revoked });
  try {
    const admin = await app.login();
    const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });

    // Convite: só nome e e-mail; volta o código uma única vez
    const invalid = await json(await app.request("/api/users", { method: "POST", cookie: admin, body: { name: "Ana", email: "x" } }));
    assert.equal(invalid.status, 400);
    const created = await json(await app.request("/api/users", { method: "POST", cookie: admin, body: { name: "Ana Souza", email: "Ana@Exemplo.com" } }));
    assert.equal(created.status, 201);
    assert.match(created.body.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(created.body.user.status, "pending");
    assert.equal(created.body.user.role, "member");
    const duplicated = await app.request("/api/users", { method: "POST", cookie: admin, body: { name: "Ana", email: "ana@exemplo.com" } });
    assert.equal(duplicated.status, 409);

    const list = await (await app.request("/api/users", { cookie: admin })).json();
    assert.equal(list.length, 2);
    const ana = list.find((user) => user.email === "ana@exemplo.com");
    assert.ok(ana.activation_expires_at > Date.now());
    assert.ok(!("password_hash" in ana));
    assert.equal(list.find((user) => user.is_me).email, EMAIL);

    // Sem senha ainda, não entra pelo login normal
    assert.equal((await app.request("/api/login", { method: "POST", body: { email: "ana@exemplo.com", password: "" } })).status, 401);

    // Primeiro acesso: código errado → genérico; código certo (com minúsculas e sem hífen) → mostra o nome
    const wrong = await json(await app.request("/api/activation/verify", { method: "POST", body: { email: "ana@exemplo.com", code: "AAAA-AAAA" } }));
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /inválido ou expirado/);
    const code = created.body.code.replace("-", "").toLowerCase();
    const verified = await json(await app.request("/api/activation/verify", { method: "POST", body: { email: "ANA@exemplo.com", code } }));
    assert.deepEqual(verified.body, { name: "Ana Souza", email: "ana@exemplo.com" });

    const weak = await app.request("/api/activation/complete", { method: "POST", body: { email: "ana@exemplo.com", code, name: "Ana", password: "fraca" } });
    assert.equal(weak.status, 400);
    const done = await app.request("/api/activation/complete", { method: "POST", body: { email: "ana@exemplo.com", code, name: "Ana S.", password: "senha-da-ana-1" } });
    assert.equal(done.status, 200);
    const anaCookie = done.headers.get("set-cookie").split(";")[0];
    assert.deepEqual((await (await app.request("/api/session", { cookie: anaCookie })).json()).user, { id: ana.id, name: "Ana S.", email: "ana@exemplo.com", role: "member" });
    assert.equal((await app.request("/api/contacts", { cookie: anaCookie })).status, 200);

    // O código não serve duas vezes
    assert.equal((await app.request("/api/activation/verify", { method: "POST", body: { email: "ana@exemplo.com", code } })).status, 400);

    // Membro não gerencia contas
    assert.equal((await app.request("/api/users", { cookie: anaCookie })).status, 403);
    assert.equal((await app.request("/api/users", { method: "POST", cookie: anaCookie, body: { name: "Zé", email: "ze@exemplo.com" } })).status, 403);

    // Esqueceu a senha: o administrador gera um código novo e ela redefine
    const reset = await (await app.request(`/api/users/${ana.id}/activation-code`, { method: "POST", cookie: admin, body: {} })).json();
    const redone = await app.request("/api/activation/complete", { method: "POST", body: { email: "ana@exemplo.com", code: reset.code, name: "Ana S.", password: "senha-nova-da-ana-2" } });
    assert.equal(redone.status, 200);
    assert.equal((await app.request("/api/contacts", { cookie: anaCookie })).status, 401, "o primeiro acesso encerra as sessões antigas");

    // Bloqueio derruba a sessão e impede o login
    const anaAgain = await app.login(undefined, { email: "ana@exemplo.com", password: "senha-nova-da-ana-2" });
    const blocked = await app.request(`/api/users/${ana.id}`, { method: "PATCH", cookie: admin, body: { status: "blocked" } });
    assert.equal((await blocked.json()).status, "blocked");
    assert.equal((await app.request("/api/contacts", { cookie: anaAgain })).status, 401);
    assert.ok(revoked.length >= 1);
    const denied = await app.request("/api/login", { method: "POST", body: { email: "ana@exemplo.com", password: "senha-nova-da-ana-2" } });
    assert.equal(denied.status, 403);
    assert.equal((await app.request(`/api/users/${ana.id}/activation-code`, { method: "POST", cookie: admin, body: {} })).status, 400);

    // Desbloquear e promover
    await app.request(`/api/users/${ana.id}`, { method: "PATCH", cookie: admin, body: { status: "active", role: "admin" } });
    const promoted = await app.login(undefined, { email: "ana@exemplo.com", password: "senha-nova-da-ana-2" });
    assert.equal((await app.request("/api/users", { cookie: promoted })).status, 200);

    // Remover
    assert.equal((await app.request(`/api/users/${ana.id}`, { method: "DELETE", cookie: admin })).status, 204);
    assert.equal((await app.request("/api/contacts", { cookie: promoted })).status, 401);
  } finally {
    app.close();
  }
});

test("contas: proteções do administrador", async () => {
  const app = await startServer();
  try {
    const admin = await app.login();
    const me = app.ctx.store.getUserWithPassword(EMAIL).id;
    const patchMe = (body) => app.request(`/api/users/${me}`, { method: "PATCH", cookie: admin, body });

    assert.match((await (await patchMe({ status: "blocked" })).json()).error, /própria conta/);
    assert.match((await (await patchMe({ role: "member" })).json()).error, /administrador/);
    assert.equal((await app.request(`/api/users/${me}`, { method: "DELETE", cookie: admin })).status, 400);
    assert.equal((await app.request("/api/users/999", { method: "PATCH", cookie: admin, body: { status: "blocked" } })).status, 404);

    // Pendente desbloqueado volta a aguardar o primeiro acesso
    const { user } = await (await app.request("/api/users", { method: "POST", cookie: admin, body: { name: "Bia", email: "bia@exemplo.com", role: "admin" } })).json();
    await app.request(`/api/users/${user.id}`, { method: "PATCH", cookie: admin, body: { status: "blocked" } });
    const unblocked = await (await app.request(`/api/users/${user.id}`, { method: "PATCH", cookie: admin, body: { status: "active" } })).json();
    assert.equal(unblocked.status, "pending");
  } finally {
    app.close();
  }
});

test("código de primeiro acesso: 5 tentativas erradas invalidam", async () => {
  const app = await startServer();
  try {
    const admin = await app.login();
    const { code } = await (await app.request("/api/users", { method: "POST", cookie: admin, body: { name: "Caio", email: "caio@exemplo.com" } })).json();
    for (let i = 0; i < 4; i++) await app.request("/api/activation/verify", { method: "POST", body: { email: "caio@exemplo.com", code: `ZZZZ-ZZZ${i + 2}` } });
    const fifth = await (await app.request("/api/activation/verify", { method: "POST", body: { email: "caio@exemplo.com", code: "ZZZZ-ZZZZ" } })).json();
    assert.match(fifth.error, /Muitas tentativas/);
    assert.ok(code, "o convite devolve o código");
  } finally {
    app.close();
  }
});

test("painel inicial: números do dia e quem espera resposta", async () => {
  const app = await startServer();
  try {
    const cookie = await app.login();
    const { store } = app.ctx;
    const a = store.createContact({ phone: "11987654321", name: "Ana", stage_id: 1 });
    store.createContact({ phone: "11987654322", name: "Bruno", stage_id: 1 });
    store.logMessage({ contact_id: a.id, direction: "in", source: "phone", text: "Oi, tem horário?" });
    store.db.prepare("UPDATE contacts SET last_inbound_at = ? WHERE id = ?").run(app.ctx.now(), a.id);

    const data = await (await app.request("/api/dashboard", { cookie })).json();
    assert.equal(data.contacts.total, 2);
    assert.equal(data.contacts.awaiting, 1);
    assert.equal(data.awaiting[0].name, "Ana");
    assert.deepEqual(data.contacts.by_stage, [{ stage_id: 1, total: 2 }]);
    assert.equal(data.messages_today.received, 1);
    assert.ok("whatsapp" in data && "settings" in data);
  } finally {
    app.close();
  }
});

test("em produção exige código forte enquanto não há conta", async () => {
  const { store } = setup();
  assert.throws(() => createAuth({ store, password: "", production: true }), /pelo menos 12/);
  assert.throws(() => createAuth({ store, password: "curta", production: true }), /pelo menos 12/);
  assert.doesNotThrow(() => createAuth({ store, password: "uma-senha-de-producao", production: true, cookieSecure: true }));

  // Com a conta criada, o código não é mais necessário
  await createUser(store);
  assert.doesNotThrow(() => createAuth({ store, password: "", production: true, cookieSecure: true }));
});

test("describeDevice reconhece navegadores comuns", () => {
  assert.equal(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0"), "Edge no Windows");
  assert.equal(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"), "Safari no iPhone/iPad");
  assert.equal(describeDevice(""), "Navegador");
});

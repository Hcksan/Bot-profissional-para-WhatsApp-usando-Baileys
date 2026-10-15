import { test } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { setup } from "./helpers.js";
import { CampaignRunner } from "../src/crm/CampaignRunner.js";
import { createAuth } from "../src/web/auth.js";
import { createApp } from "../src/web/app.js";
import { describeDevice } from "../src/web/security.js";

const PASSWORD = "uma-senha-bem-forte";

async function startServer({ ctx = setup(), password = PASSWORD, cookieSecure = false, publicUrl = "", revoked = [] } = {}) {
  const runner = new CampaignRunner({ store: ctx.store, crm: ctx.crm, wa: ctx.wa, now: ctx.now });
  const auth = createAuth({ store: ctx.store, password, cookieSecure, publicUrl, now: Date.now });
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

  const login = async (userAgent = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0") => {
    const response = await request("/api/login", { method: "POST", body: { password }, headers: { "User-Agent": userAgent } });
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

    const response = await app.request("/api/login", { method: "POST", body: { password: PASSWORD } });
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
    const response = await app.request("/api/login", { method: "POST", body: { password: PASSWORD } });
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
      const wrong = await app.request("/api/login", { method: "POST", body: { password: `errada-${i}` } });
      assert.equal(wrong.status, 401);
    }
    // Mesmo com a senha certa, fica bloqueado
    const blocked = await app.request("/api/login", { method: "POST", body: { password: PASSWORD } });
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

test("trocar a senha encerra as sessões antigas", async () => {
  const ctx = setup();
  const first = await startServer({ ctx, password: "senha-antiga-123" });
  const cookie = await first.login();
  assert.equal((await first.request("/api/contacts", { cookie })).status, 200);
  first.close();

  const second = await startServer({ ctx, password: "senha-nova-456789" });
  try {
    assert.equal((await second.request("/api/contacts", { cookie })).status, 401);
  } finally {
    second.close();
  }
});

test("em produção exige senha forte", () => {
  const { store } = setup();
  assert.throws(() => createAuth({ store, password: "", production: true }), /pelo menos 12/);
  assert.throws(() => createAuth({ store, password: "curta", production: true }), /pelo menos 12/);
  assert.doesNotThrow(() => createAuth({ store, password: "uma-senha-de-producao", production: true, cookieSecure: true }));
});

test("describeDevice reconhece navegadores comuns", () => {
  assert.equal(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0"), "Edge no Windows");
  assert.equal(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"), "Safari no iPhone/iPad");
  assert.equal(describeDevice(""), "Navegador");
});

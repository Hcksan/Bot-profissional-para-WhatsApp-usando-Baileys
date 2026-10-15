import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { FakeWhatsApp } from "./helpers.js";
import { openDatabase } from "../src/db/database.js";
import { CrmStore } from "../src/crm/CrmStore.js";
import { WorkspaceManager } from "../src/workspaces/WorkspaceManager.js";
import { createAuth } from "../src/web/auth.js";
import { createApp } from "../src/web/app.js";
import { hashPassword } from "../src/web/password.js";

const ADMIN = { email: "dono@exemplo.com", password: "senha-do-dono-1" };

/**
 * Servidor com espaços de verdade (bancos numa pasta temporária) e um WhatsApp falso por espaço
 */
async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-espacos-"));
  const mainDb = openDatabase(path.join(dir, "crm.db"));
  const mainStore = new CrmStore(mainDb);
  // Conta criada antes dos espaços existirem (como em quem já usava o CRM)
  mainStore.createUser({ name: "Dono", email: ADMIN.email, passwordHash: await hashPassword(ADMIN.password), role: "admin" });

  const phones = new Map();
  const workspaces = new WorkspaceManager({
    mainDb,
    mainStore,
    dataDir: dir,
    sessionsDir: path.join(dir, "sessions"),
    createWhatsApp: ({ label }) => {
      const wa = new FakeWhatsApp();
      wa.connected = label === "espaço 1";
      phones.set(label, wa);
      return wa;
    },
  });
  const auth = createAuth({ store: mainStore, password: "codigo-de-teste", workspaces });
  const server = http.createServer(createApp({ workspaces, auth }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = async (pathname, { method = "GET", body, cookie } = {}) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = async ({ email, password }) => (await request("/api/login", { method: "POST", body: { email, password } })).cookie;

  /** Convida e já faz o primeiro acesso da pessoa. Devolve o cookie dela. */
  const invite = async (adminCookie, { name, email, space }) => {
    const created = await request("/api/users", { method: "POST", cookie: adminCookie, body: { name, email, space } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const done = await request("/api/activation/complete", { method: "POST", body: { email, code: created.data.code, name, password: "senha-nova-123" } });
    assert.equal(done.status, 200);
    return { cookie: done.cookie, user: created.data.user };
  };

  const close = ({ keep = false } = {}) => {
    server.close();
    if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, mainStore, workspaces, phones, request, login, invite, close };
}

test("cada pessoa convidada tem contatos, configurações e WhatsApp separados", async () => {
  const app = await startServer();
  try {
    const { request } = app;
    assert.equal(app.mainStore.getUserWithPassword(ADMIN.email).workspace_id, 1, "quem já existia fica no espaço 1");

    const admin = await app.login(ADMIN);
    await request("/api/contacts", { method: "POST", cookie: admin, body: { phone: "11987654321", name: "Cliente do dono" } });

    const { cookie: bia } = await app.invite(admin, { name: "Bia Lima", email: "bia@exemplo.com" });
    assert.ok(fs.existsSync(path.join(app.dir, "workspaces", "ws-2.db")), "banco próprio do espaço novo");

    // A Bia começa vazia, com as etapas padrão, e não vê nada do dono
    assert.deepEqual((await request("/api/contacts", { cookie: bia })).data, []);
    assert.equal((await request("/api/stages", { cookie: bia })).data.length, 5);
    await request("/api/contacts", { method: "POST", cookie: bia, body: { phone: "21999998888", name: "Cliente da Bia" } });
    const adminContacts = (await request("/api/contacts", { cookie: admin })).data.map((contact) => contact.name);
    const biaContacts = (await request("/api/contacts", { cookie: bia })).data.map((contact) => contact.name);
    assert.deepEqual(adminContacts, ["Cliente do dono"]);
    assert.deepEqual(biaContacts, ["Cliente da Bia"]);

    // Contato de um espaço não é acessível pelo id a partir de outro
    const donoId = (await request("/api/contacts", { cookie: admin })).data[0].id;
    const fromBia = await request(`/api/contacts/${donoId}`, { cookie: bia });
    assert.ok(fromBia.status === 404 || fromBia.data.name !== "Cliente do dono");

    // Configurações e painel inicial separados
    await request("/api/settings", { method: "PATCH", cookie: bia, body: { daily_limit: 7 } });
    assert.equal((await request("/api/settings", { cookie: bia })).data.daily_limit, 7);
    assert.notEqual((await request("/api/settings", { cookie: admin })).data.daily_limit, 7);
    assert.equal((await request("/api/dashboard", { cookie: bia })).data.contacts.total, 1);

    // WhatsApp: o dono está conectado, a Bia ainda não (cada espaço tem o seu)
    assert.equal((await request("/api/whatsapp", { cookie: admin })).data.status, "open");
    assert.equal((await request("/api/whatsapp", { cookie: bia })).data.status, "disconnected");
    assert.equal((await request("/api/contacts/1/send", { method: "POST", cookie: bia, body: { text: "oi" } })).status, 409);
  } finally {
    app.close();
  }
});

test("convite para a mesma equipe compartilha o espaço de quem convidou", async () => {
  const app = await startServer();
  try {
    const { request } = app;
    const admin = await app.login(ADMIN);
    await request("/api/contacts", { method: "POST", cookie: admin, body: { phone: "11987654321", name: "Cliente do dono" } });

    const { cookie: caio } = await app.invite(admin, { name: "Caio", email: "caio@exemplo.com", space: "team" });
    assert.deepEqual((await request("/api/contacts", { cookie: caio })).data.map((contact) => contact.name), ["Cliente do dono"]);
    assert.ok(!fs.existsSync(path.join(app.dir, "workspaces")), "nenhum espaço novo foi criado");

    const users = (await request("/api/users", { cookie: admin })).data;
    assert.ok(users.every((user) => user.workspace_id === 1 && user.workspace_members === 2));
    assert.equal((await request("/api/users", { method: "POST", cookie: admin, body: { name: "X", email: "x@exemplo.com", space: "outro" } })).status, 400);
  } finally {
    app.close();
  }
});

test("remover a última conta de um espaço arquiva o espaço e desconecta o WhatsApp dela", async () => {
  const app = await startServer();
  try {
    const { request } = app;
    const admin = await app.login(ADMIN);
    const { cookie: bia, user } = await app.invite(admin, { name: "Bia", email: "bia@exemplo.com" });
    await request("/api/contacts", { method: "POST", cookie: bia, body: { phone: "21999998888", name: "Cliente da Bia" } });

    assert.equal((await request(`/api/users/${user.id}`, { method: "DELETE", cookie: admin })).status, 204);
    assert.equal(app.workspaces.get(2), null);
    assert.equal(app.phones.get("espaço 2").unlinked, true);
    assert.ok(!fs.existsSync(path.join(app.dir, "workspaces", "ws-2.db")));
    const removed = fs.readdirSync(path.join(app.dir, "removidos"));
    assert.ok(removed.some((name) => /^ws-2-\d{4}-\d{2}-\d{2}\.db$/.test(name)), "os dados ficam guardados");

    // O espaço do dono continua funcionando
    assert.equal((await request("/api/contacts", { cookie: admin })).status, 200);
    assert.ok(app.workspaces.get(1));
  } finally {
    app.close();
  }
});

test("espaços continuam depois de reiniciar o servidor", async () => {
  const app = await startServer();
  const admin = await app.login(ADMIN);
  const { cookie: bia } = await app.invite(admin, { name: "Bia", email: "bia@exemplo.com" });
  await app.request("/api/contacts", { method: "POST", cookie: bia, body: { phone: "21999998888", name: "Cliente da Bia" } });
  app.close({ keep: true });

  // Reabre a mesma pasta, como num restart do serviço
  const mainDb = openDatabase(path.join(app.dir, "crm.db"));
  const mainStore = new CrmStore(mainDb);
  const workspaces = new WorkspaceManager({ mainDb, mainStore, dataDir: app.dir, sessionsDir: path.join(app.dir, "sessions"), createWhatsApp: () => new FakeWhatsApp() });
  assert.deepEqual(mainStore.listWorkspaces().map((workspace) => workspace.id), [1, 2]);
  assert.deepEqual(workspaces.get(2).store.listContacts().map((contact) => contact.name), ["Cliente da Bia"]);
  assert.deepEqual(workspaces.get(1).store.listContacts(), []);
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("administrador entra no espaço de outra conta para ajudar, com registro visível para ela", async () => {
  const app = await startServer();
  try {
    const { request } = app;
    const admin = await app.login(ADMIN);
    await request("/api/contacts", { method: "POST", cookie: admin, body: { phone: "11987654321", name: "Cliente do dono" } });
    const { cookie: bia } = await app.invite(admin, { name: "Bia", email: "bia@exemplo.com" });
    await request("/api/contacts", { method: "POST", cookie: bia, body: { phone: "21999998888", name: "Cliente da Bia" } });
    const names = async (cookie) => (await request("/api/contacts", { cookie })).data.map((contact) => contact.name);

    // Lista de espaços com as pessoas de cada um
    const spaces = (await request("/api/workspaces", { cookie: admin })).data;
    assert.deepEqual(spaces.map((space) => [space.id, space.members.map((member) => member.name), space.own, space.current]), [
      [1, ["Dono"], true, true],
      [2, ["Bia"], false, false],
    ]);

    // Entrar no espaço da Bia: o administrador passa a ver e mexer nos dados dela
    const entered = await request("/api/workspace/switch", { method: "POST", cookie: admin, body: { workspace_id: 2 } });
    assert.deepEqual(entered.data.workspace, { id: 2, name: "Bia", own: false });
    assert.deepEqual(await names(admin), ["Cliente da Bia"]);
    await request("/api/contacts", { method: "POST", cookie: admin, body: { phone: "21977776666", name: "Criado pelo suporte" } });
    assert.deepEqual((await names(bia)).sort(), ["Cliente da Bia", "Criado pelo suporte"]);
    const session = (await request("/api/session", { cookie: admin })).data;
    assert.deepEqual(session.workspace, { id: 2, name: "Bia", own: false });
    assert.equal(session.user.email, ADMIN.email, "continua sendo a conta do administrador");

    // A Bia vê quem entrou no espaço dela
    const log = (await request("/api/workspace/access-log", { cookie: bia })).data;
    assert.equal(log.length, 1);
    assert.equal(log[0].user_email, ADMIN.email);

    // Membros não entram em outros espaços
    assert.equal((await request("/api/workspace/switch", { method: "POST", cookie: bia, body: { workspace_id: 1 } })).status, 403);
    assert.equal((await request("/api/workspaces", { cookie: bia })).status, 403);
    assert.equal((await request("/api/workspace/switch", { method: "POST", cookie: admin, body: { workspace_id: 99 } })).status, 404);

    // Voltar ao próprio espaço
    const back = await request("/api/workspace/switch", { method: "POST", cookie: admin, body: { workspace_id: null } });
    assert.equal(back.data.workspace.own, true);
    assert.deepEqual(await names(admin), ["Cliente do dono"]);
    assert.equal((await request("/api/workspace/access-log", { cookie: admin })).data.length, 0, "voltar ao próprio espaço não gera registro");
  } finally {
    app.close();
  }
});

test("quem deixa de ser administrador volta ao próprio espaço na hora", async () => {
  const app = await startServer();
  try {
    const { request } = app;
    const admin = await app.login(ADMIN);
    const { cookie: bia, user } = await app.invite(admin, { name: "Bia", email: "bia@exemplo.com" });
    await request(`/api/users/${user.id}`, { method: "PATCH", cookie: admin, body: { role: "admin" } });
    const biaAdmin = await app.login({ email: "bia@exemplo.com", password: "senha-nova-123" });
    await request("/api/contacts", { method: "POST", cookie: admin, body: { phone: "11987654321", name: "Cliente do dono" } });

    await request("/api/workspace/switch", { method: "POST", cookie: biaAdmin, body: { workspace_id: 1 } });
    assert.deepEqual((await request("/api/contacts", { cookie: biaAdmin })).data.map((contact) => contact.name), ["Cliente do dono"]);

    await request(`/api/users/${user.id}`, { method: "PATCH", cookie: admin, body: { role: "member" } });
    assert.deepEqual((await request("/api/contacts", { cookie: biaAdmin })).data, []);
    assert.equal((await request("/api/session", { cookie: bia })).data.workspace.own, true);
  } finally {
    app.close();
  }
});

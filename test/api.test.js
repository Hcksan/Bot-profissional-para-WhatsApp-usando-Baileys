import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import XLSX from "xlsx";
import { setup } from "./helpers.js";
import { CampaignRunner } from "../src/crm/CampaignRunner.js";
import { createAuth } from "../src/web/auth.js";
import { createApp } from "../src/web/app.js";

let server;
let base;
let cookie = "";
let ctx;

async function call(path, { method = "GET", body, auth = true } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(auth && cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = response.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await response.json() : await response.arrayBuffer();
  return { status: response.status, data, headers: response.headers };
}

before(async () => {
  ctx = setup();
  const runner = new CampaignRunner({ store: ctx.store, crm: ctx.crm, wa: ctx.wa, now: ctx.now });
  const auth = createAuth({ store: ctx.store, password: "senha-teste" });
  const app = createApp({ store: ctx.store, crm: ctx.crm, wa: ctx.wa, runner, auth });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("rotas exigem login", async () => {
  assert.equal((await call("/api/contacts", { auth: false })).status, 401);
  assert.equal((await call("/api/login", { method: "POST", body: { password: "errada" }, auth: false })).status, 401);

  const login = await call("/api/login", { method: "POST", body: { password: "senha-teste" }, auth: false });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  cookie = setCookie.split(";")[0];

  assert.equal((await call("/api/session")).data.authenticated, true);
  assert.equal((await call("/api/contacts")).status, 200);
});

test("painel é servido", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /CRM Pessoal/);
});

test("contatos via API: criar, validar, mover e enviar", async () => {
  const stages = (await call("/api/stages")).data;
  const created = await call("/api/contacts", { method: "POST", body: { phone: "(11) 98765-4321", name: "Maria", stage_id: stages[0].id } });
  assert.equal(created.status, 201);

  const invalid = await call("/api/contacts", { method: "POST", body: { phone: "12" } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.data.error, /Telefone inválido/);

  const duplicate = await call("/api/contacts", { method: "POST", body: { phone: "11987654321" } });
  assert.equal(duplicate.status, 409);

  const moved = await call(`/api/contacts/${created.data.id}/move`, { method: "POST", body: { stage_id: stages[2].id, index: 0 } });
  assert.equal(moved.data.stage_id, stages[2].id);

  const sent = await call(`/api/contacts/${created.data.id}/send`, { method: "POST", body: { text: "Olá!" } });
  assert.equal(sent.status, 200);
  assert.equal(ctx.wa.sent.at(-1).text, "Olá!");

  const detail = await call(`/api/contacts/${created.data.id}`);
  assert.equal(detail.data.messages.length, 1);
  assert.equal((await call("/api/contacts/abc")).status, 400);
  assert.equal((await call("/api/contacts/9999")).status, 404);
});

test("importa planilha .xlsx com mapeamento automático e exporta", async () => {
  const sheet = XLSX.utils.json_to_sheet([
    { "Nome completo": "João Pereira", Celular: "(21) 99999-0000", Etiquetas: "indicação" },
    { "Nome completo": "Ana", Celular: "21 98888-1111", Etiquetas: "" },
    { "Nome completo": "Sem número", Celular: "", Etiquetas: "" },
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Plan1");
  const data = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }).toString("base64");

  const preview = await call("/api/import/preview", { method: "POST", body: { data } });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.total, 3);
  assert.deepEqual(preview.data.mapping, { phone: "Celular", name: "Nome completo", tags: "Etiquetas" });

  const result = await call("/api/import/commit", { method: "POST", body: { data, mapping: preview.data.mapping, tags: "outubro" } });
  assert.equal(result.data.created, 2);
  assert.equal(result.data.invalid.length, 1);

  const joao = (await call("/api/contacts?q=pereira")).data[0];
  assert.deepEqual(joao.tags, ["indicação", "outubro"]);

  const csv = await call("/api/export?format=csv&tag=outubro");
  assert.equal(csv.status, 200);
  const text = Buffer.from(csv.data).toString("utf8");
  assert.match(text, /João Pereira;5521999990000/);
  assert.doesNotMatch(text, /Maria/);

  const xlsx = await call("/api/export");
  const parsed = XLSX.read(Buffer.from(xlsx.data), { type: "buffer" });
  assert.equal(XLSX.utils.sheet_to_json(parsed.Sheets.Contatos).length, 3);

  const bad = await call("/api/import/preview", { method: "POST", body: { data: "" } });
  assert.equal(bad.status, 400);
});

test("campanha por tag via API", async () => {
  const preview = await call("/api/campaigns/preview", { method: "POST", body: { message: "{Oi|Olá} {primeiro_nome}" } });
  assert.ok(preview.data.samples.every((text) => /^(Oi|Olá) Maria$/.test(text)));

  const created = await call("/api/campaigns", {
    method: "POST",
    body: { name: "Outubro", message: "Oi {primeiro_nome}", min_delay_s: 30, max_delay_s: 60, tag: "outubro" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.total, 2);

  const started = await call(`/api/campaigns/${created.data.id}/start`, { method: "POST" });
  assert.equal(started.data.status, "running");
  assert.equal((await call(`/api/campaigns/${created.data.id}`, { method: "DELETE" })).status, 409);
  assert.equal((await call(`/api/campaigns/${created.data.id}/pause`, { method: "POST" })).data.status, "paused");

  const noAudience = await call("/api/campaigns", { method: "POST", body: { name: "x", message: "y", min_delay_s: 30, max_delay_s: 60 } });
  assert.equal(noAudience.status, 400);
});

test("logout encerra a sessão", async () => {
  await call("/api/logout", { method: "POST" });
  assert.equal((await call("/api/contacts")).status, 401);
});

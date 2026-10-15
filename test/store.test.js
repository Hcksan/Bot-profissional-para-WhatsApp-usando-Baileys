import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

test("cria etapas padrão no primeiro uso", () => {
  const { store } = setup();
  assert.deepEqual(
    store.listStages().map((stage) => stage.name),
    ["Novo", "Em contato", "Negociando", "Fechado", "Perdido"]
  );
});

test("contatos: criar, buscar, evitar duplicados e editar", () => {
  const { store } = setup();
  const [novo] = store.listStages();
  const maria = store.createContact({ phone: "(11) 98765-4321", name: "Maria", tags: "cliente, VIP, cliente", stage_id: novo.id });

  assert.equal(maria.phone, "5511987654321");
  assert.deepEqual(maria.tags, ["cliente", "VIP"]);
  assert.throws(() => store.createContact({ phone: "+55 11 98765-4321" }), /Já existe/);
  // Mesmo número sem o nono dígito também é duplicado
  assert.throws(() => store.createContact({ phone: "551187654321" }), /Já existe/);
  assert.throws(() => store.createContact({ phone: "123" }), /Telefone inválido/);

  assert.equal(store.findContactByPhone("551187654321").id, maria.id);
  assert.equal(store.listContacts({ q: "mar" }).length, 1);
  assert.equal(store.listContacts({ q: "98765" }).length, 1);
  assert.equal(store.listContacts({ q: "joão" }).length, 0);
  assert.equal(store.listContacts({ tag: "vip" }).length, 1);

  const updated = store.updateContact(maria.id, { name: "Maria Souza", notes: "prefere tarde" });
  assert.equal(updated.name, "Maria Souza");
  assert.deepEqual(store.listTags(), [
    { tag: "cliente", total: 1 },
    { tag: "VIP", total: 1 },
  ]);
});

test("kanban: mover contato entre etapas mantém a ordem", () => {
  const { store } = setup();
  const [novo, contato] = store.listStages();
  const a = store.createContact({ phone: "11911111111", name: "A", stage_id: novo.id });
  const b = store.createContact({ phone: "11922222222", name: "B", stage_id: novo.id });
  const c = store.createContact({ phone: "11933333333", name: "C", stage_id: contato.id });

  store.moveContact(a.id, contato.id, 0);
  assert.deepEqual(store.listContacts({ stage_id: contato.id }).map((item) => item.name), ["A", "C"]);
  assert.deepEqual(store.listContacts({ stage_id: novo.id }).map((item) => item.name), ["B"]);

  store.moveContact(c.id, contato.id, 0);
  assert.deepEqual(store.listContacts({ stage_id: contato.id }).map((item) => item.name), ["C", "A"]);

  assert.throws(() => store.deleteStage(contato.id), /Mova os contatos/);
  store.moveContact(b.id, contato.id);
  store.deleteStage(novo.id);
  assert.equal(store.listStages().length, 4);
});

test("importação: cria, atualiza e aponta linhas inválidas", () => {
  const { store } = setup();
  const [novo] = store.listStages();
  store.createContact({ phone: "11987654321", name: "Maria", tags: ["antiga"] });

  const result = store.importContacts(
    [
      { phone: "11987654321", name: "Maria Silva", tags: "nova" },
      { phone: "(21) 99999-0000", name: "João", notes: "indicação" },
      { phone: "abc", name: "Inválido" },
      { phone: "", name: "Vazio" },
    ],
    { stage_id: novo.id, tags: "lista-outubro" }
  );

  assert.equal(result.created, 1);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.invalid.map((item) => item.line), [4, 5]);

  const maria = store.findContactByPhone("5511987654321");
  assert.equal(maria.name, "Maria Silva");
  assert.deepEqual(maria.tags, ["antiga", "nova", "lista-outubro"]);

  const joao = store.findContactByPhone("5521999990000");
  assert.equal(joao.stage_id, novo.id);
  assert.deepEqual(joao.tags, ["lista-outubro"]);
});

test("campanha: ignora quem pediu para sair e valida os tempos", () => {
  const { store } = setup();
  const a = store.createContact({ phone: "11911111111" });
  const b = store.createContact({ phone: "11922222222" });
  store.optOut(b.id);

  const base = { name: "Teste", message: "Oi {nome}", min_delay_s: 30, max_delay_s: 60 };
  assert.throws(() => store.createCampaign({ ...base, min_delay_s: 5 }, [a.id]), /mínimo/);
  assert.throws(() => store.createCampaign({ ...base, max_delay_s: 10 }, [a.id]), /máximo/);
  assert.throws(() => store.createCampaign(base, [b.id]), /pelo menos um contato/);

  const campaign = store.createCampaign(base, [a.id, b.id, a.id]);
  assert.equal(campaign.total, 1);
  assert.equal(campaign.status, "draft");
});

test("agendamentos: só aparecem quando vencem", () => {
  const { store, now } = setup();
  const contact = store.createContact({ phone: "11911111111" });
  const schedule = store.createSchedule({ contact_id: contact.id, text: "Lembrete", send_at: now() + 60000 });

  assert.equal(store.dueSchedules(now()).length, 0);
  assert.equal(store.dueSchedules(now() + 60000).length, 1);
  assert.throws(() => store.createSchedule({ contact_id: contact.id, text: "", send_at: now() }), /Escreva/);
  assert.throws(() => store.createSchedule({ contact_id: contact.id, text: "x", send_at: now(), recurrence: "yearly" }), /Recorrência/);

  store.cancelSchedule(schedule.id);
  assert.equal(store.dueSchedules(now() + 60000).length, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";
import { CampaignRunner } from "../src/crm/CampaignRunner.js";
import { Scheduler } from "../src/crm/Scheduler.js";

function campaignSetup({ contacts = 3, ...fields } = {}) {
  const ctx = setup();
  const [novo, emContato, negociando] = ctx.store.listStages();
  const ids = Array.from({ length: contacts }, (_, index) =>
    ctx.store.createContact({ phone: `1191111000${index}`, name: `Pessoa ${index} Teste`, stage_id: novo.id }).id
  );
  const campaign = ctx.store.createCampaign(
    {
      name: "Retorno",
      message: "{Oi|Olá} {primeiro_nome}",
      min_delay_s: 30,
      max_delay_s: 60,
      pause_every: 0,
      pause_s: 0,
      after_send_stage_id: emContato.id,
      on_reply_stage_id: negociando.id,
      ...fields,
    },
    ids
  );
  const runner = new CampaignRunner({ store: ctx.store, crm: ctx.crm, wa: ctx.wa, now: ctx.now, random: () => 0 });
  return { ...ctx, ids, campaign, runner, stages: { novo, emContato, negociando } };
}

/**
 * Avança o relógio e roda o motor até não haver mais envios
 */
async function runFor(ctx, ms, step = 1000) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    ctx.now.advance(step);
    await ctx.runner.tick();
  }
}

test("campanha envia um por vez respeitando o intervalo mínimo", async () => {
  const ctx = campaignSetup();
  ctx.runner.startCampaign(ctx.campaign.id);

  await runFor(ctx, 3000);
  assert.equal(ctx.wa.sent.length, 1);
  assert.equal(ctx.wa.sent[0].text, "Oi Pessoa");
  assert.ok(ctx.wa.sent[0].typingMs >= 2000, "mostra digitando");

  // random = 0 -> intervalo de exatamente 30s
  await runFor(ctx, 29000);
  assert.equal(ctx.wa.sent.length, 1);
  await runFor(ctx, 1000);
  assert.equal(ctx.wa.sent.length, 2);

  await runFor(ctx, 60000);
  assert.equal(ctx.wa.sent.length, 3);
  const campaign = ctx.store.getCampaign(ctx.campaign.id);
  assert.equal(campaign.status, "done");
  assert.equal(campaign.sent, 3);

  // Depois de enviar, contatos foram para "Em contato"
  for (const id of ctx.ids) assert.equal(ctx.store.getContact(id).stage_id, ctx.stages.emContato.id);
  // Histórico registrado
  assert.equal(ctx.store.listMessages(ctx.ids[0])[0].source, "campaign");
});

test("pausa longa a cada X envios", async () => {
  const ctx = campaignSetup({ contacts: 3, pause_every: 2, pause_s: 600 });
  ctx.runner.startCampaign(ctx.campaign.id);
  await runFor(ctx, 3000 + 30000);
  assert.equal(ctx.wa.sent.length, 2);
  // Terceira só depois de 30s + 10 min
  await runFor(ctx, 600000);
  assert.equal(ctx.wa.sent.length, 2);
  await runFor(ctx, 30000);
  assert.equal(ctx.wa.sent.length, 3);
});

test("respeita o limite diário e a janela de horário", async () => {
  const ctx = campaignSetup({ contacts: 3 });
  ctx.store.updateSettings({ daily_limit: 2 });
  ctx.runner.startCampaign(ctx.campaign.id);

  await runFor(ctx, 3000 + 30000 + 60000);
  assert.equal(ctx.wa.sent.length, 2);
  assert.match(ctx.store.getCampaign(ctx.campaign.id).status_note, /Limite diário/);

  // Dia seguinte às 07:00: fora da janela (08:00–20:00)
  ctx.now.set(new Date(2026, 9, 15, 7, 0).getTime());
  await ctx.runner.tick();
  assert.equal(ctx.wa.sent.length, 2);
  assert.match(ctx.store.getCampaign(ctx.campaign.id).status_note, /Fora do horário.*08:00/);

  ctx.now.set(new Date(2026, 9, 15, 8, 0).getTime());
  await ctx.runner.tick();
  assert.equal(ctx.wa.sent.length, 3);
});

test("pausar, retomar e cancelar", async () => {
  const ctx = campaignSetup({ contacts: 3 });
  ctx.runner.startCampaign(ctx.campaign.id);
  await runFor(ctx, 3000);
  assert.equal(ctx.wa.sent.length, 1);

  ctx.runner.pauseCampaign(ctx.campaign.id);
  await runFor(ctx, 120000);
  assert.equal(ctx.wa.sent.length, 1);

  ctx.runner.startCampaign(ctx.campaign.id);
  await runFor(ctx, 3000);
  assert.equal(ctx.wa.sent.length, 2);

  ctx.runner.cancelCampaign(ctx.campaign.id);
  await runFor(ctx, 120000);
  const campaign = ctx.store.getCampaign(ctx.campaign.id);
  assert.equal(ctx.wa.sent.length, 2);
  assert.equal(campaign.status, "canceled");
  assert.equal(campaign.skipped, 1);
});

test("só uma campanha por vez", () => {
  const ctx = campaignSetup({ contacts: 1 });
  const other = ctx.store.createCampaign({ name: "Outra", message: "x", min_delay_s: 30, max_delay_s: 30 }, ctx.ids);
  ctx.runner.startCampaign(ctx.campaign.id);
  assert.throws(() => ctx.runner.startCampaign(other.id), /já está em andamento/);
});

test("número sem WhatsApp falha sem travar a campanha", async () => {
  const ctx = campaignSetup({ contacts: 2 });
  ctx.wa.withoutWhatsApp.add("5511911110000");
  ctx.runner.startCampaign(ctx.campaign.id);
  await runFor(ctx, 3000 + 3000);
  const campaign = ctx.store.getCampaign(ctx.campaign.id);
  assert.equal(campaign.failed, 1);
  assert.equal(campaign.sent, 1);
  assert.equal(ctx.store.listCampaignItems(ctx.campaign.id)[0].error, "Este número não tem WhatsApp");
});

test("sem conexão a campanha espera, e com bloqueio do WhatsApp ela pausa", async () => {
  const ctx = campaignSetup({ contacts: 2 });
  ctx.wa.connected = false;
  ctx.runner.startCampaign(ctx.campaign.id);
  await runFor(ctx, 10000);
  assert.equal(ctx.wa.sent.length, 0);
  assert.match(ctx.store.getCampaign(ctx.campaign.id).status_note, /Aguardando conexão/);

  ctx.wa.connected = true;
  ctx.wa.limits.timelock = { isActive: true };
  await ctx.runner.tick();
  const campaign = ctx.store.getCampaign(ctx.campaign.id);
  assert.equal(campaign.status, "paused");
  assert.match(campaign.status_note, /bloqueou/);
});

test("resposta \"sair\" tira da campanha; outra resposta move no Kanban", async () => {
  const ctx = campaignSetup({ contacts: 3 });
  ctx.runner.startCampaign(ctx.campaign.id);
  await runFor(ctx, 3000);
  assert.equal(ctx.wa.sent.length, 1);

  // Primeiro contato responde normalmente -> vai para "Negociando"
  ctx.crm.handleIncoming({ phone: "5511911110000", jid: "5511911110000@s.whatsapp.net", text: "Oi! Quero saber mais", id: "A" });
  assert.equal(ctx.store.getContact(ctx.ids[0]).stage_id, ctx.stages.negociando.id);

  // Terceiro contato (ainda não recebeu) responde "Sair!" -> fica fora
  ctx.crm.handleIncoming({ phone: "5511911110002", jid: "5511911110002@s.whatsapp.net", text: " Sair! ", id: "B" });
  assert.equal(ctx.store.getContact(ctx.ids[2]).opted_out, true);

  await runFor(ctx, 120000);
  const campaign = ctx.store.getCampaign(ctx.campaign.id);
  assert.equal(campaign.sent, 2);
  assert.equal(campaign.skipped, 1);
  assert.equal(campaign.status, "done");
});

test("mensagem de quem não está no CRM é ignorada", () => {
  const ctx = setup();
  ctx.crm.handleIncoming({ phone: "5511900000000", jid: "x", text: "oi", id: "1" });
  assert.equal(ctx.store.listContacts().length, 0);
});

test("agendador envia na hora e reagenda os recorrentes", async () => {
  const ctx = setup();
  const contact = ctx.store.createContact({ phone: "11911111111", name: "Ana" });
  const once = ctx.store.createSchedule({ contact_id: contact.id, text: "Lembrete", send_at: ctx.now() + 60000 });
  const daily = ctx.store.createSchedule({ contact_id: contact.id, text: "Bom dia", send_at: ctx.now() + 60000, recurrence: "daily" });
  const scheduler = new Scheduler({ store: ctx.store, crm: ctx.crm, wa: ctx.wa, now: ctx.now });

  await scheduler.tick();
  assert.equal(ctx.wa.sent.length, 0);

  ctx.now.advance(60000);
  await scheduler.tick();
  assert.equal(ctx.wa.sent.length, 2);
  assert.equal(ctx.store.getSchedule(once.id).status, "sent");
  const next = ctx.store.getSchedule(daily.id);
  assert.equal(next.status, "pending");
  assert.equal(next.send_at, ctx.now() + 24 * 60 * 60 * 1000);

  // Sem conexão: fica pendente e sai quando voltar
  ctx.wa.connected = false;
  ctx.now.advance(24 * 60 * 60 * 1000);
  await scheduler.tick();
  assert.equal(ctx.wa.sent.length, 2);
  ctx.wa.connected = true;
  await scheduler.tick();
  assert.equal(ctx.wa.sent.length, 3);
});

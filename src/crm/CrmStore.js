import { transaction } from "../db/database.js";
import { normalizePhone, phoneVariants } from "../utils/phone.js";
import { parseClock, startOfDay } from "../utils/time.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";

const RECURRENCES = ["none", "daily", "weekly", "monthly"];

const DEFAULT_SETTINGS = {
  // Máximo de mensagens de campanha por dia (somando todas as campanhas)
  daily_limit: 40,
  // Respostas que marcam o contato como "não quer receber" e o tiram das campanhas
  opt_out_keywords: ["sair", "parar", "pare", "stop", "cancelar", "descadastrar"],
};

const clean = (value, max = 5000) => String(value ?? "").trim().slice(0, max);

function parseTags(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[,;]/);
  const seen = new Set();
  const tags = [];
  for (const item of list) {
    const tag = clean(item, 40);
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

function hydrateContact(row) {
  if (!row) return null;
  return { ...row, tags: JSON.parse(row.tags), opted_out: Boolean(row.opted_out) };
}

function hydrateCampaign(row) {
  if (!row) return null;
  return { ...row, typing: Boolean(row.typing) };
}

/**
 * Camada de dados do CRM (SQLite)
 */
export class CrmStore {
  /**
   * @param {import("node:sqlite").DatabaseSync} db
   * @param {{ now?: () => number }} options
   */
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
  }

  // ───────────────────────── Configurações ─────────────────────────

  getSettings() {
    const rows = this.db.prepare("SELECT key, value FROM settings").all();
    const stored = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  updateSettings(patch) {
    const updates = {};

    if (patch.daily_limit !== undefined) {
      const limit = Number(patch.daily_limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw badRequest("O limite diário deve ser um número entre 1 e 1000");
      }
      updates.daily_limit = limit;
    }

    if (patch.opt_out_keywords !== undefined) {
      updates.opt_out_keywords = parseTags(patch.opt_out_keywords).map((word) => word.toLowerCase());
    }

    const upsert = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    for (const [key, value] of Object.entries(updates)) {
      upsert.run(key, JSON.stringify(value));
    }

    return this.getSettings();
  }

  getSecret(key) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(`secret:${key}`);
    return row ? JSON.parse(row.value) : null;
  }

  setSecret(key, value) {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(`secret:${key}`, JSON.stringify(value));
  }

  // ───────────────────────── Etapas (colunas do Kanban) ─────────────────────────

  listStages() {
    return this.db.prepare("SELECT * FROM stages ORDER BY position, id").all();
  }

  getStage(id) {
    return this.db.prepare("SELECT * FROM stages WHERE id = ?").get(Number(id)) ?? null;
  }

  ensureStage(id) {
    if (id === null || id === undefined || id === "") return null;
    const stage = this.getStage(id);
    if (!stage) throw badRequest("Etapa não encontrada");
    return stage.id;
  }

  createStage({ name, color }) {
    const stageName = clean(name, 60);
    if (!stageName) throw badRequest("Informe o nome da etapa");
    const { next } = this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM stages").get();
    const result = this.db
      .prepare("INSERT INTO stages (name, color, position, created_at) VALUES (?, ?, ?, ?)")
      .run(stageName, this.#color(color), next, this.now());
    return this.getStage(result.lastInsertRowid);
  }

  updateStage(id, { name, color }) {
    const stage = this.getStage(id);
    if (!stage) throw notFound("Etapa não encontrada");
    const stageName = name === undefined ? stage.name : clean(name, 60);
    if (!stageName) throw badRequest("Informe o nome da etapa");
    this.db
      .prepare("UPDATE stages SET name = ?, color = ? WHERE id = ?")
      .run(stageName, color === undefined ? stage.color : this.#color(color), stage.id);
    return this.getStage(stage.id);
  }

  deleteStage(id) {
    const stage = this.getStage(id);
    if (!stage) throw notFound("Etapa não encontrada");
    const { total } = this.db.prepare("SELECT COUNT(*) AS total FROM contacts WHERE stage_id = ?").get(stage.id);
    if (total > 0) throw conflict("Mova os contatos desta etapa antes de excluí-la");
    this.db.prepare("DELETE FROM stages WHERE id = ?").run(stage.id);
  }

  reorderStages(ids) {
    const update = this.db.prepare("UPDATE stages SET position = ? WHERE id = ?");
    transaction(this.db, () => ids.forEach((id, index) => update.run(index, Number(id))));
    return this.listStages();
  }

  #color(value) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#64748b";
  }

  // ───────────────────────── Contatos ─────────────────────────

  listContacts({ q, stage_id, tag, include_opted_out = true } = {}) {
    const where = [];
    const params = [];

    if (stage_id === "none") where.push("stage_id IS NULL");
    else if (stage_id) {
      where.push("stage_id = ?");
      params.push(Number(stage_id));
    }

    if (q) {
      const term = `%${clean(q, 100).toLowerCase()}%`;
      const digits = clean(q, 100).replace(/\D/g, "");
      const conditions = ["LOWER(name) LIKE ?", "LOWER(notes) LIKE ?"];
      params.push(term, term);
      if (digits) {
        conditions.push("phone LIKE ?");
        params.push(`%${digits}%`);
      }
      where.push(`(${conditions.join(" OR ")})`);
    }

    if (!include_opted_out) where.push("opted_out = 0");

    const sql = `SELECT * FROM contacts ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                 ORDER BY stage_id IS NULL, stage_id, position, id`;
    let contacts = this.db.prepare(sql).all(...params).map(hydrateContact);

    if (tag) {
      const wanted = String(tag).toLowerCase();
      contacts = contacts.filter((contact) => contact.tags.some((item) => item.toLowerCase() === wanted));
    }

    return contacts;
  }

  listTags() {
    const counts = new Map();
    for (const { tags } of this.db.prepare("SELECT tags FROM contacts").all()) {
      for (const tag of JSON.parse(tags)) {
        const key = tag.toLowerCase();
        const entry = counts.get(key) ?? { tag, total: 0 };
        entry.total++;
        counts.set(key, entry);
      }
    }
    return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag, "pt-BR"));
  }

  getContact(id) {
    return hydrateContact(this.db.prepare("SELECT * FROM contacts WHERE id = ?").get(Number(id)));
  }

  requireContact(id) {
    const contact = this.getContact(id);
    if (!contact) throw notFound("Contato não encontrado");
    return contact;
  }

  /**
   * Procura um contato pelo telefone (com e sem o nono dígito) ou pelo JID já conhecido
   */
  findContactByPhone(phone) {
    const variants = phoneVariants(phone);
    if (variants.length === 0) return null;
    const marks = variants.map(() => "?").join(",");
    const jids = variants.map((item) => `${item}@s.whatsapp.net`);
    const row = this.db
      .prepare(`SELECT * FROM contacts WHERE phone IN (${marks}) OR jid IN (${marks}) ORDER BY id LIMIT 1`)
      .get(...variants, ...jids);
    return hydrateContact(row);
  }

  createContact({ phone, name = "", stage_id = null, tags = [], notes = "" }) {
    const normalized = normalizePhone(phone);
    if (!normalized) throw badRequest("Telefone inválido. Use DDD + número, ex.: (11) 98765-4321");
    if (this.findContactByPhone(normalized)) throw conflict("Já existe um contato com este telefone");

    const stageId = this.ensureStage(stage_id);
    const now = this.now();
    const result = this.db
      .prepare(
        `INSERT INTO contacts (phone, name, stage_id, position, tags, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(normalized, clean(name, 120), stageId, this.#nextPosition(stageId), JSON.stringify(parseTags(tags)), clean(notes), now, now);

    return this.getContact(result.lastInsertRowid);
  }

  updateContact(id, patch) {
    const contact = this.requireContact(id);
    const next = { ...contact };

    if (patch.phone !== undefined) {
      const normalized = normalizePhone(patch.phone);
      if (!normalized) throw badRequest("Telefone inválido");
      const other = this.findContactByPhone(normalized);
      if (other && other.id !== contact.id) throw conflict("Já existe um contato com este telefone");
      if (normalized !== contact.phone) next.jid = null;
      next.phone = normalized;
    }
    if (patch.name !== undefined) next.name = clean(patch.name, 120);
    if (patch.notes !== undefined) next.notes = clean(patch.notes);
    if (patch.tags !== undefined) next.tags = parseTags(patch.tags);
    if (patch.opted_out !== undefined) next.opted_out = Boolean(patch.opted_out);
    if (patch.stage_id !== undefined && Number(patch.stage_id) !== contact.stage_id) {
      next.stage_id = this.ensureStage(patch.stage_id);
      next.position = this.#nextPosition(next.stage_id);
    }

    this.db
      .prepare(
        `UPDATE contacts SET phone = ?, name = ?, jid = ?, stage_id = ?, position = ?, tags = ?, notes = ?,
         opted_out = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        next.phone,
        next.name,
        next.jid,
        next.stage_id,
        next.position,
        JSON.stringify(next.tags),
        next.notes,
        next.opted_out ? 1 : 0,
        this.now(),
        contact.id
      );

    return this.getContact(contact.id);
  }

  deleteContact(id) {
    const contact = this.requireContact(id);
    this.db.prepare("DELETE FROM contacts WHERE id = ?").run(contact.id);
  }

  /**
   * Move um card do Kanban para uma etapa e posição (índice dentro da coluna)
   */
  moveContact(id, stageId, index) {
    const contact = this.requireContact(id);
    const targetStage = this.ensureStage(stageId);

    const siblings = this.db
      .prepare(
        `SELECT id FROM contacts WHERE ${targetStage === null ? "stage_id IS NULL" : "stage_id = ?"} AND id != ?
         ORDER BY position, id`
      )
      .all(...(targetStage === null ? [] : [targetStage]), contact.id)
      .map((row) => row.id);

    const position = Math.max(0, Math.min(Number.isInteger(index) ? index : siblings.length, siblings.length));
    siblings.splice(position, 0, contact.id);

    const update = this.db.prepare("UPDATE contacts SET stage_id = ?, position = ?, updated_at = ? WHERE id = ?");
    transaction(this.db, () => {
      siblings.forEach((contactId, order) => update.run(targetStage, order, this.now(), contactId));
    });

    return this.getContact(contact.id);
  }

  setContactJid(id, jid) {
    this.db.prepare("UPDATE contacts SET jid = ? WHERE id = ?").run(jid, Number(id));
  }

  /**
   * Marca o contato como "não quer receber" e tira ele das campanhas pendentes
   */
  optOut(contactId) {
    transaction(this.db, () => {
      this.db.prepare("UPDATE contacts SET opted_out = 1, updated_at = ? WHERE id = ?").run(this.now(), contactId);
      this.db
        .prepare("UPDATE campaign_items SET status = 'skipped', error = 'Pediu para não receber' WHERE contact_id = ? AND status = 'pending'")
        .run(contactId);
    });
  }

  /**
   * Importa contatos de uma planilha já mapeada
   * @param {Array<{ phone: any, name?: any, tags?: any, notes?: any }>} rows
   */
  importContacts(rows, { stage_id = null, tags = [], update_existing = true } = {}) {
    const stageId = this.ensureStage(stage_id);
    const extraTags = parseTags(tags);
    const result = { created: 0, updated: 0, invalid: [] };

    transaction(this.db, () => {
      rows.forEach((row, index) => {
        const phone = normalizePhone(row.phone);
        if (!phone) {
          result.invalid.push({ line: index + 2, value: String(row.phone ?? ""), reason: "Telefone inválido" });
          return;
        }

        const rowTags = parseTags([...parseTags(row.tags ?? ""), ...extraTags]);
        const existing = this.findContactByPhone(phone);

        if (existing) {
          if (!update_existing) return;
          this.updateContact(existing.id, {
            name: clean(row.name) || existing.name,
            notes: clean(row.notes) || existing.notes,
            tags: parseTags([...existing.tags, ...rowTags]),
          });
          result.updated++;
          return;
        }

        this.createContact({ phone, name: row.name, notes: row.notes, tags: rowTags, stage_id: stageId });
        result.created++;
      });
    });

    return result;
  }

  #nextPosition(stageId) {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM contacts WHERE ${stageId === null ? "stage_id IS NULL" : "stage_id = ?"}`)
      .get(...(stageId === null ? [] : [stageId]));
    return row.next;
  }

  // ───────────────────────── Histórico de mensagens ─────────────────────────

  logMessage({ contact_id, direction, source, text, wa_id = null }) {
    const now = this.now();
    this.db
      .prepare("INSERT INTO messages (contact_id, direction, source, text, wa_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(contact_id, direction, source, String(text ?? ""), wa_id, now);
    const column = direction === "in" ? "last_inbound_at" : "last_outbound_at";
    this.db.prepare(`UPDATE contacts SET ${column} = ? WHERE id = ?`).run(now, contact_id);
  }

  listMessages(contactId, limit = 100) {
    return this.db
      .prepare("SELECT * FROM messages WHERE contact_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(Number(contactId), limit)
      .reverse();
  }

  /**
   * Quantas mensagens de campanha já foram enviadas hoje (horário local)
   */
  campaignSentToday() {
    const { total } = this.db
      .prepare("SELECT COUNT(*) AS total FROM messages WHERE source = 'campaign' AND created_at >= ?")
      .get(startOfDay(this.now()));
    return total;
  }

  // ───────────────────────── Agendamentos ─────────────────────────

  listSchedules({ status } = {}) {
    const rows = this.db
      .prepare(
        `SELECT s.*, c.name AS contact_name, c.phone AS contact_phone
         FROM schedules s JOIN contacts c ON c.id = s.contact_id
         ${status ? "WHERE s.status = ?" : ""}
         ORDER BY s.status != 'pending', s.send_at`
      )
      .all(...(status ? [status] : []));
    return rows;
  }

  getSchedule(id) {
    return this.db.prepare("SELECT * FROM schedules WHERE id = ?").get(Number(id)) ?? null;
  }

  createSchedule({ contact_id, text, send_at, recurrence = "none" }) {
    const contact = this.requireContact(contact_id);
    const message = clean(text, 4000);
    const sendAt = Number(send_at);

    if (!message) throw badRequest("Escreva a mensagem");
    if (!Number.isFinite(sendAt)) throw badRequest("Data/hora inválida");
    if (!RECURRENCES.includes(recurrence)) throw badRequest("Recorrência inválida");

    const result = this.db
      .prepare("INSERT INTO schedules (contact_id, text, send_at, recurrence, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(contact.id, message, sendAt, recurrence, this.now());
    return this.getSchedule(result.lastInsertRowid);
  }

  cancelSchedule(id) {
    const schedule = this.getSchedule(id);
    if (!schedule) throw notFound("Agendamento não encontrado");
    this.db.prepare("UPDATE schedules SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(schedule.id);
    return this.getSchedule(schedule.id);
  }

  deleteSchedule(id) {
    const schedule = this.getSchedule(id);
    if (!schedule) throw notFound("Agendamento não encontrado");
    this.db.prepare("DELETE FROM schedules WHERE id = ?").run(schedule.id);
  }

  dueSchedules(now = this.now()) {
    return this.db
      .prepare("SELECT * FROM schedules WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT 20")
      .all(now);
  }

  /**
   * Marca como enviado. Se for recorrente, reagenda para a próxima ocorrência.
   */
  markScheduleSent(id, nextSendAt) {
    if (nextSendAt) {
      this.db
        .prepare("UPDATE schedules SET send_at = ?, sent_count = sent_count + 1, last_error = NULL WHERE id = ?")
        .run(nextSendAt, id);
    } else {
      this.db
        .prepare("UPDATE schedules SET status = 'sent', sent_count = sent_count + 1, last_error = NULL WHERE id = ?")
        .run(id);
    }
  }

  markScheduleFailed(id, error) {
    this.db.prepare("UPDATE schedules SET status = 'failed', last_error = ? WHERE id = ?").run(clean(error, 500), id);
  }

  // ───────────────────────── Campanhas ─────────────────────────

  #campaignFields(data, current = {}) {
    const merged = { ...current, ...data };
    const fields = {
      name: clean(merged.name, 120),
      message: clean(merged.message, 4000),
      min_delay_s: Number(merged.min_delay_s ?? 45),
      max_delay_s: Number(merged.max_delay_s ?? 120),
      typing: merged.typing === undefined ? 1 : merged.typing ? 1 : 0,
      pause_every: Number(merged.pause_every ?? 10),
      pause_s: Number(merged.pause_s ?? 300),
      window_start: merged.window_start || "08:00",
      window_end: merged.window_end || "20:00",
      after_send_stage_id: this.ensureStage(merged.after_send_stage_id),
      on_reply_stage_id: this.ensureStage(merged.on_reply_stage_id),
    };

    if (!fields.name) throw badRequest("Dê um nome para a campanha");
    if (!fields.message) throw badRequest("Escreva a mensagem da campanha");
    for (const key of ["min_delay_s", "max_delay_s", "pause_every", "pause_s"]) {
      if (!Number.isInteger(fields[key]) || fields[key] < 0) throw badRequest("Os tempos devem ser números inteiros positivos");
    }
    if (fields.min_delay_s < 10) throw badRequest("O intervalo mínimo entre mensagens é de 10 segundos");
    if (fields.max_delay_s < fields.min_delay_s) throw badRequest("O intervalo máximo deve ser maior ou igual ao mínimo");
    if (parseClock(fields.window_start) === null || parseClock(fields.window_end) === null) {
      throw badRequest("Horário inválido. Use o formato HH:MM");
    }

    return fields;
  }

  listCampaigns() {
    return this.db
      .prepare(
        `SELECT c.*,
           (SELECT COUNT(*) FROM campaign_items i WHERE i.campaign_id = c.id) AS total,
           (SELECT COUNT(*) FROM campaign_items i WHERE i.campaign_id = c.id AND i.status = 'sent') AS sent,
           (SELECT COUNT(*) FROM campaign_items i WHERE i.campaign_id = c.id AND i.status = 'failed') AS failed,
           (SELECT COUNT(*) FROM campaign_items i WHERE i.campaign_id = c.id AND i.status = 'skipped') AS skipped,
           (SELECT COUNT(*) FROM campaign_items i WHERE i.campaign_id = c.id AND i.status = 'pending') AS pending
         FROM campaigns c ORDER BY c.id DESC`
      )
      .all()
      .map(hydrateCampaign);
  }

  getCampaign(id) {
    const campaign = this.listCampaigns().find((item) => item.id === Number(id));
    if (!campaign) throw notFound("Campanha não encontrada");
    return campaign;
  }

  listCampaignItems(campaignId) {
    return this.db
      .prepare(
        `SELECT i.*, c.name AS contact_name, c.phone AS contact_phone
         FROM campaign_items i JOIN contacts c ON c.id = i.contact_id
         WHERE i.campaign_id = ? ORDER BY i.id`
      )
      .all(Number(campaignId));
  }

  /**
   * Cria uma campanha com os contatos escolhidos (contatos que pediram para sair são ignorados)
   */
  createCampaign(data, contactIds) {
    const fields = this.#campaignFields(data);
    const ids = [...new Set((contactIds ?? []).map(Number))];

    const eligible = ids
      .map((id) => this.getContact(id))
      .filter((contact) => contact && !contact.opted_out)
      .map((contact) => contact.id);
    if (eligible.length === 0) throw badRequest("Selecione pelo menos um contato (que não tenha pedido para sair)");

    return transaction(this.db, () => {
      const result = this.db
        .prepare(
          `INSERT INTO campaigns (name, message, min_delay_s, max_delay_s, typing, pause_every, pause_s,
             window_start, window_end, after_send_stage_id, on_reply_stage_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          fields.name,
          fields.message,
          fields.min_delay_s,
          fields.max_delay_s,
          fields.typing,
          fields.pause_every,
          fields.pause_s,
          fields.window_start,
          fields.window_end,
          fields.after_send_stage_id,
          fields.on_reply_stage_id,
          this.now()
        );

      const insert = this.db.prepare("INSERT INTO campaign_items (campaign_id, contact_id) VALUES (?, ?)");
      eligible.forEach((contactId) => insert.run(result.lastInsertRowid, contactId));
      return this.getCampaign(result.lastInsertRowid);
    });
  }

  updateCampaign(id, data) {
    const campaign = this.getCampaign(id);
    if (!["draft", "paused"].includes(campaign.status)) {
      throw conflict("Pause a campanha antes de editar");
    }
    const fields = this.#campaignFields(data, campaign);
    this.db
      .prepare(
        `UPDATE campaigns SET name = ?, message = ?, min_delay_s = ?, max_delay_s = ?, typing = ?, pause_every = ?,
           pause_s = ?, window_start = ?, window_end = ?, after_send_stage_id = ?, on_reply_stage_id = ?
         WHERE id = ?`
      )
      .run(
        fields.name,
        fields.message,
        fields.min_delay_s,
        fields.max_delay_s,
        fields.typing,
        fields.pause_every,
        fields.pause_s,
        fields.window_start,
        fields.window_end,
        fields.after_send_stage_id,
        fields.on_reply_stage_id,
        campaign.id
      );
    return this.getCampaign(campaign.id);
  }

  setCampaignStatus(id, status, note = null) {
    const now = this.now();
    this.db
      .prepare(
        `UPDATE campaigns SET status = ?, status_note = ?,
           started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
           finished_at = CASE WHEN ? IN ('done', 'canceled') THEN ? ELSE NULL END
         WHERE id = ?`
      )
      .run(status, note, status, now, status, now, Number(id));
    return this.getCampaign(id);
  }

  skipPendingItems(campaignId, reason) {
    this.db
      .prepare("UPDATE campaign_items SET status = 'skipped', error = ? WHERE campaign_id = ? AND status = 'pending'")
      .run(reason, Number(campaignId));
  }

  setCampaignNote(id, note) {
    this.db.prepare("UPDATE campaigns SET status_note = ? WHERE id = ?").run(note, Number(id));
  }

  deleteCampaign(id) {
    const campaign = this.getCampaign(id);
    if (campaign.status === "running") throw conflict("Pause ou cancele a campanha antes de excluir");
    this.db.prepare("DELETE FROM campaigns WHERE id = ?").run(campaign.id);
  }

  runningCampaign() {
    return hydrateCampaign(this.db.prepare("SELECT * FROM campaigns WHERE status = 'running' ORDER BY started_at LIMIT 1").get());
  }

  nextCampaignItem(campaignId) {
    return (
      this.db
        .prepare("SELECT * FROM campaign_items WHERE campaign_id = ? AND status = 'pending' ORDER BY id LIMIT 1")
        .get(Number(campaignId)) ?? null
    );
  }

  markCampaignItem(id, status, { error = null, rendered = null } = {}) {
    this.db
      .prepare("UPDATE campaign_items SET status = ?, error = ?, rendered = COALESCE(?, rendered), sent_at = ? WHERE id = ?")
      .run(status, error ? clean(error, 500) : null, rendered, status === "sent" ? this.now() : null, id);
  }

  /**
   * Etapa para onde o contato deve ir quando responder a uma campanha
   */
  replyStageFor(contactId) {
    const row = this.db
      .prepare(
        `SELECT c.on_reply_stage_id AS stage_id FROM campaign_items i JOIN campaigns c ON c.id = i.campaign_id
         WHERE i.contact_id = ? AND i.status = 'sent' AND c.on_reply_stage_id IS NOT NULL
         ORDER BY i.sent_at DESC LIMIT 1`
      )
      .get(Number(contactId));
    return row?.stage_id ?? null;
  }

  // ───────────────────────── Contas do painel ─────────────────────────

  countUsers() {
    return this.db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
  }

  createUser({ name, email, passwordHash }) {
    try {
      const { lastInsertRowid } = this.db
        .prepare("INSERT INTO users (name, email, password_hash, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)")
        .run(clean(name, 120), clean(email, 254).toLowerCase(), passwordHash, this.now(), this.now());
      return this.getUser(lastInsertRowid);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw conflict("Já existe uma conta com este e-mail");
      throw error;
    }
  }

  /**
   * Conta pelo id, sem o hash da senha
   */
  getUser(id) {
    return this.db.prepare("SELECT id, name, email, created_at, password_changed_at, last_login_at FROM users WHERE id = ?").get(Number(id)) ?? null;
  }

  /**
   * Conta pelo e-mail, com o hash da senha (só para conferir o login)
   */
  getUserWithPassword(email) {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(String(email ?? "").toLowerCase()) ?? null;
  }

  getUserPasswordHash(id) {
    return this.db.prepare("SELECT password_hash FROM users WHERE id = ?").get(Number(id))?.password_hash ?? null;
  }

  listUsers() {
    return this.db.prepare("SELECT id, name, email, created_at, password_changed_at, last_login_at FROM users ORDER BY id").all();
  }

  setUserPassword(id, passwordHash) {
    this.db.prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(passwordHash, this.now(), Number(id));
  }

  touchUserLogin(id) {
    this.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(this.now(), Number(id));
  }

  // ───────────────────────── Sessões do painel ─────────────────────────

  createWebSession(tokenHash, expiresAt, { userId, userAgent = "", ip = "" } = {}) {
    const now = this.now();
    this.db.prepare("DELETE FROM web_sessions WHERE expires_at < ?").run(now);
    this.db
      .prepare("INSERT INTO web_sessions (token_hash, expires_at, created_at, last_seen_at, user_agent, ip, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(tokenHash, expiresAt, now, now, clean(userAgent, 300), clean(ip, 64), Number(userId));
  }

  /**
   * Sessão válida (não expirada e de uma conta existente) ou null. Atualiza o "último acesso" no máximo uma vez por minuto.
   */
  getWebSession(tokenHash, { ip } = {}) {
    const row = this.db
      .prepare("SELECT s.rowid AS id, s.* FROM web_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
      .get(tokenHash);
    if (!row || row.expires_at <= this.now()) return null;
    if (!row.last_seen_at || this.now() - row.last_seen_at > 60000) {
      this.db
        .prepare("UPDATE web_sessions SET last_seen_at = ?, ip = COALESCE(?, ip) WHERE token_hash = ?")
        .run(this.now(), ip ? clean(ip, 64) : null, tokenHash);
    }
    return row;
  }

  listWebSessions(userId) {
    return this.db
      .prepare(
        `SELECT rowid AS id, token_hash, created_at, last_seen_at, user_agent, ip, expires_at
         FROM web_sessions WHERE expires_at > ? AND user_id = ? ORDER BY last_seen_at DESC`
      )
      .all(this.now(), Number(userId));
  }

  deleteWebSession(tokenHash) {
    this.db.prepare("DELETE FROM web_sessions WHERE token_hash = ?").run(tokenHash);
  }

  deleteWebSessionById(id, userId) {
    const row = this.db.prepare("SELECT token_hash FROM web_sessions WHERE rowid = ? AND user_id = ?").get(Number(id), Number(userId));
    if (!row) throw notFound("Sessão não encontrada");
    this.deleteWebSession(row.token_hash);
    return row.token_hash;
  }

  /**
   * Encerra todas as sessões da conta, menos a informada. Devolve os hashes encerrados.
   */
  deleteOtherWebSessions(userId, keepTokenHash) {
    const others = this.db
      .prepare("SELECT token_hash FROM web_sessions WHERE user_id = ? AND token_hash != ?")
      .all(Number(userId), keepTokenHash ?? "");
    this.db.prepare("DELETE FROM web_sessions WHERE user_id = ? AND token_hash != ?").run(Number(userId), keepTokenHash ?? "");
    return others.map((row) => row.token_hash);
  }
}

export default CrmStore;

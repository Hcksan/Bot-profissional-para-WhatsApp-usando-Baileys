import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

/**
 * Migrações em ordem. Cada item roda uma única vez (controlado por PRAGMA user_version).
 * Nunca altere uma migração já publicada; adicione uma nova no final.
 */
const migrations = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE stages (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT '#64748b',
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE contacts (
    id               INTEGER PRIMARY KEY,
    phone            TEXT    NOT NULL UNIQUE,
    name             TEXT    NOT NULL DEFAULT '',
    jid              TEXT,
    stage_id         INTEGER REFERENCES stages(id) ON DELETE SET NULL,
    position         REAL    NOT NULL DEFAULT 0,
    tags             TEXT    NOT NULL DEFAULT '[]',
    notes            TEXT    NOT NULL DEFAULT '',
    opted_out        INTEGER NOT NULL DEFAULT 0,
    last_inbound_at  INTEGER,
    last_outbound_at INTEGER,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );
  CREATE INDEX contacts_stage ON contacts(stage_id, position);
  CREATE INDEX contacts_jid ON contacts(jid);

  CREATE TABLE messages (
    id         INTEGER PRIMARY KEY,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    direction  TEXT    NOT NULL CHECK (direction IN ('in', 'out')),
    source     TEXT    NOT NULL CHECK (source IN ('manual', 'schedule', 'campaign', 'phone', 'contact')),
    text       TEXT    NOT NULL,
    wa_id      TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX messages_contact ON messages(contact_id, created_at);
  CREATE INDEX messages_source_time ON messages(source, created_at);

  CREATE TABLE schedules (
    id         INTEGER PRIMARY KEY,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    text       TEXT    NOT NULL,
    send_at    INTEGER NOT NULL,
    recurrence TEXT    NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
    status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'canceled')),
    sent_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX schedules_due ON schedules(status, send_at);

  CREATE TABLE campaigns (
    id                  INTEGER PRIMARY KEY,
    name                TEXT    NOT NULL,
    message             TEXT    NOT NULL,
    min_delay_s         INTEGER NOT NULL,
    max_delay_s         INTEGER NOT NULL,
    typing              INTEGER NOT NULL DEFAULT 1,
    pause_every         INTEGER NOT NULL DEFAULT 0,
    pause_s             INTEGER NOT NULL DEFAULT 0,
    window_start        TEXT    NOT NULL DEFAULT '08:00',
    window_end          TEXT    NOT NULL DEFAULT '20:00',
    after_send_stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
    on_reply_stage_id   INTEGER REFERENCES stages(id) ON DELETE SET NULL,
    status              TEXT    NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'running', 'paused', 'done', 'canceled')),
    status_note         TEXT,
    created_at          INTEGER NOT NULL,
    started_at          INTEGER,
    finished_at         INTEGER
  );

  CREATE TABLE campaign_items (
    id          INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    error       TEXT,
    rendered    TEXT,
    sent_at     INTEGER,
    UNIQUE (campaign_id, contact_id)
  );
  CREATE INDEX campaign_items_queue ON campaign_items(campaign_id, status, id);

  CREATE TABLE web_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  `,
  // Sessões de login com dados do dispositivo, para listar e encerrar pelo painel
  `
  ALTER TABLE web_sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE web_sessions ADD COLUMN last_seen_at INTEGER;
  ALTER TABLE web_sessions ADD COLUMN user_agent TEXT;
  ALTER TABLE web_sessions ADD COLUMN ip TEXT;
  `,
];

const defaultStages = [
  { name: "Novo", color: "#3b82f6" },
  { name: "Em contato", color: "#f59e0b" },
  { name: "Negociando", color: "#8b5cf6" },
  { name: "Fechado", color: "#10b981" },
  { name: "Perdido", color: "#ef4444" },
];

/**
 * Abre (ou cria) o banco SQLite e aplica as migrações pendentes
 * @param {string} file - Caminho do arquivo, ou ":memory:" para testes
 */
export function openDatabase(file) {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  if (file !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }

  const { user_version: current } = db.prepare("PRAGMA user_version").get();
  for (let version = current; version < migrations.length; version++) {
    transaction(db, () => {
      db.exec(migrations[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }

  const { total } = db.prepare("SELECT COUNT(*) AS total FROM stages").get();
  if (total === 0) {
    const insert = db.prepare("INSERT INTO stages (name, color, position, created_at) VALUES (?, ?, ?, ?)");
    transaction(db, () => {
      defaultStages.forEach((stage, index) => insert.run(stage.name, stage.color, index, Date.now()));
    });
  }

  return db;
}

/**
 * Executa uma função dentro de uma transação
 */
export function transaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export default openDatabase;

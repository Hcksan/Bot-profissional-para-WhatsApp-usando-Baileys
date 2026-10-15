import { EventEmitter } from "events";
import { openDatabase } from "../src/db/database.js";
import { CrmStore } from "../src/crm/CrmStore.js";
import { CrmService } from "../src/crm/CrmService.js";

/**
 * WhatsApp falso: registra os envios em memória
 */
export class FakeWhatsApp extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.sent = [];
    this.withoutWhatsApp = new Set();
    this.limits = { cap: null, timelock: null };
  }

  isConnected() {
    return this.connected;
  }

  isReachoutLocked() {
    return Boolean(this.limits.timelock?.isActive);
  }

  getState() {
    return { status: this.connected ? "open" : "disconnected", qr: null, me: null, limits: this.limits, hasSession: this.connected };
  }

  hasSession() {
    return this.connected;
  }

  async connect() {}

  async disconnect() {}

  async unlink() {
    this.unlinked = true;
    this.connected = false;
  }

  async resolveJid(phone) {
    return this.withoutWhatsApp.has(phone) ? null : `${phone}@s.whatsapp.net`;
  }

  async sendText(jid, text, options = {}) {
    if (!this.connected) throw new Error("WhatsApp não está conectado");
    this.sent.push({ jid, text, ...options });
    return `MSG${this.sent.length}`;
  }
}

/**
 * Relógio controlável (começa numa quarta-feira às 10:00, horário local)
 */
export function fakeClock(start = new Date(2026, 9, 14, 10, 0, 0).getTime()) {
  let current = start;
  const now = () => current;
  now.advance = (ms) => (current += ms);
  now.set = (ms) => (current = ms);
  return now;
}

export function setup() {
  const now = fakeClock();
  const db = openDatabase(":memory:");
  const store = new CrmStore(db, { now });
  const wa = new FakeWhatsApp();
  const crm = new CrmService({ store, wa });
  return { now, db, store, wa, crm };
}

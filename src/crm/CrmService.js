import { EventEmitter } from "events";
import AppError from "../utils/errors.js";
import logger from "../utils/logger.js";

/**
 * Remove acentos, pontuação e espaços extras para comparar respostas como "Sair!" ou "PARAR"
 */
function normalizeAnswer(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Regras do CRM que dependem do WhatsApp: enviar para contatos e reagir a mensagens recebidas
 *
 * Evento "changed" ({ type, contact_id? }) avisa o painel que algo mudou.
 */
export class CrmService extends EventEmitter {
  /**
   * @param {{ store: import("./CrmStore.js").CrmStore, wa: import("../services/WhatsAppService.js").default }} deps
   */
  constructor({ store, wa }) {
    super();
    this.store = store;
    this.wa = wa;
  }

  /**
   * Envia um texto para um contato do CRM e registra no histórico
   */
  async sendToContact(contactId, text, { source = "manual", typingMs = 0 } = {}) {
    const contact = this.store.requireContact(contactId);
    const message = String(text ?? "").trim();
    if (!message) throw new AppError(400, "Escreva a mensagem");

    let jid = contact.jid;
    if (!jid) {
      jid = await this.wa.resolveJid(contact.phone);
      if (!jid) throw new AppError(422, "Este número não tem WhatsApp");
      this.store.setContactJid(contact.id, jid);
    }

    const waId = await this.wa.sendText(jid, message, { typingMs });
    this.store.logMessage({ contact_id: contact.id, direction: "out", source, text: message, wa_id: waId });
    this.emit("changed", { type: "messages", contact_id: contact.id });
    return { id: waId };
  }

  /**
   * Mensagem recebida de alguém. Só registra se a pessoa já for um contato do CRM.
   */
  handleIncoming({ phone, jid, text, pushName, id }) {
    const contact = this.store.findContactByPhone(phone);
    if (!contact) return;

    if (!contact.jid && jid) this.store.setContactJid(contact.id, jid);
    if (!contact.name && pushName) this.store.updateContact(contact.id, { name: pushName });
    this.store.logMessage({ contact_id: contact.id, direction: "in", source: "contact", text, wa_id: id });

    const { opt_out_keywords: keywords } = this.store.getSettings();
    const answer = normalizeAnswer(text);

    if (keywords.some((word) => normalizeAnswer(word) === answer)) {
      this.store.optOut(contact.id);
      logger.info(`🚫 ${contact.name || contact.phone} pediu para não receber mais mensagens`);
    } else {
      const replyStage = this.store.replyStageFor(contact.id);
      if (replyStage && replyStage !== contact.stage_id) {
        this.store.moveContact(contact.id, replyStage, 0);
      }
    }

    this.emit("changed", { type: "contacts", contact_id: contact.id });
  }

  /**
   * Mensagem que você enviou pelo celular para um contato do CRM
   */
  handleOutgoing({ phone, jid, text, id }) {
    const contact = this.store.findContactByPhone(phone);
    if (!contact) return;
    if (!contact.jid && jid) this.store.setContactJid(contact.id, jid);
    this.store.logMessage({ contact_id: contact.id, direction: "out", source: "phone", text, wa_id: id });
    this.emit("changed", { type: "messages", contact_id: contact.id });
  }
}

export default CrmService;

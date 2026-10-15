import { EventEmitter } from "events";
import logger from "../utils/logger.js";
import { renderTemplate } from "../utils/template.js";
import { isWithinWindow, nextWindowStart, randomInt, typingDurationMs } from "../utils/time.js";
import { badRequest, conflict } from "../utils/errors.js";

const formatClock = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * Executa as campanhas ("acionar clientes"), uma de cada vez, uma mensagem por vez:
 *  - intervalo aleatório entre envios (min/max)
 *  - "digitando..." proporcional ao tamanho da mensagem
 *  - pausa longa a cada X envios
 *  - só dentro da janela de horário e até o limite diário
 *  - para sozinha se o WhatsApp aplicar bloqueio temporário
 *
 * Evento "progress" (campanha) a cada mudança.
 */
export class CampaignRunner extends EventEmitter {
  constructor({ store, crm, wa, now = Date.now, random = Math.random, tickMs = 2000 }) {
    super();
    this.store = store;
    this.crm = crm;
    this.wa = wa;
    this.now = now;
    this.random = random;
    this.tickMs = tickMs;
    this.timer = null;
    this.busy = false;
    this.currentId = null;
    this.nextSendAt = 0;
    this.sentInRun = 0;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick().catch((error) => logger.error("Erro nas campanhas:", { message: error.message })), this.tickMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Dados do envio em andamento, para o painel mostrar a contagem regressiva
   */
  runtime() {
    return { campaign_id: this.currentId, next_send_at: this.currentId ? this.nextSendAt : null };
  }

  // ───────────────────────── Ações do usuário ─────────────────────────

  startCampaign(id) {
    const campaign = this.store.getCampaign(id);
    if (!["draft", "paused"].includes(campaign.status)) throw conflict("Esta campanha não pode ser iniciada");

    const running = this.store.runningCampaign();
    if (running && running.id !== campaign.id) {
      throw conflict(`A campanha "${running.name}" já está em andamento. Pause-a antes de iniciar outra.`);
    }
    if (campaign.pending === 0) throw badRequest("Não há contatos pendentes nesta campanha");

    this.currentId = campaign.id;
    this.sentInRun = 0;
    // Primeiro envio em poucos segundos
    this.nextSendAt = this.now() + 3000;
    return this.#publish(this.store.setCampaignStatus(campaign.id, "running", "Iniciando..."));
  }

  pauseCampaign(id, note = "Pausada por você") {
    const campaign = this.store.getCampaign(id);
    if (campaign.status !== "running") throw conflict("A campanha não está em andamento");
    return this.#publish(this.store.setCampaignStatus(campaign.id, "paused", note));
  }

  cancelCampaign(id) {
    const campaign = this.store.getCampaign(id);
    if (["done", "canceled"].includes(campaign.status)) throw conflict("A campanha já terminou");
    this.store.skipPendingItems(campaign.id, "Campanha cancelada");
    return this.#publish(this.store.setCampaignStatus(campaign.id, "canceled", "Cancelada por você"));
  }

  // ───────────────────────── Execução ─────────────────────────

  #publish(campaign) {
    this.emit("progress", { ...campaign, ...this.runtime() });
    return campaign;
  }

  #note(campaign, note) {
    if (campaign.status_note !== note) {
      this.store.setCampaignNote(campaign.id, note);
      this.#publish(this.store.getCampaign(campaign.id));
    }
  }

  // A campanha pode ter sido pausada/cancelada enquanto a mensagem era enviada
  #noteIfRunning(id, note) {
    if (this.store.getCampaign(id).status === "running") this.store.setCampaignNote(id, note);
  }

  async tick() {
    if (this.busy) return;

    const campaign = this.store.runningCampaign();
    if (!campaign) {
      this.currentId = null;
      return;
    }

    const now = this.now();
    if (this.currentId !== campaign.id) {
      // Campanha retomada depois de reiniciar o programa
      this.currentId = campaign.id;
      this.sentInRun = 0;
      this.nextSendAt = now + campaign.min_delay_s * 1000;
    }

    if (!this.wa.isConnected()) return this.#note(campaign, "Aguardando conexão com o WhatsApp");

    if (this.wa.isReachoutLocked()) {
      const until = this.wa.limits.timelock?.timeEnforcementEnds;
      const when = until ? ` até ${new Date(until).toLocaleString("pt-BR")}` : "";
      logger.warn("⛔ WhatsApp aplicou bloqueio temporário de envio. Campanha pausada.");
      this.#publish(
        this.store.setCampaignStatus(campaign.id, "paused", `O WhatsApp bloqueou novos envios temporariamente${when}. Campanha pausada.`)
      );
      return;
    }

    const cap = this.wa.limits.cap;
    if (cap?.total_quota && cap.used_quota >= cap.total_quota) {
      return this.#note(campaign, "Cota de novas conversas do WhatsApp atingida. Aguardando renovação.");
    }

    if (!isWithinWindow(new Date(now), campaign.window_start, campaign.window_end)) {
      return this.#note(campaign, `Fora do horário permitido. Retoma às ${formatClock(nextWindowStart(new Date(now), campaign.window_start))}`);
    }

    const { daily_limit: dailyLimit } = this.store.getSettings();
    if (this.store.campaignSentToday() >= dailyLimit) {
      return this.#note(campaign, `Limite diário de ${dailyLimit} mensagens atingido. Continua amanhã.`);
    }

    if (now < this.nextSendAt) {
      return this.#note(campaign, `Próximo envio às ${formatClock(this.nextSendAt)}`);
    }

    const item = this.store.nextCampaignItem(campaign.id);
    if (!item) {
      this.currentId = null;
      logger.success(`✅ Campanha "${campaign.name}" concluída`);
      this.#publish(this.store.setCampaignStatus(campaign.id, "done", "Concluída"));
      return;
    }

    this.busy = true;
    try {
      await this.#sendItem(campaign, item);
    } finally {
      this.busy = false;
      this.#publish(this.store.getCampaign(campaign.id));
    }
  }

  async #sendItem(campaign, item) {
    const contact = this.store.getContact(item.contact_id);
    if (!contact || contact.opted_out) {
      this.store.markCampaignItem(item.id, "skipped", { error: "Pediu para não receber" });
      return;
    }

    const text = renderTemplate(campaign.message, contact, this.random);
    this.store.setCampaignNote(campaign.id, `Enviando para ${contact.name || contact.phone}...`);
    this.#publish(this.store.getCampaign(campaign.id));

    try {
      await this.crm.sendToContact(contact.id, text, {
        source: "campaign",
        typingMs: campaign.typing ? typingDurationMs(text, this.random) : 0,
      });

      this.store.markCampaignItem(item.id, "sent", { rendered: text });
      if (campaign.after_send_stage_id && contact.stage_id !== campaign.after_send_stage_id) {
        this.store.moveContact(contact.id, campaign.after_send_stage_id);
      }

      this.sentInRun++;
      let delay = randomInt(campaign.min_delay_s, campaign.max_delay_s, this.random) * 1000;
      if (campaign.pause_every > 0 && this.sentInRun % campaign.pause_every === 0) {
        delay += campaign.pause_s * 1000;
      }
      this.nextSendAt = this.now() + delay;
      this.#noteIfRunning(campaign.id, `Próximo envio às ${formatClock(this.nextSendAt)}`);
    } catch (error) {
      if (!this.wa.isConnected()) {
        // Conexão caiu durante o envio: o contato continua pendente
        this.#noteIfRunning(campaign.id, "Aguardando conexão com o WhatsApp");
        return;
      }

      logger.warn(`Falha ao enviar para ${contact.phone}:`, { message: error.message });
      this.store.markCampaignItem(item.id, "failed", { error: error.message, rendered: text });
      // Número sem WhatsApp não chegou a enviar nada: segue rápido para o próximo
      this.nextSendAt = this.now() + (error.status === 422 ? 3000 : campaign.min_delay_s * 1000);
    }
  }
}

export default CampaignRunner;

import { EventEmitter } from "events";
import logger from "../utils/logger.js";
import { nextOccurrence, typingDurationMs } from "../utils/time.js";

/**
 * Dispara as mensagens agendadas.
 * Se o computador estiver desligado ou o WhatsApp desconectado no horário, a mensagem
 * é enviada assim que a conexão voltar (agendamentos recorrentes seguem para a próxima data).
 */
export class Scheduler extends EventEmitter {
  constructor({ store, crm, wa, now = Date.now, intervalMs = 15000 }) {
    super();
    this.store = store;
    this.crm = crm;
    this.wa = wa;
    this.now = now;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick().catch((error) => logger.error("Erro no agendador:", { message: error.message })), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running || !this.wa.isConnected()) return;
    this.running = true;

    try {
      for (const schedule of this.store.dueSchedules(this.now())) {
        if (!this.wa.isConnected()) break;

        try {
          await this.crm.sendToContact(schedule.contact_id, schedule.text, {
            source: "schedule",
            typingMs: typingDurationMs(schedule.text),
          });
          this.store.markScheduleSent(schedule.id, nextOccurrence(schedule.send_at, schedule.recurrence, this.now()));
        } catch (error) {
          // Caiu a conexão no meio do envio: tenta de novo na próxima rodada
          if (!this.wa.isConnected()) break;
          logger.error(`Falha no agendamento #${schedule.id}:`, { message: error.message });
          this.store.markScheduleFailed(schedule.id, error.message);
        }

        this.emit("changed");
      }
    } finally {
      this.running = false;
    }
  }
}

export default Scheduler;

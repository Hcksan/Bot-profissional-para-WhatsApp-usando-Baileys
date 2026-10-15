import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} from "baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import whatsappConfig from "../config/whatsapp.config.js";
import commandManager from "../commands/index.js";
import logger from "../utils/logger.js";
import { phoneFromJid } from "../utils/phone.js";
import { sleep } from "../utils/time.js";

/**
 * Extrai o texto de uma mensagem do WhatsApp
 */
function extractText(message) {
  if (!message) return "";
  const content = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ""
  );
}

/**
 * Serviço responsável pela conexão e gerenciamento do WhatsApp
 *
 * Eventos emitidos:
 *  - "status"   ({ status, qr, me, limits })         mudanças de conexão / QR Code
 *  - "incoming" ({ phone, jid, text, pushName, id })  mensagem recebida em conversa individual
 *  - "outgoing" ({ phone, jid, text, id })             mensagem enviada por você pelo celular / WhatsApp Web
 *  - "limits"   (limits)                              limites de novas conversas informados pelo WhatsApp
 */
class WhatsAppService extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} [options.sessionPath] - Pasta da sessão (cada espaço do CRM tem a sua)
   * @param {string} [options.label] - Nome que aparece nos logs (ex.: "espaço 2")
   * @param {boolean} [options.printQr] - Mostra o QR Code também no terminal
   */
  constructor({ commandsEnabled = true, sessionPath = whatsappConfig.auth.sessionPath, label = "", printQr = true } = {}) {
    super();
    this.sessionPath = sessionPath;
    this.printQr = printQr;
    const prefix = label ? `[${label}] ` : "";
    this.logger = Object.fromEntries(["info", "warn", "error", "success"].map((level) => [level, (message, meta) => logger[level](`${prefix}${message}`, meta)]));
    this.sock = null;
    this.status = "disconnected"; // disconnected | connecting | qr | open
    this.qr = null;
    this.me = null;
    this.limits = { cap: null, timelock: null };
    this.lastError = null;
    this.commandsEnabled = commandsEnabled;
    this.retryCount = 0;
    this.reconnectTimer = null;
    this.stopped = false;
    // IDs das mensagens enviadas pelo CRM (para não registrar em dobro quando o WhatsApp ecoar)
    this.sentByCrm = new Set();
    this.ensureSessionDirectory();
  }

  /**
   * Garante que o diretório de sessão existe
   */
  ensureSessionDirectory() {
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
      this.logger.info("📁 Diretório de sessão criado:", { path: this.sessionPath });
    }
  }

  /**
   * True se este número já foi conectado alguma vez (há credenciais salvas)
   */
  hasSession() {
    return fs.existsSync(path.join(this.sessionPath, "creds.json"));
  }

  getState() {
    return { status: this.status, qr: this.qr, me: this.me, limits: this.limits, lastError: this.lastError, hasSession: this.hasSession() };
  }

  setStatus(status, extra = {}) {
    this.status = status;
    if (status !== "qr") this.qr = null;
    if (status === "open" || status === "connecting") this.lastError = null;
    Object.assign(this, extra);
    this.emit("status", this.getState());
  }

  isConnected() {
    return this.status === "open" && this.sock !== null;
  }

  /**
   * Inicia a conexão com o WhatsApp
   */
  async connect() {
    if (this.status === "connecting") return;
    this.stopped = false;
    clearTimeout(this.reconnectTimer);
    this.setStatus("connecting");

    try {
      const hasSession = this.hasSession();
      this.logger.info(hasSession ? "🔐 Sessão encontrada! Tentando reconectar..." : "🚀 Primeira conexão - QR Code será gerado");

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
      const { version, isLatest } = await fetchLatestBaileysVersion();
      this.logger.info(`📱 Usando WA v${version.join(".")}, isLatest: ${isLatest}`);

      this.sock = makeWASocket({
        version,
        logger: pino({ level: whatsappConfig.logging.level }),
        auth: state,
        browser: whatsappConfig.browser,
        // Mantém as notificações chegando normalmente no celular
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });

      this.setupEventListeners(this.sock, saveCreds);
    } catch (error) {
      this.logger.error("❌ Erro ao iniciar conexão:", { message: error.message });
      this.setStatus("disconnected");
      this.scheduleReconnect(whatsappConfig.reconnect.delayOnError);
    }
  }

  scheduleReconnect(delayMs) {
    if (this.stopped) return;
    this.retryCount++;
    // Espera cada vez mais entre tentativas, até o máximo configurado
    const wait = Math.min(delayMs * Math.max(1, this.retryCount), whatsappConfig.reconnect.maxDelay);
    this.logger.info(`🔄 Nova tentativa de conexão em ${Math.round(wait / 1000)}s (tentativa ${this.retryCount})`);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), wait);
  }

  /**
   * Configura os event listeners do socket
   */
  setupEventListeners(sock, saveCreds) {
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      if (sock !== this.sock) return; // evento de um socket antigo
      await this.handleConnectionUpdate(update);
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        try {
          await this.handleMessage(msg);
        } catch (error) {
          this.logger.error("Erro ao processar mensagem:", { message: error.message });
        }
      }
    });

    sock.ev.on("message-capping.update", (cap) => {
      this.limits = { ...this.limits, cap };
      this.emit("limits", this.limits);
      this.emit("status", this.getState());
    });
  }

  /**
   * Gerencia as atualizações de conexão
   */
  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (update.reachoutTimeLock) {
      this.limits = { ...this.limits, timelock: update.reachoutTimeLock };
      this.emit("limits", this.limits);
    }

    if (qr) {
      this.logger.info(this.printQr ? "📱 QR Code gerado! Escaneie pelo painel web ou pelo terminal:" : "📱 QR Code gerado (escaneie pelo painel web)");
      if (this.printQr) qrcodeTerminal.generate(qr, { small: true });
      this.setStatus("qr", { qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }) });
    }

    if (connection === "open") {
      this.retryCount = 0;
      const id = this.sock.user?.id ? jidNormalizedUser(this.sock.user.id) : null;
      this.setStatus("open", { me: { id, phone: phoneFromJid(id), name: this.sock.user?.name ?? "" } });
      this.logger.success("✅ Conexão estabelecida com sucesso!");
      this.refreshLimits().catch(() => {});
      return;
    }

    if (connection !== "close") return;

    const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output.statusCode : null;
    const errorMessage = lastDisconnect?.error?.message || "erro desconhecido";
    this.logger.warn("⚠️ Conexão fechada:", { message: errorMessage, statusCode });

    this.sock = null;
    this.setStatus("disconnected");
    if (this.stopped) return;

    // Aparelho desconectado pelo celular: apaga a sessão e gera um novo QR Code
    if (statusCode === DisconnectReason.loggedOut) {
      this.logger.warn("🚪 Sessão encerrada pelo celular. Um novo QR Code será gerado.");
      this.clearSession();
      this.retryCount = 0;
      this.scheduleReconnect(1000);
      return;
    }

    if (statusCode === DisconnectReason.forbidden) {
      this.logger.error("⛔ O WhatsApp recusou a conexão (403). O número pode estar restrito ou banido.");
      this.setStatus("disconnected", { lastError: "O WhatsApp recusou a conexão (403). Verifique o número no celular." });
      return;
    }

    // Ninguém leu o QR Code a tempo: para de gerar códigos novos até a pessoa pedir de novo no painel
    if (statusCode === DisconnectReason.timedOut && !this.hasSession()) {
      this.stopped = true;
      this.setStatus("disconnected", { lastError: "O QR Code expirou. Clique em \"Gerar QR Code\" para tentar de novo." });
      return;
    }

    if (statusCode === DisconnectReason.restartRequired) {
      this.retryCount = 0;
      this.scheduleReconnect(1000);
      return;
    }

    if (statusCode === DisconnectReason.connectionReplaced) {
      // Outro processo abriu a mesma sessão. Não brigar por ela.
      this.logger.error("⚠️ Esta sessão foi aberta em outro lugar. Reinicie pelo painel quando quiser reconectar.");
      this.setStatus("disconnected", { lastError: "Esta sessão foi aberta em outro lugar. Clique em Reconectar." });
      return;
    }

    const isConflict = errorMessage.includes("conflict") || statusCode === DisconnectReason.multideviceMismatch;
    this.scheduleReconnect(isConflict ? whatsappConfig.reconnect.delayOnConflict : whatsappConfig.reconnect.delayOnError);
  }

  /**
   * Descobre o telefone de um JID. Com os novos identificadores (LID) do WhatsApp,
   * o número pode vir em campos alternativos ou precisar ser consultado.
   */
  async resolvePhone(key) {
    for (const jid of [key.remoteJid, key.remoteJidAlt, key.senderPn]) {
      const phone = phoneFromJid(jid ? jidNormalizedUser(jid) : null);
      if (phone) return { phone, jid: jidNormalizedUser(jid) };
    }

    if (key.remoteJid?.endsWith("@lid")) {
      try {
        const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID(key.remoteJid);
        const phone = phoneFromJid(pn ? jidNormalizedUser(pn) : null);
        if (phone) return { phone, jid: jidNormalizedUser(pn) };
      } catch {
        // sem mapeamento conhecido
      }
    }

    return null;
  }

  /**
   * Processa uma mensagem nova
   */
  async handleMessage(msg) {
    if (!msg.message || !msg.key?.remoteJid) return;

    const remoteJid = msg.key.remoteJid;
    const isIndividual = remoteJid.endsWith("@s.whatsapp.net") || remoteJid.endsWith("@lid");
    const text = extractText(msg.message);

    // Comandos: somente quando enviados pelo próprio dono do número
    if (msg.key.fromMe && this.commandsEnabled && text && commandManager.isCommand(text)) {
      await this.handleCommand(msg, text);
      return;
    }

    if (!isIndividual || !text) return;
    if (msg.key.fromMe && this.sentByCrm.delete(msg.key.id)) return;

    const resolved = await this.resolvePhone(msg.key);
    if (!resolved) return;

    const payload = { ...resolved, text, id: msg.key.id, pushName: msg.pushName ?? "" };
    this.emit(msg.key.fromMe ? "outgoing" : "incoming", payload);
  }

  /**
   * Processa comandos
   */
  async handleCommand(msg, text) {
    try {
      const parsed = commandManager.parse(text);
      if (!parsed) return;

      const chatId = msg.key.remoteJid;
      this.logger.info(`Comando recebido: ${parsed.command}`, { chat: chatId, args: parsed.args });

      await commandManager.execute(parsed.command, {
        sock: this.sock,
        msg,
        args: parsed.args,
        chatId,
        senderName: msg.pushName || "Você",
      });

      this.logger.success(`Comando executado: ${parsed.command}`);
    } catch (error) {
      this.logger.error("Erro ao executar comando:", { message: error.message });
      await this.sock?.sendMessage(msg.key.remoteJid, { text: `❌ ${error.message}` });
    }
  }

  /**
   * Confere se o número tem WhatsApp e devolve o JID correto
   * (resolve automaticamente a diferença do nono dígito)
   * @returns {Promise<string|null>}
   */
  async resolveJid(phone) {
    this.assertConnected();
    const [result] = (await this.sock.onWhatsApp(phone)) ?? [];
    return result?.exists ? jidNormalizedUser(result.jid) : null;
  }

  /**
   * Envia uma mensagem de texto, opcionalmente mostrando "digitando..." antes
   * @returns {Promise<string|null>} ID da mensagem enviada
   */
  async sendText(jid, text, { typingMs = 0 } = {}) {
    this.assertConnected();

    if (typingMs > 0) {
      try {
        await this.sock.presenceSubscribe(jid);
        await this.sock.sendPresenceUpdate("composing", jid);
        await sleep(typingMs);
        await this.sock.sendPresenceUpdate("paused", jid);
      } catch (error) {
        this.logger.warn("Não foi possível mostrar 'digitando...'", { message: error.message });
      }
      this.assertConnected();
    }

    const sent = await this.sock.sendMessage(jid, { text: text.trim() });
    const id = sent?.key?.id ?? null;
    if (id) {
      this.sentByCrm.add(id);
      // Evita crescer sem limite se o eco nunca chegar
      if (this.sentByCrm.size > 500) this.sentByCrm.delete(this.sentByCrm.values().next().value);
    }
    return id;
  }

  /**
   * Mantido para compatibilidade com o código antigo
   */
  async sendMessage(jid, text, options = {}) {
    try {
      this.assertConnected();
      await this.sock.sendMessage(jid, { text: text.trim(), ...options });
      return true;
    } catch (error) {
      this.logger.error("❌ Erro ao enviar mensagem:", { message: error.message });
      return false;
    }
  }

  /**
   * Consulta no WhatsApp a cota de novas conversas e se há bloqueio temporário de envio
   */
  async refreshLimits() {
    this.assertConnected();
    const [cap, timelock] = await Promise.allSettled([
      this.sock.fetchNewChatMessageCap(),
      this.sock.fetchAccountReachoutTimelock(),
    ]);
    this.limits = {
      cap: cap.status === "fulfilled" ? cap.value : this.limits.cap,
      timelock: timelock.status === "fulfilled" ? timelock.value : this.limits.timelock,
    };
    this.emit("limits", this.limits);
    this.emit("status", this.getState());
    return this.limits;
  }

  /**
   * True se o WhatsApp informou um bloqueio temporário para iniciar conversas
   */
  isReachoutLocked() {
    const lock = this.limits.timelock;
    if (!lock?.isActive) return false;
    return !lock.timeEnforcementEnds || new Date(lock.timeEnforcementEnds).getTime() > Date.now();
  }

  assertConnected() {
    if (!this.isConnected()) throw new Error("WhatsApp não está conectado");
  }

  clearSession() {
    fs.rmSync(this.sessionPath, { recursive: true, force: true });
    this.ensureSessionDirectory();
  }

  /**
   * Encerra a conexão sem desconectar o aparelho (a sessão continua salva)
   */
  async disconnect() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    if (this.sock) {
      const sock = this.sock;
      this.sock = null;
      sock.end(undefined);
    }
    this.setStatus("disconnected");
  }

  /**
   * Desconecta o aparelho do WhatsApp (remove dos "Aparelhos conectados") e gera um novo QR Code
   */
  async logout() {
    await this.unlink();
    this.retryCount = 0;
    await this.connect();
  }

  /**
   * Desconecta o aparelho e apaga a sessão, sem gerar QR Code novo (espaço removido)
   */
  async unlink() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    const sock = this.sock;
    this.sock = null;
    try {
      await sock?.logout();
    } catch (error) {
      this.logger.warn("Erro ao desconectar aparelho:", { message: error.message });
    }
    this.clearSession();
    this.me = null;
    this.setStatus("disconnected");
  }

  /**
   * Reinicia a conexão (útil depois de "sessão aberta em outro lugar")
   */
  async restart() {
    await this.disconnect();
    this.retryCount = 0;
    await this.connect();
  }
}

export default WhatsAppService;

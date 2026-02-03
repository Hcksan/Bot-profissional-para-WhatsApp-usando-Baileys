import fs from "fs";
import path from "path";
import qrcode from "qrcode-terminal";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import whatsappConfig from "../config/whatsapp.config.js";
import commandManager from "../commands/index.js";
import logger from "../utils/logger.js";

/**
 * Serviço responsável pela conexão e gerenciamento do WhatsApp
 */
class WhatsAppService {
  constructor() {
    this.sock = null;
    this.isReady = false;
    this.isConnecting = false;
    this.retryCount = 0;
    this.ensureSessionDirectory();
  }

  /**
   * Garante que o diretório de sessão existe
   */
  ensureSessionDirectory() {
    const sessionPath = whatsappConfig.auth.sessionPath;
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
      logger.info("📁 Diretório de sessão criado:", { path: sessionPath });
    }
  }

  /**
   * Inicia a conexão com o WhatsApp
   */
  async connect() {
    if (this.isConnecting) {
      console.log("⚠️ Já existe uma tentativa de conexão em andamento...");
      return;
    }

    this.isConnecting = true;
    
    try {
      const sessionPath = whatsappConfig.auth.sessionPath;
      
      // Verificar se já existe sessão salva
      const hasSession = fs.existsSync(path.join(sessionPath, "creds.json"));
      
      if (hasSession) {
        logger.info("🔐 Sessão encontrada! Tentando reconectar...");
      } else {
        logger.info("🚀 Primeira conexão - QR Code será gerado");
      }

      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      const { version, isLatest } = await fetchLatestBaileysVersion();

      logger.info(`📱 Usando WA v${version.join(".")}, isLatest: ${isLatest}`);

      this.sock = makeWASocket({
        version,
        logger: pino({ level: whatsappConfig.logging.level }),
        auth: state,
        browser: [
          whatsappConfig.browser.name,
          whatsappConfig.browser.browserName,
          whatsappConfig.browser.version,
        ],
        printQRInTerminal: false, // Desabilitar QR automático do Baileys
        defaultQueryTimeoutMs: undefined,
      });

      this.setupEventListeners(saveCreds);
    } catch (error) {
      console.error("❌ Erro ao iniciar bot:", error);
      this.isConnecting = false;

      if (this.retryCount < whatsappConfig.reconnect.maxRetries) {
        this.retryCount++;
        console.log(`🔄 Tentativa ${this.retryCount}/${whatsappConfig.reconnect.maxRetries}`);
        await delay(whatsappConfig.reconnect.delayOnError);
        this.connect();
      } else {
        console.error("❌ Número máximo de tentativas atingido.");
      }
    }
  }

  /**
   * Configura os event listeners do socket
   */
  setupEventListeners(saveCreds) {
    // Listener para atualização de credenciais
    this.sock.ev.on("creds.update", async () => {
      await saveCreds();
      logger.info("💾 Credenciais salvas com sucesso!");
    });

    // Listener para mudanças de conexão
    this.sock.ev.on("connection.update", async (update) => {
      await this.handleConnectionUpdate(update);
    });

    // Listener para mensagens recebidas
    this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
      await this.handleMessages(messages, type);
    });
  }

  /**
   * Gerencia as atualizações de conexão
   */
  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info("📱 QR Code gerado! Escaneie com seu WhatsApp:");
      console.log("\n");
      qrcode.generate(qr, { small: true });
      console.log("\n");
      logger.warn("⚠️ Aguardando escaneamento do QR Code...");
    }

    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : null;

      const errorMessage = lastDisconnect?.error?.message || "erro desconhecido";
      
      // Tipos de desconexão
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isConnectionFailure = errorMessage === "Connection Failure" || 
                                  statusCode === DisconnectReason.connectionClosed ||
                                  statusCode === DisconnectReason.timedOut;
      const isConflict = errorMessage.includes("conflict") || 
                        statusCode === DisconnectReason.multideviceMismatch;
      const isBadSession = statusCode === DisconnectReason.badSession;
      const isRestartRequired = statusCode === DisconnectReason.restartRequired;

      logger.warn(
        "⚠️ Conexão fechada:",
        { message: errorMessage, statusCode }
      );

      // Se foi deslogado ou sessão ruim, não reconectar
      if (isLoggedOut || isBadSession) {
        logger.error(
          "🚪 Sessão inválida. Remova a pasta de sessão e reinicie o bot."
        );
        logger.info(`📁 Caminho da sessão: ${whatsappConfig.auth.sessionPath}`);
        logger.info("💡 Execute: rm -r sessions/auth (ou delete manualmente)");
        this.isConnecting = false;
        this.isReady = false;
        return;
      }

      // Para outros erros, tentar reconectar
      if (this.retryCount >= whatsappConfig.reconnect.maxRetries) {
        logger.error(
          `❌ Máximo de tentativas (${whatsappConfig.reconnect.maxRetries}) atingido. Encerrando...`
        );
        process.exit(1);
      }

      this.retryCount++;
      
      if (isConflict) {
        logger.warn(
          `⚠️ Conflito detectado - Aguardando ${whatsappConfig.reconnect.delayOnConflict / 1000}s antes de reconectar...`
        );
        await delay(whatsappConfig.reconnect.delayOnConflict);
      } else if (isConnectionFailure) {
        logger.info(
          `🌐 Falha de conexão - Tentativa ${this.retryCount}/${whatsappConfig.reconnect.maxRetries}`
        );
        await delay(whatsappConfig.reconnect.delayOnError);
      } else if (isRestartRequired) {
        logger.info("🔄 Reinício requerido pelo servidor...");
        await delay(3000);
      } else {
        logger.info(`🔄 Reconectando... (${this.retryCount}/${whatsappConfig.reconnect.maxRetries})`);
        await delay(whatsappConfig.reconnect.delayOnError);
      }

      logger.info("🔄 Tentando reconectar...");
      this.isConnecting = false;
      this.connect();
    } else if (connection === "open") {
      logger.success("✅ Conexão estabelecida com sucesso!");
      this.isReady = true;
      this.isConnecting = false;
      this.retryCount = 0; // Reset do contador ao conectar com sucesso
      
      // Verificar se a sessão foi salva
      const sessionPath = whatsappConfig.auth.sessionPath;
      const credsFile = path.join(sessionPath, "creds.json");
      
      if (fs.existsSync(credsFile)) {
        logger.success("💾 Sessão salva com sucesso em: " + sessionPath);
      }
    } else if (connection === "connecting") {
      logger.info("🔄 Conectando ao WhatsApp...");
    }
  }

  /**
   * Processa mensagens recebidas
   */
  async handleMessages(messages, type) {
    if (type !== "notify") return;

    const msg = messages[0];
    if (!msg.message) return;

    // Extrair texto da mensagem
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      "";

    if (!text) return;

    // Verificar se é um comando
    if (commandManager.isCommand(text)) {
      await this.handleCommand(msg, text);
    }
  }

  /**
   * Processa comandos
   */
  async handleCommand(msg, text) {
    try {
      const parsed = commandManager.parse(text);
      
      if (!parsed) return;

      const chatId = msg.key.remoteJid;
      const senderName = msg.pushName || "Usuário";
      
      logger.info(`Comando recebido: ${parsed.command}`, {
        sender: senderName,
        chat: chatId,
        args: parsed.args,
      });

      // Contexto para o comando
      const context = {
        sock: this.sock,
        msg,
        args: parsed.args,
        chatId,
        senderName,
      };

      // Executar o comando
      await commandManager.execute(parsed.command, context);
      
      logger.success(`Comando executado: ${parsed.command}`);
    } catch (error) {
      logger.error("Erro ao executar comando:", error);
      
      // Enviar mensagem de erro ao usuário
      await this.sock.sendMessage(msg.key.remoteJid, {
        text: `❌ ${error.message}`,
      });
    }
  }

  /**
   * Envia uma mensagem de texto
   */
  async sendMessage(jid, text, options = {}) {
    try {
      if (!this.sock || !this.isReady) {
        throw new Error("Bot não está pronto para enviar mensagens");
      }

      await this.sock.sendMessage(jid, {
        text: text.trim(),
        ...options,
      });

      console.log(`✅ Mensagem enviada para ${jid}`);
      return true;
    } catch (error) {
      console.error("❌ Erro ao enviar mensagem:", error.message);
      return false;
    }
  }

  /**
   * Verifica se o bot está pronto
   */
  isConnected() {
    return this.isReady && this.sock !== null;
  }

  /**
   * Desconecta o bot
   */
  async disconnect() {
    if (this.sock) {
      await this.sock.logout();
      this.sock = null;
      this.isReady = false;
      console.log("👋 Bot desconectado");
    }
  }
}

export default WhatsAppService;

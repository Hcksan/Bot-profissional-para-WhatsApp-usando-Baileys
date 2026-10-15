import http from "http";
import os from "os";
import path from "path";
import { Server as SocketServer } from "socket.io";
import WhatsAppService from "./services/WhatsAppService.js";
import appConfig from "./config/app.config.js";
import { openDatabase } from "./db/database.js";
import { CrmStore } from "./crm/CrmStore.js";
import { CrmService } from "./crm/CrmService.js";
import { Scheduler } from "./crm/Scheduler.js";
import { CampaignRunner } from "./crm/CampaignRunner.js";
import { createAuth } from "./web/auth.js";
import { createApp } from "./web/app.js";
import logger from "./utils/logger.js";
import "./commands/loader.js"; // Carregar todos os comandos

/**
 * Servidor principal: WhatsApp + CRM + painel web
 */
class BotServer {
  constructor() {
    this.db = openDatabase(path.join(appConfig.dataDir, "crm.db"));
    this.store = new CrmStore(this.db);
    this.whatsappService = new WhatsAppService({ commandsEnabled: appConfig.commandsEnabled });
    this.crm = new CrmService({ store: this.store, wa: this.whatsappService });
    this.scheduler = new Scheduler({ store: this.store, crm: this.crm, wa: this.whatsappService });
    this.runner = new CampaignRunner({ store: this.store, crm: this.crm, wa: this.whatsappService });
  }

  /**
   * Inicia o servidor
   */
  async start() {
    try {
      logger.info("🚀 Iniciando servidor do bot...");

      const auth = createAuth({
        store: this.store,
        password: appConfig.password,
        cookieSecure: appConfig.cookieSecure,
        sessionDays: appConfig.sessionDays,
      });
      const app = createApp({
        store: this.store,
        crm: this.crm,
        wa: this.whatsappService,
        runner: this.runner,
        auth,
      });

      this.httpServer = http.createServer(app);
      this.io = new SocketServer(this.httpServer, { serveClient: true });
      this.io.use(auth.socketAuth);
      this.io.on("connection", (socket) => {
        socket.emit("whatsapp", this.whatsappService.getState());
      });

      this.wireEvents();

      await new Promise((resolve, reject) => {
        this.httpServer.once("error", reject);
        this.httpServer.listen(appConfig.port, appConfig.host, resolve);
      });
      this.printAddresses();

      this.scheduler.start();
      this.runner.start();
      await this.whatsappService.connect();

      logger.success("✅ Servidor iniciado com sucesso!");
      this.setupGracefulShutdown();
    } catch (error) {
      if (error.code === "EADDRINUSE") {
        logger.error(`❌ A porta ${appConfig.port} já está em uso. Feche o outro programa ou mude PORT no .env`);
      } else {
        logger.error("❌ Erro ao iniciar servidor:", { message: error.message });
      }
      process.exit(1);
    }
  }

  /**
   * Liga os eventos do WhatsApp/CRM ao painel em tempo real
   */
  wireEvents() {
    const wa = this.whatsappService;

    wa.on("status", (state) => this.io.emit("whatsapp", state));
    wa.on("incoming", (message) => this.safely(() => this.crm.handleIncoming(message)));
    wa.on("outgoing", (message) => this.safely(() => this.crm.handleOutgoing(message)));
    wa.on("status", ({ status }) => {
      // Assim que conectar, dispara o que ficou pendente
      if (status === "open") setTimeout(() => this.scheduler.tick().catch(() => {}), 5000);
    });

    this.crm.on("changed", (change) => this.io.emit("changed", change));
    this.scheduler.on("changed", () => this.io.emit("changed", { type: "schedules" }));
    this.runner.on("progress", (campaign) => {
      this.io.emit("campaign", campaign);
      this.io.emit("changed", { type: "contacts" });
    });
  }

  safely(fn) {
    try {
      fn();
    } catch (error) {
      logger.error("Erro ao processar evento:", { message: error.message });
    }
  }

  printAddresses() {
    const { port, host } = appConfig;
    logger.success(`🌐 Painel disponível em http://localhost:${port}`);
    if (host === "0.0.0.0") {
      for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses ?? []) {
          if (address.family === "IPv4" && !address.internal) {
            logger.info(`📱 Na mesma rede (celular/outro PC): http://${address.address}:${port}`);
          }
        }
      }
    }
  }

  /**
   * Configura o encerramento gracioso do servidor
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`📡 Sinal ${signal} recebido. Encerrando...`);

      try {
        this.scheduler.stop();
        this.runner.stop();
        // Encerra sem desconectar o aparelho: na próxima vez não precisa ler o QR Code de novo
        await this.whatsappService.disconnect();
        this.io?.close();
        this.db.close();
        logger.success("👋 Servidor encerrado com sucesso!");
        process.exit(0);
      } catch (error) {
        logger.error("❌ Erro ao encerrar servidor:", { message: error.message });
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}

// Iniciar o servidor
const server = new BotServer();
server.start();

export default BotServer;

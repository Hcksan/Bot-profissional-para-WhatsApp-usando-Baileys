import http from "http";
import os from "os";
import path from "path";
import { Server as SocketServer } from "socket.io";
import appConfig from "./config/app.config.js";
import { openDatabase } from "./db/database.js";
import { CrmStore } from "./crm/CrmStore.js";
import { WorkspaceManager } from "./workspaces/WorkspaceManager.js";
import { createAuth } from "./web/auth.js";
import { createApp } from "./web/app.js";
import logger from "./utils/logger.js";
import "./commands/loader.js"; // Carregar todos os comandos

/**
 * Servidor principal: painel web + um espaço (CRM e WhatsApp) por conta
 */
class BotServer {
  constructor() {
    this.db = openDatabase(path.join(appConfig.dataDir, "crm.db"));
    this.store = new CrmStore(this.db);
    this.workspaces = new WorkspaceManager({
      mainDb: this.db,
      mainStore: this.store,
      dataDir: appConfig.dataDir,
      commandsEnabled: appConfig.commandsEnabled,
    });
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
        production: appConfig.production,
        cookieSecure: appConfig.cookieSecure,
        sessionDays: appConfig.sessionDays,
        publicUrl: appConfig.publicUrl,
        workspaces: this.workspaces,
      });
      const app = createApp({
        workspaces: this.workspaces,
        auth,
        config: appConfig,
        // Sessão encerrada pelo painel: derruba também a conexão em tempo real daquele aparelho
        onSessionsRevoked: (hashes) => {
          const revoked = new Set(hashes);
          for (const socket of this.io?.sockets.sockets.values() ?? []) {
            if (revoked.has(socket.data.sessionHash)) socket.disconnect(true);
          }
        },
      });

      this.httpServer = http.createServer(app);
      this.io = new SocketServer(this.httpServer, { serveClient: true, maxHttpBufferSize: 1e5 });
      this.io.use(auth.socketAuth);
      this.io.on("connection", (socket) => {
        // Cada aba só recebe os eventos do próprio espaço
        const workspace = this.workspaces.get(socket.data.workspaceId);
        if (!workspace) return socket.disconnect(true);
        socket.join(`ws:${workspace.id}`);
        socket.emit("whatsapp", workspace.wa.getState());
      });

      this.wireEvents();

      await new Promise((resolve, reject) => {
        this.httpServer.once("error", reject);
        this.httpServer.listen(appConfig.port, appConfig.host, resolve);
      });
      this.printAddresses();

      await this.workspaces.start();

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
    const room = (id) => this.io.to(`ws:${id}`);
    this.workspaces.on("whatsapp", (id, state) => room(id).emit("whatsapp", state));
    this.workspaces.on("changed", (id, change) => room(id).emit("changed", change));
    this.workspaces.on("campaign", (id, campaign) => room(id).emit("campaign", campaign));
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
        // Encerra sem desconectar os aparelhos: na próxima vez não precisa ler o QR Code de novo
        await this.workspaces.stop();
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

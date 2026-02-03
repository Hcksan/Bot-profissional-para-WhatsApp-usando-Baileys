import WhatsAppService from "./services/WhatsAppService.js";
import logger from "./utils/logger.js";
import "./commands/loader.js"; // Carregar todos os comandos

/**
 * Servidor principal do bot
 */
class BotServer {
  constructor() {
    this.whatsappService = new WhatsAppService();
  }

  /**
   * Inicia o servidor
   */
  async start() {
    try {
      logger.info("🚀 Iniciando servidor do bot...");
      
      // Conectar ao WhatsApp
      await this.whatsappService.connect();
      
      logger.success("✅ Servidor iniciado com sucesso!");
      
      // Gerenciar sinais de encerramento
      this.setupGracefulShutdown();
    } catch (error) {
      logger.error("❌ Erro ao iniciar servidor:", error);
      process.exit(1);
    }
  }

  /**
   * Configura o encerramento gracioso do servidor
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`📡 Sinal ${signal} recebido. Encerrando...`);
      
      try {
        await this.whatsappService.disconnect();
        logger.success("👋 Servidor encerrado com sucesso!");
        process.exit(0);
      } catch (error) {
        logger.error("❌ Erro ao encerrar servidor:", error);
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

/**
 * Configurações do WhatsApp Bot
 */

export const whatsappConfig = {
  // Configurações de autenticação
  auth: {
    sessionPath: "./sessions/auth",
  },

  // Configurações do browser
  browser: {
    name: "Bot WhatsApp Business",
    browserName: "Chrome",
    version: "1.0.0",
  },

  // Configurações de reconexão
  reconnect: {
    maxRetries: 10,
    delayOnError: 3000,
    delayOnConflict: 10000,
  },

  // Configurações de logs
  logging: {
    level: "silent", // 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  },
};

export default whatsappConfig;

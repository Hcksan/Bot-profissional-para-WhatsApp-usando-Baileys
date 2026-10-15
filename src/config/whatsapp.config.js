import { Browsers } from "baileys";

/**
 * Configurações do WhatsApp Bot
 */

export const whatsappConfig = {
  // Configurações de autenticação
  auth: {
    sessionPath: "./sessions/auth",
  },

  // Como o aparelho aparece em "Aparelhos conectados" no celular
  browser: Browsers.windows("Chrome"),

  // Configurações de reconexão (em ms)
  reconnect: {
    delayOnError: 3000,
    delayOnConflict: 10000,
    maxDelay: 60000,
  },

  // Configurações de logs
  logging: {
    level: "silent", // 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  },
};

export default whatsappConfig;

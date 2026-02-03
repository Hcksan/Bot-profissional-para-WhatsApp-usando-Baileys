import commandManager from "./index.js";

/**
 * Comando de teste - Ping
 */
async function pingHandler({ sock, msg, args }) {
  const chatId = msg.key.remoteJid;
  const startTime = Date.now();

  await sock.sendMessage(chatId, {
    text: "🏓 Pong!",
  });

  const endTime = Date.now();
  const latency = endTime - startTime;

  await sock.sendMessage(chatId, {
    text: `⚡ Latência: ${latency}ms`,
  });
}

// Registrar o comando
commandManager.register("ping", pingHandler, {
  description: "Testa a latência do bot",
  usage: "!ping",
  category: "utilidade",
});

export default pingHandler;

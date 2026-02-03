import commandManager from "./index.js";

/**
 * Comando de informações do bot
 */
async function infoHandler({ sock, msg, args }) {
  const chatId = msg.key.remoteJid;
  
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  const memoryUsage = process.memoryUsage();
  const memoryInMB = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);

  const infoText = `
🤖 *Informações do Bot*

📊 *Status:* Online ✅
⏱️ *Tempo ativo:* ${hours}h ${minutes}m ${seconds}s
💾 *Memória:* ${memoryInMB} MB
📦 *Node.js:* ${process.version}
🔧 *Plataforma:* ${process.platform}
📝 *Comandos registrados:* ${commandManager.list().length}

*Desenvolvido com ❤️ usando Baileys*
  `.trim();

  await sock.sendMessage(chatId, { text: infoText });
}

// Registrar o comando
commandManager.register("info", infoHandler, {
  description: "Mostra informações do bot",
  usage: "!info",
  category: "utilidade",
});

export default infoHandler;

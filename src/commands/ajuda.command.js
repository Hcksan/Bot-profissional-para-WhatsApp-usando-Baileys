import commandManager from "./index.js";

/**
 * Comando de ajuda
 */
async function ajudaHandler({ sock, msg, args }) {
  const chatId = msg.key.remoteJid;
  const senderName = msg.pushName || "Usuário";

  // Se foi especificado um comando, mostrar ajuda específica
  if (args.length > 0) {
    const commandName = args[0].toLowerCase();
    const command = commandManager.get(commandName);

    if (!command) {
      await sock.sendMessage(chatId, {
        text: `❌ Comando "${commandName}" não encontrado.`,
      });
      return;
    }

    const helpText = `
📖 *Ajuda do Comando*

*Comando:* ${command.name}
*Descrição:* ${command.description}
*Uso:* ${command.usage}
*Categoria:* ${command.category}
    `.trim();

    await sock.sendMessage(chatId, { text: helpText });
    return;
  }

  // Listar todos os comandos agrupados por categoria
  const allCommands = commandManager.list();
  const categories = [...new Set(allCommands.map((cmd) => cmd.category))];

  let helpText = `👋 Olá ${senderName}! Aqui estão os comandos disponíveis:\n\n`;

  for (const category of categories) {
    const commands = commandManager.listByCategory(category);
    helpText += `*[${category.toUpperCase()}]*\n`;

    for (const cmd of commands) {
      helpText += `• \`${cmd.usage}\` - ${cmd.description}\n`;
    }
    helpText += "\n";
  }

  helpText += `\n💡 *Dica:* Use \`!ajuda <comando>\` para mais informações sobre um comando específico.`;

  await sock.sendMessage(chatId, { text: helpText });
}

// Registrar o comando
commandManager.register("ajuda", ajudaHandler, {
  description: "Lista todos os comandos disponíveis",
  usage: "!ajuda [comando]",
  category: "utilidade",
});

export default ajudaHandler;

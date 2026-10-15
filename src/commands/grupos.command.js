import commandManager from "./index.js";
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import logger from "../utils/logger.js";

/**
 * Comando para gerenciar grupos
 */
async function gruposHandler({ sock, msg, args }) {
  const chatId = msg.key.remoteJid;
  const senderNumber = msg.key.participant?.replace(/[^0-9]/g, "") || 
                       chatId.replace(/[^0-9]/g, "");

  // Subcomandos disponíveis
  const subcommand = args[0]?.toLowerCase();

  try {
    switch (subcommand) {
      case "listar":
        await listarGrupos(sock, chatId);
        break;

      case "membros":
        await extrairMembros(sock, chatId, msg, args);
        break;

      case "info":
        await infoGrupo(sock, chatId, msg, args);
        break;

      default:
        await mostrarAjuda(sock, chatId);
        break;
    }
  } catch (error) {
    logger.error("Erro no comando grupos:", error);
    await sock.sendMessage(chatId, {
      text: `❌ Erro ao executar comando: ${error.message}`,
    });
  }
}

/**
 * Lista todos os grupos que o bot participa
 */
async function listarGrupos(sock, chatId) {
  await sock.sendMessage(chatId, {
    text: "🔍 Buscando grupos...",
  });

  const groups = await sock.groupFetchAllParticipating();
  const groupList = Object.values(groups);

  if (groupList.length === 0) {
    await sock.sendMessage(chatId, {
      text: "📭 O bot não está em nenhum grupo.",
    });
    return;
  }

  let message = `📋 *Lista de Grupos* (${groupList.length})\n\n`;

  groupList.forEach((group, index) => {
    const participantCount = group.participants?.length || 0;
    message += `${index + 1}. *${group.subject}*\n`;
    message += `   👥 Membros: ${participantCount}\n`;
    message += `   🆔 ID: \`${group.id}\`\n\n`;
  });

  message += `\n💡 *Dica:* Use \`!grupos membros\` para extrair membros de um grupo.`;

  await sock.sendMessage(chatId, { text: message });
  logger.info(`Lista de grupos enviada (${groupList.length} grupos)`);
}

/**
 * Extrai membros do grupo atual ou de um grupo específico
 */
async function extrairMembros(sock, chatId, msg, args) {
  await sock.sendMessage(chatId, {
    text: "📊 Extraindo membros do grupo...",
  });

  let targetGroupId = chatId;
  let formato = "completo";

  // Verificar se foi especificado um ID de grupo
  // Formato: !grupos membros [id_do_grupo] [formato]
  // ou: !grupos membros [formato]
  
  if (args[1]) {
    // Se o argumento parece ser um ID de grupo (contém @g.us)
    if (args[1].includes("@g.us")) {
      targetGroupId = args[1];
      formato = args[2]?.toLowerCase() || "completo";
    } else {
      // Se não, é o formato
      formato = args[1].toLowerCase();
    }
  }

  // Validar se o targetGroupId é um grupo
  if (!targetGroupId.endsWith("@g.us")) {
    await sock.sendMessage(chatId, {
      text: "❌ ID de grupo inválido!\n\n💡 *Opções de uso:*\n\n" +
            "1️⃣ Dentro de um grupo:\n" +
            "   \`!grupos membros\` - Extrai do grupo atual\n" +
            "   \`!grupos membros numeros\` - Apenas números\n\n" +
            "2️⃣ De qualquer chat (usando ID):\n" +
            "   \`!grupos membros ID_DO_GRUPO@g.us\`\n" +
            "   \`!grupos membros ID_DO_GRUPO@g.us numeros\`\n\n" +
            "💡 Use \`!grupos listar\` para ver os IDs dos grupos.",
    });
    return;
  }

  // Tentar buscar metadados do grupo
  let groupMetadata;
  try {
    groupMetadata = await sock.groupMetadata(targetGroupId);
  } catch (error) {
    await sock.sendMessage(chatId, {
      text: `❌ Não foi possível acessar o grupo especificado.\n\n` +
            `Possíveis motivos:\n` +
            `• O bot não está neste grupo\n` +
            `• O ID do grupo está incorreto\n` +
            `• O grupo não existe mais\n\n` +
            `💡 Use \`!grupos listar\` para ver os grupos disponíveis.`,
    });
    logger.error("Erro ao buscar metadados do grupo:", error);
    return;
  }

  const participants = groupMetadata.participants;

  // Enviar feedback de progresso
  await sock.sendMessage(chatId, {
    text: `⏳ Processando ${participants.length} membros...\n\nIsso pode levar alguns segundos.`,
  });

  // Preparar dados
  const membrosData = [];
  let processados = 0;
  const totalMembros = participants.length;

  // Processar em lotes para melhor performance
  const batchSize = 50;
  let numerosReais = 0;
  let idsInternos = 0;
  
  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i];
    
    // Verificar o tipo de ID (o Baileys 7 informa o número real em phoneNumber quando o ID é um LID)
    const fullId = participant.phoneNumber || participant.id;
    const isPhoneNumber = fullId.includes("@s.whatsapp.net");
    const isLidAccount = fullId.includes("@lid");
    
    // Extrair número/ID corretamente
    let numero = fullId.split("@")[0]; // Remove @s.whatsapp.net, @lid, etc
    numero = numero.split(":")[0]; // Remove :1 ou outros sufixos
    numero = numero.replace(/[^0-9]/g, ""); // Remove caracteres não numéricos
    
    const isAdmin = participant.admin === "admin" || participant.admin === "superadmin";
    const isSuperAdmin = participant.admin === "superadmin";

    // Identificar o tipo de conta
    let tipoConta = "WhatsApp";
    if (isLidAccount) {
      tipoConta = "Número oculto (LID)";
      idsInternos++;
    } else if (isPhoneNumber) {
      numerosReais++;
    } else {
      tipoConta = "Outro";
      idsInternos++;
    }

    if (formato === "numeros") {
      membrosData.push({
        Número: isPhoneNumber ? numero : `ID:${numero}`,
        Tipo: tipoConta,
      });
    } else {
      // Usar pushName se disponível, caso contrário usar o número
      let nome = participant.notify || participant.verifiedName || "Sem nome";

      membrosData.push({
        Nome: nome,
        Número: isPhoneNumber ? numero : `ID:${numero}`,
        Tipo: tipoConta,
        Admin: isAdmin ? "Sim" : "Não",
        "Super Admin": isSuperAdmin ? "Sim" : "Não",
      });
    }

    processados++;

    // Enviar atualização de progresso a cada 50 membros processados
    if (processados % batchSize === 0 && processados < totalMembros) {
      try {
        await sock.sendMessage(chatId, {
          text: `⏳ Progresso: ${processados}/${totalMembros} membros processados...`,
        });
      } catch (error) {
        // Ignorar erro de mensagem de progresso
      }
    }
  }

  logger.info(`Processamento concluído: ${processados} membros`);

  // Criar arquivos
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
  const groupName = groupMetadata.subject.replace(/[^a-zA-Z0-9]/g, "_");
  const baseFileName = `membros_${groupName}_${timestamp}`;

  // Garantir que a pasta temp existe
  const tempDir = "./temp";
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Salvar JSON
  const jsonPath = path.join(tempDir, `${baseFileName}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(membrosData, null, 2), "utf8");

  // Salvar XLSX
  const xlsxPath = path.join(tempDir, `${baseFileName}.xlsx`);
  const worksheet = XLSX.utils.json_to_sheet(membrosData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Membros");
  XLSX.writeFile(workbook, xlsxPath);

  // Criar mensagem de resumo
  const admins = participants.filter((p) => p.admin === "admin" || p.admin === "superadmin").length;
  const superAdmins = participants.filter((p) => p.admin === "superadmin").length;

  let resumo = `✅ *Extração Concluída!*\n\n`;
  resumo += `📊 *Grupo:* ${groupMetadata.subject}\n`;
  resumo += `👥 *Total de membros:* ${participants.length}\n`;
  resumo += `� *Números WhatsApp:* ${numerosReais}\n`;
  resumo += `🔗 *Contas vinculadas (FB/IG):* ${idsInternos}\n`;
  resumo += `�👑 *Admins:* ${admins}\n`;
  resumo += `⭐ *Super Admins:* ${superAdmins}\n`;
  resumo += `📋 *Formato:* ${formato === "numeros" ? "Apenas números" : "Completo (nome + número)"}\n\n`;
  resumo += `📁 Enviando arquivos...`;

  await sock.sendMessage(chatId, { text: resumo });

  // Enviar arquivos
  try {
    // Enviar JSON
    await sock.sendMessage(chatId, {
      document: fs.readFileSync(jsonPath),
      mimetype: "application/json",
      fileName: `${baseFileName}.json`,
      caption: "📄 Membros em formato JSON",
    });

    // Enviar XLSX
    await sock.sendMessage(chatId, {
      document: fs.readFileSync(xlsxPath),
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: `${baseFileName}.xlsx`,
      caption: "📊 Membros em formato Excel",
    });

    await sock.sendMessage(chatId, {
      text: "✅ Arquivos enviados com sucesso!",
    });

    // Limpar arquivos temporários após 30 segundos
    setTimeout(() => {
      try {
        if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
        if (fs.existsSync(xlsxPath)) fs.unlinkSync(xlsxPath);
        logger.info("Arquivos temporários removidos");
      } catch (error) {
        logger.warn("Erro ao remover arquivos temporários:", error);
      }
    }, 30000);

    logger.info(`Membros extraídos: ${participants.length} do grupo ${groupMetadata.subject}`);
  } catch (error) {
    logger.error("Erro ao enviar arquivos:", error);
    await sock.sendMessage(chatId, {
      text: `❌ Erro ao enviar arquivos: ${error.message}`,
    });
  }
}

/**
 * Mostra informações do grupo atual ou de um grupo específico
 */
async function infoGrupo(sock, chatId, msg, args) {
  let targetGroupId = chatId;

  // Verificar se foi especificado um ID de grupo
  if (args[1] && args[1].includes("@g.us")) {
    targetGroupId = args[1];
  }

  // Validar se é um grupo
  if (!targetGroupId.endsWith("@g.us")) {
    await sock.sendMessage(chatId, {
      text: "❌ ID de grupo inválido!\n\n" +
            "💡 *Opções de uso:*\n\n" +
            "• Dentro do grupo: \`!grupos info\`\n" +
            "• De qualquer chat: \`!grupos info ID_DO_GRUPO@g.us\`\n\n" +
            "Use \`!grupos listar\` para ver os IDs.",
    });
    return;
  }

  // Tentar buscar metadados do grupo
  let groupMetadata;
  try {
    groupMetadata = await sock.groupMetadata(targetGroupId);
  } catch (error) {
    await sock.sendMessage(chatId, {
      text: "❌ Não foi possível acessar o grupo especificado.\n\n" +
            "O bot precisa estar no grupo para ver as informações.",
    });
    logger.error("Erro ao buscar metadados do grupo:", error);
    return;
  }

  const participants = groupMetadata.participants;
  const admins = participants.filter((p) => p.admin === "admin" || p.admin === "superadmin");
  const superAdmins = participants.filter((p) => p.admin === "superadmin");

  let info = `ℹ️ *Informações do Grupo*\n\n`;
  info += `📝 *Nome:* ${groupMetadata.subject}\n`;
  info += `🆔 *ID:* \`${groupMetadata.id}\`\n`;
  info += `👥 *Membros:* ${participants.length}\n`;
  info += `👑 *Admins:* ${admins.length}\n`;
  info += `⭐ *Super Admins:* ${superAdmins.length}\n`;
  info += `📅 *Criado em:* ${new Date(groupMetadata.creation * 1000).toLocaleString("pt-BR")}\n`;

  if (groupMetadata.desc) {
    info += `\n📄 *Descrição:*\n${groupMetadata.desc}`;
  }

  await sock.sendMessage(chatId, { text: info });
}

/**
 * Mostra ajuda do comando
 */
async function mostrarAjuda(sock, chatId) {
  const ajuda = `
📚 *Comando de Grupos*

*Subcomandos disponíveis:*

1️⃣ \`!grupos listar\`
   Lista todos os grupos que o bot participa
   Mostra: Nome, quantidade de membros e ID

2️⃣ \`!grupos membros [id_grupo] [formato]\`
   Extrai membros de um grupo em JSON e XLSX
   
   *Uso dentro de um grupo:*
   • \`!grupos membros\` - Extrai do grupo atual
   • \`!grupos membros numeros\` - Apenas números
   
   *Uso de qualquer chat (com ID):*
   • \`!grupos membros 120363142576126965@g.us\`
   • \`!grupos membros 120363142576126965@g.us numeros\`
   
   *Formatos disponíveis:*
   • \`completo\` (padrão) - Nome, número, tipo, admin
   • \`numeros\` - Números e tipo
   
   💡 Use \`!grupos listar\` para copiar o ID do grupo

3️⃣ \`!grupos info [id_grupo]\`
   Mostra informações detalhadas de um grupo
   
   • \`!grupos info\` - Info do grupo atual
   • \`!grupos info 120363142576126965@g.us\` - Info de qualquer grupo

⚠️ *Sobre os tipos de conta:*
• *WhatsApp* - Número de telefone normal
• *Número oculto (LID)* - O WhatsApp escondeu o número desta pessoa no grupo (ID começa com "ID:")
• Os IDs internos aparecem como "ID:xxxxx" para diferenciá-los

📋 *Exemplos práticos:*

\`\`\`
!grupos listar
!grupos membros
!grupos membros numeros
!grupos membros 120363142576126965@g.us
!grupos info
\`\`\`
  `.trim();

  await sock.sendMessage(chatId, { text: ajuda });
}

// Registrar o comando
commandManager.register("grupos", gruposHandler, {
  description: "Gerencia grupos do WhatsApp",
  usage: "!grupos [listar|membros|info]",
  category: "grupos",
});

export default gruposHandler;

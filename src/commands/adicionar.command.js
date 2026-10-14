import { jidNormalizedUser } from "baileys";
import commandManager from "./index.js";
import logger from "../utils/logger.js";

/**
 * Encontra você (dono do número) na lista de participantes do grupo.
 * No WhatsApp atual o participante pode vir com o número (@s.whatsapp.net) ou com o LID (@lid).
 */
function findMe(participants, sock) {
  const myIds = new Set([sock.user?.id, sock.user?.lid].filter(Boolean).map((id) => jidNormalizedUser(id)));
  return participants.find((p) => [p.id, p.phoneNumber, p.lid].filter(Boolean).some((id) => myIds.has(jidNormalizedUser(id))));
}

const isAdmin = (participant) => participant?.admin === "admin" || participant?.admin === "superadmin";

/**
 * Comando para adicionar membros a grupos
 */
async function adicionarHandler({ sock, msg, args }) {
  const chatId = msg.key.remoteJid;

  // Subcomandos disponíveis
  const subcommand = args[0]?.toLowerCase();

  try {
    switch (subcommand) {
      case "listar":
        await listarGruposAdmin(sock, chatId);
        break;

      case "membro":
      case "membros":
        await adicionarMembros(sock, chatId, msg, args);
        break;

      default:
        await mostrarAjuda(sock, chatId);
        break;
    }
  } catch (error) {
    logger.error("Erro no comando adicionar:", error);
    await sock.sendMessage(chatId, {
      text: `❌ Erro ao executar comando: ${error.message}`,
    });
  }
}

/**
 * Lista grupos onde o usuário é admin
 */
async function listarGruposAdmin(sock, chatId) {
  await sock.sendMessage(chatId, {
    text: "🔍 Buscando grupos onde você é admin...",
  });

  const groups = await sock.groupFetchAllParticipating();
  const groupList = Object.values(groups);

  if (groupList.length === 0) {
    await sock.sendMessage(chatId, {
      text: "📭 O bot não está em nenhum grupo.",
    });
    return;
  }

  // Filtrar grupos onde o remetente é admin
  const adminGroups = [];

  for (const group of groupList) {
    const participants = group.participants || [];
    const sender = findMe(participants, sock);

    if (isAdmin(sender)) {
      adminGroups.push({
        id: group.id,
        subject: group.subject,
        participantCount: participants.length,
        isSuperAdmin: sender.admin === "superadmin",
      });
    }
  }

  if (adminGroups.length === 0) {
    await sock.sendMessage(chatId, {
      text: "⚠️ Você não é administrador em nenhum grupo onde o bot está presente.",
    });
    return;
  }

  let message = `👑 *Grupos onde você é Admin* (${adminGroups.length})\n\n`;

  adminGroups.forEach((group, index) => {
    message += `${index + 1}. *${group.subject}*\n`;
    message += `   👥 Membros: ${group.participantCount}\n`;
    message += `   ${group.isSuperAdmin ? "⭐" : "👑"} Seu cargo: ${group.isSuperAdmin ? "Super Admin" : "Admin"}\n`;
    message += `   🆔 ID: \`${group.id}\`\n\n`;
  });

  message += `\n💡 *Como adicionar membros:*\n`;
  message += `\`!adicionar membros ID_DO_GRUPO@g.us 5511999999999,5511888888888\`\n\n`;
  message += `📝 *Dica:* Separe os números por vírgula, sem espaços.`;

  await sock.sendMessage(chatId, { text: message });
  logger.info(`Lista de grupos admin enviada (${adminGroups.length} grupos)`);
}

/**
 * Adiciona membros a um grupo
 */
async function adicionarMembros(sock, chatId, msg, args) {
  // Formato: !adicionar membros ID_DO_GRUPO@g.us 5511999999999,5511888888888
  
  if (args.length < 3) {
    await sock.sendMessage(chatId, {
      text: `❌ *Comando incompleto!*\n\n` +
            `*Uso correto:*\n` +
            `\`!adicionar membros ID_DO_GRUPO@g.us numero1,numero2,numero3\`\n\n` +
            `*Exemplo:*\n` +
            `\`!adicionar membros 120363142576126965@g.us 5511999999999,5511888888888\`\n\n` +
            `💡 Use \`!adicionar listar\` para ver os grupos onde você é admin.`,
    });
    return;
  }

  const targetGroupId = args[1];
  const numerosString = args.slice(2).join(" "); // Juntar todos os argumentos restantes

  // Validar ID do grupo
  if (!targetGroupId.endsWith("@g.us")) {
    await sock.sendMessage(chatId, {
      text: "❌ ID de grupo inválido! O ID deve terminar com @g.us",
    });
    return;
  }

  // Verificar se o remetente é admin do grupo
  let groupMetadata;
  try {
    groupMetadata = await sock.groupMetadata(targetGroupId);
  } catch (error) {
    await sock.sendMessage(chatId, {
      text: `❌ Não foi possível acessar o grupo.\n\n` +
            `Possíveis motivos:\n` +
            `• O bot não está neste grupo\n` +
            `• O ID está incorreto\n` +
            `• O grupo não existe mais`,
    });
    logger.error("Erro ao buscar metadados do grupo:", error);
    return;
  }

  // Verificar se o remetente é admin
  const participants = groupMetadata.participants;
  const sender = findMe(participants, sock);

  if (!isAdmin(sender)) {
    await sock.sendMessage(chatId, {
      text: `❌ Você não é administrador do grupo *${groupMetadata.subject}*!\n\n` +
            `Apenas administradores podem adicionar membros.`,
    });
    return;
  }

  // Verificar se o bot é admin
  const botParticipant = sender;

  if (!isAdmin(botParticipant)) {
    await sock.sendMessage(chatId, {
      text: `⚠️ O bot não é administrador do grupo *${groupMetadata.subject}*!\n\n` +
            `Para adicionar membros, o bot precisa ser admin do grupo.`,
    });
    return;
  }

  // Processar lista de números
  const numeros = numerosString
    .split(",")
    .map((n) => n.trim().replace(/[^0-9]/g, ""))
    .filter((n) => n.length > 0);

  if (numeros.length === 0) {
    await sock.sendMessage(chatId, {
      text: `❌ Nenhum número válido foi fornecido!\n\n` +
            `*Formato correto:* 5511999999999,5511888888888\n` +
            `Separe os números por vírgula.`,
    });
    return;
  }

  // Validar números (devem ter pelo menos 10 dígitos)
  const numerosValidos = numeros.filter((n) => n.length >= 10);
  const numerosInvalidos = numeros.filter((n) => n.length < 10);

  if (numerosValidos.length === 0) {
    await sock.sendMessage(chatId, {
      text: `❌ Nenhum número válido!\n\n` +
            `Todos os números devem ter pelo menos 10 dígitos.\n` +
            `Números inválidos: ${numerosInvalidos.join(", ")}`,
    });
    return;
  }

  // Enviar feedback inicial
  let feedback = `🚀 *Adicionando membros ao grupo*\n\n`;
  feedback += `📊 *Grupo:* ${groupMetadata.subject}\n`;
  feedback += `👥 *Total a adicionar:* ${numerosValidos.length}\n`;
  
  if (numerosInvalidos.length > 0) {
    feedback += `⚠️ *Números ignorados:* ${numerosInvalidos.length} (inválidos)\n`;
  }
  
  feedback += `\n⏳ Processando...`;

  await sock.sendMessage(chatId, { text: feedback });

  // Adicionar membros
  const resultados = {
    sucesso: [],
    falha: [],
    jaNoGrupo: [],
  };

  for (const numero of numerosValidos) {
    try {
      const jid = `${numero}@s.whatsapp.net`;

      // Verificar se já está no grupo
      const jaEstaNoGrupo = participants.some((p) => 
        p.id.replace(/[^0-9]/g, "") === numero
      );

      if (jaEstaNoGrupo) {
        resultados.jaNoGrupo.push(numero);
        continue;
      }

      // Verificar se o número existe no WhatsApp
      const [exists] = await sock.onWhatsApp(jid);
      
      if (!exists) {
        resultados.falha.push({ numero, motivo: "Número não está no WhatsApp" });
        continue;
      }

      // Tentar adicionar
      await sock.groupParticipantsUpdate(targetGroupId, [jid], "add");
      resultados.sucesso.push(numero);
      
      // Aguardar 1 segundo entre cada adição para evitar spam
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      let motivo = "Erro desconhecido";
      
      if (error.message?.includes("403")) {
        motivo = "Privacidade do usuário impede adicionar";
      } else if (error.message?.includes("404")) {
        motivo = "Número não encontrado";
      } else if (error.message?.includes("409")) {
        motivo = "Já está no grupo";
      } else {
        motivo = error.message || "Erro desconhecido";
      }
      
      resultados.falha.push({ numero, motivo });
      logger.warn(`Falha ao adicionar ${numero}: ${motivo}`);
    }
  }

  // Montar relatório final
  let relatorio = `\n📊 *Relatório de Adições*\n\n`;
  relatorio += `✅ *Adicionados com sucesso:* ${resultados.sucesso.length}\n`;
  
  if (resultados.sucesso.length > 0) {
    relatorio += `   ${resultados.sucesso.map((n) => `• ${n}`).join("\n   ")}\n\n`;
  }

  if (resultados.jaNoGrupo.length > 0) {
    relatorio += `ℹ️ *Já estavam no grupo:* ${resultados.jaNoGrupo.length}\n`;
    relatorio += `   ${resultados.jaNoGrupo.map((n) => `• ${n}`).join("\n   ")}\n\n`;
  }

  if (resultados.falha.length > 0) {
    relatorio += `❌ *Não foi possível adicionar:* ${resultados.falha.length}\n`;
    resultados.falha.forEach(({ numero, motivo }) => {
      relatorio += `   • ${numero}: ${motivo}\n`;
    });
  }

  await sock.sendMessage(chatId, { text: relatorio });
  
  logger.info(
    `Membros adicionados ao grupo ${groupMetadata.subject}: ` +
    `${resultados.sucesso.length} sucesso, ${resultados.falha.length} falha`
  );
}

/**
 * Mostra ajuda do comando
 */
async function mostrarAjuda(sock, chatId) {
  const ajuda = `
📚 *Comando de Adicionar Membros*

*Subcomandos disponíveis:*

1️⃣ \`!adicionar listar\`
   Lista todos os grupos onde você é administrador
   
   📋 Mostra:
   • Nome do grupo
   • Quantidade de membros
   • Seu cargo (Admin ou Super Admin)
   • ID do grupo

2️⃣ \`!adicionar membros ID_GRUPO@g.us numero1,numero2,numero3\`
   Adiciona membros a um grupo específico
   
   ⚠️ *Requisitos:*
   • Você deve ser admin do grupo
   • O bot deve ser admin do grupo
   • Números devem ter pelo menos 10 dígitos
   • Separe os números por vírgula
   
   📝 *Formato dos números:*
   • Com código do país: 5511999999999
   • Sem formatação: apenas números
   • Separados por vírgula: 5511999999999,5511888888888

📋 *Exemplos práticos:*

\`\`\`
# Listar grupos onde você é admin
!adicionar listar

# Adicionar um membro
!adicionar membros 120363142576126965@g.us 5511999999999

# Adicionar vários membros
!adicionar membros 120363142576126965@g.us 5511999999999,5511888888888,5511777777777

# Adicionar com espaços (também funciona)
!adicionar membros 120363142576126965@g.us 5511999999999, 5511888888888, 5511777777777
\`\`\`

⚠️ *Observações importantes:*

• Alguns usuários podem ter configurações de privacidade que impedem serem adicionados
• O bot aguarda 1 segundo entre cada adição para evitar spam
• Você receberá um relatório detalhado após o processo
• Apenas admins do grupo podem usar este comando
  `.trim();

  await sock.sendMessage(chatId, { text: ajuda });
}

// Registrar o comando
commandManager.register("adicionar", adicionarHandler, {
  description: "Adiciona membros a grupos",
  usage: "!adicionar [listar|membros]",
  category: "grupos",
});

export default adicionarHandler;

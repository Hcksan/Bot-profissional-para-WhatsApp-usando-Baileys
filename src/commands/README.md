# 🎯 Sistema de Comandos

Este diretório contém todos os comandos do bot WhatsApp. O sistema é modular e facilita a criação de novos comandos.

## 📁 Estrutura

```
commands/
├── index.js              # Gerenciador central de comandos
├── loader.js             # Carregador automático de comandos
├── ping.command.js       # Exemplo de comando simples
├── ajuda.command.js      # Comando de ajuda
├── info.command.js       # Informações do bot
├── grupos.command.js     # Comando complexo com subcomandos
└── adicionar.command.js  # Comando com validações
```

## 🚀 Como Criar um Novo Comando

### Passo 1: Criar o arquivo do comando

Crie um arquivo seguindo o padrão: `nome.command.js`

```javascript
import commandManager from "./index.js";
import logger from "../utils/logger.js";

/**
 * Descrição do seu comando
 */
async function meuComandoHandler({ sock, msg, args }) {
  const chatId = msg.key.remoteJid;
  const senderName = msg.pushName || "Usuário";

  // Sua lógica aqui
  await sock.sendMessage(chatId, {
    text: `Olá ${senderName}! Comando executado com sucesso!`,
  });

  logger.info(`Comando executado por ${senderName}`);
}

// Registrar o comando
commandManager.register("meucomando", meuComandoHandler, {
  description: "Descrição curta do comando",
  usage: "!meucomando [argumentos]",
  category: "categoria",
});

export default meuComandoHandler;
```

### Passo 2: Adicionar ao loader

Abra `loader.js` e importe seu comando:

```javascript
// ...existing imports...
import "./meucomando.command.js";
```

### Passo 3: Testar

Reinicie o bot e teste seu comando:
```
!meucomando
```

## 📚 Contexto do Handler

Cada handler recebe um objeto com as seguintes propriedades:

```javascript
{
  sock,        // Socket do WhatsApp (Baileys)
  msg,         // Objeto da mensagem completa
  args,        // Array de argumentos do comando
  chatId,      // ID do chat (grupo ou privado)
  senderName,  // Nome de quem enviou
}
```

### Propriedades Úteis:

```javascript
// ID do chat
const chatId = msg.key.remoteJid;

// Nome do remetente
const senderName = msg.pushName || "Usuário";

// Número do remetente
const senderNumber = msg.key.participant?.replace(/[^0-9]/g, "") || 
                     chatId.replace(/[^0-9]/g, "");

// Verificar se está em um grupo
const isGroup = chatId.endsWith("@g.us");

// Argumentos do comando
// Para: !comando arg1 arg2 arg3
// args = ["arg1", "arg2", "arg3"]
const primeiroArg = args[0];
```

## 🎨 Exemplos de Comandos

### Comando Simples

```javascript
import commandManager from "./index.js";

async function helloHandler({ sock, msg }) {
  const chatId = msg.key.remoteJid;
  
  await sock.sendMessage(chatId, {
    text: "👋 Olá! Como posso ajudar?",
  });
}

commandManager.register("hello", helloHandler, {
  description: "Saudação simples",
  usage: "!hello",
  category: "utilidade",
});

export default helloHandler;
```

### Comando com Argumentos

```javascript
import commandManager from "./index.js";

async function calcularHandler({ sock, msg, args }) {
  const chatId = msg.key.remoteJid;

  if (args.length < 2) {
    await sock.sendMessage(chatId, {
      text: "❌ Uso: !calcular numero1 numero2",
    });
    return;
  }

  const num1 = parseFloat(args[0]);
  const num2 = parseFloat(args[1]);

  if (isNaN(num1) || isNaN(num2)) {
    await sock.sendMessage(chatId, {
      text: "❌ Por favor, forneça números válidos!",
    });
    return;
  }

  const soma = num1 + num2;
  
  await sock.sendMessage(chatId, {
    text: `🧮 Resultado: ${num1} + ${num2} = ${soma}`,
  });
}

commandManager.register("calcular", calcularHandler, {
  description: "Soma dois números",
  usage: "!calcular <numero1> <numero2>",
  category: "utilidade",
});

export default calcularHandler;
```

### Comando com Subcomandos

```javascript
import commandManager from "./index.js";

async function adminHandler({ sock, msg, args }) {
  const chatId = msg.key.remoteJid;
  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "kick":
      await kickMembro(sock, chatId, args);
      break;

    case "promote":
      await promoverMembro(sock, chatId, args);
      break;

    default:
      await sock.sendMessage(chatId, {
        text: "❌ Subcomando inválido!\n\nUse:\n• !admin kick\n• !admin promote",
      });
      break;
  }
}

async function kickMembro(sock, chatId, args) {
  // Lógica para remover membro
  await sock.sendMessage(chatId, {
    text: "✅ Membro removido!",
  });
}

async function promoverMembro(sock, chatId, args) {
  // Lógica para promover membro
  await sock.sendMessage(chatId, {
    text: "✅ Membro promovido!",
  });
}

commandManager.register("admin", adminHandler, {
  description: "Comandos de administração",
  usage: "!admin <kick|promote>",
  category: "admin",
});

export default adminHandler;
```

## 📤 Enviando Diferentes Tipos de Mensagens

### Texto Simples

```javascript
await sock.sendMessage(chatId, {
  text: "Olá, mundo!",
});
```

### Texto Formatado (Markdown)

```javascript
await sock.sendMessage(chatId, {
  text: "*Negrito* _Itálico_ ~Riscado~ ```Código```",
});
```

### Mencionar Usuários

```javascript
const mentions = ["5511999999999@s.whatsapp.net"];

await sock.sendMessage(chatId, {
  text: "@5511999999999 Você foi mencionado!",
  mentions: mentions,
});
```

### Reagir a Mensagem

```javascript
await sock.sendMessage(chatId, {
  react: {
    text: "👍", // Emoji
    key: msg.key,
  },
});
```

### Responder Mensagem

```javascript
await sock.sendMessage(chatId, {
  text: "Esta é uma resposta!",
}, {
  quoted: msg,
});
```

### Enviar Arquivo

```javascript
import fs from "fs";

await sock.sendMessage(chatId, {
  document: fs.readFileSync("./arquivo.pdf"),
  mimetype: "application/pdf",
  fileName: "documento.pdf",
  caption: "📄 Aqui está o arquivo!",
});
```

### Enviar Imagem

```javascript
import fs from "fs";

await sock.sendMessage(chatId, {
  image: fs.readFileSync("./imagem.jpg"),
  caption: "🖼️ Confira esta imagem!",
});
```

## 🔒 Validações e Segurança

### Verificar se é Admin

```javascript
const isGroup = chatId.endsWith("@g.us");

if (!isGroup) {
  await sock.sendMessage(chatId, {
    text: "❌ Este comando só funciona em grupos!",
  });
  return;
}

const groupMetadata = await sock.groupMetadata(chatId);
const participants = groupMetadata.participants;

const sender = participants.find((p) => 
  p.id.replace(/[^0-9]/g, "").includes(senderNumber)
);

if (!sender || (sender.admin !== "admin" && sender.admin !== "superadmin")) {
  await sock.sendMessage(chatId, {
    text: "❌ Apenas administradores podem usar este comando!",
  });
  return;
}
```

### Lista de Usuários Permitidos

```javascript
const usuariosPermitidos = ["5511999999999", "5511888888888"];

if (!usuariosPermitidos.includes(senderNumber)) {
  await sock.sendMessage(chatId, {
    text: "❌ Você não tem permissão para usar este comando!",
  });
  return;
}
```

### Rate Limiting (Cooldown)

```javascript
const cooldowns = new Map();
const COOLDOWN_TIME = 5000; // 5 segundos

const now = Date.now();
const lastUsed = cooldowns.get(senderNumber);

if (lastUsed && now - lastUsed < COOLDOWN_TIME) {
  const timeLeft = Math.ceil((COOLDOWN_TIME - (now - lastUsed)) / 1000);
  await sock.sendMessage(chatId, {
    text: `⏳ Aguarde ${timeLeft} segundos para usar este comando novamente.`,
  });
  return;
}

cooldowns.set(senderNumber, now);
```

## 🛠️ Utilitários Disponíveis

### Logger

```javascript
import logger from "../utils/logger.js";

logger.info("Mensagem informativa");
logger.warn("Mensagem de aviso");
logger.error("Mensagem de erro");
logger.success("Mensagem de sucesso");
```

### Command Manager

```javascript
import commandManager from "./index.js";

// Registrar comando
commandManager.register("nome", handler, options);

// Buscar comando
const comando = commandManager.get("nome");

// Listar todos os comandos
const todosComandos = commandManager.list();

// Listar por categoria
const comandosUtilidade = commandManager.listByCategory("utilidade");
```

## 📋 Categorias Sugeridas

- `utilidade` - Comandos gerais e úteis
- `grupos` - Gerenciamento de grupos
- `admin` - Comandos administrativos
- `diversao` - Comandos de entretenimento
- `informacao` - Comandos informativos
- `ferramentas` - Ferramentas e utilitários

## ⚡ Boas Práticas

1. **Sempre valide os argumentos**
   ```javascript
   if (args.length < 1) {
     await sock.sendMessage(chatId, {
       text: "❌ Argumentos insuficientes!",
     });
     return;
   }
   ```

2. **Use try-catch para erros**
   ```javascript
   try {
     // Código que pode falhar
   } catch (error) {
     logger.error("Erro no comando:", error);
     await sock.sendMessage(chatId, {
       text: `❌ Erro: ${error.message}`,
     });
   }
   ```

3. **Logue ações importantes**
   ```javascript
   logger.info(`Comando executado por ${senderName}`);
   ```

4. **Forneça feedback ao usuário**
   ```javascript
   await sock.sendMessage(chatId, {
     text: "⏳ Processando...",
   });
   ```

5. **Use emojis para melhor UX**
   ```javascript
   ✅ ❌ ⚠️ 💡 📊 🔍 ⏳ 🚀 📁 📝
   ```

## 🧪 Testando Comandos

1. Reinicie o bot após criar o comando
2. Envie o comando no WhatsApp: `!seucomando`
3. Verifique os logs para debug
4. Teste casos extremos e erros

## 📖 Exemplos Completos

Consulte os comandos existentes para referência:
- `ping.command.js` - Comando simples
- `info.command.js` - Comando com dados do sistema
- `grupos.command.js` - Comando complexo com subcomandos
- `adicionar.command.js` - Comando com validações extensas

## 💡 Dicas

- Use `!ajuda` no WhatsApp para ver todos os comandos
- Cada comando aparece automaticamente no `!ajuda`
- O prefixo padrão é `!`, configurável em `index.js`
- Comandos são case-insensitive (não diferenciam maiúsculas/minúsculas)

## 🤝 Contribuindo

Ao criar novos comandos:
1. Siga o padrão de nomenclatura: `nome.command.js`
2. Documente seu código com comentários
3. Adicione ao `loader.js`
4. Teste antes de commitar
5. Atualize este README se necessário

---

**Dúvidas?** Consulte os exemplos ou abra uma issue! 🚀

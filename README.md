# 🤖 WhatsApp Bot

Bot profissional para WhatsApp usando Baileys.

## 📁 Estrutura do Projeto

```
bot/
├── src/
│   ├── commands/            # 🎯 Comandos do bot
│   │   ├── index.js         # Gerenciador de comandos
│   │   ├── loader.js        # Carregador de comandos
│   │   ├── ping.command.js  # Comando de teste
│   │   ├── ajuda.command.js # Comando de ajuda
│   │   ├── info.command.js  # Informações do bot
│   │   ├── grupos.command.js # Gerenciamento de grupos
│   │   └── adicionar.command.js # Adicionar membros
│   ├── config/              # ⚙️ Arquivos de configuração
│   │   └── whatsapp.config.js
│   ├── services/            # 🔧 Serviços principais
│   │   └── WhatsAppService.js
│   ├── utils/               # 🛠️ Utilitários
│   │   ├── logger.js
│   │   └── disconnectHandler.js
│   └── server.js            # 🚀 Servidor principal
├── sessions/                # 🔐 Sessões do WhatsApp (gerado automaticamente)
├── logs/                    # 📝 Logs da aplicação
├── temp/                    # 📂 Arquivos temporários
├── .env.example             # 📋 Exemplo de variáveis de ambiente
├── .gitignore
├── package.json
└── README.md
```

## 🚀 Como Usar

### 1. Instalar Dependências

```bash
npm install
```

### 2. Iniciar o Bot

```bash
npm start
```

### 3. Escanear QR Code

Ao iniciar, um QR Code será exibido no terminal. Escaneie-o com seu WhatsApp.

## 📦 Dependências

- **@whiskeysockets/baileys**: Biblioteca principal para WhatsApp
- **@hapi/boom**: Gerenciamento de erros HTTP
- **pino**: Sistema de logs rápido
- **qrcode-terminal**: Exibição de QR Code no terminal
- **xlsx**: Exportação de dados para Excel

## 🎯 Comandos Disponíveis

### 📋 Utilidades
- **!ping** - Testa a latência do bot
- **!info** - Mostra informações do bot (uptime, memória, etc)
- **!ajuda** - Lista todos os comandos disponíveis

### 👥 Gerenciamento de Grupos
- **!grupos listar** - Lista todos os grupos
- **!grupos membros [id] [formato]** - Extrai membros em JSON/XLSX
- **!grupos info [id]** - Informações detalhadas do grupo

### ➕ Adicionar Membros
- **!adicionar listar** - Lista grupos onde você é admin
- **!adicionar membros ID@g.us numero1,numero2** - Adiciona membros

💡 Use `!ajuda` ou `!grupos` para ver detalhes de cada comando!

## ⚙️ Configuração

As configurações podem ser alteradas em `src/config/whatsapp.config.js`:

- **sessionPath**: Caminho para salvar a sessão
- **browser**: Informações do navegador
- **reconnect**: Configurações de reconexão
- **logging**: Nível de logs

## 📝 Logs

Os logs são salvos automaticamente na pasta `logs/` com o formato:
- `bot-YYYY-MM-DD.log`

## 🔒 Segurança

- A pasta `sessions/` contém informações sensíveis e está no `.gitignore`
- Nunca compartilhe ou faça commit dos arquivos de sessão

## 🛠️ Desenvolvimento

Para desenvolvimento com auto-reload (Node.js 18+):

```bash
npm run dev
```

## 📄 Licença

ISC

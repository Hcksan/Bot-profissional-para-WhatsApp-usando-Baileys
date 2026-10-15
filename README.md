# 🤖 CRM Pessoal para WhatsApp

CRM pessoal que roda no seu computador e conecta no **seu WhatsApp** (como um "aparelho conectado", igual ao WhatsApp Web), com painel web:

- **Kanban** de contatos com arrastar e soltar (etapas personalizáveis)
- **Agendador** de mensagens (uma vez, diária, semanal ou mensal)
- **Importação/exportação** de listas em Excel ou CSV (gerado no seu PC, nada vai para servidor de terceiros)
- **Campanhas ("acionar clientes")**: envia uma mensagem para vários contatos, um de cada vez, com
  - intervalo aleatório entre envios e pausa longa a cada X mensagens
  - "digitando..." antes de cada mensagem
  - variáveis (`{nome}`, `{primeiro_nome}`) e variações de texto (`{Oi|Olá|E aí}`)
  - janela de horário e limite diário
  - pausa automática se o WhatsApp aplicar bloqueio temporário
  - quem responder **"sair"** / **"parar"** sai automaticamente das campanhas
  - move o card no Kanban depois do envio e quando a pessoa responde
- **Histórico** das conversas com cada contato
- Os comandos antigos (`!ping`, `!grupos`, `!adicionar`...) continuam funcionando, mas **só quando enviados por você**

> ⚠️ Usa a conexão não oficial do WhatsApp Web (biblioteca Baileys). O WhatsApp pode restringir números que enviam
> muitas mensagens para quem não conhece você. Leia [Boas práticas](#-boas-práticas-para-não-ter-o-número-restringido).

## 🪟 Instalação no Windows

1. Instale o **Node.js 22 LTS** (ou mais novo): https://nodejs.org → botão "LTS". Na instalação, deixe tudo marcado.
2. Baixe este projeto (botão **Code → Download ZIP** no GitHub) e extraia, ou use `git clone`.
3. Abra a pasta do projeto, clique na barra de endereço do Explorer, digite `cmd` e Enter. No terminal:

```bash
npm install
copy .env.example .env
```

4. Abra o arquivo `.env` no Bloco de Notas e defina sua senha do painel:

```
CRM_PASSWORD="uma-senha-forte-aqui"
```

5. Inicie:

```bash
npm start
```

6. Abra **http://localhost:3000** no navegador, entre com a senha e vá na aba **WhatsApp**.
7. No celular: WhatsApp → **Aparelhos conectados** → **Conectar um aparelho** → leia o QR Code.

Pronto. Você continua usando o WhatsApp normalmente no celular. Para parar o CRM, feche o terminal ou aperte `Ctrl + C`
(isso **não** desconecta o aparelho; na próxima vez ele entra direto).

> Na primeira vez, o Windows pode perguntar se o Node.js pode acessar a rede. Permita em **redes privadas**
> para conseguir abrir o painel pelo celular.

## 🌐 Acessar pelo celular ou de outro lugar

**Na mesma rede Wi-Fi:** ao iniciar, o terminal mostra um endereço como `http://192.168.0.10:3000`. Abra no navegador do celular.

**De qualquer lugar (internet):** a forma mais simples e segura é o **Cloudflare Tunnel**, que cria um endereço `https://`
sem abrir portas no seu roteador:

```bash
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

Ele mostra um endereço `https://....trycloudflare.com`. Quando usar HTTPS, coloque `COOKIE_SECURE="true"` no `.env`.
Use sempre uma senha forte em `CRM_PASSWORD`.

> O CRM precisa estar rodando no seu computador para enviar as mensagens agendadas e as campanhas. Se quiser que
> funcione 24h, dá para instalar o mesmo projeto num servidor (VPS) com Node.js 22.

## 🚀 Produção (VM Ubuntu/Debian + Nginx + Cloudflare)

Um comando instala tudo na VM: usuário de sistema próprio (`crm`, sem root), serviço no systemd com isolamento,
site no Nginx para o domínio, backup diário do banco e uma senha forte gerada na hora.

```bash
# Na VM, como root:
curl -fsSL https://raw.githubusercontent.com/Hcksan/Bot-profissional-para-WhatsApp-usando-Baileys/main/deploy/install.sh -o install-crm.sh
sudo bash install-crm.sh
```

Padrões (mude com variáveis antes do comando, ex.: `sudo DOMAIN=crm.exemplo.com bash install-crm.sh`):

| Variável | Padrão |
|---|---|
| `DOMAIN` | `crm.promocoesbrasil.com.br` |
| `PORT` | `3900` (só em `127.0.0.1`; o público entra pelo Nginx) |
| `APP_DIR` | `/opt/crm` |
| `SSL_CERT` / `SSL_KEY` | `/etc/ssl/promocoesbrasil/origin.crt` / `.key` (certificado de origem da Cloudflare) |

Depois, na **Cloudflare → DNS**, crie: tipo `A`, nome `crm`, conteúdo = IP da VM, **proxy ligado (nuvem laranja)**.
O script mostra o IP no final. Então abra `https://crm.promocoesbrasil.com.br`, entre com a senha e leia o QR Code.

O que a instalação protege:

- A VM só aceita acesso ao painel vindo da Cloudflare (acesso direto pelo IP recebe 403)
- O CRM escuta só em `127.0.0.1`; roda como usuário `crm`, sem permissão de escrever fora das próprias pastas
- `.env` com permissão 600 e pastas `data/` e `sessions/` com permissão 700
- Limite de tentativas de login no Nginx e no CRM; IP real do visitante vindo da Cloudflare (não dá para falsificar)
- Cookie `__Host-` com `Secure`, `HttpOnly` e `SameSite`; bloqueio de ações vindas de outros sites; CSP e HSTS

No dia a dia:

```bash
journalctl -u crm -f                    # logs ao vivo
systemctl restart crm                   # reiniciar (não desconecta o WhatsApp)
sudo bash /opt/crm/deploy/update.sh     # atualizar para a versão mais nova do GitHub (faz backup antes)
nano /opt/crm/.env && systemctl restart crm   # trocar a senha (encerra todas as sessões abertas)
```

Backups diários ficam em `/opt/crm/data/backups/` (últimos 14 dias).

## ⚙️ Configuração (`.env`)

| Variável | Padrão | Para que serve |
|---|---|---|
| `NODE_ENV` | `development` | `production` exige senha forte (12+ caracteres) |
| `CRM_PASSWORD` | (gerada) | Senha do painel. Se vazia, uma senha aleatória é criada e mostrada no terminal. Trocar encerra todas as sessões |
| `PUBLIC_URL` | (vazio) | Endereço público, ex.: `https://crm.promocoesbrasil.com.br` |
| `TRUST_PROXY` | `loopback` | Proxies confiáveis para descobrir o IP do visitante |
| `PORT` | `3000` | Porta do painel |
| `HOST` | `0.0.0.0` | `0.0.0.0` libera para outros aparelhos da rede; `127.0.0.1` deixa só neste PC |
| `COOKIE_SECURE` | `false` | `true` quando o painel for acessado por HTTPS |
| `DATA_DIR` | `./data` | Onde fica o banco de dados (contatos, mensagens, campanhas) |
| `COMMANDS_ENABLED` | `true` | Liga/desliga os comandos `!` no chat |

O limite diário de campanhas e as palavras de "sair" ficam na aba **Configurações** do painel.

## 📣 Como funciona uma campanha

1. Em **Contatos**, importe uma planilha ou cadastre os contatos (use tags para separar listas).
2. Em **Campanhas → Nova campanha**, escolha o público (selecionados, uma etapa ou uma tag) e escreva a mensagem.
   Ex.: `{Oi|Olá} {primeiro_nome}, tudo bem? {Passando|Vim} para avisar que...`
3. Ajuste o ritmo (padrão: 45 a 120 s entre mensagens, pausa de 10 min a cada 10 envios, das 08:00 às 20:00).
4. Clique em **Iniciar envio**. Dá para pausar, retomar ou cancelar a qualquer momento.

Antes de cada envio o CRM confere se o número tem WhatsApp (resolve sozinho a diferença do nono dígito),
mostra "digitando..." por alguns segundos e só então envia.

## 🛡️ Boas práticas para não ter o número restringido

- Envie só para quem conhece você e tem seu número salvo.
- Comece com um limite diário baixo (30 a 50) e aumente aos poucos.
- Use intervalos longos e varie o texto com `{opção1|opção2}`.
- Evite links na primeira mensagem para quem nunca falou com você.
- O que mais causa restrição é **gente bloqueando ou denunciando** seu número. Nenhum intervalo evita isso.
- Na aba **WhatsApp** aparece a cota de novas conversas informada pelo próprio WhatsApp e se há bloqueio temporário.

## 📁 Estrutura do Projeto

```
├── public/                    # 🖥️ Painel web (HTML/CSS/JS, sem etapa de build)
├── src/
│   ├── commands/              # 🎯 Comandos "!" do chat
│   ├── config/                # ⚙️ Configurações (WhatsApp e painel)
│   ├── crm/
│   │   ├── CrmStore.js        # Banco de dados (contatos, etapas, campanhas, agendamentos)
│   │   ├── CrmService.js      # Envio para contatos e reação às respostas
│   │   ├── CampaignRunner.js  # Motor das campanhas
│   │   ├── Scheduler.js       # Agendador
│   │   └── spreadsheet.js     # Importar/exportar Excel e CSV
│   ├── db/database.js         # SQLite (nativo do Node.js) e migrações
│   ├── services/WhatsAppService.js  # Conexão Baileys
│   ├── web/                   # API, login e servidor do painel
│   └── server.js              # 🚀 Inicializa tudo
├── test/                      # Testes automatizados (npm test)
├── data/                      # 🔐 Banco de dados (gerado, fora do git)
└── sessions/                  # 🔐 Sessão do WhatsApp (gerado, fora do git)
```

## 🎯 Comandos no chat

Funcionam quando **você** envia a mensagem (de qualquer conversa):

- **!ping** - Testa a latência
- **!info** - Informações do bot (uptime, memória)
- **!ajuda** - Lista os comandos
- **!grupos listar** / **!grupos membros [id] [formato]** / **!grupos info [id]**
- **!adicionar listar** / **!adicionar membros ID@g.us numero1,numero2**

## 🔒 Segurança e privacidade

- Tudo fica no seu computador: `data/` (contatos e mensagens) e `sessions/` (login do WhatsApp). As duas pastas estão no `.gitignore`.
- **Nunca compartilhe a pasta `sessions/`**: com ela, qualquer pessoa usa seu WhatsApp.
- Painel protegido por senha, sessão em cookie `HttpOnly` e bloqueio após 5 tentativas erradas (por IP) ou 30 no total em 15 minutos.
- Dá para ficar logado em **vários aparelhos ao mesmo tempo** (PC, celular...). Em **Configurações → Aparelhos conectados**
  você vê cada um (navegador, IP, último acesso) e pode encerrar um ou todos os outros.
- Para trocar de número ou "deslogar", use **WhatsApp → Desconectar aparelho** no painel.

## 🛠️ Desenvolvimento

```bash
npm run dev   # reinicia sozinho ao salvar arquivos (Windows/macOS)
npm test      # testes automatizados
```

Requer Node.js 22.13 ou mais novo (usa o SQLite nativo do Node, sem compilar nada no Windows).

## 📄 Licença

ISC

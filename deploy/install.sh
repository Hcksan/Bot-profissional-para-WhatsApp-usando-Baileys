#!/usr/bin/env bash
#
# Instala (ou reinstala) o CRM Pessoal numa VM Ubuntu/Debian, atrás do Nginx + Cloudflare.
#
# Uso, na VM, como root:
#
#   curl -fsSL https://raw.githubusercontent.com/Hcksan/Bot-profissional-para-WhatsApp-usando-Baileys/main/deploy/install.sh -o install-crm.sh
#   sudo bash install-crm.sh
#
# Variáveis opcionais (valores padrão entre parênteses):
#   DOMAIN   (crm.promocoesbrasil.com.br)   endereço do painel
#   PORT     (3900)                          porta interna, só em 127.0.0.1
#   APP_DIR  (/opt/crm)                      pasta da instalação
#   BRANCH   (main)                          branch do GitHub
#   SSL_CERT / SSL_KEY                       certificado de origem da Cloudflare
#                                            (/etc/ssl/promocoesbrasil/origin.crt e .key)
#
# Pode rodar de novo quando quiser: não apaga dados, sessão do WhatsApp nem a senha.
set -euo pipefail

DOMAIN="${DOMAIN:-crm.promocoesbrasil.com.br}"
PORT="${PORT:-3900}"
APP_DIR="${APP_DIR:-/opt/crm}"
APP_USER="${APP_USER:-crm}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/Hcksan/Bot-profissional-para-WhatsApp-usando-Baileys.git}"
SSL_CERT="${SSL_CERT:-/etc/ssl/promocoesbrasil/origin.crt}"
SSL_KEY="${SSL_KEY:-/etc/ssl/promocoesbrasil/origin.key}"
NODE_MAJOR_MIN=22
NODE_MINOR_MIN=13

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m⚠️  %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

as_app() { runuser -u "$APP_USER" -- "$@"; }
# A dependência libsignal do Baileys vem do GitHub; força HTTPS (a VM não precisa de chave SSH do GitHub)
npm_as_app() {
  as_app env HOME="$APP_DIR" npm_config_cache="$APP_DIR/.npm" \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.https://github.com/.insteadOf" GIT_CONFIG_VALUE_0="ssh://git@github.com/" \
    npm "$@"
}

[ "$(id -u)" -eq 0 ] || die "Rode como root: sudo bash $0"
command -v apt-get >/dev/null || die "Este script é para Ubuntu/Debian (apt-get)."

# ───────────────────────── Pacotes ─────────────────────────
say "Conferindo pacotes do sistema (git, nginx, curl, openssl)..."
missing=()
for pkg in git nginx curl openssl; do command -v "$pkg" >/dev/null || missing+=("$pkg"); done
if [ "${#missing[@]}" -gt 0 ]; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}"
fi

# ───────────────────────── Node.js ─────────────────────────
say "Conferindo Node.js (precisa de ${NODE_MAJOR_MIN}.${NODE_MINOR_MIN} ou mais novo)..."
if ! command -v node >/dev/null; then
  say "Node.js não encontrado. Instalando Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi
NODE_BIN="$(command -v node)"
NODE_VERSION="$("$NODE_BIN" -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_MINOR="$(echo "$NODE_VERSION" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt "$NODE_MAJOR_MIN" ] || { [ "$NODE_MAJOR" -eq "$NODE_MAJOR_MIN" ] && [ "$NODE_MINOR" -lt "$NODE_MINOR_MIN" ]; }; then
  die "Node.js $NODE_VERSION é antigo demais (precisa de ${NODE_MAJOR_MIN}.${NODE_MINOR_MIN}+).
   Outros sistemas desta VM usam o mesmo Node, por isso não atualizo sozinho.
   Para atualizar: curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
   Depois confira os outros serviços (pm2 restart all) e rode este script de novo."
fi
echo "Node.js $NODE_VERSION em $NODE_BIN"

# ───────────────────────── Usuário e código ─────────────────────────
if ! id "$APP_USER" >/dev/null 2>&1; then
  say "Criando o usuário de sistema '$APP_USER' (o CRM não roda como root)..."
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

if [ -d "$APP_DIR/.git" ]; then
  say "Atualizando o código em $APP_DIR..."
  as_app git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  as_app git -C "$APP_DIR" checkout --quiet "$BRANCH"
  as_app git -C "$APP_DIR" merge --quiet --ff-only "origin/$BRANCH"
else
  [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ] && die "$APP_DIR já existe e não é uma instalação do CRM. Escolha outra pasta com APP_DIR=..."
  say "Baixando o código para $APP_DIR..."
  mkdir -p "$APP_DIR"
  chown "$APP_USER:$APP_USER" "$APP_DIR"
  as_app git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

say "Instalando dependências (versões travadas pelo package-lock.json)..."
(cd "$APP_DIR" && npm_as_app ci --omit=dev --no-audit --no-fund --loglevel=error)

for dir in data sessions logs; do
  mkdir -p "$APP_DIR/$dir"
  chown "$APP_USER:$APP_USER" "$APP_DIR/$dir"
  chmod 700 "$APP_DIR/$dir"
done

# ───────────────────────── Configuração (.env) ─────────────────────────
NEW_PASSWORD=""
if [ ! -f "$APP_DIR/.env" ]; then
  say "Criando $APP_DIR/.env com uma senha forte gerada agora..."
  NEW_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  cat > "$APP_DIR/.env" <<EOF
# Gerado por deploy/install.sh em $(date -Iseconds)
NODE_ENV="production"

# Senha do painel (mínimo de 12 caracteres em produção). Depois de trocar: systemctl restart crm
CRM_PASSWORD="$NEW_PASSWORD"

# Só o Nginx desta máquina acessa o CRM; o público entra por https://$DOMAIN
HOST="127.0.0.1"
PORT="$PORT"
PUBLIC_URL="https://$DOMAIN"
COOKIE_SECURE="true"
TRUST_PROXY="loopback"

DATA_DIR="./data"
COMMANDS_ENABLED="true"
EOF
else
  say "Mantendo o .env existente (senha e configurações atuais)."
fi
chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

# ───────────────────────── systemd ─────────────────────────
say "Instalando o serviço 'crm' no systemd..."
sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__APP_USER__#$APP_USER#g" -e "s#__NODE__#$NODE_BIN#g" \
  "$APP_DIR/deploy/crm.service" > /etc/systemd/system/crm.service
systemctl daemon-reload
systemctl enable --quiet crm
systemctl restart crm

# ───────────────────────── Nginx ─────────────────────────
say "Configurando o Nginx para $DOMAIN..."
mkdir -p /etc/nginx/snippets

if [ ! -f "$SSL_CERT" ] || [ ! -f "$SSL_KEY" ]; then
  warn "Certificado de origem não encontrado em $SSL_CERT. Gerando um autoassinado
   (funciona com a Cloudflare em SSL 'Full'; para 'Full (strict)' use um certificado de origem da Cloudflare)."
  SSL_CERT=/etc/ssl/crm/selfsigned.crt
  SSL_KEY=/etc/ssl/crm/selfsigned.key
  mkdir -p /etc/ssl/crm
  [ -f "$SSL_CERT" ] || openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -subj "/CN=$DOMAIN" \
    -keyout "$SSL_KEY" -out "$SSL_CERT" >/dev/null 2>&1
  chmod 600 "$SSL_KEY"
elif ! openssl x509 -in "$SSL_CERT" -noout -text | grep -Eq "DNS:(\*\.${DOMAIN#*.}|$DOMAIN)([,[:space:]]|$)"; then
  warn "O certificado $SSL_CERT não cobre $DOMAIN. Com SSL 'Full (strict)' na Cloudflare o acesso vai falhar (erro 526)."
fi

# Faixas de IP da Cloudflare (atualizadas na hora; se não der, usa a lista conhecida)
CF_IPS="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4 && echo && curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6)" || CF_IPS=""
if ! echo "$CF_IPS" | grep -q '/'; then
  warn "Não consegui baixar a lista de IPs da Cloudflare. Usando a lista embutida."
  CF_IPS="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18
190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14
172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32
2a06:98c0::/29 2c0f:f248::/32"
fi
{
  echo "# Faixas da Cloudflare (gerado por deploy/install.sh em $(date -Iseconds))"
  for cidr in $CF_IPS; do echo "set_real_ip_from $cidr;"; done
} > /etc/nginx/snippets/crm-cloudflare-ips.conf
{
  echo "# Faixas da Cloudflare (gerado por deploy/install.sh em $(date -Iseconds))"
  for cidr in $CF_IPS; do echo "$cidr 1;"; done
} > /etc/nginx/snippets/crm-cloudflare-geo.conf

cat > /etc/nginx/snippets/crm-proxy.conf <<EOF
proxy_pass http://127.0.0.1:$PORT;
proxy_http_version 1.1;
proxy_set_header Host \$host;
proxy_set_header Upgrade \$http_upgrade;
proxy_set_header Connection \$crm_connection_upgrade;
# Depois do real_ip, \$remote_addr é o IP real do visitante; sobrescreve qualquer valor enviado por ele
proxy_set_header X-Forwarded-For \$remote_addr;
proxy_set_header X-Real-IP \$remote_addr;
proxy_set_header X-Forwarded-Proto https;
proxy_read_timeout 120s;
proxy_send_timeout 120s;
EOF

if [ -d /etc/nginx/sites-available ]; then
  NGINX_SITE=/etc/nginx/sites-available/crm.conf
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/crm.conf
else
  NGINX_SITE=/etc/nginx/conf.d/crm.conf
fi
sed -e "s#__DOMAIN__#$DOMAIN#g" -e "s#__PORT__#$PORT#g" -e "s#__SSL_CERT__#$SSL_CERT#g" -e "s#__SSL_KEY__#$SSL_KEY#g" \
  "$APP_DIR/deploy/nginx-crm.conf" > "$NGINX_SITE"
# VM sem IPv6: remove as linhas "listen [::]" (senão o Nginx não sobe)
if [ ! -s /proc/net/if_inet6 ]; then
  sed -i '/listen \[::\]/d' "$NGINX_SITE"
fi

if ! nginx -t 2>/tmp/crm-nginx-test.log; then
  cat /tmp/crm-nginx-test.log
  rm -f "$NGINX_SITE" /etc/nginx/sites-enabled/crm.conf
  die "A configuração do Nginx falhou no teste e foi removida (os outros sites continuam como estavam)."
fi
systemctl reload nginx

# ───────────────────────── Backup diário e limpeza de logs ─────────────────────────
say "Agendando backup diário do banco (mantém 14 dias) e limpeza de logs antigos..."
cat > /etc/cron.daily/crm-backup <<EOF
#!/bin/sh
runuser -u $APP_USER -- sh -c 'cd $APP_DIR && $NODE_BIN --disable-warning=ExperimentalWarning deploy/backup.mjs'
find $APP_DIR/logs -name '*.log' -mtime +30 -delete
EOF
chmod 755 /etc/cron.daily/crm-backup

# ───────────────────────── Conferência ─────────────────────────
say "Conferindo se o CRM respondeu..."
ok=0
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/session" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" -eq 1 ] || { journalctl -u crm -n 40 --no-pager; die "O CRM não respondeu na porta $PORT. Veja os logs acima."; }

PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org || echo 'IP_DA_VM')"

cat <<EOF

══════════════════════════════════════════════════════════════════════
 ✅ CRM instalado e rodando (serviço 'crm', usuário '$APP_USER', porta interna $PORT)

 Falta só o DNS na Cloudflare (uma vez):
   Tipo A   Nome: ${DOMAIN%%.*}   Conteúdo: $PUBLIC_IP   Proxy: LIGADO (nuvem laranja)

 Depois abra: https://$DOMAIN  → aba WhatsApp → leia o QR Code
EOF
if [ -n "$NEW_PASSWORD" ]; then
cat <<EOF

 🔑 Senha do painel: $NEW_PASSWORD
    (guarde num gerenciador de senhas; ela também está em $APP_DIR/.env)
EOF
fi
cat <<EOF

 Comandos úteis:
   journalctl -u crm -f              # logs ao vivo
   systemctl restart crm             # reiniciar (não desconecta o WhatsApp)
   sudo bash $APP_DIR/deploy/update.sh   # atualizar para a versão mais nova do GitHub
══════════════════════════════════════════════════════════════════════
EOF

#!/usr/bin/env bash
#
# Atualiza o CRM para a versão mais nova do GitHub (mantém dados, contas e sessão do WhatsApp).
# Uso, na VM:  sudo bash /opt/crm/deploy/update.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/crm}"
APP_USER="${APP_USER:-crm}"
BRANCH="${BRANCH:-main}"

[ "$(id -u)" -eq 0 ] || { echo "Rode como root: sudo bash $0" >&2; exit 1; }
cd "$APP_DIR"

echo "==> Backup do banco antes de atualizar..."
runuser -u "$APP_USER" -- node --disable-warning=ExperimentalWarning deploy/backup.mjs || true

echo "==> Baixando a versão mais nova ($BRANCH)..."
before="$(runuser -u "$APP_USER" -- git rev-parse --short HEAD)"
runuser -u "$APP_USER" -- git fetch --quiet origin "$BRANCH"
runuser -u "$APP_USER" -- git merge --quiet --ff-only "origin/$BRANCH"
after="$(runuser -u "$APP_USER" -- git rev-parse --short HEAD)"

if [ "$before" = "$after" ]; then
  echo "Já está na versão mais nova ($after)."
  exit 0
fi

echo "==> Instalando dependências..."
runuser -u "$APP_USER" -- env HOME="$APP_DIR" npm_config_cache="$APP_DIR/.npm" \
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.https://github.com/.insteadOf" GIT_CONFIG_VALUE_0="ssh://git@github.com/" \
  npm ci --omit=dev --no-audit --no-fund --loglevel=error

# Se o serviço ou a configuração do Nginx mudaram, o install.sh aplica de novo
echo "==> Reiniciando o CRM ($before → $after)..."
systemctl restart crm
sleep 3
systemctl --no-pager --lines=5 status crm
echo "Atualizado. Se a versão nova mudou o deploy/, rode também: sudo bash $APP_DIR/deploy/install.sh"

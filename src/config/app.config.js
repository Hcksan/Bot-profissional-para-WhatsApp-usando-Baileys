/**
 * Configurações do servidor web / CRM
 * Valores podem ser sobrescritos pelo arquivo .env
 */

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const appConfig = {
  // Endereço do painel web. 0.0.0.0 permite acessar de outros aparelhos da rede (ex.: celular no mesmo Wi-Fi)
  host: process.env.HOST || "0.0.0.0",
  port: toInt(process.env.PORT, 3000),

  // Senha de acesso ao painel. Se não for definida, uma senha aleatória é gerada e mostrada no terminal
  password: process.env.CRM_PASSWORD || "",

  // Use "true" quando o painel estiver atrás de HTTPS (ex.: Cloudflare Tunnel, Nginx com certificado)
  cookieSecure: process.env.COOKIE_SECURE === "true",
  sessionDays: toInt(process.env.SESSION_DAYS, 30),

  // Pasta do banco de dados SQLite
  dataDir: process.env.DATA_DIR || "./data",

  // Comandos "!" no chat. Só são aceitos quando enviados pelo próprio dono do número
  commandsEnabled: process.env.COMMANDS_ENABLED !== "false",
};

export default appConfig;

/**
 * Configurações do servidor web / CRM
 * Valores podem ser sobrescritos pelo arquivo .env
 */

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const production = process.env.NODE_ENV === "production";

export const appConfig = {
  // Em produção: senha obrigatória e forte, e o painel só aceita o próprio domínio
  production,

  // Endereço público do painel (ex.: https://crm.promocoesbrasil.com.br). Usado para validar a origem das requisições.
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),

  // Quais proxies são confiáveis para descobrir o IP real do visitante (Express "trust proxy").
  // "loopback" = só o Nginx rodando na mesma máquina.
  trustProxy: process.env.TRUST_PROXY || "loopback",

  // Endereço do painel web. 0.0.0.0 permite acessar de outros aparelhos da rede (ex.: celular no mesmo Wi-Fi)
  host: process.env.HOST || "0.0.0.0",
  port: toInt(process.env.PORT, 3000),

  // Código do primeiro acesso (cria a conta de e-mail e senha pelo painel). Se não for definido, um código aleatório
  // é gerado e mostrado no terminal. Depois que a conta existe, ele não serve mais para entrar
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

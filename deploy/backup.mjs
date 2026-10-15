/**
 * Backup dos bancos do CRM: o principal (data/crm.db, com as contas e o espaço 1) e o de cada espaço
 * (data/workspaces/ws-N.db). Cada um vira data/backups/<nome>-AAAA-MM-DD.db; ficam os últimos 14 de cada.
 * Usa "VACUUM INTO", que gera uma cópia consistente mesmo com o CRM rodando.
 *
 * Uso: node deploy/backup.mjs   (o install.sh agenda isso todo dia)
 */
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const KEEP = 14;
const dataDir = process.env.DATA_DIR || "./data";
const backupDir = path.join(dataDir, "backups");
const workspacesDir = path.join(dataDir, "workspaces");

const sources = [path.join(dataDir, "crm.db")];
if (fs.existsSync(workspacesDir)) {
  for (const name of fs.readdirSync(workspacesDir).sort()) {
    if (/^ws-\d+\.db$/.test(name)) sources.push(path.join(workspacesDir, name));
  }
}

const today = new Date().toISOString().slice(0, 10);
let saved = 0;

for (const source of sources) {
  if (!fs.existsSync(source)) {
    console.log(`Nada para copiar: ${source} não existe.`);
    continue;
  }
  const prefix = path.basename(source, ".db");
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const target = path.join(backupDir, `${prefix}-${today}.db`);
  fs.rmSync(target, { force: true });

  const db = new DatabaseSync(source, { readOnly: true });
  db.prepare("VACUUM INTO ?").run(target);
  db.close();
  fs.chmodSync(target, 0o600);
  saved++;

  const pattern = new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.db$`);
  const old = fs.readdirSync(backupDir).filter((name) => pattern.test(name)).sort().slice(0, -KEEP);
  old.forEach((name) => fs.rmSync(path.join(backupDir, name)));
  console.log(`Backup salvo em ${target}${old.length ? ` (${old.length} antigo(s) removido(s))` : ""}`);
}

if (!saved) console.log("Nenhum banco para copiar.");

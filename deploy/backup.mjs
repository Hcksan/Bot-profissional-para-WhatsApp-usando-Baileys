/**
 * Backup do banco do CRM: copia data/crm.db para data/backups/crm-AAAA-MM-DD.db e mantém os últimos 14.
 * Usa "VACUUM INTO", que gera uma cópia consistente mesmo com o CRM rodando.
 *
 * Uso: node deploy/backup.mjs   (o install.sh agenda isso todo dia)
 */
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const KEEP = 14;
const dataDir = process.env.DATA_DIR || "./data";
const source = path.join(dataDir, "crm.db");
const backupDir = path.join(dataDir, "backups");

if (!fs.existsSync(source)) {
  console.log(`Nada para copiar: ${source} não existe.`);
  process.exit(0);
}

fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const target = path.join(backupDir, `crm-${new Date().toISOString().slice(0, 10)}.db`);
fs.rmSync(target, { force: true });

const db = new DatabaseSync(source, { readOnly: true });
db.prepare("VACUUM INTO ?").run(target);
db.close();
fs.chmodSync(target, 0o600);

const old = fs
  .readdirSync(backupDir)
  .filter((name) => /^crm-\d{4}-\d{2}-\d{2}\.db$/.test(name))
  .sort()
  .slice(0, -KEEP);
old.forEach((name) => fs.rmSync(path.join(backupDir, name)));

console.log(`Backup salvo em ${target}${old.length ? ` (${old.length} antigo(s) removido(s))` : ""}`);

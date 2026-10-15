import XLSX from "xlsx";
import { badRequest } from "../utils/errors.js";
import { formatPhone } from "../utils/phone.js";

const MAX_ROWS = 20000;

// Nomes de coluna reconhecidos automaticamente (sem acento, minúsculo)
const COLUMN_HINTS = {
  phone: ["telefone", "celular", "whatsapp", "whats", "numero", "fone", "phone", "mobile", "tel", "contato"],
  name: ["nome", "name", "cliente", "nome completo", "razao social"],
  tags: ["tags", "tag", "etiquetas", "etiqueta", "grupo", "categoria", "segmento"],
  notes: ["observacoes", "observacao", "obs", "notas", "nota", "notes", "anotacoes"],
};

const simplify = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * .xlsx/.ods (zip) e .xls (OLE) são binários; o resto é tratado como texto (CSV)
 */
function isBinarySpreadsheet(buffer) {
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  return zip || ole;
}

/**
 * CSV salvo pelo Excel no Windows costuma vir em Windows-1252 (ANSI), não em UTF-8.
 * Tenta UTF-8 primeiro; se não for válido, usa Windows-1252 para manter os acentos.
 */
function decodeText(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/**
 * Lê uma planilha (.xlsx, .xls, .csv, .ods) enviada em base64
 * @returns {{ headers: string[], rows: object[] }}
 */
export function parseSpreadsheet(base64) {
  if (!base64) throw badRequest("Envie um arquivo");

  let workbook;
  try {
    const buffer = Buffer.from(base64, "base64");
    workbook = isBinarySpreadsheet(buffer)
      ? XLSX.read(buffer, { type: "buffer", raw: false })
      : XLSX.read(decodeText(buffer), { type: "string", raw: false });
  } catch {
    throw badRequest("Não foi possível ler o arquivo. Use .xlsx, .xls ou .csv");
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw badRequest("A planilha está vazia");

  // raw:false mantém números de telefone como texto (sem notação científica)
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  if (rows.length === 0) throw badRequest("A planilha está vazia");
  if (rows.length > MAX_ROWS) throw badRequest(`A planilha tem mais de ${MAX_ROWS} linhas`);

  const headers = Object.keys(rows[0]);
  return { headers, rows };
}

/**
 * Sugere qual coluna corresponde a cada campo
 */
export function guessMapping(headers) {
  const mapping = {};
  for (const [field, hints] of Object.entries(COLUMN_HINTS)) {
    const exact = headers.find((header) => hints.includes(simplify(header)));
    const partial = headers.find((header) => hints.some((hint) => simplify(header).includes(hint)));
    const match = exact ?? partial;
    if (match && !Object.values(mapping).includes(match)) mapping[field] = match;
  }
  return mapping;
}

/**
 * Aplica o mapeamento de colunas escolhido pelo usuário
 */
export function applyMapping(rows, mapping) {
  if (!mapping?.phone) throw badRequest("Escolha a coluna do telefone");
  const pick = (row, field) => (mapping[field] ? row[mapping[field]] : "");
  return rows.map((row) => ({
    phone: pick(row, "phone"),
    name: pick(row, "name"),
    tags: pick(row, "tags"),
    notes: pick(row, "notes"),
  }));
}

/**
 * Gera a planilha de contatos para download
 * @param {"xlsx"|"csv"} format
 */
export function exportContacts(contacts, stages, format = "xlsx") {
  const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));
  const date = (ms) => (ms ? new Date(ms).toLocaleString("pt-BR") : "");

  const data = contacts.map((contact) => ({
    Nome: contact.name,
    Telefone: contact.phone,
    "Telefone formatado": formatPhone(contact.phone),
    Etapa: stageNames.get(contact.stage_id) ?? "",
    Tags: contact.tags.join(", "),
    Observações: contact.notes,
    "Não quer receber": contact.opted_out ? "Sim" : "",
    "Última mensagem recebida": date(contact.last_inbound_at),
    "Última mensagem enviada": date(contact.last_outbound_at),
    "Criado em": date(contact.created_at),
  }));

  const sheet = XLSX.utils.json_to_sheet(data);
  sheet["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 24 }, { wch: 40 }];

  if (format === "csv") {
    // BOM para o Excel no Windows abrir os acentos corretamente
    return Buffer.from(`﻿${XLSX.utils.sheet_to_csv(sheet, { FS: ";" })}`, "utf8");
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Contatos");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export default { parseSpreadsheet, guessMapping, applyMapping, exportContacts };

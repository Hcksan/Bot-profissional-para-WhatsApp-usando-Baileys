/**
 * Utilitários de telefone (foco em números brasileiros)
 */

/**
 * Normaliza um telefone para o formato internacional só com dígitos (ex.: 5511987654321)
 * - "(11) 98765-4321"     -> "5511987654321"
 * - "+55 11 98765-4321"   -> "5511987654321"
 * - "011 98765-4321"      -> "5511987654321"
 * - "+1 415 555 0100"     -> "14155550100"
 * @param {string|number} input
 * @returns {string|null} Número normalizado ou null se inválido
 */
export function normalizePhone(input) {
  if (input === null || input === undefined) return null;

  const raw = String(input).trim();
  const international = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");

  if (raw.startsWith("00")) digits = digits.slice(2);
  if (!digits) return null;

  if (!international) {
    // Remove zero de operadora/DDD (ex.: 011...)
    digits = digits.replace(/^0+/, "");

    // Sem DDD não dá para saber a cidade
    if (digits.length < 10) return null;

    // DDD + número (10 ou 11 dígitos) => Brasil
    if (digits.length === 10 || digits.length === 11) {
      digits = `55${digits}`;
    }
  }

  if (digits.length < 8 || digits.length > 15) return null;

  // Número brasileiro precisa ter DDD + 8 ou 9 dígitos
  if (digits.startsWith("55") && !international && digits.length !== 12 && digits.length !== 13) {
    return null;
  }

  return digits;
}

/**
 * Variações de um mesmo número brasileiro com e sem o nono dígito.
 * O WhatsApp ainda usa o formato antigo (sem o 9) em contas mais antigas.
 * @param {string} phone - Número normalizado
 * @returns {string[]}
 */
export function phoneVariants(phone) {
  if (!phone) return [];
  const variants = new Set([phone]);

  if (phone.startsWith("55")) {
    const ddd = phone.slice(2, 4);
    const rest = phone.slice(4);

    if (rest.length === 9 && rest.startsWith("9")) {
      variants.add(`55${ddd}${rest.slice(1)}`);
    } else if (rest.length === 8 && /^[6-9]/.test(rest)) {
      variants.add(`55${ddd}9${rest}`);
    }
  }

  return [...variants];
}

/**
 * Formata para exibição: 5511987654321 -> +55 (11) 98765-4321
 */
export function formatPhone(phone) {
  if (!phone) return "";
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);
  if (match) return `+55 (${match[1]}) ${match[2]}-${match[3]}`;
  return `+${phone}`;
}

/**
 * Extrai os dígitos de um JID (5511987654321@s.whatsapp.net ou 5511987654321:12@s.whatsapp.net)
 */
export function phoneFromJid(jid) {
  if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;
  return jid.split("@")[0].split(":")[0];
}

export default { normalizePhone, phoneVariants, formatPhone, phoneFromJid };

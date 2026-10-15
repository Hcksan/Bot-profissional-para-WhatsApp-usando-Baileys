/**
 * Modelos de mensagem
 *
 * Variáveis:  {nome}, {primeiro_nome}, {telefone}
 * Variações:  {Olá|Oi|E aí}  -> escolhe uma opção aleatória a cada envio
 */

const VARIABLE = /\{(nome|primeiro_nome|telefone)\}/gi;
const SPIN = /\{([^{}]*\|[^{}]*)\}/g;

/**
 * Monta a mensagem final para um contato
 * @param {string} template
 * @param {{ name?: string, phone?: string }} contact
 * @param {() => number} random - Gerador de números aleatórios (injetável para testes)
 */
export function renderTemplate(template, contact = {}, random = Math.random) {
  const name = (contact.name || "").trim();
  const firstName = name.split(/\s+/)[0] || "";

  const values = {
    nome: name,
    primeiro_nome: firstName,
    telefone: contact.phone || "",
  };

  let text = String(template).replace(VARIABLE, (_, key) => values[key.toLowerCase()]);

  // Resolve variações de dentro para fora (permite {a|{b|c}})
  let previous;
  do {
    previous = text;
    text = text.replace(SPIN, (_, options) => {
      const choices = options.split("|");
      return choices[Math.floor(random() * choices.length)] ?? "";
    });
  } while (text !== previous);

  // Limpa espaços que sobram quando o nome está vazio (ex.: "Oi , tudo bem?")
  return text
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export default { renderTemplate };

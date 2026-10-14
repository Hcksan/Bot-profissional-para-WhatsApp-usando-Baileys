import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, phoneVariants, formatPhone, phoneFromJid } from "../src/utils/phone.js";
import { renderTemplate } from "../src/utils/template.js";
import { isWithinWindow, nextOccurrence, nextWindowStart, randomInt, typingDurationMs } from "../src/utils/time.js";

test("normalizePhone aceita formatos brasileiros comuns", () => {
  assert.equal(normalizePhone("(11) 98765-4321"), "5511987654321");
  assert.equal(normalizePhone("+55 11 98765-4321"), "5511987654321");
  assert.equal(normalizePhone("011 98765-4321"), "5511987654321");
  assert.equal(normalizePhone("11 3456-7890"), "551134567890");
  assert.equal(normalizePhone(5511987654321), "5511987654321");
  assert.equal(normalizePhone("5511987654321"), "5511987654321");
});

test("normalizePhone aceita números internacionais com +", () => {
  assert.equal(normalizePhone("+1 415 555 0100"), "14155550100");
  assert.equal(normalizePhone("00351 912 345 678"), "351912345678");
});

test("normalizePhone rejeita valores inválidos", () => {
  for (const value of ["", null, undefined, "abc", "123", "98765-4321", "55119876543210"]) {
    assert.equal(normalizePhone(value), null, `deveria rejeitar ${value}`);
  }
});

test("phoneVariants gera a versão com e sem o nono dígito", () => {
  assert.deepEqual(phoneVariants("5511987654321").sort(), ["551187654321", "5511987654321"].sort());
  assert.deepEqual(phoneVariants("551187654321").sort(), ["551187654321", "5511987654321"].sort());
  // Fixo não ganha nono dígito
  assert.deepEqual(phoneVariants("551134567890"), ["551134567890"]);
  assert.deepEqual(phoneVariants("14155550100"), ["14155550100"]);
});

test("formatPhone e phoneFromJid", () => {
  assert.equal(formatPhone("5511987654321"), "+55 (11) 98765-4321");
  assert.equal(phoneFromJid("5511987654321:12@s.whatsapp.net"), "5511987654321");
  assert.equal(phoneFromJid("123456789@lid"), null);
  assert.equal(phoneFromJid("120363@g.us"), null);
});

test("renderTemplate preenche variáveis e escolhe variações", () => {
  const contact = { name: "Maria Silva", phone: "5511987654321" };
  assert.equal(renderTemplate("Oi {primeiro_nome}! ({nome})", contact), "Oi Maria! (Maria Silva)");
  assert.equal(renderTemplate("{Oi|Olá|E aí} {primeiro_nome}", contact, () => 0), "Oi Maria");
  assert.equal(renderTemplate("{Oi|Olá|E aí} {primeiro_nome}", contact, () => 0.99), "E aí Maria");
  assert.equal(renderTemplate("{a|{b|c}}", contact, () => 0.99), "c");
  // Sem nome, não sobra espaço antes da pontuação
  assert.equal(renderTemplate("Oi {primeiro_nome}, tudo bem?", { name: "" }), "Oi, tudo bem?");
  // Chaves comuns (sem |) ficam como estão
  assert.equal(renderTemplate("Código {ABC}", contact), "Código {ABC}");
});

test("randomInt e typingDurationMs ficam dentro dos limites", () => {
  for (let i = 0; i < 200; i++) {
    const value = randomInt(45, 120);
    assert.ok(value >= 45 && value <= 120);
  }
  assert.equal(typingDurationMs("oi", () => 0), 2000);
  assert.equal(typingDurationMs("x".repeat(5000), () => 1), 12000);
});

test("isWithinWindow respeita a janela de horário", () => {
  const at = (hours, minutes = 0) => new Date(2026, 9, 14, hours, minutes);
  assert.equal(isWithinWindow(at(8), "08:00", "20:00"), true);
  assert.equal(isWithinWindow(at(19, 59), "08:00", "20:00"), true);
  assert.equal(isWithinWindow(at(20), "08:00", "20:00"), false);
  assert.equal(isWithinWindow(at(7, 59), "08:00", "20:00"), false);
  // Janela que vira a noite
  assert.equal(isWithinWindow(at(23), "22:00", "06:00"), true);
  assert.equal(isWithinWindow(at(5), "22:00", "06:00"), true);
  assert.equal(isWithinWindow(at(12), "22:00", "06:00"), false);
  // Início = fim => dia todo
  assert.equal(isWithinWindow(at(3), "00:00", "00:00"), true);
});

test("nextWindowStart aponta para a próxima abertura", () => {
  const evening = new Date(2026, 9, 14, 21, 0);
  assert.equal(nextWindowStart(evening, "08:00"), new Date(2026, 9, 15, 8, 0).getTime());
  const early = new Date(2026, 9, 14, 6, 0);
  assert.equal(nextWindowStart(early, "08:00"), new Date(2026, 9, 14, 8, 0).getTime());
});

test("nextOccurrence calcula recorrências sem disparar em sequência", () => {
  const base = new Date(2026, 0, 31, 9, 0).getTime();
  assert.equal(nextOccurrence(base, "none", base), null);
  assert.equal(nextOccurrence(base, "daily", base), new Date(2026, 1, 1, 9, 0).getTime());
  assert.equal(nextOccurrence(base, "weekly", base), new Date(2026, 1, 7, 9, 0).getTime());
  // 31/jan -> 28/fev -> 31/mar (mantém o dia original)
  assert.equal(nextOccurrence(base, "monthly", base), new Date(2026, 1, 28, 9, 0).getTime());
  assert.equal(nextOccurrence(base, "monthly", new Date(2026, 1, 28, 10, 0).getTime()), new Date(2026, 2, 31, 9, 0).getTime());
  // Computador ficou desligado 10 dias: pula para a próxima data futura
  const later = new Date(2026, 1, 10, 12, 0).getTime();
  assert.equal(nextOccurrence(base, "daily", later), new Date(2026, 1, 11, 9, 0).getTime());
});

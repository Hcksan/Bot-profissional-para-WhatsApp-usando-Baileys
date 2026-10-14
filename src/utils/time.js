/**
 * Utilitários de data/hora (sempre no fuso horário do computador onde o CRM roda)
 */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Inteiro aleatório entre min e max (inclusive)
 */
export function randomInt(min, max, random = Math.random) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.floor(random() * (high - low + 1));
}

/**
 * Tempo de "digitando..." proporcional ao tamanho do texto (entre 2 e 12 segundos)
 */
export function typingDurationMs(text, random = Math.random) {
  const perChar = 35 + random() * 25;
  return Math.round(Math.min(12000, Math.max(2000, String(text).length * perChar)));
}

/**
 * Converte "HH:MM" em minutos desde a meia-noite
 */
export function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Verifica se o horário está dentro da janela permitida.
 * Suporta janelas que viram a noite (ex.: 22:00 até 06:00).
 * Janela com início igual ao fim = o dia inteiro.
 */
export function isWithinWindow(date, start, end) {
  const from = parseClock(start);
  const to = parseClock(end);
  if (from === null || to === null || from === to) return true;

  const now = date.getHours() * 60 + date.getMinutes();
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/**
 * Próximo momento em que a janela abre (em ms)
 */
export function nextWindowStart(date, start) {
  const from = parseClock(start) ?? 0;
  const next = new Date(date);
  next.setHours(Math.floor(from / 60), from % 60, 0, 0);
  if (next <= date) next.setDate(next.getDate() + 1);
  return next.getTime();
}

/**
 * Início do dia (meia-noite local) em ms
 */
export function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Próxima ocorrência de um agendamento recorrente, sempre no futuro em relação a "now"
 * (se o computador ficou desligado, não dispara várias vezes seguidas)
 */
export function nextOccurrence(sendAt, recurrence, now) {
  if (recurrence === "none") return null;

  const date = new Date(sendAt);
  const dayOfMonth = date.getDate();

  while (date.getTime() <= now) {
    if (recurrence === "daily") date.setDate(date.getDate() + 1);
    else if (recurrence === "weekly") date.setDate(date.getDate() + 7);
    else if (recurrence === "monthly") {
      // Mantém o dia original; em meses mais curtos usa o último dia (ex.: 31 -> 30/28)
      date.setDate(1);
      date.setMonth(date.getMonth() + 1);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      date.setDate(Math.min(dayOfMonth, lastDay));
    } else {
      throw new Error(`Recorrência inválida: ${recurrence}`);
    }
  }

  return date.getTime();
}

export default { sleep, randomInt, typingDurationMs, parseClock, isWithinWindow, nextWindowStart, startOfDay, nextOccurrence };

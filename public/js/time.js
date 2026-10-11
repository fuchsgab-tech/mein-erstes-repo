// Datum- und Zeit-Helfer. Diese Datei läuft im Browser UND auf dem Server.

export const pad = (n) => String(n).padStart(2, '0');

// ---------- Kalendertage ('YYYY-MM-DD') ----------

export function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
}

export function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// Woche beginnt am Montag
export function startOfWeek(d) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}

// Kalenderwoche nach ISO 8601 (wie in Deutschland üblich)
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - firstThursday) / 864e5 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Anzahl Kalendertage von a bis b (unabhängig von Sommerzeit)
export function daysBetween(a, b) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 864e5);
}

// ---------- Tagesnummern (für Wiederholungen, ohne Zeitzonen) ----------

export const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);

export function fromDayNum(n) {
  const dt = new Date(n * 864e5);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// 0 = Montag … 6 = Sonntag
export const weekdayOf = (n) => (new Date(n * 864e5).getUTCDay() + 6) % 7;

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ---------- Zeitzonen ----------

const dtfCache = new Map();

function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    dtf(tz);
    return true;
  } catch {
    return false;
  }
}

export function localTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Uhrzeit, die man in Zeitzone tz an der Wand sieht
export function wallParts(ts, tz) {
  const p = {};
  for (const { type, value } of dtf(tz).formatToParts(new Date(ts))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

function tzOffset(ts, tz) {
  const p = wallParts(ts, tz);
  const secTs = ts - (((ts % 1000) + 1000) % 1000);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - secTs;
}

// Wanduhrzeit in Zeitzone tz -> Zeitstempel (ms)
export function zonedToUtc(y, m, d, h = 0, mi = 0, s = 0, tz) {
  if (!tz) return new Date(y, m - 1, d, h, mi, s).getTime();
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  const o1 = tzOffset(guess, tz);
  let ts = guess - o1;
  const o2 = tzOffset(ts, tz);
  if (o2 !== o1) ts = guess - o2;
  return ts;
}

// Wiederkehrende Termine (RRULE nach RFC 5545, die gängigen Teile davon).
import {
  addDays, dayNum, daysBetween, daysInMonth, fromDayNum, isValidTz, localTz,
  parseYmd, startOfDay, wallParts, weekdayOf, ymd, zonedToUtc,
} from './time.js';

const WD = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function parseByday(s) {
  const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(s.trim());
  if (!m) return null;
  return { n: m[1] ? parseInt(m[1], 10) : 0, wd: WD.indexOf(m[2].toUpperCase()) };
}

export function parseRrule(str) {
  if (!str || typeof str !== 'string') return null;
  const r = {};
  for (const part of str.replace(/^RRULE:/i, '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) r[part.slice(0, i).toUpperCase()] = part.slice(i + 1);
  }
  const freq = (r.FREQ || '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const rule = { freq, interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1) };
  if (r.COUNT) rule.count = Math.max(1, parseInt(r.COUNT, 10) || 1);
  if (r.UNTIL) rule.until = r.UNTIL;
  if (r.BYDAY) rule.byday = r.BYDAY.split(',').map(parseByday).filter(Boolean);
  if (r.BYMONTHDAY) rule.bymonthday = r.BYMONTHDAY.split(',').map(Number).filter((n) => n && Math.abs(n) <= 31);
  if (r.BYMONTH) rule.bymonth = r.BYMONTH.split(',').map(Number).filter((n) => n >= 1 && n <= 12).sort((a, b) => a - b);
  if (r.BYSETPOS) rule.bysetpos = r.BYSETPOS.split(',').map(Number).filter(Boolean);
  return rule;
}

function untilLimit(until, allDay, tz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(until || '');
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (allDay) return { day: dayNum(+y, +mo, +d) };
  if (!h) return { ts: zonedToUtc(+y, +mo, +d, 23, 59, 59, tz) };
  if (z) return { ts: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) };
  return { ts: zonedToUtc(+y, +mo, +d, +h, +mi, +s, tz) };
}

function pickPositions(list, positions) {
  const out = [];
  for (const p of positions) {
    const v = p > 0 ? list[p - 1] : list[list.length + p];
    if (v !== undefined) out.push(v);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// Tage (1–31) eines Monats, an denen die Regel zutrifft
function monthDays(y, m, rule, baseDay) {
  const dim = daysInMonth(y, m);
  let days = [];
  if (rule.byday?.length) {
    const first = dayNum(y, m, 1);
    for (const { n, wd } of rule.byday) {
      const matches = [];
      for (let d = 1; d <= dim; d++) if (weekdayOf(first + d - 1) === wd) matches.push(d);
      if (n === 0) days.push(...matches);
      else {
        const pick = n > 0 ? matches[n - 1] : matches[matches.length + n];
        if (pick) days.push(pick);
      }
    }
    if (rule.bymonthday?.length) {
      days = days.filter((d) => rule.bymonthday.some((md) => (md > 0 ? md : dim + md + 1) === d));
    }
  } else if (rule.bymonthday?.length) {
    for (const md of rule.bymonthday) {
      const d = md > 0 ? md : dim + md + 1;
      if (d >= 1 && d <= dim) days.push(d);
    }
  } else if (baseDay <= dim) {
    days.push(baseDay);
  }
  days = [...new Set(days)].sort((a, b) => a - b);
  if (rule.bysetpos?.length) days = pickPositions(days, rule.bysetpos);
  return days;
}

const MAX_PERIODS = { DAILY: 100000, WEEKLY: 20000, MONTHLY: 3000, YEARLY: 500 };

function overlaps(s, e, rs, re) {
  return s < re && (e > rs || (e === s && s >= rs));
}

// Alle Vorkommen eines Termins, die den Zeitraum [rangeStart, rangeEnd) berühren.
// Ergebnis: [{ ev, start: Date, end: Date (exklusiv), allDay, key, orig }]
export function occurrences(ev, rangeStart, rangeEnd) {
  const rs = rangeStart.getTime();
  const re = rangeEnd.getTime();
  const out = [];
  const allDay = !!ev.allDay;

  let base;
  let spanDays = 0;
  let dur = 0;
  const tz = isValidTz(ev.tz) ? ev.tz : localTz();
  if (allDay) {
    const s0 = parseYmd(ev.start);
    spanDays = Math.max(0, daysBetween(s0, parseYmd(ev.end || ev.start)));
    base = { y: s0.getFullYear(), m: s0.getMonth() + 1, d: s0.getDate(), h: 0, mi: 0, s: 0 };
  } else {
    const st = Date.parse(ev.start);
    dur = Math.max(0, Date.parse(ev.end || ev.start) - st);
    base = wallParts(st, tz);
  }

  const make = (y, m, d) => {
    if (allDay) {
      const s = new Date(y, m - 1, d);
      return { s, e: new Date(y, m - 1, d + spanDays + 1), orig: ymd(s) };
    }
    const ts = zonedToUtc(y, m, d, base.h, base.mi, base.s, tz);
    return { s: new Date(ts), e: new Date(ts + dur), orig: new Date(ts).toISOString() };
  };

  const rule = parseRrule(ev.rrule);
  if (!rule) {
    let s, e;
    if (allDay) ({ s, e } = make(base.y, base.m, base.d));
    else {
      s = new Date(Date.parse(ev.start));
      e = new Date(s.getTime() + dur);
    }
    if (overlaps(s.getTime(), e.getTime(), rs, re)) {
      out.push({ ev, start: s, end: e, allDay, key: ev.id, orig: null });
    }
    return out;
  }

  const startN = dayNum(base.y, base.m, base.d);
  const limit = rule.until ? untilLimit(rule.until, allDay, tz) : null;
  const ex = new Set(
    (ev.exdates || []).map((x) => (allDay ? String(x).slice(0, 10) : Date.parse(x))),
  );

  let count = 0;
  const emit = (n) => {
    if (n < startN) return true;
    if (allDay && limit?.day !== undefined && n > limit.day) return false;
    const { y, m, d } = fromDayNum(n);
    const { s, e, orig } = make(y, m, d);
    if (!allDay && limit?.ts !== undefined && s.getTime() > limit.ts) return false;
    count++;
    if (rule.count && count > rule.count) return false;
    if (s.getTime() >= re) return false;
    if (ex.has(allDay ? orig : s.getTime())) return true;
    if (overlaps(s.getTime(), e.getTime(), rs, re)) {
      out.push({ ev, start: s, end: e, allDay, key: `${ev.id}@${orig}`, orig });
    }
    return true;
  };

  const iv = rule.interval;
  let k0 = 0;
  // Schnellvorlauf zum sichtbaren Bereich (geht nur ohne COUNT)
  if (!rule.count && (rule.freq === 'DAILY' || rule.freq === 'WEEKLY')) {
    const period = rule.freq === 'DAILY' ? iv : 7 * iv;
    const rsN = dayNum(rangeStart.getFullYear(), rangeStart.getMonth() + 1, rangeStart.getDate());
    const lookback = spanDays + Math.ceil(dur / 864e5) + 8;
    k0 = Math.max(0, Math.floor((rsN - lookback - startN) / period));
  }
  const weekDays = rule.byday?.length
    ? [...new Set(rule.byday.map((b) => b.wd))].sort((a, b) => a - b)
    : [weekdayOf(startN)];

  for (let k = k0; k < k0 + MAX_PERIODS[rule.freq]; k++) {
    let days = [];
    if (rule.freq === 'DAILY') {
      const n = startN + k * iv;
      if (!rule.byday?.length || weekDays.includes(weekdayOf(n))) days = [n];
    } else if (rule.freq === 'WEEKLY') {
      const ws = startN - weekdayOf(startN) + k * 7 * iv;
      days = weekDays.map((w) => ws + w);
    } else if (rule.freq === 'MONTHLY') {
      const total = base.m - 1 + k * iv;
      const y = base.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      days = monthDays(y, m, rule, base.d).map((d) => dayNum(y, m, d));
    } else {
      const y = base.y + k * iv;
      for (const m of rule.bymonth?.length ? rule.bymonth : [base.m]) {
        for (const d of monthDays(y, m, rule, base.d)) days.push(dayNum(y, m, d));
      }
    }
    let stop = false;
    for (const n of days) {
      if (!emit(n)) {
        stop = true;
        break;
      }
    }
    if (stop) break;
  }
  return out;
}

export function occFirstDay(o) {
  return startOfDay(o.start);
}

export function occLastDay(o) {
  if (o.allDay) return addDays(startOfDay(o.end), -1);
  const e = o.end.getTime() > o.start.getTime() ? new Date(o.end.getTime() - 1) : o.start;
  return startOfDay(e);
}

// ---------- Für den Editor ----------

export const REPEAT_PRESETS = [
  { id: '', label: 'Nie' },
  { id: 'FREQ=DAILY', label: 'Täglich' },
  { id: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: 'Werktags (Mo–Fr)' },
  { id: 'FREQ=WEEKLY', label: 'Wöchentlich' },
  { id: 'FREQ=WEEKLY;INTERVAL=2', label: 'Alle 2 Wochen' },
  { id: 'FREQ=MONTHLY', label: 'Monatlich' },
  { id: 'FREQ=YEARLY', label: 'Jährlich' },
];

// Trennt eine Regel in "Muster" und "bis wann", damit der Editor beides einzeln zeigen kann.
export function splitRrule(rrule) {
  if (!rrule) return { pattern: '', until: '' };
  const parts = rrule.replace(/^RRULE:/i, '').split(';').filter(Boolean);
  let until = '';
  const rest = [];
  for (const p of parts) {
    if (/^UNTIL=/i.test(p)) {
      const m = /^UNTIL=(\d{4})(\d{2})(\d{2})/i.exec(p);
      if (m) until = `${m[1]}-${m[2]}-${m[3]}`;
    } else rest.push(p);
  }
  return { pattern: rest.join(';'), until };
}

export function joinRrule(pattern, until) {
  if (!pattern) return null;
  return until ? `${pattern};UNTIL=${until.replace(/-/g, '')}` : pattern;
}

const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const ORD = { 1: 'ersten', 2: 'zweiten', 3: 'dritten', 4: 'vierten', 5: 'fünften', '-1': 'letzten' };

// Lesbare Beschreibung, z. B. „Alle 2 Wochen am Mo, Mi · bis 31.12.2026“
export function describeRrule(rrule, startDate) {
  const r = parseRrule(rrule);
  if (!r) return '';
  const wd = (startDate.getDay() + 6) % 7;
  const n = r.interval;
  const days = r.byday?.length ? r.byday : null;
  let text;
  if (r.freq === 'DAILY') text = n === 1 ? 'Täglich' : `Alle ${n} Tage`;
  else if (r.freq === 'WEEKLY') {
    const list = days ? days.map((d) => d.wd) : [wd];
    const isWorkdays = list.length === 5 && [0, 1, 2, 3, 4].every((x) => list.includes(x));
    const on = isWorkdays ? 'Mo–Fr' : list.length === 1 ? WD_LONG[list[0]] : list.map((x) => WD_SHORT[x]).join(', ');
    text = `${n === 1 ? 'Wöchentlich' : `Alle ${n} Wochen`} am ${on}`;
  } else if (r.freq === 'MONTHLY') {
    let on = `${startDate.getDate()}.`;
    if (days?.length === 1 && days[0].n) on = `${ORD[days[0].n] || `${days[0].n}.`} ${WD_LONG[days[0].wd]}`;
    else if (r.bymonthday?.length) on = r.bymonthday.map((d) => (d === -1 ? 'letzten Tag' : `${d}.`)).join(', ');
    text = `${n === 1 ? 'Monatlich' : `Alle ${n} Monate`} am ${on}`;
  } else {
    const month = MONTHS[(r.bymonth?.[0] || startDate.getMonth() + 1) - 1];
    let on = `${startDate.getDate()}. ${month}`;
    if (days?.length === 1 && days[0].n) on = `${ORD[days[0].n] || `${days[0].n}.`} ${WD_LONG[days[0].wd]} im ${month}`;
    text = `${n === 1 ? 'Jährlich' : `Alle ${n} Jahre`} am ${on}`;
  }
  if (r.count) text += ` · ${r.count}-mal`;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(r.until || '');
  if (m) text += ` · bis ${+m[3]}.${+m[2]}.${m[1]}`;
  return text;
}

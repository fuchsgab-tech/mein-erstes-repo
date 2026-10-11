// Lesen und Schreiben von iCalendar-Dateien (.ics), wie sie Google, Apple & Outlook benutzen.
import { isValidTz, pad, wallParts, zonedToUtc } from '../public/js/time.js';

// Outlook schreibt oft Windows-Zeitzonennamen
const WINDOWS_TZ = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

function resolveTz(name, fallback) {
  if (!name) return fallback;
  const clean = name.replace(/^"|"$/g, '');
  if (isValidTz(clean)) return clean;
  if (WINDOWS_TZ[clean]) return WINDOWS_TZ[clean];
  // z. B. "/mozilla.org/20050126_1/Europe/Berlin"
  const m = /([A-Za-z_]+\/[A-Za-z_+\-]+(?:\/[A-Za-z_+\-]+)?)$/.exec(clean);
  if (m && isValidTz(m[1])) return m[1];
  return fallback;
}

function unescapeText(v) {
  return v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

function parseLine(line) {
  // NAME;PARAM=a;PARAM2="b:c":WERT
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) || [head];
  const name = parts[0].toUpperCase();
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

// Wandelt einen DTSTART/DTEND/EXDATE-Wert um.
// Ergebnis: { allDay: true, date: 'YYYY-MM-DD' } oder { allDay: false, ts }
function parseDateValue(value, params, fallbackTz) {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (params.VALUE === 'DATE' || h === undefined) {
    return { allDay: true, date: `${y}-${mo}-${d}` };
  }
  if (z) return { allDay: false, ts: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)) };
  const tz = resolveTz(params.TZID, fallbackTz);
  return { allDay: false, ts: zonedToUtc(+y, +mo, +d, +h, +mi, +(s || 0), tz), tz };
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec((v || '').trim());
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const [, , w, d, h, mi, s] = m.map((x) => +x || 0);
  return sign * ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

function addDaysYmd(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

const MAX_EVENTS = 20000;

/**
 * Liest eine .ics-Datei.
 * @param {string} text  Inhalt der Datei
 * @param {string} defaultTz  Zeitzone für Termine ohne Zeitzonenangabe
 * @returns {{ name: string|null, events: object[] }}
 */
export function parseIcs(text, defaultTz = 'UTC') {
  if (typeof text !== 'string' || !/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('Das sieht nicht nach einer Kalenderdatei (.ics) aus.');
  }
  const lines = text.replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let calName = null;
  let calTz = defaultTz;
  const raw = [];
  const stack = [];
  let cur = null;

  for (const line of lines) {
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      stack.push(p.value.toUpperCase());
      if (p.value.toUpperCase() === 'VEVENT' && stack.length === 2) cur = { props: [] };
      continue;
    }
    if (p.name === 'END') {
      const what = stack.pop();
      if (what === 'VEVENT' && cur) {
        raw.push(cur);
        cur = null;
        if (raw.length > MAX_EVENTS) break;
      }
      continue;
    }
    if (cur && stack[stack.length - 1] === 'VEVENT') cur.props.push(p);
    else if (stack.length === 1) {
      if (p.name === 'X-WR-CALNAME') calName = unescapeText(p.value).trim() || null;
      if (p.name === 'X-WR-TIMEZONE') calTz = resolveTz(p.value.trim(), defaultTz);
    }
  }

  const events = [];
  for (const { props } of raw) {
    const get = (n) => props.find((p) => p.name === n);
    const dtstart = get('DTSTART');
    if (!dtstart) continue;
    const start = parseDateValue(dtstart.value, dtstart.params, calTz);
    if (!start) continue;
    const status = (get('STATUS')?.value || '').toUpperCase();
    const uid = get('UID')?.value?.trim() || null;
    const recId = get('RECURRENCE-ID');
    const ev = {
      uid,
      recurrenceId: null,
      cancelled: status === 'CANCELLED',
      title: unescapeText(get('SUMMARY')?.value || '').trim().slice(0, 200) || '(Ohne Titel)',
      location: unescapeText(get('LOCATION')?.value || '').trim().slice(0, 300),
      notes: unescapeText(get('DESCRIPTION')?.value || '').trim().slice(0, 5000),
      allDay: start.allDay,
      rrule: null,
      exdates: [],
    };
    if (recId) {
      const r = parseDateValue(recId.value, recId.params, calTz);
      if (r) ev.recurrenceId = r.allDay ? r.date : new Date(r.ts).toISOString();
    }

    const dtend = get('DTEND');
    const end = dtend ? parseDateValue(dtend.value, dtend.params, calTz) : null;
    const duration = get('DURATION') ? parseDuration(get('DURATION').value) : 0;

    if (start.allDay) {
      ev.start = start.date;
      let endExcl = end?.allDay ? end.date : null;
      if (!endExcl && duration > 0) endExcl = addDaysYmd(start.date, Math.max(1, Math.round(duration / 864e5)));
      // In .ics ist das Ende ganztägiger Termine exklusiv, bei uns inklusive
      ev.end = endExcl && endExcl > start.date ? addDaysYmd(endExcl, -1) : start.date;
    } else {
      ev.tz = start.tz || calTz;
      ev.start = new Date(start.ts).toISOString();
      let endTs = start.ts;
      if (end && !end.allDay) endTs = end.ts;
      else if (duration) endTs = start.ts + duration;
      ev.end = new Date(Math.max(start.ts, endTs)).toISOString();
    }

    const rrule = get('RRULE')?.value?.trim();
    if (rrule && /FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/i.test(rrule) && !recId) {
      ev.rrule = rrule.replace(/^RRULE:/i, '').slice(0, 500);
    }
    for (const ex of props.filter((p) => p.name === 'EXDATE')) {
      for (const part of ex.value.split(',')) {
        const d = parseDateValue(part, ex.params, calTz);
        if (!d) continue;
        ev.exdates.push(d.allDay ? d.date : new Date(d.ts).toISOString());
      }
    }
    events.push(ev);
  }

  // Geänderte Einzeltermine einer Serie: Original ausblenden, Änderung als eigener Termin
  const masters = new Map();
  for (const ev of events) if (ev.uid && ev.rrule && !ev.recurrenceId) masters.set(ev.uid, ev);
  const result = [];
  for (const ev of events) {
    if (ev.recurrenceId) {
      const master = masters.get(ev.uid);
      if (master) {
        master.exdates.push(master.allDay ? ev.recurrenceId.slice(0, 10) : ev.recurrenceId);
      }
      if (ev.cancelled) continue;
    } else if (ev.cancelled) continue;
    delete ev.cancelled;
    result.push(ev);
  }
  for (const ev of result) ev.exdates = [...new Set(ev.exdates)].slice(0, 2000);
  return { name: calName, events: result };
}

// ---------- Export ----------

function escapeText(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Zeilen dürfen höchstens 75 Bytes lang sein
function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const out = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const utcStamp = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateStamp = (ymdStr) => ymdStr.replace(/-/g, '');

export function buildIcs(calendar, events, host = 'zeitgarten') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zeitgarten//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${calendar.emoji ? `${calendar.emoji} ` : ''}${calendar.name}`)}`,
  ];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@${host}`);
    lines.push(`DTSTAMP:${utcStamp(Date.parse(ev.updatedAt || ev.createdAt) || Date.now())}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(ev.start)}`);
      lines.push(`DTEND;VALUE=DATE:${dateStamp(addDaysYmd(ev.end || ev.start, 1))}`);
    } else if (ev.rrule && isValidTz(ev.tz)) {
      // Serien in ihrer Zeitzone schreiben, damit die Uhrzeit bei Sommerzeit stimmt
      const w = (ts) => {
        const p = wallParts(ts, ev.tz);
        return `${p.y}${pad(p.m)}${pad(p.d)}T${pad(p.h)}${pad(p.mi)}${pad(p.s)}`;
      };
      lines.push(`DTSTART;TZID=${ev.tz}:${w(Date.parse(ev.start))}`);
      lines.push(`DTEND;TZID=${ev.tz}:${w(Date.parse(ev.end))}`);
    } else {
      lines.push(`DTSTART:${utcStamp(Date.parse(ev.start))}`);
      lines.push(`DTEND:${utcStamp(Date.parse(ev.end))}`);
    }
    if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
    for (const ex of ev.exdates || []) {
      if (ev.allDay) lines.push(`EXDATE;VALUE=DATE:${dateStamp(ex.slice(0, 10))}`);
      else lines.push(`EXDATE:${utcStamp(Date.parse(ex))}`);
    }
    lines.push(`SUMMARY:${escapeText(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${escapeText(ev.notes)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Schnell-Eingabe in Alltagsdeutsch: „Fr 19 Uhr Pizza bei Max“ wird ein fertiger Termin.
// Reine Logik ohne DOM – läuft im Browser und in Node (für die Tests).
// Datum und Uhrzeit gelten in der Zeitzone des Geräts, die Woche beginnt am Montag.
//
// parseQuick(text, { now, calendars }) liefert
//   { title, start, end, allDay, location?, rrule?, calendarId?, emoji?, matched: [{ from, to, kind }] }
// Bei ganztägigen Terminen sind start und end Tage (Mitternacht), end ist der letzte Tag – wie im Editor.
// matched sind die erkannten Stellen im Text (kind: date, time, duration, repeat, location, calendar, allday).
//
// So geht’s: Jede Regel sucht im Text, was sie kennt, und „schwärzt“ die Stelle, damit spätere Regeln
// sie nicht noch einmal finden. Die Reihenfolge ist wichtig: „in 2 Wochen“ ist ein Datum, bevor die
// Orts-Regel „in …“ drankommt; „jeden Dienstag“ ist eine Wiederholung, bevor die Wochentage drankommen.
import { suggestEmoji } from './emoji-hints.js';
import { addDays, startOfDay } from './time.js';

const W = '\\p{L}\\p{N}_';
const B0 = `(?<![${W}])`; // Wortanfang – \b kennt keine Umlaute
const B1 = `(?![${W}])`; // Wortende
const S = '\\s+';
const MASK = '\u0001';

const NUMS = {
  ein: 1, eins: 1, eine: 1, einen: 1, einer: 1, einem: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6,
  sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
};
const NUM_WORDS = Object.keys(NUMS).sort((a, b) => b.length - a.length).join('|');
const NUM = `(?:\\d{1,3}|${NUM_WORDS})`;
const HOUR_WORDS = 'eins|ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf'; // „eine Uhr“ ist keine Uhrzeit
const toNum = (s) => (/^\d/.test(s) ? parseInt(s, 10) : NUMS[s.toLowerCase()]);

const WD_FULL = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const WD_SHORT = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];
const WD_RULE = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const WD_LONG = '(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag)';
const WD_ANY = `(?:${WD_LONG.slice(3, -1)}|mo|di|mi|do|fr|sa|so)`;
function wdIndex(w) {
  const x = w.toLowerCase().replace(/\.$/, '');
  if (x === 'sonnabend') return 5;
  const i = WD_FULL.indexOf(x);
  return i >= 0 ? i : WD_SHORT.indexOf(x);
}

const MONTHS = [
  'jan(?:uar)?', 'feb(?:ruar)?', 'm(?:ä|ae)rz?|mrz', 'apr(?:il)?', 'mai', 'juni?', 'juli?', 'aug(?:ust)?',
  'sep(?:t(?:ember)?)?', 'okt(?:ober)?', 'nov(?:ember)?', 'dez(?:ember)?',
];
const MONTH = `(${MONTHS.join('|')})\\.?`;
const monthIndex = (w) => MONTHS.findIndex((p) => new RegExp(`^(?:${p})\\.?$`, 'iu').test(w));

// Tageszeiten: Standard-Uhrzeit, wenn keine genannt ist
const PARTS = { morgen: 8, früh: 8, vormittag: 10, mittag: 12, nachmittag: 15, abend: 19, nacht: 22 };
const PART_SUFFIX = '(?:morgen|vormittag|mittag|nachmittag|abend|nacht)s?';
const partOf = (w) => w.toLowerCase().replace(/s$/, '');

// „um 7 abends“ → 19 Uhr, „nachts um 2“ bleibt 2 Uhr
function withPart(t, part) {
  if (!t || !part) return t;
  let { h } = t;
  if ((part === 'nachmittag' || part === 'abend') && h < 12) h += 12;
  else if (part === 'nacht' && h >= 6 && h < 12) h += 12;
  else if (part === 'mittag' && h <= 4) h += 12;
  return { h, m: t.m };
}

const dim = (y, m) => new Date(y, m + 1, 0).getDate();
const wdOf = (d) => (d.getDay() + 6) % 7;
const at = (d, t) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.m);
const compact = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
function addMonthsKeep(d, n) {
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  return new Date(y, m, Math.min(d.getDate(), dim(y, m)));
}

const fold = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^\p{L}\p{N}]/gu, '');

function lev(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// „#WG“, „#familie“, „#Familie Müller“, „#famlie“ → passender Kalender
function findCalendar(rest, calendars) {
  const low = rest.toLowerCase();
  const byLength = [...calendars].sort((a, b) => (b.name || '').length - (a.name || '').length);
  for (const c of byLength) {
    const n = (c.name || '').trim().toLowerCase();
    if (n && low.startsWith(n) && !new RegExp(`^[${W}]`, 'u').test(rest.slice(n.length))) return { id: c.id, len: n.length };
  }
  const tok = /^[\p{L}\p{N}_-]+/u.exec(rest)?.[0];
  if (!tok) return null;
  const t = fold(tok);
  let best = null;
  for (const c of calendars) {
    const n = fold(c.name || '');
    if (!n || !t) continue;
    let score = 0;
    if (n === t) score = 4;
    else if (n.startsWith(t) && t.length >= 2) score = 3;
    else if (t.length >= 3 && (n.includes(t) || (t.startsWith(n) && n.length >= 2))) score = 2;
    else if (t.length >= 3 && lev(t, n) <= (t.length >= 6 ? 2 : 1)) score = 1;
    if (score > (best?.score || 0)) best = { id: c.id, len: tok.length, score };
  }
  return best;
}

// Orte: „bei Max“, „im Café Lotte“, „in der Turnhalle“, „am Bahnhof“, „@ Sportplatz“
const PLACE_PREP = '(beim|bei|im|in\\s+der|in\\s+dem|in\\s+den|ins|in|auf\\s+dem|auf\\s+der|auf|am|an\\s+der|an\\s+dem|vor\\s+dem|vor\\s+der)';
const KEEP_PREP = new Set(['bei', 'beim']); // „bei Max“ bleibt so stehen, „im Café Lotte“ wird „Café Lotte“
const NEEDS_CAP = new Set(['in', 'am', 'auf']); // nur vor Namen: „in Berlin“, aber nicht „in echt“
const PLACE_STOP = new Set([
  'mit', 'und', 'oder', 'zum', 'zur', 'für', 'wegen', 'weil', 'um', 'ab', 'bis', 'von', 'vom', 'danach', 'dann', 'aber',
  'ca', 'ca.', 'gegen', 'statt', 'ohne',
]);
const PLACE_JOIN = new Set(['am', 'an', 'der', 'die', 'das', 'dem', 'den', 'im', 'in', 'auf', '&', 'st.']);
const isCap = (w) => /^[\p{Lu}\p{N}]/u.test(w);

const EMOJI_RE = '(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*)';

export function parseQuick(text, { now = new Date(), calendars = [] } = {}) {
  const src = String(text ?? '').slice(0, 500);
  let work = src; // Kopie, in der Erkanntes geschwärzt wird
  const matched = [];
  const r = {};
  const today = startOfDay(now);

  function mark(from, to, kind) {
    while (from < to && /\s/.test(src[from])) from++;
    while (to > from && /\s/.test(src[to - 1])) to--;
    if (to <= from) return;
    work = work.slice(0, from) + MASK.repeat(to - from) + work.slice(to);
    if (kind) matched.push({ from, to, kind });
  }
  // fn liefert false (nicht passend), true (ganzer Treffer) oder die Länge des erkannten Teils
  function take(source, kind, fn) {
    const re = new RegExp(source, 'giu');
    for (const m of [...work.matchAll(re)]) {
      if (!m[0] || work.slice(m.index, m.index + m[0].length).includes(MASK)) continue;
      const res = fn(m);
      if (!res) continue;
      mark(m.index, m.index + (typeof res === 'number' ? res : m[0].length), kind);
    }
  }
  const before = (m) => work.slice(0, m.index);
  const after = (m) => work.slice(m.index + m[0].length);

  // ---------- Emoji: steht eins im Text, wird es das Symbol ----------
  take(EMOJI_RE, null, (m) => {
    r.emoji ||= m[0];
    return true;
  });

  // ---------- Kalender: „#WG“ ----------
  if (calendars.length) {
    for (const m of [...work.matchAll(/#/g)]) {
      if (r.calendarId) break;
      if (m.index > 0 && new RegExp(`[${W}]`, 'u').test(work[m.index - 1])) continue;
      const hit = findCalendar(work.slice(m.index + 1), calendars);
      if (!hit) continue;
      r.calendarId = hit.id;
      mark(m.index, m.index + 1 + hit.len, 'calendar');
    }
  }

  // ---------- Wiederholung ----------
  const setRule = (rule, extra = {}) => {
    if (r.rrule) return false;
    r.rrule = rule;
    Object.assign(r, extra);
    return true;
  };
  // „jeden ersten Montag (im Monat)“
  take(`${B0}jede[nmrs]?${S}(erste[nrs]?|zweite[nrs]?|dritte[nrs]?|vierte[nrs]?|letzte[nrs]?|[1-4]\\.)${S}(${WD_LONG})(${PART_SUFFIX})?(?:${S}im${S}monat)?${B1}`, 'repeat', (m) => {
    const ord = m[1].toLowerCase();
    const n = ord.startsWith('letzt') ? -1 : { e: 1, z: 2, d: 3, v: 4 }[ord[0]] || parseInt(ord, 10);
    const wd = wdIndex(m[2]);
    if (m[3]) r.part = partOf(m[3]);
    return setRule(`FREQ=MONTHLY;BYDAY=${n}${WD_RULE[wd]}`, { nth: { n, wd } });
  });
  // „jeden Dienstag“, „jeden Mo und Mi“, „jeden Freitagabend“
  take(`${B0}jede[nmrs]?${S}(${WD_ANY}(?:${PART_SUFFIX})?\\.?(?:(?:\\s*,\\s*|${S}und${S})${WD_ANY}\\.?)*)${B1}`, 'repeat', (m) => {
    const days = [...m[1].matchAll(new RegExp(`${B0}(${WD_ANY})(${PART_SUFFIX})?`, 'giu'))];
    const wds = [...new Set(days.map((d) => wdIndex(d[1])))];
    const part = days.find((d) => d[2])?.[2];
    if (!wds.length || wds.includes(-1)) return false;
    if (part) r.part = partOf(part);
    return setRule(wds.length === 1 ? 'FREQ=WEEKLY' : `FREQ=WEEKLY;BYDAY=${[...wds].sort().map((x) => WD_RULE[x]).join(',')}`, { repeatWds: wds });
  });
  // „dienstags“, „montags und donnerstags“
  take(`${B0}(${WD_LONG}s(?:(?:\\s*,\\s*|${S}und${S})${WD_LONG}s)*)${B1}`, 'repeat', (m) => {
    const wds = [...new Set([...m[1].matchAll(new RegExp(WD_LONG, 'giu'))].map((d) => wdIndex(d[0])))];
    return setRule(wds.length === 1 ? 'FREQ=WEEKLY' : `FREQ=WEEKLY;BYDAY=${[...wds].sort().map((x) => WD_RULE[x]).join(',')}`, { repeatWds: wds });
  });
  // „jeden Tag“, „jeden Abend“, „jede Woche“, „jeden Werktag“
  take(`${B0}jede[nmrs]?${S}(tag|morgen|vormittag|mittag|nachmittag|abend|nacht|werktag|woche|monat|jahr)${B1}`, 'repeat', (m) => {
    const w = m[1].toLowerCase();
    if (w === 'woche') return setRule('FREQ=WEEKLY');
    if (w === 'monat') return setRule('FREQ=MONTHLY');
    if (w === 'jahr') return setRule('FREQ=YEARLY');
    if (w === 'werktag') return setRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    if (w !== 'tag') r.part = w;
    return setRule('FREQ=DAILY');
  });
  // „jede zweite Woche“
  take(`${B0}jede[nmrs]?${S}(zweite|dritte|vierte)[nrs]?${S}(tag|woche|monat|jahr)${B1}`, 'repeat', (m) => {
    const n = { zweite: 2, dritte: 3, vierte: 4 }[m[1].toLowerCase()];
    const freq = { tag: 'DAILY', woche: 'WEEKLY', monat: 'MONTHLY', jahr: 'YEARLY' }[m[2].toLowerCase()];
    return setRule(`FREQ=${freq};INTERVAL=${n}`);
  });
  // „alle 2 Wochen“, „alle 14 Tage“
  take(`${B0}alle${S}(${NUM})${S}(tage|wochen|monate|jahre)${B1}`, 'repeat', (m) => {
    let n = toNum(m[1]);
    let freq = { tage: 'DAILY', wochen: 'WEEKLY', monate: 'MONTHLY', jahre: 'YEARLY' }[m[2].toLowerCase()];
    if (!n || n > 99) return false;
    if (freq === 'DAILY' && n % 7 === 0) {
      freq = 'WEEKLY';
      n /= 7;
    }
    return setRule(n === 1 ? `FREQ=${freq}` : `FREQ=${freq};INTERVAL=${n}`);
  });
  take(`${B0}(täglich|werktags|wöchentlich|zweiwöchentlich|vierzehntägig|14-tägig|monatlich|jährlich|alljährlich)${B1}`, 'repeat', (m) => setRule({
    täglich: 'FREQ=DAILY',
    werktags: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    wöchentlich: 'FREQ=WEEKLY',
    zweiwöchentlich: 'FREQ=WEEKLY;INTERVAL=2',
    vierzehntägig: 'FREQ=WEEKLY;INTERVAL=2',
    '14-tägig': 'FREQ=WEEKLY;INTERVAL=2',
    monatlich: 'FREQ=MONTHLY',
    jährlich: 'FREQ=YEARLY',
    alljährlich: 'FREQ=YEARLY',
  }[m[1].toLowerCase()]));

  // ---------- Ganztägig ----------
  take(`${B0}(?:ganztägig|ganztags|(?:den${S})?ganzen${S}tag|ganzer${S}tag)${B1}`, 'allday', () => (r.allDayWord = true));

  // ---------- „in 3 Tagen“, „in 2 Wochen“, „in einer Stunde“ (vor den Orten!) ----------
  take(`${B0}in${S}(${NUM})${S}(tag(?:en)?|wochen?|monat(?:en)?|jahr(?:en)?|stunden?|std\\.?|minuten?|min\\.?)${B1}`, 'date', (m) => {
    const n = toNum(m[1]);
    const unit = m[2].toLowerCase();
    if (!n && n !== 0) return false;
    if (/^(stunde|std|minute|min)/.test(unit)) {
      if (r.time) return false;
      const ms = now.getTime() + n * (unit.startsWith('m') ? 60e3 : 3600e3);
      const t = new Date(Math.ceil(ms / 300e3) * 300e3); // auf 5 Minuten aufrunden
      r.relDate = startOfDay(t);
      r.time = { h: t.getHours(), m: t.getMinutes() };
      r.relTime = true;
      return true;
    }
    if (r.relDate) return false;
    if (unit.startsWith('tag')) r.relDate = addDays(today, n);
    else if (unit.startsWith('woche')) r.relDate = addDays(today, n * 7);
    else if (unit.startsWith('monat')) r.relDate = addMonthsKeep(today, n);
    else r.relDate = addMonthsKeep(today, n * 12);
    return true;
  });

  // ---------- Datum: „24.10.“, „24.10.2026“, „24. Oktober“, „am 24.“ ----------
  const PRE = `(?:${B0}(am|den|vom|von|ab|bis(?:${S}zum)?|zum)${S})?`;
  function putDate(m, y, mo, d, hasYear) {
    if (mo < 0 || mo > 11 || d < 1 || d > dim(y, mo)) return false;
    let date = new Date(y, mo, d);
    if (!hasYear && date < today) date = new Date(y + 1, mo, Math.min(d, dim(y + 1, mo)));
    // „bis 30.10.“ oder „24.10. – 30.10.“: der letzte Tag
    if (/^bis/i.test(m[1] || '') || (r.date && new RegExp(`${MASK}\\s*[-–]\\s*$`, 'u').test(before(m)))) {
      if (r.endDate) return false;
      r.endDate = date;
      return true;
    }
    if (r.date) return false;
    r.date = date;
    return true;
  }
  take(`${PRE}${B0}(\\d{4})-(\\d{2})-(\\d{2})${B1}`, 'date', (m) => putDate(m, +m[2], m[3] - 1, +m[4], true));
  take(`${PRE}${B0}(?<!(?:um|gegen)\\s{1,3})(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}|\\d{2})?)?(?!\\d)(?!\\s*(?:uhr|h|std|stunden?|min|minuten?)${B1})`, 'date', (m) => {
    const y = m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : today.getFullYear();
    return putDate(m, y, m[3] - 1, +m[2], !!m[4]);
  });
  take(`${PRE}${B0}(\\d{1,2})\\.?\\s*${MONTH}(?:${S}(\\d{4}))?${B1}`, 'date', (m) => {
    const y = m[4] ? +m[4] : today.getFullYear();
    return putDate(m, y, monthIndex(m[3]), +m[2], !!m[4]);
  });
  take(`${B0}(am|den|zum|bis(?:${S}zum)?)${S}(\\d{1,2})\\.(?![\\d${W}])`, 'date', (m) => {
    let y = today.getFullYear();
    let mo = today.getMonth();
    if (+m[2] < today.getDate()) mo += 1;
    if (mo > 11) {
      mo = 0;
      y += 1;
    }
    return putDate(m, y, mo, +m[2], true);
  });

  // ---------- Wochentage: „Fr“, „am Freitag“, „nächsten Freitag“, „Freitag nächste Woche“, „Sonntagabend“ ----------
  const WEEK = '(nächste|übernächste|diese|kommende)[nrs]?';
  take(`${B0}(?:(nächste|übernächste|kommende|diese|am|ab|vom|bis)[nrs]?${S})?(?:${WEEK}${S}woche${S})?(${WD_ANY})(${PART_SUFFIX})?(\\.)?(?:${S}${WEEK.replace('(', '(?<wk2>')}${S}woche)?${B1}`, 'date', (m) => {
    const pre = (m[1] || '').toLowerCase();
    const week = (m[2] || m.groups.wk2 || '').toLowerCase();
    const word = m[3];
    const wd = wdIndex(word);
    if (wd < 0) return false;
    if (word.length <= 2 && !m[4]) {
      // Kurzformen sind auch normale Wörter („so“, „Kaffee mit Mo“) – nur mit klarem Zusammenhang
      const prefixed = !!(pre || week);
      const nextIsDate = new RegExp(`^\\.?\\s*(?:\\d|${MASK})`, 'u').test(after(m)) || !!m[5];
      if (/(?<!\p{L})(?:mit|bei|für|und|von|an|zu)\s+$/iu.test(before(m)) && !prefixed) return false;
      const atEnd = !after(m).replaceAll(MASK, '').trim();
      if (word.toLowerCase() === 'so' && !prefixed && !nextIsDate && !(word[0] === 'S' && atEnd)) return false;
      if (word[0] !== word[0].toUpperCase() && !prefixed && !nextIsDate) return false;
    }
    let diff = (wd - wdOf(today) + 7) % 7;
    if (week) {
      const add = { nächste: 7, kommende: 7, übernächste: 14, diese: 0 }[week];
      diff = add + wd - wdOf(today);
    } else if (pre === 'nächste' || pre === 'kommende') diff = diff || 7;
    else if (pre === 'übernächste') diff = (diff || 7) + 7;
    const date = addDays(today, diff);
    if (m[4]) r.part ||= partOf(m[4]);
    if (pre === 'bis') {
      if (r.endDate) return false;
      r.endDate = date;
      return true;
    }
    if (r.weekdayDate) return false;
    r.weekdayDate = date;
    r.weekdayEnd = m.index + m[0].length;
    return true;
  });

  // ---------- heute, morgen, übermorgen, Wochenende, nächste Woche ----------
  take(`${B0}(?<!(?:am|jeden|jede[nm]?|zum|gegen|guten)\\s+)(heute|übermorgen|morgen)(?:${S}(früh|morgen|vormittag|mittag|nachmittag|abend|nacht))?${B1}`, 'date', (m) => {
    const word = m[1].toLowerCase();
    // „Fr Morgen“ ist Freitagmorgen, nicht morgen
    if (word === 'morgen' && !m[2] && r.weekdayEnd != null && !src.slice(r.weekdayEnd, m.index).trim()) {
      r.part ||= 'morgen';
      return true;
    }
    if (r.relDate) return false;
    r.relDate = addDays(today, { heute: 0, morgen: 1, übermorgen: 2 }[word]);
    if (m[2]) r.part ||= partOf(m[2]);
    return true;
  });
  take(`${B0}(?:(am|übers|dieses|nächstes|kommendes)${S})?wochenende${B1}`, 'date', (m) => {
    if (r.relDate) return false;
    const pre = (m[1] || '').toLowerCase();
    const wd = wdOf(today);
    let diff = wd >= 5 ? 0 : 5 - wd; // Samstag, am Wochenende selbst: heute
    if ((pre === 'nächstes' || pre === 'kommendes') && wd >= 5) diff = 12 - wd;
    r.relDate = addDays(today, diff);
    if (pre === 'übers' && wd < 6) r.endDate ||= addDays(r.relDate, 1); // Samstag und Sonntag
    return true;
  });
  take(`${B0}${WEEK}${S}woche${B1}`, 'date', (m) => {
    if (r.relDate) return false;
    const add = { nächste: 7, kommende: 7, übernächste: 14, diese: 0 }[m[1].toLowerCase()];
    r.relDate = add ? addDays(today, add - wdOf(today)) : today;
    return true;
  });

  // ---------- Uhrzeiten ----------
  const T = '(\\d{1,2})(?:[:.](\\d{2}))?';
  function putTime(pre, h, mi) {
    const p = (pre || '').toLowerCase();
    if (!(h >= 0 && mi >= 0 && mi < 60) || h > (p === 'bis' ? 24 : 23) || (h === 24 && mi)) return false;
    const t = { h, m: mi };
    if (p === 'bis' || (r.time && r.endDate && !r.endTime)) {
      if (r.endTime) return false;
      r.endTime = t;
      return true;
    }
    if (r.time) return false;
    r.time = t;
    return true;
  }
  // „18-20 Uhr“, „von 18 bis 20:30“, „zwischen 18 und 20 Uhr“
  take(`${B0}(?:(von|ab|zwischen)${S})?${T}(\\s*uhr)?\\s*(-|–|bis|und)\\s*${T}(\\s*(?:uhr|h)${B1})?`, 'time', (m) => {
    const [, pre, h1, m1, uhr1, sep, h2, m2, uhr2] = m;
    const p = (pre || '').toLowerCase();
    if ((sep.toLowerCase() === 'und') !== (p === 'zwischen')) return false;
    if (!p && !uhr1 && !uhr2 && m1 == null && m2 == null) return false;
    if (r.time || r.endTime) return false;
    const a = { h: +h1, m: +(m1 || 0) };
    const b = { h: +h2, m: +(m2 || 0) };
    if (a.h > 23 || b.h > 24 || a.m > 59 || b.m > 59) return false;
    r.time = a;
    r.endTime = b;
    return true;
  });
  // „halb 8“, „viertel nach 6“, „viertel vor 8“, „dreiviertel 8“
  take(`${B0}(?:(um|ab|gegen|bis)${S})?(halb|viertel${S}nach|viertel${S}vor|dreiviertel|drei${S}viertel|viertel)${S}(\\d{1,2}|${HOUR_WORDS})(?:\\s*uhr)?${B1}`, 'time', (m) => {
    const n = toNum(m[3]);
    const kind = m[2].toLowerCase().replace(/\s+/g, ' ');
    if (!n || n > 12) return false;
    if (kind === 'viertel nach') return putTime(m[1], n, 15);
    const h = (n + 11) % 12; // „halb 1“ → 0:30
    return putTime(m[1], h, { halb: 30, viertel: 15 }[kind] ?? 45);
  });
  // „19 Uhr“, „19:30 Uhr“, „acht Uhr“, „7 Uhr 30“
  take(`${B0}(?:(um|ab|gegen|bis|ca\\.?)${S})?(\\d{1,2}|${HOUR_WORDS})(?:[:.](\\d{2}))?\\s*uhr${B1}(?:\\s*(\\d{2})${B1})?`, 'time', (m) => {
    const mi = m[3] ?? m[4];
    return putTime(m[1], toNum(m[2]), +(mi || 0));
  });
  // „19:30“
  take(`${B0}(?:(um|ab|gegen|bis|ca\\.?)${S})?(\\d{1,2}):(\\d{2})${B1}(?!\\s*(?:h|std|stunden?|min)${B1})`, 'time', (m) => putTime(m[1], +m[2], +m[3]));
  // „um 7“, „um acht“, „ab 18“, „um 7.30“
  take(`${B0}(um|ab|gegen|bis)${S}(\\d{1,2}|${HOUR_WORDS})(?:[:.](\\d{2}))?${B1}(?!\\s*(?:h|std\\.?|stunden?|min\\.?|minuten?|tage?n?|wochen?|monate?n?|jahre?n?)${B1})`, 'time', (m) => putTime(m[1], toNum(m[2]), +(m[3] || 0)));

  // ---------- Dauer: „2 Stunden“, „1,5 h“, „90 min“, „eine halbe Stunde“ ----------
  take(`${B0}(?:(?:für|ca\\.?|etwa|ungefähr)${S})?(\\d+(?:[,.]\\d+)?|${NUM_WORDS}|anderthalb|eineinhalb|zweieinhalb|eine${S}halbe|halbe?)\\s*(stunden?|std\\.?|h|minuten?|min\\.?)${B1}`, 'duration', (m) => {
    if (r.durMin) return false;
    const a = m[1].toLowerCase().replace(/\s+/g, ' ');
    const amount = /^\d/.test(a) ? parseFloat(a.replace(',', '.'))
      : { anderthalb: 1.5, eineinhalb: 1.5, zweieinhalb: 2.5, 'eine halbe': 0.5, halbe: 0.5, halb: 0.5 }[a] ?? NUMS[a];
    const min = Math.round(amount * (/^(stunde|std|h)/.test(m[2].toLowerCase()) ? 60 : 1));
    if (!(min > 0 && min <= 60 * 24 * 14)) return false;
    r.durMin = min;
    return true;
  });
  // „für 3 Tage“, „3 Tage“ (aber nicht „so ein Tag“)
  take(`${B0}(?:für${S}(${NUM})|(\\d{1,2}))${S}tage?${B1}`, 'duration', (m) => {
    const n = toNum(m[1] || m[2]);
    if (!n || n > 60 || r.days) return false;
    r.days = n;
    return true;
  });

  // ---------- Tageszeit: „abends“, „am Abend“, „Fr Abend“ ----------
  take(`${B0}(?:(am|gegen|in${S}der|zum)${S})?(früh|morgens|vormittags|mittags|nachmittags|abends|nachts|morgen|vormittag|mittag|nachmittag|abend|nacht)${B1}`, 'time', (m) => {
    const w = m[2].toLowerCase();
    const noun = !/s$/.test(w) && w !== 'früh';
    // Hauptwörter („Abend“) nur mit „am“ oder direkt nach einem Datum („Fr Abend“)
    if (noun && !m[1] && !new RegExp(`${MASK}\\s*$`, 'u').test(before(m))) return false;
    if (w === 'morgen' && !m[1]) return false;
    if (r.part) return false;
    r.part = partOf(w);
    return true;
  });

  // ---------- Ort ----------
  take(`${B0}(?:${PLACE_PREP}\\s+|(@)\\s*)`, 'location', (m) => {
    if (r.location) return false;
    const prep = (m[1] || '@').toLowerCase().replace(/\s+/g, ' ');
    const start = m.index + m[0].length;
    const rest = work.slice(start);
    const wordRe = /^(\s*)([^\s\u0001,;:()#!?]+)/u;
    let i = 0;
    let count = 0;
    while (count < 5) {
      const w = wordRe.exec(rest.slice(i));
      if (!w || (count && w[1] === '')) break;
      const word = w[2];
      const lower = word.toLowerCase();
      if (PLACE_STOP.has(lower)) break;
      if (count === 0) {
        if (!/^[\p{L}\p{N}]/u.test(word) || (NEEDS_CAP.has(prep) && !isCap(word))) break;
        if (monthIndex(word) >= 0 || wdIndex(word) >= 0) break; // „im Mai“ ist kein Ort
      } else if (!isCap(word)) {
        // Verbindungswort nur, wenn danach wieder ein Name kommt („Café am See“)
        const next = wordRe.exec(rest.slice(i + w[0].length));
        if (!PLACE_JOIN.has(lower) || !next || next[1] === '' || !isCap(next[2]) || PLACE_STOP.has(next[2].toLowerCase())) break;
      }
      i += w[0].length;
      count++;
    }
    if (!count) return false;
    let place = src.slice(start, start + i).trim();
    if (start + i >= src.trimEnd().length) place = place.replace(/[.]+$/, (x) => (/\b(?:str|nr|dr|st)\.$/i.test(place) ? x : ''));
    if (!place) return false;
    r.location = KEEP_PREP.has(prep) ? `${prep} ${place}` : place;
    return m[0].length + i;
  });

  // ---------- Titel: was übrig bleibt ----------
  const EDGE = /^[\s,;:–—\-/|+]+|[\s,;:–—\-/|+]+$/g;
  let title = work.split(/\u0001+/).map((s) => s.replace(EDGE, '')).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  for (let prev = ''; prev !== title;) {
    prev = title;
    title = title
      .replace(/^(?:am|um|ab|den|gegen|und|ca\.?)\s+/iu, '')
      .replace(/\s+(?:am|um|ab|an|den|von|bis|für|und|in|im|bei|beim|gegen|zwischen|mit|ca\.?)$/iu, '')
      .replace(EDGE, '');
  }
  if (!title && r.location) title = r.location;
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // ---------- Zusammenbauen ----------
  let date = r.date || r.relDate || r.weekdayDate || null;
  if (!date && r.repeatWds) {
    date = r.repeatWds.map((wd) => addDays(today, (wd - wdOf(today) + 7) % 7)).sort((a, b) => a - b)[0];
  }
  if (!date && r.nth) {
    for (let k = 0; k < 3 && !date; k++) {
      const first = new Date(today.getFullYear(), today.getMonth() + k, 1);
      const y = first.getFullYear();
      const mo = first.getMonth();
      let d;
      if (r.nth.n > 0) d = 1 + ((r.nth.wd - wdOf(first) + 7) % 7) + (r.nth.n - 1) * 7;
      else {
        const last = new Date(y, mo, dim(y, mo));
        d = last.getDate() - ((wdOf(last) - r.nth.wd + 7) % 7);
      }
      if (d <= dim(y, mo) && new Date(y, mo, d) >= today) date = new Date(y, mo, d);
    }
  }
  const dateGiven = !!date;
  let rrule = r.rrule || null;
  if (rrule && r.endDate) {
    rrule += `;UNTIL=${compact(r.endDate)}`;
    r.endDate = null;
  }

  let time = withPart(r.time, r.part);
  let endTime = withPart(r.endTime, r.part);
  if (!time && !endTime && r.part) time = { h: PARTS[r.part], m: 0 };
  const allDay = !!r.allDayWord || (!time && !endTime && !r.durMin && (dateGiven || !!r.endDate || !!r.days));

  let start;
  let end;
  if (allDay) {
    start = date || today;
    end = start;
    if (r.endDate && r.endDate > start) end = r.endDate;
    else if (r.days > 1) end = addDays(start, r.days - 1);
  } else {
    let day = date || today;
    if (time && endTime && endTime.h * 60 + endTime.m <= time.h * 60 + time.m && endTime.h < 12 && endTime.h + 12 > time.h) {
      endTime = { h: endTime.h + 12, m: endTime.m }; // „von 10 bis 2“ → 10–14 Uhr
    }
    const dur = (r.durMin ?? 60) * 60e3;
    if (!time && endTime) {
      const e = at(day, endTime);
      time = { h: new Date(e - dur).getHours(), m: new Date(e - dur).getMinutes() };
    }
    if (!time) time = day.getTime() === today.getTime() ? { h: Math.min(23, now.getHours() + 1), m: 0 } : { h: 10, m: 0 };
    start = at(day, time);
    // Uhrzeit heute schon vorbei und kein Datum genannt? Dann ist morgen gemeint
    if (!dateGiven && !r.relTime && (r.time || r.part) && start < now) {
      day = addDays(day, 1);
      start = at(day, time);
    }
    const endDay = r.endDate && r.endDate > day ? r.endDate : day;
    if (endTime) {
      end = at(endDay, endTime);
      if (end <= start) end = new Date(at(addDays(endDay, 1), endTime));
    } else end = endDay > day ? new Date(at(endDay, time).getTime() + dur) : new Date(start.getTime() + dur);
  }

  const out = { title, start, end, allDay, matched: matched.sort((a, b) => a.from - b.from) };
  if (r.location) out.location = r.location;
  if (rrule) out.rrule = rrule;
  if (r.calendarId) out.calendarId = r.calendarId;
  const emoji = r.emoji || suggestEmoji(title) || (r.location ? suggestEmoji(r.location) : '');
  if (emoji) out.emoji = emoji;
  return out;
}

// „Dein Jahr in Zeitgarten“: die Zahlen für den Jahresrückblick.
// Ohne Bildschirm – läuft im Browser und in Node (für die Tests).
import { suggestEmoji } from './emoji-hints.js';
import { occurrences } from './recur.js';
import { dayNum, weekdayOf } from './time.js';

export const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Tageszeiten (Beginn des Termins, Ortszeit)
export const DAYPARTS = [
  { key: 'morning', label: 'morgens', title: 'Morgens', emoji: '🌅', hours: '5–11 Uhr' },
  { key: 'noon', label: 'mittags', title: 'Mittags', emoji: '☀️', hours: '11–14 Uhr' },
  { key: 'afternoon', label: 'nachmittags', title: 'Nachmittags', emoji: '🌤️', hours: '14–18 Uhr' },
  { key: 'evening', label: 'abends', title: 'Abends', emoji: '🌆', hours: '18–22 Uhr' },
  { key: 'night', label: 'nachts', title: 'Nachts', emoji: '🌙', hours: '22–5 Uhr' },
];
const daypartOf = (hr) => (hr >= 5 && hr < 11 ? 0 : hr >= 11 && hr < 14 ? 1 : hr >= 14 && hr < 18 ? 2 : hr >= 18 && hr < 22 ? 3 : 4);

// ---------- Emojis in Titeln (wie in sheets.js) ----------

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const EMOJI_LOOK = /\p{Emoji_Presentation}|️|\p{Regional_Indicator}/u;
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('de', { granularity: 'grapheme' }) : null;
const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));
const isEmoji = (g) => EMOJI.test(g) && EMOJI_LOOK.test(g);

/** Symbol eines Termins: das erste Emoji im Titel, sonst der Vorschlag passend zum Titel */
export function emojiOf(title) {
  return graphemes(title || '').find(isEmoji) || suggestEmoji(title) || '';
}

/** Titel ohne Emojis („Yoga 🧘“ → „Yoga“) */
export function plainTitle(title) {
  return graphemes(title || '').filter((g) => !isEmoji(g)).join('').replace(/\s+/g, ' ').trim();
}

const emojiKey = (e) => e.replace(/️/g, '');
const baseOf = (e) => (e ? String.fromCodePoint(e.codePointAt(0)) : '');
const set = (s) => new Set(Array.from(s));
const SPORT = set('⚽🏀🏈⚾🎾🏐🏉🏓🏸🥊🥋⛳🏒🏑🏏🎿⛷🏂🏋🤸🤼🤾🧗🚴🚵🏃🏊🏄🚣🧘🤺🏇⛹🛹⛸🥅💪🚲👟🏆');
const PARTY = set('🎉🥳🍻🍺🥂🍷🍸🍹🍾🎂🎈🎁🍕🍔🍝🍣🌮🍿🎲🎮🎤🎶🎵🎸🎭🪩💃🕺🎊🎆🍲🥐🍽🧁🎳');
const WORK = set('💼💻📊📈🚀📝📞🗂📋🏢🖥⌨🗓');
const TRAVEL = set('✈🏖🏝🌊🚆🚄🚂🧳🗺🏕⛺🚢⛰🏔🗼🏞🌍🌎🌏🚌🚗');

// Feiertage sind nicht „deine“ Termine
const isHolidayCal = (c) => /feiertag|holiday/i.test(c.name || '') || (c.subscriptions || []).some((s) => /feiertag|holiday/i.test(s.name || ''));

// Wer ist dabei? Bei Serien gilt die Zusage pro Datum (wie attendeesFor in state.js)
const attendeesOf = (ev, orig) =>
  (ev.rrule && orig && ev.attendeesByOcc && Object.hasOwn(ev.attendeesByOcc, orig) ? ev.attendeesByOcc[orig] : ev.attendees) || [];

const dayN = (d) => dayNum(d.getFullYear(), d.getMonth() + 1, d.getDate());
const weekIdx = (n) => Math.floor((n - weekdayOf(n)) / 7);
const top = (counts) => counts.reduce((best, c, i) => (c > counts[best] ? i : best), 0);
const pct = (x) => `${Math.round(x * 100)} %`;

// ---------- Zeitgarten-Typ ----------

export const TYPES = {
  neuling: { label: 'Garten-Neuling', emoji: '🌱', text: () => 'Dein Garten fängt gerade erst an zu wachsen. Nächstes Jahr wird’s bunt!' },
  sport: { label: 'Sport-Maschine', emoji: '💪', text: (s) => `${pct(s.shares.sport)} deiner Termine waren Sport. Respekt!` },
  party: { label: 'Party-Profi', emoji: '🥳', text: (s) => `Bei ${pct(s.shares.party)} deiner Termine wurde gefeiert, gegessen oder gespielt.` },
  work: { label: 'Business-Profi', emoji: '💼', text: (s) => `${pct(s.shares.work)} deiner Termine hatten mit Arbeit zu tun. Feierabend nicht vergessen!` },
  travel: { label: 'Weltenbummler:in', emoji: '✈️', text: (s) => `${s.trips} Reisen und Ausflüge – du warst ganz schön unterwegs.` },
  team: { label: 'Teamplayer', emoji: '🤝', text: (s) => `${pct(s.shares.shared)} deiner Termine hast du mit anderen geteilt.` },
  night: { label: 'Nachteule', emoji: '🦉', text: (s) => `${pct(s.shares.late)} deiner Termine begannen abends oder nachts.` },
  early: { label: 'Early Bird', emoji: '🐦', text: (s) => `${pct(s.shares.morning)} deiner Termine waren schon morgens.` },
  organizer: { label: 'Organisationstalent', emoji: '🗂️', text: (s) => `${pct(s.shares.series)} deiner Termine sind feste Serien – du hast alles im Griff.` },
  spontan: { label: 'Spontan-Talent', emoji: '⚡', text: () => 'Kaum Serien, fast nur Einzeltermine – bei dir ist jede Woche anders.' },
  allround: { label: 'Allround-Talent', emoji: '🌿', text: () => 'Von allem etwas: Sport, Freunde, Alltag – genau die richtige Mischung.' },
};

function typeOf(s) {
  if (s.count < 5) return 'neuling';
  const { shares } = s;
  const cands = [
    ['sport', shares.sport / 0.22],
    ['party', shares.party / 0.28],
    ['work', shares.work / 0.32],
    ['travel', s.trips / 4],
    ['team', shares.shared / 0.4],
    ['night', s.timed >= 8 ? shares.late / 0.5 : 0],
    ['early', s.timed >= 8 ? shares.morning / 0.35 : 0],
    ['organizer', s.count >= 25 ? shares.series / 0.6 : 0],
    ['spontan', s.count >= 12 && shares.series <= 0.15 ? 1.01 : 0],
  ];
  const [key, score] = cands.reduce((a, b) => (b[1] > a[1] ? b : a));
  return score >= 1 ? key : 'allround';
}

/** Jahr, das der Rückblick zuerst zeigt: im Januar noch das alte Jahr */
export const defaultRecapYear = (now = new Date()) => (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());

/** Zeit für den Rückblick in der Übersicht: 1. Dezember bis 15. Januar */
export const recapSeason = (now = new Date()) => now.getMonth() === 11 || (now.getMonth() === 0 && now.getDate() <= 15);

/**
 * Zahlen für den Jahresrückblick.
 * events/calendars wie von der API, meId = eigene ID. Gezählt wird vom 1. Januar bis heute
 * (bzw. bis Jahresende). In gemeinsamen Kalendern nur, was du eingetragen hast oder wo du dabei bist.
 */
export function recapStats({ events, calendars, meId, year, now = new Date() }) {
  const from = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const to = todayEnd < yearEnd ? todayEnd : yearEnd;
  const cals = new Map(calendars.filter((c) => !isHolidayCal(c)).map((c) => [c.id, c]));
  const isShared = (c) => (c.members?.length || 0) > 1;

  // Leute aus deinen Kalendern
  const people = new Map();
  for (const c of calendars) for (const m of c.members || []) if (m.id !== meId && !people.has(m.id)) people.set(m.id, m);

  const list = [];
  if (to > from) {
    for (const ev of events) {
      const cal = cals.get(ev.calendarId);
      if (!cal) continue;
      for (const o of occurrences(ev, from, to)) {
        if (o.start < from) continue;
        const att = attendeesOf(ev, o.orig);
        if (isShared(cal) && ev.createdBy !== meId && !att.includes(meId)) continue;
        list.push({ o, cal, att });
      }
    }
  }
  list.sort((a, b) => a.o.start - b.o.start || (b.o.allDay ? 1 : 0) - (a.o.allDay ? 1 : 0) || a.o.ev.title.localeCompare(b.o.ev.title));

  const months = Array(12).fill(0);
  const weekdays = Array(7).fill(0);
  const dayparts = Array(5).fill(0);
  const emojis = new Map();
  const withFriend = new Map();
  const groups = new Map();
  const days = new Set();
  let hours = 0;
  let timed = 0;
  let series = 0;
  let shared = 0;
  let trips = 0;
  const cat = { sport: 0, party: 0, work: 0 };

  for (const { o, cal, att } of list) {
    const { ev } = o;
    const n = dayN(o.start);
    days.add(n);
    months[o.start.getMonth()]++;
    weekdays[weekdayOf(n)]++;
    if (!o.allDay) {
      timed++;
      hours += Math.min(o.end - o.start, 864e5) / 36e5;
      dayparts[daypartOf(o.start.getHours())]++;
    }
    if (ev.rrule) series++;

    const emoji = emojiOf(ev.title);
    if (emoji) {
      const k = emojiKey(emoji);
      const e = emojis.get(k) || { emoji, count: 0 };
      e.count++;
      emojis.set(k, e);
      const b = baseOf(k);
      if (SPORT.has(b)) cat.sport++;
      if (PARTY.has(b)) cat.party++;
      if (WORK.has(b)) cat.work++;
      if (TRAVEL.has(b)) trips++;
    }

    // Mit wem? Alle, die dabei sind oder den Termin eingetragen haben – wenn du auch dabei bist
    if (isShared(cal)) {
      const who = new Set(att);
      if (ev.createdBy) who.add(ev.createdBy);
      if (who.has(meId)) {
        let any = false;
        for (const id of who) {
          if (id === meId || !people.has(id)) continue;
          withFriend.set(id, (withFriend.get(id) || 0) + 1);
          any = true;
        }
        if (any) shared++;
      }
    }

    // Serien und gleiche Titel: in welchen Wochen?
    const key = plainTitle(ev.title).toLowerCase() || ev.id;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { weeks: new Map(), title: ev.title }));
    const w = weekIdx(n);
    if (!g.weeks.has(w)) g.weeks.set(w, o.start);
    g.title = ev.title;
  }

  const count = list.length;

  // Längste Serie: Wochen am Stück mit demselben Termin
  let streak = null;
  for (const g of groups.values()) {
    const ws = [...g.weeks.keys()].sort((a, b) => a - b);
    let runStart = 0;
    for (let i = 1; i <= ws.length; i++) {
      if (i < ws.length && ws[i] === ws[i - 1] + 1) continue;
      const len = i - runStart;
      if (len >= 2 && (!streak || len > streak.weeks)) {
        streak = { weeks: len, title: g.title, emoji: emojiOf(g.title), from: g.weeks.get(ws[runStart]), to: g.weeks.get(ws[i - 1]) };
      }
      runStart = i;
    }
  }

  // Lieblingsmensch: mit wem die meisten Termine, sonst wer in den meisten gemeinsamen Kalendern ist
  let friend = null;
  if (withFriend.size) {
    const [id, n] = [...withFriend].reduce((a, b) => (b[1] > a[1] ? b : a));
    friend = { ...people.get(id), count: n, via: 'events' };
  } else {
    const inCals = new Map();
    for (const c of cals.values()) {
      if (!isShared(c) || !c.members.some((m) => m.id === meId)) continue;
      for (const m of c.members) if (m.id !== meId) inCals.set(m.id, (inCals.get(m.id) || 0) + 1);
    }
    if (inCals.size) {
      const [id, n] = [...inCals].reduce((a, b) => (b[1] > a[1] ? b : a));
      friend = { ...people.get(id), count: n, via: 'calendars' };
    }
  }

  const enough = count >= 3;
  const wd = top(weekdays);
  const dp = top(dayparts);
  const mo = top(months);
  const first = list[0]?.o;
  const stats = {
    year,
    from,
    to,
    partial: to < yearEnd,
    count,
    hours: Math.round(hours * 10) / 10,
    days: days.size,
    timed,
    months,
    weekdays,
    dayparts,
    topEmojis: [...emojis.values()].sort((a, b) => b.count - a.count).slice(0, 3),
    weekday: enough ? { index: wd, name: WEEKDAYS_LONG[wd], count: weekdays[wd], share: weekdays[wd] / count } : null,
    daypart: timed >= 3 ? { ...DAYPARTS[dp], index: dp, count: dayparts[dp], share: dayparts[dp] / timed } : null,
    month: enough ? { index: mo, name: MONTHS[mo], count: months[mo] } : null,
    friend,
    streak,
    sharedCalendars: [...cals.values()].filter(isShared).length,
    friends: people.size,
    first: first ? { title: first.ev.title, emoji: emojiOf(first.ev.title), start: first.start, allDay: first.allDay } : null,
    trips,
    shares: {
      sport: count ? cat.sport / count : 0,
      party: count ? cat.party / count : 0,
      work: count ? cat.work / count : 0,
      shared: count ? shared / count : 0,
      series: count ? series / count : 0,
      late: timed ? (dayparts[3] + dayparts[4]) / timed : 0,
      morning: timed ? dayparts[0] / timed : 0,
    },
  };
  const key = typeOf(stats);
  stats.type = { key, label: TYPES[key].label, emoji: TYPES[key].emoji, text: TYPES[key].text(stats) };
  return stats;
}

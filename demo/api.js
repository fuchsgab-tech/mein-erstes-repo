// Demo-Version: Zeitgarten läuft komplett im Browser – ohne Server.
// Es ist dieselbe Logik wie auf dem echten Server (server/core.js), die Daten bleiben auf diesem Gerät.
// Max und Lena sind Beispiel-Freunde, die live mitmachen, damit man die Live-Funktionen allein ausprobieren kann.
import { createCore } from '../server/core.js';

export const isDemo = true;

const DB_KEY = 'zg.demo.db';
const TOKEN_KEY = 'zg.token';

const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* privater Modus: dann eben nur bis zum Neuladen */
  }
};

// In der Demo startet man auf der Übersicht
if (!read('zg.view')) write('zg.view', JSON.stringify('today'));

const EMPTY = () => ({ version: 1, users: {}, calendars: {}, members: [], events: {}, comments: {}, subscriptions: {}, activity: [], demo: null });
let db;
try {
  db = { ...EMPTY(), ...JSON.parse(read(DB_KEY) || 'null') };
} catch {
  db = EMPTY();
}

let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => write(DB_KEY, JSON.stringify(db)), 150);
};

function newId(bytes = 12) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let token = read(TOKEN_KEY);
const listeners = new Set();
const botsOnline = new Set();
const me = () => core.authenticate(token);

const core = createCore({
  db,
  save,
  newId,
  hash: (t) => `demo:${t}`,
  push: (userId, payload) => {
    if (userId !== me()?.id) return;
    const copy = structuredClone(payload);
    for (const fn of listeners) setTimeout(() => fn(copy), 40);
  },
  isConnected: (id) => botsOnline.has(id) || (id === me()?.id && listeners.size > 0),
  fetchCalendarText: async (url) => {
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new Error('In der Demo lassen sich Kalender-Links meist nicht laden. Probier den Import einer .ics-Datei.');
    }
    if (!res.ok) throw new Error(`Der Kalender-Server meldet Fehler ${res.status}.`);
    return res.text();
  },
  normalizeCalendarUrl: (raw) => {
    const url = String(raw || '').trim().replace(/^webcals?:\/\//i, 'https://');
    try {
      if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
    } catch {
      throw new Error('Das ist keine gültige Internetadresse.');
    }
    return url;
  },
  // iPhone-Import: In der Demo wird nichts an Apple gesendet – es gibt Beispiel-Kalender
  caldav: {
    async discover() {
      await wait(900);
      return ICLOUD.map((c) => ({ url: `${ICLOUD_BASE}${c.id}/`, name: c.name, color: c.color }));
    },
    async fetchEvents(_, url) {
      await wait(500);
      const cal = ICLOUD.find((c) => url === `${ICLOUD_BASE}${c.id}/`);
      return cal ? cal.events().map(icsOf) : [];
    },
  },
  // Die Demo legt keine Passwörter ab, nicht einmal auf diesem Gerät
  sealSecret: () => '{}',
  openSecret: (sealed) => sealed,
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Schnittstelle wie in public/js/api.js ----------

export const auth = {
  get token() {
    return token;
  },
  set(t) {
    token = t || null;
    write(TOKEN_KEY, token);
  },
};

export async function api(method, path, body) {
  await wait(40 + Math.random() * 90); // fühlt sich an wie ein echter Server
  const url = new URL(path, 'https://demo.zeitgarten');
  let result;
  try {
    result = await core.handle(method, url.pathname, { token, body: body ? structuredClone(body) : {}, query: url.searchParams, ip: 'demo' });
  } catch (e) {
    // Wie im echten Client: Profil unbekannt (z. B. Demo-Daten gelöscht) -> app.js erklärt das
    if (e.status === 401 && token) window.dispatchEvent(new CustomEvent('zg:unauthorized'));
    throw Object.assign(new Error(e.message || 'Da ist etwas schiefgelaufen.'), { status: e.status || 500 });
  }
  try {
    await afterRequest(method, url.pathname, result, body || {});
  } catch {
    /* die Beispiel-Freunde sind nicht so wichtig */
  }
  return structuredClone(result);
}

export function openStream(onMessage, { onOpen } = {}) {
  const fn = (msg) => onMessage(msg);
  listeners.add(fn);
  setTimeout(() => {
    onOpen?.();
    const user = me();
    if (!user) return;
    fn({ type: 'presence', online: core.onlineContacts(user.id) });
    startScript();
  }, 60);
  return { close: () => listeners.delete(fn) };
}

// ---------- Beispiel-Daten ----------

const pad = (n) => String(n).padStart(2, '0');
function day(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function at(offset, hhmm) {
  const d = day(offset);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
const tz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
})();
// nächster Samstag/Sonntag (mindestens morgen)
const nextWeekday = (wd) => {
  for (let i = 1; i <= 7; i++) if (day(i).getDay() === wd) return i;
  return 7;
};

// ---------- Beispiel-Kalender „vom iPhone“ ----------

const ICLOUD_BASE = 'https://p42-caldav.icloud.com/1234567890/calendars/';
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const wall = (d) => `${ymd(d).replace(/-/g, '')}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsText = (v) => v.replace(/[\\;,]/g, (c) => `\\${c}`);
// letzter Wochentag wd vor heute (Beginn einer Serie)
const lastWeekday = (wd) => nextWeekday(wd) - 7;

// Ein Termin, wie ihn iCloud liefert: eigener VCALENDAR mit Ortszeit (TZID)
function icsOf(e) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iPhone OS 18.0//EN', 'BEGIN:VEVENT', `UID:${e.uid}@demo.icloud`];
  if (e.from) {
    lines.push(`DTSTART;TZID=${tz}:${wall(new Date(at(e.off, e.from)))}`, `DTEND;TZID=${tz}:${wall(new Date(at(e.off, e.to)))}`);
  } else {
    const start = day(e.off);
    if (e.born) start.setFullYear(e.born);
    const end = new Date(start);
    end.setDate(end.getDate() + (e.days || 1));
    lines.push(`DTSTART;VALUE=DATE:${ymd(start).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${ymd(end).replace(/-/g, '')}`);
  }
  if (e.weekly) lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[day(e.off).getDay()]}`);
  if (e.born) lines.push('RRULE:FREQ=YEARLY');
  if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
  lines.push(`SUMMARY:${icsText(e.title)}`, 'END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

const ICLOUD = [
  {
    id: 'home', name: 'Privat', color: '#3d9df2',
    events: () => [
      { uid: 'friseur', title: 'Friseur ✂️', off: 3, from: '17:30', to: '18:15', location: 'Salon Schnittig' },
      { uid: 'brunch', title: 'Brunch mit Jana 🥐', off: nextWeekday(6), from: '11:00', to: '13:00', location: 'Café Kranz' },
      { uid: 'laufen', title: 'Laufgruppe 🏃‍♀️', off: lastWeekday(2), from: '18:30', to: '19:30', weekly: true, location: 'Volkspark, Haupteingang' },
      { uid: 'markt', title: 'Wochenmarkt 🧺', off: 6, from: '10:00', to: '11:00' },
      { uid: 'wellness', title: 'Wellness-Wochenende 🧖', off: 19, days: 2 },
    ],
  },
  {
    id: 'work', name: 'Arbeit', color: '#f59440',
    events: () => [
      { uid: 'weekly', title: 'Team-Weekly', off: lastWeekday(1), from: '09:30', to: '10:15', weekly: true, location: 'Raum 4.12' },
      { uid: 'kunde', title: 'Kundentermin Müller GmbH', off: 2, from: '14:00', to: '15:30', location: 'Konferenzraum 3' },
      { uid: 'one-on-one', title: '1:1 mit Sarah', off: 1, from: '16:00', to: '16:30' },
      { uid: 'deadline', title: 'Projekt-Deadline 🚀', off: 8 },
      { uid: 'sprint', title: 'Workshop Design-Sprint', off: 14, days: 2, location: 'Coworking Space, Etage 2' },
    ],
  },
  {
    id: 'family', name: 'Familie', color: '#ec6aa8',
    events: () => [
      { uid: 'oma', title: 'Sonntagsessen bei Oma 🍲', off: nextWeekday(0), from: '12:30', to: '15:00' },
      { uid: 'eltern', title: 'Elternabend', off: 4, from: '19:00', to: '20:30', location: 'Grundschule am Park' },
      { uid: 'turnen', title: 'Kinderturnen', off: lastWeekday(4), from: '16:00', to: '17:00', weekly: true },
      { uid: 'ostsee', title: 'Herbsturlaub an der Ostsee 🌊', off: 21, days: 6 },
    ],
  },
  {
    id: 'birthdays', name: 'Geburtstage', color: '#a46cf0',
    events: () => [
      { uid: 'mama', title: 'Mama 🎂', off: 5, born: 1966 },
      { uid: 'tim', title: 'Tim 🎈', off: 12, born: 1994 },
      { uid: 'rosi', title: 'Oma Rosi 🌷', off: 27, born: 1941 },
      { uid: 'jana', title: 'Jana 🥳', off: -9, born: 1996 },
      { uid: 'papa', title: 'Papa 🎂', off: 45, born: 1963 },
    ],
  },
];

const as = (who) => ({
  post: (path, body) => core.handle('POST', path, { token: who.token, body }),
  patch: (path, body) => core.handle('PATCH', path, { token: who.token, body }),
});

async function seed(user, userToken) {
  const max = await core.handle('POST', '/api/users', { body: { name: 'Max', color: '#f2675b' } });
  const lena = await core.handle('POST', '/api/users', { body: { name: 'Lena', color: '#a46cf0' } });
  const L = as(lena);
  const M = as(max);
  const U = as({ token: userToken });
  // Die Beispiel-Freunde haben ein Emoji als Profilbild
  await M.patch('/api/me', { emoji: '🐻' });
  await L.patch('/api/me', { emoji: '🦊' });

  const { calendar: wg } = await L.post('/api/calendars', { name: 'WG Kastanienallee', emoji: '🏠', color: '#22b3a0' });
  await M.post(`/api/invites/${wg.inviteCode}/accept`);
  await U.post(`/api/invites/${wg.inviteCode}/accept`);

  const timed = (title, off, from, to, extra = {}) => ({ calendarId: wg.id, title, allDay: false, start: at(off, from), end: at(off, to), tz, ...extra });
  const sat = nextWeekday(6);
  const { event: pizza } = await M.post('/api/events', timed('Pizza-Abend 🍕', 2, '19:00', '22:00', { location: 'Küche, 3. Stock', notes: 'Jede:r bringt einen Belag mit!' }));
  await L.post(`/api/events/${pizza.id}/attend`, { going: true });
  await M.post(`/api/events/${pizza.id}/attend`, { going: true });
  await L.post(`/api/events/${pizza.id}/comments`, { text: 'Ich mach den Teig! 🍕' });
  await M.post(`/api/events/${pizza.id}/comments`, { text: 'Perfekt, ich kümmere mich um die Musik 🎶' });
  await L.post(`/api/events/${pizza.id}/react`, { emoji: '❤️' });
  await L.post('/api/events', { ...timed('Putzplan: Küche 🧽', sat, '10:00', '11:00'), rrule: 'FREQ=WEEKLY' });
  const { event: lake } = await L.post('/api/events', { calendarId: wg.id, title: 'WG-Ausflug an den See 🏞️', allDay: true, start: ymd(day(9)), end: ymd(day(10)), color: '#3d9df2' });
  await L.post(`/api/events/${lake.id}/attend`, { going: true });
  await M.post(`/api/events/${lake.id}/react`, { emoji: '🔥' });
  await M.post('/api/events', timed('Spieleabend 🎲', 0, '20:00', '23:00', { color: '#6366f1' }));
  await L.post('/api/events', { calendarId: wg.id, title: 'Lenas Geburtstag 🎂', allDay: true, start: ymd(day(16)), end: ymd(day(16)), rrule: 'FREQ=YEARLY', color: '#ec6aa8' });

  // Eigene Termine von Max und Lena – bei „Wann habt ihr Zeit?“ sieht man davon nur frei/belegt
  const calOf = (u) => Object.values(db.calendars).find((c) => c.ownerId === u.user.id).id;
  const busy = (who, u, title, off, from, to, extra = {}) =>
    who.post('/api/events', { calendarId: calOf(u), title, allDay: false, start: at(off, from), end: at(off, to), tz, ...extra });
  await busy(M, max, 'Arbeit 💼', lastWeekday(1), '09:00', '17:00', { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
  await busy(M, max, 'Fußballtraining ⚽️', lastWeekday(2), '18:30', '20:30', { rrule: 'FREQ=WEEKLY' });
  await busy(M, max, 'Bandprobe 🎸', lastWeekday(4), '19:00', '22:00', { rrule: 'FREQ=WEEKLY' });
  await busy(M, max, 'Besuch bei Oma', nextWeekday(0), '14:00', '18:00');
  await M.post('/api/events', { calendarId: calOf(max), title: 'Kurztrip Hamburg 🚆', allDay: true, start: ymd(day(12)), end: ymd(day(13)) });
  await busy(L, lena, 'Chor 🎶', lastWeekday(3), '19:00', '21:00', { rrule: 'FREQ=WEEKLY' });
  await busy(L, lena, 'Yoga 🧘‍♀️', lastWeekday(1), '18:00', '19:00', { rrule: 'FREQ=WEEKLY' });
  await busy(L, lena, 'Schicht im Café ☕️', 1, '12:00', '20:00');
  await busy(L, lena, 'Schicht im Café ☕️', 5, '15:00', '22:00');
  await busy(L, lena, 'Uni 📚', lastWeekday(4), '10:00', '16:00', { rrule: 'FREQ=WEEKLY' });

  // Eigener Kalender
  const own = Object.values(db.calendars).find((c) => c.ownerId === user.id);
  const mine = (title, off, from, to, extra = {}) => U.post('/api/events', { calendarId: own.id, title, allDay: false, start: at(off, from), end: at(off, to), tz, ...extra });
  await mine('Laufen 🏃', 1, '07:00', '07:45', { color: '#4fb477' });
  await mine('Mittagessen mit Papa', 0, '12:30', '13:30', { color: '#f59440', location: 'Café Lotte' });
  await mine('Yoga 🧘', -14, '18:30', '19:30', { rrule: 'FREQ=WEEKLY', color: '#a46cf0', location: 'Studio Mitte' });
  await mine('Zahnarzt', 4, '09:00', '09:45', { color: '#64748b' });
  await mine('Kino: Dune 3 🍿', 5, '20:00', '22:45', { color: '#f2675b' });
  await mine('Konzert 🎸', 11, '20:00', '23:00', { color: '#6366f1' });
  await U.post('/api/events', { calendarId: own.id, title: 'Urlaub in Kroatien 🏖️', allDay: true, start: ymd(day(24)), end: ymd(day(31)), color: '#3d9df2' });

  db.demo = { max: { id: max.user.id, token: max.token }, lena: { id: lena.user.id, token: lena.token }, wgId: wg.id, pizzaId: pizza.id, done: {} };
  save();
}

// ---------- Die Beispiel-Freunde machen live mit ----------

const REPLIES = ['Klingt super! 😄', 'Bin dabei 🙌', 'Haha, perfekt 😂', 'Ich bring Snacks mit 🍿', 'Yes! Freu mich 🥳'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const bot = (key) => db.demo?.[key];
const sharedEvent = (id) => {
  const ev = db.events[id];
  return ev && ev.calendarId === db.demo?.wgId ? ev : null;
};

function goOnline(key) {
  const b = bot(key);
  if (!b || botsOnline.has(b.id)) return;
  botsOnline.add(b.id);
  core.announcePresence(b.id, true);
}

async function typeThen(key, eventId, ms, then) {
  const b = bot(key);
  if (!b || !sharedEvent(eventId)) return;
  goOnline(key);
  for (let t = 0; t < ms; t += 2000) {
    await core.handle('POST', `/api/events/${eventId}/typing`, { token: b.token }).catch(() => {});
    await wait(Math.min(2000, ms - t));
  }
  await then?.();
}

async function react(key, eventId, emoji) {
  const b = bot(key);
  const ev = sharedEvent(eventId);
  if (!b || !ev || (ev.reactions?.[emoji] || []).includes(b.id)) return;
  await core.handle('POST', `/api/events/${eventId}/react`, { token: b.token, body: { emoji } }).catch(() => {});
}

const later = (ms, fn) => setTimeout(() => Promise.resolve().then(fn).catch(() => {}), ms);

// Reaktionen auf das, was du machst
async function afterRequest(method, path, result, body) {
  if (method === 'POST' && path === '/api/users' && result?.token) {
    await seed(result.user, result.token);
    return;
  }
  if (!db.demo || method !== 'POST') return;
  let m = /^\/api\/events\/([^/]+)\/comments$/.exec(path);
  if (m && sharedEvent(m[1])) {
    const id = m[1];
    later(1200, () => typeThen('lena', id, 4500, () =>
      core.handle('POST', `/api/events/${id}/comments`, { token: bot('lena').token, body: { text: pick(REPLIES) } })));
    later(9000, () => react('max', id, '🔥'));
    return;
  }
  m = /^\/api\/events\/([^/]+)\/attend$/.exec(path);
  if (m && body.going && sharedEvent(m[1])) {
    later(2500, () => react('lena', m[1], '🎉'));
    return;
  }
  if (path === '/api/events' && result?.event && sharedEvent(result.event.id)) {
    const id = result.event.id;
    later(2500, () => react('lena', id, '❤️'));
    later(4000, () => typeThen('max', id, 3000, async () => {
      await core.handle('POST', `/api/events/${id}/attend`, { token: bot('max').token, body: { going: true } });
      await core.handle('POST', `/api/events/${id}/comments`, { token: bot('max').token, body: { text: 'Ich bin dabei! 🙌' } });
    }));
  }
}

// Kleine Vorführung nach dem Start (jeder Schritt nur einmal)
let scriptStarted = false;
function once(key, fn) {
  if (!db.demo || db.demo.done[key]) return;
  db.demo.done[key] = true;
  save();
  return fn();
}

function startScript() {
  if (scriptStarted || !db.demo || !db.calendars[db.demo.wgId]) return;
  scriptStarted = true;
  showHint();
  later(1500, () => goOnline('lena'));
  later(5000, () => goOnline('max'));
  later(12000, () => once('flohmarkt', async () => {
    const off = nextWeekday(0);
    const r = await core.handle('POST', '/api/events', {
      token: bot('max').token,
      body: { calendarId: db.demo.wgId, title: 'Flohmarkt im Mauerpark 🧺', allDay: false, start: at(off, '11:00'), end: at(off, '15:00'), tz, location: 'Mauerpark', color: '#e9b31f' },
    });
    db.demo.flohmarktId = r.event.id;
    save();
  }));
  later(22000, () => once('getraenke', () => typeThen('lena', db.demo.pizzaId, 4000, () =>
    core.handle('POST', `/api/events/${db.demo.pizzaId}/comments`, { token: bot('lena').token, body: { text: 'Wer bringt Getränke mit? 🥤' } }))));
  later(34000, () => once('flohmarkt-herz', () => react('lena', db.demo.flohmarktId, '❤️')));
}

function showHint() {
  const box = document.getElementById('toasts');
  if (!box || read('zg.demo.hint')) return;
  write('zg.demo.hint', '1');
  const el = document.createElement('div');
  el.className = 'toast demo-hint';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span>✨</span><span></span>';
  el.lastChild.textContent = 'Das ist eine Demo: Max und Lena sind Beispiel-Freunde und machen gleich live mit. Trag im Kalender „WG Kastanienallee“ etwas ein oder schreib einen Kommentar!';
  el.addEventListener('click', () => el.remove());
  box.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 9000);
}

// Demo-Version: Zeitgarten läuft komplett im Browser – ohne Server.
// Es ist dieselbe Logik wie auf dem echten Server (server/core.js), die Daten bleiben auf diesem Gerät.
// Max und Lena sind Beispiel-Freunde, die live mitmachen, damit man die Live-Funktionen allein ausprobieren kann.
import { createCore } from '../server/core.js';

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
    result = await core.handle(method, url.pathname, { token, body: body ? structuredClone(body) : {}, query: url.searchParams });
  } catch (e) {
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

const as = (who) => ({
  post: (path, body) => core.handle('POST', path, { token: who.token, body }),
});

async function seed(user, userToken) {
  const max = await core.handle('POST', '/api/users', { body: { name: 'Max', color: '#f2675b' } });
  const lena = await core.handle('POST', '/api/users', { body: { name: 'Lena', color: '#a46cf0' } });
  const L = as(lena);
  const M = as(max);
  const U = as({ token: userToken });

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

// Zeitgarten – die eigentliche Logik (Kalender, Einladungen, Termine, Neuigkeiten …) ohne HTTP.
// Läuft auf dem Server (server/index.js) und in der Demo direkt im Browser (demo/api.js).
import { parseIcs } from './ics.js';
import { isValidTz, isYmd } from '../public/js/time.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {object} deps
 * @param {object} deps.db  Daten (siehe store.js)
 * @param {Function} deps.save  speichert die Daten
 * @param {Function} deps.newId  zufällige ID
 * @param {Function} deps.hash  Hash für Anmelde-Tokens
 * @param {Function} deps.push  (userId, nachricht) – Live-Nachricht an eine Person
 * @param {Function} deps.isConnected  (userId) – ist die Person gerade online?
 * @param {Function} deps.fetchCalendarText  (url) – lädt einen Kalender-Link
 * @param {Function} deps.normalizeCalendarUrl  (url) – prüft/normalisiert einen Kalender-Link
 */
export function createCore({ db, save, newId, hash, push, isConnected, fetchCalendarText, normalizeCalendarUrl }) {
  // ---------- Hilfsfunktionen ----------

  const now = () => new Date().toISOString();
  const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);

  const fail = (status, message) => {
    throw new HttpError(status, message);
  };

  const tokenIndex = new Map();
  for (const u of Object.values(db.users)) tokenIndex.set(u.tokenHash, u.id);

  function issueToken(user) {
    if (user.tokenHash) tokenIndex.delete(user.tokenHash);
    const token = newId(24);
    user.tokenHash = hash(token);
    tokenIndex.set(user.tokenHash, user.id);
    return token;
  }

  const membership = (calId, userId) => db.members.find((m) => m.calendarId === calId && m.userId === userId);
  const membersOf = (calId) => db.members.filter((m) => m.calendarId === calId);
  const calendarIdsOf = (userId) => db.members.filter((m) => m.userId === userId).map((m) => m.calendarId);

  function requireCalendar(calId, user) {
    const cal = db.calendars[calId];
    if (!cal || !membership(calId, user.id)) fail(404, 'Kalender nicht gefunden.');
    return cal;
  }

  function requireEvent(eventId, user) {
    const ev = db.events[eventId];
    if (!ev || !membership(ev.calendarId, user.id)) fail(404, 'Termin nicht gefunden.');
    return ev;
  }

  const publicUser = (u) => ({ id: u.id, name: u.name, color: u.color });

  function calendarView(cal, user) {
    const subs = Object.values(db.subscriptions).filter((s) => s.calendarId === cal.id);
    const subCounts = {};
    if (subs.length) {
      for (const ev of Object.values(db.events)) {
        if (ev.subscriptionId) subCounts[ev.subscriptionId] = (subCounts[ev.subscriptionId] || 0) + 1;
      }
    }
    return {
      id: cal.id,
      name: cal.name,
      color: cal.color,
      emoji: cal.emoji,
      ownerId: cal.ownerId,
      createdAt: cal.createdAt,
      role: membership(cal.id, user.id)?.role,
      inviteCode: cal.inviteCode,
      feedToken: cal.feedToken,
      members: membersOf(cal.id)
        .filter((m) => db.users[m.userId])
        .map((m) => ({ ...publicUser(db.users[m.userId]), role: m.role, joinedAt: m.joinedAt })),
      subscriptions: subs.map((s) => ({
        id: s.id,
        name: s.name,
        host: new URL(s.url).host,
        lastSync: s.lastSync,
        error: s.error || null,
        count: subCounts[s.id] || 0,
      })),
    };
  }

  function eventView(ev, commentCounts) {
    const { createdBy, ...rest } = ev;
    return { ...rest, createdBy, commentCount: commentCounts?.[ev.id] || 0 };
  }

  function commentCountsFor(eventIds) {
    const counts = {};
    for (const c of Object.values(db.comments)) {
      if (eventIds.has(c.eventId)) counts[c.eventId] = (counts[c.eventId] || 0) + 1;
    }
    return counts;
  }

  function createCalendar(user, { name, color, emoji }) {
    const cal = {
      id: newId(9),
      name: str(name, 60).trim() || 'Neuer Kalender',
      color: isColor(color) ? color : user.color,
      emoji: str(emoji, 16).trim() || '📅',
      ownerId: user.id,
      inviteCode: newId(9),
      feedToken: newId(18),
      createdAt: now(),
    };
    db.calendars[cal.id] = cal;
    db.members.push({ calendarId: cal.id, userId: user.id, role: 'owner', joinedAt: now() });
    return cal;
  }

  function deleteEventData(ev) {
    delete db.events[ev.id];
    for (const c of Object.values(db.comments)) if (c.eventId === ev.id) delete db.comments[c.id];
  }

  function deleteCalendar(cal) {
    for (const ev of Object.values(db.events)) if (ev.calendarId === cal.id) deleteEventData(ev);
    for (const s of Object.values(db.subscriptions)) if (s.calendarId === cal.id) delete db.subscriptions[s.id];
    db.members = db.members.filter((m) => m.calendarId !== cal.id);
    delete db.calendars[cal.id];
  }

  // Prüft und säubert die Termindaten aus einer Anfrage
  function cleanEvent(b, base = {}) {
    const ev = { ...base };
    if ('title' in b) ev.title = str(b.title, 200).trim() || '(Ohne Titel)';
    if ('allDay' in b) ev.allDay = !!b.allDay;
    for (const k of ['start', 'end']) if (k in b) ev[k] = b[k];
    if ('tz' in b) ev.tz = isValidTz(b.tz) ? b.tz : null;
    if ('location' in b) ev.location = str(b.location, 300).trim();
    if ('notes' in b) ev.notes = str(b.notes, 5000);
    if ('color' in b) ev.color = isColor(b.color) ? b.color : null;
    if ('rrule' in b) {
      const r = typeof b.rrule === 'string' ? b.rrule.trim() : '';
      ev.rrule = /^[A-Z0-9=;,+\-:]{1,500}$/i.test(r) && /FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/i.test(r) ? r : null;
    }
    if ('exdates' in b) {
      ev.exdates = Array.isArray(b.exdates)
        ? b.exdates.filter((x) => typeof x === 'string' && x.length <= 40).slice(0, 2000)
        : [];
    }

    if (ev.allDay) {
      if (!isYmd(ev.start)) fail(400, 'Ungültiges Datum.');
      if (!isYmd(ev.end) || ev.end < ev.start) ev.end = ev.start;
    } else {
      const s = Date.parse(ev.start);
      if (Number.isNaN(s)) fail(400, 'Ungültige Uhrzeit.');
      const e = Date.parse(ev.end);
      ev.start = new Date(s).toISOString();
      ev.end = new Date(Number.isNaN(e) || e < s ? s : e).toISOString();
      if (!isValidTz(ev.tz)) ev.tz = 'UTC';
    }
    ev.title ??= '(Ohne Titel)';
    ev.location ??= '';
    ev.notes ??= '';
    ev.rrule ??= null;
    ev.exdates ??= [];
    ev.color ??= null;
    return ev;
  }

  // ---------- Live-Aktualisierung ----------

  function notifyCalendar(calId, payload, { except = null } = {}) {
    for (const m of membersOf(calId)) if (m.userId !== except) push(m.userId, payload);
  }

  // Alle, die mindestens einen Kalender mit dieser Person teilen
  function contactsOf(userId) {
    const set = new Set();
    for (const calId of calendarIdsOf(userId)) for (const m of membersOf(calId)) set.add(m.userId);
    set.delete(userId);
    return set;
  }

  const onlineContacts = (userId) => [...contactsOf(userId)].filter((id) => isConnected(id));

  function announcePresence(userId, online) {
    for (const id of contactsOf(userId)) push(id, { type: 'online', userId, online });
  }

  // Neuigkeiten („Max hat … eingetragen“)
  function logActivity(calId, userId, kind, extra = {}) {
    const u = db.users[userId];
    const a = { id: newId(8), calendarId: calId, userId, name: u?.name, color: u?.color, kind, at: now(), ...extra };
    db.activity.push(a);
    if (db.activity.length > 3000) db.activity.splice(0, db.activity.length - 3000);
    notifyCalendar(calId, { type: 'activity', activity: a });
    return a;
  }

  const REACTIONS = ['❤️', '👍', '🎉', '😂', '😮', '🙏', '🔥', '🥳'];

  // Persönliche Design-Einstellungen (nur einfache Werte)
  function cleanPrefs(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
    const out = {};
    for (const [k, v] of Object.entries(p).slice(0, 24)) {
      if (!/^[a-zA-Z]{1,20}$/.test(k)) continue;
      if (typeof v === 'boolean' || v === null) out[k] = v;
      else if (typeof v === 'string' && /^[#\w-]{0,24}$/.test(v)) out[k] = v;
    }
    return out;
  }

  // ---------- Import ----------

  function importEvents(cal, events, { subscription = null, user }) {
    const stamp = now();
    const keyOf = (e) => `${e.uid || `${e.title}|${e.start}`}|${e.recurrenceId || ''}`;
    const existing = new Map();
    for (const ev of Object.values(db.events)) {
      if (ev.calendarId !== cal.id) continue;
      if (subscription ? ev.subscriptionId === subscription.id : !ev.subscriptionId && ev.uid) {
        existing.set(keyOf(ev), ev);
      }
    }
    const used = new Set();
    const seen = new Set();
    let count = 0;
    for (const p of events) {
      const key = keyOf(p);
      const old = used.has(key) ? null : existing.get(key);
      used.add(key);
      const ev = {
        id: old?.id || newId(),
        calendarId: cal.id,
        title: p.title,
        allDay: p.allDay,
        start: p.start,
        end: p.end,
        tz: p.tz || null,
        rrule: p.rrule,
        exdates: p.exdates,
        location: p.location,
        notes: p.notes,
        color: old?.color || null,
        attendees: old?.attendees || [],
        createdBy: old?.createdBy || subscription?.createdBy || user.id,
        createdAt: old?.createdAt || stamp,
        updatedAt: stamp,
        uid: p.uid || null,
        recurrenceId: p.recurrenceId || null,
        subscriptionId: subscription?.id || null,
      };
      db.events[ev.id] = ev;
      seen.add(ev.id);
      count++;
    }
    if (subscription) {
      // Termine, die es im Abo nicht mehr gibt, verschwinden
      for (const ev of existing.values()) if (!seen.has(ev.id)) deleteEventData(ev);
    }
    return count;
  }

  async function syncSubscription(sub) {
    const cal = db.calendars[sub.calendarId];
    if (!cal) return 0;
    sub.lastAttempt = now();
    try {
      const text = await fetchCalendarText(sub.url);
      const parsed = parseIcs(text, sub.tz);
      if (!db.subscriptions[sub.id]) return 0; // in der Zwischenzeit gelöscht
      const count = importEvents(cal, parsed.events, { subscription: sub, user: { id: sub.createdBy } });
      sub.lastSync = now();
      sub.error = null;
      save();
      notifyCalendar(cal.id, { type: 'events', calendarId: cal.id });
      return count;
    } catch (e) {
      sub.error = e.message;
      save();
      throw e;
    }
  }

  // Abos, die länger als maxAge nicht aktualisiert wurden, neu laden
  let syncing = false;
  async function syncDue(maxAge) {
    if (syncing) return;
    syncing = true;
    try {
      for (const sub of Object.values(db.subscriptions)) {
        const last = Date.parse(sub.lastAttempt || sub.lastSync || 0);
        if (Date.now() - last > maxAge) await syncSubscription(sub).catch(() => {});
      }
    } finally {
      syncing = false;
    }
  }

  // ---------- Routen ----------

  const routes = [];
  function route(method, pattern, handler, { auth = true } = {}) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler, auth });
  }

  route('GET', '/api/health', () => ({ ok: true }), { auth: false });

  // Profil
  route('POST', '/api/users', ({ body }) => {
    const name = str(body.name, 40).trim();
    if (!name) fail(400, 'Bitte gib deinen Namen ein.');
    const user = { id: newId(9), name, color: isColor(body.color) ? body.color : '#6366f1', createdAt: now() };
    const token = issueToken(user);
    db.users[user.id] = user;
    createCalendar(user, { name: 'Mein Kalender', color: user.color, emoji: '🌿' });
    save();
    return { token, user: publicUser(user) };
  }, { auth: false });

  route('GET', '/api/me', ({ user }) => ({
    user: publicUser(user),
    prefs: user.prefs || {},
    calendars: calendarIdsOf(user.id).map((id) => calendarView(db.calendars[id], user)),
  }));

  route('GET', '/api/presence', ({ user }) => ({ online: onlineContacts(user.id) }));

  route('GET', '/api/activity', ({ user, query }) => {
    const mine = new Set(calendarIdsOf(user.id));
    const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 60));
    const list = [];
    for (let i = db.activity.length - 1; i >= 0 && list.length < limit; i--) {
      if (mine.has(db.activity[i].calendarId)) list.push(db.activity[i]);
    }
    return { activity: list };
  });

  route('PATCH', '/api/me', ({ user, body }) => {
    if ('name' in body) user.name = str(body.name, 40).trim() || user.name;
    if (isColor(body.color)) user.color = body.color;
    if ('prefs' in body) user.prefs = cleanPrefs(body.prefs);
    save();
    if ('name' in body || 'color' in body) {
      for (const id of calendarIdsOf(user.id)) notifyCalendar(id, { type: 'calendars' });
    }
    if ('prefs' in body) push(user.id, { type: 'prefs' });
    return { user: publicUser(user), prefs: user.prefs || {} };
  });

  route('POST', '/api/me/token', ({ user }) => {
    const token = issueToken(user);
    save();
    return { token };
  });

  // Kalender
  route('POST', '/api/calendars', ({ user, body }) => {
    const cal = createCalendar(user, body);
    save();
    return { calendar: calendarView(cal, user) };
  });

  route('PATCH', '/api/calendars/:id', ({ user, body, params }) => {
    const cal = requireCalendar(params.id, user);
    if ('name' in body) cal.name = str(body.name, 60).trim() || cal.name;
    if (isColor(body.color)) cal.color = body.color;
    if ('emoji' in body) cal.emoji = str(body.emoji, 16).trim() || cal.emoji;
    save();
    notifyCalendar(cal.id, { type: 'calendars' });
    return { calendar: calendarView(cal, user) };
  });

  route('DELETE', '/api/calendars/:id', ({ user, params }) => {
    const cal = requireCalendar(params.id, user);
    if (cal.ownerId !== user.id) fail(403, 'Nur die Person, die den Kalender erstellt hat, kann ihn löschen.');
    const members = membersOf(cal.id);
    deleteCalendar(cal);
    save();
    for (const m of members) push(m.userId, { type: 'calendars' });
    return { ok: true };
  });

  route('POST', '/api/calendars/:id/leave', ({ user, params }) => {
    const cal = requireCalendar(params.id, user);
    const others = membersOf(cal.id).filter((m) => m.userId !== user.id);
    if (!others.length) {
      deleteCalendar(cal);
    } else {
      db.members = db.members.filter((m) => !(m.calendarId === cal.id && m.userId === user.id));
      logActivity(cal.id, user.id, 'member.leave', { title: cal.name });
      if (cal.ownerId === user.id) {
        const next = others.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
        next.role = 'owner';
        cal.ownerId = next.userId;
      }
      notifyCalendar(cal.id, { type: 'calendars' });
    }
    push(user.id, { type: 'calendars' });
    save();
    return { ok: true };
  });

  route('DELETE', '/api/calendars/:id/members/:userId', ({ user, params }) => {
    const cal = requireCalendar(params.id, user);
    if (cal.ownerId !== user.id) fail(403, 'Nur die Kalender-Besitzerin bzw. der Besitzer kann Mitglieder entfernen.');
    if (params.userId === user.id) fail(400, 'Du kannst dich nicht selbst entfernen.');
    notifyCalendar(cal.id, { type: 'calendars' });
    db.members = db.members.filter((m) => !(m.calendarId === cal.id && m.userId === params.userId));
    save();
    return { calendar: calendarView(cal, user) };
  });

  route('POST', '/api/calendars/:id/invite', ({ user, params }) => {
    const cal = requireCalendar(params.id, user);
    if (cal.ownerId !== user.id) fail(403, 'Nur die Kalender-Besitzerin bzw. der Besitzer kann den Link erneuern.');
    cal.inviteCode = newId(9);
    save();
    notifyCalendar(cal.id, { type: 'calendars' });
    return { calendar: calendarView(cal, user) };
  });

  // Einladungen
  function findInvite(code) {
    const cal = Object.values(db.calendars).find((c) => c.inviteCode === code);
    if (!cal) fail(404, 'Dieser Einladungslink ist nicht (mehr) gültig.');
    return cal;
  }

  route('GET', '/api/invites/:code', ({ params }) => {
    const cal = findInvite(params.code);
    const owner = db.users[cal.ownerId];
    const members = membersOf(cal.id).map((m) => db.users[m.userId]).filter(Boolean);
    return {
      calendar: { id: cal.id, name: cal.name, color: cal.color, emoji: cal.emoji },
      owner: owner ? publicUser(owner) : null,
      members: members.slice(0, 8).map(publicUser),
      memberCount: members.length,
    };
  }, { auth: false });

  route('POST', '/api/invites/:code/accept', ({ user, params }) => {
    const cal = findInvite(params.code);
    if (membership(cal.id, user.id)) return { calendarId: cal.id, already: true };
    db.members.push({ calendarId: cal.id, userId: user.id, role: 'member', joinedAt: now() });
    save();
    notifyCalendar(cal.id, { type: 'calendars', joined: user.id });
    logActivity(cal.id, user.id, 'member.join', { title: cal.name });
    if (isConnected(user.id)) announcePresence(user.id, true);
    return { calendarId: cal.id, already: false };
  });

  // Termine
  route('GET', '/api/events', ({ user, query }) => {
    const mine = new Set(calendarIdsOf(user.id));
    const only = query.get('calendarId');
    const list = Object.values(db.events).filter((ev) => mine.has(ev.calendarId) && (!only || ev.calendarId === only));
    const counts = commentCountsFor(new Set(list.map((e) => e.id)));
    return { events: list.map((ev) => eventView(ev, counts)) };
  });

  route('POST', '/api/events', ({ user, body }) => {
    const cal = requireCalendar(body.calendarId, user);
    const ev = cleanEvent(body);
    Object.assign(ev, {
      id: newId(),
      calendarId: cal.id,
      attendees: body.going ? [user.id] : [],
      createdBy: user.id,
      createdAt: now(),
      updatedAt: now(),
      subscriptionId: null,
    });
    db.events[ev.id] = ev;
    save();
    notifyCalendar(cal.id, { type: 'events', calendarId: cal.id });
    logActivity(cal.id, user.id, 'event.create', { eventId: ev.id, title: ev.title, start: ev.start, allDay: ev.allDay });
    return { event: eventView(ev) };
  });

  route('PATCH', '/api/events/:id', ({ user, body, params }) => {
    const old = requireEvent(params.id, user);
    if (old.subscriptionId) fail(409, 'Dieser Termin kommt aus einem Kalender-Abo und kann hier nicht bearbeitet werden.');
    const ev = cleanEvent(body, old);
    if (body.calendarId && body.calendarId !== old.calendarId) {
      requireCalendar(body.calendarId, user);
      ev.calendarId = body.calendarId;
    }
    ev.updatedAt = now();
    ev.updatedBy = user.id;
    db.events[ev.id] = ev;
    save();
    notifyCalendar(old.calendarId, { type: 'events', calendarId: old.calendarId });
    if (ev.calendarId !== old.calendarId) notifyCalendar(ev.calendarId, { type: 'events', calendarId: ev.calendarId });
    const onlyExdates = Object.keys(body).every((k) => k === 'exdates');
    logActivity(ev.calendarId, user.id, onlyExdates ? 'event.skip' : 'event.update', { eventId: ev.id, title: ev.title, start: ev.start, allDay: ev.allDay });
    return { event: eventView(ev) };
  });

  route('DELETE', '/api/events/:id', ({ user, params }) => {
    const ev = requireEvent(params.id, user);
    if (ev.subscriptionId) fail(409, 'Dieser Termin kommt aus einem Kalender-Abo. Entferne stattdessen das Abo in den Kalender-Einstellungen.');
    deleteEventData(ev);
    save();
    notifyCalendar(ev.calendarId, { type: 'events', calendarId: ev.calendarId });
    logActivity(ev.calendarId, user.id, 'event.delete', { title: ev.title });
    return { ok: true };
  });

  route('POST', '/api/events/:id/attend', ({ user, body, params }) => {
    const ev = requireEvent(params.id, user);
    const set = new Set(ev.attendees || []);
    const was = set.has(user.id);
    if (body.going) set.add(user.id);
    else set.delete(user.id);
    ev.attendees = [...set];
    save();
    notifyCalendar(ev.calendarId, { type: 'events', calendarId: ev.calendarId });
    if (body.going && !was) logActivity(ev.calendarId, user.id, 'attend', { eventId: ev.id, title: ev.title });
    return { event: eventView(ev) };
  });

  route('POST', '/api/events/:id/react', ({ user, body, params }) => {
    const ev = requireEvent(params.id, user);
    if (!REACTIONS.includes(body.emoji)) fail(400, 'Diese Reaktion gibt es nicht.');
    ev.reactions ||= {};
    const set = new Set(ev.reactions[body.emoji] || []);
    const added = !set.has(user.id);
    if (added) set.add(user.id);
    else set.delete(user.id);
    if (set.size) ev.reactions[body.emoji] = [...set];
    else delete ev.reactions[body.emoji];
    save();
    notifyCalendar(ev.calendarId, { type: 'events', calendarId: ev.calendarId });
    notifyCalendar(ev.calendarId, { type: 'reaction', eventId: ev.id, userId: user.id, emoji: body.emoji, added }, { except: user.id });
    if (added) logActivity(ev.calendarId, user.id, 'react', { eventId: ev.id, title: ev.title, emoji: body.emoji });
    return { event: eventView(ev) };
  });

  route('POST', '/api/events/:id/typing', ({ user, params }) => {
    const ev = requireEvent(params.id, user);
    notifyCalendar(ev.calendarId, { type: 'typing', eventId: ev.id, userId: user.id }, { except: user.id });
    return { ok: true };
  });

  // Kommentare
  route('GET', '/api/events/:id/comments', ({ user, params }) => {
    const ev = requireEvent(params.id, user);
    const list = Object.values(db.comments)
      .filter((c) => c.eventId === ev.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      comments: list.map((c) => ({ ...c, author: db.users[c.userId] ? publicUser(db.users[c.userId]) : null })),
    };
  });

  route('POST', '/api/events/:id/comments', ({ user, body, params }) => {
    const ev = requireEvent(params.id, user);
    const text = str(body.text, 2000).trim();
    if (!text) fail(400, 'Der Kommentar ist leer.');
    const c = { id: newId(), eventId: ev.id, userId: user.id, text, createdAt: now() };
    db.comments[c.id] = c;
    save();
    notifyCalendar(ev.calendarId, { type: 'comments', calendarId: ev.calendarId, eventId: ev.id });
    logActivity(ev.calendarId, user.id, 'comment', { eventId: ev.id, title: ev.title, text: text.slice(0, 120) });
    return { comment: { ...c, author: publicUser(user) } };
  });

  route('DELETE', '/api/comments/:id', ({ user, params }) => {
    const c = db.comments[params.id];
    if (!c || c.userId !== user.id) fail(404, 'Kommentar nicht gefunden.');
    const ev = db.events[c.eventId];
    delete db.comments[c.id];
    save();
    if (ev) notifyCalendar(ev.calendarId, { type: 'comments', calendarId: ev.calendarId, eventId: ev.id });
    return { ok: true };
  });

  // Kalender importieren (Datei oder Link)
  route('POST', '/api/import', async ({ user, body }) => {
    const tz = isValidTz(body.tz) ? body.tz : 'UTC';
    let text = typeof body.ics === 'string' ? body.ics : null;
    let url = null;
    if (!text) {
      if (!body.url) fail(400, 'Bitte wähle eine Datei oder gib einen Link ein.');
      try {
        url = normalizeCalendarUrl(body.url);
        text = await fetchCalendarText(url);
      } catch (e) {
        fail(400, e.message);
      }
    }
    let parsed;
    try {
      parsed = parseIcs(text, tz);
    } catch (e) {
      fail(400, e.message);
    }

    let cal;
    let created = false;
    if (body.calendarId) cal = requireCalendar(body.calendarId, user);
    else {
      const nc = body.newCalendar || {};
      const name = str(nc.name, 60).trim() || parsed.name || str(body.fallbackName, 60).trim() || 'Importierter Kalender';
      cal = createCalendar(user, { ...nc, name });
      created = true;
    }

    let count;
    if (url && body.subscribe) {
      const sub = {
        id: newId(9),
        calendarId: cal.id,
        url,
        name: str(body.name, 60).trim() || parsed.name || new URL(url).host,
        tz,
        createdBy: user.id,
        createdAt: now(),
        lastSync: now(),
        lastAttempt: now(),
        error: null,
      };
      db.subscriptions[sub.id] = sub;
      count = importEvents(cal, parsed.events, { subscription: sub, user });
    } else {
      count = importEvents(cal, parsed.events, { user });
    }
    save();
    if (created) push(user.id, { type: 'calendars' });
    notifyCalendar(cal.id, { type: 'calendars' });
    if (!created) logActivity(cal.id, user.id, 'import', { title: cal.name, count });
    return { count, calendarId: cal.id, createdCalendar: created };
  });

  route('POST', '/api/subscriptions/:id/sync', async ({ user, params }) => {
    const sub = db.subscriptions[params.id];
    if (!sub) fail(404, 'Abo nicht gefunden.');
    requireCalendar(sub.calendarId, user);
    try {
      const count = await syncSubscription(sub);
      return { count };
    } catch (e) {
      fail(400, e.message);
    }
  });

  route('DELETE', '/api/subscriptions/:id', ({ user, params }) => {
    const sub = db.subscriptions[params.id];
    if (!sub) fail(404, 'Abo nicht gefunden.');
    requireCalendar(sub.calendarId, user);
    for (const ev of Object.values(db.events)) if (ev.subscriptionId === sub.id) deleteEventData(ev);
    delete db.subscriptions[sub.id];
    save();
    notifyCalendar(sub.calendarId, { type: 'calendars' });
    return { ok: true };
  });

  // ---------- Anfragen beantworten ----------

  function authenticate(token) {
    if (!token) return null;
    const id = tokenIndex.get(hash(token));
    return id ? db.users[id] : null;
  }

  async function handle(method, pathname, { token = null, body = {}, query = new URLSearchParams() } = {}) {
    let match = null;
    let r;
    for (r of routes) {
      if (r.method !== method) continue;
      match = r.re.exec(pathname);
      if (match) break;
    }
    if (!match) fail(404, 'Nicht gefunden.');
    const user = authenticate(token);
    if (r.auth && !user) fail(401, 'Nicht angemeldet.');
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
    const result = await r.handler({ user, body: body && typeof body === 'object' ? body : {}, params, query });
    return result ?? { ok: true };
  }

  // Kalender als .ics-Abo (für Apple/Google/Outlook)
  function feed(feedToken) {
    const cal = Object.values(db.calendars).find((c) => c.feedToken === feedToken);
    if (!cal) return null;
    return { calendar: cal, events: Object.values(db.events).filter((e) => e.calendarId === cal.id) };
  }

  return { handle, authenticate, feed, syncDue, onlineContacts, announcePresence };
}

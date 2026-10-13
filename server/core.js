// Zeitgarten – die eigentliche Logik (Kalender, Einladungen, Termine, Neuigkeiten …) ohne HTTP.
// Läuft auf dem Server (server/index.js) und in der Demo direkt im Browser (demo/api.js).
import { parseIcs } from './ics.js';
import { occurrences } from '../public/js/recur.js';
import { dayNum, fromDayNum, isValidTz, isYmd, pad, wallParts, zonedToUtc } from '../public/js/time.js';

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
 * @param {object} [deps.caldav]  iPhone/iCloud-Import: { discover(creds), fetchEvents(creds, url) }
 * @param {Function} [deps.sealSecret]  (text) – verschlüsselt Zugangsdaten zum Speichern
 * @param {Function} [deps.openSecret]  (sealed) – entschlüsselt sie wieder
 */
export function createCore({
  db, save, newId, hash, push, isConnected, fetchCalendarText, normalizeCalendarUrl,
  caldav = null, sealSecret = null, openSecret = null,
}) {
  // ---------- Hilfsfunktionen ----------

  const now = () => new Date().toISOString();
  const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);

  const fail = (status, message) => {
    throw new HttpError(status, message);
  };

  // ---------- Anmeldung: jedes Gerät hat einen eigenen Token ----------
  // user.tokens = [{ hash, createdAt, usedAt }]. user.tokenHash spiegelt tokens[0] – so bleibt
  // das erste Gerät angemeldet, falls jemand auf eine ältere Version zurückgeht.
  const MAX_DEVICES = 30;
  const tokenIndex = new Map(); // hash -> userId
  let migrated = false;

  const syncLegacyToken = (u) => {
    if (u.tokens[0]) u.tokenHash = u.tokens[0].hash;
    else delete u.tokenHash;
  };

  for (const u of Object.values(db.users)) {
    if (!Array.isArray(u.tokens)) u.tokens = [];
    u.tokens = u.tokens.filter((t) => t && typeof t.hash === 'string');
    if (u.tokenHash && !u.tokens.some((t) => t.hash === u.tokenHash)) {
      // Altes Format (ein Token pro Person) – oder eine ältere Version hat den ersten Token erneuert
      const entry = { hash: u.tokenHash, createdAt: u.createdAt || now() };
      if (u.tokens.length) u.tokens[0] = entry;
      else u.tokens.push(entry);
      migrated = true;
    }
    for (const t of u.tokens) tokenIndex.set(t.hash, u.id);
  }

  // Neuer Token für ein Gerät; mit replace wird nur der Token dieses einen Geräts ersetzt
  function issueToken(user, replace = null) {
    const token = newId(24);
    const entry = { hash: hash(token), createdAt: now(), usedAt: now() };
    user.tokens ||= [];
    const i = replace ? user.tokens.findIndex((t) => t.hash === replace) : -1;
    if (i >= 0) {
      tokenIndex.delete(user.tokens[i].hash);
      user.tokens[i] = entry;
    } else {
      user.tokens.push(entry);
      // Höchstens MAX_DEVICES Geräte – das am längsten nicht benutzte fliegt raus
      while (user.tokens.length > MAX_DEVICES) {
        const last = (t) => t.usedAt || t.createdAt || '';
        const oldest = user.tokens.reduce((a, t, j) => (last(t) < last(user.tokens[a]) ? j : a), 0);
        tokenIndex.delete(user.tokens[oldest].hash);
        user.tokens.splice(oldest, 1);
      }
    }
    tokenIndex.set(entry.hash, user.id);
    syncLegacyToken(user);
    return token;
  }

  // ---------- Mitglieder ----------

  // Jedes Mitglied hat einen eigenen Abo-Link (/feed/<feedToken>.ics). Wer geht oder entfernt wird, nimmt ihn mit.
  function addMember(calId, userId, role) {
    const m = { calendarId: calId, userId, role, joinedAt: now(), feedToken: newId(18) };
    db.members.push(m);
    return m;
  }

  // Früher teilten sich alle Mitglieder einen Abo-Link pro Kalender. Wer ihn hatte, lässt sich nicht mehr
  // feststellen (auch Leute, die längst entfernt wurden) – deshalb bekommt jetzt jedes Mitglied einen neuen,
  // persönlichen Link. Der alte zeigt nur noch einen Hinweis, dass er erneuert wurde.
  for (const m of db.members) {
    if (!m.feedToken) {
      m.feedToken = newId(18);
      migrated = true;
    }
  }
  for (const cal of Object.values(db.calendars)) {
    if (!cal.feedToken) continue;
    db.retiredFeeds ||= {};
    db.retiredFeeds[cal.feedToken] = cal.id;
    delete cal.feedToken;
    migrated = true;
  }
  if (migrated) save();

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

  const publicUser = (u) => ({ id: u.id, name: u.name, color: u.color, emoji: u.emoji || null });

  // Profilbild als Emoji: genau eines – auch zusammengesetzte (👨‍👩‍👧, ❤️‍🔥) und mit Hautfarbe (👍🏽) oder Flaggen (🇩🇪)
  const graphemes = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('de', { granularity: 'grapheme' })
    : null;
  function cleanEmoji(v) {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') fail(400, 'Bitte wähle genau ein Emoji aus.');
    const e = v.trim();
    if (!e) return null;
    const pictos = (s) => (s.match(/\p{Extended_Pictographic}/gu) || []).length;
    const flags = (e.match(/\p{Regional_Indicator}/gu) || []).length;
    const ok = e.length <= 16
      && /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200D\uFE0F\u20E3]+$/u.test(e)
      && !/[\p{L}\p{N}#*]/u.test(e) // keine Buchstaben, Ziffern oder Tasten-Emojis wie 1️⃣
      && (flags ? flags === 2 && !pictos(e) : e.split('\u200D').every((part) => pictos(part) === 1))
      && (!graphemes || [...graphemes.segment(e)].length === 1);
    if (!ok) fail(400, 'Bitte wähle genau ein Emoji aus.');
    return e;
  }

  const isIcloudHost = (hostname) => /(^|\.)icloud\.com$/i.test(hostname);
  // „iCloud“ oder der Name des CalDAV-Servers
  function caldavHost(server) {
    if (!server) return 'iCloud';
    const u = new URL(server);
    return isIcloudHost(u.hostname) ? 'iCloud' : u.host;
  }

  // Wie die Zugangsdaten angezeigt werden dürfen: g••••@icloud.com
  function maskAccount(name) {
    const [local, domain] = String(name).split(/@(?=[^@]*$)/);
    return `${[...local][0] || ''}••••${domain ? `@${domain}` : ''}`;
  }

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
      feedToken: membership(cal.id, user.id)?.feedToken || null, // persönlicher Abo-Link
      members: membersOf(cal.id)
        .filter((m) => db.users[m.userId])
        .map((m) => ({ ...publicUser(db.users[m.userId]), role: m.role, joinedAt: m.joinedAt })),
      subscriptions: subs.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.type === 'caldav' ? 'caldav' : 'ics',
        host: s.type === 'caldav' ? caldavHost(s.server) : new URL(s.url).host,
        account: s.type === 'caldav' ? s.account || null : null,
        lastSync: s.lastSync,
        error: s.error || null,
        count: subCounts[s.id] || 0,
      })),
    };
  }

  function eventView(ev, commentCounts) {
    const { createdBy, ...rest } = ev;
    return { ...rest, attendeesByOcc: ev.attendeesByOcc || {}, createdBy, commentCount: commentCounts?.[ev.id] || 0 };
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
      createdAt: now(),
    };
    db.calendars[cal.id] = cal;
    addMember(cal.id, user.id, 'owner');
    return cal;
  }

  function deleteEventData(ev) {
    delete db.events[ev.id];
    for (const c of Object.values(db.comments)) if (c.eventId === ev.id) delete db.comments[c.id];
  }

  // Wer einen Kalender verlässt, nimmt die eigene iPhone-Verbindung mit – die Zugangsdaten gehören nur ihr bzw. ihm
  function dropCaldavOf(calId, userId) {
    for (const s of Object.values(db.subscriptions)) {
      if (s.calendarId !== calId || s.type !== 'caldav' || s.createdBy !== userId) continue;
      for (const ev of Object.values(db.events)) if (ev.subscriptionId === s.id) deleteEventData(ev);
      delete db.subscriptions[s.id];
    }
  }

  function deleteCalendar(cal) {
    for (const ev of Object.values(db.events)) if (ev.calendarId === cal.id) deleteEventData(ev);
    for (const s of Object.values(db.subscriptions)) if (s.calendarId === cal.id) delete db.subscriptions[s.id];
    db.members = db.members.filter((m) => m.calendarId !== cal.id);
    for (const [t, id] of Object.entries(db.retiredFeeds || {})) if (id === cal.id) delete db.retiredFeeds[t];
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

  // ---------- Einzelne Tage einer Serie ----------

  // Ein Tag einer Serie wird so bezeichnet wie in public/js/recur.js (o.orig):
  // 'YYYY-MM-DD' bei ganztägigen Serien, sonst der Beginn als ISO-Zeit in UTC
  function cleanOccurrence(ev, raw) {
    if (typeof raw !== 'string' || raw.length > 40) fail(400, 'Ungültiges Datum.');
    if (ev.allDay) {
      if (!isYmd(raw) || Number.isNaN(Date.parse(raw)) || raw < ev.start) fail(400, 'Ungültiges Datum.');
      return raw;
    }
    const t = Date.parse(raw);
    if (Number.isNaN(t) || t < Date.parse(ev.start) - 864e5) fail(400, 'Ungültiges Datum.');
    return new Date(t).toISOString();
  }

  const isExdate = (ev, occ) => (ev.exdates || []).some((x) => (ev.allDay ? String(x).slice(0, 10) === occ : Date.parse(x) === Date.parse(occ)));

  // Wer an diesem Tag dabei ist – ohne eigenen Eintrag gilt die Zusage für die ganze Serie
  const attendeesFor = (ev, occ) => (ev.rrule && occ && ev.attendeesByOcc && Object.hasOwn(ev.attendeesByOcc, occ)
    ? ev.attendeesByOcc[occ]
    : ev.attendees || []);

  const MAX_OCC_ENTRIES = 1000;
  function setOccAttendees(ev, occ, list) {
    ev.attendeesByOcc ||= {};
    ev.attendeesByOcc[occ] = list;
    const keys = Object.keys(ev.attendeesByOcc);
    // Sehr alte Tage zuerst vergessen (ISO-Zeiten und Daten sortieren sich zeitlich)
    if (keys.length > MAX_OCC_ENTRIES) for (const k of keys.sort().slice(0, keys.length - MAX_OCC_ENTRIES)) delete ev.attendeesByOcc[k];
  }

  function dropOccAttendees(ev, occ) {
    if (!ev.attendeesByOcc) return;
    for (const k of Object.keys(ev.attendeesByOcc)) {
      if (ev.allDay ? k === String(occ).slice(0, 10) : Date.parse(k) === Date.parse(occ)) delete ev.attendeesByOcc[k];
    }
  }

  // Wird eine Serie verschoben (andere Uhrzeit oder anderer Tag), wandern abgesagte Tage und Zusagen
  // für einzelne Tage mit – sonst tauchten abgesagte Tage nach dem Verschieben wieder auf.
  function shiftSeriesDates(old, ev, { exdates = true } = {}) {
    if (!old.rrule || !ev.rrule || !old.allDay !== !ev.allDay || (old.start === ev.start && old.tz === ev.tz)) return;
    const ymdNum = (v) => (isYmd(String(v).slice(0, 10)) ? dayNum(...String(v).slice(0, 10).split('-').map(Number)) : NaN);
    let shift;
    if (ev.allDay) {
      const delta = ymdNum(ev.start) - ymdNum(old.start);
      if (!delta) return;
      shift = (k) => {
        const n = ymdNum(k);
        if (Number.isNaN(n)) return k;
        const { y, m, d } = fromDayNum(n + delta);
        return `${y}-${pad(m)}-${pad(d)}`;
      };
    } else {
      const oldTz = isValidTz(old.tz) ? old.tz : 'UTC';
      const newTz = isValidTz(ev.tz) ? ev.tz : 'UTC';
      const t0 = Date.parse(old.start);
      if (Number.isNaN(t0) || Number.isNaN(Date.parse(ev.start))) return;
      const o = wallParts(t0, oldTz);
      const n = wallParts(Date.parse(ev.start), newTz);
      const delta = dayNum(n.y, n.m, n.d) - dayNum(o.y, o.m, o.d);
      shift = (k) => {
        const t = Date.parse(k);
        if (Number.isNaN(t)) return k;
        const w = wallParts(t, oldTz);
        const { y, m, d } = fromDayNum(dayNum(w.y, w.m, w.d) + delta);
        return new Date(zonedToUtc(y, m, d, n.h, n.mi, n.s, newTz)).toISOString();
      };
    }
    if (exdates) ev.exdates = ev.exdates.map(shift);
    if (ev.attendeesByOcc) ev.attendeesByOcc = Object.fromEntries(Object.entries(ev.attendeesByOcc).map(([k, v]) => [shift(k), v]));
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

  // ---------- Wann habt ihr Zeit? (nur frei/belegt) ----------
  // Belegt sind Termine mit Uhrzeit (auch Serien und importierte Kalender) und mehrtägige ganztägige Termine
  // (Urlaub & Co.) – einzelne ganztägige Termine wie Geburtstage blockieren nichts. In gemeinsamen Kalendern
  // zählt ein Termin nur für die, die ihn eingetragen haben oder dabei sind – Mamas Zahnarzt im
  // Familienkalender macht nicht die ganze Familie „belegt“.
  // Es kommen nur Zeiträume heraus, nie Titel, Orte oder Kalendernamen.
  const FREEBUSY_MAX_DAYS = 42;
  const FREEBUSY_MAX_USERS = 12;

  function busyTimes(targetId, viewerId, from, to, tz, eventsByCal) {
    let cals = calendarIdsOf(targetId);
    // Wer „Frei/Belegt teilen“ ausschaltet, zeigt nur, was ihr ohnehin gemeinsam seht
    if (targetId !== viewerId && db.users[targetId]?.shareBusy === false) {
      const shared = new Set(calendarIdsOf(viewerId));
      cals = cals.filter((id) => shared.has(id));
    }
    const rs = new Date(from - 2 * 864e5); // etwas Puffer für ganztägige Termine in anderen Zeitzonen
    const re = new Date(to + 2 * 864e5);
    const out = [];
    for (const calId of new Set(cals)) {
      const shared = membersOf(calId).length > 1;
      for (const ev of eventsByCal.get(calId) || []) {
        let span = 0;
        if (ev.allDay) {
          if (!isYmd(ev.start)) continue;
          const n0 = dayNum(...ev.start.split('-').map(Number));
          span = isYmd(ev.end) ? dayNum(...ev.end.split('-').map(Number)) - n0 : 0;
          if (span < 1) continue; // nur Urlaub & Co. (ab 2 Tagen) blockiert
        }
        let occs;
        try {
          occs = occurrences(ev, rs, re);
        } catch {
          continue;
        }
        for (const o of occs) {
          if (shared && ev.createdBy !== targetId && !attendeesFor(ev, o.orig).includes(targetId)) continue;
          let s;
          let e;
          if (o.allDay) {
            const [y, m, d] = (o.orig || ev.start).split('-').map(Number);
            const last = fromDayNum(dayNum(y, m, d) + span + 1);
            s = zonedToUtc(y, m, d, 0, 0, 0, tz);
            e = zonedToUtc(last.y, last.m, last.d, 0, 0, 0, tz);
          } else {
            s = o.start.getTime();
            e = o.end.getTime();
          }
          s = Math.max(s, from);
          e = Math.min(e, to);
          if (e > s) out.push([s, e]);
        }
      }
    }
    // Überlappende und aneinanderstoßende Zeiten zusammenfassen
    out.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of out) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([...iv]);
    }
    return merged.map(([s, e]) => [new Date(s).toISOString(), new Date(e).toISOString()]);
  }

  // Neuigkeiten („Max hat … eingetragen“)
  function logActivity(calId, userId, kind, extra = {}) {
    const u = db.users[userId];
    const a = { id: newId(8), calendarId: calId, userId, name: u?.name, color: u?.color, emoji: u?.emoji || null, kind, at: now(), ...extra };
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
      // Bei einer Datei dürfen die Termine hier bearbeitet werden: selbst abgesagte Tage einer Serie bleiben abgesagt
      const exdates = !subscription && old?.exdates?.length ? [...new Set([...p.exdates, ...old.exdates])] : p.exdates;
      const ev = {
        id: old?.id || newId(),
        calendarId: cal.id,
        title: p.title,
        allDay: p.allDay,
        start: p.start,
        end: p.end,
        tz: p.tz || null,
        rrule: p.rrule,
        exdates,
        location: p.location,
        notes: p.notes,
        // Was die Leute hier ergänzt haben, bleibt beim Aktualisieren erhalten
        color: old?.color || null,
        attendees: old?.attendees || [],
        ...(old?.attendeesByOcc ? { attendeesByOcc: old.attendeesByOcc } : {}),
        ...(old?.reactions ? { reactions: old.reactions } : {}),
        createdBy: old?.createdBy || subscription?.createdBy || user.id,
        createdAt: old?.createdAt || stamp,
        updatedAt: stamp,
        uid: p.uid || null,
        recurrenceId: p.recurrenceId || null,
        subscriptionId: subscription?.id || null,
      };
      // Serie im Abo verschoben: Zusagen für einzelne Tage wandern mit (die abgesagten Tage kommen aus dem Abo)
      if (old) shiftSeriesDates(old, ev, { exdates: false });
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

  // CalDAV liefert jeden Termin als eigenen .ics-Text – alles zu einer Liste zusammenführen
  function parseAll(texts, tz) {
    const events = [];
    for (const t of texts) {
      let parsed;
      try {
        parsed = parseIcs(t, tz);
      } catch {
        continue; // einzelne kaputte Einträge überspringen
      }
      for (const ev of parsed.events) events.push(ev);
      if (events.length >= 20000) break;
    }
    return events;
  }

  function caldavCreds(sealed) {
    try {
      return JSON.parse(openSecret(sealed));
    } catch {
      throw new Error('Die gespeicherten Zugangsdaten passen nicht mehr. Bitte verbinde den Kalender neu.');
    }
  }

  async function loadSubscription(sub) {
    if (sub.type !== 'caldav') return parseIcs(await fetchCalendarText(sub.url), sub.tz).events;
    if (!caldav || !openSecret) throw new Error('Der iPhone-Import ist hier nicht verfügbar.');
    return parseAll(await caldav.fetchEvents(caldavCreds(sub.creds), sub.url), sub.tz);
  }

  async function syncSubscription(sub) {
    const cal = db.calendars[sub.calendarId];
    if (!cal) return 0;
    sub.lastAttempt = now();
    try {
      const events = await loadSubscription(sub);
      if (!db.subscriptions[sub.id]) return 0; // in der Zwischenzeit gelöscht
      const count = importEvents(cal, events, { subscription: sub, user: { id: sub.createdBy } });
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

  // Abos, die länger als maxAge nicht aktualisiert wurden, neu laden – iPhone-Kalender öfter,
  // außer die Anmeldung klappt gerade nicht (sonst klopfen wir alle 30 Minuten mit falschem Passwort bei Apple an)
  const CALDAV_SYNC_MS = 30 * 60 * 1000;
  let syncing = false;
  async function syncDue(maxAge) {
    if (syncing) return;
    syncing = true;
    try {
      for (const sub of Object.values(db.subscriptions)) {
        const last = Date.parse(sub.lastAttempt || sub.lastSync || 0);
        const age = sub.type === 'caldav' && !sub.error ? Math.min(maxAge, CALDAV_SYNC_MS) : maxAge;
        if (Date.now() - last > age) await syncSubscription(sub).catch(() => {});
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
    const user = { id: newId(9), name, color: isColor(body.color) ? body.color : '#6366f1', createdAt: now(), tokens: [] };
    const token = issueToken(user);
    db.users[user.id] = user;
    createCalendar(user, { name: 'Mein Kalender', color: user.color, emoji: '🌿' });
    save();
    return { token, user: publicUser(user) };
  }, { auth: false });

  route('GET', '/api/me', ({ user }) => ({
    user: publicUser(user),
    prefs: user.prefs || {},
    shareBusy: user.shareBusy !== false,
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
    const emoji = 'emoji' in body ? cleanEmoji(body.emoji) : undefined; // erst prüfen, dann ändern
    if ('name' in body) user.name = str(body.name, 40).trim() || user.name;
    if (isColor(body.color)) user.color = body.color;
    if (emoji !== undefined) {
      if (emoji) user.emoji = emoji;
      else delete user.emoji;
    }
    if ('prefs' in body) user.prefs = cleanPrefs(body.prefs);
    if (typeof body.shareBusy === 'boolean') user.shareBusy = body.shareBusy;
    save();
    if ('name' in body || 'color' in body || 'emoji' in body) {
      for (const id of calendarIdsOf(user.id)) notifyCalendar(id, { type: 'calendars' });
    }
    if ('prefs' in body) push(user.id, { type: 'prefs' });
    return { user: publicUser(user), prefs: user.prefs || {}, shareBusy: user.shareBusy !== false };
  });

  // Neuer Token nur für DIESES Gerät (der bisherige gilt danach nicht mehr). Andere Geräte bleiben angemeldet –
  // außer sie wurden per /login/-Link mit genau diesem Token angemeldet.
  route('POST', '/api/me/token', ({ user, tokenHash }) => {
    const token = issueToken(user, tokenHash);
    save();
    return { token };
  });

  // ---------- Weiteres Gerät per Code verbinden (z. B. die App auf dem iPhone-Home-Bildschirm) ----------

  const PAIR_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // ohne 0/O und 1/I/L
  const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const PAIR_MS = 10 * 60 * 1000;
  const PAIR_WINDOW_MS = 10 * 60 * 1000;
  const PAIR_MAX_FAILS_IP = 10;
  const PAIR_MAX_FAILS_ALL = 300; // 31^8 mögliche Codes: auch 300 Versuche alle 10 Minuten treffen praktisch nie
  const pairCodes = new Map(); // Code ohne Strich -> { userId, expires }
  const pairFails = new Map(); // IP -> Zeitpunkte falscher Versuche
  let pairFailsAll = [];

  // Zufällige Zeichen aus newId (Zufall kommt von außen, damit das auch im Browser läuft)
  function randomCode(n) {
    let out = '';
    while (out.length < n) {
      for (const ch of newId(12)) {
        const i = B64URL.indexOf(ch);
        // 62 = 2 × 31: so ist jedes Zeichen gleich wahrscheinlich
        if (i >= 0 && i < 2 * PAIR_ALPHABET.length && out.length < n) out += PAIR_ALPHABET[i % PAIR_ALPHABET.length];
      }
    }
    return out;
  }

  function prunePairing() {
    const t = Date.now();
    for (const [c, p] of pairCodes) if (p.expires <= t) pairCodes.delete(c);
    pairFailsAll = pairFailsAll.filter((x) => t - x < PAIR_WINDOW_MS);
    for (const [ip, list] of pairFails) {
      const recent = list.filter((x) => t - x < PAIR_WINDOW_MS);
      if (recent.length) pairFails.set(ip, recent);
      else pairFails.delete(ip);
    }
  }

  route('POST', '/api/me/pair-code', ({ user }) => {
    prunePairing();
    for (const [c, p] of pairCodes) if (p.userId === user.id) pairCodes.delete(c); // nur ein Code gleichzeitig
    let code;
    do code = randomCode(8);
    while (pairCodes.has(code));
    const expires = Date.now() + PAIR_MS;
    pairCodes.set(code, { userId: user.id, expires });
    return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: new Date(expires).toISOString() };
  });

  // Schutz vor Durchprobieren: pro Adresse und insgesamt nur wenige falsche Versuche in 10 Minuten
  route('POST', '/api/pair', ({ body, ip }) => {
    prunePairing();
    if ((pairFails.get(ip) || []).length >= PAIR_MAX_FAILS_IP || pairFailsAll.length >= PAIR_MAX_FAILS_ALL) {
      fail(429, 'Zu viele Versuche. Warte ein paar Minuten und versuch es dann nochmal.');
    }
    const code = str(body.code, 40).toUpperCase().replace(/[\s-]/g, '');
    const p = code.length === 8 ? pairCodes.get(code) : null;
    const user = p && db.users[p.userId];
    if (!user) {
      const t = Date.now();
      if (pairFails.size > 10000) pairFails.clear(); // Notbremse für den Speicher – das Gesamt-Limit gilt weiter
      pairFails.set(ip, [...(pairFails.get(ip) || []), t]);
      pairFailsAll.push(t);
      fail(400, 'Der Code stimmt nicht oder ist abgelaufen.');
    }
    pairCodes.delete(code); // nur einmal gültig
    const token = issueToken(user);
    save();
    push(user.id, { type: 'paired' }); // das andere Gerät kann den Code jetzt ausblenden
    return { token, user: publicUser(user) };
  }, { auth: false });

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
      dropCaldavOf(cal.id, user.id);
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
    if (membership(cal.id, params.userId)) {
      notifyCalendar(cal.id, { type: 'calendars' }); // auch an die entfernte Person, damit der Kalender bei ihr verschwindet
      // Mit dem Mitgliedseintrag ist auch der persönliche Abo-Link weg
      db.members = db.members.filter((m) => !(m.calendarId === cal.id && m.userId === params.userId));
      dropCaldavOf(cal.id, params.userId);
      // Neuer Einladungslink, damit die entfernte Person nicht einfach wieder beitreten kann
      cal.inviteCode = newId(9);
      save();
    }
    return { calendar: calendarView(cal, user), inviteCode: cal.inviteCode };
  });

  // Eigenen Abo-Link erneuern (falls er in falsche Hände geraten ist)
  route('POST', '/api/calendars/:id/feed-token', ({ user, params }) => {
    const cal = requireCalendar(params.id, user);
    membership(cal.id, user.id).feedToken = newId(18);
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
    addMember(cal.id, user.id, 'member');
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

  // Wann habt ihr Zeit? – frei/belegt von mir und Leuten aus meinen Kalendern
  route('POST', '/api/freebusy', ({ user, body }) => {
    const from = Date.parse(body.from);
    const to = Date.parse(body.to);
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) fail(400, 'Ungültiger Zeitraum.');
    if (to - from > FREEBUSY_MAX_DAYS * 864e5) fail(400, `Höchstens ${FREEBUSY_MAX_DAYS} Tage auf einmal.`);
    if (!Array.isArray(body.userIds) || body.userIds.some((id) => typeof id !== 'string')) fail(400, 'Bitte wähle Personen aus.');
    const ids = [...new Set([user.id, ...body.userIds])];
    if (ids.length > FREEBUSY_MAX_USERS) fail(400, `Höchstens ${FREEBUSY_MAX_USERS} Personen auf einmal.`);
    const contacts = contactsOf(user.id);
    if (ids.some((id) => id !== user.id && (!contacts.has(id) || !db.users[id]))) {
      fail(403, 'Du kannst nur Leute aus deinen Kalendern auswählen.');
    }
    const tz = isValidTz(body.tz) ? body.tz : 'UTC';
    const cals = new Set(ids.flatMap((id) => calendarIdsOf(id)));
    const eventsByCal = new Map();
    for (const ev of Object.values(db.events)) {
      if (!cals.has(ev.calendarId)) continue;
      if (!eventsByCal.has(ev.calendarId)) eventsByCal.set(ev.calendarId, []);
      eventsByCal.get(ev.calendarId).push(ev);
    }
    return { users: ids.map((id) => ({ id, busy: busyTimes(id, user.id, from, to, tz, eventsByCal) })) };
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
    // Hat die App die abgesagten Tage selbst schon angepasst, bleiben sie, wie sie sind
    shiftSeriesDates(old, ev, { exdates: !('exdates' in body) || JSON.stringify(body.exdates) === JSON.stringify(old.exdates || []) });
    if (body.calendarId && body.calendarId !== old.calendarId) {
      requireCalendar(body.calendarId, user);
      ev.calendarId = body.calendarId;
    }
    // Nur einen Tag einer Serie abgesagt? Dann sagen die Neuigkeiten, welchen
    const onlyExdates = Object.keys(body).length > 0 && Object.keys(body).every((k) => k === 'exdates');
    const before = new Set(old.exdates || []);
    const added = onlyExdates ? ev.exdates.filter((x) => !before.has(x)) : [];
    for (const x of added) dropOccAttendees(ev, x); // Zusagen für abgesagte Tage sind hinfällig
    ev.updatedAt = now();
    ev.updatedBy = user.id;
    db.events[ev.id] = ev;
    save();
    notifyCalendar(old.calendarId, { type: 'events', calendarId: old.calendarId });
    if (ev.calendarId !== old.calendarId) notifyCalendar(ev.calendarId, { type: 'events', calendarId: ev.calendarId });
    if (added.length) {
      logActivity(ev.calendarId, user.id, 'event.skip', { eventId: ev.id, title: ev.title, occurrence: added[added.length - 1], start: ev.start, allDay: ev.allDay });
    } else {
      logActivity(ev.calendarId, user.id, 'event.update', { eventId: ev.id, title: ev.title, start: ev.start, allDay: ev.allDay });
    }
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

  // Zusagen gelten bei Serien für einen bestimmten Tag (occurrence), sonst für den ganzen Termin
  route('POST', '/api/events/:id/attend', ({ user, body, params }) => {
    const ev = requireEvent(params.id, user);
    const hasOcc = ev.rrule && body.occurrence !== undefined && body.occurrence !== null && body.occurrence !== '';
    const occ = hasOcc ? cleanOccurrence(ev, body.occurrence) : null;
    if (occ && isExdate(ev, occ)) fail(409, 'An diesem Tag findet der Termin nicht statt.');
    const set = new Set(attendeesFor(ev, occ));
    const was = set.has(user.id);
    if (body.going) set.add(user.id);
    else set.delete(user.id);
    if (occ) setOccAttendees(ev, occ, [...set]);
    else ev.attendees = [...set];
    save();
    notifyCalendar(ev.calendarId, { type: 'events', calendarId: ev.calendarId });
    if (body.going && !was) {
      logActivity(ev.calendarId, user.id, 'attend', { eventId: ev.id, title: ev.title, ...(occ ? { occurrence: occ } : {}), allDay: !!ev.allDay });
    }
    return { event: eventView(ev) };
  });

  // Nur einen Tag einer Serie ändern: Der Tag fällt aus der Serie heraus und wird ein eigener Termin
  route('POST', '/api/events/:id/detach', ({ user, body, params }) => {
    const series = requireEvent(params.id, user);
    if (series.subscriptionId) fail(409, 'Dieser Termin kommt aus einem Kalender-Abo und kann hier nicht bearbeitet werden.');
    if (!series.rrule) fail(400, 'Dieser Termin wiederholt sich nicht.');
    const occ = cleanOccurrence(series, body.occurrence);
    if (isExdate(series, occ)) fail(409, 'Dieser Tag der Serie wurde schon geändert oder abgesagt.');
    const patch = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch) ? body.patch : {};
    let calId = series.calendarId;
    if (patch.calendarId && patch.calendarId !== calId) calId = requireCalendar(patch.calendarId, user).id;

    // Ausgangspunkt ist die Serie an genau diesem Tag (gleiche Dauer)
    let base;
    if (series.allDay) {
      const span = Math.max(0, Math.round((Date.parse(series.end || series.start) - Date.parse(series.start)) / 864e5));
      const end = new Date(Date.parse(occ) + span * 864e5).toISOString().slice(0, 10);
      base = { start: occ, end };
    } else {
      const dur = Math.max(0, Date.parse(series.end) - Date.parse(series.start)) || 0;
      base = { start: occ, end: new Date(Date.parse(occ) + dur).toISOString() };
    }
    for (const k of ['title', 'allDay', 'tz', 'location', 'notes', 'color']) base[k] = series[k];
    const picked = {};
    for (const k of ['title', 'start', 'end', 'allDay', 'tz', 'location', 'notes', 'color']) if (k in patch) picked[k] = patch[k];
    const ev = cleanEvent(picked, base);
    const stamp = now();
    Object.assign(ev, {
      id: newId(),
      calendarId: calId,
      rrule: null,
      exdates: [],
      attendees: [...attendeesFor(series, occ)],
      ...(series.reactions ? { reactions: JSON.parse(JSON.stringify(series.reactions)) } : {}),
      createdBy: series.createdBy,
      createdAt: stamp,
      updatedAt: stamp,
      updatedBy: user.id,
      subscriptionId: null,
    });
    db.events[ev.id] = ev;
    series.exdates = [...(series.exdates || []), occ];
    dropOccAttendees(series, occ);
    series.updatedAt = stamp;
    series.updatedBy = user.id;
    save();
    notifyCalendar(series.calendarId, { type: 'events', calendarId: series.calendarId });
    if (calId !== series.calendarId) notifyCalendar(calId, { type: 'events', calendarId: calId });
    logActivity(calId, user.id, 'event.moveone', { eventId: ev.id, title: ev.title, occurrence: occ, start: ev.start, allDay: ev.allDay });
    return { event: eventView(ev), series: eventView(series, commentCountsFor(new Set([series.id]))) };
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

  // ---------- iPhone / iCloud (CalDAV) ----------

  const CALDAV_SESSION_MS = 15 * 60 * 1000;
  const PALETTE = ['#3d9df2', '#f59440', '#4fb477', '#ec6aa8', '#a46cf0', '#22b3a0', '#f2675b', '#e9b31f', '#6366f1'];
  const caldavSessions = new Map(); // sessionId -> { userId, server, account, creds (verschlüsselt), calendars, expires }
  const caldavAttempts = new Map(); // userId -> Zeitpunkte der letzten Anmeldeversuche

  function requireCaldav() {
    if (!caldav || !sealSecret || !openSecret) fail(501, 'Der iPhone-Import ist hier nicht verfügbar.');
  }

  function cleanCaldavCreds(body) {
    const username = str(body.username, 200).trim();
    // Apple zeigt App-Passwörter als xxxx-xxxx-xxxx-xxxx – beim Kopieren rutschen gern Leerzeichen mit
    const password = str(body.password, 200).trim();
    let server = str(body.server, 300).trim() || null;
    if (server) {
      if (!/^[a-z][a-z\d+.-]*:\/\//i.test(server)) server = `https://${server}`;
      try {
        const u = new URL(server);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
        u.username = '';
        u.password = '';
        server = u.toString();
      } catch {
        fail(400, 'Die Server-Adresse ist ungültig.');
      }
    }
    if (!username) fail(400, server ? 'Bitte gib deinen Benutzernamen ein.' : 'Bitte gib deine Apple-ID ein.');
    if (!password) fail(400, server ? 'Bitte gib dein Passwort ein.' : 'Bitte gib das App-spezifische Passwort ein.');
    return { server, username, password };
  }

  // Schutz vor Durchprobieren von Passwörtern über unseren Server
  function throttleCaldav(userId) {
    const t = Date.now();
    const recent = (caldavAttempts.get(userId) || []).filter((x) => t - x < 10 * 60 * 1000);
    if (recent.length >= 10) fail(429, 'Zu viele Versuche. Warte ein paar Minuten und versuch es dann nochmal.');
    recent.push(t);
    caldavAttempts.set(userId, recent);
  }

  function pruneCaldavSessions() {
    const t = Date.now();
    for (const [id, sess] of caldavSessions) if (sess.expires < t) caldavSessions.delete(id);
  }

  // iPhone-Kalender, die diese Person verbunden hat
  function caldavSubsOf(user) {
    const mine = new Set(calendarIdsOf(user.id));
    return Object.values(db.subscriptions).filter((s) => s.type === 'caldav' && s.createdBy === user.id && mine.has(s.calendarId));
  }
  const connectedCaldavUrls = (user) => new Set(caldavSubsOf(user).map((s) => s.url));

  route('POST', '/api/caldav/discover', async ({ user, body }) => {
    requireCaldav();
    const creds = cleanCaldavCreds(body);
    throttleCaldav(user.id);
    let found;
    try {
      found = await caldav.discover(creds);
    } catch (e) {
      // Nur die eigenen, verständlichen Meldungen weitergeben – keine technischen Interna
      fail(400, (e.code && e.message) || 'Die Verbindung hat nicht geklappt. Prüf die Angaben und versuch es nochmal.');
    }
    pruneCaldavSessions();
    for (const [id, sess] of caldavSessions) if (sess.userId === user.id) caldavSessions.delete(id);
    const account = maskAccount(creds.username);
    // Kalender ohne eigene Farbe bekommen eine, die noch nicht vergeben ist
    const used = new Set(calendarIdsOf(user.id).map((id) => db.calendars[id]?.color));
    const spare = PALETTE.filter((c) => !used.has(c));
    const calendars = (Array.isArray(found) ? found : []).slice(0, 100).map((c, i) => ({
      id: newId(6),
      url: String(c.url),
      name: str(c.name, 60).trim() || 'Kalender',
      color: isColor(c.color) ? c.color.toLowerCase() : spare.shift() || PALETTE[i % PALETTE.length],
    }));
    if (!calendars.length) fail(400, 'Es wurden keine Kalender gefunden.');
    const sealed = sealSecret(JSON.stringify(creds));
    const sessionId = newId(18);
    caldavSessions.set(sessionId, {
      userId: user.id,
      server: creds.server,
      account,
      creds: sealed,
      calendars,
      expires: Date.now() + CALDAV_SESSION_MS,
    });

    // Schon verbundene Kalender übernehmen die neuen Zugangsdaten (z. B. nach einem neuen App-Passwort)
    const urls = new Set(calendars.map((c) => c.url));
    const renewed = caldavSubsOf(user).filter((s) => urls.has(s.url));
    const repaired = renewed.filter((s) => s.error);
    for (const s of renewed) Object.assign(s, { creds: sealed, server: creds.server, account });
    if (renewed.length) save();
    for (const s of repaired) {
      syncSubscription(s).catch(() => {}).finally(() => notifyCalendar(s.calendarId, { type: 'calendars' }));
    }

    const connected = new Set(renewed.map((s) => s.url));
    return {
      sessionId,
      account,
      host: caldavHost(creds.server),
      repaired: repaired.length,
      calendars: calendars.map((c) => ({ id: c.id, name: c.name, color: c.color, connected: connected.has(c.url) })),
    };
  });

  route('POST', '/api/caldav/import', async ({ user, body }) => {
    requireCaldav();
    pruneCaldavSessions();
    const sess = caldavSessions.get(str(body.sessionId, 64));
    if (!sess || sess.userId !== user.id) fail(410, 'Die Anmeldung ist abgelaufen. Bitte verbinde dich noch einmal.');
    const ids = new Set(Array.isArray(body.calendars) ? body.calendars : []);
    const chosen = sess.calendars.filter((c) => ids.has(c.id));
    if (!chosen.length) fail(400, 'Bitte wähle mindestens einen Kalender aus.');
    const before = connectedCaldavUrls(user);
    const picked = chosen.filter((c) => !before.has(c.url));
    if (!picked.length) fail(409, chosen.length === 1 ? 'Dieser Kalender ist schon verbunden.' : 'Diese Kalender sind schon verbunden.');
    const tz = isValidTz(body.tz) ? body.tz : 'UTC';
    const creds = caldavCreds(sess.creds);
    const results = await Promise.allSettled(picked.map((c) => caldav.fetchEvents(creds, c.url)));

    const imported = [];
    const failed = [];
    const connected = connectedCaldavUrls(user); // falls parallel schon importiert wurde
    picked.forEach((c, i) => {
      const r = results[i];
      if (connected.has(c.url)) return;
      if (r.status === 'rejected') {
        failed.push({ name: c.name, error: r.reason?.message || 'Der Kalender konnte nicht geladen werden.' });
        return;
      }
      const cal = createCalendar(user, { name: c.name, color: c.color, emoji: '📱' });
      const stamp = now();
      const sub = {
        id: newId(9),
        type: 'caldav',
        calendarId: cal.id,
        url: c.url,
        server: sess.server,
        account: sess.account,
        creds: sess.creds,
        name: c.name,
        tz,
        createdBy: user.id,
        createdAt: stamp,
        lastSync: stamp,
        lastAttempt: stamp,
        error: null,
      };
      db.subscriptions[sub.id] = sub;
      const count = importEvents(cal, parseAll(r.value, tz), { subscription: sub, user });
      imported.push({ calendarId: cal.id, name: cal.name, count });
    });
    if (!imported.length) fail(failed.length ? 400 : 409, failed[0]?.error || 'Diese Kalender sind schon verbunden.');
    caldavSessions.delete(str(body.sessionId, 64));
    save();
    push(user.id, { type: 'calendars' });
    return { imported, failed, total: imported.reduce((n, x) => n + x.count, 0) };
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

  const DAY_MS = 24 * 60 * 60 * 1000;
  function userByHash(tokenHash) {
    const id = tokenHash ? tokenIndex.get(tokenHash) : null;
    const user = id ? db.users[id] : null;
    if (!user) return null;
    // Höchstens einmal am Tag merken, wann das Gerät zuletzt benutzt wurde (für das Aufräumen alter Geräte)
    const t = user.tokens.find((x) => x.hash === tokenHash);
    if (t && !(Date.now() - Date.parse(t.usedAt || 0) < DAY_MS)) {
      t.usedAt = now();
      save();
    }
    return user;
  }

  function authenticate(token) {
    if (!token || typeof token !== 'string') return null;
    return userByHash(hash(token));
  }

  // ip dient nur dem Schutz vor Durchprobieren (Kopplungs-Codes)
  async function handle(method, pathname, { token = null, body = {}, query = new URLSearchParams(), ip = 'unbekannt' } = {}) {
    let match = null;
    let r;
    for (r of routes) {
      if (r.method !== method) continue;
      match = r.re.exec(pathname);
      if (match) break;
    }
    if (!match) fail(404, 'Nicht gefunden.');
    const tokenHash = token && typeof token === 'string' ? hash(token) : null;
    const user = userByHash(tokenHash);
    if (r.auth && !user) fail(401, 'Nicht angemeldet.');
    let params;
    try {
      params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
    } catch {
      fail(400, 'Ungültige Anfrage.');
    }
    const result = await r.handler({
      user, tokenHash: user ? tokenHash : null, ip: String(ip || 'unbekannt'), body: body && typeof body === 'object' ? body : {}, params, query,
    });
    return result ?? { ok: true };
  }

  // Kalender als .ics-Abo (für Apple/Google/Outlook) – jeder persönliche Link gehört zu einem Mitglied.
  // Alte, gemeinsame Links liefern nur noch { renewed: true } (siehe oben).
  function feed(feedToken) {
    if (!feedToken || typeof feedToken !== 'string') return null;
    const m = db.members.find((x) => x.feedToken === feedToken);
    const cal = m && db.calendars[m.calendarId];
    if (cal) return { calendar: cal, events: Object.values(db.events).filter((e) => e.calendarId === cal.id) };
    const retired = db.retiredFeeds && Object.hasOwn(db.retiredFeeds, feedToken) ? db.calendars[db.retiredFeeds[feedToken]] : null;
    return retired ? { renewed: true } : null;
  }

  // Für die Link-Vorschau einer Einladung (WhatsApp, iMessage …) – nur Name des Kalenders und der Person
  function invitePreview(code) {
    const cal = typeof code === 'string' && code ? Object.values(db.calendars).find((c) => c.inviteCode === code) : null;
    if (!cal) return null;
    return { calendar: `${cal.emoji || ''} ${cal.name}`.trim(), owner: db.users[cal.ownerId]?.name || null };
  }

  return { handle, authenticate, feed, invitePreview, syncDue, onlineContacts, announcePresence };
}

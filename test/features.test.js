import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createCore, HttpError } from '../server/core.js';

// App-Logik direkt (ohne HTTP), mit austauschbaren Kalender-Quellen
function makeCore({ db = null, files = {}, caldavItems = {} } = {}) {
  db ||= { version: 1, users: {}, calendars: {}, members: [], events: {}, comments: {}, subscriptions: {}, activity: [] };
  const pushed = [];
  let saves = 0;
  const core = createCore({
    db,
    save: () => saves++,
    newId: (n = 12) => crypto.randomBytes(n).toString('base64url'),
    hash: (t) => crypto.createHash('sha256').update(t).digest('hex'),
    push: (userId, msg) => pushed.push({ userId, msg }),
    isConnected: () => false,
    fetchCalendarText: async (url) => {
      if (!(url in files)) throw new Error('nicht gefunden');
      return files[url];
    },
    normalizeCalendarUrl: (u) => u,
    caldav: {
      discover: async () => Object.keys(caldavItems).map((url) => ({ url, name: 'Privat', color: '#1badf8' })),
      fetchEvents: async (_, url) => caldavItems[url] || [],
    },
    sealSecret: (t) => t,
    openSecret: (t) => t,
  });
  const call = async (method, path, token, body, opts = {}) => {
    const u = new URL(path, 'http://x');
    try {
      return { status: 200, data: await core.handle(method, u.pathname, { token, body, query: u.searchParams, ...opts }) };
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      return { status: e.status, data: { error: e.message } };
    }
  };
  const user = async (name) => (await call('POST', '/api/users', null, { name })).data;
  return { db, core, call, user, pushed, saves: () => saves };
}

const ics = (...vevents) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//DE',
  ...vevents.flatMap((v) => ['BEGIN:VEVENT', ...v, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

// ---------- 1. Abos: Reaktionen & Co. bleiben beim Aktualisieren ----------

test('Abo per Link: Reaktionen, Zusagen, Farbe und Kommentare überleben das Aktualisieren', async () => {
  const url = 'https://example.com/verein.ics';
  const files = {
    [url]: ics(
      ['UID:fest-1', 'DTSTART:20261020T170000Z', 'DTEND:20261020T190000Z', 'SUMMARY:Sommerfest'],
      ['UID:training-1', 'DTSTART:20261013T160000Z', 'DTEND:20261013T170000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Training'],
    ),
  };
  const { db, call, user } = makeCore({ files });
  const lena = await user('Lena');
  const imp = await call('POST', '/api/import', lena.token, { url, subscribe: true, tz: 'Europe/Berlin' });
  assert.equal(imp.status, 200);
  const events = () => Object.values(db.events).filter((e) => e.calendarId === imp.data.calendarId);
  const fest = events().find((e) => e.uid === 'fest-1');
  const training = events().find((e) => e.uid === 'training-1');

  await call('POST', `/api/events/${fest.id}/react`, lena.token, { emoji: '🎉' });
  await call('POST', `/api/events/${fest.id}/attend`, lena.token, { going: true });
  await call('POST', `/api/events/${fest.id}/comments`, lena.token, { text: 'Ich bring Kuchen mit' });
  await call('POST', `/api/events/${training.id}/attend`, lena.token, { going: true, occurrence: '2026-10-20T16:00:00.000Z' });
  fest.color = '#f2675b';

  // Im Abo geändert (auch das Training eine Stunde später) -> Aktualisieren
  files[url] = files[url].replace('SUMMARY:Sommerfest', 'SUMMARY:Sommerfest (neue Uhrzeit)').replace('20261020T170000Z', '20261020T180000Z')
    .replace('DTSTART:20261013T160000Z', 'DTSTART:20261013T170000Z').replace('DTEND:20261013T170000Z', 'DTEND:20261013T180000Z');
  const sub = Object.values(db.subscriptions)[0];
  assert.deepEqual((await call('POST', `/api/subscriptions/${sub.id}/sync`, lena.token)).data, { count: 2 });
  const after = (await call('GET', `/api/events?calendarId=${imp.data.calendarId}`, lena.token)).data.events;
  const f2 = after.find((e) => e.uid === 'fest-1');
  assert.equal(f2.id, fest.id);
  assert.equal(f2.title, 'Sommerfest (neue Uhrzeit)');
  assert.deepEqual(f2.reactions, { '🎉': [lena.user.id] });
  assert.deepEqual(f2.attendees, [lena.user.id]);
  assert.equal(f2.color, '#f2675b');
  assert.equal(f2.commentCount, 1);
  const t2 = after.find((e) => e.uid === 'training-1');
  assert.deepEqual(t2.attendeesByOcc, { '2026-10-20T17:00:00.000Z': [lena.user.id] }, 'Zusage wandert mit der neuen Uhrzeit');
});

test('iPhone-Kalender (CalDAV): Reaktionen bleiben beim automatischen Aktualisieren', async () => {
  const calUrl = 'https://p42-caldav.icloud.com/1/calendars/home/';
  const caldavItems = { [calUrl]: [ics(['UID:kino-1', 'DTSTART:20261014T180000Z', 'DTEND:20261014T200000Z', 'SUMMARY:Kino'])] };
  const { db, core, call, user } = makeCore({ caldavItems });
  const gabriel = await user('Gabriel');
  const found = (await call('POST', '/api/caldav/discover', gabriel.token, { username: 'g@icloud.com', password: 'abcd-efgh' })).data;
  const imp = await call('POST', '/api/caldav/import', gabriel.token, { sessionId: found.sessionId, calendars: [found.calendars[0].id], tz: 'Europe/Berlin' });
  assert.equal(imp.status, 200);
  const kino = Object.values(db.events).find((e) => e.uid === 'kino-1');
  await call('POST', `/api/events/${kino.id}/react`, gabriel.token, { emoji: '❤️' });

  caldavItems[calUrl] = [caldavItems[calUrl][0].replace('SUMMARY:Kino', 'SUMMARY:Kino 🍿')];
  const sub = Object.values(db.subscriptions)[0];
  sub.lastAttempt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  await core.syncDue(6 * 60 * 60 * 1000);
  const again = db.events[kino.id];
  assert.equal(again.title, 'Kino 🍿');
  assert.deepEqual(again.reactions, { '❤️': [gabriel.user.id] });
});

test('Datei erneut importiert: selbst abgesagte Tage einer Serie bleiben abgesagt', async () => {
  const file = ics(['UID:yoga-1', 'DTSTART:20261013T160000Z', 'DTEND:20261013T170000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Yoga']);
  const { db, call, user } = makeCore();
  const a = await user('Ana');
  const calId = (await call('GET', '/api/me', a.token)).data.calendars[0].id;
  await call('POST', '/api/import', a.token, { ics: file, calendarId: calId });
  const yoga = Object.values(db.events).find((e) => e.uid === 'yoga-1');
  await call('PATCH', `/api/events/${yoga.id}`, a.token, { exdates: ['2026-10-20T16:00:00.000Z'] });
  await call('POST', '/api/import', a.token, { ics: file, calendarId: calId });
  assert.deepEqual(db.events[yoga.id].exdates, ['2026-10-20T16:00:00.000Z']);
});

// ---------- 2. Zusagen pro Tag, einzelnen Tag ändern oder absagen ----------

async function weeklySetup() {
  const t = makeCore();
  const lena = await t.user('Lena');
  const max = await t.user('Max');
  const { calendar } = (await t.call('POST', '/api/calendars', lena.token, { name: 'WG', emoji: '🏠' })).data;
  await t.call('POST', `/api/invites/${calendar.inviteCode}/accept`, max.token);
  // Jeden Dienstag 18:30 in Berlin, ab 13.10.2026
  const { event } = (await t.call('POST', '/api/events', lena.token, {
    calendarId: calendar.id, title: 'Laufgruppe', allDay: false, tz: 'Europe/Berlin', rrule: 'FREQ=WEEKLY',
    start: '2026-10-13T16:30:00.000Z', end: '2026-10-13T17:30:00.000Z', going: true,
  })).data;
  return { ...t, lena, max, calendar, event };
}

test('Zusage für einen einzelnen Tag einer Serie', async () => {
  const { db, call, lena, max, event } = await weeklySetup();
  const d1 = '2026-10-20T16:30:00.000Z';
  const d2 = '2026-10-27T17:30:00.000Z'; // nach der Zeitumstellung: wieder 18:30 Ortszeit

  // Max sagt nur für den 20.10. zu – der erste Eintrag für den Tag übernimmt die Zusagen der ganzen Serie
  let r = await call('POST', `/api/events/${event.id}/attend`, max.token, { going: true, occurrence: d1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.event.attendeesByOcc, { [d1]: [lena.user.id, max.user.id] });
  assert.deepEqual(r.data.event.attendees, [lena.user.id], 'die Serie selbst bleibt unverändert');

  // Lena kann am 27.10. nicht
  r = await call('POST', `/api/events/${event.id}/attend`, lena.token, { going: false, occurrence: d2 });
  assert.deepEqual(r.data.event.attendeesByOcc[d2], []);
  assert.deepEqual(r.data.event.attendeesByOcc[d1], [lena.user.id, max.user.id]);

  // Andere Schreibweise derselben Zeit landet beim selben Tag
  r = await call('POST', `/api/events/${event.id}/attend`, max.token, { going: false, occurrence: '2026-10-20T18:30:00+02:00' });
  assert.deepEqual(r.data.event.attendeesByOcc[d1], [lena.user.id]);

  // Neuigkeit mit Datum
  await call('POST', `/api/events/${event.id}/attend`, max.token, { going: true, occurrence: d1 });
  const act = db.activity.at(-1);
  assert.equal(act.kind, 'attend');
  assert.equal(act.occurrence, d1);
  assert.equal(act.allDay, false);
  assert.equal(act.eventId, event.id);

  // Ungültige Tage
  assert.equal((await call('POST', `/api/events/${event.id}/attend`, max.token, { going: true, occurrence: 'morgen' })).status, 400);
  assert.equal((await call('POST', `/api/events/${event.id}/attend`, max.token, { going: true, occurrence: '2020-01-07T17:30:00.000Z' })).status, 400);

  // Ohne occurrence: wie bisher für die ganze Serie
  r = await call('POST', `/api/events/${event.id}/attend`, max.token, { going: true });
  assert.deepEqual(r.data.event.attendees, [lena.user.id, max.user.id]);

  // Einzeltermine ignorieren occurrence
  const single = (await call('POST', '/api/events', max.token, {
    calendarId: event.calendarId, title: 'Kino', allDay: false, start: '2026-10-16T18:00:00Z', end: '2026-10-16T20:00:00Z',
  })).data.event;
  assert.deepEqual(single.attendeesByOcc, {});
  r = await call('POST', `/api/events/${single.id}/attend`, lena.token, { going: true, occurrence: '2026-10-16T18:00:00.000Z' });
  assert.deepEqual(r.data.event.attendees, [lena.user.id]);
  assert.deepEqual(r.data.event.attendeesByOcc, {});
});

test('Ganztägige Serie: Zusage pro Datum (YYYY-MM-DD)', async () => {
  const { call, lena, calendar } = await weeklySetup();
  const { event } = (await call('POST', '/api/events', lena.token, {
    calendarId: calendar.id, title: 'Putzplan', allDay: true, start: '2026-10-17', end: '2026-10-17', rrule: 'FREQ=WEEKLY',
  })).data;
  const r = await call('POST', `/api/events/${event.id}/attend`, lena.token, { going: true, occurrence: '2026-10-24' });
  assert.deepEqual(r.data.event.attendeesByOcc, { '2026-10-24': [lena.user.id] });
  assert.equal((await call('POST', `/api/events/${event.id}/attend`, lena.token, { going: true, occurrence: '2026-10-24T00:00:00Z' })).status, 400);
  assert.equal((await call('POST', `/api/events/${event.id}/attend`, lena.token, { going: true, occurrence: '2026-10-10' })).status, 400);
});

test('Nur einen Tag einer Serie ändern (detach)', async () => {
  const { db, call, lena, max, event, calendar } = await weeklySetup();
  const d1 = '2026-10-20T16:30:00.000Z';
  await call('POST', `/api/events/${event.id}/attend`, max.token, { going: true, occurrence: d1 });
  await call('POST', `/api/events/${event.id}/react`, max.token, { emoji: '🔥' });
  await call('POST', `/api/events/${event.id}/comments`, max.token, { text: 'Bin dabei' });
  const before = db.activity.length;

  // Am 20.10. eine Stunde später und woanders
  const r = await call('POST', `/api/events/${event.id}/detach`, lena.token, {
    occurrence: d1,
    patch: { title: 'Laufgruppe (Halbmarathon-Training)', start: '2026-10-20T17:30:00.000Z', end: '2026-10-20T19:00:00.000Z', allDay: false, tz: 'Europe/Berlin', location: 'Stadion', notes: '', color: null },
  });
  assert.equal(r.status, 200);
  const { event: one, series } = r.data;
  assert.notEqual(one.id, event.id);
  assert.equal(one.title, 'Laufgruppe (Halbmarathon-Training)');
  assert.equal(one.start, '2026-10-20T17:30:00.000Z');
  assert.equal(one.location, 'Stadion');
  assert.equal(one.rrule, null);
  assert.deepEqual(one.exdates, []);
  assert.equal(one.calendarId, calendar.id);
  assert.deepEqual(one.attendees, [lena.user.id, max.user.id], 'Zusagen dieses Tages wandern mit');
  assert.deepEqual(one.reactions, { '🔥': [max.user.id] });
  assert.equal(one.createdBy, lena.user.id);
  assert.deepEqual(series.exdates, [d1]);
  assert.deepEqual(series.attendeesByOcc, {});
  assert.equal(series.commentCount, 1);
  assert.equal(series.rrule, 'FREQ=WEEKLY');

  // Genau eine Neuigkeit
  assert.equal(db.activity.length, before + 1);
  const act = db.activity.at(-1);
  assert.equal(act.kind, 'event.moveone');
  assert.deepEqual(
    { eventId: act.eventId, title: act.title, occurrence: act.occurrence, start: act.start, allDay: act.allDay },
    { eventId: one.id, title: one.title, occurrence: d1, start: one.start, allDay: false },
  );

  // Denselben Tag nicht doppelt herauslösen; Reaktionen sind kopiert, nicht geteilt
  assert.equal((await call('POST', `/api/events/${event.id}/detach`, lena.token, { occurrence: d1, patch: {} })).status, 409);
  db.events[one.id].reactions['🔥'].push('x');
  assert.deepEqual(db.events[event.id].reactions, { '🔥': [max.user.id] });

  // Ohne Änderungen: gleicher Tag, gleiche Dauer
  const d2 = '2026-11-03T17:30:00.000Z';
  const plain = (await call('POST', `/api/events/${event.id}/detach`, max.token, { occurrence: d2 })).data.event;
  assert.equal(plain.start, d2);
  assert.equal(plain.end, '2026-11-03T18:30:00.000Z');
  assert.equal(plain.title, 'Laufgruppe');
  assert.equal(plain.tz, 'Europe/Berlin');

  // Fehlerfälle
  const single = (await call('POST', '/api/events', lena.token, { calendarId: calendar.id, title: 'x', allDay: true, start: '2026-10-30', end: '2026-10-30' })).data.event;
  assert.equal((await call('POST', `/api/events/${single.id}/detach`, lena.token, { occurrence: '2026-10-30' })).status, 400);
  assert.equal((await call('POST', `/api/events/${event.id}/detach`, lena.token, { occurrence: 'quatsch' })).status, 400);
  const eve = await (async () => (await call('POST', '/api/users', null, { name: 'Eve' })).data)();
  assert.equal((await call('POST', `/api/events/${event.id}/detach`, eve.token, { occurrence: d2 })).status, 404);
  const { calendar: other } = (await call('POST', '/api/calendars', eve.token, { name: 'Eves' })).data;
  assert.equal((await call('POST', `/api/events/${event.id}/detach`, lena.token, { occurrence: '2026-11-10T17:30:00.000Z', patch: { calendarId: other.id } })).status, 404);
});

test('Ganztägige Serie: einen Tag herauslösen und in einen anderen Kalender legen', async () => {
  const { db, call, lena } = await weeklySetup();
  const mine = (await call('GET', '/api/me', lena.token)).data.calendars.find((c) => c.name === 'Mein Kalender');
  const { event } = (await call('POST', '/api/events', lena.token, {
    calendarId: mine.id, title: 'Wochenendtrip', allDay: true, start: '2026-10-17', end: '2026-10-18', rrule: 'FREQ=MONTHLY',
  })).data;
  const wg = (await call('GET', '/api/me', lena.token)).data.calendars.find((c) => c.name === 'WG');
  const r = await call('POST', `/api/events/${event.id}/detach`, lena.token, { occurrence: '2026-11-17', patch: { calendarId: wg.id } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.event.start, r.data.event.end, r.data.event.allDay, r.data.event.calendarId], ['2026-11-17', '2026-11-18', true, wg.id]);
  assert.deepEqual(r.data.series.exdates, ['2026-11-17']);
  assert.equal(db.activity.at(-1).calendarId, wg.id);
  assert.equal(db.activity.at(-1).allDay, true);
});

test('Einen Tag absagen: Neuigkeit sagt welchen', async () => {
  const { db, call, lena, max, event } = await weeklySetup();
  const d1 = '2026-10-20T16:30:00.000Z';
  await call('POST', `/api/events/${event.id}/attend`, max.token, { going: true, occurrence: d1 });
  const r = await call('PATCH', `/api/events/${event.id}`, lena.token, { exdates: [d1] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.event.attendeesByOcc, {}, 'Zusagen für den abgesagten Tag verschwinden');
  let act = db.activity.at(-1);
  assert.deepEqual({ kind: act.kind, eventId: act.eventId, title: act.title, occurrence: act.occurrence, allDay: act.allDay },
    { kind: 'event.skip', eventId: event.id, title: 'Laufgruppe', occurrence: d1, allDay: false });
  // Für einen abgesagten Tag kann man nicht zusagen
  assert.equal((await call('POST', `/api/events/${event.id}/attend`, max.token, { going: true, occurrence: d1 })).status, 409);

  // Zweiter Tag dazu -> occurrence ist der neue
  const d2 = '2026-11-03T17:30:00.000Z';
  await call('PATCH', `/api/events/${event.id}`, lena.token, { exdates: [d1, d2] });
  assert.equal(db.activity.at(-1).occurrence, d2);
  // Tag wiederhergestellt oder normale Änderung -> event.update
  await call('PATCH', `/api/events/${event.id}`, lena.token, { exdates: [d2] });
  act = db.activity.at(-1);
  assert.equal(act.kind, 'event.update');
  await call('PATCH', `/api/events/${event.id}`, lena.token, { title: 'Lauftreff', exdates: [d2, d1] });
  assert.equal(db.activity.at(-1).kind, 'event.update');
});

test('Serie verschoben: abgesagte Tage und Zusagen pro Tag wandern mit', async () => {
  const { call, lena, max, event } = await weeklySetup();
  await call('POST', `/api/events/${event.id}/attend`, max.token, { going: true, occurrence: '2026-11-03T17:30:00.000Z' });
  await call('PATCH', `/api/events/${event.id}`, lena.token, { exdates: ['2026-10-20T16:30:00.000Z'] });
  // Ab jetzt mittwochs um 19:00 (Ortszeit) – wie der Editor: alle Felder, exdates unverändert
  const r = await call('PATCH', `/api/events/${event.id}`, lena.token, {
    title: 'Laufgruppe', allDay: false, tz: 'Europe/Berlin', rrule: 'FREQ=WEEKLY', exdates: ['2026-10-20T16:30:00.000Z'],
    start: '2026-10-14T17:00:00.000Z', end: '2026-10-14T18:00:00.000Z',
  });
  assert.deepEqual(r.data.event.exdates, ['2026-10-21T17:00:00.000Z']);
  // 4.11. ist nach der Zeitumstellung: 19:00 Ortszeit = 18:00 UTC
  assert.deepEqual(Object.keys(r.data.event.attendeesByOcc), ['2026-11-04T18:00:00.000Z']);

  // Ganztägig: um zwei Tage verschoben
  const { event: putz } = (await call('POST', '/api/events', lena.token, {
    calendarId: event.calendarId, title: 'Putzplan', allDay: true, start: '2026-10-17', end: '2026-10-17', rrule: 'FREQ=WEEKLY', exdates: ['2026-10-24'],
  })).data;
  const r2 = await call('PATCH', `/api/events/${putz.id}`, lena.token, { start: '2026-10-19', end: '2026-10-19' });
  assert.deepEqual(r2.data.event.exdates, ['2026-10-26']);
  // Hat die App die Tage schon selbst angepasst, bleibt es dabei
  const r3 = await call('PATCH', `/api/events/${putz.id}`, lena.token, { start: '2026-10-20', end: '2026-10-20', exdates: ['2026-10-27', '2026-11-03'] });
  assert.deepEqual(r3.data.event.exdates, ['2026-10-27', '2026-11-03']);
});

// ---------- 3. Weitere Geräte: Kopplungs-Code, mehrere Tokens ----------

test('Gerät per Code verbinden: einmal gültig, Groß-/Kleinschreibung egal, andere Geräte bleiben angemeldet', async () => {
  const { db, call, user, pushed } = makeCore();
  const lena = await user('Lena');
  const r = await call('POST', '/api/me/pair-code', lena.token);
  assert.equal(r.status, 200);
  assert.match(r.data.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  const left = Date.parse(r.data.expiresAt) - Date.now();
  assert.ok(left > 9 * 60 * 1000 && left <= 10 * 60 * 1000, String(left));
  assert.equal((await call('POST', '/api/me/pair-code', null)).status, 401);

  // Ohne Strich, klein geschrieben, mit Leerzeichen
  const typed = ` ${r.data.code.replace('-', '').toLowerCase()} `;
  const paired = await call('POST', '/api/pair', null, { code: typed }, { ip: '1.2.3.4' });
  assert.equal(paired.status, 200);
  assert.equal(paired.data.user.id, lena.user.id);
  assert.notEqual(paired.data.token, lena.token);
  assert.ok(pushed.some((p) => p.userId === lena.user.id && p.msg.type === 'paired'));
  // Beide Geräte sind angemeldet
  assert.equal((await call('GET', '/api/me', lena.token)).data.user.name, 'Lena');
  assert.equal((await call('GET', '/api/me', paired.data.token)).data.user.name, 'Lena');
  assert.equal(db.users[lena.user.id].tokens.length, 2);
  assert.ok(!JSON.stringify(db).includes(paired.data.token), 'Tokens werden nur als Hash gespeichert');

  // Nur einmal gültig
  const again = await call('POST', '/api/pair', null, { code: r.data.code }, { ip: '1.2.3.4' });
  assert.deepEqual(again, { status: 400, data: { error: 'Der Code stimmt nicht oder ist abgelaufen.' } });

  // Ein neuer Code ersetzt den alten
  const c1 = (await call('POST', '/api/me/pair-code', lena.token)).data.code;
  const c2 = (await call('POST', '/api/me/pair-code', lena.token)).data.code;
  assert.equal((await call('POST', '/api/pair', null, { code: c1 }, { ip: '5.6.7.8' })).status, 400);
  assert.equal((await call('POST', '/api/pair', null, { code: c2 }, { ip: '5.6.7.8' })).status, 200);
});

test('Kopplungs-Code läuft nach 10 Minuten ab', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-12T08:41:00Z') });
  const { call, user } = makeCore();
  const lena = await user('Lena');
  const { code } = (await call('POST', '/api/me/pair-code', lena.token)).data;
  t.mock.timers.tick(10 * 60 * 1000 + 1);
  assert.equal((await call('POST', '/api/pair', null, { code }, { ip: '1.1.1.1' })).status, 400);
});

test('Durchprobieren von Codes wird gebremst – pro Adresse und insgesamt', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-12T08:41:00Z') });
  const { call, user } = makeCore();
  const lena = await user('Lena');
  const { code } = (await call('POST', '/api/me/pair-code', lena.token)).data;
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/api/pair', null, { code: 'AAAA-AAAA' }, { ip: '6.6.6.6' })).status, 400);
  // Jetzt ist diese Adresse gesperrt – auch mit dem richtigen Code
  const blocked = await call('POST', '/api/pair', null, { code }, { ip: '6.6.6.6' });
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.error, /Zu viele Versuche/);
  // Andere Adressen gehen noch
  assert.equal((await call('POST', '/api/pair', null, { code: 'BBBB-BBBB' }, { ip: '7.7.7.7' })).status, 400);

  // Viele Adressen zusammen: Gesamt-Limit
  for (let i = 0; i < 289; i++) await call('POST', '/api/pair', null, { code: 'CCCC-CCCC' }, { ip: `10.0.${i % 250}.${1 + Math.floor(i / 250)}` });
  assert.equal((await call('POST', '/api/pair', null, { code }, { ip: '8.8.8.8' })).status, 429);

  // Nach 10 Minuten ist die Sperre vorbei
  t.mock.timers.tick(10 * 60 * 1000 + 1);
  const { code: fresh } = (await call('POST', '/api/me/pair-code', lena.token)).data;
  assert.equal((await call('POST', '/api/pair', null, { code: fresh }, { ip: '6.6.6.6' })).status, 200);
});

test('Token erneuern betrifft nur dieses Gerät', async () => {
  const { call, user } = makeCore();
  const lena = await user('Lena');
  const { code } = (await call('POST', '/api/me/pair-code', lena.token)).data;
  const phone = (await call('POST', '/api/pair', null, { code })).data.token;
  const { token: renewed } = (await call('POST', '/api/me/token', phone)).data;
  assert.equal((await call('GET', '/api/me', phone)).status, 401, 'alter Token des Handys gilt nicht mehr');
  assert.equal((await call('GET', '/api/me', renewed)).status, 200);
  assert.equal((await call('GET', '/api/me', lena.token)).status, 200, 'der Laptop bleibt angemeldet');
  assert.equal((await call('GET', '/api/me', 'quatsch')).status, 401);
});

test('Alte Daten (ein Token pro Person, gemeinsamer Abo-Link) werden sicher übernommen', async () => {
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const db = {
    version: 1,
    users: { u1: { id: 'u1', name: 'Lena', color: '#f2675b', createdAt: '2026-01-01T00:00:00.000Z', tokenHash: sha('alter-token') } },
    calendars: { c1: { id: 'c1', name: 'WG', color: '#22b3a0', emoji: '🏠', ownerId: 'u1', inviteCode: 'einladung', feedToken: 'alter-feed', createdAt: '2026-01-01T00:00:00.000Z' } },
    members: [{ calendarId: 'c1', userId: 'u1', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' }],
    events: {}, comments: {}, subscriptions: {}, activity: [],
  };
  const { core, call, saves } = makeCore({ db });
  assert.ok(saves() > 0, 'Übernahme wird gespeichert');
  // Bisheriger Token funktioniert weiter
  const me = await call('GET', '/api/me', 'alter-token');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.emoji, null);
  assert.equal(db.users.u1.tokens.length, 1);
  assert.equal(db.users.u1.tokenHash, sha('alter-token'), 'für eine ältere Version bleibt das erste Gerät gespiegelt');
  // Persönlicher Abo-Link statt des gemeinsamen
  const cal = me.data.calendars[0];
  assert.ok(cal.feedToken && cal.feedToken !== 'alter-feed');
  assert.equal(core.feed(cal.feedToken).calendar.id, 'c1');
  assert.deepEqual(core.feed('alter-feed'), { renewed: true });
  assert.equal(core.feed('gibt-es-nicht'), null);

  // Eine ältere Version hat den Token zwischendurch erneuert -> der neue gilt, der alte nicht mehr
  db.users.u1.tokenHash = sha('von-alter-version');
  const t2 = makeCore({ db });
  assert.equal((await t2.call('GET', '/api/me', 'von-alter-version')).status, 200);
  assert.equal((await t2.call('GET', '/api/me', 'alter-token')).status, 401);
});

// ---------- 4. Emoji als Profilbild ----------

test('Emoji als Profilbild: genau ein Emoji, sonst Fehler', async () => {
  const { db, call, user, pushed } = makeCore();
  const lena = await user('Lena');
  assert.equal(lena.user.emoji, null);
  const max = await user('Max');
  const { calendar } = (await call('POST', '/api/calendars', lena.token, { name: 'WG' })).data;
  await call('POST', `/api/invites/${calendar.inviteCode}/accept`, max.token);

  for (const ok of ['🦊', '👍🏽', '❤️‍🔥', '👨‍👩‍👧‍👦', '🇩🇪', '🏳️‍🌈', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🧑🏽‍🤝‍🧑🏻', '☺️']) {
    const r = await call('PATCH', '/api/me', lena.token, { emoji: ok });
    assert.equal(r.status, 200, ok);
    assert.equal(r.data.user.emoji, ok);
  }
  pushed.length = 0;
  const r = await call('PATCH', '/api/me', lena.token, { emoji: ' 🌻 ' });
  assert.equal(r.data.user.emoji, '🌻');
  assert.ok(pushed.some((p) => p.userId === max.user.id && p.msg.type === 'calendars'), 'die anderen sehen das neue Bild');

  for (const bad of ['a', 'Ab', '1️⃣', '#️⃣', '😀😀', '🇩🇪🇫🇷', '<b>', '🙂x', '😀 😀', 'x'.repeat(17), '‍', '️', 42, ['🦊'], { e: '🦊' }]) {
    const res = await call('PATCH', '/api/me', lena.token, { emoji: bad, name: 'Hacker' });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.data.error, 'Bitte wähle genau ein Emoji aus.');
  }
  assert.equal(db.users[lena.user.id].name, 'Lena', 'bei einem Fehler wird gar nichts geändert');
  assert.equal(db.users[lena.user.id].emoji, '🌻');

  // Überall, wo Personen vorkommen
  const view = (await call('GET', '/api/me', max.token)).data.calendars.find((c) => c.id === calendar.id);
  assert.equal(view.members.find((m) => m.id === lena.user.id).emoji, '🌻');
  assert.equal(view.members.find((m) => m.id === max.user.id).emoji, null);
  assert.equal((await call('GET', `/api/invites/${calendar.inviteCode}`)).data.owner.emoji, '🌻');
  const { event } = (await call('POST', '/api/events', lena.token, { calendarId: calendar.id, title: 'x', allDay: true, start: '2026-10-20' })).data;
  await call('POST', `/api/events/${event.id}/comments`, lena.token, { text: 'hi' });
  assert.equal((await call('GET', `/api/events/${event.id}/comments`, max.token)).data.comments[0].author.emoji, '🌻');
  assert.equal(db.activity.at(-1).emoji, '🌻');

  // Entfernen: null oder ''
  assert.equal((await call('PATCH', '/api/me', lena.token, { emoji: null })).data.user.emoji, null);
  await call('PATCH', '/api/me', lena.token, { emoji: '🌻' });
  assert.equal((await call('PATCH', '/api/me', lena.token, { emoji: '' })).data.user.emoji, null);
  assert.ok(!('emoji' in db.users[lena.user.id]));
});

// ---------- 5. Mitglied entfernen ----------

test('Mitglied entfernen: neuer Einladungslink, Abo-Link der Person geht nicht mehr', async () => {
  const { core, call, user, pushed } = makeCore();
  const lena = await user('Lena');
  const max = await user('Max');
  const mia = await user('Mia');
  const { calendar } = (await call('POST', '/api/calendars', lena.token, { name: 'WG', emoji: '🏠' })).data;
  const oldCode = calendar.inviteCode;
  await call('POST', `/api/invites/${oldCode}/accept`, max.token);
  await call('POST', `/api/invites/${oldCode}/accept`, mia.token);
  const feedOf = async (u) => (await call('GET', '/api/me', u.token)).data.calendars.find((c) => c.id === calendar.id).feedToken;
  const feeds = { lena: await feedOf(lena), max: await feedOf(max), mia: await feedOf(mia) };
  assert.equal(new Set(Object.values(feeds)).size, 3, 'jeder hat einen eigenen Abo-Link');
  for (const f of Object.values(feeds)) assert.equal(core.feed(f).calendar.id, calendar.id);

  // Nur die Besitzerin darf entfernen
  assert.equal((await call('DELETE', `/api/calendars/${calendar.id}/members/${mia.user.id}`, max.token)).status, 403);

  pushed.length = 0;
  const r = await call('DELETE', `/api/calendars/${calendar.id}/members/${max.user.id}`, lena.token);
  assert.equal(r.status, 200);
  assert.ok(r.data.inviteCode && r.data.inviteCode !== oldCode);
  assert.equal(r.data.calendar.inviteCode, r.data.inviteCode);
  assert.ok(!r.data.calendar.members.some((m) => m.id === max.user.id));
  assert.ok(pushed.some((p) => p.userId === max.user.id && p.msg.type === 'calendars'), 'Max bekommt Bescheid');

  // Max' Abo-Link ist tot, die der anderen gehen weiter
  assert.equal(core.feed(feeds.max), null);
  assert.equal(core.feed(feeds.lena).calendar.id, calendar.id);
  assert.equal(core.feed(feeds.mia).calendar.id, calendar.id);
  // Mit dem alten Einladungslink kommt er nicht wieder rein
  assert.equal((await call('POST', `/api/invites/${oldCode}/accept`, max.token)).status, 404);
  assert.equal((await call('GET', `/api/events?calendarId=${calendar.id}`, max.token)).data.events.length, 0);
  // Nochmal entfernen ändert nichts
  const again = await call('DELETE', `/api/calendars/${calendar.id}/members/${max.user.id}`, lena.token);
  assert.equal(again.data.inviteCode, r.data.inviteCode);

  // Wer selbst geht, nimmt seinen Abo-Link auch mit
  await call('POST', `/api/calendars/${calendar.id}/leave`, mia.token);
  assert.equal(core.feed(feeds.mia), null);

  // Eigenen Abo-Link erneuern
  const renewed = (await call('POST', `/api/calendars/${calendar.id}/feed-token`, lena.token)).data.calendar.feedToken;
  assert.notEqual(renewed, feeds.lena);
  assert.equal(core.feed(feeds.lena), null);
  assert.equal(core.feed(renewed).calendar.id, calendar.id);
});

test('Link-Vorschau einer Einladung', async () => {
  const { core, call, user } = makeCore();
  const lena = await user('Lena');
  const { calendar } = (await call('POST', '/api/calendars', lena.token, { name: 'WG Kastanienallee', emoji: '🏠' })).data;
  assert.deepEqual(core.invitePreview(calendar.inviteCode), { calendar: '🏠 WG Kastanienallee', owner: 'Lena' });
  assert.equal(core.invitePreview('falsch'), null);
  assert.equal(core.invitePreview(''), null);
});

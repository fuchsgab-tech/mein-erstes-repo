// „Wann habt ihr Zeit?“ – frei/belegt (POST /api/freebusy)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createCore, HttpError } from '../server/core.js';

function makeCore({ files = {} } = {}) {
  const db = { version: 1, users: {}, calendars: {}, members: [], events: {}, comments: {}, subscriptions: {}, activity: [] };
  const core = createCore({
    db,
    save: () => {},
    newId: (n = 12) => crypto.randomBytes(n).toString('base64url'),
    hash: (t) => crypto.createHash('sha256').update(t).digest('hex'),
    push: () => {},
    isConnected: () => false,
    fetchCalendarText: async (url) => {
      if (!(url in files)) throw new Error('nicht gefunden');
      return files[url];
    },
    normalizeCalendarUrl: (u) => u,
  });
  const call = async (method, path, token, body) => {
    try {
      return { status: 200, data: await core.handle(method, path, { token, body }) };
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      return { status: e.status, data: { error: e.message } };
    }
  };
  const user = async (name) => (await call('POST', '/api/users', null, { name })).data;
  const ownCal = (u) => Object.values(db.calendars).find((c) => c.ownerId === u.user.id).id;
  const add = (u, calendarId, ev) => call('POST', '/api/events', u.token, { calendarId, allDay: false, tz: 'Europe/Berlin', title: 'Termin', ...ev });
  return { db, call, user, ownCal, add };
}

// Anna und Ben teilen „WG“, Carl ist nirgends dabei
async function setup(opts) {
  const t = makeCore(opts);
  const anna = await t.user('Anna');
  const ben = await t.user('Ben');
  const carl = await t.user('Carl');
  const wg = (await t.call('POST', '/api/calendars', anna.token, { name: 'WG' })).data.calendar;
  await t.call('POST', `/api/invites/${wg.inviteCode}/accept`, ben.token);
  return { ...t, anna, ben, carl, wg };
}

const range = { from: '2026-10-12T00:00:00.000Z', to: '2026-10-26T00:00:00.000Z' };
const busyOf = (res, u) => res.data.users.find((x) => x.id === u.user.id).busy;

test('Frei/belegt: nur ich und Leute aus meinen Kalendern, mit Grenzen', async () => {
  const { call, anna, ben, carl } = await setup();
  const ok = await call('POST', '/api/freebusy', anna.token, { userIds: [ben.user.id], ...range });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.users.map((u) => u.id), [anna.user.id, ben.user.id], 'ich bin immer dabei');

  assert.equal((await call('POST', '/api/freebusy', anna.token, { userIds: [carl.user.id], ...range })).status, 403);
  assert.equal((await call('POST', '/api/freebusy', anna.token, { userIds: [ben.user.id, 'gibtsnicht'], ...range })).status, 403);
  assert.equal((await call('POST', '/api/freebusy', carl.token, { userIds: [anna.user.id], ...range })).status, 403);
  assert.equal((await call('POST', '/api/freebusy', null, { userIds: [], ...range })).status, 401);

  const tooLong = { from: '2026-10-01T00:00:00Z', to: '2026-11-13T00:00:00Z' }; // 43 Tage
  assert.equal((await call('POST', '/api/freebusy', anna.token, { userIds: [ben.user.id], ...tooLong })).status, 400);
  assert.equal((await call('POST', '/api/freebusy', anna.token, { userIds: [ben.user.id], from: range.to, to: range.from })).status, 400);
  assert.equal((await call('POST', '/api/freebusy', anna.token, { userIds: 'ben', ...range })).status, 400);
  const many = Array.from({ length: 12 }, (_, i) => `x${i}`);
  assert.equal((await call('POST', '/api/freebusy', anna.token, { userIds: many, ...range })).status, 400);
});

test('Frei/belegt: Serien mit abgesagten Tagen, ganztägige Termine und Zusammenfassen', async () => {
  const { call, ownCal, add, anna, ben, wg } = await setup();
  const bc = ownCal(ben);
  // Jeden Montag 20–21 Uhr (Berlin), am 19. abgesagt
  await add(ben, bc, { start: '2026-10-12T18:00:00Z', end: '2026-10-12T19:00:00Z', rrule: 'FREQ=WEEKLY', exdates: ['2026-10-19T18:00:00.000Z'] });
  // Geburtstag (ein Tag) blockiert nichts, Kurzurlaub (2 Tage) schon – ganze Tage in der Zeitzone der Anfrage
  await call('POST', '/api/events', ben.token, { calendarId: bc, title: 'Geburtstag', allDay: true, start: '2026-10-21', end: '2026-10-21' });
  await call('POST', '/api/events', ben.token, { calendarId: bc, title: 'Kurzurlaub', allDay: true, start: '2026-10-14', end: '2026-10-15' });
  // Überlappend und aneinanderstoßend -> ein Block
  await add(ben, bc, { start: '2026-10-22T08:00:00Z', end: '2026-10-22T09:00:00Z' });
  await add(ben, bc, { start: '2026-10-22T08:30:00Z', end: '2026-10-22T10:00:00Z' });
  await add(ben, bc, { start: '2026-10-22T10:00:00Z', end: '2026-10-22T11:00:00Z' });
  // Im gemeinsamen Kalender zählt ein Termin für die, die ihn eingetragen haben oder dabei sind
  await add(anna, wg.id, { start: '2026-10-20T10:00:00Z', end: '2026-10-20T11:00:00Z' });
  const { event: kino } = (await add(anna, wg.id, { start: '2026-10-21T18:00:00Z', end: '2026-10-21T20:00:00Z' })).data;
  await call('POST', `/api/events/${kino.id}/attend`, ben.token, { going: true });
  // Ragt über das Ende hinaus -> abgeschnitten
  await add(ben, bc, { start: '2026-10-25T23:00:00Z', end: '2026-10-26T02:00:00Z' });

  const res = await call('POST', '/api/freebusy', anna.token, { userIds: [ben.user.id], ...range, tz: 'Europe/Berlin' });
  assert.equal(res.status, 200);
  assert.deepEqual(busyOf(res, ben), [
    ['2026-10-12T18:00:00.000Z', '2026-10-12T19:00:00.000Z'],
    ['2026-10-13T22:00:00.000Z', '2026-10-15T22:00:00.000Z'],
    ['2026-10-21T18:00:00.000Z', '2026-10-21T20:00:00.000Z'],
    ['2026-10-22T08:00:00.000Z', '2026-10-22T11:00:00.000Z'],
    ['2026-10-25T23:00:00.000Z', '2026-10-26T00:00:00.000Z'],
  ]);
  assert.deepEqual(busyOf(res, anna), [
    ['2026-10-20T10:00:00.000Z', '2026-10-20T11:00:00.000Z'],
    ['2026-10-21T18:00:00.000Z', '2026-10-21T20:00:00.000Z'],
  ]);
});

test('Frei/belegt: importierte Abos zählen mit', async () => {
  const url = 'https://example.com/arbeit.ics';
  const files = {
    [url]: ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//DE', 'BEGIN:VEVENT', 'UID:a-1',
      'DTSTART:20261013T070000Z', 'DTEND:20261013T150000Z', 'RRULE:FREQ=DAILY;COUNT=2', 'SUMMARY:Schicht', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'),
  };
  const { call, anna, ben } = await setup({ files });
  assert.equal((await call('POST', '/api/import', ben.token, { url, subscribe: true, tz: 'Europe/Berlin' })).status, 200);
  const res = await call('POST', '/api/freebusy', anna.token, { userIds: [ben.user.id], ...range });
  assert.deepEqual(busyOf(res, ben), [
    ['2026-10-13T07:00:00.000Z', '2026-10-13T15:00:00.000Z'],
    ['2026-10-14T07:00:00.000Z', '2026-10-14T15:00:00.000Z'],
  ]);
});

test('Frei/belegt: ausgeschaltetes Teilen zeigt nur gemeinsame Kalender, und nie Titel oder Orte', async () => {
  const { call, ownCal, add, anna, ben, wg } = await setup();
  await add(ben, ownCal(ben), { title: 'Geheimes Date', location: 'Bar Rosa', start: '2026-10-16T18:00:00Z', end: '2026-10-16T20:00:00Z' });
  await add(ben, wg.id, { title: 'Putzen', location: 'Küche', start: '2026-10-17T09:00:00Z', end: '2026-10-17T10:00:00Z' });

  const before = await call('POST', '/api/freebusy', anna.token, { userIds: [ben.user.id], ...range });
  assert.equal(busyOf(before, ben).length, 2);
  const text = JSON.stringify(before.data);
  for (const secret of ['Geheimes', 'Bar Rosa', 'Putzen', 'Küche', 'WG', 'Mein Kalender', 'Ben']) assert.ok(!text.includes(secret), secret);
  for (const u of before.data.users) assert.deepEqual(Object.keys(u).sort(), ['busy', 'id']);

  assert.equal((await call('GET', '/api/me', ben.token)).data.shareBusy, true, 'Standard: an');
  const off = await call('PATCH', '/api/me', ben.token, { shareBusy: false });
  assert.equal(off.data.shareBusy, false);
  assert.equal((await call('GET', '/api/me', ben.token)).data.shareBusy, false);
  // Design-Einstellungen ändern das nicht
  await call('PATCH', '/api/me', ben.token, { prefs: { skin: 'neon' } });

  const after = await call('POST', '/api/freebusy', anna.token, { userIds: [ben.user.id], ...range });
  assert.deepEqual(busyOf(after, ben), [['2026-10-17T09:00:00.000Z', '2026-10-17T10:00:00.000Z']]);
  // Für sich selbst sieht Ben weiter alles
  const self = await call('POST', '/api/freebusy', ben.token, { userIds: [], ...range });
  assert.equal(busyOf(self, ben).length, 2);
});

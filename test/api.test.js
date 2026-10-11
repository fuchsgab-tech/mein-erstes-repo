import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let server;
let base;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeitgarten-test-'));

before(async () => {
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', DATA_DIR: dataDir } });
  base = await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => {
      const m = /http:\/\/localhost:(\d+)/.exec(String(d));
      if (m) resolve(`http://localhost:${m[1]}`);
    });
    server.on('exit', () => reject(new Error('Server ist abgestürzt')));
  });
});

after(() => {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const call = async (method, url, token, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

test('Einladen per Link, Neuigkeiten, Reaktionen, Präsenz und Design-Einstellungen', async () => {
  const lena = (await call('POST', '/api/users', null, { name: 'Lena', color: '#f2675b' })).data;
  const max = (await call('POST', '/api/users', null, { name: 'Max', color: '#3d9df2' })).data;

  const { data: { calendar } } = await call('POST', '/api/calendars', lena.token, { name: 'WG', emoji: '🏠' });
  const preview = await call('GET', `/api/invites/${calendar.inviteCode}`);
  assert.equal(preview.data.calendar.name, 'WG');
  assert.equal(preview.data.owner.name, 'Lena');

  assert.equal((await call('POST', '/api/invites/falsch/accept', max.token)).status, 404);
  await call('POST', `/api/invites/${calendar.inviteCode}/accept`, max.token);
  const maxMe = (await call('GET', '/api/me', max.token)).data;
  assert.ok(maxMe.calendars.some((c) => c.id === calendar.id));

  // Max ist live verbunden -> Lena sieht ihn als online
  const ctrl = new AbortController();
  const stream = await fetch(`${base}/api/stream?token=${max.token}`, { signal: ctrl.signal });
  const reader = stream.body.getReader();
  await reader.read();
  assert.deepEqual((await call('GET', '/api/presence', lena.token)).data.online, [max.user.id]);

  const { data: { event } } = await call('POST', '/api/events', max.token, {
    calendarId: calendar.id, title: 'WG-Abend', allDay: false, start: '2026-10-16T17:00:00Z', end: '2026-10-16T19:00:00Z', tz: 'Europe/Berlin',
  });
  await call('POST', `/api/events/${event.id}/react`, lena.token, { emoji: '❤️' });
  assert.equal((await call('POST', `/api/events/${event.id}/react`, lena.token, { emoji: '💩' })).status, 400);
  const evs = (await call('GET', '/api/events', max.token)).data.events;
  assert.deepEqual(evs.find((e) => e.id === event.id).reactions, { '❤️': [lena.user.id] });
  assert.equal((await call('POST', `/api/events/${event.id}/typing`, lena.token)).status, 200);

  const kinds = (await call('GET', '/api/activity', lena.token)).data.activity.map((a) => a.kind);
  assert.deepEqual(kinds.slice(0, 3), ['react', 'event.create', 'member.join']);

  // Fremde sehen nichts
  const eve = (await call('POST', '/api/users', null, { name: 'Eve' })).data;
  assert.equal((await call('GET', '/api/activity', eve.token)).data.activity.length, 0);
  assert.equal((await call('POST', `/api/events/${event.id}/react`, eve.token, { emoji: '❤️' })).status, 404);

  // Design-Einstellungen: nur einfache Werte werden gespeichert
  const saved = (await call('PATCH', '/api/me', lena.token, { prefs: { skin: 'aurora', kw: true, evil: '<script>', nested: { a: 1 } } })).data.prefs;
  assert.deepEqual(saved, { skin: 'aurora', kw: true });
  assert.deepEqual((await call('GET', '/api/me', lena.token)).data.prefs, { skin: 'aurora', kw: true });

  ctrl.abort();
});

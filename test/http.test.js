import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Echter Server mit Daten im alten Format – und einer beim letzten Mal kaputt geschriebenen Datei
let server;
let base;
let port;
let output = '';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeitgarten-http-'));
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

const legacy = {
  version: 1,
  users: {
    u1: { id: 'u1', name: 'Lena', color: '#f2675b', createdAt: '2026-01-01T00:00:00.000Z', tokenHash: sha('lena-token') },
    u2: { id: 'u2', name: 'Max', color: '#3d9df2', createdAt: '2026-01-02T00:00:00.000Z', tokenHash: sha('max-token') },
  },
  calendars: {
    c1: { id: 'c1', name: 'WG "Kastanie" <3', color: '#22b3a0', emoji: '🏠', ownerId: 'u1', inviteCode: 'einladung1', feedToken: 'gemeinsamer-feed', createdAt: '2026-01-01T00:00:00.000Z' },
  },
  members: [
    { calendarId: 'c1', userId: 'u1', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' },
    { calendarId: 'c1', userId: 'u2', role: 'member', joinedAt: '2026-01-02T00:00:00.000Z' },
  ],
  events: {
    e1: { id: 'e1', calendarId: 'c1', title: 'Pizza-Abend', allDay: false, start: '2026-10-16T17:00:00.000Z', end: '2026-10-16T20:00:00.000Z', tz: 'Europe/Berlin', rrule: null, exdates: [], location: '', notes: '', color: null, attendees: [], createdBy: 'u1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', subscriptionId: null },
  },
  comments: {},
  subscriptions: {},
  activity: [],
};

before(async () => {
  fs.mkdirSync(path.join(dataDir, 'backups'));
  fs.writeFileSync(path.join(dataDir, 'backups', 'zeitgarten-2026-10-11.json'), JSON.stringify(legacy));
  fs.writeFileSync(path.join(dataDir, 'zeitgarten.json'), JSON.stringify(legacy).slice(0, 300));
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', DATA_DIR: dataDir, PUBLIC_URL: '', TRUST_PROXY: '' } });
  server.stderr.on('data', (d) => (output += d));
  base = await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => {
      output += d;
      const m = /http:\/\/localhost:(\d+)/.exec(String(d));
      if (m) resolve(`http://localhost:${m[1]}`);
    });
    server.on('exit', () => reject(new Error(`Server ist abgestürzt:\n${output}`)));
  });
  port = new URL(base).port;
});

after(async () => {
  // Erst warten, bis der Server beim Beenden fertig gespeichert hat – sonst schreibt er noch in den Ordner
  const exited = server.exitCode === null && server.signalCode === null ? new Promise((r) => server.once('exit', r)) : null;
  server.kill();
  await exited;
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

// Roh-Anfrage, um den Host-Header selbst zu setzen
const raw = (url, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: url, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

const meta = (html, key) => {
  const m = new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html);
  return m ? m[1] : null;
};

test('Start mit kaputter Datei: Sicherung geladen, alte Anmeldungen gehen weiter', async () => {
  assert.match(output, /beschädigt/);
  assert.ok(fs.readdirSync(dataDir).some((f) => f.startsWith('zeitgarten.kaputt-')));
  const me = await call('GET', '/api/me', 'lena-token');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.name, 'Lena');
  assert.equal(me.data.user.emoji, null);
  assert.equal((await call('GET', '/api/me', 'max-token')).status, 200);
  assert.equal((await call('GET', '/api/me', 'falsch')).status, 401);
});

test('Link-Vorschau: allgemein auf der Startseite, persönlich bei einer Einladung', async () => {
  let res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /img-src 'self' data:/);
  let html = await res.text();
  assert.equal(meta(html, 'og:title'), 'Zeitgarten – gemeinsam planen');
  assert.equal(meta(html, 'og:type'), 'website');
  assert.equal(meta(html, 'og:image'), `${base}/og-image.png`);
  assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
  assert.equal(meta(html, 'twitter:image'), `${base}/og-image.png`);
  assert.match(html, /<script type="module" src="js\/app.js"><\/script>/);

  // Einladung: Name der Person und des Kalenders – sauber maskiert
  res = await fetch(`${base}/join/einladung1`);
  html = await res.text();
  const title = 'Lena lädt dich in „🏠 WG &quot;Kastanie&quot; &lt;3“ ein';
  assert.equal(meta(html, 'og:title'), title);
  assert.equal(meta(html, 'twitter:title'), title);
  assert.equal(meta(html, 'og:description'), 'Zeitgarten – euer gemeinsamer Kalender. Link öffnen, Namen eingeben, mitplanen.');
  assert.equal(meta(html, 'twitter:description'), 'Zeitgarten – euer gemeinsamer Kalender. Link öffnen, Namen eingeben, mitplanen.');
  assert.equal(meta(html, 'og:url'), `${base}/join/einladung1`);
  assert.equal(meta(html, 'og:image'), `${base}/og-image.png`);
  assert.match(html, /<title>Lena lädt dich in „🏠 WG &quot;Kastanie&quot; &lt;3“ ein · Zeitgarten<\/title>/);
  assert.ok(!html.includes('<3'));

  // Unbekannter Code: allgemeine Vorschau
  html = await (await fetch(`${base}/join/gibtsnicht`)).text();
  assert.equal(meta(html, 'og:title'), 'Zeitgarten – gemeinsam planen');
  assert.equal(meta(html, 'og:url'), `${base}/`);

  // Erneut abgefragt: 304
  res = await fetch(`${base}/join/einladung1`);
  const again = await fetch(`${base}/join/einladung1`, { headers: { 'if-none-match': res.headers.get('etag') } });
  assert.equal(again.status, 304);
});

test('Link-Vorschau: Host-Header wird geprüft, HTTPS hinter einem Proxy erkannt', async () => {
  let r = await raw('/join/einladung1', { host: 'evil.example"><script>alert(1)</script>' });
  let html = r.body.toString();
  assert.ok(!html.includes('<script>alert'));
  assert.equal(meta(html, 'og:image'), '/og-image.png');
  assert.equal(meta(html, 'og:url'), null);

  r = await raw('/', { host: 'kalender.example.de', 'x-forwarded-proto': 'https' });
  html = r.body.toString();
  assert.equal(meta(html, 'og:image'), 'https://kalender.example.de/og-image.png');
  assert.equal(meta(html, 'og:url'), 'https://kalender.example.de/');
});

test('Vorschaubild, Termin-Links und App-Seiten', async () => {
  const img = await fetch(`${base}/og-image.png`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await img.arrayBuffer());
  assert.ok(buf.length < 300 * 1024, `${buf.length} Bytes`);
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [1200, 630]);

  for (const p of ['/e/e1', '/e/gibtsnicht', '/login/abc', '/join/x/']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<div id="app"><\/div>/);
  }
  assert.equal((await fetch(`${base}/gibts/nicht.png`)).status, 404);
});

test('Persönliche Abo-Links; der alte gemeinsame zeigt einen Hinweis', async () => {
  const old = await fetch(`${base}/feed/gemeinsamer-feed.ics`);
  assert.equal(old.status, 200);
  const notice = await old.text();
  assert.match(notice, /SUMMARY:🔗 Zeitgarten: Dieser Abo-Link wurde erneuert/);
  assert.ok(!notice.includes('Pizza'));

  const lenaCal = (await call('GET', '/api/me', 'lena-token')).data.calendars[0];
  const maxCal = (await call('GET', '/api/me', 'max-token')).data.calendars[0];
  assert.notEqual(lenaCal.feedToken, maxCal.feedToken);
  const ics = await (await fetch(`${base}/feed/${maxCal.feedToken}.ics`)).text();
  assert.match(ics, /SUMMARY:Pizza-Abend/);
  assert.match(ics, /UID:e1@zeitgarten/);

  // Max wird entfernt: sein Link ist tot, Lenas geht weiter, neuer Einladungslink
  const r = await call('DELETE', '/api/calendars/c1/members/u2', 'lena-token');
  assert.equal(r.status, 200);
  assert.notEqual(r.data.inviteCode, 'einladung1');
  assert.equal((await fetch(`${base}/feed/${maxCal.feedToken}.ics`)).status, 404);
  assert.equal((await fetch(`${base}/feed/${lenaCal.feedToken}.ics`)).status, 200);
  const html = await (await fetch(`${base}/join/einladung1`)).text();
  assert.equal(meta(html, 'og:title'), 'Zeitgarten – gemeinsam planen');
});

test('Kaputte Anfragen bringen den Server nicht zum Absturz', async () => {
  assert.equal((await raw('/%E0%A4%A')).status, 400);
  assert.equal((await call('GET', '/api/events/%E0%A4%A/comments', 'lena-token')).status, 400);
  const bad = await fetch(`${base}/api/events`, { method: 'POST', headers: { authorization: 'Bearer lena-token' }, body: '{kaputt' });
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', '/api/pair', null, { code: 'AAAA-AAAA' })).status, 400);
  assert.deepEqual((await call('GET', '/api/health')).data, { ok: true });
});

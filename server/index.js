// Zeitgarten – Server
// Startet mit:  npm start   (danach http://localhost:3000 öffnen)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { buildIcs } from './ics.js';
import { createCore, HttpError } from './core.js';
import { fetchCalendarText, normalizeCalendarUrl, safeRequest } from './safe-fetch.js';
import { discoverCalendars, fetchCalendarEvents, secretBox } from './caldav.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(ROOT, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.resolve(ROOT, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'zeitgarten.json');
// Nur zum Entwickeln/Testen: erlaubt Kalender-Links auf localhost
const ALLOW_PRIVATE_FETCH = process.env.ALLOW_PRIVATE_FETCH === '1';
const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;

const store = openStore(DATA_FILE);

// Schlüssel für gespeicherte Zugangsdaten (iCloud-App-Passwörter): aus ZEITGARTEN_SECRET
// oder beim ersten Start zufällig erzeugt und in DATA_DIR/secret.key abgelegt (nur für den Server lesbar).
function loadSecretKey() {
  if (process.env.ZEITGARTEN_SECRET) return crypto.scryptSync(process.env.ZEITGARTEN_SECRET, 'zeitgarten-secret', 32);
  const file = path.join(DATA_DIR, 'secret.key');
  try {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error(`${file} ist beschädigt.`);
    return key;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  return key;
}
const secrets = secretBox(loadSecretKey());
const request = (url, opts) => safeRequest(url, { ...opts, allowPrivate: ALLOW_PRIVATE_FETCH });

// ---------- Live-Verbindungen (Server-Sent Events) ----------

const streams = new Map(); // userId -> Set<res>

function push(userId, payload) {
  const set = streams.get(userId);
  if (!set) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) res.write(msg);
}

setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
}, 25000).unref();

const core = createCore({
  db: store.data,
  save: store.save,
  newId: (bytes = 12) => crypto.randomBytes(bytes).toString('base64url'),
  hash: (t) => crypto.createHash('sha256').update(t).digest('hex'),
  push,
  isConnected: (userId) => streams.has(userId),
  fetchCalendarText: (url) => fetchCalendarText(url, { allowPrivate: ALLOW_PRIVATE_FETCH }),
  normalizeCalendarUrl,
  caldav: {
    discover: (creds) => discoverCalendars(creds, { request }),
    fetchEvents: (creds, url) => fetchCalendarEvents(creds, url, { request }),
  },
  sealSecret: secrets.seal,
  openSecret: secrets.open,
});

setInterval(() => core.syncDue(SYNC_EVERY_MS), 10 * 60 * 1000).unref();

// ---------- HTTP ----------

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};

function send(req, res, status, body, type) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers = { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store' };
  if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = zlib.gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

const sendJson = (req, res, status, obj) => send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8');

function readBody(req, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Die Datei ist zu groß.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function tokenOf(req, url) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
}

function openStream(req, res, user) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const first = !streams.has(user.id);
  if (first) streams.set(user.id, new Set());
  streams.get(user.id).add(res);
  res.write(`data: ${JSON.stringify({ type: 'presence', online: core.onlineContacts(user.id) })}\n\n`);
  if (first) core.announcePresence(user.id, true);
  req.on('close', () => {
    const set = streams.get(user.id);
    set?.delete(res);
    if (set && !set.size) {
      streams.delete(user.id);
      core.announcePresence(user.id, false);
    }
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(req, res, 400, 'Bad request', 'text/plain');
  }
  let file = path.resolve(PUBLIC, `.${rel}`);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(req, res, 404, 'Not found', 'text/plain');
  let stat = fs.existsSync(file) ? fs.statSync(file) : null;
  if (!stat || stat.isDirectory()) {
    // Alle Seiten ohne Dateiendung (/, /join/…, /login/…) zeigen die App
    if (path.extname(rel)) return send(req, res, 404, 'Not found', 'text/plain');
    file = path.join(PUBLIC, 'index.html');
    stat = fs.statSync(file);
  }
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  let buf = fs.readFileSync(file);
  const headers = { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag };
  if (/text|javascript|json|svg|manifest/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = zlib.gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  try {
    // Kalender-Abo für Apple/Google/Outlook
    const feed = /^\/feed\/([\w-]+)\.ics$/.exec(pathname);
    if (feed && (req.method === 'GET' || req.method === 'HEAD')) {
      const found = core.feed(feed[1]);
      if (!found) return send(req, res, 404, 'Not found', 'text/plain');
      return send(req, res, 200, buildIcs(found.calendar, found.events, req.headers.host || 'zeitgarten'), 'text/calendar; charset=utf-8');
    }

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'Method not allowed', 'text/plain');
      return serveStatic(req, res, pathname);
    }

    const token = tokenOf(req, url);
    if (pathname === '/api/stream') {
      const user = core.authenticate(token);
      if (!user) return sendJson(req, res, 401, { error: 'Nicht angemeldet.' });
      return openStream(req, res, user);
    }

    let body = {};
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const raw = await readBody(req);
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          throw new HttpError(400, 'Ungültige Anfrage.');
        }
      }
    }
    const result = await core.handle(req.method, pathname, { token, body, query: url.searchParams });
    sendJson(req, res, 200, result);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(req, res, e.status, { error: e.message });
    console.error(e);
    if (!res.headersSent) sendJson(req, res, 500, { error: 'Da ist etwas schiefgelaufen.' });
  }
});

function shutdown() {
  store.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`🌿 Zeitgarten läuft auf http://localhost:${server.address().port}`);
  console.log(`   Daten werden gespeichert in ${DATA_FILE}`);
});

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
// Hinter einem Proxy (Railway, Fly.io, Caddy …): die echte Adresse steht in X-Forwarded-For
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Öffentliche Adresse, z. B. https://kalender.example.de – sonst wird sie aus der Anfrage gebildet (nur für Link-Vorschauen)
const PUBLIC_URL = (() => {
  try {
    const u = new URL(process.env.PUBLIC_URL || '');
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
})();
const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;

// Sicherheitsnetz: Ein einzelner Fehler (z. B. in einer Anfrage) soll nicht den ganzen Server beenden.
// Klappt dagegen schon der Start nicht (Port belegt, Schlüssel kaputt …), wird mit Fehler beendet.
let started = false;
function unexpected(e) {
  if (!started) {
    console.error('Zeitgarten konnte nicht starten:', e);
    process.exit(1);
  }
  console.error('Unerwarteter Fehler – der Server läuft weiter:', e);
}
process.on('uncaughtException', unexpected);
process.on('unhandledRejection', unexpected);

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

function write(res, msg) {
  try {
    if (!res.destroyed && !res.writableEnded) res.write(msg);
  } catch {
    /* Verbindung ist schon weg – wird beim 'close' aufgeräumt */
  }
}

function push(userId, payload) {
  const set = streams.get(userId);
  if (!set) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) write(res, msg);
}

setInterval(() => {
  for (const set of streams.values()) for (const res of set) write(res, ': ping\n\n');
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

setInterval(() => core.syncDue(SYNC_EVERY_MS).catch((e) => console.error('Abo-Aktualisierung:', e)), 10 * 60 * 1000).unref();

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

// In den UIDs der .ics-Abos steht ein fester Name statt des Host-Headers (der kommt vom Browser und ist nicht vertrauenswürdig)
const FEED_HOST = PUBLIC_URL ? new URL(PUBLIC_URL).host : 'zeitgarten';

// Alte, gemeinsame Abo-Links wurden durch persönliche ersetzt: Statt still zu veralten zeigt der Kalender einen Hinweis
function renewedFeedIcs() {
  const today = new Date().toISOString().slice(0, 10);
  return buildIcs({ name: 'Zeitgarten', emoji: '🌿' }, [{
    id: 'abo-link-erneuert',
    title: '🔗 Zeitgarten: Dieser Abo-Link wurde erneuert',
    notes: 'Jede Person hat jetzt einen eigenen Abo-Link. Öffne Zeitgarten, geh zu den Einstellungen des Kalenders, kopiere den neuen Abo-Link und abonniere ihn. Diesen Kalender kannst du danach löschen.',
    allDay: true,
    start: today,
    end: today,
    updatedAt: `${today}T00:00:00.000Z`,
  }], FEED_HOST);
}

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

// Nur für den Schutz vor Durchprobieren (Kopplungs-Codes). X-Forwarded-For nur mit TRUST_PROXY=1,
// und dann der letzte Eintrag – den hat unser eigener Proxy angehängt, die davor kann jeder fälschen.
function clientIp(req) {
  if (TRUST_PROXY) {
    const list = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (list.length) return list[list.length - 1].slice(0, 64);
  }
  return req.socket.remoteAddress || 'unbekannt';
}

function openStream(req, res, user) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.on('error', () => {}); // abgebrochene Verbindungen sind normal
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
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// ---------- Die App-Seite mit Link-Vorschau (WhatsApp, iMessage, Signal …) ----------

const INDEX_FILE = path.join(PUBLIC, 'index.html');
const OG_DESCRIPTION = 'Zeitgarten – euer gemeinsamer Kalender. Link öffnen, Namen eingeben, mitplanen.';
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const oneLine = (s) => String(s).replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();

let indexCache = { mtimeMs: -1, html: '' };
function indexHtml() {
  const st = fs.statSync(INDEX_FILE);
  if (st.mtimeMs !== indexCache.mtimeMs) indexCache = { mtimeMs: st.mtimeMs, html: fs.readFileSync(INDEX_FILE, 'utf8') };
  return indexCache.html;
}

// Vorschau-Bilder brauchen eine absolute Adresse. Der Host-Header wird dafür streng geprüft
// und nur hier benutzt – für nichts anderes.
function publicBase(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = String(req.headers.host || '').toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/.test(host) || host.length > 255) {
    return '';
  }
  // Hinter einem Proxy mit HTTPS (fast jeder Hoster) kommt die Anfrage selbst als http an
  const fwd = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const proto = req.socket.encrypted || fwd === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

// Ersetzt den Inhalt eines <meta>-Tags (oder fügt ihn vor </head> ein)
function setMeta(html, key, value) {
  const attr = /^og:/.test(key) ? 'property' : 'name';
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(value)}">`;
  const re = new RegExp(`<meta\\s+(?:property|name)="${key.replace(/[.:]/g, '\\$&')}"\\s+content="[^"]*"\\s*/?>`);
  return re.test(html) ? html.replace(re, () => tag) : html.replace('</head>', () => `  ${tag}\n</head>`);
}

function renderIndex(req, pathname) {
  let html = indexHtml();
  const base = publicBase(req);
  for (const key of ['og:image', 'twitter:image']) html = setMeta(html, key, `${base}/og-image.png`);
  if (base) html = setMeta(html, 'og:url', `${base}${/^\/join\/[\w-]+\/?$/.test(pathname) ? pathname : '/'}`);
  // Einladungslink: „Lena lädt dich in „🏠 WG“ ein“ – unbekannte Codes bekommen die allgemeine Vorschau
  const join = /^\/join\/([\w-]+)\/?$/.exec(pathname);
  const invite = join ? core.invitePreview(join[1]) : null;
  if (invite) {
    const cal = oneLine(invite.calendar).slice(0, 80);
    const title = invite.owner ? `${oneLine(invite.owner).slice(0, 40)} lädt dich in „${cal}“ ein` : `Einladung in „${cal}“`;
    for (const key of ['og:title', 'twitter:title']) html = setMeta(html, key, title);
    for (const key of ['og:description', 'twitter:description', 'description']) html = setMeta(html, key, OG_DESCRIPTION);
    html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(`${title} · Zeitgarten`)}</title>`);
  }
  return html;
}

function sendIndex(req, res, pathname) {
  let buf = Buffer.from(renderIndex(req, pathname));
  const etag = `"${crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  const headers = { ...SECURITY_HEADERS, 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', ETag: etag, Vary: 'Accept-Encoding' };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = zlib.gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

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
  if (!stat || stat.isDirectory() || file === INDEX_FILE) {
    // Alle Seiten ohne Dateiendung (/, /join/…, /login/…, /e/<Termin>) zeigen die App
    if (path.extname(rel) && file !== INDEX_FILE) return send(req, res, 404, 'Not found', 'text/plain');
    return sendIndex(req, res, rel);
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
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(req, res, 400, 'Bad request', 'text/plain');
  }
  const { pathname } = url;
  try {
    // Kalender-Abo für Apple/Google/Outlook
    const feed = /^\/feed\/([\w-]+)\.ics$/.exec(pathname);
    if (feed && (req.method === 'GET' || req.method === 'HEAD')) {
      const found = core.feed(feed[1]);
      if (!found) return send(req, res, 404, 'Not found', 'text/plain');
      if (found.renewed) return send(req, res, 200, renewedFeedIcs(), 'text/calendar; charset=utf-8');
      return send(req, res, 200, buildIcs(found.calendar, found.events, FEED_HOST), 'text/calendar; charset=utf-8');
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
    const result = await core.handle(req.method, pathname, { token, body, query: url.searchParams, ip: clientIp(req) });
    sendJson(req, res, 200, result);
  } catch (e) {
    try {
      if (e instanceof HttpError) return sendJson(req, res, e.status, { error: e.message });
      console.error(e);
      if (!res.headersSent) sendJson(req, res, 500, { error: 'Da ist etwas schiefgelaufen.' });
      else res.destroy();
    } catch (e2) {
      console.error(e2);
    }
  }
});

function shutdown() {
  if (!store.flush()) console.error('Beim Beenden konnte nicht alles gespeichert werden.');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('error', (e) => {
  if (!started) unexpected(e);
  else console.error('Server-Fehler:', e);
});
server.listen(PORT, () => {
  started = true;
  console.log(`🌿 Zeitgarten läuft auf http://localhost:${server.address().port}`);
  console.log(`   Daten werden gespeichert in ${DATA_FILE}`);
});

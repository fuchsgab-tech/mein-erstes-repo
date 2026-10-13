// Lädt Daten von einer Internetadresse – aber niemals aus dem eigenen Netzwerk,
// damit niemand über die App interne Server abfragen kann.
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const MAX_BYTES = 15 * 1024 * 1024;
const USER_AGENT = 'Zeitgarten/1.0 (Kalender-Import)';

function isPrivateV4(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

// IPv6 in acht 16-Bit-Blöcke zerlegen – auch mit „::“ und eingebetteter IPv4-Adresse
function v6Words(ip) {
  let s = ip.replace(/%.*$/, '');
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail = ''] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = s.includes('::') ? 8 - h.length - t.length : 0;
  return [...h, ...Array(Math.max(0, fill)).fill('0'), ...t].map((x) => parseInt(x, 16) || 0);
}

const v4Of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

export function isPrivateAddress(ip) {
  const host = String(ip).replace(/^\[|\]$/g, '');
  if (net.isIPv4(host)) return isPrivateV4(host);
  if (!net.isIPv6(host)) return false;
  // Die URL-Schreibweise macht aus ::ffff:127.0.0.1 ein ::ffff:7f00:1 – darum blockweise prüfen
  const w = v6Words(host);
  const zero = (from, to) => w.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && (w[5] === 0 || w[5] === 0xffff)) return isPrivateV4(v4Of(w[6], w[7])); // ::, ::1, ::ffff:a.b.c.d
  if (zero(0, 4) && w[4] === 0xffff && w[5] === 0) return isPrivateV4(v4Of(w[6], w[7]));
  if (w[0] === 0x64 && w[1] === 0xff9b) return w[2] !== 0 || isPrivateV4(v4Of(w[6], w[7])); // NAT64
  if (w[0] === 0x2002) return isPrivateV4(v4Of(w[1], w[2])); // 6to4
  if (w[0] === 0x2001 && (w[1] === 0 || w[1] === 0xdb8)) return true; // Teredo, Dokumentation
  if (w[0] === 0x100 && zero(1, 4)) return true;
  return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0 || (w[0] & 0xff00) === 0xff00;
}

export function normalizeCalendarUrl(raw) {
  const url = String(raw || '').trim().replace(/^webcals?:\/\//i, 'https://');
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('Das ist keine gültige Internetadresse.');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Nur http(s)- und webcal-Links funktionieren.');
  return u.toString();
}

const bareHost = (u) => u.hostname.replace(/^\[|\]$/g, '');

// Anbieter einer Adresse: icloud.com für p42-caldav.icloud.com – bei kurzen Endungen wie co.uk drei Teile
function siteOf(u) {
  const host = bareHost(u);
  if (net.isIP(host)) return host;
  const parts = host.split('.');
  return parts.slice(parts.length > 2 && parts[parts.length - 2].length <= 3 ? -3 : -2).join('.');
}

// Gehören zwei Adressen zum selben Anbieter? (gleicher Host oder z. B. beide *.icloud.com)
// Zugangsdaten werden nur innerhalb davon weitergegeben – und nie von https zu http.
export function sameSite(a, b) {
  const x = new URL(a);
  const y = new URL(b);
  if (x.protocol === 'https:' && y.protocol !== 'https:') return false;
  return x.hostname === y.hostname || siteOf(x) === siteOf(y);
}

const requestError = (code, message) => Object.assign(new Error(message), { code });
const blockedError = () => requestError('blocked', 'Diese Adresse ist nicht erlaubt.');
const networkError = () => requestError('network', 'Der Kalender konnte nicht geladen werden.');

// Namensauflösung, die interne Adressen ablehnt. Die Verbindung geht genau an die geprüfte Adresse –
// so kann ein Name nicht zwischen Prüfung und Abruf auf eine interne Adresse umspringen (DNS-Rebinding).
function publicLookup(hostname, options, cb) {
  dns.lookup(hostname, { family: options.family || 0, hints: options.hints, all: true }).then((addrs) => {
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) cb(blockedError());
    else if (options.all) cb(null, addrs);
    else cb(null, addrs[0].address, addrs[0].family);
  }, () => cb(networkError()));
}

// Eine einzelne Anfrage ohne Weiterleitungen
function requestOnce(u, { method, headers, body, allowPrivate, maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const fail = (e) => reject(e?.code === 'blocked' ? e : signal.aborted
      ? requestError('timeout', 'Der Kalender-Server antwortet nicht.')
      : networkError());
    const data = body == null ? null : Buffer.from(String(body), 'utf8');
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method,
      headers: data ? { ...headers, 'content-length': data.length } : headers,
      agent: false,
      lookup: allowPrivate ? undefined : publicLookup,
      signal,
    }, (res) => {
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && location) {
        res.resume();
        resolve({ status: res.statusCode, location });
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size <= maxBytes) chunks.push(c);
        else {
          reject(requestError('too-big', `Der Kalender ist zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB).`));
          req.destroy();
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end(data);
  });
}

/**
 * Allgemeine Anfrage (GET, PROPFIND, REPORT …) mit Schutz vor internen Adressen.
 * Weiterleitungen werden selbst verfolgt (max. 5) und jede Station wird neu geprüft.
 * Fehler haben ein `code`: invalid, blocked, network, timeout, too-big, redirects.
 * @returns {Promise<{ status: number, url: string, text: string }>}
 */
export async function safeRequest(rawUrl, {
  method = 'GET', headers = {}, body, allowPrivate = false, maxBytes = MAX_BYTES, timeoutMs = 20000,
} = {}) {
  let url;
  try {
    url = normalizeCalendarUrl(rawUrl);
  } catch (e) {
    throw requestError('invalid', e.message);
  }
  let hdrs = { 'user-agent': USER_AGENT, ...headers };
  for (let hop = 0; hop <= 5; hop++) {
    const u = new URL(url);
    // Namen prüft publicLookup beim Verbinden, feste IP-Adressen gleich hier
    if (!allowPrivate && isPrivateAddress(bareHost(u))) throw blockedError();
    if (u.username || u.password) throw requestError('invalid', 'Die Adresse darf keine Zugangsdaten enthalten.');
    const res = await requestOnce(u, { method, headers: hdrs, body, allowPrivate, maxBytes, timeoutMs });
    if (!res.location) return { status: res.status, url, text: res.text };
    let next;
    try {
      next = normalizeCalendarUrl(new URL(res.location, u).toString());
    } catch (e) {
      throw requestError('invalid', e.message);
    }
    // Wie im Browser: 303 (und 301/302 nach POST) werden zu GET – PROPFIND & REPORT bleiben erhalten
    if ((res.status === 303 && method !== 'HEAD') || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
      hdrs = Object.fromEntries(Object.entries(hdrs).filter(([k]) => !/^content-/i.test(k)));
    }
    if (!sameSite(url, next)) hdrs = Object.fromEntries(Object.entries(hdrs).filter(([k]) => k.toLowerCase() !== 'authorization'));
    url = next;
  }
  throw requestError('redirects', 'Zu viele Weiterleitungen.');
}

export async function fetchCalendarText(rawUrl, { allowPrivate = false } = {}) {
  const res = await safeRequest(normalizeCalendarUrl(rawUrl), {
    allowPrivate,
    headers: { accept: 'text/calendar, text/plain, */*' },
  });
  if (res.status < 200 || res.status > 299) throw new Error(`Der Kalender-Server meldet Fehler ${res.status}.`);
  return res.text;
}

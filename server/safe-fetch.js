// Lädt Daten von einer Internetadresse – aber niemals aus dem eigenen Netzwerk,
// damit niemand über die App interne Server abfragen kann.
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 15 * 1024 * 1024;
const USER_AGENT = 'Zeitgarten/1.0 (Kalender-Import)';

function isPrivateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateV4(mapped[1]);
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
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

// Gehören zwei Adressen zum selben Anbieter? (gleicher Host oder z. B. beide *.icloud.com)
// Zugangsdaten werden nur innerhalb davon weitergegeben – und nie von https zu http.
export function sameSite(a, b) {
  const x = new URL(a);
  const y = new URL(b);
  if (x.protocol === 'https:' && y.protocol !== 'https:') return false;
  const site = (u) => (net.isIP(bareHost(u)) ? bareHost(u) : u.hostname.split('.').slice(-2).join('.'));
  return x.hostname === y.hostname || site(x) === site(y);
}

const requestError = (code, message) => Object.assign(new Error(message), { code });

async function assertPublic(u) {
  const host = bareHost(u);
  let addrs;
  try {
    addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  } catch {
    throw requestError('network', 'Der Kalender konnte nicht geladen werden.');
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw requestError('blocked', 'Diese Adresse ist nicht erlaubt.');
  }
}

async function readLimited(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      reader.cancel().catch(() => {});
      throw requestError('too-big', `Der Kalender ist zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB).`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
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
    if (!allowPrivate) await assertPublic(u);
    let res;
    try {
      res = await fetch(u, { method, headers: hdrs, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw e.name === 'TimeoutError'
        ? requestError('timeout', 'Der Kalender-Server antwortet nicht.')
        : requestError('network', 'Der Kalender konnte nicht geladen werden.');
    }
    const location = res.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(res.status) || !location) {
      return { status: res.status, url, text: await readLimited(res, maxBytes) };
    }
    res.body?.cancel().catch(() => {});
    let next;
    try {
      next = normalizeCalendarUrl(new URL(location, u).toString());
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

// Lädt einen Kalender von einer Internetadresse – aber niemals aus dem eigenen Netzwerk,
// damit niemand über die App interne Server abfragen kann.
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 15 * 1024 * 1024;

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

export async function fetchCalendarText(rawUrl, { allowPrivate = false } = {}) {
  let url = normalizeCalendarUrl(rawUrl);
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url);
    if (!allowPrivate) {
      const host = u.hostname.replace(/^\[|\]$/g, '');
      const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
        throw new Error('Diese Adresse ist nicht erlaubt.');
      }
    }
    let res;
    try {
      res = await fetch(u, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers: { 'user-agent': 'Zeitgarten/1.0 (Kalender-Import)', accept: 'text/calendar, text/plain, */*' },
      });
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? 'Der Kalender-Server antwortet nicht.' : 'Der Kalender konnte nicht geladen werden.');
    }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
      url = normalizeCalendarUrl(new URL(res.headers.get('location'), u).toString());
      continue;
    }
    if (!res.ok) throw new Error(`Der Kalender-Server meldet Fehler ${res.status}.`);
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        reader.cancel();
        throw new Error('Der Kalender ist zu groß (max. 15 MB).');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Zu viele Weiterleitungen.');
}

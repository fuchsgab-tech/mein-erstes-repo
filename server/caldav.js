// iPhone-Kalender über iCloud (CalDAV) finden und laden – funktioniert auch mit Nextcloud & Co.
// Die eigentliche Netzwerk-Anfrage kommt von außen (request), damit sie SSRF-geschützt ist.
import crypto from 'node:crypto';
import net from 'node:net';
import { isPrivateAddress, sameSite } from './safe-fetch.js';
import { children, find, findAll, parseXml, text } from './xml.js';

export const ICLOUD_SERVER = 'https://caldav.icloud.com/';
const YEAR = 365 * 24 * 3600e3;

const caldavError = (code, message) => Object.assign(new Error(message), { code });
const isIcloud = (server) => /(^|\.)icloud\.com$/i.test(new URL(server).hostname);
// Ohne Verschlüsselung (http) nur im eigenen Netz – sonst ginge das Passwort im Klartext durchs Internet
const isLocalHost = (host) => (net.isIP(host) ? isPrivateAddress(host) : /^(localhost|[^.]+|.+\.(local|lan|home\.arpa|internal))$/i.test(host));

function normalizeServer(raw) {
  const s = String(raw || '').trim();
  if (!s) return ICLOUD_SERVER;
  let u;
  try {
    u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw caldavError('invalid', 'Die Server-Adresse ist ungültig.');
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalHost(u.hostname.replace(/^\[|\]$/g, '')))) {
    throw caldavError('invalid', 'Die Server-Adresse muss mit https:// beginnen.');
  }
  u.username = '';
  u.password = '';
  return u.toString();
}

function resolveHref(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function basicAuth(username, password) {
  let bin = '';
  for (const b of new TextEncoder().encode(`${username}:${password}`)) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

// #FF2968FF (Apple, mit Deckkraft) -> #ff2968
export function normalizeColor(c) {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(String(c || '').trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

const PROPFIND = (props) => `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>${props}</d:prop>
</d:propfind>`;

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function session(creds, request) {
  const server = normalizeServer(creds.server);
  const icloud = isIcloud(server);
  const auth = basicAuth(creds.username, creds.password);

  async function send(url, method, depth, body) {
    // Zugangsdaten gehen nur an den Anbieter selbst (z. B. caldav.icloud.com -> p42-caldav.icloud.com)
    if (!sameSite(server, url)) throw caldavError('foreign', 'Der Kalender-Server verweist auf eine fremde Adresse.');
    let res;
    try {
      res = await request(url, {
        method,
        body,
        headers: { authorization: auth, depth: String(depth), 'content-type': 'application/xml; charset=utf-8', accept: 'application/xml, text/xml' },
      });
    } catch (e) {
      if (e.code === 'blocked' || e.code === 'invalid' || e.code === 'too-big') throw caldavError(e.code, e.message);
      throw caldavError('network', icloud
        ? 'iCloud ist gerade nicht erreichbar. Versuch es gleich nochmal.'
        : 'Der Kalender-Server ist gerade nicht erreichbar. Versuch es gleich nochmal.');
    }
    if (res.status === 401 || res.status === 403) {
      throw caldavError('auth', icloud
        ? 'Apple-ID oder App-Passwort stimmt nicht. Du brauchst ein app-spezifisches Passwort, nicht dein normales Apple-Passwort.'
        : 'Benutzername oder Passwort stimmt nicht.');
    }
    return res;
  }

  // Liefert pro <response> die Eigenschaften, die der Server mit 200 beantwortet hat.
  // hrefs werden gegen die Adresse aufgelöst, die tatsächlich geantwortet hat (nach Weiterleitungen).
  async function propfind(url, depth, props) {
    const res = await send(url, 'PROPFIND', depth, PROPFIND(props));
    if (res.status !== 207) return null;
    const root = parseXml(res.text);
    if (root?.name !== 'multistatus') return null;
    return findAll(root, 'response').map((r) => {
      const found = {};
      for (const ps of children(r, 'propstat')) {
        const status = text(children(ps, 'status')[0]);
        if (status && !/\s2\d\d(\s|$)/.test(status)) continue;
        for (const p of children(children(ps, 'prop')[0])) found[p.name] ??= p;
      }
      const href = text(children(r, 'href')[0]);
      return { url: href ? resolveHref(href, res.url) : res.url, base: res.url, props: found };
    }).filter((r) => r.url);
  }

  // Ein Verweis (<d:href>) innerhalb einer Eigenschaft: current-user-principal oder calendar-home-set
  async function hrefProp(url, prop) {
    const xml = prop === 'calendar-home-set' ? '<c:calendar-home-set/>' : `<d:${prop}/>`;
    const hit = (await propfind(url, 0, xml))?.find((r) => text(find(r.props[prop], 'href')));
    return hit ? resolveHref(text(find(hit.props[prop], 'href')), hit.base) : null;
  }

  return { server, icloud, send, propfind, hrefProp };
}

/**
 * Findet alle Terminkalender eines Kontos.
 * @param {{ server?: string, username: string, password: string }} creds
 * @param {{ request: Function }} deps  request(url, { method, headers, body }) -> { status, url, text }
 * @returns {Promise<Array<{ url: string, name: string, color: string|null, ctag: string|null }>>}
 */
export async function discoverCalendars(creds, { request }) {
  const s = session(creds, request);

  let principal = await s.hrefProp(s.server, 'current-user-principal');
  if (!principal) {
    // z. B. https://cloud.example.com -> /.well-known/caldav leitet zur richtigen Stelle weiter
    principal = await s.hrefProp(new URL('/.well-known/caldav', s.server).toString(), 'current-user-principal').catch((e) => {
      if (e.code === 'auth') throw e;
      return null;
    });
  }
  principal ||= s.server;
  const home = (await s.hrefProp(principal, 'calendar-home-set')) || principal;

  const list = await s.propfind(home, 1, [
    '<d:displayname/>', '<d:resourcetype/>', '<c:supported-calendar-component-set/>',
    '<ic:calendar-color/>', '<ic:calendar-order/>', '<cs:getctag/>',
  ].join(''));
  if (!list) {
    throw caldavError('protocol', s.icloud
      ? 'iCloud hat unerwartet geantwortet. Versuch es gleich nochmal.'
      : 'Unter dieser Adresse wurde kein CalDAV-Kalender gefunden.');
  }

  const seen = new Set();
  const calendars = [];
  for (const { url, props } of list) {
    if (seen.has(url) || !find(props.resourcetype, 'calendar')) continue;
    // Nur Kalender mit Terminen – keine Erinnerungslisten (VTODO), Posteingang usw.
    const comps = findAll(props['supported-calendar-component-set'], 'comp').map((c) => (c.attrs.name || '').toUpperCase());
    if (comps.length && !comps.includes('VEVENT')) continue;
    seen.add(url);
    const fallback = safeDecode(new URL(url).pathname.split('/').filter(Boolean).pop() || 'Kalender');
    calendars.push({
      url,
      name: (text(props.displayname) || fallback).slice(0, 60),
      color: normalizeColor(text(props['calendar-color'])),
      ctag: text(props.getctag) || null,
      order: Number(text(props['calendar-order'])) || 0,
    });
  }
  if (!calendars.length) {
    throw caldavError('empty', s.icloud
      ? 'In deinem iCloud-Konto wurden keine Kalender gefunden. Ist „Kalender“ in den iCloud-Einstellungen deines iPhones eingeschaltet?'
      : 'Auf diesem Server wurden keine Kalender gefunden.');
  }
  calendars.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'de'));
  for (const c of calendars) delete c.order;
  return calendars;
}

/**
 * Lädt die Termine eines Kalenders (Standard: ein Jahr zurück bis zwei Jahre voraus).
 * @returns {Promise<string[]>}  .ics-Texte (calendar-data), ein Eintrag pro Termin
 */
export async function fetchCalendarEvents(creds, calendarUrl, { request, from = Date.now() - YEAR, to = Date.now() + 2 * YEAR }) {
  const s = session(creds, request);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${icsTime(from)}" end="${icsTime(to)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
  const res = await s.send(calendarUrl, 'REPORT', 1, body);
  if (res.status === 404 || res.status === 410) {
    throw caldavError('gone', 'Diesen Kalender gibt es nicht mehr – wurde er auf dem iPhone gelöscht?');
  }
  const root = res.status === 207 ? parseXml(res.text) : null;
  if (root?.name !== 'multistatus') throw caldavError('protocol', `Der Kalender-Server meldet Fehler ${res.status}.`);
  return findAll(root, 'calendar-data').map(text).filter((t) => /BEGIN:VCALENDAR/i.test(t));
}

// ---------- Zugangsdaten verschlüsselt ablegen (AES-256-GCM) ----------

export function secretBox(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Der Schlüssel muss 32 Bytes lang sein.');
  return {
    seal(plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), data].map((x) => (typeof x === 'string' ? x : x.toString('base64url'))).join('.');
    },
    open(sealed) {
      const [v, iv, tag, data] = String(sealed).split('.');
      if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unbekanntes Format.');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    },
  };
}

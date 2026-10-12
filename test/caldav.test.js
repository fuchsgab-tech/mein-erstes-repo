import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { children, decodeEntities, find, findAll, parseXml, text } from '../server/xml.js';
import { discoverCalendars, fetchCalendarEvents, ICLOUD_SERVER, normalizeColor, secretBox } from '../server/caldav.js';
import { fetchCalendarText, normalizeCalendarUrl, safeRequest, sameSite } from '../server/safe-fetch.js';
import { createCore, HttpError } from '../server/core.js';

// ---------- XML ----------

test('XML: Namensräume, Entities, CDATA, Kommentare', () => {
  const root = parseXml(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE x [ <!ENTITY foo "bar"> ]>
<!-- Kommentar mit <tags> drin -->
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/cal/a%20b/</D:href>
    <propstat xmlns="DAV:">
      <prop>
        <displayname>Tom &amp; Jerry &lt;3 &quot;x&quot; &apos;y&apos; &#228;&#xF6;&#x1F600;</displayname>
        <C:calendar-data><![CDATA[BEGIN:VCALENDAR
<kein-tag> & roh]]></C:calendar-data>
        <C:comp name="VEVENT" data-x='a>b'/>
        <empty/>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </D:response>
  <?pi ignoriert?>
</D:multistatus>`);
  assert.equal(root.name, 'multistatus');
  assert.equal(root.qname, 'D:multistatus');
  assert.equal(text(find(root, 'href')), '/cal/a%20b/');
  assert.equal(text(find(root, 'displayname')), 'Tom & Jerry <3 "x" \'y\' äö😀');
  assert.equal(text(find(root, 'calendar-data')), 'BEGIN:VCALENDAR\n<kein-tag> & roh');
  const comp = find(root, 'comp');
  assert.deepEqual(comp.attrs, { name: 'VEVENT', 'data-x': 'a>b' });
  assert.equal(comp.children.length, 0);
  assert.equal(text(find(root, 'empty')), '');
  assert.deepEqual(children(find(root, 'prop')).map((c) => c.name), ['displayname', 'calendar-data', 'comp', 'empty']);
  assert.equal(findAll(root, 'response').length, 1);
  assert.equal(find(root, 'nichtda'), null);
  assert.equal(text(null), '');
});

test('XML: tolerant bei kaputtem oder leerem Inhalt', () => {
  assert.equal(parseXml(''), null);
  assert.equal(parseXml('kein xml'), null);
  // Fehlendes </b> schließt das Elternelement, ein unpassendes </x> wird übergangen
  const r = parseXml('<a><b>eins</a>');
  assert.equal(r.name, 'a');
  assert.equal(text(find(r, 'b')), 'eins');
  assert.equal(text(parseXml('<a>text</x><c/></a>')), 'text');
  assert.equal(parseXml('<a><b').name, 'a');
  assert.equal(decodeEntities('&unbekannt; &#0; &amp;amp;'), '&unbekannt; &#0; &amp;');
  // Tiefe Verschachtelung sprengt nichts
  const deep = parseXml(`${'<x>'.repeat(20000)}tief${'</x>'.repeat(20000)}`);
  assert.equal(findAll(deep, 'x').length, 19999);
  assert.equal(text(deep), 'tief');
});

test('Farben und Adressen', () => {
  assert.equal(normalizeColor('#FF2968FF'), '#ff2968');
  assert.equal(normalizeColor('#1BADF8'), '#1badf8');
  assert.equal(normalizeColor(' 63DA38 '), '#63da38');
  assert.equal(normalizeColor('rot'), null);
  assert.equal(normalizeColor(''), null);
  assert.ok(sameSite('https://caldav.icloud.com/', 'https://p42-caldav.icloud.com:443/123/calendars/'));
  assert.ok(sameSite('http://127.0.0.1:1/', 'http://127.0.0.1:2/x'));
  assert.ok(!sameSite('https://caldav.icloud.com/', 'http://p42-caldav.icloud.com/'));
  assert.ok(!sameSite('https://caldav.icloud.com/', 'https://evil.example/'));
  assert.ok(!sameSite('http://localhost:1/', 'http://127.0.0.1:1/'));
});

// ---------- Nachgebauter iCloud-Server ----------

const USER = 'gabriel@icloud.com';
const PASS = 'abcd-efgh-ijkl-mnop';
const ID = '123456789';

const ics = (...vevents) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iCloud//EN',
  'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'END:STANDARD', 'END:VTIMEZONE',
  ...vevents.flatMap((v) => ['BEGIN:VEVENT', ...v, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');

function startMock() {
  const state = {
    log: [],
    failWork: false,
    home: [
      // Wie bei iCloud: Entities und &#13; für Zeilenumbrüche
      { id: 'a', data: ics(['UID:tom-1', 'DTSTAMP:20261001T100000Z', 'DTSTART:20261014T180000Z', 'DTEND:20261014T200000Z', 'SUMMARY:Tom & Jerry <live>', 'LOCATION:Kino\\, Saal 2']), cdata: false },
      // Serie mit Zeitzone, in CDATA
      { id: 'b', data: ics(['UID:yoga-1', 'DTSTAMP:20261001T100000Z', 'DTSTART;TZID=Europe/Berlin:20261013T183000', 'DTEND;TZID=Europe/Berlin:20261013T193000', 'RRULE:FREQ=WEEKLY;BYDAY=TU', 'SUMMARY:Yoga 🧘']), cdata: true },
    ],
  };
  const auth = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;
  const ports = {};
  const ms = (inner, attrs = 'xmlns:D="DAV:"') => `<?xml version="1.0" encoding="UTF-8"?>\n<D:multistatus ${attrs}>${inner}</D:multistatus>`;
  const ok = (props) => `<D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>`;
  const missing = (props) => `<D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>`;
  const NS = 'xmlns:D="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:ICAL="http://apple.com/ns/ical/"';

  function calendars() {
    const b = `http://127.0.0.1:${ports.p42}`;
    return ms([
      `<D:response><D:href>/${ID}/calendars/</D:href>${ok('<D:resourcetype><D:collection/></D:resourcetype>')}${missing('<ICAL:calendar-color/><CS:getctag/>')}</D:response>`,
      `<D:response><D:href>/${ID}/calendars/inbox/</D:href>${ok('<D:resourcetype><D:collection/><CAL:schedule-inbox/></D:resourcetype><D:displayname>Inbox</D:displayname>')}</D:response>`,
      `<D:response><D:href>/${ID}/calendars/outbox/</D:href>${ok('<D:resourcetype><D:collection/><CAL:schedule-outbox/></D:resourcetype>')}</D:response>`,
      `<D:response><D:href>/${ID}/calendars/notification/</D:href>${ok('<D:resourcetype><D:collection/><CS:notification/></D:resourcetype>')}</D:response>`,
      `<D:response><D:href>/${ID}/calendars/home/</D:href>${ok(`<D:displayname>Privat</D:displayname><D:resourcetype><D:collection/><CAL:calendar/></D:resourcetype>
        <CAL:supported-calendar-component-set><CAL:comp name="VEVENT"/></CAL:supported-calendar-component-set>
        <ICAL:calendar-color symbolic-color="custom">#1BADF8FF</ICAL:calendar-color><ICAL:calendar-order>2</ICAL:calendar-order><CS:getctag>HwoQEgwAAA</CS:getctag>`)}</D:response>`,
      // Absolute Adresse und Standard-Namensraum statt Präfix
      `<response xmlns="DAV:"><href>${b}/${ID}/calendars/work/</href><propstat><prop><displayname>Arbeit</displayname>
        <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
        <x:supported-calendar-component-set xmlns:x="urn:ietf:params:xml:ns:caldav"><x:comp name="VEVENT"/><x:comp name="VTODO"/></x:supported-calendar-component-set>
        <calendar-color xmlns="http://apple.com/ns/ical/">#FF9500</calendar-color><calendar-order xmlns="http://apple.com/ns/ical/">1</calendar-order></prop>
        <status>HTTP/1.1 200 OK</status></propstat></response>`,
      `<D:response><D:href>/${ID}/calendars/tasks/</D:href>${ok(`<D:displayname>Erinnerungen</D:displayname><D:resourcetype><D:collection/><CAL:calendar/></D:resourcetype>
        <CAL:supported-calendar-component-set><CAL:comp name="VTODO"/></CAL:supported-calendar-component-set><ICAL:calendar-order>0</ICAL:calendar-order>`)}</D:response>`,
      `<D:response><D:href>/${ID}/calendars/birthdays/</D:href>${ok(`<D:displayname>Geburtstage &amp; Feste</D:displayname><D:resourcetype><D:collection/><CAL:calendar/></D:resourcetype>
        <ICAL:calendar-color>#CC73E1FF</ICAL:calendar-color><ICAL:calendar-order>4</ICAL:calendar-order>`)}${missing('<CAL:supported-calendar-component-set/>')}</D:response>`,
      `<D:response><D:href>/${ID}/calendars/abo/</D:href>${ok('<D:displayname>Abo</D:displayname><D:resourcetype><D:collection/><CS:subscribed/></D:resourcetype>')}</D:response>`,
    ].join('\n'), NS);
  }

  function events(list) {
    return ms(list.map((e) => `<D:response><D:href>/${ID}/calendars/x/${e.id}.ics</D:href>${ok(`<D:getetag>"${e.id}"</D:getetag><C:calendar-data>${e.cdata ? `<![CDATA[${e.data}]]>` : escapeXml(e.data)}</C:calendar-data>`)}</D:response>`).join(''),
      'xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"');
  }

  const BIRTHDAYS = [{ id: 'mama', data: ics(['UID:mama-1', 'DTSTART;VALUE=DATE:19650312', 'DTEND;VALUE=DATE:19650313', 'RRULE:FREQ=YEARLY', 'SUMMARY:Mamas Geburtstag 🎂']) }];
  const WORK = [{ id: 'w', data: ics(['UID:w-1', 'DTSTART:20261012T073000Z', 'DTEND:20261012T083000Z', 'SUMMARY:Team-Meeting', 'RRULE:FREQ=WEEKLY;BYDAY=MO']) }];

  function handler(role) {
    return (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        state.log.push({ role, method: req.method, url: req.url, depth: req.headers.depth, body, auth: req.headers.authorization || null });
        const send = (status, xml, headers = {}) => {
          res.writeHead(status, { 'content-type': 'application/xml; charset=utf-8', ...headers });
          res.end(xml);
        };
        if (role === 'root' && req.method === 'GET') {
          if (req.url === '/umzug') return send(301, '', { location: '/feiertage.ics' });
          if (req.url === '/feiertage.ics') {
            res.writeHead(200, { 'content-type': 'text/calendar' });
            return res.end(ics(['UID:f1', 'DTSTART;VALUE=DATE:20261003', 'SUMMARY:Tag der Deutschen Einheit']).replace('VERSION:2.0', 'VERSION:2.0\r\nX-WR-CALNAME:Feiertage'));
          }
        }
        if (req.url === '/redirect-post') return send(307, '', { location: '/echo' });
        if (req.url === '/to-other-host') return send(302, '', { location: `http://localhost:${ports.root}/echo` });
        if (req.url === '/echo') return send(200, JSON.stringify({ method: req.method, body, auth: req.headers.authorization || null }));
        if (req.headers.authorization !== auth) return send(401, '', { 'www-authenticate': 'Basic realm="iCloud"' });

        if (role === 'root' && req.method === 'PROPFIND' && req.url === '/' && /current-user-principal/.test(body)) {
          return send(207, ms(`<D:response><D:href>/</D:href>${ok(`<D:current-user-principal><D:href>/${ID}/principal/</D:href></D:current-user-principal>`)}</D:response>`));
        }
        // Weiterleitung auf einen anderen Host (wie p42-caldav.icloud.com) – PROPFIND & Body müssen erhalten bleiben
        if (role === 'root' && req.url === `/${ID}/principal/`) return send(301, '', { location: `http://127.0.0.1:${ports.p42}/${ID}/principal/` });
        if (role === 'p42' && req.method === 'PROPFIND' && req.url === `/${ID}/principal/` && /calendar-home-set/.test(body) && req.headers.depth === '0') {
          return send(207, ms(`<D:response><D:href>/${ID}/principal/</D:href>${ok(`<C:calendar-home-set xmlns:C="urn:ietf:params:xml:ns:caldav"><D:href>http://127.0.0.1:${ports.p42}/${ID}/calendars/</D:href></C:calendar-home-set>`)}</D:response>`));
        }
        if (role === 'p42' && req.method === 'PROPFIND' && req.url === `/${ID}/calendars/` && req.headers.depth === '1') return send(207, calendars());
        if (role === 'p42' && req.method === 'REPORT' && req.headers.depth === '1' && /calendar-query/.test(body) && /time-range start="\d{8}T\d{6}Z"/.test(body)) {
          if (req.url === `/${ID}/calendars/home/`) return send(207, events(state.home));
          if (req.url === `/${ID}/calendars/birthdays/`) return send(207, events(BIRTHDAYS));
          if (req.url === `/${ID}/calendars/work/`) return state.failWork ? send(500, 'kaputt') : send(207, events(WORK));
          return send(404, '');
        }
        send(405, '');
      });
    };
  }

  const root = http.createServer(handler('root'));
  const p42 = http.createServer(handler('p42'));
  return new Promise((resolve) => {
    root.listen(0, () => {
      ports.root = root.address().port;
      p42.listen(0, () => {
        ports.p42 = p42.address().port;
        resolve({
          state,
          server: `http://127.0.0.1:${ports.root}/`,
          ports,
          close: () => {
            root.close();
            p42.close();
          },
        });
      });
    });
  });
}

let mock;
before(async () => {
  mock = await startMock();
});
after(() => mock.close());

const request = (url, opts) => safeRequest(url, { ...opts, allowPrivate: true });
const creds = () => ({ server: mock.server, username: USER, password: PASS });

// ---------- Sichere Anfragen ----------

test('safeRequest: Weiterleitungen, Methoden, Schutz vor internen Adressen', async () => {
  // 307 behält Methode und Inhalt
  let r = await safeRequest(`${mock.server}redirect-post`, { method: 'POST', body: 'hallo', allowPrivate: true });
  assert.deepEqual(JSON.parse(r.text), { method: 'POST', body: 'hallo', auth: null });
  assert.equal(r.url, `${mock.server}echo`);
  // Zugangsdaten gehen nicht an einen fremden Host
  r = await safeRequest(`${mock.server}to-other-host`, { headers: { authorization: 'Basic geheim' }, allowPrivate: true });
  assert.equal(JSON.parse(r.text).auth, null);
  assert.equal(new URL(r.url).hostname, 'localhost');
  // Ohne Freigabe sind interne Adressen gesperrt
  await assert.rejects(safeRequest(mock.server), { code: 'blocked', message: 'Diese Adresse ist nicht erlaubt.' });
  await assert.rejects(safeRequest('ftp://example.com/'), { code: 'invalid' });
  // Die alte Funktion für Kalender-Links funktioniert wie bisher
  const t = await fetchCalendarText(`${mock.server}umzug`, { allowPrivate: true });
  assert.match(t, /Tag der Deutschen Einheit/);
  await assert.rejects(fetchCalendarText(mock.server.replace('http', 'webcal')), { message: 'Diese Adresse ist nicht erlaubt.' });
  await assert.rejects(fetchCalendarText(`${mock.server}gibtsnicht`, { allowPrivate: true }), { message: /Fehler 401/ });
  assert.equal(normalizeCalendarUrl('webcal://example.com/a.ics'), 'https://example.com/a.ics');
});

// ---------- CalDAV ----------

test('discoverCalendars findet nur echte Terminkalender – mit Farben, Reihenfolge und Weiterleitung', async () => {
  mock.state.log.length = 0;
  const list = await discoverCalendars(creds(), { request });
  const b = `http://127.0.0.1:${mock.ports.p42}/${ID}/calendars`;
  assert.deepEqual(list, [
    { url: `${b}/work/`, name: 'Arbeit', color: '#ff9500', ctag: null },
    { url: `${b}/home/`, name: 'Privat', color: '#1badf8', ctag: 'HwoQEgwAAA' },
    { url: `${b}/birthdays/`, name: 'Geburtstage & Feste', color: '#cc73e1', ctag: null },
  ]);
  // Die Weiterleitung wurde mit PROPFIND, Inhalt und Anmeldung verfolgt
  const hop = mock.state.log.find((l) => l.role === 'p42' && l.url === `/${ID}/principal/`);
  assert.equal(hop.method, 'PROPFIND');
  assert.match(hop.body, /calendar-home-set/);
  assert.ok(hop.auth);
});

test('fetchCalendarEvents lädt die Termine (Entities und CDATA)', async () => {
  mock.state.log.length = 0;
  const url = `http://127.0.0.1:${mock.ports.p42}/${ID}/calendars/home/`;
  const items = await fetchCalendarEvents(creds(), url, { request });
  assert.equal(items.length, 2);
  assert.match(items[0], /^BEGIN:VCALENDAR\r\n/);
  assert.match(items[0], /SUMMARY:Tom & Jerry <live>/);
  assert.match(items[1], /SUMMARY:Yoga 🧘/);
  const report = mock.state.log.find((l) => l.method === 'REPORT');
  assert.equal(report.depth, '1');
  const from = Number(/start="(\d{4})/.exec(report.body)[1]);
  const to = Number(/end="(\d{4})/.exec(report.body)[1]);
  assert.equal(to - from, 3);
  await assert.rejects(fetchCalendarEvents(creds(), `http://127.0.0.1:${mock.ports.p42}/${ID}/calendars/weg/`, { request }), /gibt es nicht mehr/);
  await assert.rejects(fetchCalendarEvents(creds(), 'https://evil.example/cal/', { request }), /fremde Adresse/);
});

test('verständliche Fehler: falsches Passwort, Netzwerk, keine Kalender', async () => {
  await assert.rejects(discoverCalendars({ ...creds(), password: 'falsch' }, { request }), { code: 'auth', message: 'Benutzername oder Passwort stimmt nicht.' });
  // Bei iCloud (Standard-Server) die Apple-Variante – ohne echtes Netzwerk
  const fake = (status, xml = '') => async () => ({ status, url: ICLOUD_SERVER, text: xml });
  await assert.rejects(discoverCalendars({ username: USER, password: 'x' }, { request: fake(401) }),
    { message: 'Apple-ID oder App-Passwort stimmt nicht. Du brauchst ein app-spezifisches Passwort, nicht dein normales Apple-Passwort.' });
  const offline = async () => {
    throw Object.assign(new Error('weg'), { code: 'timeout' });
  };
  await assert.rejects(discoverCalendars({ username: USER, password: 'x' }, { request: offline }), { message: 'iCloud ist gerade nicht erreichbar. Versuch es gleich nochmal.' });
  const onlyInbox = '<multistatus xmlns="DAV:"><response><href>/1/calendars/inbox/</href><propstat><prop><resourcetype><collection/><schedule-inbox xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>';
  await assert.rejects(discoverCalendars({ username: USER, password: 'x' }, { request: fake(207, onlyInbox) }), { code: 'empty', message: /keine Kalender gefunden/ });
  await assert.rejects(discoverCalendars({ server: 'ftp://x', username: USER, password: 'x' }, { request }), { code: 'invalid' });
});

test('Zugangsdaten werden mit AES-256-GCM versiegelt', () => {
  const box = secretBox(crypto.randomBytes(32));
  const sealed = box.seal('{"password":"geheim"}');
  assert.ok(!sealed.includes('geheim'));
  assert.notEqual(box.seal('x'), box.seal('x'));
  assert.equal(box.open(sealed), '{"password":"geheim"}');
  const parts = sealed.split('.');
  parts[3] = `${parts[3].slice(0, -2)}AA`;
  assert.throws(() => box.open(parts.join('.')));
  assert.throws(() => secretBox(crypto.randomBytes(32)).open(sealed));
  assert.throws(() => secretBox(Buffer.alloc(8)));
});

// ---------- Ende-zu-Ende mit der App-Logik ----------

function makeCore({ withCaldav = true } = {}) {
  const db = { version: 1, users: {}, calendars: {}, members: [], events: {}, comments: {}, subscriptions: {}, activity: [] };
  const box = secretBox(crypto.createHash('sha256').update('test-schlüssel').digest());
  const pushed = [];
  const core = createCore({
    db,
    save: () => {},
    newId: (n = 12) => crypto.randomBytes(n).toString('base64url'),
    hash: (t) => crypto.createHash('sha256').update(t).digest('hex'),
    push: (userId, msg) => pushed.push({ userId, msg }),
    isConnected: () => false,
    fetchCalendarText: (url) => fetchCalendarText(url, { allowPrivate: true }),
    normalizeCalendarUrl,
    ...(withCaldav ? {
      caldav: {
        discover: (c) => discoverCalendars(c, { request }),
        fetchEvents: (c, url) => fetchCalendarEvents(c, url, { request }),
      },
      sealSecret: box.seal,
      openSecret: box.open,
    } : {}),
  });
  const call = async (method, path, token, body) => {
    const u = new URL(path, 'http://x');
    try {
      return { status: 200, data: await core.handle(method, u.pathname, { token, body, query: u.searchParams }) };
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      return { status: e.status, data: { error: e.message } };
    }
  };
  return { db, box, core, call, pushed };
}

test('iPhone-Import Ende zu Ende: verbinden, auswählen, importieren, aktualisieren', async () => {
  const { db, box, core, call, pushed } = makeCore();
  const { token, user } = (await call('POST', '/api/users', null, { name: 'Gabriel', color: '#3d9df2' })).data;
  const seen = [];
  const spy = async (...args) => {
    const r = await call(...args);
    seen.push(JSON.stringify(r.data));
    return r;
  };

  // Eingaben prüfen
  assert.equal((await spy('POST', '/api/caldav/discover', token, { username: '', password: 'x' })).status, 400);
  assert.equal((await spy('POST', '/api/caldav/discover', token, { username: USER, password: '  ' })).data.error, 'Bitte gib das App-spezifische Passwort ein.');
  assert.equal((await spy('POST', '/api/caldav/discover', token, { server: 'ht tp://kaputt', username: USER, password: 'x' })).data.error, 'Die Server-Adresse ist ungültig.');
  const wrong = await spy('POST', '/api/caldav/discover', token, { ...creds(), password: 'falsch-falsch' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error, 'Benutzername oder Passwort stimmt nicht.');
  assert.equal((await call('POST', '/api/caldav/discover', null, creds())).status, 401);

  // Verbinden (Passwort mit Leerzeichen drumherum, wie beim Kopieren)
  const found = await spy('POST', '/api/caldav/discover', token, { ...creds(), password: ` ${PASS} ` });
  assert.equal(found.status, 200);
  assert.equal(found.data.account, 'g••••@icloud.com');
  assert.deepEqual(found.data.calendars.map((c) => [c.name, c.color, c.connected]), [
    ['Arbeit', '#ff9500', false], ['Privat', '#1badf8', false], ['Geburtstage & Feste', '#cc73e1', false],
  ]);
  const idOf = (name) => found.data.calendars.find((c) => c.name === name).id;

  // Eine Sitzung gehört nur der Person, die sich verbunden hat
  const eve = (await call('POST', '/api/users', null, { name: 'Eve' })).data;
  assert.equal((await call('POST', '/api/caldav/import', eve.token, { sessionId: found.data.sessionId, calendars: [idOf('Privat')] })).status, 410);
  assert.equal((await call('POST', '/api/caldav/import', token, { sessionId: found.data.sessionId, calendars: [] })).status, 400);

  // Ein Kalender klappt nicht – die anderen trotzdem
  mock.state.failWork = true;
  const imp = await spy('POST', '/api/caldav/import', token, {
    sessionId: found.data.sessionId, calendars: [idOf('Privat'), idOf('Geburtstage & Feste'), idOf('Arbeit')], tz: 'Europe/Berlin',
  });
  mock.state.failWork = false;
  assert.equal(imp.status, 200);
  assert.deepEqual(imp.data.imported.map((x) => [x.name, x.count]), [['Privat', 2], ['Geburtstage & Feste', 1]]);
  assert.equal(imp.data.total, 3);
  assert.deepEqual(imp.data.failed.map((x) => x.name), ['Arbeit']);
  assert.match(imp.data.failed[0].error, /Fehler 500/);
  assert.ok(pushed.some((p) => p.userId === user.id && p.msg.type === 'calendars'));

  // Neue Kalender mit iCloud-Name, -Farbe und 📱
  const me = (await spy('GET', '/api/me', token)).data;
  const privat = me.calendars.find((c) => c.name === 'Privat');
  assert.equal(privat.color, '#1badf8');
  assert.equal(privat.emoji, '📱');
  assert.equal(privat.subscriptions.length, 1);
  const sub = privat.subscriptions[0];
  assert.equal(sub.kind, 'caldav');
  assert.equal(sub.host, `127.0.0.1:${mock.ports.root}`);
  assert.equal(sub.account, 'g••••@icloud.com');
  assert.equal(sub.count, 2);
  assert.equal(sub.error, null);
  assert.equal(me.calendars.find((c) => c.name === 'Mein Kalender').subscriptions.length, 0);

  // Termine sind da – richtig dekodiert
  let events = (await spy('GET', `/api/events?calendarId=${privat.id}`, token)).data.events;
  const tom = events.find((e) => e.uid === 'tom-1');
  assert.equal(tom.title, 'Tom & Jerry <live>');
  assert.equal(tom.location, 'Kino, Saal 2');
  assert.equal(tom.start, '2026-10-14T18:00:00.000Z');
  const yoga = events.find((e) => e.uid === 'yoga-1');
  assert.equal(yoga.rrule, 'FREQ=WEEKLY;BYDAY=TU');
  assert.equal(yoga.tz, 'Europe/Berlin');
  assert.equal(yoga.start, '2026-10-13T16:30:00.000Z');
  // Abo-Termine lassen sich hier nicht ändern
  assert.equal((await call('PATCH', `/api/events/${tom.id}`, token, { title: 'x' })).status, 409);

  // Gespeicherte Zugangsdaten sind verschlüsselt und lassen sich mit dem Schlüssel öffnen
  const stored = Object.values(db.subscriptions).find((s) => s.calendarId === privat.id);
  assert.equal(stored.type, 'caldav');
  assert.ok(!JSON.stringify(stored).includes(PASS));
  assert.deepEqual(JSON.parse(box.open(stored.creds)), { server: mock.server, username: USER, password: PASS });

  // Auf dem iPhone geändert -> beim Aktualisieren übernommen
  mock.state.home = [
    { id: 'a', data: mock.state.home[0].data.replace('SUMMARY:Tom & Jerry <live>', 'SUMMARY:Tom & Jerry (verschoben)').replace('20261014T18', '20261015T18'), cdata: true },
    { id: 'c', data: ics(['UID:neu-1', 'DTSTART:20261020T090000Z', 'DTEND:20261020T100000Z', 'SUMMARY:Neu vom iPhone']), cdata: false },
  ];
  const synced = await spy('POST', `/api/subscriptions/${sub.id}/sync`, token);
  assert.deepEqual(synced.data, { count: 2 });
  events = (await spy('GET', `/api/events?calendarId=${privat.id}`, token)).data.events;
  assert.deepEqual(events.map((e) => e.title).sort(), ['Neu vom iPhone', 'Tom & Jerry (verschoben)']);
  assert.equal(events.find((e) => e.uid === 'tom-1').id, tom.id, 'gleicher Termin bleibt gleich (Kommentare usw.)');

  // Automatisches Aktualisieren (syncDue) nimmt iPhone-Kalender öfter mit
  mock.state.home = mock.state.home.slice(0, 1);
  stored.lastAttempt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  await core.syncDue(6 * 60 * 60 * 1000);
  assert.equal(Object.values(db.events).filter((e) => e.subscriptionId === stored.id).length, 1);

  // Schon verbundene Kalender sind markiert und werden nicht doppelt importiert
  const again = await spy('POST', '/api/caldav/discover', token, creds());
  assert.deepEqual(again.data.calendars.map((c) => [c.name, c.connected]), [['Arbeit', false], ['Privat', true], ['Geburtstage & Feste', true]]);
  const dup = await spy('POST', '/api/caldav/import', token, { sessionId: again.data.sessionId, calendars: [again.data.calendars[1].id] });
  assert.equal(dup.status, 409);
  const work = await spy('POST', '/api/caldav/import', token, { sessionId: again.data.sessionId, calendars: [again.data.calendars[0].id] });
  assert.deepEqual(work.data.imported.map((x) => [x.name, x.count]), [['Arbeit', 1]]);
  // Die ältere Sitzung ist durch die neue ersetzt
  assert.equal((await call('POST', '/api/caldav/import', token, { sessionId: found.data.sessionId, calendars: [idOf('Arbeit')] })).status, 410);

  // Abgelaufenes Passwort -> Fehler am Abo, Termine bleiben
  stored.creds = box.seal(JSON.stringify({ ...creds(), password: 'widerrufen' }));
  assert.equal((await call('POST', `/api/subscriptions/${sub.id}/sync`, token)).status, 400);
  const broken = (await spy('GET', '/api/me', token)).data.calendars.find((c) => c.id === privat.id).subscriptions[0];
  assert.equal(broken.error, 'Benutzername oder Passwort stimmt nicht.');
  assert.equal(broken.count, 1);

  // Nirgends in den Antworten tauchen Passwort oder verschlüsselte Zugangsdaten auf
  for (const s of seen) {
    assert.ok(!s.includes(PASS), s);
    assert.ok(!s.includes(stored.creds), s);
    assert.ok(!s.includes(USER), s);
  }

  // Abo entfernen löscht Termine und Zugangsdaten
  assert.equal((await call('DELETE', `/api/subscriptions/${sub.id}`, token)).status, 200);
  assert.ok(!Object.values(db.subscriptions).some((s) => s.id === sub.id));
  assert.equal(Object.values(db.events).filter((e) => e.calendarId === privat.id).length, 0);
});

test('Ohne CalDAV (z. B. alte Einrichtung) gibt es eine klare Meldung – Links-Import geht weiter', async () => {
  const { call } = makeCore({ withCaldav: false });
  const { token } = (await call('POST', '/api/users', null, { name: 'Lena' })).data;
  const r = await call('POST', '/api/caldav/discover', token, creds());
  assert.equal(r.status, 501);
  assert.equal(r.data.error, 'Der iPhone-Import ist hier nicht verfügbar.');

  // Bisheriger Import per Link (mit Weiterleitung) als Abo
  const imp = await call('POST', '/api/import', token, { url: `${mock.server}umzug`, subscribe: true, tz: 'Europe/Berlin' });
  assert.equal(imp.status, 200);
  assert.equal(imp.data.count, 1);
  assert.equal(imp.data.createdCalendar, true);
  const cal = (await call('GET', '/api/me', token)).data.calendars.find((c) => c.id === imp.data.calendarId);
  assert.equal(cal.name, 'Feiertage');
  assert.deepEqual(
    { kind: cal.subscriptions[0].kind, host: cal.subscriptions[0].host, account: cal.subscriptions[0].account },
    { kind: 'ics', host: `127.0.0.1:${mock.ports.root}`, account: null },
  );
  assert.deepEqual((await call('POST', `/api/subscriptions/${cal.subscriptions[0].id}/sync`, token)).data, { count: 1 });
  // Datei-Import wie bisher
  const file = await call('POST', '/api/import', token, { ics: ics(['UID:x', 'DTSTART;VALUE=DATE:20261224', 'SUMMARY:Heiligabend']), calendarId: cal.id });
  assert.equal(file.data.count, 1);
});

// Schnell-Eingabe: Alltagsdeutsch → Termin. Fester Zeitpunkt: Montag, 12. Oktober 2026, 10:41 in Berlin
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Vor dem ersten Datum setzen – jede Testdatei läuft in einem eigenen Prozess
process.env.TZ = 'Europe/Berlin';
const { parseQuick } = await import('../public/js/quick-parse.js');

const NOW = new Date(2026, 9, 12, 10, 41);
const CALENDARS = [{ id: 'wg', name: 'WG' }, { id: 'fam', name: 'Familie Müller' }, { id: 'job', name: 'Arbeit' }];
const q = (text, now = NOW) => parseQuick(text, { now, calendars: CALENDARS });
const pad = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d) => `${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Kurzschreibweise: when = 'YYYY-MM-DD' (ganztägig) oder 'YYYY-MM-DD HH:MM–HH:MM' bzw. mit zweitem Datum
function when(p) {
  if (p.allDay) return day(p.start) === day(p.end) ? day(p.start) : `${day(p.start)}–${day(p.end)}`;
  const e = day(p.end) === day(p.start) ? stamp(p.end).slice(11) : stamp(p.end);
  return `${stamp(p.start)}–${e}`;
}
function check(text, want) {
  const p = q(text);
  const got = { title: p.title, when: when(p) };
  for (const k of ['location', 'rrule', 'calendarId', 'emoji']) if (k in want) got[k] = p[k];
  assert.deepEqual(got, want, text);
}

test('Zeitzone für den Test ist aktiv', () => {
  assert.equal(NOW.getTimezoneOffset(), -120);
  assert.equal(NOW.getDay(), 1);
});

test('Das Beispiel aus der Anleitung', () => {
  const p = q('Fr 19 Uhr Pizza bei Max');
  assert.equal(p.title, 'Pizza');
  assert.equal(when(p), '2026-10-16 19:00–20:00');
  assert.equal(p.allDay, false);
  assert.equal(p.location, 'bei Max');
  assert.equal(p.emoji, '🍕');
  assert.equal(p.rrule, undefined);
  assert.deepEqual(p.matched, [
    { from: 0, to: 2, kind: 'date' },
    { from: 3, to: 9, kind: 'time' },
    { from: 16, to: 23, kind: 'location' },
  ]);
});

test('Tage: heute, morgen, übermorgen, Wochentage, Wochenende, in … Tagen/Wochen', () => {
  check('heute Abend Kino', { title: 'Kino', when: '2026-10-12 19:00–20:00' });
  check('morgen um 7 Joggen', { title: 'Joggen', when: '2026-10-13 07:00–08:00' });
  check('übermorgen Friseur', { title: 'Friseur', when: '2026-10-14' });
  check('Mo 9 Uhr Standup', { title: 'Standup', when: '2026-10-12 09:00–10:00' }); // heute ist Montag: Datum genannt, also nicht verschieben
  check('Di 18 Uhr Chor', { title: 'Chor', when: '2026-10-13 18:00–19:00' });
  check('mi 18 uhr chor', { title: 'Chor', when: '2026-10-14 18:00–19:00' });
  check('Zahnarzt Do 8:30', { title: 'Zahnarzt', when: '2026-10-15 08:30–09:30', emoji: '🦷' });
  check('Spieleabend Sa.', { title: 'Spieleabend', when: '2026-10-17' });
  check('So 11 Uhr Brunch', { title: 'Brunch', when: '2026-10-18 11:00–12:00' });
  check('am Freitag Kino', { title: 'Kino', when: '2026-10-16' });
  check('nächsten Freitag Party', { title: 'Party', when: '2026-10-16' });
  check('nächsten Montag Arzt', { title: 'Arzt', when: '2026-10-19' }); // nicht heute
  check('Freitag nächste Woche Kino', { title: 'Kino', when: '2026-10-23' });
  check('nächste Woche Mittwoch Elternabend', { title: 'Elternabend', when: '2026-10-21' });
  check('Sonntagmorgen Brunch', { title: 'Brunch', when: '2026-10-18 08:00–09:00' });
  check('Fr Morgen Laufen', { title: 'Laufen', when: '2026-10-16 08:00–09:00' });
  check('Ausflug am Wochenende', { title: 'Ausflug', when: '2026-10-17' });
  check('Radtour übers Wochenende', { title: 'Radtour', when: '2026-10-17–2026-10-18' });
  check('in 3 Tagen Paket abholen', { title: 'Paket abholen', when: '2026-10-15' });
  check('Kino in 2 Wochen', { title: 'Kino', when: '2026-10-26', location: undefined });
  check('in einer Woche Abgabe', { title: 'Abgabe', when: '2026-10-19' });
  check('in 30 min Anruf', { title: 'Anruf', when: '2026-10-12 11:15–12:15' });
});

test('Daten: 24.10., 24.10.2026, 24. Oktober, am 24., Zeiträume', () => {
  check('Omas Geburtstag 14.11.', { title: 'Omas Geburtstag', when: '2026-11-14', emoji: '🎂' });
  check('Prüfung 24.10.2026', { title: 'Prüfung', when: '2026-10-24' });
  check('Konzert 24. Oktober 20 Uhr', { title: 'Konzert', when: '2026-10-24 20:00–21:00' });
  check('Hochzeit 3. Juni 2027', { title: 'Hochzeit', when: '2027-06-03' });
  check('Neujahrsbrunch 1.1.', { title: 'Neujahrsbrunch', when: '2027-01-01' }); // schon vorbei → nächstes Jahr
  check('Party am 24.', { title: 'Party', when: '2026-10-24' });
  check('Arzt 2026-11-03 9:15', { title: 'Arzt', when: '2026-11-03 09:15–10:15' });
  check('Urlaub vom 24.10. bis 30.10.', { title: 'Urlaub', when: '2026-10-24–2026-10-30' });
  check('Urlaub 24.10.-30.10.', { title: 'Urlaub', when: '2026-10-24–2026-10-30' });
  check('Messe für 3 Tage ab 5.11.', { title: 'Messe', when: '2026-11-05–2026-11-07' });
  check('Fr 16.10. Party', { title: 'Party', when: '2026-10-16' });
});

test('Uhrzeiten: Uhr, 19:30, um 7, halb 8, viertel nach 6, Tageszeiten', () => {
  check('9 Uhr Bericht', { title: 'Bericht', when: '2026-10-13 09:00–10:00' }); // heute schon vorbei → morgen
  check('heute 9 Uhr Bericht', { title: 'Bericht', when: '2026-10-12 09:00–10:00' }); // Datum genannt → bleibt
  check('Essen 19:30', { title: 'Essen', when: '2026-10-12 19:30–20:30' });
  check('Kino 19.30 Uhr', { title: 'Kino', when: '2026-10-12 19:30–20:30' });
  check('Kino um 7', { title: 'Kino', when: '2026-10-13 07:00–08:00' });
  check('um 7 abends Essen', { title: 'Essen', when: '2026-10-12 19:00–20:00' });
  check('7 Uhr abends Essen', { title: 'Essen', when: '2026-10-12 19:00–20:00' });
  check('halb 8 Frühstück', { title: 'Frühstück', when: '2026-10-13 07:30–08:30' });
  check('Theater halb 8 abends', { title: 'Theater', when: '2026-10-12 19:30–20:30' });
  check('viertel nach 6 Bus', { title: 'Bus', when: '2026-10-13 06:15–07:15' });
  check('viertel vor 8 Treffen', { title: 'Treffen', when: '2026-10-13 07:45–08:45' });
  check('Kino um acht abends', { title: 'Kino', when: '2026-10-12 20:00–21:00' });
  check('mittags Essen mit Papa', { title: 'Essen mit Papa', when: '2026-10-12 12:00–13:00' });
  check('um 1 mittags Termin', { title: 'Termin', when: '2026-10-12 13:00–14:00' });
  check('morgens Laufen', { title: 'Laufen', when: '2026-10-13 08:00–09:00' });
  check('Do nachmittags Kaffee', { title: 'Kaffee', when: '2026-10-15 15:00–16:00' });
  check('Fr Abend Spiele', { title: 'Spiele', when: '2026-10-16 19:00–20:00' });
});

test('Zeiträume und Dauer', () => {
  check('Party 18-20 Uhr', { title: 'Party', when: '2026-10-12 18:00–20:00' });
  check('Meeting von 18 bis 20:30', { title: 'Meeting', when: '2026-10-12 18:00–20:30' });
  check('Party ab 18 Uhr bis 20 Uhr', { title: 'Party', when: '2026-10-12 18:00–20:00' });
  check('zwischen 18 und 20 Uhr Abholung', { title: 'Abholung', when: '2026-10-12 18:00–20:00' });
  check('von 6 bis 8 abends Grillen', { title: 'Grillen', when: '2026-10-12 18:00–20:00' });
  check('Treffen 22-1 Uhr', { title: 'Treffen', when: '2026-10-12 22:00–2026-10-13 01:00' });
  check('Lesung bis 20 Uhr', { title: 'Lesung', when: '2026-10-12 19:00–20:00' });
  check('18 Uhr Kochkurs 2 Stunden', { title: 'Kochkurs', when: '2026-10-12 18:00–20:00' });
  check('Zahnarzt Do 8:30 1,5 h', { title: 'Zahnarzt', when: '2026-10-15 08:30–10:00' });
  check('Lernen 90 min morgen 14 Uhr', { title: 'Lernen', when: '2026-10-13 14:00–15:30' });
  check('Telefonat eine halbe Stunde 16 Uhr', { title: 'Telefonat', when: '2026-10-12 16:00–16:30' });
  check('Film anderthalb Stunden 20:15', { title: 'Film', when: '2026-10-12 20:15–21:45' });
});

test('Ganztägig', () => {
  check('Ausflug Sa ganztägig', { title: 'Ausflug', when: '2026-10-17' });
  check('Umzug morgen den ganzen Tag', { title: 'Umzug', when: '2026-10-13' });
  check('Workshop Fr 9 Uhr ganztags', { title: 'Workshop', when: '2026-10-16' });
});

test('Wiederholungen werden zur RRULE', () => {
  check('Yoga jeden Dienstag 18 Uhr', { title: 'Yoga', when: '2026-10-13 18:00–19:00', rrule: 'FREQ=WEEKLY' });
  check('jede Woche Putzen', { title: 'Putzen', when: '2026-10-12 11:00–12:00', rrule: 'FREQ=WEEKLY' });
  check('wöchentlich Chor Mi 19 Uhr', { title: 'Chor', when: '2026-10-14 19:00–20:00', rrule: 'FREQ=WEEKLY' });
  check('alle 2 Wochen Mo Chor 19:30', { title: 'Chor', when: '2026-10-12 19:30–20:30', rrule: 'FREQ=WEEKLY;INTERVAL=2' });
  check('alle 14 Tage Altpapier', { title: 'Altpapier', rrule: 'FREQ=WEEKLY;INTERVAL=2', when: '2026-10-12 11:00–12:00' });
  check('jeden Monat Miete ganztägig', { title: 'Miete', when: '2026-10-12', rrule: 'FREQ=MONTHLY' });
  check('Weihnachten 24.12. jährlich', { title: 'Weihnachten', when: '2026-12-24', rrule: 'FREQ=YEARLY' });
  check('Training jeden Mo und Mi 19 Uhr', { title: 'Training', when: '2026-10-12 19:00–20:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' });
  check('dienstags Training 18 Uhr', { title: 'Training', when: '2026-10-13 18:00–19:00', rrule: 'FREQ=WEEKLY' });
  check('jeden ersten Montag Stammtisch 19 Uhr', { title: 'Stammtisch', when: '2026-11-02 19:00–20:00', rrule: 'FREQ=MONTHLY;BYDAY=1MO' });
  check('Arbeit 9:00-17:00 werktags', { title: 'Arbeit', when: '2026-10-13 09:00–17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
  check('Kurs jeden Montag 18 Uhr bis 30.11.', { title: 'Kurs', when: '2026-10-12 18:00–19:00', rrule: 'FREQ=WEEKLY;UNTIL=20261130' });
  check('Laufen jeden Morgen', { title: 'Laufen', when: '2026-10-13 08:00–09:00', rrule: 'FREQ=DAILY' });
});

test('Orte: bei, im, in der, am, @ – aber „in 2 Wochen“ ist kein Ort', () => {
  check('Essen bei Oma mit Lena So 12 Uhr', { title: 'Essen mit Lena', when: '2026-10-18 12:00–13:00', location: 'bei Oma' });
  check('Party im Café Lotte Sa 20 Uhr', { title: 'Party', when: '2026-10-17 20:00–21:00', location: 'Café Lotte' });
  check('Volleyball in der Turnhalle Di 19 Uhr', { title: 'Volleyball', when: '2026-10-13 19:00–20:00', location: 'Turnhalle' });
  check('Fußball @ Sportplatz am Wochenende 15 Uhr', { title: 'Fußball', when: '2026-10-17 15:00–16:00', location: 'Sportplatz' });
  check('Grillen am See 18 Uhr', { title: 'Grillen', when: '2026-10-12 18:00–19:00', location: 'See' });
  check('Kaffee Fr 15:30 im Café am Markt', { title: 'Kaffee', when: '2026-10-16 15:30–16:30', location: 'Café am Markt' });
  check('Termin beim Zahnarzt Di 10 Uhr', { title: 'Termin', when: '2026-10-13 10:00–11:00', location: 'beim Zahnarzt', emoji: '🦷' });
  check('Kino in Berlin', { title: 'Kino', when: '2026-10-12 11:00–12:00', location: 'Berlin' });
  check('Essen im Mai', { title: 'Essen im Mai', when: '2026-10-12 11:00–12:00', location: undefined });
  check('bei Max 19 Uhr', { title: 'Bei Max', when: '2026-10-12 19:00–20:00', location: 'bei Max' });
});

test('Kalender per #Name, auch ungenau', () => {
  check('Putzen Sa #WG', { title: 'Putzen', when: '2026-10-17', calendarId: 'wg' });
  check('Putzen Sa #wg', { title: 'Putzen', when: '2026-10-17', calendarId: 'wg' });
  check('Essen #familie So 12 Uhr', { title: 'Essen', when: '2026-10-18 12:00–13:00', calendarId: 'fam' });
  check('Essen #Familie Müller So', { title: 'Essen', when: '2026-10-18', calendarId: 'fam' });
  check('Meeting #arbiet Mo 14 Uhr', { title: 'Meeting', when: '2026-10-12 14:00–15:00', calendarId: 'job' });
  check('Kaffee 15 Uhr #xyz', { title: 'Kaffee #xyz', when: '2026-10-12 15:00–16:00', calendarId: undefined });
});

test('Kniffliges: Kurzformen, die normale Wörter sind, Emojis, Titel aufräumen', () => {
  check('so ein Tag', { title: 'So ein Tag', when: '2026-10-12 11:00–12:00' });
  check('Kaffee mit Mo um 9', { title: 'Kaffee mit Mo', when: '2026-10-13 09:00–10:00' });
  check('eine Uhr kaufen', { title: 'Eine Uhr kaufen', when: '2026-10-12 11:00–12:00' });
  check('Pizza', { title: 'Pizza', when: '2026-10-12 11:00–12:00', emoji: '🍕' });
  check('🎉 Party Sa 20 Uhr', { title: 'Party', when: '2026-10-17 20:00–21:00', emoji: '🎉' });
  check('Spieleabend, Fr, 19 Uhr', { title: 'Spieleabend', when: '2026-10-16 19:00–20:00' });
  check('kino am fr um 20 uhr', { title: 'Kino', when: '2026-10-16 20:00–21:00' });
  check('Rückgabe 1.5 Stunden', { title: 'Rückgabe', when: '2026-10-12 11:00–12:30' });
  check('', { title: '', when: '2026-10-12 11:00–12:00' });
});

test('Spät am Abend: vergangene Uhrzeit ohne Datum rutscht auf morgen, Zeitumstellung passt', () => {
  const late = new Date(2026, 9, 24, 21, 5); // Samstag vor der Zeitumstellung
  const p = q('Joggen 7:30', late);
  assert.equal(stamp(p.start), '2026-10-25 07:30');
  assert.equal(p.end - p.start, 3600e3);
  assert.equal(stamp(q('abends Kino', late).start), '2026-10-25 19:00');
  assert.equal(stamp(q('heute abends Kino', late).start), '2026-10-24 19:00');
});

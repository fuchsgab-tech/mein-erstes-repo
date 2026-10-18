import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, parseIcs } from '../server/ics.js';
import { isPrivateAddress, normalizeCalendarUrl } from '../server/safe-fetch.js';

const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:Familie',
  'X-WR-TIMEZONE:Europe/Berlin',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:geburtstag-1',
  'DTSTART;VALUE=DATE:20261012',
  'DTEND;VALUE=DATE:20261013',
  'RRULE:FREQ=YEARLY',
  'SUMMARY:Omas Geburtstag 🎂',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:yoga',
  'DTSTART;TZID=Europe/Berlin:20261005T183000',
  'DTEND;TZID=Europe/Berlin:20261005T193000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'EXDATE;TZID=Europe/Berlin:20261012T183000',
  'SUMMARY:Yoga',
  'LOCATION:Studio\\, Hinterhof',
  'DESCRIPTION:Matte mitbringen\\nund Wasser',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:yoga',
  'RECURRENCE-ID;TZID=Europe/Berlin:20261019T183000',
  'DTSTART;TZID=Europe/Berlin:20261019T190000',
  'DTEND;TZID=Europe/Berlin:20261019T200000',
  'SUMMARY:Yoga (später)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:urlaub',
  'DTSTART;VALUE=DATE:20261101',
  'DTEND;VALUE=DATE:20261108',
  'SUMMARY:Urlaub mit einem sehr langen Titel der über mehrere Zeilen gefaltet',
  '  wird',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:abgesagt',
  'DTSTART:20261020T100000Z',
  'DURATION:PT1H',
  'STATUS:CANCELLED',
  'SUMMARY:Fällt aus',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:outlook',
  'DTSTART;TZID="W. Europe Standard Time":20261021T090000',
  'DURATION:PT1H30M',
  'SUMMARY:Outlook-Termin',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('liest typische .ics-Dateien von Google, Apple und Outlook', () => {
  const { name, events } = parseIcs(SAMPLE, 'UTC');
  assert.equal(name, 'Familie');
  assert.equal(events.length, 5);
  const by = (uid, rec = null) => events.find((e) => e.uid === uid && e.recurrenceId === rec);

  const bday = by('geburtstag-1');
  assert.deepEqual([bday.allDay, bday.start, bday.end, bday.rrule], [true, '2026-10-12', '2026-10-12', 'FREQ=YEARLY']);

  const yoga = by('yoga');
  assert.equal(yoga.start, '2026-10-05T16:30:00.000Z');
  assert.equal(yoga.tz, 'Europe/Berlin');
  assert.equal(yoga.location, 'Studio, Hinterhof');
  assert.equal(yoga.notes, 'Matte mitbringen\nund Wasser');
  assert.deepEqual(yoga.exdates, ['2026-10-12T16:30:00.000Z', '2026-10-19T16:30:00.000Z']);

  const moved = by('yoga', '2026-10-19T16:30:00.000Z');
  assert.equal(moved.title, 'Yoga (später)');
  assert.equal(moved.rrule, null);

  const trip = by('urlaub');
  assert.equal(trip.end, '2026-11-07');
  assert.match(trip.title, /gefaltet wird$/);

  const outlook = by('outlook');
  assert.equal(outlook.start, '2026-10-21T07:00:00.000Z');
  assert.equal(outlook.end, '2026-10-21T08:30:00.000Z');
});

test('lehnt Dateien ab, die keine Kalender sind', () => {
  assert.throws(() => parseIcs('hallo welt'), /Kalenderdatei/);
});

test('Export lässt sich wieder einlesen', () => {
  const cal = { name: 'WG', emoji: '🏠' };
  const events = [
    { id: 'e1', title: 'Putzplan; Küche, Bad', allDay: true, start: '2026-10-12', end: '2026-10-13', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'e2', title: 'Spieleabend', allDay: false, start: '2026-10-16T17:00:00.000Z', end: '2026-10-16T21:00:00.000Z', tz: 'Europe/Berlin', rrule: 'FREQ=WEEKLY', exdates: ['2026-10-23T17:00:00.000Z'], createdAt: '2026-10-01T00:00:00Z' },
  ];
  const text = buildIcs(cal, events, 'example.org');
  assert.ok(text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  const back = parseIcs(text, 'UTC');
  assert.equal(back.name, '🏠 WG');
  assert.equal(back.events[0].title, 'Putzplan; Küche, Bad');
  assert.equal(back.events[0].end, '2026-10-13');
  assert.equal(back.events[1].start, '2026-10-16T17:00:00.000Z');
  assert.equal(back.events[1].tz, 'Europe/Berlin');
  assert.deepEqual(back.events[1].exdates, ['2026-10-23T17:00:00.000Z']);
});

test('Kalender-Links: webcal wird zu https, interne Adressen sind gesperrt', () => {
  assert.equal(normalizeCalendarUrl('webcal://p01-caldav.icloud.com/published/2/abc'), 'https://p01-caldav.icloud.com/published/2/abc');
  assert.throws(() => normalizeCalendarUrl('file:///etc/passwd'));
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress('142.250.185.78'), false);
});

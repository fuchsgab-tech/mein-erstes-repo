import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRrule, joinRrule, occurrences, splitRrule } from '../public/js/recur.js';
import { wallParts, zonedToUtc } from '../public/js/time.js';

const range = (a, b) => [new Date(a), new Date(b)];
const starts = (list) => list.map((o) => o.start.toISOString());

test('Zeitzonen-Umrechnung berücksichtigt die Sommerzeit', () => {
  // 10:00 in Berlin ist im Winter 09:00 UTC und im Sommer 08:00 UTC
  assert.equal(new Date(zonedToUtc(2026, 1, 15, 10, 0, 0, 'Europe/Berlin')).toISOString(), '2026-01-15T09:00:00.000Z');
  assert.equal(new Date(zonedToUtc(2026, 7, 15, 10, 0, 0, 'Europe/Berlin')).toISOString(), '2026-07-15T08:00:00.000Z');
  assert.deepEqual(wallParts(Date.parse('2026-07-15T08:00:00Z'), 'Europe/Berlin'), { y: 2026, m: 7, d: 15, h: 10, mi: 0, s: 0 });
});

test('einzelner Termin wird nur im passenden Zeitraum gefunden', () => {
  const ev = { id: 'a', allDay: false, start: '2026-10-12T12:00:00.000Z', end: '2026-10-12T13:00:00.000Z', tz: 'Europe/Berlin' };
  assert.equal(occurrences(ev, ...range('2026-10-01', '2026-11-01')).length, 1);
  assert.equal(occurrences(ev, ...range('2026-11-01', '2026-12-01')).length, 0);
});

test('wöchentliche Serie bleibt über die Zeitumstellung um 10 Uhr', () => {
  const ev = {
    id: 'w', allDay: false, tz: 'Europe/Berlin', rrule: 'FREQ=WEEKLY',
    start: '2026-10-19T08:00:00.000Z', end: '2026-10-19T09:00:00.000Z', // Mo 10:00 Sommerzeit
  };
  const list = occurrences(ev, ...range('2026-10-01', '2026-11-10'));
  assert.deepEqual(starts(list), [
    '2026-10-19T08:00:00.000Z',
    '2026-10-26T09:00:00.000Z', // nach der Umstellung wieder 10:00 Ortszeit
    '2026-11-02T09:00:00.000Z',
    '2026-11-09T09:00:00.000Z',
  ]);
});

test('BYDAY, COUNT, UNTIL und EXDATE', () => {
  const base = { id: 'x', allDay: true, start: '2026-10-05', end: '2026-10-05' }; // Montag
  const r = range('2026-10-01', '2026-12-31');
  const ymds = (list) => list.map((o) => o.orig);

  assert.deepEqual(ymds(occurrences({ ...base, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4' }, ...r)),
    ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14']);
  assert.deepEqual(ymds(occurrences({ ...base, rrule: 'FREQ=DAILY;UNTIL=20261008' }, ...r)),
    ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
  assert.deepEqual(ymds(occurrences({ ...base, rrule: 'FREQ=DAILY;COUNT=3', exdates: ['2026-10-06'] }, ...r)),
    ['2026-10-05', '2026-10-07']);
});

test('monatlich am letzten Freitag und jährlich am 2. Sonntag im Mai', () => {
  const lastFri = { id: 'm', allDay: true, start: '2026-01-30', end: '2026-01-30', rrule: 'FREQ=MONTHLY;BYDAY=-1FR' };
  assert.deepEqual(occurrences(lastFri, ...range('2026-01-01', '2026-04-01')).map((o) => o.orig),
    ['2026-01-30', '2026-02-27', '2026-03-27']);

  const mothersDay = { id: 'y', allDay: true, start: '2026-05-10', end: '2026-05-10', rrule: 'FREQ=YEARLY;BYMONTH=5;BYDAY=2SU' };
  assert.deepEqual(occurrences(mothersDay, ...range('2026-01-01', '2029-01-01')).map((o) => o.orig),
    ['2026-05-10', '2027-05-09', '2028-05-14']);
});

test('Geburtstag am 31. wird in kurzen Monaten übersprungen, mehrtägige Termine bleiben mehrtägig', () => {
  const ev = { id: 'b', allDay: true, start: '2026-01-31', end: '2026-01-31', rrule: 'FREQ=MONTHLY' };
  assert.deepEqual(occurrences(ev, ...range('2026-01-01', '2026-06-01')).map((o) => o.orig),
    ['2026-01-31', '2026-03-31', '2026-05-31']);

  const trip = { id: 't', allDay: true, start: '2026-10-09', end: '2026-10-11', rrule: 'FREQ=YEARLY' };
  const [o] = occurrences(trip, ...range('2027-10-01', '2027-11-01'));
  assert.equal(o.orig, '2027-10-09');
  assert.equal(o.end.getDate(), 12); // Ende exklusiv
});

test('alte tägliche Serie wird schnell bis zum sichtbaren Monat gespult', () => {
  const ev = { id: 'd', allDay: false, tz: 'UTC', rrule: 'FREQ=DAILY', start: '2000-01-01T07:00:00.000Z', end: '2000-01-01T07:30:00.000Z' };
  const list = occurrences(ev, ...range('2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z'));
  assert.equal(list.length, 7);
});

test('Beschreibung und Zerlegen der Regel', () => {
  const start = new Date(2026, 9, 12); // Montag, 12. Oktober
  assert.equal(describeRrule('FREQ=WEEKLY', start), 'Wöchentlich am Montag');
  assert.equal(describeRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', start), 'Alle 2 Wochen am Mo, Mi');
  assert.equal(describeRrule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', start), 'Wöchentlich am Mo–Fr');
  assert.equal(describeRrule('FREQ=MONTHLY;BYDAY=2MO', start), 'Monatlich am zweiten Montag');
  assert.equal(describeRrule('FREQ=YEARLY;UNTIL=20301231', start), 'Jährlich am 12. Oktober · bis 31.12.2030');
  assert.deepEqual(splitRrule('FREQ=WEEKLY;UNTIL=20301231T235959Z'), { pattern: 'FREQ=WEEKLY', until: '2030-12-31' });
  assert.equal(joinRrule('FREQ=DAILY', '2026-12-24'), 'FREQ=DAILY;UNTIL=20261224');
  assert.equal(joinRrule('', '2026-12-24'), null);
});

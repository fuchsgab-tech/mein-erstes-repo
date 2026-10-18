// Wochenraster und Tagesfortschritt an Tagen mit Zeitumstellung (Europe/Berlin)
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Vor dem ersten Datum setzen – jede Testdatei läuft in einem eigenen Prozess
process.env.TZ = 'Europe/Berlin';
const { dayFraction, dayMinutes, wallMinutes } = await import('../public/js/time.js');

const at = (d, h, mi = 0) => new Date(2026, d[0] - 1, d[1], h, mi);
const OCT25 = [10, 25]; // Uhren eine Stunde zurück: der Tag hat 25 Stunden
const MAR29 = [3, 29]; // Uhren eine Stunde vor: der Tag hat 23 Stunden

test('Zeitzone für den Test ist aktiv', () => {
  assert.equal(at(OCT25, 0).getTimezoneOffset(), -120);
  assert.equal(at(OCT25, 12).getTimezoneOffset(), -60);
  assert.equal(at(MAR29, 0).getTimezoneOffset(), -60);
  assert.equal(at(MAR29, 12).getTimezoneOffset(), -120);
});

test('25. Oktober: Termine ab 3 Uhr stehen an ihrer Uhrzeit, nicht eine Stunde später', () => {
  const day = at(OCT25, 0);
  // So hat es die Woche früher gerechnet: eine Stunde zu spät
  assert.equal((at(OCT25, 10) - day) / 60000, 660);
  assert.deepEqual(dayMinutes(at(OCT25, 10), at(OCT25, 11, 30), day), { s: 600, e: 690 });
  assert.deepEqual(dayMinutes(at(OCT25, 18), at(OCT25, 19), day), { s: 1080, e: 1140 });
  // vor der Umstellung ändert sich nichts
  assert.deepEqual(dayMinutes(at(OCT25, 0, 30), at(OCT25, 1, 30), day), { s: 30, e: 90 });
  // über die Umstellung hinweg: Höhe passt zur Skala (01:30 bis 03:30), obwohl 3 Stunden vergehen
  assert.deepEqual(dayMinutes(at(OCT25, 1, 30), at(OCT25, 3, 30), day), { s: 90, e: 210 });
  // als Zeitstempel: 09:00 UTC ist nach der Umstellung 10:00 in Berlin
  assert.deepEqual(dayMinutes(Date.parse('2026-10-25T09:00:00Z'), Date.parse('2026-10-25T10:00:00Z'), day), { s: 600, e: 660 });
});

test('29. März: Termine ab 3 Uhr stehen an ihrer Uhrzeit, nicht eine Stunde früher', () => {
  const day = at(MAR29, 0);
  assert.equal((at(MAR29, 10) - day) / 60000, 540);
  assert.deepEqual(dayMinutes(at(MAR29, 10), at(MAR29, 11), day), { s: 600, e: 660 });
  assert.deepEqual(dayMinutes(at(MAR29, 20, 15), at(MAR29, 22, 45), day), { s: 1215, e: 1365 });
  // 01:30 bis 03:30 dauert nur eine Stunde, reicht im Raster aber trotzdem bis 03:30
  assert.deepEqual(dayMinutes(at(MAR29, 1, 30), at(MAR29, 3, 30), day), { s: 90, e: 210 });
});

test('Ränder des Tages und Mindestlänge', () => {
  const day = at(OCT25, 0);
  // bis Mitternacht: endet unten am Raster
  assert.deepEqual(dayMinutes(at(OCT25, 22), at([10, 26], 0), day), { s: 1320, e: 1440 });
  // vom Vortag herein: beginnt oben
  assert.deepEqual(dayMinutes(at([10, 24], 22), at(OCT25, 4), day), { s: 0, e: 240 });
  // kurze Termine bleiben anklickbar, ragen aber nicht über den Tag hinaus
  assert.deepEqual(dayMinutes(at(OCT25, 9), at(OCT25, 9, 5), day, 20), { s: 540, e: 560 });
  assert.deepEqual(dayMinutes(at(OCT25, 23, 50), at(OCT25, 23, 55), day, 20), { s: 1430, e: 1440 });
  // ein Tag mit dem Termin als Datum irgendwann am Tag geht auch
  assert.deepEqual(dayMinutes(at(MAR29, 10), at(MAR29, 11), at(MAR29, 15)), { s: 600, e: 660 });
});

test('Tagesfortschritt folgt der Uhr – auch an langen und kurzen Tagen', () => {
  assert.equal(wallMinutes(at(OCT25, 12)), 720);
  assert.equal(dayFraction(at(OCT25, 12)), 0.5);
  assert.equal(dayFraction(at(MAR29, 12)), 0.5);
  assert.ok(dayFraction(at(OCT25, 23, 59)) < 1);
  assert.ok(dayFraction(at(MAR29, 23, 59)) > 0.99);
  assert.equal(wallMinutes(new Date(2026, 9, 25, 7, 30, 30)), 450.5);
});

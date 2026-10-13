import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRecapYear, emojiOf, plainTitle, recapSeason, recapStats } from '../public/js/recap-stats.js';

const ME = 'me';
const me = { id: ME, name: 'Ich' };
const lena = { id: 'lena', name: 'Lena', color: '#a46cf0' };
const max = { id: 'max', name: 'Max', color: '#f2675b' };
const own = { id: 'own', name: 'Ich', members: [me] };
const wg = { id: 'wg', name: 'WG', members: [me, lena, max] };
const family = { id: 'fam', name: 'Familie', members: [me, max] };
const holidays = { id: 'hol', name: 'Feiertage', members: [me] };

let seq = 0;
// Termin mit Uhrzeit in Ortszeit
const ev = (title, y, m, d, hh, mm = 0, mins = 60, extra = {}) => {
  const s = new Date(y, m - 1, d, hh, mm);
  return { id: `e${++seq}`, calendarId: 'own', title, allDay: false, start: s.toISOString(), end: new Date(s.getTime() + mins * 6e4).toISOString(), createdBy: ME, ...extra };
};
const allDay = (title, ymd, extra = {}) => ({ id: `e${++seq}`, calendarId: 'own', title, allDay: true, start: ymd, end: ymd, createdBy: ME, ...extra });
const NOW = new Date(2026, 9, 13, 12, 0);
const run = (events, opts = {}) => recapStats({ events, calendars: [own, wg, family, holidays], meId: ME, year: 2026, now: NOW, ...opts });

test('Emojis und Titel: erstes Emoji im Titel, sonst der Vorschlag', () => {
  assert.equal(emojiOf('Yoga 🧘‍♀️ im Park'), '🧘‍♀️');
  assert.equal(emojiOf('Pizza-Abend'), '🍕');
  assert.equal(emojiOf('Xyzzy'), '');
  assert.equal(plainTitle('🎉 Party  bei Max 🍻'), 'Party bei Max');
});

test('Leeres Jahr: alles null, Typ „Garten-Neuling“', () => {
  const s = run([]);
  assert.equal(s.count, 0);
  assert.equal(s.hours, 0);
  assert.equal(s.weekday, null);
  assert.equal(s.daypart, null);
  assert.equal(s.month, null);
  assert.equal(s.streak, null);
  assert.equal(s.first, null);
  assert.deepEqual(s.topEmojis, []);
  assert.equal(s.type.key, 'neuling');
  // Freunde und gemeinsame Kalender gibt es trotzdem
  assert.equal(s.sharedCalendars, 2);
  assert.equal(s.friends, 2);
  assert.equal(s.friend.via, 'calendars');
  assert.equal(s.friend.id, 'max'); // in zwei gemeinsamen Kalendern
  assert.equal(s.friend.count, 2);
});

test('Zählt nur das Jahr bis heute, Stunden nur mit Uhrzeit, Feiertage nicht', () => {
  const s = run([
    ev('Zahnarzt', 2025, 12, 31, 10), // letztes Jahr
    ev('Kino 🍿', 2026, 1, 2, 20, 0, 150),
    ev('Brunch 🥐', 2026, 3, 7, 11, 0, 120),
    allDay('Urlaub 🏖️', '2026-08-03', { end: '2026-08-09' }),
    ev('Konzert 🎸', 2026, 11, 20, 20), // nach heute
    allDay('Tag der Deutschen Einheit', '2026-10-03', { calendarId: 'hol' }),
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.hours, 4.5);
  assert.equal(s.days, 3);
  assert.equal(s.partial, true);
  assert.equal(s.first.title, 'Kino 🍿');
  assert.equal(s.first.emoji, '🍿');
  assert.equal(s.months[7], 1);
  // Für das letzte Jahr: ganzes Jahr, nicht „bis heute“
  const last = run([ev('Zahnarzt', 2025, 12, 31, 10)], { year: 2025 });
  assert.equal(last.count, 1);
  assert.equal(last.partial, false);
});

test('Lieblingstag, Tageszeit, Monat und Top-Emojis', () => {
  const list = [];
  // 10× Samstag abends Spieleabend, 4× Dienstag morgens Laufen, 2× Pizza
  for (let i = 0; i < 10; i++) list.push(ev('Spieleabend 🎲', 2026, 5, 2 + i * 7, 19)); // 2. Mai 2026 ist ein Samstag
  for (let i = 0; i < 4; i++) list.push(ev('Laufen', 2026, 2, 3 + i * 7, 7)); // Dienstag
  list.push(ev('Pizza-Abend', 2026, 9, 1, 19), ev('Pizza 🍕', 2026, 9, 2, 19));
  const s = run(list);
  assert.equal(s.count, 16);
  assert.equal(s.weekday.name, 'Samstag');
  assert.equal(s.weekday.count, 10);
  assert.equal(s.daypart.key, 'evening');
  assert.equal(s.daypart.count, 12);
  assert.equal(s.month.name, 'Mai'); // 5 Samstage im Mai
  assert.deepEqual(s.topEmojis.map((e) => [e.emoji, e.count]), [['🎲', 10], ['🏃', 4], ['🍕', 2]]);
  assert.equal(s.type.key, 'party');
  assert.match(s.type.text, /75 %/);
});

test('Längste Serie: Wochen am Stück, auch über Serien und gleiche Titel', () => {
  const yoga = ev('Yoga 🧘', 2026, 1, 5, 18, 30, 60, { rrule: 'FREQ=WEEKLY;COUNT=12' });
  const list = [yoga, ev('Chor', 2026, 3, 2, 19), ev('Chor', 2026, 3, 9, 19), ev('Chor 🎶', 2026, 3, 16, 19), ev('Chor', 2026, 3, 30, 19)];
  const s = run(list);
  assert.equal(s.streak.weeks, 12);
  assert.equal(s.streak.title, 'Yoga 🧘');
  assert.equal(s.streak.from.getDate(), 5);
  assert.equal(s.streak.to.getMonth(), 2); // 23. März
  // Ohne Yoga gewinnt der Chor mit 3 Wochen (die Lücke am 23. zählt nicht)
  const chor = run(list.slice(1));
  assert.equal(chor.streak.weeks, 3);
  assert.equal(chor.streak.emoji, '🎶');
  // Einzelne Termine sind keine Serie
  assert.equal(run([ev('Kino', 2026, 1, 2, 20)]).streak, null);
});

test('Gemeinsame Kalender: nur eigene Termine und Zusagen, Lieblingsmensch nach geteilten Terminen', () => {
  const list = [
    // Lena trägt ein, ich bin dabei → zählt, mit Lena
    ev('WG-Dinner 🍝', 2026, 2, 1, 19, 0, 120, { calendarId: 'wg', createdBy: 'lena', attendees: ['lena', ME] }),
    ev('Kino mit Lena', 2026, 4, 1, 20, 0, 120, { calendarId: 'wg', createdBy: ME, attendees: [ME, 'lena'] }),
    // Max trägt ein, ich bin nicht dabei → zählt nicht
    ev('Bandprobe', 2026, 4, 2, 19, 0, 120, { calendarId: 'wg', createdBy: 'max', attendees: ['max'] }),
    // Serie von Max: nur am 2. Termin bin ich dabei
    ev('Bouldern 🧗', 2026, 6, 1, 18, 0, 90, {
      calendarId: 'fam', createdBy: 'max', rrule: 'FREQ=WEEKLY;COUNT=3', attendees: ['max'],
      attendeesByOcc: { [new Date(2026, 5, 8, 18).toISOString()]: ['max', ME] },
    }),
    // Jemand, der nicht (mehr) in meinen Kalendern ist, zählt nicht als Freund
    ev('Party', 2026, 7, 1, 21, 0, 180, { calendarId: 'wg', createdBy: ME, attendees: [ME, 'fremd'] }),
  ];
  const s = run(list);
  assert.equal(s.count, 4);
  assert.equal(s.friend.id, 'lena');
  assert.equal(s.friend.name, 'Lena');
  assert.equal(s.friend.count, 2);
  assert.equal(s.friend.via, 'events');
  assert.equal(s.shares.shared, 0.75);
});

test('Zeitgarten-Typ passt zu den Zahlen', () => {
  const sport = [];
  for (let i = 0; i < 8; i++) sport.push(ev('Fußball ⚽️', 2026, 3, 2 + i * 7, 18));
  for (let i = 0; i < 8; i++) sport.push(ev('Zahnarzt', 2026, 6, 1 + i, 9));
  assert.equal(run(sport).type.label, 'Sport-Maschine');

  const night = [];
  for (let i = 0; i < 12; i++) night.push(ev(`Treffen ${i}`, 2026, 4, 1 + i, 22, 30));
  assert.equal(run(night).type.key, 'night');

  const neutral = [];
  for (let i = 0; i < 6; i++) neutral.push(ev(`Termin ${i}`, 2026, 4, 1 + i * 3, 9 + i * 2));
  assert.equal(run(neutral).type.key, 'allround');
});

test('Zeitraum: Rückblick ab 1. Dezember bis 15. Januar, im Januar das alte Jahr', () => {
  assert.equal(recapSeason(new Date(2026, 11, 1)), true);
  assert.equal(recapSeason(new Date(2027, 0, 15, 22)), true);
  assert.equal(recapSeason(new Date(2027, 0, 16)), false);
  assert.equal(recapSeason(new Date(2026, 10, 30)), false);
  assert.equal(defaultRecapYear(new Date(2027, 0, 10)), 2026);
  assert.equal(defaultRecapYear(new Date(2026, 9, 13)), 2026);
});

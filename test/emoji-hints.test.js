import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestEmoji } from '../public/js/emoji-hints.js';

const expect = (cases) => {
  for (const [title, emoji] of Object.entries(cases)) assert.equal(suggestEmoji(title), emoji, title);
};

test('Alltag auf Deutsch bekommt ein passendes Emoji', () => {
  expect({
    'Pizza-Abend': '🍕', Sushi: '🍣', 'Burger essen': '🍔', Kaffee: '☕', 'Frühstück mit Lena': '🥐',
    Brunch: '🥞', Grillen: '🍖', 'Mittagessen mit Papa': '🍽️', Spieleabend: '🎲', Raclette: '🫕',
    Fußball: '⚽', Fußballtraining: '⚽', Training: '🏋️', Laufen: '🏃', Joggen: '🏃', Yoga: '🧘',
    'Hatha-Yoga': '🧘', Gym: '🏋️', Schwimmen: '🏊', Tennis: '🎾', Tischtennis: '🏓', 'Rad fahren': '🚴',
    Arzt: '🩺', Hausarzt: '🩺', Kinderarzttermin: '🩺', Zahnarzt: '🦷', Zahnarzttermin: '🦷', Physio: '🤸',
    Friseur: '💇', Tierarzt: '🐾', Grippeimpfung: '💉',
    Arbeit: '💼', 'Team-Meeting': '👥', Call: '📞', Präsentation: '📊', Schule: '🏫', Uni: '🎓',
    Prüfung: '📝', Matheprüfung: '📝', Elternabend: '🏫',
    Urlaub: '🏖️', Sommerurlaub: '🏖️', 'Flug nach Rom': '✈️', Zug: '🚆', Hotel: '🏨', Strand: '🏖️', Skiurlaub: '⛷️',
    Party: '🎉', Gartenparty: '🎉', Geburtstag: '🎂', Kindergeburtstag: '🎂', Hochzeit: '💍', Jahrestag: '💕',
    Konzert: '🎶', Kino: '🍿', Theater: '🎭', Festival: '🎪',
    Putzen: '🧹', Einkaufen: '🛒', 'Müll rausbringen': '🗑️', Wäsche: '🧺', Umzug: '📦',
    Familientreffen: '👪', Kinder: '🧒', Kita: '🧸', Kindergarten: '🧸', Hund: '🐶', Hundeschule: '🐶',
    Auto: '🚗', Werkstatt: '🔧', TÜV: '🚗', Fahrschule: '🚗', Steuererklärung: '🧾', Geld: '💶',
    Gaming: '🎮', Lesen: '📖', Garten: '🌻', 'Oma besuchen': '👵',
  });
});

test('Umlaute, ß und Großschreibung sind egal', () => {
  expect({
    FRÜHSTÜCK: '🥐', Fruehstueck: '🥐', Fussball: '⚽', FUSSBALL: '⚽', Muell: '🗑️', tuev: '🚗',
    'Zahnärztin': '🦷', 'Hausärztin': '🩺', Frisör: '💇', 'Café Lotte': '☕',
  });
});

test('Englische Titel gehen auch', () => {
  expect({
    Breakfast: '🥐', Lunch: '🍽️', Coffee: '☕', 'Team meeting': '👥', 'Birthday party': '🎂',
    Wedding: '💍', Flight: '✈️', 'Train to Berlin': '🚆', Gym: '🏋️', Running: '🏃', Doctor: '🩺',
    Dentist: '🦷', Haircut: '💇', Cinema: '🍿', Concert: '🎶', Laundry: '🧺', 'Game night': '🎲',
  });
});

test('keine albernen Treffer', () => {
  expect({
    'Termin bei Müller': '', Schwarztee: '', Uniform: '', Skizze: '', Autorenlesung: '📖',
    Dienstag: '', 'Bärbel anrufen': '📞', Preise: '', Messen: '', Ablauf: '', Hundert: '', Omar: '',
    Festnetz: '', Weinen: '', 'Zählerstand ablesen': '', Spargel: '', Rahmen: '',
  });
  // Trauer wird nie zur Party
  assert.equal(suggestEmoji('Trauerfeier'), '🕯️');
  assert.equal(suggestEmoji('Weihnachtsfeier'), '🎄');
  assert.equal(suggestEmoji('Feierabendbier'), '🍻');
});

test('leere und seltsame Eingaben', () => {
  expect({ '': '', '   ': '', '🍕': '', '123': '', 'x': '' });
  assert.equal(suggestEmoji(null), '');
  assert.equal(suggestEmoji(undefined), '');
  assert.equal(suggestEmoji(42), '');
  // zweimal derselbe Titel: gleiches Ergebnis (Zwischenspeicher)
  assert.equal(suggestEmoji('Pizza'), suggestEmoji('Pizza'));
});

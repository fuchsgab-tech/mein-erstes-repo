import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KEEP_BACKUPS, openStore } from '../server/store.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zeitgarten-store-'));
const quiet = () => {
  const lines = [];
  return { lines, error: (...a) => lines.push(a.join(' ')) };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Speichern über Zwischendatei, Laden beim nächsten Start', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'zeitgarten.json');
  const s = openStore(file, { log: quiet() });
  assert.deepEqual(s.data.users, {});
  s.data.users.u1 = { id: 'u1', name: 'Lena' };
  s.save();
  assert.equal(s.flush(), true);
  assert.ok(!fs.existsSync(`${file}.tmp`));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).users.u1.name, 'Lena');
  const again = openStore(file, { log: quiet() });
  assert.equal(again.data.users.u1.name, 'Lena');
  assert.deepEqual(again.data.activity, [], 'fehlende Teile werden ergänzt');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Kaputte Datei: wird beiseitegelegt, die neueste gute Sicherung wird geladen', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'zeitgarten.json');
  const backups = path.join(dir, 'backups');
  fs.mkdirSync(backups);
  fs.writeFileSync(path.join(backups, 'zeitgarten-2026-10-09.json'), JSON.stringify({ users: { a: { id: 'a', name: 'Alt' } } }));
  fs.writeFileSync(path.join(backups, 'zeitgarten-2026-10-10.json'), JSON.stringify({ users: { b: { id: 'b', name: 'Gut' } } }));
  fs.writeFileSync(path.join(backups, 'zeitgarten-2026-10-11.json'), '{"users": {"c": '); // auch kaputt
  fs.writeFileSync(file, '{"users": {"x": {"id": "x", "na'); // z. B. Stromausfall mitten im Schreiben
  const log = quiet();
  const s = openStore(file, { log, today: () => '2026-10-12' });
  assert.deepEqual(Object.keys(s.data.users), ['b']);
  const aside = fs.readdirSync(dir).find((f) => f.startsWith('zeitgarten.kaputt-'));
  assert.ok(aside, 'kaputte Datei liegt daneben');
  assert.equal(fs.readFileSync(path.join(dir, aside), 'utf8'), '{"users": {"x": {"id": "x", "na');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).users.b.name, 'Gut', 'gleich wieder eine gute Datei');
  assert.ok(log.lines.some((l) => /beschädigt/.test(l)));
  assert.ok(log.lines.some((l) => /zeitgarten-2026-10-10\.json/.test(l)));

  // Leere Datei oder kein Objekt zählt auch als kaputt; ohne gute Sicherung startet es leer
  const dir2 = tmpDir();
  const file2 = path.join(dir2, 'zeitgarten.json');
  fs.writeFileSync(file2, '[1,2,3]');
  const s2 = openStore(file2, { log: quiet() });
  assert.deepEqual(s2.data.users, {});
  assert.ok(fs.readdirSync(dir2).some((f) => f.startsWith('zeitgarten.kaputt-')));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('Tägliche Sicherung: Stand vor der ersten Änderung des Tages, die letzten 14 bleiben', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'zeitgarten.json');
  const backups = path.join(dir, 'backups');
  let day = '2026-10-01';
  const s = openStore(file, { log: quiet(), today: () => day });
  s.data.users.u = { n: 1 };
  s.save();
  s.flush();
  assert.ok(!fs.existsSync(backups) || !fs.readdirSync(backups).length, 'vor dem ersten Speichern gibt es nichts zu sichern');

  for (let i = 2; i <= 20; i++) {
    day = `2026-10-${String(i).padStart(2, '0')}`;
    s.data.users.u = { n: i };
    s.save();
    s.flush();
    s.data.users.u = { n: i, später: true };
    s.save();
    s.flush();
  }
  const list = fs.readdirSync(backups).sort();
  assert.equal(list.length, KEEP_BACKUPS);
  assert.equal(list[0], 'zeitgarten-2026-10-07.json');
  assert.equal(list.at(-1), 'zeitgarten-2026-10-20.json');
  // Die Sicherung vom 20. enthält den Stand vom Ende des 19.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backups, 'zeitgarten-2026-10-20.json'), 'utf8')).users.u, { n: 19, später: true });
  // Andere Dateien im Ordner bleiben unangetastet
  fs.writeFileSync(path.join(backups, 'notiz.txt'), 'x');
  day = '2026-10-21';
  s.save();
  s.flush();
  assert.ok(fs.existsSync(path.join(backups, 'notiz.txt')));

  // Beim Start wird auch gesichert (falls an dem Tag nichts gespeichert wird)
  openStore(file, { log: quiet(), today: () => '2026-10-25' });
  assert.ok(fs.existsSync(path.join(backups, 'zeitgarten-2026-10-25.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Speichern scheitert: kein Absturz, neuer Versuch später', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'zeitgarten.json');
  const log = quiet();
  const s = openStore(file, { log, retryMs: 20 });
  // Statt der Datei liegt dort ein (nicht leerer) Ordner -> Umbenennen geht schief
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, 'blockiert'), 'x');
  s.data.users.u = { name: 'Lena' };
  s.save();
  assert.equal(s.flush(), false);
  assert.ok(log.lines.some((l) => /Speichern hat nicht geklappt/.test(l)));
  // Problem behoben -> der nächste Versuch klappt von selbst
  fs.rmSync(file, { recursive: true });
  for (let i = 0; i < 50 && !fs.existsSync(file); i++) await wait(20);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).users.u.name, 'Lena');
  assert.ok(log.lines.some((l) => /klappt wieder/.test(l)));
  assert.equal(s.flush(), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

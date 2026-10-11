// Ganz einfache Datenbank: alles liegt in einer JSON-Datei.
// Für eine Gruppe von Freunden reicht das völlig.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({
  version: 1,
  users: {},
  calendars: {},
  members: [],
  events: {},
  comments: {},
  subscriptions: {},
  activity: [],
});

export function openStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = EMPTY();
  if (fs.existsSync(file)) {
    data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  }

  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  };
  // Mehrere Änderungen kurz hintereinander werden zusammen gespeichert
  const save = () => {
    if (!timer) timer = setTimeout(flush, 150);
  };
  const flushIfPending = () => {
    if (timer) flush();
  };

  return { data, save, flush: flushIfPending };
}

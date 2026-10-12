// Ganz einfache Datenbank: alles liegt in einer JSON-Datei.
// Für eine Gruppe von Freunden reicht das völlig.
// Sicherheitsnetz: Geschrieben wird erst in eine Zwischendatei, die dann die alte ersetzt (nie halb geschrieben).
// Jeden Tag wird eine Sicherung in DATA_DIR/backups abgelegt (die letzten 14 bleiben).
// Ist zeitgarten.json beim Start kaputt, wird sie beiseitegelegt und die neueste gute Sicherung geladen.
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

export const KEEP_BACKUPS = 14;

function readJson(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Inhalt ist kein Datenobjekt');
  return data;
}

// Erst komplett in eine Zwischendatei schreiben, auf die Platte bringen, dann umbenennen
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/**
 * @param {string} file  z. B. DATA_DIR/zeitgarten.json
 * @param {object} [opts]
 * @param {object} [opts.log]  Ausgabe für Warnungen (Standard: console)
 * @param {number} [opts.retryMs]  Wartezeit vor dem ersten neuen Versuch, wenn das Speichern scheitert
 * @param {Function} [opts.today]  heutiges Datum als 'YYYY-MM-DD' (für die Sicherungen)
 */
export function openStore(file, { log = console, retryMs = 2000, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const dir = path.dirname(file);
  const name = path.basename(file, '.json');
  const backupDir = path.join(dir, 'backups');
  const backupRe = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-\\d{2}-\\d{2}\\.json$`);
  fs.mkdirSync(dir, { recursive: true });

  const listBackups = () => {
    try {
      return fs.readdirSync(backupDir).filter((f) => backupRe.test(f)).sort().map((f) => path.join(backupDir, f));
    } catch {
      return [];
    }
  };

  // ---------- Laden ----------

  let loaded = null;
  let restored = false;
  if (fs.existsSync(file)) {
    try {
      loaded = readJson(file);
    } catch (e) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const aside = path.join(dir, `${name}.kaputt-${stamp}.json`);
      fs.renameSync(file, aside);
      log.error(`⚠️  ${file} ist beschädigt (${e.message}). Die Datei liegt jetzt unter ${aside}.`);
      for (const b of listBackups().reverse()) {
        try {
          loaded = readJson(b);
          log.error(`   Stattdessen wurde die Sicherung ${b} geladen.`);
          break;
        } catch {
          log.error(`   Sicherung ${b} ist auch nicht lesbar.`);
        }
      }
      if (!loaded) log.error('   Keine lesbare Sicherung gefunden – Zeitgarten startet ohne Daten.');
      restored = true;
    }
  }
  const data = { ...EMPTY(), ...(loaded || {}) };

  // ---------- Sicherungen ----------

  let backupDay = null;
  function pruneBackups() {
    const list = listBackups();
    for (const f of list.slice(0, Math.max(0, list.length - KEEP_BACKUPS))) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* dann beim nächsten Mal */
      }
    }
  }

  // Einmal am Tag: Stand der Datei, bevor sie heute zum ersten Mal überschrieben wird
  function backupDaily() {
    const day = today();
    if (day === backupDay) return;
    try {
      const target = path.join(backupDir, `${name}-${day}.json`);
      if (!fs.existsSync(target) && fs.existsSync(file)) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(file, `${target}.tmp`);
        fs.renameSync(`${target}.tmp`, target);
      }
      backupDay = day;
      pruneBackups();
    } catch (e) {
      log.error(`Die tägliche Sicherung hat nicht geklappt: ${e.message}`);
    }
  }

  // ---------- Speichern ----------

  let timer = null;
  let dirty = false;
  let failures = 0;

  // Gibt true zurück, wenn alles gespeichert ist. Wirft nie – bei Fehlern wird es später nochmal versucht.
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!dirty) return true;
    try {
      const text = JSON.stringify(data);
      backupDaily();
      writeAtomic(file, text);
      dirty = false;
      if (failures) log.error(`Speichern klappt wieder (nach ${failures} Fehlversuchen).`);
      failures = 0;
      return true;
    } catch (e) {
      failures++;
      const wait = Math.min(retryMs * 2 ** Math.min(failures - 1, 10), 60000);
      log.error(`Speichern hat nicht geklappt (${e.message}). Neuer Versuch in ${Math.round(wait / 1000)} s.`);
      timer = setTimeout(flush, wait);
      timer.unref?.();
      return false;
    }
  }

  // Mehrere Änderungen kurz hintereinander werden zusammen gespeichert
  const save = () => {
    dirty = true;
    if (!timer) timer = setTimeout(flush, 150);
  };
  const flushIfPending = () => (dirty ? flush() : true);

  if (restored) {
    // Gleich wieder eine gute Datei anlegen
    dirty = true;
    flush();
  } else if (loaded) {
    backupDaily();
  }

  return { data, save, flush: flushIfPending };
}

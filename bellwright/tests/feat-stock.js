// BUILD 18 "Vorrats-Check per Lager-Foto": the group photographs the game's "Lager" window (a category, a list of items
// with three numbers: Lager, reserviert, unterwegs) and the app reads it with Claude, shows the stock in groups with a
// traffic light (knapp / okay / viel) and SUGGESTS which jobs should be more or less important. It changes nothing by itself.
// Data: the NEW collection 'stock', one doc per check {at, by, rows, pop, vieh} (the latest 12 are kept; older ones are
// deleted in the same "Speichern"); local mode keeps them inside the LS payload.
// Fixtures: lager-live.json = the lead's transcription of the group's real Lager photos (60 Rohstoffe + 15 Proviant rows,
// population 32, livestock 11), lager-*.jpg = those photos; check-live.json = the group's roster and settings (the
// importance each suggestion names). The sample stub answers with the transcription laid out like three photos: two
// overlapping Rohstoffe photos (5 rows twice), the Proviant photo (cut-off names), "2.115" for Federn, one unreadable number.
// BUILD 18b "Vorschläge pro Rohstoff": the suggestions are two lists per RESOURCE, no buildings, never "put a job back":
// "Knapp" (per item, Essen and Tierfutter as one line each; most urgent = amount ÷ minimum first; below each line the job to
// raise with its importance, a job named once and later lines say "Auch dafür: …") and "Reichlich" (per item, Essen as one
// line; largest amount ÷ viel-level first; no job names). At most 5 lines each, "+ n weitere" shows the rest. Only items the
// players make or gather on purpose get a line (by-products like Federn or Fell never do).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../bellwright-arbeitsplan.html');
const SHOTS = path.resolve(__dirname, '../shots-stock');
const FIX = path.resolve(__dirname, 'fixtures');
fs.mkdirSync(SHOTS, { recursive: true });
function load(file) {
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf('// ---------- Game data ----------');
  const b = s.indexOf('// ---------- Rendering: Plan ----------');
  const fn = new Function('localStorage', 'matchMedia', 'document', '"use strict";\n' + s.slice(a, b)
    + '\nreturn { normSettings, stockNum: typeof stockNum === "function" ? stockNum : null, stockView: typeof stockView === "function" ? stockView : null };');
  const store = {};
  return fn({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, () => ({ matches: false }), undefined);
}
const T = load(APP);
const F = JSON.parse(fs.readFileSync(path.join(FIX, 'check-live.json'), 'utf8'));
const L = JSON.parse(fs.readFileSync(path.join(FIX, 'lager-live.json'), 'utf8'));
const ANIM_KEY = 'bellwright-anim-v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));
const joinDe = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' und ' + a[a.length - 1] : (a[0] || '');
const two = n => String(n).padStart(2, '0');
const dm = t => { const x = new Date(t); return `${two(x.getDate())}.${two(x.getMonth() + 1)}.`; };

// ---------- what the overview must say about the real data (independent of the app) ----------
const HOWTO = 'Im Spiel: Fenster „Lager“ → Kategorie wählen (am wichtigsten: Proviant, Rohstoffe, Werkzeuge) → Liste abfotografieren, bei langen Listen mehrere Fotos, jeweils weiter gescrollt.';
const GROUPS = ['essen', 'holz', 'stein', 'erz', 'stoff', 'futter', 'werkzeug', 'saatgut', 'sonstiges'];
const LABEL = { essen: 'Essen', holz: 'Holz & Bretter', stein: 'Stein & Lehm', erz: 'Erz & Metall', stoff: 'Stoff, Leder & Seil', futter: 'Tierfutter', werkzeug: 'Werkzeug', saatgut: 'Saatgut', sonstiges: 'Sonstiges' };
const IN = {
  holz: ['Baumstamm', 'Hartholzplanke', 'Hartholzstamm', 'Holz', 'Holzplanke'],
  stein: ['Granit', 'Rohstein', 'Schlamm', 'Stampflehm', 'Torf'],
  erz: ['Bronzebarren', 'Eisenbarren', 'Eisenerz', 'Eisennägel', 'Kupferbarren', 'Kupfererz', 'Kupfernägel', 'Zinnbarren', 'Zinnerz'],
  stoff: ['Baumwollbolzen', 'Baumwolle', 'Einfache Schnur', 'Fell', 'Flachs', 'Hanf', 'Leder', 'Leinen', 'Pelz', 'Riemen', 'Rohpelz', 'Seil', 'Unverarbeitetes Leder'],
  futter: ['Getreide', 'Grobes Tierfutter', 'Stroh', 'Weizen'],
  saatgut: ['Apfelsamen', 'Baumsamen', 'Baumsetzling', 'Baumwollsamen', 'Flachssamen', 'Hanfsamen', 'Knoblauchsamen', 'Radieschensamen', 'Rote-Bete-Samen', 'Rübensamen', 'Salbeisamen'],
  sonstiges: ['Dünger', 'Federn', 'Fischschuppe', 'Flussschilf', 'Hahnkadaver', 'Hirschgeweih', 'Knoblauch', 'Moos', 'Regenwürmer', 'Salbei', 'Schilf', 'Weiße Perle', 'Wolfszahn'],
};
const groupOf = r => r.category === 'Proviant' ? 'essen' : Object.keys(IN).find(g => IN[g].includes(r.name));
const BURNT = ['Angebrannter Fisch', 'Angebrannter Pilz'], SPOILED = ['Verdorbene Nahrung'];
const RAW = ['Fischfilet', 'Großes Stück rohes Flei…', 'Kleines Stück rohes Flei…', 'Stück rohes Fleisch'];
const sum = (rows, f = () => true) => rows.filter(f).reduce((s, r) => s + (r.lager || 0), 0);
const FOOD = sum(L.rows, r => groupOf(r) === 'essen' && !BURNT.includes(r.name) && !SPOILED.includes(r.name));
const TOTAL = Object.fromEntries(GROUPS.map(g => [g, g === 'essen' ? FOOD : g === 'futter' ? sum(L.rows, r => r.name === 'Grobes Tierfutter') : sum(L.rows, r => groupOf(r) === g)]));
const S = T.normSettings(F.settings);
const IMP = ['', 'unwichtig', 'nebenbei', 'normal', 'wichtig', 'dringend'];
// A job to raise, with its importance from the group's settings ("Handwerk – gerade „normal“").
const up = (label, id) => `${label} – gerade „${IMP[S.jobs[id].imp]}“`;
const raise = (...ps) => `Dafür wichtiger stellen: ${ps.map(([l, id]) => up(l, id)).join(' · ')}.`;
const KN = ' – knapp, mehr herstellen.', RE = ' – reichlich, kann etwas runtergestellt werden.';
const LIGHTS = { essen: 'viel', holz: 'okay', stein: 'okay', erz: 'okay', stoff: 'knapp', futter: 'knapp', saatgut: null, sonstiges: null };
// The real data: Leinen 1 of 5 (0.2), Tierfutter 7 of 33 for 11 animals (0.21), Seil 4 of 10 (0.4); Handwerk named once.
const KNAPP = [
  { key: 'Leinen', text: 'Leinen 1' + KN, hint: raise(['Handwerk', 'crafting']) },
  { key: 'futter', text: 'Tierfutter 7 bei 11 Tieren' + KN, hint: raise(['Landwirtschaft', 'farming'], ['Tierhaltung', 'animals']) },
  { key: 'Seil', text: 'Seil 4' + KN, hint: 'Auch dafür: Handwerk.' },
];
// Essen 807 of 640 for 32 (1.26), Rohstein 737 of 600 (1.23). No job names.
const VIEL = [
  { key: 'essen', text: `Essen ${FOOD} für 32 Bewohner` + RE, hint: null },
  { key: 'Rohstein', text: 'Rohstein 737' + RE, hint: null },
];
// The items the players make or gather on purpose (the only ones with a line), and what never gets one.
const PURPOSEFUL = ['Baumstamm', 'Holz', 'Holzplanke', 'Hartholzstamm', 'Hartholzplanke', 'Rohstein', 'Granit', 'Schlamm', 'Stampflehm', 'Torf',
  'Kupfererz', 'Zinnerz', 'Eisenerz', 'Kupferbarren', 'Zinnbarren', 'Bronzebarren', 'Eisenbarren', 'Kupfernägel', 'Eisennägel',
  'Seil', 'Einfache Schnur', 'Riemen', 'Leder', 'Leinen', 'Baumwollbolzen'];
const BYPRODUCT = L.rows.filter(r => r.category === 'Rohstoffe' && !PURPOSEFUL.includes(r.name) && r.name !== 'Grobes Tierfutter').map(r => r.name);
const JOB_LABELS = ['Bau', 'Lieferung', 'Karawanenträger', 'Karawanenwache', 'Holzfällen', 'Ernte', 'Landwirtschaft', 'Jagen', 'Tierhaltung', 'Kochen', 'Handwerk', 'Schmelzen', 'Forschung'];
const BUILDINGS = /Sägegrube|Minenlager|Werkzeugmacher|Rennofen|Schmelzofen|Schmiede/;
const lines = list => (Array.isArray(list) ? list : []).map(s => ({ key: s.key, text: s.text, hint: s.hint || null }));
// Many things knapp and reichlich at once (7 each): the order and "+ 2 weitere".
const MANY_KNAPP = [
  { key: 'Seil', text: 'Seil 0' + KN, hint: raise(['Handwerk', 'crafting']) },
  { key: 'Leinen', text: 'Leinen 1' + KN, hint: 'Auch dafür: Handwerk.' },
  { key: 'futter', text: 'Tierfutter 7 bei 11 Tieren' + KN, hint: raise(['Landwirtschaft', 'farming'], ['Tierhaltung', 'animals']) },
  { key: 'Holzplanke', text: 'Holzplanke 9' + KN, hint: 'Auch dafür: Handwerk.' },
  { key: 'Kupfererz', text: 'Kupfererz 5' + KN, hint: raise(['Ernte', 'harvesting']) },
  { key: 'Baumstamm', text: 'Baumstamm 13' + KN, hint: raise(['Holzfällen', 'woodcutting']) },
  { key: 'Granit', text: 'Granit 7' + KN, hint: 'Auch dafür: Ernte.' },
];
const MANY_VIEL = [
  { key: 'Rohstein', text: 'Rohstein 1.800' + RE, hint: null },
  { key: 'Schlamm', text: 'Schlamm 800' + RE, hint: null },
  { key: 'Torf', text: 'Torf 450' + RE, hint: null },
  { key: 'essen', text: `Essen ${FOOD} für 32 Bewohner` + RE, hint: null },
  { key: 'Holz', text: 'Holz 480' + RE, hint: null },
  { key: 'Riemen', text: 'Riemen 220' + RE, hint: null },
  { key: 'Einfache Schnur', text: 'Einfache Schnur 210' + RE, hint: null },
];
const WARN = ['Verdorbene Nahrung 79 – Essen verdirbt. Ein Vorratskeller hält Essen länger frisch.', 'Angebranntes Essen 8 (Angebrannter Fisch 6, Angebrannter Pilz 2) – zählt nicht als Essen.'];
const LINE = 'Lager: Leinen, Tierfutter und Seil knapp → Vorschläge ansehen';
const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// The sample's answer: three photos as the lead transcribed them. Rohstoffe photo 1 = rows 0..34, photo 2 = rows 30..59
// (5 rows on both), the Proviant photo. Federn as the game writes it ("2.115"), Eisenerz "unterwegs" unreadable (null,
// unsure), Claude's own group for every row (Seil wrongly "sonstiges": the app's built-in map wins).
const ROH = L.rows.filter(r => r.category === 'Rohstoffe'), PRO = L.rows.filter(r => r.category === 'Proviant');
const claudeGroup = r => r.name === 'Seil' ? 'sonstiges' : groupOf(r);
const asRead = r => {
  const o = { name: r.name, category: r.category, lager: r.lager, reserviert: r.reserviert, unterwegs: r.unterwegs, group: claudeGroup(r), unsure: [] };
  if (r.name === 'Federn') o.lager = '2.115';
  if (r.name === 'Eisenerz') { o.unterwegs = null; o.unsure = ['unterwegs']; }
  return o;
};
const REPLY = { rows: [...ROH.slice(0, 35), ...ROH.slice(30), ...PRO].map(asRead), population: 32, livestock: 11, note: '' };
const IMG_FILES = ['lager-rohstoffe-1.jpg', 'lager-rohstoffe-2.jpg', 'lager-proviant-1.jpg'].map(f => path.join(FIX, f));
let IMGS = IMG_FILES;   // the group's real photos; without them (the repo copy keeps only the JSON) three drawn stand-ins
// A saved check as the app writes it (for seeding): the fixture rows with their groups.
const docOf = (at, rows = L.rows, extra = {}) => ({ at, by: 'u_b', pop: 32, vieh: 11, rows: rows.map(r => ({ name: r.name, category: r.category, lager: r.lager, reserviert: r.reserviert, unterwegs: r.unterwegs, group: groupOf(r) })), ...extra });
const withRows = (changes) => L.rows.map(r => r.name in changes ? { ...r, lager: changes[r.name] } : r);
const MANY = withRows({ Seil: 0, Leinen: 1, 'Grobes Tierfutter': 7, Holzplanke: 9, Kupfererz: 5, Baumstamm: 13, Granit: 7,
  Rohstein: 1800, Schlamm: 800, Torf: 450, Holz: 480, Riemen: 220, 'Einfache Schnur': 210 });

// ---------- fake server and page stub (lazy collections) ----------
function makeServer(seed = {}) {
  const maps = new Map();
  const col = c => { if (!maps.has(c)) maps.set(c, new Map()); return maps.get(c); };
  const srv = { col, log: [], pages: new Set() };
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) col(c).set(id, clone(d));
  srv.docs = c => [...col(c)].map(([id, d]) => [id, clone(d)]);
  srv.obj = c => Object.fromEntries(srv.docs(c));
  srv.broadcast = c => { const docs = srv.docs(c); for (const p of srv.pages) p.evaluate(([c, docs]) => window.__deliver && window.__deliver(c, docs), [c, docs]).catch(() => {}); };
  srv.write = async (who, op, c, id, d) => {
    await sleep(60);
    if (op === 'set') col(c).set(id, clone(d)); else col(c).delete(id);
    srv.log.push({ who, op, c, id, d: d && clone(d) });
    setTimeout(() => srv.broadcast(c), 10);
  };
  return srv;
}
// cfg: { name, inClaude, writable, user, sample: undefined (works) | null | 'noImages', anim, costSeen, maxCount }
function STUB(cfg) {
  try {
    if (cfg.anim) localStorage.setItem('bellwright-anim-v1', JSON.stringify(cfg.anim));
    if (cfg.costSeen !== false) localStorage.setItem('bellwright-kosten-info-v1', 'true');
  } catch (e) { /* ignore */ }
  window.__calls = [];
  window.__reply = { rows: [] };
  window.__err = null;
  window.__wait = 150;
  let sample = null;
  if (cfg.sample !== null) {
    sample = async () => ({ text: '' });
    sample.limits = cfg.sample === 'noImages' ? async () => ({ maxPromptBytes: 262144 })
      : async () => ({ maxPromptBytes: 262144, images: { maxCount: cfg.maxCount || 10, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
    sample.json = (input, opts) => new Promise((res, rej) => {
      window.__calls.push({ input, n: opts && opts.images ? opts.images.length : 0, types: opts && opts.images ? [...opts.images].map(b => b.type) : [], cache: opts && opts.cache });
      const sig = opts && opts.signal;
      const t = setTimeout(() => { if (window.__err) rej(window.__err); else res(JSON.parse(JSON.stringify(window.__reply))); }, window.__wait);
      if (sig) sig.addEventListener('abort', () => { clearTimeout(t); rej({ code: 'cancelled', message: 'stop' }); });
    });
  }
  if (!cfg.inClaude) { window.claude = { use: async n => (n === 'sample' ? sample : null) }; return; }
  const colL = new Map(), docL = new Map();
  const list = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const clone = d => JSON.parse(JSON.stringify(d));
  const snapC = docs => ({ docs: docs.map(([id, d]) => ({ id, exists: true, data: () => clone(d), metadata: {} })), size: docs.length, empty: !docs.length, metadata: {}, docChanges: () => [] });
  const snapD = (docs, id) => { const e = docs.find(x => x[0] === id); return { id, exists: !!e, data: () => (e ? clone(e[1]) : undefined), metadata: {} }; };
  window.__deliver = (c, docs) => {
    for (const f of colL.get(c) || []) f(snapC(docs));
    for (const [k, fs] of docL) if (k.startsWith(c + '/')) for (const f of fs) f(snapD(docs, k.slice(c.length + 1)));
  };
  const refuse = () => Promise.reject({ code: 'invalid_argument', message: 'below the write level' });
  const docRef = (c, id) => ({
    set: d => cfg.writable ? window.__srvWrite(cfg.name, 'set', c, id, clone(d)) : refuse(),
    delete: () => cfg.writable ? window.__srvWrite(cfg.name, 'delete', c, id, null) : refuse(),
    onSnapshot: n => { list(docL, c + '/' + id).push(n); window.__srvRead(c).then(docs => n(snapD(docs, id))); return () => {}; },
  });
  const db = Object.freeze({
    collection: c => ({ doc: id => docRef(c, id), onSnapshot: n => { list(colL, c).push(n); window.__srvRead(c).then(docs => n(snapC(docs))); return () => {}; } }),
    doc: p => { const [c, id] = p.split('/'); return docRef(c, id); },
  });
  const u = cfg.user;
  const user = !u ? null : Object.freeze({
    isOwner: async () => !!u.owner, id: async () => u.id || null, can: async n => (n === 'data.write' ? u.can : false),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: i === 'u_a' ? 'Gabriel' : i === 'u_b' ? 'Lena' : '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : n === 'sample' ? sample : null) };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 1200) : '')); };
const errs = [];
async function section(name, fn) { if (process.env.ONLY && !process.env.ONLY.split(',').some(o => name.startsWith(o))) return; try { await fn(); } catch (e) { check(`${name}: runs to the end`, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } }
async function phone(browser, srv, cfg, { width = 390, height = 844, hash = '#plan', noFonts = false } = {}) {
  const mobile = width < 900;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
  ctx.setDefaultTimeout(5000);
  if (noFonts) await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push((cfg.name || '?') + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g(oogleapis|static)\.com|Failed to load resource/.test(m.text())) errs.push((cfg.name || '?') + ' console: ' + m.text()); });
  if (srv) {
    await ctx.exposeFunction('__srvWrite', (who, op, c, id, d) => srv.write(who, op, c, id, d));
    await ctx.exposeFunction('__srvRead', c => srv.docs(c));
    srv.pages.add(page);
    page.on('close', () => srv.pages.delete(page));
  }
  await page.addInitScript(STUB, cfg);
  await page.goto('file://' + process.cwd() + '/page.html' + hash);
  await page.waitForTimeout(500);
  return { ctx, page };
}
async function until(fn, max = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(30); }
  return -1;
}
// The next visit of this device (instead of page.reload()). Headless Chromium now and then cuts a page off from the
// browser's localStorage (measured on a bare page, 2026-10-30: about 1 page in 100): that page still reads its own writes,
// but they never reach the store, or a new page starts with an empty store. A reload then starts without what the app
// saved, and "after a reload" checks flake (a second page alone flakes the same way: 3 of 80). So: what the app wrote is
// read in its own page; a neutral page of the same origin (this script, as text) waits until the store has exactly that,
// else writes it (the test browser lost it, not the app); the next page counts only if it starts with exactly that, else
// another one opens. Each time the test browser lost something is reported as a note, never hidden.
const notes = [];
async function nextVisit(ctx, from, keys, srv, cfg, hash = '#lager') {
  const wrote = await from.evaluate(ks => Object.fromEntries(ks.map(k => [k, localStorage.getItem(k)])), keys);
  const has = pg => pg.evaluate(w => Object.entries(w).every(([k, v]) => localStorage.getItem(k) === v), wrote);
  for (let i = 0; i < 4; i++) {
    const h = await ctx.newPage();
    await h.goto('file://' + __filename);
    const ok = (await until(() => has(h), 2000)) >= 0;
    if (!ok) { notes.push(`${cfg.name}: the test browser lost a localStorage write (${keys.join(', ')}), written again`); await h.evaluate(w => { for (const [k, v] of Object.entries(w)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } }, wrote); }
    await h.close();
    if (ok) break;
  }
  for (let i = 0; i < 4; i++) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push((cfg.name || '?') + ' (next visit): ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g(oogleapis|static)\.com|Failed to load resource/.test(m.text())) errs.push((cfg.name || '?') + ' (next visit) console: ' + m.text()); });
    if (srv) { srv.pages.add(page); page.on('close', () => srv.pages.delete(page)); }
    await page.addInitScript(ks => { window.__lsAtStart = Object.fromEntries(ks.map(k => { try { return [k, localStorage.getItem(k)]; } catch (e) { return [k, undefined]; } })); }, keys);
    await page.addInitScript(STUB, cfg);
    await page.goto('file://' + process.cwd() + '/page.html' + hash);
    await page.waitForTimeout(600);
    if (await page.evaluate(w => Object.entries(w).every(([k, v]) => window.__lsAtStart[k] === v), wrote)) return page;
    notes.push(`${cfg.name}: a page of the test browser started without localStorage, opened another`);
    await page.close();
  }
  throw new Error('the test browser kept losing localStorage');
}
const owner = { id: 'u_a', owner: true, can: true };
const lena = { id: 'u_b', owner: false, can: true };
const viewer = { id: 'u_ro', owner: false, can: false };
const SEED_W = Object.fromEntries(F.workers.map(w => [w.id, { name: w.name, role: w.role, traits: w.traits, order: w.order, stats: w.stats }]));
const seedAll = (stock = {}) => ({ workers: SEED_W, settings: { main: F.settings }, ingame: F.ingame, stock });

// Everything the Lager tab shows.
const SK = page => page.evaluate(() => {
  const $ = s => document.querySelector(s);
  const vis = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const t = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  const nv = el => el ? (el.querySelector('input') ? el.querySelector('input').value : t(el)) : null;
  const panel = $('#panel-lager');
  const rv = $('#stock-review');
  return {
    tabs: [...document.querySelectorAll('.tablist [role="tab"]')].map(b => b.id),
    panel: vis(panel), hash: location.hash,
    open: $('#stock-open') ? { shown: vis($('#stock-open')), text: t($('#stock-open')), expanded: $('#stock-open').getAttribute('aria-expanded') } : null,
    note: vis($('#stock-note')) ? t($('#stock-note')) : null,
    empty: vis($('#stock-empty')) ? t($('#stock-empty')) : null,
    photo: vis($('#stock-photo')), photoHead: t($('#stock-photo-h')), howto: t($('#stock-howto')),
    read: $('#stock-read') ? { shown: vis($('#stock-read')), disabled: $('#stock-read').disabled, text: t($('#stock-read')) } : null,
    stop: vis($('#stock-stop')), msg: t($('#stock-msg')), thumbs: document.querySelectorAll('#stock-thumbs .thumb').length,
    review: vis(rv),
    rv: vis(rv) ? {
      title: t($('#stock-rv-title')), sum: t(rv.querySelector('.sk-sum')), ro: vis(rv.querySelector('.sk-ro')) ? t(rv.querySelector('.sk-ro')) : null,
      pop: $('#stock-pop') && $('#stock-pop').value, vieh: $('#stock-vieh') && $('#stock-vieh').value, openText: vis(rv.querySelector('.sk-open')) ? t(rv.querySelector('.sk-open')) : null,
      groups: [...rv.querySelectorAll('.sk-rgroup')].map(g => ({ id: g.dataset.group, open: g.open, n: +t(g.querySelector('.sk-cnt')),
        rows: [...g.querySelectorAll('.sk-row')].map(r => ({ name: t(r.querySelector('.sk-iname')), n: [...r.querySelectorAll('.sk-n')].map(nv), tag: t(r.querySelector('.sk-tag')), doubt: !!r.querySelector('.sk-n.doubt') })) })),
      save: { text: t($('#stock-save')), disabled: $('#stock-save').disabled }, actMsg: t($('#stock-act-msg')),
      bar: getComputedStyle(rv.querySelector('.sk-act')).position,
    } : null,
    over: vis($('#sk-over-h')) ? {
      when: t($('.sk-when')), est: vis($('.sk-est')) ? t($('.sk-est')) : null,
      warn: [...document.querySelectorAll('.sk-warn li')].filter(vis).map(t),
      groups: [...document.querySelectorAll('.sk-group')].filter(vis).map(g => ({ id: g.dataset.group, light: g.dataset.light || null, lightText: t(g.querySelector('.sk-light')), name: t(g.querySelector('.sk-name')),
        total: t(g.querySelector('.sk-total')), trend: t(g.querySelector('.sk-trend')), why: t(g.querySelector('.sk-why')), open: g.open,
        items: [...g.querySelectorAll('.sk-item')].map(r => ({ name: t(r.querySelector('.sk-iname')), n: [...r.querySelectorAll('.sk-n')].map(t), tag: t(r.querySelector('.sk-tag')) })) })),
      missing: vis($('.sk-missing')) ? t($('.sk-missing')) : null,
    } : null,
    sugg: vis($('#sk-sugg-h')) ? {
      head: t($('#sk-sugg-h')), note: t($('.sk-sugg-note')), none: vis($('.sk-none')) ? t($('.sk-none')) : null,
      lists: [...document.querySelectorAll('#sk-sugg .sk-list')].filter(vis).map(c => ({ light: c.dataset.light, title: t(c.querySelector('h4')),
        lines: [...c.querySelectorAll('.sk-lines > li')].filter(vis).map(li => ({ key: li.dataset.key, text: t(li.querySelector('.sk-say')), hint: t(li.querySelector('.sk-do')) })),
        hidden: [...c.querySelectorAll('.sk-lines > li')].filter(li => !vis(li)).length,
        more: c.querySelector('.sk-more') && vis(c.querySelector('.sk-more')) ? t(c.querySelector('.sk-more')) : null })),
      text: t($('#sk-sugg')),
    } : null,
    line: vis($('#stock-line')) ? t($('#stock-line')) : null,
  };
});
const toastMsg = page => page.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : (t.querySelector('.toast-msg') || {}).textContent || ''; });
const toastAct = page => page.evaluate(() => { const b = document.querySelector('#toast:not([hidden]) .toast-act'); return b ? b.textContent : null; });
const readDone = async page => { await page.waitForTimeout(40); await until(() => page.evaluate(() => { const s = document.getElementById('stock-stop'); return !s || s.hidden; }), 4000); await page.waitForTimeout(80); };
async function readStock(page, reply, files = IMGS) {
  if (await page.evaluate(() => document.getElementById('panel-lager') ? document.getElementById('panel-lager').hidden : true)) await page.click('#tab-lager');
  if (!(await page.evaluate(() => { const b = document.getElementById('stock-photo'); return b && !b.hidden; }))) await page.click('#stock-open');
  await page.setInputFiles('#stock-file', files);
  await page.evaluate(r => { window.__reply = r; }, reply);
  await page.click('#stock-read');
  await readDone(page);
}
const grp = (r, id) => r.over && r.over.groups.find(g => g.id === id);
const sl = (r, light) => r.sugg && r.sugg.lists.find(l => l.light === light);
const rvRow = (r, name) => { for (const g of (r.rv ? r.rv.groups : [])) { const x = g.rows.find(y => y.name === name); if (x) return { ...x, group: g.id }; } return null; };
const storeRows = rows => rows.map(r => ({ name: r.name, category: r.category, lager: r.lager, reserviert: r.reserviert, unterwegs: r.unterwegs }));

// Three JPEGs drawn like the Lager list (only the files are sent; the stub answers with the transcription either way).
async function standIns(browser) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 900 } });
  const p = await ctx.newPage();
  const out = [];
  for (const [i, rows] of [ROH.slice(0, 35), ROH.slice(30), PRO].entries()) {
    await p.setContent(`<body style="margin:0;background:#0d1b2a;color:#eee;font:18px Georgia"><div style="padding:8px 16px">${rows[0].category}</div>${rows.map(r =>
      `<div style="display:flex;gap:12px;padding:3px 16px"><span style="width:300px">${r.name}</span><b style="width:60px;text-align:right">${fmt(r.lager)}</b><b style="width:40px;text-align:right">${r.reserviert}</b><b style="width:40px;text-align:right">${r.unterwegs}</b></div>`).join('')}</body>`);
    out.push({ name: `lager-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: await p.screenshot({ type: 'jpeg', quality: 80, fullPage: true }) });
  }
  await ctx.close();
  return out;
}

(async () => {
  // ===== 0) The planner side (node): numbers, groups, lights, trend, suggestions — without a page =====
  await section('0) model', async () => {
    check('stockNum and stockView exist in the logic part of the file', typeof T.stockNum === 'function' && typeof T.stockView === 'function');
    if (!T.stockNum || !T.stockView) return;
    const N = T.stockNum;
    check('numbers: "2.115" and 2.115 (German thousands) = 2115; "1.234.567"; plain numbers; nonsense = null',
      N('2.115') === 2115 && N(2.115) === 2115 && N('2115') === 2115 && N(70) === 70 && N('1.234.567') === 1234567 && N(' 12 ') === 12 && N(0) === 0
      && N(-3) === null && N('abc') === null && N(null) === null && N(undefined) === null && N(1.5) === null && N('') === null,
      ['2.115', 2.115, '1.234.567', -3, 1.5].map(N));
    const AT1 = new Date(2026, 9, 30, 12, 0).getTime(), AT0 = new Date(2026, 9, 28, 18, 0).getTime();
    const m = T.stockView([{ id: 'k1', ...docOf(AT1) }], S);
    check('first check: "Schätzung – wird mit jeder Prüfung genauer"', m.first === true);
    check('the groups in their order, Werkzeug not on the photos', JSON.stringify(m.groups.map(g => g.id)) === JSON.stringify(GROUPS) && m.groups.find(g => g.id === 'werkzeug').present === false
      && GROUPS.filter(g => g !== 'werkzeug').every(g => m.groups.find(x => x.id === g).present), m.groups.map(g => [g.id, g.present]));
    const lights = Object.fromEntries(m.groups.filter(g => g.present).map(g => [g.id, g.light]));
    check('traffic lights for the real data: Essen viel, Holz/Stein/Erz okay, Stoff knapp (Seil), Tierfutter knapp, Saatgut/Sonstiges none', JSON.stringify(lights) === JSON.stringify(LIGHTS), lights);
    const totals = Object.fromEntries(m.groups.filter(g => g.present).map(g => [g.id, g.total]));
    check('totals: Essen without burnt/spoiled food, Tierfutter = the feed itself (not Getreide/Weizen/Stroh), the others the sum', GROUPS.filter(g => g !== 'werkzeug').every(g => totals[g] === TOTAL[g]), { got: totals, want: TOTAL });
    const why = Object.fromEntries(m.groups.filter(g => g.present).map(g => [g.id, g.why]));
    check('why: "für 32 Bewohner", "bei 11 Tieren", "Seil 4 und Leinen 1 knapp"', why.essen === 'für 32 Bewohner' && why.futter === 'bei 11 Tieren' && why.stoff === 'Seil 4 und Leinen 1 knapp', why);
    check('warnings: spoiled food (Vorratskeller) and burnt food', JSON.stringify(m.warnings) === JSON.stringify(WARN), m.warnings);
    check('knapp, most urgent first (amount ÷ minimum): Leinen (1 of 5) before Tierfutter (7 of 33) before Seil (4 of 10)', JSON.stringify(m.knapp) === '["Leinen","Tierfutter","Seil"]', m.knapp);
    check('the Plan line, built from the knapp list', m.line === LINE, m.line);
    const ms = m.sugg || {};
    check('knapp list per item: "Seil 4 – knapp, mehr herstellen.", Tierfutter as one line "bei 11 Tieren"; below each the job to raise with its importance, Handwerk named once',
      JSON.stringify(lines(ms.knapp || [])) === JSON.stringify(KNAPP), ms.knapp);
    check('reichlich list: Essen as one line "für 32 Bewohner", then Rohstein 737 (largest excess first), no hints',
      JSON.stringify(lines(ms.viel || [])) === JSON.stringify(VIEL), ms.viel);
    const all = JSON.stringify(m);
    check('no job is ever "zurückgestellt" any more', !/zurückgestellt|zurückstellen/.test(all), all.match(/[^"]*zurückgestellt[^"]*/));
    check('the reichlich list names no job', (ms.viel || []).every(x => !JOB_LABELS.some(l => x.text.includes(l))), ms.viel);
    check('no building is named (Sägegrube, Minenlager, Werkzeugmacher …)', !BUILDINGS.test(all), all.match(BUILDINGS));
    check('by-products never get a line (Federn 2.115, Fell 179, Pelz 102 …)', [...(ms.knapp || []), ...(ms.viel || [])].every(x => !BYPRODUCT.includes(x.key)) && !/Federn|Fell|Pelz/.test(JSON.stringify(ms)), ms);
    // Every purposeful item has a minimum and a viel level: all at 0 -> each one knapp; all plentiful -> each one reichlich.
    // By-products at 0 or plentiful never show up.
    const keysOf = l => (l || []).map(x => x.key).sort();
    const want = [...PURPOSEFUL, 'essen', 'futter'].sort();
    const z = T.stockView([{ id: 'z', ...docOf(AT1, L.rows.map(r => ({ ...r, lager: 0 }))) }], S);
    check('all at 0: every purposeful item (+ Essen, Tierfutter) is knapp, nothing else', JSON.stringify(keysOf(z.sugg && z.sugg.knapp)) === JSON.stringify(want) && !(z.sugg.viel || []).length,
      { got: keysOf(z.sugg && z.sugg.knapp), want });
    const h = T.stockView([{ id: 'h', ...docOf(AT1, L.rows.map(r => ({ ...r, lager: 900000 }))) }], S);
    check('all plentiful: every purposeful item (+ Essen, Tierfutter) is reichlich, nothing else', JSON.stringify(keysOf(h.sugg && h.sugg.viel)) === JSON.stringify(want) && !(h.sugg.knapp || []).length,
      { got: keysOf(h.sugg && h.sugg.viel), want });
    // The order with many lines (the list keeps all of them; the page shows 5 and "+ n weitere").
    const mm = T.stockView([{ id: 'm', ...docOf(AT1, MANY) }], S);
    check('many knapp: sorted by amount ÷ minimum, smallest first; a job named once, later lines "Auch dafür: …"', JSON.stringify(lines(mm.sugg.knapp)) === JSON.stringify(MANY_KNAPP), mm.sugg.knapp);
    check('many reichlich: sorted by amount ÷ viel-level, largest first', JSON.stringify(lines(mm.sugg.viel)) === JSON.stringify(MANY_VIEL), mm.sugg.viel);
    check('many: the Plan line names the 3 most urgent', mm.line === 'Lager: Seil, Leinen, Tierfutter und 4 weitere knapp → Vorschläge ansehen', mm.line);
    const allZ = JSON.stringify([z, mm, T.stockView([{ id: 'w', ...docOf(AT1, [...L.rows.map(r => ({ ...r, lager: 0 })), { name: 'Spitzhacke', category: 'Werkzeuge', lager: 1, reserviert: 0, unterwegs: 0 }]) }], S)]);
    check('no building named anywhere (planks, ore, tools knapp: no Sägegrube, Minenlager, Werkzeugmacher)', !BUILDINGS.test(allZ) && /Werkzeug 1 für 32 Bewohner – knapp, mehr herstellen\./.test(allZ), allZ.match(BUILDINGS));
    check('missing: "Nicht auf den Fotos: Werkzeug (Kategorie „Werkzeuge“)."', m.missing === 'Nicht auf den Fotos: Werkzeug (Kategorie „Werkzeuge“).', m.missing);
    // trend: the check of 28.10. had 16 more Baumstamm, 700 more Rote Bete (Essen falls fast), 2 Tierfutter
    const prev = { id: 'k0', ...docOf(AT0, withRows({ Baumstamm: 86, 'Rote Bete': 884, 'Grobes Tierfutter': 2 })) };
    const m2 = T.stockView([prev, { id: 'k1', ...docOf(AT1) }], S);
    const g2 = id => m2.groups.find(g => g.id === id);
    check('second check: no estimate note', m2.first === false);
    check('trend: "↓ 16 seit 28.10.", "↓ 700 seit 28.10.", "↑ 5 seit 28.10.", "gleich seit 28.10."', g2('holz').trend === '↓ 16 seit 28.10.' && g2('essen').trend === '↓ 700 seit 28.10.'
      && g2('futter').trend === '↑ 5 seit 28.10.' && g2('stoff').trend === 'gleich seit 28.10.', ['holz', 'essen', 'futter', 'stoff'].map(id => g2(id).trend));
    check('falling fast: Essen knapp although above the minimum, "reicht bei diesem Verbrauch noch etwa 1 Prüfung"', g2('essen').light === 'knapp' && g2('essen').why === 'für 32 Bewohner · reicht bei diesem Verbrauch noch etwa 1 Prüfung', [g2('essen').light, g2('essen').why]);
    check('falling slowly (Baumstamm 86 -> 70) stays okay', g2('holz').light === 'okay');
    check('knapp order with the trend: below the minimum first', JSON.stringify(m2.knapp) === '["Leinen","Tierfutter","Seil","Essen"]' && m2.line === 'Lager: Leinen, Tierfutter, Seil und 1 weitere knapp → Vorschläge ansehen', [m2.knapp, m2.line]);
    const k2 = (m2.sugg && m2.sugg.knapp) || [], se = k2.find(x => x.key === 'essen');
    check('Essen knapp (falling fast): one line with the reason; Kochen, Jagen, Ernte to raise, Landwirtschaft already named at Tierfutter', se && k2.indexOf(se) === 3
      && se.text === `Essen ${FOOD} für 32 Bewohner – knapp, mehr herstellen. Reicht bei diesem Verbrauch noch etwa 1 Prüfung.`
      && se.hint === `${raise(['Kochen', 'cooking'], ['Jagen', 'hunting'], ['Ernte', 'harvesting'])} Auch dafür: Landwirtschaft.`, se);
    check('… and Essen is not reichlich any more (only Rohstein)', JSON.stringify(lines(m2.sugg.viel)) === JSON.stringify([VIEL[1]]), m2.sugg.viel);
    // The trend per item: Holz 180 -> 130 lasts about 2 more checks (knapp although above its minimum of 30), while the
    // group's sum stays the same (Baumstamm 20 -> 70); Rohstein 900 -> 737 falls slowly and stays reichlich.
    const mt = T.stockView([{ id: 'k0', ...docOf(AT0, withRows({ Holz: 180, Baumstamm: 20, Rohstein: 900 })) }, { id: 'k1', ...docOf(AT1) }], S);
    const gt = id => mt.groups.find(g => g.id === id), kt = (mt.sugg && mt.sugg.knapp) || [];
    check('trend per item: Holz falls fast -> knapp line with "Reicht … noch etwa 2 Prüfungen", after the ones below their minimum',
      JSON.stringify(lines(kt)) === JSON.stringify([...KNAPP, { key: 'Holz', text: 'Holz 130 – knapp, mehr herstellen. Reicht bei diesem Verbrauch noch etwa 2 Prüfungen.', hint: raise(['Holzfällen', 'woodcutting']) }]), kt);
    check('trend per item: the Holz group is knapp although its sum is "gleich"', gt('holz').light === 'knapp' && gt('holz').trend === 'gleich seit 28.10.' && gt('holz').why === 'Holz reicht bei diesem Verbrauch noch etwa 2 Prüfungen', [gt('holz').light, gt('holz').trend, gt('holz').why]);
    check('trend per item: Rohstein falling slowly stays reichlich', JSON.stringify(lines(mt.sugg.viel)) === JSON.stringify(VIEL), mt.sugg.viel);
    // Vieh and Bewohner unknown, no Vieh at all
    const mu = T.stockView([{ id: 'k1', ...docOf(AT1, L.rows, { vieh: null, pop: null }) }], S);
    const gu = id => mu.groups.find(g => g.id === id);
    check('Vieh unknown: Tierfutter against a fixed minimum (7 < 20: knapp), "Vieh unbekannt"', gu('futter').light === 'knapp' && gu('futter').why === 'Vieh unbekannt', [gu('futter').light, gu('futter').why]);
    check('Bewohner unknown: Essen without a light, "Bewohnerzahl fehlt"', gu('essen').light === null && gu('essen').why === 'Bewohnerzahl fehlt', [gu('essen').light, gu('essen').why]);
    const m0 = T.stockView([{ id: 'k1', ...docOf(AT1, L.rows, { vieh: 0 }) }], S);
    const f0 = m0.groups.find(g => g.id === 'futter');
    check('no Vieh: Tierfutter without a light, "Ohne Vieh braucht ihr kein Tierfutter.", no line', f0.light === null && f0.why === 'Ohne Vieh braucht ihr kein Tierfutter.' && ![...(m0.sugg.knapp || []), ...(m0.sugg.viel || [])].some(x => x.key === 'futter'), f0);
    const ku = (mu.sugg.knapp || []).find(x => x.key === 'futter');
    check('Vieh unknown: the Tierfutter line without "bei … Tieren"; Bewohner unknown: no Essen line', ku && ku.text === 'Tierfutter 7' + KN && ![...(mu.sugg.knapp || []), ...(mu.sugg.viel || [])].some(x => x.key === 'essen'), [ku, mu.sugg.viel]);
    const S2 = clone(S); S2.jobs.animals.on = false; S2.jobs.farming.imp = 5;
    const mo = T.stockView([{ id: 'k1', ...docOf(AT1) }], T.normSettings(S2));
    const sf = (mo.sugg.knapp || []).find(x => x.key === 'futter');
    check('a job already "dringend" / switched off is said so (not "wichtiger stellen")', sf && sf.hint === 'Landwirtschaft ist schon „dringend“. Tierhaltung ist bei euch abgeschaltet.', sf);
    const S3 = clone(S); S3.jobs.animals.imp = 5; S3.jobs.farming.imp = 5;
    const sf3 = (T.stockView([{ id: 'k1', ...docOf(AT1) }], T.normSettings(S3)).sugg.knapp || []).find(x => x.key === 'futter');
    check('two jobs already "dringend": "Landwirtschaft und Tierhaltung sind schon „dringend“."', sf3 && sf3.hint === 'Landwirtschaft und Tierhaltung sind schon „dringend“.', sf3);
    check('no checks: nothing', T.stockView([], S) === null);
    // A second check where the last Rohstoffe photo is missing (Riemen … Zinnerz not on it): the trend compares only what
    // is on both checks, so a missing photo is no "falling fast" (Erz 80 of 157 would read "reicht noch etwa 1 Prüfung").
    const cut = L.rows.filter(r => r.category === 'Proviant' || r.name < 'Riemen');
    const mp = T.stockView([{ id: 'k0', ...docOf(AT0) }, { id: 'k1', ...docOf(AT1, cut) }], S);
    const gp = id => mp.groups.find(g => g.id === id);
    const erzItems = IN.erz;
    check('partial second check: no false "knapp" from a missing photo (Erz okay, no ore/bar/nail line)', gp('erz').light === 'okay' && !mp.knapp.some(n => erzItems.includes(n)) && !(mp.sugg.knapp || []).some(x => erzItems.includes(x.key)), [gp('erz').light, gp('erz').why, mp.knapp]);
    check('partial second check: the trend counts only what is on both checks ("gleich", not "↓ 1.244")', gp('stein').trend === 'gleich seit 28.10.' && gp('erz').trend === 'gleich seit 28.10.' && gp('stoff').trend === 'gleich seit 28.10.',
      ['stein', 'erz', 'stoff'].map(id => gp(id).trend));
    // A number saved as unreadable (null) is not "0 im Lager": Seil without its number is not judged.
    const mn = T.stockView([{ id: 'k1', ...docOf(AT1, L.rows.map(r => r.name === 'Seil' ? { ...r, lager: null } : r)) }], S);
    check('an unreadable number is not 0: Seil (null) is not "knapp", no Seil line', !mn.knapp.includes('Seil') && mn.groups.find(g => g.id === 'stoff').why === 'Leinen 1 knapp' && ![...(mn.sugg.knapp || []), ...(mn.sugg.viel || [])].some(x => x.key === 'Seil'), [mn.knapp, mn.groups.find(g => g.id === 'stoff').why]);
    // The same for a group's own number: Grobes Tierfutter unreadable is not "Tierfutter 0 – knapp" (Getreide, Weizen and
    // Stroh are readable but do not count), all Proviant unreadable is not "Essen 0", a tool without its number is not
    // "Werkzeug 0". Only spoiled food readable IS nothing to eat (Essen 0, knapp). A check with no readable number: nothing.
    const nul = f => L.rows.map(r => f(r) ? { ...r, lager: null } : r);
    const mf = T.stockView([{ id: 'k1', ...docOf(AT1, nul(r => r.name === 'Grobes Tierfutter')) }], S), ff = mf.groups.find(g => g.id === 'futter');
    check('Tierfutter unreadable: no light, "Zahl nicht lesbar", no Tierfutter line, not in the Plan line', ff.light === null && ff.why === 'Zahl nicht lesbar'
      && ![...(mf.sugg.knapp || []), ...(mf.sugg.viel || [])].some(x => x.key === 'futter') && !mf.knapp.includes('Tierfutter'), [ff.light, ff.why, mf.knapp]);
    const SPOIL = ['Verdorbene Nahrung', 'Angebrannter Fisch', 'Angebrannter Pilz'];
    const me = T.stockView([{ id: 'k1', ...docOf(AT1, nul(r => r.category === 'Proviant' && !SPOIL.includes(r.name))) }], S), fe = me.groups.find(g => g.id === 'essen');
    check('all food unreadable (spoiled and burnt readable): Essen without a light, "Zahlen nicht lesbar", no Essen line', fe.light === null && fe.why === 'Zahlen nicht lesbar'
      && ![...(me.sugg.knapp || []), ...(me.sugg.viel || [])].some(x => x.key === 'essen'), [fe.light, fe.why]);
    const ms0 = T.stockView([{ id: 'k1', ...docOf(AT1, L.rows.filter(r => r.category !== 'Proviant' || SPOIL.includes(r.name))) }], S);
    check('only spoiled and burnt food: Essen 0 is knapp (nothing to eat)', ms0.groups.find(g => g.id === 'essen').light === 'knapp' && (ms0.sugg.knapp || [])[0] && ms0.sugg.knapp[0].text === 'Essen 0 für 32 Bewohner' + KN, ms0.sugg.knapp);
    const tool = { name: 'Spitzhacke', category: 'Werkzeuge', lager: null, reserviert: 0, unterwegs: 0 };
    const mw = T.stockView([{ id: 'k1', ...docOf(AT1, [...L.rows, tool]) }], S), fw = mw.groups.find(g => g.id === 'werkzeug');
    check('a tool without its number: Werkzeug without a light, "Zahl nicht lesbar", no line', fw.present && fw.light === null && fw.why === 'Zahl nicht lesbar'
      && ![...(mw.sugg.knapp || []), ...(mw.sugg.viel || [])].some(x => x.key === 'werkzeug'), [fw.light, fw.why]);
    const me0 = T.stockView([{ id: 'k1', ...docOf(AT1, nul(() => true)) }], S);
    check('no readable number at all: no light, no line, no Plan line', me0.groups.every(g => g.light === null) && !(me0.sugg.knapp || []).length && !(me0.sugg.viel || []).length && me0.line === '',
      { lights: me0.groups.map(g => [g.id, g.light]), sugg: me0.sugg, line: me0.line });
    // Honest wording: the limits stay estimates after the first check too.
    check('first check: estimate note', m.est === 'Schätzung – wird mit jeder Prüfung genauer.', m.est);
    check('later checks: still called an estimate, plus the trend', m2.est === 'Schätzung – die Ampel nutzt Richtwerte und den Verlauf seit der letzten Prüfung.', m2.est);
  });

  const browser = await chromium.launch();
  if (!IMG_FILES.every(f => fs.existsSync(f))) IMGS = await standIns(browser);
  try {
    // ===== 1) Owner: the tab, the empty state, reading 3 photos, review, Speichern, overview, suggestions, Plan line =====
    await section('1) owner', async () => {
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: owner, anim: 'aus' });
      const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: lena, anim: 'aus' }, { width: 1280, height: 900 });
      const P = A.page;
      let r = await SK(P);
      check('tab row: Plan, Arbeiter, Lager, Einstellungen, Hilfe', JSON.stringify(r.tabs) === '["tab-plan","tab-arbeiter","tab-lager","tab-jobs","tab-wissen"]', r.tabs);
      check('tab "Lager"; "Einstellungen" keeps its name for screen readers', await P.evaluate(() => document.getElementById('tab-lager').textContent.trim() === 'Lager' && document.getElementById('tab-jobs').textContent.trim() === 'Einstellungen'));
      check('no Plan line without a check', r.line === null);
      await P.click('#tab-lager'); await P.waitForTimeout(150);
      r = await SK(P);
      check('the Lager tab opens (#lager)', r.panel && r.hash === '#lager');
      check('empty state with the how-to', r.empty && r.empty.includes(HOWTO), r.empty);
      check('"Lager prüfen (Foto)"', r.open && r.open.shown && r.open.text === 'Lager prüfen (Foto)' && r.open.expanded === 'false', r.open);
      check('no overview yet', !r.over && !r.sugg);
      const bh = await P.$eval('#stock-open', b => b.getBoundingClientRect().height);
      check('the button is >= 44 px tall on a phone', bh >= 44, bh);
      await P.click('#stock-open'); await P.waitForTimeout(150);
      r = await SK(P);
      check('opens "Lager prüfen per Foto" with the how-to (the empty state steps aside)', r.photo && r.photoHead === 'Lager prüfen per Foto' && r.howto === HOWTO && !r.empty && r.open.expanded === 'true', { h: r.photoHead, howto: r.howto, empty: r.empty });
      check('focus on the panel heading', await P.evaluate(() => document.activeElement && document.activeElement.id === 'stock-photo-h'));
      check('"Lager auslesen" waits for photos', r.read.shown && r.read.disabled && r.read.text === 'Lager auslesen', r.read);
      await P.setInputFiles('#stock-file', IMGS); await P.waitForTimeout(200);
      r = await SK(P);
      check('three photos ready', r.thumbs === 3 && !r.read.disabled, r.thumbs);
      await P.evaluate(rep => { window.__reply = rep; window.__wait = 500; }, REPLY);
      await P.click('#stock-read'); await P.waitForTimeout(120);
      r = await SK(P);
      check('while Claude reads: message and "Stopp"', r.msg === 'Claude liest die Fotos. Das dauert meist 10 bis 60 Sekunden.' && r.stop && r.read.disabled, r.msg);
      await readDone(P);
      const calls = await P.evaluate(() => window.__calls);
      const call = calls[0];
      check('one Claude call with the 3 photos (JPEG), not cached', calls.length === 1 && call.n === 3 && call.types.every(x => x === 'image/jpeg') && call.cache === false, call && { n: call.n, cache: call.cache, types: call.types });
      const pr = call.input;
      fs.writeFileSync(path.join(SHOTS, 'stock-prompt.txt'), pr);
      check('prompt: the Lager window, its three numbers, categories, overlap', /„?Lager“?/.test(pr) && /reserviert/.test(pr) && /unterwegs/.test(pr) && L.categories.every(c => pr.includes(c)) && /overlap/i.test(pr), pr.slice(0, 600));
      check('prompt: thousands separator "2.115" = 2115, cut-off names keep "…", the red cursor box is ignored', pr.includes('2.115') && pr.includes('2115') && pr.includes('…') && /red/i.test(pr));
      check('prompt: the fixed groups for unknown items and the known item names', GROUPS.every(g => pr.includes(`"${g}"`)) && ['Grobes Tierfutter', 'Holzplanke', 'Verdorbene Nahrung'].every(n => pr.includes(JSON.stringify(n))));
      check('prompt: strict JSON rows {name, category, lager, reserviert, unterwegs, group, unsure}, population, livestock', ['"rows":[', '"name"', '"category"', '"lager"', '"reserviert"', '"unterwegs"', '"group"', '"unsure"', '"population"', '"livestock"', '"note"'].every(k => pr.includes(k)) && /null/.test(pr));
      check('nothing written while checking', !srv.log.length, srv.log.slice(0, 3));
      r = await SK(P);
      check('done message', r.msg === '75 Gegenstände erkannt. Prüft das Ergebnis unten.', r.msg);
      check('review: "Ergebnis", 75 items, the 5 doubled rows merged, nothing saved yet', r.review && r.rv.title === 'Ergebnis' && r.rv.sum === '75 Gegenstände erkannt, 5 doppelte Zeilen zusammengeführt. Gespeichert wird erst mit „Speichern“.', r.rv && r.rv.sum);
      check('Bewohner 32 and Vieh 11 from the photos', r.rv.pop === '32' && r.rv.vieh === '11', [r.rv.pop, r.rv.vieh]);
      const gIds = r.rv.groups.map(g => g.id), cnt = Object.fromEntries(r.rv.groups.map(g => [g.id, g.n]));
      const wantCnt = Object.fromEntries(GROUPS.filter(g => g !== 'werkzeug').map(g => [g, L.rows.filter(x => groupOf(x) === g).length]));
      check('rows grouped (group order, counts; the built-in map beats Claude: Seil in Stoff)', JSON.stringify(gIds) === JSON.stringify(GROUPS.filter(g => g !== 'werkzeug')) && JSON.stringify(cnt) === JSON.stringify(wantCnt)
        && rvRow(r, 'Seil') && rvRow(r, 'Seil').group === 'stoff', { cnt, wantCnt });
      const allRv = r.rv.groups.flatMap(g => g.rows);
      check('every row of the photos once, with its three numbers', allRv.length === 75 && L.rows.every(x => { const y = rvRow(r, x.name); return y && (x.name === 'Eisenerz' || JSON.stringify(y.n) === JSON.stringify([fmt(x.lager), fmt(x.reserviert), fmt(x.unterwegs)])); }),
        L.rows.filter(x => { const y = rvRow(r, x.name); return !y || JSON.stringify(y.n) !== JSON.stringify([fmt(x.lager), fmt(x.reserviert), fmt(x.unterwegs)]); }).map(x => x.name).slice(0, 8));
      check('"2.115" read as 2115 (shown as the game writes it)', rvRow(r, 'Federn') && rvRow(r, 'Federn').n[0] === '2.115', rvRow(r, 'Federn'));
      check('cut-off name kept, raw food marked "roh – muss noch zubereitet werden"', rvRow(r, 'Großes Stück rohes Flei…') && rvRow(r, 'Großes Stück rohes Flei…').group === 'essen' && rvRow(r, 'Großes Stück rohes Flei…').tag === 'roh – muss noch zubereitet werden', rvRow(r, 'Großes Stück rohes Flei…'));
      const ee = rvRow(r, 'Eisenerz');
      check('the unreadable number: highlighted, an empty field, its group open (the others closed)', ee && ee.doubt && ee.n[2] === '' && r.rv.groups.find(g => g.id === 'erz').open && r.rv.groups.filter(g => g.open).length === 1, { ee, open: r.rv.groups.filter(g => g.open).map(g => g.id) });
      check('"1 unsichere Zahl ist gelb markiert. Prüft sie kurz."', r.rv.openText === '1 unsichere Zahl ist gelb markiert. Prüft sie kurz.', r.rv.openText);
      check('sticky bar: "Verwerfen" and "Speichern"', r.rv.bar === 'sticky' && r.rv.save.text === 'Speichern' && !r.rv.save.disabled, r.rv.save);
      await P.screenshot({ path: path.join(SHOTS, 'flow-390-review.png') });
      // first tap with the open number: asked once
      await P.click('#stock-save'); await P.waitForTimeout(100);
      r = await SK(P);
      check('first "Speichern" with an open number: "Trotzdem speichern (1 offen)", nothing written', r.rv.save.text === 'Trotzdem speichern (1 offen)' && r.rv.actMsg === '1 Zahl ist noch unsicher. Tippt noch einmal, um trotzdem zu speichern.' && !srv.log.length, r.rv);
      await P.fill('.sk-row .sk-n.doubt input', '2'); await P.waitForTimeout(120);
      r = await SK(P);
      check('typing the number clears the doubt and the question', !rvRow(r, 'Eisenerz').doubt && rvRow(r, 'Eisenerz').n[2] === '2' && r.rv.save.text === 'Speichern' && !r.rv.openText, { row: rvRow(r, 'Eisenerz'), save: r.rv.save, open: r.rv.openText });
      await P.click('#stock-save');
      await until(() => srv.docs('stock').length === 1);
      await P.waitForTimeout(250);
      const docs = srv.docs('stock');
      const [sid, sdoc] = docs[0] || [];
      check('one stock doc {at, by, pop, vieh, rows}', docs.length === 1 && typeof sdoc.at === 'number' && sdoc.by === 'u_a' && sdoc.pop === 32 && sdoc.vieh === 11 && Array.isArray(sdoc.rows)
        && JSON.stringify(Object.keys(sdoc).sort()) === '["at","by","pop","rows","vieh"]', sdoc && { keys: Object.keys(sdoc), pop: sdoc.pop, vieh: sdoc.vieh, by: sdoc.by });
      const byName = new Map((sdoc ? sdoc.rows : []).map(x => [x.name, x]));
      check('the saved rows are the photos (75, the typed number, "2.115" = 2115), each with its group',
        sdoc && sdoc.rows.length === 75 && JSON.stringify(storeRows(L.rows)) === JSON.stringify(storeRows(L.rows.map(x => byName.get(x.name) || {})))
        && L.rows.every(x => byName.get(x.name) && byName.get(x.name).group === groupOf(x)),
        sdoc && L.rows.filter(x => !byName.get(x.name) || JSON.stringify(storeRows([x])) !== JSON.stringify(storeRows([byName.get(x.name)])) || byName.get(x.name).group !== groupOf(x)).map(x => [x.name, byName.get(x.name)]).slice(0, 5));
      check('only the stock collection was written (no settings: nothing changes by itself)', srv.log.every(x => x.c === 'stock'), [...new Set(srv.log.map(x => x.c))]);
      check('toast with Rückgängig', /^Lager-Prüfung gespeichert\./.test(await toastMsg(P)) && (await toastAct(P)) === 'Rückgängig', await toastMsg(P));
      r = await SK(P);
      check('review and photo panel close', !r.review && !r.photo && r.open.expanded === 'false');
      check('overview: "Geprüft gerade eben von Gabriel · 32 Bewohner · 11 Tiere", estimate note', r.over && r.over.when === 'Geprüft gerade eben von Gabriel · 32 Bewohner · 11 Tiere' && r.over.est === 'Schätzung – wird mit jeder Prüfung genauer.', r.over && [r.over.when, r.over.est]);
      check('overview: the groups with traffic light, total, why', r.over && JSON.stringify(r.over.groups.map(g => [g.id, g.name, g.light, g.total])) === JSON.stringify(GROUPS.filter(g => g !== 'werkzeug').map(g => [g, LABEL[g], LIGHTS[g], fmt(TOTAL[g])]))
        && grp(r, 'essen').lightText === 'viel' && grp(r, 'stoff').lightText === 'knapp' && grp(r, 'holz').lightText === 'okay' && grp(r, 'saatgut').lightText === null
        && grp(r, 'essen').why === 'für 32 Bewohner' && grp(r, 'futter').why === 'bei 11 Tieren' && grp(r, 'stoff').why === 'Seil 4 und Leinen 1 knapp', r.over && r.over.groups.map(g => [g.id, g.light, g.total, g.why]));
      check('overview: groups collapsed, no trend on the first check', r.over.groups.every(g => !g.open && !g.trend));
      check('overview: warnings for spoiled and burnt food', JSON.stringify(r.over.warn) === JSON.stringify(WARN), r.over.warn);
      check('overview: "Nicht auf den Fotos: Werkzeug (Kategorie „Werkzeuge“)."', r.over.missing === 'Nicht auf den Fotos: Werkzeug (Kategorie „Werkzeuge“).', r.over.missing);
      await P.click('.sk-group[data-group="essen"] summary'); await P.waitForTimeout(100);
      r = await SK(P);
      const ess = grp(r, 'essen');
      check('Essen opens: 15 items with Lager / reserviert / unterwegs, raw / burnt / spoiled marked', ess.open && ess.items.length === 15 && JSON.stringify(ess.items.find(i => i.name === 'Kleines Stück rohes Flei…').n) === '["12","3","0"]'
        && RAW.every(n => ess.items.find(i => i.name === n).tag === 'roh – muss noch zubereitet werden') && ess.items.find(i => i.name === 'Verdorbene Nahrung').tag === 'verdorben – zählt nicht' && ess.items.find(i => i.name === 'Angebrannter Fisch').tag === 'angebrannt – zählt nicht', ess.items.slice(0, 4));
      check('suggestions: two lists "Knapp" and "Reichlich"', r.sugg && r.sugg.head === 'Vorschläge' && JSON.stringify(r.sugg.lists.map(l => [l.light, l.title])) === '[["knapp","Knapp"],["viel","Reichlich"]]', r.sugg && r.sugg.lists.map(l => [l.light, l.title]));
      check('Knapp: Leinen, Tierfutter, Seil per item, each with the job to raise and its importance (Handwerk once)', sl(r, 'knapp') && JSON.stringify(sl(r, 'knapp').lines) === JSON.stringify(KNAPP) && !sl(r, 'knapp').more && !sl(r, 'knapp').hidden, sl(r, 'knapp'));
      check('Reichlich: Essen and Rohstein, no job names', sl(r, 'viel') && JSON.stringify(sl(r, 'viel').lines) === JSON.stringify(VIEL) && !sl(r, 'viel').more, sl(r, 'viel'));
      check('nothing on the page says a job "kann zurückgestellt werden", no building, no Federn/Fell', !/zurückgestellt/.test(r.sugg.text) && !BUILDINGS.test(r.sugg.text) && !/Federn|Fell\b/.test(r.sugg.text), r.sugg.text);
      check('suggestions say that nothing changes by itself, with "Zu den Einstellungen"', r.sugg.note === 'Die App ändert nichts von selbst. Die Wichtigkeit stellt ihr unter Einstellungen ein. Zu den Einstellungen', r.sugg.note);
      await P.screenshot({ path: path.join(SHOTS, 'flow-390-overview.png'), fullPage: true });
      await P.click('.sk-sugg-note [data-goto="jobs"]'); await P.waitForTimeout(150);
      check('"Zu den Einstellungen" opens the settings', await P.evaluate(() => !document.getElementById('panel-jobs').hidden));
      // the Plan line
      await P.click('#tab-plan'); await P.waitForTimeout(150);
      r = await SK(P);
      check('Plan tab: "Lager: Tierfutter und Seil knapp → Vorschläge ansehen"', r.line === LINE, r.line);
      const lh = await P.$eval('#stock-line-go', b => b.getBoundingClientRect().height);
      check('the Plan line is >= 44 px tall on a phone', lh >= 44, lh);
      await P.screenshot({ path: path.join(SHOTS, 'flow-390-planline.png') });
      await P.click('#stock-line-go'); await P.waitForTimeout(200);
      check('the Plan line opens the Lager tab at the suggestions', await P.evaluate(() => !document.getElementById('panel-lager').hidden && document.activeElement && document.activeElement.id === 'sk-sugg-h'));
      // the other phone, live
      await until(async () => (await SK(B.page)).line === LINE);
      const rb = await SK(B.page);
      check('the other phone shows the Plan line live', rb.line === LINE, rb.line);
      await B.page.click('#tab-lager'); await B.page.waitForTimeout(150);
      const rb2 = await SK(B.page);
      check('the other phone shows the same overview and suggestions', rb2.over && JSON.stringify(Object.fromEntries(rb2.over.groups.map(g => [g.id, g.light]))) === JSON.stringify(LIGHTS)
        && rb2.sugg && JSON.stringify(rb2.sugg.lists.map(l => l.lines.map(x => x.key))) === JSON.stringify([KNAPP.map(x => x.key), VIEL.map(x => x.key)]), rb2.over && rb2.over.groups.map(g => [g.id, g.light]));
      check('no writes from drawing (the other phone wrote nothing)', !srv.log.some(x => x.who === 'B'));
      // A second check, taken back at once with Rückgängig: the first one stays.
      await readStock(P, REPLY);
      await P.fill('.sk-row .sk-n.doubt input', '2');
      await P.click('#stock-save');
      await until(() => srv.docs('stock').length === 2);
      const n0 = srv.log.length;
      await P.click('#toast .toast-act');
      await until(() => srv.docs('stock').length === 1);
      await P.waitForTimeout(250);
      r = await SK(P);
      check('Rückgängig removes the new check again (one delete), the first one stays', srv.docs('stock').length === 1 && srv.docs('stock')[0][0] === sid && srv.log.slice(n0).length === 1 && srv.log[n0].op === 'delete' && srv.log[n0].c === 'stock', srv.log.slice(n0).map(x => [x.op, x.c]));
      check('… the overview shows the first check, the toast says so', r.over && r.over.est === 'Schätzung – wird mit jeder Prüfung genauer.' && /^Rückgängig/.test(await toastMsg(P)), r.over && r.over.est);
      await A.ctx.close(); await B.ctx.close();
    });

    // ===== 1b) Every number of the result can be corrected (a confidently misread one too): tap the number, type =====
    // The review stays compact on a phone: a number is plain text in a 44 px tap target, not a field; only the tapped one
    // becomes a field. Emptying a number makes it open again (amber, asked about once), like an unreadable one.
    for (const w of [360, 390]) {
      await section('1b) correct any number ' + w, async () => {
        const srv = makeServer(seedAll());
        const A = await phone(browser, srv, { name: 'ED' + w, inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: w, height: 780, hash: '#lager' });
        const P = A.page;
        await readStock(P, REPLY);
        let r = await SK(P);
        const hint = await P.evaluate(() => { const h = document.querySelector('#stock-review .sk-hint'); return h && !h.closest('[hidden]') ? h.textContent.trim() : null; });
        check(`${w}: the result says that every number can be corrected`, hint === 'Falsch gelesen? Tippt auf eine Zahl, um sie zu ändern.', hint);
        await P.evaluate(() => { for (const d of document.querySelectorAll('.sk-rgroup')) d.open = true; });
        await P.waitForTimeout(80);
        const look = await P.evaluate(() => {
          const row = [...document.querySelectorAll('#stock-review .sk-row')].find(x => x.querySelector('.sk-iname').textContent === 'Seil');
          const b = row && row.querySelector('.sk-n button');
          const rows = [...document.querySelectorAll('#stock-review .sk-row')].filter(x => !x.querySelector('.sk-tag') && x.querySelector('.sk-dline').hidden && (() => { const g = document.createRange(); g.selectNodeContents(x.querySelector('.sk-iname')); return g.getClientRects().length === 1; })());
          return { buttons: row ? row.querySelectorAll('.sk-n button').length : 0, inputs: document.querySelectorAll('#stock-review .sk-n input').length,
            label: b && b.getAttribute('aria-label'), text: b && b.textContent, h: b && Math.round(b.getBoundingClientRect().height), bw: b && Math.round(b.getBoundingClientRect().width),
            cw: b && Math.round(b.parentElement.getBoundingClientRect().width), rowMax: Math.max(...rows.map(x => x.getBoundingClientRect().height)), nrows: rows.length };
        });
        check(`${w}: a sure number is a button (not a field): three in a row, only the unreadable one is a field`, look.buttons === 3 && look.inputs === 1, look);
        check(`${w}: the button names the item, the column and the number`, look.label === 'Seil, Lager 4 – ändern' && look.text === '4', look);
        check(`${w}: the tap target is >= 44 px tall and stays in its column`, look.h >= 44 && look.bw <= look.cw, look);
        check(`${w}: the result stays compact: a one-line row is at most 46 px`, look.nrows > 40 && look.rowMax <= 46, { rowMax: look.rowMax, n: look.nrows });
        await P.locator('#stock-review .sk-row', { has: P.locator('.sk-iname', { hasText: /^Seil$/ }) }).locator('.sk-n button').first().click();
        await P.waitForTimeout(60);
        const ed = await P.evaluate(() => { const a = document.activeElement; return a && { tag: a.tagName, type: a.type, value: a.value, label: a.getAttribute('aria-label'), doubt: !!a.closest('.doubt'), sel: a.selectionStart === undefined ? null : true }; });
        check(`${w}: tapping the number makes it a field with the number, focused (not amber)`, ed && ed.tag === 'INPUT' && ed.type === 'number' && ed.value === '4' && ed.label === 'Seil, Lager' && !ed.doubt, ed);
        await P.keyboard.press('Control+A'); await P.keyboard.type('14'); await P.waitForTimeout(60);
        r = await SK(P);
        check(`${w}: the corrected number stays, nothing becomes open`, rvRow(r, 'Seil').n[0] === '14' && !rvRow(r, 'Seil').doubt && r.rv.openText === '1 unsichere Zahl ist gelb markiert. Prüft sie kurz.', { seil: rvRow(r, 'Seil'), open: r.rv.openText });
        // keyboard: Tab to a number, Enter opens it
        await P.locator('#stock-review .sk-row', { has: P.locator('.sk-iname', { hasText: /^Federn$/ }) }).locator('.sk-n button').first().focus();
        await P.keyboard.press('Enter'); await P.waitForTimeout(60);
        const fe = await P.evaluate(() => { const a = document.activeElement; return a && { tag: a.tagName, value: a.value }; });
        check(`${w}: keyboard: Enter on a number opens it ("2.115" as 2115)`, fe && fe.tag === 'INPUT' && fe.value === '2115', fe);
        // emptying a number: open again, asked about once
        await P.keyboard.press('Control+A'); await P.keyboard.press('Backspace'); await P.waitForTimeout(60);
        r = await SK(P);
        check(`${w}: an emptied number is open again (amber) and counted`, rvRow(r, 'Federn').doubt && r.rv.openText === '2 unsichere Zahlen sind gelb markiert. Prüft sie kurz.', { f: rvRow(r, 'Federn'), open: r.rv.openText });
        await P.keyboard.type('2116'); await P.waitForTimeout(60);
        r = await SK(P);
        check(`${w}: typed again: checked`, !rvRow(r, 'Federn').doubt && rvRow(r, 'Federn').n[0] === '2116' && r.rv.openText === '1 unsichere Zahl ist gelb markiert. Prüft sie kurz.', { f: rvRow(r, 'Federn'), open: r.rv.openText });
        await P.keyboard.press('Control+A'); await P.keyboard.type('12115'); await P.waitForTimeout(60);
        const fit = await P.evaluate(() => { const a = document.activeElement; return { v: a.value, sw: a.scrollWidth, cw: a.clientWidth }; });
        check(`${w}: a five-digit number fits its field (no digit hidden)`, fit.v === '12115' && fit.sw <= fit.cw, fit);
        await P.keyboard.press('Control+A'); await P.keyboard.type('2116'); await P.waitForTimeout(60);
        await P.fill('.sk-row .sk-n.doubt input', '2'); await P.waitForTimeout(60);
        const sc = await P.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
        check(`${w}: with fields open: no horizontal scroll`, sc.sw <= sc.vw, sc);
        await P.click('#stock-save');
        await until(() => srv.docs('stock').length === 1);
        const doc = (srv.docs('stock')[0] || [])[1];
        const by = new Map((doc ? doc.rows : []).map(x => [x.name, x]));
        check(`${w}: saved with the corrections (Seil 14, Federn 2116), the rest as read`, doc && by.get('Seil').lager === 14 && by.get('Federn').lager === 2116 && by.get('Eisenerz').unterwegs === 2 && by.get('Baumstamm').lager === 70 && by.get('Seil').reserviert === 0,
          doc && [by.get('Seil'), by.get('Federn')]);
        await A.ctx.close();
      });
    }

    // ===== 2) Second check: trend, falling fast, prefilled Bewohner/Vieh, keep the latest 12 =====
    await section('2) trend and keep 12', async () => {
      const now = Date.now(), day = 864e5;
      const stock = {};
      for (let i = 11; i >= 1; i--) stock['old' + two(i)] = docOf(now - (i + 2) * day, L.rows);   // 11 older ones, 3..13 days back
      const AT0 = now - 2 * day;
      stock.prev = docOf(AT0, withRows({ Baumstamm: 86, 'Rote Bete': 884, 'Grobes Tierfutter': 2 }));   // the last one before
      const srv = makeServer(seedAll(stock));
      const A = await phone(browser, srv, { name: 'A2', inClaude: true, writable: true, user: owner, anim: 'aus' });
      const P = A.page;
      check('no writes at load', !srv.log.length, srv.log.slice(0, 3));
      await P.click('#tab-lager'); await P.waitForTimeout(150);
      let r = await SK(P);
      check('loaded: the latest check (12 kept) is shown', r.over && grp(r, 'holz') && grp(r, 'holz').total === fmt(TOTAL.holz + 16), r.over && grp(r, 'holz'));
      const reply = { rows: REPLY.rows, note: '' };   // no population / livestock on these photos
      await readStock(P, reply);
      r = await SK(P);
      check('Bewohner and Vieh prefilled from the last check (asked once)', r.rv && r.rv.pop === '32' && r.rv.vieh === '11', r.rv && [r.rv.pop, r.rv.vieh]);
      await P.fill('.sk-row .sk-n.doubt input', '2'); await P.waitForTimeout(80);
      const n0 = srv.log.length;
      await P.click('#stock-save');
      await until(() => srv.log.length >= n0 + 2);
      await P.waitForTimeout(250);
      const ids = srv.docs('stock').map(x => x[0]);
      check('keep 12: the new one written, the oldest deleted in the same action', ids.length === 12 && !ids.includes('old11') && ids.includes('prev') && ids.includes('old01')
        && srv.log.slice(n0).filter(x => x.op === 'set').length === 1 && JSON.stringify(srv.log.slice(n0).filter(x => x.op === 'delete').map(x => x.id)) === '["old11"]', { ids, log: srv.log.slice(n0).map(x => [x.op, x.id]) });
      r = await SK(P);
      const since = `seit ${dm(AT0)}`;
      check('trend per group: "↓ 16 seit …" (Holz), "↓ 700" (Essen), "↑ 5" (Tierfutter), "gleich" (Stoff)', grp(r, 'holz').trend === `↓ 16 ${since}` && grp(r, 'essen').trend === `↓ 700 ${since}` && grp(r, 'futter').trend === `↑ 5 ${since}` && grp(r, 'stoff').trend === `gleich ${since}`,
        ['holz', 'essen', 'futter', 'stoff'].map(g => grp(r, g).trend));
      check('from the second check on: still an estimate, plus the trend', r.over.est === 'Schätzung – die Ampel nutzt Richtwerte und den Verlauf seit der letzten Prüfung.', r.over.est);
      check('Essen falls fast: knapp although above the minimum, "reicht bei diesem Verbrauch noch etwa 1 Prüfung"', grp(r, 'essen').light === 'knapp' && grp(r, 'essen').why === 'für 32 Bewohner · reicht bei diesem Verbrauch noch etwa 1 Prüfung', [grp(r, 'essen').light, grp(r, 'essen').why]);
      const k2 = sl(r, 'knapp');
      check('suggestions: Essen knapp (falling fast) after Leinen, Tierfutter, Seil, with Kochen, Jagen, Ernte to raise and "Auch dafür: Landwirtschaft."', k2 && k2.lines.map(c => c.key).join() === 'Leinen,futter,Seil,essen'
        && k2.lines[3].text === `Essen ${FOOD} für 32 Bewohner – knapp, mehr herstellen. Reicht bei diesem Verbrauch noch etwa 1 Prüfung.`
        && k2.lines[3].hint === `${raise(['Kochen', 'cooking'], ['Jagen', 'hunting'], ['Ernte', 'harvesting'])} Auch dafür: Landwirtschaft.`, k2);
      check('… Reichlich: only Rohstein now', sl(r, 'viel') && JSON.stringify(sl(r, 'viel').lines) === JSON.stringify([VIEL[1]]), sl(r, 'viel'));
      await P.click('#tab-plan'); await P.waitForTimeout(150);
      check('Plan line: "Lager: Leinen, Tierfutter, Seil und 1 weitere knapp → Vorschläge ansehen"', (await SK(P)).line === 'Lager: Leinen, Tierfutter, Seil und 1 weitere knapp → Vorschläge ansehen', (await SK(P)).line);
      // Rückgängig brings the deleted one back
      const n1 = srv.log.length;
      await P.click('#toast .toast-act');
      await until(() => srv.log.length >= n1 + 2);
      await P.waitForTimeout(200);
      const ids2 = srv.docs('stock').map(x => x[0]).sort();
      check('Rückgängig: the new check goes, the deleted oldest comes back', ids2.length === 12 && ids2.includes('old11') && JSON.stringify(ids2) === JSON.stringify(Object.keys(stock).sort()), ids2);
      await A.ctx.close();
    });

    // ===== 3) Read-only viewer: may check and look, cannot save =====
    await section('3) read-only', async () => {
      const srv = makeServer(seedAll({ k1: docOf(Date.now() - 3600e3) }));
      const V = await phone(browser, srv, { name: 'V', inClaude: true, writable: false, user: viewer, anim: 'aus' });
      const P = V.page;
      let r = await SK(P);
      check('read-only: the Plan line shows', r.line === LINE, r.line);
      await P.click('#tab-lager'); await P.waitForTimeout(150);
      r = await SK(P);
      check('read-only: the overview and the suggestions', r.over && r.over.groups.length === 8 && r.sugg && r.sugg.lists.length === 2 && JSON.stringify(sl(r, 'knapp').lines) === JSON.stringify(KNAPP), r.over && r.over.groups.length);
      check('read-only: "Lager prüfen (Foto)" is there (checking is allowed)', r.open && r.open.shown);
      await readStock(P, REPLY);
      r = await SK(P);
      check('read-only: the review shows, saving is not possible', r.review && r.rv.ro === 'Nur ansehen: Ihr seht das Ergebnis, speichern könnt ihr hier nicht.' && r.rv.save.disabled && r.rv.sum === '75 Gegenstände erkannt, 5 doppelte Zeilen zusammengeführt.', r.rv && { ro: r.rv.ro, save: r.rv.save, sum: r.rv.sum });
      check('read-only: nothing written', !srv.log.length);
      await P.click('#stock-discard'); await P.waitForTimeout(100);
      check('"Verwerfen" closes the review', !(await SK(P)).review);
      await V.ctx.close();
    });

    // ===== 4) Errors and limits =====
    await section('4) errors', async () => {
      const srv = makeServer(seedAll());
      // no sample: no photo reading here, the note says why
      let X = await phone(browser, srv, { name: 'N', inClaude: true, writable: true, user: owner, sample: null }, { hash: '#lager' });
      let r = await SK(X.page);
      check('without Claude: no "Lager prüfen (Foto)", a note, the how-to stays', r.open && !r.open.shown && r.note === 'Lager prüfen per Foto klappt nur, wenn ihr die Seite in Claude geöffnet habt und angemeldet seid.' && r.empty && r.empty.includes(HOWTO), { open: r.open, note: r.note });
      await X.ctx.close();
      X = await phone(browser, srv, { name: 'N2', inClaude: true, writable: true, user: owner, sample: 'noImages' }, { hash: '#lager' });
      r = await SK(X.page);
      check('no images in this view: a note', r.open && !r.open.shown && r.note === 'Bilder lesen geht in dieser Ansicht nicht.', r.note);
      await X.ctx.close();
      const A = await phone(browser, srv, { name: 'E', inClaude: true, writable: true, user: owner, anim: 'aus' }, { hash: '#lager' });
      const P = A.page;
      await P.click('#stock-open');
      await P.setInputFiles('#stock-file', Array.from({ length: 9 }, () => IMGS[0])); await P.waitForTimeout(300);
      r = await SK(P);
      check('at most 8 photos', r.thumbs === 8 && r.msg === 'Höchstens 8 Bilder auf einmal.', { n: r.thumbs, msg: r.msg });
      await P.click('#stock-thumbs [data-skrm="7"]'); await P.waitForTimeout(80);
      check('a photo can be removed', (await SK(P)).thumbs === 7);
      const errCase = async (err, want) => {
        await P.evaluate(e => { window.__err = e; window.__wait = 60; }, err);
        await P.click('#stock-read'); await readDone(P);
        return (await SK(P)).msg;
      };
      check('rate limit', (await errCase({ code: 'rate_limited', message: 'x' })) === 'Euer Claude-Limit ist gerade erreicht. Versucht es später noch einmal.');
      check('unreadable answer', (await errCase({ code: 'invalid_json', message: 'x' })) === 'Die Antwort war nicht lesbar. Versucht es noch einmal, am besten mit einem schärferen Bild.');
      check('other failure', (await errCase({ code: 'unavailable', message: 'x' })) === 'Die Verbindung wurde unterbrochen. Versucht es noch einmal.');
      await P.evaluate(() => { window.__err = null; window.__reply = { rows: [], note: 'Das ist die Karte, keine Lager-Liste.' }; });
      await P.click('#stock-read'); await readDone(P);
      r = await SK(P);
      check('nothing found: Claude\'s note, no review', r.msg === 'Das ist die Karte, keine Lager-Liste.' && !r.review, r.msg);
      await P.evaluate(() => { window.__reply = { rows: [] }; });
      await P.click('#stock-read'); await readDone(P);
      check('nothing found, no note: the hint', (await SK(P)).msg === 'Auf den Fotos war keine Lager-Liste zu erkennen. Fotografiert das Fenster „Lager“ so, dass Namen und Zahlen scharf zu sehen sind.');
      await P.evaluate(() => { window.__wait = 800; });
      await P.click('#stock-read'); await P.waitForTimeout(100);
      await P.click('#stock-stop'); await readDone(P);
      check('Stopp: "Abgebrochen."', (await SK(P)).msg === 'Abgebrochen.');
      check('every failure: nothing written, one call each', !srv.log.length && (await P.evaluate(() => window.__calls.length)) === 6);
      await P.evaluate(() => { window.__err = { code: 'not_granted', message: 'x' }; window.__wait = 30; });
      await P.click('#stock-read'); await P.waitForTimeout(400);
      r = await SK(P);
      check('Claude not allowed: photos off for this view (panel closes, button goes, note, toast)', !r.photo && !r.open.shown && r.note === 'Ihr habt Claude das Lesen von Bildern für diese Seite nicht erlaubt.' && /nicht erlaubt/.test(await toastMsg(P)), { photo: r.photo, note: r.note, toast: await toastMsg(P) });
      await A.ctx.close();
    });

    // ===== 4b) A screenshot pasted or dropped on the Lager tab goes to "Lager prüfen" (never into the villager import) =====
    await section('4b) paste and drop', async () => {
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'PD', inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: 1280, height: 900, hash: '#lager' });
      const P = A.page;
      const give = how => P.evaluate(async how => {
        const c = document.createElement('canvas'); c.width = c.height = 8;
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const dt = new DataTransfer(); dt.items.add(new File([blob], 'lager.png', { type: 'image/png' }));
        if (how === 'paste') document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        else { document.body.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }
      }, how);
      const where = () => P.evaluate(() => ({ lager: !document.getElementById('panel-lager').hidden, arbeiter: !document.getElementById('panel-arbeiter').hidden,
        stockOpen: !document.getElementById('stock-photo').hidden, stockThumbs: document.querySelectorAll('#stock-thumbs .thumb').length, importThumbs: document.querySelectorAll('#thumbs .thumb').length }));
      await give('paste'); await P.waitForTimeout(250);
      let w = await where();
      check('paste on the Lager tab (closed): "Lager prüfen" opens with the picture, the villager import stays empty', w.lager && !w.arbeiter && w.stockOpen && w.stockThumbs === 1 && w.importThumbs === 0, w);
      await P.click('#stock-close'); await P.waitForTimeout(80);
      await give('drop'); await P.waitForTimeout(250);
      w = await where();
      check('drop on the Lager tab (closed): the same', w.lager && !w.arbeiter && w.stockOpen && w.stockThumbs === 1 && w.importThumbs === 0, w);
      await P.click('#tab-plan'); await P.waitForTimeout(80);
      await give('paste'); await P.waitForTimeout(250);
      w = await where();
      check('paste on the Plan tab: the villager import as before', w.arbeiter && w.importThumbs === 1, w);
      check('nothing written', !srv.log.length);
      await A.ctx.close();
    });

    // ===== 5) Local mode (no shared list): saved inside the LS payload, unknown items by category / Claude's group =====
    await section('5) local', async () => {
      const A = await phone(browser, null, { name: 'LOC', inClaude: false, anim: 'aus' }, { hash: '#lager' });
      const P = A.page;
      const extra = [
        { name: 'Spitzhacke', category: 'Werkzeuge', lager: 3, reserviert: 0, unterwegs: 0, group: 'werkzeug', unsure: [] },
        { name: 'Sandstein', category: 'Rohstoffe', lager: 40, reserviert: 0, unterwegs: 0, group: 'stein', unsure: [] },
        { name: 'Brot', category: 'Proviant', lager: 50, reserviert: 0, unterwegs: 0, group: 'sonstiges', unsure: [] },
      ];
      const reply = { rows: [...L.rows.map(r => ({ ...r, group: groupOf(r), unsure: [] })), ...extra], population: 32, livestock: 11 };
      await readStock(P, reply);
      await P.click('#stock-save'); await P.waitForTimeout(200);
      await P.click('#toast .toast-act'); await P.waitForTimeout(200);
      const ls0 = await P.evaluate(() => JSON.parse(localStorage.getItem('bellwright-arbeitsplan-v1') || 'null'));
      const r0 = await SK(P);
      check('local: Rückgängig of the only check: gone from the LS payload, the empty state is back', ls0 && ls0.stock && !Object.keys(ls0.stock).length && r0.empty && !r0.over, { ls: ls0 && ls0.stock, empty: r0.empty });
      await readStock(P, reply);
      await P.click('#stock-save'); await P.waitForTimeout(300);
      const ls = await P.evaluate(() => JSON.parse(localStorage.getItem('bellwright-arbeitsplan-v1') || 'null'));
      const docs = ls && ls.stock ? Object.values(ls.stock) : [];
      check('local: the check is inside the LS payload', docs.length === 1 && docs[0].rows.length === 78 && docs[0].pop === 32, ls && Object.keys(ls));
      // The next visit of this browser (see nextVisit: not page.reload(), and not a bare second page either).
      const Q = await nextVisit(A.ctx, P, ['bellwright-arbeitsplan-v1'], null, { name: 'LOC2', inClaude: false, anim: 'aus' });
      const tOver = await until(() => Q.evaluate(() => { const o = document.getElementById('sk-over'); return !!o && !o.hidden; }), 5000);
      const r = await SK(Q);
      const diag = await Q.evaluate(() => { const d = JSON.parse(localStorage.getItem('bellwright-arbeitsplan-v1') || 'null'); const h = id => document.getElementById(id).hidden;
        return { hash: location.hash, lager: !h('panel-lager'), over: !h('sk-over'), load: !h('stock-load'), empty: !h('stock-empty'), lsStock: d && d.stock ? Object.keys(d.stock).length : null, status: document.getElementById('status-text').textContent }; });
      check('local: the next page of this browser shows the overview', r.over && r.over.groups.length === 9, r.over ? r.over.groups.map(g => g.id) : { ...diag, waited: tOver });
      await Q.click('.sk-group[data-group="werkzeug"] summary'); await Q.click('.sk-group[data-group="stein"] summary'); await Q.click('.sk-group[data-group="essen"] summary');
      await Q.waitForTimeout(100);
      const r2 = await SK(Q);
      check('category Werkzeuge -> Werkzeug; an unknown Rohstoff -> Claude\'s group; an unknown Proviant -> Essen', grp(r2, 'werkzeug').items.some(i => i.name === 'Spitzhacke') && grp(r2, 'stein').items.some(i => i.name === 'Sandstein') && grp(r2, 'essen').items.some(i => i.name === 'Brot')
        && grp(r2, 'werkzeug').light !== null && !r2.over.missing, { w: grp(r2, 'werkzeug'), missing: r2.over.missing });
      await A.ctx.close();
    });

    // ===== 6) Animations per the skill: voll / ruhig / aus =====
    for (const lvl of ['voll', 'ruhig', 'aus']) {
      await section('6) ' + lvl, async () => {
        const srv = makeServer(seedAll());
        const A = await phone(browser, srv, { name: 'AN' + lvl, inClaude: true, writable: true, user: owner, anim: lvl }, { hash: '#lager' });
        const P = A.page;
        await P.click('#stock-open');
        await P.setInputFiles('#stock-file', IMGS);
        await P.evaluate(rep => { window.__reply = rep; window.__wait = 60; }, REPLY);
        await P.click('#stock-read');
        await until(() => P.evaluate(() => !document.getElementById('stock-review').hidden), 3000);
        const rvA = await P.evaluate(() => [...document.querySelectorAll('#stock-review .sk-in')].map(e => { const s = getComputedStyle(e); return s.animationName + ' ' + s.animationDuration; }));
        await P.fill('.sk-row .sk-n.doubt input', '2');
        await P.click('#stock-save');
        await P.waitForTimeout(30);
        const ovA = await P.evaluate(() => ({ cls: [...document.querySelectorAll('#stock-view .sk-in')].map(e => { const s = getComputedStyle(e); return s.animationName + ' ' + s.animationDuration; }),
          js: [...document.querySelectorAll('#stock-view *')].filter(e => e.getAnimations && e.getAnimations().length).length }));
        if (lvl === 'voll') {
          check('voll: the review rows come in like a list (rise, 220 ms)', rvA.length > 0 && rvA.every(x => x === 'rise 0.22s'), rvA.slice(0, 3));
          check('voll: the overview comes in group by group (rise, 220 ms) and the lights stamp', ovA.cls.length >= 8 && ovA.cls.every(x => x === 'rise 0.22s') && ovA.js > 0, ovA);
        } else if (lvl === 'ruhig') {
          check('ruhig: only a 150 ms fade', rvA.length > 0 && rvA.every(x => x === 'calmIn 0.15s') && ovA.cls.length >= 8 && ovA.cls.every(x => x === 'calmIn 0.15s'), { rvA: rvA.slice(0, 2), ovA });
        } else {
          check('aus: nothing moves', !rvA.length && !ovA.cls.length && ovA.js === 0, { rvA, ovA });
        }
        await P.waitForTimeout(1500);
        const left = await P.evaluate(() => document.querySelectorAll('#panel-lager .sk-in').length);
        check(`${lvl}: no animation classes left behind`, left === 0, left);
        await P.click('.sk-group[data-group="stoff"] summary'); await P.waitForTimeout(20);
        const open = await P.evaluate(() => { const s = getComputedStyle(document.querySelector('.sk-group[data-group="stoff"] .sk-items')); return s.animationName + ' ' + s.animationDuration; });
        check(`${lvl}: a group opens with ${lvl === 'voll' ? 'a short drop' : lvl === 'ruhig' ? 'a fade' : 'no animation'}`, lvl === 'voll' ? open === 'drop 0.25s' : lvl === 'ruhig' ? open === 'calmIn 0.15s' : open.startsWith('none'), open);
        // Something unrelated is drawn again (another phone's change, the minute clock): the open list stays as it is.
        await P.waitForTimeout(400);
        await P.evaluate(() => { window.__items = document.querySelector('.sk-group[data-group="stoff"] .sk-items'); });
        srv.broadcast('workers'); await P.waitForTimeout(60);
        const again = await P.evaluate(() => { const it = document.querySelector('.sk-group[data-group="stoff"] .sk-items'); return { same: it === window.__items, open: it.parentElement.open, anims: it.getAnimations().filter(a => a.playState === 'running').length }; });
        check(`${lvl}: an unrelated redraw leaves the open group alone (no new drop-in)`, again.same && again.open && !again.anims, again);
        await A.ctx.close();
      });
    }

    // ===== 7) Layout: 360 / 390 / 1280, tabs fit, no horizontal scroll, >= 44 px, keyboard =====
    for (const w of [360, 390, 1280]) {
      await section('7) layout ' + w, async () => {
        for (const noFonts of w < 900 ? [false, true] : [false]) {
          const X = await phone(browser, makeServer(seedAll()), { name: 'T' + w, inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: w, height: 780, noFonts });
          const t = await X.page.evaluate(() => { const l = document.querySelector('.tablist'); return { sw: l.scrollWidth, cw: l.clientWidth, h: Math.min(...[...l.children].map(b => b.getBoundingClientRect().height)), wmin: Math.min(...[...l.children].map(b => b.getBoundingClientRect().width)) }; });
          check(`${w}${noFonts ? ' (fallback font)' : ''}: the tab row fits (5 tabs), each tab >= 44 px`, t.sw <= t.cw + 1 && t.h >= 44 && t.wmin >= 44, t);
          if (!noFonts) await X.page.screenshot({ path: path.join(SHOTS, `stock-${w}-tabs.png`), clip: { x: 0, y: 0, width: w, height: 260 } });
          await X.ctx.close();
        }
        const srvE = makeServer(seedAll());
        const E = await phone(browser, srvE, { name: 'LE' + w, inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: w, height: 780, hash: '#lager' });
        await E.page.screenshot({ path: path.join(SHOTS, `stock-${w}-empty.png`) });
        await E.ctx.close();
        const srv = makeServer(seedAll({ k1: docOf(Date.now() - 3 * 864e5, withRows({ Baumstamm: 86 })) }));
        const A = await phone(browser, srv, { name: 'L' + w, inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: w, height: 780 });
        const P = A.page;
        await P.screenshot({ path: path.join(SHOTS, `stock-${w}-planline.png`) });
        if (w === 1280) {
          await P.focus('#tab-arbeiter'); await P.keyboard.press('Tab');
          const f = await P.evaluate(() => document.activeElement && document.activeElement.id);
          await P.keyboard.press('Enter'); await P.waitForTimeout(150);
          check('keyboard: Tab from "Arbeiter" reaches "Lager", Enter opens it', f === 'tab-lager' && await P.evaluate(() => !document.getElementById('panel-lager').hidden), f);
        } else await P.click('#tab-lager');
        await P.waitForTimeout(150);
        for (const s of await P.$$('.sk-group summary')) await s.click();
        await P.waitForTimeout(100);
        const measure = () => P.evaluate(() => {
          const vis = el => !el.closest('[hidden]') && el.getClientRects().length > 0;
          const els = [...document.querySelectorAll('#panel-lager button, #panel-lager label.btn, #panel-lager summary, #panel-lager input:not(.vh), #stock-line-go')].filter(vis);
          const small = els.filter(e => e.getBoundingClientRect().height < 44).map(e => (e.textContent || e.id || e.tagName).trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().height));
          const wide = [...document.querySelectorAll('#panel-lager *')].filter(vis).filter(e => e.getBoundingClientRect().right > innerWidth + 0.5).map(e => e.className || e.tagName).slice(0, 5);
          return { sw: document.documentElement.scrollWidth, vw: innerWidth, small, wide };
        });
        let m = await measure();
        check(`${w}: overview: no horizontal scroll`, m.sw <= m.vw && !m.wide.length, m);
        if (w < 900) check(`${w}: overview: every control >= 44 px`, !m.small.length, m.small);
        await P.evaluate(() => window.scrollTo(0, 0));
        await P.screenshot({ path: path.join(SHOTS, `stock-${w}-overview.png`) });
        await P.evaluate(() => document.getElementById('sk-sugg-h').scrollIntoView());
        await P.screenshot({ path: path.join(SHOTS, `stock-${w}-suggestions.png`) });
        await readStock(P, REPLY);
        await P.evaluate(() => { for (const d of document.querySelectorAll('.sk-rgroup')) d.open = true; });
        await P.waitForTimeout(100);
        m = await measure();
        check(`${w}: review: no horizontal scroll`, m.sw <= m.vw && !m.wide.length, m);
        if (w < 900) check(`${w}: review: every control >= 44 px`, !m.small.length, m.small);
        await P.evaluate(() => document.getElementById('stock-rv-title').scrollIntoView());
        await P.screenshot({ path: path.join(SHOTS, `stock-${w}-review.png`) });
        await P.evaluate(() => document.querySelector('.sk-rgroup[data-group="stoff"]').scrollIntoView({ block: 'center' }));
        await P.waitForTimeout(80);
        const bar = await P.evaluate(() => { const b = document.querySelector('#stock-review .sk-act').getBoundingClientRect(); return { bottom: Math.round(b.bottom), vh: innerHeight, end: Math.round(document.getElementById('stock-review').getBoundingClientRect().bottom) }; });
        check(`${w}: the review's action bar stays at the bottom while scrolling`, bar.end > bar.vh ? Math.abs(bar.bottom - bar.vh) <= 1 : bar.bottom <= bar.vh, bar);
        await P.screenshot({ path: path.join(SHOTS, `stock-${w}-review-rows.png`) });
        await A.ctx.close();
      });
    }

    // ===== 8) BUILD 18b: the lists per resource on the page — real data and 7 + 7 lines (5 shown, "+ 2 weitere") =====
    const SHOTS_I = path.resolve(__dirname, '../shots-stock-items');
    fs.mkdirSync(SHOTS_I, { recursive: true });
    const measureSugg = P => P.evaluate(() => {
      const vis = el => !el.closest('[hidden]') && el.getClientRects().length > 0;
      const box = document.getElementById('sk-sugg');
      const small = [...box.querySelectorAll('button')].filter(vis).filter(e => e.getBoundingClientRect().height < 44).map(e => e.textContent.trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().height));
      const wide = [...document.querySelectorAll('#panel-lager *')].filter(vis).filter(e => e.getBoundingClientRect().right > innerWidth + 0.5).map(e => e.className || e.tagName).slice(0, 5);
      return { sw: document.documentElement.scrollWidth, vw: innerWidth, small, wide };
    });
    for (const w of [360, 390, 1280]) {
      await section('8) item lists ' + w, async () => {
        const srv = makeServer(seedAll({ k1: docOf(Date.now() - 3600e3) }));
        const A = await phone(browser, srv, { name: 'IL' + w, inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: w, height: 800, hash: '#lager' });
        let r = await SK(A.page);
        check(`${w}: real data: Knapp (3 lines with hints) and Reichlich (2 lines), no "weitere"`, sl(r, 'knapp') && sl(r, 'viel') && JSON.stringify(sl(r, 'knapp').lines) === JSON.stringify(KNAPP)
          && JSON.stringify(sl(r, 'viel').lines) === JSON.stringify(VIEL) && !sl(r, 'knapp').more && !sl(r, 'viel').more, r.sugg && r.sugg.lists);
        // A job and its importance ("Landwirtschaft – gerade „normal“") never break across two lines.
        const broken = await A.page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('#sk-sugg .sk-do')) {
            const nodes = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let txt = '';
            while (walk.nextNode()) { nodes.push([walk.currentNode, txt.length]); txt += walk.currentNode.data; }
            const at = i => { let k = nodes.length - 1; while (k > 0 && nodes[k][1] > i) k--; return [nodes[k][0], i - nodes[k][1]]; };
            for (const mt of txt.matchAll(/\S+[\s ]–[\s ]gerade[\s ]„[^“]+“/g)) {
              const r = document.createRange(); r.setStart(...at(mt.index)); r.setEnd(...at(mt.index + mt[0].length));
              const tops = new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)));
              if (tops.size > 1) out.push(mt[0]);
            }
          }
          return out;
        });
        check(`${w}: real data: a job and its importance stay on one line`, !broken.length, broken);
        if (w === 1280) {
          const cols = await A.page.evaluate(() => { const c = document.getElementById('sk-cards').getBoundingClientRect(), [k, v] = [...document.querySelectorAll('#sk-cards .sk-list')].map(e => e.getBoundingClientRect());
            return { k: [Math.round(k.left), Math.round(k.right), Math.round(k.top)], v: [Math.round(v.left), Math.round(v.right), Math.round(v.top)], c: [Math.round(c.left), Math.round(c.right)] }; });
          check('1280: Knapp and Reichlich side by side, together filling the row', cols.k[2] === cols.v[2] && cols.k[0] === cols.c[0] && cols.k[1] < cols.v[0] && Math.abs(cols.v[1] - cols.c[1]) <= 1, cols);
        }
        let m = await measureSugg(A.page);
        check(`${w}: real data: no horizontal scroll`, m.sw <= m.vw && !m.wide.length, m);
        if (w < 900) check(`${w}: real data: every control of the suggestions >= 44 px`, !m.small.length, m.small);
        await A.page.locator('#sk-sugg').screenshot({ path: path.join(SHOTS_I, `items-${w}-real.png`) });
        await A.ctx.close();

        const srv2 = makeServer(seedAll({ k1: docOf(Date.now() - 3600e3, MANY) }));
        const B = await phone(browser, srv2, { name: 'IM' + w, inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: w, height: 800, hash: '#lager' });
        const Q = B.page;
        r = await SK(Q);
        const kn = sl(r, 'knapp'), vi = sl(r, 'viel');
        check(`${w}: 7 knapp: the 5 most urgent shown, then "+ 2 weitere"`, kn && JSON.stringify(kn.lines) === JSON.stringify(MANY_KNAPP.slice(0, 5)) && kn.hidden === 2 && kn.more === '+ 2 weitere', kn);
        check(`${w}: 7 reichlich: the 5 largest shown, then "+ 2 weitere"`, vi && JSON.stringify(vi.lines) === JSON.stringify(MANY_VIEL.slice(0, 5)) && vi.hidden === 2 && vi.more === '+ 2 weitere', vi);
        m = await measureSugg(Q);
        check(`${w}: 7 + 7: no horizontal scroll`, m.sw <= m.vw && !m.wide.length, m);
        if (w < 900) check(`${w}: 7 + 7: "+ 2 weitere" and every other control >= 44 px`, !m.small.length, m.small);
        await Q.locator('#sk-sugg').screenshot({ path: path.join(SHOTS_I, `items-${w}-many.png`) });
        if (w === 1280) {   // keyboard: Tab reaches "+ 2 weitere", Enter opens it
          await Q.focus('.sk-list[data-light="knapp"] .sk-more'); await Q.keyboard.press('Enter');
        } else await Q.click('.sk-list[data-light="knapp"] .sk-more');
        await Q.waitForTimeout(120);
        r = await SK(Q);
        const kn2 = sl(r, 'knapp');
        check(`${w}: "+ 2 weitere" shows the rest in order, the button goes, Reichlich stays as it was`, kn2 && JSON.stringify(kn2.lines) === JSON.stringify(MANY_KNAPP) && !kn2.hidden && !kn2.more
          && sl(r, 'viel').more === '+ 2 weitere' && sl(r, 'viel').lines.length === 5, kn2);
        const foc = await Q.evaluate(() => { const a = document.activeElement; return a && a.closest && a.closest('.sk-lines') ? a.dataset.key : (a && (a.id || a.className || a.tagName)); });
        check(`${w}: focus moves to the first line it showed`, foc === 'Baumstamm', foc);
        srv2.broadcast('workers'); await Q.waitForTimeout(120);
        r = await SK(Q);
        check(`${w}: an unrelated redraw keeps the list open`, sl(r, 'knapp').lines.length === 7 && !sl(r, 'knapp').more, sl(r, 'knapp'));
        m = await measureSugg(Q);
        check(`${w}: opened: no horizontal scroll`, m.sw <= m.vw && !m.wide.length, m);
        await Q.locator('#sk-sugg').screenshot({ path: path.join(SHOTS_I, `items-${w}-many-open.png`) });
        check(`${w}: nothing written`, !srv2.log.length, srv2.log.slice(0, 2));
        if (w === 390) {   // Another phone saves a check where Baumstamm is nearly gone: it moves up to the 2nd line, keeps the focus
          await Q.evaluate(() => { const li = document.querySelector('#sk-cards .sk-lines > li[data-key="Baumstamm"]'); if (li) li.focus(); });
          srv2.col('stock').set('k2', docOf(Date.now(), MANY.map(x => x.name === 'Baumstamm' ? { ...x, lager: 1 } : x))); srv2.broadcast('stock');
          await until(async () => { const z = sl(await SK(Q), 'knapp'); return z && z.lines[1] && z.lines[1].key === 'Baumstamm'; }, 3000);
          const z = sl(await SK(Q), 'knapp');
          const f2 = await Q.evaluate(() => { const a = document.activeElement; return a && a.dataset ? a.dataset.key || a.tagName : null; });
          check('390: a new check from another phone: the line in focus keeps the focus where it moved to, the list stays open', z && z.lines[1].key === 'Baumstamm' && z.lines.length === 7 && f2 === 'Baumstamm', { keys: z && z.lines.map(x => x.key), f2 });
        }
        await B.ctx.close();
      });
    }
    // A read-only viewer sees the same lists and can open "+ 2 weitere" (nothing is written).
    await section('8) read-only more', async () => {
      const srv = makeServer(seedAll({ k1: docOf(Date.now() - 3600e3, MANY) }));
      const V = await phone(browser, srv, { name: 'IV', inClaude: true, writable: false, user: viewer, anim: 'aus' }, { hash: '#lager' });
      let r = await SK(V.page);
      check('read-only: 5 + "+ 2 weitere" in both lists', sl(r, 'knapp') && sl(r, 'knapp').more === '+ 2 weitere' && sl(r, 'viel').more === '+ 2 weitere', r.sugg && r.sugg.lists);
      await V.page.click('.sk-list[data-light="viel"] .sk-more'); await V.page.waitForTimeout(120);
      r = await SK(V.page);
      check('read-only: "+ 2 weitere" shows the rest of Reichlich, nothing written', JSON.stringify(sl(r, 'viel').lines) === JSON.stringify(MANY_VIEL) && !srv.log.length, sl(r, 'viel'));
      await V.ctx.close();
    });
    // Nothing knapp and nothing reichlich (only Proviant photographed, Essen in between): "Gerade gibt es nichts vorzuschlagen."
    await section('8) nothing to suggest', async () => {
      const rows = L.rows.filter(r => r.category === 'Proviant').map(r => r.name === 'Rote Bete' ? { ...r, lager: 0 } : r);
      const srv = makeServer(seedAll({ k1: docOf(Date.now() - 3600e3, rows) }));
      const A = await phone(browser, srv, { name: 'IN', inClaude: true, writable: true, user: owner, anim: 'aus' }, { hash: '#lager' });
      const r = await SK(A.page);
      check('only Proviant, Essen okay: no lists, "Gerade gibt es nichts vorzuschlagen."', r.sugg && !r.sugg.lists.length && r.sugg.none === 'Gerade gibt es nichts vorzuschlagen.' && r.line === null, r.sugg);
      await A.ctx.close();
    });
    // The rest comes in like the rows of a list (voll: rise 220 ms; ruhig: a 150 ms fade; aus: at once).
    for (const lvl of ['voll', 'ruhig', 'aus']) {
      await section('8) reveal ' + lvl, async () => {
        const srv = makeServer(seedAll({ k1: docOf(Date.now() - 3600e3, MANY) }));
        const A = await phone(browser, srv, { name: 'IR' + lvl, inClaude: true, writable: true, user: owner, anim: lvl }, { hash: '#lager' });
        const P = A.page;
        await P.waitForTimeout(600);
        await P.click('.sk-list[data-light="knapp"] .sk-more'); await P.waitForTimeout(20);
        const an = await P.evaluate(() => [...document.querySelectorAll('.sk-list[data-light="knapp"] .sk-lines > li')].slice(5).map(e => { const s = getComputedStyle(e); return s.animationName + ' ' + s.animationDuration; }));
        const want = lvl === 'voll' ? 'rise 0.22s' : lvl === 'ruhig' ? 'calmIn 0.15s' : null;
        check(`${lvl}: the 2 lines shown ${want ? `come in (${want})` : 'appear at once'}`, an.length === 2 && an.every(x => want ? x === want : x.startsWith('none')), an);
        await P.waitForTimeout(900);
        check(`${lvl}: no animation classes left behind`, (await P.evaluate(() => document.querySelectorAll('#panel-lager .sk-in').length)) === 0);
        await A.ctx.close();
      });
    }
  } finally { await browser.close(); }
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const n of notes) console.log('NOTE ' + n);
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-stock: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

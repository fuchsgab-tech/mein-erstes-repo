// BUILD 18 "Vorrats-Check per Lager-Foto": the group photographs the game's "Lager" window (a category, a list of items
// with three numbers: Lager, reserviert, unterwegs) and the app reads it with Claude, shows the stock in groups with a
// traffic light (knapp / okay / viel) and SUGGESTS which jobs should be more or less important. It changes nothing by itself.
// Data: the NEW collection 'stock', one doc per check {at, by, rows, pop, vieh} (the latest 12 are kept; older ones are
// deleted in the same "Speichern"); local mode keeps them inside the LS payload.
// Fixtures: lager-live.json = the lead's transcription of the group's real Lager photos (60 Rohstoffe + 15 Proviant rows,
// population 32, livestock 11), lager-*.jpg = those photos; check-live.json = the group's roster and settings (the
// importance each suggestion names). The sample stub answers with the transcription laid out like three photos: two
// overlapping Rohstoffe photos (5 rows twice), the Proviant photo (cut-off names), "2.115" for Federn, one unreadable number.
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
const up = (label, id) => `${label} ist gerade „${IMP[S.jobs[id].imp]}“ – „dringend“ wäre besser.`;
const down = (label, id) => `${label} ist gerade „${IMP[S.jobs[id].imp]}“ – kann etwas zurückgestellt werden.`;
const LIGHTS = { essen: 'viel', holz: 'okay', stein: 'okay', erz: 'okay', stoff: 'knapp', futter: 'knapp', saatgut: null, sonstiges: null };
const SUGG = [
  { key: 'futter', light: 'knapp', title: 'Tierfutter knapp', why: '7 Tierfutter bei 11 Tieren.', jobs: [up('Landwirtschaft', 'farming'), up('Tierhaltung', 'animals')] },
  { key: 'Seil', light: 'knapp', title: 'Seil knapp', why: 'Seil: 4 im Lager.', jobs: [up('Handwerk', 'crafting')] },
  { key: 'essen', light: 'viel', title: 'Essen viel', why: `${FOOD} Essen für 32 Bewohner.`, jobs: [down('Jagen', 'hunting'), down('Ernte', 'harvesting')] },
];
const WARN = ['Verdorbene Nahrung 79 – Essen verdirbt. Ein Vorratskeller hält Essen länger frisch.', 'Angebranntes Essen 8 (Angebrannter Fisch 6, Angebrannter Pilz 2) – zählt nicht als Essen.'];
const LINE = 'Lager: Tierfutter und Seil knapp → Vorschläge ansehen';
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
async function section(name, fn) { try { await fn(); } catch (e) { check(`${name}: runs to the end`, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } }
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
      cards: [...document.querySelectorAll('.sk-card')].filter(vis).map(c => ({ key: c.dataset.key, light: c.dataset.light, title: t(c.querySelector('h4')), why: t(c.querySelector('.sk-card-why')), jobs: [...c.querySelectorAll('.sk-jobs li')].map(t) })),
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
    check('why: "für 32 Bewohner", "bei 11 Tieren", "Seil 4 knapp"', why.essen === 'für 32 Bewohner' && why.futter === 'bei 11 Tieren' && why.stoff === 'Seil 4 knapp', why);
    check('warnings: spoiled food (Vorratskeller) and burnt food', JSON.stringify(m.warnings) === JSON.stringify(WARN), m.warnings);
    check('knapp, most urgent first: Tierfutter (7 of 33) before Seil (4 of 10)', JSON.stringify(m.knapp) === '["Tierfutter","Seil"]', m.knapp);
    check('the Plan line', m.line === LINE, m.line);
    check('suggestions: the knapp ones (importance from the settings, "dringend wäre besser"), then Essen viel without the jobs a knapp group needs',
      JSON.stringify(m.sugg) === JSON.stringify(SUGG), m.sugg);
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
    check('knapp order with the trend: below the minimum first', JSON.stringify(m2.knapp) === '["Tierfutter","Seil","Essen"]' && m2.line === 'Lager: Tierfutter, Seil und Essen knapp → Vorschläge ansehen', [m2.knapp, m2.line]);
    const se = m2.sugg.find(x => x.key === 'essen');
    check('Essen knapp: Kochen, Landwirtschaft, Jagen and Ernte more important; no "Essen viel" any more', se && se.light === 'knapp' && se.why === `${FOOD} Essen für 32 Bewohner. Reicht bei diesem Verbrauch noch etwa 1 Prüfung.`
      && JSON.stringify(se.jobs) === JSON.stringify([up('Kochen', 'cooking'), up('Landwirtschaft', 'farming'), up('Jagen', 'hunting'), up('Ernte', 'harvesting')]) && !m2.sugg.some(x => x.light === 'viel' && x.key === 'essen'), se);
    // Vieh and Bewohner unknown, no Vieh at all
    const mu = T.stockView([{ id: 'k1', ...docOf(AT1, L.rows, { vieh: null, pop: null }) }], S);
    const gu = id => mu.groups.find(g => g.id === id);
    check('Vieh unknown: Tierfutter against a fixed minimum (7 < 20: knapp), "Vieh unbekannt"', gu('futter').light === 'knapp' && gu('futter').why === 'Vieh unbekannt', [gu('futter').light, gu('futter').why]);
    check('Bewohner unknown: Essen without a light, "Bewohnerzahl fehlt"', gu('essen').light === null && gu('essen').why === 'Bewohnerzahl fehlt', [gu('essen').light, gu('essen').why]);
    const m0 = T.stockView([{ id: 'k1', ...docOf(AT1, L.rows, { vieh: 0 }) }], S);
    const f0 = m0.groups.find(g => g.id === 'futter');
    check('no Vieh: Tierfutter without a light, "Ohne Vieh braucht ihr kein Tierfutter.", no suggestion', f0.light === null && f0.why === 'Ohne Vieh braucht ihr kein Tierfutter.' && !m0.sugg.some(x => x.key === 'futter'), f0);
    const S2 = clone(S); S2.jobs.animals.on = false; S2.jobs.farming.imp = 5;
    const mo = T.stockView([{ id: 'k1', ...docOf(AT1) }], T.normSettings(S2));
    const sf = mo.sugg.find(x => x.key === 'futter');
    check('a job already "dringend" / switched off is said so', sf && JSON.stringify(sf.jobs) === JSON.stringify(['Landwirtschaft ist schon „dringend“.', 'Tierhaltung ist bei euch abgeschaltet.']), sf);
    check('no checks: nothing', T.stockView([], S) === null);
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
        && grp(r, 'essen').why === 'für 32 Bewohner' && grp(r, 'futter').why === 'bei 11 Tieren' && grp(r, 'stoff').why === 'Seil 4 knapp', r.over && r.over.groups.map(g => [g.id, g.light, g.total, g.why]));
      check('overview: groups collapsed, no trend on the first check', r.over.groups.every(g => !g.open && !g.trend));
      check('overview: warnings for spoiled and burnt food', JSON.stringify(r.over.warn) === JSON.stringify(WARN), r.over.warn);
      check('overview: "Nicht auf den Fotos: Werkzeug (Kategorie „Werkzeuge“)."', r.over.missing === 'Nicht auf den Fotos: Werkzeug (Kategorie „Werkzeuge“).', r.over.missing);
      await P.click('.sk-group[data-group="essen"] summary'); await P.waitForTimeout(100);
      r = await SK(P);
      const ess = grp(r, 'essen');
      check('Essen opens: 15 items with Lager / reserviert / unterwegs, raw / burnt / spoiled marked', ess.open && ess.items.length === 15 && JSON.stringify(ess.items.find(i => i.name === 'Kleines Stück rohes Flei…').n) === '["12","3","0"]'
        && RAW.every(n => ess.items.find(i => i.name === n).tag === 'roh – muss noch zubereitet werden') && ess.items.find(i => i.name === 'Verdorbene Nahrung').tag === 'verdorben – zählt nicht' && ess.items.find(i => i.name === 'Angebrannter Fisch').tag === 'angebrannt – zählt nicht', ess.items.slice(0, 4));
      check('suggestions: Tierfutter and Seil knapp, Essen viel, each job with its importance', r.sugg && r.sugg.head === 'Vorschläge'
        && JSON.stringify(r.sugg.cards) === JSON.stringify(SUGG.map(s => ({ key: s.key, light: s.light, title: s.title, why: s.why, jobs: s.jobs }))), r.sugg && r.sugg.cards);
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
        && rb2.sugg && JSON.stringify(rb2.sugg.cards.map(c => c.title)) === JSON.stringify(SUGG.map(s => s.title)), rb2.over && rb2.over.groups.map(g => [g.id, g.light]));
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
      check('no estimate note from the second check on', r.over.est === null, r.over.est);
      check('Essen falls fast: knapp although above the minimum, "reicht bei diesem Verbrauch noch etwa 1 Prüfung"', grp(r, 'essen').light === 'knapp' && grp(r, 'essen').why === 'für 32 Bewohner · reicht bei diesem Verbrauch noch etwa 1 Prüfung', [grp(r, 'essen').light, grp(r, 'essen').why]);
      check('suggestions: Essen knapp with Kochen, Landwirtschaft, Jagen, Ernte', r.sugg.cards.map(c => c.key).join() === 'futter,Seil,essen' && JSON.stringify(r.sugg.cards[2].jobs) === JSON.stringify([up('Kochen', 'cooking'), up('Landwirtschaft', 'farming'), up('Jagen', 'hunting'), up('Ernte', 'harvesting')]), r.sugg.cards);
      await P.click('#tab-plan'); await P.waitForTimeout(150);
      check('Plan line: "Lager: Tierfutter, Seil und Essen knapp → Vorschläge ansehen"', (await SK(P)).line === 'Lager: Tierfutter, Seil und Essen knapp → Vorschläge ansehen', (await SK(P)).line);
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
      check('read-only: the overview and the suggestions', r.over && r.over.groups.length === 8 && r.sugg && r.sugg.cards.length === 3, r.over && r.over.groups.length);
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
      // The next visit: a second page of this browser (not page.reload(): in a fresh headless context a localStorage write
      // on a file:// page is sometimes lost across a reload, 13 of 120 times in a bare page without this app).
      const Q = await A.ctx.newPage();
      Q.on('pageerror', e => errs.push('LOC2: ' + e.message));
      await Q.goto('file://' + process.cwd() + '/page.html#lager');
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
  } finally { await browser.close(); }
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-stock: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

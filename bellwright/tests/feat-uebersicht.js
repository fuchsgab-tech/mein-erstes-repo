// BUILD 21, step 2 "Übersicht": a new start tab. The title picture "Euer Dorf", four tiles (im Spiel eingetragen, Lager,
// im Spiel falsch, Werte), "Ins Spiel eintragen" with the way into the Eintragen-Modus and "Zu zweit", the progress of
// a split, and the Hinweise (Lager knapp, wrong priorities, old values), each with its way to the place to fix it.
// Opening the app without a tab in the address shows it; "#plan" and the other tabs open as before.
// The harness (fake server, phones) is the one from feat-duo.js.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../bellwright-arbeitsplan.html');
const SHOTS = path.resolve(__dirname, '../shots-uebersicht');
fs.mkdirSync(SHOTS, { recursive: true });
function load(file) {
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf('// ---------- Game data ----------');
  const b = s.indexOf('// ---------- Rendering: Plan ----------');
  const fn = new Function('localStorage', 'matchMedia', 'document', '"use strict";\n' + s.slice(a, b) + '\nreturn { JOBS };');
  const store = {};
  return fn({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, () => ({ matches: false }), undefined);
}
const T = load(APP);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));
const ENTRY_KEY = 'bellwright-eintragen-v1';
const LS_KEY = 'bellwright-arbeitsplan-v1';

const st = o => Object.fromEntries(Object.entries(o).map(([k, [cur, max]]) => [k, { cur, max }]));
const NAMES = ['Agnes', 'Bertram', 'Cilli', 'Dietmar', 'Edda', 'Fritz', 'Godric', 'Hilde', 'Irmgard', 'Jost'];
const STATS = [
  { labourer: [3, 5], harvesting: [6, 9], farming: [2, 4], cooking: [1, 3], crafting: [2, 6], researching: [0, 2], hunting: [5, 8] },
  { labourer: [7, 9], harvesting: [4, 6], farming: [1, 3], cooking: [2, 4], crafting: [3, 5], researching: [1, 3], hunting: [2, 4] },
  { labourer: [4, 6], harvesting: [2, 4], farming: [8, 10], cooking: [3, 5], crafting: [2, 4], researching: [2, 3], hunting: [1, 2] },
  { labourer: [5, 7], harvesting: [3, 5], farming: [2, 4], cooking: [7, 9], crafting: [1, 3], researching: [2, 4], hunting: [3, 5] },
  { labourer: [2, 4], harvesting: [1, 3], farming: [3, 6], cooking: [8, 10], crafting: [2, 4], researching: [3, 5], hunting: [0, 2] },
  { labourer: [6, 8], harvesting: [5, 7], farming: [4, 6], cooking: [2, 3], crafting: [6, 9], researching: [1, 2], hunting: [2, 3] },
  { labourer: [3, 6], harvesting: [3, 5], farming: [2, 4], cooking: [1, 4], crafting: [6, 10], researching: [4, 7], hunting: [1, 3] },
  { labourer: [2, 5], harvesting: [2, 5], farming: [7, 9], cooking: [4, 6], crafting: [1, 3], researching: [2, 4], hunting: [3, 6] },
  { labourer: [4, 5], harvesting: [7, 8], farming: [3, 4], cooking: [3, 4], crafting: [3, 4], researching: [5, 9], hunting: [2, 4] },
  { labourer: [8, 10], harvesting: [2, 3], farming: [2, 3], cooking: [2, 3], crafting: [4, 6], researching: [1, 2], hunting: [6, 9] },
];
// Cilli joined late: last in the app's roster (order 99), but the game lists villagers by name, so she is third there.
const SEED_W = Object.fromEntries(NAMES.map((n, i) => ['w_' + n.toLowerCase(), { name: n, role: 'worker', traits: '', order: n === 'Cilli' ? 99 : i + 1, stats: st(STATS[i]) }]));
// Everyone stands on 5 everywhere in the game (as entered long ago): every number the plan wants other than 5 is open.
const FIVES = Object.fromEntries(T.JOBS.map(j => [j.id, 5]));
const INGAME = Object.fromEntries(Object.keys(SEED_W).map(id => [id, { vals: FIVES, by: 'u_old', at: Date.now() - 2 * 864e5 }]));
const DIR = { u_a: 'Gabriel', u_b: 'Lena', u_ro: 'Ida' };

// ---------- fake server and page stub (lazy collections, as feat-mismatch.js) ----------
function makeServer(seed = {}) {
  const maps = new Map();
  const col = c => { if (!maps.has(c)) maps.set(c, new Map()); return maps.get(c); };
  const srv = { col, log: [], pages: new Set() };
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) col(c).set(id, clone(d));
  srv.docs = c => [...col(c)].map(([id, d]) => [id, clone(d)]);
  srv.broadcast = c => { const docs = srv.docs(c); for (const p of srv.pages) p.evaluate(([c, docs]) => window.__deliver && window.__deliver(c, docs), [c, docs]).catch(() => {}); };
  srv.write = async (who, op, c, id, d) => {
    await sleep(60);
    if (op === 'set') col(c).set(id, clone(d)); else col(c).delete(id);
    srv.log.push({ who, op, c, id, d: d && clone(d) });
    setTimeout(() => srv.broadcast(c), 10);
  };
  srv.duo = () => { const d = col('duo').get('current'); return d ? clone(d) : null; };
  return srv;
}
// cfg: { name, inClaude, writable, user, anim, seedLs }
function STUB(cfg) {
  try {
    if (cfg.anim !== null) localStorage.setItem('bellwright-anim-v1', JSON.stringify(cfg.anim || 'aus'));   // null: no choice made (the app's default)
    localStorage.setItem('bellwright-kosten-info-v1', 'true');
    localStorage.setItem('bellwright-sperre-tipp-v1', 'true');
    if (cfg.seedLs && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(cfg.seedLs)) localStorage.setItem(k, JSON.stringify(v)); }
  } catch (e) { /* ignore */ }
  if (!cfg.inClaude) { window.claude = { use: async () => null }; return; }
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
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: (cfg.dir || {})[i] || '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : null) };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 1500) : '')); };
const errs = [];
async function section(name, fn) { try { await fn(); } catch (e) { check(`${name}: runs to the end`, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } }
async function phone(browser, srv, cfg, { width = 390, height = 844, hash = '', reduced = false } = {}) {
  const mobile = width < 900;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  ctx.setDefaultTimeout(5000);
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push((cfg.name || '?') + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g(oogleapis|static)\.com|Failed to load resource/.test(m.text())) errs.push((cfg.name || '?') + ' console: ' + m.text()); });
  if (srv) {
    await ctx.exposeFunction('__srvWrite', (who, op, c, id, d) => srv.write(who, op, c, id, d));
    await ctx.exposeFunction('__srvRead', c => srv.docs(c));
    srv.pages.add(page);
    page.on('close', () => srv.pages.delete(page));
  }
  await page.addInitScript(STUB, { dir: DIR, ...cfg });
  await page.goto('file://' + process.cwd() + '/page.html' + hash);
  await page.waitForTimeout(500);
  return { ctx, page };
}
async function until(fn, max = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(30); }
  return -1;
}
// The next visit of this device (see feat-mismatch.js: headless Chromium now and then loses a localStorage write).
const notes = [];
async function nextVisit(ctx, from, keys, srv, cfg, hash = '#plan') {
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
    await page.addInitScript(STUB, { dir: DIR, ...cfg });
    await page.goto('file://' + process.cwd() + '/page.html' + hash);
    await page.waitForTimeout(600);
    if (await page.evaluate(w => Object.entries(w).every(([k, v]) => window.__lsAtStart[k] === v), wrote)) return page;
    notes.push(`${cfg.name}: a page of the test browser started without localStorage, opened another`);
    await page.close();
  }
  throw new Error('the test browser kept losing localStorage');
}

const gabriel = { id: 'u_a', owner: true, can: true };
const lena = { id: 'u_b', owner: false, can: true };
const ida = { id: 'u_ro', owner: false, can: false };
const seedAll = () => ({ workers: SEED_W, ingame: INGAME });

// ---------- reading the page ----------
const vis = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return !!el && !el.closest('[hidden]') && el.getClientRects().length > 0; }, sel);
// Open villagers in plan order and their numbers to change, read from the plan's cards.
const openWeights = page => page.evaluate(() => [...document.querySelectorAll('.wp-card')].map(c => ({ id: c.id.slice(3), n: c.querySelectorAll('.pbadge.chg').length, name: c.querySelector('h3').firstChild.textContent })).filter(x => x.n > 0));
const parts = page => page.evaluate(() => [...document.querySelectorAll('#duo .duo-part')].map(p => {
  const b = p.querySelector('[data-duo-pick]');
  return { ids: (p.dataset.ids || '').split(',').filter(Boolean), k: p.querySelector('.duo-k').textContent.trim(), range: p.querySelector('.duo-range').textContent.replace(/\s+/g, ' ').trim(),
    meta: p.querySelector('.duo-meta').textContent.replace(/\s+/g, ' ').trim(), who: (p.querySelector('.duo-who') || { textContent: '' }).textContent.trim(),
    btn: b ? b.textContent.trim() : '', primary: !!b && b.classList.contains('primary'), disabled: !!b && b.disabled };
}));
const E = page => page.evaluate(() => {
  const box = document.getElementById('entry');
  const q = s => box.querySelector(s);
  const shown = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const nm = document.getElementById('entry-name');
  const fin = q('#entry-finale');
  const take = q('[data-e="duo-take"]');
  return {
    open: !box.hidden, name: nm ? nm.textContent : null, wid: (q('.entry-card') || { dataset: {} }).dataset.wid || null,
    count: q('#entry-count').textContent.replace(/\s+/g, ' ').replace(' von / ', ' / '),
    duo: shown(q('#entry-duo')) ? q('#entry-duo').textContent.trim() : '', mate: shown(q('#entry-mate')) ? q('#entry-mate').textContent.trim() : '',
    finale: shown(fin), finaleCls: fin.className, finaleText: fin.textContent.replace(/\s+/g, ' ').trim(), take: shown(take) ? take.textContent.trim() : '',
    ro: shown(q('#entry-ro')), next: q('#entry-next').textContent,
  };
});
async function fertig(page, wait = 450) { await page.click('#entry-next'); await page.waitForTimeout(wait); }
const sum = a => a.reduce((s, x) => s + x, 0);
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);


const L = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/lager-live.json'), 'utf8'));
const STOCK = { k1: { at: Date.now() - 2 * 3600e3, by: 'u_b', pop: 32, vieh: 11, rows: L.rows.map(r => ({ name: r.name, category: r.category, lager: r.lager, reserviert: r.reserviert, unterwegs: r.unterwegs, group: r.group || '' })) } };
const OV = page => page.evaluate(() => {
  const shown = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const q = s => document.querySelector(s), t = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const img = q('#panel-uebersicht .ov-img');
  return {
    panel: shown(q('#panel-uebersicht')), plan: shown(q('#panel-plan')), sel: (q('.tablist [aria-selected="true"]') || {}).id, hash: location.hash,
    tabs: [...document.querySelectorAll('.tablist [role="tab"]')].map(b => b.id),
    title: t(q('#ov-title')), tag: t(q('#ov-tag')), img: !!img && img.complete && img.naturalWidth > 0, imgW: img ? img.naturalWidth : 0,
    tiles: Object.fromEntries([...document.querySelectorAll('#ov-tiles .ov-tile')].filter(shown).map(e => [e.dataset.tile, { v: t(e.querySelector('b')), l: t(e.querySelector('small')), cls: e.className }])),
    entry: t(q('#ov-entry-text')), go: shown(q('#ov-entry-go')), duoGo: shown(q('#ov-duo-go')),
    duo: shown(q('#ov-duo')) ? [...document.querySelectorAll('#ov-duo .ov-duo-row')].map(t) : null,
    notes: [...document.querySelectorAll('#ov-notes .ov-note')].filter(shown).map(e => ({ k: e.dataset.note, text: t(e.querySelector('.ov-note-t')), btn: t(e.querySelector('button')) })), none: shown(q('#ov-notes .ov-none')),
    start: shown(q('#ov-start')), active: document.activeElement && document.activeElement.id,
  };
});

(async () => {
  const browser = await chromium.launch();

  // ===== 1) The start tab of a real team: picture, tiles, the ways into entering =====
  await section('start tab', async () => {
    const srv = makeServer(seedAll());
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: gabriel });
    const P = A.page;
    await until(async () => (await OV(P)).entry !== '');
    let o = await OV(P);
    check('no tab in the address: the Übersicht opens, the address stays clean', o.panel && !o.plan && o.sel === 'tab-uebersicht' && o.hash === '', o);
    check('six tabs: Übersicht first, then as before', JSON.stringify(o.tabs) === '["tab-uebersicht","tab-plan","tab-arbeiter","tab-lager","tab-jobs","tab-wissen"]', o.tabs);
    const fit = await P.evaluate(() => { const l = document.querySelector('.tablist'); return { sw: l.scrollWidth, cw: l.clientWidth, h: Math.min(...[...l.children].map(b => b.getBoundingClientRect().height)) }; });
    check('390: six tabs fit the bottom bar, each at least 44 px tall', fit.sw <= fit.cw + 1 && fit.h >= 44, fit);
    check('the title picture: "Euer Dorf", the phase, a real picture (at least 1200 px wide)', o.title === 'Euer Dorf' && /^Phase: \S/.test(o.tag) && o.img && o.imgW >= 1200, { title: o.title, tag: o.tag, img: o.img, w: o.imgW });
    check('tile "Im Spiel eingetragen": 0 / 10', o.tiles.done && o.tiles.done.v === `0 / ${NAMES.length}` && o.tiles.done.l === 'Im Spiel eingetragen', o.tiles);
    check('tile "Lager": never checked', o.tiles.lager && o.tiles.lager.v === 'nicht geprüft', o.tiles);
    check('tile "Im Spiel falsch": nothing', o.tiles.mm && o.tiles.mm.v === 'nichts', o.tiles);
    check('tile "Werte": up to date', o.tiles.werte && o.tiles.werte.v === 'aktuell', o.tiles);
    check('"Ins Spiel eintragen": 10 Bewohner haben neue Zahlen, both buttons', o.entry === `${NAMES.length} Bewohner haben neue Zahlen` && o.go && o.duoGo, o);
    check('no Hinweise yet', o.none && o.notes.length === 0, o);
    await P.screenshot({ path: path.join(SHOTS, 'uebersicht-390.png'), fullPage: true });
    // The Eintragen-Modus opens from here; one villager entered moves the numbers.
    await P.click('#ov-entry-go'); await P.waitForTimeout(350);
    check('"Im Spiel eintragen" opens the Eintragen-Modus', (await E(P)).open, await E(P));
    await fertig(P);
    await P.keyboard.press('Escape'); await P.waitForTimeout(250);
    o = await OV(P);
    check('closed: back on the Übersicht, focus on its button', o.panel && o.active === 'ov-entry-go', o);
    check('one entered: tile 1 / 10, "9 Bewohner haben neue Zahlen"', o.tiles.done.v === `1 / ${NAMES.length}` && o.entry === `${NAMES.length - 1} Bewohner haben neue Zahlen`, o);
    // Zu zweit: the button leads to the chooser on the Plan tab; a split then shows its progress here.
    await P.click('#ov-duo-go'); await P.waitForTimeout(300);
    check('"Zu zweit eintragen" opens the Plan tab with the chooser', (await OV(P)).plan && await vis(P, '#duo'), await OV(P));
    await P.click('[data-duo-pick="0"]'); await P.waitForTimeout(350);
    await fertig(P);
    await P.keyboard.press('Escape'); await P.waitForTimeout(250);
    await P.click('#tab-uebersicht'); await P.waitForTimeout(250);
    o = await OV(P);
    check('a split is running: "Zu zweit" shows both parts with their progress', o.duo && o.duo.length === 2 && /^Teil 1 · Du 1 \/ \d+$/.test(o.duo[0]) && /^Teil 2 0 \/ \d+$/.test(o.duo[1]), o.duo);
    check('the tab can be reached by its address too', await (async () => { await P.evaluate(() => { location.hash = '#lager'; }); await P.waitForTimeout(200); const a = await vis(P, '#panel-lager'); await P.evaluate(() => { location.hash = '#uebersicht'; }); await P.waitForTimeout(200); return a && (await OV(P)).panel; })());
    await A.ctx.close();
  });

  // ===== 2) Hinweise: Lager knapp and old values, each with its way =====
  await section('hints', async () => {
    const old = Date.now() - 9 * 864e5;
    const srv = makeServer({ ...seedAll(), stock: STOCK, stamps: { w_agnes: { at: old, by: '' }, w_bertram: { at: old, by: '' }, ...Object.fromEntries(NAMES.slice(2).map(n => ['w_' + n.toLowerCase(), { at: Date.now(), by: '' }])) } });
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: gabriel });
    const P = A.page;
    await until(async () => (await OV(P)).notes.length >= 2);
    let o = await OV(P);
    const kn = await P.evaluate(() => document.getElementById('stock-line-go').textContent);
    check('tile "Lager": n knapp (marked)', /^\d+ knapp$/.test(o.tiles.lager.v) && /\bwarn\b/.test(o.tiles.lager.cls), o.tiles.lager);
    const nl = o.notes.find(n => n.k === 'lager');
    check('Hinweis Lager: the same items as the Plan line, "Vorschläge ansehen"', nl && kn.startsWith(nl.text) && / knapp$/.test(nl.text) && nl.btn === 'Vorschläge ansehen', { nl, kn });
    check('tile "Werte": 2 veraltet', o.tiles.werte.v === '2 veraltet' && /\bwarn\b/.test(o.tiles.werte.cls), o.tiles.werte);
    const nw = o.notes.find(n => n.k === 'werte');
    check('Hinweis Werte: "Die Werte von 2 Bewohnern sind über eine Woche alt", "Nachschauen"', nw && nw.text === 'Die Werte von 2 Bewohnern sind über eine Woche alt' && nw.btn === 'Nachschauen', nw);
    check('with Hinweise there is no "Keine Hinweise"', !o.none);
    await P.click('#ov-notes [data-note="lager"] button'); await P.waitForTimeout(250);
    check('"Vorschläge ansehen" opens the Lager tab', await vis(P, '#panel-lager'));
    await P.click('#tab-uebersicht'); await P.waitForTimeout(200);
    await P.click('#ov-notes [data-note="werte"] button'); await P.waitForTimeout(250);
    check('"Nachschauen" opens the Arbeiter tab', await vis(P, '#panel-arbeiter'));
    await P.click('#tab-uebersicht'); await P.waitForTimeout(200);
    await P.click('#ov-tiles [data-tile="done"]'); await P.waitForTimeout(250);
    check('a tile is a way too: "Im Spiel eingetragen" opens the Plan', (await OV(P)).plan);
    await A.ctx.close();
  });

  // ===== 3) No team yet, other start addresses, the viewer =====
  await section('edges', async () => {
    const srv0 = makeServer({});
    const N = await phone(browser, srv0, { name: 'N', inClaude: true, writable: true, user: gabriel });
    await until(() => vis(N.page, '#ov-start'));
    let o = await OV(N.page);
    check('no villagers yet: the picture, a start box with the way to the Arbeiter tab, no tiles', o.panel && o.start && Object.keys(o.tiles).length === 0 && !o.go, o);
    await N.page.click('#ov-start [data-goto="arbeiter"]'); await N.page.waitForTimeout(200);
    check('the start box leads to the Arbeiter tab', await vis(N.page, '#panel-arbeiter'));
    await N.ctx.close();
    const srv = makeServer(seedAll());
    const Pl = await phone(browser, srv, { name: 'P', inClaude: true, writable: true, user: gabriel }, { hash: '#plan' });
    check('"#plan" opens the Plan as before', (await OV(Pl.page)).plan && (await OV(Pl.page)).sel === 'tab-plan');
    await Pl.ctx.close();
    const X = await phone(browser, srv, { name: 'X', inClaude: true, writable: true, user: gabriel }, { hash: '#gibtsnicht' });
    check('an unknown address opens the Übersicht', (await OV(X.page)).panel);
    await X.ctx.close();
    const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, user: ida });
    await until(async () => (await OV(C.page)).entry !== '');
    o = await OV(C.page);
    check('viewer: sees the numbers; the way into the mode stays (it only shows there)', o.tiles.done && o.go, o);
    check('viewer: nothing written', srv.log.every(x => x.who !== 'C'), srv.log);
    await C.ctx.close();
  });

  // ===== 4) Layout and motion =====
  for (const [width, height] of [[360, 740], [820, 1100], [1280, 900]]) {
    await section(`layout ${width}`, async () => {
      const srv = makeServer({ ...seedAll(), stock: STOCK });
      const A = await phone(browser, srv, { name: 'A' + width, inClaude: true, writable: true, user: gabriel, anim: 'voll' }, { width, height });
      await until(async () => (await OV(A.page)).notes.length >= 1);
      await A.page.waitForTimeout(500);
      check(`${width}: no horizontal scroll`, await noOverflow(A.page));
      const g = await A.page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); const m = r('.ov-main'), sd = r('.ov-side'), nav = document.querySelector('.tabs'); return { beside: sd.left >= m.right - 1, below: sd.top >= m.bottom - 1, navPos: getComputedStyle(nav).position, tiles: [...document.querySelectorAll('.ov-tile')].map(e => Math.round(e.getBoundingClientRect().height)), btn: Math.min(...[...document.querySelectorAll('#panel-uebersicht button')].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect().height)) }; });
      if (width >= 1100) check(`${width}: boxes beside the picture, navigation on the left`, g.beside && g.navPos === 'sticky', g);
      else check(`${width}: boxes below the picture, navigation fixed at the bottom`, (width >= 900 ? g.beside : g.below) && g.navPos === 'fixed', g);
      if (width < 900) check(`${width}: every button at least 44 px tall`, g.btn >= 43.5, g);
      await A.page.screenshot({ path: path.join(SHOTS, `uebersicht-${width}.png`) });
      await A.ctx.close();
    });
  }
  await section('motion', async () => {
    for (const anim of ['voll', 'ruhig', 'aus']) {
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'M' + anim, inClaude: true, writable: true, user: gabriel, anim });
      await until(async () => (await OV(A.page)).entry !== '');
      const r = await A.page.evaluate(() => {
        const els = [...document.querySelectorAll('#panel-uebersicht, #panel-uebersicht *')];
        const loops = els.filter(el => [getComputedStyle(el), getComputedStyle(el, '::before'), getComputedStyle(el, '::after')].some(c => c.animationName !== 'none' && c.animationIterationCount === 'infinite')).map(el => el.className);
        const tr = els.map(el => getComputedStyle(el).transitionProperty).filter(p => p && p !== 'all' && p !== 'none' && !/^(opacity|transform|background-color|border-color|color|box-shadow|filter)(, (opacity|transform|background-color|border-color|color|box-shadow|filter))*$/.test(p));
        return { loops, tr };
      });
      check(`${anim}: nothing on the Übersicht moves forever, no layout transitions`, r.loops.length === 0 && r.tr.length === 0, r);
      await A.ctx.close();
    }
  });

  await browser.close();
  for (const n of notes) console.log('note:', n);
  if (errs.length) { console.log('page errors:'); for (const e of [...new Set(errs)].slice(0, 20)) console.log('  ' + e); }
  console.log(`\nfeat-uebersicht: ${passes} passed, ${fails.length} failed`);
  for (const f of fails) console.log('FAIL ' + f);
  process.exit(fails.length || errs.length ? 1 : 0);
})();

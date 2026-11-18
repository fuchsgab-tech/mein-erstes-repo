// BUILD 19 "Zu zweit eintragen": two players transfer the plan into the game at the same time, each from their own
// phone at their own Xbox. "Zu zweit eintragen" splits the villagers with open numbers into two blocks in the plan's
// (= the game's) order, balanced by the numbers to change; each phone picks "Ich mache Teil 1/2" and gets the usual
// Eintragen-Modus with only that part. The split lives in the new collection 'duo' (doc 'current': {at, by, a, b,
// whoA, whoB}) so both phones see the same parts and who took which. The mode shows the partner's progress; whoever is
// done first can take over the last open villagers of the other part (from its end); the big finale comes once both
// parts are entered. Phones are browser contexts sharing one fake server in node (as feat-mismatch.js).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../bellwright-arbeitsplan.html');
const SHOTS = path.resolve(__dirname, '../shots-duo');
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
async function phone(browser, srv, cfg, { width = 390, height = 844, hash = '#plan', reduced = false } = {}) {
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

(async () => {
  const browser = await chromium.launch();

  // ===== 1) Two phones: split, pick, live progress, take-over, finale for both =====
  await section('two phones', async () => {
    const srv = makeServer(seedAll());
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: gabriel });
    const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: lena });
    const PA = A.page, PB = B.page;
    await until(async () => (await openWeights(PA)).length > 0);
    const ow = await openWeights(PA);
    check('setup: every villager has open numbers', ow.length === NAMES.length, ow);
    check('banner: "Zu zweit eintragen" next to "Jetzt im Spiel eintragen"', await vis(PA, '#entry-banner #duo-open') && (await PA.textContent('#duo-open')).trim() === 'Zu zweit eintragen');
    check('the grid-head button waits while the banner shows', !(await vis(PA, '#duo-open-head')));
    check('chooser closed at first', !(await vis(PA, '#duo')));
    await PA.click('#duo-open'); await PA.waitForTimeout(150);
    check('chooser opens, focus on its heading', await vis(PA, '#duo') && await PA.evaluate(() => document.activeElement && document.activeElement.id === 'duo-title'));
    const pa = await parts(PA);
    check('two parts', pa.length === 2, pa);
    check('setup: Cilli comes last in the app (joined late)', ow[ow.length - 1].name === 'Cilli', ow.map(x => x.name));
    const game = ow.slice().sort((x, y) => x.name.localeCompare(y.name, 'de'));   // the game's list: by name
    const order = game.map(x => x.id), w = game.map(x => x.n), tot = sum(w);
    const all = [...pa[0].ids, ...pa[1].ids];
    check('the parts are the open villagers in the game\'s order (by name), part 1 first, nobody twice', JSON.stringify(all) === JSON.stringify(order), { all, order });
    const c = pa[0].ids.length;
    const best = Math.min(...Array.from({ length: order.length - 1 }, (_, i) => Math.abs(2 * sum(w.slice(0, i + 1)) - tot)));
    check('balanced by the numbers to change (the best cut there is)', c > 0 && c < order.length && Math.abs(2 * sum(w.slice(0, c)) - tot) === best, { c, w, best });
    const nm = id => ow.find(x => x.id === id).name;
    check('part 1 reads "Teil 1", "first bis last", "n Bewohner · m Zahlen"', pa[0].k === 'Teil 1' && pa[0].range === `${nm(pa[0].ids[0])} bis ${nm(pa[0].ids[c - 1])}` && pa[0].meta === `${c} Bewohner · ${sum(w.slice(0, c))} Zahlen`, pa[0]);
    check('part 2 likewise', pa[1].k === 'Teil 2' && pa[1].range === `${nm(pa[1].ids[0])} bis ${nm(pa[1].ids[pa[1].ids.length - 1])}` && pa[1].meta === `${pa[1].ids.length} Bewohner · ${sum(w.slice(c))} Zahlen`, pa[1]);
    check('buttons "Ich mache Teil 1/2", nobody claimed yet', pa[0].btn === 'Ich mache Teil 1' && pa[1].btn === 'Ich mache Teil 2' && !pa[0].who && !pa[1].who, pa);
    check('nothing saved before a pick', srv.duo() === null);
    await PB.click('#duo-open'); await PB.waitForTimeout(150);
    const pb0 = await parts(PB);
    check('the other phone shows the same split', JSON.stringify(pb0.map(p => p.ids)) === JSON.stringify(pa.map(p => p.ids)), pb0);
    await PA.screenshot({ path: path.join(SHOTS, 'duo-390-chooser.png'), fullPage: false });

    // A takes part 1.
    await PA.click('[data-duo-pick="0"]'); await PA.waitForTimeout(350);
    let ea = await E(PA);
    check('A: the mode opens with part 1 only, on its first villager', ea.open && ea.wid === pa[0].ids[0] && ea.count === `1 / ${c}`, ea);
    check('A: "Teil 1" in the top line', ea.duo === 'Teil 1', ea);
    await until(() => srv.duo() !== null);
    const d1 = srv.duo();
    check('the split is saved for both: duo/current {at, by, a, b, whoA, whoB}', d1 && JSON.stringify(d1.a) === JSON.stringify(pa[0].ids) && JSON.stringify(d1.b) === JSON.stringify(pa[1].ids) && d1.whoA === 'u_a' && d1.whoB === '' && d1.by === 'u_a' && d1.at > 0, d1);
    check('A: partner pill for the free part: "Teil 2: 0 von n fertig"', ea.mate === `Teil 2: 0 von ${pa[1].ids.length} fertig`, ea);
    await until(async () => (await parts(PB))[0].who !== '');
    const pb1 = await parts(PB);
    check('B: part 1 shows who has it, part 2 is the suggestion', pb1[0].who === 'Macht gerade: Gabriel' && !pb1[0].primary && pb1[1].primary, pb1);
    await PB.click('[data-duo-pick="1"]'); await PB.waitForTimeout(350);
    let eb = await E(PB);
    check('B: the mode opens with part 2 only', eb.open && eb.wid === pa[1].ids[0] && eb.count === `1 / ${pa[1].ids.length}` && eb.duo === 'Teil 2', eb);
    await until(() => srv.duo().whoB === 'u_b');
    check('B\'s pick is saved, A\'s claim stays', srv.duo().whoA === 'u_a' && srv.duo().whoB === 'u_b' && srv.duo().at === d1.at);
    check('B: partner pill "Gabriel: 0 von n fertig"', eb.mate === `Gabriel: 0 von ${c} fertig`, eb);
    await until(async () => (await E(PA)).mate.startsWith('Lena'));
    check('A: the pill now names Lena', (await E(PA)).mate === `Lena: 0 von ${pa[1].ids.length} fertig`, await E(PA));
    await PB.screenshot({ path: path.join(SHOTS, 'duo-390-entry.png') });

    // Live progress both ways.
    await fertig(PA);
    await until(async () => (await E(PB)).mate === `Gabriel: 1 von ${c} fertig`);
    check('B sees A\'s tick at once', (await E(PB)).mate === `Gabriel: 1 von ${c} fertig`, await E(PB));
    await fertig(PB);
    eb = await E(PB);
    check('B moves on in part 2 only', eb.wid === pa[1].ids[1] && eb.count === `2 / ${pa[1].ids.length}`, eb);

    // B reloads in the middle: the resume banner brings part 2 back with the partner pill.
    const PB2 = await nextVisit(B.ctx, PB, [ENTRY_KEY], srv, { name: 'B', inClaude: true, writable: true, user: lena });
    await PB.close();
    await until(() => vis(PB2, '#entry-resume'));
    check('B after a reload: "Weitermachen bei …" (2/n)', await vis(PB2, '#entry-resume') && (await PB2.textContent('#entry-resume-text')).includes(`(2/${pa[1].ids.length})`), await PB2.textContent('#entry-resume-text'));
    await PB2.click('#entry-resume-go'); await PB2.waitForTimeout(300);
    eb = await E(PB2);
    check('B resumed: part 2, the partner pill is back', eb.open && eb.wid === pa[1].ids[1] && eb.duo === 'Teil 2' && eb.mate === `Gabriel: 1 von ${c} fertig`, eb);

    // A finishes part 1: the part finale with the partner's progress and the take-over.
    for (let i = 1; i < c; i++) await fertig(PA);
    ea = await E(PA);
    const openB = pa[1].ids.length - 1, k = Math.floor(openB / 2);
    check('A: "Dein Teil ist fertig." (no big finale while part 2 is open)', ea.finale && ea.finaleCls.includes('fin-part') && ea.finaleText.includes('Dein Teil ist fertig.') && ea.finaleText.includes(`Lena: 1 von ${pa[1].ids.length} eingetragen`), ea);
    check(`A: take-over button for the last ${k}`, ea.take === (k === 1 ? 'Den letzten übernehmen' : `Die letzten ${k} übernehmen`), ea);
    await PA.screenshot({ path: path.join(SHOTS, 'duo-390-part-done.png') });
    await PA.click('[data-e="duo-take"]'); await PA.waitForTimeout(350);
    const taken = pa[1].ids.slice(pa[1].ids.length - k);
    ea = await E(PA);
    check('A: goes on with the first taken villager', ea.open && !ea.finale && ea.wid === taken[0] && ea.count === `${c + 1} / ${c + k}`, ea);
    await until(() => srv.duo().a.length === c + k);
    const d2 = srv.duo();
    check('the take-over is saved: moved from b to a', JSON.stringify(d2.a) === JSON.stringify([...pa[0].ids, ...taken]) && JSON.stringify(d2.b) === JSON.stringify(pa[1].ids.slice(0, pa[1].ids.length - k)) && d2.whoA === 'u_a' && d2.whoB === 'u_b' && d2.at === d1.at, d2);
    await until(async () => (await E(PB2)).count === `2 / ${pa[1].ids.length - k}`);
    eb = await E(PB2);
    check('B: the taken villagers leave B\'s queue', eb.count === `2 / ${pa[1].ids.length - k}` && eb.wid === pa[1].ids[1], eb);
    check('B: the pill counts A\'s bigger part', eb.mate === `Gabriel: ${c} von ${c + k} fertig`, eb);

    // B finishes what is left; A finishes the taken ones; both get the big finale.
    for (let i = 1; i < pa[1].ids.length - k; i++) await fertig(PB2);
    eb = await E(PB2);
    check('B: part done while A still works: part finale', eb.finale && eb.finaleCls.includes('fin-part') && eb.finaleText.includes('Dein Teil ist fertig.'), eb);
    for (let i = 0; i < k; i++) await fertig(PA);
    ea = await E(PA);
    check('A: everything entered: the big finale "Alle n eingetragen."', ea.finale && ea.finaleCls.includes('fin-all') && ea.finaleText.includes(`Alle ${NAMES.length} eingetragen.`), ea);
    await until(async () => (await E(PB2)).finaleCls.includes('fin-all'));
    eb = await E(PB2);
    check('B: the big finale comes by itself once A is done', eb.finaleCls.includes('fin-all') && eb.finaleText.includes(`Alle ${NAMES.length} eingetragen.`), eb);
    await PA.click('#entry-next'); await PA.waitForTimeout(250);
    check('A: closed, nothing open: no "Zu zweit" button any more', !(await E(PA)).open && !(await vis(PA, '#duo-open')) && !(await vis(PA, '#duo-open-head')) && !(await vis(PA, '#duo')));
    await A.ctx.close(); await B.ctx.close();
  });

  // ===== 2) "Neu aufteilen", the read-only viewer, the grid-head button =====
  await section('re-split and viewer', async () => {
    const srv = makeServer(seedAll());
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: gabriel });
    const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, user: ida });
    const PA = A.page, PC = C.page;
    await until(() => vis(PA, '#duo-open'));
    await PA.click('#duo-open'); await PA.click('[data-duo-pick="0"]'); await PA.waitForTimeout(300);
    await until(() => srv.duo() !== null);
    const at0 = srv.duo().at;
    // The viewer sees the saved split and can open a part to look, never writes.
    await until(() => vis(PC, '#duo-open'));
    await PC.click('#duo-open'); await PC.waitForTimeout(150);
    const pc = await parts(PC);
    check('viewer: the saved split with Gabriel on part 1', pc.length === 2 && pc[0].who === 'Macht gerade: Gabriel', pc);
    check('viewer: no "Neu aufteilen"', !(await vis(PC, '#duo-new')));
    const before = srv.log.length;
    await PC.click('[data-duo-pick="1"]'); await PC.waitForTimeout(300);
    const ec = await E(PC);
    check('viewer: part 2 opens read-only', ec.open && ec.ro && ec.duo === 'Teil 2' && ec.wid === pc[1].ids[0], ec);
    check('viewer: nothing written', srv.log.slice(before).every(x => x.who !== 'C'), srv.log.slice(before));
    await PC.keyboard.press('Escape'); await PC.waitForTimeout(150);
    // A second writer re-splits: new 'at', no claims; A's pill goes (that split is gone).
    const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: lena });
    const PB = B.page;
    await until(() => vis(PB, '#duo-open'));
    await PB.click('#duo-open'); await PB.waitForTimeout(150);
    check('writer: "Neu aufteilen" while a split is saved', await vis(PB, '#duo-new'));
    await PB.click('#duo-new'); await PB.waitForTimeout(150);
    await until(() => srv.duo().at !== at0);
    const d = srv.duo();
    check('"Neu aufteilen": a new split, nobody on it', d.at !== at0 && d.whoA === '' && d.whoB === '', d);
    await until(async () => (await E(PA)).mate === '');
    check('A: the partner pill goes with the old split', (await E(PA)).mate === '', await E(PA));
    const pbn = await parts(PB);
    check('B: the chooser shows the new split without names', pbn.every(p => !p.who), pbn);
    await PB.click('#duo-x'); await PB.waitForTimeout(100);
    check('"Schließen" closes the chooser, focus back on the opener', !(await vis(PB, '#duo')) && await PB.evaluate(() => document.activeElement && document.activeElement.id === 'duo-open'));
    // "Später" hides the banner: the grid-head button is the way in.
    await PB.click('#entry-banner-later'); await PB.waitForTimeout(150);
    check('banner hidden ("Später"): "Zu zweit" next to the title button', await vis(PB, '#duo-open-head') && (await PB.textContent('#duo-open-head')).trim() === 'Zu zweit eintragen');
    await PB.click('#duo-open-head'); await PB.waitForTimeout(250);
    check('the grid-head button opens the chooser in view', await vis(PB, '#duo') && await PB.evaluate(() => { const r = document.getElementById('duo').getBoundingClientRect(); return r.top >= -2 && r.top < innerHeight; }));
    await A.ctx.close(); await B.ctx.close(); await C.ctx.close();
  });

  // ===== 3) Local mode: one device keeps its own ticks, so there is nothing to share =====
  await section('local mode', async () => {
    const workers = Object.entries(SEED_W).map(([id, w]) => ({ id, ...w }));
    const L = await phone(browser, null, { name: 'L', inClaude: false, seedLs: { [LS_KEY]: { workers } } });
    await until(() => vis(L.page, '#entry-banner'));
    check('local mode: entry banner yes, "Zu zweit" no', await vis(L.page, '#entry-banner') && !(await vis(L.page, '#duo-open')) && !(await vis(L.page, '#duo-open-head')));
    await L.ctx.close();
  });

  // ===== 4) Layout and motion =====
  for (const [width, height] of [[360, 740], [390, 844], [1280, 900]]) {
    await section(`layout ${width}`, async () => {
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'A' + width, inClaude: true, writable: true, user: gabriel, anim: 'voll' }, { width, height });
      const PA = A.page;
      await until(() => vis(PA, '#duo-open'));
      check(`${width}: banner without horizontal scroll`, await noOverflow(PA));
      await PA.click('#duo-open'); await PA.waitForTimeout(400);
      check(`${width}: chooser without horizontal scroll`, await noOverflow(PA));
      const g = await PA.evaluate(() => [...document.querySelectorAll('#duo button, #entry-banner button')].filter(b => b.getClientRects().length).map(b => ({ id: b.id || b.dataset.duoPick, h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width })));
      if (width < 900) check(`${width}: every button at least 44 px tall`, g.every(b => b.h >= 43.5), g);
      await PA.screenshot({ path: path.join(SHOTS, `duo-${width}-chooser.png`) });
      await PA.click('[data-duo-pick="1"]'); await PA.waitForTimeout(700);
      check(`${width}: the mode shows "Teil 2" and the pill without overflow`, (await E(PA)).duo === 'Teil 2' && (await E(PA)).mate !== '' && await PA.evaluate(() => { const e = document.getElementById('entry'); return e.scrollWidth <= e.clientWidth + 1; }));
      await PA.screenshot({ path: path.join(SHOTS, `duo-${width}-entry.png`) });
      await A.ctx.close();
    });
  }
  await section('motion', async () => {
    for (const [anim, want] of [['voll', /rise/], ['ruhig', /calmIn/], ['aus', /^none$/]]) {
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'M' + anim, inClaude: true, writable: true, user: gabriel, anim });
      await until(() => vis(A.page, '#duo-open'));
      await A.page.click('#duo-open');
      const name = await A.page.evaluate(() => getComputedStyle(document.getElementById('duo')).animationName);
      check(`${anim}: the chooser comes in with ${want}`, want.test(name), name);
      const tr = await A.page.evaluate(() => [...document.querySelectorAll('#duo, #duo *')].map(el => getComputedStyle(el).transitionProperty).filter(p => p && p !== 'all' && p !== 'none' && !/^(opacity|transform|background-color|border-color|color|box-shadow)(, (opacity|transform|background-color|border-color|color|box-shadow))*$/.test(p)));
      check(`${anim}: no layout transitions in the chooser`, tr.length === 0, tr);
      await A.ctx.close();
    }
    const srv = makeServer(seedAll());
    const R = await phone(browser, srv, { name: 'RM', inClaude: true, writable: true, user: gabriel, anim: null }, { reduced: true });   // no choice made: reduced motion means "aus"
    await until(() => vis(R.page, '#duo-open'));
    await R.page.click('#duo-open');
    const rn = await R.page.evaluate(() => ({ name: getComputedStyle(document.getElementById('duo')).animationName, anim: document.documentElement.dataset.anim }));
    check('reduced motion (no choice made): "aus", the chooser does not move', rn.anim === 'aus' && rn.name === 'none', rn);
    await R.ctx.close();
  });

  await browser.close();
  for (const n of notes) console.log('note:', n);
  if (errs.length) { console.log('page errors:'); for (const e of [...new Set(errs)].slice(0, 20)) console.log('  ' + e); }
  console.log(`\n${passes} passed, ${fails.length} failed`);
  for (const f of fails) console.log('FAIL ' + f);
  process.exit(fails.length || errs.length ? 1 : 0);
})();

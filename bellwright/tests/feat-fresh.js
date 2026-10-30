// BUILD 14 "Werte aktuell halten":
//  - "+1" next to each skill's Stufe in the Arbeiter editor (>= 44 px on touch, disabled read-only and at MAXV):
//    Stufe + 1, Max raised to it if needed (never lowered, an unknown Max stays unknown), saved like any edit;
//  - freshness in the NEW collection 'stamps' (doc id = worker id, {at, by}; worker docs keep their fields), written
//    when stats change through the editor, +1, text or photo import (and "Stimmen noch" on an old card), deleted with
//    the worker and restored by its Rückgängig; local mode keeps them in the LS payload; a worker without a stamp counts
//    from the time this device first saw it (localStorage map), so old data needs no writes;
//  - each card says "Werte von heute / gestern / vor n Tagen"; a Plan hint for values older than a week
//    ("Werte prüfen" = Arbeiter tab oldest first + chip "Älteste zuerst", "Später" = 3 days), never for the example team,
//    without workers, for viewers who cannot edit, or while the stamps are still loading.
const { chromium } = require('playwright');
const path = require('path');

const SHOTS = path.resolve(__dirname, '../shots-r3');
const LS_KEY = 'bellwright-arbeitsplan-v1';
const SEEN_KEY = 'bellwright-gesehen-v1';
const LATER_KEY = 'bellwright-werte-spaeter-v1';
const ANIM_KEY = 'bellwright-anim-v1';
const NOW = Date.now(), DAY = 864e5;
const st = o => Object.fromEntries(Object.entries(o).map(([k, [cur, max]]) => [k, { cur, max }]));
const SEED_W = {
  w_agnes: { name: 'Agnes', role: 'worker', traits: 'Optimist', order: 1, stats: st({ labourer: [3, 5], harvesting: [6, 9], farming: [2, 4], cooking: [1, 3], crafting: [2, 6], researching: [0, 2], hunting: [5, 8] }) },
  w_bertram: { name: 'Bertram', role: 'worker', traits: 'Resilient', order: 2, stats: st({ labourer: [7, 9], harvesting: [4, 6], farming: [1, 3], cooking: [2, 4], crafting: [3, 5], researching: [1, 3], hunting: [2, 4] }) },
  w_edda: { name: 'Edda', role: 'worker', traits: '', order: 3, stats: st({ labourer: [2, 4], harvesting: [1, 3], farming: [3, 6], cooking: [8, 10], crafting: [2, 4], researching: [3, 5], hunting: [0, 2] }) },
  w_godric: { name: 'Godric', role: 'worker', traits: 'Prodigy', order: 4, stats: st({ labourer: [3, 6], harvesting: [3, 5], farming: [2, 4], cooking: [1, 4], crafting: [6, 10], researching: [4, 7], hunting: [1, 3] }) },
  w_hilde: { name: 'Hilde', role: 'worker', traits: '', order: 5, stats: st({ labourer: [2, 5], harvesting: [2, 5], farming: [7, 9], cooking: [4, 6], crafting: [1, 3], researching: [2, 4], hunting: [3, 6] }) },
};
const STAMPS = { w_agnes: { at: NOW - 12 * DAY, by: 'u_b' }, w_bertram: { at: NOW - 3 * DAY, by: 'u_b' }, w_godric: { at: NOW - 20 * DAY, by: 'u_b' } };
const HINT = n => `Die Werte von ${n} ${n === 1 ? 'Bewohner' : 'Bewohnern'} sind über eine Woche alt. Durch Arbeit werden sie besser – kurz nachschauen?`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));

// ---------- the shared fake server (node side): one map per collection, made on first use ----------
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
    srv.log.push({ who, op, c, id, d: d && clone(d), t: Date.now() });
    setTimeout(() => srv.broadcast(c), 10);
  };
  return srv;
}
// ---------- page side. cfg: { name, inClaude, writable, user, seedLs, delay: {collection: ms} } ----------
function STUB(cfg) {
  if (cfg.seedLs && !sessionStorage.getItem('__seeded')) {
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(cfg.seedLs)) localStorage.setItem(k, JSON.stringify(v));
  }
  const sample = async () => ({ text: '' });
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
  sample.json = async () => { await new Promise(r => setTimeout(r, 80)); return JSON.parse(JSON.stringify(window.__reply || { workers: [] })); };
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
    collection: c => ({ doc: id => docRef(c, id), onSnapshot: n => { list(colL, c).push(n); window.__srvRead(c).then(docs => setTimeout(() => n(snapC(docs)), (cfg.delay || {})[c] || 0)); return () => {}; } }),
    doc: p => { const [c, id] = p.split('/'); return docRef(c, id); },
  });
  const u = cfg.user;
  const user = !u ? null : Object.freeze({
    isOwner: async () => !!u.owner, id: async () => u.id || null, can: async n => (n === 'data.write' ? u.can : false),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : n === 'sample' ? sample : null) };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 700) : '')); };
const errs = [];
async function section(name, fn) { try { await fn(); } catch (e) { check(`${name}: runs to the end`, false, String(e && e.message || e).split('\n')[0]); } }
async function phone(browser, srv, cfg, { width = 390, height = 844, hash = '#arbeiter' } = {}) {
  const mobile = width < 900;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
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
const order = page => page.$$eval('#wlist .wcard', cs => cs.map(c => c.dataset.wid));
const fresh = page => page.$$eval('#wlist .wcard', cs => Object.fromEntries(cs.map(c => { const f = c.querySelector('[data-out="fresh"]'); const b = c.querySelector('[data-act="fresh"]'); return [c.dataset.wid, { t: f && f.firstChild ? f.firstChild.textContent.replace(/\s+/g, ' ').trim() : null, ok: !!b && !b.closest('[hidden]') && b.getClientRects().length > 0 }]; })));
const val = (page, wid, f) => page.$eval(`#${wid}-${f}`, e => e.value);
const up = (page, wid, a) => page.click(`#wlist [data-wid="${wid}"] [data-up="${a}"]`);
const hint = page => page.evaluate(() => {
  const h = document.getElementById('fresh-hint');
  const vis = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  return { exists: !!h, shown: vis(h), text: h ? (document.getElementById('fresh-hint-text') || h).textContent.replace(/\s+/g, ' ').trim() : '',
    check: (document.getElementById('fresh-check') || {}).textContent, later: (document.getElementById('fresh-later') || {}).textContent };
});
const chip = page => page.evaluate(() => { const c = document.getElementById('sort-old'); return c ? { shown: !c.closest('[hidden]') && c.getClientRects().length > 0, text: c.textContent.replace(/\s+/g, ' ').trim(), pressed: c.getAttribute('aria-pressed') } : null; });
const sameKeys = (o, keys) => !!o && Object.keys(o).sort().join() === [...keys].sort().join();

(async () => {
  const browser = await chromium.launch();
  try {
    // ===== 1) Shared list: freshness lines, the Plan hint, "Werte prüfen", +1, "Stimmen noch", live, delete/undo, read-only =====
    await section('1) shared', async () => {
      const srv = makeServer({ workers: SEED_W, stamps: STAMPS });
      const seedLs = { [SEEN_KEY]: { w_hilde: NOW - 9 * DAY } };
      const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: owner, seedLs }, { hash: '#plan' });
      const P = A.page;
      let h = await hint(P);
      check('Plan hint: values of 3 villagers older than a week (12 d, 20 d, first seen 9 d ago)', h.shown && h.text === HINT(3), h);
      check('Plan hint buttons: "Werte prüfen" and "Später"', h.check === 'Werte prüfen' && h.later === 'Später', h);
      check('no stamp writes for old data (opening wrote nothing)', !srv.log.some(l => l.c === 'stamps'), srv.log);
      await P.screenshot({ path: path.join(SHOTS, 'fresh-390-hint.png') });
      await P.click('#fresh-check'); await P.waitForTimeout(300);
      const tab = await P.evaluate(() => document.getElementById('tab-arbeiter').getAttribute('aria-selected'));
      check('"Werte prüfen" opens the Arbeiter tab, oldest values first', tab === 'true' && JSON.stringify(await order(P)) === JSON.stringify(['w_godric', 'w_agnes', 'w_hilde', 'w_bertram', 'w_edda']), { tab, order: await order(P) });
      let c = await chip(P);
      check('chip "Älteste zuerst" (pressed) to switch back', c && c.shown && c.text.startsWith('Älteste zuerst') && c.pressed === 'true', c);
      let f = await fresh(P);
      check('cards: "Werte von vor 20 Tagen / vor 12 Tagen / vor 9 Tagen / vor 3 Tagen / heute"', f.w_godric.t === 'Werte von vor 20 Tagen' && f.w_agnes.t === 'Werte von vor 12 Tagen' && f.w_hilde.t === 'Werte von vor 9 Tagen' && f.w_bertram.t === 'Werte von vor 3 Tagen' && f.w_edda.t === 'Werte von heute', f);
      check('"Stimmen noch" only on values older than a week', f.w_godric.ok && f.w_agnes.ok && f.w_hilde.ok && !f.w_bertram.ok && !f.w_edda.ok, f);
      // +1 on Godric's Kochen (1/4): 2/4, saved, stamp {at, by}, the worker doc keeps its fields; the order stays.
      await up(P, 'w_godric', 'cooking');
      check('+1: Stufe 1 -> 2 at once, Max 4 kept', (await val(P, 'w_godric', 'cur-cooking')) === '2' && (await val(P, 'w_godric', 'max-cooking')) === '4');
      const saved = await until(() => { const w = srv.col('workers').get('w_godric'); const s = srv.col('stamps').get('w_godric'); return w && w.stats.cooking.cur === 2 && s && s.at > NOW; }, 3000);
      const wdoc = srv.col('workers').get('w_godric'), sdoc = srv.col('stamps').get('w_godric');
      check('+1: saved through the worker save; stamp doc {at, by} in "stamps"', saved >= 0 && sameKeys(sdoc, ['at', 'by']) && sdoc.by === 'u_a' && Math.abs(sdoc.at - Date.now()) < 10e3, { saved, sdoc });
      check('+1: the worker doc gets no new fields', sameKeys(wdoc, ['name', 'role', 'traits', 'order', 'stats']), wdoc && Object.keys(wdoc));
      f = await fresh(P);
      check('+1: the card now says "Werte von heute", no "Stimmen noch"', f.w_godric.t === 'Werte von heute' && !f.w_godric.ok, f.w_godric);
      check('+1: the oldest-first order does not jump while you work', JSON.stringify(await order(P)) === JSON.stringify(['w_godric', 'w_agnes', 'w_hilde', 'w_bertram', 'w_edda']), await order(P));
      // Agnes Kochen 1/3: three taps -> 4/4 (Max raised to the Stufe, never lowered).
      for (let k = 0; k < 3; k++) await up(P, 'w_agnes', 'cooking');
      await P.waitForTimeout(900);
      const ag = srv.col('workers').get('w_agnes').stats.cooking;
      check('+1 three times on 1/3: 4/4 (Max raised to the Stufe)', (await val(P, 'w_agnes', 'cur-cooking')) === '4' && (await val(P, 'w_agnes', 'max-cooking')) === '4' && ag.cur === 4 && ag.max === 4, ag);
      // The chip switches back to the normal order.
      await P.click('#sort-old'); await P.waitForTimeout(150);
      c = await chip(P);
      check('chip: back to the list order, chip not pressed', JSON.stringify(await order(P)) === JSON.stringify(['w_agnes', 'w_bertram', 'w_edda', 'w_godric', 'w_hilde']) && c && c.pressed === 'false', { order: await order(P), c });
      await P.click('#tab-plan'); await P.waitForTimeout(250);
      h = await hint(P);
      check('Plan hint follows: 1 villager left ("von 1 Bewohner")', h.shown && h.text === HINT(1), h);
      // "Stimmen noch" on Hilde (first seen 9 days ago, no stamp): stamp now, the hint is gone.
      await P.click('#tab-arbeiter'); await P.waitForTimeout(150);
      await P.click('#wlist [data-wid="w_hilde"] [data-act="fresh"]');
      const hs = await until(() => { const s = srv.col('stamps').get('w_hilde'); return s && s.at > NOW; }, 3000);
      check('"Stimmen noch": stamp written without touching the values', hs >= 0 && JSON.stringify(srv.col('workers').get('w_hilde').stats) === JSON.stringify(SEED_W.w_hilde.stats) && (await fresh(P)).w_hilde.t === 'Werte von heute', hs);
      await P.click('#tab-plan'); await P.waitForTimeout(250);
      check('no old values left: no hint', !(await hint(P)).shown);
      // Phone B sees Godric fresh (stamp snapshot), and its own typing stamps Bertram.
      const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: { id: 'u_b', owner: false, can: true } });
      check('B: Godric "Werte von heute" from the shared stamp', (await fresh(B.page)).w_godric.t === 'Werte von heute');
      await B.page.fill('#w_bertram-cur-harvesting', '5');
      const bs = await until(() => { const s = srv.col('stamps').get('w_bertram'); return s && s.by === 'u_b' && s.at > NOW; }, 3000);
      check('typing a Stufe in the editor stamps the villager', bs >= 0, srv.col('stamps').get('w_bertram'));
      const bName = srv.log.length;
      await B.page.fill('#w_bertram-name', 'Bertram der Starke'); await B.page.waitForTimeout(900);
      check('typing a name does not stamp (only stats count)', !srv.log.slice(bName).some(l => l.c === 'stamps'), srv.log.slice(bName));
      // Delete Godric: his stamp goes too; Rückgängig brings both back (same at).
      const gAt = srv.col('stamps').get('w_godric').at;
      const del = B.page.locator('#wlist [data-wid="w_godric"] [data-act="del"]');
      await del.click(); await B.page.waitForTimeout(500); await del.click();
      const gone = await until(() => !srv.col('stamps').has('w_godric') && !srv.col('workers').has('w_godric'), 3000);
      check('delete: the stamp is deleted with the worker', gone >= 0);
      await B.page.click('#toast .toast-act');
      const back = await until(() => { const s = srv.col('stamps').get('w_godric'); return !!s && srv.col('workers').has('w_godric'); }, 3000);
      check('Rückgängig: worker and stamp back (same time)', back >= 0 && srv.col('stamps').get('w_godric').at === gAt, srv.col('stamps').get('w_godric'));
      // Read-only viewer: +1 disabled, no "Stimmen noch", no hint.
      const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, user: { id: 'u_c', owner: false, can: false } });
      const ro = await C.page.evaluate(() => ({ ups: [...document.querySelectorAll('#wlist [data-up]')].map(b => b.disabled), ok: document.querySelectorAll('#wlist [data-act="fresh"]:not([hidden])').length }));
      check('read-only: every +1 disabled, no "Stimmen noch"', ro.ups.length === 35 && ro.ups.every(Boolean) && ro.ok === 0, ro);
      await srv.col('stamps').set('w_edda', { at: NOW - 30 * DAY, by: 'u_b' });
      srv.broadcast('stamps');
      await C.page.click('#tab-plan'); await C.page.waitForTimeout(300);
      check('read-only: no "Werte prüfen" hint (they cannot change values)', !(await hint(C.page)).shown);
      check('...but an editor sees it (Edda 30 days)', (await until(async () => (await hint(P)).text === HINT(1), 2000)) >= 0, await hint(P));
      for (const s of [A, B, C]) await s.ctx.close();
    });

    // ===== 2) Text and photo import stamp the villagers they update =====
    await section('2) import', async () => {
      const srv = makeServer({ workers: SEED_W, stamps: STAMPS });
      const A = await phone(browser, srv, { name: 'I', inClaude: true, writable: true, user: owner, seedLs: { 'bellwright-kosten-info-v1': true } });
      const P = A.page;
      await P.click('#toggle-import');
      await P.fill('#import-text', 'Edda: Kochen 9/10');
      await P.click('#do-import'); await P.waitForSelector('#review .rcard');
      await P.click('#review-apply');
      const te = await until(() => { const s = srv.col('stamps').get('w_edda'); return s && s.at > NOW && srv.col('workers').get('w_edda').stats.cooking.cur === 9; }, 3000);
      check('text import: Edda updated and stamped', te >= 0, srv.col('stamps').get('w_edda'));
      await P.evaluate(r => { window.__reply = r; }, { workers: [{ name: 'Hilde', known: 'Hilde', image: 0, role: null, traits: [], stats: { farming: { cur: 8, max: 9, sure: true } }, unsure: '' }] });
      await P.click('#toggle-photo');
      await P.setInputFiles('#photo-file', [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }]);
      await P.click('#photo-read'); await P.waitForSelector('#review .rcard');
      await P.click('#review-apply');
      const ph = await until(() => { const s = srv.col('stamps').get('w_hilde'); return s && s.at > NOW && srv.col('workers').get('w_hilde').stats.farming.cur === 8; }, 3000);
      check('photo import: Hilde updated and stamped', ph >= 0, srv.col('stamps').get('w_hilde'));
      check('imports: Agnes and Godric (not in the import) keep their stamps', srv.col('stamps').get('w_agnes').at === STAMPS.w_agnes.at && srv.col('stamps').get('w_godric').at === STAMPS.w_godric.at);
      await A.ctx.close();
    });

    // ===== 3) Waiting for the stamps; old first-seen data; maxed-out villagers; example team =====
    await section('3) loading', async () => {
      // Fresh stamp on the server, but this device first saw Agnes 10 days ago: no hint before or after the stamps arrive.
      const srv = makeServer({ workers: SEED_W, stamps: { w_agnes: { at: NOW - DAY, by: 'u_b' } } });
      const seedLs = { [SEEN_KEY]: Object.fromEntries(Object.keys(SEED_W).map(id => [id, NOW - (id === 'w_agnes' ? 10 : 1) * DAY])) };
      const L = await phone(browser, srv, { name: 'W', inClaude: true, writable: true, user: owner, seedLs, delay: { stamps: 1500 } }, { hash: '#plan' });
      const early = await hint(L.page);
      await L.page.waitForTimeout(1600);
      const late = await hint(L.page);
      check('stamps still loading: no hint (it would flash for Agnes)', !early.shown && !late.shown, { early, late });
      await L.ctx.close();
      const srv2 = makeServer({ workers: SEED_W, stamps: { w_agnes: { at: NOW - 10 * DAY, by: 'u_b' } } });
      const seen1 = { [SEEN_KEY]: Object.fromEntries(Object.keys(SEED_W).map(id => [id, NOW - DAY])) };
      const M = await phone(browser, srv2, { name: 'W2', inClaude: true, writable: true, user: owner, seedLs: seen1, delay: { stamps: 1200 } }, { hash: '#plan' });
      const e2 = await hint(M.page);
      const got = await until(async () => (await hint(M.page)).text === HINT(1), 2500);
      check('old stamp arriving late: the hint comes once the stamps are there', !e2.shown && got >= 0, { e2, got });
      await M.ctx.close();
      // A villager whose skills are all at Max cannot get better: not counted.
      const maxed = { w_max: { name: 'Maxi', role: 'worker', traits: '', order: 1, stats: st({ labourer: [5, 5], harvesting: [4, 4], farming: [3, 3], cooking: [6, 6], crafting: [2, 2], researching: [1, 1], hunting: [3, 3] }) } };
      const srv3 = makeServer({ workers: { ...maxed, w_ida: { name: 'Ida', role: 'worker', traits: '', order: 2, stats: st({ cooking: [2, 5] }) } }, stamps: { w_max: { at: NOW - 30 * DAY, by: '' }, w_ida: { at: NOW, by: '' } } });
      const N = await phone(browser, srv3, { name: 'W3', inClaude: true, writable: true, user: owner }, { hash: '#plan' });
      check('all skills at Max: not counted (cannot get better by working)', !(await hint(N.page)).shown);
      await N.ctx.close();
      // First-seen map: written once per villager, kept across reloads; no stamp writes.
      const srv4 = makeServer({ workers: SEED_W });
      const O = await phone(browser, srv4, { name: 'W4', inClaude: true, writable: true, user: owner });
      const s1 = await O.page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), SEEN_KEY);
      await O.page.reload(); await O.page.waitForTimeout(500);
      const s2 = await O.page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), SEEN_KEY);
      check('first seen: one entry per villager on this device, kept across a reload', s1 && Object.keys(SEED_W).every(id => s1[id] > NOW - 60e3) && JSON.stringify(s1) === JSON.stringify(s2), { s1, s2 });
      check('first seen: nothing written to the shared list', !srv4.log.length, srv4.log);
      check('first seen today: the cards say "Werte von heute"', Object.values(await fresh(O.page)).every(x => x.t === 'Werte von heute'));
      await O.ctx.close();
      const X = await phone(browser, null, { name: 'X', seedLs: { [SEEN_KEY]: {} } }, { hash: '#plan' });
      check('example team: no hint', !(await hint(X.page)).shown && (await hint(X.page)).exists);
      await X.ctx.close();
    });

    // ===== 4) Local mode: stamps in the LS payload, +1 limits, "Später" for 3 days =====
    await section('4) local', async () => {
      const workers = [
        ...Object.entries(SEED_W).map(([id, w]) => ({ id, ...w })),
        { id: 'w_top', name: 'Topp', role: 'worker', traits: '', order: 6, stats: st({ cooking: [15, 15], crafting: [2, 3] }) },
        { id: 'w_open', name: 'Offen', role: 'worker', traits: '', order: 7, stats: { cooking: { cur: 2, max: null } } },
      ];
      const payload = { settings: null, workers, stamps: { w_agnes: { at: NOW - 12 * DAY, by: '' } } };
      const L = await phone(browser, null, { name: 'L', seedLs: { [LS_KEY]: payload } });
      const P = L.page;
      const ls = () => P.evaluate(k => JSON.parse(localStorage.getItem(k)), LS_KEY);
      check('local: the stamp from the payload ("vor 12 Tagen")', (await fresh(P)).w_agnes.t === 'Werte von vor 12 Tagen');
      const dis = await P.evaluate(() => ({ top: document.querySelector('#wlist [data-wid="w_top"] [data-up="cooking"]').disabled, topCraft: document.querySelector('#wlist [data-wid="w_top"] [data-up="crafting"]').disabled }));
      check('+1 at the top value (15) is disabled, others not', dis.top && !dis.topCraft, dis);
      await up(P, 'w_open', 'cooking'); await P.waitForTimeout(100);
      const open = (await ls()).workers.find(w => w.id === 'w_open').stats.cooking;
      check('+1 with an unknown Max: 3/? (Max stays unknown)', open.cur === 3 && open.max === null && (await val(P, 'w_open', 'max-cooking')) === '', open);
      await up(P, 'w_agnes', 'farming'); await P.waitForTimeout(100);
      let d = await ls();
      check('local +1: stats saved and the stamp is in the payload ({at, by: ""})', d.workers.find(w => w.id === 'w_agnes').stats.farming.cur === 3 && d.stamps && sameKeys(d.stamps.w_agnes, ['at', 'by']) && d.stamps.w_agnes.at > NOW && d.stamps.w_agnes.by === '', d.stamps);
      const at = d.stamps.w_agnes.at;
      const del = P.locator('#wlist [data-wid="w_agnes"] [data-act="del"]');
      await del.click(); await P.waitForTimeout(500); await del.click(); await P.waitForTimeout(150);
      d = await ls();
      check('local delete: the stamp leaves the payload', !d.workers.some(w => w.id === 'w_agnes') && !(d.stamps && d.stamps.w_agnes), d.stamps);
      await P.click('#toast .toast-act'); await P.waitForTimeout(150);
      d = await ls();
      check('local Rückgängig: the stamp is back', d.stamps && d.stamps.w_agnes && d.stamps.w_agnes.at === at, d.stamps);
      await L.ctx.close();
      // "Später": 3 days on this device.
      const old = { settings: null, workers: Object.entries(SEED_W).map(([id, w]) => ({ id, ...w })), stamps: { w_agnes: { at: NOW - 12 * DAY, by: '' } } };
      const H = await phone(browser, null, { name: 'H', seedLs: { [LS_KEY]: old } }, { hash: '#plan' });
      check('local: hint for Agnes', (await hint(H.page)).text === HINT(1));
      await H.page.click('#fresh-later'); await H.page.waitForTimeout(100);
      const later = await H.page.evaluate(k => localStorage.getItem(k), LATER_KEY);
      check('"Später": hidden, stored on this device', !(await hint(H.page)).shown && later !== null, later);
      await H.page.reload(); await H.page.waitForTimeout(500);
      check('"Später": still hidden after a reload', !(await hint(H.page)).shown);
      await H.page.evaluate(([k, t]) => localStorage.setItem(k, JSON.stringify(t)), [LATER_KEY, NOW - 3 * DAY - 60e3]);
      await H.page.reload(); await H.page.waitForTimeout(500);
      check('"Später" older than 3 days: the hint is back', (await hint(H.page)).shown);
      await H.ctx.close();
    });

    // ===== 5) Layout 360 / 390 / 1280 and motion per level =====
    for (const [w, h] of [[360, 740], [390, 844], [1280, 900]]) {
      await section('5) layout ' + w, async () => {
        const srv = makeServer({ workers: SEED_W, stamps: STAMPS });
        const L = await phone(browser, srv, { name: 'Y' + w, inClaude: true, writable: true, user: owner }, { width: w, height: h });
        const P = L.page;
        const r = await P.evaluate(() => {
          const card = document.querySelector('#wlist [data-wid="w_agnes"]'), cr = card.getBoundingClientRect();
          const rows = [...card.querySelectorAll('.st-row')].map(row => {
            const q = s => row.querySelector(s).getBoundingClientRect();
            const n = row.querySelector('.st-name'), nr = n.getBoundingClientRect();
            return { name: nr.right, nameScroll: n.scrollWidth > n.clientWidth + 1, cur: q('[data-f^="cur:"]'), up: q('[data-up]'), max: q('[data-f^="max:"]') };
          });
          return { sw: document.documentElement.scrollWidth, vw: innerWidth, cardL: cr.left, cardR: cr.right,
            rows: rows.map(x => ({ nameR: Math.round(x.name), nameScroll: x.nameScroll, curL: Math.round(x.cur.left), curR: Math.round(x.cur.right), upL: Math.round(x.up.left), upR: Math.round(x.up.right), upW: Math.round(x.up.width), upH: Math.round(x.up.height), maxL: Math.round(x.max.left), maxR: Math.round(x.max.right) })) };
        });
        const ok = r.rows.length === 7 && r.rows.every(x => x.nameR <= x.curL + 0.5 && !x.nameScroll && x.curR <= x.upL && x.upR <= x.maxL && x.maxR <= r.cardR);
        check(`${w}: +1 sits between Stufe and Max, names not cut, nothing outside the card, no horizontal scroll`, ok && r.sw <= r.vw, r);
        if (w < 900) check(`${w}: +1 buttons >= 44 x 44 on touch`, r.rows.every(x => x.upW >= 44 && x.upH >= 44), r.rows.map(x => [x.upW, x.upH]));
        await P.evaluate(() => document.querySelector('#wlist [data-wid="w_agnes"]').scrollIntoView({ block: 'start' })); await P.waitForTimeout(200);
        await P.screenshot({ path: path.join(SHOTS, `fresh-${w}-arbeiter.png`) });
        if (w === 1280) { await P.click('#tab-plan'); await P.waitForTimeout(300); await P.screenshot({ path: path.join(SHOTS, 'fresh-1280-hint.png') }); }
        if (w === 360) { await P.click('#tab-plan'); await P.waitForTimeout(300); check('360 Plan with the hint: no horizontal scroll', await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await P.screenshot({ path: path.join(SHOTS, 'fresh-360-hint.png') }); }
        await L.ctx.close();
      });
    }
    for (const lvl of ['voll', 'ruhig', 'aus']) {
      await section('5) motion ' + lvl, async () => {
        const L = await phone(browser, null, { name: 'Z' + lvl, seedLs: { [LS_KEY]: { settings: null, workers: Object.entries(SEED_W).map(([id, w]) => ({ id, ...w })) }, [ANIM_KEY]: lvl } });
        await up(L.page, 'w_edda', 'farming'); await L.page.waitForTimeout(20);
        const a = await L.page.evaluate(() => document.getElementById('w_edda-cur-farming').getAnimations().map(x => { const kf = x.effect.getKeyframes(); return { dur: x.effect.getComputedTiming().duration, props: [...new Set(kf.flatMap(k => Object.keys(k).filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p))))] }; }));
        if (lvl === 'voll') check('voll: the raised Stufe stamps (transform, <= 400 ms)', a.length === 1 && a[0].dur <= 400 && a[0].props.includes('transform') && a[0].props.every(p => p === 'transform' || p === 'opacity'), a);
        if (lvl === 'ruhig') check('ruhig: a short fade (opacity, <= 150 ms)', a.length === 1 && a[0].dur <= 150 && a[0].props.join() === 'opacity', a);
        if (lvl === 'aus') check('aus: no animation', a.length === 0, a);
        await L.ctx.close();
      });
    }
  } finally { await browser.close(); }
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-fresh: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

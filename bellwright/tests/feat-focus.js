// BUILD 13 "Eintragen ohne Verrutschen":
//  - a banner at the top of the Plan tab while villagers have open numbers ("{n} Bewohner haben neue Zahlen",
//    "Jetzt im Spiel eintragen" opens the Eintragen-Modus, "Später" hides it on this device until the count changes);
//    it replaces the grid-head button, the sticky phone bar only shows once it is scrolled out of view;
//  - "Hier warst du": a tap in a card (cards) or row (table) marks that villager (gold edge, warm tint, "◆ hier"), one at
//    a time, per device ('bellwright-fokus-v1'), through re-renders, live snapshots, tab switches and reloads; closing the
//    Eintragen-Modus marks the villager last shown there; opening the Plan tab scrolls it into view (smooth only in voll);
//  - table readability: zebra rows, taller rows on phones, sticky name column, the focused row tinted across.
// Local mode for most of it, two phones on one fake server (node) for the live snapshot.
const { chromium } = require('playwright');
const path = require('path');

const SHOTS = path.resolve(__dirname, '../shots-r3');
const LS_KEY = 'bellwright-arbeitsplan-v1';
const AP_KEY = 'bellwright-arbeitsplan-eingetragen-v1';
const ENTRY_KEY = 'bellwright-eintragen-v1';
const FOKUS_KEY = 'bellwright-fokus-v1';
const LATER_KEY = 'bellwright-eintragen-spaeter-v1';
const ANIM_KEY = 'bellwright-anim-v1';
const st = o => Object.fromEntries(Object.entries(o).map(([k, [cur, max]]) => [k, { cur, max }]));
const SEED_W = {
  w_agnes: { name: 'Agnes', role: 'worker', traits: 'Optimist', order: 1, stats: st({ labourer: [3, 5], harvesting: [6, 9], farming: [2, 4], cooking: [1, 3], crafting: [2, 6], researching: [0, 2], hunting: [5, 8] }) },
  w_bertram: { name: 'Bertram', role: 'worker', traits: 'Resilient', order: 2, stats: st({ labourer: [7, 9], harvesting: [4, 6], farming: [1, 3], cooking: [2, 4], crafting: [3, 5], researching: [1, 3], hunting: [2, 4] }) },
  w_edda: { name: 'Edda', role: 'worker', traits: '', order: 3, stats: st({ labourer: [2, 4], harvesting: [1, 3], farming: [3, 6], cooking: [8, 10], crafting: [2, 4], researching: [3, 5], hunting: [0, 2] }) },
  w_godric: { name: 'Godric', role: 'worker', traits: 'Prodigy', order: 4, stats: st({ labourer: [3, 6], harvesting: [3, 5], farming: [2, 4], cooking: [1, 4], crafting: [6, 10], researching: [4, 7], hunting: [1, 3] }) },
  w_hilde: { name: 'Hilde', role: 'worker', traits: '', order: 5, stats: st({ labourer: [2, 5], harvesting: [2, 5], farming: [7, 9], cooking: [4, 6], crafting: [1, 3], researching: [2, 4], hunting: [3, 6] }) },
};
const IDS = Object.keys(SEED_W);
const localSeed = (extra = {}) => ({ [LS_KEY]: { settings: null, workers: Object.entries(SEED_W).map(([id, w]) => ({ id, ...w })) }, ...extra });
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
    srv.log.push({ who, op, c, id });
    setTimeout(() => srv.broadcast(c), 10);
  };
  return srv;
}
// ---------- page side. cfg: { name, inClaude, writable, user, seedLs } ----------
function STUB(cfg) {
  if (cfg.seedLs && !sessionStorage.getItem('__seeded')) {
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(cfg.seedLs)) localStorage.setItem(k, JSON.stringify(v));
  }
  try { Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => ({ request: async () => { const s = new EventTarget(); s.release = async () => {}; return s; } }) }); } catch (e) { /* ignore */ }
  if (!cfg.inClaude) return;
  const colL = new Map();
  const list = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const clone = d => JSON.parse(JSON.stringify(d));
  const snapC = docs => ({ docs: docs.map(([id, d]) => ({ id, exists: true, data: () => clone(d), metadata: {} })), size: docs.length, empty: !docs.length, metadata: {}, docChanges: () => [] });
  const snapD = (docs, id) => { const e = docs.find(x => x[0] === id); return { id, exists: !!e, data: () => (e ? clone(e[1]) : undefined), metadata: {} }; };
  const docL = new Map();
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
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : null) };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 700) : '')); };
const errs = [];
async function phone(browser, srv, cfg, { width = 390, height = 844, hash = '#plan', reduced = false } = {}) {
  const mobile = width < 900;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  ctx.setDefaultTimeout(5000);
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push((cfg.name || '?') + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push((cfg.name || '?') + ' console: ' + m.text()); });
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
async function until(fn, max = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(30); }
  return -1;
}
// The banner, the grid-head button and the sticky bar.
const B = page => page.evaluate(() => {
  const vis = el => !!el && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  const ban = document.getElementById('entry-banner'), go = document.getElementById('entry-banner-go'), later = document.getElementById('entry-banner-later');
  const st = document.getElementById('entry-sticky'), sb = st && st.querySelector('button');
  const inView = el => { if (!vis(el)) return false; const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const phase = document.querySelector('#panel-plan .phase');
  return {
    exists: !!ban, shown: vis(ban), text: ban ? (document.getElementById('entry-banner-text') || ban).textContent.replace(/\s+/g, ' ').trim() : '',
    go: go ? go.textContent.trim() : '', goPrimary: !!go && go.classList.contains('primary'), later: later ? later.textContent.trim() : '',
    goH: vis(go) ? go.getBoundingClientRect().height : 0, laterH: vis(later) ? later.getBoundingClientRect().height : 0, laterW: vis(later) ? later.getBoundingClientRect().width : 0,
    abovePhase: vis(ban) && ban.getBoundingClientRect().bottom <= phase.getBoundingClientRect().top + 1,
    headBtn: vis(document.getElementById('entry-open')), headLabel: document.getElementById('entry-open').textContent,
    sticky: vis(sb), stickyInView: inView(sb), stickyLabel: sb ? sb.textContent : '',
    ctasInView: [go, document.getElementById('entry-open'), sb].filter(inView).length,
    resume: vis(document.getElementById('entry-resume')),
    active: document.activeElement && document.activeElement.id,
  };
});
// Which villager carries the "Hier warst du" mark, and how it looks.
const F = page => page.evaluate(() => {
  const marked = [...document.querySelectorAll('#plan-view .fokus')];
  const el = marked[0];
  const mark = el && el.querySelector('.fokus-mark');
  const markVis = !!mark && getComputedStyle(mark).display !== 'none' && mark.getClientRects().length > 0;
  const otherMarks = [...document.querySelectorAll('#plan-view .fokus-mark')].filter(m => !m.closest('.fokus') && getComputedStyle(m).display !== 'none' && m.getClientRects().length > 0).length;
  let ls = null; try { ls = JSON.parse(localStorage.getItem('bellwright-fokus-v1')); } catch (e) { ls = 'ERR'; }
  return { n: marked.length, wid: el ? el.dataset.fokus : null, tag: el ? el.tagName : null, mark: mark ? mark.textContent.replace(/\s+/g, ' ').trim() : '', markVis, otherMarks, ls };
});
const anim = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.getAnimations({ subtree: true }).map(a => { const t = a.effect.getComputedTiming(); let kf = []; try { kf = a.effect.getKeyframes(); } catch (e) { /* */ } return { name: a.animationName || 'js', dur: t.duration, props: [...new Set(kf.flatMap(k => Object.keys(k).filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p))))] }; }) : null; }, sel);
const tapCard = (page, wid, sel = '.wp-head h3') => page.click(`#wp-${wid} ${sel}`);
// A scenario that breaks off (e.g. a missing element) counts as a failed check instead of ending the run.
async function section(name, fn) { try { await fn(); } catch (e) { check(`${name}: runs to the end`, false, String(e && e.message || e).split('\n')[0]); } }

(async () => {
  const browser = await chromium.launch();
  try {
    // ===== 1) The banner on a phone (local mode, 5 villagers, nobody entered yet) =====
    await section('1) The banner on a phone (local mode, 5 vil', async () => {
      const L = await phone(browser, null, { name: 'L', seedLs: localSeed() });
      const P = L.page;
      let b = await B(P);
      check('banner: shown at the top of the Plan tab (above the phase buttons)', b.exists && b.shown && b.abovePhase, b);
      check('banner text "5 Bewohner haben neue Zahlen", primary "Jetzt im Spiel eintragen", small "Später"', b.text.startsWith('5 Bewohner haben neue Zahlen') && b.go === 'Jetzt im Spiel eintragen' && b.goPrimary && b.later === 'Später', b);
      check('banner replaces the grid-head button; the sticky bar waits while the banner is in view', !b.headBtn && !b.sticky && b.ctasInView === 1, b);
      check('the hidden head button keeps its label "Im Spiel eintragen (5 offen)"', b.headLabel === 'Im Spiel eintragen (5 offen)', b.headLabel);
      check('390 touch: the big button >= 48 px, "Später" >= 44 x 44', b.goH >= 48 && b.laterH >= 44 && b.laterW >= 44, b);
      check('360-ish: no horizontal scroll with the banner', await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await P.screenshot({ path: path.join(SHOTS, 'focus-390-banner.png') });
      // Scrolled away: the sticky bar comes; back up: it goes.
      await P.evaluate(() => window.scrollTo(0, 1400)); await P.waitForTimeout(250);
      b = await B(P);
      check('banner scrolled out of view: the sticky bar shows ("Im Spiel eintragen (5 offen)")', b.sticky && b.stickyInView && b.stickyLabel === 'Im Spiel eintragen (5 offen)' && b.ctasInView === 1, b);
      await P.screenshot({ path: path.join(SHOTS, 'focus-390-sticky.png') });
      await P.evaluate(() => window.scrollTo(0, 0)); await P.waitForTimeout(250);
      b = await B(P);
      check('back at the top: the sticky bar hides again', b.shown && !b.sticky, b);
      // "Jetzt im Spiel eintragen" opens the Eintragen-Modus; closing it marks the villager last shown there.
      await P.click('#entry-banner-go'); await P.waitForTimeout(250);
      const e1 = await P.evaluate(() => ({ open: !document.getElementById('entry').hidden, name: (document.getElementById('entry-name') || {}).textContent }));
      check('"Jetzt im Spiel eintragen" opens the Eintragen-Modus on the first open villager', e1.open && e1.name === 'Agnes', e1);
      await P.keyboard.press('ArrowRight'); await P.waitForTimeout(450);
      await P.keyboard.press('Escape'); await P.waitForTimeout(200);
      let f = await F(P);
      b = await B(P);
      check('closing the mode marks the villager last shown there (Bertram), stored per device', f.n === 1 && f.wid === 'w_bertram' && f.ls === 'w_bertram' && f.tag === 'ARTICLE', f);
      check('the mark: "◆ hier" on that card only', f.markVis && f.mark.startsWith('◆ hier') && f.otherMarks === 0, f);
      check('after closing: keyboard focus back on the banner button (still 5 open)', b.shown && b.active === 'entry-banner-go', b);
      // Später: hidden on this device until the count changes.
      await P.click('#entry-banner-later'); await P.waitForTimeout(150);
      b = await B(P);
      check('"Später": banner gone, the head button "Im Spiel eintragen (5 offen)" is back and focused', !b.shown && b.headBtn && b.headLabel === 'Im Spiel eintragen (5 offen)' && b.active === 'entry-open', b);
      check('"Später" is stored on this device', (await P.evaluate(k => localStorage.getItem(k), LATER_KEY)) !== null);
      await P.evaluate(() => window.scrollTo(0, 1400)); await P.waitForTimeout(250);
      check('banner dismissed: the sticky bar works as before', (await B(P)).sticky);
      await P.evaluate(() => window.scrollTo(0, 0));
      await P.evaluate(k => localStorage.removeItem(k), ENTRY_KEY);   // no resume offer (the mode was closed midway above)
      await P.reload(); await P.waitForTimeout(500);
      b = await B(P);
      check('reload: still hidden (same count)', !b.shown && !b.resume && b.headBtn, b);
      // The count changes (Agnes ticked off in the plan): the banner is back.
      await P.click('#wp-w_agnes [data-applied]'); await P.waitForTimeout(200);
      b = await B(P);
      check('count changes 5 -> 4: banner back, "4 Bewohner haben neue Zahlen"', b.shown && b.text.startsWith('4 Bewohner haben neue Zahlen') && !b.headBtn, b);
      // "until the count changes": once it changed, the "Später" is used up, also when the count comes back (Rückgängig: 5 again).
      check('count changed: the "Später" is forgotten on this device', (await P.evaluate(k => localStorage.getItem(k), LATER_KEY)) === null);
      await P.click('#toast .toast-act'); await P.waitForTimeout(200);
      b = await B(P);
      check('Rückgängig, 5 open again: the banner stays (the "Später" was used up)', b.shown && b.text.startsWith('5 Bewohner haben neue Zahlen') && !b.headBtn, b);
      await P.click('#wp-w_agnes [data-applied]'); await P.waitForTimeout(200);
      for (const id of ['w_bertram', 'w_edda', 'w_godric']) { await P.click(`#wp-${id} [data-applied]`); await P.waitForTimeout(150); }
      b = await B(P);
      check('one left: "1 Bewohner hat neue Zahlen"', b.shown && b.text.startsWith('1 Bewohner hat neue Zahlen'), b);
      await P.click('#wp-w_hilde [data-applied]'); await P.waitForTimeout(200);
      b = await B(P);
      check('nothing open: no banner, no head button, no sticky bar', !b.shown && !b.headBtn && !b.sticky, b);
      check('nothing open: the "Später" of an earlier count is forgotten', (await P.evaluate(k => localStorage.getItem(k), LATER_KEY)) === null);
      await L.ctx.close();
    });

    // ===== 2) Example team, resume banner =====
    await section('2) Example team, resume banner', async () => {
      const X = await phone(browser, null, { name: 'X' });
      const b = await B(X.page);
      check('example team: no banner', b.exists && !b.shown && !b.headBtn, b);
      await X.ctx.close();
      const R = await phone(browser, null, { name: 'R', seedLs: localSeed({ [ENTRY_KEY]: { ids: IDS, i: 2, at: Date.now() - 60e3 } }) });
      let r = await B(R.page);
      check('resume banner shown: the new banner waits (one invitation at a time), head button as before', r.resume && !r.shown && r.headBtn, r);
      await R.page.click('#entry-resume-x'); await R.page.waitForTimeout(150);
      r = await B(R.page);
      check('resume banner dismissed: the new banner takes over, focus on its button', !r.resume && r.shown && !r.headBtn && r.active === 'entry-banner-go', r);
      await R.ctx.close();
    });

    // ===== 3) "Hier warst du" in the cards view =====
    await section('3) "Hier warst du" in the cards view', async () => {
      const L = await phone(browser, null, { name: 'C', seedLs: localSeed() });
      const P = L.page;
      check('nothing marked at first', (await F(P)).n === 0);
      await tapCard(P, 'w_edda');
      let f = await F(P);
      check('tap in Edda\'s card: Edda marked, only her, stored', f.n === 1 && f.wid === 'w_edda' && f.ls === 'w_edda' && f.markVis && f.otherMarks === 0, f);
      const look = await P.evaluate(() => {
        const a = document.getElementById('wp-w_edda'), o = document.getElementById('wp-w_agnes');
        const be = getComputedStyle(a, '::before');
        return { edge: be.backgroundColor, w: parseFloat(be.width), bgA: getComputedStyle(a).backgroundImage, bgO: getComputedStyle(o).backgroundImage, mark: getComputedStyle(a.querySelector('.fokus-mark')).color };
      });
      check('the marked card: a clear gold left edge (accent-hi, >= 3 px) and a warm tint', look.edge === 'rgb(240, 200, 106)' && look.w >= 3 && look.bgA !== look.bgO, look);
      // A row inside another card: it opens as before, and the mark moves.
      await P.click('#wp-w_hilde details.wp-row:nth-of-type(1) > summary'); await P.waitForTimeout(150);
      f = await F(P);
      const opened = await P.evaluate(() => document.querySelector('#wp-w_hilde details.wp-row').open);
      check('tap on a row in Hilde\'s card: the row opens, the mark moves to Hilde (one at a time)', opened && f.n === 1 && f.wid === 'w_hilde' && f.ls === 'w_hilde', { opened, f });
      // Survives a re-render (phase switch), a tab switch and a reload.
      await P.click('#panel-plan [data-phase="krieg"]'); await P.waitForTimeout(500);
      check('phase switch (re-render): still Hilde', (await F(P)).wid === 'w_hilde');
      await P.click('#tab-arbeiter'); await P.waitForTimeout(100); await P.click('#tab-plan'); await P.waitForTimeout(400);
      check('tab switch and back: still Hilde', (await F(P)).wid === 'w_hilde');
      await P.reload(); await P.waitForTimeout(600);
      f = await F(P);
      check('reload: still Hilde', f.n === 1 && f.wid === 'w_hilde' && f.markVis, f);
      await P.screenshot({ path: path.join(SHOTS, 'focus-390-cards.png') });
      await L.ctx.close();
    });

    // ===== 4) Opening the Plan tab scrolls the marked villager into view (instant unless voll) =====
    for (const lvl of ['ruhig', 'aus', 'voll']) {
    await section('4) ' + lvl, async () => {
      const L = await phone(browser, null, { name: 'S' + lvl, seedLs: localSeed({ [FOKUS_KEY]: 'w_hilde', [ANIM_KEY]: lvl }) }, { hash: '#arbeiter' });
      const P = L.page;
      await P.click('#tab-plan');
      const at0 = await P.evaluate(() => { const r = document.getElementById('wp-w_hilde').getBoundingClientRect(); return { top: r.top, y: scrollY, h: innerHeight }; });
      await P.waitForTimeout(1200);
      const at1 = await P.evaluate(() => { const r = document.getElementById('wp-w_hilde').getBoundingClientRect(); return { top: r.top, y: scrollY, h: innerHeight }; });
      if (lvl === 'voll') check('voll: the marked card off-screen -> scrolled into view (smooth)', at1.y > 0 && at1.top >= -1 && at1.top < at1.h - 100, { at0, at1 });
      else check(`${lvl}: the marked card is in view at once (no smooth scroll)`, at0.y > 0 && at0.top >= -1 && at0.top < at0.h - 100, at0);
      await L.ctx.close();
    });
    }
    await section('4b) on screen / at boot', async () => {
      // Marked villager already on screen: nothing scrolls. And at boot on the Plan tab: scrolled to it.
      // (A tall desktop window, so Agnes' card is on screen without scrolling.)
      const L = await phone(browser, null, { name: 'S0', seedLs: localSeed({ [FOKUS_KEY]: 'w_agnes', [ANIM_KEY]: 'aus', 'bellwright-arbeitsplan-view': 'cards' }) }, { hash: '#arbeiter', width: 1280, height: 1400 });
      await L.page.click('#tab-plan'); await L.page.waitForTimeout(200);
      const on = await L.page.evaluate(() => { const r = document.getElementById('wp-w_agnes').getBoundingClientRect(); return { y: scrollY, top: r.top, h: innerHeight, fokus: document.getElementById('wp-w_agnes').classList.contains('fokus') }; });
      check('marked card already on screen: no scroll', on.fokus && on.y === 0 && on.top > 0 && on.top < on.h - 140, on);
      await L.ctx.close();
      const M = await phone(browser, null, { name: 'S1', seedLs: localSeed({ [FOKUS_KEY]: 'w_hilde', [ANIM_KEY]: 'aus' }) }, { hash: '#plan' });
      const at = await M.page.evaluate(() => { const r = document.getElementById('wp-w_hilde').getBoundingClientRect(); return { top: r.top, y: scrollY, h: innerHeight }; });
      check('reload on the Plan tab: the marked villager is scrolled into view', at.y > 0 && at.top >= -1 && at.top < at.h - 100, at);
      await M.ctx.close();
    });

    // ===== 5) Table view: zebra, taller rows on phones, sticky names, the marked row tinted across =====
    const rowInfo = page => page.evaluate(() => {
      const rows = [...document.querySelectorAll('#plan-view table.matrix tbody tr')];
      const bg = el => getComputedStyle(el).backgroundColor;
      return rows.map(r => ({ wid: r.dataset.fokus, fokus: r.classList.contains('fokus'), h: r.getBoundingClientRect().height, th: bg(r.querySelector('th')), tds: [...r.querySelectorAll('td')].map(bg),
        edge: getComputedStyle(r.querySelector('th'), '::before').backgroundColor, mark: (() => { const m = r.querySelector('.fokus-mark'); return !!m && getComputedStyle(m).display !== 'none' && m.getClientRects().length > 0; })() }));
    });
    let deskH = 0;
    await section('5a) desktop table', async () => {
      const D = await phone(browser, null, { name: 'TD', seedLs: localSeed() }, { width: 1280, height: 900 });
      await D.page.click('[data-view="table"]'); await D.page.waitForTimeout(200);
      deskH = (await rowInfo(D.page))[0].h;
      await D.page.click('[data-cell="w_godric|cooking"]'); await D.page.waitForTimeout(150);
      await D.page.screenshot({ path: path.join(SHOTS, 'focus-1280-table.png') });
      await D.page.click('[data-view="cards"]'); await D.page.waitForTimeout(200);
      await D.page.screenshot({ path: path.join(SHOTS, 'focus-1280-cards.png') });
      check('1280: no horizontal scroll', await D.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await D.ctx.close();
    });
    for (const w of [360, 390]) {
    await section('5b) table ' + w, async () => {
      const T = await phone(browser, null, { name: 'T' + w, seedLs: localSeed() }, { width: w, height: 800 });
      const P = T.page;
      await P.click('[data-view="table"]'); await P.waitForTimeout(200);
      let rows = await rowInfo(P);
      check(`${w} table: zebra rows (2nd row differs from 1st and 3rd is like 1st)`, rows.length === 5 && rows[1].tds[0] !== rows[0].tds[0] && rows[2].tds[0] === rows[0].tds[0] && rows[1].th !== rows[0].th, rows.slice(0, 3).map(r => [r.th, r.tds[0]]));
      check(`${w} table: rows taller on phones (>= 56 px, desktop ${Math.round(deskH)} px)`, rows.every(r => r.h >= 56) && rows[0].h > deskH, rows.map(r => Math.round(r.h)));
      await P.click('[data-cell="w_godric|cooking"]'); await P.waitForTimeout(150);
      rows = await rowInfo(P);
      const g = rows.find(r => r.wid === 'w_godric'), other = rows.find(r => r.wid === 'w_bertram');
      check(`${w} table: tap in Godric's row marks the row, the gold edge on the name, "◆ hier"`, g && g.fokus && rows.filter(r => r.fokus).length === 1 && g.edge === 'rgb(240, 200, 106)' && g.mark && (await F(P)).ls === 'w_godric', g);
      check(`${w} table: the marked row is tinted across the whole width`, g && g.tds.every(c => c === g.tds[0]) && g.tds[0] !== other.tds[0] && g.th !== other.th, { g: g && [g.th, g.tds[0]], o: other && [other.th, other.tds[0]] });
      const sticky = await P.evaluate(() => {
        const wrap = document.querySelector('.matrix-wrap'), th = document.querySelector('#plan-view tbody tr th.wcol');
        wrap.scrollLeft = 0;   // the tap above scrolled the cell into view
        const l0 = th.getBoundingClientRect().left, c0 = document.querySelector('#plan-view tbody tr td').getBoundingClientRect().left;
        wrap.scrollLeft = 260;
        return { l0, l1: th.getBoundingClientRect().left, wrapL: wrap.getBoundingClientRect().left, c0, c1: document.querySelector('#plan-view tbody tr td').getBoundingClientRect().left, sl: wrap.scrollLeft };
      });
      check(`${w} table: the name column stays on the left while scrolling sideways`, sticky.sl > 100 && Math.abs(sticky.l1 - sticky.l0) < 1 && sticky.c1 < sticky.c0 - 100, sticky);
      check(`${w} table: no horizontal page scroll`, await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (w === 390) {
        await P.evaluate(() => { document.querySelector('.matrix-wrap').scrollLeft = 0; document.querySelector('#plan-view .matrix-wrap').scrollIntoView({ block: 'start' }); });
        await P.waitForTimeout(200);
        await P.screenshot({ path: path.join(SHOTS, 'focus-390-table.png') });
      }
      await P.click('[data-view="cards"]'); await P.waitForTimeout(200);
      const f = await F(P);
      check(`${w}: back to cards: Godric's card is marked`, f.n === 1 && f.wid === 'w_godric' && f.tag === 'ARTICLE', f);
      if (w === 360) {
        await P.evaluate(() => window.scrollTo(0, 0)); await P.waitForTimeout(100);
        await P.screenshot({ path: path.join(SHOTS, 'focus-360-banner.png') });
        check('360 cards: no horizontal page scroll with banner and mark', await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await T.ctx.close();
    });
    }

    // ===== 6) Shared list: the mark is per device and survives live snapshots =====
    await section('6) Shared list: the mark is per device and ', async () => {
      const srv = makeServer({ workers: SEED_W });
      const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: { id: 'u_a', owner: true, can: true } });
      const Bp = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: { id: 'u_b', owner: false, can: true } });
      check('db: banner on both phones', (await B(A.page)).shown && (await B(Bp.page)).shown);
      await tapCard(A.page, 'w_edda');
      await Bp.page.click('#wp-w_agnes [data-applied]');
      const got = await until(async () => (await B(A.page)).text.startsWith('4 Bewohner'), 3000);
      const fa = await F(A.page), fb = await F(Bp.page);
      check('db: B ticks Agnes -> A follows live (4 open) and keeps its own mark on Edda', got >= 0 && fa.wid === 'w_edda' && fa.n === 1, { got, fa });
      check('db: the mark is per device (B marked Agnes by tapping, not Edda)', fb.wid === 'w_agnes', fb);
      await Bp.page.click('#panel-plan [data-phase="ausbau"]');
      await until(async () => A.page.evaluate(() => document.querySelector('#panel-plan [data-phase="ausbau"]').getAttribute('aria-pressed') === 'true'), 3000);
      await A.page.waitForTimeout(200);
      check('db: a phase switch from the other phone (new snapshot) keeps the mark', (await F(A.page)).wid === 'w_edda');
      const C = await phone(browser, srv, { name: 'RO', inClaude: true, writable: false, user: { id: 'u_c', owner: false, can: false } });
      const bc = await B(C.page);
      await tapCard(C.page, 'w_godric');
      check('read-only viewer: sees the banner and can mark a villager on its own device', bc.shown && (await F(C.page)).wid === 'w_godric', bc);
      for (const s of [A, Bp, C]) await s.ctx.close();
    });

    // ===== 7) Motion per level: the mark stamps (voll), fades (ruhig) or just appears (aus); the banner likewise =====
    for (const lvl of ['voll', 'ruhig', 'aus']) {
    await section('7) ' + lvl, async () => {
      const L = await phone(browser, null, { name: 'M' + lvl, seedLs: localSeed({ [ANIM_KEY]: lvl }) });
      const P = L.page;
      await tapCard(P, 'w_bertram'); await P.waitForTimeout(20);
      const a = await anim(P, '#wp-w_bertram .fokus-mark');
      if (lvl === 'voll') check('voll: the mark stamps in (transform, <= 400 ms)', a.length === 1 && a[0].dur <= 400 && a[0].props.every(p => p === 'transform' || p === 'opacity') && a[0].props.includes('transform'), a);
      if (lvl === 'ruhig') check('ruhig: the mark only fades (opacity, <= 150 ms)', a.length === 1 && a[0].dur <= 150 && a[0].props.join() === 'opacity', a);
      if (lvl === 'aus') check('aus: the mark has no animation', a.length === 0, a);
      // The banner comes back (count changes after "Später"): voll rises, ruhig fades, aus nothing.
      await P.click('#entry-banner-later'); await P.waitForTimeout(50);
      await P.click('#wp-w_agnes [data-applied]'); await P.waitForTimeout(20);
      const ba = await anim(P, '#entry-banner');
      const own = (ba || []).filter(x => x.name !== 'js');
      if (lvl === 'voll') check('voll: the banner rises in (<= 400 ms, transform/opacity)', own.length >= 1 && own.every(x => x.dur <= 400 && x.props.every(p => p === 'transform' || p === 'opacity')), ba);
      if (lvl === 'ruhig') check('ruhig: the banner fades in (opacity, <= 150 ms)', own.length >= 1 && own.every(x => x.dur <= 150 && x.props.join() === 'opacity'), ba);
      if (lvl === 'aus') check('aus: the banner just appears', own.length === 0, ba);
      await L.ctx.close();
    });
    }
  } finally { await browser.close(); }
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-focus: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

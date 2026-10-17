// BUILD 10 "Animationen": the per-device setting voll / ruhig / aus (html[data-anim], localStorage 'bellwright-anim-v1'),
// reduced motion = aus with a note (BUILD 11: unless a level was chosen on this device), the Eintragen-Modus effects (page turn, wax seal + sparks, rolling numbers, finale
// banner + fountain), rolling plan numbers, the phase-switch light sweep, the title torch, pausing while hidden,
// the entry flow in all three modes against a shared fake server, timing, cleanup and overflow at 360/390/1280.
const { chromium } = require('playwright');

const LS_KEY = 'bellwright-arbeitsplan-v1';
const AP_KEY = 'bellwright-arbeitsplan-eingetragen-v1';
const ANIM_KEY = 'bellwright-anim-v1';
const DIR = { u_owner: 'Gabriel', u_lena: 'Lena', u_ro: 'Ida' };
const st = o => Object.fromEntries(Object.entries(o).map(([k, [cur, max]]) => [k, { cur, max }]));
const SEED_W = {
  w_agnes: { name: 'Agnes', role: 'worker', traits: 'Optimist', order: 1, stats: st({ labourer: [3, 5], harvesting: [6, 9], farming: [2, 4], cooking: [1, 3], crafting: [2, 6], researching: [0, 2], hunting: [5, 8] }) },
  w_bertram: { name: 'Bertram', role: 'worker', traits: 'Resilient', order: 2, stats: st({ labourer: [7, 9], harvesting: [4, 6], farming: [1, 3], cooking: [2, 4], crafting: [3, 5], researching: [1, 3], hunting: [2, 4] }) },
  w_edda: { name: 'Edda', role: 'worker', traits: '', order: 3, stats: st({ labourer: [2, 4], harvesting: [1, 3], farming: [3, 6], cooking: [8, 10], crafting: [2, 4], researching: [3, 5], hunting: [0, 2] }) },
  w_godric: { name: 'Godric', role: 'worker', traits: 'Prodigy', order: 4, stats: st({ labourer: [3, 6], harvesting: [3, 5], farming: [2, 4], cooking: [1, 4], crafting: [6, 10], researching: [4, 7], hunting: [1, 3] }) },
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));

// ---------- the shared fake server (node side): its own map per collection ----------
function makeServer(seed = {}) {
  const srv = { workers: new Map(), settings: new Map(), ingame: new Map(), prefs: new Map(), log: [], pages: new Set() };
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) srv[c].set(id, clone(d));
  srv.docs = c => [...(srv[c] || new Map())].map(([id, d]) => [id, clone(d)]);
  srv.broadcast = c => { const docs = srv.docs(c); for (const p of srv.pages) p.evaluate(([c, docs]) => window.__deliver && window.__deliver(c, docs), [c, docs]).catch(() => {}); };
  srv.write = async (who, op, c, id, d) => {
    await sleep(60);
    if (!srv[c]) srv[c] = new Map();
    if (op === 'set') srv[c].set(id, clone(d)); else srv[c].delete(id);
    srv.log.push({ who, op, c, id });
    setTimeout(() => srv.broadcast(c), 10);
  };
  return srv;
}

// ---------- page side ----------
// cfg: { name, inClaude, writable, user, dir, anim (seeded once), seedLs, blockStorage }
function STUB(cfg) {
  if (cfg.blockStorage) {
    const t = () => { throw new DOMException('blocked', 'SecurityError'); };
    for (const k of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[k] = t;
  } else if (!sessionStorage.getItem('__seeded')) {
    sessionStorage.setItem('__seeded', '1');
    if (cfg.anim) localStorage.setItem('bellwright-anim-v1', JSON.stringify(cfg.anim));
    localStorage.setItem('bellwright-sperre-tipp-v1', 'true');
    for (const [k, v] of Object.entries(cfg.seedLs || {})) localStorage.setItem(k, JSON.stringify(v));
  }
  const fakeLock = { request: async () => { const s = new EventTarget(); s.released = false; s.release = async () => { s.released = true; }; return s; } };
  Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => fakeLock });
  window.__setHidden = h => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  // Every animation that ever existed on the page (for "ruhig: only short ones").
  window.__seen = new Map();
  window.__sample = () => { for (const a of document.getAnimations()) if (!window.__seen.has(a)) { const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {}; window.__seen.set(a, { name: a.animationName || a.transitionProperty || 'js', iter: t.iterations, end: t.endTime, cls: a.effect && a.effect.target ? String(a.effect.target.className || a.effect.target.tagName) : '' }); } };
  const sample = async () => ({ text: '' });
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
  sample.json = async () => ({ workers: [] });
  if (!cfg.inClaude) { window.claude = { use: async n => (n === 'sample' ? sample : null) }; return; }
  const colL = new Map(), docL = new Map();
  const list = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const cl = d => JSON.parse(JSON.stringify(d));
  const snapC = docs => ({ docs: docs.map(([id, d]) => ({ id, exists: true, data: () => cl(d), metadata: {} })), size: docs.length, empty: !docs.length, metadata: {}, docChanges: () => [] });
  const snapD = (docs, id) => { const e = docs.find(x => x[0] === id); return { id, exists: !!e, data: () => (e ? cl(e[1]) : undefined), metadata: {} }; };
  window.__deliver = (c, docs) => {
    for (const f of colL.get(c) || []) f(snapC(docs));
    for (const [k, fs] of docL) if (k.startsWith(c + '/')) for (const f of fs) f(snapD(docs, k.slice(c.length + 1)));
  };
  const refuse = () => Promise.reject({ code: 'invalid_argument', message: 'below the write level' });
  const docRef = (c, id) => ({
    set: d => cfg.writable ? window.__srvWrite(cfg.name, 'set', c, id, cl(d)) : refuse(),
    delete: () => cfg.writable ? window.__srvWrite(cfg.name, 'delete', c, id, null) : refuse(),
    onSnapshot: n => { list(docL, c + '/' + id).push(n); window.__srvRead(c).then(docs => n(snapD(docs, id))); return () => {}; },
  });
  const db = Object.freeze({
    collection: c => ({ doc: id => docRef(c, id), onSnapshot: n => { list(colL, c).push(n); window.__srvRead(c).then(docs => n(snapC(docs))); return () => {}; } }),
    doc: p => { const [c, id] = p.split('/'); return docRef(c, id); },
  });
  const u = cfg.user;
  const user = !u ? null : Object.freeze({
    isOwner: async () => !!u.owner,
    id: async () => u.id || null,
    can: async n => (n === 'data.write' ? u.can : false),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: (cfg.dir || {})[i] || '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : n === 'sample' ? sample : null) };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); };
const errs = [];

async function phone(browser, srv, cfg, { width = 390, height = 844, reduced = false, hash = '', ctx = null } = {}) {
  const mobile = width < 900;
  const own = !ctx;
  ctx = ctx || await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push((cfg.name || '?') + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push((cfg.name || '?') + ' console: ' + m.text()); });
  if (srv && own) {
    await ctx.exposeFunction('__srvWrite', (who, op, c, id, d) => srv.write(who, op, c, id, d));
    await ctx.exposeFunction('__srvRead', c => srv.docs(c));
  }
  if (srv) { srv.pages.add(page); page.on('close', () => srv.pages.delete(page)); }
  await page.addInitScript(STUB, { dir: DIR, ...cfg });
  await page.goto('file://' + process.cwd() + '/page.html' + hash);
  await page.waitForTimeout(500);
  return { ctx, page };
}
async function until(fn, max = 2500, step = 20) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(step); }
  return -1;
}
const nameOf = page => page.evaluate(() => { const n = document.getElementById('entry-name'); return n ? n.textContent : null; });
const countOf = page => page.evaluate(() => document.getElementById('entry-count').textContent.replace(/\s+/g, ' ').replace(' von / ', ' / '));
const animCount = page => page.evaluate(() => document.getAnimations().length);
const overflow = page => page.evaluate(() => {
  const e = document.getElementById('entry');
  return { doc: document.documentElement.scrollWidth - innerWidth, entry: e.hidden ? 0 : e.scrollWidth - e.clientWidth };
});
const canvasSig = page => page.evaluate(() => { const c = document.getElementById('embers'); const d = c.getContext('2d').getImageData(0, 0, Math.max(1, c.width), Math.max(1, c.height)).data; let h = 0, n = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] > 10) n++; if (i % 97 === 0) h = (h * 31 + d[i]) | 0; } return { h, n }; });
const domVals = page => page.evaluate(() => {
  const o = {};
  for (const b of document.querySelectorAll('#plan-view .pbadge[data-k], #plan-view [data-cell]')) { const k = b.dataset.k || b.dataset.cell; const t = b.textContent.trim(); o[k] = t === 'aus' ? 0 : +t; }
  return o;
});
// Classes the effects add for a moment; none may stay behind.
const stuck = page => page.evaluate(() => ({
  sweep: document.querySelectorAll('.sweep').length, odo: document.querySelectorAll('.odo').length, spark: document.querySelectorAll('.spark').length,
  ghost: document.querySelectorAll('.entry-ghost').length, leaf: document.querySelectorAll('.leaf-under, .leaf-back, .leaf-fwd').length,
}));

(async () => {
  const browser = await chromium.launch();

  // ===== 1) The setting: Einstellungen control, html[data-anim], per device, other tabs, read-only viewers =====
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true, isMobile: true });
    const A = await phone(browser, null, { name: 'S1', inClaude: false }, { ctx, hash: '#jobs' });
    const s0 = await A.page.evaluate(() => ({ anim: document.documentElement.dataset.anim, pressed: [...document.querySelectorAll('[data-anim-set]')].map(b => b.dataset.animSet + ':' + b.getAttribute('aria-pressed')),
      labels: [...document.querySelectorAll('[data-anim-set]')].map(b => b.firstChild.textContent), note: document.getElementById('anim-rm').hidden, group: document.querySelector('.anim-seg').getAttribute('role'),
      h: [...document.querySelectorAll('[data-anim-set]')].map(b => Math.round(b.getBoundingClientRect().height)), ls: localStorage.getItem('bellwright-anim-v1') }));
    check('default: html[data-anim="voll"], "Voll" pressed, nothing stored yet', s0.anim === 'voll' && s0.pressed.join() === 'voll:true,ruhig:false,aus:false' && s0.ls === null, s0);
    check('control: group of Voll / Ruhig / Aus, >= 44px on touch, no reduced-motion note', s0.labels.join() === 'Voll,Ruhig,Aus' && s0.group === 'group' && s0.h.every(h => h >= 44) && s0.note, s0);
    check('360: Einstellungen without horizontal overflow', (await overflow(A.page)).doc <= 0);
    await A.page.screenshot({ path: 'anim-360-setting.png' });
    await A.page.click('[data-anim-set="ruhig"]');
    const s1 = await A.page.evaluate(() => ({ anim: document.documentElement.dataset.anim, ls: localStorage.getItem('bellwright-anim-v1'), pressed: document.querySelector('[data-anim-set="ruhig"]').getAttribute('aria-pressed') }));
    check('Ruhig: html[data-anim="ruhig"], stored per device as "ruhig"', s1.anim === 'ruhig' && s1.ls === '"ruhig"' && s1.pressed === 'true', s1);
    const B = await phone(browser, null, { name: 'S2', inClaude: false }, { ctx });
    check('same device, new tab: starts in "ruhig"', (await B.page.evaluate(() => document.documentElement.dataset.anim)) === 'ruhig');
    await B.page.click('#tab-jobs'); await B.page.click('[data-anim-set="aus"]');
    const followed = await until(async () => (await A.page.evaluate(() => document.documentElement.dataset.anim)) === 'aus', 2000);
    check('another tab of this browser switches to "Aus": this tab follows', followed >= 0 && (await A.page.$eval('[data-anim-set="aus"]', b => b.getAttribute('aria-pressed'))) === 'true');
    await A.page.reload(); await A.page.waitForTimeout(400);
    check('reload keeps "aus"', (await A.page.evaluate(() => document.documentElement.dataset.anim)) === 'aus');
    await ctx.close();
    const C = await phone(browser, null, { name: 'S3', inClaude: false });
    check('another device (fresh browser): "voll"', (await C.page.evaluate(() => document.documentElement.dataset.anim)) === 'voll');
    await C.ctx.close();
    // Garbage in storage: back to voll.
    const D = await phone(browser, null, { name: 'S4', inClaude: false, anim: 'wild' });
    check('unknown stored value: "voll"', (await D.page.evaluate(() => document.documentElement.dataset.anim)) === 'voll');
    await D.ctx.close();
    // Blocked storage: voll, no errors, the choice still applies for this page.
    const E = await phone(browser, null, { name: 'S5', inClaude: false, blockStorage: true }, { hash: '#jobs' });
    const e0 = await E.page.evaluate(() => document.documentElement.dataset.anim);
    await E.page.click('[data-anim-set="aus"]');
    const e1 = await E.page.evaluate(() => ({ anim: document.documentElement.dataset.anim, pressed: document.querySelector('[data-anim-set="aus"]').getAttribute('aria-pressed') }));
    check('blocked localStorage: "voll", and "Aus" still applies until reload, no errors', e0 === 'voll' && e1.anim === 'aus' && e1.pressed === 'true' && !errs.some(x => x.startsWith('S5')), { e0, e1, errs });
    await E.ctx.close();
    // Shared list, read-only viewer: may still choose (it is only this device), and nothing is written to the server.
    const srv = makeServer({ workers: SEED_W });
    const R = await phone(browser, srv, { name: 'S6', inClaude: true, writable: false, user: { id: 'u_ro', owner: false, can: false } }, { hash: '#jobs' });
    const rDis = await R.page.evaluate(() => ({ opt: document.getElementById('opt-calm').disabled, anim: [...document.querySelectorAll('[data-anim-set]')].some(b => b.disabled) }));
    const logLen = srv.log.length;
    await R.page.click('[data-anim-set="ruhig"]'); await R.page.waitForTimeout(150);
    check('read-only viewer: shared options locked, Animationen usable, nothing sent to the server', rDis.opt && !rDis.anim && srv.log.length === logLen
      && (await R.page.evaluate(() => document.documentElement.dataset.anim)) === 'ruhig', { rDis, log: srv.log.slice(logLen) });
    await R.ctx.close();
  }

  // ===== 2) Entry flow against the shared server in all three modes (+ reduced motion) =====
  for (const mode of ['voll', 'ruhig', 'aus', 'reduced']) {
    const srv = makeServer({ workers: SEED_W });
    const reduced = mode === 'reduced';
    // BUILD 11: reduced motion counts as "aus" only while nobody chose a level here, so nothing is stored for it.
    const P = (await phone(browser, srv, { name: 'E-' + mode, inClaude: true, writable: true, anim: reduced ? undefined : mode, user: { id: 'u_owner', owner: true, can: true } }, { reduced })).page;
    const T = `[${mode}] `;
    const sampleOff = async () => (reduced || mode === 'aus') ? animCount(P) : 0;
    let off = 0;
    off += await sampleOff();
    if (reduced) {
      await P.click('#tab-jobs');
      const note = await P.evaluate(() => { const n = document.getElementById('anim-rm'); return { hidden: n.hidden, text: n.textContent, anim: document.documentElement.dataset.anim }; });
      check(T + 'note "Euer Gerät wünscht weniger Bewegung, darum sind die Animationen von selbst aus. …" (nothing chosen: "aus")', !note.hidden && note.text === 'Euer Gerät wünscht weniger Bewegung, darum sind die Animationen von selbst aus. Wählt ihr hier eine Stufe, gilt eure Wahl.' && note.anim === 'aus', note);
      off += await sampleOff();
      await P.click('#tab-plan');
    }
    await P.evaluate(() => window.__sample());
    // A phase switch on the plan (sweep + rolls in voll only).
    await P.click('#panel-plan [data-phase="ausbau"]');
    await P.waitForTimeout(30);
    off += await sampleOff();
    await P.evaluate(() => window.__sample());
    const ph = await stuck(P);
    if (mode === 'ruhig' || mode === 'aus' || reduced) check(T + 'phase switch: no sweep, no rolling', ph.sweep === 0 && ph.odo === 0, ph);
    await P.waitForTimeout(150);
    off += await sampleOff();
    await P.click('#panel-plan [data-phase="start"]'); await P.waitForTimeout(1300);
    // Open the mode.
    await P.click('#entry-open'); await P.waitForTimeout(60);
    off += await sampleOff();
    await P.evaluate(() => window.__sample());
    const first = await nameOf(P);
    check(T + 'opens on Agnes, 1 / 4', first === 'Agnes' && (await countOf(P)) === '1 / 4', { first, count: await countOf(P) });
    if (mode === 'voll') {
      const r = await P.evaluate(() => [...document.querySelectorAll('.entry-card .er-to')].map(b => { const o = b.querySelector('.odo'); return { text: b.textContent, odo: !!o, roll: o ? o.dataset.roll : null, v: o ? o.querySelector('.odo-v').textContent : null }; }));
      const rolling = r.filter(x => x.odo);
      check(T + 'card appears: the changed numbers roll from "von 5" to the target (text stays the target)', rolling.length > 0 && rolling.every(x => x.v === x.text && (x.roll.split('\n').includes('5') || x.roll === '5') && (x.roll.split('\n').includes(x.text) || x.text === 'X')), r);
    }
    // Fertig: ticks through the shared tick-off, seal, then the next villager in time. A double tap counts once.
    // BUILD 11: the second tap no longer waits for the seal: it moves on at once (checked below, one write).
    const t0 = Date.now();
    await P.click('#entry-next');
    await P.waitForTimeout(mode === 'voll' ? 200 : 40);   // voll: the sparks fly when the seal lands (~160 ms)
    off += await sampleOff();
    await P.evaluate(() => window.__sample());
    const seal = await P.evaluate(() => { const s = document.querySelector('.entry-card .entry-seal'); return { shown: !!s && !s.hidden, landing: !!s && s.classList.contains('landing'), sparks: document.querySelectorAll('#entry-fx .spark').length, thump: document.querySelector('.entry-card').classList.contains('thump') }; });
    if (mode === 'voll') check(T + 'Fertig: the seal lands, the card thumps, 1–20 sparks', seal.shown && seal.landing && seal.thump && seal.sparks >= 1 && seal.sparks <= 20, seal);
    else check(T + 'Fertig: the seal shows, no sparks, no thump', seal.shown && seal.sparks === 0 && !seal.thump, seal);
    if (mode === 'voll') { const ov = await overflow(P); await P.waitForTimeout(120); const ov2 = await overflow(P); check(T + '390: no overflow while the seal lands and sparks fly', ov.doc <= 0 && ov.entry <= 0 && ov2.doc <= 0 && ov2.entry <= 0, { ov, ov2 }); }
    const moved = await until(async () => (await nameOf(P)) === 'Bertram', 2000, 10);
    const dt = Date.now() - t0;
    check(T + 'next villager within ~1.2 s', moved >= 0 && dt <= 1200, dt);
    check(T + 'Fertig wrote the shared ingame doc for Agnes (by u_owner)', srv.ingame.has('w_agnes') && srv.ingame.get('w_agnes').by === 'u_owner', [...srv.ingame.keys()]);
    await P.waitForTimeout(40);
    if (mode === 'voll') {
      const g = await P.evaluate(() => { const gh = document.querySelector('#entry-stage .entry-ghost'); return gh ? { cls: gh.className, inert: gh.inert, hidden: gh.getAttribute('aria-hidden'), ids: gh.querySelectorAll('[id]').length, acts: gh.querySelectorAll('[data-e]').length, first: document.querySelector('#entry-stage').firstElementChild.classList.contains('entry-card') } : null; });
      check(T + 'page turn: the old page is an inert, id-free ghost turning away; the real page comes first', g && /leaf-fwd/.test(g.cls) && g.inert && g.hidden === 'true' && g.ids === 0 && g.acts === 0 && g.first, g);
      await P.evaluate(() => document.getElementById('entry').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
      check(T + 'a tap during the turn finishes it at once', (await stuck(P)).ghost === 0 && (await P.evaluate(() => document.querySelector('.entry-card').className)) === 'entry-card leaf');
      check(T + 'focus is not held back by the turn (stays on the Fertig button)', await P.evaluate(() => document.activeElement && document.activeElement.id === 'entry-next'));
    } else {
      const s = await stuck(P);
      check(T + 'no ghost page, no rolling, no sparks', s.ghost === 0 && s.odo === 0 && s.spark === 0, s);
    }
    await P.waitForTimeout(300);
    check(T + 'Fertig counted once (2 / 4, one write)', (await countOf(P)) === '2 / 4' && srv.log.filter(l => l.c === 'ingame').length === 1, { count: await countOf(P), log: srv.log });
    // Zurück (page comes back), then on again with the arrow key.
    await P.click('#entry-back'); await P.waitForTimeout(30);
    off += await sampleOff();
    await P.evaluate(() => window.__sample());
    if (mode === 'voll') check(T + 'Zurück: the previous page turns back over the current one', await P.evaluate(() => !!document.querySelector('.entry-card.leaf-back') && !!document.querySelector('.entry-ghost.under')));
    check(T + 'Zurück: Agnes again (done, "Weiter ▶")', (await nameOf(P)) === 'Agnes' && (await P.$eval('#entry-next', b => b.textContent)) === 'Weiter ▶');
    await P.keyboard.press('ArrowRight'); await P.waitForTimeout(80);
    check(T + '→ goes on without ticking', (await nameOf(P)) === 'Bertram' && srv.log.filter(l => l.c === 'ingame').length === 1);
    // Tick the rest: the finale.
    for (let k = 0; k < 3; k++) { await P.click('#entry-next'); await until(async () => (await countOf(P)) === `${k + 3} / 4` || await P.evaluate(() => !document.getElementById('entry-finale').hidden), 1500, 10); await P.waitForTimeout(20); off += await sampleOff(); await P.evaluate(() => window.__sample()); }
    const fin0 = await P.evaluate(() => { const f = document.getElementById('entry-finale'); return { shown: !f.hidden, text: f.textContent, cls: f.className, sparks: f.querySelectorAll('.spark').length, banner: !!f.querySelector('.fin-banner .fin-cloth #entry-name') }; });
    check(T + 'finale: "Alle 4 eingetragen." on the banner', fin0.shown && fin0.text.startsWith('Alle 4 eingetragen.') && fin0.banner && /fin-all/.test(fin0.cls), fin0);
    check(T + 'all four ticked on the server', ['w_agnes', 'w_bertram', 'w_edda', 'w_godric'].every(id => srv.ingame.has(id)));
    if (mode === 'voll') {
      await P.waitForTimeout(700);
      const f1 = await P.evaluate(() => { const f = document.getElementById('entry-finale'); const bell = f.querySelector('.fin-bell'); return { sparks: f.querySelectorAll('.spark').length, cloth: f.querySelector('.fin-cloth').getAnimations().map(a => a.animationName), bell: bell.getAnimations().map(a => a.animationName) }; });
      check(T + 'finale: the banner unfurls, the bell rings, an ember fountain (<= 20 sparks since BUILD 11)', f1.sparks > 0 && f1.sparks <= 20 && f1.cloth.includes('unfurl') && f1.bell.includes('swing'), f1);
      const ov = await overflow(P);
      check(T + '390: no overflow during the finale', ov.doc <= 0 && ov.entry <= 0, ov);
      await P.screenshot({ path: 'anim-390-finale.png' });
      await P.waitForTimeout(2200);
      check(T + 'finale: sparks removed after use', (await stuck(P)).spark === 0, await stuck(P));
    } else {
      await P.waitForTimeout(400);
      check(T + 'finale: no fountain', (await stuck(P)).spark === 0);
    }
    off += await sampleOff();
    await P.evaluate(() => window.__sample());
    // Schließen.
    await P.click('#entry-next'); await P.waitForTimeout(100);
    check(T + 'Schließen closes the mode', await P.evaluate(() => document.getElementById('entry').hidden));
    // A toast and a tab switch, for the record.
    await P.click('#tab-arbeiter'); await P.waitForTimeout(30); off += await sampleOff(); await P.click('#tab-plan'); await P.waitForTimeout(30); off += await sampleOff();
    await P.evaluate(() => window.__sample());
    const seen = await P.evaluate(() => [...window.__seen.values()]);
    if (mode === 'aus' || reduced) check(T + 'no animations at all after every interaction (document.getAnimations() empty)', off === 0 && seen.length === 0, { off, seen: seen.slice(0, 5) });
    if (mode === 'ruhig') {
      const bad = seen.filter(a => !(a.iter < Infinity) || !(a.end <= 200));
      check(T + 'only short fades: no infinite or long animations (<= 200 ms)', seen.length > 0 && bad.length === 0, { bad: bad.slice(0, 6), n: seen.length });
    }
    if (mode === 'voll') {
      check(T + 'voll uses the full set (page turn, seal, rolls, finale)', ['leafAway', 'waxDrop', 'sparkFly', 'odoRoll', 'unfurl'].every(n => seen.some(a => a.name === n)), [...new Set(seen.map(a => a.name))]);
    }
    const em = await canvasSig(P); await P.waitForTimeout(300); const em2 = await canvasSig(P);
    if (mode === 'voll') check(T + 'embers drift on the page', em.n > 0 && em.h !== em2.h, { em, em2 });
    else check(T + 'no embers (canvas empty)', em.n === 0 && em2.n === 0, { em, em2 });
    const torch = await P.evaluate(() => document.querySelector('h1').getAnimations({ subtree: true }).map(a => a.animationName));
    if (mode === 'voll') check(T + 'title torch flickers (two loops on its glow layers)', torch.includes('torch') && torch.includes('torchCore'), torch);
    else check(T + 'no title flicker', torch.length === 0, torch);
    check(T + 'nothing stuck behind', JSON.stringify(await stuck(P)) === JSON.stringify({ sweep: 0, odo: 0, spark: 0, ghost: 0, leaf: 0 }), await stuck(P));
    await P.context().close();
  }

  // ===== 3) Plan in voll at 1280: rolling numbers and the phase-switch light (table and cards); ruhig: short fade =====
  for (const view of ['table', 'cards']) {
    const L = await phone(browser, null, { name: 'P-' + view, inClaude: false, anim: 'voll', seedLs: { 'bellwright-arbeitsplan-view': view } }, { width: 1280, height: 1000, hash: '#arbeiter' });
    const P = L.page;
    await P.click('#adopt-example'); await P.click('#tab-plan'); await P.waitForTimeout(900);
    await P.click('#mark-all'); await P.waitForTimeout(700);
    const before = await domVals(P);
    await P.click('#panel-plan [data-phase="ausbau"]');
    await P.waitForTimeout(20);
    const mid = await P.evaluate(() => ({
      sweeps: document.querySelectorAll('#plan-view .sweep').length,
      odo: [...document.querySelectorAll('#plan-view .odo')].map(o => { const el = o.parentElement; return { k: el.dataset.k || el.dataset.cell, text: el.textContent, v: o.querySelector('.odo-v').textContent, roll: o.dataset.roll, xf: o.classList.contains('xf'), dl: parseFloat(o.style.getPropertyValue('--dl')) }; }),
      bumps: document.querySelectorAll('#plan-view .bump').length }));
    const after = await domVals(P);
    const changedKeys = Object.keys(after).filter(k => after[k] !== before[k]);
    const okRoll = mid.odo.every(o => { const a = before[o.k], b = after[o.k]; if (o.xf) return o.roll === (a === 0 ? 'aus' : String(a)) && (b === 0 || a === 0); const d = o.roll.split('\n').map(Number); return d[0] === Math.min(a, b) && d[d.length - 1] === Math.max(a, b) && o.v === o.text; });
    check(`plan ${view}: phase switch draws the light sweep (${view === 'table' ? 'one layer' : 'per card on screen'})`, view === 'table' ? mid.sweeps === 1 : mid.sweeps >= 2, mid.sweeps);
    check(`plan ${view}: changed numbers roll old → new (no plain bump in voll)`, changedKeys.length > 0 && mid.odo.length > 0 && okRoll && mid.bumps === 0, { changed: changedKeys.length, odo: mid.odo.slice(0, 4), bumps: mid.bumps });
    check(`plan ${view}: staggered with the light (later columns/cards later)`, new Set(mid.odo.map(o => o.dl)).size > 1, mid.odo.map(o => o.dl).slice(0, 10));
    check(`plan ${view}: no overflow during the sweep`, (await overflow(P)).doc <= 0);
    await P.screenshot({ path: `anim-1280-sweep-${view}.png` });
    await P.waitForTimeout(1400);
    const end = await stuck(P);
    const final = await domVals(P);
    check(`plan ${view}: the sweep ends and leaves nothing behind`, end.sweep === 0 && end.odo === 0, end);
    check(`plan ${view}: rolled numbers end on the right value`, JSON.stringify(final) === JSON.stringify(after) && changedKeys.every(k => final[k] === after[k]), changedKeys.filter(k => final[k] !== after[k]));
    // An edit that is not a phase switch: the numbers roll, but no sweep.
    if (view === 'cards') {
      await P.click('#tab-jobs'); await P.click('#opt-weak'); await P.click('#tab-plan'); await P.waitForTimeout(30);
      check('plan: a change made on another tab does not leave rolls behind on hidden cards', (await stuck(P)).sweep === 0);
    }
    // Switch to ruhig on the fly: the next phase switch only fades the changed numbers.
    await P.click('#tab-jobs'); await P.click('[data-anim-set="ruhig"]'); await P.click('#tab-plan'); await P.waitForTimeout(300);
    await P.click('#panel-plan [data-phase="krieg"]'); await P.waitForTimeout(20);
    const calm = await P.evaluate(() => ({ sweep: document.querySelectorAll('.sweep').length, odo: document.querySelectorAll('.odo').length, bump: [...document.querySelectorAll('#plan-view .bump')].map(b => b.getAnimations().map(a => a.animationName + ':' + a.effect.getComputedTiming().endTime).join()) }));
    check(`plan ${view} ruhig: no sweep, no rolling, changed numbers fade (<= 150 ms since BUILD 11)`, calm.sweep === 0 && calm.odo === 0 && calm.bump.length > 0 && calm.bump.every(x => /^calmBlink:150$/.test(x)), calm);
    await L.ctx.close();
  }

  // ===== 4) Hidden page pauses everything; level change mid-effect stops it =====
  {
    const L = await phone(browser, null, { name: 'H', inClaude: false, anim: 'voll' }, { width: 390, hash: '#arbeiter' });
    const P = L.page;
    await P.click('#adopt-example'); await P.click('#tab-plan'); await P.waitForTimeout(700);
    await P.evaluate(() => window.__setHidden(true));
    const h = await P.evaluate(() => ({ cls: document.documentElement.classList.contains('motion-paused'), torch: document.querySelector('h1').getAnimations({ subtree: true }).map(a => a.playState) }));
    const c1 = await canvasSig(P); await P.waitForTimeout(250); const c2 = await canvasSig(P);
    check('hidden: html.motion-paused, the torch paused, embers stand still', h.cls && h.torch.length > 0 && h.torch.every(s => s === 'paused') && c1.h === c2.h, { h, c1, c2 });
    await P.evaluate(() => window.__setHidden(false));
    const v = await P.evaluate(() => ({ cls: document.documentElement.classList.contains('motion-paused'), torch: document.querySelector('h1').getAnimations({ subtree: true }).map(a => a.playState) }));
    const c3 = await canvasSig(P); await P.waitForTimeout(250); const c4 = await canvasSig(P);
    check('visible again: everything runs', !v.cls && v.torch.every(s => s === 'running') && c3.h !== c4.h, { v });
    // Entry open, Fertig, and switch to "aus" (another tab) while the seal lands: effects stop, flow goes on.
    await P.click('#entry-sticky button'); await P.waitForTimeout(100);
    await P.click('#entry-next'); await P.waitForTimeout(60);
    await P.evaluate(k => { localStorage.setItem(k, '"aus"'); window.dispatchEvent(new StorageEvent('storage', { key: k })); }, ANIM_KEY);
    const s = await stuck(P);
    check('level drops to "aus" mid-effect: sparks and rolls gone at once', s.spark === 0 && s.odo === 0, s);
    const moved = await until(async () => (await countOf(P)).startsWith('2 /'), 1500);
    check('...and the flow goes on (next villager)', moved >= 0);
    check('...with no animation left', (await animCount(P)) === 0, await P.evaluate(() => document.getAnimations().map(a => a.animationName)));
    await L.ctx.close();
  }

  // ===== 5) Overflow at 360 / 390 / 1280 through seal, page turn and finale (voll) =====
  for (const [w, h] of [[360, 740], [390, 844], [1280, 900]]) {
    const seedLs = { [LS_KEY]: { settings: null, workers: Object.entries(SEED_W).map(([id, x]) => ({ id, ...x })) } };
    const L = await phone(browser, null, { name: 'O' + w, inClaude: false, anim: 'voll', seedLs }, { width: w, height: h });
    const P = L.page;
    await P.click('#entry-open'); await P.waitForTimeout(80);
    let worst = { doc: 0, entry: 0 };
    const take = async () => { const o = await overflow(P); worst = { doc: Math.max(worst.doc, o.doc), entry: Math.max(worst.entry, o.entry) }; };
    for (let k = 0; k < 4; k++) {
      await P.click('#entry-next');
      for (const t of [80, 200, 250, 250, 250]) { await P.waitForTimeout(t); await take(); }
    }
    for (const t of [200, 400, 600]) { await P.waitForTimeout(t); await take(); }
    check(`${w}: no horizontal overflow at any moment (page and overlay)`, worst.doc <= 0 && worst.entry <= 0, worst);
    if (w === 360 || w === 1280) await P.screenshot({ path: `anim-${w}-finale.png` });
    await L.ctx.close();
  }

  // ===== 6) Review fixes: a level change replays nothing; the page behind the mode waits; partial-finale ghost; scrolling =====
  {
    const seedLs = { [LS_KEY]: { settings: null, workers: Object.entries(SEED_W).map(([id, x]) => ({ id, ...x })) } };
    const L = await phone(browser, null, { name: 'F', inClaude: false, anim: 'voll', seedLs }, { width: 390, height: 844 });
    const P = L.page;
    const named = () => P.evaluate(() => document.getAnimations().filter(a => !(a instanceof CSSTransition)).map(a => a.animationName + '@' + (a.effect.target.id || a.effect.target.className)));
    await P.click('#tab-jobs'); await P.waitForTimeout(900);
    await P.click('[data-anim-set="ruhig"]'); await P.waitForTimeout(20);
    const r1 = await named();
    await P.waitForTimeout(300); await P.click('[data-anim-set="voll"]'); await P.waitForTimeout(20);
    const r2 = (await named()).filter(x => !/^torch/.test(x));
    check('level change: the page intro and the tab fade do not play again', r1.length === 0 && r2.length === 0, { r1, r2 });
    // In "aus" the one-shot classes stay (no animationend); back in "voll" they must not all fire at once.
    await P.click('[data-anim-set="aus"]'); await P.click('#tab-plan'); await P.waitForTimeout(100);
    await P.click('#panel-plan [data-phase="ausbau"]'); await P.waitForTimeout(200);
    const left = await P.evaluate(() => ({ bump: document.querySelectorAll('.bump').length, ring: document.getElementById('bell').classList.contains('ring') }));
    await P.click('#tab-jobs'); await P.click('[data-anim-set="voll"]'); await P.click('#tab-plan'); await P.waitForTimeout(20);
    const fired = (await named()).filter(x => /^(bump|swing|stamp|toastin)/.test(x));
    check('"aus" -> "voll": the old flashes and the bell do not go off', left.bump > 0 && fired.length === 0 && (await P.evaluate(() => document.querySelectorAll('.bump').length)) === 0, { left, fired });
    await P.click('#panel-plan [data-phase="start"]'); await P.waitForTimeout(1300);
    // The page behind the mode: its loops wait while the mode covers it.
    await P.click('#entry-open'); await P.waitForTimeout(100);
    const behind = await P.evaluate(() => document.querySelector('h1').getAnimations({ subtree: true }).map(a => a.playState));
    check('mode open: the title torch behind it is paused', behind.length > 0 && behind.every(s => s === 'paused'), behind);
    // Partial finale -> "Noch offene ansehen": the copy of the finale stays as it is under the page coming back.
    await P.click('#entry-next'); await P.waitForTimeout(1300);
    for (let k = 0; k < 3; k++) { await P.click('[data-e="skip"]'); await P.waitForTimeout(700); }
    const part = await P.evaluate(() => document.getElementById('entry-finale').className);
    await P.click('[data-e="first-open"]'); await P.waitForTimeout(30);
    const gh = await P.evaluate(() => [...document.querySelectorAll('.entry-ghost')].map(g => g.getAnimations({ subtree: false }).length));
    check('partial finale -> back: its copy does not fade in again under the turning page', /fin-part/.test(part) && gh.length === 1 && gh[0] === 0, { part, gh });
    await P.waitForTimeout(600);
    await P.keyboard.press('Escape'); await P.waitForTimeout(100);
    const after = await P.evaluate(() => document.querySelector('h1').getAnimations({ subtree: true }).map(a => a.playState));
    check('mode closed: the title torch runs again', after.length > 0 && after.every(s => s === 'running'), after);
    await L.ctx.close();
    // Reduced motion (and ruhig/aus): scrolling to a card jumps instead of gliding.
    // BUILD 11: with reduced motion and nothing chosen on this device the level is "aus" (nothing stored for that case).
    for (const [mode, reduced] of [['voll', true], ['ruhig', false], ['voll', false]]) {
      const M = await phone(browser, null, { name: 'S-' + mode, inClaude: false, anim: reduced ? undefined : mode, seedLs: { ...seedLs, 'bellwright-arbeitsplan-view': 'cards' } }, { width: 1280, height: 700, reduced });
      await M.page.evaluate(() => { const o = Element.prototype.scrollIntoView; window.__sv = []; Element.prototype.scrollIntoView = function (a) { window.__sv.push(a && a.behavior); return o.call(this, a); }; });
      await M.page.click('#chips .chip'); await M.page.waitForTimeout(100);
      const sv = await M.page.evaluate(() => window.__sv);
      const want = mode === 'voll' && !reduced ? 'smooth' : 'auto';
      check(`scroll to a card (${reduced ? 'reduced motion' : mode}): ${want}`, sv.length > 0 && sv.every(b => b === want), sv);
      await M.ctx.close();
    }
  }

  check('no page errors or console errors', errs.length === 0, errs);
  console.log(`feat-anim: ${passes} passed, ${fails.length} failed`);
  for (const f of fails) console.log('FAIL ' + f);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();

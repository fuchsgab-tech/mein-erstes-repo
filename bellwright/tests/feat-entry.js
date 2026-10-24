// BUILD 3 "Eintragen-Modus am Fernseher": one villager per screen, Fertig ticks through the shared 'ingame' collection,
// live plan follow-up, wake lock, resume banner, focus handling, layout at 360/390/landscape/1280, reduced motion.
// Phones are separate browser contexts sharing one fake server in node (per-collection docs and listeners),
// the same pattern as feat-ingame.js. navigator.wakeLock is stubbed per phone: 'ok' | 'deny' | 'none'.
const { chromium } = require('playwright');
// BUILD 13: while villagers have open numbers, the banner's "Jetzt im Spiel eintragen" replaces the grid-head button
// (and the sticky bar waits until the banner is scrolled away), so the mode opens through whichever trigger is visible.
const ENTRY_OPEN = '#entry-banner-go:visible, #entry-open:visible';

const AP_KEY = 'bellwright-arbeitsplan-eingetragen-v1';
const LS_KEY = 'bellwright-arbeitsplan-v1';
const ENTRY_KEY = 'bellwright-eintragen-v1';
const TIP_KEY = 'bellwright-sperre-tipp-v1';
const DIR = { u_owner: 'Gabriel', u_lena: 'Lena', u_ro: 'Ida' };
const st = o => Object.fromEntries(Object.entries(o).map(([k, [cur, max]]) => [k, { cur, max }]));
const SEED_W = {
  w_agnes: { name: 'Agnes', role: 'worker', traits: 'Optimist', order: 1, stats: st({ labourer: [3, 5], harvesting: [6, 9], farming: [2, 4], cooking: [1, 3], crafting: [2, 6], researching: [0, 2], hunting: [5, 8] }) },
  w_bertram: { name: 'Bertram', role: 'worker', traits: 'Resilient', order: 2, stats: st({ labourer: [7, 9], harvesting: [4, 6], farming: [1, 3], cooking: [2, 4], crafting: [3, 5], researching: [1, 3], hunting: [2, 4] }) },
  w_edda: { name: 'Edda', role: 'worker', traits: '', order: 3, stats: st({ labourer: [2, 4], harvesting: [1, 3], farming: [3, 6], cooking: [8, 10], crafting: [2, 4], researching: [3, 5], hunting: [0, 2] }) },
  w_godric: { name: 'Godric', role: 'worker', traits: 'Prodigy', order: 4, stats: st({ labourer: [3, 6], harvesting: [3, 5], farming: [2, 4], cooking: [1, 4], crafting: [6, 10], researching: [4, 7], hunting: [1, 3] }) },
  w_hilde: { name: 'Hilde', role: 'worker', traits: '', order: 5, stats: st({ labourer: [2, 5], harvesting: [2, 5], farming: [7, 9], cooking: [4, 6], crafting: [1, 3], researching: [2, 4], hunting: [3, 6] }) },
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));

// ---------- the shared fake server (node side): one map per collection ----------
function makeServer(seed = {}) {
  const srv = { workers: new Map(), settings: new Map(), ingame: new Map(), prefs: new Map(), log: [], pages: new Set() };
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) srv[c].set(id, clone(d));
  srv.docs = c => [...srv[c]].map(([id, d]) => [id, clone(d)]);
  srv.broadcast = c => { const docs = srv.docs(c); for (const p of srv.pages) p.evaluate(([c, docs]) => window.__deliver && window.__deliver(c, docs), [c, docs]).catch(() => {}); };
  srv.write = async (who, op, c, id, d) => {
    await sleep(80);
    if (op === 'set') srv[c].set(id, clone(d)); else srv[c].delete(id);
    srv.log.push({ who, op, c, id });
    setTimeout(() => srv.broadcast(c), 10);
  };
  return srv;
}

// ---------- page side ----------
// cfg: { name, inClaude, writable, wake: 'ok'|'deny'|'none', user: null | { id, owner, can }, dir, seedLs }
function STUB(cfg) {
  // Wake lock stub (counts requests and releases; a sentinel can be released by "the system").
  window.__wake = { req: 0, rel: 0, s: [] };
  if (cfg.wake === 'none') { try { delete Navigator.prototype.wakeLock; } catch (e) { /* ignore */ } }
  else if (cfg.wake) {
    const fake = { request: async type => {
      window.__wake.req++;
      if (cfg.wake === 'deny') throw new DOMException('not allowed', 'NotAllowedError');
      const s = new EventTarget();
      s.type = type; s.released = false;
      s.release = async () => { if (s.released) return; s.released = true; window.__wake.rel++; s.dispatchEvent(new Event('release')); };
      window.__wake.s.push(s);
      return s;
    } };
    Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => fake });
  }
  window.__setHidden = h => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  if (cfg.seedLs && !sessionStorage.getItem('__seeded')) {
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(cfg.seedLs)) localStorage.setItem(k, JSON.stringify(v));
  }
  if (!cfg.inClaude) return;
  const colL = new Map(), docL = new Map();
  const list = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const clone = d => JSON.parse(JSON.stringify(d));
  const snapC = docs => ({ docs: docs.map(([id, d]) => ({ id, exists: true, data: () => clone(d), metadata: {} })), size: docs.length, empty: !docs.length, metadata: {}, docChanges: () => [] });
  const snapD = (docs, id) => { const e = docs.find(x => x[0] === id); return { id, exists: !!e, data: () => (e ? clone(e[1]) : undefined), metadata: {} }; };
  window.__deliver = (c, docs) => {
    for (const f of colL.get(c) || []) f(snapC(docs));
    for (const [k, fs] of docL) if (k.startsWith(c + '/')) for (const f of fs) f(snapD(docs, k.slice(c.length + 1)));
  };
  window.__refused = 0;
  const refuse = () => { window.__refused++; return Promise.reject({ code: 'invalid_argument', message: 'below the write level' }); };
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
    isOwner: async () => !!u.owner,
    id: async () => u.id || null,
    can: async n => (n === 'data.write' ? u.can : false),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: (cfg.dir || {})[i] || '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : null) };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); };
const errs = [];

async function phone(browser, srv, cfg, { width = 390, height = 800, reduced = false, hash = '' } = {}) {
  const mobile = width < 900;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push((cfg.name || '?') + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push((cfg.name || '?') + ' console: ' + m.text()); });
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
async function until(fn, max = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(40); }
  return -1;
}

// Everything the overlay shows, read from the DOM.
const E = page => page.evaluate(() => {
  const box = document.getElementById('entry');
  const q = s => box.querySelector(s);
  const vis = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const rows = [...box.querySelectorAll('.entry-card .er-row')].map(r => {
    const diff = r.classList.contains('diff');
    const job = diff ? r.dataset.job : null;
    return { diff, job, label: r.querySelector('.er-job').firstChild.textContent, from: diff ? r.querySelector('.er-from').textContent.replace('→', '').trim() : null,
      to: diff ? r.querySelector('.er-to').textContent : r.querySelector('.er-keep').textContent, pressed: r.getAttribute('aria-pressed') };
  });
  const nm = document.getElementById('entry-name');
  return {
    open: !box.hidden, name: nm ? nm.textContent : null, count: q('#entry-count').textContent.replace(/\s+/g, ' ').replace(' von / ', ' / '),
    next: q('#entry-next').textContent, backDisabled: q('#entry-back').getAttribute('aria-disabled') === 'true',
    chip: (q('.entry-chip') || {}).textContent || '', skip: vis(q('[data-e="skip"]')), undo: vis(q('[data-e="undo"]')),
    where: (q('.ep-where') || {}).textContent || '', isNew: vis(q('.ep-new')), changed: vis(q('.ep-changed')),
    seal: vis(q('.entry-card .entry-seal')), done: vis(q('.ep-done')), finale: vis(q('#entry-finale')), finaleText: q('#entry-finale').textContent,
    dots: [...box.querySelectorAll('#entry-dots i')].map(i => i.className), dotsShown: vis(q('#entry-dots')),
    awake: vis(q('#entry-awake')), tip: vis(q('#entry-tip')), ro: vis(q('#entry-ro')),
    whyItems: box.querySelectorAll('.ep-why li').length, rows,
    active: document.activeElement && (document.activeElement.id || document.activeElement.className || document.activeElement.tagName),
    activeInside: box.contains(document.activeElement),
  };
});
// The plan behind the overlay: values per job of one villager's card ('aus' -> 0).
const planVals = (page, wid) => page.evaluate(wid => Object.fromEntries([...document.querySelectorAll(`#wp-${wid} .pbadge[data-k]`)].map(b => [b.dataset.k.split('|')[1], b.textContent === 'aus' ? 0 : +b.textContent])), wid);
const xt = v => (v === 0 ? 'X' : String(v));
const canvasSig = page => page.evaluate(() => { const c = document.getElementById('embers'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 3; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; });
const openOrder = page => page.evaluate(() => [...document.querySelectorAll('.wp-card')].filter(c => c.querySelector('.pbadge.chg') || !c.querySelector('.applied-ok')).map(c => c.id.slice(3)));

(async () => {
  const browser = await chromium.launch();

  // ===== 1) Local mode on a phone: example team, open count, the mode itself, Fertig, Zurück, resume, finale =====
  {
    const L = await phone(browser, null, { name: 'L', inClaude: false, wake: 'ok' }, { hash: '#plan' });
    const P = L.page;
    check('example team: no entry button, no sticky bar', await P.evaluate(() => document.getElementById('entry-open').hidden && document.getElementById('entry-sticky').hidden));
    await P.click('#tab-arbeiter'); await P.click('#adopt-example'); await P.click('#tab-plan'); await P.waitForTimeout(200);
    const b0 = await P.evaluate(() => ({ t: document.getElementById('entry-open').textContent, h: document.getElementById('entry-open').hidden, sticky: getComputedStyle(document.getElementById('entry-sticky')).position, stickyHidden: document.getElementById('entry-sticky').hidden, inHead: !!document.querySelector('.grid-head #entry-open'), banner: !document.getElementById('entry-banner').hidden }));
    // BUILD 13: the banner at the top replaces the head button (which keeps its label) and the sticky bar waits until the banner is scrolled away.
    check('adopted: the banner replaces the head button "Im Spiel eintragen (7 offen)" in .grid-head', b0.h && b0.banner && b0.inHead && b0.t === 'Im Spiel eintragen (7 offen)', b0);
    await P.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await P.waitForTimeout(250);
    const b1 = await P.evaluate(() => ({ sticky: getComputedStyle(document.getElementById('entry-sticky')).position, stickyHidden: document.getElementById('entry-sticky').hidden }));
    check('coarse pointer: sticky bar at the bottom of the Plan panel (banner scrolled away)', !b1.stickyHidden && b1.sticky === 'sticky', b1);
    await P.evaluate(() => window.scrollTo(0, 0)); await P.waitForTimeout(150);
    await P.click('#mark-all'); await P.waitForTimeout(150);
    check('everyone ticked: button and bar hidden', await P.evaluate(() => document.getElementById('entry-open').hidden && document.getElementById('entry-sticky').hidden));
    await P.click('#panel-plan [data-phase="ausbau"]'); await P.waitForTimeout(200);
    const order = await openOrder(P);
    const label = await P.$eval('#entry-open', e => e.textContent);
    check('phase switch: button shows "(n offen)"', order.length > 0 && label === `Im Spiel eintragen (${order.length} offen)`, { label, order });
    await P.screenshot({ path: 'entry-plan-390.png' });
    const snaps = await P.evaluate(k => JSON.parse(localStorage.getItem(k)), AP_KEY);
    const before = clone(snaps);

    // Open from the sticky bar (BUILD 13: it shows once the banner is scrolled away).
    await P.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await P.waitForTimeout(250);
    await P.click('#entry-sticky button'); await P.waitForTimeout(200);
    let e = await E(P);
    const dlg = await P.evaluate(() => { const d = document.getElementById('entry'); return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), lb: d.getAttribute('aria-labelledby'), z: getComputedStyle(d).zIndex, pos: getComputedStyle(d).position, oy: getComputedStyle(d).overflowY, inert: document.querySelector('.wrap').inert, htmlOv: getComputedStyle(document.documentElement).overflow, bg: getComputedStyle(d).backgroundColor }; });
    check('dialog: role/aria-modal/labelledby, fixed, z 20, own scroll, page locked', dlg.role === 'dialog' && dlg.modal === 'true' && dlg.lb === 'entry-name' && dlg.pos === 'fixed' && dlg.z === '20' && dlg.oy === 'auto' && dlg.inert && dlg.htmlOv === 'hidden', dlg);
    const firstName = await P.evaluate(id => document.querySelector(`#wp-${id} h3`).firstChild.textContent, order[0]);
    check('opens on the first open villager in roster order, focus on the name', e.open && e.name === firstName && e.active === 'entry-name', { e: e.name, firstName, active: e.active });
    check('progress "1 / n" with dots, current marked', e.count === `1 / ${order.length}` && e.dots.length === order.length && e.dots[0].includes('cur'), { count: e.count, dots: e.dots });
    // 'von' equals the snapshot, the badge equals the plan cell.
    const pv = await planVals(P, order[0]);
    const jobsShown = e.rows.length;
    let mism = [];
    const jobIds = Object.keys(pv);
    e.rows.forEach((r, i) => {
      const job = jobIds[i];
      const want = pv[job], from = before[order[0]][job];
      if (r.diff) { if (r.job !== job || r.to !== xt(want) || r.from !== 'von ' + xt(from) || from === want) mism.push([job, r, want, from]); }
      else if (r.to !== 'bleibt ' + xt(want) || from !== want) mism.push([job, r, want, from]);
    });
    check('rows in plan order: "von" = snapshot, badge = plan cell, same rows say "bleibt"', jobsShown === jobIds.length && !mism.length, mism.slice(0, 3));
    const nDiff = e.rows.filter(r => r.diff).length;
    check('chip "n Zahlen ändern"', e.chip === `${nDiff} ${nDiff === 1 ? 'Zahl' : 'Zahlen'} ändern`, e.chip);
    check('header: where line, no new-villager line (has a snapshot), Überspringen', e.where === `Im Spiel: Bevölkerung → ${firstName} → Arbeitsprioritäten` && !e.isNew && e.skip, e);
    check('why details: one item per row', e.whyItems === jobsShown, e.whyItems);
    const sizes = await P.evaluate(() => {
      const d = document.querySelector('.er-row.diff'), s = document.querySelector('.er-row.same'), b = document.querySelector('.er-row.diff .er-to');
      const cs = getComputedStyle(d), bs = getComputedStyle(b), ss = s && getComputedStyle(s);
      return { dH: d.getBoundingClientRect().height, border: cs.borderLeftColor, bw: cs.borderLeftWidth, bW: b.getBoundingClientRect().width, bH: b.getBoundingClientRect().height, bF: bs.fontSize, jobF: getComputedStyle(d.querySelector('.er-job')).fontSize,
        sH: s ? s.getBoundingClientRect().height : null, sO: ss ? ss.opacity : null, x: document.querySelectorAll('.er-row .er-to.p0').length ? document.querySelector('.er-row .er-to.p0').textContent : 'none',
        xLabel: [...document.querySelectorAll('.er-row.diff')].map(r => r.getAttribute('aria-label')).find(l => /aus – im Spiel X/.test(l)) || '' };
    });
    check('change rows: >= 56px, ember left border, label 18px, badge 64x56 at 32px', sizes.dH >= 56 && sizes.bw === '4px' && sizes.border === 'rgb(240, 138, 60)' && sizes.jobF === '18px' && sizes.bW === 64 && sizes.bH === 56 && sizes.bF === '32px', sizes);
    check('same rows: 36px, opacity .5', sizes.sH === null || (Math.round(sizes.sH) === 36 && sizes.sO === '0.5'), sizes);
    check('0 shows as X with "aus – im Spiel X"', sizes.x === 'none' || (sizes.x === 'X' && sizes.xLabel !== ''), sizes);
    // Row toggle: session check, line-through and tick.
    await P.click('.er-row.diff');
    const tog = await P.evaluate(() => { const r = document.querySelector('.er-row.diff'); return { p: r.getAttribute('aria-pressed'), td: getComputedStyle(r.querySelector('.er-job')).textDecorationLine, tick: getComputedStyle(r.querySelector('.er-check'), '::after').content, focus: document.activeElement === r }; });
    check('tap on a row: checked, line-through, ✓, focus kept', tog.p === 'true' && tog.td === 'line-through' && tog.tick === '"✓"' && tog.focus, tog);
    await P.click('.er-row.diff');
    check('tap again: unchecked', (await P.$eval('.er-row.diff', r => r.getAttribute('aria-pressed'))) === 'false');
    // Screen stays on, embers paused.
    check('wake lock: requested once, pill shown, no tip', e.awake && !e.tip && (await P.evaluate(() => window.__wake.req)) === 1, { awake: e.awake, tip: e.tip });
    const s1 = await canvasSig(P); await P.waitForTimeout(350); const s2 = await canvasSig(P);
    check('embers paused while open', s1 === s2);
    // Bottom bar.
    const bar = await P.evaluate(() => { const b = document.getElementById('entry-back').getBoundingClientRect(), n = document.getElementById('entry-next').getBoundingClientRect(), bar = document.querySelector('.entry-bar'), inn = document.querySelector('.entry-bar-in').getBoundingClientRect(), x = document.querySelector('[data-e="close"]').getBoundingClientRect();
      return { bw: b.width / inn.width, nh: n.height, bh: b.height, bottom: bar.getBoundingClientRect().bottom, vh: innerHeight, pos: getComputedStyle(bar).position, pb: parseFloat(getComputedStyle(bar).paddingBottom), x: [x.width, x.height], xl: document.querySelector('[data-e="close"]').getAttribute('aria-label') }; });
    check('bar: fixed at the bottom, Zurück ~30 %, Fertig >= 64px, padding >= 12px', bar.pos === 'fixed' && Math.abs(bar.bottom - bar.vh) < 1 && bar.bw > 0.27 && bar.bw < 0.31 && bar.nh >= 64 && bar.bh >= 64 && bar.pb >= 12, bar);
    check('✕ is 44x44 with aria-label "Schließen"', bar.x[0] >= 44 && bar.x[1] >= 44 && bar.xl === 'Schließen', bar);
    check('bar labels: "Fertig – weiter ▶", Zurück disabled on the first', e.next === 'Fertig – weiter ▶' && e.backDisabled, e);
    check('390: no horizontal scroll (page and overlay)', await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('entry').scrollWidth <= document.getElementById('entry').clientWidth));
    await P.screenshot({ path: 'entry-390.png' });
    // Tab stays inside the dialog.
    let out = 0;
    for (let k = 0; k < 30; k++) { await P.keyboard.press('Tab'); if (!(await P.evaluate(() => document.getElementById('entry').contains(document.activeElement)))) out++; }
    for (let k = 0; k < 12; k++) { await P.keyboard.press('Shift+Tab'); if (!(await P.evaluate(() => document.getElementById('entry').contains(document.activeElement)))) out++; }
    check('Tab and Shift+Tab stay inside the dialog', out === 0, out);

    // Fertig: ticks (AP_KEY in local mode), seal, then the next villager.
    await P.click('#entry-next');
    const mid = await E(P);
    check('Fertig: seal shown, label kept while it lands', mid.seal && mid.next === 'Fertig – weiter ▶', { seal: mid.seal, next: mid.next });
    const ap1 = await P.evaluate(k => JSON.parse(localStorage.getItem(k)), AP_KEY);
    check('Fertig: snapshot = the plan values', JSON.stringify(ap1[order[0]]) === JSON.stringify(pv), { got: ap1[order[0]], pv });
    await P.waitForTimeout(950);
    e = await E(P);
    const secondName = await P.evaluate(id => document.querySelector(`#wp-${id} h3`).firstChild.textContent, order[1]);
    check('Fertig: moves on to the next villager, first dot done', e.name === secondName && e.count === `2 / ${order.length}` && e.dots[0].includes('done') && e.dots[1].includes('cur'), { name: e.name, count: e.count, dots: e.dots });
    check('plan behind: first card sealed', await P.evaluate(id => !!document.querySelector(`#wp-${id} .applied-ok`), order[0]));
    const rs = await P.evaluate(k => JSON.parse(localStorage.getItem(k)), ENTRY_KEY);
    check('resume key written on every step {ids, i, at}', rs && JSON.stringify(rs.ids) === JSON.stringify(order) && rs.i === 1 && Math.abs(Date.now() - rs.at) < 5000, rs);
    // Überspringen writes nothing.
    await P.click('[data-e="skip"]'); await P.waitForTimeout(100);
    e = await E(P);
    const ap2 = await P.evaluate(k => JSON.parse(localStorage.getItem(k)), AP_KEY);
    check('Überspringen: next villager, nothing written, focus on the name', e.count === `3 / ${order.length}` && JSON.stringify(ap2[order[1]]) === JSON.stringify(before[order[1]]) && e.active === 'entry-name', { count: e.count, active: e.active });
    // Arrow keys: back and on, never ticking.
    await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(80);
    const left = await E(P);
    await P.keyboard.press('ArrowRight'); await P.waitForTimeout(80);
    const right = await E(P);
    const ap3 = await P.evaluate(k => JSON.parse(localStorage.getItem(k)), AP_KEY);
    check('←/→ go back and forward without ticking', left.count === `2 / ${order.length}` && right.count === `3 / ${order.length}` && JSON.stringify(ap3) === JSON.stringify(ap2) && (await P.$eval('#entry-stage', s => s.dataset.dir)) === 'forward', { l: left.count, r: right.count });
    // Back to the first: done, can be taken back.
    await P.click('#entry-back'); await P.waitForTimeout(80);
    check('Zurück: data-dir back', (await P.$eval('#entry-stage', s => s.dataset.dir)) === 'back');
    await P.click('#entry-back'); await P.waitForTimeout(80);
    e = await E(P);
    check('back on a ticked villager: "Alles passt schon", seal line, "Weiter ▶", undo link', e.name === firstName && e.chip === 'Alles passt schon' && e.done && e.next === 'Weiter ▶' && e.undo && !e.skip && e.rows.every(r => !r.diff), e);
    await P.screenshot({ path: 'entry-390-done.png' });
    await P.click('[data-e="undo"]'); await P.waitForTimeout(100);
    e = await E(P);
    const ap4 = await P.evaluate(k => JSON.parse(localStorage.getItem(k)), AP_KEY);
    check('"Abhaken zurücknehmen" restores the old snapshot', JSON.stringify(ap4[order[0]]) === JSON.stringify(before[order[0]]) && e.rows.some(r => r.diff) && e.next === 'Fertig – weiter ▶' && e.activeInside, { e: e.next, active: e.active });
    // Fertig again on #1, then on #2: now at #3.
    await P.click('#entry-next'); await P.waitForTimeout(950);
    await P.click('#entry-next'); await P.waitForTimeout(950);
    e = await E(P);
    check('two more Fertig: at 3 / n', e.count === `3 / ${order.length}`, e.count);

    // Reload halfway: the resume banner.
    await P.reload(); await P.waitForTimeout(600);
    const thirdName = await P.evaluate(id => document.querySelector(`#wp-${id} h3`).firstChild.textContent, order[2]);
    const ban = await P.evaluate(() => ({ h: document.getElementById('entry-resume').hidden, t: document.getElementById('entry-resume-text').textContent, entry: document.getElementById('entry').hidden }));
    check('reload halfway: "Weitermachen bei {Name} (3/n)"', !ban.h && ban.entry && ban.t === `Weitermachen bei ${thirdName} (3/${order.length})`, ban);
    await P.click('#entry-resume-go'); await P.waitForTimeout(200);
    e = await E(P);
    check('Weiter: the mode opens at that villager', e.open && e.name === thirdName && e.count === `3 / ${order.length}` && e.dots[0].includes('done') && e.dots[1].includes('done'), { name: e.name, count: e.count, dots: e.dots });
    check('banner gone once the mode opened', await P.evaluate(() => document.getElementById('entry-resume').hidden));
    // Escape closes, focus goes back (the banner button is gone, so the entry button), wake lock released, embers run.
    const relBefore = await P.evaluate(() => window.__wake.rel);
    await P.keyboard.press('Escape'); await P.waitForTimeout(150);
    const cl = await P.evaluate(() => ({ hidden: document.getElementById('entry').hidden, cls: document.documentElement.className, inert: document.querySelector('.wrap').inert, active: document.activeElement.id, rel: window.__wake.rel }));
    // BUILD 13: the resume banner is gone, the new banner (still open villagers) took over: its button gets the focus.
    check('Escape closes: page unlocked, wake lock released, focus to the entry button', cl.hidden && !cl.cls.includes('entry-open') && !cl.inert && cl.rel === relBefore + 1 && cl.active === 'entry-banner-go', cl);
    const c1 = await canvasSig(P); await P.waitForTimeout(250); const c2 = await canvasSig(P);
    check('embers run again after closing', c1 !== c2);
    // Open by the title button, close with ✕: focus back on the opener.
    const opener = await P.evaluate(() => ['entry-banner-go', 'entry-open'].find(id => !document.getElementById(id).closest('[hidden]')));
    await P.click(ENTRY_OPEN); await P.waitForTimeout(150);
    await P.click('[data-e="close"]'); await P.waitForTimeout(100);
    check('✕ closes, focus back on the opener', !!opener && await P.evaluate(id => document.getElementById('entry').hidden && document.activeElement.id === id, opener));
    // Finale: tick everyone that is left.
    await P.click(ENTRY_OPEN); await P.waitForTimeout(150);
    const nLeft = (await openOrder(P)).length;
    for (let k = 0; k < nLeft; k++) {
      const s = await E(P);
      if (k === nLeft - 1) check('last villager: "Fertig"', s.next === 'Fertig', s.next);
      await P.click('#entry-next'); await P.waitForTimeout(950);
    }
    e = await E(P);
    check('finale: "Alle n eingetragen." and "Schließen"', e.finale && e.finaleText.startsWith(`Alle ${nLeft} eingetragen.`) && e.next === 'Schließen' && e.dots.every(d => d.includes('done')), { f: e.finaleText, next: e.next, dots: e.dots });
    check('finale: resume key removed', (await P.evaluate(k => localStorage.getItem(k), ENTRY_KEY)) === null);
    await P.screenshot({ path: 'entry-390-finale.png' });
    await P.click('#entry-next'); await P.waitForTimeout(150);
    const fin = await P.evaluate(() => ({ hidden: document.getElementById('entry').hidden, btn: document.getElementById('entry-open').hidden, active: document.activeElement.id }));
    check('Schließen: closed, no button (nothing open), focus on the plan title', fin.hidden && fin.btn && fin.active === 'plan-title', fin);
    // Close midway, reload, dismiss the banner with ×.
    // (BUILD 4: with "Plan ruhig halten" Ausbau → Start only changes one villager, so this goes to Aufrüsten,
    // which leaves several open, as the test needs.)
    await P.click('#panel-plan [data-phase="krieg"]'); await P.waitForTimeout(150);
    await P.click(ENTRY_OPEN); await P.waitForTimeout(150);
    await P.keyboard.press('ArrowRight'); await P.keyboard.press('Escape');
    await P.reload(); await P.waitForTimeout(600);
    check('closed midway: banner after reload', !(await P.evaluate(() => document.getElementById('entry-resume').hidden)));
    await P.click('#entry-resume-x');
    check('× hides the banner and forgets the place', await P.evaluate(k => document.getElementById('entry-resume').hidden && localStorage.getItem(k) === null, ENTRY_KEY));
    // An old place (> 3 h) is not offered.
    await P.evaluate(([k, ids]) => localStorage.setItem(k, JSON.stringify({ ids, i: 0, at: Date.now() - 4 * 3600e3 })), [ENTRY_KEY, await openOrder(P)]);
    await P.reload(); await P.waitForTimeout(600);
    check('older than 3 h: no banner', await P.evaluate(() => document.getElementById('entry-resume').hidden));
    // All jobs off: no button.
    await P.click('#tab-jobs');
    for (const id of await P.$$eval('#jobrows input[type="checkbox"]', els => els.filter(e => e.checked).map(e => e.id))) await P.click('#' + id);
    await P.click('#tab-plan'); await P.waitForTimeout(150);
    check('all jobs off: button hidden', await P.evaluate(() => document.getElementById('entry-open').hidden && document.getElementById('entry-sticky').hidden));
    await L.ctx.close();
  }

  // ===== 2) Wake lock refused / missing: the tip once per device; re-request after the screen comes back =====
  {
    const seedLs = { [LS_KEY]: { settings: null, workers: Object.entries(SEED_W).map(([id, w]) => ({ id, ...w })) } };
    const D = await phone(browser, null, { name: 'D', inClaude: false, wake: 'deny', seedLs }, { width: 360, height: 740 });
    await D.page.click(ENTRY_OPEN); await D.page.waitForTimeout(150);
    let e = await E(D.page);
    check('refused lock: no pill, tip shown, flag set', !e.awake && e.tip && (await D.page.evaluate(k => localStorage.getItem(k), TIP_KEY)) === 'true', e);
    check('360: no horizontal scroll', await D.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('entry').scrollWidth <= document.getElementById('entry').clientWidth));
    check('new villager line without a snapshot', e.isNew && e.rows.filter(r => r.diff).every(r => r.from === 'von 5') && e.rows.filter(r => !r.diff).every(r => r.to === 'bleibt 5'), e.rows);
    await D.page.screenshot({ path: 'entry-360.png' });
    await D.page.keyboard.press('Escape');
    await D.page.click(ENTRY_OPEN); await D.page.waitForTimeout(150);
    e = await E(D.page);
    check('tip only once per device', !e.tip && !e.awake);
    await D.ctx.close();
    const N = await phone(browser, null, { name: 'N', inClaude: false, wake: 'none', seedLs });
    await N.page.click(ENTRY_OPEN); await N.page.waitForTimeout(150);
    e = await E(N.page);
    check('no wake lock API: tip, no pill', e.tip && !e.awake, e);
    await N.ctx.close();
    const O = await phone(browser, null, { name: 'O', inClaude: false, wake: 'ok', seedLs });
    await O.page.click(ENTRY_OPEN); await O.page.waitForTimeout(150);
    await O.page.evaluate(() => { window.__wake.s[0].release(); window.__setHidden(true); });
    await O.page.waitForTimeout(80);
    const gone = (await E(O.page)).awake;
    await O.page.evaluate(() => window.__setHidden(false));
    await O.page.waitForTimeout(120);
    const w2 = await O.page.evaluate(() => ({ req: window.__wake.req, rel: window.__wake.rel }));
    check('system release hides the pill; visible again re-requests', !gone && w2.req === 2 && (await E(O.page)).awake, { gone, w2 });
    await O.page.click('[data-e="close"]');
    check('close releases the new lock', (await O.page.evaluate(() => window.__wake.rel)) === 2 && (await O.page.evaluate(() => window.__wake.s[1].released)));
    await O.page.evaluate(() => window.__setHidden(true)); await O.page.evaluate(() => window.__setHidden(false)); await O.page.waitForTimeout(80);
    check('closed: no request on visibility change', (await O.page.evaluate(() => window.__wake.req)) === 2);
    await O.ctx.close();
  }

  // ===== 3) Two phones on the shared list: Fertig on A clears the card on B; live plan changes; leaving the team =====
  {
    const srv = makeServer({ workers: SEED_W });
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, wake: 'ok', user: { id: 'u_owner', owner: true, can: true } });
    const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, wake: 'ok', user: { id: 'u_lena', owner: false, can: true } });
    check('db: button "(5 offen)"', (await A.page.$eval('#entry-open', e => e.textContent)) === 'Im Spiel eintragen (5 offen)');
    await A.page.click(ENTRY_OPEN); await A.page.waitForTimeout(150);
    let e = await E(A.page);
    check('db: opens on Agnes', e.name === 'Agnes' && e.count === '1 / 5', e);
    const pvA = await planVals(A.page, 'w_agnes');
    await A.page.click('#entry-next');
    const waited = await until(async () => B.page.evaluate(() => !!document.querySelector('#wp-w_agnes .applied-ok')));
    const doc = srv.ingame.get('w_agnes');
    check('Fertig on A clears the card on B within ~1 s', waited >= 0 && waited <= 1200, waited);
    check('Fertig writes the shared ingame doc {vals = plan, by, at}', doc && doc.by === 'u_owner' && JSON.stringify(doc.vals) === JSON.stringify(pvA) && Object.keys(doc).sort().join() === 'at,by,vals', doc);
    check('no worker doc touched', srv.log.every(l => l.c === 'ingame'), srv.log);
    await A.page.waitForTimeout(900);
    e = await E(A.page);
    check('A moved on to Bertram', e.name === 'Bertram', e.name);
    // B changes the phase: A's card follows, bumps the changed badges and says so.
    const tBefore = e.rows.map(r => r.to);
    await B.page.click('#panel-plan [data-phase="krieg"]');
    const live = await until(async () => (await E(A.page)).changed, 3000);
    e = await E(A.page);
    const pvB = await planVals(A.page, 'w_bertram');
    const bump = await A.page.evaluate(() => { const b = document.querySelector('#entry .er-to.bump'); return b ? getComputedStyle(b).animationName : 'none-found'; });
    const allMatch = e.rows.every((r, i) => r.diff ? r.to === xt(Object.values(pvB)[i]) : r.to === 'bleibt ' + xt(Object.values(pvB)[i]));
    check('live: "Der Plan hat sich gerade geändert." on A', live >= 0 && e.changed, { live, rows: e.rows.map(r => r.to), tBefore });
    check('live: badges follow the plan, changed ones bump', allMatch && bump === 'bump', { bump, allMatch });
    check('live: progress keeps all 5 dots', e.dots.length === 5);
    await A.page.screenshot({ path: 'entry-390-live.png' });
    // Bertram leaves the team (B makes him a guard): A skips him.
    await B.page.click('#tab-arbeiter');
    await B.page.selectOption('#w_bertram-role', 'guard');
    const skipped = await until(async () => (await E(A.page)).name === 'Edda', 3000);
    e = await E(A.page);
    check('a villager who left the team is skipped', skipped >= 0 && e.dots[1].includes('gone'), { skipped, name: e.name, dots: e.dots });
    check('Zurück skips him too (lands on Agnes)', await (async () => { await A.page.click('#entry-back'); await A.page.waitForTimeout(80); return (await E(A.page)).name === 'Agnes'; })());
    await A.page.keyboard.press('Escape');
    // Read-only viewer: "Weiter ▶" writes nothing.
    const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, wake: 'ok', user: { id: 'u_ro', owner: false, can: false } });
    const logLen = srv.log.length;
    // BUILD 13: the trigger may be the banner button or the head button, whichever is shown.
    const cBtn = await C.page.evaluate(() => ({ h: document.getElementById('entry-open').hidden && document.getElementById('entry-banner').hidden, t: document.getElementById('entry-open').textContent }));
    check('read-only: may open the mode too', !cBtn.h, cBtn);
    await C.page.click(ENTRY_OPEN); await C.page.waitForTimeout(150);
    e = await E(C.page);
    check('read-only: "Weiter ▶", "Nur ansehen" note, no Überspringen', e.next === 'Weiter ▶' && e.ro && !e.skip, e);
    const n1 = e.name;
    await C.page.click('#entry-next'); await C.page.waitForTimeout(150);
    e = await E(C.page);
    check('read-only: Weiter moves on and writes nothing', e.name !== n1 && srv.log.length === logLen && (await C.page.evaluate(() => window.__refused)) === 0, { n1, n2: e.name });
    await C.page.screenshot({ path: 'entry-390-readonly.png' });
    for (const s of [A, B, C]) await s.ctx.close();
  }

  // ===== 4) Reduced motion: no stamp and no bump animation (the seal still shows) =====
  {
    const srv = makeServer({ workers: SEED_W });
    const R = await phone(browser, srv, { name: 'R', inClaude: true, writable: true, wake: 'ok', user: { id: 'u_owner', owner: true, can: true } }, { reduced: true });
    const B = await phone(browser, srv, { name: 'B2', inClaude: true, writable: true, wake: 'ok', user: { id: 'u_lena', owner: false, can: true } });
    await R.page.click(ENTRY_OPEN); await R.page.waitForTimeout(150);
    await R.page.click('#entry-next');
    const st1 = await R.page.evaluate(() => { const s = document.querySelector('#entry .entry-seal .applied-ok'); return { shown: !s.closest('[hidden]'), stamp: s.classList.contains('stamp'), anim: getComputedStyle(s, '::before').animationName }; });
    check('reduced motion: seal shown without the stamp animation', st1.shown && st1.stamp && st1.anim === 'none', st1);
    await R.page.waitForTimeout(500);
    check('reduced motion: moves on sooner', (await E(R.page)).name === 'Bertram');
    await B.page.click('#panel-plan [data-phase="krieg"]');
    await until(async () => (await E(R.page)).changed, 3000);
    const bump = await R.page.evaluate(() => [...document.querySelectorAll('#entry .er-to.bump')].map(b => getComputedStyle(b).animationName));
    check('reduced motion: changed badges get .bump but no animation', bump.length > 0 && bump.every(a => a === 'none'), bump);
    for (const s of [R, B]) await s.ctx.close();
  }

  // ===== 5) Layout: landscape, desktop, more than 12 villagers =====
  {
    const many = {};
    for (let k = 0; k < 13; k++) many['w' + k] = { name: 'Leute' + k, role: 'worker', traits: '', order: k, stats: st({ labourer: [k % 7, 9], cooking: [(k * 3) % 8, 9], farming: [(k * 5) % 9, 10], crafting: [(k * 2) % 7, 8], researching: [k % 5, 7], harvesting: [(k * 4) % 9, 9], hunting: [(k * 6) % 8, 9] }) };
    const seedLs = { [LS_KEY]: { settings: null, workers: Object.entries(many).map(([id, w]) => ({ id, ...w })) } };
    const M = await phone(browser, null, { name: 'M', inClaude: false, wake: 'ok', seedLs });
    await M.page.click(ENTRY_OPEN); await M.page.waitForTimeout(150);
    const e = await E(M.page);
    check('13 villagers: count only, no dots', e.count === '1 / 13' && !e.dotsShown, { count: e.count, dots: e.dotsShown });
    await M.ctx.close();

    const seed5 = { [LS_KEY]: { settings: null, workers: Object.entries(SEED_W).map(([id, w]) => ({ id, ...w })) } };
    const Q = await phone(browser, null, { name: 'Q', inClaude: false, wake: 'ok', seedLs: seed5 }, { width: 844, height: 390 });
    await Q.page.click(ENTRY_OPEN); await Q.page.waitForTimeout(150);
    const land = await Q.page.evaluate(() => { const h = document.querySelector('.ep-head').getBoundingClientRect(), r = document.querySelector('.er-rows'); return { headRight: h.right, rowsLeft: r.getBoundingClientRect().left, cols: getComputedStyle(r).columnCount, ov: document.getElementById('entry').scrollWidth <= document.getElementById('entry').clientWidth }; });
    check('landscape: name block left, rows in two columns', land.headRight <= land.rowsLeft && land.cols === '2' && land.ov, land);
    await Q.page.screenshot({ path: 'entry-landscape.png' });
    await Q.ctx.close();

    const W = await phone(browser, null, { name: 'W', inClaude: false, wake: 'ok', seedLs: seed5 }, { width: 1280, height: 900 });
    // BUILD 13: with open villagers the banner stands in for the title button.
    const desk = await W.page.evaluate(() => ({ sticky: getComputedStyle(document.getElementById('entry-sticky')).display, btn: !document.getElementById('entry-open').hidden || !document.getElementById('entry-banner').hidden }));
    check('desktop: title button (or the banner), no sticky bar', desk.btn && desk.sticky === 'none', desk);
    await W.page.screenshot({ path: 'entry-plan-1280.png' });
    await W.page.click(ENTRY_OPEN); await W.page.waitForTimeout(150);
    await W.page.screenshot({ path: 'entry-1280.png' });
    await W.page.click('details.ep-why summary'); await W.page.waitForTimeout(80);
    check('why details open on desktop', await W.page.evaluate(() => document.querySelector('details.ep-why').open));
    await W.ctx.close();
  }

  // ===== 6) Review regressions: blocked storage keeps earlier ticks; finale repaint keeps focus; landscape notes =====
  {
    // Storage blocked (private window): every Fertig must keep the earlier ticks in memory.
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
    const P = await ctx.newPage();
    P.on('pageerror', e => errs.push('blocked: ' + e.message));
    await P.addInitScript(() => { const t = () => { throw new DOMException('blocked', 'SecurityError'); }; for (const k of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[k] = t; });
    await P.goto('file://' + process.cwd() + '/page.html#plan'); await P.waitForTimeout(400);
    await P.click('#tab-arbeiter'); await P.click('#adopt-example'); await P.click('#tab-plan'); await P.waitForTimeout(150);
    await P.click(ENTRY_OPEN); await P.waitForTimeout(150);
    let guard = 0;
    while (!(await E(P)).finale && guard++ < 10) { await P.click('#entry-next'); await P.waitForTimeout(800); }
    const f = await E(P);
    check('blocked storage: all ticks kept, finale "Alle 7 eingetragen."', f.finaleText.startsWith('Alle 7 eingetragen.') && f.dots.every(d => d.includes('done')), { f: f.finaleText, dots: f.dots });
    await ctx.close();

    // Finale with focus on its heading; another phone ticks someone: focus stays in the dialog.
    const srv = makeServer({ workers: SEED_W });
    const A = await phone(browser, srv, { name: 'FA', inClaude: true, writable: true, wake: 'ok', user: { id: 'u_owner', owner: true, can: true } }, { width: 1280 });
    const B = await phone(browser, srv, { name: 'FB', inClaude: true, writable: true, wake: 'ok', user: { id: 'u_lena', owner: false, can: true } });
    await A.page.click(ENTRY_OPEN); await A.page.waitForTimeout(150);
    for (let k = 0; k < 5; k++) await A.page.keyboard.press('ArrowRight');
    await B.page.click('#wp-w_agnes [data-applied]');
    await until(async () => (await E(A.page)).finaleText.startsWith('1 von'), 3000);
    const e = await E(A.page);
    check('finale repaint keeps focus on the heading', e.finaleText.startsWith('1 von 5') && e.active === 'entry-name', { f: e.finaleText, active: e.active });
    for (const s of [A, B]) await s.ctx.close();

    // Small landscape phone (568x320), 12 villagers, read-only pill: the notes never cover the dots.
    const many = {};
    for (let k = 0; k < 12; k++) many['w' + k] = { name: 'Leute' + k, role: 'worker', traits: '', order: k, stats: st({ labourer: [k % 7, 9], cooking: [(k * 3) % 8, 9], farming: [(k * 5) % 9, 10] }) };
    const srv2 = makeServer({ workers: many });
    const C = await phone(browser, srv2, { name: 'FC', inClaude: true, writable: false, wake: 'deny', user: { id: 'u_ro', owner: false, can: false } }, { width: 568, height: 320 });
    await C.page.click(ENTRY_OPEN); await C.page.waitForTimeout(150);
    const lay = await C.page.evaluate(() => {
      const d = document.getElementById('entry-dots').getBoundingClientRect();
      const kids = [...document.getElementById('entry-notes').children].filter(k => !k.hidden).map(k => k.getBoundingClientRect().left);
      return { dotsRight: d.right, notesLeft: Math.min(...kids) };
    });
    check('568x320 landscape: notes do not cover the dots', lay.dotsRight <= lay.notesLeft, lay);
    await C.ctx.close();
  }

  check('no page errors', errs.length === 0, errs);
  console.log(`feat-entry: ${passes} passed, ${fails.length} failed`);
  for (const f of fails) console.log('FAIL ' + f);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();

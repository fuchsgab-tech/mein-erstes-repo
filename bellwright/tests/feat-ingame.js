// BUILD 2 "Gemeinsamer Spielstand + Rückgängig": shared 'ingame' tick-off, who/when line, undo for tick, mark-all and delete,
// one-time migration of the per-device AP_KEY, local mode unchanged.
// Phones are separate browser contexts (own localStorage) that share one fake server living in node:
// db writes go to node through an exposed function, node pushes snapshots of that collection to every open page.
const { chromium } = require('playwright');

const AP_KEY = 'bellwright-arbeitsplan-eingetragen-v1';
const LS_KEY = 'bellwright-arbeitsplan-v1';
const FLAG = 'bellwright-ingame-migriert-v1';
const DIR = { u_owner: 'Gabriel', u_lena: 'Lena', u_ro: 'Ida' };
const st = o => Object.fromEntries(Object.entries(o).map(([k, [cur, max]]) => [k, { cur, max }]));
const SEED_W = {
  w_agnes: { name: 'Agnes', role: 'worker', traits: 'Optimist', order: 1, stats: st({ labourer: [3, 5], harvesting: [6, 9], farming: [2, 4], cooking: [1, 3], crafting: [2, 6], researching: [0, 2], hunting: [5, 8] }) },
  w_bertram: { name: 'Bertram', role: 'worker', traits: 'Resilient', order: 2, stats: st({ labourer: [7, 9], harvesting: [4, 6], farming: [1, 3], cooking: [2, 4], crafting: [3, 5], researching: [1, 3], hunting: [2, 4] }) },
  w_edda: { name: 'Edda', role: 'worker', traits: '', order: 3, stats: st({ labourer: [2, 4], harvesting: [1, 3], farming: [3, 6], cooking: [8, 10], crafting: [2, 4], researching: [3, 5], hunting: [0, 2] }) },
  w_godric: { name: 'Godric', role: 'worker', traits: 'Prodigy', order: 4, stats: st({ labourer: [3, 6], harvesting: [3, 5], farming: [2, 4], cooking: [1, 4], crafting: [6, 10], researching: [4, 7], hunting: [1, 3] }) },
  w_hilde: { name: 'Hilde', role: 'worker', traits: '', order: 5, stats: st({ labourer: [2, 5], harvesting: [2, 5], farming: [7, 9], cooking: [4, 6], crafting: [1, 3], researching: [2, 4], hunting: [3, 6] }) },
};
const ALL5 = { construction: 5, delivery: 5, woodcutting: 5, harvesting: 5, farming: 5, hunting: 5, animals: 5, cooking: 5, crafting: 5, smelting: 5, research: 5 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));

// ---------- the shared fake server (node side) ----------
function makeServer(seed = {}) {
  const srv = { workers: new Map(), settings: new Map(), ingame: new Map(), log: [], pages: new Set() };
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

// ---------- page side: db and user stubs that talk to the node server ----------
// cfg: { name, inClaude, writable, ingameDelay, user: null | { id, owner, can } , dir, seedLs: {key: value} }
function STUB(cfg) {
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
    get: async () => snapD(await window.__srvRead(c), id),
    onSnapshot: n => { list(docL, c + '/' + id).push(n); window.__srvRead(c).then(docs => n(snapD(docs, id))); return () => {}; },
  });
  const db = Object.freeze({
    collection: c => ({
      doc: id => docRef(c, id),
      onSnapshot: n => {
        list(colL, c).push(n);
        window.__srvRead(c).then(docs => setTimeout(() => n(snapC(docs)), c === 'ingame' ? (cfg.ingameDelay || 0) : 0));
        return () => {};
      },
    }),
    doc: p => { const [c, id] = p.split('/'); return docRef(c, id); },
  });
  const u = cfg.user;
  window.__profileCalls = [];
  const late = v => new Promise(r => setTimeout(() => r(v), (u && u.delay) || 0));   // a slow host answer
  const user = !u ? null : Object.freeze({
    isOwner: () => late(!!u.owner),
    canEdit: () => late(!!u.owner),
    id: () => late(u.id || null),
    can: n => late(n === 'data.write' ? u.can : false),
    me: async () => ({ id: u.id || null, name: (cfg.dir || {})[u.id] || '', avatarUrl: 'data:,', color: '#888', email: null, isOwner: !!u.owner, canEdit: !!u.owner }),
    profiles: async ids => {
      const arr = [].concat(ids);
      window.__profileCalls.push(arr);
      return Object.fromEntries(arr.map(i => [i, { id: i, name: (cfg.dir || {})[i] || '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }]));
    },
  });
  window.claude = { use: async n => n === 'db' ? db : n === 'user' ? user : null };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); };
const errs = [];

async function phone(browser, srv, cfg, { width = 390, file = 'page.html', hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: width < 600, isMobile: width < 600 });
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
  await page.goto('file://' + process.cwd() + '/' + file + hash);
  await page.waitForTimeout(500);
  return { ctx, page };
}
// Poll until fn() is truthy (in node); returns ms waited or -1.
async function until(fn, max = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(40); }
  return -1;
}
const card = (page, wid) => page.evaluate(wid => {
  const c = document.getElementById('wp-' + wid);
  if (!c) return null;
  const btn = c.querySelector('[data-applied]');
  return {
    sealed: !!c.querySelector('.applied-ok'),
    who: (c.querySelector('.applied-who') || {}).textContent || '',
    dots: c.querySelectorAll('.pbadge.chg').length,
    button: btn ? btn.textContent : '',
  };
}, wid);
const toastState = page => page.evaluate(() => {
  const t = document.getElementById('toast');
  const b = t.querySelector('.toast-act');
  const r = t.getBoundingClientRect();
  return { shown: !t.hidden, role: t.getAttribute('role'), msg: (t.querySelector('.toast-msg') || {}).textContent || '', text: t.textContent,
    act: b ? b.textContent : '', actH: b ? b.getBoundingClientRect().height : 0, actTab: b ? b.tabIndex : null, left: r.left, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
});
const clickUndo = page => page.click('#toast .toast-act');

(async () => {
  const browser = await chromium.launch();

  // ===== 1) Two phones: owner A (Gabriel) and invited Bearbeiter B (Lena) =====
  {
    const srv = makeServer({ workers: SEED_W });
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: { id: 'u_owner', owner: true, can: true } });
    const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: { id: 'u_lena', owner: false, can: true } });
    const a0 = await card(A.page, 'w_agnes'), b0 = await card(B.page, 'w_agnes');
    check('2phones: start without tick on both', a0 && b0 && !a0.sealed && !b0.sealed && a0.button === 'Im Spiel eingetragen? Abhaken' && b0.button === 'Im Spiel eingetragen? Abhaken', { a0, b0 });

    // Tick Agnes on A: B shows the seal and who within about 1 s.
    await A.page.click('#wp-w_agnes [data-applied]');
    const tA = await toastState(A.page);
    check('tick: toast text + Rückgängig button', tA.shown && tA.msg === 'Für alle als eingetragen gemerkt.' && tA.act === 'Rückgängig', tA);
    check('tick: toast keeps role=status', tA.role === 'status', tA.role);
    check('tick: A seals at once', (await card(A.page, 'w_agnes')).sealed);
    const waited = await until(async () => { const c = await card(B.page, 'w_agnes'); return c && c.sealed && c.who.includes('von Gabriel'); });
    const b1 = await card(B.page, 'w_agnes');
    check('tick: B sees it within ~1 s', waited >= 0 && waited <= 1100, { waited, b1 });
    check('tick: B line "eingetragen von Gabriel · gerade eben"', b1.who === 'eingetragen von Gabriel · gerade eben', b1.who);
    check('tick: A line uses the name too', (await card(A.page, 'w_agnes')).who === 'eingetragen von Gabriel · gerade eben');
    const doc1 = clone(srv.ingame.get('w_agnes'));
    check('tick: server doc {vals, by, at}', doc1 && doc1.by === 'u_owner' && typeof doc1.at === 'number' && Math.abs(Date.now() - doc1.at) < 5000
      && Object.keys(doc1.vals).length === 11 && Object.values(doc1.vals).every(v => Number.isInteger(v) && v >= 0 && v <= 9) && Object.keys(doc1).sort().join() === 'at,by,vals', doc1);
    check('tick: worker docs untouched (no new fields)', [...srv.workers.values()].every(d => Object.keys(d).sort().join() === 'name,order,role,stats,traits'));
    check('tick: nothing written to AP_KEY in db mode', (await A.page.evaluate(k => localStorage.getItem(k), AP_KEY)) === null);
    check('names: profiles asked once for u_owner on B', (await B.page.evaluate(() => window.__profileCalls.filter(c => c.includes('u_owner')).length)) === 1, await B.page.evaluate(() => window.__profileCalls));

    // Rückgängig with no previous doc deletes it; both phones lose the seal.
    await clickUndo(A.page);
    await until(async () => !srv.ingame.has('w_agnes'));
    const back = await until(async () => { const c = await card(B.page, 'w_agnes'); return c && !c.sealed; });
    check('undo first tick: doc deleted on the server', !srv.ingame.has('w_agnes'));
    check('undo first tick: B unsealed', back >= 0, back);
    check('undo first tick: A unsealed + button back', (await card(A.page, 'w_agnes')).button === 'Im Spiel eingetragen? Abhaken');
    check('undo: confirmation toast', (await toastState(A.page)).msg === 'Rückgängig gemacht.');

    // Dots come back on both phones after Rückgängig of a re-tick.
    await A.page.click('#wp-w_agnes [data-applied]');
    await until(async () => srv.ingame.has('w_agnes'));
    await until(async () => (await card(B.page, 'w_agnes')).sealed);
    const first = clone(srv.ingame.get('w_agnes'));
    await A.page.click('#panel-plan [data-phase="ausbau"]');
    const dotsBoth = await until(async () => (await card(A.page, 'w_agnes')).dots > 0 && (await card(B.page, 'w_agnes')).dots > 0, 3000);
    const nDots = (await card(B.page, 'w_agnes')).dots;
    check('phase switch: dots on both phones', dotsBoth >= 0 && nDots > 0, { dotsBoth, nDots });
    await A.page.click('#wp-w_agnes [data-applied]');
    const cleared = await until(async () => (await card(A.page, 'w_agnes')).dots === 0 && (await card(B.page, 'w_agnes')).dots === 0);
    check('re-tick: dots gone on both', cleared >= 0, cleared);
    // Rückgängig by keyboard: Strg+Z while focus is not in a field.
    await A.page.evaluate(() => document.activeElement && document.activeElement.blur());
    await A.page.keyboard.press('Control+z');
    const dotsBack = await until(async () => (await card(A.page, 'w_agnes')).dots === nDots && (await card(B.page, 'w_agnes')).dots === nDots);
    check('Strg+Z undo: dots back on both phones', dotsBack >= 0, { dotsBack, a: await card(A.page, 'w_agnes'), b: await card(B.page, 'w_agnes') });
    await until(async () => JSON.stringify(srv.ingame.get('w_agnes')) === JSON.stringify(first));
    check('undo restores the previous doc exactly (same by/at)', JSON.stringify(srv.ingame.get('w_agnes')) === JSON.stringify(first), { now: srv.ingame.get('w_agnes'), first });
    // Strg+Z inside a text field stays the field's own undo.
    await A.page.click('#wp-w_agnes [data-applied]');
    await until(async () => (await card(A.page, 'w_agnes')).dots === 0);
    await A.page.click('#tab-arbeiter');
    await A.page.click('#w_agnes-traits');
    await A.page.keyboard.press('Control+z');
    await A.page.waitForTimeout(300);
    check('Strg+Z in a field does not undo the tick', (await A.page.evaluate(() => !!document.querySelector('#toast .toast-act'))) && srv.ingame.get('w_agnes').at !== first.at);
    await A.page.click('#tab-plan');

    // Mark-all on B, then Rückgängig restores every villager (Agnes back to A's doc, the others removed).
    await sleep(300);
    const agnesBefore = clone(srv.ingame.get('w_agnes'));
    await B.page.click('#mark-all');
    const tB = await toastState(B.page);
    check('mark-all: toast + button', tB.msg === 'Alle als eingetragen gemerkt.' && tB.act === 'Rückgängig', tB);
    await until(async () => srv.ingame.size === 5 && [...srv.ingame.values()].every(d => d.by === 'u_lena'));
    check('mark-all: all five by Lena', srv.ingame.size === 5 && [...srv.ingame.values()].every(d => d.by === 'u_lena'), [...srv.ingame.keys()]);
    const allA = await until(async () => { for (const w of Object.keys(SEED_W)) if (!(await card(A.page, w)).sealed) return false; return true; });
    check('mark-all: A sees all sealed, "von Lena"', allA >= 0 && (await card(A.page, 'w_hilde')).who.startsWith('eingetragen von Lena'), await card(A.page, 'w_hilde'));
    await clickUndo(B.page);
    await until(async () => srv.ingame.size === 1);
    check('mark-all undo: only Agnes left, with her old doc', srv.ingame.size === 1 && JSON.stringify(srv.ingame.get('w_agnes')) === JSON.stringify(agnesBefore), [...srv.ingame.entries()]);
    const unsealedA = await until(async () => !(await card(A.page, 'w_hilde')).sealed && (await card(A.page, 'w_agnes')).who.includes('Gabriel'));
    check('mark-all undo: A follows', unsealedA >= 0);

    // Read-only viewer C: sees the ticks and who, gets no tick buttons.
    const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, user: { id: 'u_ro', owner: false, can: false } });
    const c1 = await card(C.page, 'w_agnes');
    const cBtns = await C.page.evaluate(() => ({ ticks: document.querySelectorAll('[data-applied]').length, markAll: !document.getElementById('mark-all').hidden }));
    check('read-only: sees seal + who', c1.sealed && c1.who.startsWith('eingetragen von Gabriel'), c1);
    check('read-only: no tick buttons, no mark-all', cBtns.ticks === 0 && !cBtns.markAll, cBtns);
    await C.page.click('[data-view="table"]');
    await C.page.waitForTimeout(200);
    const cTable = await C.page.evaluate(() => ({ ticks: document.querySelectorAll('[data-applied]').length, done: [...document.querySelectorAll('.matrix .tick.done')].map(e => e.textContent) }));
    check('read-only table: no tick buttons, who next to the tick', cTable.ticks === 0 && cTable.done.some(t => t.startsWith('✓ eingetragen von Gabriel')), cTable);
    check('read-only: nothing tried to write', (await C.page.evaluate(() => window.__refused)) === 0);
    await C.ctx.close();

    // Delete Bertram (ticked) on A, then Rückgängig: same id, same tick-off, on both phones.
    await A.page.click('#wp-w_bertram [data-applied]');
    await until(async () => srv.ingame.has('w_bertram'));
    await until(async () => (await card(B.page, 'w_bertram')).sealed);
    const bertDoc = clone(srv.ingame.get('w_bertram')), bertW = clone(srv.workers.get('w_bertram'));
    await A.page.click('#tab-arbeiter');
    const del = A.page.locator('[data-wid="w_bertram"] [data-act="del"]');
    await del.click(); await A.page.waitForTimeout(500); await del.click();
    const tD = await toastState(A.page);
    check('delete: toast "Bertram gelöscht." + Rückgängig', tD.msg === 'Bertram gelöscht.' && tD.act === 'Rückgängig', tD);
    await until(async () => !srv.workers.has('w_bertram') && !srv.ingame.has('w_bertram'));
    check('delete: worker and ingame doc removed', !srv.workers.has('w_bertram') && !srv.ingame.has('w_bertram'));
    const goneB = await until(async () => !(await card(B.page, 'w_bertram')));
    check('delete: gone on B', goneB >= 0);
    await clickUndo(A.page);
    await until(async () => srv.workers.has('w_bertram') && srv.ingame.has('w_bertram'));
    check('delete undo: same id, same worker doc', JSON.stringify(srv.workers.get('w_bertram')) === JSON.stringify(bertW), srv.workers.get('w_bertram'));
    check('delete undo: same ingame doc (by/at kept)', JSON.stringify(srv.ingame.get('w_bertram')) === JSON.stringify(bertDoc), srv.ingame.get('w_bertram'));
    const backB = await until(async () => { const c = await card(B.page, 'w_bertram'); return c && c.sealed; });
    check('delete undo: B shows Bertram sealed again', backB >= 0);
    check('delete undo: A editor card back in place', (await A.page.evaluate(() => [...document.querySelectorAll('#wlist [data-wid]')].map(e => e.dataset.wid).join())) === 'w_agnes,w_bertram,w_edda,w_godric,w_hilde');
    check('delete undo: focus moved to the restored card', (await A.page.evaluate(() => document.activeElement && document.activeElement.closest('[data-wid]') && document.activeElement.closest('[data-wid]').dataset.wid)) === 'w_bertram');
    check('delete undo: toast', (await toastState(A.page)).msg === 'Bertram ist wieder da.');
    // Bertram must stay (no stale "deleting" filter hiding him after the next snapshot).
    srv.broadcast('workers'); await sleep(300);
    check('delete undo: survives the next snapshot on A', (await A.page.evaluate(() => !!document.querySelector('#wlist [data-wid="w_bertram"]'))));
    await A.page.click('#tab-plan');

    // An old tab writing AP_KEY must not change the shared view.
    await A.page.evaluate(([k, v]) => { localStorage.setItem(k, JSON.stringify({ w_hilde: v })); window.dispatchEvent(new StorageEvent('storage', { key: k })); }, [AP_KEY, ALL5]);
    await A.page.waitForTimeout(200);
    check('db mode ignores AP_KEY from old tabs', !(await card(A.page, 'w_hilde')).sealed && (await card(A.page, 'w_hilde')).dots === 0);

    // Toast lifetime: 8 s with a button, 3.6 s without (ticked by keyboard, so the pointer is not on the toast).
    await A.page.mouse.move(5, 5);
    await A.page.focus('#wp-w_edda [data-applied]');
    await A.page.keyboard.press('Enter');
    check('keyboard tick: toast with button', (await toastState(A.page)).act === 'Rückgängig');
    await A.page.waitForTimeout(6000);
    const at6 = (await toastState(A.page)).shown;
    await A.page.waitForTimeout(2600);
    const at86 = (await toastState(A.page)).shown;
    check('toast with button: visible at 6 s, gone after 8 s', at6 && !at86, { at6, at86 });
    await A.page.focus('#wp-w_edda [data-applied]').catch(() => {});
    await A.page.focus('#mark-all');
    await A.page.evaluate(() => document.activeElement.blur());
    await A.page.keyboard.press('Control+z');   // no action toast any more: nothing happens
    await A.page.waitForTimeout(300);
    check('Strg+Z after the toast is gone does nothing', srv.ingame.has('w_edda'));
    await A.page.focus('#wp-w_godric [data-applied]');
    await A.page.keyboard.press('Enter');
    await A.page.keyboard.press('Control+z');
    const plain = await toastState(A.page);
    check('plain toast has no button and the exact text', plain.msg === 'Rückgängig gemacht.' && plain.act === '' && plain.text === 'Rückgängig gemacht.', plain);
    await A.page.waitForTimeout(4000);
    check('plain toast: gone after 3.6 s', !(await toastState(A.page)).shown);
    // Keyboard: the button is focusable, and focus on it holds the toast.
    await A.page.click('#wp-w_godric [data-applied]');
    await A.page.focus('#toast .toast-act');
    await A.page.waitForTimeout(8600);
    const held = await toastState(A.page);
    check('toast: button focusable (Tab order) and focus holds it', held.shown && held.actTab === 0, held);
    await A.page.keyboard.press('Enter');
    await until(async () => !srv.ingame.has('w_godric'));
    check('toast: Enter on the button runs Rückgängig', !srv.ingame.has('w_godric'));
    check('toast: focus not lost to <body> after Rückgängig', (await A.page.evaluate(() => document.activeElement !== document.body)), await A.page.evaluate(() => document.activeElement.outerHTML.slice(0, 80)));

    // Layout at 390: no page overflow with the toast, button >= 44px, toast inside the screen.
    await A.page.click('#wp-w_godric [data-applied]');
    const lay = await toastState(A.page);
    check('390: toast inside the screen, button >= 44px', lay.left >= 0 && lay.right <= lay.vw && lay.bottom <= lay.vh && lay.actH >= 44, lay);
    check('390: no horizontal overflow', (await A.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await A.page.screenshot({ path: 'ingame-390.png' });
    await A.page.evaluate(() => window.scrollTo(0, 0));
    for (const s of [A, B]) await s.ctx.close();
  }

  // ===== 2) Migration of the per-device AP_KEY (once per device) =====
  {
    const eddaDoc = { vals: { ...ALL5, cooking: 1 }, by: 'u_lena', at: Date.now() - 3 * 3600e3 };
    const srv = makeServer({ workers: SEED_W, ingame: { w_edda: eddaDoc } });
    const seedLs = { [AP_KEY]: { w_agnes: { ...ALL5, harvesting: 1 }, w_godric: { ...ALL5, crafting: 1, bad: 'x' }, w_edda: ALL5, w_ghost: ALL5 } };
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, seedLs, user: { id: 'u_owner', owner: true, can: true } });
    await until(async () => srv.ingame.has('w_agnes') && srv.ingame.has('w_godric'));
    const ag = srv.ingame.get('w_agnes'), go = srv.ingame.get('w_godric');
    check('migrate: docs created with by=myId', ag && go && ag.by === 'u_owner' && go.by === 'u_owner' && ag.at === go.at && ag.vals.harvesting === 1 && !('bad' in go.vals), { ag, go });
    check('migrate: existing doc never overwritten', JSON.stringify(srv.ingame.get('w_edda')) === JSON.stringify(eddaDoc));
    check('migrate: unknown villager not written', !srv.ingame.has('w_ghost'));
    await A.page.waitForTimeout(200);
    const ls = await A.page.evaluate(([k, f]) => ({ ap: JSON.parse(localStorage.getItem(k)), flag: localStorage.getItem(f) }), [AP_KEY, FLAG]);
    check('migrate: migrated keys removed from AP_KEY, others kept', ls.ap && !ls.ap.w_agnes && !ls.ap.w_godric && ls.ap.w_edda && ls.ap.w_ghost, ls.ap);
    check('migrate: flag set', ls.flag === 'true', ls.flag);
    const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: { id: 'u_lena', owner: false, can: true } });
    const bAg = await card(B.page, 'w_agnes');
    const notes = await B.page.$eval('#notes', e => e.textContent);
    check('migrate: B sees Agnes as entered (dots, not "noch nie")', bAg.dots > 0 && bAg.button.includes('geändert') && !/Noch nie eingetragen:[^.]*Agnes/.test(notes), { bAg, notes });
    // Once per device: a later AP_KEY entry is not migrated after a reload.
    const before = srv.log.length;
    await A.page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify({ w_hilde: v })), [AP_KEY, ALL5]);
    await A.page.reload(); await A.page.waitForTimeout(700);
    check('migrate: runs once per device', !srv.ingame.has('w_hilde') && srv.log.length === before, srv.log.slice(before));
    for (const s of [A, B]) await s.ctx.close();
  }
  // 2b) A read-only device keeps its AP_KEY and does not set the flag.
  {
    const srv = makeServer({ workers: SEED_W });
    const seedLs = { [AP_KEY]: { w_agnes: ALL5 } };
    const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, seedLs, user: { id: 'u_ro', owner: false, can: false } });
    await C.page.waitForTimeout(300);
    const ls = await C.page.evaluate(([k, f]) => ({ ap: localStorage.getItem(k), flag: localStorage.getItem(f) }), [AP_KEY, FLAG]);
    check('migrate read-only: nothing written, flag not set, AP_KEY kept', srv.ingame.size === 0 && !ls.flag && ls.ap && (await C.page.evaluate(() => window.__refused)) === 0, ls);
    await C.ctx.close();
  }
  // 2c) The viewer's id arrives 2.5 s after the snapshots: the migration waits for it.
  {
    const srv = makeServer({ workers: SEED_W });
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, seedLs: { [AP_KEY]: { w_hilde: ALL5 } }, user: { id: 'u_owner', owner: true, can: true, delay: 2500 } });
    const known = await A.page.evaluate(() => document.getElementById('status-line').hidden);   // owner line waits for the user answer too
    check('migrate late user: nothing written before the id is known', known && !srv.ingame.has('w_hilde') && srv.log.length === 0, srv.log);
    await until(async () => srv.ingame.has('w_hilde'), 4000);
    check('migrate late user: by is the viewer id', srv.ingame.get('w_hilde') && srv.ingame.get('w_hilde').by === 'u_owner', srv.ingame.get('w_hilde'));
    await A.ctx.close();
  }

  // ===== 3) Loading: no ticks and no "Noch nie eingetragen" before the first ingame snapshot =====
  // BUILD 4 changed this on purpose: with "Plan ruhig halten" (the default) the numbers depend on the tick-off,
  // so the plan itself waits for it ("Lädt …"). With the option off the plan shows at once, as before.
  for (const calm of [true, false]) {
    const seed = { workers: SEED_W, ingame: { w_agnes: { vals: ALL5, by: 'u_lena', at: Date.now() } } };
    if (!calm) seed.settings = { main: { phase: 'start', growth: 0.35, disableWeak: true, calm: false } };
    const srv = makeServer(seed);
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, ingameDelay: 1500, user: { id: 'u_owner', owner: true, can: true } });
    const early = await A.page.evaluate(() => ({ ticks: document.querySelectorAll('[data-applied]').length, markAll: !document.getElementById('mark-all').hidden, notes: document.getElementById('notes').textContent, cards: document.querySelectorAll('.wp-card').length, view: document.getElementById('plan-view').textContent }));
    if (calm) check('loading (calm): the plan waits for the tick-off, no ticks and no "Noch nie"', early.cards === 0 && /Lädt/.test(early.view) && early.ticks === 0 && !early.markAll && !early.notes.includes('Noch nie'), early);
    else check('loading (calm off): plan shows, but no ticks and no "Noch nie"', early.cards === 5 && early.ticks === 0 && !early.markAll && !early.notes.includes('Noch nie'), early);
    await A.page.waitForTimeout(1500);
    const late = await A.page.evaluate(() => ({ ticks: document.querySelectorAll('[data-applied]').length, markAll: !document.getElementById('mark-all').hidden, notes: document.getElementById('notes').textContent, cards: document.querySelectorAll('.wp-card').length }));
    check(`loaded (calm ${calm}): plan, ticks and notes appear`, late.cards === 5 && late.ticks > 0 && late.markAll && late.notes.includes('Noch nie eingetragen'), late);
    await A.ctx.close();
  }

  // ===== 4) can() says nothing, the write is refused: the tick is taken back, then read-only =====
  {
    const srv = makeServer({ workers: SEED_W });
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: false, user: { id: 'u_x', owner: false, can: null } });
    await A.page.click('#wp-w_agnes [data-applied]');
    await A.page.waitForTimeout(600);
    const c = await card(A.page, 'w_agnes');
    const s = await A.page.evaluate(() => ({ title: document.getElementById('status-text').textContent, ticks: document.querySelectorAll('[data-applied]').length, markAll: !document.getElementById('mark-all').hidden }));
    check('refused tick: seal taken back', !c.sealed, c);
    check('refused tick: read-only, buttons gone', s.title === 'Nur ansehen' && s.ticks === 0 && !s.markAll, s);
    check('refused tick: nothing on the server', srv.ingame.size === 0);
    await A.ctx.close();
  }
  // 4b) A refused delete brings the villager back.
  {
    const srv = makeServer({ workers: SEED_W });
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: false, user: { id: 'u_x', owner: false, can: null } }, { hash: '#arbeiter' });
    const del = A.page.locator('[data-wid="w_edda"] [data-act="del"]');
    await del.click(); await A.page.waitForTimeout(500); await del.click();
    await A.page.waitForTimeout(600);
    check('refused delete: Edda shown again', await A.page.evaluate(() => !!document.querySelector('#wlist [data-wid="w_edda"]')));
    await A.ctx.close();
  }

  // ===== 5) user capability missing: by = "", line without a name =====
  {
    const srv = makeServer({ workers: SEED_W });
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: null });
    await A.page.click('#wp-w_agnes [data-applied]');
    await until(async () => srv.ingame.has('w_agnes'));
    const c = await card(A.page, 'w_agnes');
    check('user null: by is empty', srv.ingame.get('w_agnes').by === '');
    check('user null: "eingetragen gerade eben"', c.who === 'eingetragen gerade eben', c.who);
    await A.ctx.close();
  }
  // 5b) A name the viewer cannot resolve ("") reads "eingetragen vor 2 Std."
  {
    const srv = makeServer({ workers: SEED_W, ingame: { w_agnes: { vals: {}, by: 'u_stranger', at: Date.now() - 2 * 3600e3 - 5000 } } });
    const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: { id: 'u_lena', owner: false, can: true } }, { width: 1280 });
    await B.page.click('[data-view="cards"]');
    await B.page.waitForTimeout(200);
    // Agnes has an empty snapshot, so she shows changes. Give Edda a snapshot that matches the plan, so she is sealed.
    const vals = await B.page.evaluate(() => { const c = document.getElementById('wp-w_edda'); return [...c.querySelectorAll('.pbadge')].map(b => b.textContent); });
    const jobs = ['crafting', 'smelting', 'harvesting', 'farming', 'woodcutting', 'delivery', 'cooking', 'hunting', 'construction', 'animals', 'research'];   // game order (badges are shown in it)
    srv.ingame.set('w_edda', { vals: Object.fromEntries(jobs.map((j, i) => [j, vals[i] === 'aus' ? 0 : +vals[i]])), by: 'u_stranger', at: Date.now() - 2 * 3600e3 - 5000 });
    srv.broadcast('ingame');
    await until(async () => (await card(B.page, 'w_edda')).sealed);
    check('unknown name: "eingetragen vor 2 Std."', (await card(B.page, 'w_edda')).who === 'eingetragen vor 2 Std.', await card(B.page, 'w_edda'));
    await B.page.screenshot({ path: 'ingame-1280.png' });
    await B.page.click('#wp-w_agnes [data-applied]');
    await B.page.waitForTimeout(200);
    await B.page.screenshot({ path: 'ingame-1280-toast.png' });
    await B.page.click('[data-view="table"]');
    await B.page.waitForTimeout(300);
    await B.page.screenshot({ path: 'ingame-1280-table.png' });
    await B.ctx.close();
  }

  // ===== 6) Local mode outside Claude: AP_KEY exactly as before, plus Rückgängig =====
  {
    const seedLs = { [LS_KEY]: { settings: null, workers: Object.entries(SEED_W).map(([id, w]) => ({ id, ...w })) } };
    const L = await phone(browser, null, { name: 'L', inClaude: false, seedLs });
    const ap = () => L.page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), AP_KEY);
    await L.page.click('#wp-w_agnes [data-applied]');
    const t = await toastState(L.page);
    const a1 = await ap();
    check('local: toast text + Rückgängig', t.msg === 'Als im Spiel eingetragen gemerkt.' && t.act === 'Rückgängig', t);
    check('local: AP_KEY {wid: vals} as before', a1 && a1.w_agnes && Object.keys(a1).join() === 'w_agnes' && Object.keys(a1.w_agnes).length === 11 && !('by' in a1.w_agnes) && !('vals' in a1.w_agnes), a1);
    const c = await card(L.page, 'w_agnes');
    check('local: sealed, no who line', c.sealed && c.who === '', c);
    await clickUndo(L.page);
    check('local undo: removed from AP_KEY', !(await ap()).w_agnes);
    await L.page.click('#wp-w_agnes [data-applied]');
    await L.page.reload(); await L.page.waitForTimeout(500);
    check('local: tick survives reload', (await card(L.page, 'w_agnes')).sealed);
    // Another tab of the same browser ticks Hilde: this tab follows (as before).
    await L.page.evaluate(([k]) => { const a = JSON.parse(localStorage.getItem(k)); a.w_hilde = a.w_agnes; localStorage.setItem(k, JSON.stringify(a)); window.dispatchEvent(new StorageEvent('storage', { key: k })); }, [AP_KEY]);
    await L.page.waitForTimeout(200);
    check('local: other tab change shows', (await card(L.page, 'w_hilde')).dots > 0 || (await card(L.page, 'w_hilde')).sealed);
    // Delete Agnes, then Rückgängig: same id back in LS_KEY, tick back in AP_KEY.
    const agVals = (await ap()).w_agnes;
    await L.page.click('#tab-arbeiter');
    const del = L.page.locator('[data-wid="w_agnes"] [data-act="del"]');
    await del.click(); await L.page.waitForTimeout(500); await del.click();
    const gone = await L.page.evaluate(([k, l]) => ({ ap: JSON.parse(localStorage.getItem(k)), ws: JSON.parse(localStorage.getItem(l)).workers.map(w => w.id) }), [AP_KEY, LS_KEY]);
    check('local delete: removed from both keys', !gone.ap.w_agnes && !gone.ws.includes('w_agnes'), gone);
    await clickUndo(L.page);
    const backL = await L.page.evaluate(([k, l]) => ({ ap: JSON.parse(localStorage.getItem(k)), ws: JSON.parse(localStorage.getItem(l)).workers.map(w => w.id + ':' + w.order) }), [AP_KEY, LS_KEY]);
    check('local delete undo: same id and order, same tick', backL.ws.includes('w_agnes:1') && JSON.stringify(backL.ap.w_agnes) === JSON.stringify(agVals), backL);
    check('local: no migration flag outside Claude', (await L.page.evaluate(f => localStorage.getItem(f), FLAG)) === null);
    await L.ctx.close();
  }

  // ===== 7) Relative time =====
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('rel: ' + e.message));
    await page.goto('file://' + process.cwd() + '/expose.html'); await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const T = window.__t;
      const now = new Date(2026, 9, 14, 10, 0, 0).getTime();
      const h = 3600e3;
      return [
        T.relTime(now - 30e3, now), T.relTime(now - 5 * 60e3, now), T.relTime(now - 2 * h, now), T.relTime(now - 14 * h, now),
        T.relTime(new Date(2026, 9, 12, 18, 0).getTime(), now), T.relTime(new Date(2026, 8, 3, 18, 0).getTime(), now),
        T.relTime(new Date(2026, 9, 14, 0, 30).getTime() - h, new Date(2026, 9, 14, 0, 40).getTime()),
        T.relTime(now + 5000, now), T.relTime(0, now),
      ];
    });
    check('relTime', JSON.stringify(r) === JSON.stringify(['gerade eben', 'vor 5 Min.', 'vor 2 Std.', 'gestern', 'am 12.10.', 'am 03.09.', 'vor 1 Std.', 'gerade eben', '']), r);
    const cl = await page.evaluate(() => [window.__t.cleanIngame({ vals: { a: 1, b: 10, c: -1, d: 2.5, e: '3', f: 0 }, by: 5, at: 'x' }), window.__t.cleanIngame({ name: 'Agnes' }), window.__t.cleanIngame(null)]);
    check('cleanIngame keeps whole numbers 0..9 only', JSON.stringify(cl) === JSON.stringify([{ vals: { a: 1, f: 0 }, by: '', at: 0 }, null, null]), cl);
    await ctx.close();
  }

  check('no page errors', errs.length === 0, errs);
  console.log(`feat-ingame: ${passes} passed, ${fails.length} failed`);
  for (const f of fails) console.log('FAIL ' + f);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();

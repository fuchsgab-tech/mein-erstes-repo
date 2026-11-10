// BUILD 20 "Eigene Figur + wer ist online": each player picks one of 8 drawn figures (or the profile picture from their
// Claude account); a bar next to "Gemeinsam gespeichert" shows the group: who has the app open right now and what
// they are doing (room presence), and when the others were last there ('players' collection, doc id = user id:
// {fig, pic, seen}). Tapping your own figure changes it; tapping someone else's shows it bigger. The small figure also
// stands next to names the app already shows ("eingetragen von Gabriel", "Macht gerade: Gabriel").
// Phones are browser contexts sharing one fake server in node: db collections as feat-duo.js, plus a fake room
// (presence per open page, delivered to every page as onPeers snapshots).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../bellwright-arbeitsplan.html');
const SHOTS = path.resolve(__dirname, '../shots-figur');
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
const LS_KEY = 'bellwright-arbeitsplan-v1';
// BUILD 21: the figures are the players' own portraits now (14 of them); the first eight ids are the saved ones.
const FIG_IDS = ['vogt', 'schmiedin', 'jaeger', 'baeuerin', 'koechin', 'holzfaeller', 'gelehrte', 'wache', 'koenig', 'koenigin', 'prinz', 'fuerst', 'herzog', 'graf'];
const FIG_LABELS = ['Vogt', 'Schmiedin', 'Jäger', 'Bäuerin', 'Köchin', 'Holzfäller', 'Gelehrter', 'Wache', 'König', 'Königin', 'Prinz', 'Fürst', 'Herzog', 'Graf'];

const st = o => Object.fromEntries(Object.entries(o).map(([k, [cur, max]]) => [k, { cur, max }]));
const NAMES = ['Agnes', 'Bertram', 'Cilli', 'Dietmar', 'Edda', 'Fritz'];
const STATS = [
  { labourer: [3, 5], harvesting: [6, 9], farming: [2, 4], cooking: [1, 3], crafting: [2, 6], researching: [0, 2], hunting: [5, 8] },
  { labourer: [7, 9], harvesting: [4, 6], farming: [1, 3], cooking: [2, 4], crafting: [3, 5], researching: [1, 3], hunting: [2, 4] },
  { labourer: [4, 6], harvesting: [2, 4], farming: [8, 10], cooking: [3, 5], crafting: [2, 4], researching: [2, 3], hunting: [1, 2] },
  { labourer: [5, 7], harvesting: [3, 5], farming: [2, 4], cooking: [7, 9], crafting: [1, 3], researching: [2, 4], hunting: [3, 5] },
  { labourer: [2, 4], harvesting: [1, 3], farming: [3, 6], cooking: [8, 10], crafting: [2, 4], researching: [3, 5], hunting: [0, 2] },
  { labourer: [6, 8], harvesting: [5, 7], farming: [4, 6], cooking: [2, 3], crafting: [6, 9], researching: [1, 2], hunting: [2, 3] },
];
const SEED_W = Object.fromEntries(NAMES.map((n, i) => ['w_' + n.toLowerCase(), { name: n, role: 'worker', traits: '', order: i + 1, stats: st(STATS[i]) }]));
const FIVES = Object.fromEntries(T.JOBS.map(j => [j.id, 5]));
const INGAME = Object.fromEntries(Object.keys(SEED_W).map(id => [id, { vals: FIVES, by: 'u_old', at: Date.now() - 2 * 864e5 }]));
const DIR = { u_a: 'Gabriel', u_b: 'Lena', u_ro: 'Ida' };
const YESTERDAY_NOON = (() => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(12, 0, 0, 0); return d.getTime(); })();   // always "gestern"

// ---------- fake server: db collections + a room ----------
function makeServer(seed = {}) {
  const maps = new Map();
  const col = c => { if (!maps.has(c)) maps.set(c, new Map()); return maps.get(c); };
  const srv = { col, log: [], pages: new Set(), room: new Map() };
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) col(c).set(id, clone(d));
  srv.docs = c => [...col(c)].map(([id, d]) => [id, clone(d)]);
  srv.broadcast = c => { const docs = srv.docs(c); for (const p of srv.pages) p.evaluate(([c, docs]) => window.__deliver && window.__deliver(c, docs), [c, docs]).catch(() => {}); };
  srv.write = async (who, op, c, id, d) => {
    await sleep(60);
    if (op === 'set') col(c).set(id, clone(d)); else col(c).delete(id);
    srv.log.push({ who, op, c, id, d: d && clone(d) });
    setTimeout(() => srv.broadcast(c), 10);
  };
  srv.put = (c, id, d) => { col(c).set(id, clone(d)); srv.broadcast(c); };
  srv.get = (c, id) => { const d = col(c).get(id); return d ? clone(d) : null; };
  // The room: one peer per open page (peer label = the page's name), presence merged per field.
  srv.peers = () => [...srv.room.values()].map(p => clone(p));
  srv.roomBroadcast = () => { const list = srv.peers(); for (const p of srv.pages) p.evaluate(l => window.__deliverPeers && window.__deliverPeers(l), list).catch(() => {}); };
  srv.join = (name, by) => { if (!srv.room.has(name)) srv.room.set(name, { peer: name, by, presence: {}, updatedAt: Date.now() }); setTimeout(srv.roomBroadcast, 20); return srv.peers(); };
  srv.presence = (name, by, patch) => {
    const p = srv.room.get(name) || { peer: name, by, presence: {}, updatedAt: 0 };
    const pr = { ...p.presence };
    for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete pr[k]; else pr[k] = v; }
    srv.room.set(name, { ...p, presence: pr, updatedAt: Date.now() });
    setTimeout(srv.roomBroadcast, 20);
  };
  srv.leave = name => { if (srv.room.delete(name)) setTimeout(srv.roomBroadcast, 20); };
  return srv;
}
// cfg: { name, inClaude, writable, user, anim, seedLs, room (false = no room capability) }
function STUB(cfg) {
  try {
    if (cfg.anim !== null) localStorage.setItem('bellwright-anim-v1', JSON.stringify(cfg.anim || 'aus'));
    localStorage.setItem('bellwright-kosten-info-v1', 'true');
    localStorage.setItem('bellwright-sperre-tipp-v1', 'true');
    if (cfg.seedLs && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(cfg.seedLs)) localStorage.setItem(k, JSON.stringify(v)); }
  } catch (e) { /* ignore */ }
  window.__setHidden = h => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
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
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: (cfg.dir || {})[i] || '', avatarUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 8 8%22%3E%3Crect width=%228%22 height=%228%22 fill=%22%23' + (i === 'u_b' ? '3a7' : '777') + '%22/%3E%3C/svg%3E', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  const peerL = [];
  window.__deliverPeers = l => {
    const peers = Object.freeze(l.map(p => Object.freeze({ peer: p.peer, by: p.by, isMe: !!u && p.by === u.id, sameTab: p.peer === cfg.name, kind: 'viewer', guest: false, presence: Object.freeze(p.presence || {}), updatedAt: p.updatedAt })));
    for (const f of peerL) f({ peers, joined: [], left: [], updated: [] });
  };
  window.__presenceCalls = [];
  const room = cfg.room === false ? null : Object.freeze({
    presence: async patch => { window.__presenceCalls.push(JSON.parse(JSON.stringify(patch))); await window.__roomPresence(cfg.name, u ? u.id : null, patch); },
    onPeers: fn => { peerL.push(fn); window.__roomJoin(cfg.name, u ? u.id : null).then(l => window.__deliverPeers(l)); return () => {}; },
    peers: () => Object.freeze([]), connected: () => true, onConnection: fn => { setTimeout(() => fn(true), 0); return () => {}; },
    emit: async () => {}, on: () => () => {},
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : n === 'room' ? room : null) };
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
    await ctx.exposeFunction('__roomJoin', (name, by) => srv.join(name, by));
    await ctx.exposeFunction('__roomPresence', (name, by, patch) => srv.presence(name, by, patch));
    srv.pages.add(page);
    page.on('close', () => { srv.pages.delete(page); srv.leave(cfg.name); });
  }
  await page.addInitScript(STUB, { dir: DIR, ...cfg });
  await page.goto('file://' + process.cwd() + '/page.html' + hash);
  await page.waitForTimeout(500);
  return { ctx, page };
}
async function until(fn, max = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(40); }
  return -1;
}
const gabriel = { id: 'u_a', owner: true, can: true };
const lena = { id: 'u_b', owner: false, can: true };
const ida = { id: 'u_ro', owner: false, can: false };
const seedAll = () => ({ workers: SEED_W, ingame: INGAME });

const vis = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return !!el && !el.closest('[hidden]') && el.getClientRects().length > 0; }, sel);
// The bar, read from the DOM: one entry per chip.
const crew = page => page.evaluate(() => {
  const box = document.getElementById('crew');
  if (!box || box.hidden) return null;
  return [...box.querySelectorAll('.crew-m')].map(b => {
    const tok = b.querySelector('.fig');
    return { uid: b.dataset.crew, cls: b.className, name: b.querySelector('.crew-txt b').textContent, sub: b.querySelector('.crew-txt small').textContent,
      fig: tok ? tok.dataset.fig || (tok.classList.contains('pic') ? 'pic' : tok.classList.contains('q') ? '?' : '') : '', dot: !!b.querySelector('.crew-dot'), label: b.getAttribute('aria-label'), h: b.getBoundingClientRect().height };
  });
});
const chip = async (page, uid) => ((await crew(page)) || []).find(c => c.uid === uid) || null;
const dlg = page => page.evaluate(() => {
  const d = document.getElementById('figdlg');
  return { open: !!d && d.open, title: (d.querySelector('#figdlg-title') || {}).textContent || '', text: d.textContent.replace(/\s+/g, ' ').trim(),
    opts: [...d.querySelectorAll('[data-figpick]')].map(o => ({ id: o.dataset.figpick, pressed: o.getAttribute('aria-pressed'), label: o.textContent.trim() })),
    grid: !!d.querySelector('.figgrid'), active: document.activeElement && (document.activeElement.dataset.figpick || document.activeElement.id || document.activeElement.dataset.crew || document.activeElement.tagName) };
});
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

(async () => {
  const browser = await chromium.launch();

  // ===== 1) Pick a figure, see each other online, follow what the other does =====
  await section('two phones', async () => {
    const srv = makeServer(seedAll());
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: gabriel });
    const PA = A.page;
    await until(async () => (await crew(PA)) !== null);
    let ca = await crew(PA);
    check('the bar shows next to the status', ca !== null && await PA.evaluate(() => document.getElementById('crew').closest('#mast-side') !== null), ca);
    const me0 = ca && ca[0];
    check('first chip is you: "Du", "Wer bist du? Wähl deine Figur", marked as a hint', me0 && me0.uid === 'u_a' && me0.name === 'Du' && me0.sub === 'Wer bist du? Wähl deine Figur' && /\bhint\b/.test(me0.cls), me0);
    check('no figure yet: the profile picture stands in', me0 && me0.fig === 'pic', me0);
    await until(() => srv.get('players', 'u_a') !== null);
    const p0 = srv.get('players', 'u_a');
    check('opening the app notes when you were there: players/u_a {fig:"", pic:false, seen}', p0 && p0.fig === '' && p0.pic === false && p0.seen > Date.now() - 60e3, p0);
    // Pick a figure.
    await PA.click('#crew [data-crew="u_a"]'); await PA.waitForTimeout(200);
    let d = await dlg(PA);
    check('own chip opens "Wer bist du?" with the 14 figures and the profile picture', d.open && d.title === 'Wer bist du?' && d.opts.length === 15 && JSON.stringify(d.opts.slice(0, 14).map(o => o.id)) === JSON.stringify(FIG_IDS) && d.opts[14].id === 'pic', d);
    const pics = await PA.evaluate(() => [...document.querySelectorAll('#figdlg .fig[data-fig]')].map(e => getComputedStyle(e).backgroundImage.startsWith('url("data:image/jpeg')));
    check('every figure shows its portrait', pics.length === 14 && pics.every(Boolean), pics);
    check('figure names as in the app', JSON.stringify(d.opts.map(o => o.label)) === JSON.stringify([...FIG_LABELS, 'Profilbild']), d.opts.map(o => o.label));
    check('the dialog says who you are', d.text.includes('Du bist Gabriel.'), d.text);
    check('nothing chosen yet', d.opts.every(o => o.pressed === 'false'), d.opts);
    await PA.click('[data-figpick="schmiedin"]'); await PA.waitForTimeout(100);
    d = await dlg(PA);
    check('a tap selects (aria-pressed) and keeps the dialog open', d.open && d.opts.find(o => o.id === 'schmiedin').pressed === 'true' && d.opts.filter(o => o.pressed === 'true').length === 1, d.opts);
    await until(() => (srv.get('players', 'u_a') || {}).fig === 'schmiedin');
    const p1 = srv.get('players', 'u_a');
    check('saved at once: players/u_a fig "schmiedin"', p1 && p1.fig === 'schmiedin' && p1.pic === false, p1);
    await PA.screenshot({ path: path.join(SHOTS, 'figur-390-pick.png') });
    await PA.click('#figdlg-ok'); await PA.waitForTimeout(200);
    d = await dlg(PA);
    const me1 = await chip(PA, 'u_a');
    check('"Fertig" closes; the chip shows the Schmiedin, focus back on it', !d.open && me1.fig === 'schmiedin' && me1.sub === 'Schmiedin' && !/\bhint\b/.test(me1.cls) && d.active === 'u_a', { d, me1 });

    // Lena opens: each sees the other online.
    const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: lena });
    const PB = B.page;
    await until(async () => { const c = await chip(PB, 'u_a'); return c && /\bon\b/.test(c.cls); });
    let ga = await chip(PB, 'u_a');
    check('B sees Gabriel online, as the Schmiedin, "schaut den Plan an"', ga && ga.name === 'Gabriel' && ga.fig === 'schmiedin' && /\bon\b/.test(ga.cls) && ga.dot && ga.sub === 'schaut den Plan an', ga);
    await until(async () => { const c = await chip(PA, 'u_b'); return c && /\bon\b/.test(c.cls); });
    let lb = await chip(PA, 'u_b');
    check('A sees Lena online with her profile picture (no figure chosen)', lb && lb.name === 'Lena' && lb.fig === 'pic' && lb.dot, lb);
    ca = await crew(PA);
    check('order: you first, then the others', ca[0].uid === 'u_a' && ca[1].uid === 'u_b', ca.map(c => c.uid));
    // What Lena does, live.
    for (const [tab, want] of [['lager', 'prüft das Lager'], ['arbeiter', 'bearbeitet Arbeiter'], ['jobs', 'in den Einstellungen'], ['wissen', 'liest die Hilfe'], ['plan', 'schaut den Plan an']]) {
      await PB.click('#tab-' + tab);
      const t = await until(async () => ((await chip(PA, 'u_b')) || {}).sub === want);
      check(`Lena on "${tab}": A reads "${want}"`, t >= 0, await chip(PA, 'u_b'));
    }
    // Zu zweit: Lena takes part 2.
    await until(() => vis(PB, '#duo-open'));
    await PB.click('#duo-open'); await PB.waitForTimeout(200);
    const duoWho = await PB.evaluate(() => [...document.querySelectorAll('#duo .duo-who')].map(e => ({ t: e.textContent, fig: !!e.querySelector('.fig') })));
    check('nobody on a part yet: no "Macht gerade" lines', duoWho.length === 0, duoWho);
    await PB.click('[data-duo-pick="1"]'); await PB.waitForTimeout(300);
    let t = await until(async () => ((await chip(PA, 'u_b')) || {}).sub === 'trägt Teil 2 ein');
    check('Lena in part 2: A reads "trägt Teil 2 ein"', t >= 0, await chip(PA, 'u_b'));
    await PA.click('#duo-open'); await PA.waitForTimeout(250);
    const dw = await PA.evaluate(() => [...document.querySelectorAll('#duo .duo-who')].map(e => ({ t: e.textContent.trim(), fig: (e.querySelector('.fig') || { className: '' }).className })));
    check('duo chooser: "Macht gerade: Lena" (Lena has no figure: no token)', dw.length === 1 && dw[0].t === 'Macht gerade: Lena' && dw[0].fig === '', dw);
    await PA.click('[data-duo-pick="0"]'); await PA.waitForTimeout(350);
    t = await until(async () => ((await chip(PB, 'u_a')) || {}).sub === 'trägt Teil 1 ein');
    check('Gabriel in part 1: B reads "trägt Teil 1 ein" (the bar sits behind the mode, it still follows)', t >= 0, await chip(PB, 'u_a'));
    // Gabriel ticks one: his figure next to "eingetragen von Gabriel".
    const firstWid = await PA.evaluate(() => document.querySelector('#entry-stage .entry-card').dataset.wid);
    await PA.click('#entry-next'); await PA.waitForTimeout(450);
    await PA.click('[data-e="back"]'); await PA.waitForTimeout(450);
    const who1 = await PA.evaluate(() => { const w = document.querySelector('#entry .applied-who'); return w ? { t: w.textContent, fig: (w.querySelector('.fig') || { dataset: {} }).dataset.fig || '' } : null; });
    check('Eintragen-Modus: the Schmiedin next to "eingetragen von Gabriel"', who1 && who1.t.startsWith('eingetragen von Gabriel') && who1.fig === 'schmiedin', who1);
    await PA.keyboard.press('Escape'); await PA.waitForTimeout(200);
    await PB.keyboard.press('Escape'); await PB.waitForTimeout(200);
    await until(async () => PB.evaluate(id => { const c = document.querySelector(`#wp-${id} .applied-who`); return !!(c && c.querySelector('.fig')); }, firstWid));
    const who2 = await PB.evaluate(id => { const c = document.querySelector(`#wp-${id} .applied-who`); return c ? { t: c.textContent, fig: (c.querySelector('.fig') || { dataset: {} }).dataset.fig || '' } : null; }, firstWid);
    check('B\'s plan card: the Schmiedin next to "eingetragen von Gabriel"', who2 && who2.t.startsWith('eingetragen von Gabriel') && who2.fig === 'schmiedin', who2);
    t = await until(async () => ((await chip(PA, 'u_b')) || {}).sub === 'schaut den Plan an');
    check('Lena closed the mode: back to "schaut den Plan an"', t >= 0, await chip(PA, 'u_b'));
    // Lena picks her profile picture on purpose.
    await PB.click('#crew [data-crew="u_b"]'); await PB.waitForTimeout(150);
    await PB.click('[data-figpick="pic"]'); await PB.waitForTimeout(100);
    await until(() => (srv.get('players', 'u_b') || {}).pic === true);
    check('profile picture saved: players/u_b pic true', (srv.get('players', 'u_b') || {}).pic === true, srv.get('players', 'u_b'));
    await PB.keyboard.press('Escape'); await PB.waitForTimeout(150);
    check('Escape closes the dialog', !(await dlg(PB)).open);
    lb = await chip(PB, 'u_b');
    check('B\'s own chip: picture, "Profilbild"', lb.fig === 'pic' && lb.sub === 'Profilbild', lb);
    // Lena puts the app in the background, then leaves.
    await PB.evaluate(() => window.__setHidden(true));
    t = await until(async () => ((await chip(PA, 'u_b')) || {}).sub === 'hat die App im Hintergrund');
    lb = await chip(PA, 'u_b');
    check('background: "hat die App im Hintergrund", marked away', t >= 0 && /\baway\b/.test(lb.cls), lb);
    await PB.evaluate(() => window.__setHidden(false));
    await until(async () => ((await chip(PA, 'u_b')) || {}).sub === 'schaut den Plan an');
    await B.ctx.close();
    t = await until(async () => { const c = await chip(PA, 'u_b'); return c && /\boff\b/.test(c.cls); });
    lb = await chip(PA, 'u_b');
    check('Lena gone: grey, no dot, "eben noch da"', t >= 0 && !lb.dot && lb.sub === 'eben noch da', lb);
    srv.put('players', 'u_b', { ...srv.get('players', 'u_b'), seen: Date.now() - 2 * 3600e3 - 60e3 });
    t = await until(async () => ((await chip(PA, 'u_b')) || {}).sub === 'zuletzt vor 2 Std.');
    check('two hours later: "zuletzt vor 2 Std."', t >= 0, await chip(PA, 'u_b'));
    // Tap Lena: bigger, with what she is up to.
    await PA.click('#crew [data-crew="u_b"]'); await PA.waitForTimeout(200);
    d = await dlg(PA);
    check('tapping someone else: name, picture and status bigger, no figure grid', d.open && d.title === 'Lena' && !d.grid && d.text.includes('zuletzt vor 2 Std.') && d.text.includes('Profilbild'), d);
    await PA.screenshot({ path: path.join(SHOTS, 'figur-390-view.png') });
    await PA.click('#figdlg button[type="submit"]'); await PA.waitForTimeout(150);
    check('closing goes back to Lena\'s chip', !(await dlg(PA)).open && (await dlg(PA)).active === 'u_b', await dlg(PA));
    // The seen time stays fresh while the app is open (every few minutes) — here: a change of the figure writes it too.
    await A.ctx.close();
  });

  // ===== 2) The viewer, and a page without the room =====
  await section('viewer and no room', async () => {
    const srv = makeServer({ ...seedAll(), players: { u_a: { fig: 'vogt', pic: false, seen: YESTERDAY_NOON } } });
    const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, user: ida });
    const PC = C.page;
    await until(async () => (await crew(PC)) !== null && (await chip(PC, 'u_a')) !== null);
    const mc = await chip(PC, 'u_ro');
    check('viewer: own chip without the "Wähl deine Figur" hint', mc && mc.name === 'Du' && !/\bhint\b/.test(mc.cls) && mc.fig === 'pic', mc);
    const ga = await chip(PC, 'u_a');
    check('viewer: Gabriel (offline) as the Vogt, "zuletzt gestern"', ga && ga.fig === 'vogt' && /\boff\b/.test(ga.cls) && ga.sub === 'zuletzt gestern', ga);
    await PC.click('#crew [data-crew="u_ro"]'); await PC.waitForTimeout(150);
    const d = await dlg(PC);
    check('viewer: own chip opens the view, no grid', d.open && !d.grid && d.title === 'Ida', d);
    await PC.keyboard.press('Escape');
    check('viewer: nothing written', srv.log.every(x => x.who !== 'C'), srv.log);
    // Without the room the bar still shows the group from the saved data.
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: gabriel, room: false });
    await until(async () => (await crew(A.page)) !== null);
    const ca = await crew(A.page);
    check('no room: the bar shows you as the Vogt, no errors', ca && ca[0].uid === 'u_a' && ca[0].fig === 'vogt', ca);
    const ic = await chip(A.page, 'u_ro');
    check('no room: the viewer (online elsewhere) does not show as online here', !ic || !/\bon\b/.test(ic.cls), ic);
    // Ida (in the room) sees nothing of Gabriel's page: his page has no room.
    await sleep(500);
    check('the viewer does not see Gabriel online (his page has no room)', !/\bon\b/.test(((await chip(PC, 'u_a')) || { cls: '' }).cls), await chip(PC, 'u_a'));
    await A.ctx.close(); await C.ctx.close();
  });

  // ===== 3) Local mode: one device, nothing to show =====
  await section('local mode', async () => {
    const workers = Object.entries(SEED_W).map(([id, w]) => ({ id, ...w }));
    const L = await phone(browser, null, { name: 'L', inClaude: false, seedLs: { [LS_KEY]: { workers } } });
    await sleep(300);
    check('local mode: no bar', (await crew(L.page)) === null);
    await L.ctx.close();
  });

  // ===== 4) Layout =====
  for (const [width, height] of [[360, 740], [390, 844], [1280, 900]]) {
    await section(`layout ${width}`, async () => {
      const srv = makeServer({ ...seedAll(), players: { u_a: { fig: 'holzfaeller', pic: false, seen: Date.now() } } });
      const B = await phone(browser, srv, { name: 'B' + width, inClaude: true, writable: true, user: lena }, { width, height });
      const A = await phone(browser, srv, { name: 'A' + width, inClaude: true, writable: true, user: gabriel, anim: 'voll' }, { width, height });
      const PA = A.page;
      await until(async () => { const c = await chip(PA, 'u_b'); return c && /\bon\b/.test(c.cls); });
      check(`${width}: no horizontal scroll with the bar`, await noOverflow(PA));
      const ca = await crew(PA);
      if (width < 900) check(`${width}: chips at least 44 px tall`, ca.every(c => c.h >= 43.5), ca.map(c => c.h));
      await PA.screenshot({ path: path.join(SHOTS, `figur-${width}-bar.png`) });
      await PA.click('#crew [data-crew="u_a"]'); await PA.waitForTimeout(400);
      const box = await PA.evaluate(() => { const r = document.getElementById('figdlg').getBoundingClientRect(); const o = [...document.querySelectorAll('.figopt')].map(b => b.getBoundingClientRect()); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight, minH: Math.min(...o.map(x => x.height)) }; });
      check(`${width}: the dialog fits the screen, options at least 44 px`, box.l >= 0 && box.r <= box.w + 0.5 && box.t >= 0 && box.minH >= 44, box);
      await PA.screenshot({ path: path.join(SHOTS, `figur-${width}-pick.png`) });
      await A.ctx.close(); await B.ctx.close();
    });
  }

  // ===== 5) Motion =====
  await section('motion', async () => {
    for (const [anim, dot, sheet] of [['voll', /crewPulse/, /sheetIn/], ['ruhig', /^none$/, /calmIn/], ['aus', /^none$/, /^none$/]]) {
      const srv = makeServer(seedAll());
      const B = await phone(browser, srv, { name: 'MB' + anim, inClaude: true, writable: true, user: lena });
      const A = await phone(browser, srv, { name: 'MA' + anim, inClaude: true, writable: true, user: gabriel, anim });
      await until(async () => { const c = await chip(A.page, 'u_b'); return c && /\bon\b/.test(c.cls); });
      const dn = await A.page.evaluate(() => getComputedStyle(document.querySelector('#crew .crew-dot'), '::after').animationName);
      check(`${anim}: the online dot ${dot}`, dot.test(dn), dn);
      await A.page.click('#crew [data-crew="u_a"]');
      const sn = await A.page.evaluate(() => getComputedStyle(document.getElementById('figdlg')).animationName);
      check(`${anim}: the dialog comes in with ${sheet}`, sheet.test(sn), sn);
      const tr = await A.page.evaluate(() => [...document.querySelectorAll('#crew, #crew *, #figdlg, #figdlg *')].map(el => getComputedStyle(el).transitionProperty).filter(p => p && p !== 'all' && p !== 'none' && !/^(opacity|transform|background-color|border-color|color|box-shadow)(, (opacity|transform|background-color|border-color|color|box-shadow))*$/.test(p)));
      check(`${anim}: no layout transitions`, tr.length === 0, tr);
      if (anim === 'voll') {
        await A.page.evaluate(() => window.__setHidden(true));
        const ps = await A.page.evaluate(() => getComputedStyle(document.querySelector('#crew .crew-dot'), '::after').animationPlayState);
        check('voll: the pulse pauses while the page is hidden', ps === 'paused', ps);
        await A.page.evaluate(() => window.__setHidden(false));
      }
      await A.ctx.close(); await B.ctx.close();
    }
    const srv = makeServer(seedAll());
    const R = await phone(browser, srv, { name: 'RM', inClaude: true, writable: true, user: gabriel, anim: null }, { reduced: true });
    await until(async () => (await crew(R.page)) !== null);
    await R.page.click('#crew [data-crew="u_a"]');
    const rn = await R.page.evaluate(() => ({ a: document.documentElement.dataset.anim, n: getComputedStyle(document.getElementById('figdlg')).animationName }));
    check('reduced motion (no choice made): "aus", the dialog does not move', rn.a === 'aus' && rn.n === 'none', rn);
    await R.ctx.close();
  });

  await browser.close();
  if (errs.length) { console.log('page errors:'); for (const e of [...new Set(errs)].slice(0, 20)) console.log('  ' + e); }
  console.log(`\nfeat-figur: ${passes} passed, ${fails.length} failed`);
  for (const f of fails) console.log('FAIL ' + f);
  process.exit(fails.length || errs.length ? 1 : 0);
})();

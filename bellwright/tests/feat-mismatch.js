// BUILD 17 "Abweichungen zum Spiel deutlich markieren": after the photo check (BUILD 16) a priority that stands wrong in
// the game is marked in the plan, so one sees at once (1) that it does not match, (2) what is in the game and (3) what it
// should be ("~~1~~ → 7", Helene Colley Bau). Wording (the user): it is the PRIORITIES that are wrong, not the villagers.
// Data: the new collection 'checks' (doc id = worker id) written by the check's "Übernehmen" for every villager it took:
// {at, by, vals, want}: vals = the game's numbers (the same object as the 'ingame' snapshot), want = what the check asked
// for (the plan's number; the game's number where "So lassen" kept it). A priority is marked red while the villager's
// snapshot is still the one the check wrote (the same vals; review: not "ingame.at <= checks.at" alone, see 10), the photo showed it wrong
// (vals != want) and it still differs from the plan now. A number that only moved in the plan since then keeps the ember dot.
// Data: fixtures/check-live.json (the group's roster, settings, tick-off and the lead's transcription of their table photos).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../bellwright-arbeitsplan.html');
const SHOTS = path.resolve(__dirname, '../shots-mismatch');
const FIX = path.resolve(__dirname, 'fixtures');
fs.mkdirSync(SHOTS, { recursive: true });
function load(file) {
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf('// ---------- Game data ----------');
  const b = s.indexOf('// ---------- Rendering: Plan ----------');
  const fn = new Function('localStorage', 'matchMedia', 'document', '"use strict";\n' + s.slice(a, b) + '\nreturn { compute, JOB, JOBS, GAME_ORDER, PHASES, normSettings, normWorker };');
  const store = {};
  return fn({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, () => ({ matches: false }), undefined);
}
const T = load(APP);
const F = JSON.parse(fs.readFileSync(path.join(FIX, 'check-live.json'), 'utf8'));
const IMG_FILES = ['tabelle-1.jpg', 'tabelle-2.jpg'].map(f => path.join(FIX, f));
let IMGS = IMG_FILES;   // the group's real photos; without them (the repo copy keeps only the JSON) two drawn stand-ins
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x);
const xs = v => v === 0 ? 'X' : String(v);      // a number as the game shows it (locked = X)
const ps = v => v === 0 ? 'aus' : String(v);    // a number as the plan shows it (locked = aus)
const two = n => String(n).padStart(2, '0');
const dateDe = at => { const d = new Date(at); return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() : ''}`; };
const prio = n => `${n} ${n === 1 ? 'Priorität' : 'Prioritäten'}`;
const LEAD = (n, m) => `${n} ${n === 1 ? 'Priorität steht' : 'Prioritäten stehen'} im Spiel falsch (bei ${m} ${m === 1 ? 'Bewohner' : 'Bewohnern'})`;
const BADGE = n => `⚠ ${prio(n)} falsch im Spiel`;
const ELINE = n => `Laut Foto ${n === 1 ? 'steht diese Priorität' : 'stehen diese Prioritäten'} im Spiel falsch`;
const WHY = (at, g, t) => `Laut Foto-Prüfung vom ${dateDe(at)} steht im Spiel ${xs(g)}. Soll: ${ps(t)}.`;
const FILTER_KEY = 'bellwright-nur-falsche-v1';

// ---------- the group's data and what the planner says about it ----------
const SEED_W = Object.fromEntries(F.workers.map(w => [w.id, { name: w.name, role: w.role, traits: w.traits, order: w.order, stats: w.stats }]));
const roster = F.workers.map(w => T.normWorker(w.id, w)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
const S = T.normSettings(F.settings);
const ID = Object.fromEntries(roster.map(w => [w.name, w.id]));
const NAME = Object.fromEntries(roster.map(w => [w.id, w.name]));
const anchorOf = ing => Object.fromEntries(Object.entries(ing).map(([k, v]) => [k, v.vals]));
const cellVal = c => c.off ? 0 : c.p;
const PLAN0 = T.compute(roster, S, { calm: !!S.calm, anchor: anchorOf(F.ingame), prefs: {} });
const ROWVALS = Object.fromEntries(Object.entries(F.photoRows).map(([n, r]) => [n, r.split(' ').map(x => x === 'X' ? 'X' : +x)]));
const GAME = Object.fromEntries(Object.entries(ROWVALS).map(([n, v]) => [ID[n], Object.fromEntries(T.GAME_ORDER.map((id, i) => [id, v[i] === 'X' ? 0 : v[i]]))]));
const gameSnap = id => Object.fromEntries(PLAN0.jobs.map(j => [j.id, GAME[id][j.id]]));
const planNow = id => Object.fromEntries(PLAN0.jobs.map(j => [j.id, cellVal(PLAN0.cells[id][j.id])]));
// The villagers whose photo row differs from the plan (BUILD 16's 10), in roster order.
const DIFF_IDS = roster.filter(w => PLAN0.jobs.some(j => GAME[w.id][j.id] !== cellVal(PLAN0.cells[w.id][j.id]))).map(w => w.id);
const OK_IDS = roster.filter(w => !DIFF_IDS.includes(w.id)).map(w => w.id);

// The marks a page has to show for the server's data: {"wid|jobId": {g, t, main, fixed}}, plus the numbers that only
// moved in the plan since the last tick ("wid|jobId" with the ember dot). Restates the rule of the spec, independently.
function expectNow(srv) {
  const st = T.normSettings(srv.col('settings').get('main'));
  const ws = roster.filter(w => srv.col('workers').has(w.id));
  const ing = srv.obj('ingame'), chk = srv.obj('checks');
  const P = T.compute(ws, st, { calm: !!st.calm, anchor: anchorOf(ing), prefs: srv.obj('prefs') });
  const marks = {}, chg = [];
  for (const w of P.team) {
    const c = chk[w.id], s = ing[w.id];
    // The snapshot is still the one the check wrote: the same numbers. An older or newer snapshot with other numbers (a
    // write of the check that did not land, a tick from a phone whose clock is behind) is not: the plan follows it.
    const holds = !!c && !!s && canon(s.vals) === canon(c.vals);
    for (const j of P.jobs) {
      const cell = P.cells[w.id][j.id], t = cellVal(cell), k = w.id + '|' + j.id;
      if (holds && c.vals[j.id] !== undefined && c.vals[j.id] !== t && c.vals[j.id] !== c.want[j.id]) marks[k] = { g: c.vals[j.id], t, main: !!cell.main, fixed: !!(cell.fixed || cell.locked), at: c.at };
      else if (s && s.vals[j.id] !== t) chg.push(k);
    }
  }
  const per = {};
  for (const k of Object.keys(marks)) { const wid = k.split('|')[0]; per[wid] = (per[wid] || 0) + 1; }
  const ids = P.team.filter(w => per[w.id]).map(w => w.id);
  return { P, marks, chg: chg.sort(), per, ids, cells: Object.keys(marks).length };
}
// What the page must show for them (cards: aria-label "Im Spiel 1, soll 7"; table: with name and job in front).
function wantMarks(e, view) {
  return Object.fromEntries(Object.entries(e.marks).map(([k, m]) => {
    const [wid, jid] = k.split('|');
    const tail = `Im Spiel ${xs(m.g)}, soll ${ps(m.t)}${m.main ? ', Hauptjob' : ''}${m.fixed ? ', von euch festgelegt' : ''}`;
    return [k, { was: xs(m.g), to: ps(m.t), aria: view === 'table' ? `${NAME[wid]}, ${T.JOB[jid].label}: ${tail}` : tail, chg: false }];
  }));
}
const sortObj = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));

// The sample's answer: the two photos as the lead transcribed them (as in feat-check.js).
const PHOTO1 = ['Arnold Dixon', 'Crimson Reid', 'Elyza Gernier', 'Fabian Renard', 'Helene Colley', ['Hubert Gernier', 'Hubert Ger…'], 'Imka Durham', 'Jane Hodge', 'Jane Rhodes',
  'Joan Reinfred', 'Jocelyn Fresin', ['Krystoffer Blavier', 'Krystoffer B…'], ['Larkin Reinold', 'Larkin Rein…'], ['Leopold Edgeworth', 'Leopold Edg…'], ['Lubomir Netterby', 'Lubomir Ne…']];
const PHOTO2 = [['Leopold Edgeworth', 'Leopold Edg…'], ['Lubomir Netterby', 'Lubomir Ne…'], ['Michel Warwick', 'Michel War…'], ['Milon Hamnet', 'Milon Ham…'], 'Nell Terrin', 'Nuttel',
  ['Ondrej Barrington', 'Ondrej Barr…'], ['Phoebe Graves', 'Phoebe Gra…'], ['Robert Adelard', 'Robert Adel…'], 'Royce Sykes', 'Rudy Kemper', 'Sal Farman', ['Sam Kinborough', 'Sam Kinbor…'],
  'Saul Belsante', 'Saul Lovell'];
const RESEARCH = T.GAME_ORDER.indexOf('research');
const rowOf = e => { const [full, shown] = Array.isArray(e) ? e : [e, e]; return { name: shown, values: ROWVALS[full].slice(), unsure: full === 'Saul Lovell' ? [RESEARCH] : [] }; };
const REPLY = { rows: [...PHOTO1, ...PHOTO2].map(rowOf), note: '' };

// ---------- fake server and page stub (lazy collections, as feat-check.js) ----------
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
// cfg: { name, inClaude, writable, user, anim, seedLs, logAnim }
function STUB(cfg) {
  try {
    if (cfg.anim) localStorage.setItem('bellwright-anim-v1', JSON.stringify(cfg.anim));
    localStorage.setItem('bellwright-kosten-info-v1', 'true');
    localStorage.setItem('bellwright-sperre-tipp-v1', 'true');
    if (cfg.seedLs && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(cfg.seedLs)) localStorage.setItem(k, JSON.stringify(v)); }
  } catch (e) { /* ignore */ }
  if (cfg.logAnim) {   // every animation the script starts, with the element it runs on
    const orig = Element.prototype.animate;
    window.__anims = [];
    Element.prototype.animate = function (k, o) {
      const frames = Array.isArray(k) ? k : [];
      window.__anims.push({ cls: String(this.className && this.className.baseVal !== undefined ? this.className.baseVal : this.className), key: this.dataset ? (this.dataset.k || this.dataset.cell || '') : '', dur: o && typeof o === 'object' ? o.duration : o,
        props: [...new Set(frames.flatMap(f => Object.keys(f).filter(p => !['offset', 'easing', 'composite'].includes(p))))], t: performance.now() });
      return orig.call(this, k, o);
    };
  }
  window.__calls = [];
  window.__reply = { rows: [] };
  window.__wait = 120;
  const sample = async () => ({ text: '' });
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
  sample.json = (input, opts) => new Promise(res => { window.__calls.push({ n: opts && opts.images ? opts.images.length : 0 }); setTimeout(() => res(JSON.parse(JSON.stringify(window.__reply))), window.__wait); });
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
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: i === 'u_a' ? 'Gabriel' : '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : n === 'sample' ? sample : null) };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 1500) : '')); };
const errs = [];
async function section(name, fn) { try { await fn(); } catch (e) { check(`${name}: runs to the end`, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } }
async function phone(browser, srv, cfg, { width = 390, height = 844, hash = '#plan' } = {}) {
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
const lena = { id: 'u_b', owner: false, can: true };
const viewer = { id: 'u_ro', owner: false, can: false };
const seedAll = (ingame = F.ingame) => ({ workers: SEED_W, settings: { main: F.settings }, ingame });
// As if the check had been taken earlier ("Korrigieren" everywhere): the game's numbers as everybody's snapshot and check.
const AT_CHECK = Date.UTC(2026, 9, 24, 18, 30);
function seedChecked(ids = roster.map(w => w.id)) {
  const ingame = clone(F.ingame), checks = {};
  for (const id of ids) {
    ingame[id] = { vals: gameSnap(id), by: 'u_a', at: AT_CHECK };
    checks[id] = { at: AT_CHECK, by: 'u_a', vals: gameSnap(id), want: planNow(id) };
  }
  return { ...seedAll(ingame), checks };
}

// Everything the plan shows about marks.
const MM = page => page.evaluate(() => {
  const $ = s => document.querySelector(s);
  const vis = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const t = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  const view = $('#plan-view');
  const units = [...view.querySelectorAll('[data-fokus]')];
  const ban = $('#mm-banner'), eb = $('#entry-banner');
  const frame = el => { const cs = getComputedStyle(el); return [cs.boxShadow, cs.outlineColor + ' ' + cs.outlineStyle, cs.borderColor].join(' '); };
  return {
    banner: vis(ban) ? { lead: t(ban.querySelector('.mm-banner-lead')), go: vis($('#mm-go')) ? t($('#mm-go')) : null, only: vis($('#mm-only')) ? t($('#mm-only')) : null,
      aboveEntry: !!eb && !!(ban.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING), edge: getComputedStyle(ban).borderLeftColor } : null,
    filter: vis($('#mm-filter')) ? { text: t($('#mm-filter-text')), all: vis($('#mm-all')) ? t($('#mm-all')) : null } : null,
    legend: vis($('#legend-mm')) ? t($('#legend-mm')) : null,
    view: view.querySelector('.wplan') ? 'cards' : view.querySelector('.matrix') ? 'table' : '',
    ids: units.map(u => u.dataset.fokus),
    marks: Object.fromEntries([...view.querySelectorAll('.mm')].map(el => [el.dataset.k || el.dataset.cell, { was: t(el.querySelector('.mm-was')), to: t(el.querySelector('.mm-to')), aria: el.getAttribute('aria-label'), chg: el.classList.contains('chg') }])),
    look: (() => { const el = view.querySelector('.mm'); if (!el) return null; const w = el.querySelector('.mm-was'), to = el.querySelector('.mm-to'); const ws = getComputedStyle(w);
      return { struck: ws.textDecorationLine, small: parseFloat(ws.fontSize) < parseFloat(getComputedStyle(to).fontSize), wasFirst: !!(w.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING), arrow: el.textContent.includes('→'), frame: frame(el) }; })(),
    badges: Object.fromEntries(units.map(u => [u.dataset.fokus, t(u.querySelector('.mm-badge'))]).filter(x => x[1])),
    chg: [...view.querySelectorAll('.chg')].map(el => el.dataset.k || el.dataset.cell).sort(),
  };
});
const ENTRY = page => page.evaluate(() => {
  const t = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  const c = document.querySelector('#entry-stage .entry-card'), ln = c && c.querySelector('.ep-mm'), rows = c && c.querySelector('.er-rows');
  const cnt = document.getElementById('entry-count').cloneNode(true); for (const x of cnt.querySelectorAll('.vh')) x.remove();   // as seen ("1 / 10")
  return { open: !document.getElementById('entry').hidden, name: t(document.getElementById('entry-name')), count: t(cnt), next: t(document.getElementById('entry-next')),
    finale: !document.getElementById('entry-finale').hidden, line: t(ln), lineAbove: !!ln && !!rows && !!(ln.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING),
    rows: c ? [...c.querySelectorAll('.er-row.diff.mm')].map(r => ({ job: r.dataset.job, from: r.querySelector('.er-from').firstChild.textContent.trim(), to: t(r.querySelector('.er-to')) })) : [] };
});
const toastMsg = page => page.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : (t.querySelector('.toast-msg') || {}).textContent || ''; });
async function readTable(page, reply = REPLY) {
  if (!(await page.evaluate(() => { const b = document.getElementById('check'); return b && !b.hidden; }))) await page.click('#check-open');
  await page.setInputFiles('#check-file', IMGS);
  await page.evaluate(r => { window.__reply = r; }, reply);
  await page.click('#check-read');
  await until(() => page.evaluate(() => { const r = document.getElementById('check-result'); return r && !r.hidden; }), 4000);
  await page.waitForTimeout(80);
}
// Read, confirm Saul Lovell's unsure Forschung (5, as read), Übernehmen ("Korrigieren" everywhere).
async function applyCheck(page) {
  await readTable(page);
  await page.click(`#check-result .ck-card[data-wid="${ID['Saul Lovell']}"] .ck-line[data-job="research"] [data-ck="ok"]`);
  await page.waitForTimeout(80);
  await page.click('#check-apply');
}
async function standIns(browser) {
  const ctx = await browser.newContext({ viewport: { width: 760, height: 760 } });
  const p = await ctx.newPage();
  const out = [];
  for (const [i, rows] of [PHOTO1, PHOTO2].entries()) {
    await p.setContent(`<body style="margin:0;background:#0d1b2a;color:#eee;font:20px Georgia">${rows.map(e => { const [full, shown] = Array.isArray(e) ? e : [e, e];
      return `<div style="display:flex;gap:8px;padding:8px 16px"><span style="width:190px">${shown}</span>${ROWVALS[full].map(v => `<b style="width:28px;text-align:center;border:1px solid #6af">${v === 'X' ? '⊘' : v}</b>`).join('')}</div>`; }).join('')}</body>`);
    out.push({ name: `tabelle-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: await p.screenshot({ type: 'jpeg', quality: 80 }) });
  }
  await ctx.close();
  return out;
}
// The page shows exactly the expected marks, badges, banner and ember dots.
async function same(label, page, e) {
  const r = await MM(page);
  const want = sortObj(wantMarks(e, r.view));
  check(`${label}: the red marks (game small and struck through, the target big, "Im Spiel 1, soll 7"; no ember dot)`, canon(sortObj(r.marks)) === canon(want),
    { view: r.view, extra: Object.keys(r.marks).filter(k => !want[k]).map(k => [k, r.marks[k]]), missing: Object.keys(want).filter(k => !r.marks[k]), diff: Object.keys(want).filter(k => r.marks[k] && canon(r.marks[k]) !== canon(want[k])).map(k => [r.marks[k], want[k]]) });
  const wantB = Object.fromEntries(e.ids.filter(id => r.ids.includes(id)).map(id => [id, BADGE(e.per[id])]));
  check(`${label}: "⚠ n Prioritäten falsch im Spiel" on exactly these villagers`, canon(r.badges) === canon(wantB), { got: r.badges, want: wantB });
  check(`${label}: banner "${e.cells ? LEAD(e.cells, e.ids.length) : '(none)'}"`, e.cells ? !!r.banner && r.banner.lead === LEAD(e.cells, e.ids.length) && r.banner.go === 'Jetzt korrigieren' : !r.banner, r.banner);
  const wantChg = e.chg.filter(k => r.ids.includes(k.split('|')[0]));
  check(`${label}: plan-only changes keep the ember dot`, canon(r.chg) === canon(wantChg), { got: r.chg.filter(k => !wantChg.includes(k)), missing: wantChg.filter(k => !r.chg.includes(k)) });
  return r;
}

(async () => {
  const browser = await chromium.launch();
  if (!IMG_FILES.every(f => fs.existsSync(f))) IMGS = await standIns(browser);
  try {
    // ===== 1) The real photos taken over: marks on two phones, filter, Jetzt korrigieren, a tick, a phase switch, delete =====
    await section('1) owner and Lena', async () => {
      check('fixture: 10 villagers differ from the plan', DIFF_IDS.length === 10, DIFF_IDS.map(id => NAME[id]));
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: owner, anim: 'aus' });
      const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: lena, anim: 'aus' }, { width: 1280, height: 900 });
      const P = A.page;
      let r = await MM(P);
      check('before any check: no banner, no marks, no legend entry', !r.banner && !Object.keys(r.marks).length && !Object.keys(r.badges).length && !r.legend, r);
      const t0 = Date.now();
      await applyCheck(P);
      await until(async () => srv.log.filter(x => x.c === 'ingame').length >= 28 && srv.log.filter(x => x.c === 'checks').length >= 28, 5000);
      await P.waitForTimeout(200);
      check('after Übernehmen the focus is on "Jetzt korrigieren" (the one next step)', await P.evaluate(() => document.activeElement && document.activeElement.id === 'mm-go'), await P.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
      // the data
      const ing = srv.obj('ingame'), chk = srv.obj('checks');
      const bad = roster.filter(w => { const c = chk[w.id], d = ing[w.id];
        return !c || canon(Object.keys(c).sort()) !== canon(['at', 'by', 'vals', 'want']) || c.by !== 'u_a' || !(c.at >= t0) || c.at !== d.at || canon(c.vals) !== canon(d.vals) || canon(c.vals) !== canon(gameSnap(w.id)) || canon(c.want) !== canon(planNow(w.id)); });
      check('"Übernehmen" writes one \'checks\' doc per villager: {at, by, vals (= the ingame snapshot), want (= the plan the check compared with)}', !bad.length && srv.docs('checks').length === 28, bad.map(w => ({ n: w.name, c: chk[w.id] })));
      check('only ingame and checks were written (no worker docs get new fields, no prefs without "So lassen")', srv.log.every(x => x.c === 'ingame' || x.c === 'checks'), [...new Set(srv.log.map(x => x.c))]);
      // phone A (cards)
      let e = expectNow(srv);
      check('expected after the check: 13 priorities wrong at the 10 villagers (Helene Colley Bau: game 1, plan 7)', e.cells === 13 && canon(e.ids) === canon(DIFF_IDS) && canon(e.marks[ID['Helene Colley'] + '|construction'] && [e.marks[ID['Helene Colley'] + '|construction'].g, e.marks[ID['Helene Colley'] + '|construction'].t]) === '[1,7]', { cells: e.cells, ids: e.ids.map(id => NAME[id]) });
      r = await same('A cards after Übernehmen', P, e);
      check('A: cards view', r.view === 'cards');
      check('the banner sits above the entry banner, crimson edge; the legend explains the mark', r.banner && r.banner.aboveEntry && r.banner.edge === 'rgb(179, 54, 47)' && r.banner.only === 'Nur diese zeigen' && r.legend === 'steht laut Foto falsch im Spiel', { banner: r.banner, legend: r.legend });
      check('wording (the user): it is the priorities, never "Bewohner passen nicht"', !(await P.evaluate(() => /passen[^.]*nicht zum Spiel|passt[^.]*nicht zum Spiel/.test(document.body.innerText))));
      check('the mark: the game value small and struck through before the target, an arrow, a crimson frame', r.look && r.look.struck === 'line-through' && r.look.small && r.look.wasFirst && r.look.arrow && /rgb\(230, 107, 93\)|rgb\(179, 54, 47\)/.test(r.look.frame), r.look);
      const hk = ID['Helene Colley'] + '|construction';
      check('Helene Colley: Bau "~~1~~ → 7", aria-label "Im Spiel 1, soll 7"', r.marks[hk] && r.marks[hk].was === '1' && r.marks[hk].to === '7' && r.marks[hk].aria === 'Im Spiel 1, soll 7', r.marks[hk]);
      check('X stays X in the game: Joan Reinfred Holzfällen "~~X~~ → 1"', canon(r.marks[ID['Joan Reinfred'] + '|woodcutting'] && [r.marks[ID['Joan Reinfred'] + '|woodcutting'].was, r.marks[ID['Joan Reinfred'] + '|woodcutting'].to]) === '["X","1"]', r.marks[ID['Joan Reinfred'] + '|woodcutting']);
      // the reason row of a marked priority: the photo line on top
      await P.click(`[data-focus="r:${hk}"]`); await P.waitForTimeout(80);
      const why = await P.evaluate(k => { const d = document.querySelector(`#plan-view details[data-key="${k}"]`); return d && { open: d.open, first: d.children[1] && d.children[1].className, text: d.children[1] && d.children[1].textContent.trim() }; }, hk);
      const atA = srv.obj('checks')[ID['Helene Colley']].at;
      check('cards: tapping the row opens it with "Laut Foto-Prüfung vom … steht im Spiel 1. Soll: 7." on top', why && why.open && /mm-why/.test(why.first) && why.text === WHY(atA, 1, 7), { why, want: WHY(atA, 1, 7) });
      await P.evaluate(k => document.querySelector(`#plan-view details[data-key="${k}"]`).scrollIntoView({ block: 'center' }), hk); await P.waitForTimeout(60);
      await P.screenshot({ path: path.join(SHOTS, 'flow-390-reason.png') });
      // phone B (table, 1280) sees it live
      await until(() => B.page.evaluate(() => document.querySelectorAll('#plan-view .mm').length >= 13), 3000);
      const rb = await same('B table, live from A', B.page, e);
      check('B: table view', rb.view === 'table');
      await B.page.click(`[data-cell="${hk}"]`); await B.page.waitForTimeout(80);
      const rwhy = await B.page.evaluate(() => { const f = document.querySelector('#reason-text').firstElementChild; return f && { cls: f.className, text: f.textContent.trim() }; });
      check('table: a click on the cell shows the photo line on top of the reason box', rwhy && /mm-why/.test(rwhy.cls) && rwhy.text === WHY(atA, 1, 7), rwhy);
      await B.page.screenshot({ path: path.join(SHOTS, 'flow-1280-table.png') });
      // the filter (per device)
      await P.click('#mm-only'); await P.waitForTimeout(100);
      r = await MM(P);
      check('"Nur diese zeigen": only the 10 villagers, the chip "Alle zeigen", focus on it', canon(r.ids) === canon(DIFF_IDS) && r.filter && r.filter.all === 'Alle zeigen' && !(r.banner && r.banner.only) && await P.evaluate(() => document.activeElement && document.activeElement.id === 'mm-all'), { ids: r.ids.map(i => NAME[i]), filter: r.filter });
      check('the other phone keeps showing everybody', (await MM(B.page)).ids.length === 28);
      await P.screenshot({ path: path.join(SHOTS, 'flow-390-filter.png') });
      await P.reload(); await P.waitForTimeout(600);
      check('the filter stays on this device after a reload', canon((await MM(P)).ids) === canon(DIFF_IDS));
      await P.click('[data-view="table"]'); await P.waitForTimeout(100);
      r = await MM(P);
      check('the filter holds in the table view too', r.view === 'table' && canon(r.ids) === canon(DIFF_IDS), r.ids.length);
      await P.click('[data-view="cards"]'); await P.waitForTimeout(100);
      await P.click('#mm-all'); await P.waitForTimeout(100);
      r = await MM(P);
      check('"Alle zeigen": everybody again, the chip goes, the banner offers the filter again', r.ids.length === 28 && !r.filter && r.banner && r.banner.only === 'Nur diese zeigen' && (await P.evaluate(k => localStorage.getItem(k), FILTER_KEY)) !== 'true', r.filter);
      // Jetzt korrigieren: the Eintragen-Modus with only these villagers
      await P.click('#mm-go'); await P.waitForTimeout(150);
      const seen = [];
      for (let k = 0; k < 12; k++) {
        const x = await ENTRY(P);
        if (!x.open || x.finale) break;
        seen.push(x);
        await P.keyboard.press('ArrowRight'); await P.waitForTimeout(60);
      }
      const wantSeen = e.ids.map(id => ({ name: NAME[id], line: ELINE(e.per[id]), lineAbove: true,
        rows: Object.keys(e.marks).filter(k => k.startsWith(id + '|')).map(k => ({ job: k.split('|')[1], from: 'von ' + xs(e.marks[k].g), to: xs(e.marks[k].t) })) }));
      check('"Jetzt korrigieren": the Eintragen-Modus with exactly these 10, starting "1 / 10"', seen.length === 10 && seen[0].count === '1 / 10', { n: seen.length, count: seen[0] && seen[0].count });
      const gotSeen = seen.map(x => ({ name: x.name, line: x.line, lineAbove: x.lineAbove, rows: x.rows }));
      const order = rs => rs.slice().sort((a, b) => a.job.localeCompare(b.job));
      check('each card: the crimson line "Laut Foto stehen diese Prioritäten im Spiel falsch" above the rows, the wrong rows "von 1 → 7"',
        canon(gotSeen.map(x => ({ ...x, rows: order(x.rows) }))) === canon(wantSeen.map(x => ({ ...x, rows: order(x.rows) }))), { got: gotSeen.slice(0, 3), want: wantSeen.slice(0, 3) });
      await P.keyboard.press('Escape'); await P.waitForTimeout(80);
      // A tick in the Eintragen-Modus clears that villager's marks (on both phones)
      const first = e.ids[0];
      await P.click('#mm-go'); await P.waitForTimeout(150);
      check('the first one is ' + NAME[first], (await ENTRY(P)).name === NAME[first]);
      const n0 = srv.log.length;
      await P.click('#entry-next');
      await until(async () => srv.log.slice(n0).some(x => x.c === 'ingame' && x.id === first), 3000);
      await P.waitForTimeout(450);
      await P.keyboard.press('Escape'); await P.waitForTimeout(150);
      check('the tick writes a new snapshot, the check stays as it was', srv.obj('ingame')[first].at > srv.obj('checks')[first].at && !srv.log.slice(n0).some(x => x.c === 'checks'));
      e = expectNow(srv);
      check('expected after the tick: 12 priorities at 9 villagers, none for ' + NAME[first], e.cells === 12 && e.ids.length === 9 && !e.ids.includes(first), { cells: e.cells, n: e.ids.length });
      await same('A after the tick', P, e);
      await until(() => B.page.evaluate(id => !document.querySelector(`#plan-view [data-cell^="${id}|"].mm`), first), 3000);
      await same('B after the tick (live)', B.page, e);
      // A phase switch only moves the plan: the ember dot, not red
      await P.click('#panel-plan .phase-seg [data-phase="ausbau"]');
      await until(() => srv.col('settings').get('main').phase === 'ausbau', 3000);
      await P.waitForTimeout(200);
      e = expectNow(srv);
      const okMoved = OK_IDS.filter(id => e.chg.some(k => k.startsWith(id + '|')));
      check('expected after the phase switch: villagers whose photo matched get plan-only changes, and no red', okMoved.length >= 3 && !e.ids.some(id => OK_IDS.includes(id)), { okMoved: okMoved.map(i => NAME[i]), ids: e.ids.map(i => NAME[i]) });
      r = await same('A after the phase switch', P, e);
      check('A: a plan-only change on a villager the photo found right shows the ember dot and no red mark', okMoved.every(id => r.chg.some(k => k.startsWith(id + '|')) && !Object.keys(r.marks).some(k => k.startsWith(id + '|')) && !r.badges[id]));
      await until(() => B.page.evaluate(() => document.querySelectorAll('#panel-plan .phase-seg [data-phase="ausbau"][aria-pressed="true"]').length > 0), 3000);
      await B.page.waitForTimeout(150);
      await same('B after the phase switch', B.page, e);
      // Delete a villager with marks and take it back: worker, snapshot and check come back
      const joan = ID['Joan Reinfred'];
      const before = { w: srv.col('workers').get(joan), i: srv.col('ingame').get(joan), c: srv.col('checks').get(joan) };
      await P.click('#tab-arbeiter'); await P.waitForTimeout(150);
      await P.click(`#wlist [data-wid="${joan}"] [data-act="del"]`); await P.waitForTimeout(550);
      await P.click(`#wlist [data-wid="${joan}"] [data-act="del"]`);
      const gone = await until(async () => !srv.col('workers').has(joan) && !srv.col('ingame').has(joan) && !srv.col('checks').has(joan), 3000);
      check('delete: the villager\'s check goes with the worker and the snapshot', gone >= 0, { checks: srv.col('checks').has(joan) });
      await P.click('#toast .toast-act');
      const back = await until(async () => srv.col('workers').has(joan) && srv.col('ingame').has(joan) && srv.col('checks').has(joan), 3000);
      check('Rückgängig: the same check doc again', back >= 0 && canon(srv.col('checks').get(joan)) === canon(before.c) && canon(srv.col('ingame').get(joan)) === canon(before.i), srv.col('checks').get(joan));
      await P.click('#tab-plan'); await P.waitForTimeout(200);
      e = expectNow(srv);
      await same('A after delete + Rückgängig', P, e);
      check('Joan Reinfred is marked again', !!(await MM(P)).badges[joan]);
      await A.ctx.close(); await B.ctx.close();
    });

    // ===== 2) The check's own Rückgängig: an earlier check comes back, new ones go =====
    await section('2) Rückgängig of the check', async () => {
      const nell = ID['Nell Terrin'];
      const oldCheck = { at: F.ingame[nell].at, by: 'u_b', vals: clone(F.ingame[nell].vals), want: clone(F.ingame[nell].vals) };
      const srv = makeServer({ ...seedAll(), checks: { [nell]: oldCheck } });
      const A = await phone(browser, srv, { name: 'U', inClaude: true, writable: true, user: owner, anim: 'aus' });
      check('an earlier check that matched: no marks', !Object.keys((await MM(A.page)).marks).length);
      await applyCheck(A.page);
      await until(async () => srv.docs('checks').length === 28 && srv.log.filter(x => x.c === 'ingame').length >= 28, 5000);
      await A.page.waitForTimeout(150);
      check('after Übernehmen: 13 marks', Object.keys((await MM(A.page)).marks).length === 13);
      await A.page.click('#toast .toast-act');
      await until(async () => srv.docs('checks').length === 1 && canon(srv.obj('ingame')) === canon(F.ingame), 5000);
      check('Rückgängig: the earlier check doc of Nell Terrin again, the 27 new ones removed, the snapshots as before', canon(srv.obj('checks')) === canon({ [nell]: oldCheck }) && canon(srv.obj('ingame')) === canon(F.ingame), Object.keys(srv.obj('checks')).length);
      const r = await MM(A.page);
      check('Rückgängig: no marks, no banner', !Object.keys(r.marks).length && !r.banner, r.banner);
      await A.ctx.close();
    });

    // ===== 3) Nothing is left: the filter switches itself off =====
    await section('3) filter clears itself', async () => {
      const hel = ID['Helene Colley'];
      const srv = makeServer(seedChecked([hel]));
      const A = await phone(browser, srv, { name: 'C', inClaude: true, writable: true, user: owner, anim: 'aus' });
      let r = await MM(A.page);
      check('one villager with one wrong priority: "1 Priorität steht im Spiel falsch (bei 1 Bewohner)", "⚠ 1 Priorität falsch im Spiel"', r.banner && r.banner.lead === LEAD(1, 1) && r.badges[hel] === BADGE(1), { banner: r.banner, badges: r.badges });
      await A.page.click('#mm-only'); await A.page.waitForTimeout(80);
      const fr = await MM(A.page);
      check('filtered to her, "Gezeigt: nur der Bewohner mit der falschen Priorität." (one priority: singular)', canon(fr.ids) === canon([hel]) && fr.filter && fr.filter.text === 'Gezeigt: nur der Bewohner mit der falschen Priorität.', fr.filter);
      await A.page.click('#mm-go'); await A.page.waitForTimeout(150);
      const x = await ENTRY(A.page);
      check('Eintragen-Modus: "Laut Foto steht diese Priorität im Spiel falsch", "1 / 1"', x.line === ELINE(1) && x.count === '1 / 1', x);
      await A.page.screenshot({ path: path.join(SHOTS, 'flow-390-entry-one.png') });
      await A.page.click('#entry-next');
      await until(async () => srv.obj('ingame')[hel].at > AT_CHECK, 3000);
      await A.page.waitForTimeout(450);
      await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(150);
      r = await MM(A.page);
      check('ticked: no marks left, the banner goes, the filter switched itself off (everybody, stored no more)', !Object.keys(r.marks).length && !r.banner && !r.filter && r.ids.length === 28 && (await A.page.evaluate(k => localStorage.getItem(k), FILTER_KEY)) === null, { banner: r.banner, filter: r.filter, n: r.ids.length });
      await A.ctx.close();
    });

    // ===== 4) Read-only viewers see the marks and the filter; "Jetzt korrigieren" writes nothing =====
    await section('4) read-only', async () => {
      const srv = makeServer(seedChecked());
      const V = await phone(browser, srv, { name: 'V', inClaude: true, writable: false, user: viewer, anim: 'aus' });
      const e = expectNow(srv);
      check('expected: the seeded check gives the same 13 at 10', e.cells === 13 && e.ids.length === 10);
      await same('read-only', V.page, e);
      await V.page.click('#mm-only'); await V.page.waitForTimeout(80);
      check('read-only: the filter works', canon((await MM(V.page)).ids) === canon(DIFF_IDS));
      await V.page.click('#mm-go'); await V.page.waitForTimeout(150);
      let x = await ENTRY(V.page);
      check('read-only: "Jetzt korrigieren" opens the Eintragen-Modus as usual ("Weiter ▶"), with the line', x.open && x.next === 'Weiter ▶' && x.line === ELINE(e.per[e.ids[0]]) && x.count === '1 / 10', x);
      for (let k = 0; k < 11; k++) { await V.page.click('#entry-next'); await V.page.waitForTimeout(80); }
      x = await ENTRY(V.page);
      check('read-only: through to the end, nothing written', (x.finale || !x.open) && !srv.log.length, { x, log: srv.log.length });
      await V.ctx.close();
    });

    // ===== 5) Nothing changes without a check: example team, real team without checks, a phase switch =====
    await section('5) no checks', async () => {
      const X = await phone(browser, null, { name: 'ex', inClaude: false });
      const rx = await MM(X.page);
      check('example team: no banner, no marks', !rx.banner && !Object.keys(rx.marks).length && !rx.legend, rx.banner);
      await X.ctx.close();
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'N', inClaude: true, writable: true, user: owner, anim: 'aus' });
      await A.page.click('#panel-plan .phase-seg [data-phase="krieg"]');
      await until(() => srv.col('settings').get('main').phase === 'krieg', 3000);
      await A.page.waitForTimeout(150);
      const e = expectNow(srv);
      check('expected: a phase switch without any check moves numbers', e.chg.length >= 3 && !e.cells, e.chg.length);
      const r = await same('no checks, phase switch', A.page, e);
      check('no checks: the ember dots only, nothing red', !Object.keys(r.marks).length && r.chg.length === e.chg.length);
      await A.ctx.close();
    });

    // ===== 6) Local mode: the checks live inside the LS payload =====
    await section('6) local mode', async () => {
      const LS_KEY = 'bellwright-arbeitsplan-v1', AP_KEY = 'bellwright-arbeitsplan-eingetragen-v1';
      const A = await phone(browser, null, { name: 'L', inClaude: false, anim: 'aus', seedLs: { [LS_KEY]: { settings: F.settings, workers: F.workers, prefs: {} }, [AP_KEY]: anchorOf(F.ingame) } });
      await applyCheck(A.page);
      await A.page.waitForTimeout(300);
      const ls = await A.page.evaluate(k => JSON.parse(localStorage.getItem(k)), LS_KEY);
      const bad = roster.filter(w => { const c = ls.checks && ls.checks[w.id]; return !c || canon(c.vals) !== canon(gameSnap(w.id)) || canon(c.want) !== canon(planNow(w.id)) || !(c.at > 0); });
      check('local: "Übernehmen" keeps the 28 checks inside the LS payload', !bad.length, bad.map(w => w.name));
      let r = await MM(A.page);
      check('local: 13 marks at the 10, the banner', Object.keys(r.marks).length === 13 && Object.keys(r.badges).length === 10 && r.banner && r.banner.lead === LEAD(13, 10), r.banner);
      await A.page.reload(); await A.page.waitForTimeout(600);
      r = await MM(A.page);
      check('local: still there after a reload', Object.keys(r.marks).length === 13);
      await A.ctx.close();
    });

    // ===== 7) Motion per the bellwright-animations skill: marks stamp once when they appear (voll), fade (ruhig), nothing (aus) =====
    for (const lvl of ['voll', 'ruhig', 'aus']) {
      await section('7) motion ' + lvl, async () => {
        const srv = makeServer(seedAll());
        const A = await phone(browser, srv, { name: 'M' + lvl, inClaude: true, writable: true, user: owner, anim: lvl, logAnim: true });
        const P = A.page;
        // another phone takes the check: first the snapshots, then the checks
        const ck = seedChecked();
        for (const [id, d] of Object.entries(ck.ingame)) srv.col('ingame').set(id, d);
        srv.broadcast('ingame');
        await P.waitForTimeout(900);
        await P.evaluate(() => { window.__anims = []; });
        for (const [id, d] of Object.entries(ck.checks)) srv.col('checks').set(id, d);
        srv.broadcast('checks');
        await until(() => P.evaluate(() => document.querySelectorAll('#plan-view .mm').length >= 13), 3000);
        await P.waitForTimeout(40);
        const log = await P.evaluate(() => window.__anims.filter(a => /(^| )mm( |$)|mm-badge/.test(a.cls)));
        const css = await P.evaluate(() => document.getElementById('mm-banner').getAnimations().map(a => ({ dur: a.effect.getComputedTiming().duration, iter: a.effect.getComputedTiming().iterations, name: a.animationName })));
        const marks = log.filter(a => /(^| )mm( |$)/.test(a.cls)), badges = log.filter(a => /mm-badge/.test(a.cls));
        if (lvl === 'voll') check('voll: every new mark and badge stamps once (transform, 320 ms)', marks.length === 13 && badges.length === 10 && log.every(a => a.dur === 320 && a.props.join() === 'transform'), { marks: marks.length, badges: badges.length, a: log.slice(0, 2) });
        if (lvl === 'ruhig') check('ruhig: they only fade in (opacity, <= 150 ms)', marks.length === 13 && badges.length === 10 && log.every(a => a.dur <= 150 && a.props.join() === 'opacity'), log.slice(0, 2));
        if (lvl === 'aus') check('aus: no animation', !log.length, log.slice(0, 2));
        if (lvl === 'voll') check('voll: the banner comes in once (<= 400 ms)', css.length === 1 && css[0].dur <= 400 && css[0].iter === 1, css);
        if (lvl === 'ruhig') check('ruhig: the banner fades (<= 150 ms)', css.length === 1 && css[0].dur <= 150 && css[0].iter === 1, css);
        if (lvl === 'aus') check('aus: the banner just appears', !css.length, css);
        await P.waitForTimeout(700);
        const left = await P.evaluate(() => [...document.querySelectorAll('#plan-view .mm, #plan-view .mm-badge, #mm-banner')].flatMap(el => el.getAnimations())
          .filter(a => a.playState === 'running' || a.effect.getComputedTiming().iterations === Infinity).map(a => a.animationName || 'script'));
        check(`${lvl}: nothing keeps moving (no pulsing)`, left.length === 0, left);
        // the same marks again (a redraw, another view) do not stamp again
        await P.evaluate(() => { window.__anims = []; });
        await P.click('[data-view="table"]'); await P.waitForTimeout(80);
        await P.click('[data-view="cards"]'); await P.waitForTimeout(80);
        check(`${lvl}: switching the view does not stamp the marks again`, !(await P.evaluate(() => window.__anims.filter(a => /(^| )mm( |$)|mm-badge/.test(a.cls)).length)));
        await A.ctx.close();
        if (lvl === 'voll') {
          const L = await phone(browser, makeServer(seedChecked()), { name: 'Mload', inClaude: true, writable: true, user: owner, anim: 'voll', logAnim: true });
          check('voll: marks that are already there when the page opens do not stamp', (await L.page.evaluate(() => document.querySelectorAll('#plan-view .mm').length)) === 13
            && !(await L.page.evaluate(() => window.__anims.filter(a => /(^| )mm( |$)|mm-badge/.test(a.cls)).length)));
          await L.ctx.close();
        }
      });
    }

    // ===== 8) Layout: 360 / 390 / 1280, cards and table, the banner, a reason row, an entry card =====
    for (const w of [360, 390, 1280]) {
      await section('8) layout ' + w, async () => {
        const srv = makeServer(seedChecked());
        const A = await phone(browser, srv, { name: 'W' + w, inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: w, height: w < 900 ? 780 : 900 });
        const P = A.page;
        const measure = () => P.evaluate(() => {
          const vis = el => !el.closest('[hidden]') && el.getClientRects().length > 0;
          const wide = [...document.querySelectorAll('#mm-banner *, #mm-filter *, .wplan *, .legend *, .entry-card *')].filter(vis).filter(e => e.getBoundingClientRect().right > innerWidth + 0.5).map(e => e.className || e.tagName).slice(0, 5);
          const out = [...document.querySelectorAll('.matrix .mm-badge')].filter(vis).filter(b => b.getBoundingClientRect().right > b.closest('th').getBoundingClientRect().right + 0.5).length;
          const small = [...document.querySelectorAll('#mm-go, #mm-only, #mm-all')].filter(vis).filter(e => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map(e => e.id + ':' + Math.round(e.getBoundingClientRect().height));
          return { sw: document.documentElement.scrollWidth, vw: innerWidth, wide, out, small };
        });
        const ok = (label, m, taps) => {
          check(`${w} ${label}: no horizontal scroll, nothing sticks out`, m.sw <= m.vw && !m.wide.length && !m.out, m);
          if (taps && w < 900) check(`${w} ${label}: the buttons >= 44 px`, !m.small.length, m.small);
        };
        for (const view of ['cards', 'table']) {
          await P.click(`[data-view="${view}"]`); await P.waitForTimeout(120);
          await P.evaluate(() => window.scrollTo(0, 0)); await P.waitForTimeout(60);
          ok(view + ' (banner)', await measure(), true);
          if (view === 'cards') await P.screenshot({ path: path.join(SHOTS, `mm-${w}-banner.png`) });
          const hk = ID['Helene Colley'] + '|construction';
          if (view === 'cards') {
            await P.evaluate(id => document.getElementById('wp-' + id).scrollIntoView({ block: 'start' }), ID['Helene Colley']); await P.waitForTimeout(80);
            await P.screenshot({ path: path.join(SHOTS, `mm-${w}-cards.png`) });
            await P.click(`[data-focus="r:${hk}"]`); await P.waitForTimeout(100);
            await P.evaluate(k => document.querySelector(`details[data-key="${k}"]`).scrollIntoView({ block: 'center' }), hk); await P.waitForTimeout(60);
            ok('cards, reason row open', await measure());
            await P.screenshot({ path: path.join(SHOTS, `mm-${w}-reason.png`) });
            await P.click(`[data-focus="r:${hk}"]`); await P.waitForTimeout(60);
          } else {
            await P.evaluate(k => document.querySelector(`[data-cell="${k}"]`).scrollIntoView({ block: 'center', inline: 'center' }), hk); await P.waitForTimeout(80);
            await P.click(`[data-cell="${hk}"]`); await P.waitForTimeout(100);
            ok('table, cell chosen', await measure());
            await P.evaluate(() => document.querySelector('.matrix-wrap').scrollIntoView({ block: 'start' })); await P.waitForTimeout(60);
            await P.screenshot({ path: path.join(SHOTS, `mm-${w}-table.png`) });
            await P.evaluate(() => document.getElementById('reason').scrollIntoView({ block: 'end' })); await P.waitForTimeout(60);
            await P.screenshot({ path: path.join(SHOTS, `mm-${w}-table-reason.png`) });
          }
        }
        await P.click(`[data-view="${w < 900 ? 'cards' : 'table'}"]`); await P.waitForTimeout(80);
        await P.evaluate(() => window.scrollTo(0, 0));
        await P.click('#mm-only'); await P.waitForTimeout(100);
        ok('filter on', await measure(), true);
        await P.screenshot({ path: path.join(SHOTS, `mm-${w}-filter.png`) });
        await P.click('#mm-all'); await P.waitForTimeout(80);
        await P.evaluate(() => window.scrollTo(0, 0));
        await P.click('#mm-go'); await P.waitForTimeout(150);
        ok('entry card', await measure());
        await P.screenshot({ path: path.join(SHOTS, `mm-${w}-entry.png`) });
        await P.keyboard.press('Escape');
        await A.ctx.close();
      });
    }

    // ===== 9) One big button at a time (review): the crimson banner stands in for the entry banner =====
    // While priorities stand wrong in the game, "Jetzt korrigieren" is the one primary call to action on the Plan tab: no
    // entry banner, no title button, the sticky bar (touch) only once the crimson banner is scrolled away, a resume banner's
    // "Weiter" is a plain button. Villagers with new numbers that are not red get one small line in the crimson banner with
    // a plain "Im Spiel eintragen (n offen)". Without red marks the entry banner is back as before.
    const CTA = page => page.evaluate(() => {
      const vis = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
      const t = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
      const panel = document.getElementById('panel-plan'), more = document.getElementById('mm-more'), mb = more && more.querySelector('button');
      return {
        prim: [...panel.querySelectorAll('.btn.primary')].filter(vis).filter(b => !b.closest('#entry-sticky')).map(b => b.id || t(b)),
        entryBanner: vis(document.getElementById('entry-banner')), titleBtn: vis(document.getElementById('entry-open')),
        sticky: vis(document.getElementById('entry-sticky')) ? t(document.querySelector('#entry-sticky .btn')) : null,
        more: vis(more) ? { text: t(document.getElementById('mm-more-text')), btn: t(mb), primary: mb.classList.contains('primary'), h: Math.round(mb.getBoundingClientRect().height) } : null,
        resume: vis(document.getElementById('entry-resume')) ? { text: t(document.getElementById('entry-resume-text')), primary: document.getElementById('entry-resume-go').classList.contains('primary') } : null,
      };
    });
    await section('9) one primary call to action', async () => {
      // a) everybody open is red (the check's own 10): only "Jetzt korrigieren"
      let srv = makeServer(seedChecked());
      let A = await phone(browser, srv, { name: 'Q1', inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: 360, height: 780 });
      let c = await CTA(A.page);
      check('9a: red only: one primary button ("Jetzt korrigieren"), no entry banner, no title button, no extra line, no sticky bar under the banner',
        canon(c.prim) === canon(['mm-go']) && !c.entryBanner && !c.titleBtn && !c.more && c.sticky === null, c);
      await A.page.screenshot({ path: path.join(SHOTS, 'cta-360-red-only.png') });
      await A.page.evaluate(() => window.scrollTo(0, 1600)); await A.page.waitForTimeout(250);
      c = await CTA(A.page);
      check('9a: the crimson banner scrolled away: the sticky bar "Im Spiel eintragen (10 offen)" comes', c.sticky === 'Im Spiel eintragen (10 offen)', c.sticky);
      await A.page.evaluate(() => window.scrollTo(0, 0)); await A.page.waitForTimeout(250);
      check('9a: back at the top: the sticky bar goes again', (await CTA(A.page)).sticky === null);
      await A.ctx.close();
      // b) one more villager open who is not red (never entered): the small line in the crimson banner
      const arnold = ID['Arnold Dixon'];
      const seedB = seedChecked(roster.map(w => w.id).filter(id => id !== arnold));
      delete seedB.ingame[arnold];
      srv = makeServer(seedB);
      A = await phone(browser, srv, { name: 'Q2', inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: 360, height: 780 });
      c = await CTA(A.page);
      check('9b: others open too: still one primary button; the crimson banner says "Außerdem hat 1 weiterer Bewohner neue Zahlen." with a plain "Im Spiel eintragen (11 offen)" (>= 44 px)',
        canon(c.prim) === canon(['mm-go']) && !c.entryBanner && !c.titleBtn && c.more && c.more.text === 'Außerdem hat 1 weiterer Bewohner neue Zahlen.' && c.more.btn === 'Im Spiel eintragen (11 offen)' && !c.more.primary && c.more.h >= 44, c);
      await A.page.screenshot({ path: path.join(SHOTS, 'cta-360-red-and-more.png') });
      check('9b: nothing sticks out at 360', await A.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('#mm-banner *')].every(e => e.getBoundingClientRect().right <= innerWidth + 0.5)));
      await A.page.click('#mm-more-go'); await A.page.waitForTimeout(150);
      let x = await ENTRY(A.page);
      check('9b: that button opens the Eintragen-Modus with everybody open ("1 / 11")', x.open && x.count === '1 / 11', x);
      await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(100);
      await A.ctx.close();
      // c) the red ones corrected: the entry banner is back, as before
      const hel = ID['Helene Colley'];
      const seedC = seedChecked([hel]);
      delete seedC.ingame[arnold];
      srv = makeServer(seedC);
      A = await phone(browser, srv, { name: 'Q3', inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: 360, height: 780 });
      c = await CTA(A.page);
      check('9c: one red villager and one more open: "Jetzt korrigieren" + "Außerdem hat 1 weiterer Bewohner neue Zahlen."', canon(c.prim) === canon(['mm-go']) && c.more && c.more.text === 'Außerdem hat 1 weiterer Bewohner neue Zahlen.' && c.more.btn === 'Im Spiel eintragen (2 offen)', c);
      await A.page.click('#mm-go'); await A.page.waitForTimeout(150);
      await A.page.click('#entry-next');
      await until(async () => srv.obj('ingame')[hel].at > AT_CHECK, 3000);
      await A.page.waitForTimeout(450);
      await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(150);
      c = await CTA(A.page);
      check('9c: nothing red any more: the entry banner "1 Bewohner hat neue Zahlen" with its primary button is back, the crimson line gone',
        canon(c.prim) === canon(['entry-banner-go']) && c.entryBanner && !c.more && await A.page.evaluate(() => document.getElementById('entry-banner-text').textContent.startsWith('1 Bewohner hat neue Zahlen') && document.getElementById('mm-banner').hidden), c);
      check('9c: closing the mode put the focus on a visible button', await A.page.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && !a.closest('[hidden]') && a.getClientRects().length > 0; }));
      await A.ctx.close();
      // d) a resume banner from an earlier Eintragen-Modus: its "Weiter" is a plain button while the crimson banner shows
      srv = makeServer(seedChecked());
      A = await phone(browser, srv, { name: 'Q4', inClaude: true, writable: true, user: owner, anim: 'aus', seedLs: { 'bellwright-eintragen-v1': { ids: DIFF_IDS, i: 2, at: Date.now() } } }, { width: 360, height: 780 });
      c = await CTA(A.page);
      check('9d: resume banner and crimson banner: "Weiter" is no second primary button', c.resume && /^Weitermachen bei /.test(c.resume.text) && !c.resume.primary && canon(c.prim) === canon(['mm-go']), c);
      await A.page.click('#entry-resume-go'); await A.page.waitForTimeout(150);
      x = await ENTRY(A.page);
      check('9d: "Weiter" still picks up there ("3 / 10")', x.open && x.count === '3 / 10', x);
      await A.ctx.close();
      // e) without red marks the resume banner keeps its primary "Weiter"
      const ingE = clone(F.ingame);
      delete ingE[arnold];
      srv = makeServer(seedAll(ingE));
      A = await phone(browser, srv, { name: 'Q5', inClaude: true, writable: true, user: owner, anim: 'aus', seedLs: { 'bellwright-eintragen-v1': { ids: [arnold], i: 0, at: Date.now() } } }, { width: 360, height: 780 });
      c = await CTA(A.page);
      check('9e: no red marks: the resume banner keeps its primary "Weiter" (and stands in for the entry banner, as before)', c.resume && c.resume.primary === true && c.prim.includes('entry-resume-go') && !c.entryBanner && !c.more, c);
      await A.ctx.close();
    });

    // ===== 10) The marks never contradict the tick-off (review) =====
    // Red only while the villager's snapshot is the one the check wrote (the same numbers). Otherwise the cards would show
    // "~~1~~ → 7" while the Eintragen-Modus says "von 7" or nothing, and "Jetzt korrigieren" could open nothing.
    await section('10) snapshot and check agree', async () => {
      const hel = ID['Helene Colley'];
      // a) a tick-off from a phone whose clock is a minute behind: the snapshot looks older than the check
      let seed = seedChecked([hel]);
      seed.ingame[hel] = { vals: planNow(hel), by: 'u_b', at: AT_CHECK - 60000 };
      let srv = makeServer(seed);
      let A = await phone(browser, srv, { name: 'S1', inClaude: true, writable: true, user: owner, anim: 'aus' });
      let r = await MM(A.page);
      check('10a: ticked on a phone with a slow clock (snapshot = plan, "older" than the check): no red marks, no banner, no badge', !Object.keys(r.marks).length && !r.banner && !Object.keys(r.badges).length, { banner: r.banner, marks: Object.keys(r.marks) });
      await same('10a', A.page, expectNow(srv));
      await A.ctx.close();
      // b) the check's snapshot did not land (an older tick-off with other numbers is still there)
      seed = seedChecked([hel]);
      seed.ingame[hel] = clone(F.ingame[hel]);
      srv = makeServer(seed);
      A = await phone(browser, srv, { name: 'S2', inClaude: true, writable: true, user: owner, anim: 'aus' });
      const e = expectNow(srv);
      r = await same('10b: the snapshot is older than the check, with other numbers', A.page, e);
      if (r.banner) {   // whatever is red must be what the Eintragen-Modus asks for
        await A.page.click('#mm-go'); await A.page.waitForTimeout(150);
        const x = await ENTRY(A.page);
        check('10b: "Jetzt korrigieren" opens the mode', x.open, x);
        await A.page.keyboard.press('Escape');
      } else check('10b: no red marks from a check whose snapshot is not there', !Object.keys(r.marks).length);
      await A.ctx.close();
      // c) two phones took the same photo at once: A's snapshot (later) and B's check (earlier) have the same numbers
      seed = seedChecked([hel]);
      seed.ingame[hel] = { vals: gameSnap(hel), by: 'u_a', at: AT_CHECK + 5000 };
      seed.checks[hel].by = 'u_b';
      srv = makeServer(seed);
      A = await phone(browser, srv, { name: 'S3', inClaude: true, writable: true, user: owner, anim: 'aus' });
      r = await MM(A.page);
      check('10c: the same numbers from a second phone a moment later: still "1 → 7" for Helene Colley', r.marks[hel + '|construction'] && r.marks[hel + '|construction'].was === '1' && r.marks[hel + '|construction'].to === '7' && r.banner && r.banner.lead === LEAD(1, 1), { banner: r.banner, m: r.marks[hel + '|construction'] });
      await A.ctx.close();
    });

    // ===== 11) The struck game value still reads as its digit (review): a thin, light strike, not a "+" =====
    await section('11) struck value legible', async () => {
      const srv = makeServer(seedChecked());
      const A = await phone(browser, srv, { name: 'G', inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: 360, height: 780 });
      const look = await A.page.evaluate(() => [...document.querySelectorAll('#plan-view .mm')].slice(0, 1).map(el => {
        const w = getComputedStyle(el.querySelector('.mm-was')), to = getComputedStyle(el.querySelector('.mm-to'));
        return { line: w.textDecorationLine, thick: w.textDecorationThickness, color: w.textDecorationColor, ratio: parseFloat(w.fontSize) / parseFloat(to.fontSize) };
      })[0]);
      const alpha = s => { const m = /rgba?\(([^)]+)\)/.exec(s); if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? +p[3] : 1; } const n = /\/\s*([\d.]+)\s*\)/.exec(s); return n ? +n[1] : 1; };
      check('11: struck through with a 1 px line that lets the digit show through (a thick red bar turns "1" into "+")', look && look.line === 'line-through' && look.thick === '1px' && alpha(look.color) < 1, look);
      check('11: the game value smaller than the target, but not tiny (0.8 to 0.9 of it)', look && look.ratio >= 0.8 && look.ratio < 0.95, look && look.ratio);
      const hk = ID['Helene Colley'] + '|construction';
      await A.page.evaluate(k => document.querySelector(`[data-k="${k}"]`).scrollIntoView({ block: 'center' }), hk); await A.page.waitForTimeout(80);
      const b = await A.page.evaluate(k => { const r = document.querySelector(`[data-k="${k}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, hk);
      await A.page.screenshot({ path: path.join(SHOTS, 'mark-360-zoom.png'), clip: { x: Math.max(0, b.x - 220), y: b.y - 16, width: 280, height: b.h + 32 } });
      await A.ctx.close();
    });

    // ===== 12) Table: the sticky name column stays solid in every row (review; also before BUILD 17) =====
    // A row under the finger (sticky :hover on phones) had a see-through name cell: the numbers scrolled under it showed
    // through "Helene Colley", right where the badge now sits.
    await section('12) sticky name column', async () => {
      const srv = makeServer(seedChecked());
      const A = await phone(browser, srv, { name: 'T', inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: 360, height: 780 });
      await A.page.click('[data-view="table"]'); await A.page.waitForTimeout(120);
      const alphaOf = s => { const m = /rgba?\(([^)]+)\)/.exec(s); if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? +p[3] : 1; } const n = /\/\s*([\d.]+)\s*\)/.exec(s); return n ? +n[1] : 1; };
      const seeThrough = [];
      for (let i = 0; i < 6; i++) {
        const id = roster[i].id;
        await A.page.evaluate(id => { const tr = document.querySelector(`tr[data-fokus="${id}"]`); tr.scrollIntoView({ block: 'center' }); document.querySelector('.matrix-wrap').scrollLeft = 300; }, id);
        await A.page.waitForTimeout(40);
        await A.page.hover(`tr[data-fokus="${id}"] td:nth-child(8) .cell`);
        const bg = await A.page.evaluate(id => { const th = document.querySelector(`tr[data-fokus="${id}"] > th`); return { hover: th.parentNode.matches(':hover'), bg: getComputedStyle(th).backgroundColor }; }, id);
        if (!bg.hover || alphaOf(bg.bg) < 1) seeThrough.push({ n: NAME[id], ...bg });
      }
      check('12: the name cell is opaque in every row, also the one under the finger', !seeThrough.length, seeThrough);
      await A.ctx.close();
    });
  } finally { await browser.close(); }
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-mismatch: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

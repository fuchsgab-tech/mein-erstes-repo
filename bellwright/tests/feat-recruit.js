// BUILD 15 "Rekruten-Check": Arbeiter tab "Rekruten prüfen" opens a panel (bottom sheet on phones) for up to 3
// candidates (optional name, 7 skills Stufe/Max, traits, a text field in the import format). Each is compared with the
// plan without them: compute(current active workers + candidate, current settings, prefs/locks, calm OFF) against
// compute(workers, same options): main job + reason, gap text, team effect (out.worth, see Part 0), who would change main job
// (max 3, then "+n weitere"), "Bester Kandidat" with 2–3. Nothing is written while checking; "Anwerben" adds a normal
// worker (stamp now, toast with Rückgängig), "Verwerfen" drops one, "Alle verwerfen" clears and closes; the panel keeps
// its candidates per device (localStorage) until then. Read-only viewers may check, not add.
// Part A computes the expected texts in node with the planner cut out of the app file (as feat-pins.js does).
// Part 0 checks the team effect itself: out.worth = the skill the team has at work, in Stufen a player can believe (per
// job with a skill: the main holders' levels, a second one half, a third a third …; at least half the best level of
// someone on 2; × importance/3). It replaced out.objective, which rewards a free hauler for having no skills, so a weak
// all-rounder came out ahead of a skilled specialist (test team: 2/3 cook +15, 7/10 researcher +12,5).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../bellwright-arbeitsplan.html');
const SHOTS = path.resolve(__dirname, '../shots-r3');
function load(file) {
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf('// ---------- Game data ----------');
  const b = s.indexOf('// ---------- Rendering: Plan ----------');
  const fn = new Function('localStorage', 'matchMedia', 'document', '"use strict";\n' + s.slice(a, b) + '\nreturn { compute, JOB, JOBS, ATTRS, defaultSettings, normSettings, normWorker, EXAMPLE, PHASES };');
  const store = {};
  return fn({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, () => ({ matches: false }), undefined);
}
const T = load(APP);
const REC_KEY = 'bellwright-rekruten-v1';
const ANIM_KEY = 'bellwright-anim-v1';
const st = o => Object.fromEntries(Object.entries(o).map(([k, [cur, max]]) => [k, { cur, max }]));
const SEED_W = {
  w_agnes: { name: 'Agnes', role: 'worker', traits: 'Optimist', order: 1, stats: st({ labourer: [3, 5], harvesting: [6, 9], farming: [2, 4], cooking: [1, 3], crafting: [2, 6], researching: [0, 2], hunting: [5, 8] }) },
  w_bertram: { name: 'Bertram', role: 'worker', traits: 'Resilient', order: 2, stats: st({ labourer: [7, 9], harvesting: [4, 6], farming: [1, 3], cooking: [2, 4], crafting: [3, 5], researching: [1, 3], hunting: [2, 4] }) },
  w_edda: { name: 'Edda', role: 'worker', traits: '', order: 3, stats: st({ labourer: [2, 4], harvesting: [1, 3], farming: [3, 6], cooking: [8, 10], crafting: [2, 4], researching: [3, 5], hunting: [0, 2] }) },
  w_godric: { name: 'Godric', role: 'worker', traits: 'Prodigy', order: 4, stats: st({ labourer: [3, 6], harvesting: [3, 5], farming: [2, 4], cooking: [1, 4], crafting: [6, 10], researching: [4, 7], hunting: [1, 3] }) },
  w_hilde: { name: 'Hilde', role: 'worker', traits: '', order: 5, stats: st({ labourer: [2, 5], harvesting: [2, 5], farming: [7, 9], cooking: [4, 6], crafting: [1, 3], researching: [2, 4], hunting: [3, 6] }) },
  w_kuni: { name: 'Kunibert', role: 'guard', traits: 'Stalwart', order: 6, stats: st({ labourer: [3, 4], hunting: [4, 6] }) },
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));
const joinDe = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' und ' + a[a.length - 1] : (a[0] || '');

// ---------- expected texts, from the app's own compute() ----------
const roster = workers => Object.entries(workers).map(([id, d]) => T.normWorker(id, d)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
// An unnamed candidate is called like its card ("Kandidat 3") in the texts.
const candWorker = (c, label) => T.normWorker('cand', { name: c.name || label || '', role: 'worker', traits: c.traits || '', stats: c.stats, order: 1e15 });
function expect(workers, settings, prefs, c, label) {
  const ws = roster(workers), cw = candWorker(c, label);
  const opts = { calm: false, prefs, explain: false };
  const base = T.compute(ws, settings, opts), next = T.compute([...ws, cw], settings, opts);
  const job = next.main.cand, J = T.JOB[job], cell = next.cells.cand[job];
  const s = J.attr ? cw.stats[J.attr] : null;
  const main = `Hauptjob: ${J.label}${J.attr ? ` (Stufe ${s.cur}/${s.max === null ? '?' : s.max})` : ''}`;
  const before = base.team.filter(w => base.main[w.id] === job), now = next.team.filter(w => next.main[w.id] === job).length;
  const gap = !before.length ? `Füllt eine Lücke: bisher hatte niemand ${J.label} als Hauptjob.`
    : now > before.length ? `Verstärkt ${J.label} (jetzt ${now} Leute).`
    : `Übernimmt ${J.label} von ${joinDe(before.filter(w => next.main[w.id] !== job).map(w => w.name || 'Ohne Namen'))}.`;
  const d = next.worth - base.worth, r = Math.round(d * 2) / 2;
  const team = r >= 0.5 ? `Das Team wird etwa ${String(r).replace('.', ',')} ${r === 1 ? 'Stufe' : 'Stufen'} besser.` : 'Das Team wird dadurch kaum besser.';
  const moves = base.team.filter(w => base.main[w.id] && next.main[w.id] !== base.main[w.id])
    .map(w => next.main[w.id] ? `${w.name || 'Ohne Namen'} würde von ${T.JOB[base.main[w.id]].label} zu ${T.JOB[next.main[w.id]].label} wechseln` : `${w.name || 'Ohne Namen'} hätte keinen Hauptjob mehr`);
  return { main, why: cell.why, gap, team, d, moves };
}
const movesShown = m => m.length > 3 ? [...m.slice(0, 3), `+${m.length - 3} weitere`] : m;

// ---------- Part 0: the team effect ----------
// Derived here from what compute() returns (main jobs, the numbers, out.level = the level the plan works with).
function worthOf(p, s) {
  let W = 0;
  for (const j of p.jobs) {
    if (!j.attr) continue;
    const hold = p.team.filter(w => p.main[w.id] === j.id).map(w => p.level[w.id][j.id]).sort((a, b) => b - a);
    const two = p.team.filter(w => p.main[w.id] !== j.id && p.cells[w.id][j.id].p === 2 && !p.cells[w.id][j.id].off).map(w => p.level[w.id][j.id]);
    W += Math.max(hold.reduce((a, l, i) => a + l / (i + 1), 0), two.length ? Math.max(...two) / 2 : 0) * s.jobs[j.id].imp / 3;
  }
  return W;
}
const ALL = (cur, max) => Object.fromEntries(['labourer', 'harvesting', 'farming', 'cooking', 'crafting', 'researching', 'hunting'].map(a => [a, [cur, max]]));
const CANDS = {
  rolf: { name: 'Rolf', traits: '', stats: st({ researching: [7, 10], crafting: [6, 8], labourer: [5, 7] }) },   // a skilled researcher
  weak: { name: '', traits: '', stats: st({ cooking: [2, 3], labourer: [2, 3] }) },                              // a weak all-rounder
  mara: { name: 'Mara', traits: 'Prodigy', stats: st({ cooking: [9, 10], harvesting: [2, 3] }) },
  blank: { name: 'Leer', traits: '', stats: st({ labourer: [0, 0] }) },                                          // no skills at all
  allround: { name: 'Allerlei', traits: '', stats: st(ALL(2, 3)) },
  crafter: { name: 'Hans', traits: '', stats: st({ crafting: [8, 10] }) },
  hunter: { name: 'Jana', traits: '', stats: st({ hunting: [7, 9] }) },
};
const phaseSettings = id => { const ph = T.PHASES.find(p => p.id === id); return T.normSettings({ phase: id, jobs: Object.fromEntries(T.JOBS.map(j => [j.id, { on: j.defaultOn !== false, imp: ph.imp[j.id] }])) }); };
const EX = Object.fromEntries(T.EXAMPLE.map(w => [w.id, w]));
function part0() {
  const s = T.defaultSettings(), prefs = { w_edda: { lockMain: 'cooking', pins: {} } };
  // The level the plan works with: Stufe + 35 % of the way to Max ("Potenzial einrechnen"), Prodigy faster.
  const p0 = T.compute(roster(SEED_W), s, { calm: false, explain: false });
  check('0) out.level: the level the plan works with (Godric Forschen 4/7, Prodigy: 4 + 0,35·1,3·3)', Math.abs(p0.level.w_godric.research - (4 + 0.35 * 1.3 * 3)) < 1e-9 && Math.abs(p0.level.w_hilde.farming - 7.7) < 1e-9, p0.level && p0.level.w_godric);
  // out.worth is exactly the rule above, for every team, phase and candidate here.
  const bad = [];
  for (const [team, ph, pf] of [[SEED_W, 'start', prefs], [SEED_W, 'ausbau', {}], [EX, 'start', {}], [EX, 'krieg', {}], [Object.fromEntries(Object.entries(SEED_W).slice(0, 2)), 'start', {}]]) {
    const ss = phaseSettings(ph), ws = roster(team);
    for (const c of [null, ...Object.values(CANDS)]) {
      const p = T.compute(c ? [...ws, candWorker(c, 'Kandidat')] : ws, ss, { calm: false, prefs: pf, explain: false });
      if (!(Math.abs(p.worth - worthOf(p, ss)) < 1e-9)) bad.push({ ph, c: c && c.name, worth: p.worth, want: worthOf(p, ss) });
    }
  }
  check('0) out.worth = main holders (1, 1/2, 1/3 …), at least half the best on 2, × importance/3, skill jobs only', !bad.length, bad.slice(0, 3));
  // Intuition on the test team (Start, Edda locked on Kochen).
  const D = c => expect(SEED_W, s, prefs, c, 'Kandidat');
  const rolf = D(CANDS.rolf), weak = D(CANDS.weak), mara = D(CANDS.mara);
  const R = d => Math.round(d * 2) / 2;
  check('0) the 7/10 researcher (fills research) clearly beats the 2/3 cook who only carries (>= 1 Stufe ahead)', R(rolf.d) - R(weak.d) >= 1 && rolf.d > mara.d, { rolf: rolf.d, weak: weak.d, mara: mara.d });
  check('0) plausible size: the researcher about his level minus what research had on 2 (4 to 8,5 Stufen)', rolf.d >= 4 && rolf.d <= 8.5, rolf.d);
  check('0) plausible size: the 2/3 cook only frees Hilde for Landwirtschaft (at most 4,5 Stufen)', weak.d > 0 && weak.d <= 4.5 && weak.moves.some(m => m.startsWith('Hilde')), { d: weak.d, moves: weak.moves });
  // Someone with no skills never beats a specialist who takes a job nobody had as main job.
  const worse = [];
  for (const [team, ph] of [[SEED_W, 'start'], [SEED_W, 'ausbau'], [EX, 'start'], [EX, 'ausbau']]) {
    const ss = phaseSettings(ph);
    const e = c => expect(team, ss, {}, c, 'Kandidat');
    const blank = e(CANDS.blank), allround = e(CANDS.allround);
    for (const k of ['crafter', 'hunter']) {
      const sp = e(CANDS[k]);
      if (!/^Füllt eine Lücke/.test(sp.gap)) continue;
      if (!(sp.d > blank.d + 1 && sp.d > allround.d)) worse.push({ ph, team: Object.keys(team).length, k, sp: sp.d, blank: blank.d, allround: allround.d });
    }
  }
  check('0) a specialist who fills a gap beats a recruit with no skills (by > 1 Stufe) and a 2/3 all-rounder', !worse.length, worse);
  // Importance counts: the same researcher in "Ausbau" (Forschung dringend) is worth more than in "Start" (normal).
  const rA = expect(SEED_W, phaseSettings('ausbau'), {}, CANDS.rolf), rS = expect(SEED_W, phaseSettings('start'), {}, CANDS.rolf);
  check('0) importance: Forschung dringend (Ausbau) > normal (Start) for the same researcher', rA.d > rS.d + 2, { ausbau: rA.d, start: rS.d });
  return { rolf, weak, mara };
}

// ---------- fake server and page stub (lazy collections) ----------
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
  return srv;
}
function STUB(cfg) {
  if (cfg.blockLs) {   // a browser that blocks storage: every access throws
    const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
    try { Object.defineProperty(window, 'localStorage', { configurable: true, get: boom }); } catch (e) { /* ignore */ }
    return;
  }
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
    isOwner: async () => !!u.owner, id: async () => u.id || null, can: async n => (n === 'data.write' ? u.can : false),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : null) };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 900) : '')); };
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
// Everything the panel shows, per candidate card.
const R = page => page.evaluate(() => {
  const d = document.getElementById('recruit');
  const vis = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const t = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  return {
    open: !!d && !d.hidden, title: d ? t(d.querySelector('#recruit-title')) : null,
    add: d ? { shown: vis(d.querySelector('[data-rk="add"]')), disabled: !!(d.querySelector('[data-rk="add"]') || {}).disabled } : null,
    note: d ? t(d.querySelector('.rk-ro:not([hidden])')) : null,
    cards: d ? [...d.querySelectorAll('.rk-card')].map(c => ({
      k: c.dataset.k, name: c.querySelector('[data-rk="name"]').value, traits: c.querySelector('[data-rk="traits"]').value,
      stats: Object.fromEntries([...c.querySelectorAll('[data-rk^="cur:"]')].map(i => [i.dataset.rk.slice(4), [i.value, c.querySelector(`[data-rk="max:${i.dataset.rk.slice(4)}"]`).value]])),
      main: vis(c.querySelector('.rk-main')) ? t(c.querySelector('.rk-main')) : null, why: vis(c.querySelector('.rk-why')) ? t(c.querySelector('.rk-why')) : null,
      gap: vis(c.querySelector('.rk-gap')) ? t(c.querySelector('.rk-gap')) : null, team: vis(c.querySelector('.rk-team')) ? t(c.querySelector('.rk-team')) : null,
      moves: [...c.querySelectorAll('.rk-moves li')].filter(vis).map(t), best: vis(c.querySelector('.rk-best')),
      empty: vis(c.querySelector('.rk-empty')) ? t(c.querySelector('.rk-empty')) : null, msg: t(c.querySelector('.rk-msg')),
      hire: { shown: vis(c.querySelector('[data-rk="hire"]')), disabled: !!(c.querySelector('[data-rk="hire"]') || {}).disabled, text: t(c.querySelector('[data-rk="hire"]')) },
      drop: t(c.querySelector('[data-rk="drop"]')),
    })) : [],
  };
});
const card = (page, i) => `#recruit .rk-card:nth-of-type(${i + 1})`;
const fillText = async (page, i, text) => { await page.fill(`${card(page, i)} [data-rk="text"]`, text); await page.click(`${card(page, i)} [data-rk="fill"]`); await page.waitForTimeout(80); };
const setStat = async (page, i, a, cur, max) => { await page.fill(`${card(page, i)} [data-rk="cur:${a}"]`, String(cur)); if (max !== undefined) await page.fill(`${card(page, i)} [data-rk="max:${a}"]`, String(max)); await page.waitForTimeout(60); };
const sameResult = (c, e) => c.main === e.main && c.why === e.why && c.gap === e.gap && c.team === e.team && JSON.stringify(c.moves) === JSON.stringify(movesShown(e.moves));

(async () => {
  try { part0(); } catch (e) { check('0) runs to the end', false, String(e && e.message || e).split('\n')[0]); }
  const browser = await chromium.launch();
  try {
    // ===== 1) Shared list, an owner: check, compare, best candidate, keep, Anwerben + Rückgängig, Alle verwerfen =====
    await section('1) shared', async () => {
      const s = T.defaultSettings();
      // Everyone entered the calm plan already (anchors) and Edda's main job is locked: the check uses calm OFF, prefs ON.
      const prefs = { w_edda: { lockMain: 'cooking', pins: {} } };
      const ws = roster(SEED_W);
      const anchor = Object.fromEntries((p => p.team.map(w => [w.id, Object.fromEntries(p.jobs.map(j => [j.id, p.cells[w.id][j.id].off ? 0 : p.cells[w.id][j.id].p]))]))(T.compute(ws, s, { calm: true, prefs })));
      const ingame = Object.fromEntries(Object.entries(anchor).map(([wid, v]) => [wid, { vals: v, by: 'u_b', at: Date.now() - 3600e3 }]));
      const srv = makeServer({ workers: SEED_W, prefs, ingame });
      const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: owner });
      const P = A.page;
      const btn = await P.evaluate(() => { const b = document.getElementById('recruit-open'); return b ? { t: b.textContent.trim(), h: b.getBoundingClientRect().height, inBar: !!b.closest('.toolbar') } : null; });
      check('Arbeiter tab: button "Rekruten prüfen" in the toolbar (>= 44 px on touch)', btn && btn.t === 'Rekruten prüfen' && btn.inBar && btn.h >= 44, btn);
      await P.click('#recruit-open'); await P.waitForTimeout(350);
      let r = await R(P);
      check('opens the panel "Rekruten prüfen" with one empty candidate and "+ Kandidat"', r.open && r.title === 'Rekruten prüfen' && r.cards.length === 1 && r.add.shown && !r.add.disabled && !r.cards[0].main && !!r.cards[0].empty, r);
      // Candidate 1 from the import format.
      await fillText(P, 0, 'Mara: Kochen 9/10, Ernte 2/3 – Eigenschaften: Prodigy');
      r = await R(P);
      const c1 = { name: 'Mara', traits: 'Prodigy', stats: st({ cooking: [9, 10], harvesting: [2, 3] }) };
      const e1 = expect(SEED_W, s, prefs, c1);
      check('text field (import format) fills name, skills and traits', r.cards[0].name === 'Mara' && r.cards[0].traits === 'Prodigy' && JSON.stringify(r.cards[0].stats.cooking) === '["9","10"]' && JSON.stringify(r.cards[0].stats.harvesting) === '["2","3"]' && JSON.stringify(r.cards[0].stats.farming) === '["",""]', r.cards[0]);
      check('Mara: main job, reason, gap, team effect and changes = compute(+Mara, calm off, Edda locked) vs. compute(team)', sameResult(r.cards[0], e1), { got: r.cards[0], want: e1 });
      check('Mara: Edda keeps cooking (locked), so no "Edda würde … wechseln"', !r.cards[0].moves.some(m => m.startsWith('Edda')), r.cards[0].moves);
      // Candidate 2 typed in by hand; candidate 3 a weak all-rounder.
      await P.click('#recruit [data-rk="add"]'); await P.waitForTimeout(80);
      await P.fill(`${card(P, 1)} [data-rk="name"]`, 'Rolf');
      await setStat(P, 1, 'researching', 7, 10); await setStat(P, 1, 'crafting', 6, 8); await setStat(P, 1, 'labourer', 5, 7);
      await P.click('#recruit [data-rk="add"]'); await P.waitForTimeout(80);
      await fillText(P, 2, 'Kochen 2/3, Arbeiter 2/3');
      r = await R(P);
      const c2 = { name: 'Rolf', traits: '', stats: st({ researching: [7, 10], crafting: [6, 8], labourer: [5, 7] }) };
      const c3 = { name: '', traits: '', stats: st({ cooking: [2, 3], labourer: [2, 3] }) };
      const e2 = expect(SEED_W, s, prefs, c2), e3 = expect(SEED_W, s, prefs, c3, 'Kandidat 3');
      check('Rolf (typed in): same as compute', sameResult(r.cards[1], e2), { got: r.cards[1], want: e2 });
      check('a line without a name fills the values, the name stays empty', r.cards[2].name === '' && JSON.stringify(r.cards[2].stats.cooking) === '["2","3"]' && sameResult(r.cards[2], e3), { got: r.cards[2], want: e3 });
      const best = [e1.d, e2.d, e3.d].indexOf(Math.max(e1.d, e2.d, e3.d));
      check('"Bester Kandidat" on the one with the biggest team effect, only there', r.cards.map(c => c.best).join() === [0, 1, 2].map(i => i === best).join(), { best, ds: [e1.d, e2.d, e3.d], shown: r.cards.map(c => c.best) });
      check('"Bester Kandidat": Rolf (7/10 researcher), not the 2/3 cook', best === 1 && r.cards[1].best && !r.cards[2].best, { ds: [e1.d, e2.d, e3.d], team: r.cards.map(c => c.team) });
      check('three candidates: "+ Kandidat" disabled', r.add.disabled, r.add);
      check('nothing written to the shared list while checking', !srv.log.length, srv.log);
      const ls = await P.evaluate(k => JSON.parse(localStorage.getItem(k)), REC_KEY);
      check('the candidates are kept on this device (localStorage)', Array.isArray(ls) && ls.length === 3 && ls[0].name === 'Mara', ls);
      await P.screenshot({ path: path.join(SHOTS, 'recruit-390.png') });
      // ✕ keeps them; a reload too.
      await P.click('#recruit [data-rk="close"]'); await P.waitForTimeout(150);
      check('✕ closes, focus back on "Rekruten prüfen"', !(await R(P)).open && await P.evaluate(() => document.activeElement && document.activeElement.id === 'recruit-open'));
      await P.reload(); await P.waitForTimeout(500);
      await P.click('#recruit-open'); await P.waitForTimeout(300);
      r = await R(P);
      check('reopened after a reload: the three candidates are still there, results too', r.cards.length === 3 && r.cards[0].name === 'Mara' && sameResult(r.cards[0], e1) && r.cards[1].name === 'Rolf', r.cards.map(c => c.name));
      // Anwerben Mara: a normal worker with these values, stamp now, toast with Rückgängig.
      await P.click(`${card(P, 0)} [data-rk="hire"]`);
      const hired = await until(() => [...srv.col('workers').values()].some(w => w.name === 'Mara'), 3000);
      const [mid, mdoc] = [...srv.col('workers').entries()].find(([, w]) => w.name === 'Mara') || [];
      const toast = await P.evaluate(() => { const t = document.getElementById('toast'); return { shown: !t.hidden, msg: (t.querySelector('.toast-msg') || {}).textContent, act: (t.querySelector('.toast-act') || {}).textContent }; });
      check('Anwerben: Mara saved as a normal worker (role worker, the values, traits, order last)', hired >= 0 && mdoc && mdoc.role === 'worker' && mdoc.traits === 'Prodigy' && mdoc.stats.cooking.cur === 9 && mdoc.stats.cooking.max === 10 && mdoc.stats.harvesting.cur === 2 && mdoc.order > 6 && Object.keys(mdoc).sort().join() === 'name,order,role,stats,traits', mdoc);
      const sdoc = mid && await until(() => srv.col('stamps').has(mid), 2000) >= 0 ? srv.col('stamps').get(mid) : null;
      check('Anwerben: stamp now ({at, by})', sdoc && Math.abs(sdoc.at - Date.now()) < 10e3 && sdoc.by === 'u_a', sdoc);
      check('Anwerben: toast "Mara angeworben." with Rückgängig', toast.shown && toast.msg === 'Mara angeworben.' && toast.act === 'Rückgängig', toast);
      r = await R(P);
      check('Anwerben: Mara leaves the panel, the others stay and are compared with the new team', r.cards.length === 2 && r.cards[0].name === 'Rolf' && !r.add.disabled, r.cards.map(c => c.name));
      const withMara = { ...SEED_W, [mid]: mdoc };
      check('Rolf now compared with the team including Mara', sameResult(r.cards[0], expect(withMara, s, prefs, c2)), { got: r.cards[0], want: expect(withMara, s, prefs, c2) });
      await P.click('#toast .toast-act');
      const undone = await until(() => !srv.col('workers').has(mid) && !srv.col('stamps').has(mid), 3000);
      r = await R(P);
      check('Rückgängig: Mara gone from the list (and her stamp), back in the panel', undone >= 0 && r.cards.length === 3 && r.cards.some(c => c.name === 'Mara'), { undone, names: r.cards.map(c => c.name) });
      const fa = await P.evaluate(() => { const e = document.activeElement; return { inDlg: !!e && document.getElementById('recruit').contains(e), dis: !!(e && e.disabled), rk: e && e.dataset && e.dataset.rk, card: !!(e && e.closest('.rk-card')) && e.closest('.rk-card').querySelector('[data-rk="name"]').value }; });
      check('Rückgängig with three candidates again ("+ Kandidat" disabled): focus on Mara\'s card, inside the panel', fa.inDlg && !fa.dis && fa.card === 'Mara', fa);
      // Verwerfen one, then Alle verwerfen.
      const k3 = r.cards.find(c => c.name === '').k;
      await P.click(`#recruit .rk-card[data-k="${k3}"] [data-rk="drop"]`); await P.waitForTimeout(100);
      r = await R(P);
      check('Verwerfen drops that candidate only', r.cards.length === 2 && !r.cards.some(c => c.k === k3), r.cards.map(c => c.name));
      await P.click('#recruit [data-rk="drop-all"]'); await P.waitForTimeout(150);
      check('Alle verwerfen: panel closed, nothing kept on this device', !(await R(P)).open && (await P.evaluate(k => localStorage.getItem(k), REC_KEY)) === null);
      await P.click('#recruit-open'); await P.waitForTimeout(250);
      r = await R(P);
      check('reopened: one empty candidate again', r.cards.length === 1 && !r.cards[0].name && !r.cards[0].main, r.cards);
      check('only Anwerben/Rückgängig wrote anything (workers + stamps)', srv.log.every(l => l.c === 'workers' || l.c === 'stamps'), srv.log.map(l => l.c));
      await A.ctx.close();
    });

    // ===== 2) Read-only viewer: may check, not add =====
    await section('2) read-only', async () => {
      const srv = makeServer({ workers: SEED_W });
      const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, user: { id: 'u_c', owner: false, can: false } });
      await C.page.click('#recruit-open'); await C.page.waitForTimeout(300);
      await fillText(C.page, 0, 'Lene: Landwirtschaft 8/10');
      const r = await R(C.page);
      const e = expect(SEED_W, T.defaultSettings(), {}, { name: 'Lene', traits: '', stats: st({ farming: [8, 10] }) });
      check('read-only: the check works', r.open && sameResult(r.cards[0], e), { got: r.cards[0], want: e });
      check('read-only: "Anwerben" disabled and a note says why', r.cards[0].hire.disabled && !!r.note, { hire: r.cards[0].hire, note: r.note });
      let out = 0;
      for (let k = 0; k < 30; k++) { await C.page.keyboard.press('Tab'); if (!(await C.page.evaluate(() => document.getElementById('recruit').contains(document.activeElement)))) out++; }
      for (let k = 0; k < 8; k++) { await C.page.keyboard.press('Shift+Tab'); if (!(await C.page.evaluate(() => document.getElementById('recruit').contains(document.activeElement)))) out++; }
      check('Tab and Shift+Tab stay inside the panel', out === 0, out);
      await C.page.click(`${card(C.page, 0)} [data-rk="hire"]`, { force: true }); await C.page.waitForTimeout(300);
      check('read-only: nothing written, nothing refused', !srv.log.length && (await C.page.evaluate(() => window.__refused)) === 0);
      await C.ctx.close();
    });

    // ===== 3) Local mode with the example team only: an empty list compares with nobody =====
    await section('3) empty list', async () => {
      const X = await phone(browser, null, { name: 'X' });
      await X.page.click('#recruit-open'); await X.page.waitForTimeout(300);
      await fillText(X.page, 0, 'Ole: Kochen 3/5');
      const r = await R(X.page);
      check('empty list: the candidate fills a gap ("Füllt eine Lücke: bisher hatte niemand … als Hauptjob.")', /^Füllt eine Lücke: bisher hatte niemand .+ als Hauptjob\.$/.test(r.cards[0].gap || '') && /^Hauptjob: /.test(r.cards[0].main || ''), r.cards[0]);
      // Local Anwerben: into the LS payload with a stamp.
      await X.page.click(`${card(X.page, 0)} [data-rk="hire"]`); await X.page.waitForTimeout(200);
      const d = await X.page.evaluate(() => JSON.parse(localStorage.getItem('bellwright-arbeitsplan-v1')));
      const ole = d && d.workers.find(w => w.name === 'Ole');
      check('local Anwerben: worker and stamp in the payload', ole && ole.stats.cooking.cur === 3 && d.stamps && d.stamps[ole.id] && d.stamps[ole.id].at > Date.now() - 10e3, d && { w: d.workers.map(w => w.name), stamps: d.stamps });
      await X.ctx.close();
    });

    // ===== 4) Layout: bottom sheet on phones, dialog on desktop; motion per level =====
    for (const [w, h] of [[360, 740], [390, 844], [1280, 900]]) {
      await section('4) layout ' + w, async () => {
        const L = await phone(browser, null, { name: 'L' + w, seedLs: { 'bellwright-arbeitsplan-v1': { settings: null, workers: Object.entries(SEED_W).map(([id, x]) => ({ id, ...x })) }, [ANIM_KEY]: 'aus' } }, { width: w, height: h });
        const P = L.page;
        await P.click('#recruit-open'); await P.waitForTimeout(250);
        await fillText(P, 0, 'Mara: Kochen 9/10, Ernte 2/3');
        await P.click('#recruit [data-rk="add"]'); await P.waitForTimeout(80);
        const m = await P.evaluate(() => {
          const d = document.querySelector('#recruit .recruit-sheet'), r = d.getBoundingClientRect();
          const ctl = [...d.querySelectorAll('button, input, select, textarea')].filter(e => e.getClientRects().length);
          return { l: r.left, r: r.right, b: r.bottom, t: r.top, vw: innerWidth, vh: innerHeight, sw: d.scrollWidth, cw: d.clientWidth,
            inner: [...d.querySelectorAll('.rk-card')].every(c => c.scrollWidth <= c.clientWidth + 1),
            minH: Math.min(...ctl.map(e => e.getBoundingClientRect().height)), small: ctl.filter(e => e.getBoundingClientRect().height < 44).map(e => (e.dataset.rk || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height)).slice(0, 6),
            page: document.documentElement.scrollWidth <= innerWidth };
        });
        if (w < 900) {
          check(`${w}: bottom sheet (full width, at the bottom), no horizontal scroll inside`, Math.abs(m.l) < 1 && Math.abs(m.r - m.vw) < 1 && Math.abs(m.b - m.vh) < 1 && m.sw <= m.cw && m.inner && m.page, m);
          check(`${w}: every control >= 44 px tall (one-handed)`, m.minH >= 44, m.small);
        } else check('1280: a centred dialog, not full width, no horizontal scroll', m.l > 100 && m.r < m.vw - 100 && m.sw <= m.cw && m.inner, m);
        await P.screenshot({ path: path.join(SHOTS, `recruit-${w}.png`) });
        await P.evaluate(() => { const b = document.querySelector('#recruit .recruit-body'); if (b) b.scrollTop = b.scrollHeight; });
        await P.waitForTimeout(100);
        await P.screenshot({ path: path.join(SHOTS, `recruit-${w}-bottom.png`) });
        await L.ctx.close();
      });
    }
    // ===== 5) Blocked storage and values out of range =====
    await section('5) blocked storage', async () => {
      const X = await phone(browser, null, { name: 'blk', blockLs: true });
      await X.page.click('#recruit-open'); await X.page.waitForTimeout(250);
      await fillText(X.page, 0, 'Mara: Kochen 9/10');
      await X.page.click('#recruit [data-rk="close"]'); await X.page.waitForTimeout(100);
      await X.page.click('#recruit-open'); await X.page.waitForTimeout(250);
      const r = await R(X.page);
      check('blocked storage: after ✕ and reopening, the candidate is still there (held for this page load)', r.cards.length === 1 && r.cards[0].name === 'Mara' && !!r.cards[0].main, r.cards);
      // A Stufe above the top value: leaving the field shows what the app computes with (15), as in the worker editor.
      await X.page.fill(`${card(X.page, 0)} [data-rk="cur:farming"]`, '20');
      await X.page.press(`${card(X.page, 0)} [data-rk="cur:farming"]`, 'Tab'); await X.page.waitForTimeout(80);
      const v = await X.page.evaluate(() => document.querySelector('#recruit .rk-card [data-rk="cur:farming"]').value);
      check('Stufe 20 typed: the field shows 15 after leaving it', v === '15', v);
      await X.ctx.close();
    });
    for (const lvl of ['voll', 'ruhig', 'aus']) {
      await section('4) motion ' + lvl, async () => {
        const L = await phone(browser, null, { name: 'M' + lvl, seedLs: { [ANIM_KEY]: lvl } });
        await L.page.click('#recruit-open'); await L.page.waitForTimeout(20);
        const a = await L.page.evaluate(() => document.getElementById('recruit').getAnimations({ subtree: true }).map(x => { const kf = x.effect.getKeyframes(); return { dur: x.effect.getComputedTiming().duration, props: [...new Set(kf.flatMap(k => Object.keys(k).filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p))))] }; }));
        const dlg = await L.page.evaluate(() => { const d = document.getElementById('recruit'); return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), lb: d.getAttribute('aria-labelledby'), inert: document.querySelector('.wrap').inert }; });
        check(`${lvl}: role=dialog, aria-modal, labelled by the title, page behind inert`, dlg.role === 'dialog' && dlg.modal === 'true' && dlg.lb === 'recruit-title' && dlg.inert, dlg);
        if (lvl === 'voll') check('voll: the sheet slides in (transform + opacity, <= 400 ms)', a.length >= 1 && a.every(x => x.dur <= 400 && x.props.every(p => p === 'transform' || p === 'opacity')) && a.some(x => x.props.includes('transform')), a);
        if (lvl === 'voll') {
          // The sheet covers the page like the Eintragen-Modus: the ember loop (the page's one frame loop) waits meanwhile.
          await L.page.evaluate(() => { window.__raf = 0; const o = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => { window.__raf++; return o(cb); }; });
          await L.page.waitForTimeout(300);
          const held = await L.page.evaluate(() => window.__raf);
          await L.page.click('#recruit [data-rk="close"]'); await L.page.waitForTimeout(300);
          const after = await L.page.evaluate(() => window.__raf);
          check('voll: the ember loop waits while the panel is open and runs again after closing', held === 0 && after > 3, { held, after });
          await L.page.click('#recruit-open'); await L.page.waitForTimeout(100);
        }
        if (lvl === 'ruhig') check('ruhig: only a fade (opacity, <= 150 ms)', a.length >= 1 && a.every(x => x.dur <= 150 && x.props.join() === 'opacity'), a);
        if (lvl === 'aus') check('aus: no animation', a.length === 0, a);
        await L.page.keyboard.press('Escape'); await L.page.waitForTimeout(100);
        check(`${lvl}: Escape closes the panel`, !(await R(L.page)).open);
        await L.ctx.close();
      });
    }
  } finally { await browser.close(); }
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-recruit: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

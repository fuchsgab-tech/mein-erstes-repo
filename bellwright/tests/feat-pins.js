// BUILD 7 "Festlegen": lock a main job or pin single numbers (collection 'prefs', doc id = worker id,
// {lockMain: jobId|null, pins: {jobId: 0|2..9}}), compute(workers, settings, {anchor, calm, explain, prefs}).
// Part A runs the planner in node (cut out of the app file, like calm-load.js, plus cleanPrefs). The copy saved
// before this build (versions/before-pins.html) is the reference for "no prefs = exactly today's plan".
// Part B drives page.html (from mk.js) in Playwright: phones share one fake server in node (one map and one
// listener list per collection: workers, settings, ingame, prefs), user stub with id/isOwner/can/profiles, sample stub.
const { chromium } = require('playwright');
// BUILD 13: while villagers have open numbers, the banner's "Jetzt im Spiel eintragen" replaces the grid-head button,
// so the mode opens through whichever trigger is visible.
const ENTRY_OPEN = '#entry-banner-go:visible, #entry-open:visible';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../bellwright-arbeitsplan.html');
const OLD = path.resolve(__dirname, '../versions/before-pins.html');
function load(file) {
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf('// ---------- Game data ----------');
  const b = s.indexOf('// ---------- Rendering: Plan ----------');
  if (a < 0 || b < 0) throw new Error('planner section not found in ' + file);
  const code = s.slice(a, b);
  const names = ['compute', 'EXAMPLE', 'PHASES', 'JOBS', 'JOB', 'ATTRS', 'defaultSettings', 'normSettings', 'normWorker'];
  const extra = /function cleanPrefs\b/.test(code) ? ', cleanPrefs' : '';
  const fn = new Function('localStorage', 'matchMedia', 'document', '"use strict";\n' + code + `\nreturn { ${names.join(', ')}${extra} };`);
  const store = {};
  const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  return fn(ls, () => ({ matches: false }), undefined);
}
const T = load(APP), O = load(OLD);
const LS_KEY = 'bellwright-arbeitsplan-v1';
const DIR = { u_owner: 'Gabriel', u_lena: 'Lena', u_ro: 'Ida' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 700) : '')); };
const info = [];
const deq = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
// The whole result as plain data (team/others/jobs as ids), without the values added later only to report on the plan
// (objective; level and worth for the Rekruten-Check): numbers, flags, why texts, notes.
const full = p => { const q = clone({ ...p, team: p.team.map(w => w.id), others: p.others.map(w => w.id), jobs: p.jobs.map(j => j.id) }); delete q.objective; delete q.level; delete q.worth; return q; };
const setPhase = (M, s, id) => { const ph = M.PHASES.find(x => x.id === id); s.phase = id; for (const j of M.JOBS) s.jobs[j.id].imp = ph.imp[j.id]; return s; };
const phaseSettings = (M, id) => setPhase(M, M.defaultSettings(), id);
const cv = c => (c.off ? 0 : c.p);
const vals = p => Object.fromEntries(p.team.map(w => [w.id, Object.fromEntries(p.jobs.map(j => [j.id, cv(p.cells[w.id][j.id])]))]));
const flat = p => Object.fromEntries(p.team.flatMap(w => p.jobs.map(j => [`${w.id}|${j.id}`, cv(p.cells[w.id][j.id])])));
const ex = () => clone(T.EXAMPLE);
const exId = name => T.EXAMPLE.find(w => w.name === name).id;
const PH = ['start', 'ausbau', 'krieg', 'ausgewogen'];

function randomTeam(rnd, M, N) {
  const ws = [];
  for (let i = 0; i < N; i++) {
    const stats = {};
    for (const a of M.ATTRS) { const c = Math.floor(rnd() * 11); const hasMax = rnd() > 0.2; stats[a.id] = { cur: c, max: hasMax ? Math.min(10, c + Math.floor(rnd() * 6)) : null }; }
    const traits = ['', '', '', 'Slacker', 'Neurotic', 'Stalwart', 'Dullard', 'Prodigy', 'Tireless'][Math.floor(rnd() * 9)];
    ws.push(M.normWorker('w' + i, { name: 'W' + i, role: rnd() < 0.1 ? 'guard' : 'worker', traits, stats, order: i }));
  }
  return ws;
}
function variedSettings(M, rep) {   // the same variations as logic.js / feat-calm.js
  const st = M.defaultSettings();
  const ph = M.PHASES[rep % 4];
  st.phase = ph.id; for (const j of M.JOBS) st.jobs[j.id].imp = ph.imp[j.id];
  if (rep % 7 === 3) st.jobs.research.on = false;
  if (rep % 11 === 5) for (const j of M.JOBS) st.jobs[j.id].on = j.id === 'delivery';
  if (rep % 13 === 6) st.growth = rep % 2 ? 0 : 1;
  if (rep % 5 === 2) st.disableWeak = false;
  if (rep % 9 === 4) st.jobs.caravan.on = true;
  return st;
}
const costNote = r => `Eure Festlegungen kosten das Team etwa ${String(r).replace('.', ',')} ${r === 1 ? 'Stufe' : 'Stufen'}.`;

// =====================================================================================================
// Part A: the planner in node
// =====================================================================================================
function partA() {
  // ---- no prefs = exactly today's plan (numbers, flags, why texts, notes), proven against the saved copy ----
  {
    const snapStart = vals(O.compute(ex(), phaseSettings(O, 'start')));
    const noPrefs = [undefined, {}, null, { nobody: { lockMain: 'crafting', pins: { research: 0 } } }, { [exId('Kunibert')]: { lockMain: 'crafting', pins: { research: 0 } } }, 'junk'];
    let runs = 0; const bad = [];
    for (const ph of PH) for (const base of [{}, { calm: false }, { calm: true }, { calm: true, anchor: snapStart }, { calm: false, anchor: snapStart }, { calm: true, anchor: snapStart, explain: false }]) {
      const want = full(O.compute(ex(), phaseSettings(O, ph), base));
      for (const prefs of noPrefs) {
        runs++;
        const got = T.compute(ex(), phaseSettings(T, ph), prefs === undefined ? base : { ...base, prefs });
        if (!deq(full(got), want)) bad.push(`${ph} ${JSON.stringify(base).slice(0, 40)} prefs=${JSON.stringify(prefs)}`);
      }
    }
    check(`no prefs: the whole result deep-equals the copy before this build (EXAMPLE, ${runs} runs)`, !bad.length, bad.slice(0, 4));
    let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let n = 0; const bad2 = [];
    for (let N = 0; N <= 20; N++) for (let rep = 0; rep < 40; rep++) {
      const ws = randomTeam(rnd, T, N);
      const sN = variedSettings(T, rep), sO = variedSettings(O, rep);
      const anchor = rep % 3 ? vals(O.compute(clone(ws), variedSettings(O, rep + 1))) : {};
      const opts = { calm: rep % 2 === 0, anchor };
      const guard = ws.find(w => w.role !== 'worker');
      const prefs = rep % 4 === 0 ? {} : rep % 4 === 1 ? { ghost: { lockMain: 'cooking', pins: {} } } : guard ? { [guard.id]: { lockMain: 'research', pins: { cooking: 0 } } } : undefined;
      n++;
      if (!deq(full(T.compute(clone(ws), sN, { ...opts, prefs })), full(O.compute(clone(ws), sO, opts)))) bad2.push(`N=${N} rep=${rep}`);
    }
    check(`no prefs (fuzz, ${n} teams, calm on/off with anchors): whole result deep-equals the copy before this build`, !bad2.length, bad2.slice(0, 5));
    check('objective: a number, 0 for an empty team', typeof T.compute(ex(), T.defaultSettings()).objective === 'number' && T.compute([], T.defaultSettings()).objective === 0);
  }

  // ---- cleanPrefs ----
  {
    const C = T.cleanPrefs;
    check('cleanPrefs: 1 is never a pin; 10, -1, "3", 2.5 dropped; 0 and 2..9 kept', deq(C({ lockMain: null, pins: { a: 1, b: 10, c: -1, d: '3', e: 2.5, f: 0, g: 2, h: 9 } }), { lockMain: null, pins: { f: 0, g: 2, h: 9 } }));
    check('cleanPrefs: lock + X on the same job: the lock wins, the pin goes', deq(C({ lockMain: 'research', pins: { research: 0, cooking: 3 } }), { lockMain: 'research', pins: { cooking: 3 } }));
    check('cleanPrefs: nothing left = null (Auto everywhere)', C({ lockMain: null, pins: {} }) === null && C(null) === null && C('x') === null && C([]) === null);
    check('cleanPrefs: junk keys and lock ids dropped', deq(C({ lockMain: 'Bad Id!', pins: { '__proto__': 3, 'Bad Key': 2, ok: 3 } }), { lockMain: null, pins: { ok: 3 } }));
  }

  const godric = exId('Godric'), wulfric = exId('Wulfric'), agnes = exId('Agnes'), edda = exId('Edda');
  // ---- TEST: lock Godric → Handwerk: he gets crafting 1 and the cost note shows about 1 Stufe ----
  {
    const s = phaseSettings(T, 'start');
    const plain = T.compute(ex(), s);
    const p = T.compute(ex(), s, { prefs: { [godric]: { lockMain: 'crafting', pins: {} } } });
    const c = p.cells[godric].crafting;
    check('lock Godric → Handwerk (Start): main crafting, cell 1, locked', plain.main[godric] !== 'crafting' && p.main[godric] === 'crafting' && c.p === 1 && c.main && c.locked && !c.fixed, { was: plain.main[godric], c });
    check('lock: why "Hauptjob von euch festgelegt." + the skill line', c.why === 'Hauptjob von euch festgelegt. Fertigkeit Handwerk (Crafting) 6/10.', c.why);
    const d = plain.objective - p.objective;
    check('lock: cost note "Eure Festlegungen kosten das Team etwa 1 Stufe."', p.notes.some(x => x.text === costNote(1)) && d > 0.5 && d < 1.25, { d, notes: p.notes.map(x => x.text) });
    info.push(`lock Godric → Handwerk in Start: objective ${plain.objective.toFixed(2)} → ${p.objective.toFixed(2)} (Δ ${d.toFixed(2)})`);
    check('lock: only Godric has a 1 on crafting, every worker exactly one 1', p.team.every(w => p.jobs.filter(j => cv(p.cells[w.id][j.id]) === 1).length === 1) && p.team.filter(w => p.cells[w.id].crafting.p === 1).length === 1);
    let ok = true;
    for (const ph of PH) for (const calm of [false, true]) {
      const q = T.compute(ex(), phaseSettings(T, ph), { calm, anchor: vals(plain), prefs: { [godric]: { lockMain: 'crafting', pins: {} } } });
      if (q.main[godric] !== 'crafting' || !q.cells[godric].crafting.locked || q.cells[godric].crafting.why.includes('Bleibt Hauptjob')) ok = false;
    }
    check('lock holds in every phase, calm on and off (and never gets the "Bleibt Hauptjob" text)', ok);
    // A lock in Ausbau, where Godric is crafter anyway: no cost note.
    const pa = T.compute(ex(), phaseSettings(T, 'ausbau'), { prefs: { [godric]: { lockMain: 'crafting', pins: {} } } });
    check('lock on the job the app picks anyway: same numbers, no cost note', deq(flat(pa), flat(T.compute(ex(), phaseSettings(T, 'ausbau')))) && !pa.notes.some(x => x.text.startsWith('Eure Festlegungen')));
    // "Hauptjob festhalten" for Edda (cook): a later phase keeps her there.
    const pe = T.compute(ex(), phaseSettings(T, 'krieg'), { prefs: { [edda]: { lockMain: 'cooking', pins: {} } } });
    check('Edda stays cook (locked) in Aufrüsten', pe.main[edda] === 'cooking' && pe.cells[edda].cooking.locked);
  }

  // ---- TEST: pin Wulfric Forschung = X: someone else covers research, Wulfric never gets it as main ----
  {
    for (const ph of PH) {
      const s = phaseSettings(T, ph);
      const p = T.compute(ex(), s, { prefs: { [wulfric]: { lockMain: null, pins: { research: 0 } } } });
      const c = p.cells[wulfric].research;
      const cover = p.team.filter(w => w.id !== wulfric && !p.cells[w.id].research.off && p.cells[w.id].research.p <= 2);
      check(`pin Wulfric Forschung X (${ph}): off, fixed, not main; someone else on 1–2`, c.off && c.p === 0 && c.fixed && p.main[wulfric] !== 'research' && cover.length >= 1, { c, main: p.main[wulfric], cover: cover.map(w => w.name) });
    }
    // Even when the game has research on 1 for him (calm anchor), the pin wins.
    const s = phaseSettings(T, 'ausbau');
    const anchor = vals(T.compute(ex(), s));
    const p = T.compute(ex(), s, { calm: true, anchor, prefs: { [wulfric]: { lockMain: null, pins: { research: 0 } } } });
    check('pin X beats the calm anchor (research is 1 in the game)', anchor[wulfric].research === 1 && p.main[wulfric] !== 'research' && p.cells[wulfric].research.off);
    // The fixed why: what the app would say without the Festlegungen.
    const auto = T.compute(ex(), s, { calm: true, anchor }).cells[wulfric].research;
    check('fixed why: "Von euch festgelegt. Die App würde 1 vorschlagen: {why}" (the plan without Festlegungen)', p.cells[wulfric].research.why === `Von euch festgelegt. Die App würde 1 vorschlagen: ${auto.why}` && deq(p.cells[wulfric].research.auto, { p: 1, off: false, why: auto.why }), p.cells[wulfric].research.why);
  }

  // ---- TEST: two pinned 2s: no third 2 ----
  {
    let tried = 0; const bad = [];
    for (const ph of PH) {
      const s = phaseSettings(T, ph);
      const plain = T.compute(ex(), s);
      for (const w of plain.team) {
        const free = plain.jobs.filter(j => j.attr && !plain.cells[w.id][j.id].main).map(j => j.id);
        for (let a = 0; a < free.length; a++) for (let b = a + 1; b < free.length; b++) {
          tried++;
          const p = T.compute(ex(), s, { calm: tried % 2 === 0, prefs: { [w.id]: { lockMain: null, pins: { [free[a]]: 2, [free[b]]: 2 } } } });
          const twos = p.jobs.filter(j => cv(p.cells[w.id][j.id]) === 2).map(j => j.id).sort();
          if (!deq(twos, [free[a], free[b]].sort())) bad.push(`${ph} ${w.name} ${free[a]}+${free[b]} -> ${twos}`);
        }
      }
    }
    check(`two pinned 2s: exactly those two 2s, no side job, no third 2 (${tried} cases)`, !bad.length, bad.slice(0, 4));
    // 'Max two 2s' never demotes a fixed cell: three pinned 2s stay.
    const s = phaseSettings(T, 'ausbau');
    const p = T.compute(ex(), s, { prefs: { [agnes]: { lockMain: null, pins: { crafting: 2, cooking: 2, research: 2 } } } });
    check('three pinned 2s all stay (never demoted)', ['crafting', 'cooking', 'research'].every(j => p.cells[agnes][j].p === 2 && p.cells[agnes][j].fixed));
  }

  // ---- TEST: 'Auto' removes the pin ----
  {
    const s = phaseSettings(T, 'start');
    const withPin = { [agnes]: { lockMain: null, pins: { cooking: 3, crafting: 5 } } };
    const auto = { [agnes]: { lockMain: null, pins: { crafting: 5 } } };   // Auto on cooking
    const p1 = T.compute(ex(), s, { prefs: withPin }), p2 = T.compute(ex(), s, { prefs: auto }), p0 = T.compute(ex(), s);
    check('Auto on cooking: that cell is the app\'s again, the other pin stays', p1.cells[agnes].cooking.fixed && !p2.cells[agnes].cooking.fixed && p2.cells[agnes].crafting.fixed && p2.cells[agnes].cooking.p === p0.cells[agnes].cooking.p);
    check('Auto everywhere (cleanPrefs → null): the plain plan exactly', deq(full(T.compute(ex(), s, { prefs: { [agnes]: T.cleanPrefs({ lockMain: null, pins: {} }) } })), full(p0)));
  }

  // ---- edge cases ----
  {
    const s = phaseSettings(T, 'start'); s.jobs.crafting.on = false;
    const p = T.compute(ex(), s, { prefs: { [godric]: { lockMain: 'crafting', pins: {} } } });
    check('lock on a switched-off job rests: plain numbers + note', deq(flat(p), flat(T.compute(ex(), s))) && p.notes.some(x => x.text === 'Festlegung für Godric ruht – Handwerk ist abgeschaltet.'), p.notes.map(x => x.text));
    const s2 = phaseSettings(T, 'start');
    const g = T.compute(ex(), s2, { prefs: { [exId('Kunibert')]: { lockMain: 'crafting', pins: { research: 2 } } } });
    check('guards keep their prefs, but they are inactive', deq(full(g), full(T.compute(ex(), s2))));
    const lx = T.compute(ex(), s2, { prefs: { [godric]: { lockMain: 'research', pins: { research: 0 } } } });
    check('lock + X on the same job in the data: the lock wins', lx.main[godric] === 'research' && lx.cells[godric].research.p === 1 && lx.cells[godric].research.locked);
    // Pins on every switched-on job: no main job at all (nothing on 1), no crash, "Hauptjob: –".
    const allX = Object.fromEntries(T.JOBS.map(j => [j.id, 0]));
    const ax = T.compute(ex(), s2, { calm: true, anchor: vals(T.compute(ex(), s2)), prefs: { [agnes]: { lockMain: null, pins: allX } } });
    check('X everywhere: no main job, every cell X and fixed', !ax.main[agnes] && ax.jobs.every(j => ax.cells[agnes][j.id].off && ax.cells[agnes][j.id].fixed));
    // calm: a pinned cell is never held; a held cell becomes the pin.
    const sA = phaseSettings(T, 'ausbau'), anchor = vals(T.compute(ex(), phaseSettings(T, 'start')));
    const calmP = T.compute(ex(), sA, { calm: true, anchor });
    const held = calmP.team.flatMap(w => calmP.jobs.filter(j => calmP.cells[w.id][j.id].held).map(j => [w.id, j.id]));
    const [hw, hj] = held[0];
    const pin = calmP.cells[hw][hj].ideal;
    const q = T.compute(ex(), sA, { calm: true, anchor, prefs: { [hw]: { lockMain: null, pins: { [hj]: pin } } } });
    check('calm hysteresis skips pinned cells (a held number pinned to its calculated value)', held.length > 0 && q.cells[hw][hj].p === pin && q.cells[hw][hj].fixed && !q.cells[hw][hj].held, q.cells[hw][hj]);
    // explain:false (phase costs) gives the same numbers, without the extra runs.
    const pr = { [godric]: { lockMain: 'crafting', pins: {} }, [wulfric]: { lockMain: null, pins: { research: 0, cooking: 3 } } };
    const e1 = T.compute(ex(), sA, { calm: true, anchor, prefs: pr }), e0 = T.compute(ex(), sA, { calm: true, anchor, prefs: pr, explain: false });
    check('explain:false: same numbers, no cost note', deq(flat(e1), flat(e0)) && !e0.notes.some(x => x.text.startsWith('Eure Festlegungen')));
    // prefs are stored by job id: a phase switch keeps them.
    check('a phase switch keeps the Festlegungen (stored by job id)', PH.every(ph => { const x = T.compute(ex(), phaseSettings(T, ph), { prefs: pr }); return x.main[godric] === 'crafting' && x.cells[wulfric].research.off && x.cells[wulfric].cooking.p === 3; }));
  }

  // ---- fuzz: invariants with random Festlegungen ----
  {
    let seed = 29; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const bad = []; let runs = 0, notes = 0;
    const PINV = [0, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let N = 1; N <= 16; N++) for (let rep = 0; rep < 30; rep++) {
      const ws = randomTeam(rnd, T, N);
      const s = variedSettings(T, rep);
      const prefs = {};
      for (const w of ws) {
        if (rnd() < 0.45) continue;
        const p = { lockMain: rnd() < 0.35 ? T.JOBS[Math.floor(rnd() * T.JOBS.length)].id : null, pins: {} };
        const k = Math.floor(rnd() * 4);
        for (let i = 0; i < k; i++) p.pins[T.JOBS[Math.floor(rnd() * T.JOBS.length)].id] = PINV[Math.floor(rnd() * PINV.length)];
        if (rnd() < 0.05) for (const j of T.JOBS) p.pins[j.id] = 0;
        prefs[w.id] = p;
      }
      const calm = rep % 2 === 0;
      const anchor = calm ? vals(T.compute(ws, variedSettings(T, rep + 1))) : undefined;
      const p = T.compute(ws, s, { calm, anchor, prefs });
      runs++;
      for (const w of p.team) {
        const cp = T.cleanPrefs(prefs[w.id]);
        const lock = cp && cp.lockMain && s.jobs[cp.lockMain].on ? cp.lockMain : null;
        const ones = p.jobs.filter(j => cv(p.cells[w.id][j.id]) === 1);
        const pinnedOn = p.jobs.filter(j => cp && j.id !== lock && cp.pins[j.id] !== undefined);
        if (lock && (p.main[w.id] !== lock || !p.cells[w.id][lock].locked || cv(p.cells[w.id][lock]) !== 1)) bad.push(`N=${N} rep=${rep} ${w.name} lock ${lock} not kept`);
        for (const j of pinnedOn) { const c = p.cells[w.id][j.id]; if (!c.fixed || cv(c) !== cp.pins[j.id] || c.main || c.held || !c.why.startsWith('Von euch festgelegt.') || !c.auto) bad.push(`N=${N} rep=${rep} ${w.name} pin ${j.id}=${cp.pins[j.id]} -> ${JSON.stringify(c).slice(0, 120)}`); }
        if (ones.length > 1) bad.push(`N=${N} rep=${rep} ${w.name} has ${ones.length} ones`);
        if (pinnedOn.length < p.jobs.length && ones.length !== 1) bad.push(`N=${N} rep=${rep} ${w.name} has no 1 although a job is free`);
        if ((p.main[w.id] ? 1 : 0) !== ones.length || (ones.length && ones[0].id !== p.main[w.id])) bad.push(`N=${N} rep=${rep} ${w.name} main/1 mismatch`);
        const p2 = pinnedOn.filter(j => cp.pins[j.id] === 2).length;
        if (p2 >= 2 && p.jobs.filter(j => cv(p.cells[w.id][j.id]) === 2).length !== p2) bad.push(`N=${N} rep=${rep} ${w.name} extra 2 next to ${p2} pinned 2s`);
        for (const j of p.jobs) { const c = p.cells[w.id][j.id]; if (!c.why || (!c.off && (c.p < 1 || c.p > 9 || !Number.isInteger(c.p))) || (c.fixed && !pinnedOn.includes(j))) bad.push(`N=${N} rep=${rep} bad cell ${j.id}`); }
      }
      const q = T.compute(ws, s, { calm, anchor, prefs, explain: false });
      if (!deq(flat(q), flat(p))) bad.push(`N=${N} rep=${rep} explain:false differs`);
      const plain = T.compute(ws, s, { calm, anchor, explain: false });
      const r = Math.round((plain.objective - p.objective) * 2) / 2;
      const hasActive = p.team.some(w => T.cleanPrefs(prefs[w.id]));
      const note = p.notes.find(x => x.text.startsWith('Eure Festlegungen'));
      if (p.team.length && p.jobs.length && hasActive && (r >= 1 ? !note || note.text !== costNote(r) : !!note)) bad.push(`N=${N} rep=${rep} cost note ${r} ${note && note.text}`);
      if (note) notes++;
    }
    check(`fuzz (${runs} teams with random locks and pins): locks kept, pins exact and never main, one 1 per worker, no third 2, explain:false same, cost note right`, !bad.length, bad.slice(0, 5));
    info.push(`fuzz: ${runs} teams, ${notes} with a cost note`);
  }
}

// =====================================================================================================
// Part B: the page
// =====================================================================================================
function makeServer(seed = {}) {
  const srv = { workers: new Map(), settings: new Map(), ingame: new Map(), prefs: new Map(), stamps: new Map(), checks: new Map(), log: [], pages: new Set() };   // BUILD 14: 'stamps', BUILD 17: 'checks' too
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) srv[c].set(id, clone(d));
  srv.docs = c => [...srv[c]].map(([id, d]) => [id, clone(d)]);
  srv.broadcast = c => { const docs = srv.docs(c); for (const p of srv.pages) p.evaluate(([c, docs]) => window.__deliver && window.__deliver(c, docs), [c, docs]).catch(() => {}); };
  srv.write = async (who, op, c, id, d) => {
    await sleep(80);
    if (op === 'set') srv[c].set(id, clone(d)); else srv[c].delete(id);
    srv.log.push({ who, op, c, id, d: d && clone(d), t: Date.now() });
    setTimeout(() => srv.broadcast(c), 10);
  };
  return srv;
}
// cfg: { name, inClaude, writable, prefsDelay, prefsError, user: null | { id, owner, can }, dir }
function STUB(cfg) {
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__clip = t; } } }); } catch (e) { /* ignore */ }
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
      onSnapshot: (n, err) => {
        if (c === 'prefs' && cfg.prefsError) { setTimeout(() => err && err({ code: cfg.prefsError, message: 'refused' }), 300); return () => {}; }
        list(colL, c).push(n);
        window.__srvRead(c).then(docs => setTimeout(() => n(snapC(docs)), c === 'prefs' ? (cfg.prefsDelay || 0) : 0));
        return () => {};
      },
    }),
    doc: p => { const [c, id] = p.split('/'); return docRef(c, id); },
  });
  const u = cfg.user;
  const user = !u ? null : Object.freeze({
    isOwner: async () => !!u.owner,
    id: async () => u.id || null,
    can: async n => (n === 'data.write' ? u.can : false),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: (cfg.dir || {})[i] || '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  const sample = async () => ({ text: '' });
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
  sample.json = async () => ({ workers: [] });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : n === 'sample' ? sample : null) };
}

const errs = [];
async function phone(browser, srv, cfg, { width = 390, height = 844, hash = '#plan', file = 'page.html' } = {}) {
  const mobile = width < 900;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
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
async function until(fn, max = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(25); }
  return -1;
}
const domVals = page => page.evaluate(() => {
  const o = {};
  for (const b of document.querySelectorAll('#plan-view .pbadge[data-k], #plan-view [data-cell]')) { const k = b.dataset.k || b.dataset.cell; const t = b.textContent.trim(); o[k] = t === 'aus' ? 0 : +t; }
  return o;
});
const fixedKeys = page => page.evaluate(() => [...document.querySelectorAll('#plan-view .pbadge.fixed, #plan-view .cell.fixed')].map(b => b.dataset.k || b.dataset.cell).sort());
const subOf = (page, wid) => page.evaluate(id => { const s = document.querySelector(`#wp-${CSS.escape(id)} .wp-head .sub`); return s ? s.textContent : null; }, wid);
const notesText = page => page.evaluate(() => [...document.querySelectorAll('#notes li')].map(l => l.textContent));
const toastState = page => page.evaluate(() => { const t = document.getElementById('toast'); const b = t.querySelector('.toast-act'); return { shown: !t.hidden, msg: (t.querySelector('.toast-msg') || {}).textContent || '', act: b ? b.textContent : '' }; });
// Opens a card row (and "Zahlen zeigen" around it on cards that are all entered), like tapping it.
const openRow = async (page, key) => { await page.evaluate(k => { const d = document.querySelector(`#plan-view details[data-key="${CSS.escape(k)}"]`); for (let x = d; x; x = x.parentElement && x.parentElement.closest('details')) if (!x.open) x.querySelector(':scope > summary').click(); }, key); await page.waitForTimeout(60); };
const tapFix = (page, key, v) => page.click(`#plan-view details[data-key="${key}"] [data-fix="${v}"]`);
const fixInfo = (page, key) => page.evaluate(k => {
  const d = document.querySelector(`#plan-view details[data-key="${CSS.escape(k)}"]`);
  const f = d && d.querySelector('.fix');
  if (!f) return null;
  const card = d.closest('.wp-card').getBoundingClientRect(), seg = f.querySelector('.fix-seg');
  return {
    seg: seg ? [...seg.querySelectorAll('button')].map(b => ({ t: b.textContent, v: b.dataset.fix, p: b.getAttribute('aria-pressed'), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width })) : [],
    sel: (f.querySelector('select') || {}).value, opts: f.querySelector('select') ? [...f.querySelector('select').options].map(o => o.textContent) : [],
    selOn: !!f.querySelector('select.on'), selH: f.querySelector('select') ? f.querySelector('select').getBoundingClientRect().height : 0,
    btns: [...f.querySelectorAll('.btn')].map(b => ({ t: b.textContent, v: b.dataset.fix, h: b.getBoundingClientRect().height })),
    lbl: (f.querySelector('.fix-lbl') || {}).textContent, group: f.getAttribute('aria-label'),
    inside: [...f.querySelectorAll('button, select')].every(el => { const r = el.getBoundingClientRect(); return r.left >= card.left - 0.5 && r.right <= card.right + 0.5; }),
  };
}, key);
const byOrder = ws => [...ws].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
function exampleSeed() {
  const workers = {};
  T.EXAMPLE.forEach((w, i) => { workers['w_' + w.name.toLowerCase()] = { name: w.name, role: w.role, traits: w.traits, order: i + 1, stats: clone(w.stats) }; });
  return workers;
}
const prefsLog = (srv, id) => srv.log.filter(x => x.c === 'prefs' && x.id === id);

async function sharedFlow(browser) {
  const workers = exampleSeed();
  const ws = byOrder(Object.entries(workers).map(([id, d]) => T.normWorker(id, d)));
  const s0 = T.defaultSettings();
  // Everyone entered the calm Start plan already, so the plan is stable and tracked.
  const snap = vals(T.compute(clone(ws), s0, { calm: true, anchor: {} }));
  const ingame = Object.fromEntries(Object.entries(snap).map(([wid, v]) => [wid, { vals: v, by: 'u_lena', at: Date.now() - 3600e3 }]));
  const srv = makeServer({ workers, ingame });
  const plan = prefs => flat(T.compute(clone(ws), s0, { calm: true, anchor: snap, prefs }));
  const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: { id: 'u_owner', owner: true, can: true } });
  const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: { id: 'u_lena', owner: false, can: true } });
  const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, user: { id: 'u_ro', owner: false, can: false } }, { width: 360, height: 740 });
  check('shared: every phone shows the plan (no Festlegungen yet)', deq(await domVals(A.page), plan({})) && deq(await domVals(B.page), plan({})) && deq(await domVals(C.page), plan({})));
  check('card hint mentions Festlegen for editors only', (await A.page.$eval('#card-hint', e => e.textContent)).includes('festlegen') && !(await C.page.$eval('#card-hint', e => e.textContent)).includes('festlegen'));

  // Controls appear only inside an opened row.
  check('closed rows: the controls sit inside closed rows only', await A.page.evaluate(() => { const f = [...document.querySelectorAll('#plan-view .fix')]; return f.length > 0 && f.every(x => !!x.closest('details.wp-row:not([open])')); }));
  await openRow(A.page, 'w_godric|crafting');
  const f0 = await fixInfo(A.page, 'w_godric|crafting');
  check('opened row: "Festlegen:" with Auto · 2 · 3 · 5 · 9 · X, Auto pressed', f0 && f0.lbl === 'Festlegen:' && f0.seg.map(b => b.t).join() === 'Auto,2,3,5,9,X' && f0.seg[0].p === 'true' && f0.seg.slice(1).every(b => b.p === 'false'), f0);
  check('opened row: select "andere" with 4/6/7/8, and "Als Hauptjob"', f0 && f0.opts.join() === 'andere,4,6,7,8' && f0.sel === '' && f0.btns.map(b => b.t).join() === 'Als Hauptjob', f0);
  check('390 touch: every control >= 44px tall, number buttons >= 44px wide, inside the card', f0 && f0.seg.every(b => b.h >= 44 && b.w >= 44) && f0.selH >= 44 && f0.btns.every(b => b.h >= 44) && f0.inside, f0);
  check('group label names job and villager', f0 && f0.group === 'Festlegen: Handwerk für Godric', f0 && f0.group);
  await openRow(A.page, 'w_edda|cooking');
  const fe = await fixInfo(A.page, 'w_edda|cooking');
  check('the app\'s own main row offers "Hauptjob festhalten"', fe && fe.btns.map(b => b.t).join() === 'Hauptjob festhalten', fe && fe.btns);

  // TEST: lock Godric → Handwerk on A; B sees it within about 1 s.
  const t0 = Date.now();
  await tapFix(A.page, 'w_godric|crafting', 'main');
  const pG = { w_godric: { lockMain: 'crafting', pins: {} } };
  check('A: Godric is crafter at once, badge 1 with "fest"', (await subOf(A.page, 'w_godric')) === 'Hauptjob: Handwerk' && (await domVals(A.page))['w_godric|crafting'] === 1 && (await fixedKeys(A.page)).includes('w_godric|crafting'));
  check('A: plan = compute with the lock', deq(await domVals(A.page), plan(pG)));
  const tA = await toastState(A.page);
  check('A: toast "Godric: Hauptjob Handwerk festgelegt." with Rückgängig', tA.msg === 'Godric: Hauptjob Handwerk festgelegt.' && tA.act === 'Rückgängig', tA);
  check('A: focus moves to "Hauptjob lösen" in the same row', await A.page.evaluate(() => document.activeElement && document.activeElement.dataset.fix === 'unlock' && document.activeElement.textContent === 'Hauptjob lösen'));
  const wantNote = T.compute(clone(ws), s0, { calm: true, anchor: snap, prefs: pG }).notes.find(x => x.text.startsWith('Eure Festlegungen'));
  check('A: the cost note is shown', !!wantNote && (await notesText(A.page)).includes(wantNote.text), { want: wantNote, got: await notesText(A.page) });
  const dB = await until(async () => (await subOf(B.page, 'w_godric')) === 'Hauptjob: Handwerk', 3000);
  const seenB = dB < 0 ? -1 : Date.now() - t0;
  info.push(`B saw the lock ${seenB} ms after the tap on A (300 ms debounce + fake server)`);
  check('TEST: a second phone sees the fix within about 1 s', dB >= 0 && seenB <= 1200, seenB);
  check('server: prefs/w_godric = {lockMain: crafting, pins: {}} (one write)', deq(srv.prefs.get('w_godric'), pG.w_godric) && prefsLog(srv, 'w_godric').length === 1, [srv.prefs.get('w_godric'), prefsLog(srv, 'w_godric').length]);
  await until(async () => (await subOf(C.page, 'w_godric')) === 'Hauptjob: Handwerk');
  check('B and C (read-only): same plan with the lock', deq(await domVals(B.page), plan(pG)) && deq(await domVals(C.page), plan(pG)));
  await openRow(C.page, 'w_godric|crafting'); await openRow(C.page, 'w_wulfric|research');
  check('read-only: no Festlegen controls, no "Alle Festlegungen lösen", but the "fest" tag', await C.page.evaluate(() => !document.querySelector('#plan-view .fix, #plan-view [data-fix], #plan-view [data-fix-sel]') && !!document.querySelector('#plan-view .pbadge.fixed')));
  check('read-only: why "Hauptjob von euch festgelegt. …"', (await C.page.$eval('#plan-view details[data-key="w_godric|crafting"] .wp-why', e => e.textContent)).startsWith('Hauptjob von euch festgelegt. Fertigkeit Handwerk (Crafting)'));
  const fl = await fixInfo(A.page, 'w_godric|crafting');
  check('locked row: only "Hauptjob lösen"', fl && !fl.seg.length && fl.btns.map(b => b.t).join() === 'Hauptjob lösen' && fl.lbl === 'Hauptjob von euch festgelegt.', fl);
  check('card with fixes: "Alle Festlegungen lösen" under it (editors)', await A.page.evaluate(() => !!document.querySelector('#wp-w_godric .wp-unfix [data-fix="clear"]') && !document.querySelector('#wp-w_edda .wp-unfix')));

  // TEST: Wulfric Forschung = X on B.
  await openRow(B.page, 'w_wulfric|research');
  await tapFix(B.page, 'w_wulfric|research', '0');
  const pW = { ...pG, w_wulfric: { lockMain: null, pins: { research: 0 } } };
  check('B: Wulfric research "aus" with "fest", X pressed, focus kept on X', (await domVals(B.page))['w_wulfric|research'] === 0 && (await fixedKeys(B.page)).includes('w_wulfric|research')
    && await B.page.evaluate(() => document.activeElement.dataset.fix === '0' && document.activeElement.getAttribute('aria-pressed') === 'true'));
  await until(async () => (await domVals(A.page))['w_wulfric|research'] === 0);
  const aW = await domVals(A.page);
  check('A follows: plan = compute with both Festlegungen; someone else covers research', deq(aW, plan(pW)) && Object.entries(aW).some(([k, v]) => k.endsWith('|research') && !k.startsWith('w_wulfric') && v >= 1 && v <= 2), aW);
  check('A: Wulfric is not researcher', !/Forschung/.test(await subOf(A.page, 'w_wulfric')));
  await until(async () => deq(srv.prefs.get('w_wulfric'), pW.w_wulfric));
  check('server: prefs/w_wulfric = {lockMain: null, pins: {research: 0}}', deq(srv.prefs.get('w_wulfric'), pW.w_wulfric), srv.prefs.get('w_wulfric'));

  // Quick taps: 3, then 5 → one write with 5. Then "andere" 7, then Auto (doc removed).
  await openRow(B.page, 'w_agnes|cooking');
  const n0 = prefsLog(srv, 'w_agnes').length;
  // Two taps 120 ms apart (within the 300 ms the save waits).
  await B.page.evaluate(async () => { const q = v => document.querySelector(`#plan-view details[data-key="w_agnes|cooking"] [data-fix="${v}"]`); q('3').click(); await new Promise(r => setTimeout(r, 120)); q('5').click(); });
  await until(async () => srv.prefs.has('w_agnes')); await sleep(300);
  check('two quick taps (3, 5): one write, pin 5', prefsLog(srv, 'w_agnes').length - n0 === 1 && deq(srv.prefs.get('w_agnes'), { lockMain: null, pins: { cooking: 5 } }), prefsLog(srv, 'w_agnes'));
  check('pinned 5: badge 5 with "fest", 5 pressed', (await domVals(B.page))['w_agnes|cooking'] === 5 && (await fixInfo(B.page, 'w_agnes|cooking')).seg.find(b => b.t === '5').p === 'true');
  await B.page.selectOption('#plan-view details[data-key="w_agnes|cooking"] select', '7');
  await until(async () => srv.prefs.get('w_agnes') && srv.prefs.get('w_agnes').pins.cooking === 7);
  const f7 = await fixInfo(B.page, 'w_agnes|cooking');
  check('"andere" 7: pin 7, the select shows it, Auto not pressed', (await domVals(B.page))['w_agnes|cooking'] === 7 && f7.sel === '7' && f7.selOn && f7.seg.every(b => b.p === 'false') && srv.prefs.get('w_agnes').pins.cooking === 7, f7);
  // Picking "andere" itself changes nothing: the select keeps showing the saved 7.
  await B.page.selectOption('#plan-view details[data-key="w_agnes|cooking"] select', ''); await B.page.waitForTimeout(150);
  const fA = await fixInfo(B.page, 'w_agnes|cooking');
  check('"andere" alone: nothing changes, the select still shows 7', fA.sel === '7' && fA.selOn && (await domVals(B.page))['w_agnes|cooking'] === 7, fA);
  const why7 = await B.page.$eval('#plan-view details[data-key="w_agnes|cooking"] .wp-why', e => e.textContent);
  check('pinned why: "Von euch festgelegt. Die App würde … vorschlagen: …"', /^Von euch festgelegt\. Die App würde (\d|„aus“) vorschlagen: .+/.test(why7), why7);
  await tapFix(B.page, 'w_agnes|cooking', 'auto');
  await until(async () => !srv.prefs.has('w_agnes'));
  check('TEST: Auto removes the pin (doc deleted, plan without it)', !srv.prefs.has('w_agnes') && prefsLog(srv, 'w_agnes').slice(-1)[0].op === 'delete' && deq(await domVals(B.page), plan(pW)));

  // Table view on A: the reason box has the same controls.
  await A.page.click('[data-view="table"]'); await A.page.waitForTimeout(150);
  await A.page.click('[data-cell="w_wulfric|research"]'); await A.page.waitForTimeout(100);
  const r0 = await A.page.evaluate(() => ({ text: document.getElementById('reason-text').textContent, live: document.getElementById('reason-text').getAttribute('aria-live'), fix: !!document.querySelector('#reason-fix .fix-seg'), pressed: (document.querySelector('#reason-fix [aria-pressed="true"]') || {}).textContent, cellFixed: document.querySelector('[data-cell="w_wulfric|research"]').classList.contains('fixed'), label: document.querySelector('[data-cell="w_wulfric|research"]').getAttribute('aria-label') }));
  check('table: reason box shows "(fest)", the why and the controls (X pressed); the cell has "fest"', r0.text.includes('Wulfric · Forschung: aus (fest)') && r0.text.includes('Von euch festgelegt.') && r0.fix && r0.pressed === 'X' && r0.cellFixed && r0.live === 'polite' && r0.label.includes('von euch festgelegt'), r0);
  await A.page.click('#reason-fix [data-fix="3"]');
  await until(async () => srv.prefs.get('w_wulfric') && srv.prefs.get('w_wulfric').pins.research === 3);
  const r1 = await A.page.evaluate(() => ({ cell: document.querySelector('[data-cell="w_wulfric|research"]').textContent, focus: document.activeElement.dataset.fix, inBox: document.getElementById('reason-fix').contains(document.activeElement), text: document.getElementById('reason-text').textContent }));
  check('table: tap 3 in the reason box: cell 3, focus stays on 3, server pin 3', r1.cell === '3' && r1.focus === '3' && r1.inBox && r1.text.includes('Priorität 3 (fest)') && srv.prefs.get('w_wulfric').pins.research === 3, r1);
  const pW3 = { ...pG, w_wulfric: { lockMain: null, pins: { research: 3 } } };
  check('table: values = compute', deq(await domVals(A.page), plan(pW3)));
  // Plan as text marks fixed values.
  await A.page.click('#copy-plan'); await A.page.waitForTimeout(100);
  const clip = await A.page.evaluate(() => window.__clip || '');
  check('planText: " (fest)" after fixed values (lock and pin), nowhere else', clip.includes('Handwerk 1 (fest)') && clip.includes('Forschung 3 (fest)') && (clip.match(/\(fest\)/g) || []).length === 2, clip.split('\n').filter(l => l.includes('fest')));
  await A.page.click('[data-view="cards"]'); await A.page.waitForTimeout(150);

  // Eintragen-Modus: the fixed target is shown like any other, tagged "fest".
  await A.page.click(ENTRY_OPEN); await A.page.waitForTimeout(200);
  let seen = null;
  for (let i = 0; i < 8 && !seen; i++) {
    seen = await A.page.evaluate(() => { const c = document.querySelector('#entry-stage .entry-card'); if (!c || c.dataset.wid !== 'w_wulfric') return null; const r = c.querySelector('.er-row[data-job="research"]'); return r ? { to: r.querySelector('.er-to').textContent, fixed: r.querySelector('.er-to').classList.contains('fixed'), label: r.getAttribute('aria-label') } : { none: true }; });
    if (!seen) { await A.page.click('[data-e="skip"]').catch(() => {}); await A.page.waitForTimeout(150); }
  }
  check('Eintragen-Modus: the pinned target (3) with the "fest" tag', seen && seen.to === '3' && seen.fixed && seen.label.includes('von euch festgelegt'), seen);
  await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(150);

  // "Alle Festlegungen lösen" + Rückgängig on A (Wulfric).
  await A.page.click('#wp-w_wulfric .wp-unfix [data-fix="clear"]');
  const tc = await toastState(A.page);
  check('"Alle Festlegungen lösen": toast with Rückgängig', tc.msg === 'Alle Festlegungen für Wulfric gelöst.' && tc.act === 'Rückgängig', tc);
  check('...focus goes to the card heading', await A.page.evaluate(() => document.activeElement && document.activeElement.dataset.focus === 'h:w_wulfric'));
  await until(async () => !srv.prefs.has('w_wulfric'));
  check('...doc deleted, plan = only Godric\'s lock', !srv.prefs.has('w_wulfric') && deq(await domVals(A.page), plan(pG)));
  await A.page.click('#toast .toast-act');
  await until(async () => srv.prefs.has('w_wulfric'));
  check('Rückgängig: Wulfric\'s pin is back on the server and in the plan', deq(srv.prefs.get('w_wulfric'), pW3.w_wulfric) && deq(await domVals(A.page), plan(pW3)));
  await until(async () => (await domVals(B.page))['w_wulfric|research'] === 3);

  // Hauptjob lösen on B, Rückgängig.
  await openRow(B.page, 'w_godric|crafting');
  await tapFix(B.page, 'w_godric|crafting', 'unlock');
  await until(async () => !srv.prefs.has('w_godric'));
  check('Hauptjob lösen: doc deleted, Godric back to the app\'s choice, focus on "Hauptjob festhalten"/"Als Hauptjob"',
    !srv.prefs.has('w_godric') && deq(await domVals(B.page), plan({ w_wulfric: pW3.w_wulfric })) && await B.page.evaluate(() => document.activeElement.dataset.fix === 'main'));
  await B.page.click('#toast .toast-act');
  await until(async () => srv.prefs.has('w_godric'));
  check('Rückgängig brings the lock back', deq(srv.prefs.get('w_godric'), pG.w_godric));
  await until(async () => (await subOf(A.page, 'w_godric')) === 'Hauptjob: Handwerk');

  // An older tab (before this build) saves Godric with set(): the prefs doc is not touched.
  {
    const D = await phone(browser, srv, { name: 'D-old', inClaude: true, writable: true, user: { id: 'u_lena', owner: false, can: true } }, { file: 'old-page.html', hash: '#arbeiter' });
    await D.page.fill('#w_godric-cur-cooking', '2'); await D.page.waitForTimeout(900);
    check('older tab rewrites the worker doc: prefs untouched, the lock still shows on A', srv.workers.get('w_godric').stats.cooking.cur === 2 && deq(srv.prefs.get('w_godric'), pG.w_godric) && (await subOf(A.page, 'w_godric')) === 'Hauptjob: Handwerk');
    await D.ctx.close();
  }

  // Delete Godric (with his lock) on A, then Rückgängig: the same id, the same prefs.
  await A.page.click('#tab-arbeiter');
  const del = A.page.locator('[data-wid="w_godric"] [data-act="del"]');
  await del.click(); await A.page.waitForTimeout(500); await del.click();
  await until(async () => !srv.prefs.has('w_godric') && !srv.workers.has('w_godric'));
  check('delete: worker and prefs doc gone', !srv.prefs.has('w_godric') && !srv.workers.has('w_godric'));
  await A.page.click('#toast .toast-act');
  await until(async () => srv.prefs.has('w_godric') && srv.workers.has('w_godric'));
  check('Rückgängig: same id back with the same prefs', deq(srv.prefs.get('w_godric'), pG.w_godric) && srv.workers.has('w_godric'));
  await A.page.click('#tab-plan'); await A.page.waitForTimeout(200);
  check('...and the lock shows again', (await subOf(A.page, 'w_godric')) === 'Hauptjob: Handwerk');
  for (const x of [A, B, C]) await x.ctx.close();

  // Loading: the prefs arrive 1.5 s after the rest. The plan waits instead of jumping.
  {
    const E = await phone(browser, srv, { name: 'E', inClaude: true, writable: true, prefsDelay: 1500, user: { id: 'u_owner', owner: true, can: true } });
    const early = await E.page.evaluate(() => ({ view: document.getElementById('plan-view').textContent, cards: document.querySelectorAll('.wp-card').length }));
    check('loading: "Lädt …" until the Festlegungen are there', early.cards === 0 && /Lädt/.test(early.view), early);
    await E.page.evaluate(() => { window.__bumps = 0; new MutationObserver(ms => { for (const m of ms) if (m.target.classList && m.target.classList.contains('bump')) window.__bumps++; }).observe(document.getElementById('plan-view'), { subtree: true, attributes: true, attributeFilter: ['class'] }); });
    await until(async () => (await E.page.evaluate(() => document.querySelectorAll('.wp-card').length)) > 0, 3000);
    await E.page.waitForTimeout(200);
    const ws2 = byOrder([...srv.workers].map(([id, d]) => T.normWorker(id, d)));
    const want = flat(T.compute(clone(ws2), s0, { calm: true, anchor: snap, prefs: Object.fromEntries(srv.prefs) }));
    const late = await E.page.evaluate(() => ({ cards: document.querySelectorAll('.wp-card').length, bumps: window.__bumps }));
    check('loaded: the plan with the Festlegungen, no flashes', late.cards === 7 && late.bumps === 0 && deq(await domVals(E.page), want), late);
    await E.ctx.close();
  }
  // The prefs listener is refused: the plan shows anyway, read-only, without controls.
  {
    const F = await phone(browser, srv, { name: 'F', inClaude: true, writable: true, prefsError: 'not_granted', user: { id: 'u_owner', owner: true, can: true } });
    await F.page.waitForTimeout(400);
    await openRow(F.page, 'w_agnes|cooking');
    const s = await F.page.evaluate(() => ({ cards: document.querySelectorAll('.wp-card').length, status: document.getElementById('status-text').textContent, fix: !!document.querySelector('#plan-view .fix') }));
    check('prefs refused: plan shows (no endless "Lädt …"), read-only, no controls', s.cards === 7 && s.status === 'Nur ansehen' && !s.fix, s);
    await F.ctx.close();
  }
}

async function localFlow(browser) {
  const L = await phone(browser, null, { name: 'L', inClaude: false });
  const P = L.page;
  await openRow(P, 'ex3|crafting');
  check('example team: no Festlegen controls', await P.evaluate(() => !document.querySelector('#plan-view .fix')));
  await P.click('#tab-arbeiter'); await P.click('#adopt-example'); await P.click('#tab-plan'); await P.waitForTimeout(200);
  const ws = byOrder(JSON.parse(await P.evaluate(k => localStorage.getItem(k), LS_KEY)).workers.map(w => T.normWorker(w.id, w)));
  const gid = ws.find(w => w.name === 'Godric').id;
  await openRow(P, `${gid}|crafting`);
  await tapFix(P, `${gid}|crafting`, 'main');
  await P.waitForTimeout(100);
  const ls = JSON.parse(await P.evaluate(k => localStorage.getItem(k), LS_KEY));
  check('local: LS_KEY payload gets a "prefs" map', ls.prefs && deq(ls.prefs[gid], { lockMain: 'crafting', pins: {} }) && Array.isArray(ls.workers) && ls.settings, ls.prefs);
  check('local: plan = compute with the lock', deq(await domVals(P), flat(T.compute(clone(ws), T.defaultSettings(), { calm: true, anchor: {}, prefs: ls.prefs }))));
  await P.reload(); await P.waitForTimeout(500);
  check('local: the lock survives a reload', (await subOf(P, gid)) === 'Hauptjob: Handwerk');
  // An older version saves LS_KEY without prefs: the plan just has none (no crash).
  // Delete + Rückgängig keeps the prefs.
  await P.click('#tab-arbeiter');
  const del = P.locator(`[data-wid="${gid}"] [data-act="del"]`);
  await del.click(); await P.waitForTimeout(500); await del.click(); await P.waitForTimeout(100);
  const gone = JSON.parse(await P.evaluate(k => localStorage.getItem(k), LS_KEY));
  check('local delete: prefs removed with the worker', !gone.prefs[gid] && !gone.workers.some(w => w.id === gid));
  await P.click('#toast .toast-act'); await P.waitForTimeout(100);
  const back = JSON.parse(await P.evaluate(k => localStorage.getItem(k), LS_KEY));
  check('local Rückgängig: prefs back', deq(back.prefs[gid], { lockMain: 'crafting', pins: {} }));
  await L.ctx.close();
}

async function layout(browser) {
  const workers = exampleSeed();
  const prefs = { w_godric: { lockMain: 'crafting', pins: {} }, w_wulfric: { lockMain: null, pins: { research: 0, cooking: 3 } }, w_agnes: { lockMain: null, pins: { crafting: 7 } } };
  for (const [w, h] of [[360, 740], [390, 844], [1280, 900]]) {
    const srv = makeServer({ workers, prefs });
    const X = await phone(browser, srv, { name: 'L' + w, inClaude: true, writable: true, user: { id: 'u_owner', owner: true, can: true } }, { width: w, height: h });
    const P = X.page;
    if (w === 1280) {
      await P.click('[data-view="table"]'); await P.waitForTimeout(150);
      await P.click('[data-cell="w_wulfric|research"]'); await P.waitForTimeout(150);
      await P.evaluate(() => document.getElementById('reason').scrollIntoView({ block: 'center' })); await P.waitForTimeout(200);
      const r = await P.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth, fix: !!document.querySelector('#reason-fix .fix-seg'), h: Math.min(...[...document.querySelectorAll('#reason-fix button')].map(b => b.getBoundingClientRect().height)) }));
      check('1280 table: controls in the reason box, no horizontal scroll', r.fix && r.sw <= r.vw && r.h >= 30, r);
      await P.screenshot({ path: 'pins-1280-table.png' });
      await P.click('[data-view="cards"]'); await P.waitForTimeout(150);
      await openRow(P, 'w_wulfric|cooking');
      await P.evaluate(() => document.getElementById('wp-w_wulfric').scrollIntoView({ block: 'center' })); await P.waitForTimeout(200);
      await P.screenshot({ path: 'pins-1280-cards.png' });
    } else {
      await openRow(P, 'w_wulfric|cooking');
      await P.evaluate(() => document.querySelector('#plan-view details[data-key="w_wulfric|cooking"]').scrollIntoView({ block: 'center' })); await P.waitForTimeout(250);
      const r = await P.evaluate(() => {
        const d = document.querySelector('#plan-view details[data-key="w_wulfric|cooking"]'), card = d.closest('.wp-card').getBoundingClientRect();
        const els = [...d.querySelectorAll('.fix button, .fix select')];
        return { sw: document.documentElement.scrollWidth, vw: innerWidth, minH: Math.min(...els.map(e => e.getBoundingClientRect().height)),
          inside: els.every(e => { const b = e.getBoundingClientRect(); return b.left >= card.left - 0.5 && b.right <= card.right + 0.5; }),
          segRows: new Set([...d.querySelectorAll('.fix-seg button')].map(b => Math.round(b.getBoundingClientRect().top))).size,
          tags: document.querySelectorAll('#plan-view .pbadge.fixed').length };
      });
      check(`${w}: no horizontal scroll, controls >= 44px and inside the card, the six buttons in one line`, r.sw <= r.vw && r.minH >= 44 && r.inside && r.segRows === 1 && r.tags >= 4, r);
      await P.screenshot({ path: `pins-${w}-row.png` });
      await P.evaluate(() => document.getElementById('wp-w_godric').scrollIntoView({ block: 'start' })); await P.waitForTimeout(200);
      await P.screenshot({ path: `pins-${w}-locked.png` });
    }
    await X.ctx.close();
  }
}

(async () => {
  partA();
  // The copy before this build as an "older tab" page (same wrapper as mk.js).
  const oldBody = fs.readFileSync(OLD, 'utf8');
  fs.writeFileSync(path.join(__dirname, 'old-page.html'), '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>' + oldBody + '</body></html>');
  process.chdir(__dirname);
  const browser = await chromium.launch();
  try {
    await sharedFlow(browser);
    await localFlow(browser);
    await layout(browser);
  } finally { await browser.close(); }
  for (const l of info) console.log('  ' + l);
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-pins: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

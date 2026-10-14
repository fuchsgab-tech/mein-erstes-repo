// BUILD 4 "Ruhiger Plan": calm compute (anchor main jobs, keep ±1 shifts), the checkbox in Einstellungen,
// the "Ruhig gehalten" note, the why texts and "{n} Zahlen ändern" under the other phases.
// Part A runs the planner in node: the constants, hungarian and compute are cut out of the app file (calm-load.js),
// and the copy saved before this build (versions/before-calm.html) is the reference for "calm off = today exactly".
// Part B drives page.html (from mk.js) in Playwright: local mode, and shared mode with phones that share one fake
// server in node (one map and one listener list per collection), user stub with id/isOwner/can/profiles, sample stub.
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const load = require('./calm-load.js');

const APP = path.resolve(__dirname, '../bellwright-arbeitsplan.html');
const OLD = path.resolve(__dirname, '../versions/before-calm.html');
const T = load(APP), O = load(OLD);
const AP_KEY = 'bellwright-arbeitsplan-eingetragen-v1';
const LS_KEY = 'bellwright-arbeitsplan-v1';
const DIR = { u_owner: 'Gabriel', u_lena: 'Lena', u_ro: 'Ida' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 600) : '')); };
const info = [];
const deq = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };

// ---------- planner helpers ----------
const setPhase = (M, s, id) => { const ph = M.PHASES.find(x => x.id === id); s.phase = id; for (const j of M.JOBS) s.jobs[j.id].imp = ph.imp[j.id]; return s; };
const phaseSettings = (M, id) => setPhase(M, M.defaultSettings(), id);
const cv = c => (c.off ? 0 : c.p);
const vals = p => Object.fromEntries(p.team.map(w => [w.id, Object.fromEntries(p.jobs.map(j => [j.id, cv(p.cells[w.id][j.id])]))]));
const flat = p => Object.fromEntries(p.team.flatMap(w => p.jobs.map(j => [`${w.id}|${j.id}`, cv(p.cells[w.id][j.id])])));
// Numbers to change in the game, counted like the Eintragen-Modus: against the snapshot, new villagers from 5.
const changes = (p, snap) => p.team.reduce((n, w) => n + p.jobs.filter(j => {
  const s = snap[w.id]; const from = !s ? 5 : s[j.id] === undefined ? null : s[j.id];
  return from !== cv(p.cells[w.id][j.id]);
}).length, 0);
const openWorkers = (p, snap) => p.team.filter(w => !snap[w.id] || p.jobs.some(j => snap[w.id][j.id] !== cv(p.cells[w.id][j.id]))).length;
const heldCount = p => p.team.reduce((n, w) => n + p.jobs.filter(j => p.cells[w.id][j.id].held).length, 0);
const zahlen = n => `${n} ${n === 1 ? 'Zahl' : 'Zahlen'}`;
const ex = () => clone(T.EXAMPLE);
const OTHER = { start: ['ausbau', 'krieg', 'ausgewogen'] };

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
function variedSettings(M, rep) {   // the same variations as logic.js
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

// =====================================================================================================
// Part A: the planner in node
// =====================================================================================================
function partA() {
  // ---- settings ----
  check('defaultSettings: calm on', T.defaultSettings().calm === true);
  check('normSettings: missing calm counts as on (old tab rewrote settings/main)', T.normSettings({ phase: 'ausbau', growth: 0.5, disableWeak: true, jobs: {} }).calm === true);
  check('normSettings: calm false is kept', T.normSettings({ calm: false }).calm === false);
  check('normSettings: junk calm counts as on', T.normSettings({ calm: 'nein' }).calm === true && T.normSettings(null).calm === true);
  check('STICK is 1.2 score points', T.STICK === 1.2, T.STICK);

  // ---- TEST 1: calm off (and no anchor) deep-equals today's compute, 4 phases on EXAMPLE ----
  const snapStart = vals(O.compute(clone(O.EXAMPLE), phaseSettings(O, 'start')));
  for (const ph of T.PHASES) {
    const want = O.compute(clone(O.EXAMPLE), phaseSettings(O, ph.id));
    const s = phaseSettings(T, ph.id);
    const variants = {
      'compute(w, s)': T.compute(ex(), s),
      'opts {}': T.compute(ex(), s, {}),
      'calm false': T.compute(ex(), s, { calm: false }),
      'calm false + anchor': T.compute(ex(), s, { calm: false, anchor: snapStart }),
      'calm undefined + anchor': T.compute(ex(), s, { anchor: snapStart }),
    };
    for (const [k, got] of Object.entries(variants)) check(`TEST 1 ${ph.id}: ${k} deep-equals the saved compute`, deq(got, want));
  }
  // The same over 840 random teams with varied settings (logic.js), with and without an anchor.
  {
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let runs = 0, bad = [];
    for (let N = 0; N <= 20; N++) for (let rep = 0; rep < 40; rep++) {
      const ws = randomTeam(rnd, T, N);
      const sN = variedSettings(T, rep), sO = variedSettings(O, rep);
      const want = O.compute(clone(ws), sO);
      const anchor = rep % 2 ? vals(want) : {};
      runs++;
      if (!deq(T.compute(clone(ws), sN), want) || !deq(T.compute(clone(ws), sN, { calm: false, anchor }), want)) bad.push(`N=${N} rep=${rep}`);
    }
    check(`TEST 1 fuzz: calm off deep-equals the saved compute (${runs} teams)`, !bad.length, bad.slice(0, 5));
  }

  // ---- TEST 2: snapshot everyone in Start, then switch phase ----
  const target = { ausbau: [4, 40], krieg: [17, 28], ausgewogen: [3, 21] };
  for (const ph of OTHER.start) {
    const s = phaseSettings(T, ph);
    const calmN = changes(T.compute(ex(), s, { calm: true, anchor: snapStart }), snapStart);
    const freshN = changes(T.compute(ex(), s), snapStart);
    info.push(`TEST 2 ${ph}: calm ${calmN} (spec about ${target[ph][0]}), fresh ${freshN} (spec ${target[ph][1]})`);
    check(`TEST 2 ${ph}: about ${target[ph][0]} changes with calm (fresh ${target[ph][1]})`, Math.abs(calmN - target[ph][0]) <= 2 && freshN === target[ph][1], { calmN, freshN });
  }
  // A new group: the Start plan itself was calm (no snapshots, everyone counts as 5).
  {
    const snap0 = vals(T.compute(ex(), phaseSettings(T, 'start'), { calm: true }));
    const parts = [];
    for (const ph of OTHER.start) {
      const s = phaseSettings(T, ph);
      const c = changes(T.compute(ex(), s, { calm: true, anchor: snap0 }), snap0), f = changes(T.compute(ex(), s), snap0);
      parts.push(`${ph} ${c}/${f}`);
      check(`TEST 2b new group, ${ph}: calm changes fewer than fresh`, c < f, { c, f });
    }
    info.push('TEST 2b new group (calm Start, then switch), calm/fresh: ' + parts.join(', '));
  }

  // ---- TEST 3: 49 single "+1 Stufe" edits ----
  for (const [label, snapFn] of [['entered today\'s plan', () => snapStart], ['entered the calm plan', () => vals(T.compute(ex(), T.defaultSettings(), { calm: true }))]]) {
    const s0 = T.defaultSettings(), snap = snapFn();
    const base = T.compute(ex(), s0, { calm: true, anchor: snap });
    const plain0 = T.compute(ex(), s0);
    let edits = 0, flipsCalm = 0, editsFlipFresh = 0, cellsCalm = 0, cellsFresh = 0;
    for (const w of base.team) for (const a of T.ATTRS) {
      const ws = ex(); const st = ws.find(x => x.id === w.id).stats[a.id];
      st.cur += 1; if (st.max !== null && st.max < st.cur) st.max = st.cur;
      const pc = T.compute(ws, s0, { calm: true, anchor: snap }), pf = T.compute(ws, s0);
      edits++;
      flipsCalm += pc.team.filter(x => pc.main[x.id] !== base.main[x.id]).length;
      if (pf.team.some(x => pf.main[x.id] !== plain0.main[x.id])) editsFlipFresh++;
      cellsCalm += changes(pc, snap); cellsFresh += changes(pf, vals(plain0));
    }
    info.push(`TEST 3 (${label}): ${edits} edits, main flips calm ${flipsCalm}, edits with a flip today ${editsFlipFresh}, changed cells per edit calm ${(cellsCalm / edits).toFixed(2)}, today ${(cellsFresh / edits).toFixed(2)}`);
    check(`TEST 3 (${label}): 49 edits, 0 main flips with calm (today ${editsFlipFresh})`, edits === 49 && flipsCalm === 0 && editsFlipFresh >= 1, { edits, flipsCalm, editsFlipFresh });
    check(`TEST 3 (${label}): about 0.5 changed cells per edit`, cellsCalm / edits <= 0.75 && cellsCalm < cellsFresh, { calm: cellsCalm / edits, fresh: cellsFresh / edits });
  }

  // ---- TEST 4: Edda Kochen 3/4, Hilde 9/10: Hilde becomes cook even with calm on ----
  {
    const ws = ex();
    ws.find(x => x.name === 'Edda').stats.cooking = { cur: 3, max: 4 };
    ws.find(x => x.name === 'Hilde').stats.cooking = { cur: 9, max: 10 };
    const hilde = ws.find(x => x.name === 'Hilde').id, edda = ws.find(x => x.name === 'Edda').id;
    check('TEST 4: snapshot has Edda as cook', snapStart[edda].cooking === 1);
    const p = T.compute(ws, T.defaultSettings(), { calm: true, anchor: snapStart });
    check('TEST 4: Hilde becomes cook with calm on', p.main[hilde] === 'cooking' && p.main[edda] !== 'cooking', { hilde: p.main[hilde], edda: p.main[edda] });
  }

  // ---- (a) the anchored main job, (b)(c) STICK and the re-sort, (e) "Bleibt Hauptjob" ----
  {
    // Wulfric Ernten +1: today Godric (Holzfällen -> Herstellung) and Wulfric (Forschung -> Holzfällen) swap.
    const ws = ex(); const wul = ws.find(x => x.name === 'Wulfric'), god = ws.find(x => x.name === 'Godric');
    wul.stats.harvesting.cur += 1;
    const s0 = T.defaultSettings();
    const plain = T.compute(ws, s0);
    check('(a) setup: today the edit flips Godric and Wulfric', plain.main[god.id] !== snapStart[god.id] && plain.main[god.id] !== 'woodcutting' && plain.main[wul.id] !== 'research', { god: plain.main[god.id], wul: plain.main[wul.id] });
    const calmP = T.compute(ws, s0, { calm: true, anchor: snapStart });
    check('(b) calm: both keep the main job that is entered', calmP.main[god.id] === 'woodcutting' && calmP.main[wul.id] === 'research', { god: calmP.main[god.id], wul: calmP.main[wul.id] });
    const BLEIBT = ' Bleibt Hauptjob, weil es schon so im Spiel steht und ein Wechsel kaum etwas bringt.';
    const kept = calmP.team.filter(w => calmP.cells[w.id][calmP.main[w.id]].why.endsWith(BLEIBT)).map(w => w.name).sort();
    check('(e) "Bleibt Hauptjob …" only on the main rows that STICK kept', JSON.stringify(kept) === JSON.stringify(['Godric', 'Wulfric']), kept);
    const quiet = T.compute(ws, s0, { calm: true, anchor: snapStart, explain: false });
    check('(e) explain:false: same numbers, no extra text', deq(flat(quiet), flat(calmP)) && !quiet.team.some(w => quiet.cells[w.id][quiet.main[w.id]].why.includes('Bleibt Hauptjob')));
    // Two jobs on 1 in the game: no anchored main, so the plan moves like today.
    const two = clone(snapStart);
    two[god.id].construction = 1; two[wul.id].cooking = 1;
    const pTwo = T.compute(ws, s0, { calm: true, anchor: two });
    check('(a) two jobs on 1: no head start, main jobs as today', pTwo.main[god.id] === plain.main[god.id] && pTwo.main[wul.id] === plain.main[wul.id], { god: pTwo.main[god.id], wul: pTwo.main[wul.id] });
    // A second 1 on a switched-off job does not count: still exactly one switched-on job on 1.
    const offOne = clone(snapStart);
    offOne[god.id].caravan = 1; offOne[wul.id].caravan = 1;   // Karawane is off by default
    const pOff = T.compute(ws, s0, { calm: true, anchor: offOne });
    check('(a) a 1 on a switched-off job is ignored', pOff.main[god.id] === 'woodcutting' && pOff.main[wul.id] === 'research', { god: pOff.main[god.id], wul: pOff.main[wul.id] });
    // The anchored job switched off: no head start for it, no crash.
    const sOff = T.defaultSettings(); sOff.jobs.woodcutting.on = false;
    const pJobOff = T.compute(ws, sOff, { calm: true, anchor: snapStart });
    check('(a) anchored job switched off: planned without it', pJobOff.main[god.id] !== 'woodcutting' && !pJobOff.jobs.some(j => j.id === 'woodcutting'));
    // (c) Agnes Ernten -> Holzfällen today (same skill, Ausbau). With her Ernten entered she keeps it.
    const agnes = ex().find(x => x.name === 'Agnes').id;
    const sA = phaseSettings(T, 'ausbau');
    const fresh = T.compute(ex(), sA), calmA = T.compute(ex(), sA, { calm: true, anchor: snapStart });
    check('(c) same-skill swap: today Agnes goes to Holzfällen, calm keeps Ernten', fresh.main[agnes] === 'woodcutting' && calmA.main[agnes] === 'harvesting', { fresh: fresh.main[agnes], calm: calmA.main[agnes] });
  }

  // ---- (c) review fix: two workers with the same job of a same-skill group on 1 in the game, one place ----
  // The assignment ties between them (both get the head start), so it used to depend on unrelated rows of the
  // cost matrix: ticking off someone else could flip it and reopen a villager who was done. Now the better
  // worker keeps it, whoever else is ticked off (and the same as the plain plan's choice).
  {
    const mk = (id, st) => T.normWorker(id, { name: id, role: 'worker', order: +id.slice(1), stats: Object.fromEntries(T.ATTRS.map(a => [a.id, st[a.id] ? { cur: st[a.id][0], max: st[a.id][1] } : { cur: 1, max: 2 }])) });
    const extra = ['cooking', 'harvesting', 'farming', 'researching'];
    const ws = [mk('w1', { crafting: [5, 7] }), mk('w2', { crafting: [7, 9] }), ...extra.map((a, i) => mk('w' + (i + 3), { [a]: [6, 8] }))];
    const s = phaseSettings(T, 'krieg');
    const plain = T.compute(ws, s);
    const seen = new Set();
    for (let mask = 0; mask < 16; mask++) {
      const anchor = { w1: { crafting: 1, smelting: 3 }, w2: { crafting: 1, smelting: 3 } };
      ws.slice(2).forEach((w, i) => { if (mask & (1 << i)) anchor[w.id] = vals(plain)[w.id]; });
      const p = T.compute(ws, s, { calm: true, anchor });
      seen.add(p.main.w1 + '/' + p.main.w2);
    }
    check('(c) both on Herstellung 1, one place: the better crafter keeps it, whoever else is ticked off', seen.size === 1 && seen.has('smelting/crafting') && plain.main.w2 === 'crafting', [...seen]);
  }
  // Sequential ticking (Eintragen-Modus): the team entered in one phase, then another phase, villagers ticked
  // off one at a time in roster order. A villager who is done never reopens because someone else was ticked off.
  {
    let seed = 4242; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let reopen = 0, ticks = 0; const where = [];
    for (let it = 0; it < 120; it++) {
      const N = 5 + Math.floor(rnd() * 16), ws = [];
      for (let i = 0; i < N; i++) {
        const stats = {};
        for (const a of T.ATTRS) { const c = Math.floor(rnd() * 8); stats[a.id] = { cur: c, max: Math.min(10, c + Math.floor(rnd() * 5)) }; }
        ws.push(T.normWorker('w' + i, { name: 'W' + i, role: 'worker', traits: ['', '', 'Prodigy', 'Slacker', 'Tireless'][Math.floor(rnd() * 5)], stats, order: i }));
      }
      for (const A of T.PHASES) for (const B of T.PHASES) {
        if (A === B) continue;
        const pA = T.compute(ws, phaseSettings(T, A.id), { calm: true, anchor: {} });
        const anchor = vals(pA), sB = phaseSettings(T, B.id);
        for (const w0 of pA.team) {
          const p = T.compute(ws, sB, { calm: true, anchor, explain: false });
          if (deq(anchor[w0.id], vals(p)[w0.id])) continue;
          anchor[w0.id] = vals(p)[w0.id]; ticks++;
          const q = T.compute(ws, sB, { calm: true, anchor, explain: false }), vp = vals(p), vq = vals(q);
          for (const x of q.team) if (x.id !== w0.id && deq(anchor[x.id], vp[x.id]) && !deq(vq[x.id], vp[x.id])) { reopen++; if (where.length < 3) where.push(`it=${it} ${A.id}->${B.id} ${w0.id} reopened ${x.id}`); }
        }
      }
    }
    check(`sequential ticking: nobody who is done reopens (${ticks} ticks)`, reopen === 0, where);
  }

  // ---- (d) hysteresis texts and rules, (f) the note ----
  {
    const s = phaseSettings(T, 'ausbau');
    const p = T.compute(ex(), s, { calm: true, anchor: snapStart });
    const held = [];
    for (const w of p.team) for (const j of p.jobs) { const c = p.cells[w.id][j.id]; if (c.held) held.push({ w, j, c }); }
    check('(d) some cells are held after Start -> Ausbau', held.length > 0, held.length);
    const textOk = held.every(({ w, j, c }) => c.why.endsWith(` Rechnerisch ${c.ideal}, im Spiel steht ${c.p} – zu wenig Unterschied, um es umzustellen.`) && c.p === snapStart[w.id][j.id]);
    check('(d) held: "Rechnerisch {p}, im Spiel steht {a} – …" and the value is the entered one', textOk, held.slice(0, 2).map(h => h.c));
    const n = heldCount(p);
    const note = p.notes.find(x => x.text.startsWith('Ruhig gehalten:'));
    check('(f) note "Ruhig gehalten: {n} Zahlen bleiben wie im Spiel, …"', note && note.sev === 'info' && note.text === `Ruhig gehalten: ${n} Zahlen bleiben wie im Spiel, weil sich kaum etwas ändern würde.`, note);
    // No snapshot: everyone counts as 5 (new villagers), with its own text.
    const pNew = T.compute(ex(), s, { calm: true });
    const heldNew = pNew.team.flatMap(w => pNew.jobs.map(j => pNew.cells[w.id][j.id]).filter(c => c.held));
    check('(d) no snapshot: held at 5 with the new-villager text', heldNew.length > 0 && heldNew.every(c => c.p === 5 && Math.abs(c.ideal - 5) === 1 && c.why.endsWith(` Rechnerisch ${c.ideal}. Neue Dorfbewohner stehen auf 5 – der kleine Unterschied lohnt das Umstellen nicht.`)), heldNew.slice(0, 2));
    // One held number: singular.
    const one = T.compute(ex(), s, { calm: true, anchor: snapStart });
    // build an anchor that holds exactly one cell: the plain Ausbau plan with one held candidate moved by one
    const plainA = T.compute(ex(), s), snapOne = vals(plainA);
    const cand = plainA.team.flatMap(w => plainA.jobs.map(j => ({ w, j, c: plainA.cells[w.id][j.id] }))).find(x => !x.c.main && !x.c.side && !x.c.off && !x.c.weak && x.c.p >= 4 && x.c.p <= 8);
    snapOne[cand.w.id][cand.j.id] = cand.c.p + 1;
    const pOne = T.compute(ex(), s, { calm: true, anchor: snapOne });
    check('(f) one held number: "1 Zahl bleibt"', heldCount(pOne) === 1 && pOne.notes.some(x => x.text === 'Ruhig gehalten: 1 Zahl bleibt wie im Spiel, weil sich kaum etwas ändern würde.'), pOne.notes.map(x => x.text));
    check('(f) no note with calm off', !T.compute(ex(), s).notes.some(x => x.text.startsWith('Ruhig')) && one.notes.length >= 1);
    // A job newer than the snapshot (switched back on): no value, so never held. 0/1/2 never held.
    const snapNoRes = clone(snapStart);
    for (const w of Object.keys(snapNoRes)) delete snapNoRes[w].research;
    const pNoRes = T.compute(ex(), s, { calm: true, anchor: snapNoRes });
    check('(d) job missing from the snapshot: never held', pNoRes.team.every(w => !pNoRes.cells[w.id].research.held));
    const snapLow = clone(snapStart);
    for (const w of Object.keys(snapLow)) for (const j of Object.keys(snapLow[w])) if (snapLow[w][j] >= 3) snapLow[w][j] = 2;
    const pLow = T.compute(ex(), s, { calm: true, anchor: snapLow });
    check('(d) snapshot values 0/1/2 are never held', heldCount(pLow) === 0, heldCount(pLow));
    // Values for removed or unknown jobs and junk are ignored.
    const junk = clone(snapStart);
    for (const w of Object.keys(junk)) { junk[w].oldjob = 3; junk[w].x = 'y'; }
    junk.nobody = { construction: 1 };
    check('(edge) unknown jobs, unknown workers and junk in the snapshot are ignored', deq(flat(T.compute(ex(), s, { calm: true, anchor: junk })), flat(p)));
  }

  // ---- fuzz: invariants with calm on random anchors ----
  {
    let seed = 13; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const bad = []; let runs = 0, totCalm = 0, totFresh = 0, notFixed = 0;
    for (let N = 1; N <= 18; N++) for (let rep = 0; rep < 30; rep++) {
      const ws = randomTeam(rnd, T, N);
      const s = variedSettings(T, rep);
      const prev = variedSettings(T, rep + 1 + (rep % 3));
      // Anchor: what was entered for another phase, some workers never entered, sometimes random values.
      const anchor = vals(T.compute(ws, prev));
      for (const id of Object.keys(anchor)) {
        if (rnd() < 0.15) delete anchor[id];
        else if (rnd() < 0.1) for (const j of Object.keys(anchor[id])) anchor[id][j] = Math.floor(rnd() * 10);
      }
      const p = T.compute(ws, s, { calm: true, anchor });
      runs++;
      for (const w of p.team) {
        const ones = p.jobs.filter(j => p.cells[w.id][j.id].p === 1 && !p.cells[w.id][j.id].off).length;
        if (ones !== 1) bad.push(`N=${N} rep=${rep} ${w.name} has ${ones} ones`);
        for (const j of p.jobs) {
          const c = p.cells[w.id][j.id];
          if (!c.off && (c.p < 1 || c.p > 9 || !Number.isInteger(c.p))) bad.push(`bad p ${c.p}`);
          if (!c.why) bad.push(`no why ${j.id}`);
          if (c.held) {
            const a = anchor[w.id] ? anchor[w.id][j.id] : 5;
            if (c.main || c.side || c.off || c.weak || c.cover || c.p !== a || c.p < 3 || c.p > 9 || Math.abs(c.ideal - c.p) !== 1 || c.ideal < 2) bad.push(`bad hold N=${N} rep=${rep} ${j.id} ${JSON.stringify(c)} a=${a}`);
          }
        }
      }
      if (p.team.length >= 3) for (const j of p.jobs) if (!(j.id === 'delivery' && p.team.length < 5) && s.jobs[j.id].imp >= 2 && !p.team.some(w => { const c = p.cells[w.id][j.id]; return !c.off && c.p <= ((s.jobs[j.id].imp >= 4 || j.id === 'research') ? 2 : 3); })) bad.push(`N=${N} rep=${rep} job ${j.id} uncovered`);
      const n = heldCount(p), note = p.notes.find(x => x.text.startsWith('Ruhig gehalten:'));
      if (n ? !note || !note.text.startsWith(`Ruhig gehalten: ${zahlen(n)} `) : !!note) bad.push(`note count N=${N} rep=${rep}`);
      // Ticking the calm plan and planning again changes nothing (no endless "geändert").
      const after = vals(p);
      if (changes(T.compute(ws, s, { calm: true, anchor: after }), after)) notFixed++;
      totCalm += changes(p, anchor); totFresh += changes(T.compute(ws, s), anchor);
    }
    check(`fuzz: one 1 per worker, coverage kept, holds valid, note counts right (${runs} teams)`, !bad.length, bad.slice(0, 5));
    check('fuzz: after ticking the calm plan, planning again changes nothing', notFixed === 0, notFixed);
    check('fuzz: calm changes fewer numbers overall', totCalm < totFresh, { totCalm, totFresh });
    info.push(`fuzz: ${runs} teams, numbers to change calm ${totCalm} vs fresh ${totFresh}`);
  }
}

// =====================================================================================================
// Part B: the page
// =====================================================================================================
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
// cfg: { name, inClaude, writable, ingameDelay, ingameError, user: null | { id, owner, can }, dir }
function STUB(cfg) {
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
        // refused after the list arrived
        if (c === 'ingame' && cfg.ingameError) { setTimeout(() => err && err({ code: cfg.ingameError, message: 'refused' }), 300); return () => {}; }
        list(colL, c).push(n);
        window.__srvRead(c).then(docs => setTimeout(() => n(snapC(docs)), c === 'ingame' ? (cfg.ingameDelay || 0) : 0));
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
async function phone(browser, srv, cfg, { width = 390, height = 844, hash = '#plan' } = {}) {
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
  await page.goto('file://' + process.cwd() + '/page.html' + hash);
  await page.waitForTimeout(500);
  return { ctx, page };
}
async function until(fn, max = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(40); }
  return -1;
}
// Shown plan values ('aus' -> 0) from cards or table, keyed "wid|job".
const domVals = page => page.evaluate(() => {
  const o = {};
  for (const b of document.querySelectorAll('#plan-view .pbadge[data-k], #plan-view [data-cell]')) { const k = b.dataset.k || b.dataset.cell; const t = b.textContent.trim(); o[k] = t === 'aus' ? 0 : +t; }
  return o;
});
const phaseTexts = (page, panel = '#panel-plan') => page.evaluate(sel => Object.fromEntries([...document.querySelectorAll(sel + ' .phase-seg button[data-phase]')].map(b => [b.dataset.phase, { small: b.querySelector('small').textContent, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, cost: b.querySelector('small').classList.contains('cost') }])), panel);
const notesText = page => page.evaluate(() => [...document.querySelectorAll('#notes li')].map(l => l.textContent));
const chgCount = page => page.evaluate(() => document.querySelectorAll('#plan-view .pbadge.chg, #plan-view .cell.chg').length);
const readLs = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), k);
// The page plans in roster order (sortedWorkers); so does the expectation.
const byOrder = ws => [...ws].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
const SUBS = Object.fromEntries(T.PHASES.map(p => [p.id, p.sub]));
// Expected "{n} Zahlen ändern" for the phases other than `active`.
function expectedCosts(ws, settings, applied) {
  const out = {};
  for (const p of T.PHASES) {
    if (p.id === settings.phase) continue;
    const s = clone(settings); setPhase(T, s, p.id);
    out[p.id] = `${zahlen(changes(T.compute(clone(ws), s, { calm: !!settings.calm, anchor: applied }), applied))} ändern`;
  }
  return out;
}
const costTexts = pt => Object.fromEntries(Object.entries(pt).filter(([, v]) => v.cost || /ändern$/.test(v.small)).map(([k, v]) => [k, v.small]));

async function localFlow(browser) {
  const L = await phone(browser, null, { name: 'L', inClaude: false });
  const P = L.page;
  // Example team: calm, but no anchor (everyone counts as 5); no costs.
  const exVals = await domVals(P);
  const exWant = Object.fromEntries(Object.entries(flat(T.compute(ex(), T.defaultSettings(), { calm: true }))));
  check('local example: plan = calm compute without anchor', deq(exVals, exWant), { got: Object.keys(exVals).length });
  check('local example: not the same as today (calm holds 4/6 at 5)', !deq(exVals, flat(O.compute(clone(O.EXAMPLE), O.defaultSettings()))));
  let pt = await phaseTexts(P);
  check('local example: phase buttons keep their short texts', Object.entries(pt).every(([k, v]) => v.small === SUBS[k] && !v.cost), pt);
  check('local example: note "Ruhig gehalten: …"', (await notesText(P)).some(t => /^Ruhig gehalten: \d+ Zahlen bleiben wie im Spiel, weil sich kaum etwas ändern würde\.$/.test(t)));
  // Einstellungen: the checkbox.
  await P.click('#tab-jobs');
  const opt = await P.evaluate(() => {
    const cb = document.getElementById('opt-calm'), lab = cb.closest('label');
    const r = lab.getBoundingClientRect();
    return { checked: cb.checked, disabled: cb.disabled, strong: lab.querySelector('strong').textContent, small: lab.querySelector('small').textContent, h: r.height, inRechenweise: [...document.querySelectorAll('#panel-jobs section')].find(s => s.contains(cb)).querySelector('h2').textContent, forOk: lab.htmlFor === 'opt-calm' };
  });
  check('Einstellungen → Rechenweise: checkbox "Plan ruhig halten", on by default', opt.checked && !opt.disabled && opt.strong === 'Plan ruhig halten' && opt.inRechenweise === 'Rechenweise' && opt.forOk, opt);
  check('checkbox small text (ihr)', opt.small === 'Kleine Verschiebungen um eins werden nicht umgestellt, und Hauptjobs wechseln nur, wenn es sich deutlich lohnt. So müsst ihr im Spiel weniger umstellen.', opt.small);
  check('checkbox label is a tap target >= 44px', opt.h >= 44, opt.h);
  const ptJobs = await phaseTexts(P, '#panel-jobs');
  check('Einstellungen phase buttons: short texts', Object.entries(ptJobs).every(([k, v]) => v.small === SUBS[k]), ptJobs);
  // Adopt the example: no snapshot yet -> no costs. Tick everyone -> costs.
  await P.click('#tab-arbeiter'); await P.click('#adopt-example'); await P.click('#tab-plan'); await P.waitForTimeout(250);
  pt = await phaseTexts(P);
  check('adopted, nothing entered: no costs yet', Object.entries(pt).every(([k, v]) => v.small === SUBS[k]), pt);
  const ws = byOrder((await readLs(P, LS_KEY)).workers);
  check('adopted: plan = calm compute with the (empty) tick-off', deq(await domVals(P), flat(T.compute(clone(ws), T.defaultSettings(), { calm: true, anchor: {} }))));
  await P.click('#mark-all'); await P.waitForTimeout(250);
  let applied = await readLs(P, AP_KEY);
  pt = await phaseTexts(P);
  const want = expectedCosts(ws, T.defaultSettings(), applied);
  check('ticked: "{n} Zahlen ändern" under each other phase, the active one keeps its text', deq(costTexts(pt), want) && pt.start.small === SUBS.start && pt.start.pressed === 'true', { pt, want });
  info.push('local, new group after ticking Start: ' + JSON.stringify(costTexts(pt)));
  check('costs in ember only when > 0', Object.entries(pt).every(([k, v]) => k === 'start' || v.cost === !/^0 /.test(v.small)), pt);
  await P.click('#tab-jobs');
  check('Einstellungen phase buttons still show the short texts', Object.entries(await phaseTexts(P, '#panel-jobs')).every(([k, v]) => v.small === SUBS[k]));
  await P.click('#tab-plan'); await P.waitForTimeout(100);
  // Switch to Ausbau: the cost shown before is what is now open.
  const costAusbau = +pt.ausbau.small.split(' ')[0];
  await P.click('#panel-plan [data-phase="ausbau"]'); await P.waitForTimeout(250);
  const sA = phaseSettings(T, 'ausbau');
  const pA = T.compute(clone(ws), sA, { calm: true, anchor: applied });
  check('Ausbau: plan = calm compute with the tick-off as anchor', deq(await domVals(P), flat(pA)));
  check('Ausbau: changed numbers = the cost shown before', (await chgCount(P)) === costAusbau && changes(pA, applied) === costAusbau, { chg: await chgCount(P), costAusbau });
  const label = await P.$eval('#entry-open', e => e.textContent);
  check('Ausbau: "Im Spiel eintragen (n offen)" matches', label === `Im Spiel eintragen (${openWorkers(pA, applied)} offen)`, label);
  pt = await phaseTexts(P);
  check('after switching: Start now shows its cost, Ausbau its short text', /ändern$/.test(pt.start.small) && pt.ausbau.small === SUBS.ausbau, pt);
  const n = heldCount(pA);
  check('Ausbau: note with the held count', (await notesText(P)).includes(`Ruhig gehalten: ${zahlen(n)} ${n === 1 ? 'bleibt' : 'bleiben'} wie im Spiel, weil sich kaum etwas ändern würde.`), await notesText(P));
  // A held row explains itself.
  const h = pA.team.flatMap(w => pA.jobs.map(j => ({ w, j, c: pA.cells[w.id][j.id] }))).find(x => x.c.held);
  if (h) {
    await P.click(`#plan-view details[data-key="${h.w.id}|${h.j.id}"] summary`);
    const why = await P.$eval(`#plan-view details[data-key="${h.w.id}|${h.j.id}"] .wp-why`, e => e.textContent);
    check('held row: why says "Rechnerisch {p}, im Spiel steht {a} – …"', why.endsWith(`Rechnerisch ${h.c.ideal}, im Spiel steht ${h.c.p} – zu wenig Unterschied, um es umzustellen.`), why);
  } else check('Ausbau has a held cell to look at', false);
  await P.screenshot({ path: 'calm-390-plan.png' });
  // Uncheck: today's plan exactly, costs follow.
  await P.click('#tab-jobs'); await P.click('label[for="opt-calm"]'); await P.waitForTimeout(150);
  await P.screenshot({ path: 'calm-390-settings.png' });
  const lsOff = await readLs(P, LS_KEY);
  check('unticked: saved as calm false', lsOff.settings.calm === false, lsOff.settings.calm);
  await P.click('#tab-plan'); await P.waitForTimeout(150);
  check('unticked: plan = today\'s compute exactly', deq(await domVals(P), flat(O.compute(clone(ws), setPhase(O, O.defaultSettings(), 'ausbau')))));
  check('unticked: no "Ruhig gehalten" note', !(await notesText(P)).some(t => t.startsWith('Ruhig')));
  check('unticked: costs counted without calm', deq(costTexts(await phaseTexts(P)), expectedCosts(ws, { ...sA, calm: false }, applied)));
  // Reload keeps it off; a payload without the field (older version) counts as on.
  await P.reload(); await P.waitForTimeout(500);
  check('reload: still off', !(await P.$eval('#opt-calm', e => e.checked)));
  await P.evaluate(k => { const d = JSON.parse(localStorage.getItem(k)); delete d.settings.calm; localStorage.setItem(k, JSON.stringify(d)); }, LS_KEY);
  await P.reload(); await P.waitForTimeout(500);
  check('payload without calm (older version): on', await P.$eval('#opt-calm', e => e.checked));
  check('...and the plan is calm again', deq(await domVals(P), flat(T.compute(clone(ws), sA, { calm: true, anchor: applied }))));
  // Tick everything in Ausbau: nothing open, planning again is stable.
  await P.click('#mark-all'); await P.waitForTimeout(250);
  const before = await domVals(P);
  applied = await readLs(P, AP_KEY);
  check('ticked Ausbau: nothing open, numbers unchanged', (await chgCount(P)) === 0 && await P.$eval('#entry-open', e => e.hidden) && deq(before, flat(T.compute(clone(ws), sA, { calm: true, anchor: applied }))));
  check('390: no horizontal scroll', await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // A value changes on the Arbeiter tab (costs are only worked out while the Plan tab is in view): back on the Plan
  // tab they fit the new values.
  const agnes = ws.find(w => w.name === 'Agnes');
  await P.click('#tab-arbeiter');
  await P.fill(`#${agnes.id}-cur-cooking`, '9'); await P.waitForTimeout(150);
  await P.click('#tab-plan'); await P.waitForTimeout(150);
  const ws2 = byOrder((await readLs(P, LS_KEY)).workers);
  check('Arbeiter tab edit: the stored value changed', ws2.find(w => w.id === agnes.id).stats.cooking.cur === 9);
  check('back on the Plan tab: costs fit the new values', deq(costTexts(await phaseTexts(P)), expectedCosts(ws2, sA, applied)), { got: costTexts(await phaseTexts(P)), want: expectedCosts(ws2, sA, applied) });
  // "Eigene" (a slider moved): all four phases show what they would cost.
  await P.click('#tab-jobs');
  await P.$eval('#imp-cooking', el => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await P.click('#tab-plan'); await P.waitForTimeout(150);
  const sE = clone(sA); sE.phase = 'eigene'; sE.jobs.cooking.imp = 2;
  const ptE = await phaseTexts(P);
  check('phase "Eigene": every preset shows its cost', Object.keys(ptE).length === 5 && ptE.eigene.small === 'von Hand' && deq(costTexts(ptE), expectedCosts(ws2, sE, applied)), ptE);
  await L.ctx.close();
}

function exampleSeed() {
  const ids = {};
  const workers = {};
  T.EXAMPLE.forEach((w, i) => { const id = 'w_' + w.name.toLowerCase(); ids[w.id] = id; workers[id] = { name: w.name, role: w.role, traits: w.traits, order: i + 1, stats: clone(w.stats) }; });
  return { ids, workers };
}

async function sharedFlow(browser) {
  // The group entered today's Start plan before this version (shared tick-off, by Lena two hours ago).
  const { ids, workers } = exampleSeed();
  const ws = byOrder(Object.entries(workers).map(([id, d]) => T.normWorker(id, d)));
  const snap = vals(O.compute(clone(ws), phaseSettings(O, 'start')));
  const at = Date.now() - 2 * 3600e3;
  const ingame = Object.fromEntries(Object.entries(snap).map(([wid, v]) => [wid, { vals: v, by: 'u_lena', at }]));
  const srv = makeServer({ workers, ingame });
  const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: { id: 'u_owner', owner: true, can: true } });
  const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: { id: 'u_lena', owner: false, can: true } });
  const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, user: { id: 'u_ro', owner: false, can: false } }, { width: 360 });
  const s0 = T.defaultSettings();
  const want0 = flat(T.compute(clone(ws), s0, { calm: true, anchor: snap }));
  const [a0, b0, c0] = [await domVals(A.page), await domVals(B.page), await domVals(C.page)];
  check('shared: all phones show the anchored plan', deq(a0, want0) && deq(b0, want0) && deq(c0, want0));
  check('shared: today\'s entered plan stays as it is (0 open)', (await chgCount(A.page)) === 0 && await A.page.$eval('#entry-open', e => e.hidden));
  // TEST 2 in the page: the costs under the phases.
  const ptA = await phaseTexts(A.page);
  const want = expectedCosts(ws, s0, snap);
  check('shared: costs under the other phases = one compute per phase', deq(costTexts(ptA), want), { got: costTexts(ptA), want });
  check('shared: Start → Ausbau 4, Aufrüsten 17, Ausgewogen 3 (spec: about 4/17/3)', ptA.ausbau.small === '4 Zahlen ändern' && ptA.krieg.small === '17 Zahlen ändern' && ptA.ausgewogen.small === '3 Zahlen ändern', costTexts(ptA));
  info.push('shared, today\'s Start entered: ' + JSON.stringify(costTexts(ptA)));
  const ptC = await phaseTexts(C.page);
  check('read-only phone: same costs, phase buttons disabled', deq(costTexts(ptC), want) && Object.values(ptC).every(v => v.disabled), ptC);
  const cOpt = await C.page.evaluate(() => ({ checked: document.getElementById('opt-calm').checked, disabled: document.getElementById('opt-calm').disabled }));
  check('read-only phone: checkbox shown checked but disabled', cOpt.checked && cOpt.disabled, cOpt);
  await C.page.screenshot({ path: 'calm-360-plan.png' });
  check('360: no horizontal scroll, phase texts fit their buttons', await C.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
    && [...document.querySelectorAll('#panel-plan .phase-seg button')].every(b => b.scrollWidth <= b.clientWidth + 1)));
  // A switches to Ausbau: B and C follow with the same anchored plan.
  await A.page.click('#panel-plan [data-phase="ausbau"]');
  await until(async () => (await phaseTexts(B.page)).ausbau.pressed === 'true');
  await B.page.waitForTimeout(150);
  const sA = phaseSettings(T, 'ausbau');
  const wantA = flat(T.compute(clone(ws), sA, { calm: true, anchor: snap }));
  const [a1, b1, c1] = [await domVals(A.page), await domVals(B.page), await domVals(C.page)];
  check('Ausbau on A: every phone shows the same anchored plan', deq(a1, wantA) && deq(b1, wantA) && deq(c1, wantA));
  check('Ausbau: 4 numbers to change on B, as the button said', (await chgCount(B.page)) === 4, await chgCount(B.page));
  const labA = await A.page.$eval('#entry-open', e => e.textContent), labB = await B.page.$eval('#entry-open', e => e.textContent);
  check('Ausbau: the same "(n offen)" on both phones', labA === labB && /\(\d+ offen\)$/.test(labA), [labA, labB]);
  // B ticks everyone: A sees nothing open and the same numbers.
  await B.page.click('#mark-all');
  await until(async () => (await chgCount(A.page)) === 0);
  const a2 = await domVals(A.page);
  check('B ticks all: A has nothing open, numbers unchanged', (await chgCount(A.page)) === 0 && deq(a2, wantA) && deq(await domVals(B.page), wantA));
  check('B ticks all: shared docs hold the shown numbers', [...srv.ingame.entries()].every(([wid, d]) => Object.entries(d.vals).every(([j, v]) => wantA[`${wid}|${j}`] === v)));
  // A turns calm off: saved for everyone, B shows today's plan.
  await A.page.click('#tab-jobs'); await A.page.click('label[for="opt-calm"]');
  await until(async () => srv.settings.get('main') && srv.settings.get('main').calm === false);
  check('A unticks: settings/main.calm = false on the server', srv.settings.get('main') && srv.settings.get('main').calm === false);
  await until(async () => !(await B.page.$eval('#opt-calm', e => e.checked)));
  check('B: checkbox follows', !(await B.page.$eval('#opt-calm', e => e.checked)));
  check('B: plan = today\'s compute', deq(await domVals(B.page), flat(O.compute(clone(ws), setPhase(O, O.defaultSettings(), 'ausbau')))));
  // An older tab rewrites settings/main without the field: on again everywhere.
  const old = clone(srv.settings.get('main')); delete old.calm;
  srv.settings.set('main', old); srv.broadcast('settings');
  await until(async () => await B.page.$eval('#opt-calm', e => e.checked) && await A.page.$eval('#opt-calm', e => e.checked));
  check('older tab drops the field: calm is on again on every phone', await B.page.$eval('#opt-calm', e => e.checked) && await A.page.$eval('#opt-calm', e => e.checked));
  check('...and the plan is calm again', deq(await domVals(B.page), wantA));
  for (const x of [A, B, C]) await x.ctx.close();

  // Loading: the tick-off arrives 1.5 s after the list. The plan waits instead of jumping.
  {
    const D = await phone(browser, srv, { name: 'D', inClaude: true, writable: true, ingameDelay: 1500, user: { id: 'u_owner', owner: true, can: true } });
    const early = await D.page.evaluate(() => ({ view: document.getElementById('plan-view').textContent, cards: document.querySelectorAll('.wp-card').length }));
    check('loading: "Lädt …" until the tick-off is there', early.cards === 0 && /Lädt/.test(early.view), early);
    await D.page.evaluate(() => { window.__bumps = 0; new MutationObserver(ms => { for (const m of ms) if (m.target.classList && m.target.classList.contains('bump')) window.__bumps++; }).observe(document.getElementById('plan-view'), { subtree: true, attributes: true, attributeFilter: ['class'] }); });
    await until(async () => (await D.page.evaluate(() => document.querySelectorAll('.wp-card').length)) > 0, 3000);
    await D.page.waitForTimeout(200);
    const late = await D.page.evaluate(() => ({ cards: document.querySelectorAll('.wp-card').length, bumps: window.__bumps }));
    check('loaded: the anchored plan, no "changed" flashes', late.cards === 7 && late.bumps === 0 && deq(await domVals(D.page), wantA), late);
    await D.ctx.close();
  }
  // The tick-off listener is refused before it delivers: the plan shows anyway (no endless "Lädt …").
  {
    const E = await phone(browser, srv, { name: 'E', inClaude: true, writable: true, ingameError: 'not_granted', user: { id: 'u_owner', owner: true, can: true } });
    await E.page.waitForTimeout(400);
    const s = await E.page.evaluate(() => ({ cards: document.querySelectorAll('.wp-card').length, status: document.getElementById('status-text').textContent, costs: [...document.querySelectorAll('#panel-plan .phase-seg small')].map(x => x.textContent) }));
    check('ingame refused: plan shows without the anchor, read-only', s.cards === 7 && s.status === 'Nur ansehen', s);
    check('ingame refused: plan = calm compute without anchor', deq(await domVals(E.page), flat(T.compute(clone(ws), sA, { calm: true }))));
    await E.ctx.close();
  }
}

async function layout(browser) {
  for (const [w, h] of [[1280, 900], [390, 844], [360, 740]]) {
    const L = await phone(browser, null, { name: 'W' + w, inClaude: false }, { width: w, height: h, hash: '#arbeiter' });
    const P = L.page;
    await P.click('#adopt-example'); await P.click('#tab-plan'); await P.waitForTimeout(200);
    await P.click('#mark-all'); await P.waitForTimeout(150);
    const r = await P.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth,
      fit: [...document.querySelectorAll('#panel-plan .phase-seg button')].every(b => b.scrollWidth <= b.clientWidth + 1),
      minH: Math.min(...[...document.querySelectorAll('#panel-plan .phase-seg button')].map(b => b.getBoundingClientRect().height)),
      costs: [...document.querySelectorAll('#panel-plan .phase-seg small.cost')].length }));
    check(`${w}: costs shown, no horizontal scroll, texts fit, buttons >= 44px`, r.sw <= r.vw && r.fit && r.costs >= 1 && r.minH >= 44, r);
    if (w === 1280) {
      await P.screenshot({ path: 'calm-1280-plan.png' });
      await P.click('#panel-plan [data-phase="ausbau"]'); await P.waitForTimeout(1700);
      await P.click('[data-view="table"]'); await P.waitForTimeout(200);
      // the table's reason box explains a held number
      const held = await P.evaluate(() => { const b = [...document.querySelectorAll('#plan-view [data-cell]')]; return b.map(x => x.dataset.cell); });
      let shown = '';
      for (const k of held) { await P.click(`[data-cell="${k}"]`); shown = await P.$eval('#reason', e => e.textContent); if (shown.includes('Rechnerisch')) break; }
      check('1280 table: the reason box shows the "Rechnerisch …" text for a held number', /Rechnerisch \d, im Spiel steht \d – zu wenig Unterschied, um es umzustellen\./.test(shown), shown.slice(0, 200));
      await P.evaluate(() => document.getElementById('reason').scrollIntoView({ block: 'center' })); await P.waitForTimeout(200);
      await P.screenshot({ path: 'calm-1280-table.png' });
      await P.click('#tab-jobs'); await P.evaluate(() => document.getElementById('opt-calm').scrollIntoView({ block: 'center' })); await P.waitForTimeout(200);
      await P.screenshot({ path: 'calm-1280-settings.png' });
    }
    await L.ctx.close();
  }
}

(async () => {
  partA();
  const browser = await chromium.launch();
  try {
    await localFlow(browser);
    await sharedFlow(browser);
    await layout(browser);
  } finally { await browser.close(); }
  for (const l of info) console.log('  ' + l);
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-calm: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

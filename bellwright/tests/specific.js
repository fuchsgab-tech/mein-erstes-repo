const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/expose.html'); await p.waitForTimeout(200);
  const r = await p.evaluate(() => {
    const T = window.__t; const out = {};
    const setPhase = (s, id) => { const ph = T.PHASES.find(x => x.id === id); s.phase = id; for (const j of T.JOBS) s.jobs[j.id].imp = ph.imp[j.id]; return s; };
    // a) Aufrüsten example: best crafter makes Handwerk
    const s1 = setPhase(T.defaultSettings(), 'krieg');
    const p1 = T.compute(T.EXAMPLE, s1);
    out.krieg = p1.team.map(w => w.name + '=' + p1.main[w.id]).join(', ');
    out.kriegNotes = p1.notes.map(n => n.text);
    // b) research coverage N=3..8 in start/krieg: share of teams without research <=2
    let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const mk = N => Array.from({ length: N }, (_, i) => { const stats = {}; for (const a of T.ATTRS) { const c = Math.floor(rnd() * 11); stats[a.id] = { cur: c, max: Math.min(10, c + Math.floor(rnd() * 5)) }; } return T.normWorker('w' + i, { name: 'W' + i, stats }); });
    const res = {}, haul = {}, swap = {};
    for (const ph of ['start', 'krieg', 'ausgewogen']) for (let N = 3; N <= 10; N++) {
      let noRes = 0, noHaul = 0, badCraft = 0, tot = 200;
      for (let k = 0; k < tot; k++) {
        const ws = mk(N); const pl = T.compute(ws, setPhase(T.defaultSettings(), ph));
        if (!pl.team.some(w => pl.cells[w.id].research.p <= 2)) noRes++;
        if (N >= 5 && !Object.values(pl.main).includes('delivery')) noHaul++;
        const cr = pl.team.filter(w => pl.main[w.id] === 'crafting'), sm = pl.team.filter(w => pl.main[w.id] === 'smelting');
        if (cr.length && sm.length && Math.max(...sm.map(w => w.stats.crafting.cur)) >= Math.min(...cr.map(w => w.stats.crafting.cur)) + 3) badCraft++;
      }
      res[ph + N] = noRes; if (N >= 5) haul[ph + N] = noHaul; swap[ph + N] = badCraft;
    }
    out.noResearch = res; out.noHauler = haul; out.smelterBetter = swap;
    // c) prodigy cap at 100%
    const st = T.defaultSettings(); st.growth = 1;
    const pr = T.compute([T.normWorker('a', { name: 'Pro', traits: 'Prodigy', stats: { cooking: { cur: 2, max: 6 } } }), T.normWorker('b', { name: 'Koch', stats: { cooking: { cur: 6, max: 6 } } }), T.normWorker('c', { name: 'X', stats: { labourer: { cur: 6, max: 7 } } })], st);
    out.prodigy = Object.entries(pr.main).map(([k, v]) => k + '=' + v).join(',');
    // d) main reason texts for example (start)
    const p2 = T.compute(T.EXAMPLE, T.defaultSettings());
    out.whyMain = p2.team.map(w => w.name + ': ' + p2.cells[w.id][p2.main[w.id]].why);
    return out;
  });
  console.log(JSON.stringify(r, null, 1)); console.log('ERRORS', errs); await b.close();
})();

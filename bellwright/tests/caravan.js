const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/expose.html'); await p.waitForTimeout(200);
  const r = await p.evaluate(() => {
    const T = window.__t; const out = {};
    const d = T.defaultSettings(); out.defaultCaravanOn = d.jobs.caravan.on; out.jobsOn = Object.entries(d.jobs).filter(([k, v]) => v.on).length;
    // old stored settings (from v4, no caravan): stays off
    out.oldStored = JSON.stringify(T.normSettings({ phase: 'start', jobs: { construction: { on: true, imp: 5 } } }).jobs.caravan);
    // caravan on, 8 workers incl. a Nomad
    const s = T.defaultSettings(); s.jobs.caravan.on = true; s.jobs.caravan.imp = 4;
    const ws = T.EXAMPLE.slice(0, 7).concat([T.normWorker('n', { name: 'Nomadia', traits: 'Nomad', stats: { labourer: { cur: 2, max: 3 }, cooking: { cur: 2, max: 3 } } })]);
    const pl = T.compute(ws, s);
    out.mains = pl.team.map(w => w.name + '=' + pl.main[w.id]).join(', ');
    const nom = pl.team.find(w => w.name === 'Nomadia');
    out.nomadWhy = pl.cells[nom.id][pl.main[nom.id]].why;
    out.carNonMain = pl.cells[pl.team[0].id].caravan.why;
    // invariants with caravan on, fuzz
    let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; let bad = 0;
    for (let N = 0; N <= 20; N++) for (let k = 0; k < 30; k++) {
      const team = Array.from({ length: N }, (_, i) => { const st = {}; for (const a of T.ATTRS) { const c = Math.floor(rnd() * 11); st[a.id] = { cur: c, max: Math.min(10, c + Math.floor(rnd() * 4)) }; } return T.normWorker('w' + i, { name: 'W' + i, traits: rnd() < 0.2 ? 'Nomad' : '', stats: st }); });
      const ss = T.defaultSettings(); ss.jobs.caravan.on = true; ss.jobs.caravan.imp = 1 + (k % 5);
      const q = T.compute(team, ss);
      for (const w of q.team) { if (q.jobs.filter(j => q.cells[w.id][j.id].p === 1 && !q.cells[w.id][j.id].off).length !== 1) bad++; for (const j of q.jobs) if (!q.cells[w.id][j.id].why) bad++; }
    }
    out.fuzzBad = bad;
    out.parse = T.parseRoster('Anna: Landwirtschaft 4/7, Herstellung 3/6').rows.map(x => JSON.stringify(x.stats));
    return out;
  });
  console.log(JSON.stringify(r, null, 1)); console.log('ERRORS', errs); await b.close();
})();

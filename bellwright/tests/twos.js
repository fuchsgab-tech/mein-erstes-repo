const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + process.cwd() + '/expose.html'); await p.waitForTimeout(200);
  const r = await p.evaluate(() => { const T = window.__t; let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const hist = {}; for (let N = 3; N <= 12; N++) { let tot = 0, cnt = 0, mx = 0; for (let rep = 0; rep < 60; rep++) { const ws = []; for (let i = 0; i < N; i++) { const stats = {}; for (const a of T.ATTRS) { const c = Math.floor(rnd() * 11); stats[a.id] = { cur: c, max: Math.min(10, c + Math.floor(rnd() * 5)) }; } ws.push(T.normWorker('w' + i, { name: 'W' + i, stats })); }
      const st = T.defaultSettings(); const ph = T.PHASES[rep % 3]; st.phase = ph.id; for (const j of T.JOBS) st.jobs[j.id].imp = ph.imp[j.id];
      const pl = T.compute(ws, st); for (const w of pl.team) { const t = pl.jobs.filter(j => pl.cells[w.id][j.id].p === 2).length; tot += t; cnt++; mx = Math.max(mx, t); } } hist[N] = `avg2s=${(tot / cnt).toFixed(2)} max=${mx}`; } return hist; });
  console.log(r); await b.close(); })();

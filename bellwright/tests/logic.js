const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + process.cwd() + '/expose.html');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const T = window.__t;
    const out = {};
    // 1) example plan
    const s = T.defaultSettings();
    const p = T.compute(T.EXAMPLE, s);
    out.example = p.team.map(w => w.name + ' [' + p.main[w.id] + '] ' + p.jobs.map(j => { const c = p.cells[w.id][j.id]; return j.id.slice(0,4) + '=' + (c.off ? 'x' : c.p); }).join(' '));
    out.exampleNotes = p.notes.map(n => n.text);
    // 2) random fuzz
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const problems = [];
    let runs = 0;
    for (let N = 0; N <= 20; N++) for (let rep = 0; rep < 40; rep++) {
      const ws = [];
      for (let i = 0; i < N; i++) {
        const stats = {};
        for (const a of T.ATTRS) { const c = Math.floor(rnd() * 11); const hasMax = rnd() > 0.2; stats[a.id] = { cur: c, max: hasMax ? Math.min(10, c + Math.floor(rnd() * 6)) : null }; }
        const traits = ['', '', '', 'Slacker', 'Neurotic', 'Stalwart', 'Dullard', 'Prodigy', 'Tireless'][Math.floor(rnd() * 9)];
        ws.push(T.normWorker('w' + i, { name: 'W' + i, role: rnd() < 0.1 ? 'guard' : 'worker', traits, stats, order: i }));
      }
      const st = T.defaultSettings();
      const ph = T.PHASES[rep % 4];
      st.phase = ph.id; for (const j of T.JOBS) st.jobs[j.id].imp = ph.imp[j.id];
      if (rep % 7 === 3) st.jobs.research.on = false;
      if (rep % 11 === 5) for (const j of T.JOBS) st.jobs[j.id].on = j.id === 'delivery';
      if (rep % 13 === 6) st.growth = rep % 2 ? 0 : 1;
      if (rep % 5 === 2) st.disableWeak = false;
      const pl = T.compute(ws, st);
      runs++;
      for (const w of pl.team) {
        const ones = pl.jobs.filter(j => pl.cells[w.id][j.id].p === 1 && !pl.cells[w.id][j.id].off).length;
        if (ones !== 1) problems.push(`N=${N} rep=${rep} ${w.name} has ${ones} ones`);
        for (const j of pl.jobs) { const c = pl.cells[w.id][j.id]; if (!c.off && (c.p < 1 || c.p > 9 || !Number.isInteger(c.p))) problems.push(`bad p ${c.p}`); if (!c.why) problems.push(`no why N=${N} ${j.id}`); }
        const twos = pl.jobs.filter(j => pl.cells[w.id][j.id].p === 2).length;
        if (twos > 4) problems.push(`N=${N} rep=${rep} ${w.name} has ${twos} twos`);
      }
      if (pl.team.length >= 3) for (const j of pl.jobs) if (!(j.id === 'delivery' && pl.team.length < 5) && st.jobs[j.id].imp >= 2 && !pl.team.some(w => { const c = pl.cells[w.id][j.id]; return !c.off && c.p <= ((st.jobs[j.id].imp >= 4 || j.id === 'research') ? 2 : 3); })) problems.push(`N=${N} rep=${rep} job ${j.id} uncovered`);
    }
    out.runs = runs; out.problems = problems.slice(0, 20); out.problemCount = problems.length;
    // 3) traits matter: slacker vs neurotic crafter
    const mk = (id, name, traits, crafting) => T.normWorker(id, { name, traits, stats: { crafting: { cur: crafting, max: crafting + 1 }, cooking: { cur: 4, max: 6 } } });
    const s2 = T.defaultSettings(); s2.phase = 'ausbau'; for (const j of T.JOBS) s2.jobs[j.id].imp = T.PHASES[1].imp[j.id];
    const p2 = T.compute([mk('a', 'Faul', 'Slacker', 8), mk('b', 'Fleissig', 'Neurotic', 7), mk('c', 'Normal', '', 3)], s2);
    out.traits = Object.entries(p2.main).map(([k, v]) => k + '=' + v);
    // 4) small team importance: N=2 start phase -> construction must be filled
    const p3 = T.compute([mk('a', 'A', '', 2), mk('b', 'B', '', 2)], T.defaultSettings());
    out.small = Object.values(p3.main);
    // 5) parser
    const pr = T.parseRoster([
      '- **Agnes** [Arbeiter]: Labourer 3/5, Harvesting 6/9, Animal Handling 7/9, Crafting 2/6',
      'Bodo: Animal Handling 8/10',
      'Carla: Tierhaltung 5/7, Kochen 3 von 4',
      'Kunibert [Wache]: Labourer 3/4',
      'Dora – Traits: Optimist, Prodigy – Kochen 5/8',
      '1. Emil (Begleiter): Jagd 4',
      '| Frieda | Bauen 2/3 |',
      '```',
      'Gustav Wache: Feldarbeit 6/9 – Eigenschaften: Slacker',
      'Anna-Lena (die Alte) [Begleiter]: Kochen 4/6',
      'Agnes (Traits: Optimist): Kochen 3/5',
      'Agnes: Labourer 3/5 (Traits: Optimist)',
      'Konrad',
      'Bodo – Traits: Prodigy',
    ].join('\n'));
    out.parse = pr.rows.map(x => `${x.name}|${x.role}|${x.traits}|${x.traitsOnly ? 'T' : ''}|${Object.entries(x.stats).map(([k, v]) => k + v.cur + '/' + v.max).join(',')}`);
    out.skipped = pr.skipped;
    // 6) photo cleaning tolerance
    out.clean = T.cleanPhotoResult({ workers: [
      { name: 'Edwin', role: null, stats: { Labourer: { cur: 4, max: 7 }, Cooking: '6/9', 'animal handling': 3, Crafting: { current: 2, maximum: 5 }, Strength: 5 }, unsure: '' },
      { name: 42, stats: { harvesting: { cur: 12, max: 4 } } },
      { name: 'Leer', stats: {} },
    ] }).map(w => `${w.name}|${w.role}|${Object.entries(w.stats).map(([k, v]) => k + v.cur + '/' + v.max).join(',')}`);
    // 7) mergeStat keeps max
    const w = T.normWorker('m', { name: 'M', stats: { cooking: { cur: 1, max: 9 } } });
    T.mergeStat(w, 'cooking', 4, null); const keep = JSON.stringify(w.stats.cooking);
    T.mergeStat(w, 'cooking', 10, null); const drop = JSON.stringify(w.stats.cooking);
    out.merge = [keep, drop];
    // 8) old saved settings without new jobs
    const old = T.normSettings({ phase: 'ausbau', jobs: { construction: { on: true, imp: 2 }, hunting: { on: false, imp: 3 } } });
    out.oldSettings = JSON.stringify({ c: old.jobs.construction, h: old.jobs.hunting, s: old.jobs.smelting, a: old.jobs.animals });
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('ERRORS', errs);
  await browser.close();
})();

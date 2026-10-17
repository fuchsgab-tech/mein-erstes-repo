// Screenshots of the Eintragen-Modus at several sizes (local mode, seeded roster, no snapshots, one ticked villager).
const { chromium } = require('playwright');
const st = o => Object.fromEntries(Object.entries(o).map(([k, [cur, max]]) => [k, { cur, max }]));
const W = [
  { id: 'w_agnes', name: 'Agnes', role: 'worker', traits: 'Optimist', order: 1, stats: st({ labourer: [3, 5], harvesting: [6, 9], farming: [2, 4], cooking: [1, 3], crafting: [2, 6], researching: [0, 2], hunting: [5, 8] }) },
  { id: 'w_edda', name: 'Edda', role: 'worker', traits: '', order: 3, stats: st({ labourer: [2, 4], harvesting: [1, 3], farming: [3, 6], cooking: [8, 10], crafting: [2, 4], researching: [3, 5], hunting: [0, 2] }) },
  { id: 'w_godric', name: 'Godric', role: 'worker', traits: 'Prodigy', order: 4, stats: st({ labourer: [3, 6], harvesting: [3, 5], farming: [2, 4], cooking: [1, 4], crafting: [6, 10], researching: [4, 7], hunting: [1, 3] }) },
  { id: 'w_hilde', name: 'Hilde', role: 'worker', traits: '', order: 5, stats: st({ labourer: [2, 5], harvesting: [2, 5], farming: [7, 9], cooking: [4, 6], crafting: [1, 3], researching: [2, 4], hunting: [3, 6] }) },
];
(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const [w, h, tag] of [[360, 740, '360'], [390, 844, '390'], [844, 390, 'land844'], [667, 375, 'land667'], [1280, 900, '1280']]) {
    const mob = w < 900;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: mob, isMobile: mob });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(tag + ': ' + e.message));
    await p.addInitScript(ws => {
      if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', '1'); localStorage.setItem('bellwright-arbeitsplan-v1', JSON.stringify({ settings: null, workers: ws })); localStorage.setItem('bellwright-sperre-tipp-v1', 'true'); }
      const fake = { request: async () => { const s = new EventTarget(); s.release = async () => {}; return s; } };
      Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => fake });
    }, W);
    await p.goto('file://' + process.cwd() + '/page.html');
    await p.waitForTimeout(500);
    await p.click('#entry-open'); await p.waitForTimeout(250);
    const ov = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, entry: document.getElementById('entry').scrollWidth - document.getElementById('entry').clientWidth,
      wide: [...document.querySelectorAll('#entry *')].filter(e => e.getBoundingClientRect().right > innerWidth + 0.5).map(e => e.className || e.tagName).slice(0, 5),
      broken: [...document.querySelectorAll('.er-job')].filter(e => { const r = document.createRange(); r.selectNodeContents(e.firstChild); return r.getClientRects().length > 1; }).map(e => e.firstChild.textContent) }));
    console.log(tag, JSON.stringify(ov));
    await p.screenshot({ path: `shot-entry-${tag}.png` });
    if (tag === '390') {
      await p.click('.er-row.diff'); await p.click('details.ep-why summary');
      await p.evaluate(() => document.getElementById('entry').scrollTo(0, 99999)); await p.waitForTimeout(150);
      await p.screenshot({ path: `shot-entry-${tag}-bottom.png` });
    }
    await ctx.close();
  }
  console.log('ERRORS', errs);
  await b.close();
})();

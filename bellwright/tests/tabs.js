const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const w of [360, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage(); await p.goto('file://' + process.cwd() + '/page.html'); await p.waitForTimeout(1200);
    await p.click('#panel-plan [data-phase="ausbau"]'); await p.waitForTimeout(200);
    const r = await p.evaluate(() => { const t = document.querySelector('.tablist'); const pressed = document.querySelector('#panel-plan [aria-pressed="true"][data-phase]'); return { fits: t.scrollWidth <= t.clientWidth + 1, sw: t.scrollWidth, cw: t.clientWidth, pressedBg: getComputedStyle(pressed).backgroundImage.slice(0, 30), pressedColor: getComputedStyle(pressed).color }; });
    console.log(w, JSON.stringify(r));
    await ctx.close();
  }
  await b.close();
})();

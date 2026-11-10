const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [file, w, h, out, full] of [['vorschau-breit.html', 1280, 800, 'vorschau-gross.png', true], ['vorschau-handy.html', 390, 844, 'vorschau-handy.png', true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 900, hasTouch: w < 900 });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + __dirname + '/' + file, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    const info = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, cinzel: document.fonts.check('700 20px Cinzel'), aleg: document.fonts.check('16px "Alegreya Sans"') }));
    if (w < 900) await p.addStyleTag({ content: '.bottom{position:absolute!important;top:auto}body{position:relative}' });
    await p.screenshot({ path: out, fullPage: full });
    console.log(out, JSON.stringify(info), errs);
    await ctx.close();
  }
  await b.close();
})();

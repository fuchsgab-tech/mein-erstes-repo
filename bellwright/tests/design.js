const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  for (const [name, vp, touch] of [['d-desk', { width: 1280, height: 900 }, false], ['d-phone', { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(name + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text()); });
    await page.addInitScript(() => {
      const sample = async () => ({ text: '' });
      sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
      sample.json = async () => ({ workers: [] });
      window.claude = { use: async n => n === 'sample' ? sample : null };
    });
    await page.goto('file://' + process.cwd() + '/page.html#arbeiter');
    await page.waitForTimeout(400);
    await page.click('#adopt-example');
    await page.click('#tab-plan');
    await page.waitForTimeout(1300);
    // Embers drawn?
    const emberPixels = await page.evaluate(() => { const c = document.getElementById('embers'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++; return n; });
    // Bell rang on load?
    // mark all -> stamp; change phase -> bump + ring
    await page.click('#mark-all');
    const stampCount = await page.$$eval('.stamp', e => e.length);
    await page.click('#panel-plan [data-phase="ausbau"]');
    await page.waitForTimeout(60);
    const bumps = await page.$$eval('.bump', e => e.length);
    const ringing = await page.$eval('#bell', e => e.classList.contains('ring'));
    console.log(name, '| scrollWidth', await page.evaluate(() => document.documentElement.scrollWidth), '| ember pixels', emberPixels, '| stamps', stampCount, '| bumps', bumps, '| bell ringing', ringing);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: name + '.png', fullPage: false });
    if (name === 'd-phone') {
      await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(300);
      await page.screenshot({ path: name + '-2.png' });
      await page.click('#tab-arbeiter'); await page.waitForTimeout(400);
      await page.screenshot({ path: name + '-arbeiter.png' });
    } else {
      await page.click('[data-view="table"]'); await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, 420)); await page.waitForTimeout(300);
      await page.screenshot({ path: name + '-table.png' });
    }
    await ctx.close();
  }
  // reduced motion: no embers loop
  const ctx = await browser.newContext({ reducedMotion: 'reduce' }); const page = await ctx.newPage();
  await page.goto('file://' + process.cwd() + '/page.html'); await page.waitForTimeout(800);
  console.log('reduced motion ember pixels', await page.evaluate(() => { const c = document.getElementById('embers'); const d = c.getContext('2d').getImageData(0, 0, Math.max(1, c.width), Math.max(1, c.height)).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++; return n; }));
  await ctx.close();
  console.log('ERRORS', errs);
  await browser.close();
})();

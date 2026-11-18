const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  for (const [name, vp, scheme, touch] of [['phone-light', { width: 390, height: 844 }, 'light', true], ['phone-dark', { width: 390, height: 844 }, 'dark', true], ['desk-light', { width: 1280, height: 900 }, 'light', false]]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(name + ': ' + e.message));
    await page.addInitScript(() => {
      const sample = async () => ({ text: '' });
      sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
      sample.json = async () => ({ workers: [] });
      window.claude = { use: async n => n === 'sample' ? sample : null };
    });
    await page.goto('file://' + process.cwd() + '/page.html#arbeiter');
    await page.waitForTimeout(500);
    await page.click('#adopt-example');
    await page.click('#tab-plan');
    await page.waitForTimeout(200);
    // mark first two as applied, then change a setting so diffs appear
    if (name !== 'desk-light') { await page.click('#mark-all'); }
    else { await page.click('#mark-all'); }
    await page.click('#tab-jobs');
    await page.click('#panel-jobs [data-phase="ausbau"]');
    await page.click('#tab-plan');
    await page.waitForTimeout(300);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    console.log(name, 'scrollWidth', sw, 'view', await page.evaluate(() => document.querySelector('[data-view][aria-pressed=true]').dataset.view));
    // open one row reason in card view
    if (name.startsWith('phone')) { const d = page.locator('.wp-row').nth(2); await d.locator('summary').click(); }
    await page.screenshot({ path: name + '.png', fullPage: name !== 'desk-light' ? false : false });
    if (name === 'phone-light') {
      await page.evaluate(() => window.scrollTo(0, 700));
      await page.screenshot({ path: name + '-2.png' });
      await page.click('#tab-arbeiter'); await page.click('#toggle-photo'); await page.waitForTimeout(200);
      await page.screenshot({ path: name + '-arbeiter.png', fullPage: false });
      await page.click('#tab-wissen'); await page.evaluate(() => document.querySelector('.ktable').scrollIntoView()); await page.screenshot({ path: name + '-hilfe.png' });
    }
    if (name === 'desk-light') { await page.click('.cell >> nth=3'); await page.screenshot({ path: name + '-full.png', fullPage: true }); }
    await ctx.close();
  }
  console.log('ERRORS', errs);
  await browser.close();
})();

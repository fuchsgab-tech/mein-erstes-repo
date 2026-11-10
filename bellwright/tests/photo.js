const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  // --- A: local mode with an existing worker, photo result updates without losing Max/role
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => {
    const sample = async () => ({ text: '' });
    sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
    let mode = 'ok';
    window.__setMode = m => { mode = m; };
    sample.json = async (prompt, opts) => {
      window.__opts = { n: opts.images.length, cache: opts.cache };
      await new Promise(r => setTimeout(r, 200));
      if (mode === 'deny') throw { code: 'not_granted', message: 'x' };
      return { workers: [
        { name: 'Kunibert', role: null, stats: { Cooking: '4', labourer: { cur: 5, max: null } }, unsure: 'Max nicht lesbar.' },
        { name: 'Neu', role: 'worker', stats: { 'Animal Handling': { cur: 6, max: 9 } } },
      ], note: '' };
    };
    window.claude = { use: async n => n === 'sample' ? sample : null };
    localStorage.setItem('bellwright-arbeitsplan-v1', JSON.stringify({ settings: null, workers: [
      { id: 'k1', name: 'Kunibert', role: 'guard', traits: 'Stalwart', order: 1, stats: { cooking: { cur: 1, max: 9 }, labourer: { cur: 3, max: 8 } } },
    ] }));
  });
  await page.goto('file://' + process.cwd() + '/page.html#arbeiter');
  await page.waitForTimeout(400);
  await page.click('#toggle-photo');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#photo-file', [{ name: 'a.png', mimeType: 'image/png', buffer: png }]);
  await page.click('#photo-read');
  await page.waitForSelector('#review .rcard');
  console.log('opts', await page.evaluate(() => window.__opts), '| msg:', await page.$eval('#photo-msg', e => e.textContent));
  console.log('review:', await page.$$eval('#review .rcard', cs => cs.map(c => c.querySelector('[data-r=name]').value + ' role=' + c.querySelector('[data-r=role]').value + ' badge=' + c.querySelector('[data-badge]').textContent)));
  await page.screenshot({ path: 'photo-review.png' });
  await page.click('#review-apply');
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bellwright-arbeitsplan-v1')).workers.map(w => `${w.name} role=${w.role} cook=${w.stats.cooking.cur}/${w.stats.cooking.max} lab=${w.stats.labourer.cur}/${w.stats.labourer.max} ah=${w.stats.hunting.cur}/${w.stats.hunting.max}`));
  console.log('stored:', stored);
  console.log('goplan visible:', await page.isVisible('#photo-goplan'), '| toast:', await page.$eval('#toast', e => e.textContent));
  // denied consent
  await page.evaluate(() => window.__setMode('deny'));
  await page.setInputFiles('#photo-file', [{ name: 'b.png', mimeType: 'image/png', buffer: png }]);
  await page.click('#photo-read');
  await page.waitForTimeout(600);
  console.log('deny -> photo panel hidden:', await page.isHidden('#photo'), '| note:', await page.$eval('#photo-note', e => e.textContent));
  // reload: persisted
  await page.reload(); await page.waitForTimeout(400);
  console.log('after reload cards:', await page.$$eval('.wcard', c => c.length));
  await ctx.close();

  // --- B: loading lock: db never resolves for 2s; inputs disabled meanwhile
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errs.push(e.message));
  await p2.addInitScript(() => { window.claude = { use: n => new Promise(r => setTimeout(() => r(null), 1500)) }; });
  await p2.goto('file://' + process.cwd() + '/page.html#arbeiter');
  await p2.waitForTimeout(300);
  console.log('loading: add disabled', await p2.$eval('#add-worker', e => e.disabled), '| empty hidden', await p2.isHidden('#w-empty'), '| banner hidden', await p2.isHidden('#example-banner'));
  await p2.waitForTimeout(1600);
  console.log('ready: add disabled', await p2.$eval('#add-worker', e => e.disabled), '| status', await p2.$eval('#status-text', e => e.textContent));
  await ctx2.close();
  console.log('ERRORS', errs);
  await browser.close();
})();

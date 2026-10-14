const { chromium } = require('playwright');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  // 1) settings snapshot arrives 1.5 s after workers: controls must stay locked, stored settings must survive
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('1: ' + e.message));
    await page.addInitScript(() => {
      const stored = { phase: 'krieg', growth: 0.8, disableWeak: true, jobs: { smelting: { on: false, imp: 5 } } };
      window.__srv = { settings: stored, writes: 0 };
      const db = {
        // Only 'workers' holds Agnes; every other collection (ingame) starts empty.
        collection: c => ({ doc: id => ({ set: async d => { window.__srv.writes++; }, delete: async () => {} }), onSnapshot: n => { setTimeout(() => n({ docs: c === 'workers' ? [{ id: 'a', data: () => ({ name: 'Agnes', role: 'worker', order: 1, stats: { cooking: { cur: 5, max: 8 } } }) }] : [] }), 30); return () => {}; } }),
        doc: () => ({ set: async d => { window.__srv.settings = d; window.__srv.writes++; }, onSnapshot: n => { setTimeout(() => n({ exists: true, data: () => stored }), 1500); return () => {}; } }),
      };
      window.claude = { use: async n => n === 'db' ? db : null };
    });
    await page.goto('file://' + process.cwd() + '/page.html');
    await page.waitForTimeout(300);
    const lockedEarly = await page.$eval('#panel-plan [data-phase="ausbau"]', e => e.disabled);
    const statusEarly = await page.$eval('#status-text', e => e.textContent);
    await page.waitForTimeout(1500);
    const phaseAfter = await page.$eval('#panel-plan [aria-pressed="true"][data-phase]', e => e.dataset.phase);
    console.log('1) locked before settings:', lockedEarly, '| status early:', statusEarly, '| phase after:', phaseAfter, '| writes:', await page.evaluate(() => window.__srv.writes));
    await ctx.close();
  }
  // 2) listeners never connect: no example team, editing locked, error text
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('2: ' + e.message));
    await page.addInitScript(() => {
      window.__subs = 0;
      const fail = (n, err) => { window.__subs++; setTimeout(() => err({ code: 'unavailable', message: 'x' }), 50); return () => {}; };
      const db = { collection: () => ({ doc: () => ({}), onSnapshot: fail }), doc: () => ({ onSnapshot: fail }) };
      window.claude = { use: async n => n === 'db' ? db : null };
    });
    await page.goto('file://' + process.cwd() + '/page.html');
    await page.waitForTimeout(8000);
    console.log('2) status:', await page.$eval('#status-text', e => e.textContent), '| banner hidden:', await page.isHidden('#example-banner'), '| plan text:', (await page.$eval('#plan-view', e => e.textContent)).trim().slice(0, 60), '| add disabled:', await page.$eval('#add-worker', e => e.disabled), '| subs:', await page.evaluate(() => window.__subs));
    await ctx.close();
  }
  // 3) local mode: Max typo, paste text+image, table overflow on phone, nosave
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('3: ' + e.message));
    await page.addInitScript(() => {
      const sample = async () => ({ text: '' });
      sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
      sample.json = async () => ({ workers: [{ name: 'Kunlbert', role: null, stats: { cooking: { cur: 4, max: null } } }, { name: '', role: null, stats: { farming: { cur: 7, max: 9 } } }] });
      window.claude = { use: async n => n === 'sample' ? sample : null };
      if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('bellwright-arbeitsplan-v1', JSON.stringify({ workers: [{ id: 'k1', name: 'Kunibert', role: 'guard', order: 1, stats: { cooking: { cur: 3, max: 5 } } }] })); }
    });
    await page.goto('file://' + process.cwd() + '/page.html#arbeiter');
    await page.waitForTimeout(400);
    // Max typo
    await page.click('#k1-cur-cooking'); await page.keyboard.type('12'); await page.keyboard.press('Backspace');
    const midMax = await page.evaluate(() => JSON.parse(localStorage.getItem('bellwright-arbeitsplan-v1')).workers[0].stats.cooking);
    await page.click('#k1-traits');
    const endMax = await page.evaluate(() => JSON.parse(localStorage.getItem('bellwright-arbeitsplan-v1')).workers[0].stats.cooking);
    console.log('3a) after typing 12 then backspace:', JSON.stringify(midMax), '| after leaving field:', JSON.stringify(endMax));
    // paste text + image into import box
    await page.click('#toggle-import');
    const pasted = await page.evaluate(() => {
      const ta = document.getElementById('import-text'); ta.focus();
      const dt = new DataTransfer(); dt.setData('text/plain', 'Agnes: Kochen 5/8');
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'x.png', { type: 'image/png' }));
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      ta.dispatchEvent(ev);
      return { prevented: ev.defaultPrevented, photoOpen: !document.getElementById('photo').hidden };
    });
    console.log('3b) paste text+image into textarea:', JSON.stringify(pasted));
    // photo review: corrected name keeps guard role; unnamed card blocks apply
    await page.click('#toggle-photo');
    await page.setInputFiles('#photo-file', [{ name: 'a.png', mimeType: 'image/png', buffer: png }]);
    await page.click('#photo-read'); await page.waitForSelector('#review .rcard');
    await page.fill('#rv-0-name', 'Kunibert');
    const roleShown = await page.$eval('#rv-0-role', e => e.value);
    await page.click('#review-apply');
    const msg1 = await page.$eval('#photo-msg', e => e.textContent);
    const stillThere = await page.$$eval('#review .rcard', c => c.length);
    await page.fill('#rv-1-name', 'Mira');
    await page.click('#review-apply'); await page.waitForTimeout(200);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bellwright-arbeitsplan-v1')).workers.map(w => `${w.name}:${w.role}:cook=${w.stats.cooking.cur}/${w.stats.cooking.max}:farm=${w.stats.farming.cur}/${w.stats.farming.max}`));
    console.log('3c) role shown after name fix:', roleShown, '| unnamed msg:', msg1, '| cards kept:', stillThere, '| stored:', stored);
    // table view overflow on phone
    await page.click('#tab-plan'); await page.click('[data-view="table"]'); await page.waitForTimeout(200);
    const ov = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, wrap: document.querySelector('.matrix-wrap').scrollWidth > document.querySelector('.matrix-wrap').clientWidth }));
    console.log('3d) table on 390px: page scrollWidth', ov.doc, '| table scrolls inside:', ov.wrap);
    await page.screenshot({ path: 'table-phone.png' });
    await page.click('[data-view="cards"]'); await page.waitForTimeout(100);
    await page.screenshot({ path: 'cards-phone.png' });
    await ctx.close();
  }
  // 4) blocked storage -> nosave status
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('4: ' + e.message));
    await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }); });
    await page.goto('file://' + process.cwd() + '/page.html');
    await page.waitForTimeout(400);
    console.log('4) blocked storage status:', await page.$eval('#status-text', e => e.textContent), '|', await page.$eval('#status-line', e => e.textContent));
    await ctx.close();
  }
  console.log('ERRORS', errs);
  await browser.close();
})();

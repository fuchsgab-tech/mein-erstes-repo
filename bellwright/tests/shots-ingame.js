// Screens for BUILD 2: sealed cards with the "eingetragen von …" line, the table tick, and the undo toast (390 / 360 / 1280).
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/feat-ingame.js', 'utf8');
const head = src.slice(0, src.indexOf('(async () => {\n  const browser'));
eval(head + `
(async () => {
  const browser = await chromium.launch();
  for (const [name, width, view] of [['shot-ingame-390', 390, 'cards'], ['shot-ingame-360', 360, 'cards'], ['shot-ingame-1280', 1280, 'cards'], ['shot-ingame-1280-table', 1280, 'table'], ['shot-ingame-390-table', 390, 'table']]) {
    const srv = makeServer({ workers: SEED_W });
    const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: { id: 'u_owner', owner: true, can: true } }, { width });
    const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: { id: 'u_lena', owner: false, can: true } }, { width });
    await A.page.click('[data-view="cards"]'); await A.page.waitForTimeout(100);
    await A.page.click('#mark-all'); await A.page.waitForTimeout(400);
    // Lena re-ticks Edda later; an unknown person ticked Godric yesterday.
    const d = clone(srv.ingame.get('w_godric')); d.by = 'u_x'; d.at = Date.now() - 26 * 3600e3; srv.ingame.set('w_godric', d); srv.broadcast('ingame');
    await B.page.click('[data-view="' + view + '"]'); await B.page.waitForTimeout(500);
    await B.page.evaluate(() => document.querySelector('.grid-head').scrollIntoView());
    await B.page.waitForTimeout(300);
    await B.page.screenshot({ path: name + '.png' });
    if (name === 'shot-ingame-360') {
      await B.page.click('#tab-arbeiter');
      const del = B.page.locator('[data-wid="w_bertram"] [data-act="del"]');
      await del.click(); await B.page.waitForTimeout(500); await del.click(); await B.page.waitForTimeout(300);
      console.log('360 overflow', await B.page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
      await B.page.screenshot({ path: 'shot-ingame-360-delete.png' });
    }
    for (const s of [A, B]) await s.ctx.close();
  }
  console.log('errors', errs);
  await browser.close();
})();`);

const { chromium } = require('playwright');
// Fake db: set() resolves after 350ms, then echoes a snapshot; another viewer writes every 500ms; periodic refresh.
const STUB = () => {
  // One map and one listener list per collection (workers, settings, ingame, prefs), so each listener gets only its own docs.
  const docs = { workers: new Map(), settings: new Map(), ingame: new Map(), prefs: new Map() };
  const listeners = { workers: [], settings: [], ingame: [], prefs: [] };
  window.__server = docs;
  const snapC = c => ({ docs: [...docs[c].entries()].map(([id, d]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(d)), metadata: {} })), size: docs[c].size, empty: !docs[c].size, metadata: {}, docChanges: () => [] });
  const snapS = () => { const d = docs.settings.get('main'); return { id: 'main', exists: !!d, data: () => d && JSON.parse(JSON.stringify(d)), metadata: {} }; };
  const fire = () => { listeners.workers.forEach(f => f(snapC('workers'))); listeners.ingame.forEach(f => f(snapC('ingame'))); listeners.prefs.forEach(f => f(snapC('prefs'))); listeners.settings.forEach(f => f(snapS())); };
  window.__fire = fire;
  const ref = (coll, id) => ({
    set: d => new Promise(r => setTimeout(() => { docs[coll].set(id, JSON.parse(JSON.stringify(d))); r(); setTimeout(fire, 20); }, 350)),
    delete: () => new Promise(r => setTimeout(() => { docs[coll].delete(id); r(); setTimeout(fire, 20); }, 350)),
    onSnapshot: (n) => { listeners.settings.push(n); setTimeout(() => n(snapS()), 30); return () => {}; },
  });
  const db = {
    collection: c => ({ doc: id => ref(c, id), onSnapshot: (n) => { listeners[c].push(n); setTimeout(() => n(snapC(c)), 30); return () => {}; } }),
    doc: p => ref('settings', p.split('/')[1]),
  };
  // another viewer edits a different worker periodically
  docs.workers.set('other', { name: 'Bertram', role: 'worker', traits: '', order: 1, stats: {} });
  setInterval(() => { const o = docs.workers.get('other'); o.traits = 'x' + Math.random(); fire(); }, 300);
  window.claude = { use: async n => n === 'db' ? db : n === 'user' ? { can: async () => true } : null };
};
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(STUB);
  await page.goto('file://' + process.cwd() + '/page.html#arbeiter');
  await page.waitForTimeout(400);
  // (1) add a worker and type the name right away, then a stat
  await page.click('#add-worker');
  await page.waitForTimeout(50);
  await page.keyboard.type('Ida', { delay: 60 });
  const card = page.locator('.wcard').filter({ has: page.locator('input[value=""], input') }).last();
  const id = await page.evaluate(() => document.activeElement.closest('[data-wid]').dataset.wid);
  await page.fill(`#${id}-cur-cooking`, '4');
  await page.waitForTimeout(650);
  await page.fill(`#${id}-cur-crafting`, '7');
  await page.waitForTimeout(2500);
  const server = await page.evaluate(id => window.__server.workers.get(id), id);
  const shown = await page.evaluate(id => [document.getElementById(id + '-name').value, document.getElementById(id + '-cur-cooking').value, document.getElementById(id + '-cur-crafting').value], id);
  console.log('server:', server && server.name, server && server.stats.cooking.cur, server && server.stats.crafting.cur, '| shown:', shown.join(','));
  // (2) settings: two quick slider changes during write
  await page.click('#tab-jobs');
  await page.$eval('#imp-cooking', el => { el.value = '1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(500);
  await page.$eval('#imp-hunting', el => { el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(2500);
  const ss = await page.evaluate(() => window.__server.settings.get('main'));
  console.log('settings server cooking/hunting:', ss.jobs.cooking.imp, ss.jobs.hunting.imp, '| label:', await page.$eval('#imp-hunting-out', e => e.textContent));
  // (3) delete while a write is in flight; must not come back
  await page.click('#tab-arbeiter');
  await page.fill(`#${id}-cur-farming`, '5');
  await page.waitForTimeout(650); // write in flight
  const del = page.locator(`[data-wid="${id}"] [data-act="del"]`);
  await del.click(); await page.waitForTimeout(500); await del.click();
  await page.waitForTimeout(3000);
  console.log('after delete: server has it?', await page.evaluate(id => window.__server.workers.has(id), id), '| card shown?', await page.locator(`[data-wid="${id}"]`).count());
  // (4) quick double click on delete must not delete
  const other = page.locator('[data-wid="other"] [data-act="del"]');
  await other.dblclick(); await page.waitForTimeout(1200);
  console.log('dblclick deleted other?', !(await page.evaluate(() => window.__server.workers.has('other'))));
  console.log('status:', await page.$eval('#status-text', e => e.textContent));
  console.log('ERRORS', errs);
  await browser.close();
})();

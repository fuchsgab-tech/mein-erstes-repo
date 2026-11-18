const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 600 }, deviceScaleFactor: 2 });
  await p.goto('file://' + __dirname + '/titelbild.svg');
  await p.screenshot({ path: 'titelbild.png' });
  await b.close();
})();

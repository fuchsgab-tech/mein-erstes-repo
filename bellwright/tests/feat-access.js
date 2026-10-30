// BUILD 1 "Mitspieler-Zugang erklären": status texts per access situation, copy button, example banner, Hilfe section.
// Fake platform: db with per-collection docs and listeners, user with id()/isOwner()/can()/profiles(), clipboard.
const { chromium } = require('playwright');

const OWNER_LINE = 'Mitspieler können nur mitplanen, wenn ihr sie im Teilen-Menü per E-Mail als „Bearbeiter“ einladet.';
const WRITER_LINE = 'Diese Liste sehen und bearbeiten alle, mit denen ihr die Seite teilt.';
const RO_LINE = 'Ihr könnt den Plan ansehen, aber nichts ändern. Damit ihr mitplanen könnt, muss der Besitzer euch im Teilen-Menü per E-Mail als „Bearbeiter“ einladen. Ist die Seite zusätzlich per Link geteilt, können eingeladene Mitspieler nur ansehen.';
const OFF_LINE = 'Ihr seht gerade nicht die gemeinsame Liste. Meldet euch bei claude.ai an und öffnet den Link noch einmal. Bis dahin speichert die App nur auf diesem Gerät.';
const OFF_LINE_NOSTORE = 'Ihr seht gerade nicht die gemeinsame Liste. Meldet euch bei claude.ai an und öffnet den Link noch einmal. Bis dahin wird nichts gespeichert.';
const ASK = 'Hi! Im Bellwright-Arbeitsplan kann ich nichts ändern. Kannst du mich im Teilen-Menü per E-Mail als Bearbeiter einladen und das Teilen per Link ausschalten? Danke!';
const ASK_TOAST = 'Nachricht kopiert. Schickt sie dem Besitzer.';
const HELP_ITEMS = [
  'Die Seite in Claude über „Teilen“ freigeben.',
  'Jeden Mitspieler mit seiner E-Mail-Adresse einladen und „Bearbeiter“ wählen.',
  'Das Teilen per Link aus lassen – sonst können eingeladene Mitspieler nur ansehen.',
  'Jeder braucht ein eigenes Claude-Konto und muss angemeldet sein.',
];
const SEED = { workers: { w1: { name: 'Agnes', role: 'worker', traits: '', order: 1, stats: { cooking: { cur: 4, max: 7 }, farming: { cur: 2, max: 5 } } } } };

// Runs in the page before the app. cfg: { inClaude, db, writable, user: null | {owner, id, can, delay}, clip, seed, blockStorage }
function STUB(cfg) {
  window.__clip = null;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: t => cfg.clip === 'fail' ? Promise.reject(new Error('denied')) : (window.__clip = t, Promise.resolve()),
  } });
  if (cfg.blockStorage) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  if (!cfg.inClaude) return;
  const cols = new Map(), colL = new Map(), docL = new Map();
  const coll = n => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  const list = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const clone = d => JSON.parse(JSON.stringify(d));
  const snapC = n => { const m = coll(n); return { docs: [...m].map(([id, d]) => ({ id, exists: true, data: () => clone(d), metadata: {} })), size: m.size, empty: !m.size, metadata: {}, docChanges: () => [] }; };
  const snapD = (c, id) => { const d = coll(c).get(id); return { id, exists: !!d, data: () => (d ? clone(d) : undefined), metadata: {} }; };
  const fire = c => {
    for (const f of colL.get(c) || []) f(snapC(c));
    for (const [k, fs] of docL) if (k.startsWith(c + '/')) for (const f of fs) f(snapD(c, k.slice(c.length + 1)));
  };
  window.__srv = { cols, writes: 0, rejected: 0 };
  const refuse = () => { window.__srv.rejected++; return Promise.reject({ code: 'invalid_argument', message: 'below the write level' }); };
  const docRef = (c, id) => ({
    set: d => { if (!cfg.writable) return refuse(); window.__srv.writes++; coll(c).set(id, clone(d)); setTimeout(() => fire(c), 10); return Promise.resolve(); },
    delete: () => { if (!cfg.writable) return refuse(); coll(c).delete(id); setTimeout(() => fire(c), 10); return Promise.resolve(); },
    get: async () => snapD(c, id),
    onSnapshot: (n) => { list(docL, c + '/' + id).push(n); setTimeout(() => n(snapD(c, id)), 20); return () => {}; },
  });
  const db = Object.freeze({
    collection: c => ({ doc: id => docRef(c, id), onSnapshot: (n) => { list(colL, c).push(n); setTimeout(() => n(snapC(c)), 20); return () => {}; } }),
    doc: p => { const [c, id] = p.split('/'); return docRef(c, id); },
  });
  for (const [c, docs] of Object.entries(cfg.seed || {})) for (const [id, d] of Object.entries(docs)) coll(c).set(id, clone(d));
  const u = cfg.user;
  // hold: the answer waits until the test calls window.__releaseUser() (a late host answer).
  const gate = new Promise(r => { window.__releaseUser = r; });
  const wait = async v => { if (u && u.hold) await gate; return v; };
  const profile = id => ({ id, name: id === (u && u.id) ? 'Ich' : '', avatarUrl: 'data:,', color: '#888', email: null, isMe: id === (u && u.id), guest: false });
  const user = u === null || u === undefined ? null : u === 'canOnly' ? { can: async () => true } : Object.freeze({
    isOwner: () => wait(!!u.owner),
    canEdit: () => wait(!!u.owner),
    id: () => wait(u.id === undefined ? null : u.id),
    can: name => wait(name === 'data.write' ? u.can : false),
    me: () => wait({ id: u.id || null, name: u.id ? 'Ich' : '', avatarUrl: 'data:,', color: '#888', email: null, isOwner: !!u.owner, canEdit: !!u.owner }),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, profile(i)])),
  });
  window.claude = { use: async n => n === 'db' ? (cfg.db ? db : null) : n === 'user' ? user : null };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); };

async function session(browser, cfg, { width = 360, file = 'page.html', hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 780 }, hasTouch: width < 600, isMobile: width < 600 });
  const page = await ctx.newPage();
  page.__errs = [];
  page.on('pageerror', e => page.__errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.__errs.push('console: ' + m.text()); });
  await page.addInitScript(STUB, cfg);
  await page.goto('file://' + process.cwd() + '/' + file + hash);
  await page.waitForTimeout(400);
  return { ctx, page };
}
const status = page => page.evaluate(() => ({
  title: document.getElementById('status-text').textContent,
  mode: document.getElementById('status').dataset.mode,
  line: document.getElementById('status-line').hidden ? '' : document.getElementById('status-line').textContent,
  ask: !document.getElementById('ask-owner').hidden && !!document.getElementById('ask-owner').offsetParent,
  help: !document.getElementById('invite-help').hidden && !!document.getElementById('invite-help').offsetParent,
  explain: document.getElementById('mast-side').classList.contains('explain'),
  bodyText: document.body.innerText,
  overflow: document.documentElement.scrollWidth - innerWidth,
  addDisabled: document.getElementById('add-worker').disabled,
  banner: !document.getElementById('example-banner').hidden,
  bannerLead: document.getElementById('example-lead').textContent,
  bannerOff: document.getElementById('example-banner').hasAttribute('data-off'),
  toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent,
}));
const height = (page, sel) => page.$eval(sel, e => e.getBoundingClientRect().height);

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const done = async (s, label) => { errs.push(...s.page.__errs.map(e => label + ': ' + e)); await s.ctx.close(); };

  // 1) Owner (db, can write). Owner line + guide link, never the copy button. myId kept for later features.
  {
    const s = await session(browser, { inClaude: true, db: true, writable: true, seed: SEED, user: { owner: true, id: 'u_owner', can: true } }, { file: 'expose.html' });
    const st = await status(s.page);
    check('owner: title', st.title === 'Gemeinsam gespeichert', st.title);
    check('owner: line', st.line === OWNER_LINE, st.line);
    check('owner: no copy button', !st.ask);
    check('owner: guide link', st.help);
    check('owner: guide link >= 44px', (await height(s.page, '#invite-help')) >= 44, await height(s.page, '#invite-help'));
    check('owner: no overflow at 360', st.overflow <= 0, st.overflow);
    check('owner: inputs enabled', !st.addDisabled);
    const u = await s.page.evaluate(() => ({ id: window.__t.getUser().myId, ns: !!window.__t.getUser().userNs, owner: window.__t.state.isOwner }));
    check('owner: myId and userNs resolved', u.id === 'u_owner' && u.ns && u.owner, u);
    await s.page.screenshot({ path: 'acc-owner-360.png' });
    await s.page.click('#invite-help');
    await s.page.waitForTimeout(300);
    const help = await s.page.evaluate(() => ({ tab: document.getElementById('tab-wissen').getAttribute('aria-selected'), firstH2: document.querySelector('#panel-wissen section h2').textContent }));
    check('owner: guide link opens Hilfe at the invite steps', help.tab === 'true' && help.firstH2 === 'Mitspieler einladen', help);
    // writing still works for the owner
    await s.page.click('#tab-arbeiter'); await s.page.fill('#w1-cur-cooking', '5'); await s.page.waitForTimeout(1100);
    const srv = await s.page.evaluate(() => ({ w: window.__srv.writes, cook: window.__srv.cols.get('workers').get('w1').stats.cooking.cur }));
    check('owner: edit saved', srv.w >= 1 && srv.cook === 5, srv);
    await done(s, 'owner');
  }

  // 2) Friend invited by email as Bearbeiter (can edit): today's writer line, never the owner line.
  {
    const s = await session(browser, { inClaude: true, db: true, writable: true, seed: SEED, user: { owner: false, id: 'u_lena', can: true } });
    const st = await status(s.page);
    check('editor: title', st.title === 'Gemeinsam gespeichert', st.title);
    check('editor: writer line unchanged', st.line === WRITER_LINE, st.line);
    check('editor: owner line never shown', !st.bodyText.includes('Mitspieler können nur mitplanen'));
    check('editor: no copy button, no guide link', !st.ask && !st.help);
    check('editor: no overflow at 360', st.overflow <= 0, st.overflow);
    await s.page.click('#tab-arbeiter'); await s.page.fill('#w1-cur-cooking', '6'); await s.page.waitForTimeout(1100);
    check('editor: edit saved', (await s.page.evaluate(() => window.__srv.cols.get('workers').get('w1').stats.cooking.cur)) === 6);
    await done(s, 'editor');
  }

  // 3) Same friend after the owner turned on link sharing: platform says can("data.write") = false.
  {
    const s = await session(browser, { inClaude: true, db: true, writable: false, seed: SEED, user: { owner: false, id: 'u_lena', can: false } });
    const st = await status(s.page);
    check('link-shared: title', st.title === 'Nur ansehen', st.title);
    check('link-shared: explanation', st.line === RO_LINE, st.line);
    check('link-shared: owner line never shown', !st.bodyText.includes('Mitspieler können nur mitplanen'));
    check('link-shared: copy button shown', st.ask);
    check('link-shared: wide note', st.explain);
    check('link-shared: inputs locked', st.addDisabled);
    check('link-shared: no overflow at 360', st.overflow <= 0, st.overflow);
    check('link-shared: copy button >= 44px', (await height(s.page, '#ask-owner')) >= 44, await height(s.page, '#ask-owner'));
    check('link-shared: copy button fits 360', (await s.page.$eval('#ask-owner', e => e.getBoundingClientRect().right)) <= 360);
    await s.page.screenshot({ path: 'acc-ro-360.png' });
    await s.page.click('#ask-owner');
    await s.page.waitForTimeout(150);
    const after = await status(s.page);
    check('link-shared: message copied', (await s.page.evaluate(() => window.__clip)) === ASK, await s.page.evaluate(() => window.__clip));
    check('link-shared: toast', after.toast === ASK_TOAST, after.toast);
    check('link-shared: nothing written', (await s.page.evaluate(() => window.__srv.writes)) === 0);
    await done(s, 'link-shared');
  }

  // 3b) Clipboard blocked, button pressed on the Hilfe tab: the fallback box shows on the Plan tab with the message.
  {
    const s = await session(browser, { inClaude: true, db: true, writable: false, seed: SEED, clip: 'fail', user: { owner: false, id: 'u_lena', can: false } }, { hash: '#wissen' });
    await s.page.click('#ask-owner');
    await s.page.waitForTimeout(200);
    const fb = await s.page.evaluate(() => ({ plan: document.getElementById('tab-plan').getAttribute('aria-selected'), shown: !!document.getElementById('copy-fallback').offsetParent, text: document.getElementById('copy-text').value, focused: document.activeElement.id }));
    check('clipboard blocked: fallback visible with message', fb.plan === 'true' && fb.shown && fb.text === ASK && fb.focused === 'copy-text', fb);
    await done(s, 'clip-fail');
  }

  // 4) Platform says nothing (can() = null): keep the inputs, the refused write decides and shows the same text.
  {
    const s = await session(browser, { inClaude: true, db: true, writable: false, seed: SEED, user: { owner: false, id: null, can: null } });
    const st = await status(s.page);
    check('can null: inputs kept', !st.addDisabled && st.title === 'Gemeinsam gespeichert', st);
    await s.page.click('#tab-arbeiter'); await s.page.fill('#w1-cur-cooking', '6'); await s.page.waitForTimeout(1100);
    const after = await status(s.page);
    check('can null: refused write -> Nur ansehen + explanation', after.title === 'Nur ansehen' && after.line === RO_LINE && after.ask, after);
    check('can null: toast points to the explanation', after.toast === 'Änderungen können hier nicht gespeichert werden. Oben steht, woran das liegt.', after.toast);
    check('can null: inputs now locked', after.addDisabled);
    await done(s, 'can-null');
  }

  // 5) Private or signed-out window: inside Claude, db is null.
  {
    const s = await session(browser, { inClaude: true, db: false, user: { owner: false, id: null, can: null } });
    const st = await status(s.page);
    check('signed out: title', st.title === 'Nicht verbunden', st.title);
    check('signed out: mode', st.mode === 'off', st.mode);
    check('signed out: line', st.line === OFF_LINE, st.line);
    check('signed out: example banner', st.banner && st.bannerLead === 'Das ist nur ein Beispiel, nicht eure gemeinsame Liste.' && st.bannerOff, st);
    check('signed out: no copy button, no guide', !st.ask && !st.help);
    check('signed out: local editing still works', !st.addDisabled);
    check('signed out: no overflow at 360', st.overflow <= 0, st.overflow);
    await s.page.screenshot({ path: 'acc-off-360.png' });
    await done(s, 'signed-out');
  }
  // 5b) Signed out and the browser blocks storage: do not promise saving on this device.
  {
    const s = await session(browser, { inClaude: true, db: false, user: null, blockStorage: true });
    const st = await status(s.page);
    check('signed out + no storage: line', st.title === 'Nicht verbunden' && st.line === OFF_LINE_NOSTORE, st.line);
    await done(s, 'signed-out-nostore');
  }

  // 6) Outside Claude (no window.claude): local mode unchanged.
  {
    const s = await session(browser, { inClaude: false });
    const st = await status(s.page);
    check('outside: unchanged local status', st.title === 'Nur auf diesem Gerät gespeichert' && st.line === 'Gemeinsames Speichern geht hier nicht. Die Liste bleibt in diesem Browser.', st);
    check('outside: banner unchanged', st.banner && st.bannerLead === 'Beispielteam.' && !st.bannerOff, st);
    check('outside: no buttons', !st.ask && !st.help);
    await done(s, 'outside');
  }

  // 7) db works but the user capability is missing (null): behave as today.
  {
    const s = await session(browser, { inClaude: true, db: true, writable: true, seed: SEED, user: null }, { file: 'expose.html' });
    const st = await status(s.page);
    check('user null: today\'s db status', st.title === 'Gemeinsam gespeichert' && st.line === WRITER_LINE && !st.ask && !st.help && !st.addDisabled, st);
    const u = await s.page.evaluate(() => window.__t.getUser());
    check('user null: userNs null, myId empty', u.userNs === null && u.myId === '', u);
    await done(s, 'user-null');
  }
  // 7b) A partial user namespace (only can) must not break anything.
  {
    const s = await session(browser, { inClaude: true, db: true, writable: true, seed: SEED, user: 'canOnly' }, { file: 'expose.html' });
    const st = await status(s.page);
    check('partial user: writer line', st.title === 'Gemeinsam gespeichert' && st.line === WRITER_LINE, st);
    check('partial user: myId empty', (await s.page.evaluate(() => window.__t.getUser().myId)) === '');
    await done(s, 'partial-user');
  }

  // 8) The owner whose write is refused (technical): no invite text, no copy button.
  {
    const s = await session(browser, { inClaude: true, db: true, writable: false, seed: SEED, user: { owner: true, id: 'u_owner', can: null } });
    await s.page.click('#tab-arbeiter'); await s.page.fill('#w1-cur-cooking', '6'); await s.page.waitForTimeout(1100);
    const st = await status(s.page);
    check('owner refused: own text', st.title === 'Nur ansehen' && st.line === 'Speichern geht hier gerade nicht. Ladet die Seite neu.' && !st.ask && !st.help, st);
    await done(s, 'owner-refused');
  }

  // 9) The user answer arrives late: no line flashes before it, then the right one.
  for (const owner of [true, false]) {
    const s = await session(browser, { inClaude: true, db: true, writable: true, seed: SEED, user: { owner, id: 'u_x', can: true, hold: true } });
    const early = await status(s.page);
    check(`late user (${owner ? 'owner' : 'editor'}): no line before the answer`, early.title === 'Gemeinsam gespeichert' && early.line === '', early.line);
    await s.page.evaluate(() => window.__releaseUser());
    await s.page.waitForTimeout(100);
    const late = await status(s.page);
    check(`late user (${owner ? 'owner' : 'editor'}): line after the answer`, late.line === (owner ? OWNER_LINE : WRITER_LINE), late.line);
    await done(s, 'late-user');
  }

  // 10) Hilfe: first section "Mitspieler einladen" as an ordered list, plus the wording note.
  {
    const s = await session(browser, { inClaude: false }, { hash: '#wissen' });
    const h = await s.page.evaluate(() => {
      const sec = document.querySelector('#panel-wissen > section');
      return { h2: sec.querySelector('h2').textContent, items: [...sec.querySelectorAll('ol > li')].map(li => li.textContent), note: sec.innerText.includes('Teilen-Menü können') , overflow: document.documentElement.scrollWidth - innerWidth };
    });
    check('hilfe: first section title', h.h2 === 'Mitspieler einladen', h.h2);
    check('hilfe: four steps in order', JSON.stringify(h.items) === JSON.stringify(HELP_ITEMS), h.items);
    check('hilfe: wording note', h.note);
    check('hilfe: no overflow at 360', h.overflow <= 0, h.overflow);
    await s.page.screenshot({ path: 'acc-hilfe-360.png' });
    await done(s, 'hilfe');
  }

  // Screens for review: 390px and 1280px.
  for (const [name, width, cfg] of [
    ['acc-ro-390', 390, { inClaude: true, db: true, writable: false, seed: SEED, user: { owner: false, id: 'u_l', can: false } }],
    ['acc-ro-1280', 1280, { inClaude: true, db: true, writable: false, seed: SEED, user: { owner: false, id: 'u_l', can: false } }],
    ['acc-owner-1280', 1280, { inClaude: true, db: true, writable: true, seed: SEED, user: { owner: true, id: 'u_o', can: true } }],
    ['acc-off-1280', 1280, { inClaude: true, db: false, user: null }],
    ['acc-off-390', 390, { inClaude: true, db: false, user: null }],
  ]) {
    const s = await session(browser, cfg, { width });
    check(name + ': no overflow', (await s.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await s.page.screenshot({ path: name + '.png' });
    await done(s, name);
  }

  check('no page errors', errs.length === 0, errs);
  console.log(`feat-access: ${passes} passed, ${fails.length} failed`);
  for (const f of fails) console.log('FAIL ' + f);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();

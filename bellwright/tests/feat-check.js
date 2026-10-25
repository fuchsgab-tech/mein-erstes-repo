// BUILD 16 "Spiel prüfen per Foto": the group photographs the game's table view (Bevölkerung -> "Arbeitsprioritäten",
// one row per villager, 13 job columns) and the app checks that everything was entered as planned.
// Data: fixtures/check-live.json = the group's real roster, settings and shared tick-off ('ingame') plus the lead's
// transcription of their two table photos (photoRows); fixtures/tabelle-1.jpg / tabelle-2.jpg are those photos.
// The sample stub answers with that transcription laid out like the two photos (cut-off names as on screen, the two
// rows the photos share listed twice, Saul Lovell's Forschung cell unsure under the red cursor).
// Expected texts come from the app's own compute() (the planner cut out of the file, as feat-pins.js does).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../bellwright-arbeitsplan.html');
const SHOTS = path.resolve(__dirname, '../shots-check');
const FIX = path.resolve(__dirname, 'fixtures');
fs.mkdirSync(SHOTS, { recursive: true });
function load(file) {
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf('// ---------- Game data ----------');
  const b = s.indexOf('// ---------- Rendering: Plan ----------');
  const fn = new Function('localStorage', 'matchMedia', 'document', '"use strict";\n' + s.slice(a, b) + '\nreturn { compute, JOB, JOBS, GAME_ORDER, normSettings, normWorker };');
  const store = {};
  return fn({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, () => ({ matches: false }), undefined);
}
const T = load(APP);
const F = JSON.parse(fs.readFileSync(path.join(FIX, 'check-live.json'), 'utf8'));
const IMG_FILES = ['tabelle-1.jpg', 'tabelle-2.jpg'].map(f => path.join(FIX, f));
let IMGS = IMG_FILES;   // the group's real photos; without them (the repo copy keeps only the JSON) two drawn stand-ins
const ANIM_KEY = 'bellwright-anim-v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));
const joinDe = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' und ' + a[a.length - 1] : (a[0] || '');
const xs = v => v === 0 ? 'X' : String(v);
// JSON with sorted keys: documents are compared by content, not by the order their fields were written in.
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x);

// ---------- the group's data and what the app's planner says about it ----------
const SEED_W = Object.fromEntries(F.workers.map(w => [w.id, { name: w.name, role: w.role, traits: w.traits, order: w.order, stats: w.stats }]));
const roster = F.workers.map(w => T.normWorker(w.id, w)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
const S = T.normSettings(F.settings);
const ID = Object.fromEntries(roster.map(w => [w.name, w.id]));
const NAME = Object.fromEntries(roster.map(w => [w.id, w.name]));
const anchorOf = ing => Object.fromEntries(Object.entries(ing).map(([k, v]) => [k, v.vals]));
const cellVal = c => c.off ? 0 : c.p;
const planOf = (anchor, prefs) => T.compute(roster, S, { calm: !!S.calm, anchor, prefs: prefs || {} });
const PLAN0 = planOf(anchorOf(F.ingame));
// The game as the photos show it: {wid: {jobId: 0..9}} for all 13 columns (X = 0).
const ROWVALS = Object.fromEntries(Object.entries(F.photoRows).map(([n, r]) => [n, r.split(' ').map(x => x === 'X' ? 'X' : +x)]));
const GAME = Object.fromEntries(Object.entries(ROWVALS).map(([n, v]) => [ID[n], Object.fromEntries(T.GAME_ORDER.map((id, i) => [id, v[i] === 'X' ? 0 : v[i]]))]));
// What the result must say per villager (compared: the switched-on jobs only, against the CURRENT plan).
function expectFor(plan, game) {
  const out = {};
  for (const w of plan.team) {
    const g = game[w.id];
    if (!g) continue;
    const lines = plan.jobs.filter(j => g[j.id] !== cellVal(plan.cells[w.id][j.id]))
      .map(j => ({ job: j.id, txt: `${j.label}: im Spiel ${xs(g[j.id])}, Plan ${xs(cellVal(plan.cells[w.id][j.id]))}`, g: g[j.id] }));
    const ones = plan.jobs.filter(j => g[j.id] === 1).map(j => j.label);
    out[w.id] = { lines, ones, warn: ones.length >= 2 ? `${w.name} hat ${joinDe(ones)} auf 1 – das Spiel wählt dann zufällig. ${ones.length === 2 ? 'Stellt einen davon auf 2.' : 'Stellt alle bis auf einen auf 2.'}` : null };
  }
  return out;
}
const EXP = expectFor(PLAN0, GAME);
const DIFF_IDS = roster.filter(w => EXP[w.id] && EXP[w.id].lines.length).map(w => w.id);
const OK_IDS = roster.filter(w => EXP[w.id] && !EXP[w.id].lines.length).map(w => w.id);
// The plan after "Übernehmen": the game's numbers (switched-on jobs) as the snapshot of every villager written
// (all but `skip`, who keep their snapshot), plus the Festlegungen from "So lassen".
const gameSnap = id => Object.fromEntries(PLAN0.jobs.map(j => [j.id, GAME[id][j.id]]));
const planAfter = (skip = [], prefs = {}) => planOf({ ...anchorOf(F.ingame), ...Object.fromEntries(roster.filter(w => !skip.includes(w.id)).map(w => [w.id, gameSnap(w.id)])) }, prefs);
// "Dadurch ändert sich auch der Plan": every number that moves against the plan now, except the lines kept with
// "So lassen" ("wid|jobId"), one entry per villager in roster order.
const rippleOf = (after, kept = new Set()) => PLAN0.team.map(w => ({ w, parts: PLAN0.jobs.filter(j => !kept.has(w.id + '|' + j.id) && cellVal(after.cells[w.id][j.id]) !== cellVal(PLAN0.cells[w.id][j.id]))
  .map(j => `${j.label} ${xs(cellVal(after.cells[w.id][j.id]))} statt ${xs(cellVal(PLAN0.cells[w.id][j.id]))}`) })).filter(x => x.parts.length).map(x => `${x.w.name}: ${x.parts.join(', ')}`);
const rippleNames = list => list.map(s => s.slice(0, s.indexOf(':')));

// The sample's answer: the two photos as the lead transcribed them, names cut off as on screen.
const PHOTO1 = ['Arnold Dixon', 'Crimson Reid', 'Elyza Gernier', 'Fabian Renard', 'Helene Colley', ['Hubert Gernier', 'Hubert Ger…'], 'Imka Durham', 'Jane Hodge', 'Jane Rhodes',
  'Joan Reinfred', 'Jocelyn Fresin', ['Krystoffer Blavier', 'Krystoffer B…'], ['Larkin Reinold', 'Larkin Rein…'], ['Leopold Edgeworth', 'Leopold Edg…'], ['Lubomir Netterby', 'Lubomir Ne…']];
const PHOTO2 = [['Leopold Edgeworth', 'Leopold Edg…'], ['Lubomir Netterby', 'Lubomir Ne…'], ['Michel Warwick', 'Michel War…'], ['Milon Hamnet', 'Milon Ham…'], 'Nell Terrin', 'Nuttel',
  ['Ondrej Barrington', 'Ondrej Barr…'], ['Phoebe Graves', 'Phoebe Gra…'], ['Robert Adelard', 'Robert Adel…'], 'Royce Sykes', 'Rudy Kemper', 'Sal Farman', ['Sam Kinborough', 'Sam Kinbor…'],
  'Saul Belsante', 'Saul Lovell'];
const RESEARCH = T.GAME_ORDER.indexOf('research');
const rowOf = e => { const [full, shown] = Array.isArray(e) ? e : [e, e]; return { name: shown, values: ROWVALS[full].slice(), unsure: full === 'Saul Lovell' ? [RESEARCH] : [] }; };
const REPLY = { rows: [...PHOTO1, ...PHOTO2].map(rowOf), note: '' };
const HOWTO = 'Im Spiel: Bevölkerung → oben rechts „Arbeitsprioritäten“. Fotografiert die Tabelle so, dass links die Namen und alle Spalten zu sehen sind. Bei vielen Bewohnern 2–3 Fotos, jeweils weiter gescrollt.';

// ---------- fake server and page stub (lazy collections) ----------
function makeServer(seed = {}) {
  const maps = new Map();
  const col = c => { if (!maps.has(c)) maps.set(c, new Map()); return maps.get(c); };
  const srv = { col, log: [], pages: new Set() };
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) col(c).set(id, clone(d));
  srv.docs = c => [...col(c)].map(([id, d]) => [id, clone(d)]);
  srv.obj = c => Object.fromEntries(srv.docs(c));
  srv.broadcast = c => { const docs = srv.docs(c); for (const p of srv.pages) p.evaluate(([c, docs]) => window.__deliver && window.__deliver(c, docs), [c, docs]).catch(() => {}); };
  srv.write = async (who, op, c, id, d) => {
    await sleep(60);
    if (op === 'set') col(c).set(id, clone(d)); else col(c).delete(id);
    srv.log.push({ who, op, c, id, d: d && clone(d) });
    setTimeout(() => srv.broadcast(c), 10);
  };
  return srv;
}
// cfg: { name, inClaude, writable, user, sample: undefined (works) | null | 'noImages', anim, costSeen, seedLs }
function STUB(cfg) {
  try {
    if (cfg.anim) localStorage.setItem('bellwright-anim-v1', JSON.stringify(cfg.anim));
    if (cfg.costSeen !== false) localStorage.setItem('bellwright-kosten-info-v1', 'true');
    if (cfg.seedLs && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(cfg.seedLs)) localStorage.setItem(k, JSON.stringify(v)); }
  } catch (e) { /* ignore */ }
  window.__calls = [];
  window.__reply = { rows: [] };
  window.__err = null;
  window.__wait = 150;
  let sample = null;
  if (cfg.sample !== null) {
    sample = async () => ({ text: '' });
    sample.limits = cfg.sample === 'noImages' ? async () => ({ maxPromptBytes: 262144 })
      : async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
    sample.json = (input, opts) => new Promise((res, rej) => {
      window.__calls.push({ input, n: opts && opts.images ? opts.images.length : 0, types: opts && opts.images ? [...opts.images].map(b => b.type) : [], cache: opts && opts.cache, t: Date.now() });
      const sig = opts && opts.signal;
      const t = setTimeout(() => { if (window.__err) rej(window.__err); else res(JSON.parse(JSON.stringify(window.__reply))); }, window.__wait);
      if (sig) sig.addEventListener('abort', () => { clearTimeout(t); rej({ code: 'cancelled', message: 'stop' }); });
    });
  }
  if (!cfg.inClaude) { window.claude = { use: async n => (n === 'sample' ? sample : null) }; return; }
  const colL = new Map(), docL = new Map();
  const list = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const clone = d => JSON.parse(JSON.stringify(d));
  const snapC = docs => ({ docs: docs.map(([id, d]) => ({ id, exists: true, data: () => clone(d), metadata: {} })), size: docs.length, empty: !docs.length, metadata: {}, docChanges: () => [] });
  const snapD = (docs, id) => { const e = docs.find(x => x[0] === id); return { id, exists: !!e, data: () => (e ? clone(e[1]) : undefined), metadata: {} }; };
  window.__deliver = (c, docs) => {
    for (const f of colL.get(c) || []) f(snapC(docs));
    for (const [k, fs] of docL) if (k.startsWith(c + '/')) for (const f of fs) f(snapD(docs, k.slice(c.length + 1)));
  };
  const refuse = () => Promise.reject({ code: 'invalid_argument', message: 'below the write level' });
  const docRef = (c, id) => ({
    set: d => cfg.writable ? window.__srvWrite(cfg.name, 'set', c, id, clone(d)) : refuse(),
    delete: () => cfg.writable ? window.__srvWrite(cfg.name, 'delete', c, id, null) : refuse(),
    onSnapshot: n => { list(docL, c + '/' + id).push(n); window.__srvRead(c).then(docs => n(snapD(docs, id))); return () => {}; },
  });
  const db = Object.freeze({
    collection: c => ({ doc: id => docRef(c, id), onSnapshot: n => { list(colL, c).push(n); window.__srvRead(c).then(docs => n(snapC(docs))); return () => {}; } }),
    doc: p => { const [c, id] = p.split('/'); return docRef(c, id); },
  });
  const u = cfg.user;
  const user = !u ? null : Object.freeze({
    isOwner: async () => !!u.owner, id: async () => u.id || null, can: async n => (n === 'data.write' ? u.can : false),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: i === 'u_a' ? 'Gabriel' : '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : n === 'sample' ? sample : null) };
}

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 1200) : '')); };
const errs = [];
async function section(name, fn) { try { await fn(); } catch (e) { check(`${name}: runs to the end`, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } }
async function phone(browser, srv, cfg, { width = 390, height = 844, hash = '#plan', reducedMotion } = {}) {
  const mobile = width < 900;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, ...(reducedMotion ? { reducedMotion } : {}) });
  ctx.setDefaultTimeout(5000);
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push((cfg.name || '?') + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g(oogleapis|static)\.com|Failed to load resource/.test(m.text())) errs.push((cfg.name || '?') + ' console: ' + m.text()); });
  if (srv) {
    await ctx.exposeFunction('__srvWrite', (who, op, c, id, d) => srv.write(who, op, c, id, d));
    await ctx.exposeFunction('__srvRead', c => srv.docs(c));
    srv.pages.add(page);
    page.on('close', () => srv.pages.delete(page));
  }
  await page.addInitScript(STUB, cfg);
  await page.goto('file://' + process.cwd() + '/page.html' + hash);
  await page.waitForTimeout(500);
  return { ctx, page };
}
async function until(fn, max = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(30); }
  return -1;
}
const owner = { id: 'u_a', owner: true, can: true };
const lena = { id: 'u_b', owner: false, can: true };
const viewer = { id: 'u_ro', owner: false, can: false };
const seedAll = (ingame = F.ingame) => ({ workers: SEED_W, settings: { main: F.settings }, ingame });

// Everything the check shows.
const CK = page => page.evaluate(() => {
  const $ = s => document.querySelector(s);
  const vis = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const t = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  const box = $('#check'), res = $('#check-result');
  const btn = $('#check-open');
  return {
    btn: btn ? { shown: vis(btn), text: t(btn), expanded: btn.getAttribute('aria-expanded'), inHead: !!btn.closest('.grid-head') } : null,
    open: vis(box), result: vis(res),
    head: box ? t(box.querySelector('#check-h')) : null, howto: box ? t(box.querySelector('#check-howto')) : null,
    read: $('#check-read') ? { shown: vis($('#check-read')), disabled: $('#check-read').disabled, text: t($('#check-read')) } : null,
    stop: vis($('#check-stop')), msg: t($('#check-msg')), thumbs: document.querySelectorAll('#check-thumbs .thumb').length,
    title: res ? t(res.querySelector('#check-title')) : null, sum: res ? t(res.querySelector('.ck-sum')) : null,
    assign: res ? [...res.querySelectorAll('.ck-assign .ck-row')].filter(vis).map(r => { const s = r.querySelector('select'); return { k: r.dataset.row, read: t(r.querySelector('.ck-read')), val: s.value, opts: [...s.options].map(o => ({ v: o.value, t: o.textContent, dis: o.disabled })) }; }) : [],
    cards: res ? [...res.querySelectorAll('.ck-card')].filter(vis).map(c => ({
      wid: c.dataset.wid, name: t(c.querySelector('h4')), chips: [...c.querySelectorAll('.ck-chip')].map(t), fine: t(c.querySelector('.ck-fine')),
      warn: [...c.querySelectorAll('.ck-warn')].filter(vis).map(t),
      lines: [...c.querySelectorAll('.ck-line')].filter(vis).map(l => { const s = l.querySelector('select'), f = l.querySelector('[data-ck="fix"]'), k = l.querySelector('[data-ck="keep"]'), ok = l.querySelector('[data-ck="ok"]');
        return { job: l.dataset.job, txt: t(l.querySelector('.ck-txt')), fix: f && vis(f) ? f.getAttribute('aria-pressed') : null, keep: k && vis(k) ? k.getAttribute('aria-pressed') : null, sel: s ? s.value : null, ok: !!ok && vis(ok), hint: vis(l.querySelector('.ck-hint')) ? t(l.querySelector('.ck-hint')) : null }; }),
    })) : [],
    explain: res ? t(res.querySelector('.ck-explain')) : null,
    ripple: res && vis(res.querySelector('.ck-ripple')) ? { head: t(res.querySelector('.ck-ripple h4')), text: t(res.querySelector('.ck-ripple p')), items: [...res.querySelectorAll('.ck-ripple li')].map(t) } : null,
    ok: res && vis(res.querySelector('.ck-ok')) ? { sum: t(res.querySelector('.ck-ok summary')), names: t(res.querySelector('.ck-oknames')), open: res.querySelector('.ck-ok').open } : null,
    miss: res && vis(res.querySelector('.ck-miss')) ? t(res.querySelector('.ck-miss')) : null,
    other: res && vis(res.querySelector('.ck-other')) ? t(res.querySelector('.ck-other')) : null,
    ro: res && vis(res.querySelector('.ck-ro')) ? t(res.querySelector('.ck-ro')) : null,
    apply: $('#check-apply') ? { shown: vis($('#check-apply')), text: t($('#check-apply')), disabled: $('#check-apply').disabled } : null,
    discard: vis($('#check-discard')), actMsg: t($('#check-act-msg')),
    bar: res && res.querySelector('.ck-act') ? getComputedStyle(res.querySelector('.ck-act')).position : null,
  };
});
const toastMsg = page => page.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : (t.querySelector('.toast-msg') || {}).textContent || ''; });
const toastAct = page => page.evaluate(() => { const b = document.querySelector('#toast:not([hidden]) .toast-act'); return b ? b.textContent : null; });
const readDone = async page => { await page.waitForTimeout(40); await until(() => page.evaluate(() => { const s = document.getElementById('check-stop'); return !s || s.hidden; }), 4000); await page.waitForTimeout(60); };
async function readTable(page, reply, files = IMGS) {
  if (!(await page.evaluate(() => { const b = document.getElementById('check'); return b && !b.hidden; }))) await page.click('#check-open');
  await page.setInputFiles('#check-file', files);
  await page.evaluate(r => { window.__reply = r; }, reply);
  await page.click('#check-read');
  await readDone(page);
}
const line = (c, job) => c && c.lines.find(l => l.job === job);
const cardOf = (r, wid) => r.cards.find(c => c.wid === wid);
const lineSel = (wid, job, what) => `#check-result .ck-card[data-wid="${wid}"] .ck-line[data-job="${job}"] ${what}`;

// Two JPEGs drawn like the table (only the files are sent; the stub answers with the transcription either way).
async function standIns(browser) {
  const ctx = await browser.newContext({ viewport: { width: 760, height: 760 } });
  const p = await ctx.newPage();
  const out = [];
  for (const [i, rows] of [PHOTO1, PHOTO2].entries()) {
    await p.setContent(`<body style="margin:0;background:#0d1b2a;color:#eee;font:20px Georgia">${rows.map(e => { const [full, shown] = Array.isArray(e) ? e : [e, e];
      return `<div style="display:flex;gap:8px;padding:8px 16px"><span style="width:190px">${shown}</span>${ROWVALS[full].map(v => `<b style="width:28px;text-align:center;border:1px solid #6af">${v === 'X' ? '⊘' : v}</b>`).join('')}</div>`; }).join('')}</body>`);
    out.push({ name: `tabelle-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: await p.screenshot({ type: 'jpeg', quality: 80 }) });
  }
  await ctx.close();
  return out;
}

(async () => {
  const browser = await chromium.launch();
  if (!IMG_FILES.every(f => fs.existsSync(f))) IMGS = await standIns(browser);
  try {
    // ===== 1) The group's real photos: owner, Korrigieren / So lassen, Übernehmen, the Eintragen-Modus, Rückgängig =====
    await section('1) real photos', async () => {
      check('fixture: 28 villagers, 28 transcribed rows, everybody ticked off at the plan', roster.length === 28 && Object.keys(F.photoRows).length === 28
        && roster.every(w => PLAN0.jobs.every(j => F.ingame[w.id] && F.ingame[w.id].vals[j.id] === cellVal(PLAN0.cells[w.id][j.id]))));
      check('fixture: the photos differ from the plan for 10 villagers (18 match)', DIFF_IDS.length === 10 && OK_IDS.length === 18, DIFF_IDS.map(id => NAME[id]));
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: owner, anim: 'aus' });
      const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: lena, anim: 'aus' }, { width: 1280, height: 900 });
      const P = A.page;
      let r = await CK(P);
      check('Plan tab: "Spiel prüfen (Foto)" in the plan head (tracking, workers, photos possible)', r.btn && r.btn.shown && r.btn.inHead && r.btn.text === 'Spiel prüfen (Foto)' && r.btn.expanded === 'false' && !r.open, r.btn);
      const bh = await P.$eval('#check-open', b => b.getBoundingClientRect().height);
      check('the button is >= 44 px tall on a phone', bh >= 44, bh);
      await P.click('#check-open'); await P.waitForTimeout(150);
      r = await CK(P);
      check('opens the panel "Spiel prüfen per Foto" with the how-to', r.open && r.head === 'Spiel prüfen per Foto' && r.howto === HOWTO && r.btn.expanded === 'true', { head: r.head, howto: r.howto });
      check('focus on the panel heading', await P.evaluate(() => document.activeElement && document.activeElement.id === 'check-h'));
      check('"Tabelle prüfen" waits for photos', r.read.shown && r.read.disabled && r.read.text === 'Tabelle prüfen', r.read);
      await P.setInputFiles('#check-file', IMGS);
      await P.waitForTimeout(150);
      r = await CK(P);
      check('two photos ready (thumbnails), "Tabelle prüfen" enabled', r.thumbs === 2 && !r.read.disabled, r);
      await P.evaluate(rep => { window.__reply = rep; window.__wait = 500; }, REPLY);
      await P.click('#check-read');
      await P.waitForTimeout(120);
      r = await CK(P);
      check('while Claude reads: message and "Stopp"', r.msg === 'Claude liest die Tabelle. Das dauert meist 10 bis 60 Sekunden.' && r.stop && r.read.disabled, r.msg);
      await readDone(P);
      const call = await P.evaluate(() => window.__calls[0]);
      check('one Claude call with both photos (as JPEG), not cached', (await P.evaluate(() => window.__calls.length)) === 1 && call.n === 2 && call.types.every(x => x === 'image/jpeg') && call.cache === false, call && { n: call.n, cache: call.cache, types: call.types });
      const pr = call.input;
      fs.writeFileSync(path.join(SHOTS, 'table-prompt.txt'), pr);
      check('prompt: the table view, the 13 columns in the game order with their icons', /Arbeitsprioritäten/.test(pr)
        && ['0 Handwerk / Crafting (anvil)', '1 Schmelzen / Smelting (furnace)', '2 Ernte / Harvesting (berries)', '3 Landwirtschaft / Farming (sprout)', '4 Holzfällen / Woodcutting (axe)', '5 Lieferung / Delivery (chest)',
          '6 Kochen / Cooking (bowl)', '7 Jagen / Hunting (bow)', '8 Bau / Construction (hammer)', '9 Tierhaltung / Animal Handling (rabbit)', '10 Forschung / Researching (paper)', '11 Karawanenträger / Caravan (cart)', '12 Karawanenwache / Caravan Guard (shield)']
          .every((c, i, a) => pr.includes(c) && (i === 0 || pr.indexOf(a[i - 1]) < pr.indexOf(c))), pr.slice(0, 1600));
      check('prompt: every villager of the roster for matching', roster.every(w => pr.includes(JSON.stringify(w.name))));
      check('prompt: strict JSON rows {name, values (13: 1-9, "X" or null), unsure}; cut-off names stay cut off; the profession line is not the name',
        pr.includes('{"rows":[') && pr.includes('"values"') && pr.includes('"unsure"') && /exactly 13/.test(pr) && /"X"/.test(pr) && /null/.test(pr) && /…/.test(pr) && /Zimmermann/.test(pr));
      check('nothing written while checking', !srv.log.length, srv.log.slice(0, 3));
      r = await CK(P);
      check('done message', r.msg === '28 Bewohner erkannt. Prüft das Ergebnis unten.', r.msg);
      check('result: "Ergebnis", 28 villagers, nothing saved before "Übernehmen"', r.result && r.title === 'Ergebnis' && r.sum === '28 Bewohner auf den Fotos erkannt. Gespeichert wird erst mit „Übernehmen“.', { title: r.title, sum: r.sum });
      check('matching: all 28 assigned (cut-off names, the doubled rows merged), nobody to pick by hand, nobody missing', !r.assign.length && !r.miss
        && r.cards.length + (r.ok ? r.ok.names.split(/, | und /).length : 0) === 28, { assign: r.assign, miss: r.miss, cards: r.cards.length, ok: r.ok });
      check('the 10 villagers with differences each get a card, in roster order', JSON.stringify(r.cards.map(c => c.wid)) === JSON.stringify(DIFF_IDS), r.cards.map(c => c.name));
      const okNames = OK_IDS.map(id => NAME[id]);
      check('"✓ 18 stimmen", collapsed, with their names (Leopold once)', r.ok && r.ok.sum === '✓ 18 stimmen' && !r.ok.open && r.ok.names === joinDe(okNames) + '.' && (r.ok.names.match(/Leopold/g) || []).length === 1, r.ok);
      const wrong = [];
      for (const wid of DIFF_IDS) {
        const c = cardOf(r, wid), e = EXP[wid];
        const diffLines = c ? c.lines.filter(l => l.job !== 'research' || wid !== ID['Saul Lovell']) : [];
        if (!c || c.name !== NAME[wid] || JSON.stringify(diffLines.map(l => l.txt)) !== JSON.stringify(e.lines.map(l => l.txt))) wrong.push({ name: NAME[wid], got: c && c.lines.map(l => l.txt), want: e.lines.map(l => l.txt) });
      }
      check('every difference against the current plan: "Bau: im Spiel 1, Plan 7"', !wrong.length, wrong);
      const hc = cardOf(r, ID['Helene Colley']);
      check('Helene Colley: "Bau: im Spiel 1, Plan 7"', hc && line(hc, 'construction') && line(hc, 'construction').txt === 'Bau: im Spiel 1, Plan 7', hc);
      const warnBad = DIFF_IDS.filter(wid => JSON.stringify(cardOf(r, wid).warn) !== JSON.stringify(EXP[wid].warn ? [EXP[wid].warn] : []));
      check('two 1s: the warning on exactly the 7 villagers concerned', !warnBad.length && DIFF_IDS.filter(w => EXP[w].warn).length === 7, warnBad.map(w => ({ n: NAME[w], got: cardOf(r, w).warn, want: EXP[w].warn })));
      check('two 1s: "Helene Colley hat Kochen und Bau auf 1 – das Spiel wählt dann zufällig. Stellt einen davon auf 2."', hc && hc.warn[0] === 'Helene Colley hat Kochen und Bau auf 1 – das Spiel wählt dann zufällig. Stellt einen davon auf 2.', hc && hc.warn);
      check('two 1s: no "So lassen" for the 1s (Korrigieren only)', [ID['Helene Colley'], ID['Crimson Reid'], ID['Robert Adelard']].every(w => { const l = line(cardOf(r, w), 'construction'); return l && l.keep === null; }));
      const joan = cardOf(r, ID['Joan Reinfred']);
      check('a single 1 off the main job and an X: "Korrigieren" (pressed) and "So lassen" on each line', joan && ['woodcutting', 'construction'].every(j => { const l = line(joan, j); return l && l.fix === 'true' && l.keep === 'false'; }), joan);
      check('the explanation of the two buttons', r.explain === '„Korrigieren“: ihr stellt die Zahl im Spiel um, danach zeigt sie der Eintragen-Modus. „So lassen“: die Zahl bleibt im Spiel, der Plan rechnet damit (Festlegung).', r.explain);
      const saul = cardOf(r, ID['Saul Lovell']);
      const sr = line(saul, 'research');
      check('the unsure cell (Saul Lovell, Forschung under the cursor): "?", the value read in a picker, "stimmt"', sr && sr.txt === 'Forschung: im Spiel ?, Plan 5' && sr.sel === '5' && sr.ok && sr.keep === null, sr);
      check('cards say how many differ / need a look', JSON.stringify(cardOf(r, ID['Crimson Reid']).chips) === '["1 Unterschied"]' && JSON.stringify(joan.chips) === '["2 Unterschiede"]' && JSON.stringify(saul.chips) === '["2 Unterschiede","1 Feld prüfen"]', [cardOf(r, ID['Crimson Reid']).chips, joan.chips, saul.chips]);
      check('the action bar sticks to the bottom: "Verwerfen" and "Übernehmen"', r.bar === 'sticky' && r.discard && r.apply.shown && !r.apply.disabled && r.apply.text === 'Übernehmen', { bar: r.bar, apply: r.apply });
      // No surprises after Übernehmen (the real data): with the game's numbers as the snapshots the plan stays put.
      // Before BUILD 16's review a snapshot with two 1s lost its anchored main job: Jane Hodge and Larkin Reinold swapped
      // Jagen/Tierhaltung, and Jane's one difference became three.
      const FIX_ALL = planAfter();
      const todo = (plan, id) => plan.jobs.filter(j => GAME[id][j.id] !== cellVal(plan.cells[id][j.id])).map(j => j.id).join();
      check('Korrigieren everywhere: the 18 that match stay matching, each of the 10 others keeps exactly its corrections (Jane Hodge: Bau only)',
        OK_IDS.every(id => todo(FIX_ALL, id) === '') && DIFF_IDS.every(id => todo(FIX_ALL, id) === EXP[id].lines.map(l => l.job).join()) && todo(FIX_ALL, ID['Jane Hodge']) === 'construction',
        roster.filter(w => todo(FIX_ALL, w.id) !== (EXP[w.id].lines.map(l => l.job).join())).map(w => ({ n: w.name, now: todo(FIX_ALL, w.id) })));
      check('Korrigieren everywhere: main jobs stay', FIX_ALL.team.every(w => FIX_ALL.main[w.id] === PLAN0.main[w.id]), FIX_ALL.team.filter(w => FIX_ALL.main[w.id] !== PLAN0.main[w.id]).map(w => w.name));
      check('the only number that moves: Crimson Reid Bau 7 statt 8 (8 was kept because the game supposedly had 8; it has 1)', JSON.stringify(rippleOf(FIX_ALL)) === '["Crimson Reid: Bau 7 statt 8"]', rippleOf(FIX_ALL));
      // ... and the result says so before Übernehmen (Saul Lovell, with his "?" open, is not written yet).
      const RIP_HEAD = 'Dadurch ändert sich auch der Plan';
      const ripText = keeps => `Nach dem Übernehmen rechnet der Plan mit den Zahlen aus dem Spiel${keeps ? ' und euren Festlegungen' : ''}. An diesen Stellen schlägt er dann etwas anderes vor:`;
      const rip0 = rippleOf(planAfter([ID['Saul Lovell']]));
      check('"Dadurch ändert sich auch der Plan": the numbers that move after Übernehmen, before it', r.ripple && r.ripple.head === RIP_HEAD && r.ripple.text === ripText(false) && JSON.stringify(r.ripple.items) === JSON.stringify(rip0) && rip0.length >= 1, { got: r.ripple, want: rip0 });
      // So lassen: Joan keeps Bau 1 (one 1, not the main job -> lockMain) and Holzfällen X (pin 0); Phoebe keeps Handwerk X.
      await P.click(lineSel(ID['Joan Reinfred'], 'construction', '[data-ck="keep"]'));
      await P.waitForTimeout(80);
      r = await CK(P);
      const keptJ = new Set([ID['Joan Reinfred'] + '|construction']);
      const rip1 = rippleOf(planAfter([ID['Saul Lovell']], { [ID['Joan Reinfred']]: { lockMain: 'construction', pins: {} } }), keptJ);
      const added1 = rippleNames(rip1).filter(n => !rippleNames(rip0).includes(n));
      check('"So lassen" Bau as main job for Joan: the result lists what it moves', r.ripple && r.ripple.text === ripText(true) && JSON.stringify(r.ripple.items) === JSON.stringify(rip1) && added1.length >= 1, { got: r.ripple && r.ripple.items, want: rip1 });
      check('... and the action bar says who else changes (announced)', r.actMsg === `Dadurch ändert sich auch der Plan bei ${joinDe(added1)}.`, { msg: r.actMsg, added1 });
      await P.click(lineSel(ID['Joan Reinfred'], 'woodcutting', '[data-ck="keep"]'));
      await P.click(lineSel(ID['Phoebe Graves'], 'crafting', '[data-ck="keep"]'));
      await P.waitForTimeout(80);
      r = await CK(P);
      const jb = line(cardOf(r, ID['Joan Reinfred']), 'construction'), jw = line(cardOf(r, ID['Joan Reinfred']), 'woodcutting'), pc = line(cardOf(r, ID['Phoebe Graves']), 'crafting');
      check('"So lassen" pressed, with what will be fixed', jb.keep === 'true' && jb.fix === 'false' && jb.hint === 'Wird festgelegt: Bau als Hauptjob.' && jw.hint === 'Wird festgelegt: Holzfällen bleibt X.' && pc.hint === 'Wird festgelegt: Handwerk bleibt X.', { jb, jw, pc });
      check('focus stays on the button that was pressed', await P.evaluate(() => { const a = document.activeElement; return !!a && a.dataset.ck === 'keep' && a.closest('.ck-line').dataset.job === 'crafting'; }));
      check('still nothing written', !srv.log.length);
      // Übernehmen with the "?" still open: asks again, and says what stays out.
      await P.click('#check-apply'); await P.waitForTimeout(60);
      r = await CK(P);
      check('first tap with one "?" open: "Trotzdem übernehmen (1 offen)" and why', r.apply.text === 'Trotzdem übernehmen (1 offen)' && r.actMsg === 'Eine Stelle ist noch offen (mit ? oder ohne Zuordnung). Diese Bewohner bleiben, wie sie sind. Tippt noch einmal, um den Rest zu übernehmen.' && !srv.log.length, { apply: r.apply, msg: r.actMsg });
      await P.click(lineSel(ID['Saul Lovell'], 'research', '[data-ck="ok"]')); await P.waitForTimeout(80);
      r = await CK(P);
      const sr2 = line(cardOf(r, ID['Saul Lovell']), 'research');
      const PREFS_K = { [ID['Joan Reinfred']]: { lockMain: 'construction', pins: { woodcutting: 0 } }, [ID['Phoebe Graves']]: { lockMain: null, pins: { crafting: 0 } } };
      const keptAll = new Set([ID['Joan Reinfred'] + '|construction', ID['Joan Reinfred'] + '|woodcutting', ID['Phoebe Graves'] + '|crafting']);
      const ripAll = rippleOf(planAfter([], PREFS_K), keptAll);
      const addedS = rippleNames(ripAll).filter(n => !rippleNames(rippleOf(planAfter([ID['Saul Lovell']], PREFS_K), keptAll)).includes(n));
      check('"stimmt": the cell is confirmed ("wie im Plan"), the guard is off again', sr2 && sr2.txt === 'Forschung: im Spiel 5 – wie im Plan' && !sr2.ok && JSON.stringify(cardOf(r, ID['Saul Lovell']).chips) === '["2 Unterschiede"]' && r.apply.text === 'Übernehmen'
        && r.actMsg === (addedS.length ? `Dadurch ändert sich auch der Plan bei ${joinDe(addedS)}.` : ''), { sr2, apply: r.apply, msg: r.actMsg, addedS });
      check('before Übernehmen: the list holds every number the plan will move', r.ripple && JSON.stringify(r.ripple.items) === JSON.stringify(ripAll), { got: r.ripple && r.ripple.items, want: ripAll });
      const said = r;   // what the result said right before Übernehmen
      const t0 = Date.now();
      await P.click('#check-apply');
      await until(async () => srv.log.filter(x => x.c === 'ingame').length >= 28 && srv.log.filter(x => x.c === 'prefs').length >= 2, 4000);
      await P.waitForTimeout(150);
      // ingame = the game, for every villager (the switched-on jobs), by the one who applied
      const ing = srv.obj('ingame');
      const badIng = roster.filter(w => { const d = ing[w.id], want = Object.fromEntries(PLAN0.jobs.map(j => [j.id, GAME[w.id][j.id]])); return !d || canon(d.vals) !== canon(want) || d.by !== 'u_a' || !(d.at >= t0 - 50); });
      check('Übernehmen: every villager\'s shared snapshot is now the game (28 docs, by the owner, now)', !badIng.length && srv.log.filter(x => x.c === 'ingame').length === 28, badIng.map(w => ({ n: w.name, d: ing[w.id] })));
      const pf = srv.obj('prefs');
      const PREFS1 = { [ID['Joan Reinfred']]: { lockMain: 'construction', pins: { woodcutting: 0 } }, [ID['Phoebe Graves']]: { lockMain: null, pins: { crafting: 0 } } };
      check('"So lassen" became Festlegungen: Joan Bau as main job + Holzfällen X, Phoebe Handwerk X; nobody else', canon(pf) === canon(PREFS1), pf);
      check('only ingame, prefs and (BUILD 17) checks were written (no worker or settings docs)', srv.log.every(x => x.c === 'ingame' || x.c === 'prefs' || x.c === 'checks'), [...new Set(srv.log.map(x => x.c))]);
      r = await CK(P);
      check('the check closes after Übernehmen', !r.open && !r.result && r.btn.expanded === 'false', r);
      const PLAN1 = planOf(Object.fromEntries(roster.map(w => [w.id, ing[w.id].vals])), PREFS1);
      const open1 = PLAN1.team.filter(w => PLAN1.jobs.some(j => ing[w.id].vals[j.id] !== cellVal(PLAN1.cells[w.id][j.id]))).map(w => w.id);
      const tm = await toastMsg(P);
      check('toast: what was taken, with Rückgängig', tm === `Spielstand von 28 Bewohnern übernommen. ${open1.length} haben Zahlen zum Nachziehen.` && await toastAct(P) === 'Rückgängig', { tm, open: open1.length });
      await P.hover('#toast');   // holds the toast while the second phone looks
      // the other phone: matching villagers ticked off, the others open in the Eintragen-Modus with exactly "von <game> → <plan>"
      await until(() => B.page.evaluate(n => { const b = document.getElementById('entry-banner'); return b && !b.hidden && b.textContent.includes(n + ' Bewohner'); }, open1.length), 3000);
      const ban = await B.page.evaluate(() => document.getElementById('entry-banner-text').textContent);
      check(`phone B: the banner counts the ${open1.length} villagers with numbers to change`, ban.startsWith(`${open1.length} Bewohner ${open1.length === 1 ? 'hat' : 'haben'} neue Zahlen`), ban);
      const ticked = await B.page.evaluate(() => [...document.querySelectorAll('#plan-view tr[data-fokus]')].filter(tr => tr.querySelector('.tick.done')).map(tr => tr.dataset.fokus));
      const wantTicked = roster.filter(w => !open1.includes(w.id)).map(w => w.id);
      check('phone B: every villager whose game now equals the plan is ticked off (all 18 that matched among them)', JSON.stringify(ticked) === JSON.stringify(wantTicked) && OK_IDS.filter(id => !open1.includes(id)).every(id => ticked.includes(id)), { ticked: ticked.map(i => NAME[i]), want: wantTicked.map(i => NAME[i]) });
      await B.page.click('#entry-banner-go'); await B.page.waitForTimeout(150);
      const seenEntry = [];
      for (let k = 0; k < open1.length; k++) {
        seenEntry.push(await B.page.evaluate(() => ({ name: document.getElementById('entry-name').textContent, rows: [...document.querySelectorAll('#entry-stage .entry-card .er-row.diff')].map(r => ({ job: r.dataset.job, from: r.querySelector('.er-from').firstChild.textContent.trim(), to: r.querySelector('.er-to').textContent.trim() })) })));
        await B.page.keyboard.press('ArrowRight'); await B.page.waitForTimeout(60);
      }
      const wantEntry = open1.map(id => ({ name: NAME[id], rows: PLAN1.jobs.filter(j => ing[id].vals[j.id] !== cellVal(PLAN1.cells[id][j.id])).map(j => ({ job: j.id, from: 'von ' + xs(ing[id].vals[j.id]), to: xs(cellVal(PLAN1.cells[id][j.id])) })) }));
      check('Eintragen-Modus: exactly the open villagers, each row "von <im Spiel> → <Plan>"', JSON.stringify(seenEntry) === JSON.stringify(wantEntry), { seen: seenEntry.slice(0, 4), want: wantEntry.slice(0, 4) });
      const hcE = seenEntry.find(x => x.name === 'Helene Colley');
      check('Eintragen-Modus: Helene Colley "Bau von 1 → 7"', hcE && hcE.rows.some(x => x.job === 'construction' && x.from === 'von 1' && x.to === '7'), hcE);
      // No surprises: every number the Eintragen-Modus asks for was in the result (a card line, or the list of what moves).
      const unsaid = [];
      for (const v of seenEntry) for (const row of v.rows) {
        const lab = T.JOB[row.job].label, g = row.from.slice(4), c = said.cards.find(x => x.name === v.name), l = c && line(c, row.job);
        const item = said.ripple && said.ripple.items.find(s => s.startsWith(v.name + ': '));
        const parts = item ? item.slice(v.name.length + 2).split(', ') : [];
        const moved = parts.find(p => p.startsWith(lab + ' '));
        const ok = moved ? moved.startsWith(`${lab} ${row.to} statt `) : !!l && l.txt === `${lab}: im Spiel ${g}, Plan ${row.to}`;
        if (!ok) unsaid.push(`${v.name} ${lab} ${row.from} → ${row.to}`);
      }
      check('no surprises: every number the Eintragen-Modus asks for was announced in the result', !unsaid.length && seenEntry.length >= 10, unsaid);
      await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(80);
      // Rückgängig: the earlier snapshots and Festlegungen come back for everyone
      check('the toast is still there for Rückgängig', await toastAct(P) === 'Rückgängig');
      await P.click('#toast .toast-act');
      await until(async () => canon(srv.obj('ingame')) === canon(F.ingame) && !srv.docs('prefs').length, 4000);
      check('Rückgängig: every earlier snapshot (vals, by, at) and no Festlegungen again', canon(srv.obj('ingame')) === canon(F.ingame) && !srv.docs('prefs').length, { prefs: srv.obj('prefs') });
      check('Rückgängig toast', (await toastMsg(P)) === 'Rückgängig gemacht.', await toastMsg(P));
      await until(() => B.page.evaluate(() => document.getElementById('entry-banner').hidden), 2000);
      check('phone B: nothing open again after Rückgängig', await B.page.evaluate(() => document.getElementById('entry-banner').hidden && document.querySelectorAll('#plan-view .tick.done').length === 28));
      await A.ctx.close(); await B.ctx.close();
    });

    // ===== 2) Rows the app cannot place, a cell nobody could read, a missing villager, "So lassen" on a 4 =====
    await section('2) edge cases', async () => {
      const rep = clone(REPLY);
      const byShown = n => rep.rows.find(x => x.name === n);
      byShown('Jane Rhodes').name = 'Jane …';                                  // fits both Janes
      rep.rows.push({ name: 'Gunther Moss', values: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], unsure: [] });   // nobody of ours
      rep.rows = rep.rows.filter(x => x.name !== 'Nuttel');                    // not on the photos
      byShown('Arnold Dixon').values[6] = null;                               // Kochen unreadable
      byShown('Elyza Gernier').values[6] = 4;                                 // Kochen 4, the plan says 3
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'E', inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: 360, height: 740 });
      const P = A.page;
      await readTable(P, rep);
      let r = await CK(P);
      check('two rows to place by hand ("Wer ist das?"), the rest matched', r.assign.length === 2 && r.assign[0].read.startsWith('„Jane …“') && r.assign[1].read === '„Gunther Moss“: 5 5 5 5 5 5 5 5 5 5 5 5 5', r.assign.map(a => a.read));
      await P.evaluate(() => document.querySelector('#check-result .ck-assign').scrollIntoView({ block: 'start' })); await P.waitForTimeout(80);
      await P.screenshot({ path: path.join(SHOTS, 'check-360-assign.png') });
      const ja = r.assign[0];
      check('"Jane …": nothing preselected; the two Janes first; Jane Hodge (already on another row) cannot be picked twice; "Niemand"', ja.val === '' && ja.opts[0].t === 'bitte wählen' && ja.opts[1].v === '-' && ja.opts[1].t === 'Niemand (nicht übernehmen)'
        && ja.opts[2].v === ID['Jane Hodge'] && ja.opts[2].dis && ja.opts[2].t === 'Jane Hodge (schon zugeordnet)' && ja.opts[3].v === ID['Jane Rhodes'] && !ja.opts[3].dis && ja.opts.length === 2 + 28, ja.opts.slice(0, 5));
      check('not on the photos (yet): "Nicht auf den Fotos: Jane Rhodes und Nuttel." (Jane Rhodes until her row is placed)', r.miss === 'Nicht auf den Fotos: Jane Rhodes und Nuttel.', r.miss);
      const ar = line(cardOf(r, ID['Arnold Dixon']), 'cooking');
      check('Arnold Dixon\'s unreadable Kochen: "?" with an empty picker, no "stimmt" yet', ar && ar.txt === 'Kochen: im Spiel ?, Plan 7' && ar.sel === '' && !ar.ok, ar);
      const el = line(cardOf(r, ID['Elyza Gernier']), 'cooking');
      check('Elyza Gernier "Kochen: im Spiel 4, Plan 3" with Korrigieren / So lassen', el && el.txt === 'Kochen: im Spiel 4, Plan 3' && el.fix === 'true' && el.keep === 'false', el);
      // apply now: 4 open (2 rows, Arnold's ?, Saul's ?)
      await P.click('#check-apply'); await P.waitForTimeout(60);
      r = await CK(P);
      await P.screenshot({ path: path.join(SHOTS, 'check-360-armed.png') });
      check('4 open: "Trotzdem übernehmen (4 offen)"', r.apply.text === 'Trotzdem übernehmen (4 offen)' && r.actMsg.startsWith('4 Stellen sind noch offen') && !srv.log.length, { apply: r.apply, msg: r.actMsg });
      await P.selectOption(`#check-result .ck-row[data-row="${r.assign[1].k}"] select`, '-'); await P.waitForTimeout(60);
      await P.selectOption(`#check-result .ck-row[data-row="${r.assign[0].k}"] select`, ID['Jane Rhodes']); await P.waitForTimeout(60);
      await P.selectOption(lineSel(ID['Arnold Dixon'], 'cooking', 'select'), '7'); await P.waitForTimeout(60);
      await P.click(lineSel(ID['Elyza Gernier'], 'cooking', '[data-ck="keep"]')); await P.waitForTimeout(60);
      r = await CK(P);
      const ar2 = line(cardOf(r, ID['Arnold Dixon']), 'cooking');
      check('picked: both rows placed (they stay listed with the choice, so a wrong pick can be changed), "Nicht auf den Fotos: Nuttel.", Arnold\'s Kochen 7 confirmed, only Saul\'s "?" left',
        r.assign.length === 2 && r.assign[0].val === ID['Jane Rhodes'] && r.assign[1].val === '-' && r.miss === 'Nicht auf den Fotos: Nuttel.' && ar2.txt === 'Kochen: im Spiel 7 – wie im Plan' && r.apply.text === 'Trotzdem übernehmen (1 offen)', { assign: r.assign, miss: r.miss, ar2, apply: r.apply });
      check('Jane Rhodes is compared now (no differences: in "stimmen")', r.ok && r.ok.names.includes('Jane Rhodes'), r.ok);
      check('the placed rows are marked done', await P.evaluate(() => [...document.querySelectorAll('#check-result .ck-row')].every(x => x.classList.contains('done'))));
      check('Elyza: "So lassen" -> "Wird festgelegt: Kochen bleibt 4."', line(cardOf(r, ID['Elyza Gernier']), 'cooking').hint === 'Wird festgelegt: Kochen bleibt 4.');
      await P.click('#check-apply');
      await until(async () => srv.log.filter(x => x.c === 'ingame').length >= 26 && srv.log.some(x => x.c === 'prefs'), 4000);
      await P.waitForTimeout(150);
      const wr = [...new Set(srv.log.filter(x => x.c === 'ingame').map(x => x.id))];
      check('second tap: 26 villagers written (not Nuttel, not Saul with the open "?", nobody for Gunther)', wr.length === 26 && !wr.includes(ID['Nuttel']) && !wr.includes(ID['Saul Lovell']), wr.length);
      check('Saul and Nuttel keep their earlier snapshot', canon(srv.obj('ingame')[ID['Saul Lovell']]) === canon(F.ingame[ID['Saul Lovell']]) && canon(srv.obj('ingame')[ID['Nuttel']]) === canon(F.ingame[ID['Nuttel']]));
      check('Arnold\'s confirmed Kochen 7 and Jane Rhodes\'s row are in the snapshots', srv.obj('ingame')[ID['Arnold Dixon']].vals.cooking === 7 && srv.obj('ingame')[ID['Jane Rhodes']].vals.research === 1);
      check('"So lassen" on a 4: a pin Kochen 4 for Elyza', canon(srv.obj('prefs')) === canon({ [ID['Elyza Gernier']]: { lockMain: null, pins: { cooking: 4 } } }), srv.obj('prefs'));
      check('toast counts 26', (await toastMsg(P)).startsWith('Spielstand von 26 Bewohnern übernommen.'), await toastMsg(P));
      // Verwerfen: nothing written, everything closed
      const n0 = srv.log.length;
      await readTable(P, REPLY);
      await P.click('#check-discard'); await P.waitForTimeout(80);
      r = await CK(P);
      check('Verwerfen: closed, nothing written, focus back on "Spiel prüfen (Foto)"', !r.open && !r.result && srv.log.length === n0 && await P.evaluate(() => document.activeElement && document.activeElement.id === 'check-open'), { open: r.open, w: srv.log.length - n0 });
      await A.ctx.close();
    });

    // ===== 2b) A guard on the photos: matched, but not compared (the plan has no numbers for guards) =====
    await section('2b) guard', async () => {
      const W2 = clone(SEED_W); W2[ID['Royce Sykes']].role = 'guard';
      const srv = makeServer({ workers: W2, settings: { main: F.settings }, ingame: F.ingame });
      const A = await phone(browser, srv, { name: 'G', inClaude: true, writable: true, user: owner, anim: 'aus' });
      await readTable(A.page, REPLY);
      const r = await CK(A.page);
      check('a guard on the photos: "Nicht verglichen (keine Dorfarbeit): Royce Sykes (Wache)." and no card for him', r.other === 'Nicht verglichen (keine Dorfarbeit): Royce Sykes (Wache).' && !cardOf(r, ID['Royce Sykes']) && !(r.miss || '').includes('Royce'), { other: r.other, miss: r.miss });
      await A.ctx.close();
    });

    // ===== 3) A read-only viewer may check, but not apply =====
    await section('3) read-only', async () => {
      const srv = makeServer(seedAll());
      const V = await phone(browser, srv, { name: 'V', inClaude: true, writable: false, user: viewer, anim: 'aus' });
      let r = await CK(V.page);
      check('read-only: the button is there', r.btn && r.btn.shown, r.btn);
      await readTable(V.page, REPLY);
      r = await CK(V.page);
      check('read-only: the full result (10 cards, 18 match, warnings)', r.result && r.cards.length === 10 && r.ok && r.ok.sum === '✓ 18 stimmen' && cardOf(r, ID['Helene Colley']).warn.length === 1, r.cards.length);
      await V.page.evaluate(() => document.getElementById('check-title').scrollIntoView({ block: 'start' })); await V.page.waitForTimeout(80);
      await V.page.screenshot({ path: path.join(SHOTS, 'check-390-readonly.png') });
      check('read-only: a note, "Übernehmen" off, no "So lassen" choices, no list of what Übernehmen would move', r.ro === 'Nur ansehen: Ihr seht das Ergebnis, übernehmen könnt ihr hier nicht.' && r.apply.disabled
        && r.cards.every(c => c.lines.every(l => l.keep === null && l.fix === null)) && !r.ripple, { ro: r.ro, apply: r.apply, ripple: r.ripple });
      await V.page.click('#check-apply', { force: true }).catch(() => {});
      await V.page.waitForTimeout(200);
      check('read-only: nothing written', !srv.log.length, srv.log.slice(0, 2));
      // The plan changes on another phone (Forschung switched off): the result follows; focus on its heading stays.
      await V.page.focus('#check-title');
      const st = clone(F.settings); st.jobs.research.on = false;
      srv.col('settings').set('main', st); srv.broadcast('settings');
      await until(() => V.page.evaluate(() => !document.querySelector('#check-result .ck-line[data-job="research"]')), 3000);
      const after = await V.page.evaluate(() => ({ act: document.activeElement && document.activeElement.id, research: !!document.querySelector('#check-result .ck-line[data-job="research"]'), cards: document.querySelectorAll('#check-result .ck-card').length }));
      check('the result follows a plan change from elsewhere (Forschung off: no Forschung lines) and focus stays on its heading', !after.research && after.act === 'check-title', after);
      await V.ctx.close();
    });

    // ===== 4) Errors and when the button is not there =====
    await section('4) errors', async () => {
      const X0 = await phone(browser, null, { name: 'ex', inClaude: false });
      check('example team: no "Spiel prüfen (Foto)"', !(await CK(X0.page)).btn.shown);
      await X0.ctx.close();
      for (const [kind, label] of [[null, 'no sample'], ['noImages', 'no images in this view']]) {
        const srv = makeServer(seedAll());
        const X = await phone(browser, srv, { name: 'n' + kind, inClaude: true, writable: true, user: owner, sample: kind });
        check(`${label}: no "Spiel prüfen (Foto)"`, !(await CK(X.page)).btn.shown);
        await X.ctx.close();
      }
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'err', inClaude: true, writable: true, user: owner, anim: 'aus' });
      const P = A.page;
      await P.click('#check-open');
      await P.setInputFiles('#check-file', [...IMGS, IMGS[0], IMGS[1]]);
      await P.waitForTimeout(200);
      let r = await CK(P);
      check('at most 3 photos at once', r.thumbs === 3 && r.msg === 'Höchstens 3 Bilder auf einmal.', { n: r.thumbs, msg: r.msg });
      await P.click('#check-thumbs .thumb button'); await P.waitForTimeout(60);
      check('a photo can be removed again', (await CK(P)).thumbs === 2);
      // PC: a screenshot pasted (Strg+V) or dropped while the check is open goes into the check, not to the photo import.
      const into = kind => P.evaluate(async kind => {
        const c = document.createElement('canvas'); c.width = c.height = 8;
        const b = await new Promise(r => c.toBlob(r, 'image/png'));
        const dt = new DataTransfer(); dt.items.add(new File([b], 'shot.png', { type: 'image/png' }));
        document.dispatchEvent(kind === 'paste' ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 250));
        return { thumbs: document.querySelectorAll('#check-thumbs .thumb').length, plan: !document.getElementById('panel-plan').hidden, photo: document.querySelectorAll('#thumbs .thumb').length };
      }, kind);
      for (const kind of ['paste', 'drop']) {
        const x = await into(kind);
        check(`${kind} while the check is open: into the check (3 photos), the Plan tab stays, the photo import gets nothing`, x.thumbs === 3 && x.plan && x.photo === 0, x);
        await P.click('#check-thumbs .thumb:last-child button'); await P.waitForTimeout(60);
      }
      const cases = [
        [{ code: 'rate_limited', message: 'x' }, 'Euer Claude-Limit ist gerade erreicht. Versucht es später noch einmal oder vergleicht die Zahlen von Hand.'],
        [{ code: 'invalid_json', message: 'x' }, 'Die Antwort war nicht lesbar. Versucht es noch einmal, am besten mit einem schärferen Bild.'],
        [{ code: 'upstream_error', message: 'x' }, 'Die Verbindung wurde unterbrochen. Versucht es noch einmal.'],
      ];
      for (const [err, want] of cases) {
        const n0 = await P.evaluate(() => window.__calls.length);
        await P.evaluate(e => { window.__err = e; }, err);
        await P.click('#check-read'); await readDone(P);
        await P.waitForTimeout(err.code === 'rate_limited' ? 1200 : 0);
        r = await CK(P);
        check(`${err.code}: "${want}", one call, never retried, no result, read again possible`, r.msg === want && (await P.evaluate(() => window.__calls.length)) === n0 + 1 && !r.result && !r.read.disabled, { msg: r.msg, calls: await P.evaluate(() => window.__calls.length) - n0 });
      }
      await P.evaluate(() => { window.__err = null; window.__reply = { rows: [], note: 'Auf dem Bild ist das Hauptmenü zu sehen.' }; });
      await P.click('#check-read'); await readDone(P);
      check('no table: Claude\'s note', (await CK(P)).msg === 'Auf dem Bild ist das Hauptmenü zu sehen.');
      await P.evaluate(() => { window.__reply = { rows: [{ name: '', values: [] }] }; });
      await P.click('#check-read'); await readDone(P);
      check('no rows without a note: the app\'s own hint', (await CK(P)).msg === 'Auf den Bildern war keine Tabelle mit Arbeitsprioritäten zu erkennen. Fotografiert die Ansicht „Arbeitsprioritäten“ so, dass Namen und Zahlen scharf zu sehen sind.');
      // Only one row, and its Kochen could not be read: nothing to take yet.
      await P.evaluate(r => { window.__reply = r; }, { rows: [{ name: 'Arnold Dixon', values: ROWVALS['Arnold Dixon'].map((v, i) => i === 6 ? null : v), unsure: [6] }] });
      await P.click('#check-read'); await readDone(P);
      await P.click('#check-apply'); await P.waitForTimeout(80);
      r = await CK(P);
      check('nothing ready: "Noch nichts zu übernehmen. … mit „?“." and nothing written', r.actMsg === 'Noch nichts zu übernehmen. Ordnet die Zeilen zu oder bestätigt die Felder mit „?“.' && !srv.log.length, r.actMsg);
      await P.evaluate(() => { window.__wait = 3000; });
      await P.click('#check-read'); await P.waitForTimeout(100);
      await P.click('#check-stop'); await readDone(P);
      check('Stopp: "Abgebrochen."', (await CK(P)).msg === 'Abgebrochen.');
      await P.evaluate(() => { window.__wait = 150; window.__err = { code: 'not_granted', message: 'no' }; });
      await P.click('#check-read'); await readDone(P);
      r = await CK(P);
      check('not_granted: the check closes, its button goes, a short toast', !r.open && !r.btn.shown && (await toastMsg(P)) === 'Ihr habt Claude das Lesen von Bildern für diese Seite nicht erlaubt.', { open: r.open, btn: r.btn, t: await toastMsg(P) });
      check('nothing written by any of this', !srv.log.length);
      await A.ctx.close();
    });

    // ===== 5) From the Eintragen-Modus finale =====
    await section('5) finale', async () => {
      const ing = clone(F.ingame);
      delete ing[ID['Arnold Dixon']];
      const srv = makeServer(seedAll(ing));
      const A = await phone(browser, srv, { name: 'fin', inClaude: true, writable: true, user: owner, anim: 'aus' });
      const P = A.page;
      await P.click('#entry-banner-go'); await P.waitForTimeout(100);
      const n = await P.evaluate(() => document.getElementById('entry-count').textContent);
      for (let k = 0; k < 40; k++) {
        if (await P.evaluate(() => !document.getElementById('entry-finale').hidden)) break;
        await P.click('#entry-next'); await P.waitForTimeout(380);
      }
      const fin = await P.evaluate(() => { const f = document.getElementById('entry-finale'); const b = f.querySelector('[data-e="check"]'); return { shown: !f.hidden, h: f.querySelector('h2') && f.querySelector('h2').textContent, btn: b && b.textContent, bh: b && b.getBoundingClientRect().height }; });
      check('finale: "Jetzt mit Foto prüfen" (>= 44 px)', fin.shown && /eingetragen/.test(fin.h) && fin.btn === 'Jetzt mit Foto prüfen' && fin.bh >= 44, { fin, n });
      await P.click('#entry-finale [data-e="check"]'); await P.waitForTimeout(200);
      const r = await CK(P);
      check('it closes the Eintragen-Modus and opens the check on the Plan tab, focus on its heading', r.open && await P.evaluate(() => document.getElementById('entry').hidden && !document.getElementById('panel-plan').hidden && document.activeElement && document.activeElement.id === 'check-h'), r.open);
      await A.ctx.close();
    });

    // ===== 5b) Shared data changing while the result is open =====
    await section('5b) races', async () => {
      const srv = makeServer(seedAll());
      const A = await phone(browser, srv, { name: 'RA', inClaude: true, writable: true, user: owner, anim: 'aus' });
      const B = await phone(browser, srv, { name: 'RB', inClaude: true, writable: true, user: lena, anim: 'aus' });
      await readTable(A.page, REPLY);
      await readTable(B.page, REPLY);
      // Jane Hodge is deleted on another phone: her row has to be placed by hand again, nobody gets her numbers.
      srv.col('workers').delete(ID['Jane Hodge']); srv.broadcast('workers');
      await until(() => A.page.evaluate(() => document.querySelectorAll('#check-result .ck-assign .ck-row').length === 1), 3000);
      let r = await CK(A.page);
      check('a villager deleted meanwhile: her row goes to "Wer ist das?" (she is not offered), no card for her', r.assign.length === 1 && r.assign[0].read.startsWith('„Jane Hodge“') && r.assign[0].val === ''
        && !r.assign[0].opts.some(o => o.v === ID['Jane Hodge']) && !cardOf(r, ID['Jane Hodge']), r.assign);
      // Phone B takes its result first (two taps: Jane's row is open there too), then A, then A's Rückgängig.
      await B.page.click(lineSel(ID['Saul Lovell'], 'research', '[data-ck="ok"]'));
      await B.page.click('#check-apply'); await B.page.waitForTimeout(600); await B.page.click('#check-apply');
      await until(async () => srv.log.filter(x => x.c === 'ingame' && x.who === 'RB').length >= 27, 4000);
      await until(() => A.page.evaluate(() => !document.querySelector('#check-result .ck-ripple')), 3000);
      r = await CK(A.page);
      check('the other phone took the same result: A\'s result follows (nothing moves any more), still open', r.result && !r.ripple && r.apply.text === 'Übernehmen', { ripple: r.ripple, apply: r.apply });
      const n0 = srv.log.length;
      await A.page.click('#check-apply'); await A.page.waitForTimeout(600); await A.page.click('#check-apply');
      await until(async () => srv.log.slice(n0).filter(x => x.who === 'RA' && x.c === 'ingame').length >= 26, 4000);
      const aw = srv.log.slice(n0).filter(x => x.who === 'RA' && x.c === 'ingame');   // BUILD 17: plus one 'checks' doc each
      check('A writes 26 (not Jane, not Saul with his open "?")', aw.length === 26 && !aw.some(x => x.id === ID['Jane Hodge'] || x.id === ID['Saul Lovell']), aw.length);
      await A.page.click('#toast .toast-act');
      const byB = () => { const ing = srv.obj('ingame'); return roster.every(w => w.id === ID['Jane Hodge'] || (ing[w.id] && ing[w.id].by === 'u_b')); };
      await until(async () => byB(), 4000);
      check('A\'s Rückgängig brings back what B had written (not the older snapshots)', byB());
      await A.ctx.close(); await B.ctx.close();
    });

    // ===== 6) Motion per the bellwright-animations skill =====
    for (const lvl of ['voll', 'ruhig', 'aus']) {
      await section('6) motion ' + lvl, async () => {
        const srv = makeServer(seedAll());
        const A = await phone(browser, srv, { name: 'M' + lvl, inClaude: true, writable: true, user: owner, anim: lvl });
        const P = A.page;
        await P.click('#check-open');
        await P.setInputFiles('#check-file', IMGS);
        await P.evaluate(r => { window.__reply = r; window.__wait = 60; }, REPLY);
        await P.click('#check-read');
        await until(() => P.evaluate(() => { const r = document.getElementById('check-result'); return r && !r.hidden; }), 3000);
        const a = await P.evaluate(() => document.getElementById('check-result').getAnimations({ subtree: true }).map(x => { const kf = x.effect.getKeyframes(); const tm = x.effect.getComputedTiming(); return { dur: tm.duration, delay: tm.delay, iter: tm.iterations, props: [...new Set(kf.flatMap(k => Object.keys(k).filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p))))] }; }));
        if (lvl === 'voll') check('voll: the result comes in card by card (transform + opacity, 220 ms, 30 ms apart, at most 10 apart)', a.length >= 10 && a.every(x => x.dur === 220 && x.delay <= 300 && x.iter === 1 && x.props.every(p => p === 'transform' || p === 'opacity')) && Math.max(...a.map(x => x.delay)) === 300, a.slice(0, 3));
        if (lvl === 'ruhig') check('ruhig: only a fade (opacity, <= 150 ms)', a.length >= 1 && a.every(x => x.dur <= 150 && x.props.join() === 'opacity' && x.iter === 1), a.slice(0, 3));
        if (lvl === 'aus') check('aus: nothing moves', a.length === 0, a.slice(0, 3));
        await P.waitForTimeout(750);
        await P.click(lineSel(ID['Saul Lovell'], 'research', '[data-ck="ok"]'));
        await P.waitForTimeout(20);
        const s = await P.evaluate(() => document.getElementById('check-result').getAnimations({ subtree: true }).map(x => { const kf = x.effect.getKeyframes(); const tm = x.effect.getComputedTiming(); return { dur: tm.duration, props: [...new Set(kf.flatMap(k => Object.keys(k).filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p))))] }; }));
        if (lvl === 'voll') check('voll: the confirmed number stamps (scale, 320 ms)', s.length === 1 && s[0].dur === 320 && s[0].props.join() === 'transform', s);
        if (lvl === 'ruhig') check('ruhig: the confirmed number fades in (150 ms)', s.length === 1 && s[0].dur === 150 && s[0].props.join() === 'opacity', s);
        if (lvl === 'aus') check('aus: no stamp', s.length === 0, s);
        await P.waitForTimeout(450);
        const left = await P.evaluate(() => document.querySelectorAll('#check-result .ck-in').length);
        check(`${lvl}: no animation classes left behind`, left === 0 || lvl === 'aus', left);
        await A.ctx.close();
      });
    }

    // ===== 7) Layout: 360 / 390 / 1280, one-handed, no horizontal scroll; the sticky bars do not stack =====
    for (const w of [360, 390, 1280]) {
      await section('7) layout ' + w, async () => {
        const ing = clone(F.ingame);
        delete ing[ID['Arnold Dixon']];   // one villager open: the Eintragen banner and (touch) the sticky bar exist
        const srv = makeServer(seedAll(ing));
        const A = await phone(browser, srv, { name: 'L' + w, inClaude: true, writable: true, user: owner, anim: 'aus' }, { width: w, height: w < 900 ? 780 : 900 });
        const P = A.page;
        await P.click('#check-open'); await P.waitForTimeout(100);
        await P.screenshot({ path: path.join(SHOTS, `check-${w}-panel.png`) });
        await readTable(P, REPLY);
        await P.evaluate(() => document.getElementById('check-title').scrollIntoView());
        await P.waitForTimeout(100);
        const m = await P.evaluate(() => {
          const vis = el => !el.closest('[hidden]') && el.getClientRects().length > 0;
          const els = [...document.querySelectorAll('#check button, #check label.btn, #check-result button, #check-result select, #check-result summary, #check-open')].filter(vis);
          const small = els.filter(e => e.getBoundingClientRect().height < 44).map(e => (e.textContent || e.tagName).trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().height));
          const wide = [...document.querySelectorAll('#check *, #check-result *')].filter(vis).filter(e => e.getBoundingClientRect().right > innerWidth + 0.5).map(e => e.className || e.tagName).slice(0, 5);
          return { sw: document.documentElement.scrollWidth, vw: innerWidth, small, wide, sticky: document.getElementById('entry-sticky').hidden };
        });
        check(`${w}: no horizontal scroll, nothing sticks out`, m.sw <= m.vw && !m.wide.length, m);
        if (w < 900) check(`${w}: every control in the check >= 44 px tall`, !m.small.length, m.small);
        if (w < 900) check(`${w}: the Eintragen sticky bar stays away while the result is open (one bar at the bottom)`, m.sticky === true);
        await P.screenshot({ path: path.join(SHOTS, `check-${w}-result.png`) });
        await P.evaluate(() => { const c = document.querySelector('.ck-card[data-wid="wmva1am7xw4j44"]'); if (c) c.scrollIntoView({ block: 'center' }); });
        await P.waitForTimeout(100);
        const bar = await P.evaluate(() => { const b = document.querySelector('#check-result .ck-act').getBoundingClientRect(); return { bottom: Math.round(b.bottom), vh: innerHeight, end: Math.round(document.getElementById('check-result').getBoundingClientRect().bottom) }; });
        check(`${w}: the action bar is at the bottom of the screen while scrolling the cards`, bar.end > bar.vh ? Math.abs(bar.bottom - bar.vh) <= 1 : bar.bottom <= bar.vh, bar);
        await P.screenshot({ path: path.join(SHOTS, `check-${w}-cards.png`) });
        if (w === 360) {
          // keyboard through the result: every focused control stays clear of the sticky action bar
          await P.focus('#check-title');
          const hidden = [], seen = new Set();
          for (let i = 0; i < 30; i++) {
            await P.keyboard.press('Tab');
            await P.waitForTimeout(40);
            const r = await P.evaluate(() => {
              const a = document.activeElement, bar = document.querySelector('#check-result .ck-act');
              if (!bar || !a || a.closest('.ck-act') || !a.closest('#check-result')) return null;
              const b = a.getBoundingClientRect(), t = bar.getBoundingClientRect().top;
              return { k: a.dataset.focus || a.tagName, bad: b.bottom > t + 1 ? (a.dataset.focus || a.tagName) + ':' + Math.round(b.bottom) + '>' + Math.round(t) : null };
            });
            if (r) { seen.add(r.k); if (r.bad) hidden.push(r.bad); }
          }
          check('360: a control reached with Tab is never hidden behind the action bar (>= 20 controls visited)', !hidden.length && seen.size >= 20, { hidden, seen: seen.size });
        }
        await A.ctx.close();
      });
    }
  } finally { await browser.close(); }
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-check: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

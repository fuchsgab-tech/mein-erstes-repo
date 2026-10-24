// BUILD 5 "Fotos richtig zuordnen und unsichere Zahlen zeigen (auch beim Text-Import)".
// Part A: the internals in expose.html (window.__t.review, from mk.js) with the example team as the roster:
//   normName / matching / levels, the prompt (roster, image, sure), cleanPhotoResult, mergeStat never lowering Max, doubts.
// Part B: page.html in Playwright. Phones share one fake server in node (one map and one listener list per collection:
//   workers, settings, ingame, prefs), user stub with id/isOwner/can/profiles, a sample stub whose answer and error the
//   test sets (window.__reply / window.__err) and which records every call (window.__calls).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../bellwright-arbeitsplan.html');
function load(file) {
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf('// ---------- Game data ----------');
  const b = s.indexOf('// ---------- Rendering: Plan ----------');
  if (a < 0 || b < 0) throw new Error('planner section not found in ' + file);
  const fn = new Function('localStorage', 'matchMedia', 'document', '"use strict";\n' + s.slice(a, b) + '\nreturn { EXAMPLE, normWorker, ATTRS };');
  const store = {};
  const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  return fn(ls, () => ({ matches: false }), undefined);
}
const T = load(APP);
const DIR = { u_owner: 'Gabriel', u_lena: 'Lena', u_ro: 'Ida' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));
const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 900) : '')); };
const info = [];
const errs = [];
const WRAP = b => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>' + b + '</body></html>';

function exampleSeed() {
  const workers = {};
  T.EXAMPLE.forEach((w, i) => { workers['w_' + w.name.toLowerCase()] = { name: w.name, role: w.role, traits: w.traits, order: i + 1, stats: clone(w.stats) }; });
  return workers;
}

// =====================================================================================================
// Part A: internals (local mode, example team adopted as the real roster)
// =====================================================================================================
async function partA(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('A: ' + e.message));
  await page.addInitScript(seed => {
    window.claude = { use: async () => null };
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('bellwright-arbeitsplan-v1', JSON.stringify({ settings: null, workers: seed }));
    }
  }, Object.entries(exampleSeed()).map(([id, d]) => ({ id, ...d })));
  await page.goto('file://' + process.cwd() + '/expose.html#arbeiter');
  await page.waitForFunction(() => window.__t && window.__t.state.ready);
  const r = await page.evaluate(() => {
    const R = window.__t.review, S = window.__t.state;
    const ws = [...S.workers.values()];
    const id = n => ws.find(w => w.name === n).id;
    const read = (name, stats = {}, known = null) => ({ name, known, stats });
    const best = rd => { const b = R.rankTargets(rd)[0]; return b ? { name: b.w.name, score: +b.m.score.toFixed(3), conflict: b.m.conflict, level: R.matchLevel(b.m) } : null; };
    const out = {};
    out.norm = ['Agnés', 'W0lfric', 'Wu1fric', 'Bertrarn', 'Ag!nes', 'HILDE ', 'Kuni-bert', 'Æthel'].map(R.normName);
    // digits 2-9 stay, so numbered names are not one person (0/1 are still read as o/l)
    out.digits = { n: ['Wache 2', 'Wache 3', 'Wache 1'].map(R.normName), sim: +R.nameSim('Wache 2', 'Wache 3').toFixed(3) };
    out.wulfrlc = best(read('Wulfrlc'));
    out.wulfrlcTarget = R.autoTarget(read('Wulfrlc')) === id('Wulfric');
    out.agnes = best(read('Agnés'));
    out.ina = best(read('Ina'));
    out.inaTarget = R.autoTarget(read('Ina')) === id('Ida');
    out.edda = best(read('Edda', { cooking: { cur: 1, max: 10 } }));
    out.eddaDoubts = R.rowDoubts(true, 1, 10, S.workers.get(id('Edda')).stats.cooking);
    out.known = best(read('Wlfrc', {}, 'Wulfric'));
    out.knownNo = best(read('Wlfrc'));
    out.stranger = best(read('Oswin'));
    out.strangerTarget = R.autoTarget(read('Oswin'));
    out.maxBonus = +R.matchScore(read('Hilde', { farming: { cur: 7, max: 9 }, cooking: { cur: 4, max: 6 } }), S.workers.get(id('Hilde'))).score.toFixed(3);
    out.maxConflict = R.matchScore(read('Hilde', { farming: { cur: 7, max: 8 } }), S.workers.get(id('Hilde')));
    out.skip = R.matchScore(read('Edda', { cooking: { cur: 1, max: 10 } }), S.workers.get(id('Edda')), new Set(['cooking']));
    // unnamed villagers never match, but stay pickable
    out.unnamed = R.matchScore(read(''), { name: '  ', stats: ws[0].stats });
    out.emptyRead = best(read(''));
    out.doubts = {
      unsure: R.rowDoubts(false, 3, 5, null),
      over: R.rowDoubts(true, 6, 4, null),
      high: R.rowDoubts(true, 12, 13, null),
      lower: R.rowDoubts(true, 2, 6, { cur: 4, max: 6 }),
      maxLow: R.rowDoubts(true, 4, 5, { cur: 4, max: 6 }),
      maxHigh: R.rowDoubts(true, 4, 8, { cur: 4, max: 6 }),
      empty: R.rowDoubts(false, null, null, { cur: 4, max: 6 }),
      ok: R.rowDoubts(true, 5, 6, { cur: 4, max: 6 }),
    };
    // prompt: roster, image, sure
    const pr = R.photoPrompt();
    out.prompt = {
      roster: pr.includes('Known villagers in this village (photos may misspell them): "Agnes", "Bertram", "Edda", "Godric", "Hilde", "Wulfric", "Ida", "Kunibert".'),
      knownRule: pr.includes('If a villager is one of them, set "known" to that exact name, otherwise null.'),
      image: pr.includes('"image": the 0-based number of the image'),
      sure: pr.includes('"sure": true or false') && pr.includes('(3/8, 1/7, 5/6, 0/8)'),
      example: /\{"workers":\[\{"name":"Oswin","known":null,"image":0,.*"sure":false/.test(pr),
      skills: ['"Arbeiter"', '"Ernte"', 'Landwirtschaft', 'Kochen', '"Handwerk"', '"Forschen"', '"Tierpflege"'].every(x => pr.includes(x)),
      combat: pr.includes('Stärke, Gewandtheit, Einhand, Zweihand, Stangenwaffen, Schilde, Bogenschießen'),
    };
    const empty = R.photoPrompt([]);
    out.promptEmpty = { noRoster: !empty.includes('Known villagers'), knownNull: empty.includes('- "known": null.') };
    const many = Array.from({ length: 100 }, (_, i) => 'N' + i);
    out.cap = R.rosterNames().length;
    // cleanPhotoResult
    const c = window.__t.cleanPhotoResult({ workers: [
      { name: '  Agnés ', known: ' Agnes '.padEnd(60, 'x'), image: 1, stats: { cooking: { cur: 2, max: 3, sure: false }, Harvesting: '6/9', labourer: { cur: 12, max: 4 } } },
      { name: 'B', known: 7, image: '1', stats: { farming: { cur: 2, max: null, sure: 'false' }, crafting: '3?' } },
      { name: 'C', image: 5, stats: { cooking: 4 } },
      { name: 'D', image: -1, stats: { cooking: { cur: 1 } } },
      { name: 'E', image: 1.5, stats: { cooking: { cur: 1 } } },
    ] }, 2);
    out.clean = c.map(w => ({ name: w.name, known: w.known, image: w.image, stats: w.stats }));
    out.cleanOne = window.__t.cleanPhotoResult({ workers: [{ name: 'X', stats: { cooking: 3 } }] }, 1)[0].image;
    out.cleanNone = window.__t.cleanPhotoResult({ workers: [{ name: 'X', stats: { cooking: 3 } }] })[0].image;
    // mergeStat: an import never lowers a known Max
    const m = (cur0, max0, cur, max) => { const w = window.__t.normWorker('m', { name: 'M', stats: { cooking: { cur: cur0, max: max0 } } }); window.__t.mergeStat(w, 'cooking', cur, max); return w.stats.cooking; };
    out.merge = { lower: m(4, 9, 5, 7), higher: m(4, 9, 5, 10), missing: m(4, 9, 5, null), outgrown: m(4, 9, 10, null), overMax: m(0, null, 6, 4), curOnly: m(4, 9, null, 7), down: m(6, 9, 3, 9), nomax: m(4, null, 5, 7) };
    out.same = { unchanged: R.sameAfter({ cur: 4, max: 9 }, 4, 7), changed: R.sameAfter({ cur: 4, max: 9 }, 5, null), empty: R.sameAfter({ cur: 4, max: 9 }, null, null) };
    return out;
  });
  check('A normName: lowercase, no accents, 0→o, 1|!→l, rn→m, letters (and digits 2-9) only', JSON.stringify(r.norm) === JSON.stringify(['agnes', 'wolfric', 'wulfric', 'bertram', 'aglnes', 'hilde', 'kunibert', 'æthel']), r.norm);
  check('A numbered names stay apart: "Wache 2" vs "Wache 3" is amber at best, never the same name', r.digits.n.join() === 'wache2,wache3,wachel' && r.digits.sim < 0.85, r.digits);
  check("A 'Wulfrlc' → Wulfric preselected", r.wulfrlc && r.wulfrlc.name === 'Wulfric' && r.wulfrlcTarget, r.wulfrlc);
  check("A 'Agnés' → Agnes, green", r.agnes && r.agnes.name === 'Agnes' && r.agnes.level === 'upd', r.agnes);
  check("A 'Ina' → Ida, amber (preselected, sim .67)", r.ina && r.ina.name === 'Ida' && r.ina.level === 'ask' && r.inaTarget && Math.abs(r.ina.score - 0.667) < 0.01, r.ina);
  check('A Edda read with Kochen 1 → amber, doubt "niedriger…"', r.edda && r.edda.name === 'Edda' && r.edda.conflict && r.edda.level === 'ask' && r.eddaDoubts.includes('niedriger als gespeichert – Lesefehler?'), [r.edda, r.eddaDoubts]);
  check('A known bonus +0.3: a garbled name with known=Wulfric is green, without it is not', r.known.level === 'upd' && r.known.name === 'Wulfric' && r.knownNo.level !== 'upd', [r.known, r.knownNo]);
  check('A a stranger is "neu" (no target)', r.strangerTarget === '' && (!r.stranger || r.stranger.level === 'new'), r.stranger);
  check('A equal Max +0.02 each; a different Max is a conflict', r.maxBonus === 1.04 && r.maxConflict.conflict && Math.abs(r.maxConflict.score - 0.92) < 1e-9, [r.maxBonus, r.maxConflict]);
  check('A a number marked "stimmt" no longer counts as conflict', !r.skip.conflict && r.skip.score >= 0.85, r.skip);
  check('A unnamed villagers never match; an empty read name matches nobody', r.unnamed === null && (!r.emptyRead || r.emptyRead.level === 'new'), [r.unnamed, r.emptyRead]);
  const d = r.doubts;
  check('A doubts: unsicher gelesen / Stufe über Max / ungewöhnlich hoch / niedriger / Max anders (bleibt) ',
    d.unsure.join() === 'unsicher gelesen' && d.over.join() === 'Stufe über Max' && d.high.includes('ungewöhnlich hoch') && d.lower.join() === 'niedriger als gespeichert – Lesefehler?'
    && d.maxLow.join() === 'Max anders als gespeichert (bleibt 6)' && d.maxHigh.join() === 'Max anders als gespeichert' && !d.empty.length && !d.ok.length, d);
  check('A prompt: roster list, known rule, image index, sure flag, example, German skills, combat stats ignored', Object.values(r.prompt).every(Boolean), r.prompt);
  check('A prompt with an empty roster: no known list, known = null', r.promptEmpty.noRoster && r.promptEmpty.knownNull, r.promptEmpty);
  const cl = r.clean;
  check('A cleanPhotoResult: known ≤40, image in range, sure kept/default, Stufe over Max kept as read',
    cl[0].name === 'Agnés' && cl[0].known.length === 40 && cl[0].known.startsWith('Agnes') && cl[0].image === 1 && cl[0].stats.cooking.sure === false && cl[0].stats.harvesting.sure === true
    && cl[0].stats.labourer.cur === 12 && cl[0].stats.labourer.max === 4
    && cl[1].known === null && cl[1].image === 1 && cl[1].stats.farming.sure === false && cl[1].stats.crafting.sure === false && cl[1].stats.crafting.cur === 3
    && cl[2].image === null && cl[3].image === null && cl[4].image === null && r.cleanOne === 0 && r.cleanNone === null, cl);
  const mg = r.merge;
  check('A mergeStat: never lowers a known Max, keeps it when missing, drops it when outgrown, raises Max to Stufe',
    JSON.stringify(mg) === JSON.stringify({ lower: { cur: 5, max: 9 }, higher: { cur: 5, max: 10 }, missing: { cur: 5, max: 9 }, outgrown: { cur: 10, max: null }, overMax: { cur: 6, max: 6 }, curOnly: { cur: 4, max: 9 }, down: { cur: 3, max: 9 }, nomax: { cur: 5, max: 7 } }), mg);
  check('A sameAfter follows mergeStat', r.same.unchanged === true && r.same.changed === false && r.same.empty === true, r.same);
  check('A roster names for the prompt: the 8 named villagers', r.cap === 8, r.cap);
  // at most 80 names
  const cap = await page.evaluate(() => {
    const S = window.__t.state;
    for (let i = 0; i < 100; i++) S.workers.set('x' + i, window.__t.normWorker('x' + i, { name: 'Name' + i, order: 100 + i }));
    const n = window.__t.review.rosterNames().length;
    for (let i = 0; i < 100; i++) S.workers.delete('x' + i);
    return n;
  });
  check('A at most 80 names go into the prompt', cap === 80, cap);
  await ctx.close();
}

// =====================================================================================================
// Part B: the page
// =====================================================================================================
function makeServer(seed = {}) {
  const srv = { workers: new Map(), settings: new Map(), ingame: new Map(), prefs: new Map(), stamps: new Map(), log: [], pages: new Set() };   // BUILD 14: 'stamps' too
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) srv[c].set(id, clone(d));
  srv.docs = c => [...srv[c]].map(([id, d]) => [id, clone(d)]);
  srv.broadcast = c => { const docs = srv.docs(c); for (const p of srv.pages) p.evaluate(([c, docs]) => window.__deliver && window.__deliver(c, docs), [c, docs]).catch(() => {}); };
  srv.write = async (who, op, c, id, d) => {
    await sleep(80);
    if (op === 'set') srv[c].set(id, clone(d)); else srv[c].delete(id);
    srv.log.push({ who, op, c, id, d: d && clone(d), t: Date.now() });
    setTimeout(() => srv.broadcast(c), 10);
  };
  return srv;
}
// cfg: { name, inClaude, writable, user, dir, sample: undefined (works) | null | 'limitsThrow' | 'limitsReject' | 'noLimits' | 'noImages', costSeen, anim }
function STUB(cfg) {
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__clip = t; } } }); } catch (e) { /* ignore */ }
  try {
    if (cfg.anim) localStorage.setItem('bellwright-anim-v1', JSON.stringify(cfg.anim));
    if (cfg.costSeen) localStorage.setItem('bellwright-kosten-info-v1', 'true');
  } catch (e) { /* ignore */ }
  window.__calls = [];
  window.__reply = { workers: [] };
  window.__err = null;
  let sample = null;
  if (cfg.sample !== null) {
    sample = async () => ({ text: '' });
    if (cfg.sample === 'limitsThrow') sample.limits = () => { throw new Error('no limits here'); };
    else if (cfg.sample === 'limitsReject') sample.limits = () => Promise.reject({ code: 'upstream_error', message: 'x' });
    else if (cfg.sample === 'noImages') sample.limits = async () => ({ maxPromptBytes: 262144 });
    else if (cfg.sample !== 'noLimits') sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
    sample.json = async (input, opts) => {
      window.__calls.push({ input, n: opts && opts.images ? opts.images.length : 0, cache: opts && opts.cache, t: Date.now() });
      await new Promise(r => setTimeout(r, 150));
      if (window.__err) throw window.__err;
      return JSON.parse(JSON.stringify(window.__reply));
    };
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
    get: async () => snapD(await window.__srvRead(c), id),
    onSnapshot: n => { list(docL, c + '/' + id).push(n); window.__srvRead(c).then(docs => n(snapD(docs, id))); return () => {}; },
  });
  const db = Object.freeze({
    collection: c => ({
      doc: id => docRef(c, id),
      onSnapshot: n => { list(colL, c).push(n); window.__srvRead(c).then(docs => setTimeout(() => n(snapC(docs)), 0)); return () => {}; },
    }),
    doc: p => { const [c, id] = p.split('/'); return docRef(c, id); },
  });
  const u = cfg.user;
  const user = !u ? null : Object.freeze({
    isOwner: async () => !!u.owner,
    id: async () => u.id || null,
    can: async n => (n === 'data.write' ? u.can : false),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: (cfg.dir || {})[i] || '', avatarUrl: 'data:,', color: '#888', email: null, isMe: i === u.id, guest: false }])),
  });
  window.claude = { use: async n => (n === 'db' ? db : n === 'user' ? user : n === 'sample' ? sample : null) };
}
async function phone(browser, srv, cfg, { width = 390, height = 844, hash = '#arbeiter', reducedMotion } = {}) {
  const mobile = width < 900;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, ...(reducedMotion ? { reducedMotion } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push((cfg.name || '?') + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push((cfg.name || '?') + ' console: ' + m.text()); });
  if (srv) {
    await ctx.exposeFunction('__srvWrite', (who, op, c, id, d) => srv.write(who, op, c, id, d));
    await ctx.exposeFunction('__srvRead', c => srv.docs(c));
    srv.pages.add(page);
    page.on('close', () => srv.pages.delete(page));
  }
  await page.addInitScript(STUB, { dir: DIR, ...cfg });
  await page.goto('file://' + process.cwd() + '/page.html' + hash);
  await page.waitForTimeout(450);
  return { ctx, page };
}
async function until(fn, max = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(25); }
  return -1;
}
const cards = page => page.$$eval('#review .rcard', cs => cs.map(c => {
  const q = s => c.querySelector(s);
  return {
    k: c.dataset.rk, name: q('[data-r=name]').value, target: q('[data-r=target]').value,
    opts: [...q('[data-r=target]').options].map(o => o.value), optText: [...q('[data-r=target]').options].map(o => o.textContent),
    badge: q('[data-badge]').textContent, cls: q('[data-badge]').className,
    yes: q('[data-r=yes]').hidden ? '' : q('[data-r=yes]').textContent,
    chip: q('[data-chk]').hidden ? '' : q('[data-chk]').textContent,
    thumb: !!q('.rc-thumb'), on: q('[data-r=on]').checked, role: q('[data-r=role]').value,
    doubts: Object.fromEntries([...c.querySelectorAll('.rc-stat.doubt')].map(r => [r.dataset.a, r.querySelector('.rc-why').textContent])),
    was: Object.fromEntries([...c.querySelectorAll('.rc-stat')].filter(r => !r.querySelector('.rc-was').hidden).map(r => [r.dataset.a, r.querySelector('.rc-was').textContent])),
    same: [...c.querySelectorAll('.rc-stat.same')].map(r => r.dataset.a),
    vals: Object.fromEntries([...c.querySelectorAll('.rc-stat')].map(r => [r.dataset.a, r.querySelector('[data-r^="cur:"]').value + '/' + r.querySelector('[data-r^="max:"]').value])),
  };
}));
const workerWrites = srv => srv.log.filter(x => x.c === 'workers');
const byName = (srv, n) => [...srv.workers].filter(([, d]) => d.name === n);
const applyText = page => page.$eval('#review-apply', b => b.textContent);
const reviewMsg = page => page.$eval('#review-msg', e => e.textContent).catch(() => null);
// A read has finished (the Stopp button is gone again).
const readDone = async page => { await page.waitForTimeout(60); await until(() => page.isHidden('#photo-stop'), 3000); };
const toastMsg = page => page.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : (t.querySelector('.toast-msg') || {}).textContent || ''; });

// Two "photos": an app-drawn villager window, screenshotted (so thumbnails and the zoom show something).
async function makeImages(browser) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 420 } });
  const p = await ctx.newPage();
  const shots = [];
  for (const [name, rows] of [['Wulfric', [['Arbeiter', '4/6'], ['Forschen', '6/8'], ['Kochen', '2/3']]], ['Agnes', [['Ernte', '6/9'], ['Kochen', '2/3'], ['Tierpflege', '5/8']]]]) {
    await p.setContent(`<body style="margin:0;background:#111;font:22px Georgia;color:#eee"><div style="margin:30px;padding:24px;border:3px solid #a87;background:#2a2018;width:520px">
      <div style="font-size:34px;color:#fc6;margin-bottom:14px">${name}</div>${rows.map(([a, v]) => `<div style="display:flex;justify-content:space-between;border-top:1px solid #554;padding:8px 0"><span>${a}</span><b>${v}</b></div>`).join('')}</div></body>`);
    shots.push(await p.screenshot({ type: 'png' }));
  }
  await ctx.close();
  return shots.map((buffer, i) => ({ name: `bild${i + 1}.png`, mimeType: 'image/png', buffer }));
}

const REPLY = { workers: [
  // Wulfric misread, and a lower research Max than stored (10): amber, preselected, Max kept
  { name: 'Wulfrlc', known: null, image: 0, role: null, traits: ['Dullard'], stats: { labourer: { cur: 4, max: 6, sure: true }, researching: { cur: 6, max: 8, sure: true } }, unsure: '' },
  // Agnes with an accent and known: green; one digit unsure
  { name: 'Agnés', known: 'Agnes', image: 1, role: null, traits: ['Optimist'], stats: { harvesting: { cur: 6, max: 9, sure: true }, cooking: { cur: 2, max: 3, sure: false } }, unsure: 'Kochen: 2 oder 7?' },
  // A new villager whose name is close to Ida
  { name: 'Ina', known: null, image: 1, role: null, traits: [], stats: { farming: { cur: 2, max: 3, sure: true } }, unsure: '' },
  // Edda with a lower Kochen than stored (8/10)
  { name: 'Edda', known: 'Edda', image: 0, role: null, traits: [], stats: { cooking: { cur: 1, max: 10, sure: true } }, unsure: '' },
  // Somebody new
  { name: 'Oswin', known: null, image: 0, role: null, traits: [], stats: { crafting: { cur: 3, max: 8, sure: true } }, unsure: '' },
], note: '' };

async function photoFlow(browser, imgs) {
  const srv = makeServer({ workers: exampleSeed() });
  const A = await phone(browser, srv, { name: 'A', inClaude: true, writable: true, user: { id: 'u_owner', owner: true, can: true } });
  const B = await phone(browser, srv, { name: 'B', inClaude: true, writable: true, user: { id: 'u_lena', owner: false, can: true }, costSeen: true }, { width: 360, height: 740 });
  const P = A.page;
  // cost note, once per device
  await P.click('#toggle-photo');
  check('cost note shows above "Werte auslesen" the first time', await P.isVisible('#cost-info') && (await P.$eval('#cost-info', e => e.textContent)).includes('Fotos lesen nutzt euer eigenes Claude-Kontingent, ähnlich wie eine Chat-Nachricht mit Bild. Beim ersten Mal fragt Claude um Erlaubnis.')
    && await P.evaluate(() => document.getElementById('cost-info').compareDocumentPosition(document.getElementById('photo-read')) & Node.DOCUMENT_POSITION_FOLLOWING));
  await B.page.click('#toggle-photo');
  check('cost note stays hidden once confirmed on this device', await B.page.isHidden('#cost-info'));
  await P.click('#cost-ok');
  check('"Verstanden" hides it and remembers it per device', await P.isHidden('#cost-info') && await P.evaluate(() => localStorage.getItem('bellwright-kosten-info-v1')) === 'true');

  await P.setInputFiles('#photo-file', imgs);
  await P.evaluate(r => { window.__reply = r; }, REPLY);
  await P.click('#photo-read');
  await P.waitForSelector('#review .rcard');
  await P.waitForTimeout(150);
  const call = await P.evaluate(() => window.__calls[0]);
  check('one Claude call with both pictures, not cached', (await P.evaluate(() => window.__calls.length)) === 1 && call.n === 2 && call.cache === false, { n: call.n, cache: call.cache });
  check('the prompt lists the known villagers', call.input.includes('Known villagers in this village (photos may misspell them): "Agnes", "Bertram", "Edda", "Godric", "Hilde", "Wulfric", "Ida", "Kunibert".'));
  let cs = await cards(P);
  const [cw, ca, ci, ce, co] = cs;
  check('five cards in the order read, each with its thumbnail', cs.length === 5 && cs.every(c => c.thumb) && cs.map(c => c.name).join() === 'Wulfrlc,Agnés,Ina,Edda,Oswin', cs.map(c => c.name));
  check("'Wulfrlc' → Wulfric preselected (amber: Max differs), best match first in the select", cw.target === 'w_wulfric' && cw.opts[0] === '' && cw.opts[1] === 'w_wulfric' && cw.badge === 'Ist das Wulfric?' && cw.yes === 'Ja, Wulfric' && cw.optText[0] === 'Neu anlegen', cw);
  check('a lower Max than stored is a doubt that says the Max stays', cw.doubts.researching === 'Max anders als gespeichert (bleibt 10)' && cw.chip === '1 Zahl prüfen', cw.doubts);
  check("'Agnés' → Agnes, green; the unsure digit is a doubt", ca.target === 'w_agnes' && ca.badge === 'aktualisiert Agnes' && /upd/.test(ca.cls) && ca.doubts.cooking === 'unsicher gelesen' && ca.chip === '1 Zahl prüfen' && !ca.yes, ca);
  check("'Ina' → amber 'Ist das Ida?'", ci.target === 'w_ida' && ci.badge === 'Ist das Ida?' && /ask/.test(ci.cls), ci);
  check("Edda read with Kochen 1 → amber, doubt 'niedriger als gespeichert – Lesefehler?'", ce.target === 'w_edda' && ce.badge === 'Ist das Edda?' && ce.doubts.cooking === 'niedriger als gespeichert – Lesefehler?', ce);
  check("existing target: 'bisher' per number, unchanged rows dimmed", ce.was.cooking === 'bisher 8/10' && Object.keys(ce.was).length === 7 && ce.same.length === 6 && !ce.same.includes('cooking') && ca.same.includes('harvesting'), { was: ce.was, same: ce.same });
  check("'Oswin' → neu (Neu anlegen), no 'bisher'", co.target === '' && co.badge === 'neu' && !Object.keys(co.was).length, co);
  check('role of an existing target is shown (not reset to Arbeiter)', cs.every(c => c.role === 'worker'));
  check('nothing is saved before "Ausgewählte übernehmen"', workerWrites(srv).length === 0, workerWrites(srv));
  check('photo message counts villagers and marked places', (await P.$eval('#photo-msg', e => e.textContent)).startsWith('5 Dorfbewohner mit Werten erkannt. Prüft die Werte unten.'), await P.$eval('#photo-msg', e => e.textContent));
  check('review sits directly under the text import, outside the photo box', await P.evaluate(() => { const r = document.getElementById('review'); return r.previousElementSibling && r.previousElementSibling.id === 'import' && !document.getElementById('photo').contains(r); }));
  check('the review heading has focus after reading', await P.evaluate(() => document.activeElement && document.activeElement.id === 'review-title'));

  // zoom
  await P.click('#review .rcard[data-rk="1"] .rc-thumb');
  await P.waitForTimeout(100);
  const z = await P.evaluate(() => { const d = document.getElementById('zoom'), img = document.getElementById('zoom-img'); return { open: d.open, title: document.getElementById('zoom-title').textContent, src: img.src, focus: document.activeElement.id, iw: img.getBoundingClientRect().width, bw: document.getElementById('zoom-box').clientWidth }; });
  check('thumbnail opens the zoom dialog with that picture at full width', z.open && z.title === 'Bild 2 von 2' && z.src.startsWith('blob:') && z.focus === 'zoom-close' && Math.abs(z.iw - z.bw) < 2, z);
  await P.click('#zoom-big');
  await P.waitForTimeout(260);
  const zb = await P.evaluate(() => ({ pressed: document.getElementById('zoom-big').getAttribute('aria-pressed'), iw: document.getElementById('zoom-img').getBoundingClientRect().width, bw: document.getElementById('zoom-box').clientWidth, ta: getComputedStyle(document.getElementById('zoom-box')).touchAction, scroll: document.getElementById('zoom-box').scrollWidth > document.getElementById('zoom-box').clientWidth }));
  check('"Größer" doubles it inside a scroll box with pinch zoom', zb.pressed === 'true' && Math.abs(zb.iw - 2 * zb.bw) < 3 && zb.scroll && (zb.ta === 'manipulation' || (/pan-x/.test(zb.ta) && /pinch-zoom/.test(zb.ta))), zb);   // Chrome writes pan-x pan-y pinch-zoom as manipulation
  await P.screenshot({ path: 'photo5-zoom-390.png' });
  await P.keyboard.press('Escape');
  await P.waitForTimeout(100);
  check('Escape closes the zoom, focus goes back to the thumbnail', await P.evaluate(() => !document.getElementById('zoom').open && document.activeElement.classList.contains('rc-thumb') && !document.getElementById('zoom-img').getAttribute('src')));
  await P.click('#review .rcard[data-rk="0"] .rc-thumb');
  await P.click('#zoom-close');
  check('"Schließen" closes it too', await P.evaluate(() => !document.getElementById('zoom').open));

  // Ina is not Ida: pick "Neu anlegen" by hand
  await P.selectOption('#rv-2-target', '');
  cs = await cards(P);
  check('picking "Neu anlegen" by hand → neu', cs[2].target === '' && cs[2].badge === 'neu', cs[2]);
  // the name edit re-runs the match only while the select was not touched
  await P.fill('#rv-2-name', 'Ida');
  check('after a hand pick, editing the name does not move the target', (await cards(P))[2].target === '');
  await P.fill('#rv-2-name', 'Ina');

  // two cards on Agnes
  await P.selectOption('#rv-4-target', 'w_agnes');
  cs = await cards(P);
  check('two cards on one villager show it on the second card', cs[4].badge === 'Zwei Karten zeigen auf Agnes', cs[4].badge);
  await P.click('#review-apply');
  await P.waitForTimeout(100);
  check('two cards pointing at Agnes → blocked, focus on the second select', (await reviewMsg(P)) === 'Zwei Karten zeigen auf Agnes. Bitte bei einer „Neu anlegen“ oder einen anderen Namen wählen.'
    && await P.evaluate(() => document.activeElement.id) === 'rv-4-target' && await P.$eval('#rv-4-target', e => e.getAttribute('aria-invalid')) === 'true' && workerWrites(srv).length === 0, await reviewMsg(P));
  await P.selectOption('#rv-4-target', '');

  // two-tap guard while doubts are open
  const open1 = await P.evaluate(() => [...document.querySelectorAll('#review .rcard')].reduce((n, c) => n + (c.querySelector('[data-chk]').hidden ? 0 : 1), 0));
  await P.click('#review-apply');
  await P.waitForTimeout(80);
  const armed = await applyText(P);
  check('doubts left: first tap turns into "Trotzdem übernehmen (n ungeprüft)", nothing saved', /^Trotzdem übernehmen \(5 ungeprüft\)$/.test(armed) && await P.$eval('#review-apply', b => b.classList.contains('armed')) && workerWrites(srv).length === 0, { armed, open1 });
  await P.waitForTimeout(4200);
  check('after 4 s it is "Ausgewählte übernehmen" again and the hint is gone', (await applyText(P)) === 'Ausgewählte übernehmen' && (await reviewMsg(P)) === '', await reviewMsg(P));

  // clear doubts: "stimmt" on Edda's Kochen, "Ja, Wulfric", edit Agnes' Kochen
  await P.click('#review .rcard[data-rk="3"] .rc-stat[data-a="cooking"] [data-r="okd"]');
  cs = await cards(P);
  check('"stimmt" clears the doubt and (no conflict left) Edda turns green', !cs[3].doubts.cooking && cs[3].chip === '' && cs[3].badge === 'aktualisiert Edda', cs[3]);
  await P.click('#review .rcard[data-rk="0"] [data-r="yes"]');
  cs = await cards(P);
  check('"Ja, Wulfric" confirms the match', cs[0].badge === 'aktualisiert Wulfric' && !cs[0].yes && cs[0].doubts.researching, cs[0]);
  await P.fill('#rv-1-cur-cooking', '2');
  cs = await cards(P);
  check('editing a number clears its doubt', !cs[1].doubts.cooking && cs[1].chip === '', cs[1]);
  await P.click('#review-apply');
  await P.waitForTimeout(80);
  check('one doubt left → "Trotzdem übernehmen (1 ungeprüft)"', (await applyText(P)) === 'Trotzdem übernehmen (1 ungeprüft)');
  await P.click('#review-apply');   // within 450 ms: a double tap is ignored
  await P.waitForTimeout(80);
  check('a double tap is not a second decision', workerWrites(srv).length === 0 && (await applyText(P)) === 'Trotzdem übernehmen (1 ungeprüft)');
  await P.waitForTimeout(500);
  const tApply = Date.now();
  await P.click('#review-apply');
  const seenP = until(() => B.page.evaluate(() => document.querySelectorAll('#wlist .wcard').length === 10), 3000).then(ms => ms < 0 ? -1 : Date.now() - tApply);
  await until(() => workerWrites(srv).length >= 5, 3000);
  await P.waitForTimeout(200);
  const ws = srv.workers;
  check('saved: 3 updated by id, 2 new, no ghost villager', ws.size === 10 && !byName(srv, 'Wulfrlc').length && !byName(srv, 'Agnés').length && byName(srv, 'Ina').length === 1 && byName(srv, 'Oswin').length === 1 && byName(srv, 'Ida').length === 1, [...ws.values()].map(d => d.name));
  check('Wulfric: research Max not lowered (6/10), traits from the photo', JSON.stringify(ws.get('w_wulfric').stats.researching) === '{"cur":6,"max":10}' && ws.get('w_wulfric').traits === 'Dullard' && ws.get('w_wulfric').name === 'Wulfric', ws.get('w_wulfric'));
  check('Agnes keeps her name, Kochen 2/3', ws.get('w_agnes').name === 'Agnes' && JSON.stringify(ws.get('w_agnes').stats.cooking) === '{"cur":2,"max":3}', ws.get('w_agnes'));
  check('Edda Kochen 1/10 after "stimmt" (Max kept)', JSON.stringify(ws.get('w_edda').stats.cooking) === '{"cur":1,"max":10}');
  check('Ida untouched', JSON.stringify(ws.get('w_ida')) === JSON.stringify(exampleSeed().w_ida));
  const ina = byName(srv, 'Ina')[0][1];
  check('Ina created as new worker with Landwirtschaft 2/3', ina.role === 'worker' && JSON.stringify(ina.stats.farming) === '{"cur":2,"max":3}', ina);
  check('worker docs keep the old shape (old tabs cannot wipe anything)', [...ws.values()].every(d => Object.keys(d).sort().join() === 'name,order,role,stats,traits'));
  check('after saving: toast, review gone, photo strip emptied, "Zum Plan"', (await toastMsg(P)) === '2 neu angelegt, 3 aktualisiert. Der Plan ist neu gerechnet.' && await P.isHidden('#review') && (await P.$$('#thumbs .thumb')).length === 0 && await P.isVisible('#photo-goplan'), await toastMsg(P));
  const seen = await seenP;
  check('the second phone sees the result within about 1 s', seen >= 0 && seen < 1500, seen);
  info.push(`photo flow: second phone after ${seen} ms`);

  // ---------- Text import through the same review ----------
  await P.click('#toggle-import');
  await P.fill('#import-text', 'Agnes: Kochen 4/7\nKonrad\nBertram: Ernte 5/6\nBertram: Kochen 3/4');
  await P.click('#do-import');
  await P.waitForSelector('#review .rcard');
  cs = await cards(P);
  check('"Prüfen" (renamed) shows a review; lines of one name make one card', (await P.$eval('#do-import', b => b.textContent)) === 'Prüfen' && cs.length === 2 && cs[0].target === 'w_agnes' && cs[1].target === 'w_bertram' && cs[1].vals.harvesting === '5/6' && cs[1].vals.cooking === '3/4' && cs.every(c => !c.thumb), cs.map(c => [c.name, c.target, c.vals]));
  check('unreadable lines stay in the field with the count', (await P.inputValue('#import-text')) === 'Konrad' && (await P.$eval('#import-msg', e => e.textContent)).endsWith('1 Zeile ohne Werte bleibt im Feld.'), await P.$eval('#import-msg', e => e.textContent));
  check('text import saves nothing before confirming', workerWrites(srv).length === 5);
  check("'Agnes: Kochen 4/7' (stored 2/3): amber, Max doubt", cs[0].badge === 'Ist das Agnes?' && cs[0].doubts.cooking === 'Max anders als gespeichert' && cs[1].badge === 'aktualisiert Bertram', cs);
  await P.click('#review-apply');
  await P.waitForTimeout(80);
  check('text: first tap asks again', (await applyText(P)).startsWith('Trotzdem übernehmen (') && workerWrites(srv).length === 5);
  await P.waitForTimeout(500);
  await P.click('#review-apply');
  await until(() => workerWrites(srv).length >= 7, 3000);
  await P.waitForTimeout(150);
  check('…and saves only after confirming: Agnes Kochen 4/7, Bertram Ernte 5/6 + Kochen 3/4', JSON.stringify(srv.workers.get('w_agnes').stats.cooking) === '{"cur":4,"max":7}'
    && JSON.stringify(srv.workers.get('w_bertram').stats.harvesting) === '{"cur":5,"max":6}' && JSON.stringify(srv.workers.get('w_bertram').stats.cooking) === '{"cur":3,"max":4}' && srv.workers.size === 10);
  check('after saving, focus is on "Prüfen" (no keyboard popping up), the leftover line still in the field', await P.evaluate(() => document.activeElement.id) === 'do-import' && (await P.inputValue('#import-text')) === 'Konrad');

  // appending keeps edits; Verwerfen puts the lines back
  await P.fill('#import-text', 'Godric: Handwerk 7/10');
  await P.click('#do-import');
  await P.waitForSelector('#review .rcard');
  await P.fill('#rv-0-cur-crafting', '8');
  await P.fill('#import-text', 'Hilde: Kochen 5/6\nGodric (Traits: Prodigy, Optimist)');
  await P.click('#do-import');
  await P.waitForTimeout(100);
  cs = await cards(P);
  check('a second "Prüfen" adds cards and keeps what was corrected', cs.length === 3 && cs[0].vals.crafting === '8/10' && cs[1].name === 'Hilde' && cs[2].name === 'Godric', cs.map(c => [c.name, c.vals.crafting]));
  await P.click('#review-discard');
  await P.waitForTimeout(80);
  const ta = await P.inputValue('#import-text');
  check('"Verwerfen" saves nothing and puts every line back into the field', await P.isHidden('#review') && ta.includes('Godric: Handwerk 7/10') && ta.includes('Hilde: Kochen 5/6') && ta.includes('Godric (Traits: Prodigy, Optimist)') && workerWrites(srv).length === 7, ta);

  // a review is live: another phone deletes the target / adds someone
  await P.fill('#import-text', 'Hilde: Kochen 5/6');
  await P.click('#do-import');
  await P.waitForSelector('#review .rcard');
  srv.workers.delete('w_hilde');
  srv.workers.set('w_zora', { name: 'Zora', role: 'worker', traits: '', order: 99, stats: {} });
  srv.broadcast('workers');
  await until(async () => (await cards(P))[0].badge.includes('gibt es nicht mehr'), 2000);
  cs = await cards(P);
  check('a target deleted on another phone: the card says so and asks again', cs[0].badge === 'Hilde gibt es nicht mehr' && cs[0].yes === 'Passt so' && cs[0].target === '' && cs[0].opts.includes('w_zora') && !cs[0].opts.includes('w_hilde'), cs[0]);
  await P.click('#review .rcard[data-rk="0"] [data-r="yes"]');
  check('"Passt so" accepts the new pick', (await cards(P))[0].badge === 'neu');
  await P.click('#review-discard');
  for (const X of [A, B]) await X.ctx.close();
}

// Found in review: pictures of a read that is still on its way survive saving the review; a focused field never hides
// behind the sticky action bar; a long name never widens the page; two new numbered villagers are not "the same".
async function reviewExtras(browser, imgs) {
  const seed = exampleSeed();
  const LONG = 'WMWMWMWMWMWMWMWMWMWMWMWMWMWMWMWMWMWMWMWM';
  seed.w_long = { name: LONG, role: 'companion', traits: '', order: 30, stats: clone(seed.w_agnes.stats) };
  const srv = makeServer({ workers: seed });
  const X = await phone(browser, srv, { name: 'E', inClaude: true, writable: true, user: { id: 'u_owner', owner: true, can: true }, costSeen: true }, { width: 360, height: 740 });
  const P = X.page;
  await P.click('#toggle-photo');
  await P.setInputFiles('#photo-file', imgs);
  await P.evaluate(() => { window.__reply = { workers: [{ name: 'Agnes', image: 1, stats: { cooking: { cur: 2, max: 3, sure: true } } }, { name: 'Oswin', image: 0, stats: { cooking: { cur: 2, max: 3, sure: true } } }] }; });
  await P.click('#photo-read');
  await P.waitForSelector('#review .rcard');
  await readDone(P);
  // read the same pictures again and save the first review while that read is on its way
  await P.click('#photo-read');
  await P.waitForTimeout(30);
  await P.click('#review-apply');
  await readDone(P);
  await P.waitForSelector('#review .rcard');
  const thumbs = await P.evaluate(async () => {
    const out = [];
    for (const i of document.querySelectorAll('#review .rc-thumb img')) out.push(await new Promise(ok => { const x = new Image(); x.onload = () => ok('ok'); x.onerror = () => ok('broken'); x.src = i.src; }));
    return out;
  });
  check('saving a review while the same pictures are read again keeps the new cards\' thumbnails', thumbs.length === 2 && thumbs.every(t => t === 'ok'), thumbs);
  await P.click('#review-discard');
  // a long villager name, two cards on it, numbered new villagers
  await P.evaluate(L => { window.__reply = { workers: [
    { name: L, image: 0, stats: { cooking: { cur: 1, max: 2, sure: false } }, unsure: 'x'.repeat(200) },
    { name: L.slice(0, 39) + 'X', image: 1, stats: { cooking: { cur: 1, max: 2, sure: true } } },
    { name: 'Wache 3', image: 1, stats: { cooking: { cur: 1, max: 2, sure: true } } },
    { name: 'Wache 4', image: 1, stats: { cooking: { cur: 1, max: 2, sure: true } } },
  ] }; }, LONG);
  if (!(await P.$$('#thumbs .thumb')).length) await P.setInputFiles('#photo-file', imgs);   // the saved read emptied the strip
  await P.click('#photo-read');
  await readDone(P);
  await P.selectOption('#rv-1-target', 'w_long');
  await P.waitForTimeout(400);
  const cs = await cards(P);
  const ov = await P.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check('360: a 40-letter name in "Ist das …?", "Ja, …" and "Zwei Karten zeigen auf …" never widens the page', ov.sw <= 360 && ov.iw === 360 && /^Zwei Karten/.test(cs[1].badge) && /^Ist das/.test(cs[0].badge), ov);
  check('"Wache 3" and "Wache 4" are two new villagers', cs[2].badge === 'neu' && cs[3].badge === 'neu', cs.slice(2).map(c => c.badge));
  await P.selectOption('#rv-1-target', '');
  await P.uncheck('#rv-0-on');
  await P.waitForTimeout(100);
  // keyboard through a card: every focused field stays clear of the sticky action bar
  await P.focus('#rv-1-name');
  const hidden = [];
  for (let i = 0; i < 24; i++) {
    await P.keyboard.press('Tab');
    await P.waitForTimeout(50);
    const r = await P.evaluate(() => {
      const a = document.activeElement, bar = document.querySelector('.review-act');
      if (!bar || !a || a.closest('.review-act') || !a.closest('#review')) return null;
      const b = a.getBoundingClientRect(), t = bar.getBoundingClientRect().top;
      return b.bottom > t + 1 ? (a.id || a.dataset.r) + ':' + Math.round(b.bottom) + '>' + Math.round(t) : null;
    });
    if (r) hidden.push(r);
  }
  check('360: a field reached with Tab is never hidden behind the action bar', !hidden.length, hidden);
  await P.click('#review-apply');   // no doubts left on the ticked cards: saved with one tap
  await until(() => byName(srv, 'Wache 4').length === 1, 3000);
  check('…and both are saved as two villagers', byName(srv, 'Wache 3').length === 1 && byName(srv, 'Wache 4').length === 1, [...srv.workers.values()].map(d => d.name));
  // "Ja, Ida" holds like a pick in the select; an unconfirmed suggestion follows the list
  await P.click('#toggle-import');
  await P.fill('#import-text', 'Ina: Landwirtschaft 2/3\nBertran: Kochen 4/9');
  await P.click('#do-import');
  await P.waitForSelector('#review .rcard');
  let rc = await cards(P);
  const before = rc.map(c => [c.target, c.badge]);
  await P.click('#review .rcard[data-rk="0"] [data-r="yes"]');
  srv.workers.set('w_ina', { name: 'Ina', role: 'worker', traits: '', order: 98, stats: {} });
  srv.workers.set('w_bertran', { name: 'Bertran', role: 'worker', traits: '', order: 99, stats: {} });
  srv.broadcast('workers');
  await until(async () => (await cards(P))[1].target === 'w_bertran', 2000);
  rc = await cards(P);
  check('a match confirmed with "Ja, Ida" stays when another phone adds an "Ina"; an unconfirmed one moves to the exact name', before[0][0] === 'w_ida' && before[1][0] === 'w_bertram'
    && rc[0].target === 'w_ida' && rc[0].badge === 'aktualisiert Ida' && rc[1].target === 'w_bertran', { before, after: rc.map(c => [c.target, c.badge]) });
  await P.click('#review-discard');
  await X.ctx.close();
}

// Found in the second review: a villager deleted and brought back with Rückgängig is the card's target again (the
// pick is kept); two villagers with one name are never picked silently; a typed Max below the Stufe is a doubt.
async function reviewFixes2(browser) {
  const seed = exampleSeed();
  seed.w_h1 = { name: 'Hans', role: 'worker', traits: '', order: 20, stats: clone(seed.w_agnes.stats) };
  seed.w_h2 = { name: 'Hans', role: 'worker', traits: '', order: 21, stats: clone(seed.w_bertram.stats) };
  const srv = makeServer({ workers: seed });
  const X = await phone(browser, srv, { name: 'F', inClaude: true, writable: true, user: { id: 'u_owner', owner: true, can: true }, costSeen: true }, { width: 1280, height: 900 });
  const P = X.page;
  await P.click('#toggle-import');
  await P.fill('#import-text', 'Hilde: Kochen 5/6\nGodric: Handwerk 7/10\nHans: Tierpflege 6/8\nAgnes: Ernte 9/7');
  await P.click('#do-import');
  await P.waitForSelector('#review .rcard');
  await P.selectOption('#rv-1-target', 'w_edda');   // a hand pick
  let cs = await cards(P);
  check('two villagers named Hans: amber with their place in the list, never picked silently', cs[2].badge === 'Ist das Hans (Nr. 9)?' && cs[2].yes === 'Ja, Hans (Nr. 9)'
    && cs[2].optText.includes('Hans (Nr. 9)') && cs[2].optText.includes('Hans (Nr. 10)') && !cs[2].optText.includes('Hans'), cs[2]);
  check('text "Ernte 9/7": the Max stays as typed and is a doubt "Stufe über Max"', cs[3].vals.harvesting === '9/7' && cs[3].doubts.harvesting.startsWith('Stufe über Max'), cs[3]);
  const trail = [];
  for (const id of ['w_hilde', 'w_edda']) {
    const del = `#wlist [data-wid="${id}"] [data-act="del"]`;
    await P.click(del); await P.waitForTimeout(500); await P.click(del); await P.waitForTimeout(250);
    trail.push((await cards(P)).slice(0, 2).map(c => c.badge));
    await P.click('#toast button');
    await P.waitForTimeout(300);
    trail.push((await cards(P)).slice(0, 2).map(c => c.target + '|' + c.badge));
  }
  check('deleted, then Rückgängig: the card points to the villager again (an automatic and a hand pick)', trail[0][0] === 'Hilde gibt es nicht mehr' && trail[1].join() === 'w_hilde|aktualisiert Hilde,w_edda|aktualisiert Edda'
    && trail[2][1] === 'Edda gibt es nicht mehr' && trail[3].join() === 'w_hilde|aktualisiert Hilde,w_edda|aktualisiert Edda', trail);
  await P.click('#review .rcard[data-rk="2"] [data-r="yes"]');
  await P.click('#review .rcard[data-rk="3"] .rc-stat[data-a="harvesting"] [data-r="okd"]');
  await P.click('#review-apply');
  await P.waitForTimeout(80);
  if ((await applyText(P)).startsWith('Trotzdem')) { await P.waitForTimeout(500); await P.click('#review-apply'); }
  await until(() => workerWrites(srv).length >= 4, 3000);
  await P.waitForTimeout(200);
  check('saved: Ernte 9/7 becomes 9/9, the confirmed Hans gets the values, the other Hans is untouched', JSON.stringify(srv.workers.get('w_agnes').stats.harvesting) === '{"cur":9,"max":9}'
    && JSON.stringify(srv.workers.get('w_h1').stats.hunting) === '{"cur":6,"max":8}' && JSON.stringify(srv.workers.get('w_h2')) === JSON.stringify(seed.w_h2), [srv.workers.get('w_agnes').stats.harvesting, srv.workers.get('w_h1').stats.hunting]);
  await X.ctx.close();
}

async function errorFlows(browser, imgs) {
  // local mode (no db): rate limit, consent refusal, broken answers
  const L = await phone(browser, null, { name: 'L', inClaude: false, costSeen: true });
  const P = L.page;
  await P.click('#toggle-photo');
  await P.setInputFiles('#photo-file', [imgs[0]]);
  await P.evaluate(() => { window.__err = { code: 'rate_limited', message: 'limit' }; });
  await P.click('#photo-read');
  await until(() => P.isVisible('#photo-astext'), 2000);
  await P.waitForTimeout(1500);
  check('rate_limited: clear message and "Als Text eintragen"', (await P.$eval('#photo-msg', e => e.textContent)) === 'Euer Claude-Limit ist gerade erreicht. Tragt die Werte von Hand oder als Text ein oder versucht es später.' && await P.isVisible('#photo-astext'));
  check('rate_limited: never retried by itself', (await P.evaluate(() => window.__calls.length)) === 1);
  await P.click('#photo-astext');
  await P.waitForTimeout(100);
  check('"Als Text eintragen" opens the text import, ready to type', await P.isVisible('#import') && await P.evaluate(() => document.activeElement.id) === 'import-text' && await P.isHidden('#photo-astext'));
  for (const [code, text] of [['invalid_json', 'Die Antwort war nicht lesbar.'], ['upstream_error', 'Die Verbindung wurde unterbrochen.'], ['weird_new_code', 'Die Verbindung wurde unterbrochen.']]) {
    await P.evaluate(c => { window.__err = { code: c, message: 'x' }; }, code);
    await P.click('#photo-read');
    await readDone(P);
    check(`${code}: message, no review, photos kept`, (await P.$eval('#photo-msg', e => e.textContent)).startsWith(text) && await P.isHidden('#review') && (await P.$$('#thumbs .thumb')).length === 1 && await P.isHidden('#photo-astext'));
  }
  // an answer with nothing usable
  await P.evaluate(() => { window.__err = null; window.__reply = { workers: [], note: 'Auf dem Bild ist das Hauptmenü zu sehen.' }; });
  await P.click('#photo-read');
  await readDone(P);
  check('no villager found: Claude\'s note, no review', await P.isHidden('#review') && (await P.$eval('#photo-msg', e => e.textContent)) === 'Auf dem Bild ist das Hauptmenü zu sehen.');
  // local mode works the same: a read is saved locally only after confirming
  await P.evaluate(() => { window.__reply = { workers: [{ name: 'Mira', image: 0, stats: { cooking: { cur: 3, max: 5, sure: true } } }] }; });
  await P.click('#photo-read');
  await P.waitForSelector('#review .rcard');
  const before = await P.evaluate(() => localStorage.getItem('bellwright-arbeitsplan-v1'));
  await P.click('#review-apply');
  await P.waitForTimeout(150);
  const after = await P.evaluate(() => JSON.parse(localStorage.getItem('bellwright-arbeitsplan-v1') || '{"workers":[]}').workers.map(w => w.name));
  check('local mode: nothing saved during the review, saved after "Ausgewählte übernehmen"', !String(before || '').includes('Mira') && after.includes('Mira'), after);
  // consent refused
  await P.setInputFiles('#photo-file', [imgs[1]]);
  await P.evaluate(() => { window.__err = { code: 'not_granted', message: 'no' }; });
  await P.click('#photo-read');
  await until(() => P.isHidden('#photo'), 2000);
  check('not_granted: photo reading hidden with the reason, text import still there', await P.isHidden('#toggle-photo') && (await P.$eval('#photo-note', e => e.textContent)).startsWith('Ihr habt Claude das Lesen von Bildern für diese Seite nicht erlaubt.') && await P.isVisible('#toggle-import'));
  await L.ctx.close();

  for (const [kind, expect] of [[null, 'Fotos einlesen klappt nur, wenn ihr die Seite in Claude geöffnet habt und angemeldet seid.'], ['limitsThrow', 'Bilder lesen geht in dieser Ansicht nicht.'], ['limitsReject', 'Bilder lesen geht in dieser Ansicht nicht.'], ['noLimits', 'Bilder lesen geht in dieser Ansicht nicht.'], ['noImages', 'Bilder lesen geht in dieser Ansicht nicht.']]) {
    const X = await phone(browser, null, { name: 'S' + kind, inClaude: false, sample: kind });
    await X.page.waitForTimeout(200);
    const note = await X.page.$eval('#photo-note', e => e.hidden ? '' : e.textContent);
    check(`sample ${kind === null ? 'null' : kind}: no photo button, a plain note, text import works`, await X.page.isHidden('#toggle-photo') && note.startsWith(expect) && !(await X.page.$eval('#do-import', b => b.disabled)), note);
    await X.ctx.close();
  }
  // read-only viewer
  const srv = makeServer({ workers: exampleSeed() });
  const C = await phone(browser, srv, { name: 'C', inClaude: true, writable: false, user: { id: 'u_ro', owner: false, can: false } }, { width: 360, height: 740 });
  check('read-only: no photo button, "Prüfen" disabled', await C.page.isHidden('#toggle-photo') && await C.page.$eval('#do-import', b => b.disabled) && (await C.page.$eval('#photo-note', e => e.textContent)).includes('Nur ansehen'));
  await C.ctx.close();
}

async function layout(browser, imgs) {
  for (const [w, h] of [[360, 740], [390, 844], [1280, 900]]) {
    const srv = makeServer({ workers: exampleSeed() });
    const X = await phone(browser, srv, { name: 'L' + w, inClaude: true, writable: true, user: { id: 'u_owner', owner: true, can: true } }, { width: w, height: h });
    const P = X.page;
    await P.click('#toggle-photo');
    await P.setInputFiles('#photo-file', imgs);
    await P.evaluate(r => { window.__reply = r; }, REPLY);
    await P.click('#photo-read');
    await P.waitForSelector('#review .rcard');
    await P.waitForTimeout(600);
    await P.screenshot({ path: `photo5-review-${w}.png` });
    const r = await P.evaluate(coarse => {
      const box = document.getElementById('review').getBoundingClientRect();
      const els = [...document.querySelectorAll('#review button:not([hidden]), #review select, #review input, #review .rc-take')].filter(e => e.getClientRects().length && !e.closest('[hidden]'));
      const small = els.filter(e => { const b = e.getBoundingClientRect(); return e.type !== 'checkbox' && b.height < (coarse ? 44 : 28); }).map(e => (e.dataset.r || e.id || e.className) + ':' + Math.round(e.getBoundingClientRect().height));
      const outside = els.filter(e => { const b = e.getBoundingClientRect(); return b.left < box.left - 0.5 || b.right > box.right + 0.5; }).map(e => e.dataset.r || e.id);
      return { sw: document.documentElement.scrollWidth, vw: innerWidth, small, outside, n: els.length };
    }, w < 900);
    check(`${w}: review without horizontal scroll, every control inside, ${w < 900 ? '>= 44px' : 'readable'} tap targets`, r.sw <= r.vw && !r.small.length && !r.outside.length, r);
    // one hand: scrolled into the middle of the review, the actions stay at the bottom of the screen
    await P.evaluate(() => { const c = document.querySelectorAll('#review .rcard')[2]; window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 100); });
    await P.waitForTimeout(250);
    const act = await P.evaluate(() => { const b = document.querySelector('.review-act').getBoundingClientRect(); return { bottom: Math.round(b.bottom), vh: innerHeight, applyH: document.getElementById('review-apply').getBoundingClientRect().height }; });
    check(`${w}: the action bar sticks to the bottom of the screen while scrolling the review`, Math.abs(act.bottom - act.vh) <= 2, act);
    await P.screenshot({ path: `photo5-review-${w}-mid.png` });
    if (w === 360) {
      // a card with doubts and the amber question, close up
      await P.evaluate(() => document.querySelector('#review .rcard[data-rk="3"]').scrollIntoView({ block: 'start' }));
      await P.waitForTimeout(200);
      await P.screenshot({ path: 'photo5-card-360.png' });
      await P.click('#review-apply');
      await P.waitForTimeout(100);
      await P.screenshot({ path: 'photo5-armed-360.png' });
      // text review too
      await P.click('#review-discard');
      await P.click('#toggle-import');
      await P.fill('#import-text', 'Agnes: Kochen 4/7, Ernte 6/9\nBertram: Ernte 5/6\nKonrad');
      await P.click('#do-import');
      await P.waitForTimeout(400);
      const t = await P.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
      check('360: text review without horizontal scroll', t.sw <= t.vw, t);
      await P.screenshot({ path: 'photo5-text-360.png' });
    }
    if (w === 1280) {
      await P.click('#review .rcard[data-rk="1"] .rc-thumb');
      await P.waitForTimeout(250);
      await P.screenshot({ path: 'photo5-zoom-1280.png' });
      await P.click('#zoom-close');
    }
    await X.ctx.close();
  }
}

async function motion(browser, imgs) {
  // Every review effect follows "Animationen" and the device's reduced-motion wish.
  // BUILD 11: reduced motion means "aus" only while nobody chose a level on this device, so nothing is stored for it.
  for (const [label, anim, reduced] of [['voll', 'voll'], ['ruhig', 'ruhig'], ['aus', 'aus'], ['reduced', undefined, 'reduce']]) {
    const X = await phone(browser, null, { name: 'M' + label, inClaude: false, costSeen: true, anim }, { width: 390, height: 844, reducedMotion: reduced });
    const P = X.page;
    await P.waitForTimeout(1500);   // the page intro is over
    await P.click('#toggle-photo');
    await P.setInputFiles('#photo-file', imgs);
    await P.evaluate(r => { window.__reply = r; }, REPLY);
    await P.click('#photo-read');
    await P.waitForSelector('#review .rcard');
    const list = () => P.evaluate(() => document.getAnimations().map(x => ({ el: (x.effect && x.effect.target && (x.effect.target.className || x.effect.target.id) || '').toString().slice(0, 40),
      name: x.animationName || x.transitionProperty || '', d: x.effect.getComputedTiming().duration, it: x.effect.getComputedTiming().iterations })));
    const a = await list();
    // the roster is empty here (example team only shown), so the doubt to clear is Agnés' unsure Kochen
    await P.click('#review .rcard[data-rk="1"] .rc-stat[data-a="cooking"] [data-r="okd"]');
    const b = await list();
    await P.click('#review .rcard[data-rk="0"] .rc-thumb');
    await P.waitForTimeout(30);
    const c = await list();
    await P.click('#zoom-close');
    const rc = a.filter(x => /rcard/.test(x.el)), flash = b.filter(x => x.name === 'okflash'), zoom = c.filter(x => /zoom/.test(x.el));
    if (label === 'voll') check('voll: cards rise in, "stimmt" flashes, zoom fades', rc.length >= 5 && flash.length === 1 && zoom.length >= 1, { rc: rc.length, flash, zoom });
    if (label === 'ruhig') check('ruhig: only short fades (<= 200 ms), no flash', rc.length >= 1 && [...a, ...b, ...c].every(x => x.d <= 200 && x.it !== Infinity) && !flash.length, { a, b, c });
    if (label === 'aus' || label === 'reduced') check(`${label}: no animation at all`, !a.length && !b.length && !c.length, { a, b, c });
    await X.ctx.close();
  }
}

(async () => {
  process.chdir(__dirname);
  const browser = await chromium.launch();
  try {
    await partA(browser);
    const imgs = await makeImages(browser);
    await photoFlow(browser, imgs);
    await reviewExtras(browser, imgs);
    await reviewFixes2(browser);
    await errorFlows(browser, imgs);
    await layout(browser, imgs);
    await motion(browser, imgs);
  } finally { await browser.close(); }
  for (const l of info) console.log('  ' + l);
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-photo: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

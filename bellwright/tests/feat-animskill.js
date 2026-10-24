// BUILD 11 "Animationen nach dem Skill bellwright-animations": only transform/opacity in keyframes, no endless seal pulse,
// the ember sprite (no gradient per frame), one frame loop, sparks <= 20 and < 800 ms, "ruhig" = opacity fades <= 150 ms,
// reduced motion = "aus" unless chosen on this device, page turn <= 400 ms, a second tap during the stamp advances at once
// (one write), list stagger 30 ms capped at 10, toast in/out and error shake timings, all three levels, 360 px.
const { chromium } = require('playwright');
// BUILD 13: while villagers have open numbers, the banner's "Jetzt im Spiel eintragen" replaces the grid-head button
// (and the sticky bar waits until the banner is scrolled away), so the mode opens through whichever trigger is visible.
const ENTRY_OPEN = '#entry-banner-go:visible, #entry-open:visible';

const LS_KEY = 'bellwright-arbeitsplan-v1';
const AP_KEY = 'bellwright-arbeitsplan-eingetragen-v1';
const ANIM_KEY = 'bellwright-anim-v1';
const DIR = { u_owner: 'Gabriel', u_lena: 'Lena', u_ro: 'Ida' };
const st = o => Object.fromEntries(Object.entries(o).map(([k, [cur, max]]) => [k, { cur, max }]));
const SEED_W = {
  w_agnes: { name: 'Agnes', role: 'worker', traits: 'Optimist', order: 1, stats: st({ labourer: [3, 5], harvesting: [6, 9], farming: [2, 4], cooking: [1, 3], crafting: [2, 6], researching: [0, 2], hunting: [5, 8] }) },
  w_bertram: { name: 'Bertram', role: 'worker', traits: 'Resilient', order: 2, stats: st({ labourer: [7, 9], harvesting: [4, 6], farming: [1, 3], cooking: [2, 4], crafting: [3, 5], researching: [1, 3], hunting: [2, 4] }) },
  w_edda: { name: 'Edda', role: 'worker', traits: '', order: 3, stats: st({ labourer: [2, 4], harvesting: [1, 3], farming: [3, 6], cooking: [8, 10], crafting: [2, 4], researching: [3, 5], hunting: [0, 2] }) },
  w_godric: { name: 'Godric', role: 'worker', traits: 'Prodigy', order: 4, stats: st({ labourer: [3, 6], harvesting: [3, 5], farming: [2, 4], cooking: [1, 4], crafting: [6, 10], researching: [4, 7], hunting: [1, 3] }) },
};
const LOCAL_SEED = { [LS_KEY]: { settings: null, workers: Object.entries(SEED_W).map(([id, x]) => ({ id, ...x })) } };
const NOTE = 'Euer Gerät wünscht weniger Bewegung, darum sind die Animationen von selbst aus. Wählt ihr hier eine Stufe, gilt eure Wahl.';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = d => JSON.parse(JSON.stringify(d));

// ---------- the shared fake server (node side): its own map per collection ----------
function makeServer(seed = {}) {
  const srv = { workers: new Map(), settings: new Map(), ingame: new Map(), prefs: new Map(), log: [], pages: new Set() };
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) srv[c].set(id, clone(d));
  srv.docs = c => [...(srv[c] || new Map())].map(([id, d]) => [id, clone(d)]);
  srv.broadcast = c => { const docs = srv.docs(c); for (const p of srv.pages) p.evaluate(([c, docs]) => window.__deliver && window.__deliver(c, docs), [c, docs]).catch(() => {}); };
  srv.write = async (who, op, c, id, d) => {
    await sleep(40);
    if (!srv[c]) srv[c] = new Map();
    if (op === 'set') srv[c].set(id, clone(d)); else srv[c].delete(id);
    srv.log.push({ who, op, c, id });
    setTimeout(() => srv.broadcast(c), 10);
  };
  return srv;
}

// ---------- page side ----------
// cfg: { name, inClaude, writable, user, dir, anim (seeded once), seedLs }
function STUB(cfg) {
  if (!sessionStorage.getItem('__seeded')) {
    sessionStorage.setItem('__seeded', '1');
    if (cfg.anim) localStorage.setItem('bellwright-anim-v1', JSON.stringify(cfg.anim));
    localStorage.setItem('bellwright-sperre-tipp-v1', 'true');
    for (const [k, v] of Object.entries(cfg.seedLs || {})) localStorage.setItem(k, JSON.stringify(v));
  }
  const fakeLock = { request: async () => { const s = new EventTarget(); s.released = false; s.release = async () => { s.released = true; }; return s; } };
  Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => fakeLock });
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__clip = t; } } }); } catch (e) { /* ignore */ }
  window.__setHidden = h => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  // Canvas: gradients and drawImage on the ember canvas; the sources it draws from.
  window.__cv = { rg: 0, di: 0, srcs: new Set() };
  const C2 = CanvasRenderingContext2D.prototype, oRG = C2.createRadialGradient, oDI = C2.drawImage;
  C2.createRadialGradient = function (...a) { if (this.canvas && this.canvas.id === 'embers') window.__cv.rg++; return oRG.apply(this, a); };
  C2.drawImage = function (...a) { if (this.canvas && this.canvas.id === 'embers') { window.__cv.di++; window.__cv.srcs.add(a[0]); } return oDI.apply(this, a); };
  // Frame loops: requests vs. frames they ran in.
  window.__raf = { req: 0, frames: new Set() };
  const oRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => { window.__raf.req++; return oRaf(t => { window.__raf.frames.add(t); cb(t); }); };
  // Every animation that ever existed on the page.
  // (Animations that already existed at the last reset, e.g. finished ones that still fill, do not count.)
  window.__seen = new Map();
  window.__old = new WeakSet();
  window.__reset = () => { window.__seen.clear(); window.__old = new WeakSet(document.getAnimations()); };
  window.__sample = () => {
    for (const a of document.getAnimations()) {
      if (window.__seen.has(a) || window.__old.has(a)) continue;
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
      let kf = [];
      try { kf = a.effect.getKeyframes(); } catch (e) { /* ignore */ }
      const props = [...new Set(kf.flatMap(k => Object.keys(k).filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p))))];
      const tg = a.effect && a.effect.target;
      window.__seen.set(a, { name: a.animationName || (a.transitionProperty ? 'transition:' + a.transitionProperty : 'js'), kind: a.constructor.name, iter: t.iterations, dur: t.duration, delay: t.delay, end: t.endTime,
        absEnd: a.startTime != null ? a.startTime + t.endTime : document.timeline.currentTime - (a.currentTime || 0) + t.endTime,
        props, kf: kf.map(k => ({ transform: k.transform, opacity: k.opacity })), pseudo: a.effect && a.effect.pseudoElement || '',
        cls: tg ? String(tg.id || tg.className || tg.tagName).slice(0, 60) : '', inFinale: !!(tg && tg.closest && tg.closest('#entry-finale')) });
    }
  };
  // Sparks: when each one is added and removed, and how many come in one go.
  window.__sp = { batches: [], life: [], live: new Map() };
  new MutationObserver(recs => {
    const now = performance.now();
    for (const r of recs) {
      const add = [...r.addedNodes].filter(n => n.nodeType === 1);
      const sp = add.flatMap(n => (n.classList.contains('spark') ? [n] : [...n.querySelectorAll('.spark')]));
      if (sp.length) window.__sp.batches.push({ n: sp.length, at: now, where: r.target.id || r.target.className });
      for (const n of sp) window.__sp.live.set(n, now);
      for (const n of r.removedNodes) if (n.nodeType === 1) for (const s of (n.classList.contains('spark') ? [n] : [...n.querySelectorAll('.spark')])) if (window.__sp.live.has(s)) { window.__sp.life.push(now - window.__sp.live.get(s)); window.__sp.live.delete(s); }
    }
  }).observe(document, { childList: true, subtree: true });
  const sample = async () => ({ text: '' });
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } });
  sample.json = async () => ({ workers: [] });
  if (!cfg.inClaude) { window.claude = { use: async n => (n === 'sample' ? sample : null) }; return; }
  const colL = new Map(), docL = new Map();
  const list = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const cl = d => JSON.parse(JSON.stringify(d));
  const snapC = docs => ({ docs: docs.map(([id, d]) => ({ id, exists: true, data: () => cl(d), metadata: {} })), size: docs.length, empty: !docs.length, metadata: {}, docChanges: () => [] });
  const snapD = (docs, id) => { const e = docs.find(x => x[0] === id); return { id, exists: !!e, data: () => (e ? cl(e[1]) : undefined), metadata: {} }; };
  window.__deliver = (c, docs) => {
    for (const f of colL.get(c) || []) f(snapC(docs));
    for (const [k, fs] of docL) if (k.startsWith(c + '/')) for (const f of fs) f(snapD(docs, k.slice(c.length + 1)));
  };
  const refuse = () => Promise.reject({ code: 'invalid_argument', message: 'below the write level' });
  const docRef = (c, id) => ({
    set: d => cfg.writable ? window.__srvWrite(cfg.name, 'set', c, id, cl(d)) : refuse(),
    delete: () => cfg.writable ? window.__srvWrite(cfg.name, 'delete', c, id, null) : refuse(),
    onSnapshot: n => { list(docL, c + '/' + id).push(n); window.__srvRead(c).then(docs => n(snapD(docs, id))); return () => {}; },
  });
  const db = Object.freeze({
    collection: c => ({ doc: id => docRef(c, id), onSnapshot: n => { list(colL, c).push(n); window.__srvRead(c).then(docs => n(snapC(docs))); return () => {}; } }),
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

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 900) : '')); };
const errs = [];

async function open(browser, srv, cfg, { width = 390, height = 844, reduced = false, hash = '', dpr } = {}) {
  const mobile = width < 900;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference', ...(dpr ? { deviceScaleFactor: dpr } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push((cfg.name || '?') + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push((cfg.name || '?') + ' console: ' + m.text()); });
  if (srv) {
    await ctx.exposeFunction('__srvWrite', (who, op, c, id, d) => srv.write(who, op, c, id, d));
    await ctx.exposeFunction('__srvRead', c => srv.docs(c));
    srv.pages.add(page); page.on('close', () => srv.pages.delete(page));
  }
  await page.addInitScript(STUB, { dir: DIR, ...cfg });
  await page.goto('file://' + process.cwd() + '/page.html' + hash);
  await page.waitForTimeout(700);
  return { ctx, page };
}
async function until(fn, max = 2500, step = 10) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) { if (await fn()) return Date.now() - t0; await sleep(step); }
  return -1;
}
const nameOf = page => page.evaluate(() => { const n = document.getElementById('entry-name'); return n ? n.textContent : null; });
const countOf = page => page.evaluate(() => document.getElementById('entry-count').textContent.replace(/\s+/g, ' ').replace(' von / ', ' / '));
const overflow = page => page.evaluate(() => { const e = document.getElementById('entry'); return Math.max(document.documentElement.scrollWidth - innerWidth, e.hidden ? 0 : e.scrollWidth - e.clientWidth); });
const sampleNow = page => page.evaluate(() => window.__sample());
const seen = page => page.evaluate(() => [...window.__seen.values()]);
const resetSeen = page => page.evaluate(() => window.__reset());
const canvasSig = page => page.evaluate(() => { const c = document.getElementById('embers'); const d = c.getContext('2d').getImageData(0, 0, Math.max(1, c.width), Math.max(1, c.height)).data; let h = 0, n = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] > 10) n++; if (i % 97 === 0) h = (h * 31 + d[i]) | 0; } return { h, n }; });
// The animation on el at its very start: computed transform translation and opacity there.
const startPose = (page, sel, name) => page.evaluate(([sel, name]) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const a = el.getAnimations().find(x => !name || x.animationName === name);
  if (!a) return null;
  const t = a.effect.getComputedTiming();
  a.pause(); a.currentTime = t.delay || 0;
  const cs = getComputedStyle(el), m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
  const r = { name: a.animationName, dur: t.duration, delay: t.delay, easing: a.effect.getTiming().easing, cssEasing: cs.animationTimingFunction, x: Math.round(m.m41), y: Math.round(m.m42), opacity: +cs.opacity };
  a.play();
  return r;
}, [sel, name]);

(async () => {
  const browser = await chromium.launch();

  // ===== 1) The style sheet: keyframes, the single switch [data-anim], endless loops, "ruhig" rules, the style table =====
  {
    const { ctx, page: P } = await open(browser, null, { name: 'CSS', inClaude: false, anim: 'voll' });
    const css = await P.evaluate(() => {
      const kf = {}, rules = [];
      const walk = (list, rm) => {
        for (const r of list) {
          if (r instanceof CSSKeyframesRule) kf[r.name] = [...r.cssRules].map(k => { const p = {}; for (let i = 0; i < k.style.length; i++) p[k.style[i]] = k.style.getPropertyValue(k.style[i]); return { key: k.keyText, p }; });
          else if (r instanceof CSSMediaRule) walk(r.cssRules, rm || /prefers-reduced-motion/.test(r.conditionText || r.media.mediaText));
          else if (r instanceof CSSStyleRule) {
            const s = r.style, text = s.cssText;
            const anim = /(^|;|\s)animation(-name)?\s*:/.test(text) && s.animationName !== 'none';
            const trans = /(^|;|\s)transition(-property|-duration)?\s*:/.test(text) && s.transitionProperty !== 'none' && s.transitionDuration !== '0s';
            if (anim || trans) rules.push({ sel: r.selectorText, text, rm, anim, trans, name: s.animationName, dur: s.animationDuration, delay: s.animationDelay, iter: s.animationIterationCount, fn: s.animationTimingFunction, tdur: s.transitionDuration, tprop: s.transitionProperty });
          }
        }
      };
      for (const sh of document.styleSheets) { try { walk(sh.cssRules, false); } catch (e) { /* cross-origin font sheet */ } }
      return { kf, rules };
    });
    const ALLOWED = new Set(['transform', 'opacity', 'animation-timing-function']);
    const badKf = Object.entries(css.kf).filter(([, ks]) => ks.some(k => Object.keys(k.p).some(p => !ALLOWED.has(p)))).map(([n, ks]) => n + ':' + [...new Set(ks.flatMap(k => Object.keys(k.p)))].join('/'));
    check('every @keyframes animates only transform and opacity', badKf.length === 0, badKf);
    check('no animation or transition rule hides inside a prefers-reduced-motion media query (html[data-anim] is the switch)', css.rules.every(r => !r.rm), css.rules.filter(r => r.rm).map(r => r.sel).slice(0, 5));
    const ungated = css.rules.filter(r => !/\[data-anim=/.test(r.sel));
    check('every animation/transition rule keys on html[data-anim]', ungated.length === 0, ungated.map(r => r.sel));
    const endless = css.rules.filter(r => /infinite/.test(r.text));
    check('endless loops only in "voll" and only for the title torch layers and the photo "working" bell', endless.length > 0 && endless.every(r => /\[data-anim="voll"\]/.test(r.sel) && !/ruhig/.test(r.sel) && /(h1::(before|after)|\.working::before)/.test(r.sel)), endless.map(r => r.sel));
    check('the main-job seal no longer pulses (no animation on .main)', !css.rules.some(r => r.anim && /\.main/.test(r.sel)) && !css.kf.seal, css.rules.filter(r => r.anim && /\.main/.test(r.sel)).map(r => r.sel));
    check('the title flicker animates glow layers, not text-shadow', !css.kf.torchText && css.rules.some(r => /h1::after/.test(r.sel) && /infinite/.test(r.text)) && css.rules.some(r => /h1::before/.test(r.sel) && /infinite/.test(r.text)) && !css.rules.some(r => /h1\s*$/.test(r.sel) || /h1\s*\{/.test(r.sel)), css.rules.filter(r => /h1/.test(r.sel)).map(r => r.sel));
    // "ruhig": opacity fades only, at most 150 ms; transitions at most 150 ms.
    const ms = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean).map(x => /ms$/.test(x) ? parseFloat(x) : parseFloat(x) * 1000);
    const calm = css.rules.filter(r => /\[data-anim="ruhig"\]/.test(r.sel));
    const calmBad = calm.filter(r => (r.anim && (ms(r.dur).some(d => !(d <= 150)) || String(r.name).split(',').map(s => s.trim()).some(n => !css.kf[n] || css.kf[n].some(k => Object.keys(k.p).some(p => !['opacity', 'animation-timing-function'].includes(p))))))
      || (r.trans && ms(r.tdur).some(d => !(d <= 150))));
    check('"ruhig" rules: only opacity keyframes and nothing over 150 ms', calm.length >= 5 && calmBad.length === 0, calmBad.map(r => r.sel + ' | ' + r.text.slice(0, 120)));
    // The style table.
    const rule = re => css.rules.find(r => re.test(r.sel) && /\[data-anim="voll"\]/.test(r.sel) && r.anim);
    const bump = rule(/\.bump/), stamp = rule(/\.stamp::before/);
    const kfT = n => (css.kf[n] || []).map(k => k.key + ' ' + (k.p.transform || '')).join(' | ');
    check('changed priority stamps: scale 1.25 -> 0.95 -> 1, 320 ms, cubic-bezier(.3,1.6,.5,1)', bump && ms(bump.dur)[0] === 320 && /cubic-bezier\(0\.3, 1\.6, 0\.5, 1\)/.test(bump.fn)
      && /^0% scale\(1\.25\) \| 60% scale\(0\.95\) \| 100% scale\(1\)$/.test(kfT(bump.name)), { bump, kf: kfT(bump && bump.name) });
    check('tick seal presses in: scale 1.4 -> 1 with -8° -> 0, 380 ms, overshoot', stamp && ms(stamp.dur)[0] === 380 && /cubic-bezier\(0\.3, 1\.6, 0\.5, 1\)/.test(stamp.fn)
      && /scale\(1\.4\) rotate\(-8deg\)/.test(kfT(stamp.name)), { stamp, kf: kfT(stamp && stamp.name) });
    const tab = rule(/\.panel\.enter/);
    check('tab switch: 260 ms cubic-bezier(.2,.7,.2,1)', tab && ms(tab.dur)[0] === 260 && /cubic-bezier\(0\.2, 0\.7, 0\.2, 1\)/.test(tab.fn), tab);
    // List load: 220 ms each, 30 ms apart, at most 10 apart, then all together.
    const rev = await P.evaluate(() => {
      const box = document.createElement('div');
      box.innerHTML = Array.from({ length: 14 }, (_, i) => `<div class="reveal" style="--i:${i}">x</div>`).join('');
      document.querySelector('.wrap').append(box);
      const r = [...box.children].map(el => { const cs = getComputedStyle(el); return { d: cs.animationDelay, dur: cs.animationDuration, fn: cs.animationTimingFunction }; });
      box.remove();
      return r;
    });
    const delays = rev.map(r => Math.round(ms(r.d)[0]));
    check('list load: 220 ms ease-out per row, 30 ms stagger, capped at 10 rows', rev.every(r => ms(r.dur)[0] === 220 && r.fn === 'ease-out')
      && JSON.stringify(delays) === JSON.stringify([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 300, 300, 300]), { delays, r: rev[0] });
    await ctx.close();
  }

  // ===== 2) Embers: one sprite drawn with drawImage, one frame loop, DPR <= 2, half the sparks on a phone, pauses =====
  for (const [w, h, max] of [[390, 844, 14], [1280, 900, 28]]) {
    const { ctx, page: P } = await open(browser, null, { name: 'EM' + w, inClaude: false, anim: 'voll', seedLs: LOCAL_SEED }, { width: w, height: h, dpr: 3 });
    await P.waitForTimeout(400);
    await P.evaluate(() => { window.__cv.rg = 0; window.__cv.di = 0; window.__cv.srcs.clear(); window.__raf.req = 0; window.__raf.frames.clear(); });
    await P.waitForTimeout(600);
    const r = await P.evaluate(() => { const s = [...window.__cv.srcs]; const c = document.getElementById('embers'); return { rg: window.__cv.rg, di: window.__cv.di, srcs: s.length, sprite: s[0] ? { canvas: s[0] instanceof HTMLCanvasElement, attached: s[0].isConnected, w: s[0].width, h: s[0].height } : null,
      req: window.__raf.req, frames: window.__raf.frames.size, cw: c.width, iw: innerWidth }; });
    check(`${w}: embers draw one pre-rendered sprite with drawImage, no gradient per frame`, r.rg === 0 && r.di > 0 && r.srcs === 1 && r.sprite && r.sprite.canvas && !r.sprite.attached && r.sprite.w <= 64, r);
    check(`${w}: one frame loop (one request per frame)`, r.frames > 5 && r.req <= r.frames + 1, r);
    const per = r.di / r.frames;
    check(`${w}: up to ${max} embers per frame${w < 600 ? ' (halved on a phone)' : ''}`, per <= max && per > (w < 600 ? max - 4 : 14), { per });
    check(`${w}: devicePixelRatio capped at 2 (device 3)`, r.cw === r.iw * 2, r);
    // Hidden: no frames at all; visible again: back.
    await P.evaluate(() => window.__setHidden(true)); await P.waitForTimeout(50);
    await P.evaluate(() => { window.__raf.req = 0; });
    await P.waitForTimeout(300);
    const hid = await P.evaluate(() => window.__raf.req);
    await P.evaluate(() => window.__setHidden(false)); await P.waitForTimeout(200);
    const back = await P.evaluate(() => window.__raf.req);
    check(`${w}: hidden page: the loop stops, visible: it runs again`, hid === 0 && back > 0, { hid, back });
    if (w === 390) {
      // The Eintragen-Modus covers the page: no frames.
      await P.click(ENTRY_OPEN); await P.waitForTimeout(100);
      await P.evaluate(() => { window.__raf.req = 0; }); await P.waitForTimeout(300);
      check('entry mode open: the ember loop waits', (await P.evaluate(() => window.__raf.req)) === 0);
      await P.keyboard.press('Escape'); await P.waitForTimeout(150);
      // ruhig: no loop, empty canvas.
      await P.click('#tab-jobs'); await P.click('[data-anim-set="ruhig"]'); await P.waitForTimeout(50);
      await P.evaluate(() => { window.__raf.req = 0; }); await P.waitForTimeout(300);
      const c = await canvasSig(P);
      check('ruhig: no ember loop, canvas empty (no particles)', (await P.evaluate(() => window.__raf.req)) === 0 && c.n === 0, c);
    }
    await ctx.close();
  }

  // ===== 3) Entry mode in all three levels: page turn, seal, sparks, second tap, finale =====
  for (const mode of ['voll', 'ruhig', 'aus']) {
    const T = `[${mode}] `;
    const srv = makeServer({ workers: SEED_W });
    const { ctx, page: P } = await open(browser, srv, { name: 'E-' + mode, inClaude: true, writable: true, anim: mode, user: { id: 'u_owner', owner: true, can: true } });
    const writes = () => srv.log.filter(l => l.c === 'ingame').length;
    await P.click(ENTRY_OPEN); await P.waitForTimeout(450);
    await resetSeen(P);
    await P.evaluate(() => { window.__sp.batches = []; window.__sp.life = []; });
    // Fertig once: the seal; the next villager comes by itself soon.
    const t0 = Date.now();
    await P.click('#entry-next');
    await P.waitForTimeout(30); await sampleNow(P);
    await P.waitForTimeout(150); await sampleNow(P);
    const moved = await until(async () => (await nameOf(P)) === 'Bertram', 1500, 5);
    const dt = Date.now() - t0;
    const limit = { voll: 700, ruhig: 500, aus: 400 }[mode];
    check(T + `after Fertig the next villager comes by itself within ${limit} ms`, moved >= 0 && dt <= limit, dt);
    await sampleNow(P); await P.waitForTimeout(150); await sampleNow(P);
    await P.waitForTimeout(500); await sampleNow(P);
    const s1 = await seen(P);
    if (mode === 'voll') {
      const seal = s1.filter(a => ['waxDrop', 'waxShadow', 'waxRing', 'ribbonIn', 'thump'].includes(a.name));
      check(T + 'seal: drop, shadow, ring, ribbon, thump each <= 400 ms', seal.length >= 5 && seal.every(a => a.dur <= 400), seal.map(a => a.name + ':' + a.dur));
      const turn = s1.filter(a => ['leafAway', 'shadeIn', 'shadeOut'].includes(a.name));
      check(T + 'page turn: <= 400 ms', turn.length >= 2 && turn.every(a => a.dur <= 400), turn.map(a => a.name + ':' + a.dur));
    }
    if (mode === 'ruhig') {
      const bad = s1.filter(a => !(a.end <= 150) || a.props.some(p => p !== 'opacity'));
      check(T + 'only opacity fades, each <= 150 ms (seal, page)', s1.length > 0 && bad.length === 0, bad);
    }
    if (mode === 'aus') check(T + 'no animation at all', s1.length === 0, s1.slice(0, 4));
    const sp = await P.evaluate(() => ({ batches: window.__sp.batches, life: window.__sp.life, live: window.__sp.live.size }));
    if (mode === 'voll') check(T + 'seal burst: 1–20 sparks in one go, each gone in under 800 ms', sp.batches.length === 1 && sp.batches[0].n >= 1 && sp.batches[0].n <= 20 && sp.life.length === sp.batches[0].n && sp.life.every(l => l < 800) && sp.live === 0, sp);
    else check(T + 'no sparks', sp.batches.length === 0, sp);
    // A second tap while the seal lands: on at once, no second write, nothing queued.
    await P.evaluate(() => { window.__sp.batches = []; window.__sp.life = []; });
    const w0 = writes();
    await P.click('#entry-next'); await P.waitForTimeout(60);
    // Time from the second click event to the new page (inside the page, without the test driver's click latency).
    await P.evaluate(() => {
      window.__tap2 = null; window.__swap = null;
      document.addEventListener('click', () => { if (window.__tap2 === null) window.__tap2 = performance.now(); }, { capture: true, once: true });
      const mo = new MutationObserver(() => { const n = document.getElementById('entry-name'); if (n && n.textContent === 'Edda' && window.__swap === null) { window.__swap = performance.now(); mo.disconnect(); } });
      mo.observe(document.getElementById('entry-stage'), { childList: true, subtree: true });
    });
    await P.click('#entry-next');
    const at = await until(async () => (await nameOf(P)) === 'Edda', 1000, 5);
    const dt2 = await P.evaluate(() => window.__swap !== null && window.__tap2 !== null ? Math.round(window.__swap - window.__tap2) : -1);
    await P.waitForTimeout(120);
    const after2 = await P.evaluate(() => ({ landing: document.querySelectorAll('.entry-card .entry-seal.landing, .entry-card.thump').length, sparks: document.querySelectorAll('#entry-fx .spark').length }));
    check(T + 'second tap during the stamp: next villager at once (no waiting, same task as the click)', at >= 0 && dt2 >= 0 && dt2 <= 30, dt2);
    await P.waitForTimeout(250);
    check(T + '...with one write only (Bertram ticked, Edda not)', writes() === w0 + 1 && srv.ingame.has('w_bertram') && !srv.ingame.has('w_edda'), { w: writes() - w0, ingame: [...srv.ingame.keys()] });
    check(T + '...the effects are finished at once (no seal still landing, no sparks left)', after2.landing === 0 && after2.sparks === 0, after2);
    await P.waitForTimeout(700);
    check(T + '...and nothing queued: still on Edda, 3 / 4', (await nameOf(P)) === 'Edda' && (await countOf(P)) === '3 / 4');
    // Rapid triple tap: only one tick (the third tap right after the quick turn does not tick Godric... it is Edda's card now).
    const w1 = writes();
    await P.click('#entry-next'); await P.waitForTimeout(50); await P.click('#entry-next'); await P.waitForTimeout(40); await P.click('#entry-next');
    await P.waitForTimeout(400);
    check(T + 'rapid triple tap: one write (Edda), on Godric, Godric not ticked', writes() === w1 + 1 && srv.ingame.has('w_edda') && !srv.ingame.has('w_godric') && (await nameOf(P)) === 'Godric', { w: writes() - w1, name: await nameOf(P), ingame: [...srv.ingame.keys()] });
    // Page turn back and forth with keys during the turn: never stuck.
    await P.waitForTimeout(400);
    for (let k = 0; k < 6; k++) { await P.keyboard.press(k % 2 ? 'ArrowRight' : 'ArrowLeft'); await P.waitForTimeout(30); }
    await P.waitForTimeout(450);
    const stuck = await P.evaluate(() => ({ ghost: document.querySelectorAll('.entry-ghost').length, leaf: document.querySelectorAll('.leaf-under, .leaf-back, .leaf-fwd').length }));
    check(T + 'six quick arrow presses: no ghost or turning page left behind', stuck.ghost === 0 && stuck.leaf === 0 && (await nameOf(P)) === 'Godric', stuck);
    // Finale: the banner within 700 ms, fountain <= 20 sparks under 800 ms each.
    await resetSeen(P);
    await P.evaluate(() => { window.__sp.batches = []; window.__sp.life = []; });
    await P.click('#entry-next');
    await until(async () => P.evaluate(() => !document.getElementById('entry-finale').hidden), 1500, 5);
    for (const t of [20, 120, 200, 200, 200]) { await P.waitForTimeout(t); await sampleNow(P); }
    await P.waitForTimeout(900);
    const fin = await seen(P), fsp = await P.evaluate(() => ({ batches: window.__sp.batches, life: window.__sp.life, live: window.__sp.live.size }));
    const fd = await P.evaluate(() => parseFloat(document.getElementById('entry-finale').style.getPropertyValue('--fd')) || 0);
    const parts = fin.filter(a => a.inFinale && a.name !== 'sparkFly');
    if (mode === 'voll') {
      check(T + 'finale: banner, rod, bell, tails and text are all in within 700 ms', parts.length >= 6 && parts.every(a => a.end - fd <= 700 && a.dur <= 700), { fd, parts: parts.map(a => a.name + ':' + a.delay + '+' + a.dur) });
      check(T + 'finale fountain: <= 20 sparks, each gone in under 800 ms', fsp.batches.length >= 1 && fsp.batches.every(b => b.n <= 20) && fsp.batches.filter(b => /fin-fx/.test(b.where)).length === 1 && fsp.life.every(l => l < 800) && fsp.live === 0, fsp);
    } else check(T + 'finale: no fountain', fsp.batches.length === 0);
    if (mode === 'ruhig') check(T + 'finale: one short fade only', fin.length > 0 && fin.every(a => a.end <= 150 && a.props.every(p => p === 'opacity')), fin);
    if (mode === 'aus') check(T + 'finale: no animation', fin.length === 0, fin);
    check(T + '390: no horizontal overflow', (await overflow(P)) <= 0);
    await ctx.close();
  }

  // ===== 4) Reduced motion: "aus" unless chosen on this device; the note; live switch =====
  {
    const { ctx, page: P } = await open(browser, null, { name: 'RM0', inClaude: false, seedLs: LOCAL_SEED }, { reduced: true, hash: '#jobs' });
    const s = await P.evaluate(() => ({ anim: document.documentElement.dataset.anim, pressed: [...document.querySelectorAll('[data-anim-set]')].map(b => b.dataset.animSet + ':' + b.getAttribute('aria-pressed')).join(), note: document.getElementById('anim-rm').hidden ? null : document.getElementById('anim-rm').textContent, ls: localStorage.getItem('bellwright-anim-v1') }));
    check('reduced, nothing chosen: html[data-anim="aus"], "Aus" pressed, nothing stored', s.anim === 'aus' && s.pressed === 'voll:false,ruhig:false,aus:true' && s.ls === null, s);
    check('reduced: the note says the device asks for less motion and that a choice here wins', s.note === NOTE, s.note);
    await resetSeen(P);
    await P.click('#tab-plan'); await P.click('#panel-plan [data-phase="ausbau"]'); await P.waitForTimeout(40); await sampleNow(P);
    await P.click(ENTRY_OPEN); await P.waitForTimeout(40); await sampleNow(P);
    await P.click('#entry-next'); await P.waitForTimeout(40); await sampleNow(P);
    await P.waitForTimeout(500); await P.keyboard.press('Escape'); await P.waitForTimeout(40); await sampleNow(P);
    await P.click('#tab-jobs'); await P.waitForTimeout(40); await sampleNow(P);
    const none = await seen(P), c = await canvasSig(P);
    check('reduced, nothing chosen: no animation after phase switch, entry, Fertig, tab switch; no embers', none.length === 0 && c.n === 0, { none: none.slice(0, 4), c });
    // A deliberate choice wins over the device.
    await P.click('[data-anim-set="voll"]'); await P.waitForTimeout(50);
    const s2 = await P.evaluate(() => ({ anim: document.documentElement.dataset.anim, ls: localStorage.getItem('bellwright-anim-v1'), note: !document.getElementById('anim-rm').hidden }));
    await resetSeen(P);
    await P.click('#tab-wissen'); await P.waitForTimeout(40); await sampleNow(P);
    await P.waitForTimeout(400);
    const s2a = await seen(P), c2 = await canvasSig(P);
    check('reduced + "Voll" chosen: html[data-anim="voll"], stored, the note stays', s2.anim === 'voll' && s2.ls === '"voll"' && s2.note, s2);
    check('reduced + "Voll" chosen: the tab slides in and the embers glow', s2a.some(a => a.name === 'pageIn') && c2.n > 0, { s2a: s2a.map(a => a.name), c2 });
    await ctx.close();
    // Stored before the page loads.
    for (const [want, stored] of [['voll', 'voll'], ['ruhig', 'ruhig']]) {
      const X = await open(browser, null, { name: 'RM-' + stored, inClaude: false, anim: stored }, { reduced: true });
      check(`reduced + "${stored}" stored: html[data-anim="${want}"]`, (await X.page.evaluate(() => document.documentElement.dataset.anim)) === want);
      await X.ctx.close();
    }
    // Live: the device switch flips the level only while nothing was chosen.
    const L = await open(browser, null, { name: 'RM-live', inClaude: false });
    const a0 = await L.page.evaluate(() => document.documentElement.dataset.anim);
    await L.page.emulateMedia({ reducedMotion: 'reduce' }); await L.page.waitForTimeout(100);
    const a1 = await L.page.evaluate(() => ({ anim: document.documentElement.dataset.anim, note: !document.getElementById('anim-rm').hidden, raf: window.__raf.req }));
    await L.page.evaluate(() => { window.__raf.req = 0; }); await L.page.waitForTimeout(250);
    const raf1 = await L.page.evaluate(() => window.__raf.req);
    await L.page.emulateMedia({ reducedMotion: 'no-preference' }); await L.page.waitForTimeout(100);
    const a2 = await L.page.evaluate(() => document.documentElement.dataset.anim);
    check('nothing chosen: the device switch flips voll -> aus -> voll live (loop stops while aus)', a0 === 'voll' && a1.anim === 'aus' && a1.note && raf1 === 0 && a2 === 'voll', { a0, a1, raf1, a2 });
    await L.page.click('#tab-jobs'); await L.page.click('[data-anim-set="ruhig"]');
    await L.page.emulateMedia({ reducedMotion: 'reduce' }); await L.page.waitForTimeout(100);
    check('"Ruhig" chosen: the device switch changes nothing', (await L.page.evaluate(() => document.documentElement.dataset.anim)) === 'ruhig');
    await L.ctx.close();
    // Hidden page pauses CSS loops even without the reduced-motion wrapper.
    const H = await open(browser, null, { name: 'RM-hid', inClaude: false, anim: 'voll' }, { reduced: true });
    await H.page.evaluate(() => window.__setHidden(true));
    const ps = await H.page.evaluate(() => document.querySelector('h1').getAnimations({ subtree: true }).map(a => a.playState));
    await H.page.evaluate(() => window.__setHidden(false));
    const ps2 = await H.page.evaluate(() => document.querySelector('h1').getAnimations({ subtree: true }).map(a => a.playState));
    check('reduced + "Voll" chosen, hidden: the torch layers pause; visible: they run', ps.length === 2 && ps.every(x => x === 'paused') && ps2.every(x => x === 'running'), { ps, ps2 });
    await H.ctx.close();
  }

  // ===== 5) Plan, tabs, toast, shake in all three levels (+ 360 px) =====
  for (const mode of ['voll', 'ruhig', 'aus']) {
    const T = `[${mode}] `;
    const { ctx, page: P } = await open(browser, null, { name: 'U-' + mode, inClaude: false, anim: mode, seedLs: { ...LOCAL_SEED, 'bellwright-arbeitsplan-view': 'cards' } }, { width: 360, height: 760 });
    await P.waitForTimeout(400);
    // Tab switch: 12 px slide + fade 260 ms (direction-aware).
    await resetSeen(P);
    await P.click('#tab-jobs'); await P.waitForTimeout(10);
    const fwd = await startPose(P, '#panel-jobs');
    await P.waitForTimeout(300);
    await P.click('#tab-arbeiter'); await P.waitForTimeout(10);
    const backT = await startPose(P, '#panel-arbeiter');
    if (mode === 'voll') check(T + 'tab switch: slides 12 px in (from the side you go to) and fades, 260 ms', fwd && fwd.name === 'pageIn' && fwd.dur === 260 && fwd.x === 12 && fwd.y === 0 && fwd.opacity === 0 && backT && backT.x === -12, { fwd, backT });
    if (mode === 'ruhig') check(T + 'tab switch: a 150 ms fade, no slide', fwd && fwd.dur <= 150 && fwd.x === 0 && fwd.opacity === 0, fwd);
    if (mode === 'aus') check(T + 'tab switch: no animation', fwd === null && backT === null);
    // The tab underline: voll grows it (150 ms), ruhig only fades it (skill: "Ruhig" = opacity fades only), aus: at once.
    await P.click('#tab-wissen'); await P.waitForTimeout(10);
    const ul = await P.evaluate(() => ({
      anims: document.getElementById('tab-wissen').getAnimations({ subtree: true }).concat(document.getElementById('tab-arbeiter').getAnimations({ subtree: true }))
        .map(a => ({ p: a.transitionProperty || a.animationName, pseudo: a.effect && a.effect.pseudoElement, dur: a.effect.getComputedTiming().duration })),
    }));
    await P.waitForTimeout(220);
    const ulEnd = await P.evaluate(() => ['tab-wissen', 'tab-arbeiter'].map(id => { const cs = getComputedStyle(document.getElementById(id), '::after'); return { id, o: +cs.opacity, tf: cs.transform }; }));
    const shown = u => u.o === 1 && (u.tf === 'none' || u.tf === 'matrix(1, 0, 0, 1, 0, 0)'), gone = u => u.o === 0 || /^matrix\(0, /.test(u.tf);
    check(T + 'tab underline: on the chosen tab, gone from the other', shown(ulEnd[0]) && gone(ulEnd[1]), ulEnd);
    const ulA = ul.anims.filter(a => a.pseudo === '::after');
    if (mode === 'voll') check(T + 'tab underline: grows in 150 ms', ulA.length >= 1 && ulA.every(a => a.p === 'transform' && a.dur <= 150), ul);
    if (mode === 'ruhig') check(T + 'tab underline: only fades (opacity, <= 150 ms), it does not grow', ulA.length >= 1 && ulA.every(a => a.p === 'opacity' && a.dur <= 150), ul);
    if (mode === 'aus') check(T + 'tab underline: no transition', ulA.length === 0, ul);
    await P.click('#tab-plan'); await P.waitForTimeout(300);
    // A tick on a card: the seal presses in, the toast rises in.
    await resetSeen(P);
    await P.click('#wp-w_agnes [data-applied]'); await P.waitForTimeout(10);
    const tIn = await startPose(P, '#toast');
    await sampleNow(P);
    const seal = (await seen(P)).filter(a => a.name === 'stamp');
    if (mode === 'voll') {
      check(T + 'toast in: 16 px from below + fade, 240 ms ease-out', tIn && tIn.dur === 240 && /ease-out/.test(tIn.cssEasing) && tIn.y === 16 && tIn.opacity === 0, tIn);
      check(T + 'tick: the wax seal presses in (380 ms)', seal.length >= 1 && seal.every(a => a.dur === 380), seal);
    }
    if (mode === 'ruhig') check(T + 'toast in: 150 ms fade, no movement', tIn && tIn.dur <= 150 && tIn.y === 0 && tIn.opacity === 0, tIn);
    if (mode === 'aus') check(T + 'toast in: none', tIn === null);
    // Out: Strg+Z hides it (and shows "Rückgängig gemacht."): the old one only fades, 160 ms, and is gone.
    await P.waitForTimeout(300);
    await P.evaluate(() => document.activeElement && document.activeElement.blur());
    await P.keyboard.press('Control+z'); await P.waitForTimeout(10);
    const g = await P.evaluate(() => { const gs = [...document.querySelectorAll('.toast-ghost')]; const t = document.getElementById('toast'); return { n: gs.length, id: gs.map(x => x.id).join(''), aria: gs.map(x => x.getAttribute('aria-hidden')).join(), pe: gs.map(x => getComputedStyle(x).pointerEvents).join(), anim: gs.flatMap(x => x.getAnimations().map(a => ({ d: a.effect.getComputedTiming().duration, props: [...new Set(a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p))))] }))), msg: t.hidden ? '' : t.textContent }; });
    if (mode === 'aus') check(T + 'toast out: gone at once, no fading copy', g.n === 0 && g.msg === 'Rückgängig gemacht.', g);
    else check(T + `toast out: only a fade, ${mode === 'voll' ? 160 : 150} ms, on an inert copy (no id, aria-hidden, no pointer)`, g.n === 1 && g.id === '' && g.aria === 'true' && g.pe === 'none' && g.anim.length === 1 && g.anim[0].d === (mode === 'voll' ? 160 : 150) && g.anim[0].props.join() === 'opacity' && g.msg === 'Rückgängig gemacht.', g);
    await P.waitForTimeout(260);
    check(T + 'toast out: the copy is removed', (await P.evaluate(() => document.querySelectorAll('.toast-ghost').length)) === 0);
    // The real toast times out (3.6 s): hidden at once for assistive tech, the copy fades.
    await P.waitForTimeout(3000);
    let g2 = null;
    await until(async () => { g2 = await P.evaluate(() => ({ hidden: document.getElementById('toast').hidden, ghosts: document.querySelectorAll('.toast-ghost').length })); return g2.hidden; }, 1500, 5);
    check(T + 'toast timeout: #toast hidden' + (mode === 'aus' ? '' : ', fading copy on screen'), g2.hidden && g2.ghosts === (mode === 'aus' ? 0 : 1), g2);
    await P.waitForTimeout(250);
    // A changed priority on the plan: in voll it rolls and lands with the stamp; ruhig fades; aus nothing.
    await resetSeen(P);
    await P.click('#panel-plan [data-phase="ausbau"]');
    for (const t of [20, 150, 150, 150, 150, 150, 150]) { await P.waitForTimeout(t); await sampleNow(P); }
    const pl = await seen(P);
    if (mode === 'voll') {
      const st1 = pl.filter(a => a.name === 'bump'), rolls = pl.filter(a => a.name === 'odoRoll' || a.name === 'odoIn'), sw = pl.filter(a => a.name === 'sweepBand');
      check(T + 'phase switch: numbers roll (<= 400 ms) and land with the stamp (320 ms)', rolls.length > 0 && rolls.every(a => a.dur <= 400) && st1.length > 0 && st1.every(a => a.dur === 320), { rolls: rolls.slice(0, 3), st1: st1.slice(0, 3) });
      check(T + 'phase switch at 360: no card on screen, so no sweep band; any band <= 400 ms', sw.every(a => a.dur <= 400), sw.map(a => a.dur));
      // The header bell rings when main jobs change (also on load and when someone else changes the plan): <= 700 ms, see 7).
      const longer = pl.filter(a => a.iter !== Infinity && a.dur > 400 && a.name !== 'swing' && !/^transition:/.test(a.name));
      check(T + 'phase switch: no single animation over 400 ms (besides the bell ring)', longer.length === 0, longer);
    }
    if (mode === 'ruhig') check(T + 'phase switch: only fades <= 150 ms', pl.length > 0 && pl.every(a => a.end <= 150 && (a.props.every(p => p === 'opacity') || /^transition:/.test(a.name))), pl.filter(a => !(a.end <= 150 && (a.props.every(p => p === 'opacity') || /^transition:/.test(a.name)))));
    if (mode === 'aus') check(T + 'phase switch: nothing moves', pl.length === 0, pl);
    // Error shake: an import with nothing readable.
    await P.click('#tab-arbeiter'); await P.waitForTimeout(300);
    await P.click('#toggle-import'); await P.fill('#import-text', 'nichts davon ist lesbar'); await P.waitForTimeout(200);
    await resetSeen(P);
    await P.click('#do-import'); await P.waitForTimeout(10);
    const sh = await P.evaluate(() => { const el = document.getElementById('import-text'); return el.getAnimations().map(a => { const kf = a.effect.getKeyframes(); return { d: a.effect.getComputedTiming().duration, easing: a.effect.getTiming().easing, xs: kf.map(k => k.transform ? Math.round(new DOMMatrixReadOnly(k.transform).m41) : null), props: [...new Set(kf.flatMap(k => Object.keys(k).filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p))))] }; }); });
    const msg = await P.evaluate(() => document.getElementById('import-msg').textContent);
    if (mode === 'voll') check(T + 'error: the field shakes ±4 px three times in 240 ms (linear)', /Keine Zeile erkannt/.test(msg) && sh.length === 1 && sh[0].d === 240 && sh[0].easing === 'linear' && JSON.stringify(sh[0].xs) === JSON.stringify([0, -4, 4, -4, 4, -4, 4, 0]), { msg, sh });
    if (mode === 'ruhig') check(T + 'error: a 150 ms fade blink, no movement', sh.length === 1 && sh[0].d <= 150 && sh[0].props.join() === 'opacity', sh);
    if (mode === 'aus') check(T + 'error: no shake', sh.length === 0, sh);
    check(T + '360: no horizontal overflow after tab, toast, phase switch, shake', (await overflow(P)) <= 0);
    await ctx.close();
  }

  // ===== 6) A refused write (the read-only switch) shakes the status; the review list staggers 30 ms, capped at 10 =====
  {
    const srv = makeServer({ workers: SEED_W });
    const { ctx, page: P } = await open(browser, srv, { name: 'RO', inClaude: true, writable: false, anim: 'voll', user: { id: 'u_lena', owner: false, can: undefined } });
    await P.waitForTimeout(300);
    await P.click('#panel-plan [data-phase="ausbau"]');
    const shook = await until(async () => P.evaluate(() => document.getElementById('status').getAnimations().some(a => a.effect.getComputedTiming().duration === 240)), 1500, 5);
    const ro = await P.evaluate(() => document.getElementById('status').dataset.mode);
    check('refused write: "Nur ansehen" and the status shakes (240 ms)', shook >= 0 && ro === 'ro', { shook, ro });
    await ctx.close();
    const L = await open(browser, null, { name: 'RV', inClaude: false, anim: 'voll' }, { width: 1280, height: 900, hash: '#arbeiter' });
    await L.page.click('#toggle-import');
    const lines = Array.from({ length: 13 }, (_, i) => `Bewohner${String.fromCharCode(65 + i)}: Kochen ${1 + (i % 5)}/8`).join('\n');
    await L.page.fill('#import-text', lines);
    await L.page.click('#do-import'); await L.page.waitForTimeout(20);
    const rc = await L.page.evaluate(() => [...document.querySelectorAll('#review .rcard')].map(c => { const a = c.getAnimations()[0]; const t = a ? a.effect.getComputedTiming() : null; return t ? Math.round(t.delay) + '+' + Math.round(t.duration) : 'none'; }));
    const want = Array.from({ length: 13 }, (_, i) => Math.min(i, 10) * 30 + '+220');
    check('review cards: 220 ms each, 30 ms apart, at most 10 apart', JSON.stringify(rc) === JSON.stringify(want), rc);
    await L.ctx.close();
  }

  // ===== 7) 1280, table and cards: the sweep bands, rolls and landing stamps keep to 400 ms =====
  for (const view of ['table', 'cards']) {
    const L = await open(browser, null, { name: 'SW-' + view, inClaude: false, anim: 'voll', seedLs: { ...LOCAL_SEED, 'bellwright-arbeitsplan-view': view } }, { width: 1280, height: 1000 });
    await resetSeen(L.page);
    const t0 = await L.page.evaluate(() => document.timeline.currentTime);
    await L.page.click('#panel-plan [data-phase="ausbau"]');
    for (const t of [20, 120, 120, 120, 120, 120, 120, 120]) { await L.page.waitForTimeout(t); await sampleNow(L.page); }
    const a = await seen(L.page);
    const sw = a.filter(x => x.name === 'sweepBand'), rolls = a.filter(x => /^odo/.test(x.name)), st1 = a.filter(x => x.name === 'bump');
    check(`1280 ${view}: sweep band(s) <= 400 ms, rolls <= 400 ms, landing stamps 320 ms`, sw.length >= 1 && sw.every(x => x.dur <= 400) && rolls.length > 0 && rolls.every(x => x.dur <= 400) && st1.length > 0 && st1.every(x => x.dur === 320),
      { sw: sw.map(x => x.dur + '@' + x.delay), rolls: rolls.length, st1: st1.length });
    const moment = Math.max(...a.filter(x => x.iter !== Infinity && x.name !== 'swing').map(x => x.absEnd)) - t0;
    check(`1280 ${view}: the whole phase-switch moment (light, rolls, landing stamps) is over about 1 s after the tap (<= 1.2 s)`, moment > 300 && moment <= 1200, Math.round(moment));
    await L.ctx.close();
  }

  // ===== 8) The header bell ring stays short =====
  {
    const L = await open(browser, null, { name: 'BELL', inClaude: false, anim: 'voll' });
    await L.page.evaluate(() => { const b = document.getElementById('bell'); b.classList.remove('ring'); void b.getBoundingClientRect(); b.classList.add('ring'); });
    const d = await L.page.evaluate(() => document.getElementById('bell').getAnimations().map(a => a.animationName + ':' + a.effect.getComputedTiming().duration));
    check('bell ring: one swing <= 700 ms', d.length === 1 && /^swing:/.test(d[0]) && +d[0].split(':')[1] <= 700, d);
    await L.ctx.close();
  }

  check('no page errors or console errors', errs.length === 0, errs);
  console.log(`feat-animskill: ${passes} passed, ${fails.length} failed`);
  for (const f of fails) console.log('FAIL ' + f);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();

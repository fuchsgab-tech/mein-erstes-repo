// „Dein Jahr in Zeitgarten“: Jahresrückblick als Story mit Karten wie bei Instagram.
// Tippen rechts/links oder wischen zum Blättern, Halten pausiert. Zum Schluss ein Bild zum Teilen.
import { h, icon } from './h.js';
import { burst } from './fx.js';
import { state } from './state.js';
import { avatar, openSheet, toast } from './ui.js';
import { DAYPARTS, MONTHS, defaultRecapYear, recapSeason, recapStats } from './recap-stats.js';

const DUR = 6000; // so lange bleibt eine Karte
const motionOn = () => document.documentElement.dataset.motion !== 'off';
const num = (n) => n.toLocaleString('de-DE', { maximumFractionDigits: n < 10 ? 1 : 0 });
const roundHours = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);
const fDay = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });
const fDayLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const plural = (n, one, many) => (n === 1 ? one : many);

/** Zahlen für ein Jahr aus allen geladenen Terminen */
export function yearStats(year, now = new Date()) {
  return recapStats({ events: [...state.events.values()], calendars: state.calendars, meId: state.me?.id, year, now });
}

export const recapLabel = () => `Dein Jahr ${defaultRecapYear()}`;

// ---------- Bausteine der Karten ----------

const card = (key, ...children) => h('div.rc-card', { 'data-card': key }, ...children);
const kicker = (text) => h('div.rc-kicker', null, text);
const text = (...c) => h('p.rc-text', null, ...c);
const bigNum = (n, cls = '') => h(`span.rc-num${cls}`, { 'data-to': n }, num(n));
const bigEmoji = (e) => h('div.rc-emoji', { 'aria-hidden': 'true' }, e);

// Zahlen zählen hoch (ohne Bewegung: gleich der Endwert)
function countUp(root) {
  if (!motionOn()) return;
  for (const el of root.querySelectorAll('[data-to]')) {
    const to = Number(el.dataset.to);
    const t0 = performance.now();
    const dur = 1100 + Math.min(700, to * 2);
    el.textContent = '0';
    const step = (t) => {
      if (!el.isConnected) return;
      const k = Math.min(1, Math.max(0, (t - t0) / dur));
      const v = to * (1 - (1 - k) ** 3);
      el.textContent = num(k < 1 ? (to >= 10 ? Math.round(v) : Math.round(v * 10) / 10) : to);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function barChart(values, labels, hi) {
  const max = Math.max(1, ...values);
  return h('div.rc-chart', { 'aria-hidden': 'true', style: { '--n': values.length } }, values.map((v, i) =>
    h('div.rc-col', { class: i === hi ? 'hi' : '' },
      h('i', { style: { '--v': (v / max).toFixed(3), '--d': `${120 + i * 45}ms` } }),
      h('span', null, labels[i]),
    )));
}

const confetti = (emojis, count = 22, spread = 1.7) => (el) => {
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height * 0.42, emojis, count, spread);
};

// ---------- Die Karten ----------

function buildCards(s, ctx) {
  const cards = [];
  const add = (key, render, fx) => cards.push({ key, render, fx });
  const range = s.partial ? `1. Januar bis heute (${fDay.format(new Date(s.to.getTime() - 1))})` : `1. Januar bis 31. Dezember ${s.year}`;

  if (!s.count) {
    add('empty', () => card('empty',
      bigEmoji('🌱'),
      kicker(`Dein Jahr ${s.year}`),
      h('div.rc-word', null, 'Noch ganz frisch hier'),
      text(`In ${s.year} gibt es bei dir noch keine Termine. Trag ein paar ein – dann wächst hier dein Rückblick.`),
      ctx.yearSwitch(),
    ));
    return cards;
  }

  add('intro', () => card('intro',
    bigEmoji('🌿'),
    kicker('Dein Jahr in Zeitgarten'),
    h('div.rc-num.rc-year', null, String(s.year)),
    text(range),
    ctx.yearSwitch(),
    h('p.rc-hint', null, 'Tippe rechts für weiter, links für zurück. Halten pausiert.'),
  ), confetti(['🌿', '✨', '🎉', '🌸'], 18));

  add('count', () => card('count',
    kicker('So viel war los'),
    bigNum(s.count),
    h('div.rc-unit', null, plural(s.count, 'Termin', 'Termine')),
    h('div.rc-pills', null,
      s.hours ? h('span.rc-pill', null, '⏱️ ', bigNum(roundHours(s.hours), '.sm'), ` ${plural(s.hours, 'Stunde', 'Stunden')} verplant`) : null,
      h('span.rc-pill', null, '📅 an ', bigNum(s.days, '.sm'), ` ${plural(s.days, 'Tag', 'Tagen')}`),
    ),
  ));

  if (s.topEmojis.length) {
    const [a, b, c] = s.topEmojis;
    const step = (e, place) => e && h('div.rc-step', { class: `p${place}` },
      h('div.rc-step-e', null, e.emoji),
      h('div.rc-step-n', null, `${e.count}×`),
      h('div.rc-step-b', null, place),
    );
    add('emoji', () => card('emoji',
      kicker(s.topEmojis.length > 1 ? 'Deine Top-Emojis' : 'Dein Top-Emoji'),
      h('div.rc-podium', null, step(b, 2), step(a, 1), step(c, 3)),
      text(`${a.emoji} war dein Ding – bei ${a.count} ${plural(a.count, 'Termin', 'Terminen')}.`),
    ), confetti(s.topEmojis.map((e) => e.emoji), 24));
  }

  if (s.weekday) {
    add('weekday', () => card('weekday',
      kicker('Dein Lieblingstag'),
      h('div.rc-word', null, s.weekday.name),
      barChart(s.weekdays, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], s.weekday.index),
      text(`${Math.round(s.weekday.share * 100)} % deiner Termine waren an einem ${s.weekday.name}.`),
    ));
  }

  if (s.daypart) {
    const dp = s.daypart;
    add('daypart', () => card('daypart',
      kicker('Deine Tageszeit'),
      bigEmoji(dp.emoji),
      h('div.rc-word', null, dp.title),
      h('div.rc-parts', { 'aria-hidden': 'true' }, DAYPARTS.map((p, i) => {
        const share = s.timed ? s.dayparts[i] / s.timed : 0;
        return h('div.rc-part', { class: i === dp.index ? 'hi' : '' },
          h('span', null, `${p.emoji} ${p.title}`),
          h('b', null, h('i', { style: { '--v': share.toFixed(3), '--d': `${150 + i * 70}ms` } })),
          h('em', null, `${Math.round(share * 100)} %`),
        );
      })),
      text(`Die meisten Termine hattest du ${dp.label} (${dp.hours}).`),
    ));
  }

  if (s.month && s.count >= 6) {
    add('month', () => card('month',
      kicker('Dein vollster Monat'),
      h('div.rc-word', null, s.month.name),
      h('div.rc-unit', null, bigNum(s.month.count, '.sm'), ` ${plural(s.month.count, 'Termin', 'Termine')}`),
      barChart(s.months, MONTHS.map((m) => m[0]), s.month.index),
      text(s.partial && s.month.index === new Date().getMonth() ? 'Und der Monat ist noch nicht mal vorbei!' : 'So viel wie in keinem anderen Monat.'),
    ));
  }

  if (s.friend) {
    const f = s.friend;
    add('friend', () => card('friend',
      kicker('Dein Lieblingsmensch'),
      h('div.rc-avatar', null, avatar(f, 132)),
      h('div.rc-word', null, f.name),
      f.via === 'events'
        ? h('div.rc-unit', null, bigNum(f.count, '.sm'), ` gemeinsame ${plural(f.count, 'Termin', 'Termine')}`)
        : h('div.rc-unit', null, `${f.count} gemeinsame${f.count === 1 ? 'r' : ''} ${plural(f.count, 'Kalender', 'Kalender')}`),
      text(f.via === 'events' ? 'Mit niemandem hast du mehr erlebt. Zeit für das nächste Treffen!' : 'Ihr plant zusammen – trag euch beim nächsten Termin mit „Ich bin dabei“ ein.'),
    ), confetti(['💛', '🤝', '✨', f.emoji || '🎉'], 22));
  }

  if (s.streak) {
    const st = s.streak;
    add('streak', () => card('streak',
      kicker('Deine längste Serie'),
      bigEmoji('🔥'),
      bigNum(st.weeks),
      h('div.rc-unit', null, 'Wochen am Stück'),
      h('div.rc-chip', null, st.emoji ? `${st.emoji} ` : '', st.title.replace(st.emoji, '').trim() || st.title),
      text(`Jede Woche vom ${fDay.format(st.from)} bis zum ${fDay.format(st.to)}. Dranbleiben zahlt sich aus!`),
    ), confetti(['🔥', '💪', '⭐️'], 18));
  }

  if (s.sharedCalendars || s.friends) {
    add('together', () => card('together',
      kicker('Zusammen geplant'),
      bigEmoji('🤝'),
      h('div.rc-duo', null,
        h('div', null, bigNum(s.sharedCalendars), h('span', null, `gemeinsame${s.sharedCalendars === 1 ? 'r' : ''} Kalender`)),
        h('div', null, bigNum(s.friends), h('span', null, plural(s.friends, 'Mensch', 'Menschen'))),
      ),
      text(s.friends ? 'Zusammen ist schöner: Mit so vielen planst du in Zeitgarten.' : 'Noch planst du allein – lade Freunde ein!'),
    ));
  }

  if (s.first && s.count >= 3) {
    const fe = s.first;
    add('first', () => card('first',
      kicker('Dein erster Termin'),
      h('div.rc-word.sm', null, fDayLong.format(fe.start)),
      h('div.rc-first', null,
        h('span.rc-first-e', { 'aria-hidden': 'true' }, fe.emoji || '📅'),
        h('span', null, h('strong', null, fe.title.replace(fe.emoji, '').trim() || fe.title), h('small', null, fe.allDay ? 'ganztägig' : `um ${fTime.format(fe.start)} Uhr`)),
      ),
      text(`So hat dein Jahr ${s.year} angefangen.`),
    ));
  }

  add('type', () => card('type',
    kicker('Dein Zeitgarten-Typ'),
    h('div.rc-emoji.xl', { 'aria-hidden': 'true' }, s.type.emoji),
    h('div.rc-word.type', null, s.type.label),
    text(s.type.text),
  ), confetti([s.type.emoji, '✨', '🎉', '🌟'], 30, 2));

  add('summary', () => {
    const tile = (label, value, cls = '') => value && h(`div.rc-tile${cls}`, null, h('small', null, label), h('strong', null, value));
    return card('summary',
      kicker(`Mein Jahr ${s.year}`),
      h('div.rc-tiles', null,
        tile(plural(s.count, 'Termin', 'Termine'), num(s.count)),
        s.hours ? tile('Stunden verplant', num(roundHours(s.hours))) : tile(plural(s.days, 'Tag', 'Tage'), num(s.days)),
        s.topEmojis.length ? tile('Top-Emojis', s.topEmojis.map((e) => e.emoji).join(' ')) : null,
        s.weekday ? tile('Lieblingstag', s.weekday.name) : null,
        s.friend ? tile('Lieblingsmensch', h('span.rc-who', null, avatar(s.friend, 22), s.friend.name)) : null,
        s.streak ? tile('Längste Serie', `${s.streak.weeks} Wochen`) : s.daypart ? tile('Tageszeit', s.daypart.title) : null,
        tile('Mein Zeitgarten-Typ', `${s.type.emoji} ${s.type.label}`, '.wide'),
      ),
      h('div.rc-actions', null,
        h('button.btn.primary.lg', { onclick: (e) => ctx.share(e.currentTarget) }, icon('share', 18), 'Teilen'),
        h('button.btn.lg', { onclick: ctx.restart }, icon('refresh', 18), 'Nochmal'),
      ),
    );
  });
  return cards;
}

// ---------- Bild zum Teilen (1080 × 1920) ----------

const lum = ([r, g, b]) => {
  const c = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const css = ([r, g, b], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;
// Dunkel genug für weiße Schrift
const deepen = (c, max) => {
  let x = c;
  for (let i = 0; i < 12 && lum(x) > max; i++) x = mix(x, [0, 0, 0], 0.14);
  return x;
};

// Farben des aktuellen Stils als RGB (color-mix & Co. rechnet der Browser aus)
function skinColors(root) {
  const probe = h('i', { style: { position: 'absolute', visibility: 'hidden' } });
  root.append(probe);
  const read = (v) => {
    probe.style.color = '';
    probe.style.color = v;
    return getComputedStyle(probe).color;
  };
  const raw = { a: read('var(--accent)'), b: read('var(--rc-2, var(--accent))') };
  probe.style.fontFamily = 'var(--font-display)';
  const display = getComputedStyle(probe).fontFamily;
  probe.remove();
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const rgb = (c) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#0f9d76';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  return { a: rgb(raw.a), b: rgb(raw.b), font: `${display}, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif` };
}

export function drawShareImage(s, root) {
  const W = 1080;
  const H = 1920;
  const P = 90;
  const { a, b, font } = skinColors(root);
  const c1 = deepen(mix(a, [0, 0, 0], 0.15), 0.12);
  const c2 = deepen(mix(b, [0, 0, 0], 0.3), 0.07);
  const glow = mix(a, [255, 255, 255], 0.35);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const setFont = (weight, size) => (ctx.font = `${weight} ${size}px ${font}`);
  // Schrift verkleinern, bis der Text passt
  const fit = (str, weight, size, maxW) => {
    let px = size;
    setFont(weight, px);
    while (px > 20 && ctx.measureText(str).width > maxW) setFont(weight, (px -= 4));
    return px;
  };
  const round = (x, y, w, hh, r, fill) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, hh, r);
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // Hintergrund: Verlauf in den Farben des Stils, dazu weiche Lichter
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, css(c1));
  bg.addColorStop(1, css(c2));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, al] of [[W * 0.95, 160, 620, 0.5], [-60, H * 0.55, 560, 0.32], [W * 0.7, H + 80, 700, 0.4]]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(glow, al));
    g.addColorStop(1, css(glow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Große, blasse Emojis im Hintergrund
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [[W - 140, 560, 260, -0.25], [150, 1330, 220, 0.2], [W - 170, 1500, 200, 0.3]].forEach(([x, y, size, rot], i) => {
    const e = s.topEmojis[i]?.emoji || ['🌿', '✨', '🌸'][i];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    setFont(400, size);
    ctx.fillText(e, 0, 0);
    ctx.restore();
  });
  ctx.restore();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  setFont(700, 40);
  ctx.fillText('MEIN JAHR IN ZEITGARTEN', P, 200);
  ctx.fillStyle = '#ffffff';
  setFont(900, 280);
  ctx.fillText(String(s.year), P - 10, 450);
  if (s.partial) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    setFont(600, 38);
    ctx.fillText(`1. Januar bis ${fDay.format(new Date(s.to.getTime() - 1))}`, P, 520);
  }

  // Die großen Zahlen
  const col = (x, value, label) => {
    ctx.fillStyle = '#ffffff';
    fit(value, 850, 150, (W - 2 * P) / 2 - 20);
    ctx.fillText(value, x, 720);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    setFont(600, 42);
    ctx.fillText(label, x + 4, 790);
  };
  col(P, num(s.count), plural(s.count, 'Termin', 'Termine'));
  if (s.hours) col(W / 2 + 20, num(roundHours(s.hours)), 'Stunden verplant');
  else col(W / 2 + 20, num(s.days), plural(s.days, 'Tag', 'Tage'));

  // Top-Emojis
  let y = 860;
  if (s.topEmojis.length) {
    round(P, y, W - 2 * P, 300, 44, 'rgba(255, 255, 255, 0.14)');
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    setFont(700, 34);
    ctx.fillText('Top-Emojis', P + 44, y + 70);
    const n = s.topEmojis.length;
    const cw = (W - 2 * P) / 3;
    ctx.textAlign = 'center';
    s.topEmojis.forEach((e, i) => {
      const cx = P + cw * (i + (3 - n) / 2) + cw / 2;
      ctx.fillStyle = '#ffffff';
      setFont(400, 120);
      ctx.fillText(e.emoji, cx, y + 215);
      setFont(700, 38);
      ctx.fillText(`${e.count}×`, cx, y + 272);
    });
    ctx.textAlign = 'left';
    y += 340;
  }

  // Vier Kacheln
  const tiles = [
    s.weekday && ['Lieblingstag', s.weekday.name],
    s.daypart && ['Am liebsten', s.daypart.label],
    s.friend && ['Lieblingsmensch', s.friend.name],
    s.streak && ['Längste Serie', `${s.streak.weeks} Wochen`],
    s.month && ['Vollster Monat', s.month.name],
    s.sharedCalendars && ['Gemeinsame Kalender', String(s.sharedCalendars)],
  ].filter(Boolean).slice(0, 4);
  const tw = (W - 2 * P - 30) / 2;
  tiles.forEach(([label, value], i) => {
    const x = P + (i % 2) * (tw + 30);
    const ty = y + Math.floor(i / 2) * 185;
    round(x, ty, tw, 160, 36, 'rgba(255, 255, 255, 0.14)');
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    setFont(600, 32);
    ctx.fillText(label, x + 36, ty + 58);
    ctx.fillStyle = '#ffffff';
    fit(value, 800, 58, tw - 72);
    ctx.fillText(value, x + 36, ty + 126);
  });
  y += Math.ceil(tiles.length / 2) * 185 + 20;

  // Zeitgarten-Typ
  const ty = Math.max(y, 1560);
  round(P, ty, W - 2 * P, 180, 90, 'rgba(255, 255, 255, 0.94)');
  ctx.fillStyle = css(deepen(c1, 0.06), 0.75);
  setFont(700, 32);
  ctx.fillText('Mein Zeitgarten-Typ', P + 170, ty + 66);
  ctx.fillStyle = css(deepen(c1, 0.04));
  fit(s.type.label, 850, 66, W - 2 * P - 220);
  ctx.fillText(s.type.label, P + 170, ty + 140);
  setFont(400, 92);
  ctx.textAlign = 'center';
  ctx.fillText(s.type.emoji, P + 92, ty + 122);

  // Wortmarke
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  setFont(800, 50);
  ctx.fillText('🌿 Zeitgarten', W / 2, H - 70);
  return cv;
}

const toBlob = (cv) => new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild ging nicht'))), 'image/png'));

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- Die Story ----------

export function openRecap(year) {
  const now = new Date();
  const cur = now.getFullYear();
  const cache = new Map();
  const statsOf = (y) => {
    if (!cache.has(y)) cache.set(y, yearStats(y, now));
    return cache.get(y);
  };
  let y = year ?? defaultRecapYear(now);
  if (!statsOf(y).count) y = [cur, cur - 1].find((x) => statsOf(x).count) ?? y;

  let s = null;
  let cards = [];
  let idx = 0;
  let elapsed = 0;
  let last = performance.now();
  let raf = 0;
  let held = false;
  let paused = false;
  let image = null;
  let fxTimer = 0;
  let down = null;

  const progress = h('div.rc-progress');
  const pauseBtn = h('button.rc-btn', { onclick: () => setPaused(!paused) });
  const stage = h('div.rc-stage', { 'aria-live': 'polite' });
  const bgArt = h('div.rc-bg', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const prevBtn = h('button.rc-side.prev', { 'aria-label': 'Zurück', title: 'Zurück (←)', onclick: () => go(idx - 1) }, icon('chevL', 24));
  const nextBtn = h('button.rc-side.next', { 'aria-label': 'Weiter', title: 'Weiter (→)', onclick: () => go(idx + 1) }, icon('chevR', 24));
  const head = h('div.rc-head', null,
    progress,
    h('div.rc-top', null,
      h('span.rc-brand', null, h('img', { src: 'icon.svg', alt: '' }), 'Zeitgarten'),
      h('span.grow'),
      pauseBtn,
      h('button.rc-btn', { 'aria-label': 'Schließen', title: 'Schließen', onclick: () => sheet.close() }, icon('x', 20)),
    ),
  );

  const ctx = {
    yearSwitch() {
      const years = [cur - 1, cur].filter((x) => x === y || statsOf(x).count);
      if (years.length < 2) return null;
      return h('div.rc-years', { role: 'group', 'aria-label': 'Jahr' }, years.map((x) => h('button.rc-year-btn', {
        class: x === y ? 'on' : '',
        'aria-pressed': x === y ? 'true' : 'false',
        onclick: () => x !== y && setup(x),
      }, String(x))));
    },
    restart: () => go(0),
    async share(btn) {
      btn.disabled = true;
      try {
        image ||= toBlob(drawShareImage(s, sheet.box));
        const blob = await image;
        const name = `zeitgarten-${s.year}.png`;
        const file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: `Mein Jahr ${s.year} in Zeitgarten`, text: `Mein Jahr ${s.year} in Zeitgarten ${s.topEmojis.map((e) => e.emoji).join('')}` });
            return;
          } catch (e) {
            if (e?.name === 'AbortError') return;
          }
        }
        download(blob, name);
        toast('Bild gespeichert 📸');
      } catch {
        toast('Das Bild konnte nicht erstellt werden.', { error: true });
      } finally {
        btn.disabled = false;
      }
    },
  };

  function setPaused(p) {
    paused = p;
    pauseBtn.replaceChildren(icon(p ? 'play' : 'pause', 18));
    pauseBtn.setAttribute('aria-label', p ? 'Weiter abspielen' : 'Pause');
    pauseBtn.title = p ? 'Weiter abspielen' : 'Pause';
    sheet.box.classList.toggle('paused', p);
  }

  function go(i) {
    const n = Math.max(0, Math.min(cards.length - 1, i));
    const back = n < idx;
    idx = n;
    elapsed = 0;
    const c = cards[n];
    const el = c.render();
    el.classList.add(back ? 'from-left' : 'from-right');
    stage.replaceChildren(el);
    sheet.box.dataset.tone = String(n % 4);
    sheet.box.dataset.card = c.key;
    [...progress.children].forEach((seg, j) => seg.firstChild.style.setProperty('--p', j < n ? 1 : 0));
    const lastCard = n === cards.length - 1;
    pauseBtn.hidden = lastCard;
    prevBtn.disabled = n === 0;
    nextBtn.disabled = lastCard;
    countUp(el);
    clearTimeout(fxTimer);
    if (c.fx) fxTimer = setTimeout(() => !sheet.closed && idx === n && c.fx(el), 420);
    // Bild schon vorbereiten: Teilen muss am iPhone direkt nach dem Tippen passieren
    if (c.key === 'summary') setTimeout(() => !sheet.closed && (image ||= toBlob(drawShareImage(s, sheet.box))), 600);
  }

  function setup(year2) {
    y = year2;
    s = statsOf(y);
    cards = buildCards(s, ctx);
    image = null;
    progress.replaceChildren(...cards.map(() => h('span.rc-seg', null, h('i'))));
    progress.hidden = cards.length < 2;
    idx = 0;
    go(0);
  }

  const tick = (t) => {
    if (sheet.closed) return;
    const dt = Math.min(100, t - last);
    last = t;
    const lastCard = idx === cards.length - 1;
    if (!held && !paused && !document.hidden && !lastCard) elapsed += dt;
    const seg = progress.children[idx]?.firstChild;
    if (seg) seg.style.setProperty('--p', lastCard ? 1 : Math.min(1, elapsed / DUR).toFixed(4));
    if (elapsed >= DUR && !lastCard) go(idx + 1);
    raf = requestAnimationFrame(tick);
  };

  const sheet = openSheet({
    className: 'recap-sheet',
    render: () => ({ head, body: [bgArt, stage, prevBtn, nextBtn] }),
    onClose: () => {
      cancelAnimationFrame(raf);
      clearTimeout(fxTimer);
    },
  });

  // Tippen: rechts weiter, links zurück. Wischen zur Seite blättert, Halten pausiert
  const body = sheet.box.querySelector('.sheet-body');
  body.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('button, a')) return;
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    held = true;
    sheet.box.classList.add('held');
  });
  const release = () => {
    down = null;
    held = false;
    sheet.box.classList.remove('held');
  };
  body.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const dt = e.timeStamp - down.t;
    release();
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) go(idx + (dx < 0 ? 1 : -1));
    else if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && dt < 500) {
      const r = body.getBoundingClientRect();
      go(idx + (e.clientX - r.left < r.width * 0.3 ? -1 : 1));
    }
  });
  body.addEventListener('pointercancel', release);
  body.addEventListener('contextmenu', (e) => e.preventDefault());
  sheet.box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      go(idx + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === ' ' && !e.target.closest('button')) {
      e.preventDefault();
      setPaused(!paused);
    }
  });

  setPaused(false);
  setup(y);
  raf = requestAnimationFrame(tick);
  return sheet;
}

// ---------- Karte in der Übersicht „Heute“ (1. Dezember bis 15. Januar) ----------

export function recapTeaser(now = new Date()) {
  if (!recapSeason(now)) return null;
  const s = yearStats(defaultRecapYear(now), now);
  if (!s.count) return null;
  return h('section.card.span-12.recap-teaser', { role: 'button', tabindex: '0', onclick: () => openRecap(s.year), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openRecap(s.year)) },
    h('div.rt-emojis', { 'aria-hidden': 'true' }, (s.topEmojis.length ? s.topEmojis : [{ emoji: '🌿' }]).map((e) => h('span', null, e.emoji))),
    h('div.rt-text', null,
      h('small', null, 'Jahresrückblick'),
      h('h3', null, `Dein Jahr ${s.year} in Zeitgarten`),
      h('p', null, `${num(s.count)} ${plural(s.count, 'Termin', 'Termine')}${s.hours ? `, ${num(roundHours(s.hours))} Stunden` : ''} und dein Zeitgarten-Typ – schau rein!`),
    ),
    h('span.btn.primary.rt-go', null, icon('sparkle', 18), 'Ansehen'),
  );
}

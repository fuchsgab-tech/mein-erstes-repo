// Jahreszeiten-Kunst für den Monatskopf und die Liste: eine kleine SVG-Landschaft pro Monat
// und sanft fallende Teilchen (Blätter, Schnee, Blüten, Glühwürmchen …) in einem Canvas.
// Die Farben kommen aus calendar.css (data-scene), damit sie zu Stil und Hell/Dunkel passen.

const root = document.documentElement;
const W = 520;
const H = 120;
const TAU = Math.PI * 2;

// Pro Monat: Szene, Teilchen, Stimmung
const MONTHS = [
  { scene: 'winter', fx: 'snow', season: 'Winter', emoji: '❄️', mood: 'Frische Seiten, leiser Schnee.' },
  { scene: 'winter', fx: 'snow', season: 'Winter', emoji: '☃️', mood: 'Kuschelzeit – noch ein bisschen Winter.' },
  { scene: 'spring', fx: 'petal', season: 'Frühling', emoji: '🌱', mood: 'Die ersten Knospen trauen sich raus.' },
  { scene: 'spring', fx: 'petal', season: 'Frühling', emoji: '🌸', mood: 'Kirschblüten und Aprilwetter.' },
  { scene: 'spring', fx: 'petal', season: 'Frühling', emoji: '🌷', mood: 'Alles blüht – raus mit euch!' },
  { scene: 'summer', fx: 'pollen', season: 'Sommer', emoji: '☀️', mood: 'Lange Abende, warme Luft.' },
  { scene: 'summer', fx: 'pollen', season: 'Sommer', emoji: '🏖️', mood: 'Sonne, Freibad, Eis am Stiel.' },
  { scene: 'dusk', fx: 'firefly', season: 'Sommer', emoji: '✨', mood: 'Glühwürmchen und laue Nächte.' },
  { scene: 'golden', fx: 'mote', season: 'Spätsommer', emoji: '🌾', mood: 'Goldenes Licht, letzte Sommertage.' },
  { scene: 'autumn', fx: 'leaf', season: 'Herbst', emoji: '🍂', mood: 'Bunte Blätter und Kürbissuppe.' },
  { scene: 'late', fx: 'leaf', season: 'Herbst', emoji: '🍁', mood: 'Nebelzeit – Kerzen an, Freunde rein.' },
  { scene: 'xmas', fx: 'snow', season: 'Winter', emoji: '🎄', mood: 'Schneeflocken, Lichter, Vorfreude.' },
];

export function seasonOf(date) {
  const m = date.getMonth();
  return { ...MONTHS[m], month: m, seed: date.getFullYear() * 12 + m };
}

// ---------- Zufall mit festem Startwert (jeder Monat sieht immer gleich aus) ----------

function seeded(seed) {
  let s = seed >>> 0;
  return (a = 0, b = 1) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return a + (((x ^ (x >>> 14)) >>> 0) / 4294967296) * (b - a);
  };
}

const f = (n) => n.toFixed(1);

// ---------- Landschaft (SVG) ----------

function ridge(rnd, base, amp, n) {
  const pts = Array.from({ length: n + 1 }, (_, i) => [(i / n) * W, base - amp * rnd(0.25, 1)]);
  let d = `M0 ${H} L0 ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${f(mx)} ${f(y0)} ${f(mx)} ${f(y1)} ${f(x1)} ${f(y1)}`;
  }
  // Höhe an einer Stelle (für Bäume, die auf dem Hügel stehen sollen)
  const at = (x) => {
    const i = Math.min(n - 1, Math.floor((x / W) * n));
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const t = (x - x0) / (x1 - x0);
    return y0 + (y1 - y0) * t * t * (3 - 2 * t);
  };
  return { d: `${d} L${W} ${H} Z`, at };
}

function hills(rnd, cls = ['sa-h3', 'sa-h2', 'sa-h1'], bases = [86, 99, 110]) {
  const far = ridge(rnd, bases[0], 20, 4);
  const mid = ridge(rnd, bases[1], 14, 5);
  const near = ridge(rnd, bases[2], 9, 6);
  return {
    svg: `<path class="${cls[0]}" d="${far.d}"/>`,
    svgMid: `<path class="${cls[1]}" d="${mid.d}"/>`,
    near: `<path class="${cls[2]}" d="${near.d}"/>`,
    far,
    mid,
    near0: near,
  };
}

function glowSun(cx, cy, r, cls = 'sa-sun') {
  return `<g class="${cls}"><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 2.6)}" opacity=".12"/>`
    + `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 1.7)}" opacity=".22"/>`
    + `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/></g>`;
}

function roundTree(rnd, x, y, s, k) {
  const r = 9 * s;
  const top = y - 15 * s;
  const c = (i) => 1 + ((k + i) % 3);
  const crowns = [
    [x - r * 0.62, top - r * 0.55, r * 0.74, c(0)],
    [x + r * 0.6, top - r * 0.62, r * 0.72, c(1)],
    [x, top - r * 1.2, r * 0.92, c(0)],
    [x - r * 0.2, top - r * 0.3, r * 0.66, c(2)],
    [x + r * 0.32, top - r * 1.42, r * 0.5, c(1)],
  ];
  return `<g class="sa-tree" style="animation-delay:${f(-rnd(0, 6))}s">`
    + `<path class="sa-trunk" d="M${f(x - 1.5 * s)} ${f(y + 1)} L${f(x - 0.9 * s)} ${f(top - r * 0.4)} L${f(x + 0.9 * s)} ${f(top - r * 0.4)} L${f(x + 1.5 * s)} ${f(y + 1)} Z"/>`
    + crowns.map(([cx, cy, cr, cc]) => `<circle class="sa-f${cc}" cx="${f(cx)}" cy="${f(cy)}" r="${f(cr)}"/>`).join('')
    + `<circle class="sa-shine" cx="${f(x + r * 0.25)}" cy="${f(top - r * 1.45)}" r="${f(r * 0.32)}"/>`
    + '</g>';
}

// Kleine Bäume auf dem fernen Hügel – geben der Landschaft Tiefe
function treeLine(rnd, rg, from, cls, n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = from + rnd(0, W - from);
    const y = rg.at(x) + 1.5;
    const r = rnd(2.4, 4.2);
    out += cls === 'pine'
      ? `<path class="sa-far" d="M${f(x)} ${f(y - r * 3.4)} L${f(x + r)} ${f(y)} L${f(x - r)} ${f(y)} Z"/>`
      : `<circle class="sa-far f${1 + (i % 3)}" cx="${f(x)}" cy="${f(y - r)}" r="${f(r)}"/>`;
  }
  return out;
}

function pumpkin(x, y, s) {
  return `<g class="sa-pumpkin"><ellipse cx="${f(x - 3.2 * s)}" cy="${f(y)}" rx="${f(3.6 * s)}" ry="${f(4.2 * s)}"/>`
    + `<ellipse cx="${f(x + 3.2 * s)}" cy="${f(y)}" rx="${f(3.6 * s)}" ry="${f(4.2 * s)}"/>`
    + `<ellipse class="mid" cx="${f(x)}" cy="${f(y)}" rx="${f(3.4 * s)}" ry="${f(4.6 * s)}"/>`
    + `<path class="sa-stemp" d="M${f(x)} ${f(y - 4.2 * s)} q${f(0.6 * s)} ${f(-2.4 * s)} ${f(2.2 * s)} ${f(-3 * s)}"/></g>`;
}

function pine(x, y, s, lights, rnd) {
  let out = `<rect class="sa-trunk" x="${f(x - 1.3 * s)}" y="${f(y - 5 * s)}" width="${f(2.6 * s)}" height="${f(6 * s)}"/>`;
  for (let i = 0; i < 3; i++) {
    const w = (11 - i * 2.6) * s;
    const top = y - (8 + i * 7.5) * s - 9 * s;
    const bot = y - (3 + i * 7.5) * s;
    out += `<path class="sa-pine" d="M${f(x)} ${f(top)} L${f(x + w)} ${f(bot)} L${f(x - w)} ${f(bot)} Z"/>`;
    out += `<path class="sa-cap" d="M${f(x)} ${f(top)} L${f(x + w * 0.42)} ${f(top + (bot - top) * 0.42)} Q${f(x)} ${f(top + (bot - top) * 0.3)} ${f(x - w * 0.42)} ${f(top + (bot - top) * 0.42)} Z"/>`;
  }
  if (lights) {
    for (let i = 0; i < 9; i++) {
      const t = rnd(0.15, 0.95);
      const w = 10 * s * t;
      out += `<circle class="sa-light l${i % 3}" cx="${f(x + rnd(-w, w))}" cy="${f(y - 30 * s + 26 * s * t)}" r="${f(1.1 * s)}" style="animation-delay:${f(-rnd(0, 2.4))}s"/>`;
    }
    out += `<path class="sa-star" d="M${f(x)} ${f(y - 37.5 * s)} l1.6 3.4 3.6.4-2.7 2.4.8 3.6-3.3-1.9-3.3 1.9.8-3.6-2.7-2.4 3.6-.4z"/>`;
  }
  return out;
}

function bareTree(rnd, x, y, s) {
  const b = (x0, y0, a, len, depth) => {
    const x1 = x0 + Math.cos(a) * len;
    const y1 = y0 + Math.sin(a) * len;
    let d = `M${f(x0)} ${f(y0)} L${f(x1)} ${f(y1)}`;
    if (depth > 0) {
      d += b(x1, y1, a - rnd(0.3, 0.6), len * 0.68, depth - 1);
      d += b(x1, y1, a + rnd(0.3, 0.6), len * 0.68, depth - 1);
    }
    return d;
  };
  return `<path class="sa-branch" stroke-width="${f(1.2 * s)}" d="${b(x, y, -Math.PI / 2, 11 * s, 4)}"/>`;
}

function cloud(x, y, s, i) {
  return `<g class="sa-cloud c${i}"><g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">`
    + '<ellipse cx="0" cy="6" rx="22" ry="7"/><ellipse cx="9" cy="0" rx="12" ry="9"/><ellipse cx="-8" cy="2" rx="9" ry="7"/></g></g>';
}

function bird(x, y, s) {
  return `<path class="sa-bird" stroke-width="${f(1.2)}" d="M${f(x - 5 * s)} ${f(y - 2 * s)} q${f(2.5 * s)} ${f(-1 * s)} ${f(5 * s)} ${f(2 * s)} q${f(2.5 * s)} ${f(-3 * s)} ${f(5 * s)} ${f(-2 * s)}"/>`;
}

const SCENES = {
  autumn(rnd) {
    const hl = hills(rnd);
    let trees = '';
    for (let i = 0, x = 250; x < W; i++, x += rnd(34, 58)) trees += roundTree(rnd, x, hl.mid.at(x) + 3, rnd(0.7, 1.05), i);
    const front = roundTree(rnd, 498, hl.near0.at(498) + 4, 1.45, 1) + roundTree(rnd, 236, hl.near0.at(236) + 4, 1.15, 2);
    const pumpkins = pumpkin(330, hl.near0.at(330) + 1, 1.05) + pumpkin(346, hl.near0.at(346) + 3, 0.75) + pumpkin(430, hl.near0.at(430) + 2, 0.9);
    return glowSun(440, 36, 15) + bird(300, 30, 1) + bird(318, 24, 0.75) + bird(334, 33, 0.6)
      + hl.svg + treeLine(rnd, hl.far, 180, 'round', 22) + hl.svgMid + trees + hl.near + front + pumpkins;
  },
  late(rnd) {
    const hl = hills(rnd);
    let trees = '';
    for (let x = 245; x < W; x += rnd(40, 66)) trees += bareTree(rnd, x, hl.mid.at(x) + 3, rnd(1.15, 1.6));
    let leaves = '';
    for (let i = 0; i < 9; i++) leaves += `<circle class="sa-f${1 + (i % 3)}" cx="${f(rnd(250, 515))}" cy="${f(rnd(46, 86))}" r="${f(rnd(1.6, 2.8))}"/>`;
    // Nebel aus vielen weichen, durchscheinenden Schwaden
    const band = (y, n) => {
      let out = '';
      for (let i = 0; i < n; i++) out += `<ellipse cx="${f(rnd(140, 520))}" cy="${f(y + rnd(-4, 4))}" rx="${f(rnd(40, 95))}" ry="${f(rnd(3.5, 7))}"/>`;
      return out;
    };
    const fog = `<g class="sa-fog">${band(70, 7)}</g><g class="sa-fog f2">${band(92, 7)}</g>`;
    return glowSun(410, 40, 13) + bird(330, 28, 0.9) + bird(346, 22, 0.7) + hl.svg + treeLine(rnd, hl.far, 200, 'round', 16) + hl.svgMid + trees + leaves + fog + hl.near;
  },
  winter(rnd, m) {
    const hl = hills(rnd);
    let trees = '';
    for (let x = 255; x < W; x += rnd(26, 48)) trees += pine(x, hl.mid.at(x) + 2, rnd(0.75, 1.15), false, rnd);
    const extra = m === 1
      // Schneemann
      ? '<g class="sa-snowman"><circle class="sa-cap" cx="300" cy="104" r="8"/><circle class="sa-cap" cx="300" cy="92" r="5.5"/>'
        + '<path class="sa-carrot" d="M302 91.5 l5 1 -5 1z"/><circle class="sa-coal" cx="298.6" cy="90.6" r=".8"/><circle class="sa-coal" cx="301.6" cy="90.4" r=".8"/></g>'
      // Hütte mit warmem Fenster
      : '<g class="sa-hut"><path class="sa-wall" d="M286 108 v-14 l12 -9 12 9 v14z"/><path class="sa-cap" d="M282 95 l16 -12 16 12 -3 1 -13 -9.6 -13 9.6z"/>'
        + '<rect class="sa-window" x="294" y="96" width="7" height="6" rx="1"/></g>';
    return glowSun(445, 34, 12, 'sa-sun pale') + hl.svg + treeLine(rnd, hl.far, 190, 'pine', 26) + hl.svgMid + trees + hl.near + extra;
  },
  xmas(rnd) {
    const hl = hills(rnd);
    let trees = '';
    let i = 0;
    for (let x = 255; x < W; x += rnd(28, 48), i++) trees += pine(x, hl.mid.at(x) + 2, i === 2 ? 1.35 : rnd(0.7, 1.05), i === 2, rnd);
    let stars = '';
    for (let k = 0; k < 14; k++) stars += `<circle class="sa-twinkle" cx="${f(rnd(200, 515))}" cy="${f(rnd(6, 50))}" r="${f(rnd(0.6, 1.3))}" style="animation-delay:${f(-rnd(0, 3))}s"/>`;
    return glowSun(470, 26, 9, 'sa-sun moon') + stars + hl.svg + treeLine(rnd, hl.far, 190, 'pine', 26) + hl.svgMid + trees + hl.near;
  },
  spring(rnd, m) {
    const hl = hills(rnd);
    let trees = '';
    for (let i = 0, x = 250; x < W; i++, x += rnd(36, 62)) trees += roundTree(rnd, x, hl.mid.at(x) + 3, rnd(0.75, 1.1), i);
    let flowers = '';
    const n = m === 2 ? 10 : 22;
    for (let i = 0; i < n; i++) {
      const x = rnd(170, 515);
      flowers += `<circle class="sa-bloom b${i % 3}" cx="${f(x)}" cy="${f(hl.near0.at(x) + rnd(2, 9))}" r="${f(rnd(1.2, 2.2))}"/>`;
    }
    return glowSun(445, 32, 13) + cloud(330, 30, 0.8, 1) + hl.svg + treeLine(rnd, hl.far, 190, 'round', 20) + hl.svgMid + trees + hl.near + flowers;
  },
  summer(rnd, m) {
    let rays = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      rays += `<line x1="${f(Math.cos(a) * 24)}" y1="${f(Math.sin(a) * 24)}" x2="${f(Math.cos(a) * 32)}" y2="${f(Math.sin(a) * 32)}"/>`;
    }
    const sun = `<g transform="translate(450 36)"><g class="sa-rays">${rays}</g></g>${glowSun(450, 36, 16)}`;
    if (m === 6) {
      const hl = hills(rnd, ['sa-h3', 'sa-h2', 'sa-h1'], [84, 96, 120]);
      const sea = '<path class="sa-sea" d="M0 100 Q130 96 260 100 T520 99 V120 H0Z"/>'
        + '<g class="sa-waves"><path d="M200 106 q6 -3 12 0 t12 0 M330 110 q6 -3 12 0 t12 0 M430 104 q6 -3 12 0 t12 0"/></g>';
      const boat = '<g class="sa-boat"><path class="sa-hull" d="M360 99 h26 l-5 6 h-16z"/><path class="sa-sail" d="M373 98 V76 l12 21z"/><path class="sa-sail2" d="M371 98 V80 l-9 18z"/></g>';
      return sun + cloud(320, 28, 0.9, 1) + cloud(220, 44, 0.6, 2) + hl.svg + treeLine(rnd, hl.far, 200, 'round', 16) + hl.svgMid + sea + boat;
    }
    const hl = hills(rnd);
    let flowers = '';
    for (let i = 0; i < 9; i++) {
      const x = rnd(230, 510);
      const y = hl.near0.at(x) + 1;
      const h = rnd(10, 18);
      flowers += `<path class="sa-stem" d="M${f(x)} ${f(y)} v${f(-h)}"/><circle class="sa-petals" cx="${f(x)}" cy="${f(y - h)}" r="3.4"/><circle class="sa-seed" cx="${f(x)}" cy="${f(y - h)}" r="1.5"/>`;
    }
    return sun + cloud(330, 30, 0.9, 1) + cloud(240, 48, 0.6, 2) + hl.svg + treeLine(rnd, hl.far, 190, 'round', 20) + hl.svgMid + hl.near + flowers;
  },
  dusk(rnd) {
    const hl = hills(rnd);
    let grass = '';
    for (let i = 0; i < 40; i++) {
      const x = rnd(150, 520);
      const y = hl.near0.at(x) + 2;
      grass += `M${f(x)} ${f(y)} q${f(rnd(-2, 2))} ${f(-rnd(4, 9))} ${f(rnd(-3, 3))} ${f(-rnd(8, 14))}`;
    }
    return glowSun(430, 82, 22, 'sa-sun set') + hl.svg + treeLine(rnd, hl.far, 200, 'round', 18) + hl.svgMid + hl.near + `<path class="sa-grass" d="${grass}"/>`;
  },
  golden(rnd) {
    const hl = hills(rnd, ['sa-h3', 'sa-h2', 'sa-h1'], [84, 98, 112]);
    let wheat = '';
    for (let i = 0; i < 46; i++) {
      const x = rnd(170, 520);
      const y = hl.near0.at(x) + 4;
      const h = rnd(12, 22);
      const lean = rnd(-2, 3);
      wheat += `<path class="sa-stalk" d="M${f(x)} ${f(y)} q${f(lean / 2)} ${f(-h / 2)} ${f(lean)} ${f(-h)}"/><ellipse class="sa-ear" cx="${f(x + lean)}" cy="${f(y - h - 2.4)}" rx="1.4" ry="3.2" transform="rotate(${f(lean * 4)} ${f(x + lean)} ${f(y - h - 2.4)})"/>`;
    }
    return glowSun(420, 70, 21) + bird(320, 34, 1) + bird(338, 28, 0.8) + bird(352, 38, 0.7) + hl.svg + hl.svgMid + hl.near + wheat;
  },
};

const artCache = new Map();

// Feste Grafik ohne Nutzereingaben – darf als innerHTML gesetzt werden
export function seasonArt(info) {
  let svg = artCache.get(info.seed);
  if (!svg) {
    const rnd = seeded(info.seed * 7919 + 17);
    svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">${SCENES[info.scene](rnd, info.month)}</svg>`;
    artCache.set(info.seed, svg);
  }
  return svg;
}

// ---------- Teilchen (Canvas) ----------

const FX = {
  leaf: { per: 5200, max: 26 },
  snow: { per: 1500, max: 70 },
  petal: { per: 3800, max: 34 },
  pollen: { per: 4200, max: 28 },
  firefly: { per: 4500, max: 26 },
  mote: { per: 3600, max: 32 },
};

const probe = document.createElement('canvas').getContext('2d');
function rgb(css, fallback) {
  probe.fillStyle = '#010203';
  probe.fillStyle = css || '#010203';
  const s = String(probe.fillStyle);
  if (s === '#010203') return fallback;
  if (s[0] === '#') return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  return s.match(/[\d.]+/g).slice(0, 3).map(Number);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function palette(host) {
  const cs = getComputedStyle(host);
  const accent = rgb(getComputedStyle(root).getPropertyValue('--accent').trim(), [15, 157, 118]);
  const cols = ['--p1', '--p2', '--p3'].map((n) => rgb(cs.getPropertyValue(n).trim(), [255, 255, 255]));
  const dark = root.dataset.mode === 'dark';
  // --mb-fx-accent (0 … 1): Stile können die Teilchen stärker in ihre Akzentfarbe tauchen
  const k = parseFloat(cs.getPropertyValue('--mb-fx-accent'));
  return { dark, cols: cols.map((c) => mix(c, accent, Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0.12)) };
}

function spawn(kind, w, h, rnd, anywhere) {
  const p = {
    x: rnd(0, w),
    y: anywhere ? rnd(0, h) : rnd(-20, -4),
    s: rnd(0.6, 1.25),
    c: Math.floor(rnd(0, 3)),
    ph: rnd(0, TAU),
    sp: rnd(0.6, 1.4),
    rot: rnd(0, TAU),
  };
  if (kind === 'pollen' || kind === 'mote') p.y = anywhere ? p.y : h + rnd(4, 16);
  if (kind === 'firefly') p.y = rnd(h * 0.25, h);
  return p;
}

function step(kind, p, dt, t, w, h) {
  const sway = Math.sin(t * 0.9 * p.sp + p.ph);
  switch (kind) {
    case 'leaf':
      p.y += (14 + 10 * p.s) * p.sp * dt;
      p.x += (sway * 16 - 6) * dt;
      p.rot += (1.2 + p.sp) * dt * (p.c ? 1 : -1);
      return p.y > h + 14 || p.x < -14;
    case 'snow':
      p.y += (8 + 12 * p.s) * p.sp * dt;
      p.x += sway * 7 * dt;
      return p.y > h + 4;
    case 'petal':
      p.y += (9 + 8 * p.s) * p.sp * dt;
      p.x += (sway * 12 + 9) * dt;
      p.rot += 1.6 * dt * p.sp;
      return p.y > h + 8 || p.x > w + 8;
    case 'pollen':
    case 'mote':
      p.y -= (4 + 5 * p.s) * p.sp * dt;
      p.x += (sway * 6 + (kind === 'mote' ? 5 : 2)) * dt;
      return p.y < -6 || p.x > w + 6;
    default: // Glühwürmchen
      p.x += Math.cos(t * 0.5 * p.sp + p.ph) * 9 * dt;
      p.y += Math.sin(t * 0.7 * p.sp + p.ph * 2) * 6 * dt;
      if (p.x < -6) p.x = w + 6;
      if (p.x > w + 6) p.x = -6;
      return false;
  }
}

function draw(g, kind, p, t, pal) {
  const [r, gr, b] = pal.cols[p.c];
  const col = (a) => `rgba(${r}, ${gr}, ${b}, ${a})`;
  switch (kind) {
    case 'leaf': {
      const s = 6.5 * p.s;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(Math.cos(p.rot * 0.7 + p.ph), 1);
      g.fillStyle = col(pal.dark ? 0.85 : 0.9);
      g.beginPath();
      g.moveTo(0, -s);
      g.quadraticCurveTo(s * 0.95, 0, 0, s);
      g.quadraticCurveTo(-s * 0.95, 0, 0, -s);
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.18)';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(0, -s * 0.8);
      g.lineTo(0, s * 1.25);
      g.stroke();
      g.restore();
      break;
    }
    case 'snow':
      g.fillStyle = col(0.55 + 0.4 * p.s * 0.8);
      g.beginPath();
      g.arc(p.x, p.y, 0.8 + 1.7 * p.s, 0, TAU);
      g.fill();
      if (!pal.dark) {
        g.strokeStyle = 'rgba(70, 100, 150, 0.28)';
        g.lineWidth = 0.6;
        g.stroke();
      }
      break;
    case 'petal':
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(p.rot + p.ph)));
      g.fillStyle = col(0.85);
      g.beginPath();
      g.ellipse(0, 0, 3.6 * p.s, 2.4 * p.s, 0, 0, TAU);
      g.fill();
      g.restore();
      break;
    case 'pollen':
    case 'mote': {
      const a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2 * p.sp + p.ph));
      g.fillStyle = col(a);
      g.beginPath();
      g.arc(p.x, p.y, (kind === 'mote' ? 1.1 : 1.4) * p.s + 0.3, 0, TAU);
      g.fill();
      break;
    }
    default: {
      const blink = Math.max(0, Math.sin(t * 1.6 * p.sp + p.ph));
      const rad = 7 * p.s;
      const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
      grd.addColorStop(0, col(0.9 * blink));
      grd.addColorStop(0.25, col(0.45 * blink));
      grd.addColorStop(1, col(0));
      g.fillStyle = grd;
      g.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
    }
  }
}

// Ein Teilchen-Feld bleibt über Neuzeichnungen erhalten (der Monat wird bei jeder Live-Änderung neu gebaut)
let field = null;

export function mountSeasonFx(host, info) {
  const key = `${info.fx}|${info.seed}`;
  if (field?.key !== key) {
    const cv = document.createElement('canvas');
    cv.className = 'mb-fx';
    cv.setAttribute('aria-hidden', 'true');
    field = { key, cv, g: cv.getContext('2d'), parts: [], w: 0, h: 0, t: 0, pal: null, rnd: seeded(info.seed) };
  }
  const F = field;
  const kind = info.fx;
  host.append(F.cv);

  let raf = 0;
  let last = 0;
  const still = () => root.dataset.motion === 'off';

  const paint = () => {
    const { g, w, h } = F;
    g.clearRect(0, 0, w, h);
    for (const p of F.parts) draw(g, kind, p, F.t, F.pal);
  };
  const fill = () => {
    const want = Math.min(FX[kind].max, Math.round((F.w * F.h) / FX[kind].per));
    while (F.parts.length < want) F.parts.push(spawn(kind, F.w, F.h, F.rnd, true));
    F.parts.length = want;
  };
  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    if (w !== F.w || h !== F.h) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (F.w) for (const p of F.parts) p.x *= w / F.w;
      F.w = w;
      F.h = h;
      F.cv.width = Math.round(w * dpr);
      F.cv.height = Math.round(h * dpr);
      F.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      fill();
    }
    paint();
  };
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return; // ~30 Bilder pro Sekunde reichen
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    F.t += dt;
    for (let i = 0; i < F.parts.length; i++) {
      if (step(kind, F.parts[i], dt, F.t, F.w, F.h)) F.parts[i] = spawn(kind, F.w, F.h, F.rnd, false);
    }
    paint();
  };
  // Stil, Hell/Dunkel, Bewegung oder Sichtbarkeit geändert: Farben neu lesen, Schleife neu starten
  const sync = () => {
    F.pal = palette(host);
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (still() || document.hidden) paint();
    else raf = requestAnimationFrame(frame);
  };

  F.pal = palette(host);
  resize();
  sync();
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const mo = new MutationObserver(sync);
  mo.observe(root, { attributes: true, attributeFilter: ['data-motion', 'data-mode', 'data-skin', 'style'] });
  document.addEventListener('visibilitychange', sync);

  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', sync);
    ro.disconnect();
    mo.disconnect();
  };
}

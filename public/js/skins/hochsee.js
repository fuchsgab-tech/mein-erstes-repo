// Stil „Haie & Wale“ – das offene Meer von unten: Mondlicht flimmert durch die Oberfläche, alle ~25 s gleitet
// ein Buckelwal vorbei, Haie (einer davon ein Hammerhai) ziehen in verschiedenen Tiefen, ab und zu schwebt ein
// Manta über uns, ein Fischschwarm teilt sich vor dem Hai, ein paar Blasen steigen auf.
// Hell: sonnige Hochsee – türkisblaues Wasser, Sonnenstrahlen und Glitzern, dieselben Tiere als blaue Schattenrisse.
// skin: Eintrag für die Stil-Auswahl (Vorschau-Farben je Hell/Dunkel).
// scene(p, kit): bewegter Hintergrund (siehe js/bgfx.js).

// ---------- Umrisse (Einheiten, Kopf zeigt nach rechts) ----------

// Buckelwal von der Seite, 1000 × 400: lange Brustflosse, kleiner Buckel mit Finne, breite Fluke
const WHALE = [
  ['M', 1000, 176],
  ['C', 992, 150, 960, 132, 900, 124],
  ['C', 840, 116, 790, 104, 720, 98],
  ['C', 640, 92, 560, 96, 470, 108],
  ['C', 452, 104, 440, 92, 426, 88],
  ['C', 420, 96, 414, 108, 400, 118],
  ['C', 330, 132, 260, 148, 200, 160],
  ['C', 160, 168, 130, 172, 112, 174],
  ['C', 92, 168, 52, 146, 6, 126],
  ['C', 14, 146, 34, 164, 56, 176],
  ['C', 36, 190, 18, 206, 10, 222],
  ['C', 46, 208, 86, 192, 112, 186],
  ['C', 170, 190, 250, 206, 340, 226],
  ['C', 440, 248, 550, 262, 650, 260],
  ['C', 750, 258, 850, 244, 918, 220],
  ['C', 958, 206, 988, 192, 1000, 176],
  ['Z'],
  ['M', 806, 232],
  ['C', 768, 268, 700, 316, 610, 354],
  ['C', 572, 370, 532, 382, 496, 388],
  ['C', 510, 378, 548, 360, 598, 334],
  ['C', 668, 300, 716, 272, 740, 250],
  ['Z'],
];
// nur die Brustflosse (bei Buckelwalen hell)
const FIN = WHALE.slice(17);

// Riffhai von der Seite, 1000 × 300
const SHARK = [
  ['M', 1000, 150],
  ['C', 985, 126, 940, 108, 870, 100],
  ['C', 790, 92, 720, 88, 650, 90],
  ['C', 630, 66, 604, 30, 574, 4],
  ['C', 566, 36, 560, 66, 540, 92],
  ['C', 470, 100, 380, 114, 318, 122],
  ['L', 298, 104],
  ['L', 284, 126],
  ['C', 250, 132, 214, 138, 184, 142],
  ['C', 150, 128, 92, 74, 26, 8],
  ['C', 50, 60, 84, 112, 114, 150],
  ['C', 92, 174, 72, 200, 56, 228],
  ['C', 100, 200, 142, 172, 186, 160],
  ['C', 222, 166, 250, 170, 274, 172],
  ['L', 260, 192],
  ['L', 302, 176],
  ['C', 344, 182, 384, 186, 410, 188],
  ['L', 390, 214],
  ['L', 442, 191],
  ['C', 520, 196, 600, 198, 662, 196],
  ['C', 640, 222, 608, 256, 566, 288],
  ['C', 640, 258, 702, 218, 754, 192],
  ['C', 822, 186, 900, 178, 950, 168],
  ['C', 975, 162, 992, 157, 1000, 150],
  ['Z'],
];

// symmetrische Form (Tier von unten gesehen): obere Hälfte als Kurven, die untere wird gespiegelt
function sym(start, segs, cy) {
  const m = (y) => 2 * cy - y;
  const P = [['M', start[0], start[1]]];
  for (const s of segs) P.push(['C', ...s]);
  const last = segs[segs.length - 1];
  P.push(['L', last[4], m(last[5])]);
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    const prev = i ? segs[i - 1] : [0, 0, 0, 0, start[0], start[1]];
    P.push(['C', s[2], m(s[3]), s[0], m(s[1]), prev[4], m(prev[5])]);
  }
  P.push(['Z']);
  return P;
}

// Hammerhai von unten, 1000 × 400: der breite Hammerkopf macht ihn sofort erkennbar
const HAMMER = sym([994, 200], [
  [1000, 172, 994, 120, 976, 72],
  [970, 58, 950, 52, 938, 60],
  [928, 84, 910, 120, 884, 138],
  [850, 134, 800, 128, 766, 128],
  [738, 96, 692, 62, 620, 36],
  [644, 78, 664, 116, 680, 132],
  [600, 138, 500, 150, 440, 158],
  [426, 148, 412, 134, 398, 128],
  [402, 144, 396, 158, 380, 164],
  [320, 172, 262, 180, 206, 186],
  [150, 184, 60, 168, 8, 148],
  [30, 170, 50, 188, 56, 200],
], 200);

// Mantarochen von unten, 600 × 1000: Kopflappen vorn, spitze Flügel, dünner Schwanz
const MANTA = sym([548, 500], [
  [560, 486, 600, 476, 598, 452],
  [594, 438, 570, 436, 546, 440],
  [520, 400, 450, 240, 336, 40],
  [330, 28, 318, 24, 312, 34],
  [306, 170, 260, 350, 180, 432],
  [160, 452, 146, 468, 136, 484],
  [100, 490, 50, 494, 0, 498],
], 500);

const svgD = (P) => P.map((s) => s[0] + s.slice(1).join(' ')).join('');

// ---------- Vorschau ----------

const WHALE_BG = (attrs) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 70 1000 330'%3E%3Cpath ${attrs} d='${svgD(WHALE)}'/%3E%3C/svg%3E") 46% 64% / 78% auto no-repeat`;
const BUBBLES = (c) => [[18, 74, 1.6], [21, 60, 1.1], [19, 47, 0.8], [86, 82, 1.3], [84, 70, 0.9]]
  .map(([x, y, s]) => `radial-gradient(circle at ${x}% ${y}%, transparent 0 ${s * 0.5}%, ${c} ${s * 0.6}% ${s}%, transparent ${s + 0.6}%)`).join(', ');
const RAYS = (c) => `linear-gradient(100deg, transparent 26%, ${c} 33%, transparent 40%, transparent 52%, ${c} 58%, transparent 64%, transparent 70%, ${c} 74%, transparent 79%)`;

export const skin = {
  id: 'hochsee', name: 'Haie & Wale', desc: 'Live · Wale, Haie & Mantas', live: true,
  light: {
    bg: `${WHALE_BG("fill='%230b4f80' fill-opacity='.5'")}, ${BUBBLES('rgba(255,255,255,.85)')}, ${RAYS('rgba(255,255,240,.35)')}, radial-gradient(60% 34% at 66% -4%, rgba(255,255,240,.95), transparent 72%), linear-gradient(180deg, #aef0fb, #46c3ec 50%, #1384c2), #cdeffa`,
    surface: 'rgba(244,252,255,.84)', accent: '#0369a1', text: '#06283d',
  },
  dark: {
    bg: `${WHALE_BG("fill='%23020b16' fill-opacity='.85' stroke='%2367e8f9' stroke-opacity='.45' stroke-width='5'")}, ${BUBBLES('rgba(170,225,255,.7)')}, ${RAYS('rgba(150,210,255,.13)')}, radial-gradient(60% 34% at 66% -4%, rgba(190,230,255,.5), transparent 72%), linear-gradient(180deg, #0e3d62, #062440 50%, #020c18), #051c31`,
    surface: 'rgba(5,26,44,.74)', accent: '#38bdf8', text: '#e3f4ff', glow: true,
  },
};

// ---------- Vorlagen ----------

function trace(g, P) {
  g.beginPath();
  for (const s of P) {
    if (s[0] === 'M') g.moveTo(s[1], s[2]);
    else if (s[0] === 'L') g.lineTo(s[1], s[2]);
    else if (s[0] === 'C') g.bezierCurveTo(s[1], s[2], s[3], s[4], s[5], s[6]);
    else g.closePath();
  }
}

const PAD = 7;

// Tier als Schattenriss in genau der Anzeigegröße: dunkler Körper, weiches Streiflicht oben (Seitenansicht)
// oder rundum (von unten, gegen das Licht), dazu feine Zeichnung und auf Wunsch ein leuchtender Saum
function animal(kit, P, uw, uh, len, look, flip) {
  const s = len / uw;
  const L = kit.layer(len + PAD * 2, uh * s + PAD * 2);
  const g = L.g;
  g.translate(PAD, PAD);
  if (flip) {
    g.translate(len, 0);
    g.scale(-1, 1);
  }
  g.scale(s, s);
  const body = g.createLinearGradient(0, look.y0, 0, look.y1);
  body.addColorStop(0, look.top);
  body.addColorStop(1, look.bot);
  if (look.side) {
    const r = 2.6 / s;
    g.fillStyle = look.rim;
    trace(g, P);
    g.fill();
    g.globalCompositeOperation = 'source-atop';
    g.save();
    g.translate(0, r * 0.45);
    g.fillStyle = look.mid;
    trace(g, P);
    g.fill();
    g.translate(0, r * 0.55);
    g.fillStyle = body;
    trace(g, P);
    g.fill();
    g.restore();
  } else {
    g.fillStyle = body;
    trace(g, P);
    g.fill();
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = look.rim;
    g.globalAlpha = 0.24;
    g.lineWidth = 6 / s;
    g.stroke();
    g.globalAlpha = 0.55;
    g.lineWidth = 2 / s;
    g.stroke();
  }
  g.globalAlpha = 1;
  g.strokeStyle = look.rim;
  g.fillStyle = look.rim;
  g.lineWidth = 1.2 / s;
  look.detail(g);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  if (look.glow) {
    trace(g, P);
    g.strokeStyle = look.glow;
    g.globalAlpha = 0.07;
    g.lineWidth = 8 / s;
    g.stroke();
    g.globalAlpha = 0.24;
    g.lineWidth = 1.4 / s;
    g.stroke();
    g.globalAlpha = 1;
  }
  return L.c;
}

const dots = (g, list, r, a) => {
  g.globalAlpha = a;
  for (const [x, y] of list) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
};

// helle Brustflosse, Kehlfurchen, Maullinie, Knubbel am Kopf, Auge
function whaleDetail(g) {
  g.globalAlpha = 0.2;
  trace(g, FIN);
  g.fill();
  for (let i = 1; i <= 4; i++) {
    const o = i * 10;
    g.beginPath();
    g.moveTo(950 - i * 10, 206 - i * 2);
    g.bezierCurveTo(880, 240 - o, 760, 258 - o, 610 + i * 14, 260 - o);
    g.stroke();
  }
  g.globalAlpha = 0.32;
  g.beginPath();
  g.moveTo(998, 180);
  g.bezierCurveTo(960, 192, 920, 198, 884, 192);
  g.stroke();
  dots(g, [[968, 150], [944, 140], [918, 134], [986, 164]], 4.5, 0.32);
  dots(g, [[872, 180]], 5, 0.42);
}
// Kiemenspalten und Auge
function sharkDetail(g) {
  g.globalAlpha = 0.3;
  for (let i = 0; i < 5; i++) {
    const x = 790 + i * 13;
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x - 7, 150, x - 3, 172);
    g.stroke();
  }
  dots(g, [[928, 128]], 5, 0.4);
}
// Augen an den Hammerenden, Maul, Kiemen
function hammerDetail(g) {
  dots(g, [[950, 66], [950, 334]], 7, 0.55);
  g.globalAlpha = 0.3;
  g.beginPath();
  g.moveTo(912, 180);
  g.quadraticCurveTo(936, 200, 912, 220);
  for (let i = 0; i < 5; i++) {
    const x = 800 + i * 12;
    g.moveTo(x, 170);
    g.lineTo(x - 4, 160);
    g.moveTo(x, 230);
    g.lineTo(x - 4, 240);
  }
  g.stroke();
}
// Maul zwischen den Kopflappen, zwei Reihen Kiemenspalten
function mantaDetail(g) {
  g.globalAlpha = 0.34;
  g.beginPath();
  g.moveTo(552, 468);
  g.quadraticCurveTo(562, 500, 552, 532);
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = 478 - i * 13;
      g.moveTo(x, 500 + sd * 40);
      g.lineTo(x - 5, 500 + sd * 70);
    }
  }
  g.stroke();
}

// Lichtstrahl: weiches Querprofil, nach unten auslaufend (wird verzerrt gezeichnet)
function raySprite(kit, col) {
  const { c, g } = kit.layer(32, 128, false);
  const h = g.createLinearGradient(0, 0, 32, 0);
  h.addColorStop(0, kit.rgba(col, 0));
  h.addColorStop(0.5, kit.rgba(col, 1));
  h.addColorStop(1, kit.rgba(col, 0));
  g.fillStyle = h;
  g.fillRect(0, 0, 32, 128);
  g.globalCompositeOperation = 'destination-in';
  const v = g.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, 'rgba(0,0,0,1)');
  v.addColorStop(0.35, 'rgba(0,0,0,0.55)');
  v.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, 32, 128);
  return c;
}

// Luftblase: heller Rand, fast leeres Inneres, kleiner Glanzpunkt
function bubbleSprite(kit, col) {
  const { c, g } = kit.layer(32, 32, false);
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 15);
  r.addColorStop(0, kit.rgba(col, 0.06));
  r.addColorStop(0.62, kit.rgba(col, 0.14));
  r.addColorStop(0.84, kit.rgba(col, 0.8));
  r.addColorStop(1, kit.rgba(col, 0));
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = kit.rgba(col, 0.95);
  g.beginPath();
  g.arc(11, 11, 2.6, 0, Math.PI * 2);
  g.fill();
  return c;
}

const frac = (v) => v - Math.floor(v);
const hash = (n) => frac(Math.sin(n * 12.9898 + 4.1414) * 43758.5453);

// ---------- Szene ----------

export function scene(p, kit) {
  const { rgba, mix, clamp, TAU } = kit;
  const k = p.k;
  const dark = p.dark;
  const ADD = dark ? 'lighter' : 'source-over';
  const STILL = 24;

  const shine = kit.glow(p.a, 256, 0.26);
  const glint = kit.glow(p.d, 64, 0.24);
  const ray = raySprite(kit, p.c);
  const bubble = bubbleSprite(kit, p.d);

  const SIDE = {
    side: true,
    top: rgba(p.s1, 1),
    bot: rgba(p.s2, 1),
    rim: rgba(p.s4, 1),
    mid: rgba(mix(p.s4, p.s1, 0.55), 1),
  };
  const BELOW = { side: false, top: rgba(mix(p.s1, p.s2, 0.35), 1), bot: rgba(mix(p.s1, p.s2, 0.35), 1), rim: rgba(p.s4, 1) };

  let ctx = null;
  let W = 0;
  let H = 0;
  let sw = 0;
  let cw = 0;
  let mx = 0;
  let phone = false;
  let fish = null;
  const FW = 10;
  const FH = 4;

  // ---------- ruhendes Bild und Kachel-Wiederherstellung (wie beim Lagerfeuer) ----------

  let base = null;
  let full = true;
  const TS = 24;
  let tc = 0;
  let tr = 0;
  let tiles = new Uint8Array(1);
  const MO = 96;
  const O0 = new Int16Array(MO);
  const O1 = new Int16Array(MO);
  const OR = new Int16Array(MO);
  const RC0 = new Int16Array(MO);
  const RC1 = new Int16Array(MO);
  function dirty(x0, y0, x1, y1) {
    const c0 = Math.max(0, Math.floor(x0 / TS));
    const c1 = Math.min(tc - 1, Math.floor(x1 / TS));
    const r0 = Math.max(0, Math.floor(y0 / TS));
    const r1 = Math.min(tr - 1, Math.floor(y1 / TS));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) tiles[r * tc + c] = 1;
  }
  function restore(c0, r0, c1, r1) {
    const d = kit.dpr;
    const bw = base.c.width;
    const bh = base.c.height;
    const x0 = Math.floor(c0 * TS * d);
    const y0 = Math.floor(r0 * TS * d);
    const x1 = Math.min(bw, Math.ceil((c1 + 1) * TS * d));
    const y1 = Math.min(bh, Math.ceil((r1 + 1) * TS * d));
    if (x1 <= x0 || y1 <= y0) return;
    ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    ctx.drawImage(base.c, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  }
  // markierte Kacheln zu Streifen je Zeile zusammenfassen, gleiche Streifen untereinander zu Rechtecken
  function restoreTiles() {
    let no = 0;
    for (let r = 0; r <= tr; r++) {
      let nr = 0;
      if (r < tr) {
        let c = 0;
        while (c < tc) {
          if (!tiles[r * tc + c]) {
            c++;
            continue;
          }
          const c0 = c;
          while (c < tc && tiles[r * tc + c]) tiles[r * tc + c++] = 0;
          if (nr < MO) {
            RC0[nr] = c0;
            RC1[nr] = c - 1;
            nr++;
          } else restore(c0, r, c - 1, r);
        }
      }
      let w = 0;
      for (let o = 0; o < no; o++) {
        let hit = -1;
        for (let q = 0; q < nr; q++) {
          if (RC0[q] === O0[o] && RC1[q] === O1[o]) {
            hit = q;
            break;
          }
        }
        if (hit < 0) {
          restore(O0[o], OR[o], O1[o], r - 1);
          continue;
        }
        RC0[hit] = -1;
        O0[w] = O0[o];
        O1[w] = O1[o];
        OR[w] = OR[o];
        w++;
      }
      no = w;
      for (let q = 0; q < nr; q++) {
        if (RC0[q] < 0) continue;
        if (no < MO) {
          O0[no] = RC0[q];
          O1[no] = RC1[q];
          OR[no] = r;
          no++;
        } else restore(RC0[q], r, RC1[q], r);
      }
    }
  }

  // ---------- Tiere ----------

  // Bildpaar (nach rechts / nach links), für den Schwanzschlag zerlegt: fester Vorderkörper und K schmale Streifen
  // zum Schwanz hin – jedes Teil ein eigenes Bild, gezeichnet auf ganzen Gerätepixeln (schnell und ohne Nähte)
  function pair(P, uw, uh, len, look, flex, amp, lag) {
    const d = kit.dpr;
    const fw = Math.round((PAD + flex * len) * d);
    const K = flex ? clamp(Math.round(fw / 20), 4, 32) : 0;
    const cut = (c, tailLeft) => {
      const w = c.width;
      const h = c.height;
      const x0 = tailLeft ? 0 : w - fw;
      const parts = [];
      for (let i = 0; i < K; i++) {
        const a = x0 + Math.round((i * fw) / K);
        const b = x0 + Math.round(((i + 1) * fw) / K);
        const L = kit.layer(b - a, h, false);
        L.g.drawImage(c, a, 0, b - a, h, 0, 0, b - a, h);
        const mid = (a + b) / 2 - x0;
        parts.push({ c: L.c, x: a, q: tailLeft ? 1 - mid / fw : mid / fw });
      }
      const rx = tailLeft ? fw : 0;
      const R = kit.layer(w - fw, h, false);
      R.g.drawImage(c, rx, 0, w - fw, h, 0, 0, w - fw, h);
      return { w, h, rig: R.c, rx, parts };
    };
    const one = (flip) => {
      const c = animal(kit, P, uw, uh, len, look, flip);
      return K ? cut(c, !flip) : { w: c.width, h: c.height, rig: c, rx: 0, parts: [] };
    };
    return { r: one(false), l: one(true), amp: amp * len, lag };
  }

  // Zeitplan eines Tiers: zieht quer durchs Bild, danach Pause; Lage je Durchgang leicht anders
  // o: A (Bilder), len, v (px/s), gap (s), dir (0 = abwechselnd), y, yv (Streuung je Durchgang), ya/yw (Auf und Ab),
  //    beat (Schläge/s), alpha, at (Anteil der Strecke im Standbild)
  function plan(o) {
    o.D = (cw + o.len * 1.2) / o.v;
    o.per = o.D + o.gap;
    o.off = (((o.at * o.D - STILL) % o.per) + o.per) % o.per;
    o.on = false;
    return o;
  }
  function place(o, t) {
    const q = (t + o.off) / o.per;
    const n = Math.floor(q);
    const u = (q - n) * o.per;
    o.on = u <= o.D;
    if (!o.on) return false;
    const dir = o.dir || (n % 2 ? -1 : 1);
    const ph = t * o.yw + o.seed + n * 1.7;
    o.dx = dir;
    o.x = dir > 0 ? sw - o.len * 0.6 + u * o.v : W + o.len * 0.6 - u * o.v;
    o.y = o.y0 + (hash(n * 3.1 + o.seed) - 0.5) * o.yv + Math.sin(ph) * o.ya + (o.climb ? (u / o.D - 0.5) * o.climb * (hash(n + o.seed) < 0.5 ? -1 : 1) : 0);
    return true;
  }

  // Schwanzschlag: die Streifen werden senkrecht versetzt, die Welle läuft zum Schwanz hin
  function swim(o, t) {
    const A = o.A;
    const S = o.dx > 0 ? A.r : A.l;
    const d = kit.dpr;
    const X0 = Math.round(o.x * d - S.w / 2);
    const Y0 = Math.round(o.y * d - S.h / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = o.alpha * k;
    ctx.drawImage(S.rig, X0 + S.rx, Y0);
    const ph = t * o.beat * TAU + o.seed;
    const amp = A.amp * d;
    const parts = S.parts;
    for (let i = 0; i < parts.length; i++) {
      const pt = parts[i];
      ctx.drawImage(pt.c, X0 + pt.x, Y0 + Math.round(amp * pt.q * pt.q * Math.sin(ph - pt.q * A.lag)));
    }
    const hx = S.w / 2 / d;
    const hy = S.h / 2 / d + A.amp + 1;
    dirty(o.x - hx, o.y - hy, o.x + hx, o.y + hy);
  }

  // Manta: die Flügel schlagen langsam (von unten wirkt das wie ein Atmen der Spannweite)
  function glide(o, t) {
    const S = o.dx > 0 ? o.A.r : o.A.l;
    const d = kit.dpr;
    const s = Math.sin(t * o.beat * TAU + o.seed);
    const h = Math.round(S.h * (1 - 0.2 * s * s));
    const y = o.y - Math.cos(t * o.beat * TAU + o.seed) * 2.5;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = o.alpha * k;
    ctx.drawImage(S.rig, Math.round(o.x * d - S.w / 2), Math.round(y * d - h / 2), S.w, h);
    const hx = S.w / 2 / d;
    const hy = S.h / 2 / d + 4;
    dirty(o.x - hx, y - hy, o.x + hx, y + hy);
  }

  let WH = null;
  let NEAR = null;
  let FAR = null;
  let HAM = null;
  let MAN = null;
  let SCH = null;

  // Fischschwarm: x, y (Versatz im Schwarm), Phase, Größe
  const MF = 56;
  const FS = new Float32Array(MF * 4);
  let nf = 0;
  function school(t) {
    const o = SCH;
    const span = cw + o.rx * 2 + 40;
    const u = frac((t + o.off) / o.per);
    const cx = W + o.rx + 20 - u * span;
    const cy = o.y0 + Math.sin(t * 0.21) * 10;
    const d = kit.dpr;
    const pred = NEAR.on;
    const px = NEAR.x;
    const py = NEAR.y;
    const rx = NEAR.len * 0.62;
    const ry = NEAR.len * 0.26;
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    for (let i = 0; i < nf; i++) {
      const j = i * 4;
      const ph = FS[j + 2];
      let x = cx + FS[j] + Math.sin(t * 0.9 + ph * 7) * 5;
      let y = cy + FS[j + 1] + Math.sin(t * 1.3 + ph * 11) * 3;
      if (pred) {
        // vor dem Hai weicht der Schwarm nach oben und unten aus
        const ex = (x - px) / rx;
        const ey = (y - py) / ry;
        const e = ex * ex + ey * ey;
        if (e < 1) {
          const f = (1 - e) * (1 - e);
          y += (ey >= 0 ? 1 : -1) * f * ry * 1.5;
          x += (ex >= 0 ? 1 : -1) * f * 12;
        }
      }
      if (x < sw - 10 || x > W + 10) continue;
      const s = FS[j + 3];
      ctx.globalAlpha = o.alpha * k * (dark ? 0.6 + 0.4 * Math.sin(t * 1.9 + ph * 13) : 1);
      ctx.drawImage(fish, x - FW * 0.5 * s, y - FH * 0.5 * s, FW * s, FH * s);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 > x0) dirty(x0 - 9, y0 - 5, x1 + 9, y1 + 5);
  }

  // Blasen: x-Anteil, Steiggeschwindigkeit, Größe, Phase, Pause
  const MB = 16;
  const BU = new Float32Array(MB * 5);
  let nb = 0;
  // Glitzern an der Oberfläche: x, y, Breite, Höhe, Phase, Tempo
  const MG = 26;
  const GL = new Float32Array(MG * 6);
  let ng = 0;
  // wandernde Lichtstrahlen (fertig gezeichnet): x links, Breite, Länge, Phase, Tempo
  const MR = 3;
  const RP = new Float32Array(MR * 5);
  const RPC = [];
  let nr = 0;

  function seat() {
    const rnd = kit.seeded(2207 + (phone ? 11 : 0));
    const area = cw * H;
    const L = (dsk, ph) => (phone ? ph : dsk);

    const wl = phone ? Math.min(cw * 0.8, 340) : clamp(cw * 0.46, 380, 640);
    WH = plan({
      A: pair(WHALE, 1000, 400, wl, { ...SIDE, y0: 80, y1: 330, detail: whaleDetail, glow: dark ? rgba(p.b, 1) : null }, 0.52, 0.032, 1.3),
      len: wl, v: (cw + wl * 1.2) / 22, gap: 4, dir: 0, y0: H * L(0.55, 0.54), yv: H * 0.09, ya: H * 0.02, yw: 0.16,
      beat: 0.21, alpha: dark ? 0.82 : 0.34, at: 0.52, seed: 1.3,
    });
    const nl = phone ? cw * 0.36 : clamp(cw * 0.17, 150, 230);
    NEAR = plan({
      A: pair(SHARK, 1000, 300, nl, { ...SIDE, y0: 60, y1: 220, detail: sharkDetail }, 0.5, 0.024, 2.2),
      len: nl, v: L(64, 36), gap: L(6, 5), dir: 1, y0: H * L(0.8, 0.83), yv: H * 0.02, ya: 8, yw: 0.33,
      beat: 0.95, alpha: dark ? 0.95 : 0.5, at: 0.36, seed: 4.2,
    });
    const fl = nl * 0.58;
    FAR = plan({
      A: pair(SHARK, 1000, 300, fl, { ...SIDE, y0: 60, y1: 220, detail: sharkDetail }, 0.5, 0.024, 2.2),
      len: fl, v: L(27, 15), gap: 3, dir: -1, y0: H * L(0.66, 0.69), yv: H * 0.04, ya: 6, yw: 0.27,
      beat: 0.8, alpha: dark ? 0.5 : 0.24, at: 0.78, seed: 7.7,
    });
    const hl = phone ? cw * 0.31 : clamp(cw * 0.15, 130, 200);
    HAM = plan({
      A: pair(HAMMER, 1000, 400, hl, { ...BELOW, y0: 0, y1: 400, detail: hammerDetail }, 0.62, 0.03, 2.6),
      len: hl, v: L(46, 25), gap: L(5, 4), dir: 0, y0: H * L(0.2, 0.17), yv: H * 0.05, ya: 9, yw: 0.3,
      beat: 0.85, alpha: dark ? 0.86 : 0.42, at: 0.6, seed: 2.9,
    });
    const ml = phone ? cw * 0.16 : clamp(cw * 0.075, 70, 100);
    MAN = plan({
      A: pair(MANTA, 600, 1000, ml, { ...BELOW, y0: 0, y1: 1000, detail: mantaDetail }, 0, 0, 0),
      len: ml, v: L(48, 24), gap: L(16, 12), dir: 0, y0: H * L(0.13, 0.11), yv: H * 0.05, ya: 6, yw: 0.2, climb: H * 0.07,
      beat: 0.24, alpha: dark ? 0.85 : 0.42, at: 0.24, seed: 5.5,
    });

    // Fischschwarm zieht dem nahen Hai entgegen
    const rx = phone ? 64 : 104;
    const ry = phone ? 20 : 30;
    SCH = { rx, y0: NEAR.y0 - 4, alpha: dark ? 0.62 : 0.5, off: 0, per: 1 };
    SCH.per = (cw + rx * 2 + 40) / L(20, 11);
    SCH.off = ((0.42 * SCH.per - STILL) % SCH.per + SCH.per) % SCH.per;
    nf = Math.min(MF, clamp(Math.round(area / 16000), 18, 48));
    for (let i = 0; i < nf; i++) {
      const j = i * 4;
      const ox = (rnd() + rnd() - 1) * rx;
      FS[j] = ox;
      FS[j + 1] = (rnd() + rnd() - 1) * ry * (1 - 0.5 * Math.abs(ox / rx));
      FS[j + 2] = rnd();
      FS[j + 3] = rnd(0.75, 1.2);
    }

    nb = Math.min(MB, phone ? 7 : 13);
    for (let i = 0; i < nb; i++) {
      const j = i * 5;
      BU[j] = rnd();
      BU[j + 1] = rnd(22, 46);
      BU[j + 2] = rnd(3, 7);
      BU[j + 3] = rnd();
      BU[j + 4] = rnd(1, 8);
    }

    ng = Math.min(MG, phone ? 11 : 22);
    for (let i = 0; i < ng; i++) {
      const j = i * 6;
      const near = rnd() < 0.6;
      GL[j] = near ? mx + (rnd() - 0.5) * Math.min(cw * 0.6, 640) : sw + rnd() * cw;
      GL[j + 1] = H * rnd(0.004, 0.06) + 3;
      GL[j + 2] = rnd(24, phone ? 50 : 76);
      GL[j + 3] = rnd(3, 6);
      GL[j + 4] = rnd(0, TAU);
      GL[j + 5] = rnd(0.7, 1.9);
    }

    nr = phone ? 2 : 3;
    RPC.length = 0;
    for (let i = 0; i < nr; i++) {
      const j = i * 5;
      const x = mx + (i - (nr - 1) / 2) * Math.min(cw * 0.24, 220) + rnd(-20, 20);
      const w = rnd(40, phone ? 64 : 96);
      const len = H * rnd(0.42, 0.6);
      const sl = (x - mx) * 0.45;
      const bw = w + Math.abs(sl);
      const L = kit.layer(bw, len);
      const d = kit.dpr;
      L.g.setTransform((d * w) / 32, 0, (d * sl) / 128, (d * len) / 128, d * Math.max(0, -sl), 0);
      L.g.drawImage(ray, 0, 0);
      RPC.push(L.c);
      RP[j] = x - w / 2 - Math.max(0, -sl);
      RP[j + 1] = bw;
      RP[j + 2] = len;
      RP[j + 3] = rnd(0, TAU);
      RP[j + 4] = rnd(0.15, 0.28);
    }
  }

  // Ruhende Ebene: Mond-/Sonnenschein an der Oberfläche, Wellennetz, Strahlenfächer, Schwebeteilchen
  function paint() {
    const d = kit.dpr;
    const rnd = kit.seeded(9091 + (phone ? 3 : 0));
    base = kit.layer(W, H);
    const b = base.g;
    b.save();
    b.beginPath();
    b.rect(sw, 0, cw, H);
    b.clip();
    b.globalCompositeOperation = ADD;

    // Schein des Mondes / der Sonne durch die Oberfläche
    const RW = Math.min(cw * 0.46, 520);
    const RH = Math.min(H * 0.32, 280);
    b.globalAlpha = (dark ? 0.42 : 0.75) * k;
    b.drawImage(shine, mx - RW, -RH * 0.62, RW * 2, RH * 1.24);
    b.globalAlpha = (dark ? 0.5 : 0.8) * k;
    b.drawImage(shine, mx - RW * 0.35, -RH * 0.3, RW * 0.7, RH * 0.5);

    // helles Band direkt unter der Oberfläche
    const band = H * 0.15;
    const sg = b.createLinearGradient(0, 0, 0, band);
    sg.addColorStop(0, rgba(p.a, dark ? 0.12 : 0.36));
    sg.addColorStop(1, rgba(p.a, 0));
    b.globalAlpha = k;
    b.fillStyle = sg;
    b.fillRect(sw, 0, cw, band);

    // Wellennetz der Oberfläche, von unten gesehen (zum Mond hin heller)
    const lg = b.createLinearGradient(sw, 0, W, 0);
    const mf = clamp((mx - sw) / cw, 0, 1);
    const la = dark ? 0.22 : 0.5;
    lg.addColorStop(0, rgba(p.a, la * 0.25));
    lg.addColorStop(mf, rgba(p.a, la));
    lg.addColorStop(1, rgba(p.a, la * 0.25));
    b.strokeStyle = lg;
    b.lineWidth = 1;
    const rows = phone ? 7 : 9;
    const gapY = H * (phone ? 0.011 : 0.013);
    for (let i = 0; i < rows; i++) {
      const y0 = 3 + i * gapY;
      const f1 = rnd(0.012, 0.03);
      const f2 = rnd(0.03, 0.07);
      const a1 = gapY * rnd(0.5, 0.9);
      const a2 = gapY * rnd(0.15, 0.35);
      const p1 = rnd(0, TAU);
      const p2 = rnd(0, TAU);
      b.globalAlpha = k * (1 - i / rows) ** 1.4;
      b.beginPath();
      for (let x = sw; x <= W + 8; x += 8) {
        const y = y0 + Math.sin(x * f1 + p1) * a1 + Math.sin(x * f2 + p2) * a2;
        if (x === sw) b.moveTo(x, y);
        else b.lineTo(x, y);
      }
      b.stroke();
    }

    // Strahlenfächer vom Mond / von der Sonne
    const nR = phone ? 6 : 9;
    for (let i = 0; i < nR; i++) {
      const xt = mx + (rnd() * 2 - 1) * cw * 0.36;
      const w = rnd(26, 110) * (phone ? 0.65 : 1);
      const len = H * rnd(0.42, 0.88);
      const slant = (xt - mx) * rnd(0.4, 0.8) + rnd(-20, 20);
      b.globalAlpha = (dark ? rnd(0.06, 0.15) : rnd(0.14, 0.3)) * k;
      b.setTransform((d * w) / 32, 0, (d * slant) / 128, (d * len) / 128, d * (xt - w / 2), -4 * d);
      b.drawImage(ray, 0, 0);
    }
    b.setTransform(d, 0, 0, d, 0, 0);

    // Schwebeteilchen (Meeresschnee / Plankton)
    b.globalCompositeOperation = 'source-over';
    b.fillStyle = rgba(dark ? p.d : p.a, 1);
    const nS = clamp(Math.round((cw * H) / (dark ? 5000 : 12000)), 20, 220);
    for (let i = 0; i < nS; i++) {
      const s = rnd(0.7, 1.7);
      b.globalAlpha = (dark ? rnd(0.08, 0.3) : rnd(0.25, 0.55)) * k;
      b.fillRect(sw + rnd() * cw, H * rnd(0.12, 1), s, s);
    }
    b.restore();
  }

  return {
    resize() {
      W = kit.W;
      H = kit.H;
      ctx = kit.ctx;
      sw = kit.sideW();
      cw = W - sw;
      phone = W <= 760;
      mx = sw + cw * 0.68;
      // kleiner Fisch (nach links), etwas heller am Rücken
      const f = kit.layer(FW, FH);
      const fg = f.g;
      const col = p.s3;
      fg.fillStyle = rgba(col, 1);
      fg.beginPath();
      fg.ellipse(4.2, 2, 3.9, 1.45, 0, 0, TAU);
      fg.moveTo(7.2, 2);
      fg.lineTo(10, 0.4);
      fg.lineTo(9.3, 2);
      fg.lineTo(10, 3.6);
      fg.closePath();
      fg.fill();
      fish = f.c;
      seat();
      paint();
      tc = Math.ceil(W / TS);
      tr = Math.ceil(H / TS);
      tiles = new Uint8Array(tc * tr);
      full = true;
    },

    frame(t, dt) {
      const d = kit.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (!dt || full) {
        ctx.clearRect(0, 0, base.c.width, base.c.height);
        ctx.drawImage(base.c, 0, 0);
        tiles.fill(0);
        full = false;
      } else restoreTiles();
      ctx.save();
      if (sw > 0) {
        // die Seitenleiste bleibt ruhig: Tiere tauchen hinter ihr auf
        ctx.beginPath();
        ctx.rect(sw * d, 0, cw * d, H * d);
        ctx.clip();
      }

      // wandernde Lichtstrahlen
      ctx.globalCompositeOperation = ADD;
      for (let i = 0; i < nr; i++) {
        const j = i * 5;
        const x = RP[j] + Math.sin(t * 0.11 + RP[j + 3]) * 22;
        const a = 0.5 + 0.5 * Math.sin(t * RP[j + 4] + RP[j + 3]);
        ctx.globalAlpha = a * a * (dark ? 0.2 : 0.3) * k;
        ctx.drawImage(RPC[i], Math.round(x * d), -4 * d);
        dirty(x, 0, x + RP[j + 1], RP[j + 2]);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Tiere: Wal ganz hinten, dann ferner Hai, Schwarm, naher Hai, oben Hammerhai und Manta
      ctx.globalCompositeOperation = 'source-over';
      if (place(WH, t)) swim(WH, t);
      if (place(FAR, t)) swim(FAR, t);
      place(NEAR, t);
      school(t);
      if (NEAR.on) swim(NEAR, t);
      if (place(HAM, t)) swim(HAM, t);
      if (place(MAN, t)) glide(MAN, t);

      // Blasen
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.globalCompositeOperation = ADD;
      const top = H * 0.06;
      for (let i = 0; i < nb; i++) {
        const j = i * 5;
        const v = BU[j + 1];
        const per = (H + 20 - top) / v + BU[j + 4];
        const q = t / per + BU[j + 3];
        const n = Math.floor(q);
        const y = H + 10 - (q - n) * per * v;
        if (y < top) continue;
        const x = sw + cw * frac(BU[j] + hash(n * 7.7 + i) * 0.37) + Math.sin(t * 1.7 + i * 2.3) * 5;
        const s = BU[j + 2] * (1.25 - 0.45 * (y / H));
        ctx.globalAlpha = clamp((y - top) / (H * 0.22), 0, 1) * clamp((H + 10 - y) / 40, 0, 1) * (dark ? 0.6 : 0.75) * k;
        ctx.drawImage(bubble, x - s / 2, y - s / 2, s, s);
        dirty(x - s / 2 - 1, y - s / 2 - 1, x + s / 2 + 1, y + s / 2 + 1);
      }

      // Glitzern an der Oberfläche
      for (let i = 0; i < ng; i++) {
        const j = i * 6;
        const w = GL[j + 2];
        const h = GL[j + 3];
        const x = GL[j] + Math.sin(t * 0.23 + GL[j + 4]) * 16;
        const y = GL[j + 1];
        const a = 0.5 + 0.5 * Math.sin(t * GL[j + 5] + GL[j + 4]);
        ctx.globalAlpha = a * a * (dark ? 0.55 : 0.8) * k;
        ctx.drawImage(glint, x - w / 2, y - h / 2, w, h);
        dirty(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
      }

      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

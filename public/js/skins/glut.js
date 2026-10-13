// Stil „Lagerfeuer“ – Nacht am Lagerfeuer: Funken und Glut steigen flackernd und verwirbelt auf,
// unten pulsiert die Wärme, davor Berge und Tannen als Schattenriss unter ein paar Sternen.
// Hell: goldener Herbstabend – cremefarbener Himmel, weiches Orangelicht, weniger und sanftere Funken.
// skin: Eintrag für die Stil-Auswahl (Vorschau-Farben je Hell/Dunkel).
// scene(p, kit): bewegter Hintergrund (siehe js/bgfx.js).

// Vorschau: Tannen vor dem Feuerschein, darüber Funken
const TREES = (c) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 40' preserveAspectRatio='none'%3E%3Cpath fill='${c}' d='M0 40V22l4-12 4 12-2 0 5-17 5 17-2 0 3-9 3 9 4-14 4 14 3-7 3 9 2-3 4 3H58l4-6 3 6 4-15 4 15 2-8 4 10 3-18 5 18 3-11 3 11 4-14 3 14V40Z'/%3E%3C/svg%3E") 0 100% / 100% 46% no-repeat`;
const DOTS = (list) => list.map(([x, y, s, c]) => `radial-gradient(circle at ${x}% ${y}%, ${c} 0 ${s}%, transparent ${s + 1.6}%)`).join(', ');

export const skin = {
  id: 'glut', name: 'Lagerfeuer', desc: 'Live · Funken & Glut', live: true,
  light: {
    bg: `${DOTS([[48, 50, 1.1, 'rgba(234,88,12,.8)'], [55, 36, 0.9, 'rgba(245,158,11,.8)'], [44, 26, 0.8, 'rgba(234,88,12,.6)'], [60, 18, 0.7, 'rgba(194,65,12,.5)']])}, ${TREES('%23a0532b')}, radial-gradient(42% 34% at 52% 96%, rgba(255,160,70,.85), rgba(255,170,90,.3) 55%, transparent 76%), radial-gradient(50% 40% at 82% 8%, rgba(255,252,236,.95), transparent 70%), linear-gradient(180deg, #fff4e0, #ffe0b4 55%, #f6ad72), #fbe3c4`,
    surface: 'rgba(255,250,243,.84)', accent: '#c2410c', text: '#2b1308',
  },
  dark: {
    bg: `${DOTS([[50, 54, 1.2, 'rgba(255,214,140,.95)'], [56, 40, 1, 'rgba(255,170,80,.9)'], [45, 30, 0.9, 'rgba(255,140,60,.8)'], [58, 20, 0.8, 'rgba(255,100,40,.7)'], [42, 14, 0.7, 'rgba(255,90,40,.55)']])}, ${DOTS([[14, 12, 0.5, 'rgba(255,240,220,.8)'], [80, 9, 0.6, 'rgba(255,240,220,.85)'], [90, 26, 0.4, 'rgba(255,240,220,.6)'], [28, 30, 0.4, 'rgba(255,240,220,.5)']])}, ${TREES('%23070302')}, radial-gradient(40% 34% at 52% 98%, rgba(255,190,90,.95), rgba(255,100,30,.5) 45%, transparent 78%), linear-gradient(180deg, #0c0911, #170d0b 55%, #34160a), #120a06`,
    surface: 'rgba(28,17,11,.74)', accent: '#ff8a3d', text: '#fff0e2', glow: true,
  },
};

// ---------- Vorlagen ----------

// Funke für helle Flächen: kräftiger Kern, weicher Rand (Leuchten allein wäre auf Creme unsichtbar)
function dotSprite(kit, col) {
  const { c, g } = kit.layer(32, 32, false);
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, kit.rgba(col, 1));
  gr.addColorStop(0.22, kit.rgba(col, 0.85));
  gr.addColorStop(0.5, kit.rgba(col, 0.18));
  gr.addColorStop(1, kit.rgba(col, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return c;
}

// Unscharfe Glutscheibe (wie ein Funke ganz nah vor der Kamera)
function discSprite(kit, col) {
  const { c, g } = kit.layer(64, 64, false);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, kit.rgba(col, 0.55));
  gr.addColorStop(0.62, kit.rgba(col, 0.42));
  gr.addColorStop(0.8, kit.rgba(col, 0.16));
  gr.addColorStop(1, kit.rgba(col, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}

// weiches Rauschen aus Stützpunkten (für Bergkämme)
function noise(rnd, len, step) {
  const n = Math.ceil(len / step) + 2;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = rnd();
  return (x) => {
    const f = Math.max(0, x) / step;
    const i = Math.floor(f);
    const u = (1 - Math.cos((f - i) * Math.PI)) / 2;
    return v[i] * (1 - u) + v[i + 1] * u;
  };
}

// Tanne als Pfad (Fuß bei x, y; Höhe h) – mehrere Astetagen
function pine(g, x, y, h, w) {
  const n = 4;
  g.moveTo(x, y - h);
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    const ty = y - h + h * 0.97 * f;
    g.lineTo(x + w * f, ty);
    if (i < n) g.lineTo(x + w * f * 0.45, ty - h * 0.025);
  }
  g.lineTo(x + w * 0.1, y + 3);
  g.lineTo(x - w * 0.1, y + 3);
  for (let i = n; i >= 1; i--) {
    const f = i / n;
    const ty = y - h + h * 0.97 * f;
    g.lineTo(x - w * f, ty);
    if (i > 1) g.lineTo(x - w * ((i - 1) / n) * 0.45, y - h + h * 0.97 * ((i - 1) / n) - h * 0.025);
  }
  g.closePath();
}

const frac = (v) => v - Math.floor(v);
const hash = (n) => frac(Math.sin(n) * 43758.5453);

// ---------- Szene ----------

export function scene(p, kit) {
  const { rgba, mix, clamp, TAU } = kit;
  const k = p.k;
  const dark = p.dark;
  const ADD = dark ? 'lighter' : 'source-over';

  const spark = dark ? [kit.glow(p.a, 32, 0.28), kit.glow(p.b, 32, 0.26), kit.glow(p.c, 32, 0.26)] : [dotSprite(kit, p.a), dotSprite(kit, p.b), dotSprite(kit, p.c)];
  const flame = [kit.glow(p.a, 64, 0.38), kit.glow(p.b, 64, 0.32), kit.glow(p.c, 64, 0.26)];
  const heat = kit.glow(p.d, 256, 0.32);
  const bokeh = discSprite(kit, dark ? p.b : p.d);
  const starGlow = dark ? kit.glow(p.s1, 32, 0.18) : null;
  const STAR = rgba(p.s1, 1);

  let ctx = null;
  let landY = 0;
  let hb = 0;
  let sw = 0;
  let cw = 0;
  let fx = 0;
  let fy = 0;
  let FS = 40;
  let FH = 80;
  let RX = 300;
  let RY = 180;

  // Funken: x0, y0, Steighöhe, 1/Lebensdauer, Phase, Wirbel, Wellenzahl, Wirbeltempo, Neigung, Größe, Flackern, Art, Streuung
  const SS = 13;
  const MSP = 170;
  const SP = new Float32Array(MSP * SS);
  let nsp = 0;
  // Flammen: Versatz, 1/Lebensdauer, Phase, Größe
  const MFL = 16;
  const FL = new Float32Array(MFL * 4);
  let nfl = 0;
  // Sterne: x, y, Größe
  const MST = 130;
  const ST = new Float32Array(MST * 3);
  let nst = 0;

  // ruhendes Gesamtbild (Sterne und Landschaft); bewegte Teile merken sich die Kacheln, die sie berührt haben,
  // und nur diese Kacheln werden im nächsten Bild aus dem Gesamtbild wiederhergestellt
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
  const mark = (r, x, y) => dirty(x - r, y - r, x + r, y + r);
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

  let OX = 0;
  let OY = 0;
  // Ort eines Funkens im Alter u (0–1): bremst beim Steigen, Wind und zwei Wirbel verbiegen die Bahn
  function at(j, u, t, x0, lean, wind, hs) {
    const R = SP[j + 2];
    const e = u * (1.7 - 0.7 * u);
    const y = SP[j + 1] - R * e;
    const amp = SP[j + 5] * u;
    const f = SP[j + 6];
    const w = SP[j + 7];
    OX = x0 + (wind * 0.3 + lean) * e * e * R + Math.sin(y * f + t * w + SP[j + 4] * 20) * amp + Math.sin(y * f * 2.3 - t * w * 1.7 + hs * 9) * amp * 0.45;
    OY = y;
  }

  function seat() {
    const { W, H } = kit;
    const rnd = kit.seeded(4711 + (W > 760 ? 0 : 5));
    const area = cw * H;
    const phone = W <= 760;
    const nFire = dark ? clamp(Math.round(area / 14000), 22, 80) : clamp(Math.round(area / 30000), 10, 36);
    const nAmb = dark ? clamp(Math.round(area / 36000), 8, 30) : clamp(Math.round(area / 60000), 5, 16);
    const nBok = phone ? 0 : 5;
    nsp = Math.min(MSP, nFire + nAmb + nBok);
    for (let i = 0; i < nsp; i++) {
      const j = i * SS;
      const kind = i < nFire ? 0 : i < nFire + nAmb ? 1 : 2;
      SP[j + 11] = kind;
      SP[j + 4] = rnd();
      SP[j + 10] = rnd(7, 19);
      if (kind === 0) {
        // aus dem Feuer: schnell, eng, mit Wirbeln
        SP[j] = fx;
        SP[j + 1] = fy - FH * 0.25;
        SP[j + 2] = H * rnd(0.3, 0.92);
        SP[j + 3] = 1 / rnd(2.4, 5.2);
        SP[j + 5] = rnd(10, phone ? 30 : 44);
        SP[j + 6] = rnd(0.006, 0.016);
        SP[j + 7] = rnd(0.6, 1.8);
        SP[j + 8] = rnd(-0.32, 0.32);
        SP[j + 9] = rnd(8, 16) * (dark ? 1 : 0.8);
        SP[j + 12] = FS * 0.9;
      } else if (kind === 1) {
        // verwehte Glut überall im Bild: langsam und klein
        SP[j] = sw + cw * rnd(0.05, 0.95);
        SP[j + 1] = H * rnd(0.75, 1.05);
        SP[j + 2] = H * rnd(0.35, 0.8);
        SP[j + 3] = 1 / rnd(7, 13);
        SP[j + 5] = rnd(16, 40);
        SP[j + 6] = rnd(0.004, 0.01);
        SP[j + 7] = rnd(0.3, 0.8);
        SP[j + 8] = rnd(-0.08, 0.08);
        SP[j + 9] = rnd(5, 10) * (dark ? 1 : 0.8);
        SP[j + 12] = cw * 0.25;
      } else {
        // unscharfe große Glut ganz vorn
        SP[j] = sw + cw * rnd(0.1, 0.9);
        SP[j + 1] = H * rnd(0.85, 1.1);
        SP[j + 2] = H * rnd(0.5, 0.9);
        SP[j + 3] = 1 / rnd(11, 17);
        SP[j + 5] = rnd(20, 50);
        SP[j + 6] = rnd(0.003, 0.006);
        SP[j + 7] = rnd(0.2, 0.4);
        SP[j + 8] = rnd(-0.05, 0.05);
        SP[j + 9] = rnd(26, phone ? 44 : 64);
        SP[j + 12] = cw * 0.3;
      }
    }
    nfl = phone ? 6 : 12;
    for (let i = 0; i < nfl; i++) {
      const j = i * 4;
      FL[j] = rnd(-1, 1);
      FL[j + 1] = 1 / rnd(0.55, 1.05);
      FL[j + 2] = rnd();
      FL[j + 3] = rnd(0.75, 1.2);
    }
    nst = dark ? clamp(Math.round(area / 8000), 30, MST) : 0;
    for (let i = 0; i < nst; i++) {
      const j = i * 3;
      ST[j] = sw + rnd(0, cw);
      ST[j + 1] = H * 0.64 * rnd() ** 1.5;
      ST[j + 2] = rnd() < 0.82 ? 1 : 1.6;
    }
  }

  // Ruhende Ebene: Feuerschein am Himmel, Berge, zwei Reihen Tannen, Holzscheite
  function paint() {
    const { W, H } = kit;
    const rnd = kit.seeded(1312 + (W > 760 ? 0 : 7));
    hb = Math.round(Math.min(H * 0.46, 430));
    landY = H - hb;
    const land = kit.layer(W, hb);
    const g = land.g;
    const lx = fx;
    const ly = fy - landY;
    const phone = W <= 760;

    // Feuerschein hinter den Bäumen
    // (innerhalb der Ebene auslaufen lassen, sonst entsteht oben eine Kante)
    const R = Math.min(hb * 0.97, ly);
    g.save();
    g.translate(lx, ly);
    g.scale(Math.max(phone ? 1.2 : 1.7, Math.min(cw * 0.55, 900) / R), 1);
    const sg = g.createRadialGradient(0, 0, 0, 0, 0, R);
    sg.addColorStop(0, rgba(p.d, dark ? 0.5 : 0.45));
    sg.addColorStop(0.35, rgba(p.d, dark ? 0.2 : 0.2));
    sg.addColorStop(1, rgba(p.d, 0));
    g.fillStyle = sg;
    g.fillRect(-R, -R, R * 2, R * 2);
    g.restore();

    const n1 = noise(rnd, W + 60, 170);
    const n2 = noise(rnd, W + 60, 60);
    const n3 = noise(rnd, W + 60, 90);
    const haze = (y0, a) => {
      if (dark) return;
      const hz = g.createLinearGradient(0, y0, 0, hb);
      hz.addColorStop(0, rgba(p.s1, 0));
      hz.addColorStop(1, rgba(p.s1, a));
      g.fillStyle = hz;
      g.fillRect(0, y0, W, hb - y0);
    };

    // Berge in der Ferne
    g.beginPath();
    g.moveTo(0, hb);
    for (let x = 0; x <= W + 10; x += 10) g.lineTo(x, hb * 0.5 - (n1(x) * 0.72 + n2(x) * 0.28) * hb * 0.36);
    g.lineTo(W, hb);
    g.closePath();
    const mg = g.createLinearGradient(0, hb * 0.12, 0, hb);
    mg.addColorStop(0, rgba(p.s2, dark ? 0.9 : 0.5));
    mg.addColorStop(1, rgba(p.s2, dark ? 1 : 0.7));
    g.fillStyle = mg;
    g.fill();
    haze(hb * 0.3, 0.55);

    // hintere Tannenreihe auf einem Hügel
    const midBase = (x) => hb * 0.74 - n3(x) * hb * 0.12;
    g.beginPath();
    g.moveTo(0, hb);
    for (let x = 0; x <= W + 10; x += 10) g.lineTo(x, midBase(x));
    g.lineTo(W, hb);
    g.closePath();
    for (let x = rnd(0, 8); x < W + 10; x += rnd(7, 14)) {
      const h = hb * rnd(0.09, 0.2);
      pine(g, x, midBase(x) + 2, h, h * rnd(0.26, 0.34));
    }
    g.fillStyle = rgba(p.s3, dark ? 1 : 0.55);
    g.fill();
    haze(hb * 0.55, 0.4);

    // vordere Tannen, mit einer Lichtung um das Feuer
    const ground = hb - Math.max(10, hb * 0.05);
    const clear = phone ? 64 : 120;
    g.beginPath();
    g.rect(0, ground, W, hb - ground);
    for (let x = rnd(0, 20); x < W + 20; x += rnd(13, 30)) {
      const d = Math.abs(x - lx);
      if (d < clear) continue;
      const near = clamp((d - clear) / 160, 0.45, 1);
      const h = hb * rnd(0.24, 0.5) * near;
      pine(g, x, ground + 2, h, h * rnd(0.25, 0.33));
    }
    g.fillStyle = rgba(p.s4, dark ? 1 : 0.42);
    g.fill();

    // Feuerschein streift die Silhouetten
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.translate(lx, ly);
    g.scale(1.5, 1);
    const R2 = Math.min(R, phone ? 260 : 420);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, R2);
    rg.addColorStop(0, rgba(p.b, dark ? 0.32 : 0.3));
    rg.addColorStop(0.5, rgba(p.c, dark ? 0.12 : 0.1));
    rg.addColorStop(1, rgba(p.c, 0));
    g.fillStyle = rg;
    g.fillRect(-R2, -R2, R2 * 2, R2 * 2);
    g.restore();

    // Holzscheite und Steine
    const L = phone ? 48 : 66;
    const T = phone ? 8 : 11;
    const wood = dark ? mix(p.s4, [60, 28, 14], 0.6) : mix(p.s4, p.s2, 0.25);
    g.lineCap = 'round';
    for (const a of [-0.32, 0.3, 0.02]) {
      g.save();
      g.translate(lx, ly - T * 0.9 - (a === 0.02 ? T * 0.4 : 0));
      g.rotate(a);
      g.fillStyle = rgba(wood, 1);
      g.beginPath();
      g.roundRect(-L / 2, -T / 2, L, T, T / 2);
      g.fill();
      g.strokeStyle = rgba(p.c, dark ? 0.7 : 0.5);
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-L / 2 + T * 0.6, -T / 2 + 0.6);
      g.lineTo(L / 2 - T * 0.6, -T / 2 + 0.6);
      g.stroke();
      g.restore();
    }
    g.fillStyle = rgba(dark ? mix(p.s4, [90, 70, 60], 0.35) : mix(p.s4, p.s2, 0.45), 1);
    for (let i = 0; i < 7; i++) {
      const u = (i / 6) * 2 - 1;
      g.beginPath();
      g.ellipse(lx + u * L * 0.72, ly - 3 - (1 - u * u) * 2, T * 0.72, T * 0.45, 0, 0, TAU);
      g.fill();
    }

    // alles zusammen in ein Bild: Sterne (ruhig), darüber die Landschaft
    base = kit.layer(W, H);
    const b = base.g;
    b.fillStyle = STAR;
    for (let i = 0; i < nst; i++) {
      const j = i * 3;
      b.globalAlpha = (0.3 + 0.4 * hash(i * 3.17)) * k;
      b.fillRect(ST[j], ST[j + 1], ST[j + 2], ST[j + 2]);
    }
    b.globalAlpha = 1;
    b.drawImage(land.c, 0, landY, W, hb);
  }

  return {
    resize() {
      const { W, H } = kit;
      ctx = kit.ctx;
      sw = kit.sideW();
      cw = W - sw;
      const phone = W <= 760;
      fx = sw + cw * (phone ? 0.5 : 0.7);
      fy = H - (phone ? 10 : 16);
      FS = phone ? 36 : 54;
      FH = phone ? 64 : 100;
      // pulsierende Wärme nur rund ums Feuer (der weite Schein liegt ruhend im Gesamtbild)
      RX = phone ? 92 : 210;
      RY = phone ? 74 : 150;
      seat();
      paint();
      tc = Math.ceil(W / TS);
      tr = Math.ceil(H / TS);
      tiles = new Uint8Array(tc * tr);
      full = true;
    },

    frame(t, dt) {
      const { dpr } = kit;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (!dt || full) {
        // ganzes Bild (Standbild, nach Größenänderung)
        ctx.clearRect(0, 0, base.c.width, base.c.height);
        ctx.drawImage(base.c, 0, 0);
        tiles.fill(0);
        full = false;
      } else restoreTiles();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Flackern der Glut und böiger Wind (beides gilt für alle Funken)
      const flick = 0.62 + 0.16 * Math.sin(t * 1.7) + 0.12 * Math.sin(t * 5.3 + 1.3) + 0.08 * Math.sin(t * 11.9 + 0.4);
      const wind = Math.sin(t * 0.11) * 0.6 + Math.sin(t * 0.27 + 2) * 0.4;

      ctx.globalCompositeOperation = ADD;
      // ein paar hellere Sterne funkeln
      for (let i = 0; i < nst; i += 11) {
        const j = i * 3;
        ctx.globalAlpha = (0.3 + 0.3 * Math.sin(t * (0.9 + (i % 5) * 0.21) + i)) * k;
        ctx.drawImage(starGlow, ST[j] - 6, ST[j + 1] - 6, 13, 13);
        mark(7, ST[j] + 0.5, ST[j + 1] + 0.5);
      }

      // pulsierende Wärme am Boden
      ctx.globalAlpha = (dark ? 0.5 : 0.4) * flick * k;
      ctx.drawImage(heat, fx - RX, fy - RY, RX * 2, RY * 2);
      dirty(fx - RX, fy - RY, fx + RX, fy + RY);
      dirty(fx - FS * 1.4, fy - FS * 0.8 - FH * 1.1, fx + FS * 1.4, fy + 4);

      // Flammen: viele weiche Lichtpunkte, die schnell aufsteigen und dabei abkühlen
      for (let i = 0; i < nfl; i++) {
        const j = i * 4;
        const u = frac(t * FL[j + 1] + FL[j + 2]);
        const s = FS * FL[j + 3] * (1 - 0.72 * u);
        const x = fx + FL[j] * FS * 0.42 * (1 - u) + Math.sin(t * 7.3 + FL[j + 2] * 11) * FS * 0.12 * u + wind * u * FH * 0.18;
        const y = fy - FS * 0.32 - u * FH * (0.75 + 0.25 * FL[j + 3]);
        ctx.globalAlpha = Math.min(1, u * 8) * (1 - u) * (dark ? 0.85 : 0.32) * k;
        ctx.drawImage(flame[u < 0.28 ? 0 : u < 0.6 ? 1 : 2], x - s / 2, y - s * 0.7, s, s * 1.4);
      }
      // Glutbett
      ctx.globalAlpha = (dark ? 0.75 : 0.35) * (0.7 + 0.3 * flick) * k;
      ctx.drawImage(flame[2], fx - FS * 1.3, fy - FS * 0.75, FS * 2.6, FS * 0.9);

      // Funken und Glut
      for (let i = 0; i < nsp; i++) {
        const j = i * SS;
        const q = t * SP[j + 3] + SP[j + 4];
        const cyc = Math.floor(q);
        const u = q - cyc;
        const hs = hash(cyc * 7.13 + i * 1.37);
        const kind = SP[j + 11];
        let x0 = SP[j] + (hs - 0.5) * SP[j + 12];
        if (kind) x0 = sw + frac((x0 - sw) / cw) * cw;
        const lean = SP[j + 8] + (hash(cyc * 3.7 + i) - 0.5) * 0.18;
        at(j, u, t, x0, lean, wind, hs);
        const x = OX;
        const y = OY;
        let a = Math.min(1, u * 10) * (1 - u) ** 1.3 * (0.62 + 0.38 * Math.sin(t * SP[j + 10] + SP[j + 4] * 40)) * k;
        if (x < sw + 50) a *= clamp((x - sw) / 50, 0, 1);
        if (a < 0.02) continue;
        if (kind === 2) {
          const s = SP[j + 9];
          ctx.globalAlpha = a * (dark ? 0.2 : 0.22);
          ctx.drawImage(bokeh, x - s / 2, y - s / 2, s, s);
          mark(s / 2 + 1, x, y);
          continue;
        }
        const s = SP[j + 9] * (1 - 0.55 * u);
        const spr = spark[kind ? (u < 0.5 ? 1 : 2) : u < 0.3 ? 0 : u < 0.65 ? 1 : 2];
        ctx.globalAlpha = a * (kind ? (dark ? 0.75 : 0.55) : dark ? 1 : 0.72);
        if (kind === 0 && u > 0.03) {
          // kleiner Schweif entlang der Flugbahn
          at(j, u - 0.05 * SP[j + 3], t - 0.05, x0, lean, wind, hs);
          const dx = x - OX;
          const dy = y - OY;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.6) {
            const ux = dx / len;
            const uy = dy / len;
            const lg = s + len * 1.6;
            ctx.setTransform(dpr * ux * lg, dpr * uy * lg, -dpr * uy * s, dpr * ux * s, dpr * x, dpr * y);
            ctx.drawImage(spr, -0.72, -0.5, 1, 1);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            // enger Rahmen um den Schweif (Kopf bei 0.28, Ende bei -0.72 der Länge)
            const ax = ux * lg;
            const ay = uy * lg;
            const pad = s * 0.5 + 1;
            dirty(Math.min(x - ax * 0.72, x + ax * 0.28) - pad, Math.min(y - ay * 0.72, y + ay * 0.28) - pad, Math.max(x - ax * 0.72, x + ax * 0.28) + pad, Math.max(y - ay * 0.72, y + ay * 0.28) + pad);
            continue;
          }
        }
        ctx.drawImage(spr, x - s / 2, y - s / 2, s, s);
        mark(s / 2 + 1, x, y);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

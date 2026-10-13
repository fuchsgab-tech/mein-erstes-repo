// Stil „Lavalampe“ – 70er-Lavalampe: warmes Wachs steigt auf, dehnt sich, verschmilzt und reißt wieder ab.
// Hell: cremige Pastell-Lampe in Pfirsich, Rosa und Flieder.
// skin: Eintrag für die Stil-Auswahl (Vorschau-Farben je Hell/Dunkel).
// scene(p, kit): bewegter Hintergrund (siehe js/bgfx.js).
// Technik: Metaball-Feld auf grobem Raster (1/4 bzw. 1/5 der CSS-Auflösung), Farbe aus einer Tabelle,
// dann weich hochskaliert – kein Rechnen pro Bildschirmpixel, kein CSS-Filter.

// Vorschau: Blasen mit hellem Kern, unten ein Wachsbecken
const BLOB = ([x, y, w, h], [core, body, rim]) =>
  `radial-gradient(${w}% ${h}% at ${x}% ${y}%, ${core} 0, ${body} 42%, ${rim} 64%, transparent 72%)`;
const SHAPES = [[30, 28, 15, 19], [70, 46, 19, 23], [40, 66, 12, 14], [56, 104, 62, 26]];
const PREVIEW = (cols, bg) => `${SHAPES.map((s, i) => BLOB(s, cols[i])).join(', ')}, ${bg}`;

export const skin = {
  id: 'lava', name: 'Lavalampe', desc: 'Live · Wabernde Blasen', live: true,
  light: {
    bg: PREVIEW(
      [['#fff4ea', '#d9c2ff', '#c3a2ff'], ['#fff2ec', '#ffb3cf', '#f590b8'], ['#fff6ee', '#ffc6a8', '#ffab85'], ['#fff3e8', '#ffbd98', '#ffa47c']],
      'linear-gradient(180deg, #f8ecff, #fff0ec 50%, #ffe3d2), #fff1e6',
    ),
    surface: 'rgba(255,250,246,.82)', accent: '#b83a5e', text: '#3a1424',
  },
  dark: {
    bg: PREVIEW(
      [['#ffd9ff', '#a34dff', '#6a1fb8'], ['#ffd0e2', '#ff3d8e', '#a3125a'], ['#fff0a8', '#ff7a3d', '#c2341a'], ['#ffe08a', '#ff6a2b', '#b8301a']],
      'radial-gradient(70% 34% at 50% 108%, rgba(255,90,40,.5), transparent 70%), linear-gradient(180deg, #24093a, #150822 55%, #2a0c14), #150822',
    ),
    surface: 'rgba(28,12,36,.74)', accent: '#ff7a3d', text: '#ffeede', glow: true,
  },
};

// ---------- Szene ----------

const T = 0.42; // Schwelle = Rand einer Blase: Kern (1 - d²/R²)³ mit R = 2r ergibt bei d = r genau 0,42
const FMAX = 1.5; // höchster Feldwert in der Farbtabelle
const NH = 16; // Farbstufen: heiß (unten) → kühl (oben)
const NL = 256; // Feldstufen
const MF = 10; // freie Blasen höchstens
const MP = 5; // Wachsbecken am Grund höchstens
const MB = MF * 2 + MP;

export function scene(p, kit) {
  const { clamp, mix, TAU } = kit;
  const dark = p.dark;
  const k = p.k;

  // Farbtabelle: Feldstärke × Farbstufe → RGBA (Uint32, little-endian)
  const LUT = new Uint32Array(NH * NL);
  const ss = (a, b, x) => {
    const u = clamp((x - a) / (b - a), 0, 1);
    return u * u * (3 - 2 * u);
  };
  for (let hi = 0; hi < NH; hi++) {
    const h = hi / (NH - 1);
    const body = h < 0.5 ? mix(p.b, p.c, h * 2) : mix(p.c, p.d, (h - 0.5) * 2);
    const deep = dark ? mix(body, p.s4, 0.14) : mix(body, p.s1, 0.26);
    const core = mix(body, p.a, dark ? 0.9 : 0.85);
    const halo = dark ? mix(body, p.s1, 0.25) : body;
    for (let l = 0; l < NL; l++) {
      const f = (l / (NL - 1)) * FMAX;
      const e = ss(T - 0.05, T + 0.05, f); // Kante: über gut eine Rasterzelle verlaufen lassen, sonst Treppen
      const s = clamp((f - T - 0.03) / (1.3 - T), 0, 1); // 0 am Rand, wächst zur Mitte: inneres Leuchten
      const c = s < 0.18 ? mix(deep, body, s / 0.18) : mix(body, core, ((s - 0.18) / 0.82) ** 1.7);
      const col = mix(halo, c, e);
      const glowA = (dark ? 0.17 : 0.1) * ss(0.015, T, f) ** 2.2;
      const a = (glowA * (1 - e) + (dark ? 0.9 : 0.8) * e) * k;
      LUT[hi * NL + l] = ((Math.round(clamp(a, 0, 1) * 255) << 24) | (col[2] << 16) | (col[1] << 8) | col[0]) >>> 0;
    }
  }

  // freie Blasen: x (Anteil), x-Ausschlag, x-Takt, x-Phase, Periode, Phase, oben, unten, Radius, Farbversatz
  const FREE = new Float32Array(MF * 10);
  let nf = 0;
  // Wachsbecken am Grund: x (Anteil), Radius, Phase, Breite
  const POOL = new Float32Array(MP * 4);
  let np = 0;
  // pro Bild: Lage aller Blasen
  const BX = new Float32Array(MB);
  const BY = new Float32Array(MB);
  const BR = new Float32Array(MB);
  const SX = new Float32Array(MB);
  const SY = new Float32Array(MB);
  const BH = new Float32Array(MB);
  let nb = 0;

  let ctx = null;
  let sw = 0;
  let cw = 0;
  let cell = 8;
  let gx0 = 0;
  let gw = 0;
  let gh = 0;
  let F = null;
  let HU = null;
  let px = null;
  let img = null;
  let field = null;
  let bloom = null;
  // zur Seitenleiste und zur Kopfzeile hin löst sich das Wachs weich auf (dort bleibt es ruhig)
  const FADE = new Float32Array(64);
  let nfade = 0;
  const TOPF = new Float32Array(64);
  let ntop = 0;

  function seat(rnd) {
    const { H } = kit;
    const unit = Math.sqrt(cw * H);
    nf = clamp(Math.round((cw * H) / 105000), 5, MF);
    const order = [];
    for (let i = 0; i < nf; i++) order.push(i);
    for (let i = nf - 1; i > 0; i--) {
      const j = Math.floor(rnd(0, i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < nf; i++) {
      const j = i * 10;
      FREE[j] = (order[i] + rnd(0.25, 0.75)) / nf;
      FREE[j + 1] = rnd(0.025, 0.07);
      FREE[j + 2] = rnd(0.05, 0.11);
      FREE[j + 3] = rnd(0, TAU);
      FREE[j + 4] = rnd(48, 84);
      FREE[j + 5] = (i * 0.618 + rnd(-0.06, 0.06)) % 1;
      FREE[j + 6] = rnd(0, 0.3);
      FREE[j + 7] = rnd(0.74, 1.08);
      FREE[j + 8] = unit * rnd(0.055, 0.088) * (cw < 500 ? 1.1 : 1);
      FREE[j + 9] = rnd(-0.1, 0.32);
    }
    np = clamp(Math.ceil(cw / 300), 2, MP);
    for (let i = 0; i < np; i++) {
      const j = i * 4;
      POOL[j] = (i + 0.5) / np + rnd(-0.06, 0.06);
      POOL[j + 1] = unit * rnd(0.08, 0.1) * (cw < 500 ? 1.2 : 1);
      POOL[j + 2] = rnd(0, TAU);
      POOL[j + 3] = rnd(1.6, 2.1);
    }
  }

  // Lage aller Blasen zur Zeit t (geschlossene Form: Standbild und Bewegung passen zusammen)
  function place(t) {
    const { H } = kit;
    nb = 0;
    for (let i = 0; i < np; i++) {
      const j = i * 4;
      const r = POOL[j + 1];
      const ph = POOL[j + 2];
      const breathe = Math.sin(t * 0.21 + ph);
      BX[nb] = sw + cw * POOL[j] + Math.sin(t * 0.06 + ph * 2) * cw * 0.035;
      BY[nb] = H + r * (0.42 - 0.2 * breathe);
      BR[nb] = r * (1 + 0.05 * Math.sin(t * 0.33 + ph * 3));
      SX[nb] = POOL[j + 3] * (1 + 0.08 * breathe);
      SY[nb] = 0.78 - 0.05 * breathe;
      BH[nb] = 0.04;
      nb++;
    }
    for (let i = 0; i < nf; i++) {
      const j = i * 10;
      const r0 = FREE[j + 8];
      const u = t / FREE[j + 4] + FREE[j + 5];
      const lift = 0.5 - 0.5 * Math.cos(TAU * u); // 0 unten, 1 oben
      const v = Math.sin(TAU * u); // > 0 steigt, < 0 sinkt
      const av = Math.abs(v);
      const yb = FREE[j + 7] * H;
      const y = yb + (FREE[j + 6] * H - yb) * lift;
      const x = sw + cw * clamp(FREE[j] + Math.sin(t * FREE[j + 2] + FREE[j + 3]) * FREE[j + 1], 0.04, 0.96);
      const r = r0 * (1 + 0.06 * Math.sin(t * 0.7 + FREE[j + 3] * 3));
      const hue = clamp((0.98 - y / H) * 0.9 + FREE[j + 9], 0, 1);
      // Hauptblase: in Bewegungsrichtung gestreckt
      const st = 1 + 0.32 * av;
      BX[nb] = x;
      BY[nb] = y;
      BR[nb] = r;
      SX[nb] = 1 / Math.sqrt(st);
      SY[nb] = st;
      BH[nb] = hue;
      nb++;
      // Tropfen dahinter: bei hohem Tempo reißt er ab, beim Abbremsen fließt er wieder zurück
      BX[nb] = x + r * 0.28 * Math.sin(t * 0.5 + FREE[j + 3]);
      BY[nb] = y + Math.sign(v) * r * (0.7 + 1.45 * av);
      BR[nb] = r * (0.6 - 0.1 * av);
      SX[nb] = 0.92;
      SY[nb] = 1 + 0.25 * av;
      BH[nb] = clamp(hue - 0.06 * Math.sign(v), 0, 1);
      nb++;
    }
  }

  // Feld auf dem groben Raster aufsummieren und einfärben
  function splat() {
    F.fill(0);
    HU.fill(0);
    for (let b = 0; b < nb; b++) {
      const R = BR[b] * 2;
      const rx = R * SX[b];
      const ry = R * SY[b];
      const x = BX[b] - gx0;
      const y = BY[b];
      const i0 = Math.max(0, Math.ceil((x - rx) / cell));
      const i1 = Math.min(gw - 1, Math.floor((x + rx) / cell));
      const j0 = Math.max(0, Math.ceil((y - ry) / cell));
      const j1 = Math.min(gh - 1, Math.floor((y + ry) / cell));
      if (i0 > i1 || j0 > j1) continue;
      const ix = 1 / (rx * rx);
      const iy = 1 / (ry * ry);
      const h = BH[b];
      for (let j = j0; j <= j1; j++) {
        const dy = j * cell - y;
        const qy = dy * dy * iy;
        if (qy >= 1) continue;
        const row = j * gw;
        for (let i = i0; i <= i1; i++) {
          const dx = i * cell - x;
          const q = qy + dx * dx * ix;
          if (q < 1) {
            const w0 = 1 - q;
            const w = w0 * w0 * w0;
            F[row + i] += w;
            HU[row + i] += w * h;
          }
        }
      }
    }
    const ls = (NL - 1) / FMAX;
    const hs = NH - 1;
    for (let j = 0, c = 0; j < gh; j++) {
      const fy = j < ntop ? TOPF[j] : 1;
      for (let i = 0; i < gw; i++, c++) {
        const f0 = F[c];
        const f = i < nfade ? f0 * fy * FADE[i] : f0 * fy;
        if (f < 0.012) {
          px[c] = 0;
          continue;
        }
        const l = f >= FMAX ? NL - 1 : (f * ls) | 0;
        const hh = ((HU[c] / f0) * hs + 0.5) | 0;
        px[c] = LUT[hh * NL + l];
      }
    }
  }

  return {
    resize() {
      const { W, H } = kit;
      ctx = kit.ctx;
      sw = kit.sideW();
      cw = W - sw;
      cell = W > 760 ? 5 : 4;
      gx0 = Math.max(0, sw - 12);
      gw = Math.ceil((W - gx0) / cell) + 2;
      gh = Math.ceil(H / cell) + 2;
      F = new Float32Array(gw * gh);
      HU = new Float32Array(gw * gh);
      field = kit.layer(gw, gh, false);
      img = field.g.createImageData(gw, gh);
      px = new Uint32Array(img.data.buffer);
      nfade = gx0 > 0 ? Math.min(FADE.length, Math.ceil(56 / cell)) : 0;
      for (let i = 0; i < nfade; i++) FADE[i] = ss(0, 1, i / nfade) ** 1.5;
      ntop = Math.min(TOPF.length, Math.ceil((W > 760 ? 96 : 78) / cell));
      for (let j = 0; j < ntop; j++) TOPF[j] = ss(0.25, 1, j / ntop) ** 1.3;
      bloom = dark ? kit.layer(Math.ceil(gw / 4), Math.ceil(gh / 4), false) : null;
      seat(kit.seeded(7070 + (W > 760 ? 0 : 1)));
    },

    frame(t) {
      const { W, H, dpr } = kit;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      place(t);
      splat();
      field.g.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      const ox = gx0 - cell / 2;
      const oy = -cell / 2;
      ctx.drawImage(field.c, ox, oy, gw * cell, gh * cell);
      // dunkel: weicher Lichtschein aus einer viertel so großen Kopie
      if (bloom) {
        const bw = bloom.c.width;
        const bh = bloom.c.height;
        bloom.g.clearRect(0, 0, bw, bh);
        bloom.g.drawImage(field.c, 0, 0, gw / 4, gh / 4);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18 * k;
        ctx.drawImage(bloom.c, ox, oy, bw * cell * 4, bh * cell * 4);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    },
  };
}

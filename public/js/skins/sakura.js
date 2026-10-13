// Stil „Sakura“ – japanischer Frühling: fallende Kirschblüten, rote Sonne, Tuschberge und ein blühender Zweig.
// Dunkel: „Yozakura“ – Kirschblüten bei Nacht mit Mond und leuchtenden Papierlaternen.
// skin: Eintrag für die Stil-Auswahl (Vorschau-Farben je Hell/Dunkel).
// scene(p, kit): bewegter Hintergrund (siehe js/bgfx.js).

// Vorschau: ein paar Blütenblätter als Punkte
const dots = (col, list) => list.map(([x, y, s]) => `radial-gradient(circle at ${x}% ${y}%, ${col} 0 ${s}%, transparent ${s + 0.6}%)`).join(', ');
const PETALS = [[14, 22, 2.4], [30, 60, 1.8], [46, 30, 2], [58, 74, 2.6], [84, 56, 1.8], [92, 18, 2.2], [22, 84, 2]];

export const skin = {
  id: 'sakura', name: 'Sakura', desc: 'Live · Kirschblüten', live: true,
  light: {
    bg: `${dots('#ef9bb6', PETALS)}, radial-gradient(circle at 68% 36%, #ee6a45 0 16%, rgba(238,106,69,.2) 17% 24%, transparent 25%), radial-gradient(70% 30% at 24% 100%, rgba(61,51,64,.3) 0 70%, transparent 71%), radial-gradient(70% 22% at 86% 100%, rgba(61,51,64,.2) 0 70%, transparent 71%), linear-gradient(180deg, #fbf3ea, #f4e0da)`,
    surface: '#fffaf3', accent: '#c4381f', text: '#2b1d1a',
  },
  dark: {
    bg: `${dots('#ffc4d6', PETALS)}, radial-gradient(circle at 72% 30%, #fff2d6 0 9%, rgba(255,242,214,.22) 10% 19%, transparent 20%), radial-gradient(circle at 40% 46%, #ffb067 0 3.5%, rgba(255,140,60,.35) 4% 9%, transparent 10%), radial-gradient(70% 30% at 24% 100%, #07081c 0 70%, transparent 71%), linear-gradient(180deg, #0a0c26, #2a1a4c)`,
    surface: '#17173d', accent: '#ff9fc0', text: '#fbeef2', glow: true,
  },
};

// ---------- Vorlagen ----------

// Ein Kirschblütenblatt (Spitze mit Kerbe oben, Ansatz unten) im Quadrat 0…64
function petalPath(g) {
  g.beginPath();
  g.moveTo(32, 61);
  g.bezierCurveTo(9, 47, 6, 18, 21, 7);
  g.quadraticCurveTo(28, 3, 32, 12);
  g.quadraticCurveTo(36, 3, 43, 7);
  g.bezierCurveTo(58, 18, 55, 47, 32, 61);
  g.closePath();
}

function petalSprite(kit, light, deep, back) {
  const { c, g } = kit.layer(64, 64, false);
  petalPath(g);
  const grd = g.createLinearGradient(32, 61, 32, 4);
  grd.addColorStop(0, kit.rgba(deep, 1));
  grd.addColorStop(0.45, kit.rgba(kit.mix(deep, light, back ? 0.55 : 0.75), 1));
  grd.addColorStop(1, kit.rgba(kit.mix(light, [255, 255, 255], back ? 0 : 0.45), 1));
  g.fillStyle = grd;
  g.fill();
  // feine Ader
  g.strokeStyle = kit.rgba(deep, 0.35);
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(32, 58);
  g.quadraticCurveTo(30, 34, 32, 16);
  g.stroke();
  return c;
}

// Fünfblättrige Blüte mit Staubfäden
function blossomSprite(kit, light, deep, heart, gold) {
  const S = 96;
  const { c, g } = kit.layer(S, S, false);
  g.translate(S / 2, S / 2);
  for (let i = 0; i < 5; i++) {
    g.save();
    g.rotate((i / 5) * kit.TAU);
    g.translate(-32 * 0.68, -64 * 0.68);
    g.scale(0.68, 0.68);
    petalPath(g);
    const grd = g.createLinearGradient(32, 61, 32, 4);
    grd.addColorStop(0, kit.rgba(deep, 1));
    grd.addColorStop(0.5, kit.rgba(kit.mix(deep, light, 0.7), 1));
    grd.addColorStop(1, kit.rgba(kit.mix(light, [255, 255, 255], 0.4), 1));
    g.fillStyle = grd;
    g.fill();
    g.restore();
  }
  g.fillStyle = kit.rgba(heart, 0.9);
  g.beginPath();
  g.arc(0, 0, 7, 0, kit.TAU);
  g.fill();
  g.strokeStyle = kit.rgba(heart, 0.8);
  g.fillStyle = kit.rgba(gold, 1);
  g.lineWidth = 1.4;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * kit.TAU + 0.2;
    const r = 13 + (i % 3) * 2;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    g.stroke();
    g.beginPath();
    g.arc(Math.cos(a) * r, Math.sin(a) * r, 2.2, 0, kit.TAU);
    g.fill();
  }
  return c;
}

// Papierlaterne (Chōchin), Aufhängung oben in der Mitte
function lanternSprite(kit, glowCol) {
  const w = 40;
  const hh = 58;
  const { c, g } = kit.layer(w, hh);
  const cx = w / 2;
  const cy = 30;
  const rx = 15;
  const ry = 20;
  const body = g.createRadialGradient(cx - 3, cy - 4, 2, cx, cy, ry * 1.1);
  body.addColorStop(0, '#fff1c9');
  body.addColorStop(0.35, kit.rgba(kit.mix(glowCol, [255, 230, 170], 0.45), 1));
  body.addColorStop(0.8, kit.rgba(glowCol, 1));
  body.addColorStop(1, '#b8321c');
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, kit.TAU);
  g.fill();
  // Rippen
  g.strokeStyle = 'rgba(140, 40, 15, 0.38)';
  g.lineWidth = 0.9;
  for (let j = -2; j <= 2; j++) {
    const y = cy + j * 6.5;
    const hw = rx * Math.sqrt(Math.max(0, 1 - ((j * 6.5) / ry) ** 2));
    g.beginPath();
    g.moveTo(cx - hw, y);
    g.quadraticCurveTo(cx, y + 2.4, cx + hw, y);
    g.stroke();
  }
  // Deckel und Quaste
  g.fillStyle = '#21110d';
  g.fillRect(cx - 7, cy - ry - 2.5, 14, 4);
  g.fillRect(cx - 7, cy + ry - 1.5, 14, 4);
  g.strokeStyle = '#c2321c';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(cx, cy + ry + 2.5);
  g.lineTo(cx, cy + ry + 7.5);
  g.stroke();
  return { c, w, h: hh, top: cy - ry - 2.5 };
}

// Weicher Pinselstrich für Windböen
function streakSprite(kit, col) {
  const { c, g } = kit.layer(320, 40, false);
  const grd = g.createLinearGradient(0, 0, 320, 0);
  grd.addColorStop(0, kit.rgba(col, 0));
  grd.addColorStop(0.55, kit.rgba(col, 0.9));
  grd.addColorStop(1, kit.rgba(col, 0));
  g.strokeStyle = grd;
  g.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    g.lineWidth = i ? 1.2 : 2.2;
    g.beginPath();
    g.moveTo(4, 28 - i * 9);
    g.bezierCurveTo(90, 8 - i * 4, 210, 34 - i * 6, 316, 14 - i * 5);
    g.stroke();
  }
  return c;
}

// weiches Rauschen aus Stützpunkten (für die Bergkämme)
function noise(rnd, len, step) {
  const n = Math.ceil(len / step) + 2;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = rnd();
  return (x) => {
    const f = x / step;
    const i = Math.floor(f);
    const u = (1 - Math.cos((f - i) * Math.PI)) / 2;
    return v[i] * (1 - u) + v[i + 1] * u;
  };
}

// ---------- Szene ----------

export function scene(p, kit) {
  const { rgba, clamp, TAU } = kit;
  const k = p.k;
  const dark = p.dark;
  const ink = p.d;

  const PET = [petalSprite(kit, p.b, p.c, false), petalSprite(kit, p.b, p.c, true)];
  const BLOOM = blossomSprite(kit, p.b, p.c, p.s3, p.s4);
  const glint = kit.glow(dark ? [255, 236, 244] : p.b, 64, 0.25);
  const streak = streakSprite(kit, dark ? p.b : mixInk());
  const lamp = dark ? lanternSprite(kit, p.s4) : null;
  const lampGlow = dark ? kit.glow(p.s4, 128, 0.22) : null;

  function mixInk() { return kit.mix(ink, p.c, 0.35); }

  const MAX = 72;
  const X = new Float32Array(MAX);
  const Y = new Float32Array(MAX);
  const Z = new Float32Array(MAX);
  const VY = new Float32Array(MAX);
  const R = new Float32Array(MAX);
  const VR = new Float32Array(MAX);
  const F = new Float32Array(MAX);
  const VF = new Float32Array(MAX);
  const SW = new Float32Array(MAX);
  const T = new Uint8Array(MAX);
  let n = 0;
  let base = null;
  let lamps = [];
  let sw = 0;

  function spawn(i, rnd, y) {
    const z = rnd(0.45, 1);
    Z[i] = z;
    T[i] = rnd() < 0.2 ? 1 : 0;
    X[i] = rnd(-0.1, 1.05) * kit.W;
    Y[i] = y;
    VY[i] = rnd(16, 34) * (0.55 + z * 0.6);
    R[i] = rnd(0, TAU);
    VR[i] = rnd(-1.4, 1.4);
    F[i] = rnd(0, TAU);
    VF[i] = rnd(1.2, 3.2) * (T[i] ? 0.35 : 1);
    SW[i] = rnd(0, TAU);
  }

  // Ruhende Ebene: Sonne/Mond, Berge in Tusche, Zweig mit Blüten, Papierfasern/Sterne
  function paint() {
    const { W, H } = kit;
    const wide = W > 760;
    const rnd = kit.seeded(4111 + (wide ? 0 : 7));
    base = kit.layer(W, H);
    const g = base.g;
    const cw = W - sw;

    if (dark) {
      // Sterne
      const ns = Math.min(260, Math.round((W * H) / 7000));
      g.fillStyle = 'rgb(255, 244, 250)';
      for (let i = 0; i < ns; i++) {
        g.globalAlpha = rnd(0.12, 0.65) * k;
        const r = rnd() < 0.08 ? 1.3 : 0.7;
        g.beginPath();
        g.arc(rnd(0, W), rnd(0, H * 0.62) ** 1.06, r, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    } else {
      // Papierfasern
      const nf = Math.min(420, Math.round((W * H) / 3200));
      g.strokeStyle = rgba(ink, 1);
      g.lineWidth = 0.6;
      for (let i = 0; i < nf; i++) {
        const x = rnd(0, W);
        const y = rnd(0, H);
        const a = rnd(0, TAU);
        const l = rnd(6, 22);
        g.globalAlpha = rnd(0.025, 0.07);
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    // Sonne (hell) bzw. Mond (dunkel)
    const sx = sw + cw * (wide ? 0.66 : 0.6);
    const sy = H * (wide ? 0.33 : 0.27);
    const sr = Math.min(cw, H) * (wide ? 0.19 : 0.3) * (dark ? 0.62 : 1);
    const halo = g.createRadialGradient(sx, sy, sr * 0.8, sx, sy, sr * (dark ? 3.4 : 2));
    halo.addColorStop(0, rgba(p.s1, (dark ? 0.26 : 0.2) * k));
    halo.addColorStop(1, rgba(p.s1, 0));
    g.fillStyle = halo;
    g.fillRect(sx - sr * 3.5, sy - sr * 3.5, sr * 7, sr * 7);
    const disc = g.createRadialGradient(sx - sr * 0.25, sy - sr * 0.3, sr * 0.1, sx, sy, sr);
    disc.addColorStop(0, rgba(kit.mix(p.s1, [255, 255, 255], dark ? 0.6 : 0.18), (dark ? 1 : 0.8) * k));
    disc.addColorStop(1, rgba(p.s1, (dark ? 0.95 : 0.72) * k));
    g.fillStyle = disc;
    g.beginPath();
    g.arc(sx, sy, sr, 0, TAU);
    g.fill();
    if (dark) {
      // Mondflecken
      g.fillStyle = rgba(kit.mix(p.s1, [150, 140, 170], 0.5), 0.22);
      for (const [dx, dy, r] of [[-0.3, -0.15, 0.28], [0.22, 0.2, 0.2], [0.05, -0.4, 0.14], [0.38, -0.12, 0.1]]) {
        g.beginPath();
        g.arc(sx + dx * sr, sy + dy * sr, r * sr, 0, TAU);
        g.fill();
      }
    } else {
      // Tuschrand: ein paar weiche, leicht versetzte Ringe
      g.strokeStyle = rgba(p.s1, 0.12 * k);
      for (let i = 0; i < 3; i++) {
        g.lineWidth = 3 + i * 2;
        g.beginPath();
        g.arc(sx + rnd(-3, 3), sy + rnd(-3, 3), sr * (1.01 + i * 0.012), 0, TAU);
        g.stroke();
      }
    }

    // Berge in drei Schichten, unten im Nebel
    const AL = dark ? [0.5, 0.7, 0.92] : [0.11, 0.16, 0.24];
    const YB = [0.68, 0.77, 0.87];
    const AMP = wide ? [0.15, 0.11, 0.08] : [0.11, 0.08, 0.06];
    const fx = sw + cw * (wide ? 0.3 : 0.34);
    const fr = Math.min(cw * (wide ? 0.32 : 0.6), 460);
    const fh = H * (wide ? 0.25 : 0.17);
    for (let j = 0; j < 3; j++) {
      const n1 = noise(rnd, W, 380 - j * 60);
      const n2 = noise(rnd, W, 140 - j * 20);
      const n3 = noise(rnd, W, 46);
      const yb = H * YB[j];
      const amp = H * AMP[j];
      let top = H;
      const pts = [];
      for (let x = -10; x <= W + 10; x += 6) {
        const xx = Math.max(0, x);
        let hgt = amp * (n1(xx) * 0.7 + n2(xx) * 0.24 + n3(xx) * 0.06);
        // Fuji in der fernsten Schicht
        if (j === 0) {
          const d = Math.abs(x - fx) / fr;
          if (d < 1) hgt = Math.max(hgt, Math.min(fh * (1 - d) ** 1.7, fh * 0.94));
        }
        const y = yb - hgt;
        top = Math.min(top, y);
        pts.push(x, y);
      }
      const grd = g.createLinearGradient(0, top, 0, H);
      grd.addColorStop(0, rgba(ink, AL[j] * k));
      grd.addColorStop(0.5, rgba(ink, AL[j] * k * (dark ? 0.7 : 0.4)));
      grd.addColorStop(1, rgba(ink, AL[j] * k * (dark ? 0.45 : 0.12)));
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(-10, H);
      for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.lineTo(W + 10, H);
      g.closePath();
      g.fill();
      if (j === 0) {
        // Schneekappe
        g.save();
        g.clip();
        g.fillStyle = dark ? 'rgba(220, 215, 255, 0.2)' : 'rgba(255, 255, 255, 0.75)';
        const py = yb - fh * 0.94;
        g.beginPath();
        g.moveTo(fx - fr * 0.5, py - 4);
        const steps = 9;
        for (let i = 0; i <= steps; i++) {
          const xx = fx - fr * 0.32 + (fr * 0.64 * i) / steps;
          const yy = py + fh * (0.2 + (i % 2 ? 0.1 : 0) + Math.sin(i * 1.7) * 0.03);
          g.lineTo(xx, yy);
        }
        g.lineTo(fx + fr * 0.5, py - 4);
        g.closePath();
        g.fill();
        g.restore();
      }
      // Nebelband über dem Fuß der Schicht
      const mist = g.createLinearGradient(0, yb - amp * 0.4, 0, yb + H * 0.06);
      mist.addColorStop(0, rgba(p.s2, 0));
      mist.addColorStop(0.6, rgba(p.s2, dark ? 0.22 : 0.4));
      mist.addColorStop(1, rgba(p.s2, 0));
      g.fillStyle = mist;
      g.fillRect(0, yb - amp * 0.4, W, amp * 0.4 + H * 0.06);
    }

    // Zweig vom rechten Rand mit Blütenbüscheln
    const flowers = [];
    const hangs = [];
    const by = wide ? 96 : 78;
    const len = wide ? Math.min(cw * 0.52, 660) : W * 0.74;
    const bw = wide ? 13 : 8.5;
    g.lineCap = 'round';
    g.strokeStyle = rgba(dark ? ink : kit.mix(ink, [70, 40, 40], 0.3), dark ? 1 : 0.85 * k);
    const brnd = kit.seeded(808 + (wide ? 0 : 3));
    const limb = (x, y, a, l, w, depth) => {
      const nseg = Math.max(4, Math.round(l / 15));
      const step = l / nseg;
      const bend = brnd(-0.06, 0.06) - (depth ? 0.02 : 0.035);
      for (let i = 0; i < nseg; i++) {
        a += bend + brnd(-0.17, 0.17);
        const nx = x + Math.cos(a) * step;
        const ny = y + Math.sin(a) * step;
        const w2 = Math.max(0.7, w * (1 - ((i + 1) / nseg) * 0.72));
        g.lineWidth = (w + w2) / 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(nx, ny);
        g.stroke();
        if (depth < 3 && i > 0 && i < nseg - 1 && brnd() < (depth ? 0.3 : 0.45)) {
          const side = brnd() < 0.55 ? -1 : 1;
          limb(nx, ny, a + side * brnd(0.45, 0.95), l * brnd(0.28, 0.5), w2 * 0.7, depth + 1);
        }
        if (i > nseg * 0.2 && brnd() < 0.5) flowers.push([nx + brnd(-9, 9), ny + brnd(-9, 9), brnd(0.7, 1.05), brnd(0, TAU)]);
        if (!depth && i > nseg * 0.18 && i < nseg * 0.9) hangs.push([nx, ny + w2 * 0.4]);
        x = nx;
        y = ny;
        w = w2;
      }
      const m = Math.round(brnd(2, 4));
      for (let j = 0; j < m; j++) flowers.push([x + brnd(-11, 11), y + brnd(-11, 9), brnd(0.85, 1.2), brnd(0, TAU)]);
    };
    limb(W + 14, by, Math.PI - 0.08, len, bw, 0);
    limb(W + 14, by + (wide ? 70 : 46), Math.PI + 0.32, len * 0.45, bw * 0.6, 1);

    const fs = wide ? 24 : 18;
    if (dark) {
      // Blüten fangen das Laternenlicht
      g.globalCompositeOperation = 'lighter';
      for (const [x, y] of flowers) {
        g.globalAlpha = 0.16;
        g.drawImage(glint, x - fs * 1.4, y - fs * 1.4, fs * 2.8, fs * 2.8);
      }
      g.globalCompositeOperation = 'source-over';
    }
    for (const [x, y, s, a] of flowers) {
      g.save();
      g.globalAlpha = (dark ? 0.95 : 0.92) * Math.min(1, k + 0.1);
      g.translate(x, y);
      g.rotate(a);
      g.drawImage(BLOOM, (-fs * s) / 2, (-fs * s) / 2, fs * s, fs * s);
      g.restore();
    }
    g.globalAlpha = 1;

    // Laternen hängen am Zweig (nur nachts)
    lamps = [];
    if (dark) {
      const want = wide ? 3 : 2;
      const rl = kit.seeded(51);
      const cand = hangs.filter(([x]) => x > sw + 60 && x < W - 30).sort((a, b) => b[0] - a[0]);
      for (const hp of cand) {
        if (lamps.length >= want) break;
        if (lamps.some((l) => Math.abs(l.x - hp[0]) < (wide ? 120 : 80))) continue;
        lamps.push({ x: hp[0], y: hp[1], len: rl(wide ? 40 : 30, wide ? 120 : 80), ph: rl(0, TAU), s: wide ? rl(0.95, 1.2) : rl(0.75, 0.9) });
      }
    }

    // über der Seitenleiste nur halb so kräftig
    if (sw) {
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0, 0, 0, 0.5)';
      g.fillRect(0, 0, sw, H);
      g.globalCompositeOperation = 'source-over';
    }
  }

  // Wind: leichte Brise, alle 16 s eine Böe, die als Welle von links nach rechts durchzieht
  const CYCLE = 16;
  const GUST = 5.5;
  let front = -1e4;
  let env = 0;
  function wind(t) {
    const ph = (t % CYCLE) - 3;
    if (ph < 0 || ph > GUST) {
      env = 0;
      front = -1e4;
      return;
    }
    const u = ph / GUST;
    env = Math.sin(Math.PI * u) ** 2;
    front = -360 + u * (kit.W + 720);
  }

  return {
    resize() {
      const { W, H } = kit;
      sw = kit.sideW();
      paint();
      n = clamp(Math.round((W * H) / 15000), 18, MAX);
      const rnd = kit.seeded(2026);
      for (let i = 0; i < n; i++) spawn(i, rnd, rnd(-0.05, 1) * H);
    },

    frame(t, dt) {
      const { ctx, W, H, dpr } = kit;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base.c, 0, 0, W, H);
      wind(t);
      const sig = Math.max(220, W * 0.26);

      // Laternen: leises Pendeln und Flackern
      if (lamps.length) {
        for (const l of lamps) {
          const lw = lamp.w * l.s;
          const lh = lamp.h * l.s;
          const gust = env * Math.exp(-(((l.x - front) / sig) ** 2));
          const a = 0.05 * Math.sin(t * 0.8 + l.ph) + 0.16 * gust * Math.sin(t * 3 + l.ph);
          const c = Math.cos(a);
          const s = Math.sin(a);
          const fl = 0.82 + 0.1 * Math.sin(t * 2.3 + l.ph) + 0.06 * Math.sin(t * 7.3 + l.ph * 3);
          const L = l.len;
          const ly = L + (lamp.top + 20) * l.s;
          const gx = l.x - s * ly;
          const gy = l.y + c * ly;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.5 * fl * k;
          const gr = 150 * l.s;
          ctx.drawImage(lampGlow, gx - gr, gy - gr, gr * 2, gr * 2);
          ctx.globalCompositeOperation = 'source-over';
          ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * l.x, dpr * l.y);
          ctx.globalAlpha = 0.75 * k;
          ctx.strokeStyle = 'rgba(30, 18, 30, 1)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, L + lamp.top * l.s);
          ctx.stroke();
          ctx.globalAlpha = (0.85 + fl * 0.15) * k;
          ctx.drawImage(lamp.c, -lw / 2, L, lw, lh);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      }

      // Windspuren während der Böe
      if (env > 0.02) {
        ctx.globalCompositeOperation = p.blend;
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = env * (dark ? 0.22 : 0.16) * k * (1 - i * 0.2);
          const y = H * (0.18 + i * 0.27) + Math.sin(t * 0.7 + i * 2) * 30;
          ctx.drawImage(streak, front - 160 - i * 90, y, 320 + i * 60, 40);
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // Blütenblätter
      const still = !dt;
      const rnd = Math.random;
      for (let i = 0; i < n; i++) {
        const z = Z[i];
        if (!still) {
          const loc = env * Math.exp(-(((X[i] - front) / sig) ** 2));
          SW[i] += dt * (0.7 + z * 0.5);
          X[i] += (12 * z + Math.cos(SW[i]) * 16 * z + loc * 190 * z) * dt;
          Y[i] += (VY[i] * (1 - loc * 0.55) - loc * 16) * dt;
          R[i] += VR[i] * (1 + loc * 3) * dt;
          F[i] += VF[i] * (1 + loc * 1.5) * dt;
          if (Y[i] > H + 24) spawn(i, (a = 0, b = 1) => a + rnd() * (b - a), -20);
          else if (X[i] > W + 30) X[i] = -30;
          else if (X[i] < -40) X[i] = W + 30;
        }
        const x = X[i];
        const y = Y[i];
        const fc = Math.cos(F[i]);
        const fl = fc < 0 ? Math.min(-0.18, fc) : Math.max(0.18, fc);
        const sz = (T[i] ? 21 : 13) * (0.5 + z * 0.62);
        let a = (0.35 + z * 0.6) * k * (0.6 + 0.4 * Math.abs(fl));
        if (x < sw) a *= 0.4;
        const c = Math.cos(R[i]) * sz;
        const s = Math.sin(R[i]) * sz;
        ctx.setTransform(dpr * c, dpr * s, -dpr * s * fl, dpr * c * fl, dpr * x, dpr * y);
        ctx.globalAlpha = a;
        ctx.drawImage(T[i] ? BLOOM : PET[fc < 0 ? 1 : 0], -0.5, -0.5, 1, 1);
        // nachts blitzen die Blätter kurz auf, wenn sie zum Licht drehen
        if (dark && z > 0.7 && fc > 0.93 && x >= sw) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (fc - 0.93) * 6 * k;
          ctx.drawImage(glint, x - sz * 1.3, y - sz * 1.3, sz * 2.6, sz * 2.6);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
    },
  };
}

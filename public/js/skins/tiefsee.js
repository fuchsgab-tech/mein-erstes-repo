// Stil „Tiefsee“ – nachts in der Tiefsee: Lichtstrahlen von oben, leuchtende Quallen, Blasen und Meeresschnee.
// Hell: „Lagune“ – türkises Flachwasser mit tanzenden Lichtnetzen (Kaustik) und kleinen Fischschwärmen.
// skin: Eintrag für die Stil-Auswahl (Vorschau-Farben je Hell/Dunkel).
// scene(p, kit): bewegter Hintergrund (siehe js/bgfx.js).

// Vorschau: Strahlen, eine Qualle und ein paar Blasen
const RAYS_BG = (c) => `linear-gradient(104deg, transparent 18%, ${c} 24%, transparent 31%, transparent 44%, ${c} 49%, transparent 55%, transparent 66%, ${c} 70%, transparent 76%)`;
const BUBBLES = (c) => [[22, 70, 2.2], [26, 52, 1.5], [24, 34, 1.1], [84, 76, 1.8], [80, 58, 1.2]]
  .map(([x, y, s]) => `radial-gradient(circle at ${x}% ${y}%, ${c} 0 ${s}%, transparent ${s + 0.8}%)`).join(', ');

export const skin = {
  id: 'tiefsee', name: 'Tiefsee', desc: 'Live · Quallen & Lichtstrahlen', live: true,
  light: {
    bg: `${BUBBLES('rgba(255,255,255,.85)')}, radial-gradient(10% 6% at 58% 64%, rgba(11,79,99,.5) 0 60%, transparent 70%), radial-gradient(7% 4% at 72% 70%, rgba(11,79,99,.4) 0 60%, transparent 70%), ${RAYS_BG('rgba(255,255,240,.5)')}, linear-gradient(180deg, #d4f7f5, #8fe0e3 55%, #45c0cd), #c8f3f2`,
    surface: 'rgba(247,254,255,.8)', accent: '#0e7490', text: '#06303a',
  },
  dark: {
    bg: `${BUBBLES('rgba(170,240,255,.7)')}, radial-gradient(13% 9% at 64% 42%, rgba(210,255,252,.95), rgba(46,230,214,.55) 55%, transparent 74%), radial-gradient(7% 5% at 34% 66%, rgba(240,200,255,.9), rgba(176,124,255,.5) 55%, transparent 74%), ${RAYS_BG('rgba(120,220,255,.16)')}, linear-gradient(180deg, #0a3a5a, #04192e 50%, #01070e), #010a14`,
    surface: 'rgba(4,22,38,.66)', accent: '#2ee6d6', text: '#dffcff', glow: true,
  },
};

// ---------- Vorlagen ----------

// Lichtstrahl: oben schmal und hell, nach unten breiter und blasser
function raySprite(kit, col) {
  const w = 64;
  const h = 512;
  const strip = kit.layer(w, 1, false);
  const gr = strip.g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, kit.rgba(col, 0));
  gr.addColorStop(0.5, kit.rgba(col, 1));
  gr.addColorStop(1, kit.rgba(col, 0));
  strip.g.fillStyle = gr;
  strip.g.fillRect(0, 0, w, 1);
  const { c, g } = kit.layer(w, h, false);
  for (let y = 0; y < h; y += 2) {
    const f = y / h;
    const ww = w * (0.3 + 0.7 * f);
    g.globalAlpha = (1 - f) ** 1.5;
    g.drawImage(strip.c, (w - ww) / 2, y, ww, 2);
  }
  return c;
}

// Luftblase mit Glanzpunkt
function bubbleSprite(kit, col) {
  const { c, g } = kit.layer(32, 32, false);
  const fill = g.createRadialGradient(13, 12, 1, 16, 16, 15);
  fill.addColorStop(0, kit.rgba(col, 0.04));
  fill.addColorStop(0.75, kit.rgba(col, 0.14));
  fill.addColorStop(1, kit.rgba(col, 0.5));
  g.fillStyle = fill;
  g.beginPath();
  g.arc(16, 16, 14.5, 0, kit.TAU);
  g.fill();
  g.strokeStyle = kit.rgba(col, 0.75);
  g.lineWidth = 1.6;
  g.stroke();
  g.fillStyle = 'rgba(255, 255, 255, 0.95)';
  g.beginPath();
  g.ellipse(11, 10, 3.6, 2.4, -0.7, 0, kit.TAU);
  g.fill();
  return c;
}

// Quallenschirm (Mitte des Randes bei 72, 92), leuchtend mit Rand-Punkten
const BW = 144;
const BH = 120;
const BX = 72;
const BY = 92;
const BR = 52;
function bellSprite(kit, col) {
  const { rgba, mix, TAU } = kit;
  const { c, g } = kit.layer(BW, BH, false);
  const top = BY - 74;
  const dome = () => {
    g.beginPath();
    g.moveTo(BX - BR, BY);
    g.bezierCurveTo(BX - BR * 1.04, top + 26, BX - BR * 0.56, top, BX, top);
    g.bezierCurveTo(BX + BR * 0.56, top, BX + BR * 1.04, top + 26, BX + BR, BY);
  };
  // Körper
  dome();
  g.quadraticCurveTo(BX, BY - 18, BX - BR, BY);
  const body = g.createRadialGradient(BX, top + 26, 4, BX, top + 34, BR * 1.15);
  body.addColorStop(0, rgba(mix(col, [255, 255, 255], 0.55), 0.85));
  body.addColorStop(0.45, rgba(col, 0.5));
  body.addColorStop(1, rgba(col, 0.16));
  g.fillStyle = body;
  g.fill();
  // innere Muster (vier Bögen)
  g.strokeStyle = rgba(mix(col, [255, 255, 255], 0.55), 0.5);
  g.lineWidth = 2.2;
  for (let i = 0; i < 4; i++) {
    const x = BX + (i - 1.5) * 15;
    g.beginPath();
    g.ellipse(x, top + 40, 6.5, 10, (i - 1.5) * 0.35, 0, TAU);
    g.stroke();
  }
  // leuchtende Kante
  g.shadowColor = rgba(col, 1);
  g.shadowBlur = 10;
  g.strokeStyle = rgba(mix(col, [255, 255, 255], 0.3), 0.95);
  g.lineWidth = 2;
  dome();
  g.stroke();
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(BX - BR, BY);
  g.quadraticCurveTo(BX, BY - 18, BX + BR, BY);
  g.stroke();
  // Punkte am Rand
  g.fillStyle = 'rgba(255, 255, 255, 0.95)';
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const x = BX - BR + u * BR * 2;
    const y = BY - 18 * 2 * u * (1 - u) * 1;
    g.beginPath();
    g.arc(x, y, 1.7, 0, TAU);
    g.fill();
  }
  g.shadowBlur = 0;
  return c;
}

// Kaustik: kachelbares Lichtnetz (Kanten von Zellen), einmal per Pixel berechnet
function causticTile(kit, col) {
  const S = 160;
  const { c, g } = kit.layer(S, S, false);
  const rnd = kit.seeded(1907);
  const n = 17;
  const PX = new Float32Array(n);
  const PY = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    PX[i] = rnd(0, S);
    PY[i] = rnd(0, S);
  }
  const img = g.createImageData(S, S);
  const d = img.data;
  const half = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let f1 = 1e9;
      let f2 = 1e9;
      for (let i = 0; i < n; i++) {
        let dx = Math.abs(x - PX[i]);
        let dy = Math.abs(y - PY[i]);
        if (dx > half) dx = S - dx;
        if (dy > half) dy = S - dy;
        const q = dx * dx + dy * dy;
        if (q < f1) {
          f2 = f1;
          f1 = q;
        } else if (q < f2) f2 = q;
      }
      const v = Math.sqrt(f2) - Math.sqrt(f1);
      const b = Math.max(0, 1 - v / 7) ** 2.2;
      const o = (y * S + x) * 4;
      d[o] = col[0];
      d[o + 1] = col[1];
      d[o + 2] = col[2];
      d[o + 3] = Math.round(b * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// weiches Rauschen aus Stützpunkten (für Felsen am Grund)
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

// ---------- Szene ----------

export function scene(p, kit) {
  const { rgba, mix, clamp, TAU } = kit;
  const k = p.k;
  const dark = p.dark;

  const ray = raySprite(kit, p.a);
  const bubble = bubbleSprite(kit, p.s1);
  const JC = [p.b, p.c, p.d];
  const bells = dark ? JC.map((c) => bellSprite(kit, c)) : null;
  const halos = dark ? JC.map((c) => kit.glow(c, 128, 0.2)) : null;
  const JS = dark ? JC.map((c) => rgba(mix(c, [255, 255, 255], 0.15), 1)) : null;
  const caustic = dark ? null : causticTile(kit, p.b);
  const FISH = rgba(p.c, 1);
  const SNOW = rgba(p.s1, 1);

  let ctx = null;
  let pat = null;
  let bed = null;
  let bedY = 0;
  let sw = 0;
  let cw = 0;

  // Strahlen: x, Neigung, Breite, Länge, Phase, Tempo, Stärke
  const NR = 6;
  const RAY = new Float32Array(NR * 7);
  // Quallen: x, y, Größe, Farbe, Phase, Takt, Tiefe, Drift
  const MJ = 6;
  const JEL = new Float32Array(MJ * 8);
  let nj = 0;
  // Blasen: x0, y, Größe, Tempo, Phase
  const MB = 44;
  const BUB = new Float32Array(MB * 5);
  let nb = 0;
  const VENT = new Float32Array(3);
  // Meeresschnee: x, y, Größe, Phase, Tempo
  const MS = 160;
  const SN = new Float32Array(MS * 5);
  let ns = 0;
  // Fische (hell): x-Versatz, y-Versatz, Größe, Phase – plus Schwärme
  const MF = 12;
  const FI = new Float32Array(MF * 4);
  const SCH = [
    { x: 0, y: 0, v: 22, dir: -1, n: 8, first: 0, size: 1 },
    { x: 0, y: 0, v: 34, dir: 1, n: 3, first: 8, size: 1.7 },
  ];
  let seeded = false;

  function seat(rnd) {
    const { W, H } = kit;
    const area = cw * H;
    nj = dark ? (W > 760 ? 6 : 4) : 0;
    for (let i = 0; i < nj; i++) {
      const j = i * 8;
      const z = rnd(0.45, 1);
      JEL[j] = sw + cw * ((i + rnd(0.15, 0.85)) / nj);
      JEL[j + 1] = rnd(0.08, 0.95) * H;
      JEL[j + 2] = (W > 760 ? 30 : 22) * (0.55 + z * 0.6);
      JEL[j + 3] = i % 3;
      JEL[j + 4] = rnd(0, TAU);
      JEL[j + 5] = rnd(0.45, 0.75);
      JEL[j + 6] = z;
      JEL[j + 7] = rnd(0, TAU);
    }
    nb = clamp(Math.round(area / (dark ? 22000 : 26000)), 12, MB);
    for (let i = 0; i < 3; i++) VENT[i] = sw + cw * (0.12 + 0.38 * i + rnd(-0.06, 0.06));
    for (let i = 0; i < nb; i++) bubbleAt(i, rnd, rnd(0, H));
    ns = dark ? clamp(Math.round(area / 7000), 40, MS) : clamp(Math.round(area / 16000), 16, 60);
    for (let i = 0; i < ns; i++) {
      const j = i * 5;
      SN[j] = rnd(0, W);
      SN[j + 1] = rnd(0, H);
      SN[j + 2] = rnd() < 0.85 ? 1.2 : 2;
      SN[j + 3] = rnd(0, TAU);
      SN[j + 4] = rnd(3, 11);
    }
    if (!dark) {
      for (let i = 0; i < MF; i++) {
        const j = i * 4;
        const lone = i >= 8;
        FI[j] = lone ? (i - 8) * rnd(60, 110) : rnd(-70, 70);
        FI[j + 1] = lone ? rnd(-90, 90) : rnd(-28, 28);
        FI[j + 2] = lone ? rnd(9, 13) : rnd(5, 8);
        FI[j + 3] = rnd(0, TAU);
      }
      for (const s of SCH) schoolAt(s, rnd, rnd(0.1, 0.9));
    }
  }

  function bubbleAt(i, rnd, y) {
    const j = i * 5;
    const inVent = rnd() < 0.6;
    BUB[j] = inVent ? VENT[i % 3] + rnd(-14, 14) : kit.sideW() + rnd(0, cw);
    BUB[j + 1] = y;
    BUB[j + 2] = rnd() < 0.8 ? rnd(2.5, 5.5) : rnd(6, 10);
    BUB[j + 3] = rnd(22, 46) + BUB[j + 2] * 3;
    BUB[j + 4] = rnd(0, TAU);
  }

  function schoolAt(s, rnd, f) {
    s.x = sw + cw * f;
    s.y = kit.H * rnd(0.22, 0.72);
  }

  // Ruhende Ebene: Felsen am Grund (dunkel mit Leuchtpunkten, hell als Sand mit Seegras)
  function paint(rnd) {
    const { W, H } = kit;
    const hb = Math.min(220, H * 0.26);
    bedY = H - hb;
    bed = kit.layer(W, hb);
    const g = bed.g;
    const n1 = noise(rnd, W + 40, 120);
    const n2 = noise(rnd, W + 40, 46);
    const ridge = (x, base, amp) => base - (n1(x) * 0.7 + n2(x) * 0.3) * amp;
    // hintere und vordere Felsen
    for (let l = 0; l < 2; l++) {
      g.beginPath();
      g.moveTo(0, hb);
      for (let x = 0; x <= W + 8; x += 8) g.lineTo(x, ridge(x + l * 300, hb * (l ? 0.78 : 0.5), hb * (l ? 0.4 : 0.45)));
      g.lineTo(W, hb);
      g.closePath();
      const col = dark ? p.s4 : mix(p.s3, p.c, l ? 0.3 : 0.1);
      const gr = g.createLinearGradient(0, hb * 0.2, 0, hb);
      gr.addColorStop(0, rgba(col, dark ? (l ? 0.85 : 0.5) : l ? 0.22 : 0.12));
      gr.addColorStop(1, rgba(col, dark ? 1 : l ? 0.34 : 0.2));
      g.fillStyle = gr;
      g.fill();
    }
    // Seegras / Tang
    g.lineCap = 'round';
    const nk = Math.round(W / 70);
    for (let i = 0; i < nk; i++) {
      const x = rnd(0, W);
      const h = rnd(0.3, 0.75) * hb;
      const lean = rnd(-0.25, 0.25) * h;
      g.strokeStyle = dark ? rgba(mix(p.s4, p.b, 0.12), 0.9) : rgba(p.s3, rnd(0.14, 0.24));
      g.lineWidth = rnd(1.6, 3.4);
      g.beginPath();
      g.moveTo(x, hb);
      g.bezierCurveTo(x + lean * 0.6, hb - h * 0.35, x - lean * 0.4, hb - h * 0.7, x + lean, hb - h);
      g.stroke();
    }
    if (dark) {
      // Leuchtpunkte (Anemonen) auf den Felsen
      const dot = kit.glow(p.b, 32, 0.25);
      const dot2 = kit.glow(p.d, 32, 0.25);
      for (let i = 0; i < Math.round(W / 60); i++) {
        const x = rnd(0, W);
        const y = ridge(x + 300, hb * 0.78, hb * 0.4) + rnd(2, 26);
        const s = rnd(6, 14);
        g.globalAlpha = rnd(0.35, 0.8) * k;
        g.drawImage(i % 3 ? dot : dot2, x - s / 2, y - s / 2, s, s);
      }
      g.globalAlpha = 1;
    }
  }

  return {
    resize() {
      const { W, H } = kit;
      ctx = kit.ctx;
      sw = kit.sideW();
      cw = W - sw;
      const rnd = kit.seeded(5150 + (W > 760 ? 0 : 3));
      paint(rnd);
      if (caustic) pat = ctx.createPattern(caustic, 'repeat');
      // Strahlen kommen schräg von oben rechts
      for (let i = 0; i < NR; i++) {
        const j = i * 7;
        RAY[j] = sw + cw * (0.08 + (i / (NR - 1)) * 0.95) + rnd(-0.04, 0.04) * cw + H * 0.12;
        RAY[j + 1] = rnd(0.16, 0.26);
        RAY[j + 2] = rnd(60, 150) * (W > 760 ? 1 : 0.7);
        RAY[j + 3] = H * rnd(0.75, 1.1);
        RAY[j + 4] = rnd(0, TAU);
        RAY[j + 5] = rnd(0.12, 0.24);
        RAY[j + 6] = rnd(0.6, 1);
      }
      if (!seeded) {
        seat(kit.seeded(808));
        seeded = true;
      } else {
        // nach dem Drehen: alles wieder in den sichtbaren Bereich holen
        const r2 = kit.seeded(909);
        for (let i = 0; i < nj; i++) {
          if (JEL[i * 8] > W || JEL[i * 8] < sw) JEL[i * 8] = sw + cw * r2(0.1, 0.9);
          if (JEL[i * 8 + 1] > H) JEL[i * 8 + 1] = H * r2(0.2, 0.9);
        }
        for (let i = 0; i < 3; i++) VENT[i] = sw + cw * (0.12 + 0.38 * i);
        for (let i = 0; i < ns; i++) {
          SN[i * 5] = (SN[i * 5] % W + W) % W;
          SN[i * 5 + 1] = (SN[i * 5 + 1] % H + H) % H;
        }
        for (const s of SCH) if (s.x < sw - 200 || s.x > W + 200 || s.y > H) schoolAt(s, r2, r2(0.2, 0.8));
      }
    },

    frame(t, dt) {
      const { W, H, dpr } = kit;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);

      // Kaustik (hell): zwei Lichtnetze, die gegeneinander wandern
      if (pat) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = pat;
        for (let l = 0; l < 2; l++) {
          const s = l ? 2.3 : 1.6;
          const ox = (l ? -t * 9 : t * 7) + Math.sin(t * 0.37 + l * 2) * 14;
          const oy = (l ? t * 4 : -t * 6) + Math.cos(t * 0.29 + l) * 12;
          ctx.globalAlpha = (l ? 0.36 : 0.3) * k;
          ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
          ctx.fillRect(-ox / s, -oy / s, W / s, H / s);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // Grund
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(bed.c, 0, bedY, W, H - bedY);

      // Lichtstrahlen
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < NR; i++) {
        const j = i * 7;
        const a = RAY[j + 1] + Math.sin(t * RAY[j + 5] + RAY[j + 4]) * 0.045;
        const pulse = 0.5 + 0.5 * Math.sin(t * RAY[j + 5] * 1.9 + RAY[j + 4] * 2);
        ctx.globalAlpha = RAY[j + 6] * (0.35 + 0.65 * pulse) * (dark ? 0.2 : 0.34) * k;
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * RAY[j], -dpr * 30);
        ctx.drawImage(ray, -RAY[j + 2] / 2, 0, RAY[j + 2], RAY[j + 3]);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Meeresschnee (dunkel) bzw. Schwebeteilchen (hell)
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = SNOW;
      for (let b = 0; b < 3; b++) {
        ctx.globalAlpha = (dark ? 0.16 + b * 0.13 : 0.35 + b * 0.15) * k;
        for (let i = b; i < ns; i += 3) {
          const j = i * 5;
          let y = SN[j + 1] + SN[j + 4] * dt;
          if (y > H + 4) y = -4;
          SN[j + 1] = y;
          const x = SN[j] + Math.sin(t * 0.4 + SN[j + 3]) * 6;
          ctx.fillRect(x, y, SN[j + 2], SN[j + 2]);
        }
      }

      // Fische (hell): kleine Schwärme als Schattenriss
      if (!dark) {
        ctx.fillStyle = FISH;
        for (const s of SCH) {
          s.x += s.v * s.dir * dt;
          if ((s.dir < 0 && s.x < sw - 260) || (s.dir > 0 && s.x > W + 260)) {
            s.x = s.dir < 0 ? W + 220 : sw - 220;
            s.y = H * (0.2 + Math.random() * 0.5);
          }
          for (let i = s.first; i < s.first + s.n; i++) {
            const j = i * 4;
            const ph = FI[j + 3];
            const x = s.x + FI[j] + Math.sin(t * 0.7 + ph) * 6;
            const y = s.y + FI[j + 1] + Math.sin(t * 0.9 + ph * 1.3) * 5;
            const sz = FI[j + 2] * s.size;
            const tail = Math.sin(t * (s.size > 1 ? 6 : 9) + ph) * 0.14;
            ctx.globalAlpha = (s.size > 1 ? 0.2 : 0.26) * k;
            ctx.setTransform(dpr * sz * s.dir, 0, 0, dpr * sz, dpr * x, dpr * y);
            ctx.beginPath();
            ctx.moveTo(1, 0);
            ctx.quadraticCurveTo(0.25, -0.5, -0.55, -0.06 + tail * 0.4);
            ctx.lineTo(-1.05, -0.36 + tail);
            ctx.lineTo(-0.88, tail * 0.7);
            ctx.lineTo(-1.05, 0.36 + tail);
            ctx.lineTo(-0.55, 0.06 + tail * 0.4);
            ctx.quadraticCurveTo(0.25, 0.46, 1, 0);
            ctx.fill();
          }
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // Quallen (dunkel): pulsierender Schirm, Fangarme schwingen nach
      if (dark) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = 0; i < nj; i++) {
          const j = i * 8;
          const size = JEL[j + 2];
          const ci = JEL[j + 3];
          const z = JEL[j + 6];
          const ph = t * JEL[j + 5] + JEL[j + 4];
          const u = ((ph / TAU) % 1 + 1) % 1;
          // schnelles Zusammenziehen, langsames Öffnen
          const c = u < 0.28 ? Math.sin((u / 0.28) * Math.PI * 0.5) : 0.5 + 0.5 * Math.cos(((u - 0.28) / 0.72) * Math.PI);
          let x = JEL[j];
          let y = JEL[j + 1];
          if (dt) {
            y -= (5 + 26 * c * c) * (0.6 + z * 0.5) * dt;
            x += Math.sin(t * 0.13 + JEL[j + 7]) * 6 * dt;
            if (y < -size * 5) {
              y = H + size * 1.5;
              x = sw + cw * (0.1 + Math.random() * 0.8);
            }
            JEL[j] = x;
            JEL[j + 1] = y;
          }
          const tilt = Math.sin(t * 0.21 + JEL[j + 7]) * 0.16;
          const s = size / BR;
          const co = Math.cos(tilt) * s;
          const si = Math.sin(tilt) * s;
          const glowA = (0.55 + 0.45 * c) * (0.45 + z * 0.55) * k;

          // Lichthof
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.globalAlpha = glowA * 0.6;
          const R = size * 3.6;
          ctx.drawImage(halos[ci], x - R, y - size * 0.9 - R, R * 2, R * 2);

          // ab hier in Quallen-Koordinaten (Rand-Mitte = 0, 0; Schirmradius = BR)
          ctx.setTransform(dpr * co, dpr * si, -dpr * si, dpr * co, dpr * x, dpr * y);
          ctx.strokeStyle = JS[ci];
          const sx = 1 - 0.16 * c;
          const sy = 1 + 0.08 * c;
          const L = BR * (2.4 + z * 0.8);
          // Fangarme: vorn kräftig, hinten fein
          for (let pass = 0; pass < 2; pass++) {
            ctx.globalAlpha = glowA * (pass ? 0.28 : 0.6);
            ctx.lineWidth = (pass ? 1.4 : 2) / s;
            ctx.beginPath();
            for (let a = 0; a < 7; a++) {
              const xb = ((a / 6) * 2 - 1) * BR * 0.86 * sx;
              let px = xb;
              let py = -4;
              const j0 = pass ? 4 : 0;
              const j1 = pass ? 9 : 5;
              for (let q = j0; q <= j1; q++) {
                const f = q / 9;
                const nx = xb * (1 + 0.45 * f * (1 - c)) + Math.sin(t * 1.5 - f * 4.2 + a * 1.7 + JEL[j + 4]) * BR * 0.32 * f;
                const ny = f * L * (0.88 + 0.12 * c);
                if (q === j0) ctx.moveTo(nx, ny);
                else ctx.quadraticCurveTo(px, py, (px + nx) / 2, (py + ny) / 2);
                px = nx;
                py = ny;
              }
            }
            ctx.stroke();
          }
          // Mundarme: drei wellige Bänder in der Mitte
          ctx.globalAlpha = glowA * 0.4;
          ctx.lineWidth = 4.5 / s;
          ctx.beginPath();
          for (let a = 0; a < 3; a++) {
            const xb = (a - 1) * BR * 0.16;
            ctx.moveTo(xb, -6);
            for (let q = 1; q <= 5; q++) {
              const f = q / 5;
              ctx.lineTo(xb + Math.sin(t * 1.1 - f * 5 + a * 2.1 + JEL[j + 4]) * BR * 0.16 * f, f * L * 0.55);
            }
          }
          ctx.stroke();
          // Schirm
          ctx.globalAlpha = (0.8 + 0.2 * c) * (0.6 + z * 0.4) * k;
          ctx.drawImage(bells[ci], -BX * sx, -BY * sy, BW * sx, BH * sy);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // Blasen steigen in kleinen Ketten auf
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < nb; i++) {
        const j = i * 5;
        const r = BUB[j + 2];
        let y = BUB[j + 1] - BUB[j + 3] * dt;
        if (y < -r * 2) {
          const rnd = Math.random;
          const inVent = rnd() < 0.6;
          BUB[j] = inVent ? VENT[i % 3] + (rnd() - 0.5) * 28 : sw + rnd() * cw;
          y = H + rnd() * 80;
        }
        BUB[j + 1] = y;
        const x = BUB[j] + Math.sin(t * 2.2 + BUB[j + 4] + y * 0.02) * (1.5 + r * 0.35);
        ctx.globalAlpha = (dark ? 0.55 : 0.8) * clamp((H - y) / 120, 0, 1) * k;
        ctx.drawImage(bubble, x - r, y - r, r * 2, r * 2);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

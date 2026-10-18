// Stil „Comic“ – Pop-Art-Comicseite: Rasterpunkte, die langsam wandern und atmen, Speedlines
// und ab und zu ein kurzes „POW!“ in einer freien Lücke der Kopfleiste.
// Dunkel: Comic-Nacht – tiefes Marineblau mit Cyan- und Gelb-Rastern.
// skin: Eintrag für die Stil-Auswahl (Vorschau-Farben je Hell/Dunkel).
// scene(p, kit): bewegter Hintergrund (siehe js/bgfx.js).

export const skin = {
  id: 'comic', name: 'Comic', desc: 'Live · Pop-Art', live: true,
  light: {
    bg: 'radial-gradient(circle at 76% 32%, #e11d48 0 11%, #111 11.5% 13%, transparent 13.5%), repeating-conic-gradient(from 0deg at 76% 32%, rgba(255,255,255,.55) 0 7deg, transparent 7deg 15deg), linear-gradient(32deg, transparent 34%, #ffd23f 56%), radial-gradient(circle, #00a6f0 32%, transparent 36%) 0 0 / 7px 7px, #fff4c7',
    surface: '#ffffff', accent: '#e11d48', text: '#111111',
  },
  dark: {
    bg: 'radial-gradient(circle at 76% 32%, #ffd23f 0 11%, #000 11.5% 13%, transparent 13.5%), repeating-conic-gradient(from 0deg at 76% 32%, rgba(0,208,255,.16) 0 7deg, transparent 7deg 15deg), linear-gradient(32deg, transparent 34%, #10184a 56%), radial-gradient(circle, #00d0ff 30%, transparent 36%) 0 0 / 7px 7px, #0b1030',
    surface: '#141b46', accent: '#ffd23f', text: '#fffbe8', glow: true,
  },
};

const FONT = '"Avenir Next Condensed", Futura, Impact, "Arial Black", "Segoe UI Black", system-ui, sans-serif';
const WORDS = ['POW!', 'ZACK!', 'BÄM!', 'WUMM!'];

// ---------- Vorlagen ----------

// Rasterfeld: Punkte im 45°-Raster, zur Ecke (cx, cy) hin größer; Rand um eine Rasterweite größer fürs Wandern
function halftone(kit, w, h, cx, cy, step, col) {
  const pad = step;
  const { c, g } = kit.layer(w + pad * 2, h + pad * 2);
  g.translate(pad, pad);
  g.fillStyle = kit.rgba(col, 1);
  const max = step * 0.5;
  for (let j = -2; j * step * 0.5 < h + pad * 2; j++) {
    const y = j * step * 0.5;
    for (let x = (j & 1 ? step * 0.5 : 0) - step; x < w + pad * 2; x += step) {
      const d = Math.hypot((x - cx) / w, (y - cy) / h);
      const f = 1 - d * 1.08;
      if (f <= 0.04) continue;
      g.beginPath();
      g.arc(x, y, max * f ** 0.85, 0, kit.TAU);
      g.fill();
    }
  }
  return { c, w: w + pad * 2, h: h + pad * 2 };
}

// Zacken-Stern mit Lautwort („POW!“) – Umriss in Tusche, harter Versatzschatten
function burstSprite(kit, word, fill, text, ink, seed) {
  const W = 190;
  const H = 128;
  const { c, g } = kit.layer(W, H);
  const rnd = kit.seeded(seed);
  const n = 13;
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * kit.TAU + 0.12;
    const r = i % 2 ? rnd(0.58, 0.7) : rnd(0.92, 1);
    pts.push(W / 2 + Math.cos(a) * r * (W / 2 - 10), H / 2 + Math.sin(a) * r * (H / 2 - 9));
  }
  const shape = (dx, dy) => {
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i] + dx, pts[i + 1] + dy);
    g.closePath();
  };
  g.lineJoin = 'round';
  g.fillStyle = kit.rgba(ink, 1);
  shape(5, 5);
  g.fill();
  g.fillStyle = kit.rgba(fill, 1);
  g.strokeStyle = kit.rgba(ink, 1);
  g.lineWidth = 3.5;
  shape(0, 0);
  g.fill();
  g.stroke();
  // Lautwort, leicht schräg
  g.translate(W / 2, H / 2 + 2);
  g.rotate(-0.1);
  let size = 40;
  g.font = `italic 900 ${size}px ${FONT}`;
  const tw = g.measureText(word).width;
  if (tw > W * 0.62) {
    size = Math.floor(size * ((W * 0.62) / tw));
    g.font = `italic 900 ${size}px ${FONT}`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 7;
  g.strokeStyle = kit.rgba(ink, 1);
  g.fillStyle = kit.rgba(ink, 1);
  g.fillText(word, 3, 3);
  g.strokeText(word, 0, 0);
  g.fillStyle = kit.rgba(text, 1);
  g.fillText(word, 0, 0);
  return { c, w: W, h: H };
}

// ---------- Szene ----------

export function scene(p, kit) {
  const { rgba, TAU } = kit;
  const k = p.k;
  const dark = p.dark;
  const ink = p.d;

  // Lautwörter: Füllung, Schrift
  const BURSTS = [
    burstSprite(kit, WORDS[0], p.c, p.a, ink, 11),
    burstSprite(kit, WORDS[1], p.a, p.c, ink, 23),
    burstSprite(kit, WORDS[2], p.b, p.s3, ink, 37),
    burstSprite(kit, WORDS[3], p.s2, p.s3, ink, 41),
  ];

  let base = null;
  let full = true;
  let sw = 0;
  let fx = 0;
  let fy = 0;
  let reach = 0;
  let fields = [];

  // Speedlines eines Ausbruchs
  const MAXS = 36;
  const SA = new Float32Array(MAXS);
  const SR = new Float32Array(MAXS);
  const SL = new Float32Array(MAXS);
  const SWD = new Float32Array(MAXS);
  const SV = new Float32Array(MAXS);
  let ns = 0;

  // Stellen (CSS-Pixel), die im nächsten Bild aus der ruhenden Ebene erneuert werden
  const MAXD = MAXS + 8;
  const DX = new Float32Array(MAXD);
  const DY = new Float32Array(MAXD);
  const DR = new Float32Array(MAXD);
  const DB = new Float32Array(MAXD);
  let nd = 0;
  let area = 0;
  let tick = 0;
  function mark(x0, y0, x1, y1) {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(kit.W, x1);
    y1 = Math.min(kit.H, y1);
    if (x1 <= x0 || y1 <= y0) return;
    area += (x1 - x0) * (y1 - y0);
    const i = Math.min(nd, MAXD - 1);
    if (nd >= MAXD) {
      DX[i] = Math.min(DX[i], x0);
      DY[i] = Math.min(DY[i], y0);
      DR[i] = Math.max(DR[i], x1);
      DB[i] = Math.max(DB[i], y1);
      return;
    }
    DX[i] = x0;
    DY[i] = y0;
    DR[i] = x1;
    DB[i] = y1;
    nd++;
  }

  // Ruhende Ebene: Strahlenkranz, feines Zeitungsraster, Rasterpunkte in den Ecken
  function paint() {
    const { W, H } = kit;
    const wide = W > 760;
    const cw = W - sw;
    base = kit.layer(W, H);
    const g = base.g;
    fx = sw + cw * (wide ? 0.56 : 0.5);
    fy = H * (wide ? 0.44 : 0.4);
    reach = Math.hypot(Math.max(fx, W - fx), Math.max(fy, H - fy));

    // Strahlenkranz aus abwechselnden Keilen
    const RAYS = 56;
    g.fillStyle = rgba(dark ? p.b : p.c, (dark ? 0.08 : 0.42) * k);
    for (let i = 0; i < RAYS; i += 2) {
      const a0 = (i / RAYS) * TAU;
      const a1 = ((i + 1) / RAYS) * TAU;
      g.beginPath();
      g.moveTo(fx, fy);
      g.lineTo(fx + Math.cos(a0) * reach * 1.1, fy + Math.sin(a0) * reach * 1.1);
      g.lineTo(fx + Math.cos(a1) * reach * 1.1, fy + Math.sin(a1) * reach * 1.1);
      g.closePath();
      g.fill();
    }
    // zur Mitte hin ausblenden – dort liegt der Inhalt
    g.globalCompositeOperation = 'destination-out';
    const hole = g.createRadialGradient(fx, fy, 0, fx, fy, reach * 0.7);
    hole.addColorStop(0, 'rgba(0, 0, 0, 1)');
    hole.addColorStop(0.45, 'rgba(0, 0, 0, 0.85)');
    hole.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = hole;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';

    // feines Zeitungsraster über allem
    const tile = kit.layer(6, 6);
    tile.g.fillStyle = rgba(dark ? p.b : ink, 1);
    tile.g.beginPath();
    tile.g.arc(1.5, 1.5, 0.75, 0, TAU);
    tile.g.arc(4.5, 4.5, 0.75, 0, TAU);
    tile.g.fill();
    const pat = g.createPattern(tile.c, 'repeat');
    // das Muster rechnet in Gerätepixeln – darum ohne Skalierung füllen
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = (dark ? 0.1 : 0.07) * k;
    g.fillStyle = pat;
    g.fillRect(0, 0, base.c.width, base.c.height);
    g.restore();

    // über der Seitenleiste nur halb so kräftig
    if (sw) {
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0, 0, 0, 0.6)';
      g.fillRect(0, 0, sw, H);
      g.globalCompositeOperation = 'source-over';
    }

    // Rasterfelder: oben rechts und unten links (bewegen sich in frame)
    const step = wide ? 13 : 10;
    const pw = wide ? Math.min(560, cw * 0.5) : W * 0.7;
    const ph = wide ? Math.min(420, H * 0.5) : H * 0.25;
    const qw = wide ? Math.min(380, cw * 0.34) : W * 0.6;
    const qh = wide ? Math.min(300, H * 0.34) : H * 0.22;
    // Anker = Bildschirmecke, an der die großen Punkte sitzen; dir = Wanderrichtung (eine halbe Rasterweite schräg)
    fields = [
      { ...halftone(kit, pw, ph, pw, 0, step, p.b), ax: W, ay: 0, lx: -(pw + step), ly: -step, dx: -1, dy: 1, a: (dark ? 0.5 : 0.42) * k, ph: 0, step, r0: 0, q0: 0, r1: 0, q1: 0 },
      { ...halftone(kit, qw, qh, 0, qh, step, dark ? p.c : p.a), ax: sw, ay: H, lx: -step, ly: -(qh + step), dx: 1, dy: -1, a: (dark ? 0.3 : 0.28) * k, ph: 2.1, step, r0: 0, q0: 0, r1: 0, q1: 0 },
    ];
  }

  // Ausbruch der Speedlines: alle 9 s für 1,3 s
  const SB = 9;
  const SLIFE = 1.3;
  let lastBurst = -1;
  function speedBurst(cycle) {
    if (cycle === lastBurst) return;
    lastBurst = cycle;
    const rnd = kit.seeded(cycle * 977 + 5);
    ns = kit.W > 760 ? MAXS : 22;
    for (let i = 0; i < ns; i++) {
      SA[i] = rnd(0, TAU);
      SR[i] = reach * rnd(0.42, 0.62);
      SL[i] = rnd(40, 110);
      SWD[i] = rnd(1.5, 4);
      SV[i] = reach * rnd(0.32, 0.5);
    }
  }

  // „POW!“: sucht eine freie Lücke in der Kopfleiste – nie über dem Inhalt
  let pop = null;
  let nextPop = -1;
  function findSpot() {
    const bar = document.querySelector('.topbar');
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    if (r.height < 30 || r.bottom < 0) return null;
    const xs = [];
    for (const el of bar.children) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) xs.push(b.left, b.right);
    }
    let best = 0;
    let bx = 0;
    let prev = r.left + 6;
    const order = [];
    for (let i = 0; i < xs.length; i += 2) order.push(i);
    order.sort((a, b) => xs[a] - xs[b]);
    for (const i of order) {
      if (xs[i] - prev > best) {
        best = xs[i] - prev;
        bx = prev;
      }
      prev = Math.max(prev, xs[i + 1]);
    }
    if (r.right - 6 - prev > best) {
      best = r.right - 6 - prev;
      bx = prev;
    }
    const h = Math.min(r.height + 6, 74, (best - 12) / 1.48);
    if (h < 40) return null;
    return { x: bx + best / 2, y: r.top + r.height / 2, h };
  }

  return {
    resize() {
      sw = kit.sideW();
      paint();
      full = true;
      nd = 0;
      lastBurst = -1;
      pop = null;
    },

    frame(t, dt) {
      const { ctx, W, H, dpr } = kit;
      const still = !dt;
      const bw = base.c.width;
      const bh = base.c.height;
      const restore = (x0, y0, x1, y1) => {
        x0 = Math.max(0, Math.floor(x0 * dpr));
        y0 = Math.max(0, Math.floor(y0 * dpr));
        x1 = Math.min(bw, Math.ceil(x1 * dpr));
        y1 = Math.min(bh, Math.ceil(y1 * dpr));
        if (x1 <= x0 || y1 <= y0) return;
        ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
        ctx.drawImage(base.c, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      };
      // Die Raster wandern nur ein paar Pixel pro Sekunde – jedes dritte Bild reicht,
      // außer es lag gerade etwas anderes darüber (Speedlines, „POW!“)
      tick++;
      let upd = still || full || nd > 0 || tick % 3 === 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      if (still || full || area > W * H * 0.55) {
        ctx.clearRect(0, 0, bw, bh);
        ctx.drawImage(base.c, 0, 0);
        full = false;
        upd = true;
      } else {
        for (let i = 0; i < nd; i++) restore(DX[i], DY[i], DR[i], DB[i]);
        if (upd) for (const f of fields) if (f.r1 > f.r0) restore(f.r0, f.q0, f.r1, f.q1);
      }
      nd = 0;
      area = 0;

      // Rasterfelder: wandern schräg (nahtlos, eine Rasterweite) und atmen
      if (upd) {
        for (const f of fields) {
          const d = ((t * 0.22 + f.ph) % 1) * f.step * 0.5;
          const sc = 1 + 0.045 * (0.5 + 0.5 * Math.sin(t * 0.7 + f.ph));
          const x = f.lx + f.dx * d;
          const y = f.ly + f.dy * d;
          ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * f.ax, dpr * f.ay);
          ctx.globalAlpha = f.a * (0.82 + 0.18 * Math.sin(t * 0.9 + f.ph * 2));
          ctx.drawImage(f.c, x, y, f.w, f.h);
          f.r0 = f.ax + x * sc - 1;
          f.q0 = f.ay + y * sc - 1;
          f.r1 = f.ax + (x + f.w) * sc + 1;
          f.q1 = f.ay + (y + f.h) * sc + 1;
          area += (f.r1 - f.r0) * (f.q1 - f.q0);
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Speedlines schießen nach außen
      if (!still) {
        const cyc = Math.floor(t / SB);
        const u = (t - cyc * SB) / SLIFE;
        if (u < 1) {
          speedBurst(cyc);
          const env = Math.sin(Math.PI * u);
          ctx.fillStyle = rgba(dark ? p.b : ink, 1);
          ctx.globalAlpha = env * (dark ? 0.5 : 0.32) * k;
          ctx.beginPath();
          for (let i = 0; i < ns; i++) {
            const c = Math.cos(SA[i]);
            const s = Math.sin(SA[i]);
            const r0 = SR[i] + SV[i] * u * SLIFE;
            const r1 = r0 + SL[i];
            const hw = SWD[i] / 2;
            const x0 = fx + c * r0;
            const y0 = fy + s * r0;
            const x1 = fx + c * r1;
            const y1 = fy + s * r1;
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1 - s * hw, y1 + c * hw);
            ctx.lineTo(x1 + s * hw, y1 - c * hw);
            ctx.closePath();
            mark(Math.min(x0, x1) - hw - 1, Math.min(y0, y1) - hw - 1, Math.max(x0, x1) + hw + 1, Math.max(y0, y1) + hw + 1);
          }
          ctx.fill();
        }

        // „POW!“ & Co.: kurz aufploppen, kurz stehen, verschwinden
        if (nextPop < 0) nextPop = t + 4;
        if (!pop && t >= nextPop) {
          // nicht hinter einem offenen Fenster
          const spot = document.getElementById('overlay-root')?.childElementCount ? null : findSpot();
          const rnd = Math.random;
          nextPop = t + 10 + rnd() * 8;
          if (spot) pop = { ...spot, t0: t, s: BURSTS[Math.floor(rnd() * BURSTS.length)], rot: (rnd() - 0.5) * 0.3 };
        }
        if (pop) {
          const u2 = (t - pop.t0) / 1.4;
          if (u2 >= 1) pop = null;
          else {
            let sc;
            if (u2 < 0.12) sc = 0.3 + (u2 / 0.12) * 0.85;
            else if (u2 < 0.22) sc = 1.15 - ((u2 - 0.12) / 0.1) * 0.15;
            else sc = 1 + Math.max(0, u2 - 0.8) * 0.4;
            const al = u2 > 0.8 ? 1 - (u2 - 0.8) / 0.2 : 1;
            const hh = pop.h * sc;
            const ww = hh * (pop.s.w / pop.s.h);
            const wob = u2 < 0.3 ? Math.sin(u2 * 60) * 0.06 * (1 - u2 / 0.3) : 0;
            const a = pop.rot + wob;
            ctx.setTransform(dpr * Math.cos(a), dpr * Math.sin(a), -dpr * Math.sin(a), dpr * Math.cos(a), dpr * pop.x, dpr * pop.y);
            ctx.globalAlpha = al * Math.min(1, k + 0.2);
            ctx.drawImage(pop.s.c, -ww / 2, -hh / 2, ww, hh);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const ex = Math.max(ww, hh) * 0.62 + 2;
            mark(pop.x - ex, pop.y - ex, pop.x + ex, pop.y + ex);
          }
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}

// Bewegte Hintergründe der Live-Stile (Jarvis, Synthwave, Cyberpunk, Galaxie) – wird einmal von app.js geladen.
// Ein Canvas liegt hinter allem und existiert nur, solange ein Live-Stil aktiv ist.
// Die Farben kommen aus den CSS-Variablen --fx-*, damit Hell/Dunkel und eigene Akzentfarben passen.

const root = document.documentElement;
const TAU = Math.PI * 2;
const STEP = 1000 / 30; // höchstens ~30 Bilder pro Sekunde
const STILL = 24; // Zeitpunkt (s) für das Standbild ohne Bewegung

let cv = null;
let ctx = null;
let scene = null;
let sceneKey = '';
let raf = 0;
let last = 0;
let clock = 0;
let W = 0;
let H = 0;
let dpr = 1;

// ---------- Hilfen ----------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

// Zufall mit festem Startwert: Skyline & Co. bleiben nach dem Drehen gleich
function seeded(seed) {
  let s = seed >>> 0;
  return (a = 0, b = 1) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return a + (((x ^ (x >>> 14)) >>> 0) / 4294967296) * (b - a);
  };
}

const probe = document.createElement('canvas').getContext('2d');
function rgb(css) {
  probe.fillStyle = '#000';
  probe.fillStyle = css || '#000';
  const s = String(probe.fillStyle);
  if (s[0] === '#') return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  return s.match(/[\d.]+/g).slice(0, 3).map(Number);
}
const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const mix = (c1, c2, f) => c1.map((v, i) => Math.round(v + (c2[i] - v) * f));

const FX = ['a', 'b', 'c', 'd', 's1', 's2', 's3', 's4'];
function palette() {
  const cs = getComputedStyle(root);
  const raw = FX.map((n) => cs.getPropertyValue(`--fx-${n}`).trim());
  const p = { dark: root.dataset.mode === 'dark', k: parseFloat(cs.getPropertyValue('--fx-k')) || 1 };
  FX.forEach((n, i) => (p[n] = rgb(raw[i])));
  p.blend = p.dark ? 'lighter' : 'source-over';
  p.key = `${p.dark}|${raw.join('|')}|${p.k}`;
  return p;
}

// Leinwand im Speicher; scale=true rechnet in CSS-Pixeln wie das sichtbare Canvas
function layer(w, h, scale = true) {
  const c = document.createElement('canvas');
  const f = scale ? dpr : 1;
  c.width = Math.max(1, Math.ceil(w * f));
  c.height = Math.max(1, Math.ceil(h * f));
  const g = c.getContext('2d');
  if (scale) g.setTransform(f, 0, 0, f, 0, 0);
  return { c, g };
}

// Weicher Lichtpunkt als Vorlage
function glow(col, size = 128, mid = 0.3) {
  const { c, g } = layer(size, size, false);
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, rgba(col, 1));
  grd.addColorStop(mid, rgba(col, 0.3));
  grd.addColorStop(1, rgba(col, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

// Breite der Seitenleiste – dort soll nichts Wichtiges liegen
const sideW = () => (W > 1100 ? 284 : W > 760 ? 250 : 0);

// ---------- Jarvis: Hologramm-HUD ----------

function jarvis(p) {
  const A = rgba(p.a, 1);
  const B = rgba(p.b, 1);
  const k = p.k;
  const N = 120;
  const COS = new Float32Array(N);
  const SIN = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    COS[i] = Math.cos((i / N) * TAU);
    SIN[i] = Math.sin((i / N) * TAU);
  }
  const ARCS = [0.2, 1.1, 1.6, 0.45, 2.4, 1.5, 4.2, 0.7, 5.25, 0.55];
  const DASH = [2, 6];
  const SOLID = [];
  const core = glow(p.a, 128, 0.16);

  // Lichtband, das wie ein Scanner über den Bildschirm läuft
  const band = layer(2, 160, false);
  const bg = band.g.createLinearGradient(0, 0, 0, 160);
  bg.addColorStop(0, rgba(p.a, 0));
  bg.addColorStop(0.8, rgba(p.a, 0.07));
  bg.addColorStop(0.985, rgba(p.a, 0.4));
  bg.addColorStop(1, rgba(p.a, 0));
  band.g.fillStyle = bg;
  band.g.fillRect(0, 0, 2, 160);

  // Radarkegel: helle Kante bei Winkel 0, Schweif dahinter
  const sweep = layer(256, 256, false);
  sweep.g.fillStyle = A;
  for (let i = 0; i < 48; i++) {
    sweep.g.globalAlpha = (1 - i / 48) ** 2 * 0.42;
    sweep.g.beginPath();
    sweep.g.moveTo(128, 128);
    sweep.g.arc(128, 128, 128, (-1.25 * (i + 1)) / 48, (-1.25 * i) / 48 + 0.01);
    sweep.g.closePath();
    sweep.g.fill();
  }
  sweep.g.globalAlpha = 0.9;
  sweep.g.strokeStyle = B;
  sweep.g.lineWidth = 1.5;
  sweep.g.beginPath();
  sweep.g.moveTo(128, 128);
  sweep.g.lineTo(256, 128);
  sweep.g.stroke();

  const m = {};
  let base = null;
  let parts = null;
  let blips = null;
  let clockLabel = '';
  let clockSec = -1;

  function ring(x, y, r, t, big) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = A;
    ctx.fillStyle = A;
    // Außenring mit Skala
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3 * k;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.moveTo(r * 0.62, 0);
    ctx.arc(0, 0, r * 0.62, 0, TAU);
    ctx.stroke();
    ctx.rotate(t * 0.06);
    ctx.globalAlpha = 0.6 * k;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const len = r * (i % 10 === 0 ? 0.065 : i % 5 === 0 ? 0.038 : 0.018);
      ctx.moveTo(COS[i] * r, SIN[i] * r);
      ctx.lineTo(COS[i] * (r - len), SIN[i] * (r - len));
    }
    ctx.stroke();
    // Bögen, gegenläufig
    ctx.rotate(-t * 0.28);
    ctx.lineWidth = big ? 3 : 2;
    ctx.globalAlpha = 0.7 * k;
    ctx.beginPath();
    const ra = r * 0.86;
    for (let i = 0; i < ARCS.length; i += 2) {
      ctx.moveTo(Math.cos(ARCS[i]) * ra, Math.sin(ARCS[i]) * ra);
      ctx.arc(0, 0, ra, ARCS[i], ARCS[i] + ARCS[i + 1]);
    }
    ctx.stroke();
    // gestrichelter Ring
    ctx.rotate(t * 0.42);
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.45 * k;
    ctx.setLineDash(DASH);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.74, 0, TAU);
    ctx.stroke();
    ctx.setLineDash(SOLID);
    if (big) {
      // Anzeige aus Segmenten, die sich langsam füllt und leert
      ctx.rotate(-t * 0.2);
      const rg = r * 0.5;
      const lit = Math.round((0.55 + 0.45 * Math.sin(t * 0.45)) * 48);
      ctx.lineWidth = r * 0.045;
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = (pass ? 0.75 : 0.14) * k;
        ctx.beginPath();
        for (let i = 0; i < 48; i++) {
          if ((i < lit) !== Boolean(pass)) continue;
          const a0 = (i / 48) * TAU;
          ctx.moveTo(Math.cos(a0) * rg, Math.sin(a0) * rg);
          ctx.arc(0, 0, rg, a0, a0 + (TAU / 48) * 0.62);
        }
        ctx.stroke();
      }
      // drei Marker zeigen nach innen
      ctx.globalAlpha = 0.8 * k;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * TAU;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const rr = r * 0.66;
        ctx.moveTo(c0 * rr, s0 * rr);
        ctx.lineTo(c0 * (rr + 9) - s0 * 5, s0 * (rr + 9) + c0 * 5);
        ctx.lineTo(c0 * (rr + 9) + s0 * 5, s0 * (rr + 9) - c0 * 5);
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    resize() {
      const left = sideW();
      const wide = W > 760;
      m.cx = left + (W - left) * (wide ? 0.6 : 0.5);
      m.cy = H * (wide ? 0.54 : 0.46);
      m.r = Math.min(W - left, H) * (wide ? 0.4 : 0.46);
      m.mx = wide ? left * 0.5 : W * 0.9;
      m.my = wide ? H - 150 : H * 0.11;
      m.mr = wide ? Math.min(96, left * 0.36) : W * 0.2;

      // Ruhende Ebene: Wabengitter, Fadenkreuz und Scanlines
      base = layer(W, H);
      const g = base.g;
      g.strokeStyle = A;
      g.lineWidth = 1;
      g.globalAlpha = (p.dark ? 0.07 : 0.08) * k;
      const s = 24;
      const hw = Math.sqrt(3) * s;
      g.beginPath();
      for (let row = 0, y = 0; y < H + s * 2; row++, y += s * 1.5) {
        for (let x = (row % 2) * (hw / 2); x < W + hw; x += hw) {
          for (let i = 0; i < 6; i++) {
            const a0 = Math.PI / 6 + (i * Math.PI) / 3;
            const px = x + Math.cos(a0) * s;
            const py = y + Math.sin(a0) * s;
            if (i) g.lineTo(px, py);
            else g.moveTo(px, py);
          }
          g.closePath();
        }
      }
      g.stroke();
      // nach außen ausblenden
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'destination-in';
      const fade = g.createRadialGradient(m.cx, m.cy, m.r * 0.3, m.cx, m.cy, Math.max(W, H) * 0.75);
      fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
      fade.addColorStop(1, 'rgba(0, 0, 0, 0.15)');
      g.fillStyle = fade;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      // Fadenkreuz durch die Mitte
      g.globalAlpha = 0.16 * k;
      g.beginPath();
      g.moveTo(0, m.cy + 0.5);
      g.lineTo(W, m.cy + 0.5);
      g.moveTo(m.cx + 0.5, 0);
      g.lineTo(m.cx + 0.5, H);
      for (let x = m.cx % 40; x < W; x += 40) {
        g.moveTo(x, m.cy - 3);
        g.lineTo(x, m.cy + 3);
      }
      g.stroke();
      if (p.dark) {
        g.globalAlpha = 0.035;
        g.fillStyle = B;
        g.beginPath();
        for (let y = 0; y < H; y += 3) g.rect(0, y, W, 1);
        g.fill();
      }

      // Datenpartikel
      const n = clamp(Math.round((W * H) / 9000), 36, 150);
      parts = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        parts[i * 4] = Math.random() * W;
        parts[i * 4 + 1] = Math.random() * H;
        parts[i * 4 + 2] = rand(8, 28);
        parts[i * 4 + 3] = rand(0, TAU);
      }
      blips = new Float32Array(8 * 2);
      for (let i = 0; i < 8; i++) {
        blips[i * 2] = rand(0, TAU);
        blips[i * 2 + 1] = rand(0.2, 0.84);
      }
    },

    frame(t, dt) {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base.c, 0, 0, W, H);
      ctx.globalCompositeOperation = p.blend;

      // Kern mit Leuchten
      const r = m.r;
      ctx.globalAlpha = (0.32 + 0.08 * Math.sin(t * 2.1)) * k;
      ctx.drawImage(core, m.cx - r * 0.42, m.cy - r * 0.42, r * 0.84, r * 0.84);

      ring(m.cx, m.cy, r, t, true);
      ring(m.mx, m.my, m.mr, t * 1.4 + 3, false);

      // Radar und Ziele
      ctx.save();
      ctx.translate(m.cx, m.cy);
      const sa = (t * 0.9) % TAU;
      ctx.fillStyle = B;
      ctx.strokeStyle = B;
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const b = blips[i * 2];
        const d = (sa - b + TAU * 2) % TAU;
        const v = Math.max(0, 1 - d / 2.2);
        if (d > 6 && dt) {
          blips[i * 2] = rand(0, TAU);
          blips[i * 2 + 1] = rand(0.2, 0.84);
        }
        if (v <= 0) continue;
        const bx = Math.cos(b) * r * blips[i * 2 + 1];
        const by = Math.sin(b) * r * blips[i * 2 + 1];
        ctx.globalAlpha = v * 0.9 * k;
        ctx.fillRect(bx - 2, by - 2, 4, 4);
        if (v > 0.6) {
          ctx.beginPath();
          ctx.arc(bx, by, 6 + (1 - v) * 18, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.rotate(sa);
      ctx.globalAlpha = 0.55 * k;
      ctx.drawImage(sweep.c, -r * 0.98, -r * 0.98, r * 1.96, r * 1.96);
      ctx.restore();

      // Beschriftungen wie auf einem Helmdisplay – leise, weil meist Termine darüber liegen
      const sec = Math.floor(Date.now() / 1000);
      if (sec !== clockSec) {
        clockSec = sec;
        clockLabel = new Date().toLocaleTimeString('de-DE');
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.fillStyle = A;
      ctx.strokeStyle = A;
      ctx.globalAlpha = 0.45 * k;
      const lx = m.cx + r * 0.78;
      const ly = m.cy - r * 0.86;
      ctx.beginPath();
      ctx.moveTo(m.cx + r * 0.6, m.cy - r * 0.6);
      ctx.lineTo(lx - 8, ly + 6);
      ctx.lineTo(lx + 110, ly + 6);
      ctx.moveTo(m.cx - r * 0.66, m.cy + r * 0.56);
      ctx.lineTo(m.cx - r * 0.9, m.cy + r * 0.84);
      ctx.lineTo(m.cx - r * 0.9 - 110, m.cy + r * 0.84);
      ctx.stroke();
      ctx.globalAlpha = 0.3 * k;
      ctx.fillText('SYSTEM ONLINE', lx, ly);
      ctx.fillText(clockLabel, lx, ly + 18);
      ctx.globalAlpha = 0.2 * k;
      ctx.fillText('52.52°N  13.40°E', lx, ly + 32);

      // aufsteigende Datenpartikel
      ctx.globalCompositeOperation = p.blend;
      ctx.fillStyle = B;
      for (let i = 0; i < parts.length; i += 4) {
        let y = parts[i + 1] - parts[i + 2] * dt;
        if (y < -4) {
          y = H + 4;
          parts[i] = Math.random() * W;
        }
        parts[i + 1] = y;
        const ph = parts[i + 3];
        ctx.globalAlpha = (0.25 + 0.3 * Math.sin(t * 2.3 + ph)) * k;
        ctx.fillRect(parts[i] + Math.sin(t * 0.6 + ph) * 6, y, 2, 2);
      }

      // Scanner-Band
      ctx.globalAlpha = 0.8 * k;
      ctx.drawImage(band.c, 0, ((t / 9) % 1) * (H + 240) - 200, W, 160);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

// ---------- Synthwave: Sonne, Berge und Neon-Gitter ----------

function synthwave(p) {
  const halo = glow(p.b, 256, 0.22);
  const k = p.k;
  const STAR = rgba(p.d, 1);
  const LINE = rgba(p.c, 1);
  const m = {};
  let sky = null;
  let ground = null;
  let sun = null;
  let work = null;
  let stars = null;

  return {
    resize() {
      const left = sideW();
      const wide = W > 760;
      m.hz = Math.round(H * (wide ? 0.62 : 0.6));
      m.vx = left + (W - left) / 2;
      m.sr = Math.round(Math.min(W - left, H) * (wide ? 0.25 : 0.36));
      m.sy = m.hz - m.sr * 0.36;
      m.mh = Math.round(Math.min(H * 0.2, m.sr * 0.95));

      sky = ctx.createLinearGradient(0, 0, 0, m.hz);
      sky.addColorStop(0, rgba(p.s1, 1));
      sky.addColorStop(0.58, rgba(p.s2, 1));
      sky.addColorStop(1, rgba(p.s3, 1));

      // Sonne als Vorlage; die Streifen werden pro Bild ausgeschnitten
      const d = m.sr * 2;
      sun = layer(d, d);
      const sg = sun.g.createLinearGradient(0, 0, 0, d);
      sg.addColorStop(0.1, rgba(p.a, 1));
      sg.addColorStop(0.95, rgba(p.b, 1));
      sun.g.fillStyle = sg;
      sun.g.beginPath();
      sun.g.arc(m.sr, m.sr, m.sr, 0, TAU);
      sun.g.fill();
      work = layer(d, d);

      // Boden: Bergketten, Bodenverlauf, Fluchtlinien und Horizont
      const gh = H - m.hz + m.mh;
      ground = layer(W, gh);
      const g = ground.g;
      const hy = m.mh;
      const floor = g.createLinearGradient(0, hy, 0, gh);
      floor.addColorStop(0, rgba(mix(p.s4, p.s3, 0.35), 1));
      floor.addColorStop(0.35, rgba(p.s4, 1));
      floor.addColorStop(1, rgba(p.s4, 1));
      g.fillStyle = floor;
      g.fillRect(0, hy, W, gh - hy);

      const rnd = seeded(1984);
      const range = (x0, x1) => {
        const pts = [];
        for (let x = x0; x <= x1 + 30; x += rnd(26, 60)) pts.push(x, hy - m.mh * rnd(0.18, 1) * (0.35 + 0.65 * Math.sin(((x - x0) / (x1 - x0 || 1)) * Math.PI)));
        g.beginPath();
        g.moveTo(x0, hy);
        for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.lineTo(x1 + 30, hy);
        g.closePath();
        const mg = g.createLinearGradient(0, 0, 0, hy);
        mg.addColorStop(0, rgba(mix(p.s1, p.s4, 0.4), 1));
        mg.addColorStop(1, rgba(p.s4, 1));
        g.fillStyle = mg;
        g.fill();
        // Gitter-Kanten auf den Bergen
        g.save();
        g.strokeStyle = LINE;
        g.shadowColor = LINE;
        g.shadowBlur = 10;
        g.lineWidth = 1.5;
        g.globalAlpha = 0.85;
        g.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          if (i) g.lineTo(pts[i], pts[i + 1]);
          else g.moveTo(pts[i], pts[i + 1]);
        }
        g.stroke();
        g.shadowBlur = 0;
        g.globalAlpha = 0.25;
        g.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          g.moveTo(pts[i], pts[i + 1]);
          g.lineTo(pts[i] + rnd(-30, 30), hy);
        }
        g.stroke();
        g.restore();
      };
      const gap = m.sr * 1.25;
      range(-20, m.vx - gap);
      range(m.vx + gap, W + 10);

      // Fluchtlinien zum Horizont
      g.save();
      g.beginPath();
      g.rect(0, hy, W, gh - hy);
      g.clip();
      g.strokeStyle = LINE;
      g.shadowColor = LINE;
      g.shadowBlur = 8;
      g.lineWidth = 1.3;
      g.globalAlpha = 0.75 * k;
      const top = Math.max(10, W * 0.014);
      const bottom = Math.max(70, W * 0.085);
      const n = Math.ceil((Math.max(m.vx, W - m.vx) + 40) / bottom) + 2;
      g.beginPath();
      for (let i = -n; i <= n; i++) {
        g.moveTo(m.vx + i * top, hy);
        g.lineTo(m.vx + i * bottom, gh);
      }
      g.stroke();
      g.restore();
      // Horizont
      const hg = g.createLinearGradient(0, hy - 14, 0, hy + 14);
      hg.addColorStop(0, rgba(p.s3, 0));
      hg.addColorStop(0.5, rgba(p.s3, 0.9));
      hg.addColorStop(1, rgba(p.s3, 0));
      g.fillStyle = hg;
      g.fillRect(0, hy - 14, W, 28);
      g.fillStyle = rgba(mix(p.s3, [255, 255, 255], 0.5), 1);
      g.fillRect(0, hy - 1, W, 2);

      // Sterne im oberen Himmel
      const ns = clamp(Math.round((W * m.hz) / 6000), 30, 160);
      stars = new Float32Array(ns * 4);
      const sr = seeded(7);
      for (let i = 0; i < ns; i++) {
        stars[i * 4] = sr(0, W);
        stars[i * 4 + 1] = sr(0, m.hz * 0.8) ** 1.25 / (m.hz * 0.8) ** 0.25;
        stars[i * 4 + 2] = sr(1, 2.2);
        stars[i * 4 + 3] = sr(0, TAU);
      }
    },

    frame(t) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, m.hz + 1);

      ctx.fillStyle = STAR;
      for (let i = 0; i < stars.length; i += 4) {
        ctx.globalAlpha = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.7 + stars[i + 3]))) * (p.dark ? 0.9 : 0.55);
        const s = stars[i + 2];
        ctx.fillRect(stars[i], stars[i + 1], s, s);
      }

      // Sonne mit wandernden Streifen
      const d = m.sr * 2;
      ctx.globalCompositeOperation = p.blend;
      ctx.globalAlpha = (p.dark ? 0.5 : 0.45) + 0.06 * Math.sin(t * 1.3);
      ctx.drawImage(halo, m.vx - m.sr * 2.4, m.sy - m.sr * 2.4, m.sr * 4.8, m.sr * 4.8);
      const w = work.g;
      w.globalCompositeOperation = 'source-over';
      w.clearRect(0, 0, d, d);
      w.drawImage(sun.c, 0, 0, d, d);
      w.globalCompositeOperation = 'destination-out';
      w.beginPath();
      const ph = (t * 0.12) % 1;
      for (let i = 0; i < 9; i++) {
        const f = (i + ph) / 9;
        w.rect(0, d * (0.46 + f * 0.54), d, 1 + f * m.sr * 0.11);
      }
      w.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(work.c, m.vx - m.sr, m.sy - m.sr, d, d);

      ctx.drawImage(ground.c, 0, m.hz - m.mh, W, H - m.hz + m.mh);

      // Querlinien kommen auf uns zu
      ctx.globalCompositeOperation = p.blend;
      ctx.fillStyle = LINE;
      const span = H - m.hz;
      const ph2 = (t * 0.5) % 1;
      for (let j = 0; j < 26; j++) {
        const z = j + 1 - ph2;
        const y = m.hz + (span * 1.25) / (z + 0.25);
        if (y > H + 4) continue;
        const f = (y - m.hz) / span;
        const a = clamp(f * 2.6, 0, 1) * 0.85 * k;
        const lw = 1 + f * 1.8;
        ctx.globalAlpha = a * 0.22;
        ctx.fillRect(0, y - lw * 2, W, lw * 4);
        ctx.globalAlpha = a;
        ctx.fillRect(0, y - lw / 2, W, lw);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

// ---------- Cyberpunk: Skyline bei Nacht, Neonregen und Glitches ----------

function cyberpunk(p) {
  const k = p.k;
  const COL = [rgba(p.a, 1), rgba(p.b, 1), rgba(p.c, 1)];
  const DROP = rgba(p.d, 1);
  const lamp = [glow(p.a, 64), glow(p.b, 64), glow(p.c, 64)];
  // Suchscheinwerfer in Cyan und Magenta
  const beams = [p.b, p.c].map((col) => {
    const { c, g } = layer(80, 512, false);
    const grd = g.createLinearGradient(0, 512, 0, 0);
    grd.addColorStop(0, rgba(col, 0.6));
    grd.addColorStop(1, rgba(col, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(36, 512);
    g.lineTo(0, 0);
    g.lineTo(80, 0);
    g.lineTo(44, 512);
    g.closePath();
    g.fill();
    return c;
  });

  const m = {};
  let back = null;
  let city = null;
  let wins = null;
  let rain = null;
  let cars = null;
  let glitchAt = 2;
  let glitchEnd = 0;

  return {
    resize() {
      m.ch = Math.round(H * (W > 760 ? 0.46 : 0.4));
      m.cy = H - m.ch;
      // Himmel mit Neonschein über der Skyline (flache Ellipsen) als ruhende Ebene
      back = layer(W, H);
      const bg = back.g;
      const sky = bg.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, rgba(p.s1, 1));
      sky.addColorStop(0.62, rgba(mix(p.s1, p.s2, 0.6), 1));
      sky.addColorStop(1, rgba(p.s2, 1));
      bg.fillStyle = sky;
      bg.fillRect(0, 0, W, H);
      bg.globalCompositeOperation = p.blend;
      const hr = Math.max(W * 0.34, 220);
      const flat = Math.min(0.5, (m.ch * 0.55) / hr);
      for (const [fx, col, a] of [[0.28, p.c, 0.3], [0.74, p.b, 0.14], [0.52, p.c, 0.2]]) {
        const grd = bg.createRadialGradient(0, 0, 0, 0, 0, hr);
        grd.addColorStop(0, rgba(col, a * (p.dark ? 1 : 0.45) * k));
        grd.addColorStop(1, rgba(col, 0));
        bg.save();
        bg.translate(W * fx, m.cy);
        bg.scale(1, flat);
        bg.fillStyle = grd;
        bg.fillRect(-hr, -hr, hr * 2, hr * 2);
        bg.restore();
      }

      // Skyline in drei Ebenen
      city = layer(W, m.ch);
      const g = city.g;
      const rnd = seeded(2077);
      const flick = [];
      const tiers = [
        { col: p.s3, h0: 0.4, h1: 0.98, w0: 24, w1: 70, lit: 0.12, rim: 0.2 },
        { col: mix(p.s3, p.s4, 0.55), h0: 0.25, h1: 0.72, w0: 40, w1: 96, lit: 0.2, rim: 0.3 },
        { col: p.s4, h0: 0.1, h1: 0.4, w0: 60, w1: 150, lit: 0.28, rim: 0.45 },
      ];
      tiers.forEach((tier, ti) => {
        for (let x = -rnd(0, 40); x < W; ) {
          const bw = rnd(tier.w0, tier.w1);
          const bh = m.ch * rnd(tier.h0, tier.h1);
          const top = m.ch - bh;
          g.fillStyle = rgba(tier.col, 1);
          g.fillRect(x, top, bw - 2, bh);
          if (rnd() < 0.35) g.fillRect(x + bw * 0.2, top - bh * 0.08, bw * 0.45, bh * 0.08);
          if (rnd() < 0.3) g.fillRect(x + bw * 0.5, top - bh * 0.22, 2, bh * 0.22);
          // Fenster
          for (let wy = top + 8; wy < m.ch - 6; wy += 9) {
            for (let wx = x + 5; wx < x + bw - 8; wx += 7) {
              if (rnd() > tier.lit) continue;
              const ci = rnd() < 0.55 ? 0 : rnd() < 0.7 ? 1 : 2;
              g.globalAlpha = rnd(0.15, 0.6) * (ti + 1) / 3 + 0.1;
              g.fillStyle = COL[ci];
              g.fillRect(wx, wy, 3, 4);
              if (ti && rnd() < 0.05) flick.push(wx, m.cy + wy, ci, rnd(0, TAU), rnd(2, 9));
            }
          }
          g.globalAlpha = 1;
          // Leuchtreklame
          if (ti && bw > 46 && rnd() < 0.2) {
            const sw = bw * 0.62;
            const sh = rnd(12, 22);
            const sx = x + (bw - sw) / 2;
            const sy = top + bh * rnd(0.08, 0.3);
            const col = COL[rnd() < 0.5 ? 2 : rnd() < 0.5 ? 1 : 0];
            g.save();
            g.fillStyle = rgba(tier.col, 1);
            g.fillRect(sx, sy, sw, sh);
            g.strokeStyle = col;
            g.fillStyle = col;
            g.shadowColor = col;
            g.shadowBlur = 12;
            g.lineWidth = 1.5;
            g.strokeRect(sx + 0.75, sy + 0.75, sw - 1.5, sh - 1.5);
            g.globalAlpha = 0.85;
            for (let tx = sx + 5; tx < sx + sw - 8; tx += rnd(6, 12)) g.fillRect(tx, sy + sh / 2 - 1.5, rnd(3, 7), 3);
            g.restore();
          }
          // Neonstreifen und Kanten
          if (rnd() < 0.16 + ti * 0.04) {
            g.save();
            g.fillStyle = COL[rnd() < 0.5 ? 2 : 1];
            g.shadowColor = g.fillStyle;
            g.shadowBlur = 14;
            g.fillRect(x + (rnd() < 0.5 ? 2 : bw - 7), top + bh * rnd(0.05, 0.3), 3, bh * rnd(0.2, 0.45));
            g.restore();
          }
          g.globalAlpha = tier.rim;
          g.fillStyle = COL[1];
          g.fillRect(x, top, bw - 2, 1);
          g.globalAlpha = 1;
          x += bw + rnd(0, 6);
        }
      });
      wins = new Float32Array(flick);

      // Regen
      const nr = clamp(Math.round((W * H) / 5500), 60, 260);
      rain = new Float32Array(nr * 4);
      for (let i = 0; i < nr; i++) {
        rain[i * 4] = rand(-40, W);
        rain[i * 4 + 1] = rand(-H, H);
        rain[i * 4 + 2] = rand(10, 26);
        rain[i * 4 + 3] = rand(520, 900);
      }
      // fliegende Autos
      cars = new Float32Array(5 * 4);
      for (let i = 0; i < 5; i++) {
        cars[i * 4] = rand(0, W);
        cars[i * 4 + 1] = m.cy - rand(10, H * 0.32);
        cars[i * 4 + 2] = rand(40, 110) * (i % 2 ? 1 : -1);
        cars[i * 4 + 3] = i % 3;
      }
    },

    frame(t, dt) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(back.c, 0, 0, W, H);

      // Suchscheinwerfer
      ctx.globalCompositeOperation = p.blend;
      for (let i = 0; i < 2; i++) {
        ctx.save();
        ctx.translate(W * (i ? 0.78 : 0.3), m.cy + m.ch * 0.25);
        ctx.rotate(Math.sin(t * 0.22 + i * 2.4) * 0.38 + (i ? 0.22 : -0.22));
        ctx.globalAlpha = (p.dark ? 0.2 : 0.12) * k;
        ctx.drawImage(beams[i], -60, -H * 0.95, 120, H * 0.95);
        ctx.restore();
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(city.c, 0, m.cy, W, m.ch);

      // flackernde Fenster und Leuchtreklamen
      ctx.globalCompositeOperation = p.blend;
      for (let i = 0; i < wins.length; i += 5) {
        const v = Math.sin(t * wins[i + 4] + wins[i + 3]);
        if (v < 0.2) continue;
        ctx.globalAlpha = (v > 0.92 ? 1 : 0.55) * k;
        ctx.drawImage(lamp[wins[i + 2]], wins[i] - 6, wins[i + 1] - 6, 15, 16);
      }

      // fliegende Autos
      for (let i = 0; i < cars.length; i += 4) {
        let x = cars[i] + cars[i + 2] * dt;
        if (x < -40) x = W + 40;
        if (x > W + 40) x = -40;
        cars[i] = x;
        const y = cars[i + 1] + Math.sin(t * 0.8 + i) * 4;
        const ci = cars[i + 3];
        ctx.globalAlpha = 0.5 * k;
        ctx.fillStyle = COL[ci];
        ctx.fillRect(x - Math.sign(cars[i + 2]) * 26, y, 26 * Math.sign(cars[i + 2]), 1);
        ctx.globalAlpha = 0.9 * k;
        ctx.drawImage(lamp[ci], x - 8, y - 8, 16, 16);
      }

      // Regen in einem Pfad
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = DROP;
      ctx.lineWidth = 1;
      ctx.globalAlpha = (p.dark ? 0.3 : 0.18) * k;
      ctx.beginPath();
      for (let i = 0; i < rain.length; i += 4) {
        let y = rain[i + 1] + rain[i + 3] * dt;
        let x = rain[i] + rain[i + 3] * 0.16 * dt;
        if (y > H + 30) {
          y = rand(-80, -10);
          x = rand(-40, W);
        }
        rain[i] = x;
        rain[i + 1] = y;
        const len = rain[i + 2];
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * 0.16, y - len);
      }
      ctx.stroke();

      // gelegentliche Bildstörung
      if (dt && t > glitchAt) {
        glitchEnd = t + rand(0.1, 0.26);
        glitchAt = t + rand(1.8, 4.6);
      }
      if (t < glitchEnd) {
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const y = Math.random() * H;
          const h = rand(2, 22);
          const off = rand(-40, 40);
          const sh = Math.min(h, H - y - 1);
          ctx.globalAlpha = 1;
          if (y > m.cy && sh > 1) ctx.drawImage(city.c, 0, (y - m.cy) * dpr, city.c.width, sh * dpr, off, y, W, sh);
          ctx.globalAlpha = rand(0.12, 0.35) * k;
          ctx.fillStyle = COL[i % 3];
          ctx.fillRect(Math.random() < 0.5 ? 0 : rand(0, W * 0.5), y, rand(W * 0.3, W), Math.max(1, h * 0.35));
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}

// ---------- Galaxie: Sternenfeld, Nebel und Sternschnuppen ----------

// Nebelschwade: Wölkchen entlang eines geschwungenen Fadens, dazu dunkle Staublücken
function cloud(col, seed) {
  const rnd = seeded(seed);
  const S = 256;
  const { c, g } = layer(S, S, false);
  const puff = (x, y, r, a) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rgba(col, a));
    grd.addColorStop(1, rgba(col, 0));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const bend = rnd(0, TAU);
  const lift = rnd(0.1, 0.22);
  for (let i = 0; i < 40; i++) {
    const u = i / 39;
    const w = Math.sin(u * Math.PI); // in der Mitte dichter
    const x = S * (0.14 + 0.72 * u) + rnd(-0.06, 0.06) * S;
    const y = S * (0.5 + lift * Math.sin(u * Math.PI * 1.6 + bend)) + rnd(-0.1, 0.1) * S * w;
    puff(x, y, S * rnd(0.05, 0.11 + 0.12 * w), rnd(0.08, 0.2) * (0.4 + 0.6 * w));
  }
  for (let i = 0; i < 10; i++) puff(S * rnd(0.25, 0.75), S * rnd(0.3, 0.7), S * rnd(0.12, 0.26), 0.05);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) puff(S * rnd(0.2, 0.8), S * rnd(0.3, 0.7), S * rnd(0.03, 0.08), rnd(0.3, 0.6));
  return c;
}

function galaxie(p) {
  const k = p.k;
  const clouds = [cloud(p.a, 11), cloud(p.b, 23), cloud(p.c, 37), cloud(p.s1, 41)];
  // Lage, Größe und Drift der Nebel: x, y, Größe, Tempo
  const CL = [0.22, 0.3, 1.05, 1, 0.8, 0.22, 0.85, -1.3, 0.66, 0.84, 1.15, 0.8, 0.12, 0.86, 0.75, -0.9];
  const dot = glow(p.d, 32, 0.22);
  const STAR = rgba(p.d, 1);
  // heller Stern mit vier Strahlen
  const spark = layer(64, 64, false);
  const sg = spark.g;
  sg.drawImage(glow(p.d, 64, 0.12), 0, 0);
  for (const [x0, y0, x1, y1] of [[32, 2, 32, 62], [2, 32, 62, 32]]) {
    const ray = sg.createLinearGradient(x0, y0, x1, y1);
    ray.addColorStop(0, rgba(p.d, 0));
    ray.addColorStop(0.5, rgba(p.d, 0.9));
    ray.addColorStop(1, rgba(p.d, 0));
    sg.fillStyle = ray;
    sg.fillRect(x0 === x1 ? 31 : x0, y0 === y1 ? 31 : y0, x0 === x1 ? 2 : 60, y0 === y1 ? 2 : 60);
  }
  const m = {};
  const Q = 0.25; // Nebel sind weich – Viertelauflösung reicht und spart viel Füllarbeit
  let neb = null;
  let far = null;
  let mid = null;
  let near = null;
  const shot = { x: 0, y: 0, vx: 0, vy: 0, life: 0, next: 4 };

  return {
    resize() {
      m.size = Math.max(W, H);
      neb = layer(W * Q, H * Q, false);
      far = layer(W, H);
      const g = far.g;
      const rnd = seeded(404);
      const nf = clamp(Math.round((W * H) / 1700), 200, 900);
      const tint = [p.d, mix(p.d, p.b, 0.4), mix(p.d, p.c, 0.35)];
      const bandY = (x) => H * (0.4 + 0.14 * Math.sin((x / W) * TAU + 1));
      const band = Math.max(40, H * 0.11);
      const glowDot = glow(mix(p.d, p.b, 0.5), 64, 0.4);
      g.globalAlpha = (p.dark ? 0.05 : 0.07) * k;
      for (let x = -band; x < W + band; x += band * 0.35) {
        const r = band * rnd(1.6, 2.6);
        g.drawImage(glowDot, x - r, bandY(x) + rnd(-0.3, 0.3) * band - r, r * 2, r * 2);
      }
      for (let i = 0; i < nf * 1.8; i++) {
        const inBand = i >= nf;
        const x = rnd(0, W);
        // im Band dicht und zur Mitte hin gehäuft
        const y = inBand ? bandY(x) + (rnd() + rnd() + rnd() - 1.5) * band : rnd(0, H);
        g.globalAlpha = rnd(0.15, inBand ? 0.55 : 0.7) * k;
        g.fillStyle = rgba(tint[i % 3], 1);
        const s = rnd() < 0.85 ? 1 : 1.6;
        g.fillRect(x, y, s, s);
      }
      const nm = clamp(Math.round((W * H) / 7000), 50, 220);
      mid = new Float32Array(nm * 4);
      for (let i = 0; i < nm; i++) {
        mid[i * 4] = rnd(0, W);
        mid[i * 4 + 1] = rnd(0, H);
        mid[i * 4 + 2] = rnd(1.2, 2.4);
        mid[i * 4 + 3] = rnd(0, TAU);
      }
      const nn = clamp(Math.round((W * H) / 45000), 8, 32);
      near = new Float32Array(nn * 4);
      for (let i = 0; i < nn; i++) {
        near[i * 4] = rnd(0, W);
        near[i * 4 + 1] = rnd(0, H);
        near[i * 4 + 2] = rnd(12, 26);
        near[i * 4 + 3] = rnd(0, TAU);
      }
    },

    frame(t, dt) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);

      // Nebel
      const n = neb.g;
      n.setTransform(1, 0, 0, 1, 0, 0);
      n.globalCompositeOperation = 'source-over';
      n.globalAlpha = 1;
      n.clearRect(0, 0, neb.c.width, neb.c.height);
      n.globalCompositeOperation = p.blend;
      n.globalAlpha = (p.dark ? 0.8 : 0.85) * k;
      for (let i = 0; i < 4; i++) {
        const j = i * 4;
        const s = m.size * CL[j + 2];
        const x = W * CL[j] + Math.sin(t * 0.03 * CL[j + 3] + i * 1.7) * W * 0.05;
        const y = H * CL[j + 1] + Math.cos(t * 0.025 * CL[j + 3] + i) * H * 0.05;
        const a = t * 0.008 * CL[j + 3];
        const c = Math.cos(a) * Q;
        const sn = Math.sin(a) * Q;
        n.setTransform(c, sn, -sn, c, x * Q, y * Q);
        n.drawImage(clouds[i], -s / 2, -s / 2, s, s);
      }
      ctx.drawImage(neb.c, 0, 0, W, H);

      // ferne Sterne driften langsam (Parallaxe)
      const ox = -((t * 3) % W);
      ctx.drawImage(far.c, ox, 0, W, H);
      ctx.drawImage(far.c, ox + W, 0, W, H);

      // mittlere Sterne funkeln
      ctx.fillStyle = STAR;
      for (let i = 0; i < mid.length; i += 4) {
        let x = mid[i] - 7 * dt;
        if (x < -4) x += W + 8;
        mid[i] = x;
        const s = mid[i + 2];
        ctx.globalAlpha = (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 1.9 + mid[i + 3]))) * k;
        ctx.fillRect(x, mid[i + 1], s, s);
      }

      // nahe, helle Sterne mit Glanz
      for (let i = 0; i < near.length; i += 4) {
        let x = near[i] - 15 * dt;
        if (x < -30) x += W + 60;
        near[i] = x;
        const s = near[i + 2] * (0.8 + 0.2 * Math.sin(t * 0.9 + near[i + 3]));
        ctx.globalAlpha = (0.55 + 0.45 * Math.sin(t * 0.7 + near[i + 3])) * k;
        ctx.drawImage(spark.c, x - s / 2, near[i + 1] - s / 2, s, s);
      }

      // Sternschnuppe
      if (dt && t > shot.next && shot.life <= 0) {
        const a = rand(2.55, 2.85);
        const v = rand(520, 820);
        shot.x = rand(W * 0.35, W * 1.05);
        shot.y = rand(-20, H * 0.35);
        shot.vx = Math.cos(a) * v;
        shot.vy = Math.sin(a) * v;
        shot.life = 1;
        shot.next = t + rand(3.5, 8);
      }
      if (shot.life > 0) {
        shot.x += shot.vx * dt;
        shot.y += shot.vy * dt;
        shot.life -= dt * 1.2;
        const f = Math.max(0, shot.life);
        ctx.strokeStyle = STAR;
        for (let i = 0; i < 12; i++) {
          ctx.globalAlpha = f * (1 - i / 12) * 0.9 * k;
          ctx.lineWidth = 2.2 * (1 - i / 12) + 0.3;
          ctx.beginPath();
          ctx.moveTo(shot.x - shot.vx * 0.012 * i, shot.y - shot.vy * 0.012 * i);
          ctx.lineTo(shot.x - shot.vx * 0.012 * (i + 1), shot.y - shot.vy * 0.012 * (i + 1));
          ctx.stroke();
        }
        ctx.globalAlpha = f * k;
        ctx.drawImage(dot, shot.x - 10, shot.y - 10, 20, 20);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

const SCENES = { jarvis, synthwave, cyberpunk, galaxie };

// ---------- Ablauf ----------

function draw(t, dt) {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  scene.frame(t, dt);
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  // Hinter einem offenen Fenster reicht die halbe Bildrate
  const step = document.getElementById('overlay-root')?.childElementCount ? STEP * 2 : STEP;
  if (now - last < step - 2) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  draw(clock, dt);
}

function run() {
  cancelAnimationFrame(raf);
  raf = 0;
  if (!scene || document.hidden) return; // beim Zurückkehren meldet sich visibilitychange
  const still = root.dataset.motion === 'off';
  draw(still ? STILL : clock, 0);
  if (still) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

function measure() {
  const w = Math.round(cv.clientWidth || innerWidth);
  const h = Math.round(cv.clientHeight || innerHeight);
  const d = Math.min(2, devicePixelRatio || 1);
  if (w === W && h === H && d === dpr) return false;
  W = w;
  H = h;
  dpr = d;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

let resizeRaf = 0;
function onResize() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    if (!cv || !measure()) return;
    scene.resize();
    run();
  });
}

function teardown() {
  if (!cv) return;
  cancelAnimationFrame(raf);
  cancelAnimationFrame(resizeRaf);
  raf = 0;
  removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', run);
  cv.remove();
  cv = null;
  ctx = null;
  scene = null;
  sceneKey = '';
  W = 0;
  H = 0;
}

function sync() {
  const make = SCENES[root.dataset.skin];
  if (!make) {
    teardown();
    return;
  }
  if (!cv) {
    cv = document.createElement('canvas');
    cv.className = 'bgfx';
    clock = STILL;
    cv.setAttribute('aria-hidden', 'true');
    document.body.append(cv);
    ctx = cv.getContext('2d');
    addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', run);
  }
  const resized = measure();
  const p = palette();
  const key = `${root.dataset.skin}|${p.key}`;
  if (key !== sceneKey) {
    sceneKey = key;
    scene = make(p);
    scene.resize();
  } else if (resized) {
    scene.resize();
  }
  run();
}

new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-skin', 'data-mode', 'data-motion', 'style'] });
sync();

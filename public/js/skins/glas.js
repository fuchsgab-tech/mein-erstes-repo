// Stil „Liquid Glass“ – große, weiche Farbflächen treiben langsam hinter mattiertem Glas,
// ab und zu wandert ein breiter Lichtstreif darüber.
// skin: Eintrag für die Stil-Auswahl (Vorschau-Farben je Hell/Dunkel).
// scene(p, kit): bewegter Hintergrund (siehe js/bgfx.js).
//
// Die Farbflächen sind ohnehin unscharf – deshalb zeichnen wir sie in eine Ebene mit einem Viertel
// der Auflösung und ziehen sie am Ende in einem Schritt auf volle Größe. Das kostet fast nichts.

// Vorschau: vier Farbwolken, ein Lichtstreif
const PREVIEW = (cols, sheen, base) => [
  `linear-gradient(118deg, transparent 36%, ${sheen} 46%, transparent 57%)`,
  `radial-gradient(52% 44% at 18% 20%, ${cols[0]}, transparent 70%)`,
  `radial-gradient(46% 42% at 84% 28%, ${cols[1]}, transparent 70%)`,
  `radial-gradient(54% 46% at 66% 86%, ${cols[2]}, transparent 70%)`,
  `radial-gradient(42% 38% at 12% 88%, ${cols[3]}, transparent 70%)`,
  base,
].join(', ');

export const skin = {
  id: 'glas', name: 'Liquid Glass', desc: 'Live · Glas & Licht', live: true,
  light: {
    bg: PREVIEW(['rgba(64,140,255,.85)', 'rgba(170,110,255,.8)', 'rgba(255,120,170,.8)', 'rgba(255,180,96,.8)'], 'rgba(255,255,255,.8)', 'linear-gradient(180deg, #f4f7fc, #e3e8f3)'),
    surface: 'rgba(255,255,255,.62)', accent: '#0062d6', text: '#0b1220',
  },
  dark: {
    bg: PREVIEW(['rgba(64,150,255,.75)', 'rgba(126,80,255,.75)', 'rgba(255,64,150,.7)', 'rgba(0,196,214,.65)'], 'rgba(255,255,255,.22)', 'linear-gradient(180deg, #0b0e1c, #04050b)'),
    surface: 'rgba(28,30,44,.6)', accent: '#6ab8ff', text: '#f4f6fb', glow: true,
  },
};

// ---------- Vorlagen ----------

// Weiche Farbwolke: fällt fast wie eine Glockenkurve ab, damit keine Kante sichtbar wird
function blobSprite(kit, col) {
  const S = 128;
  const { c, g } = kit.layer(S, S, false);
  const r = S / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  const stops = [[0, 1], [0.2, 0.9], [0.4, 0.66], [0.6, 0.36], [0.8, 0.12], [1, 0]];
  for (const [o, a] of stops) grd.addColorStop(o, kit.rgba(col, a));
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return c;
}

// Lichtstreif quer: hell in der Mitte, ein schwacher Begleiter daneben
function sheenSprite(kit, col) {
  const w = 128;
  const { c, g } = kit.layer(w, 1, false);
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, kit.rgba(col, 0));
  grd.addColorStop(0.3, kit.rgba(col, 0.1));
  grd.addColorStop(0.42, kit.rgba(col, 0));
  grd.addColorStop(0.62, kit.rgba(col, 1));
  grd.addColorStop(0.8, kit.rgba(col, 0.25));
  grd.addColorStop(1, kit.rgba(col, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, w, 1);
  return c;
}

// ---------- Szene ----------

// Grundlage der Farbwolken (Anteile der freien Fläche): x, y, Größe, Farbe
const LAYOUT = [
  [0.16, 0.14, 0.62, 0],
  [0.88, 0.24, 0.56, 1],
  [0.68, 0.86, 0.62, 2],
  [0.08, 0.8, 0.5, 3],
  [0.5, 0.48, 0.36, 4],
  [0.36, 1.02, 0.44, 1],
  [0.98, 0.66, 0.4, 3],
];
const SC = 4; // Viertel-Auflösung
const SWEEP = 21; // alle 21 s ein Lichtstreif …
const SWEEP_LEN = 9; // … der 9 s braucht
// Die Wolken ziehen so langsam, dass zehn neue Bilder pro Sekunde reichen: Die kleine Ebene wird jedes
// dritte Mal neu gemalt, das Hochziehen auf volle Größe in drei Streifen auf drei Bilder verteilt.
const BANDS = 3;

export function scene(p, kit) {
  const { clamp, TAU } = kit;
  const k = p.k;
  const dark = p.dark;
  const COLS = [p.a, p.b, p.c, p.d, p.s4];
  const blobs = COLS.map((c) => blobSprite(kit, c));
  const sheen = sheenSprite(kit, p.s1);
  const aMain = (dark ? 0.52 : 0.5) * k;
  const aLobe = (dark ? 0.38 : 0.4) * k;

  // je Wolke: x, y, Radius, Farbe, Bahn x/y, Tempo, Phase, Atmen, Lappen-Tempo, Drehung
  const F = 11;
  const B = new Float32Array(LAYOUT.length * F);
  let nb = 0;
  let q = null;
  let base = null;
  let calm = null;
  let veil = null;
  let QW = 1;
  let QH = 1;
  let band = 0;

  function paintBase() {
    base = kit.layer(QW, QH, false);
    const g = base.g;
    const grd = g.createLinearGradient(0, 0, QW * 0.3, QH);
    grd.addColorStop(0, kit.rgba(p.s2, 1));
    grd.addColorStop(1, kit.rgba(p.s3, 1));
    g.fillStyle = grd;
    g.fillRect(0, 0, QW, QH);
    // Kopfzeile: leichter Schleier, damit Titel und Knöpfe auf dem Hintergrund gut lesbar bleiben
    const vh = Math.ceil(150 / SC);
    veil = kit.layer(1, vh, false);
    const vg = veil.g.createLinearGradient(0, 0, 0, vh);
    vg.addColorStop(0, kit.rgba(p.s2, dark ? 0.42 : 0.48));
    vg.addColorStop(0.55, kit.rgba(p.s2, dark ? 0.26 : 0.3));
    vg.addColorStop(1, kit.rgba(p.s2, 0));
    veil.g.fillStyle = vg;
    veil.g.fillRect(0, 0, 1, vh);
    // Seitenleiste: ruhiger Schleier über den Farben
    calm = null;
    const sw = kit.sideW() / SC;
    if (sw > 0) {
      calm = kit.layer(Math.ceil(sw * 1.5), 1, false);
      const cg = calm.g.createLinearGradient(0, 0, sw * 1.5, 0);
      cg.addColorStop(0, kit.rgba(p.s2, dark ? 0.62 : 0.5));
      cg.addColorStop(0.62, kit.rgba(p.s2, dark ? 0.42 : 0.3));
      cg.addColorStop(1, kit.rgba(p.s2, 0));
      calm.g.fillStyle = cg;
      calm.g.fillRect(0, 0, sw * 1.5, 1);
    }
  }

  // Szene in die kleine Ebene malen
  function paint(t) {
    const g = q.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(base.c, 0, 0);

    // Farbwolken: jede besteht aus einem Kern und einem Lappen, der um ihn kreist – so verformt sie sich
    g.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    for (let i = 0; i < nb; i++) {
      const j = i * F;
      const ph = B[j + 7];
      const w = B[j + 6];
      const x = B[j] + Math.sin(t * w + ph) * B[j + 4];
      const y = B[j + 1] + Math.cos(t * w * 0.83 + ph * 1.7) * B[j + 5];
      const r = B[j + 2];
      const br = t * B[j + 8] + ph;
      const sx = r * (1 + 0.16 * Math.sin(br));
      const sy = r * (1 + 0.16 * Math.cos(br * 1.27));
      const rot = t * B[j + 9] * 0.5 + B[j + 10];
      const co = Math.cos(rot);
      const si = Math.sin(rot);
      const img = blobs[B[j + 3]];
      g.globalAlpha = aMain;
      g.setTransform(co * sx, si * sx, -si * sy, co * sy, x, y);
      g.drawImage(img, -1, -1, 2, 2);
      // Lappen
      const la = t * B[j + 9] + ph * 2.3;
      const lx = x + Math.cos(la) * r * 0.5;
      const ly = y + Math.sin(la) * r * 0.42;
      const lr = r * (0.58 + 0.08 * Math.sin(br * 0.7 + 1));
      g.globalAlpha = aLobe;
      g.setTransform(lr, 0, 0, lr * 0.86, lx, ly);
      g.drawImage(img, -1, -1, 2, 2);
    }

    // Kopfzeile und Seitenleiste ruhiger halten
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(veil.c, 0, 0, QW, veil.c.height);
    if (calm) g.drawImage(calm.c, 0, 0, calm.c.width, QH);

    // Lichtstreif: wandert gelegentlich schräg über alles
    const u = ((((t + 1.05) % SWEEP) + SWEEP) % SWEEP) / SWEEP_LEN;
    if (u < 1) {
      const env = Math.sin(u * Math.PI) ** 2;
      const a = -0.42;
      const co = Math.cos(a);
      const si = Math.sin(a);
      const bw = QW * 0.55 + QH * 0.15;
      const L = (QW + QH) * 1.6;
      const x = -bw * 0.6 + (QW + bw * 1.2) * u;
      g.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      g.globalAlpha = env * (dark ? 0.13 : 0.42) * k;
      g.setTransform(co * bw, si * bw, -si * L, co * L, x, QH * 0.5);
      g.drawImage(sheen, -0.5, -0.5, 1, 1);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  // kleine Ebene auf volle Größe ziehen – ganz (b < 0) oder nur einen Streifen
  function blit(b) {
    const { W, H, dpr, ctx } = kit;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    if (b >= 0) {
      const h = Math.ceil((H * dpr) / BANDS);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, b * h, W * dpr, h);
      ctx.clip();
    }
    ctx.drawImage(q.c, 0, 0, QW * SC * dpr, QH * SC * dpr);
    if (b >= 0) ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  return {
    resize() {
      const { W, H } = kit;
      QW = Math.max(8, Math.ceil(W / SC));
      QH = Math.max(8, Math.ceil(H / SC));
      q = kit.layer(QW, QH, false);
      paintBase();
      const sw = kit.sideW();
      const cw = W - sw;
      const D = Math.sqrt(cw * H);
      const rnd = kit.seeded(4242);
      // auf großen Flächen ein paar Wolken mehr
      nb = clamp(Math.round((cw * H) / 110000), 5, LAYOUT.length);
      for (let i = 0; i < nb; i++) {
        const [fx, fy, fr, ci] = LAYOUT[i];
        const j = i * F;
        B[j] = (sw + cw * fx) / SC;
        B[j + 1] = (H * fy) / SC;
        B[j + 2] = (D * fr) / SC;
        B[j + 3] = ci;
        B[j + 4] = (cw * rnd(0.08, 0.16)) / SC;
        B[j + 5] = (H * rnd(0.06, 0.12)) / SC;
        B[j + 6] = rnd(0.05, 0.09) * (rnd() < 0.5 ? -1 : 1);
        B[j + 7] = rnd(0, TAU);
        B[j + 8] = rnd(0.11, 0.2);
        B[j + 9] = rnd(0.07, 0.13) * (rnd() < 0.5 ? -1 : 1);
        B[j + 10] = rnd(0, TAU);
      }
      band = 0;
    },

    frame(t, dt) {
      // Standbild oder erstes Bild nach einer Größenänderung: alles auf einmal
      if (!dt) {
        paint(t);
        blit(-1);
        band = 0;
        return;
      }
      if (band === 0) paint(t);
      blit(band);
      band = (band + 1) % BANDS;
    },
  };
}

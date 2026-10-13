// Stil „Matrix“ – grüner Zeichenregen wie auf einem alten Röhrenmonitor.
// skin: Eintrag für die Stil-Auswahl (Vorschau-Farben je Hell/Dunkel).
// scene(p, kit): bewegter Hintergrund (siehe js/bgfx.js).

// Vorschau: ein paar Regenspuren, unten jeweils ein heller Kopf
const rain = (col, head, list) => list
  .map(([x, y, h]) => `linear-gradient(180deg, transparent, ${col} 86%, ${head} 96%, transparent) ${x}% ${y}% / 3px ${h}% no-repeat`)
  .join(', ');
const DROPS = [[6, 8, 46], [15, 70, 34], [24, 18, 58], [37, 52, 30], [49, 4, 40], [58, 60, 38], [69, 22, 50], [81, 66, 30], [90, 6, 44], [97, 40, 36]];

export const skin = {
  id: 'matrix', name: 'Matrix', desc: 'Live · Digitaler Regen', live: true,
  light: {
    bg: `${rain('rgba(10,122,53,.4)', '#06210f', DROPS)}, repeating-linear-gradient(180deg, rgba(10,122,53,.07) 0 1px, transparent 1px 3px), linear-gradient(180deg, #f4f9ec, #e2efd9)`,
    surface: 'rgba(251,253,244,.84)', accent: '#0a7a35', text: '#06210f',
  },
  dark: {
    bg: `${rain('rgba(61,255,122,.5)', '#eafff0', DROPS)}, radial-gradient(70% 60% at 50% 45%, rgba(61,255,122,.16), transparent 70%), repeating-linear-gradient(180deg, rgba(0,0,0,.35) 0 1px, transparent 1px 3px), #020a04`,
    surface: 'rgba(2,14,7,.8)', accent: '#3dff7a', text: '#d4ffe0', glow: true,
  },
};

// Halbbreiten-Katakana, Ziffern und ein paar Zeichen – wie im Film
const GLYPHS = [...'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.=*+<>¦'];
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "Hiragino Sans", "Yu Gothic", "Noto Sans JP", monospace';

// Drei Tiefen: fern (klein, matt, dicht), Mitte, nah (groß, hell, selten)
const LAYERS = [
  { size: 12, alpha: 0.46, sp: [5, 9], len: [12, 28], dens: 0.72, gap: [0.5, 1.2] },
  { size: 15, alpha: 0.64, sp: [7, 12], len: [10, 24], dens: 0.58, gap: [0.5, 1.3] },
  { size: 21, alpha: 0.82, sp: [9, 15], len: [8, 18], dens: 0.3, gap: [0.7, 1.8] },
];

// schnelle Ganzzahl-Streuung: welches Zeichen in welcher Zelle steht
function hash(a, b) {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  return x >>> 0;
}

// Der Regen springt Zeile für Zeile – 15 neue Bilder pro Sekunde reichen, dazwischen bleibt das Bild stehen
const TICK = 15;
const MAXHEADS = 600;

export function scene(p, kit) {
  const { rgba, seeded, clamp } = kit;
  const k = p.k;
  const N = GLYPHS.length;
  const lk = p.dark ? 1 : 0.85; // auf hellem Papier etwas zarter
  const TRAIL = rgba(p.a, 1);
  const HEAD = rgba(p.d, 1);
  const halo = kit.glow(p.a, 64, 0.22);
  const heads = new Float32Array(MAXHEADS * 3);
  let lay = [];
  let last = -1;

  return {
    resize() {
      const { W, H } = kit;
      const small = W <= 760;
      last = -1;
      // Spalten je Ebene: Tempo, Versatz, Spurlänge, Abstand der Tropfen, Startwert für die Zeichen
      lay = LAYERS.map((L, li) => {
        const size = small ? Math.round(L.size * 0.9) : L.size;
        const cw = Math.ceil(size * 0.82);
        const ch = Math.ceil(size * 1.12);
        const n = Math.ceil(W / cw) + 1;
        const rows = Math.ceil(H / ch) + 1;
        const rnd = seeded(1999 + li * 131);
        // auf großen Bildschirmen etwas lichter, damit die Zahl der Zeichen nicht ausufert
        const dens = L.dens * clamp(Math.sqrt(700000 / (W * H)), 0.62, 1);
        const d = new Float32Array(n * 5);
        for (let c = 0; c < n; c++) {
          const o = c * 5;
          const on = rnd() < dens;
          const len = Math.round(rnd(L.len[0], L.len[1]));
          d[o] = rnd(L.sp[0], L.sp[1]);
          d[o + 2] = on ? len : 0;
          d[o + 3] = len + Math.round(rows * rnd(L.gap[0], L.gap[1]));
          d[o + 1] = rnd(0, d[o + 3]);
          d[o + 4] = Math.floor(rnd(1, 1e6));
        }
        return { size, cw, ch, n, rows, d, font: `${size >= 18 ? 600 : 500} ${size}px ${FONT}` };
      });
    },

    // Grund, Röhrenzeilen und Rand kommen aus dem CSS – hier nur die Zeichen auf durchsichtigem Grund
    frame(t, dt) {
      const step = Math.floor(t * TICK);
      if (dt && step === last) return;
      last = step;
      t = step / TICK;
      const { ctx, W, H } = kit;
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const sw = kit.sideW();
      for (let li = 0; li < 3; li++) {
        const { cw, ch, n, rows, d, font, size } = lay[li];
        const base = LAYERS[li].alpha * k * lk;
        let nh = 0;
        ctx.font = font;
        ctx.fillStyle = TRAIL;
        for (let c = 0; c < n; c++) {
          const o = c * 5;
          const len = d[o + 2];
          if (!len) continue;
          const x = c * cw + cw / 2;
          // hinter der Seitenleiste bleibt es ruhig (dort sähe man ohnehin kaum etwas)
          if (x < sw) continue;
          const a0 = base;
          const cyc = d[o + 3];
          const seed = d[o + 4];
          const hd = Math.floor(t * d[o] + d[o + 1]);
          for (let h = hd % cyc; h - len < rows; h += cyc) {
            for (let s = Math.max(0, h - rows + 1); s < len; s++) {
              const r = h - s;
              if (r < 0) break;
              const hs = hash(seed, r);
              let gi = hs % N;
              // manche Zeichen wechseln ab und zu
              if (!(hs & 0x700)) gi = (gi + Math.floor(t * 1.4 + (hs >>> 22) / 1024)) % N;
              const y = r * ch + ch / 2;
              // hinter der Titelzeile ist die nahe Ebene gedämpft
              const a1 = li === 2 && y < 72 ? a0 * 0.55 : a0;
              if (s) {
                const f = 1 - s / len;
                const a = a1 * f * f;
                if (a < 0.03) break; // das Ende der Spur sieht man kaum – weglassen spart viel
                ctx.globalAlpha = a;
                ctx.fillText(GLYPHS[gi], x, y);
              } else if (nh < MAXHEADS) {
                heads[nh * 3] = x;
                heads[nh * 3 + 1] = y;
                heads[nh * 3 + 2] = gi + a1 * 0.999; // Zeichen und Helligkeit in einer Zahl
                nh++;
              }
            }
          }
        }
        // helle Köpfe mit weichem Schein (ferne Ebene ohne Schein)
        const hr = size * 1.7;
        if (li) {
          for (let i = 0; i < nh; i++) {
            ctx.globalAlpha = (heads[i * 3 + 2] % 1) * (p.dark ? 0.55 : 0.25);
            ctx.drawImage(halo, heads[i * 3] - hr / 2, heads[i * 3 + 1] - hr / 2, hr, hr);
          }
        }
        ctx.fillStyle = HEAD;
        for (let i = 0; i < nh; i++) {
          const v = heads[i * 3 + 2];
          ctx.globalAlpha = clamp((v % 1) * 1.3, 0, 1);
          ctx.fillText(GLYPHS[Math.floor(v)], heads[i * 3], heads[i * 3 + 1]);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}

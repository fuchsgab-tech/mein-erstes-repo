// Stil „Arcade“ – Spielhalle der 80er: Pixel-Sterne, Weltraum-Invasoren, ein Mampfer auf Punktejagd und Münzen.
// skin: Eintrag für die Stil-Auswahl (Vorschau-Farben je Hell/Dunkel).
// scene(p, kit): bewegter Hintergrund (siehe js/bgfx.js).

// Vorschau: Pixel-Sterne und Bildröhren-Zeilen (den hüpfenden Invasor malt die Stil-Auswahl selbst)
const stars = (list) => list.map(([x, y, c]) => `linear-gradient(${c}, ${c}) ${x}% ${y}% / 2px 2px no-repeat`).join(', ');

export const skin = {
  id: 'arcade', name: 'Arcade', desc: 'Live · 8-Bit & Röhrenbild', live: true,
  light: {
    bg: `${stars([[12, 30, '#306230'], [30, 80, '#306230'], [70, 22, '#306230'], [88, 64, '#306230'], [52, 90, '#306230']])}, linear-gradient(90deg, rgba(48,98,48,.1) 1px, transparent 1px) 0 0 / 4px 4px, linear-gradient(rgba(48,98,48,.1) 1px, transparent 1px) 0 0 / 4px 4px, linear-gradient(180deg, #e8efcd, #d3dea6)`,
    surface: 'rgba(243,247,226,.88)', accent: '#a3195b', text: '#142a0e',
  },
  dark: {
    bg: `${stars([[10, 24, '#29f0ff'], [28, 70, '#fff'], [44, 12, '#fff'], [66, 84, '#ffe14d'], [82, 30, '#fff'], [93, 66, '#ff4fd8'], [56, 50, '#b9a8ff'], [18, 92, '#b9a8ff']])}, radial-gradient(70% 60% at 70% 0%, rgba(255,79,216,.28), transparent 70%), repeating-linear-gradient(180deg, rgba(0,0,0,.3) 0 1px, transparent 1px 3px), linear-gradient(180deg, #0c0420, #1d0a3d)`,
    surface: 'rgba(20,9,46,.82)', accent: '#ff4fd8', text: '#f6f0ff', glow: true,
  },
};

// ---------- Pixel-Figuren (# = Farbe, W = Augenweiß, B = Pupille) ----------

const SQUID = [
  ['...##...', '..####..', '.######.', '##.##.##', '########', '..#..#..', '.#.##.#.', '#.#..#.#'],
  ['...##...', '..####..', '.######.', '##.##.##', '########', '.#.##.#.', '#......#', '.#....#.'],
];
const CRAB = [
  ['..#.....#..', '...#...#...', '..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...'],
  ['..#.....#..', '#..#...#..#', '#.#######.#', '###.###.###', '###########', '.#########.', '..#.....#..', '.#.......#.'],
];
const OCTO = [
  ['....####....', '.##########.', '############', '###..##..###', '############', '...##..##...', '..##.##.##..', '##........##'],
  ['....####....', '.##########.', '############', '###..##..###', '############', '..###..###..', '.##..##..##.', '..##....##..'],
];
const UFO = ['.....######.....', '...##########...', '..############..', '.##.##.##.##.##.', '################', '..###..##..###..', '...#........#...'];
const GHOST_TOP = [
  '.....####.....', '...########...', '..##########..', '.##WW####WW##.', '.#WWWW##WWWW#.', '.#WWBB##WWBB#.',
  '##WWBB##WWBB##', '###WW####WW###', '##############', '##############', '##############', '##############',
];
const GHOST = [
  [...GHOST_TOP, '##.###..###.##', '#...##..##...#'],
  [...GHOST_TOP, '####.####.####', '.##...##...##.'],
];

// Mampfer: Kreis mit Mund (offen, halb, zu)
function chomper(m) {
  const rows = [];
  for (let y = 0; y < 13; y++) {
    let r = '';
    for (let x = 0; x < 13; x++) {
      const dx = x - 6;
      const dy = y - 6;
      const inMouth = dx > 0 && Math.abs(Math.atan2(dy, dx)) < m;
      r += dx * dx + dy * dy <= 42 && !inMouth ? '#' : '.';
    }
    rows.push(r);
  }
  return rows;
}

// Münze, die sich dreht (volle Breite bis hochkant)
function coin(hw) {
  const rows = [];
  for (let y = 0; y < 8; y++) {
    let r = '';
    for (let x = 0; x < 8; x++) {
      const dx = (x - 3.5) / hw;
      const dy = (y - 3.5) / 4;
      const d = dx * dx + dy * dy;
      r += d <= 1 ? (d > 0.45 || hw < 1.5 ? '#' : x === 3 || x === 4 ? 'B' : 'W') : '.';
    }
    rows.push(r);
  }
  return rows;
}

export function scene(p, kit) {
  const { layer, rgba, mix, seeded, clamp } = kit;
  const k = p.k;
  const eyeW = p.dark ? p.d : p.s1;
  const eyeB = p.dark ? p.s1 : p.b;
  let s = 3;
  let spr = null;
  let stars = null;
  let ranges = [];
  let starCol = [];
  let lay = {};

  // Figur einmal in Endgröße malen (scharfe Pixel), im Dunkeln mit leichtem Leuchten
  function sprite(rows, col, glow = p.dark) {
    const w = rows[0].length * s;
    const h = rows.length * s;
    const pad = glow ? 4 : 0;
    const body = layer(w, h);
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        body.g.fillStyle = rgba(ch === 'W' ? eyeW : ch === 'B' ? eyeB : col, 1);
        body.g.fillRect(x * s, y * s, s, s);
      }
    }
    if (!pad) return { c: body.c, w, h, pad };
    const out = layer(w + pad * 2, h + pad * 2);
    out.g.shadowColor = rgba(col, 0.75);
    out.g.shadowBlur = 5 * kit.dpr;
    out.g.drawImage(body.c, pad, pad, w, h);
    out.g.shadowBlur = 0;
    out.g.drawImage(body.c, pad, pad, w, h);
    return { c: out.c, w: w + pad * 2, h: h + pad * 2, pad };
  }

  function put(sp, x, y, a) {
    kit.ctx.globalAlpha = a;
    kit.ctx.drawImage(sp.c, Math.round(x - sp.pad), Math.round(y - sp.pad), sp.w, sp.h);
  }

  return {
    resize() {
      const { W, H } = kit;
      const wide = W > 760;
      s = wide ? 3 : 2;
      const coinCol = p.c;
      spr = {
        fleet: [SQUID, CRAB, OCTO].map((f, i) => f.map((rows) => sprite(rows, [p.b, p.a, p.c][i]))),
        ufo: sprite(UFO, p.s4),
        chomp: [0.8, 0.42, 0.06].map((m) => sprite(chomper(m), p.c)),
        ghost: [p.a, p.b, p.s4].map((col) => GHOST.map((rows) => sprite(rows, col))),
        coin: [4, 2.6, 1, 2.6].map((hw) => sprite(coin(hw), coinCol, false)),
      };

      // Sterne: drei Tiefen und ein paar bunte, die blinken (nach Farbe sortiert)
      const rnd = seeded(1981);
      const n = clamp(Math.round((W * H) / 1700), 80, 340);
      const list = [];
      for (let i = 0; i < n; i++) {
        const depth = rnd() < 0.55 ? 0 : rnd() < 0.7 ? 1 : 2;
        const blink = rnd() < 0.14;
        list.push({ g: blink ? 3 + Math.floor(rnd(0, 3)) : depth, x: rnd(0, W), y: rnd(0, H), v: [7, 16, 34][depth] * rnd(0.85, 1.15), ph: rnd(0, 6.3), sp: rnd(1.5, 4) });
      }
      list.sort((a, b) => a.g - b.g);
      stars = new Float32Array(n * 5);
      ranges = [0, 0, 0, 0, 0, 0, 0];
      list.forEach((st, i) => {
        stars.set([st.x, st.y, st.v, st.ph, st.sp], i * 5);
        ranges[st.g + 1] = i + 1;
      });
      for (let g = 1; g < ranges.length; g++) ranges[g] = Math.max(ranges[g], ranges[g - 1]);
      starCol = [
        [rgba(p.s3, 1), (p.dark ? 0.6 : 0.32) * k, 1.5],
        [rgba(p.s3, 1), (p.dark ? 0.85 : 0.42) * k, 2],
        [rgba(p.d, 1), (p.dark ? 1 : 0.5) * k, s],
        [rgba(p.a, 1), (p.dark ? 0.95 : 0.5) * k, 2],
        [rgba(p.b, 1), (p.dark ? 0.95 : 0.5) * k, 2],
        [rgba(p.c, 1), (p.dark ? 0.95 : 0.5) * k, 2],
      ];

      // Wege der Figuren: Flotte oben, Mampfer unten, Münzen an den Rändern
      const sw = kit.sideW();
      const cols = W > 1100 ? 8 : wide ? 6 : 5;
      const gx = 16 * s;
      const gy = 13 * s;
      const fw = (cols - 1) * gx + 12 * s;
      const x0 = sw + (wide ? 40 : 14);
      const x1 = W - (wide ? 40 : 14) - fw;
      lay = {
        cols, gx, gy,
        x0, steps: Math.max(1, Math.floor((x1 - x0) / (3 * s))),
        y0: wide ? Math.round(H * 0.3) : Math.round(H * 0.26),
        lane: H - (wide ? 30 : 104),
        ufoY: wide ? 14 : 10,
        dotGap: 11 * s,
        dotStart: sw + 20,
        coinX: wide ? [sw + 6, W - 26] : [6, W - 22],
        dot: rgba(mix(p.d, p.c, 0.3), 1),
        // Flotte und Gespenster liegen oft hinter Überschriften der Liste – im Hellen etwas leiser
        fleetA: (p.dark ? 0.36 : 0.2) * k,
      };
    },

    frame(t) {
      const { ctx, W, H } = kit;
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;

      // Sterne fallen in Pixelschritten nach unten
      for (let g = 0; g < 6; g++) {
        const [col, a, size] = starCol[g];
        ctx.fillStyle = col;
        ctx.globalAlpha = a;
        for (let i = ranges[g]; i < ranges[g + 1]; i++) {
          const o = i * 5;
          if (g > 2 && Math.sin(t * stars[o + 4] + stars[o + 3]) < 0.1) continue;
          const y = (stars[o + 1] + stars[o + 2] * t) % (H + 4) - 2;
          ctx.fillRect(Math.round(stars[o]), Math.round(y), size, size);
        }
      }

      const L = lay;
      // gedämpft, damit Schrift davor ruhig lesbar bleibt (in der Liste liegt sie direkt darüber)
      const fa = (p.dark ? 0.36 : 0.24) * k;

      // Flotte marschiert hin und her und rückt nach jeder Runde ein Stück vor
      const n = Math.floor(t / 0.7);
      const sweep = Math.floor(n / L.steps);
      const pos = n % L.steps;
      const fx = L.x0 + (sweep % 2 ? L.steps - pos : pos) * 3 * s;
      const fy = L.y0 + (sweep % 5) * 4 * s;
      const fr = n % 2;
      for (let r = 0; r < 3; r++) {
        const sp = spr.fleet[r][fr];
        const off = r === 0 ? 2 * s : r === 1 ? 0.5 * s : 0;
        for (let c = 0; c < L.cols; c++) put(sp, fx + c * L.gx + off, fy + r * L.gy, L.fleetA);
      }

      // Ufo fliegt ab und zu oben vorbei
      const uc = t % 24;
      if (uc < 9) put(spr.ufo, -60 + (uc / 9) * (W + 120), L.ufoY, fa * 1.1);

      // Mampfer frisst die Punktereihe, Gespenster jagen hinterher
      const cx = ((t * 48) % (W + 520)) - 120;
      const dsz = 2 * s;
      ctx.fillStyle = L.dot;
      ctx.globalAlpha = fa * 0.9;
      const pellet = Math.floor(t * 3) % 2;
      for (let x = L.dotStart, i = 0; x < W - 8; x += L.dotGap, i++) {
        if (x < cx + 6 * s) continue;
        if (i % 8 === 4) {
          if (pellet) ctx.fillRect(x - s, L.lane - s - dsz / 2, dsz + 2 * s, dsz + 2 * s);
        } else ctx.fillRect(x, L.lane - dsz / 2, dsz, dsz);
      }
      const mf = [0, 1, 2, 1][Math.floor(t * 10) % 4];
      put(spr.chomp[mf], cx - 6.5 * s, L.lane - 6.5 * s, fa * 1.1);
      const gf = Math.floor(t * 6) % 2;
      for (let i = 0; i < 3; i++) put(spr.ghost[i][gf], cx - (26 + i * 18) * s, L.lane - 7 * s + Math.sin(t * 5 + i) * s, L.fleetA);

      // Münzen steigen an den Rändern auf und drehen sich
      for (let i = 0; i < 4; i++) {
        const y = H + 20 - ((t * (14 + i * 3) + i * 233) % (H + 60));
        put(spr.coin[Math.floor(t * 7 + i) % 4], L.coinX[i % 2], y, fa * 0.9);
      }
      ctx.globalAlpha = 1;
    },
  };
}

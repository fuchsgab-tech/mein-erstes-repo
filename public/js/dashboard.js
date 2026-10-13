// Übersicht „Heute“: Begrüßung, als Nächstes, Tagesablauf, Woche, nächste Wochen, Vorfreude, Neuigkeiten
import { h, icon } from './h.js';
import { dayShort, hours, monthName, relDay, time, weekdayName, WEEKDAYS } from './fmt.js';
import { hideTip, showTip } from './fx.js';
import { occFirstDay, occLastDay } from './recur.js';
import { attendeesFor, calById, eventColor, hooks, person, state, visibleOccurrences } from './state.js';
import { addDays, daysBetween, isoWeek, sameDay, startOfDay, startOfWeek } from './time.js';
import { avatarStack } from './ui.js';
import { feedItem, openActivity, openDay, openEditor, openEvent, openInvitePicker } from './sheets.js';
import { hasFriends, openFinder } from './finder.js';
import { quickBar } from './quick-add.js';

const pad2 = (n) => String(n).padStart(2, '0');
const phaseOf = (hr) => (hr >= 5 && hr < 8 ? 'dawn' : hr >= 8 && hr < 17 ? 'day' : hr >= 17 && hr < 20 ? 'dusk' : 'night');
const GREET = { dawn: ['Guten Morgen', '🌅'], day: ['Hallo', '☀️'], dusk: ['Guten Abend', '🌇'], night: ['Gute Nacht', '🌙'] };
const isMulti = (o) => o.allDay || !sameDay(occFirstDay(o), occLastDay(o));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Himmel ----------

function seeded(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function skyArt(phase) {
  const hills = `
    <path d="M-1400 176 C -1200 150, -1000 186, -800 170 S -500 150, -300 172 S -60 186, 40 178 S 300 148, 400 160 V 220 H -1400 Z" fill="rgba(255,255,255,.13)"/>
    <path d="M-1400 198 C -1150 182, -950 206, -700 192 S -350 180, -150 198 S 120 186, 250 192 S 360 182, 400 188 V 220 H -1400 Z" fill="rgba(255,255,255,.2)"/>`;
  const cloud = (x, y, s, cls, fill) => `
    <g transform="translate(${x} ${y}) scale(${s})"><g class="cloud ${cls}" fill="${fill}">
      <ellipse cx="0" cy="10" rx="36" ry="13"/><ellipse cx="18" cy="0" rx="22" ry="16"/><ellipse cx="-14" cy="3" rx="16" ry="12"/>
    </g></g>`;
  if (phase === 'night') {
    const rnd = seeded(7);
    let stars = '';
    for (let i = 0; i < 90; i++) {
      stars += `<circle class="star" cx="${(rnd() * 1500 - 1100).toFixed(1)}" cy="${(rnd() * 150).toFixed(1)}" r="${(0.6 + rnd() * 1.4).toFixed(1)}" fill="#fff" style="animation-delay:${(-rnd() * 3).toFixed(2)}s"/>`;
    }
    return `<svg viewBox="0 0 400 220" aria-hidden="true">
      <defs>
        <radialGradient id="zg-glow"><stop offset="0" stop-color="#fff8dc" stop-opacity=".55"/><stop offset="1" stop-color="#fff8dc" stop-opacity="0"/></radialGradient>
        <mask id="zg-moon"><rect width="400" height="220" fill="#fff"/><circle cx="336" cy="50" r="27" fill="#000"/></mask>
      </defs>
      ${stars}
      <line class="shoot" x1="250" y1="30" x2="290" y2="10" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="320" cy="62" r="70" fill="url(#zg-glow)"/>
      <circle cx="320" cy="62" r="28" fill="#fdf3cf" mask="url(#zg-moon)"/>
      ${hills}
    </svg>`;
  }
  const sun = {
    dawn: { cx: 300, cy: 150, r: 40, fill: '#ffe2a8' },
    day: { cx: 305, cy: 70, r: 34, fill: '#fff4b8' },
    dusk: { cx: 300, cy: 160, r: 46, fill: '#ffd27a' },
  }[phase];
  let rays = '';
  if (phase === 'day') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      rays += `<line x1="${(sun.cx + Math.cos(a) * 46).toFixed(1)}" y1="${(sun.cy + Math.sin(a) * 46).toFixed(1)}" x2="${(sun.cx + Math.cos(a) * 60).toFixed(1)}" y2="${(sun.cy + Math.sin(a) * 60).toFixed(1)}"/>`;
    }
  }
  const tint = { dawn: 'rgba(255,220,235,.85)', day: 'rgba(255,255,255,.92)', dusk: 'rgba(255,214,200,.7)' }[phase];
  return `<svg viewBox="0 0 400 220" aria-hidden="true">
    <defs><radialGradient id="zg-sun"><stop offset="0" stop-color="${sun.fill}" stop-opacity=".8"/><stop offset="1" stop-color="${sun.fill}" stop-opacity="0"/></radialGradient></defs>
    <circle cx="${sun.cx}" cy="${sun.cy}" r="${sun.r * 2.6}" fill="url(#zg-sun)"/>
    ${rays ? `<g class="sun-rays" stroke="rgba(255,250,215,.75)" stroke-width="4" stroke-linecap="round">${rays}</g>` : ''}
    <circle cx="${sun.cx}" cy="${sun.cy}" r="${sun.r}" fill="${sun.fill}"/>
    ${cloud(205, 100, 1, 'c1', tint)}
    ${cloud(350, 128, 0.7, 'c2', tint)}
    ${phase === 'dusk' ? '<path d="M150 70 q6 -6 12 0 q6 -6 12 0 M178 52 q4 -4 8 0 q4 -4 8 0" stroke="rgba(60,30,60,.5)" stroke-width="2" fill="none" stroke-linecap="round"/>' : ''}
    ${hills}
  </svg>`;
}

function skyCard(now, today, ticks) {
  const phase = phaseOf(now.getHours());
  const [hello, emoji] = GREET[phase];
  const first = (state.me.name || '').split(/\s+/)[0];
  const todays = visibleOccurrences(today, addDays(today, 1));
  const ws = startOfWeek(today);
  const weekCount = visibleOccurrences(ws, addDays(ws, 7)).length;
  const online = [...state.online].map(person);
  const clock = h('span', null, time(now));
  ticks.push(() => (clock.textContent = time(new Date())));

  const art = h('div.sky-art');
  art.innerHTML = skyArt(phase); // feste Grafik ohne Nutzereingaben

  return h('section.sky.span-12', { 'data-phase': phase },
    art,
    h('p.greet', null, `${hello}, ${first} ${emoji}`),
    h('div.date', null, `${weekdayName(now)}, ${now.getDate()}. ${monthName(now)} · KW ${isoWeek(now)}`),
    h('div.sky-pills', null,
      h('span.sky-pill', null, icon('clock', 16), clock),
      h('span.sky-pill', null, icon('calendar', 16), todays.length ? `${plural(todays.length, 'Termin', 'Termine')} heute` : 'Heute frei'),
      h('span.sky-pill', null, icon('week', 16), `${weekCount} diese Woche`),
      online.length
        ? h('span.sky-pill', null, h('span.live-dot'), avatarStack(online, 22, 3),
          online.length === 1 ? `${online[0].name} ist online` : `${online.length} sind online`)
        : null,
    ),
  );
}

// ---------- Als Nächstes ----------

// Zeit nach Wanduhr: An Tagen mit Zeitumstellung zählt die Stunde extra nicht mit
// (vom 12. Oktober 10:41 bis 26. Oktober 10:00 sind es 13 Tage 23 Std., nicht 14 Tage)
const wallMs = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());

function countdownParts(ms, withDays) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (withDays) return [[Math.floor(s / 86400), 'Tage'], [Math.floor((s % 86400) / 3600), 'Std.']];
  return [[Math.floor(s / 3600), 'Std.'], [Math.floor((s % 3600) / 60), 'Min.'], [s % 60, 'Sek.']];
}

function nextCard(now, today, ticks) {
  const occs = visibleOccurrences(addDays(today, -1), addDays(today, 120));
  const running = occs.find((o) => !o.allDay && o.start <= now && o.end > now);
  const o = running || occs.find((x) => !x.allDay && x.start > now) || occs.find((x) => x.allDay && occFirstDay(x) > today);
  if (!o) {
    return h('section.card.next.span-7', { style: { '--c': 'var(--accent)' } },
      h('div.card-head', null, h('h3', null, 'Als Nächstes')),
      h('div.empty.small', null, h('div.empty-art', null, '🌤️'), h('h3', null, 'Nichts geplant'), h('p', null, 'Zeit für etwas Schönes – mit deinen Leuten?')),
      h('div.row.center', null, h('button.btn.primary', { onclick: () => openEditor({ date: today }) }, icon('plus', 18), 'Termin anlegen')),
    );
  }
  const ev = o.ev;
  const cal = calById(ev.calendarId);
  const people = attendeesFor(ev, o.orig).map(person);
  const target = running ? o.end : o.start;
  const withDays = !running && wallMs(target) - wallMs(now) >= 864e5;
  // Tage & Stunden nach Kalender, kurze Countdowns in echter Zeit
  const remaining = (t) => (withDays ? wallMs(target) - wallMs(t) : target - t);
  const nums = [];
  const countdown = h('div.countdown', { 'aria-live': 'off' });
  countdownParts(remaining(now), withDays).forEach(([n, lbl], i) => {
    if (i) countdown.append(h('span.cd-sep', null, ':'));
    const num = h('span.cd-num', null, withDays ? n : pad2(n));
    nums.push(num);
    countdown.append(h('span.cd-unit', null, num, h('span.cd-lbl', null, lbl)));
  });
  const meter = running ? h('i', { style: { width: '0%' } }) : null;
  let fired = false;
  const tick = () => {
    const t = new Date();
    const left = target - t;
    if (left <= 0) {
      if (!fired) {
        fired = true;
        setTimeout(() => hooks.render(), 300);
      }
      return;
    }
    countdownParts(remaining(t), withDays).forEach(([n], i) => {
      nums[i].textContent = withDays ? n : pad2(n);
    });
    if (meter) meter.style.width = `${Math.min(100, ((t - o.start) / (o.end - o.start)) * 100).toFixed(2)}%`;
  };
  tick();
  ticks.push(tick);

  const rel = relDay(occFirstDay(o));
  const whenText = o.allDay ? 'Ganztägig' : `${time(o.start)} – ${time(o.end)}`;
  return h('section.card.next.span-7', { style: { '--c': eventColor(ev) }, onclick: () => openEvent(o), role: 'button', tabindex: '0' },
    h('div.when-label', null,
      running ? h('span.live-dot.red') : icon('sparkle', 16),
      running ? 'Läuft gerade – noch' : `Als Nächstes · ${rel || dayShort(o.start)}`,
    ),
    h('h2', null, ev.title),
    h('div.sub', null,
      h('span', null, icon('clock', 15), whenText),
      cal ? h('span', null, `${cal.emoji} ${cal.name}`) : null,
      ev.location ? h('span', null, icon('pin', 15), ev.location) : null,
    ),
    countdown,
    meter ? h('div.meter', { role: 'progressbar', 'aria-label': 'Fortschritt' }, meter) : null,
    h('div.people-row', null,
      people.length ? avatarStack(people, 26, 4, (id) => state.online.has(id)) : null,
      people.length ? `${plural(people.length, 'Person ist', 'Personen sind')} dabei` : 'Noch keine Zusagen – sag als Erste:r zu!',
    ),
  );
}

// ---------- Heute ----------

function todayCard(now, today) {
  const todays = visibleOccurrences(today, addDays(today, 1));
  const blocks = todays.filter(isMulti);
  const timed = todays.filter((o) => !isMulti(o));
  const list = h('div.timeline');
  let nowPlaced = false;
  const nowMarker = () => h('div.tl-now', null, `Jetzt · ${time(now)}`);
  for (const o of timed) {
    if (!nowPlaced && o.start > now) {
      list.append(nowMarker());
      nowPlaced = true;
    }
    const cls = o.end <= now ? 'past' : o.start <= now ? 'now' : '';
    list.append(h('button.tl-item', { class: cls, style: { '--c': eventColor(o.ev) }, onclick: () => openEvent(o) },
      h('span.t', null, time(o.start)), h('span.d'), h('span.n', null, o.ev.title)));
  }
  if (timed.length && !nowPlaced) list.append(nowMarker());

  return h('section.card.span-5', null,
    h('div.card-head', null,
      h('h3', null, 'Heute'),
      h('button.icon-btn.sm', { title: 'Termin für heute', 'aria-label': 'Termin für heute', onclick: () => openEditor({ date: today }) }, icon('plus', 16)),
    ),
    blocks.length ? h('div.allday-chips', null, blocks.map((o) => h('button.ad-chip', { style: { '--c': eventColor(o.ev) }, onclick: () => openEvent(o) }, o.ev.title))) : null,
    timed.length ? list : h('div.empty.small', null, h('div.empty-art', null, blocks.length ? '🌿' : '☀️'), h('p', null, blocks.length ? 'Sonst keine festen Termine.' : 'Heute ist nichts geplant.')),
  );
}

// ---------- Woche (Säulen) ----------

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

function weekCard(today) {
  const ws = startOfWeek(today);
  const occs = visibleOccurrences(ws, addDays(ws, 7));
  const hrs = Array(7).fill(0);
  const cnt = Array(7).fill(0);
  for (const o of occs) {
    for (let i = 0; i < 7; i++) {
      const d0 = addDays(ws, i);
      const d1 = addDays(ws, i + 1);
      if (o.start < d1 && (o.end > d0 || (o.end - o.start === 0 && o.start >= d0))) {
        cnt[i]++;
        if (!o.allDay) hrs[i] += (Math.min(o.end, d1) - Math.max(o.start, d0)) / 36e5;
      }
    }
  }
  const total = hrs.reduce((a, b) => a + b, 0);
  const W = 460;
  const H = 190;
  const m = { l: 36, r: 6, t: 12, b: 28 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const peak = Math.max(...hrs);
  const step = peak <= 4 ? 1 : peak <= 8 ? 2 : peak <= 16 ? 4 : 6;
  const top = Math.max(step * 2, Math.ceil(peak / step) * step);
  const y0 = m.t + ph;

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Verplante Stunden pro Tag in dieser Woche' });
  const grid = svg('g', { class: 'grid' });
  for (let v = 0; v <= top; v += step) {
    const y = y0 - (v / top) * ph;
    grid.append(svg('line', { x1: m.l, x2: W - m.r, y1: y, y2: y }));
    grid.append(svg('text', { class: 'tick', x: m.l - 8, y, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, `${v} h`));
  }
  root.append(grid);

  const slot = pw / 7;
  const bw = Math.min(24, slot * 0.5);
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const isToday = sameDay(d, today);
    const x = m.l + slot * i + (slot - bw) / 2;
    const bh = (hrs[i] / top) * ph;
    const hit = svg('rect', { class: 'hit', x: m.l + slot * i, y: m.t, width: slot, height: ph + m.b, tabindex: '0', 'aria-label': `${weekdayName(d)}: ${hours(hrs[i])}, ${plural(cnt[i], 'Termin', 'Termine')}` });
    root.append(hit);
    let col = null;
    if (bh > 0.5) {
      const r = Math.min(4, bh, bw / 2);
      const y = y0 - bh;
      col = svg('path', {
        class: `col${isToday ? ' today' : ''}`,
        d: `M${x},${y0} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${y0} Z`,
        style: `animation-delay:${i * 0.05}s`,
      });
      root.append(col);
    }
    root.append(svg('text', { class: `xl${isToday ? ' today' : ''}`, x: m.l + slot * i + slot / 2, y: H - 8, 'text-anchor': 'middle' }, WEEKDAYS[i]));
    const enter = () => {
      col?.classList.add('hover');
      showTip(col || hit, `${weekdayName(d)}, ${d.getDate()}.`, `${hours(hrs[i])} verplant · ${plural(cnt[i], 'Termin', 'Termine')}`);
    };
    const leave = () => {
      col?.classList.remove('hover');
      hideTip();
    };
    hit.addEventListener('pointerenter', enter);
    hit.addEventListener('pointerleave', leave);
    hit.addEventListener('focus', enter);
    hit.addEventListener('blur', leave);
    hit.addEventListener('click', () => {
      hideTip();
      openDay(d);
    });
  }

  const table = h('table.sr-only', null,
    h('caption', null, 'Verplante Stunden pro Tag'),
    h('tbody', null, WEEKDAYS.map((wd, i) => h('tr', null, h('th', null, wd), h('td', null, hours(hrs[i])), h('td', null, plural(cnt[i], 'Termin', 'Termine'))))));

  return h('section.card.span-6.half', null,
    h('div.card-head', null, h('h3', null, 'Diese Woche')),
    h('div.stat', null, h('b', null, hours(total)), h('span', null, `verplant · ${plural(occs.length, 'Termin', 'Termine')}`)),
    h('div.chart', null, root),
    table,
  );
}

// ---------- Nächste 5 Wochen (Heatmap) ----------

const HEAT = [
  'var(--surface-2)',
  'color-mix(in srgb, var(--accent) 26%, var(--surface-2))',
  'color-mix(in srgb, var(--accent) 48%, var(--surface-2))',
  'color-mix(in srgb, var(--accent) 72%, var(--surface-2))',
  'var(--accent)',
];

function heatCard(today) {
  const start = startOfWeek(today);
  const N = 35;
  const counts = Array(N).fill(0);
  for (const o of visibleOccurrences(start, addDays(start, N))) {
    let d = occFirstDay(o) < start ? start : occFirstDay(o);
    const l = occLastDay(o);
    for (let k = 0; d <= l && k < N; k++, d = addDays(d, 1)) {
      const i = daysBetween(start, d);
      if (i >= 0 && i < N) counts[i]++;
    }
  }
  const cells = counts.map((n, i) => {
    const d = addDays(start, i);
    const lvl = Math.min(4, n);
    const cell = h('button.cell', {
      class: [sameDay(d, today) && 'today', d < today && 'past'].filter(Boolean).join(' '),
      style: { '--hc': HEAT[lvl], '--hc-text': lvl >= 3 ? 'var(--on-accent)' : 'var(--text-2)' },
      'aria-label': `${dayShort(d)}: ${plural(n, 'Termin', 'Termine')}`,
      onclick: () => {
        hideTip();
        openDay(d);
      },
    }, d.getDate());
    cell.addEventListener('pointerenter', () => showTip(cell, dayShort(d), plural(n, 'Termin', 'Termine')));
    cell.addEventListener('pointerleave', hideTip);
    return cell;
  });
  return h('section.card.span-6.half', null,
    h('div.card-head', null,
      h('h3', null, 'Die nächsten 5 Wochen'),
      hasFriends() ? h('button.link.finder-link', { onclick: () => openFinder() }, icon('users', 15), 'Wann habt ihr Zeit?') : null,
    ),
    h('div.heat', null, WEEKDAYS.map((d) => h('span.hd', null, d)), cells),
    h('div.legend', null, h('span', null, 'frei'), HEAT.map((c) => h('i', { style: { '--hc': c } })), h('span', null, 'voll')),
  );
}

// ---------- Vorfreude ----------

function aheadCard(today) {
  const seen = new Set();
  const list = [];
  for (const o of visibleOccurrences(addDays(today, 1), addDays(today, 240))) {
    if (!isMulti(o) || seen.has(o.ev.id)) continue;
    seen.add(o.ev.id);
    list.push(o);
    if (list.length === 4) break;
  }
  if (!list.length) return null;
  return h('section.card.span-7', null,
    h('div.card-head', null, h('h3', null, 'Vorfreude')),
    h('div.ahead', null, list.map((o) => {
      const days = daysBetween(today, occFirstDay(o));
      return h('button.ahead-card', { style: { '--c': eventColor(o.ev) }, onclick: () => openEvent(o) },
        h('div.big', null, days),
        h('div.unit', null, days === 1 ? 'Tag noch' : 'Tage noch'),
        h('div.what', null, o.ev.title),
        h('div.on', null, dayShort(o.start)),
      );
    })),
  );
}

// ---------- Neuigkeiten ----------

function newsCard(wide) {
  const items = state.activity.slice(0, 6);
  return h(`section.card.${wide ? 'span-12' : 'span-5'}`, null,
    h('div.card-head', null,
      h('h3', null, 'Neuigkeiten'),
      state.activity.length ? h('button.link', { onclick: openActivity }, 'Alle anzeigen') : null,
    ),
    items.length
      ? h('div.feed', null, items.map((a) => feedItem(a, state.seenAt)))
      : h('div.empty.small', null,
        h('div.empty-art', null, '👋'),
        h('p', null, 'Noch ruhig hier. Mit Freunden wird’s lebendig!'),
        h('button.btn.primary.sm', { style: { marginTop: '12px' }, onclick: openInvitePicker }, icon('userPlus', 16), 'Freunde einladen'),
      ),
  );
}

export function renderToday(container) {
  const now = new Date();
  const today = startOfDay(now);
  const ticks = [];
  const ahead = aheadCard(today);
  const dash = h('div.dash', { class: state.viewFresh ? 'anim' : '' },
    h('div.dash-grid', null,
      skyCard(now, today, ticks),
      h('div.qa-dash.span-12', null, quickBar()),
      nextCard(now, today, ticks),
      todayCard(now, today),
      weekCard(today),
      heatCard(today),
      ahead,
      newsCard(!ahead),
    ),
  );
  container.replaceChildren(dash);
  const timer = setInterval(() => ticks.forEach((t) => t()), 1000);
  // Einmal pro Minute neu zeichnen, damit „Jetzt“ und vergangene Termine stimmen
  const minute = setTimeout(() => hooks.render(), 60000 - (Date.now() % 60000) + 50);
  return () => {
    clearInterval(timer);
    clearTimeout(minute);
    hideTip();
  };
}

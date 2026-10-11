// Die drei Ansichten: Monat, Woche, Liste – plus der kleine Monatskalender in der Seitenleiste
import { h, icon } from './h.js';
import { dayLong, monthName, relDay, time, weekdayName, WEEKDAYS } from './fmt.js';
import { occFirstDay, occLastDay } from './recur.js';
import { eventColor, state, visibleOccurrences } from './state.js';
import { addDays, addMonths, daysBetween, sameDay, startOfDay, startOfWeek, ymd } from './time.js';
import { occItem, openDay, openEditor, openEvent } from './sheets.js';

const isNarrow = () => matchMedia('(max-width: 760px)').matches;
const cssPx = (el, name, fallback) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || fallback;

// ---------- gemeinsame Balken-Logik ----------

function weekSegments(occs, ws) {
  const we = addDays(ws, 6);
  const segs = [];
  for (const o of occs) {
    const f = occFirstDay(o);
    const l = occLastDay(o);
    if (l < ws || f > we) continue;
    const s = f < ws ? ws : f;
    const e = l > we ? we : l;
    segs.push({
      o,
      col: daysBetween(ws, s),
      span: daysBetween(s, e) + 1,
      contL: f < ws,
      contR: l > we,
      block: o.allDay || !sameDay(f, l),
    });
  }
  segs.sort((a, b) => b.block - a.block || a.col - b.col || b.span - a.span || a.o.start - b.o.start);
  const rows = [];
  for (const s of segs) {
    for (let lane = 0; ; lane++) {
      rows[lane] ||= Array(7).fill(false);
      let free = true;
      for (let c = s.col; c < s.col + s.span; c++) if (rows[lane][c]) free = false;
      if (free) {
        for (let c = s.col; c < s.col + s.span; c++) rows[lane][c] = true;
        s.lane = lane;
        break;
      }
    }
  }
  return segs;
}

function barEl(s, { lane, top, showTime }) {
  const ev = s.o.ev;
  const cls = [s.block ? 'block' : 'timed', s.contL && 'cont-l', s.contR && 'cont-r'].filter(Boolean).join(' ');
  return h('button.bar', {
    class: cls,
    style: {
      '--c': eventColor(ev),
      left: `calc(${s.col} * 100% / 7 + 2px)`,
      width: `calc(${s.span} * 100% / 7 - 4px)`,
      top: `${top + s.lane * lane}px`,
      height: `${lane - 3}px`,
    },
    title: ev.title,
    onclick: (e) => {
      e.stopPropagation();
      openEvent(s.o);
    },
  }, !s.block && showTime ? h('span.t', null, time(s.o.start)) : null, h('span.label', null, ev.title));
}

// ---------- Monat ----------

export function renderMonth(container) {
  const c = state.cursor;
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const last = new Date(c.getFullYear(), c.getMonth() + 1, 0);
  const gridStart = startOfWeek(first);
  const weeks = Math.ceil((daysBetween(gridStart, last) + 1) / 7);
  const occs = visibleOccurrences(gridStart, addDays(gridStart, weeks * 7));
  const today = startOfDay(new Date());

  const body = h('div.month-body');
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(gridStart, w * 7);
    const days = h('div.week-days', null, WEEKDAYS.map((_, i) => {
      const d = addDays(ws, i);
      const cls = [
        d.getMonth() !== c.getMonth() && 'other',
        sameDay(d, today) && 'today',
        i >= 5 && 'we',
      ].filter(Boolean).join(' ');
      return h('div.day', { class: cls, role: 'button', tabindex: '-1', 'aria-label': dayLong(d), onclick: () => openDay(d) },
        h('span.num', null, d.getDate()),
        d.getDate() === 1 ? h('span.mon', null, monthName(d).slice(0, 3)) : null,
      );
    }));
    const layer = h('div.week-events');
    const el = h('div.week', null, days, layer);
    rows.push({ el, layer, ws });
    body.append(el);
  }

  const month = h('div.month', null,
    h('div.month-head', null, WEEKDAYS.map((d, i) => h('div.dow', { class: i >= 5 ? 'we' : '' }, d))),
    body,
  );
  container.replaceChildren(month);

  const layout = () => {
    const lane = cssPx(month, '--lane', 22);
    const top = cssPx(month, '--dayhead', 30);
    const showTime = !isNarrow();
    for (const row of rows) {
      const maxLanes = Math.max(1, Math.floor((row.el.clientHeight - top - 2) / lane));
      const segs = weekSegments(occs, row.ws);
      const need = Array(7).fill(0);
      for (const s of segs) for (let i = s.col; i < s.col + s.span; i++) need[i] = Math.max(need[i], s.lane + 1);
      const over = need.map((n) => n > maxLanes);
      const hidden = Array(7).fill(0);
      const out = [];
      for (const s of segs) {
        const cols = Array.from({ length: s.span }, (_, i) => s.col + i);
        const visible = s.lane < maxLanes - 1 || (s.lane === maxLanes - 1 && !cols.some((i) => over[i]));
        if (visible) out.push(barEl(s, { lane, top, showTime }));
        else for (const i of cols) hidden[i]++;
      }
      hidden.forEach((n, i) => {
        if (!n) return;
        const d = addDays(row.ws, i);
        out.push(h('button.more', {
          style: { left: `calc(${i} * 100% / 7 + 2px)`, width: `calc(100% / 7 - 4px)`, top: `${top + (maxLanes - 1) * lane}px`, height: `${lane - 3}px` },
          onclick: (e) => {
            e.stopPropagation();
            openDay(d);
          },
        }, isNarrow() ? `+${n}` : `+${n} weitere`));
      });
      row.layer.replaceChildren(...out);
    }
  };
  layout();
  let raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layout);
  });
  ro.observe(body);
  return () => ro.disconnect();
}

// ---------- Woche ----------

let weekScroll = null;

function columnize(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [];
  let cols = [];
  let clusterEnd = -1;
  const finish = () => {
    for (const it of cluster) it.cols = cols.length;
    cluster = [];
    cols = [];
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) finish();
    let col = cols.findIndex((end) => end <= it.s);
    if (col === -1) col = cols.length;
    cols[col] = it.e;
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  finish();
  return items;
}

export function renderWeek(container) {
  const ws = startOfWeek(state.cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const occs = visibleOccurrences(ws, addDays(ws, 7));
  const today = startOfDay(new Date());
  const blocks = occs.filter((o) => o.allDay || !sameDay(occFirstDay(o), occLastDay(o)));
  const timed = occs.filter((o) => !blocks.includes(o));

  const segs = weekSegments(blocks, ws);
  const lanes = segs.reduce((m, s) => Math.max(m, s.lane + 1), 0);
  const lane = isNarrow() ? 20 : 24;
  const alldayLayer = h('div.wv-allday-lanes', { style: { height: `${Math.max(1, lanes) * lane + 6}px` } },
    segs.map((s) => barEl(s, { lane, top: 3, showTime: false })));

  const head = h('div.wv-head', null,
    h('div.wv-gutter'),
    h('div.wv-days', null, days.map((d, i) => h('button.wv-dayhead', {
      class: sameDay(d, today) ? 'today' : '',
      onclick: () => openDay(d),
      'aria-label': dayLong(d),
    }, h('span.wd', null, WEEKDAYS[i]), h('span.dn', null, d.getDate())))),
  );

  const cols = days.map((d) => {
    const dayStart = d.getTime();
    const items = columnize(timed.filter((o) => sameDay(occFirstDay(o), d)).map((o) => ({
      o,
      s: Math.max(0, (o.start - dayStart) / 60000),
      e: Math.min(1440, Math.max((o.end - dayStart) / 60000, (o.start - dayStart) / 60000 + 20)),
    })));
    const col = h('div.wv-col', {
      class: sameDay(d, today) ? 'today' : '',
      onclick: (e) => {
        if (e.target !== col) return;
        const hour = Math.min(23, Math.floor(e.offsetY / cssPx(col, '--hour', 48)));
        openEditor({ date: d, hour });
      },
    }, items.map((it) => {
      const dur = it.e - it.s;
      const ev = it.o.ev;
      return h('button.wv-ev', {
        class: dur < 45 ? 'short' : '',
        style: {
          '--c': eventColor(ev),
          top: `calc(${it.s / 60} * var(--hour) + 1px)`,
          height: `calc(${dur / 60} * var(--hour) - 2px)`,
          left: `calc(${it.col} * 100% / ${it.cols} + 2px)`,
          width: `calc(100% / ${it.cols} - 4px)`,
        },
        title: ev.title,
        onclick: () => openEvent(it.o),
      }, h('span.tt', null, dur < 45 ? h('span.tm', null, `${time(it.o.start)} `) : null, ev.title),
      dur >= 45 ? h('span.tm', null, `${time(it.o.start)} – ${time(it.o.end)}`) : null);
    }));
    return col;
  });

  const nowLine = h('div.now-line');
  const colsEl = h('div.wv-cols', null, cols, nowLine);
  const placeNow = () => {
    const n = new Date();
    const i = days.findIndex((d) => sameDay(d, n));
    nowLine.hidden = i < 0;
    if (i >= 0) {
      nowLine.style.left = `calc(${i} * 100% / 7)`;
      nowLine.style.width = 'calc(100% / 7)';
      nowLine.style.top = `calc(${(n.getHours() * 60 + n.getMinutes()) / 60} * var(--hour))`;
    }
  };
  placeNow();

  const scroll = h('div.wv-scroll', { onscroll: () => (weekScroll = scroll.scrollTop) },
    h('div.wv-grid', null,
      h('div.wv-hours', null, Array.from({ length: 23 }, (_, i) => h('span', { style: { top: `calc(${i + 1} * var(--hour))` } }, `${String(i + 1).padStart(2, '0')}:00`))),
      colsEl,
    ),
  );

  const view = h('div.wv', null, head, h('div.wv-allday', null, h('div.wv-gutter.wv-allday-label', null, 'ganzt.'), alldayLayer), scroll);
  container.replaceChildren(view);
  scroll.scrollTop = weekScroll ?? cssPx(view, '--hour', 48) * 7 - 8;

  const timer = setInterval(placeNow, 60000);
  return () => clearInterval(timer);
}

// ---------- Liste ----------

export function renderList(container) {
  const searchInput = h('input', {
    id: 'search',
    type: 'search',
    placeholder: 'Termine durchsuchen …',
    value: state.search,
    autocomplete: 'off',
    oninput: () => {
      state.search = searchInput.value;
      drawBody();
    },
  });
  const body = h('div.lv-body');
  const view = h('div.lv', null, h('div.lv-search', null, h('label.search-box', null, icon('search', 18), searchInput)), body);
  container.replaceChildren(view);

  function drawBody() {
    const q = state.search.trim().toLowerCase();
    const start = startOfDay(state.cursor);
    const from = q ? addDays(start, -365) : start;
    const to = q ? addDays(start, 730) : addDays(start, state.listDays);
    let occs = visibleOccurrences(from, to);
    if (q) {
      occs = occs.filter(({ ev }) => [ev.title, ev.location, ev.notes].some((t) => t && t.toLowerCase().includes(q)));
      // Serien nur einmal zeigen: den nächsten Termin (oder den letzten, falls alle vorbei sind)
      const pick = new Map();
      for (const o of occs) {
        if (!o.ev.rrule) continue;
        const cur = pick.get(o.ev.id);
        if (!cur || (cur.start < start && o.start > cur.start)) pick.set(o.ev.id, o);
      }
      occs = occs.filter((o) => !o.ev.rrule || pick.get(o.ev.id) === o);
    }
    const groups = new Map();
    for (const o of occs) {
      const day = occFirstDay(o) < from ? from : occFirstDay(o);
      const key = ymd(day);
      if (!groups.has(key)) groups.set(key, { day, items: [] });
      groups.get(key).items.push(o);
    }
    const today = startOfDay(new Date());
    const out = [];
    for (const { day, items } of groups.values()) {
      const rel = relDay(day);
      out.push(h('section.lv-day', { class: sameDay(day, today) ? 'today' : '' },
        h('button.lv-date', { onclick: () => openDay(day) },
          h('span.dn', null, day.getDate()),
          h('span.wd', null, WEEKDAYS[(day.getDay() + 6) % 7]),
        ),
        h('div.lv-items', null,
          h('div.lv-label', null, rel ? `${rel} · ` : '', weekdayName(day), ', ', day.getDate(), '. ', monthName(day), day.getFullYear() !== today.getFullYear() ? ` ${day.getFullYear()}` : ''),
          items.map((o) => occItem(o, day)),
        ),
      ));
    }
    if (!out.length) {
      out.push(h('div.empty', null,
        h('div.empty-art', null, q ? '🔍' : '🌱'),
        h('h3', null, q ? 'Nichts gefunden' : 'Hier ist noch alles frei'),
        h('p', null, q ? `Keine Termine mit „${state.search.trim()}“.` : 'Plane etwas Schönes – allein oder mit deinen Leuten.'),
        q ? null : h('button.btn.primary', { onclick: () => openEditor({ date: start }) }, icon('plus', 18), 'Termin anlegen'),
      ));
    } else if (!q) {
      out.push(h('div.lv-more', null, h('button.btn', {
        onclick: () => {
          state.listDays += 90;
          drawBody();
        },
      }, 'Weitere Termine anzeigen')));
    }
    body.replaceChildren(...out);
  }
  drawBody();
  return null;
}

// ---------- Mini-Kalender ----------

export function renderMini(container, { onPick }) {
  const c = state.miniCursor;
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const gridEnd = addDays(gridStart, 42);
  const busyDays = new Set();
  for (const o of visibleOccurrences(gridStart, gridEnd)) {
    let d = occFirstDay(o) < gridStart ? gridStart : occFirstDay(o);
    const l = occLastDay(o);
    for (let i = 0; d <= l && i < 42; i++, d = addDays(d, 1)) busyDays.add(ymd(d));
  }
  const today = startOfDay(new Date());
  const go = (n) => {
    state.miniCursor = addMonths(state.miniCursor, n);
    renderMini(container, { onPick });
  };
  container.replaceChildren(
    h('div.mini-head', null,
      h('span', null, monthName(c), ' ', h('span.light', null, c.getFullYear())),
      h('span', null,
        h('button.icon-btn.sm', { onclick: () => go(-1), 'aria-label': 'Vorheriger Monat' }, icon('chevL', 16)),
        h('button.icon-btn.sm', { onclick: () => go(1), 'aria-label': 'Nächster Monat' }, icon('chevR', 16)),
      ),
    ),
    h('div.mini-grid', null,
      WEEKDAYS.map((d) => h('span.dw', null, d[0])),
      Array.from({ length: 42 }, (_, i) => {
        const d = addDays(gridStart, i);
        const cls = [
          d.getMonth() !== c.getMonth() && 'other',
          sameDay(d, today) && 'today',
          sameDay(d, state.cursor) && 'sel',
          busyDays.has(ymd(d)) && 'dot',
        ].filter(Boolean).join(' ');
        return h('button', { class: cls, onclick: () => onPick(d), 'aria-label': dayLong(d) }, d.getDate());
      }),
    ),
  );
}

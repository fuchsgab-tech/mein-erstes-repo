// Die drei Ansichten: Monat, Woche, Liste – plus der kleine Monatskalender in der Seitenleiste
import { h, icon } from './h.js';
import { dayLong, monthName, relDay, time, untilText, weekdayName, WEEKDAYS } from './fmt.js';
import { occFirstDay, occLastDay } from './recur.js';
import { eventColor, hooks, state, visibleOccurrences } from './state.js';
import { prefs } from './themes.js';
import { addDays, addMonths, daysBetween, isoWeek, parseYmd, sameDay, startOfDay, startOfWeek, ymd } from './time.js';
import { moveOccurrence, occItem, openDay, openEditor, openEvent } from './sheets.js';
import { mountSeasonFx, seasonArt, seasonOf } from './season.js';
import { textOn } from './ui.js';

const isNarrow = () => matchMedia('(max-width: 760px)').matches;
const cssPx = (el, name, fallback) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || fallback;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Läuft fn zu jeder vollen Minute; gibt die Aufräum-Funktion zurück
function everyMinute(fn) {
  let iv = 0;
  const to = setTimeout(() => {
    fn();
    iv = setInterval(fn, 60000);
  }, 60050 - (Date.now() % 60000));
  return () => {
    clearTimeout(to);
    clearInterval(iv);
  };
}

// ---------- Emojis, Feste, live ----------

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const EMOJI_LOOK = /\p{Emoji_Presentation}|\uFE0F|\p{Regional_Indicator}/u;
const graphemes = typeof Intl.Segmenter === 'function'
  ? ((seg) => (s) => Array.from(seg.segment(s), (x) => x.segment))(new Intl.Segmenter('de', { granularity: 'grapheme' }))
  : (s) => Array.from(s);
const emojiCache = new Map();

// Erstes Emoji im Titel wird zum Symbol, der Text bleibt ohne Doppelung
function splitEmoji(title) {
  let r = emojiCache.get(title);
  if (r) return r;
  r = { emoji: '', text: title };
  const parts = graphemes(title);
  const i = parts.findIndex((g) => EMOJI.test(g) && EMOJI_LOOK.test(g));
  if (i >= 0) {
    const text = `${parts.slice(0, i).join('')} ${parts.slice(i + 1).join('')}`.replace(/\s+/g, ' ').replace(/\s([,.!?:;])/g, '$1').trim();
    r = { emoji: parts[i], text };
  }
  if (emojiCache.size > 800) emojiCache.clear();
  emojiCache.set(title, r);
  return r;
}

const BIRTHDAY = /🎂|🥳|geburtstag|birthday/i;
const FESTIVE = /🎂|🥳|geburtstag|birthday|jahrestag|anniversary/i;
const isFestive = (o) => (o.allDay && /FREQ=YEARLY/i.test(o.ev.rrule || '')) || FESTIVE.test(o.ev.title);
const festiveEmoji = (title) => (BIRTHDAY.test(title) ? '🎂' : /hochzeit|💍/i.test(title) ? '💍' : '🎉');

function symbolOf(o) {
  const { emoji, text } = splitEmoji(o.ev.title);
  const festive = isFestive(o);
  return { emoji, text, festive, sym: emoji || (festive ? festiveEmoji(o.ev.title) : '') };
}

function liveState(o, t) {
  if (o.end <= t) return 'past';
  return !o.allDay && o.start <= t ? 'now' : '';
}

function eventLabel(o, live) {
  const n = o.ev.attendees?.length || 0;
  return [
    o.ev.title,
    o.allDay ? 'ganztägig' : o.end > o.start ? `${time(o.start)} bis ${time(o.end)} Uhr` : `${time(o.start)} Uhr`,
    live === 'now' ? 'läuft gerade' : live === 'past' ? 'vorbei' : null,
    n > 1 ? `${n} sind dabei` : null,
  ].filter(Boolean).join(', ');
}

// Klassen „läuft gerade“/„vorbei“ setzen – auch später, wenn die Minute weiterläuft
function applyLive(el, o, t) {
  const live = liveState(o, t);
  if (el.dataset.live === live) return;
  el.dataset.live = live;
  el.classList.toggle('past', live === 'past');
  el.classList.toggle('now', live === 'now');
  el.setAttribute('aria-label', eventLabel(o, live));
}

const pulse = () => h('span.ev-live', { 'aria-hidden': 'true' });

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

// ---------- Ziehen & Ablegen (Monat) ----------

let suppressClick = false;

function attachDrag(el, o) {
  if (o.ev.subscriptionId) return;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const touch = e.pointerType === 'touch';
    const rect = el.getBoundingClientRect();
    const offX = startX - rect.left;
    const offY = startY - rect.top;
    // Welcher Tag wurde gegriffen? (bei mehrtägigen Terminen wichtig)
    const cells = [...(el.parentElement?.previousElementSibling?.children || [])];
    const grabCell = cells.find((c) => {
      const r = c.getBoundingClientRect();
      return startX >= r.left && startX < r.right;
    });
    let dragging = false;
    let ghost = null;
    let target = null;
    let timer = null;

    const place = (ev) => {
      ghost.style.transform = `translate(${ev.clientX - offX}px, ${ev.clientY - offY}px) rotate(-2deg) scale(1.05)`;
    };
    const begin = (ev) => {
      dragging = true;
      state.dragging = true;
      el.classList.add('dragging');
      document.body.classList.add('is-dragging');
      ghost = el.cloneNode(true);
      ghost.classList.remove('dragging');
      ghost.classList.add('drag-ghost');
      Object.assign(ghost.style, { left: '0', top: '0', width: `${rect.width}px`, height: `${rect.height}px` });
      document.body.append(ghost);
      place(ev);
      navigator.vibrate?.(10);
    };
    const finish = async (drop) => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (!dragging) return;
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
        state.dragging = false;
      }, 60);
      el.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      ghost?.remove();
      target?.classList.remove('drop-target');
      if (drop && target?.dataset.date && grabCell?.dataset.date) {
        const delta = daysBetween(parseYmd(grabCell.dataset.date), parseYmd(target.dataset.date));
        if (delta) await moveOccurrence(o, delta);
      }
    };
    const onMove = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        if (touch) return finish(false); // auf dem Handy erst nach langem Drücken
        begin(ev);
      }
      ev.preventDefault();
      place(ev);
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.day');
      if (under !== target) {
        target?.classList.remove('drop-target');
        target = under;
        target?.classList.add('drop-target');
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    if (touch) timer = setTimeout(() => begin(e), 420);
  });
}

function barEl(s, { lane, top, showTime, draggable = false, t = Date.now(), delay = 0 }) {
  const o = s.o;
  const ev = o.ev;
  const color = eventColor(ev);
  const { text, festive, sym } = symbolOf(o);
  const people = ev.attendees?.length || 0;
  const cls = [s.block ? 'block' : 'timed', s.contL && 'cont-l', s.contR && 'cont-r', festive && 'festive', sym && 'has-ej']
    .filter(Boolean).join(' ');
  const el = h('button.bar', {
    class: cls,
    style: {
      '--c': color,
      '--on-c': textOn(color),
      '--d': delay,
      left: `calc(${s.col} * 100% / 7 + 2px)`,
      width: `calc(${s.span} * 100% / 7 - 4px)`,
      top: `${top + s.lane * lane}px`,
      height: `${lane - 3}px`,
    },
    title: ev.title,
    'data-k': `${ev.id}|${o.orig || ''}`,
    onclick: (e) => {
      e.stopPropagation();
      if (!suppressClick) openEvent(o);
    },
  },
  sym ? h('span.ej', { 'aria-hidden': 'true' }, sym) : null,
  !s.block && showTime ? h('span.t', null, time(o.start)) : null,
  h('span.label', null, text),
  o.allDay ? null : pulse(),
  showTime && people > 1 ? h('span.ppl', { 'aria-hidden': 'true' }, icon('users', 11), people) : null);
  applyLive(el, o, t);
  if (draggable) attachDrag(el, o);
  return el;
}

// ---------- Monat ----------

// Wie viele Termine liegen an jedem Tag des Rasters?
function dayLoad(occs, gridStart, days) {
  const load = new Array(days).fill(0);
  for (const o of occs) {
    const a = Math.max(0, daysBetween(gridStart, occFirstDay(o)));
    const b = Math.min(days - 1, daysBetween(gridStart, occLastDay(o)));
    for (let i = a; i <= b; i++) load[i]++;
  }
  return load;
}

const busyLevel = (n) => (n >= 7 ? 3 : n >= 5 ? 2 : n >= 3 ? 1 : 0);
const dayAria = (d, n, today) => `${dayLong(d)}${today ? ', heute' : ''}, ${n ? plural(n, 'Termin', 'Termine') : 'frei'}`;
const leftText = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} Min.` : `${Math.floor(m / 60)} Std.${m % 60 ? ` ${m % 60} Min.` : ''}`;
};

// Monatsbild: Jahreszeit, Stimmung, Zahlen und der nächste Termin
function monthBanner(c, occs, today) {
  const info = seasonOf(c);
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const next = new Date(c.getFullYear(), c.getMonth() + 1, 1);
  const inMonth = occs.filter((o) => o.start < next && o.end > first);
  const current = today >= first && today < next;
  const future = first > today;

  const birthdays = inMonth.filter((o) => isFestive(o) && BIRTHDAY.test(o.ev.title)).length;
  const parts = [
    [inMonth.length, 'Termin', 'Termine', icon('calendar', 12), ''],
    [inMonth.filter((o) => (o.ev.attendees?.length || 0) > 1).length, 'gemeinsam', 'gemeinsam', '👥', 'st-more'],
    [birthdays, 'Geburtstag', 'Geburtstage', '🎂', ''],
    [inMonth.filter(isFestive).length - birthdays, 'Jahrestag', 'Jahrestage', '🎉', 'st-more'],
  ].filter(([n], i) => n || i === 0);
  const words = ([n, one, many]) => `${n} ${n === 1 ? one : many}`;
  // Am Handy werden aus den Wörtern kleine Symbole; Vorleseprogramme bekommen immer den ganzen Satz
  const stats = inMonth.length
    ? h('p.mb-stats', null, h('span.sr-only', null, parts.map(words).join(', ')),
      h('span', { 'aria-hidden': 'true' }, parts.map(([n, one, many, sym, more], i) => h('span.st', { class: more },
        i ? h('span.sep', null, '·') : null, sym ? h('span.si', null, sym) : null, h('b', null, n), h('span.sw', null, ` ${n === 1 ? one : many}`)))))
    : h('p.mb-stats', null, future || current ? 'Noch alles frei' : 'Ein ruhiger Monat');

  const chip = (label, o, rel, live) => {
    const { text, sym } = symbolOf(o);
    const done = live ? Math.min(1, (Date.now() - o.start) / Math.max(1, o.end - o.start)) : 0;
    return h('button.mb-chip', {
      class: live ? 'live' : '',
      style: { '--c': eventColor(o.ev), '--done': done.toFixed(3) },
      title: o.ev.title,
      'aria-label': `${label}: ${o.ev.title}, ${rel}`,
      onclick: () => openEvent(o),
    },
    live ? pulse() : null,
    h('span.k', null, label),
    sym && text ? h('span.ej', { 'aria-hidden': 'true' }, sym) : null,
    h('span.nm', null, text || o.ev.title),
    h('span.rel', null, rel));
  };
  const chips = h('div.mb-chips');
  const drawChips = () => {
    const t = Date.now();
    const keep = chips.contains(document.activeElement) ? [...chips.children].indexOf(document.activeElement) : -1;
    const out = [];
    if (current) {
      let soon = occs.filter((o) => o.end > t);
      if (!soon.some((o) => o.start > t)) soon = visibleOccurrences(today, addDays(today, 90)).filter((o) => o.end > t);
      const running = soon.find((o) => !o.allDay && o.start <= t);
      const upcoming = soon.find((o) => o.start > t);
      if (running) out.push(chip('Jetzt', running, `noch ${leftText(running.end - t)}`, true));
      if (upcoming) out.push(chip('Nächstes', upcoming, upcoming.allDay && daysBetween(today, upcoming.start) === 1 ? 'morgen' : untilText(upcoming.start)));
    } else if (future && inMonth.length) {
      const starts = inMonth.filter((x) => x.start >= first);
      const o = starts.find((x) => !/FREQ=(DAILY|WEEKLY)/i.test(x.ev.rrule || '')) || starts[0] || inMonth[0];
      out.push(chip('Los geht’s', o, untilText(o.start)));
    }
    if (!inMonth.length && (current || future)) {
      out.push(h('button.mb-chip.add', { onclick: () => openEditor({ date: current ? today : first }) }, icon('plus', 14), 'Termin planen'));
    }
    chips.replaceChildren(...out);
    if (keep >= 0) (chips.children[keep] || chips.firstElementChild)?.focus();
  };
  drawChips();

  const art = h('div.mb-art', { 'aria-hidden': 'true' });
  art.innerHTML = seasonArt(info); // feste Grafik ohne Nutzereingaben
  const sky = h('div.mb-sky');
  const el = h('section.mb.season', { 'data-scene': info.scene, 'aria-label': `${monthName(c)}: ${info.season}` },
    art,
    sky,
    h('div.mb-text', null,
      h('div.mb-eyebrow', null, h('span.mb-emoji', { 'aria-hidden': 'true' }, info.emoji), info.season),
      stats,
      h('p.mb-mood', null, h('span.mb-emoji', { 'aria-hidden': 'true' }, info.emoji), info.mood),
      chips,
    ),
  );
  return { el, tick: drawChips, start: () => mountSeasonFx(sky, info) };
}

export function renderMonth(container) {
  const c = state.cursor;
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const last = new Date(c.getFullYear(), c.getMonth() + 1, 0);
  const gridStart = startOfWeek(first);
  const weeks = Math.ceil((daysBetween(gridStart, last) + 1) / 7);
  const occs = visibleOccurrences(gridStart, addDays(gridStart, weeks * 7));
  const today = startOfDay(new Date());
  const load = dayLoad(occs, gridStart, weeks * 7);
  // Fokus über Live-Neuzeichnungen hinweg behalten (Tastatur)
  const focused = container.contains(document.activeElement) ? document.activeElement : null;
  const refocus = focused?.closest('.day')?.dataset.date;
  const refocusBar = focused?.closest('.bar')?.dataset.k;
  const prog = h('span.dprog', { 'aria-hidden': 'true' }, h('i'));
  const setProgress = () => prog.style.setProperty('--p', Math.min(1, Math.max(0, (Date.now() - today) / 864e5)).toFixed(4));
  setProgress();

  // Pfeiltasten wandern durch die Tage, Enter öffnet den Tag
  const onKey = (e) => {
    const cell = e.target.closest?.('.day');
    if (!cell) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDay(parseYmd(cell.dataset.date));
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const to = body.querySelector(`.day[data-date="${ymd(addDays(parseYmd(cell.dataset.date), step))}"]`);
    if (!to) return;
    cell.tabIndex = -1;
    to.tabIndex = 0;
    to.focus();
  };

  const body = h('div.month-body', { onkeydown: onKey });
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(gridStart, w * 7);
    const days = h('div.week-days', null, WEEKDAYS.map((_, i) => {
      const d = addDays(ws, i);
      const n = load[w * 7 + i];
      const isToday = sameDay(d, today);
      const cls = [
        d.getMonth() !== c.getMonth() && 'other',
        isToday && 'today',
        i >= 5 && 'we',
        busyLevel(n) && `busy-${busyLevel(n)}`,
      ].filter(Boolean).join(' ');
      return h('div.day', {
        class: cls,
        role: 'button',
        tabindex: '-1',
        'aria-label': dayAria(d, n, isToday),
        'aria-current': isToday ? 'date' : null,
        'data-date': ymd(d),
        onclick: () => openDay(d),
      },
      h('span.num', null, d.getDate()),
      d.getDate() === 1 ? h('span.mon', null, monthName(d).slice(0, 3)) : null,
      i === 0 && prefs.kw ? h('span.kw', { title: `Kalenderwoche ${isoWeek(d)}` }, `KW ${isoWeek(d)}`) : null,
      isToday ? prog : null);
    }));
    const layer = h('div.week-events');
    const el = h('div.week', null, days, layer);
    rows.push({ el, layer, ws });
    body.append(el);
  }
  const tabStop = (refocus && body.querySelector(`.day[data-date="${refocus}"]`))
    || body.querySelector('.day.today:not(.other)') || body.querySelector(`.day[data-date="${ymd(first)}"]`);
  tabStop.tabIndex = 0;

  const banner = monthBanner(c, occs, today);
  const month = h('div.month', { class: state.viewFresh ? 'intro' : '' },
    banner.el,
    h('div.month-head', null, WEEKDAYS.map((d, i) => h('div.dow', { class: i >= 5 ? 'we' : '' }, d))),
    body,
  );
  container.replaceChildren(month);
  if (refocus) tabStop.focus();

  let liveBars = [];
  const layout = () => {
    const lane = cssPx(month, '--lane', 22);
    const top = cssPx(month, '--dayhead', 30);
    const showTime = !isNarrow();
    const t = Date.now();
    liveBars = [];
    rows.forEach((row, r) => {
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
        if (visible) {
          const el = barEl(s, { lane, top, showTime, draggable: true, t, delay: r * 45 + s.col * 14 + s.lane * 10 });
          if (!s.o.allDay) liveBars.push({ el, o: s.o });
          out.push(el);
        } else for (const i of cols) hidden[i]++;
      }
      hidden.forEach((n, i) => {
        if (!n) return;
        const d = addDays(row.ws, i);
        out.push(h('button.more', {
          style: { left: `calc(${i} * 100% / 7 + 2px)`, width: `calc(100% / 7 - 4px)`, top: `${top + (maxLanes - 1) * lane}px`, height: `${lane - 3}px` },
          'aria-label': `${plural(n, 'weiterer Termin', 'weitere Termine')} am ${dayLong(d)}`,
          onclick: (e) => {
            e.stopPropagation();
            openDay(d);
          },
        }, isNarrow() ? `+${n}` : `+${n} weitere`));
      });
      row.layer.replaceChildren(...out);
    });
  };
  layout();
  if (refocusBar) month.querySelector(`.bar[data-k="${CSS.escape(refocusBar)}"]`)?.focus();
  let raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layout);
  });
  ro.observe(body);

  const stopFx = banner.start();
  const introTimer = setTimeout(() => month.classList.remove('intro'), 1200);
  const stopTick = everyMinute(() => {
    if (!sameDay(today, new Date())) return hooks.render(); // Mitternacht: neuer Tag
    const t = Date.now();
    setProgress();
    if (!state.dragging) for (const b of liveBars) applyLive(b.el, b.o, t);
    banner.tick();
  });
  return () => {
    ro.disconnect();
    cancelAnimationFrame(raf);
    clearTimeout(introTimer);
    stopTick();
    stopFx();
  };
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
  const t0 = Date.now();
  const blocks = occs.filter((o) => o.allDay || !sameDay(occFirstDay(o), occLastDay(o)));
  const timed = occs.filter((o) => !blocks.includes(o));

  const segs = weekSegments(blocks, ws);
  const lanes = segs.reduce((m, s) => Math.max(m, s.lane + 1), 0);
  const lane = isNarrow() ? 20 : 24;
  const alldayLayer = h('div.wv-allday-lanes', { style: { height: `${Math.max(1, lanes) * lane + 6}px` } },
    segs.map((s) => barEl(s, { lane, top: 3, showTime: false, t: t0 })));

  const head = h('div.wv-head', null,
    h('div.wv-gutter'),
    h('div.wv-days', null, days.map((d, i) => {
      const list = occs.filter((o) => occFirstDay(o) <= d && occLastDay(o) >= d);
      return h('button.wv-dayhead', {
        class: sameDay(d, today) ? 'today' : d < today ? 'past' : '',
        onclick: () => openDay(d),
        'aria-label': dayAria(d, list.length, sameDay(d, today)),
        'aria-current': sameDay(d, today) ? 'date' : null,
      },
      h('span.wd', null, WEEKDAYS[i]),
      h('span.dn', null, d.getDate()),
      h('span.wv-dots', { 'aria-hidden': 'true' },
        list.slice(0, 4).map((o) => h('i', { style: { '--c': eventColor(o.ev) } })),
        list.length > 4 ? h('b', null, `+${list.length - 4}`) : null));
    })),
  );

  const evEls = [];
  const pastShade = h('div.wv-past', { 'aria-hidden': 'true' });
  const cols = days.map((d, di) => {
    const dayStart = d.getTime();
    const items = columnize(timed.filter((o) => sameDay(occFirstDay(o), d)).map((o) => ({
      o,
      s: Math.max(0, (o.start - dayStart) / 60000),
      e: Math.min(1440, Math.max((o.end - dayStart) / 60000, (o.start - dayStart) / 60000 + 20)),
    })));
    const isToday = sameDay(d, today);
    const col = h('div.wv-col', {
      class: [isToday && 'today', di >= 5 && 'we'].filter(Boolean).join(' '),
      onclick: (e) => {
        if (e.target !== col) return;
        const hour = Math.min(23, Math.floor(e.offsetY / cssPx(col, '--hour', 48)));
        openEditor({ date: d, hour });
      },
    }, isToday ? pastShade : null, items.map((it) => {
      const dur = it.e - it.s;
      const ev = it.o.ev;
      const short = dur < 45;
      const { emoji, text } = splitEmoji(ev.title);
      const el = h('button.wv-ev', {
        class: short ? 'short' : '',
        style: {
          '--c': eventColor(ev),
          '--on-c': textOn(eventColor(ev)),
          top: `calc(${it.s / 60} * var(--hour) + 1px)`,
          height: `calc(${dur / 60} * var(--hour) - 2px)`,
          left: `calc(${it.col} * 100% / ${it.cols} + 2px)`,
          width: `calc(100% / ${it.cols} - 4px)`,
        },
        title: ev.title,
        onclick: () => openEvent(it.o),
      },
      h('span.tt', null, pulse(), short ? h('span.tm', null, `${time(it.o.start)} `) : null,
        emoji && text ? h('span.ej', { 'aria-hidden': 'true' }, emoji) : null, text || ev.title),
      short ? null : h('span.tm', null, `${time(it.o.start)} – ${time(it.o.end)}`),
      emoji && dur >= 100 ? h('span.wm', { 'aria-hidden': 'true' }, emoji) : null);
      applyLive(el, it.o, t0);
      evEls.push({ el, o: it.o });
      return el;
    }));
    return col;
  });

  const nowTag = h('span.now-tag');
  const nowLine = h('div.now-line', { 'aria-hidden': 'true' }, h('span.now-rail'), nowTag);
  const colsEl = h('div.wv-cols', null, cols, nowLine);
  const placeNow = () => {
    const n = new Date();
    const i = days.findIndex((d) => sameDay(d, n));
    const top = `calc(${(n.getHours() * 60 + n.getMinutes()) / 60} * var(--hour))`;
    nowLine.hidden = i < 0;
    if (i >= 0) {
      nowLine.style.left = `calc(${i} * 100% / 7)`;
      nowLine.style.width = 'calc(100% / 7)';
      nowLine.style.top = top;
      nowLine.style.setProperty('--i', i);
      nowTag.textContent = time(n);
      pastShade.style.height = top;
    }
    for (const x of evEls) applyLive(x.el, x.o, n.getTime());
  };
  placeNow();

  const scroll = h('div.wv-scroll', { onscroll: () => (weekScroll = scroll.scrollTop) },
    h('div.wv-grid', null,
      h('div.wv-hours', null, Array.from({ length: 23 }, (_, i) => h('span', { style: { top: `calc(${i + 1} * var(--hour))` } }, `${String(i + 1).padStart(2, '0')}:00`))),
      colsEl,
    ),
  );

  const view = h('div.wv', null, head,
    h('div.wv-allday', null, h('div.wv-gutter.wv-allday-label', { title: 'Ganztägig' }, icon('sun', 13), h('span', null, 'ganztags')), alldayLayer),
    scroll);
  container.replaceChildren(view);
  scroll.scrollTop = weekScroll ?? cssPx(view, '--hour', 48) * 7 - 8;

  return everyMinute(() => {
    if (!sameDay(today, new Date())) hooks.render(); // Mitternacht: neuer Tag
    else placeNow();
  });
}

// ---------- Liste ----------

function listItem(o, day) {
  const el = occItem(o, day);
  const { emoji, text, festive, sym } = symbolOf(o);
  const title = el.querySelector('.title');
  if (emoji && text && title) title.textContent = text;
  const av = h('span.lv-av', { 'aria-hidden': 'true', class: sym ? '' : 'mono' }, sym || (graphemes(text.trim())[0] || '•').toUpperCase());
  const stripe = el.querySelector('.stripe');
  if (stripe) stripe.after(av);
  else el.prepend(av);
  if (festive) el.classList.add('festive');
  return el;
}

function monthSeparator(d) {
  const info = seasonOf(d);
  const art = h('span.lv-month-art', { 'aria-hidden': 'true' });
  art.innerHTML = seasonArt(info); // feste Grafik ohne Nutzereingaben
  return h('h2.lv-month.season', { 'data-scene': info.scene },
    art,
    h('span.lv-month-text', null,
      h('strong', null, monthName(d), d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''),
      h('span.lv-month-mood', null, h('span', { 'aria-hidden': 'true' }, info.emoji), ` ${info.mood}`),
    ),
  );
}

const REL_CLASS = { Heute: 'today', Morgen: 'tomorrow', Gestern: 'yesterday' };

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
    let lastMonth = null;
    for (const { day, items } of groups.values()) {
      const mk = day.getFullYear() * 12 + day.getMonth();
      if (lastMonth !== null && mk !== lastMonth) out.push(monthSeparator(day));
      lastMonth = mk;
      const rel = relDay(day);
      out.push(h('section.lv-day', { class: sameDay(day, today) ? 'today' : '' },
        h('button.lv-date', { onclick: () => openDay(day), 'aria-label': dayLong(day) },
          h('span.dn', null, day.getDate()),
          h('span.wd', null, WEEKDAYS[(day.getDay() + 6) % 7]),
        ),
        h('div.lv-items', null,
          h('div.lv-label', null,
            rel ? h('span.lv-chip', { class: REL_CLASS[rel] }, rel) : null,
            h('span.lv-dtext', null, weekdayName(day), ', ', day.getDate(), '. ', monthName(day), day.getFullYear() !== today.getFullYear() ? ` ${day.getFullYear()}` : ''),
            h('span.lv-count', null, plural(items.length, 'Termin', 'Termine')),
          ),
          items.map((o) => listItem(o, day)),
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

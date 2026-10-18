// Schnell eintragen: Leiste in „Heute“ und in der Liste, dazu die erkannten Teile als kleine Chips
// (auch oben im Termin-Editor). Das Verstehen des Textes steckt in quick-parse.js.
import { api } from './api.js';
import { h, icon } from './h.js';
import { dayShort, time } from './fmt.js';
import { burstFrom } from './fx.js';
import { parseQuick } from './quick-parse.js';
import { describeRrule } from './recur.js';
import { calById, defaultCalendarId, hooks, loadEvents, setHidden, state } from './state.js';
import { localTz, sameDay, ymd } from './time.js';
import { openEditor } from './sheets.js';
import { busy, errorToast, toast } from './ui.js';

const CLOCKS = ['🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚'];
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const coarse = () => matchMedia('(pointer: coarse)').matches;

export const parseNow = (text) => parseQuick(text, { now: new Date(), calendars: state.calendars });

function dateText(p) {
  if (p.allDay && !sameDay(p.start, p.end)) return `${dayShort(p.start)} – ${dayShort(p.end)}`;
  return dayShort(p.start);
}
function timeText(p) {
  if (p.allDay) return 'Ganztägig';
  return sameDay(p.start, p.end) ? `${time(p.start)}–${time(p.end)}` : `${time(p.start)} – ${dayShort(p.end)}, ${time(p.end)}`;
}
const chip = (sym, text, kind, color) =>
  h('span.qa-chip', { class: kind ? `k-${kind}` : '', style: color ? { '--c': color } : null }, h('span.qa-sym', { 'aria-hidden': 'true' }, sym), text);

// Chips zu einem Ergebnis. all = false: nur, was im Text erkannt wurde (Editor);
// all = true: alles, was eingetragen würde, samt Kalender (Vorschau der Leiste)
export function quickChips(p, { all = false } = {}) {
  const kinds = new Set(p.matched.map((m) => m.kind));
  const out = [];
  if (all || kinds.has('date') || (p.rrule && !sameDay(p.start, new Date()))) out.push(chip('📅', dateText(p), 'date'));
  if (all || kinds.has('time') || kinds.has('duration') || kinds.has('allday')) {
    out.push(chip(p.allDay ? '☀️' : CLOCKS[p.start.getHours() % 12], timeText(p), 'time'));
  }
  if (p.location) out.push(chip('📍', p.location, 'place'));
  if (p.rrule) out.push(chip('🔁', describeRrule(p.rrule, p.start), 'repeat'));
  const cal = calById(p.calendarId || (all ? defaultCalendarId() : null));
  if (cal) out.push(chip(cal.emoji || '🗓️', cal.name, 'cal', cal.color));
  return out;
}

// Chips tauschen – nur neu erkannte Teile ploppen auf, nicht bei jedem Tastendruck alle
export function swapChips(row, nodes) {
  const old = new Set([...row.children].map((c) => c.textContent));
  for (const n of nodes) if (!old.has(n.textContent)) n.classList.add('new');
  row.replaceChildren(...nodes);
}

// Daten für POST /api/events – wie der Editor sie schickt
export function quickPayload(p, calendarId) {
  return {
    calendarId,
    title: p.emoji ? `${p.emoji} ${p.title}` : p.title,
    allDay: p.allDay,
    start: p.allDay ? ymd(p.start) : p.start.toISOString(),
    end: p.allDay ? ymd(p.end) : p.end.toISOString(),
    tz: localTz(),
    rrule: p.rrule || null,
    location: p.location || '',
    notes: '',
    color: null,
  };
}

// ---------- Die Leiste ----------
// Text und offene Vorschau bleiben erhalten, wenn die Ansicht neu gezeichnet wird (Live-Updates)
let draft = '';
let previewOpen = false;
let creating = false; // schnelles doppeltes Enter soll nicht zwei Termine anlegen

export function quickBar() {
  const input = h('input', {
    id: 'quick-add',
    type: 'text',
    value: draft,
    placeholder: isPhone() ? 'z. B. „Fr 19 Uhr Pizza bei Max“' : 'Was steht an? z. B. „Fr 19 Uhr Pizza bei Max“',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    spellcheck: 'false',
    enterkeyhint: 'go',
    maxlength: 300,
    'aria-label': 'Schnell eintragen: Was steht an?',
    'aria-describedby': 'quick-add-preview',
    oninput: () => {
      draft = input.value;
      if (!draft.trim()) previewOpen = false;
      drawPreview();
    },
    onkeydown: (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!draft.trim()) return;
        if (previewOpen) create(addBtn());
        else {
          previewOpen = true;
          drawPreview();
        }
      } else if (e.key === 'Escape') {
        if (previewOpen) {
          previewOpen = false;
          drawPreview();
        } else if (draft) {
          input.value = draft = '';
        } else input.blur();
      }
    },
  });
  const goBtn = h('button.qa-go', {
    type: 'button',
    'aria-label': 'Vorschau zeigen',
    title: 'Vorschau zeigen (Enter)',
    onclick: () => {
      if (!draft.trim()) return input.focus();
      previewOpen = true;
      drawPreview();
    },
  }, icon('arrowR', 18));
  const preview = h('div.qa-preview', { id: 'quick-add-preview', 'aria-live': 'polite' });
  const bar = h('div.qa-bar', null,
    h('label.search-box.qa-box', null, h('span.qa-spark', { 'aria-hidden': 'true' }, '✨'), input, goBtn),
    preview,
  );
  const addBtn = () => preview.querySelector('.qa-add');

  function drawPreview() {
    goBtn.classList.toggle('on', !!draft.trim());
    if (!previewOpen || !draft.trim()) {
      preview.replaceChildren();
      bar.classList.remove('open');
      return;
    }
    const p = parseNow(draft);
    const titleOk = !!p.title;
    const fresh = !bar.classList.contains('open');
    const chips = h('div.qa-chips', null, ...(preview.querySelector('.qa-chips')?.children || []));
    swapChips(chips, quickChips(p, { all: true }));
    if (fresh) chips.querySelectorAll('.new').forEach((c) => c.classList.remove('new'));
    bar.classList.add('open');
    preview.replaceChildren(h('div.card.qa-card', { class: fresh ? 'in' : '' },
      h('div.qa-title', null,
        h('span.qa-emoji', { 'aria-hidden': 'true' }, p.emoji || '🗓️'),
        titleOk ? h('strong', null, p.title) : h('strong.muted', null, 'Was genau? Schreib noch einen Titel dazu'),
      ),
      chips,
      h('div.qa-actions', null,
        coarse() ? null : h('span.qa-keys', null, h('kbd', null, 'Enter'), ' eintragen · ', h('kbd', null, 'Esc'), ' zurück'),
        h('span.grow'),
        h('button.btn.ghost.sm', { type: 'button', onclick: edit }, icon('edit', 16), 'Bearbeiten'),
        h('button.btn.primary.sm.qa-add', { type: 'button', disabled: !titleOk, onclick: (e) => create(e.currentTarget) }, icon('check', 16), 'Eintragen'),
      ),
    ));
  }

  function reset() {
    draft = '';
    previewOpen = false;
    input.value = '';
    drawPreview();
  }

  function edit() {
    const text = draft;
    reset();
    openEditor({ date: new Date(), quick: text });
  }

  async function create(btn) {
    if (creating) return;
    const p = parseNow(draft);
    if (!p.title) return edit();
    const cal = calById(p.calendarId) || calById(defaultCalendarId());
    if (!cal) {
      toast('Lege zuerst einen Kalender an.');
      return;
    }
    creating = true;
    await busy(btn, async () => {
      const { event } = await api('POST', '/api/events', quickPayload(p, cal.id));
      if (btn?.isConnected) burstFrom(btn, ['✨', '🎉', '🌿', '💫'], 12);
      const keepFocus = document.activeElement === input && !coarse();
      if (!keepFocus) input.blur();
      reset();
      setHidden(cal.id, false);
      await loadEvents(cal.id);
      hooks.render();
      if (keepFocus) document.getElementById('quick-add')?.focus({ preventScroll: true });
      toast(`„${p.title}“ eingetragen`, { action: { label: 'Rückgängig', run: () => undo(event) } });
    });
    creating = false;
  }

  drawPreview();
  return bar;
}

async function undo(event) {
  try {
    await api('DELETE', `/api/events/${event.id}`);
    await loadEvents(event.calendarId);
    hooks.render();
    toast('Termin entfernt');
  } catch (e) {
    errorToast(e);
  }
}

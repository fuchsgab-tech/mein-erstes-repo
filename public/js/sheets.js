// Alle Fenster der App: Tag, Termin, Editor, Kalender, Import, Profil, Einladung
import { api, auth, isDemo } from './api.js';
import { h, icon, linkify } from './h.js';
import { ago, dayLong, dayMonth, relDay, shortDate, untilText, weekdayName, whenLong, whenShort } from './fmt.js';
import { burst, burstFrom } from './fx.js';
import { describeRrule, joinRrule, occurrences, REPEAT_PRESETS, splitRrule } from './recur.js';
import {
  COLORS, EMOJIS, calById, defaultCalendarId, eventColor, hooks, loadAll, loadEvents, loadMe, markSeen, person,
  rememberCalendar, setHidden, state, visibleOccurrences,
} from './state.js';
import { DEFAULT_PREFS, SKINS, prefs, resolvedMode, setPrefs } from './themes.js';
import { addDays, daysBetween, localTz, pad, parseYmd, startOfDay, ymd } from './time.js';
import {
  avatar, avatarStack, busy, chooseDialog, confirmDialog, copyText, errorToast, field, openSheet, segmented,
  swatches, textOn, toast,
} from './ui.js';

const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const closeBtn = (s) => h('button.icon-btn', { onclick: () => s.close(), 'aria-label': 'Schließen', title: 'Schließen' }, icon('x'));

function toggle(label, value, onChange, hint) {
  const input = h('input', { type: 'checkbox', checked: value, onchange: () => onChange(input.checked) });
  return h('label.toggle', null, h('span', null, label, hint ? h('small', null, hint) : null), input, h('span.track', null, h('span.thumb')));
}

const isOnline = (id) => state.online.has(id);

function meta(iconName, ...content) {
  return h('div.meta', null, icon(iconName, 19), h('div.v', null, ...content));
}

// ---------- Eintrag in Listen ----------

export function occItem(o, day) {
  const ev = o.ev;
  const cal = calById(ev.calendarId);
  const people = (ev.attendees || []).map(person);
  const now = Date.now();
  const rx = Object.entries(ev.reactions || {}).filter(([, ids]) => ids.length).map(([e]) => e).slice(0, 3);
  const cls = o.end <= now && !o.allDay ? 'past' : o.start <= now && o.end > now && !o.allDay ? 'now' : '';
  return h('button.item', { class: cls, style: { '--c': eventColor(ev) }, onclick: () => openEvent(o) },
    h('span.stripe'),
    h('span.when', null, whenShort(o, day)),
    h('span.item-main', null,
      h('span.title', null, ev.title),
      h('span.sub', null, cal ? `${cal.emoji} ${cal.name}` : '', ev.location ? ` · ${ev.location}` : ''),
    ),
    rx.length ? h('span.rx', null, rx.join('')) : null,
    people.length ? avatarStack(people, 22, 3, isOnline) : null,
    ev.commentCount ? h('span.cc', { title: 'Kommentare' }, icon('message', 14), ev.commentCount) : null,
  );
}

// ---------- Tag ----------

export function openDay(d) {
  const day = startOfDay(d);
  openSheet({
    live: true,
    className: 'day-sheet',
    render: (s) => {
      const occs = visibleOccurrences(day, addDays(day, 1));
      const rel = relDay(day);
      return {
        head: h('div.sheet-head', null,
          h('div.grow', null,
            h('div.eyebrow', null, rel ? `${rel} · ${weekdayName(day)}` : weekdayName(day)),
            h('h2', null, dayMonth(day), day.getFullYear() !== new Date().getFullYear() ? ` ${day.getFullYear()}` : ''),
          ),
          closeBtn(s),
        ),
        body: occs.length
          ? h('div.day-list', null, occs.map((o) => occItem(o, day)))
          : h('div.empty.small', null, h('div.empty-art', null, '☀️'), h('p', null, 'Noch nichts geplant.')),
        foot: h('button.btn.primary.block.lg', { onclick: () => openEditor({ date: day }) }, icon('plus', 20), 'Termin hinzufügen'),
      };
    },
  });
}

// ---------- Termin ansehen ----------

const REACTIONS = ['❤️', '👍', '🎉', '😂', '😮', '🙏', '🔥', '🥳'];

function currentOcc(ev, occ) {
  if (ev.rrule) return { ...occ, ev };
  return occurrences(ev, new Date(-8.64e15), new Date(8.64e15))[0] || { ...occ, ev };
}

// Passendes Vorkommen zu einem Termin (bei Serien das nächste)
export function occForEvent(ev) {
  if (!ev.rrule) return occurrences(ev, new Date(-8.64e15), new Date(8.64e15))[0];
  const from = startOfDay(new Date());
  return occurrences(ev, from, addDays(from, 800))[0] || occurrences(ev, new Date(0), addDays(from, 1)).pop();
}

export function openEventById(id) {
  const ev = state.events.get(id);
  const o = ev && occForEvent(ev);
  if (o) openEvent(o);
  else toast('Diesen Termin gibt es nicht mehr.', { error: true });
}

function statusBadge(o) {
  const now = Date.now();
  if (o.allDay) {
    const days = daysBetween(startOfDay(new Date()), startOfDay(o.start));
    if (days > 0) return h('span.ev-badge', null, icon('clock', 15), untilText(o.start));
    return null;
  }
  if (o.start <= now && o.end > now) return h('span.ev-badge', null, h('span.live-dot.red'), 'Läuft gerade');
  if (o.end <= now) return null;
  return h('span.ev-badge', null, icon('clock', 15), untilText(o.start));
}

export function openEvent(occ) {
  const id = occ.ev.id;
  let comments = null;
  let pickerOpen = false;
  let lastTyping = 0;
  const textarea = h('textarea.input', {
    rows: 1,
    placeholder: 'Kommentar schreiben …',
    maxlength: 2000,
    oninput: () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(140, textarea.scrollHeight)}px`;
      if (textarea.value && Date.now() - lastTyping > 2500) {
        lastTyping = Date.now();
        api('POST', `/api/events/${id}/typing`).catch(() => {});
      }
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    },
  });
  const sendBtn = h('button.btn.primary.icon-only', { onclick: () => send(), 'aria-label': 'Senden', title: 'Senden' }, icon('send', 18));
  const composer = h('div.composer', null, textarea, sendBtn);
  const typingEl = h('div.typing', { hidden: true, 'aria-live': 'polite' });

  async function loadComments() {
    try {
      comments = (await api('GET', `/api/events/${id}/comments`)).comments;
      const ev = state.events.get(id);
      if (ev) ev.commentCount = comments.length;
      if (!sheet.closed) sheet.refresh();
    } catch {
      /* Termin evtl. gelöscht */
    }
  }

  async function send() {
    const text = textarea.value.trim();
    if (!text) return;
    await busy(sendBtn, async () => {
      await api('POST', `/api/events/${id}/comments`, { text });
      textarea.value = '';
      textarea.style.height = 'auto';
      lastTyping = 0;
      await loadComments();
      hooks.render();
    });
  }

  async function react(emoji, el) {
    const ev = state.events.get(id);
    if (!ev) return;
    const mine = (ev.reactions?.[emoji] || []).includes(state.me.id);
    if (!mine) burstFrom(el, [emoji], 9, 0.55);
    try {
      const r = await api('POST', `/api/events/${id}/react`, { emoji });
      state.events.set(id, { ...r.event, commentCount: ev.commentCount });
      sheet.refresh();
      hooks.render();
    } catch (e) {
      errorToast(e);
    }
  }

  function reactionsRow(ev, s) {
    const chips = Object.entries(ev.reactions || {}).filter(([, ids]) => ids.length).map(([emoji, ids]) => h('button.rx-chip', {
      class: ids.includes(state.me.id) ? 'mine' : '',
      title: ids.map((x) => (x === state.me.id ? 'Du' : person(x).name)).join(', '),
      onclick: (e) => react(emoji, e.currentTarget),
    }, emoji, h('b', null, ids.length)));
    return h('div.reactions', null,
      chips,
      h('button.rx-chip.rx-add', {
        title: 'Reagieren',
        'aria-label': 'Reagieren',
        onclick: () => {
          pickerOpen = !pickerOpen;
          s.refresh();
        },
      }, icon(pickerOpen ? 'x' : 'smile', 18)),
      pickerOpen ? h('div.rx-picker', null, REACTIONS.map((e) => h('button', {
        'aria-label': `Mit ${e} reagieren`,
        onclick: (evt) => {
          pickerOpen = false;
          react(e, evt.currentTarget);
        },
      }, e))) : null,
    );
  }

  const sheet = openSheet({
    live: true,
    className: 'event-sheet',
    render: (s) => {
      const ev = state.events.get(id);
      const cal = ev && calById(ev.calendarId);
      if (!ev || !cal) {
        return { title: 'Termin', body: h('div.empty.small', null, h('div.empty-art', null, '🍃'), h('p', null, 'Dieser Termin wurde gelöscht.')) };
      }
      const o = currentOcc(ev, occ);
      const color = eventColor(ev);
      const [line1, line2] = whenLong(o);
      const going = (ev.attendees || []).includes(state.me.id);
      const people = (ev.attendees || []).map(person);
      const sub = ev.subscriptionId ? cal.subscriptions.find((x) => x.id === ev.subscriptionId) : null;
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location || '')}`;

      const attendBtn = h(`button.btn.${going ? 'going' : 'primary'}`, {
        style: { '--c': color },
        onclick: (e) => {
          const btn = e.currentTarget;
          if (!going) burstFrom(btn, ['🎉', '✨', '🥳', '💚', '🙌'], 20);
          busy(btn, async () => {
            const r = await api('POST', `/api/events/${id}/attend`, { going: !going });
            state.events.set(id, { ...r.event, commentCount: ev.commentCount });
            s.refresh();
            hooks.render();
          });
        },
      }, icon(going ? 'check' : 'sparkle', 18), going ? 'Du bist dabei' : 'Ich bin dabei');

      return {
        head: h('div.sheet-head', null,
          h('span.ev-cal', { style: { '--c': color } }, h('span.dot'), `${cal.emoji} ${cal.name}`),
          h('span.grow'),
          closeBtn(s),
        ),
        body: [
          h('h2.ev-title', null, ev.title),
          statusBadge(o),
          reactionsRow(ev, s),
          meta('clock', h('div', null, line1), h('div.muted', null, line2)),
          ev.rrule ? meta('repeat', describeRrule(ev.rrule, o.start)) : null,
          ev.location ? meta('pin', h('a', { href: mapsUrl, target: '_blank', rel: 'noopener noreferrer' }, ev.location)) : null,
          ev.notes ? meta('notes', h('div.notes', null, linkify(ev.notes))) : null,
          sub ? meta(sub.kind === 'caldav' ? 'phone' : 'feed', h('span.muted', null, sub.kind !== 'caldav'
            ? `Aus dem Abo „${sub.name}“ – wird automatisch aktualisiert.`
            : sub.host === 'iCloud'
              ? `Vom iPhone (iCloud-Kalender „${sub.name}“). Ändern kannst du den Termin dort – hier aktualisiert er sich von selbst.`
              : `Aus „${sub.name}“ (${sub.host}) – wird automatisch aktualisiert.`)) : null,
          meta('user', h('span.muted', null, `Eingetragen von ${person(ev.createdBy).name}`)),

          h('div.section', null,
            h('h3', null, 'Wer ist dabei?', people.length ? h('span.count', null, people.length) : null),
            h('div.attend', null,
              people.length
                ? h('div.people', null, people.map((p) => h('span.person', null, avatar(p, 26, { online: isOnline(p.id) }), p.id === state.me.id ? 'Du' : p.name)))
                : h('p.muted.small-text', null, 'Noch hat niemand zugesagt.'),
            ),
            attendBtn,
          ),

          h('div.section', null,
            h('h3', null, 'Kommentare', comments?.length ? h('span.count', null, comments.length) : null),
            comments === null
              ? h('p.muted.small-text', null, 'Lädt …')
              : comments.length
                ? h('div.comments', null, comments.map((c) => {
                  const who = c.author || { name: 'Ehemaliges Mitglied', color: '#9b9da4' };
                  return h('div.comment', { class: c.userId === state.me.id ? 'mine' : '' },
                    avatar(who, 30, { online: isOnline(c.userId) }),
                    h('div.bubble', null,
                      h('div.who', null, c.userId === state.me.id ? 'Du' : who.name, h('span.when', null, ago(c.createdAt))),
                      h('div.txt', null, linkify(c.text)),
                    ),
                    c.userId === state.me.id ? h('button.icon-btn.sm.del', {
                      title: 'Kommentar löschen',
                      onclick: async () => {
                        try {
                          await api('DELETE', `/api/comments/${c.id}`);
                          await loadComments();
                          hooks.render();
                        } catch (e) {
                          errorToast(e);
                        }
                      },
                    }, icon('trash', 15)) : null,
                  );
                }))
                : h('p.muted.small-text', null, 'Noch keine Kommentare. Fragt hier, wer was mitbringt 🙂'),
            typingEl,
            composer,
          ),
        ],
        foot: sub ? null : [
          h('button.btn.danger', { onclick: (e) => busy(e.currentTarget, async () => { if (await deleteEvent(ev, o)) s.close(); }) }, icon('trash', 18), 'Löschen'),
          h('span.grow'),
          h('button.btn.primary', { onclick: () => openEditor({ ev, occ: o, onSaved: () => s.close() }) }, icon('edit', 18), 'Bearbeiten'),
        ],
      };
    },
  });
  sheet.eventId = id;
  sheet.reloadComments = loadComments;
  sheet.updateTyping = () => {
    const ids = [...(state.typing.get(id)?.keys() || [])];
    typingEl.hidden = !ids.length;
    if (ids.length) {
      typingEl.replaceChildren(
        h('span.dots', null, h('i'), h('i'), h('i')),
        `${ids.map((x) => person(x).name).join(' & ')} ${ids.length > 1 ? 'schreiben' : 'schreibt'} …`,
      );
    }
  };
  sheet.onReaction = (emoji) => burstFrom(sheet.box.querySelector('.reactions'), [emoji], 9, 0.55);
  sheet.updateTyping();
  loadComments();
}

// Termin per Drag & Drop um ein paar Tage verschieben
export async function moveOccurrence(o, delta) {
  const ev = o.ev;
  const shift = (x, allDay) => (allDay ? ymd(addDays(parseYmd(x.slice(0, 10)), delta)) : addDays(new Date(x), delta).toISOString());
  try {
    if (ev.rrule && o.orig) {
      const choice = await chooseDialog({
        title: 'Serientermin verschieben',
        options: [
          { value: 'one', label: 'Nur diesen Termin', hint: dayLong(o.start) },
          { value: 'all', label: 'Alle Termine der Serie' },
        ],
      });
      if (!choice) return;
      if (choice === 'one') {
        await api('PATCH', `/api/events/${ev.id}`, { exdates: [...(ev.exdates || []), o.orig] });
        await api('POST', '/api/events', {
          calendarId: ev.calendarId, title: ev.title, allDay: ev.allDay, tz: ev.tz, location: ev.location, notes: ev.notes, color: ev.color,
          start: ev.allDay ? ymd(addDays(o.start, delta)) : addDays(o.start, delta).toISOString(),
          end: ev.allDay ? ymd(addDays(o.end, delta - 1)) : addDays(o.end, delta).toISOString(),
        });
      } else {
        await api('PATCH', `/api/events/${ev.id}`, {
          start: shift(ev.start, ev.allDay), end: shift(ev.end, ev.allDay), exdates: (ev.exdates || []).map((x) => shift(x, ev.allDay)),
        });
      }
      await loadEvents(ev.calendarId);
      hooks.render();
      toast('Verschoben');
      return;
    }
    const before = { start: ev.start, end: ev.end };
    const after = { start: shift(ev.start, ev.allDay), end: shift(ev.end, ev.allDay) };
    state.events.set(ev.id, { ...ev, ...after });
    hooks.render();
    await api('PATCH', `/api/events/${ev.id}`, after);
    toast(`„${ev.title}“ verschoben`, {
      action: {
        label: 'Rückgängig',
        run: async () => {
          try {
            await api('PATCH', `/api/events/${ev.id}`, before);
          } catch (e) {
            errorToast(e);
          }
          await loadEvents(ev.calendarId);
          hooks.render();
        },
      },
    });
    await loadEvents(ev.calendarId);
    hooks.render();
  } catch (e) {
    errorToast(e);
    await loadEvents(ev.calendarId).catch(() => {});
    hooks.render();
  }
}

async function deleteEvent(ev, o) {
  if (ev.rrule && o.orig) {
    const choice = await chooseDialog({
      title: 'Serientermin löschen',
      options: [
        { value: 'one', label: 'Nur diesen Termin', hint: dayLong(o.start) },
        { value: 'all', label: 'Alle Termine der Serie', danger: true },
      ],
    });
    if (!choice) return false;
    if (choice === 'one') await api('PATCH', `/api/events/${ev.id}`, { exdates: [...(ev.exdates || []), o.orig] });
    else await api('DELETE', `/api/events/${ev.id}`);
  } else {
    const ok = await confirmDialog({
      title: 'Termin löschen?',
      text: `„${ev.title}“ wird für alle in diesem Kalender gelöscht.`,
      ok: 'Löschen',
      danger: true,
    });
    if (!ok) return false;
    await api('DELETE', `/api/events/${ev.id}`);
  }
  await loadEvents(ev.calendarId);
  hooks.render();
  toast('Termin gelöscht');
  return true;
}

// ---------- Termin bearbeiten / anlegen ----------

export function openEditor({ ev = null, occ = null, date = null, hour = null, calendarId = null, onSaved = null } = {}) {
  if (!state.calendars.length) {
    toast('Lege zuerst einen Kalender an.');
    openNewCalendar();
    return;
  }
  const editing = !!ev;
  const now = new Date();
  let f;
  if (editing) {
    let s;
    let e;
    if (occ) {
      s = occ.start;
      e = ev.allDay ? addDays(occ.end, -1) : occ.end;
    } else {
      s = ev.allDay ? parseYmd(ev.start) : new Date(ev.start);
      e = ev.allDay ? parseYmd(ev.end) : new Date(ev.end);
    }
    const { pattern, until } = splitRrule(ev.rrule);
    f = {
      title: ev.title, calendarId: ev.calendarId, allDay: ev.allDay,
      startDate: ymd(s), startTime: ev.allDay ? '10:00' : hm(s),
      endDate: ymd(e), endTime: ev.allDay ? '11:00' : hm(e),
      repeat: pattern, until, color: ev.color, location: ev.location || '', notes: ev.notes || '',
    };
  } else {
    const base = startOfDay(date || state.cursor);
    const h0 = hour ?? (ymd(base) === ymd(now) ? Math.min(23, now.getHours() + 1) : 10);
    const s = new Date(base);
    s.setHours(h0, 0, 0, 0);
    const e = new Date(s.getTime() + 3600e3);
    f = {
      title: '', calendarId: calById(calendarId) ? calendarId : defaultCalendarId(), allDay: false,
      startDate: ymd(s), startTime: hm(s), endDate: ymd(e), endTime: hm(e),
      repeat: '', until: '', color: null, location: '', notes: '',
    };
  }

  const toDate = (d, t) => new Date(`${d}T${t || '00:00'}`);
  const durMs = () => (f.allDay ? daysBetween(parseYmd(f.startDate), parseYmd(f.endDate)) * 864e5 : toDate(f.endDate, f.endTime) - toDate(f.startDate, f.startTime));
  let keepDur = Math.max(0, durMs());
  const error = h('p.form-error', { hidden: true });

  const titleInput = h('input.title-input', {
    placeholder: 'Was steht an?',
    value: f.title,
    maxlength: 200,
    autofocus: !editing,
    'aria-label': 'Titel',
    oninput: () => {
      f.title = titleInput.value;
      titleInput.classList.remove('shake');
    },
    onkeydown: (e) => e.key === 'Enter' && save(saveBtn),
  });

  const calChips = h('div.chips');
  const drawChips = () => calChips.replaceChildren(...state.calendars.map((c) => h('button.chip', {
    type: 'button',
    class: c.id === f.calendarId ? 'on' : '',
    style: { '--c': c.color },
    onclick: () => {
      f.calendarId = c.id;
      drawChips();
      drawColors();
    },
  }, h('span', null, c.emoji), c.name)));
  drawChips();

  const sDate = h('input.input', { type: 'date', value: f.startDate, required: true });
  const sTime = h('input.input.time', { type: 'time', value: f.startTime, step: 300, required: true });
  const eDate = h('input.input', { type: 'date', value: f.endDate, required: true });
  const eTime = h('input.input.time', { type: 'time', value: f.endTime, step: 300, required: true });

  const shiftEnd = () => {
    if (f.allDay) {
      f.endDate = ymd(addDays(parseYmd(f.startDate), Math.round(keepDur / 864e5)));
    } else {
      const end = new Date(toDate(f.startDate, f.startTime).getTime() + keepDur);
      f.endDate = ymd(end);
      f.endTime = hm(end);
    }
    eDate.value = f.endDate;
    eTime.value = f.endTime;
  };
  sDate.addEventListener('change', () => {
    if (!sDate.value) return;
    f.startDate = sDate.value;
    shiftEnd();
    updateRepeatLabels();
    untilInput.min = f.startDate;
  });
  sTime.addEventListener('change', () => {
    if (!sTime.value) return;
    f.startTime = sTime.value;
    shiftEnd();
  });
  const onEnd = () => {
    if (eDate.value) f.endDate = eDate.value;
    if (eTime.value) f.endTime = eTime.value;
    keepDur = Math.max(0, durMs());
  };
  eDate.addEventListener('change', onEnd);
  eTime.addEventListener('change', onEnd);

  const repeatSel = h('select.input');
  const presets = REPEAT_PRESETS.map((p) => ({ ...p }));
  if (f.repeat && !presets.some((p) => p.id === f.repeat)) presets.push({ id: f.repeat, custom: true });
  function updateRepeatLabels() {
    const start = parseYmd(f.startDate);
    repeatSel.replaceChildren(...presets.map((p) => {
      let label = p.label;
      if (p.custom) label = `Benutzerdefiniert: ${describeRrule(p.id, start)}`;
      else if (p.id === 'FREQ=WEEKLY' || p.id === 'FREQ=MONTHLY' || p.id === 'FREQ=YEARLY') label = describeRrule(p.id, start);
      return h('option', { value: p.id, selected: p.id === f.repeat }, label);
    }));
  }
  updateRepeatLabels();
  const untilInput = h('input.input', { type: 'date', value: f.until, min: f.startDate, onchange: () => (f.until = untilInput.value) });
  const untilField = field('Wiederholung endet (optional)', untilInput);
  untilField.hidden = !f.repeat;
  repeatSel.addEventListener('change', () => {
    f.repeat = repeatSel.value;
    untilField.hidden = !f.repeat;
  });

  const colorWrap = h('div');
  const drawColors = () => colorWrap.replaceChildren(swatches(f.color, (c) => (f.color = c), {
    allowNone: true,
    noneColor: calById(f.calendarId)?.color,
  }));
  drawColors();

  const locInput = h('input.input', { value: f.location, placeholder: 'Adresse oder Treffpunkt', maxlength: 300, oninput: () => (f.location = locInput.value) });
  const notesInput = h('textarea.input', { placeholder: 'Was sollte man wissen?', maxlength: 5000, oninput: () => (f.notes = notesInput.value) }, f.notes);

  const form = h('div.editor', { class: f.allDay ? 'all-day' : '' },
    titleInput,
    field('Kalender', calChips),
    h('div.field', null, toggle('Ganztägig', f.allDay, (v) => {
      f.allDay = v;
      form.classList.toggle('all-day', v);
      keepDur = v ? Math.max(0, daysBetween(parseYmd(f.startDate), parseYmd(f.endDate))) * 864e5 : 3600e3;
      shiftEnd();
    })),
    h('div.grid-2', null,
      field('Beginn', h('div.dt', null, sDate, sTime)),
      field('Ende', h('div.dt', null, eDate, eTime)),
    ),
    error,
    h('div.grid-2', null, field('Wiederholen', repeatSel), untilField),
    field('Farbe', colorWrap),
    field('Ort', locInput),
    field('Notizen', notesInput),
  );

  async function save(btn) {
    error.hidden = true;
    if (!f.title.trim()) {
      titleInput.classList.remove('shake');
      void titleInput.offsetWidth;
      titleInput.classList.add('shake');
      titleInput.focus();
      return;
    }
    let start;
    let end;
    if (f.allDay) {
      start = f.startDate;
      end = f.endDate < f.startDate ? f.startDate : f.endDate;
    } else {
      const s = toDate(f.startDate, f.startTime);
      const e = toDate(f.endDate, f.endTime);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
        error.textContent = 'Bitte gib Datum und Uhrzeit an.';
        error.hidden = false;
        return;
      }
      if (e < s) {
        error.textContent = 'Das Ende liegt vor dem Beginn.';
        error.hidden = false;
        return;
      }
      start = s.toISOString();
      end = e.toISOString();
    }
    const payload = {
      calendarId: f.calendarId, title: f.title.trim(), allDay: f.allDay, start, end, tz: localTz(),
      rrule: joinRrule(f.repeat, f.repeat ? f.until : ''), color: f.color, location: f.location.trim(), notes: f.notes,
    };

    await busy(btn, async () => {
      if (!editing) {
        await api('POST', '/api/events', payload);
      } else if (ev.rrule && occ?.orig) {
        const choice = await chooseDialog({
          title: 'Serientermin ändern',
          text: 'Möchtest du nur diesen einen Termin ändern oder die ganze Serie?',
          options: [
            { value: 'one', label: 'Nur diesen Termin', hint: dayLong(occ.start) },
            { value: 'all', label: 'Alle Termine der Serie' },
          ],
        });
        if (!choice) return;
        if (choice === 'one') {
          await api('PATCH', `/api/events/${ev.id}`, { exdates: [...(ev.exdates || []), occ.orig] });
          await api('POST', '/api/events', { ...payload, rrule: null });
        } else {
          // Verschiebung auf den Serienbeginn übertragen
          const baseDay = ev.allDay ? parseYmd(ev.start) : startOfDay(new Date(ev.start));
          const dayDelta = daysBetween(startOfDay(occ.start), parseYmd(f.startDate));
          const newBase = addDays(baseDay, dayDelta);
          const series = { ...payload };
          let exdates = [];
          if (f.allDay) {
            series.start = ymd(newBase);
            series.end = ymd(addDays(newBase, daysBetween(parseYmd(start), parseYmd(end))));
            if (ev.allDay) exdates = (ev.exdates || []).map((x) => ymd(addDays(parseYmd(x.slice(0, 10)), dayDelta)));
          } else {
            const s = toDate(ymd(newBase), f.startTime);
            series.start = s.toISOString();
            series.end = new Date(s.getTime() + (Date.parse(end) - Date.parse(start))).toISOString();
            if (!ev.allDay) {
              const msDelta = s.getTime() - Date.parse(ev.start);
              exdates = (ev.exdates || []).map((x) => new Date(Date.parse(x) + msDelta).toISOString());
            }
          }
          await api('PATCH', `/api/events/${ev.id}`, { ...series, exdates });
        }
      } else {
        await api('PATCH', `/api/events/${ev.id}`, payload);
      }
      rememberCalendar(f.calendarId);
      setHidden(f.calendarId, false);
      await loadEvents(f.calendarId);
      if (editing && ev.calendarId !== f.calendarId) await loadEvents(ev.calendarId);
      hooks.render();
      if (!editing) burstFrom(btn, ['✨', '🎉', '🌿', '💫'], 14);
      sheet.close();
      onSaved?.();
      toast(editing ? 'Gespeichert' : 'Termin eingetragen');
    });
  }

  const saveBtn = h('button.btn.primary', { onclick: () => save(saveBtn) }, icon('check', 18), editing ? 'Speichern' : 'Eintragen');
  const sheet = openSheet({
    className: 'editor-sheet',
    render: () => ({
      title: editing ? 'Termin bearbeiten' : 'Neuer Termin',
      body: form,
      foot: [h('button.btn.ghost', { onclick: () => sheet.close() }, 'Abbrechen'), h('span.grow'), saveBtn],
    }),
  });
}

// ---------- Kalender ----------

function emojiPicker(current, onPick) {
  const wrap = h('div.emoji-grid');
  const draw = (cur) => wrap.replaceChildren(...EMOJIS.map((e) => h('button', {
    type: 'button',
    class: e === cur ? 'on' : '',
    onclick: () => {
      onPick(e);
      draw(e);
    },
  }, e)));
  draw(current);
  return wrap;
}

export function openNewCalendar() {
  let emoji = '📅';
  let color = COLORS[(state.calendars.length * 3 + 5) % COLORS.length].hex;
  const badge = h('span.cal-badge', { style: { '--c': color } }, emoji);
  const nameInput = h('input.input', { placeholder: 'z. B. WG, Familie, Fußball …', maxlength: 60, autofocus: true });
  const create = (btn) => busy(btn, async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const { calendar } = await api('POST', '/api/calendars', { name, emoji, color });
    await loadMe();
    hooks.render();
    sheet.close();
    toast('Kalender erstellt – lade jetzt deine Leute ein!');
    openCalendar(calendar.id, { invite: true });
  });
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && create(createBtn));
  const createBtn = h('button.btn.primary', { onclick: () => create(createBtn) }, 'Erstellen');
  const sheet = openSheet({
    className: 'small',
    render: () => ({
      title: 'Neuer Kalender',
      body: [
        h('p.muted', null, 'Ein Kalender für eine Gruppe – zum Beispiel deine Familie, die WG oder dein Team.'),
        h('div.row.name-row', null, badge, nameInput),
        field('Symbol', emojiPicker(emoji, (e) => {
          emoji = e;
          badge.textContent = e;
        })),
        field('Farbe', swatches(color, (c) => {
          color = c;
          badge.style.setProperty('--c', c);
        })),
      ],
      foot: [h('button.btn.ghost', { onclick: () => sheet.close() }, 'Abbrechen'), h('span.grow'), createBtn],
    }),
  });
}

export function openCalendar(calId, { invite = false } = {}) {
  const cal0 = calById(calId);
  if (!cal0) return;
  let emoji = cal0.emoji;
  let color = cal0.color;
  const nameInput = h('input.input', { value: cal0.name, maxlength: 60, oninput: () => markDirty() });
  const badge = h('span.cal-badge', { style: { '--c': color } }, emoji);
  const saveRow = h('div.save-row', { hidden: true },
    h('button.btn.primary.sm', {
      onclick: (e) => busy(e.currentTarget, async () => {
        await api('PATCH', `/api/calendars/${calId}`, { name: nameInput.value, emoji, color });
        await loadMe();
        hooks.render();
        saveRow.hidden = true;
        toast('Gespeichert');
      }),
    }, 'Änderungen speichern'),
  );
  const markDirty = () => (saveRow.hidden = false);
  const general = h('div.cal-general', null,
    h('div.row.name-row', null, badge, nameInput),
    field('Symbol', emojiPicker(emoji, (e) => {
      emoji = e;
      badge.textContent = e;
      markDirty();
    })),
    field('Farbe', swatches(color, (c) => {
      color = c;
      badge.style.setProperty('--c', c);
      markDirty();
    })),
    saveRow,
  );

  const sheet = openSheet({
    live: true,
    className: 'cal-sheet',
    render: (s) => {
      const cal = calById(calId);
      if (!cal) {
        setTimeout(() => s.close());
        return { title: '', body: h('div') };
      }
      const isOwner = cal.ownerId === state.me.id;
      const link = `${location.origin}/join/${cal.inviteCode}`;
      const shareText = `Komm in meinen Kalender „${cal.emoji} ${cal.name}“ bei Zeitgarten, dann können wir zusammen planen:`;
      const feed = `${location.origin}/feed/${cal.feedToken}.ics`;

      return {
        head: h('div.sheet-head', null,
          h('div.grow', null, h('div.eyebrow', null, 'Kalender'), h('h2', null, `${cal.emoji} ${cal.name}`)),
          closeBtn(s),
        ),
        body: [
          h('div.invite-card', { id: 'invite', style: { '--c': cal.color } },
            h('div.invite-top', null,
              h('span.invite-icon', null, icon('userPlus', 22)),
              h('div', null,
                h('strong', null, 'Freunde einladen'),
                h('p', null, 'Schick diesen Link – wer ihn öffnet, kann beitreten und mitplanen.'),
              ),
            ),
            h('div.link-box', null,
              h('span.link-text', null, link.replace(/^https?:\/\//, '')),
              h('button.btn.sm', { onclick: () => copyText(link, 'Einladungslink kopiert') }, icon('copy', 16), 'Kopieren'),
            ),
            h('div.row.wrap', null,
              navigator.share ? h('button.btn.primary.sm', {
                onclick: () => navigator.share({ title: `${cal.emoji} ${cal.name}`, text: shareText, url: link }).catch(() => {}),
              }, icon('share', 16), 'Teilen') : null,
              h('a.btn.sm.wa', {
                href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${link}`)}`,
                target: '_blank',
                rel: 'noopener noreferrer',
              }, icon('message', 16), 'WhatsApp'),
              isOwner ? h('button.btn.ghost.sm', {
                title: 'Der alte Link funktioniert danach nicht mehr',
                onclick: async (e) => {
                  const ok = await confirmDialog({
                    title: 'Neuen Link erstellen?',
                    text: 'Der bisherige Einladungslink funktioniert danach nicht mehr. Wer schon dabei ist, bleibt dabei.',
                    ok: 'Neuer Link',
                  });
                  if (ok) {
                    await busy(e.currentTarget, async () => {
                      await api('POST', `/api/calendars/${cal.id}/invite`);
                      await loadMe();
                      s.refresh();
                      toast('Neuer Einladungslink erstellt');
                    });
                  }
                },
              }, icon('refresh', 16), 'Neuer Link') : null,
            ),
          ),

          h('div.section', null,
            h('h3', null, 'Mitglieder', h('span.count', null, cal.members.length)),
            h('div.members', null, cal.members.map((m) => h('div.member', null,
              avatar(m, 36),
              h('div.m-main', null,
                h('strong', null, m.name, m.id === state.me.id ? h('span.muted', null, ' (du)') : null),
                h('span', null, m.role === 'owner' ? 'Hat den Kalender erstellt' : `Dabei seit ${shortDate(new Date(m.joinedAt))}`),
              ),
              isOwner && m.id !== state.me.id ? h('button.icon-btn', {
                title: `${m.name} entfernen`,
                onclick: async () => {
                  const ok = await confirmDialog({ title: `${m.name} entfernen?`, text: `${m.name} sieht den Kalender danach nicht mehr.`, ok: 'Entfernen', danger: true });
                  if (!ok) return;
                  try {
                    await api('DELETE', `/api/calendars/${cal.id}/members/${m.id}`);
                    await loadMe();
                    s.refresh();
                  } catch (err) {
                    errorToast(err);
                  }
                },
              }, icon('x', 18)) : null,
            ))),
          ),

          h('div.section', null, h('h3', null, 'Aussehen'), general),

          h('div.section', null,
            h('h3', null, 'Importierte Kalender'),
            cal.subscriptions.length ? h('div.subs', null, cal.subscriptions.map((sub) => {
              const phone = sub.kind === 'caldav';
              return h('div.member', null,
                h('span.sub-icon', { class: phone ? 'phone' : '', style: { '--c': cal.color } }, icon(phone ? 'phone' : 'feed', 18)),
                h('div.m-main', null,
                  h('strong', null, sub.name),
                  phone ? h('span.sub-account', null, [sub.host, sub.account].filter(Boolean).join(' · ')) : null,
                  h('span', { class: sub.error ? 'err' : '' }, sub.error
                    ? `Fehler: ${sub.error}`
                    : `${sub.count} Termine · ${phone ? '' : `${sub.host} · `}aktualisiert ${ago(sub.lastSync)}`),
                  phone && sub.error ? h('button.cd-reconnect', { type: 'button', onclick: () => openImport() }, icon('refresh', 15), 'Neu verbinden') : null,
                ),
                h('button.icon-btn', {
                  title: 'Jetzt aktualisieren',
                  'aria-label': 'Jetzt aktualisieren',
                  onclick: (e) => busy(e.currentTarget, async () => {
                    try {
                      const r = await api('POST', `/api/subscriptions/${sub.id}/sync`);
                      toast(`Aktualisiert – ${r.count} Termine`);
                    } finally {
                      // Auch nach einem Fehler neu laden – dann steht er (samt „Neu verbinden“) gleich da
                      await loadAll();
                      hooks.render();
                    }
                  }),
                }, icon('refresh', 18)),
                h('button.icon-btn', {
                  title: phone ? 'Verbindung trennen' : 'Abo entfernen',
                  'aria-label': phone ? 'Verbindung trennen' : 'Abo entfernen',
                  onclick: async () => {
                    const ok = await confirmDialog(phone ? {
                      title: 'Verbindung trennen?',
                      text: `Alle Termine aus „${sub.name}“ verschwinden aus diesem Kalender. Auf deinem iPhone bleibt alles, wie es ist.`,
                      ok: 'Trennen',
                      danger: true,
                    } : { title: 'Abo entfernen?', text: `Alle Termine aus „${sub.name}“ verschwinden aus diesem Kalender.`, ok: 'Entfernen', danger: true });
                    if (!ok) return;
                    try {
                      await api('DELETE', `/api/subscriptions/${sub.id}`);
                      await loadAll();
                      hooks.render();
                    } catch (err) {
                      errorToast(err);
                    }
                  },
                }, icon('trash', 18)),
              );
            })) : h('p.muted.small-text', null, 'Hol dir Termine vom iPhone, aus Google oder Outlook – einmalig oder als Abo, das sich selbst aktualisiert.'),
            h('button.btn.sm', { onclick: () => openImport({ calendarId: cal.id }) }, icon('upload', 16), 'Kalender importieren'),
          ),

          h('div.section', null,
            h('h3', null, 'In anderer Kalender-App anzeigen'),
            h('p.muted.small-text', null, 'Abonniere diesen Link in Apple Kalender, Google Kalender oder Outlook, um die Termine auch dort zu sehen.'),
            h('div.link-box', null,
              h('span.link-text', null, feed.replace(/^https?:\/\//, '')),
              h('button.btn.sm', { onclick: () => copyText(feed, 'Abo-Link kopiert') }, icon('copy', 16), 'Kopieren'),
            ),
          ),

          h('div.section.danger-zone', null,
            cal.members.length > 1 || !isOwner ? h('button.btn.danger.sm', {
              onclick: async (e) => {
                const ok = await confirmDialog({
                  title: 'Kalender verlassen?',
                  text: isOwner ? 'Jemand anderes aus dem Kalender wird dann zum Besitzer.' : 'Du kannst über den Einladungslink wieder beitreten.',
                  ok: 'Verlassen',
                  danger: true,
                });
                if (!ok) return;
                await busy(e.currentTarget, async () => {
                  await api('POST', `/api/calendars/${cal.id}/leave`);
                  await loadAll();
                  hooks.render();
                  s.close();
                  toast('Du hast den Kalender verlassen');
                });
              },
            }, icon('logout', 16), 'Kalender verlassen') : null,
            isOwner ? h('button.btn.danger.sm', {
              onclick: async (e) => {
                const ok = await confirmDialog({
                  title: 'Kalender löschen?',
                  text: `„${cal.name}“ und alle Termine darin werden für alle Mitglieder gelöscht. Das kann man nicht rückgängig machen.`,
                  ok: 'Endgültig löschen',
                  danger: true,
                });
                if (!ok) return;
                await busy(e.currentTarget, async () => {
                  await api('DELETE', `/api/calendars/${cal.id}`);
                  await loadAll();
                  hooks.render();
                  s.close();
                  toast('Kalender gelöscht');
                });
              },
            }, icon('trash', 16), 'Kalender löschen') : null,
          ),
        ],
      };
    },
  });
  if (invite) requestAnimationFrame(() => sheet.box.querySelector('#invite')?.classList.add('pulse'));
}

export function openInvitePicker() {
  if (state.calendars.length === 1) {
    openCalendar(state.calendars[0].id, { invite: true });
    return;
  }
  const s = openSheet({
    className: 'small',
    render: () => ({
      title: 'Freunde einladen',
      body: [
        h('p.muted', null, 'In welchen Kalender möchtest du jemanden einladen?'),
        h('div.choices', null,
          state.calendars.map((c) => h('button.choice', {
            onclick: () => {
              s.close();
              openCalendar(c.id, { invite: true });
            },
          }, h('strong', null, `${c.emoji} ${c.name}`), h('span', null, `${c.members.length} ${c.members.length === 1 ? 'Mitglied' : 'Mitglieder'}`))),
          h('button.choice', {
            onclick: () => {
              s.close();
              openNewCalendar();
            },
          }, h('strong', null, '＋ Neuer Kalender für eine Gruppe'), h('span', null, 'z. B. für die WG oder die Familie')),
        ),
      ],
    }),
  });
}

// ---------- Import ----------

const HOLIDAYS = [
  { label: '🇩🇪 Feiertage Deutschland', url: 'https://calendar.google.com/calendar/ical/de.german%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { label: '🇦🇹 Feiertage Österreich', url: 'https://calendar.google.com/calendar/ical/de.austrian%23holiday%40group.v.calendar.google.com/public/basic.ics' },
];

// Ein Schloss gibt es nicht als Symbol – feste Grafik, kein Nutzerinhalt
function lockIcon() {
  const span = h('span.icon');
  span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  return span;
}

// iPhone-Kalender über iCloud (CalDAV): 1. Verbinden, 2. Kalender auswählen
function iphoneImport({ refresh, close }) {
  let step = 1;
  let back = false;
  let found = null;
  const chosen = new Set();

  const input = (id, props) => h('input.input', { id, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', ...props });
  const userInput = input('cd-user', {
    type: 'email', inputmode: 'email', autocomplete: 'username', placeholder: 'name@icloud.com', maxlength: 200,
    value: isDemo ? 'beispiel@icloud.com' : '',
    onkeydown: (e) => e.key === 'Enter' && !e.isComposing && passInput.focus(),
  });
  const passInput = input('cd-pass', {
    type: 'password', autocomplete: 'off', placeholder: 'xxxx-xxxx-xxxx-xxxx', maxlength: 200,
    value: isDemo ? 'abcd-efgh-ijkl-mnop' : '',
    onkeydown: (e) => e.key === 'Enter' && !e.isComposing && connect(),
  });
  const showBtn = h('button.cd-show', {
    type: 'button',
    'aria-label': 'Passwort anzeigen',
    'aria-pressed': 'false',
    'aria-controls': 'cd-pass',
    onclick: () => {
      const show = passInput.type === 'password';
      passInput.type = show ? 'text' : 'password';
      showBtn.textContent = show ? 'Verbergen' : 'Zeigen';
      showBtn.setAttribute('aria-pressed', String(show));
    },
  }, 'Zeigen');
  const userLabel = h('label.label', { for: 'cd-user' }, 'Apple-ID');
  const passLabel = h('label.label', { for: 'cd-pass' }, 'App-spezifisches Passwort');
  const serverInput = input('cd-server', {
    type: 'url', inputmode: 'url', autocomplete: 'off', maxlength: 300, placeholder: 'https://cloud.example.com/remote.php/dav',
    // Bei einem eigenen Server heißt es nicht mehr Apple-ID – und der Name muss keine E-Mail-Adresse sein
    oninput: () => {
      const other = !!serverInput.value.trim();
      userLabel.textContent = other ? 'Benutzername' : 'Apple-ID';
      passLabel.textContent = other ? 'Passwort oder App-Passwort' : 'App-spezifisches Passwort';
      userInput.type = other ? 'text' : 'email';
      userInput.inputMode = other ? 'text' : 'email';
      userInput.placeholder = other ? 'Benutzername' : 'name@icloud.com';
    },
    onkeydown: (e) => e.key === 'Enter' && !e.isComposing && connect(),
  });
  const error = h('div.cd-error', { role: 'alert', hidden: true });
  const showError = (msg) => {
    error.replaceChildren(icon('x', 16), h('span', null, msg));
    error.hidden = false;
    error.scrollIntoView({ block: 'nearest' });
  };

  const steps = () => h('ol.cd-steps', { 'aria-label': 'Fortschritt' },
    h('li', { class: step === 1 ? 'on' : 'done', 'aria-current': step === 1 ? 'step' : null }, h('b', null, step > 1 ? icon('check', 13) : '1'), 'Verbinden'),
    h('li', { class: step === 2 ? 'on' : '', 'aria-current': step === 2 ? 'step' : null }, h('b', null, '2'), 'Auswählen'),
  );

  const connectBtn = h('button.btn.primary', { onclick: () => connect() }, 'Kalender anzeigen', icon('arrowR', 18));
  const connectFoot = [h('button.btn.ghost', { onclick: () => close() }, 'Abbrechen'), h('span.grow'), connectBtn];

  const connectBody = h('div.cd-step', { tabindex: '-1' },
    h('div.cd-hero', null,
      h('div.cd-art', { 'aria-hidden': 'true' },
        h('span.cd-phone', null, [5, 1, 8].map((i) => h('i', { style: { '--c': COLORS[i].hex } }))),
        h('span.cd-beam', null, h('i'), h('i'), h('i')),
        h('span.cd-tile', null, icon('calendar', 22)),
      ),
      h('div.cd-hero-text', null,
        h('strong', null, 'Deine iPhone-Kalender, direkt hier'),
        h('p', null, 'Einmal verbinden, Kalender antippen – Neues vom iPhone kommt dann von selbst.'),
      ),
    ),
    isDemo ? h('p.cd-demo', null, icon('sparkle', 16), 'Demo: Es wird nichts an Apple gesendet – du siehst Beispiel-Kalender.') : null,
    h('div.field', null, userLabel, userInput),
    h('div.field', null, passLabel, h('div.cd-pass', null, passInput, showBtn)),
    error,
    h('section.cd-howto', { 'aria-labelledby': 'cd-howto-title' },
      h('h3', { id: 'cd-howto-title' }, 'Noch kein App-Passwort? So geht’s'),
      h('ol', null,
        h('li', null, h('b', null, '1'), h('span', null, 'Öffne ', h('a', { href: 'https://account.apple.com', target: '_blank', rel: 'noopener noreferrer' }, 'account.apple.com'), ' und melde dich an.')),
        h('li', null, h('b', null, '2'), h('span', null, 'Tippe auf „Anmelden und Sicherheit“ und dann auf „App-spezifische Passwörter“.')),
        h('li', null, h('b', null, '3'), h('span', null, 'Erstelle ein neues Passwort, z. B. „Zeitgarten“, und kopiere es hierher.')),
      ),
    ),
    h('details.help.cd-other', null,
      h('summary', null, 'Anderer Kalender-Server (CalDAV)'),
      h('div.field', null, h('label.label', { for: 'cd-server' }, 'Server-Adresse'), serverInput),
      h('p.cd-hint', null, 'Für Nextcloud, mailbox.org, Fastmail & Co. Bei iCloud einfach leer lassen.'),
    ),
    h('p.cd-privacy', null, h('span.cd-lock', null, lockIcon()),
      h('span', null, 'Dein App-Passwort wird verschlüsselt gespeichert – nur damit sich deine Kalender automatisch aktualisieren. Du kannst es bei Apple jederzeit widerrufen.')),
  );

  // ---- Schritt 2 ----
  const importBtn = h('button.btn.primary', { onclick: () => importChosen() });
  const pickFoot = [h('button.btn.ghost', { onclick: () => go(1) }, icon('chevL', 18), 'Zurück'), h('span.grow'), importBtn];
  const allBtn = h('button.cd-all', { type: 'button', onclick: () => toggleAll() });
  let rows = [];
  let pickBody = null;

  const selectable = () => found.calendars.filter((c) => !c.connected);
  function updateSelection() {
    for (const { c, row, box } of rows) {
      box.checked = chosen.has(c.id);
      row.classList.toggle('on', box.checked);
    }
    const n = chosen.size;
    const free = selectable().length;
    importBtn.disabled = free > 0 && n === 0;
    importBtn.replaceChildren(icon('check', 18), free ? `${n} Kalender übernehmen` : 'Fertig');
    const all = selectable().every((c) => chosen.has(c.id));
    allBtn.textContent = all ? 'Keine auswählen' : 'Alle auswählen';
    allBtn.hidden = !free;
  }
  function toggleAll() {
    const all = selectable().every((c) => chosen.has(c.id));
    for (const c of selectable()) {
      if (all) chosen.delete(c.id);
      else chosen.add(c.id);
    }
    updateSelection();
  }

  function buildPick() {
    rows = found.calendars.map((c) => {
      const box = h('input.cd-box', {
        type: 'checkbox',
        disabled: c.connected,
        onchange: () => {
          if (box.checked) chosen.add(c.id);
          else chosen.delete(c.id);
          updateSelection();
        },
      });
      const row = h('label.cd-row', { class: c.connected ? 'connected' : '', style: { '--c': c.color, '--on-c': textOn(c.color) } },
        box,
        h('span.cd-dot'),
        h('span.cd-name', null, c.name),
        c.connected ? h('span.cd-linked', null, icon('check', 14), 'Schon verbunden') : h('span.cd-check', null, icon('check', 16)),
      );
      return { c, row, box };
    });
    const free = selectable().length;
    pickBody = h('div.cd-step', { tabindex: '-1' },
      h('div.cd-account', null,
        h('span.cd-acc-icon', null, icon('phone', 20)),
        h('div.cd-acc-main', null,
          h('strong', null, found.host, h('span.cd-ok', null, h('i'), 'verbunden')),
          h('span', null, found.account),
        ),
        h('button.btn.ghost.sm', { onclick: () => go(1) }, 'Ändern'),
      ),
      found.repaired ? h('p.cd-renewed', { role: 'status' }, icon('check', 16),
        h('span', null, found.repaired === 1
          ? 'Die Verbindung für 1 Kalender ist erneuert – er aktualisiert sich jetzt wieder.'
          : `Die Verbindung für ${found.repaired} Kalender ist erneuert – sie aktualisieren sich jetzt wieder.`)) : null,
      h('div.cd-list-head', null,
        h('h3', { id: 'cd-list-title' }, 'Deine Kalender', h('span.count', null, found.calendars.length)),
        allBtn,
      ),
      h('div.cd-list', { role: 'group', 'aria-labelledby': 'cd-list-title' }, rows.map((r) => r.row)),
      free ? null : h('p.cd-hint', null, 'Alle Kalender sind schon verbunden. Du findest sie in der Seitenleiste.'),
      h('p.cd-note', null, icon('refresh', 16),
        h('span', null, 'Bleibt automatisch aktuell: Neue und geänderte Termine vom iPhone erscheinen hier von selbst. Jeder Kalender wird ein eigener Zeitgarten-Kalender, den du auch mit Freunden teilen kannst.')),
    );
    updateSelection();
  }

  function go(n) {
    back = n < step;
    step = n;
    refresh();
    const body = step === 1 ? connectBody : pickBody;
    // Inzwischen auf einen anderen Reiter gewechselt oder geschlossen? Dann nichts weiter tun.
    const scroller = body.closest('.sheet-body');
    if (!scroller) return;
    scroller.scrollTop = 0;
    body.focus({ preventScroll: true });
  }

  async function connect() {
    if (connectBtn.disabled) return;
    error.hidden = true;
    const username = userInput.value.trim();
    const password = passInput.value.trim();
    const missing = !username ? userInput : !password ? passInput : null;
    if (missing) {
      missing.classList.remove('shake');
      void missing.offsetWidth;
      missing.classList.add('shake');
      missing.focus();
      return;
    }
    await busy(connectBtn, async () => {
      try {
        found = await api('POST', '/api/caldav/discover', { username, password, server: serverInput.value.trim() || undefined });
      } catch (e) {
        showError(e.message);
        return;
      }
      chosen.clear();
      for (const c of selectable()) chosen.add(c.id);
      buildPick();
      go(2);
    });
  }

  async function importChosen() {
    if (!selectable().length) return close();
    await busy(importBtn, async () => {
      let r;
      try {
        r = await api('POST', '/api/caldav/import', { sessionId: found.sessionId, calendars: [...chosen], tz: localTz() });
      } catch (e) {
        if (e.status !== 410) throw e;
        go(1);
        showError(e.message);
        return;
      }
      for (const x of r.imported) setHidden(x.calendarId, false);
      await loadAll();
      hooks.render();
      burstFrom(importBtn, ['📱', '✨', '📅', '🎉'], 18);
      close();
      toast(`${r.imported.length} Kalender mit ${r.total === 1 ? '1 Termin' : `${r.total} Terminen`} übernommen`);
      for (const f of r.failed) toast(`„${f.name}“ hat nicht geklappt: ${f.error}`, { error: true });
    });
  }

  return {
    body: () => {
      const el = step === 1 ? connectBody : pickBody;
      el.classList.toggle('back', back);
      return [steps(), el];
    },
    foot: () => (step === 1 ? connectFoot : pickFoot),
  };
}

export function openImport({ calendarId = null } = {}) {
  let mode = 'phone';
  let fileText = null;
  let fileName = '';
  let subscribe = true;

  const fileInput = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true, onchange: () => pick(fileInput.files[0]) });
  const dropLabel = h('div.drop-text', null, h('strong', null, 'ICS-Datei auswählen'), h('span', null, 'oder hierher ziehen'));
  const drop = h('label.drop', {
    ondragover: (e) => {
      e.preventDefault();
      drop.classList.add('over');
    },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      pick(e.dataTransfer.files[0]);
    },
  }, fileInput, icon('upload', 28), dropLabel);

  async function pick(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast('Die Datei ist zu groß (max. 15 MB).', { error: true });
      return;
    }
    fileText = await file.text();
    drop.classList.add('picked');
    dropLabel.replaceChildren(h('strong', null, file.name), h('span', null, `${Math.max(1, Math.round(file.size / 1024))} KB · bereit zum Import`));
    fileName = file.name.replace(/\.(ics|ical|ifb|icalendar)$/i, '');
  }

  const urlInput = h('input.input', { type: 'url', placeholder: 'https://… oder webcal://…', autocomplete: 'off' });
  const filePanel = h('div.panel', null,
    drop,
    h('details.help', null, h('summary', null, 'Wo bekomme ich die Datei her?'),
      h('ul', null,
        h('li', null, h('strong', null, 'Google: '), 'calendar.google.com → Zahnrad → Einstellungen → „Importieren & Exportieren“ → Exportieren. Die ZIP-Datei entpacken.'),
        h('li', null, h('strong', null, 'Apple: '), 'In der Kalender-App am Mac: Ablage → Exportieren → Exportieren …'),
        h('li', null, h('strong', null, 'Outlook: '), 'Datei → Kalender speichern (als .ics).'),
      ),
    ),
  );
  const urlPanel = h('div.panel', null,
    field('Link zum Kalender', urlInput),
    h('div.chips.wrap', null, HOLIDAYS.map((x) => h('button.chip', {
      type: 'button',
      onclick: () => {
        urlInput.value = x.url;
        if (!newName.value) newName.value = 'Feiertage';
      },
    }, x.label))),
    h('div.field', null, toggle('Automatisch aktualisieren (Abo)', subscribe, (v) => (subscribe = v))),
    h('details.help', null, h('summary', null, 'Wo finde ich den Link?'),
      h('ul', null,
        h('li', null, h('strong', null, 'Google: '), 'Einstellungen → links deinen Kalender wählen → „Privatadresse im iCal-Format“ kopieren.'),
        h('li', null, h('strong', null, 'iCloud: '), 'Kalender-App → Kalender teilen → „Öffentlicher Kalender“ einschalten → Link kopieren.'),
        h('li', null, h('strong', null, 'Outlook: '), 'Einstellungen → Kalender → Freigegebene Kalender → Kalender veröffentlichen → ICS-Link.'),
      ),
    ),
  );

  const newName = h('input.input', { placeholder: 'Leer lassen = Name aus der Datei', maxlength: 60 });
  const newNameField = field('Name', newName);
  const targetSel = h('select.input', {
    onchange: () => (newNameField.hidden = targetSel.value !== '__new'),
  },
  state.calendars.map((c) => h('option', { value: c.id, selected: c.id === calendarId }, `${c.emoji} ${c.name}`)),
  h('option', { value: '__new', selected: !calendarId }, '＋ Neuer Kalender'));
  newNameField.hidden = !!calendarId;
  const target = h('div.grid-2', null, field('Importieren in', targetSel), newNameField);

  const importBtn = h('button.btn.primary', {
    onclick: () => busy(importBtn, async () => {
      const payload = { tz: localTz(), subscribe: mode === 'url' && subscribe };
      if (mode === 'file') {
        if (!fileText) throw new Error('Bitte wähle zuerst eine .ics-Datei aus.');
        payload.ics = fileText;
      } else {
        if (!urlInput.value.trim()) throw new Error('Bitte gib einen Link ein.');
        payload.url = urlInput.value.trim();
        payload.name = newName.value.trim();
      }
      if (targetSel.value === '__new') {
        const color = COLORS[(state.calendars.length * 3 + 2) % COLORS.length].hex;
        payload.newCalendar = { name: newName.value.trim(), color, emoji: /feiertag/i.test(newName.value) ? '🎉' : '📆' };
        payload.fallbackName = mode === 'file' ? fileName : '';
      } else payload.calendarId = targetSel.value;
      const r = await api('POST', '/api/import', payload);
      setHidden(r.calendarId, false);
      await loadAll();
      hooks.render();
      sheet.close();
      toast(r.count === 1 ? '1 Termin importiert' : `${r.count} Termine importiert`);
    }),
  }, icon('upload', 18), 'Importieren');
  const cancelBtn = h('button.btn.ghost', { onclick: () => sheet.close() }, 'Abbrechen');

  const phone = iphoneImport({ refresh: () => sheet.refresh(), close: () => sheet.close() });
  const tabs = segmented([
    { value: 'phone', label: 'iPhone', icon: 'phone' },
    { value: 'file', label: 'Datei', icon: 'file' },
    { value: 'url', label: 'Link', title: 'Internet-Link', icon: 'globe' },
  ], mode, (v) => {
    mode = v;
    sheet.refresh();
  });

  const sheet = openSheet({
    className: 'import-sheet',
    render: () => ({
      title: 'Kalender importieren',
      body: [tabs, mode === 'phone' ? phone.body() : [mode === 'file' ? filePanel : urlPanel, target]],
      foot: mode === 'phone' ? phone.foot() : [cancelBtn, h('span.grow'), importBtn],
    }),
  });
}

// ---------- Profil ----------

export function openProfile() {
  let color = state.me.color;
  const preview = h('span');
  const nameInput = h('input.input', { value: state.me.name, maxlength: 40, oninput: () => drawPreview() });
  const drawPreview = () => preview.replaceChildren(avatar({ name: nameInput.value || '?', color }, 64));
  drawPreview();

  const saveBtn = h('button.btn.primary', {
    onclick: () => busy(saveBtn, async () => {
      await api('PATCH', '/api/me', { name: nameInput.value, color });
      await loadMe();
      hooks.render();
      sheet.close();
      toast('Profil gespeichert');
    }),
  }, 'Speichern');

  const sheet = openSheet({
    className: 'profile-sheet',
    render: () => ({
      title: 'Profil & Einstellungen',
      body: [
        h('div.profile-top', null, preview, h('div.grow', null, field('Dein Name', nameInput))),
        field('Deine Farbe', swatches(color, (c) => {
          color = c;
          drawPreview();
        })),
        h('button.btn.block.design-btn', { style: { marginTop: '20px' }, onclick: () => openDesign() }, icon('palette', 18), 'Design & Stil anpassen'),
        h('div.toggle-list', null, toggle('Browser-Benachrichtigungen', prefs.notify, async (v) => {
          if (v && 'Notification' in window && Notification.permission !== 'granted') {
            const r = await Notification.requestPermission().catch(() => 'denied');
            if (r !== 'granted') {
              toast('Benachrichtigungen wurden im Browser nicht erlaubt.', { error: true });
              v = false;
            }
          }
          setPrefs({ notify: v });
          sheet.refresh();
        }, 'Wenn jemand etwas einträgt, während Zeitgarten im Hintergrund offen ist')),
        h('div.section', null,
          h('h3', null, 'Auf anderem Gerät nutzen'),
          h('p.muted.small-text', null, 'Öffne diesen persönlichen Link auf deinem Handy oder Laptop, um dort mit deinem Profil angemeldet zu sein. Gib ihn niemandem sonst!'),
          h('button.btn.sm', { onclick: () => copyText(`${location.origin}/login/${auth.token}`, 'Anmelde-Link kopiert') }, icon('phone', 16), 'Anmelde-Link kopieren'),
        ),
        h('div.section.danger-zone', null,
          h('button.btn.danger.sm', {
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Auf diesem Gerät abmelden?',
                text: 'Kopiere vorher deinen Anmelde-Link – ohne ihn kommst du nicht mehr in dein Profil.',
                ok: 'Abmelden',
                danger: true,
              });
              if (!ok) return;
              auth.set(null);
              location.reload();
            },
          }, icon('logout', 16), 'Abmelden'),
        ),
      ],
      foot: [h('button.btn.ghost', { onclick: () => sheet.close() }, 'Abbrechen'), h('span.grow'), saveBtn],
    }),
  });
}

// ---------- Einladung annehmen ----------

export function inviteCard(info) {
  return h('div.invite-preview', { style: { '--c': info.calendar.color } },
    h('div.big-emoji', null, info.calendar.emoji),
    h('div.eyebrow', null, info.owner ? `${info.owner.name} lädt dich ein` : 'Du bist eingeladen'),
    h('h2', null, info.calendar.name),
    h('div.row.center', null,
      avatarStack(info.members, 28, 5),
      h('span.muted', null, `${info.memberCount} ${info.memberCount === 1 ? 'Mitglied' : 'Mitglieder'}`),
    ),
  );
}

export async function openJoin(code) {
  let info;
  try {
    info = await api('GET', `/api/invites/${encodeURIComponent(code)}`);
  } catch (e) {
    errorToast(e);
    return;
  }
  if (calById(info.calendar.id)) {
    toast(`Du bist schon in „${info.calendar.name}“`);
    return;
  }
  const joinBtn = h('button.btn.primary', {
    autofocus: true,
    onclick: () => busy(joinBtn, async () => {
      await api('POST', `/api/invites/${encodeURIComponent(code)}/accept`);
      await loadAll();
      setHidden(info.calendar.id, false);
      hooks.render();
      sheet.close();
      toast(`Willkommen in „${info.calendar.name}“!`);
    }),
  }, 'Beitreten');
  const sheet = openSheet({
    className: 'small',
    render: (s) => ({
      head: h('div.sheet-head', null, h('span.grow'), closeBtn(s)),
      body: inviteCard(info),
      foot: [h('button.btn.ghost', { onclick: () => sheet.close() }, 'Später'), h('span.grow'), joinBtn],
    }),
  });
}

// ---------- Neuigkeiten ----------

// Person hinter einer Neuigkeit (auch wenn sie noch nicht in der Mitgliederliste steht)
export function actor(a) {
  const p = person(a.userId);
  return p.name === 'Ehemaliges Mitglied' && a.name ? { id: a.userId, name: a.name, color: a.color || p.color } : p;
}

export function activityText(a) {
  const self = a.userId === state.me.id;
  const who = self ? 'Du' : actor(a).name;
  const hat = self ? 'hast' : 'hat';
  const ist = self ? 'bist' : 'ist';
  const t = a.title ? `„${a.title}“` : 'einen Termin';
  const rest = {
    'event.create': ` ${hat} ${t} eingetragen`,
    'event.update': ` ${hat} ${t} geändert`,
    'event.skip': ` ${hat} einen Termin von ${t} abgesagt`,
    'event.delete': ` ${hat} ${t} gelöscht`,
    comment: ` ${hat} ${t} kommentiert${a.text ? `: „${a.text}“` : ''}`,
    attend: ` ${ist} bei ${t} dabei 🎉`,
    react: ` ${hat} auf ${t} mit ${a.emoji || '❤️'} reagiert`,
    'member.join': ` ${ist} ${t} beigetreten 👋`,
    'member.leave': ` ${hat} ${t} verlassen`,
    import: ` ${hat} ${a.count || ''} Termine in ${t} importiert`,
  }[a.kind] || ` ${hat} etwas geändert`;
  return { who, rest, plain: `${who}${rest}` };
}

export function feedItem(a, seenAt, onOpen) {
  const cal = calById(a.calendarId);
  const { who, rest } = activityText(a);
  const unread = a.userId !== state.me.id && a.at > seenAt;
  return h('button.feed-item', {
    class: unread ? 'unread' : '',
    onclick: () => {
      if (a.eventId && state.events.has(a.eventId)) {
        onOpen?.();
        openEventById(a.eventId);
      } else if (cal) {
        onOpen?.();
        openCalendar(cal.id);
      }
    },
  },
  avatar(actor(a), 32, { online: isOnline(a.userId) }),
  h('span.txt', null, h('b', null, who), rest, h('span.ago', null, ago(a.at), cal ? ` · ${cal.emoji} ${cal.name}` : '')));
}

export function openActivity() {
  const seen = state.seenAt;
  markSeen();
  hooks.render();
  openSheet({
    live: true,
    className: 'activity-sheet',
    render: (s) => ({
      title: 'Neuigkeiten',
      body: state.activity.length
        ? h('div.feed', null, state.activity.map((a) => feedItem(a, seen, () => s.close())))
        : h('div.empty.small', null, h('div.empty-art', null, '🔔'), h('p', null, 'Noch nichts passiert. Lade Freunde ein, dann geht’s los!')),
    }),
  });
}

// ---------- Design & Stil ----------

const FONTS = [
  { id: 'modern', name: 'Modern', css: 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'rounded', name: 'Rund', css: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", Nunito, sans-serif' },
  { id: 'serif', name: 'Elegant', css: 'ui-serif, "New York", "Iowan Old Style", Palatino, Georgia, serif' },
  { id: 'mono', name: 'Technisch', css: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
];

function skinCard(sk, mode, set) {
  const p = sk[mode];
  const on = prefs.skin === sk.id;
  return h('button.skin', { class: on ? 'on' : '', 'aria-pressed': String(on), onclick: () => set({ skin: sk.id, accent: null }) },
    h('div.skin-prev', {
      class: [p.glow && 'glow', p.outline && 'outline'].filter(Boolean).join(' '),
      style: { '--p-bg': p.bg, '--p-surface': p.surface, '--p-accent': p.accent, '--p-text': p.text },
    },
    h('div.sp-side', null, h('i'), h('i'), h('i'), h('i')),
    h('div.sp-main', null, h('b.e1'), h('b'), h('b'), h('b'), h('b.e2'), h('b.e3'), h('b'), h('b'), h('b'), h('b.e1'), h('b'), h('b.e2'))),
    h('div.skin-name', null, sk.name, on ? icon('check', 16) : null),
    h('div.skin-desc', null, sk.desc),
  );
}

// „Wähl deinen Look“ nach dem Beitreten – Platzhalter, wird vom App-Team ausgebaut
export function openLookPicker({ onDone = null } = {}) {
  openDesign();
  onDone?.();
}

export function openDesign() {
  const sheet = openSheet({
    className: 'wide design-sheet',
    render: (s) => {
      const mode = resolvedMode();
      const set = (patch) => {
        setPrefs(patch);
        s.refresh();
        hooks.render();
      };
      const skin = SKINS.find((x) => x.id === prefs.skin) || SKINS[0];
      const opt = (on, onclick, ...children) => h('button.opt', { class: on ? 'on' : '', 'aria-pressed': String(on), onclick }, ...children);
      return {
        title: 'Design & Stil',
        body: [
          h('p.muted', null, 'Mach Zeitgarten zu deinem Kalender. Du siehst jede Änderung sofort, und sie gilt auch auf deinen anderen Geräten.'),
          field('Stil', h('div.skins', null, SKINS.map((sk) => skinCard(sk, mode, set)))),
          field('Hell oder dunkel', segmented([
            { value: 'auto', label: 'Automatisch', icon: 'sparkle' },
            { value: 'light', label: 'Hell', icon: 'sun' },
            { value: 'dark', label: 'Dunkel', icon: 'zap' },
          ], prefs.mode, (v) => set({ mode: v }))),
          field('Akzentfarbe', swatches(prefs.accent, (c) => set({ accent: c }), { allowNone: true, noneColor: skin[mode].accent })),
          field('So sehen Termine aus', h('div.opts', null,
            [['tint', 'Getönt'], ['solid', 'Kräftig'], ['line', 'Linie']].map(([v, label]) => opt(prefs.events === v, () => set({ events: v }),
              h(`span.sample.s-${v}`, null, '☕ Brunch'), label)))),
          field('Schrift für Überschriften', h('div.opts', null,
            FONTS.map((f) => opt(prefs.font === f.id, () => set({ font: f.id }), h('span.aa', { style: { fontFamily: f.css } }, 'Aa'), f.name)))),
          field('Ecken', h('div.opts', null,
            [['sharp', 'Eckig', '3px'], ['round', 'Rund', '9px'], ['pill', 'Extra rund', '15px']].map(([v, label, r]) => opt(prefs.corners === v, () => set({ corners: v }),
              h('span.shape', { style: { borderRadius: r } }), label)))),
          field('Abstände', segmented([
            { value: 'cozy', label: 'Luftig' },
            { value: 'compact', label: 'Kompakt' },
          ], prefs.density, (v) => set({ density: v }))),
          h('div.toggle-list', null,
            toggle('Kalenderwochen anzeigen', prefs.kw, (v) => set({ kw: v }), 'KW-Nummer in der Monatsansicht'),
            toggle('Bewegter Hintergrund & Animationen', prefs.motion, (v) => set({ motion: v }), 'Bei Aurora, Neon & Co. bewegt sich der Hintergrund sanft'),
            toggle('Konfetti & Effekte', prefs.fx, (v) => {
              set({ fx: v });
              if (v) burst(innerWidth / 2, innerHeight / 2, ['🎉', '✨', '🥳'], 18);
            }, 'Beim Zusagen, Reagieren und Eintragen'),
          ),
          h('button.btn.ghost.sm', { style: { marginTop: '18px' }, onclick: () => set({ ...DEFAULT_PREFS }) }, icon('refresh', 16), 'Auf Standard zurücksetzen'),
        ],
        foot: h('button.btn.primary.block', { onclick: () => sheet.close() }, 'Fertig'),
      };
    },
  });
}

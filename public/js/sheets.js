// Alle Fenster der App: Tag, Termin, Editor, Kalender, Import, Profil, Einladung
import { api, auth, isDemo } from './api.js';
import { h, icon, linkify } from './h.js';
import { suggestEmoji } from './emoji-hints.js';
import { ago, dayLong, dayMonth, dayShort, relDay, shortDate, time, untilText, weekdayName, whenLong, whenShort } from './fmt.js';
import { burst, burstFrom } from './fx.js';
import { describeRrule, joinRrule, occFirstDay, occLastDay, occurrences, REPEAT_PRESETS, splitRrule } from './recur.js';
import {
  COLORS, EMOJIS, attendeesFor, calById, defaultCalendarId, eventColor, hooks, loadAll, loadEvents, loadMe, markSeen, person,
  initials, rememberCalendar, setHidden, state, visibleOccurrences,
} from './state.js';
import { DEFAULT_PREFS, SKINS, prefs, resolvedMode, setPrefs } from './themes.js';
import { openFinder } from './finder.js';
import { parseNow, quickChips, swapChips } from './quick-add.js';
import { addDays, daysBetween, localTz, pad, parseYmd, startOfDay, ymd } from './time.js';
import {
  avatar, avatarStack, busy, chooseDialog, confirmDialog, copyText, errorToast, field, openSheet, segmented,
  swatches, textOn, toast,
} from './ui.js';

const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const closeBtn = (s) => h('button.icon-btn', { onclick: () => s.close(), 'aria-label': 'Schließen', title: 'Schließen' }, icon('x'));

function toggle(label, value, onChange, hint, { disabled = false } = {}) {
  const input = h('input', { type: 'checkbox', checked: value, disabled, onchange: () => onChange(input.checked) });
  return h('label.toggle', { class: disabled ? 'off' : '' }, h('span', null, label, hint ? h('small', null, hint) : null), input, h('span.track', null, h('span.thumb')));
}

const isOnline = (id) => state.online.has(id);

// ---------- Emojis in Termintiteln ----------
// Wie in views.js: Das erste Emoji im Titel ist das Symbol des Termins

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const EMOJI_LOOK = /\p{Emoji_Presentation}|\uFE0F|\p{Regional_Indicator}/u;
const graphemes = typeof Intl.Segmenter === 'function'
  ? ((seg) => (s) => Array.from(seg.segment(s), (x) => x.segment))(new Intl.Segmenter('de', { granularity: 'grapheme' }))
  : (s) => Array.from(s);
const isEmoji = (g) => EMOJI.test(g) && EMOJI_LOOK.test(g);
const tidy = (s) => s.replace(/\s+/g, ' ').replace(/\s([,.!?:;])/g, '$1').trim();

function splitTitle(title) {
  const parts = graphemes(title || '');
  const i = parts.findIndex(isEmoji);
  if (i < 0) return { emoji: '', text: (title || '').trim() };
  return { emoji: parts[i], text: tidy(`${parts.slice(0, i).join('')} ${parts.slice(i + 1).join('')}`) };
}

// Emoji am Anfang des Titels (so speichert der Editor es)
function leadingEmoji(title) {
  const parts = graphemes(title || '');
  let i = 0;
  while (i < parts.length && !parts[i].trim()) i++;
  return parts[i] && isEmoji(parts[i]) ? { emoji: parts[i], text: parts.slice(i + 1).join('').trimStart() } : { emoji: '', text: title || '' };
}

// Für Datumsangaben aus Neuigkeiten: 'YYYY-MM-DD' (ganztägig) oder ISO-Zeitpunkt
const occDate = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? parseYmd(x) : new Date(x));

// „Sa., 17. Okt., 19:00–22:00“ – kurz, zum Teilen
function whenShare(o) {
  const first = occFirstDay(o);
  const last = occLastDay(o);
  if (o.allDay) return first.getTime() === last.getTime() ? dayShort(first) : `${dayShort(first)} – ${dayShort(last)}`;
  if (first.getTime() === last.getTime()) return `${dayShort(o.start)}, ${time(o.start)}${o.end > o.start ? `–${time(o.end)}` : ''}`;
  return `${dayShort(o.start)}, ${time(o.start)} – ${dayShort(o.end)}, ${time(o.end)}`;
}

function meta(iconName, ...content) {
  return h('div.meta', null, icon(iconName, 19), h('div.v', null, ...content));
}

// ---------- Eintrag in Listen ----------

export function occItem(o, day) {
  const ev = o.ev;
  const cal = calById(ev.calendarId);
  const people = attendeesFor(ev, o.orig).map(person);
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

  async function share(ev, o) {
    const { emoji, text } = splitTitle(ev.title);
    const msg = [`${emoji || '📅'} ${text || ev.title}`, whenShare(o), ev.location?.trim()].filter(Boolean).join(' · ');
    // In der Demo gibt es keinen Server, der den Link öffnen könnte
    const url = isDemo ? '' : `${location.origin}/e/${ev.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: ev.title, text: msg, ...(url ? { url } : {}) });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return; // selbst abgebrochen
      }
    }
    copyText(url ? `${msg}\n${url}` : msg, url ? 'Termin mit Link kopiert – jetzt einfach einfügen' : 'Termin kopiert');
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
      // Bei Serien gilt die Zusage nur für diesen einen Tag
      const perDate = !!(ev.rrule && o.orig);
      const ids = attendeesFor(ev, o.orig);
      const going = ids.includes(state.me.id);
      const people = ids.map(person);
      const sub = ev.subscriptionId ? cal.subscriptions.find((x) => x.id === ev.subscriptionId) : null;
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location || '')}`;
      const { emoji, text } = splitTitle(ev.title);
      const sym = emoji || suggestEmoji(ev.title);

      const attendBtn = h(`button.btn.${going ? 'going' : 'primary'}`, {
        style: { '--c': color },
        onclick: (e) => {
          const btn = e.currentTarget;
          if (!going) burstFrom(btn, ['🎉', '✨', '🥳', '💚', '🙌'], 20);
          busy(btn, async () => {
            const r = await api('POST', `/api/events/${id}/attend`, { going: !going, ...(perDate ? { occurrence: o.orig } : {}) });
            state.events.set(id, { ...r.event, commentCount: ev.commentCount });
            s.refresh();
            hooks.render();
          });
        },
      }, icon(going ? 'check' : 'sparkle', 18), going ? 'Du bist dabei' : 'Ich bin dabei');

      return {
        head: h('div.ev-hero', { style: { '--c': color } },
          sym ? h('span.ev-hero-art', { 'aria-hidden': 'true' }, sym) : null,
          h('div.ev-hero-top', null,
            h('span.ev-cal', null, h('span.dot'), `${cal.emoji} ${cal.name}`),
            h('span.grow'),
            h('button.ev-share', { type: 'button', onclick: () => share(ev, o), title: 'Termin teilen' }, icon('share', 16), h('span', null, 'Teilen')),
            closeBtn(s),
          ),
          h('div.ev-hero-main', null,
            h('span.ev-emoji', { class: sym ? '' : 'none', 'aria-hidden': 'true' }, sym || icon('calendar', 30)),
            h('div.ev-hero-text', null,
              h('h2.ev-title', null, text || ev.title),
              h('div.ev-when', null, h('strong', null, line1), h('span', null, line2)),
            ),
          ),
        ),
        body: [
          h('div.ev-strip', null, statusBadge(o), reactionsRow(ev, s)),
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
            perDate ? h('p.muted.small-text.per-date', null, icon('repeat', 14), `Zusagen gelten nur für ${dayLong(o.start)}.`) : null,
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
        // Der Tag fällt aus der Serie heraus und wird ein eigener Termin (mit seinen Zusagen)
        await api('POST', `/api/events/${ev.id}/detach`, {
          occurrence: o.orig,
          patch: {
            start: ev.allDay ? ymd(addDays(o.start, delta)) : addDays(o.start, delta).toISOString(),
            end: ev.allDay ? ymd(addDays(o.end, delta - 1)) : addDays(o.end, delta).toISOString(),
          },
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

export function openEditor({ ev = null, occ = null, date = null, hour = null, start = null, end = null, calendarId = null, onSaved = null, quick = '' } = {}) {
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
    const s = start ? new Date(start) : new Date(base);
    if (!start) s.setHours(h0, 0, 0, 0);
    const e = start && end ? new Date(end) : new Date(s.getTime() + 3600e3);
    f = {
      title: '', calendarId: calById(calendarId) ? calendarId : defaultCalendarId(), allDay: false,
      startDate: ymd(s), startTime: hm(s), endDate: ymd(e), endTime: hm(e),
      repeat: '', until: '', color: null, location: '', notes: '',
    };
  }

  // Emoji des Termins: steht vorne im Titel, im Editor als runder Knopf neben dem Titel
  const lead = leadingEmoji(f.title);
  let emoji = lead.emoji;
  f.title = lead.text;
  const snapshot = () => JSON.stringify({ ...f, emoji });
  const initial = snapshot();

  const toDate = (d, t) => new Date(`${d}T${t || '00:00'}`);
  const durMs = () => (f.allDay ? daysBetween(parseYmd(f.startDate), parseYmd(f.endDate)) * 864e5 : toDate(f.endDate, f.endTime) - toDate(f.startDate, f.startTime));
  let keepDur = Math.max(0, durMs());
  const error = h('p.form-error', { hidden: true });

  const titleInput = h('input.title-input', {
    placeholder: 'Was steht an?',
    value: f.title,
    maxlength: 200,
    'aria-label': 'Titel',
    oninput: () => {
      // Emoji vorne eingetippt? Dann wandert es in den runden Knopf
      const typed = leadingEmoji(titleInput.value);
      if (typed.emoji) {
        const cut = titleInput.value.length - typed.text.length;
        const pos = Math.max(0, (titleInput.selectionStart ?? titleInput.value.length) - cut);
        titleInput.value = typed.text;
        titleInput.setSelectionRange(pos, pos);
        setEmoji(typed.emoji);
      }
      f.title = titleInput.value;
      titleInput.classList.remove('shake');
      drawEmojiBtn();
      updateSuggest();
    },
    onkeydown: (e) => e.key === 'Enter' && !e.isComposing && save(saveBtn),
  });

  const emojiBtn = h('button.ev-emoji-btn', {
    type: 'button',
    title: 'Emoji wählen',
    'aria-label': 'Emoji für den Termin wählen',
    'aria-expanded': 'false',
    onclick: () => showPicker(emojiPop.hidden),
  });
  const emojiPop = h('div.ev-emoji-pop', { hidden: true });
  const suggestBtn = h('button.emoji-suggest', { type: 'button', hidden: true, onclick: () => pickEmoji(suggestBtn.dataset.emoji) });

  // Symbol des Termins: das Emoji vorne – oder eines, das schon irgendwo im Titel steht
  const shownEmoji = () => emoji || splitTitle(f.title).emoji;
  function drawEmojiBtn() {
    const e = shownEmoji();
    if (emojiBtn.dataset.emoji === e) return;
    emojiBtn.dataset.emoji = e;
    emojiBtn.replaceChildren(e ? h('span', null, e) : icon('smilePlus', 22));
    emojiBtn.classList.toggle('set', !!e);
    emojiBtn.setAttribute('aria-label', e ? `Emoji ${e} ändern` : 'Emoji für den Termin wählen');
  }
  function setEmoji(e) {
    emoji = e || '';
    drawEmojiBtn();
    updateSuggest();
    if (!emojiPop.hidden) drawPicker();
  }
  // Auswahl im Knopf: ein Emoji mitten im Titel wird dabei ersetzt, damit es nur ein Symbol gibt
  function pickEmoji(e) {
    const inside = splitTitle(f.title);
    if (inside.emoji) titleInput.value = f.title = inside.text;
    setEmoji(e);
  }
  function updateSuggest() {
    const tip = !emoji && f.title.trim() && !splitTitle(f.title).emoji ? suggestEmoji(f.title) : '';
    suggestBtn.hidden = !tip;
    if (tip && suggestBtn.dataset.emoji !== tip) {
      suggestBtn.dataset.emoji = tip;
      suggestBtn.replaceChildren(h('span.e', null, tip), 'hinzufügen');
      suggestBtn.setAttribute('aria-label', `Emoji ${tip} hinzufügen`);
    }
  }
  function drawPicker() {
    const tip = suggestEmoji(f.title);
    emojiPop.replaceChildren(...[
      emojiPicker(shownEmoji(), (e) => {
        pickEmoji(e);
        showPicker(false);
      }, [...new Set([tip, ...EVENT_EMOJIS].filter(Boolean))]),
      shownEmoji() ? h('button.btn.ghost.sm.no-emoji', {
        type: 'button',
        onclick: () => {
          pickEmoji('');
          showPicker(false);
        },
      }, icon('x', 15), 'Kein Emoji') : null,
    ].filter(Boolean));
  }
  function showPicker(open) {
    if (open) drawPicker();
    emojiPop.hidden = !open;
    emojiBtn.setAttribute('aria-expanded', String(open));
    emojiBtn.classList.toggle('open', open);
  }
  setEmoji(emoji);

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

  const allDayToggle = toggle('Ganztägig', f.allDay, (v) => {
    f.allDay = v;
    form.classList.toggle('all-day', v);
    keepDur = v ? Math.max(0, daysBetween(parseYmd(f.startDate), parseYmd(f.endDate))) * 864e5 : 3600e3;
    shiftEnd();
  });

  // ---------- ✨ Schnell eintragen: Text tippen, die Felder darunter füllen sich ----------
  const base = { ...f };
  const baseEmoji = emoji;
  const quickChipRow = h('div.qa-chips', { 'aria-live': 'polite' });
  const quickInput = h('input.input.qa-input', {
    type: 'text',
    value: quick,
    placeholder: 'z. B. „Fr 19 Uhr Pizza bei Max“',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    spellcheck: 'false',
    enterkeyhint: 'done',
    maxlength: 300,
    autofocus: true,
    'aria-label': 'Schnell eintragen',
    oninput: () => applyQuick(),
    onkeydown: (e) => e.key === 'Enter' && !e.isComposing && save(saveBtn),
  });
  function applyQuick() {
    const text = quickInput.value;
    const { notes, color } = f;
    Object.assign(f, base, { notes, color });
    let em = baseEmoji;
    const p = text.trim() ? parseNow(text) : null;
    if (p) {
      const kinds = new Set(p.matched.map((m) => m.kind));
      const ownTime = kinds.has('time') || kinds.has('duration');
      // Ohne Datum im Text gilt der Tag, für den der Editor geöffnet wurde
      const ownDate = kinds.has('date') || !!p.rrule || base.startDate === ymd(new Date());
      const day = ownDate ? startOfDay(p.start) : parseYmd(base.startDate);
      f.title = p.title;
      em = p.emoji || '';
      if (p.calendarId) f.calendarId = p.calendarId;
      if (p.location) f.location = p.location;
      if (p.rrule) ({ pattern: f.repeat, until: f.until } = splitRrule(p.rrule));
      f.allDay = p.allDay;
      if (p.allDay) {
        f.startDate = ymd(day);
        f.endDate = ymd(addDays(day, daysBetween(startOfDay(p.start), startOfDay(p.end))));
      } else {
        let s = toDate(ymd(day), base.startTime);
        let dur = toDate(base.endDate, base.endTime) - s;
        if (ownTime) {
          s = ownDate ? p.start : toDate(ymd(day), hm(p.start));
          dur = p.end - p.start;
        }
        const e = new Date(s.getTime() + dur);
        Object.assign(f, { startDate: ymd(s), startTime: hm(s), endDate: ymd(e), endTime: hm(e) });
      }
    }
    keepDur = Math.max(0, durMs());
    // Felder nachziehen
    titleInput.value = f.title;
    titleInput.classList.remove('shake');
    allDayToggle.querySelector('input').checked = f.allDay;
    form.classList.toggle('all-day', f.allDay);
    sDate.value = f.startDate;
    sTime.value = f.startTime;
    eDate.value = f.endDate;
    eTime.value = f.endTime;
    if (f.repeat && !presets.some((x) => x.id === f.repeat)) presets.push({ id: f.repeat, custom: true });
    updateRepeatLabels();
    repeatSel.value = f.repeat;
    untilInput.value = f.until;
    untilInput.min = f.startDate;
    untilField.hidden = !f.repeat;
    locInput.value = f.location;
    drawChips();
    drawColors();
    setEmoji(em);
    const chips = p ? quickChips(p) : [];
    swapChips(quickChipRow, (chips.length ? chips : [h('span.qa-tip', null, p
      ? 'Tipp: Tag, Uhrzeit, Ort („bei Max“), „jeden Dienstag“ oder #Kalender dazuschreiben'
      : 'Datum, Uhrzeit, Ort, Wiederholung und #Kalender werden erkannt')]));
  }
  const quickBox = editing ? null : h('div.qa-editor', null,
    h('label.qa-label', null, h('span', { 'aria-hidden': 'true' }, '✨'), 'Schnell eintragen'),
    quickInput,
    quickChipRow,
  );

  const form = h('div.editor', { class: f.allDay ? 'all-day' : '' },
    quickBox,
    h('div.title-row', null, emojiBtn, titleInput),
    suggestBtn,
    emojiPop,
    field('Kalender', calChips),
    h('div.field', null, allDayToggle),
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
    showPicker(false);
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
      calendarId: f.calendarId, title: emoji ? `${emoji} ${f.title.trim()}` : f.title.trim(), allDay: f.allDay, start, end, tz: localTz(),
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
          const patch = { ...payload };
          delete patch.rrule;
          await api('POST', `/api/events/${ev.id}/detach`, { occurrence: occ.orig, patch });
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
  if (!editing) applyQuick();
  const sheet = openSheet({
    className: 'editor-sheet',
    isDirty: () => snapshot() !== initial,
    render: () => ({
      title: editing ? 'Termin bearbeiten' : 'Neuer Termin',
      body: form,
      foot: [h('button.btn.ghost', { onclick: () => sheet.requestClose() }, 'Abbrechen'), h('span.grow'), saveBtn],
    }),
  });
}

// ---------- Kalender ----------

// Auswahl für Termine (das passende Emoji zum Titel kommt noch nach vorne)
const EVENT_EMOJIS = [
  '🎉', '🎂', '🍕', '🍽️', '☕️', '🍻', '🍷', '🎬', '🎵', '🎸', '🎮', '⚽️', '🏃', '🧘', '🏋️', '🚲',
  '🏊', '⛰️', '✈️', '🏖️', '🚗', '🏠', '🛒', '💼', '📚', '🎓', '🩺', '🦷', '💇', '🐶', '👶', '❤️',
  '🎁', '🌿', '⭐️', '📞',
];

function emojiPicker(current, onPick, list = EMOJIS) {
  const wrap = h('div.emoji-grid');
  const draw = (cur) => wrap.replaceChildren(...list.map((e) => h('button', {
    type: 'button',
    'aria-label': e,
    'aria-pressed': String(e === cur),
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
      const feed = cal.feedToken ? `${location.origin}/feed/${cal.feedToken}.ics` : null;

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
                  const ok = await confirmDialog({ title: `${m.name} entfernen?`, text: `${m.name} sieht den Kalender danach nicht mehr. Dein Einladungslink wird dabei erneuert.`, ok: 'Entfernen', danger: true });
                  if (!ok) return;
                  try {
                    const r = await api('DELETE', `/api/calendars/${cal.id}/members/${m.id}`);
                    if (r?.inviteCode) cal.inviteCode = r.inviteCode; // gleich den neuen Link zeigen
                    s.refresh();
                    toast(`${m.name} wurde entfernt. Der Einladungslink ist jetzt neu – der alte funktioniert nicht mehr.`);
                    await loadMe();
                    s.refresh();
                  } catch (err) {
                    errorToast(err);
                  }
                },
              }, icon('x', 18)) : null,
            ))),
            cal.members.length > 1 ? h('button.btn.block.finder-cal-btn', { onclick: () => openFinder({ userIds: cal.members.map((m) => m.id) }) },
              icon('users', 18), 'Wann habt ihr alle Zeit?') : null,
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

          feed ? h('div.section.feed-section', null,
            h('h3', null, 'In anderer Kalender-App anzeigen'),
            h('a.apple-cal', { href: feed.replace(/^https?:/, 'webcal:') },
              h('span.apple-cal-ic', { 'aria-hidden': 'true' }, h('b', null, weekdayName(new Date()).slice(0, 2)), h('i', null, new Date().getDate())),
              h('span.apple-cal-txt', null,
                h('strong', null, 'In Apple Kalender anzeigen'),
                h('span', null, 'Im iPhone-Kalender, in Widgets und auf der Apple Watch – bleibt von selbst aktuell.'),
              ),
              icon('chevR', 18),
            ),
            h('p.muted.small-text', null, 'Für Google Kalender oder Outlook: Diesen Link dort als Kalender-Abo („per URL“) hinzufügen.'),
            h('div.link-box', null,
              h('span.link-text', null, feed.replace(/^https?:\/\//, '')),
              h('button.btn.sm', { onclick: () => copyText(feed, 'Abo-Link kopiert') }, icon('copy', 16), 'Kopieren'),
            ),
            h('p.muted.tiny-note', null, icon('key', 13), 'Der Link gehört nur dir – gib ihn nicht weiter.'),
          ) : null,

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

// Emojis als eigenes Profilbild (statt Initialen)
const AVATAR_EMOJIS = [
  '😀', '😎', '🤓', '🥳', '😇', '🤠', '🦊', '🐶', '🐱', '🐼', '🐸', '🦄', '🐝', '🐙', '🌻', '🌈',
  '⭐️', '🔥', '🍀', '🌊', '🎸', '⚽️', '🚀', '🍕', '🧁', '🎨', '📚',
];

// „Auf anderem Gerät anmelden“: Einmal-Code mit Countdown
function pairPanel() {
  const TTL = 10 * 60e3;
  let pair = null; // { code, expiresAt }
  let until = 0; // nach der eigenen Uhr – falls die Uhr des Geräts etwas falsch geht
  let done = false;
  let timer = null;
  const box = h('div.pair');
  const codeBtn = h('button.btn.primary.sm', { onclick: () => fetchCode() }, icon('key', 16), 'Code anzeigen');
  const left = () => (pair ? Math.max(0, until - Date.now()) : 0);

  async function fetchCode() {
    await busy(codeBtn, async () => {
      try {
        pair = await api('POST', '/api/me/pair-code');
      } catch (e) {
        if (e.status === 404) throw new Error('Das geht auf diesem Server noch nicht – nimm unten den Anmelde-Link.');
        throw e;
      }
      const ms = Date.parse(pair.expiresAt) - Date.now();
      until = Date.now() + (ms > 0 && ms <= TTL ? ms : TTL);
      done = false;
      draw();
    });
  }

  function tick() {
    const ms = left();
    const count = box.querySelector('.pair-count');
    const bar = box.querySelector('.pair-bar i');
    if (!count || !ms) {
      clearInterval(timer);
      timer = null;
      if (pair && !ms) draw();
      return;
    }
    const sec = Math.ceil(ms / 1000);
    count.textContent = `Noch ${Math.floor(sec / 60)}:${pad(sec % 60)} gültig · nur einmal`;
    bar.style.transform = `scaleX(${ms / TTL})`;
  }

  function draw() {
    clearInterval(timer);
    timer = null;
    const steps = h('ol.pair-steps', null,
      h('li', null, 'Auf dem iPhone: Zeitgarten vom Home-Bildschirm öffnen'),
      h('li', null, 'auf „Ich hab schon ein Profil“ tippen'),
      h('li', null, 'Code eingeben – fertig'),
    );
    if (done) {
      box.replaceChildren(h('div.pair-done', { role: 'status' }, h('span.pair-ok', null, icon('check', 20)),
        h('span', null, h('strong', null, 'Geschafft!'), ' Dein anderes Gerät ist jetzt angemeldet.')));
      return;
    }
    if (!pair) {
      codeBtn.replaceChildren(icon('key', 16), 'Code anzeigen');
      box.replaceChildren(steps, codeBtn);
      return;
    }
    if (!left()) {
      codeBtn.replaceChildren(icon('refresh', 16), 'Neuen Code');
      box.replaceChildren(h('div.pair-card.expired', null,
        h('span.eyebrow', null, 'Code abgelaufen'),
        h('strong.pair-code', null, pair.code),
        h('span.pair-count', null, 'Hol dir einfach einen neuen.'),
        codeBtn,
      ));
      return;
    }
    box.replaceChildren(
      h('div.pair-card', null,
        h('span.eyebrow', null, 'Dein Code'),
        h('strong.pair-code', { 'aria-label': pair.code.split('').join(' ') }, pair.code),
        h('span.pair-bar', { 'aria-hidden': 'true' }, h('i')),
        h('span.pair-count', { 'aria-live': 'off' }),
        h('button.btn.sm', { onclick: () => copyText(pair.code, 'Code kopiert') }, icon('copy', 15), 'Kopieren'),
      ),
      steps,
    );
    tick();
    timer = setInterval(tick, 1000);
  }

  draw();
  return {
    el: box,
    stop: () => clearInterval(timer),
    // Das andere Gerät hat den Code benutzt (Live-Nachricht „paired“)
    paired: () => {
      if (!pair) return;
      pair = null;
      done = true;
      draw();
    },
  };
}

export function openProfile() {
  let color = state.me.color;
  let emoji = state.me.emoji || '';
  const preview = h('span.profile-av');
  const nameInput = h('input.input', { value: state.me.name, maxlength: 40, oninput: () => drawPreview() });
  const drawPreview = () => preview.replaceChildren(avatar({ name: nameInput.value || '?', color, emoji }, 64));
  const current = () => JSON.stringify([nameInput.value, color, emoji]);
  const initial = current();
  drawPreview();

  const emojiGrid = h('div.emoji-grid.av-emojis');
  const drawEmojis = () => emojiGrid.replaceChildren(
    h('button.av-none', {
      type: 'button',
      class: emoji ? '' : 'on',
      'aria-pressed': String(!emoji),
      title: 'Kein Emoji – deine Initialen',
      'aria-label': 'Kein Emoji, Initialen zeigen',
      style: { '--c': color },
      onclick: () => pickEmoji(''),
    }, h('span', null, initials(nameInput.value || '?'))),
    ...AVATAR_EMOJIS.map((e) => h('button', { type: 'button', class: e === emoji ? 'on' : '', 'aria-pressed': String(e === emoji), 'aria-label': e, onclick: () => pickEmoji(e) }, e)),
  );
  const pickEmoji = (e) => {
    emoji = e;
    drawPreview();
    drawEmojis();
  };
  drawEmojis();

  const pairing = pairPanel();
  const canNotify = 'Notification' in window;
  const blocked = canNotify && Notification.permission === 'denied';

  const saveBtn = h('button.btn.primary', {
    onclick: () => busy(saveBtn, async () => {
      await api('PATCH', '/api/me', { name: nameInput.value, color, emoji: emoji || null });
      await loadMe();
      hooks.render();
      sheet.close();
      toast('Profil gespeichert');
    }),
  }, 'Speichern');

  const sheet = openSheet({
    className: 'profile-sheet',
    isDirty: () => current() !== initial,
    onClose: () => pairing.stop(),
    render: () => ({
      title: 'Profil & Einstellungen',
      body: [
        h('div.profile-top', null, preview, h('div.grow', null, field('Dein Name', nameInput))),
        field('Dein Bild', emojiGrid),
        field('Deine Farbe', swatches(color, (c) => {
          color = c;
          drawPreview();
          drawEmojis();
        })),
        h('button.btn.block.design-btn', { style: { marginTop: '20px' }, onclick: () => openDesign() }, icon('palette', 18), 'Design & Stil anpassen'),
        h('div.toggle-list', null, toggle('Browser-Benachrichtigungen', canNotify && prefs.notify, async (v) => {
          if (v && canNotify && Notification.permission !== 'granted') {
            const r = await Notification.requestPermission().catch(() => 'denied');
            if (r !== 'granted') {
              toast('Benachrichtigungen wurden im Browser nicht erlaubt.', { error: true });
              v = false;
            }
          }
          setPrefs({ notify: v });
          sheet.refresh();
        }, !canNotify
          ? 'Auf dem iPhone geht das, sobald Zeitgarten auf dem Home-Bildschirm liegt.'
          : blocked
            ? 'Im Browser blockiert – erlaube sie in den Einstellungen der Website.'
            : 'Wenn jemand etwas einträgt, während Zeitgarten im Hintergrund offen ist', { disabled: !canNotify }),
        toggle('Freien/Belegt-Status mit Freunden teilen', state.shareBusy !== false, async (v) => {
          try {
            await api('PATCH', '/api/me', { shareBusy: v });
            state.shareBusy = v;
          } catch (err) {
            errorToast(err);
          }
          sheet.refresh();
        }, 'Für „Wann habt ihr Zeit?“: nur „frei“ oder „belegt“, nie was du vorhast. Aus: Freunde sehen nur Termine aus euren gemeinsamen Kalendern.')),
        h('div.section', null,
          h('h3', null, 'Auf anderem Gerät anmelden'),
          h('p.muted.small-text', null, 'Hol dir einen Code und gib ihn auf dem anderen Gerät ein – zum Beispiel in der Zeitgarten-App auf deinem iPhone.'),
          pairing.el,
          h('div.pair-alt', null,
            h('p.muted.small-text', null, 'Oder öffne deinen persönlichen Anmelde-Link auf dem anderen Gerät. Gib ihn niemandem sonst!'),
            h('button.btn.sm', { onclick: () => copyText(`${location.origin}/login/${auth.token}`, 'Anmelde-Link kopiert') }, icon('link', 16), 'Anmelde-Link kopieren'),
          ),
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
      foot: [h('button.btn.ghost', { onclick: () => sheet.requestClose() }, 'Abbrechen'), h('span.grow'), saveBtn],
    }),
  });
  sheet.onPaired = pairing.paired;
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
  // Tag einer Serie („am Sa., 17. Okt.“) – ältere Meldungen haben ihn noch nicht
  const day = (x) => {
    const d = x ? occDate(x) : null;
    return d && !Number.isNaN(d.getTime()) ? dayShort(d) : '';
  };
  const on = day(a.occurrence);
  const moved = () => {
    const to = day(a.start);
    if (!on || !to) return ` ${hat} einen Termin von ${t} verschoben`;
    if (to !== on) return ` ${hat} ${t} vom ${on} auf ${to} verschoben`;
    const at = !a.allDay && a.start ? time(new Date(a.start)) : '';
    const was = !a.allDay && a.occurrence ? time(new Date(a.occurrence)) : '';
    return at && at !== was ? ` ${hat} ${t} am ${on} auf ${at} Uhr verschoben` : ` ${hat} ${t} am ${on} geändert`;
  };
  const rest = {
    'event.create': ` ${hat} ${t} eingetragen`,
    'event.update': ` ${hat} ${t} geändert`,
    'event.skip': on ? ` ${hat} ${t} am ${on} abgesagt` : ` ${hat} einen Termin von ${t} abgesagt`,
    'event.moveone': moved(),
    'event.delete': ` ${hat} ${t} gelöscht`,
    comment: ` ${hat} ${t} kommentiert${a.text ? `: „${a.text}“` : ''}`,
    attend: on ? ` ${ist} bei ${t} am ${on} dabei 🎉` : ` ${ist} bei ${t} dabei 🎉`,
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

// Echte Mini-Vorschau eines Stils: Hintergrund, Überschrift, Kalender-Karte mit Terminen
function skinPreview(sk, mode) {
  const p = sk[mode] || sk.dark;
  return h('span.skin-prev', {
    class: [`pv-${sk.id}`, p.glow && 'glow', p.outline && 'outline', sk.live && 'live'].filter(Boolean).join(' '),
    'data-pv': mode,
    'aria-hidden': 'true',
    style: { '--p-bg': p.bg, '--p-surface': p.surface, '--p-accent': p.accent, '--p-text': p.text },
  },
  h('span.pv-fx'),
  h('span.pv-head', null, h('b'), h('i')),
  h('span.pv-card', null, h('i.pv-today'), h('em.b1'), h('em.b2'), h('em.b3'), h('em.b4')),
  sk.live ? h('span.pv-live', null, h('i'), 'Live') : null,
  );
}

// Live-Stile zeigen die dunkle Variante, solange man hell eingestellt hat – so sehen sie nach der Wahl aus
const previewMode = (sk, mode) => (sk.live && mode === 'light' && prefs.skin !== sk.id ? 'dark' : mode);

function skinCard(sk, mode, onPick, { big = false } = {}) {
  const on = prefs.skin === sk.id;
  return h(`button.skin${big ? '.big' : ''}`, { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), onclick: () => onPick(sk) },
    skinPreview(sk, previewMode(sk, mode)),
    h('span.skin-name', null, sk.name, on ? icon('check', 16) : null),
    h('span.skin-desc', null, sk.desc.replace(/^Live · /, '')),
  );
}

// Stil übernehmen. Live-Stile leuchten im Dunkeln am schönsten: Bei „Hell“ wird auf „Dunkel“ gestellt.
function applySkin(sk, { after = null, quiet = false } = {}) {
  const toDark = !!sk.live && resolvedMode() === 'light';
  setPrefs({ skin: sk.id, accent: null, ...(toDark ? { mode: 'dark' } : {}) });
  hooks.render();
  if (toDark && !quiet) {
    toast('Jetzt dunkel – da leuchten Live-Stile am schönsten.', {
      action: {
        label: 'Hell lassen',
        run: () => {
          setPrefs({ mode: 'light' });
          hooks.render();
          after?.();
        },
      },
    });
  }
  return toDark;
}

const LOOKS = ['garten', 'aurora', 'neon', 'jarvis', 'synthwave', 'galaxie', 'sakura', 'tiefsee', 'glas', 'matrix'];

// „Wähl deinen Look“ – für neue Profile und nach dem Beitreten
export function openLookPicker({ onDone = null } = {}) {
  let darkHint = false;
  const looks = LOOKS.map((id) => SKINS.find((x) => x.id === id)).filter(Boolean);
  const sheet = openSheet({
    className: 'wide look-sheet',
    onClose: () => onDone?.(),
    render: (s) => {
      const mode = resolvedMode();
      const pick = (sk) => {
        darkHint = applySkin(sk, { quiet: true }) || (darkHint && !!sk.live);
        s.refresh();
      };
      return {
        head: h('div.sheet-head.look-head', null,
          h('div.grow', null,
            h('div.eyebrow', null, icon('sparkle', 14), 'Willkommen bei Zeitgarten'),
            h('h2', null, 'Wähl deinen Look'),
          ),
          closeBtn(s),
        ),
        body: [
          h('p.muted.look-sub', null, 'Tipp einfach drauf – Zeitgarten ändert sich sofort. Du kannst jederzeit wechseln.'),
          h('div.looks', null, looks.map((sk) => skinCard(sk, mode, pick, { big: true }))),
          darkHint && mode === 'dark' ? h('div.skin-hint', { role: 'status' }, icon('moon', 16),
            h('span', null, 'Live-Stile leuchten im Dunkeln – darum ist jetzt „Dunkel“ an.'),
            h('button.btn.sm', {
              onclick: () => {
                darkHint = false;
                setPrefs({ mode: 'light' });
                hooks.render();
                s.refresh();
              },
            }, icon('sun', 15), 'Hell lassen')) : null,
        ],
        foot: [
          h('button.btn.ghost.look-all', {
            onclick: () => {
              sheet.close();
              openDesign();
            },
          }, icon('sliders', 17), 'Alle Stile & Einstellungen'),
          h('span.grow'),
          h('button.btn.primary.look-next', { onclick: () => sheet.close() }, 'Weiter', icon('arrowR', 18)),
        ],
      };
    },
  });
}

export function openDesign() {
  let darkHint = false;
  const sheet = openSheet({
    className: 'wide design-sheet',
    render: (s) => {
      const mode = resolvedMode();
      const set = (patch) => {
        setPrefs(patch);
        s.refresh();
        hooks.render();
      };
      const pick = (sk) => {
        darkHint = applySkin(sk, { after: () => !s.closed && s.refresh() }) || (darkHint && !!sk.live);
        s.refresh();
      };
      const skin = SKINS.find((x) => x.id === prefs.skin) || SKINS[0];
      const opt = (on, onclick, ...children) => h('button.opt', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), onclick }, ...children);
      const group = (title, sub, list, live) => h('div.skin-group', null,
        h('h4.skin-group-h', null, live ? h('span.live-dot.red') : null, title, h('small', null, sub)),
        h('div.skins', null, list.map((sk) => skinCard(sk, mode, pick))),
      );
      return {
        title: 'Design & Stil',
        body: [
          h('p.muted', null, 'Mach Zeitgarten zu deinem Kalender. Du siehst jede Änderung sofort, und sie gilt auch auf deinen anderen Geräten.'),
          field('Stil',
            group('Klassisch', 'ruhig & schlicht', SKINS.filter((x) => !x.live), false),
            group('Live-Stile', 'mit bewegtem Hintergrund', SKINS.filter((x) => x.live), true),
          ),
          darkHint && mode === 'dark' ? h('p.skin-hint', { role: 'status' }, icon('moon', 16),
            h('span', null, 'Live-Stile leuchten im Dunkeln am schönsten – darum ist jetzt „Dunkel“ an. Hell kannst du gleich hier drunter wieder einschalten.')) : null,
          field('Hell oder dunkel', segmented([
            { value: 'auto', label: 'Automatisch', title: 'Wie dein Gerät', icon: 'contrast' },
            { value: 'light', label: 'Hell', icon: 'sun' },
            { value: 'dark', label: 'Dunkel', icon: 'moon' },
          ], prefs.mode, (v) => {
            darkHint = false;
            set({ mode: v });
          })),
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

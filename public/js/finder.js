// „Wann habt ihr Zeit?“ – freie Zeit mit Freunden finden.
// Der Server liefert nur frei/belegt (POST /api/freebusy), nie was jemand vorhat.
import { api } from './api.js';
import { h, icon } from './h.js';
import { dayShort, time } from './fmt.js';
import { person, state } from './state.js';
import { addDays, localTz, sameDay, startOfDay } from './time.js';
import { avatar, avatarStack, copyText, field, openSheet, segmented, toast } from './ui.js';
import { openEditor, openInvitePicker } from './sheets.js';

const RANGES = [
  { value: 'week', label: 'Diese Woche' },
  { value: 'd7', label: 'Nächste 7 Tage' },
  { value: 'd14', label: 'Nächste 14 Tage' },
];
// pref: Uhrzeit, die sich für einen Vorschlag am natürlichsten anfühlt
const TIMES = [
  { value: 'evening', label: 'Abends', from: 17, to: 23, pref: 18 },
  { value: 'day', label: 'Tagsüber', from: 9, to: 17, pref: 10 },
  { value: 'full', label: 'Ganztags', from: 8, to: 23, pref: 17 },
  { value: 'weekend', label: 'Wochenende', from: 9, to: 23, pref: 14, weekend: true },
];
const DURS = [1, 2, 3];
const KEY = 'zg.finder';
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function loadChoice() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveChoice(c) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* egal */
  }
}

// Alle Leute aus meinen Kalendern
export function finderFriends() {
  const map = new Map();
  for (const c of state.calendars) for (const m of c.members) if (m.id !== state.me.id && !map.has(m.id)) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function daysOf(range, tm, today) {
  const n = range === 'week' ? 7 - ((today.getDay() + 6) % 7) : range === 'd14' ? 14 : 7;
  const days = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(today, i);
    if (!tm.weekend || d.getDay() === 0 || d.getDay() === 6) days.push(d);
  }
  return days;
}

const at = (d, hr) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hr);
const isFree = (u, s, e) => !u.busy.some(([bs, be]) => bs < e && be > s);
const nameOf = (id) => (id === state.me.id ? 'du' : person(id).name);

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} und ${names.length - 2} weitere`;
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

// „alle 4 frei ✓“ oder „3 von 4 frei – Max nicht“
function freeText(free, ids) {
  if (free.length === ids.length) return ids.length === 2 ? 'beide frei ✓' : `alle ${ids.length} frei ✓`;
  const missing = ids.filter((id) => !free.includes(id)).map(nameOf);
  return `${free.length} von ${ids.length} frei – ${joinNames(missing)} nicht`;
}

// Die besten Zeiten: erst die mit den meisten Freien, möglichst an verschiedenen Tagen
function suggest(users, days, tm, dur, now) {
  const need = Math.max(2, Math.ceil(users.length / 2));
  const pref = Math.min(tm.pref, tm.to - dur);
  const cands = [];
  for (const d of days) {
    for (let hr = tm.from; hr + dur <= tm.to; hr++) {
      const s = at(d, hr);
      const e = at(d, hr + dur);
      if (s < now) continue;
      const free = users.filter((u) => isFree(u, +s, +e)).map((u) => u.id);
      if (free.length >= need) cands.push({ s, e, free, dist: Math.abs(hr - pref) });
    }
  }
  const better = (a, b) => b.free.length - a.free.length || a.s - b.s;
  const bestPerDay = new Map();
  for (const c of cands) {
    const k = c.s.toDateString();
    const cur = bestPerDay.get(k);
    if (!cur || c.free.length > cur.free.length || (c.free.length === cur.free.length && c.dist < cur.dist)) bestPerDay.set(k, c);
  }
  const picked = [...bestPerDay.values()].sort(better).slice(0, 5);
  // Zu wenige Tage? Dann weitere Zeiten, die sich nicht überschneiden
  for (const c of cands.sort((a, b) => b.free.length - a.free.length || a.dist - b.dist || a.s - b.s)) {
    if (picked.length >= 5) break;
    if (!picked.some((p) => p.s < c.e && p.e > c.s)) picked.push(c);
  }
  return picked.sort(better);
}

// Kleinster Kalender, in dem alle Ausgewählten sind – dort landet der neue Termin
function sharedCalendar(ids) {
  return state.calendars
    .filter((c) => ids.every((id) => c.members.some((m) => m.id === id)))
    .sort((a, b) => a.members.length - b.members.length)[0] || null;
}

// Anteil der Freien -> Stärke der Farbe; „fast alle“ und „alle“ sollen sich deutlich unterscheiden
const fill = (r) => (r > 0 ? `${Math.round(12 + 88 * r ** 1.6)}%` : '0%');
const slotText = (c) => `${dayShort(c.s)} · ${time(c.s)}–${time(c.e)}`;

export function openFinder({ userIds = null } = {}) {
  const friends = finderFriends();
  const saved = loadChoice();
  const known = (list) => (Array.isArray(list) ? list.filter((id) => friends.some((f) => f.id === id)) : []);
  let picked = new Set(userIds ? known(userIds) : known(saved.ids).length ? known(saved.ids) : friends.length <= 6 ? friends.map((f) => f.id) : []);
  let range = RANGES.some((r) => r.value === saved.range) ? saved.range : 'd7';
  let tod = TIMES.some((t) => t.value === saved.tod) ? saved.tod : 'evening';
  let dur = DURS.includes(saved.dur) ? saved.dur : 2;
  let data = null; // { key, users }
  let error = null;
  let seq = 0;

  const ids = () => [state.me.id, ...friends.filter((f) => picked.has(f.id)).map((f) => f.id)];
  const remember = () => saveChoice({ ids: [...picked], range, tod, dur });

  async function load() {
    const today = startOfDay(new Date());
    const days = daysOf(range, TIMES[0], today);
    const key = `${range}|${ids().join(',')}|${today.toDateString()}`;
    if (data?.key === key) return;
    const my = ++seq;
    data = null;
    error = null;
    sheet.refresh();
    try {
      const r = await api('POST', '/api/freebusy', {
        userIds: ids().slice(1),
        from: today.toISOString(),
        to: addDays(days[days.length - 1], 1).toISOString(),
        tz: localTz(),
      });
      if (my !== seq) return;
      const byId = new Map(r.users.map((u) => [u.id, u.busy.map(([s, e]) => [Date.parse(s), Date.parse(e)])]));
      data = { key, users: ids().map((id) => ({ id, busy: byId.get(id) || [] })) };
    } catch (e) {
      if (my !== seq) return;
      error = e.message || 'Das hat nicht geklappt.';
    }
    if (!sheet.closed) sheet.refresh();
  }

  const change = (fn) => {
    fn();
    remember();
    load();
    sheet.refresh();
  };

  function newEvent(s, e) {
    const cal = sharedCalendar(ids());
    openEditor({ start: s, end: e, calendarId: cal?.id || null });
  }

  function people() {
    return h('div.finder-people', { role: 'group', 'aria-label': 'Wer ist dabei?' },
      h('div.fp.me.on', { title: 'Du bist immer dabei' }, h('span.fp-av', null, avatar(state.me, 46), h('i.fp-check', null, icon('check', 12))), h('span.fp-name', null, 'Du')),
      friends.map((f) => {
        const on = picked.has(f.id);
        return h('button.fp', {
          type: 'button',
          class: on ? 'on' : '',
          'aria-pressed': String(on),
          title: f.name,
          onclick: () => change(() => {
            picked = new Set(picked);
            if (on) picked.delete(f.id);
            else picked.add(f.id);
          }),
        }, h('span.fp-av', null, avatar(f, 46), h('i.fp-check', null, icon('check', 12))), h('span.fp-name', null, f.name));
      }),
    );
  }

  function heatmap(users, days, tm, now) {
    const hours = [];
    for (let hr = tm.from; hr < tm.to; hr++) hours.push(hr);
    const step = hours.length > 9 ? 3 : hours.length > 6 ? 2 : 1;
    const n = users.length;
    return h('div.finder-heat', { style: { '--cols': hours.length }, role: 'table', 'aria-label': 'Wie viele sind wann frei' },
      h('div.fh-row.fh-head', { role: 'row' },
        h('span.fh-day', { role: 'columnheader' }),
        hours.map((hr, i) => h('span.fh-hour', { role: 'columnheader' }, i % step === 0 ? String(hr) : '')),
      ),
      days.map((d) => h('div.fh-row', { role: 'row', class: sameDay(d, now) ? 'today' : '' },
        h('span.fh-day', { role: 'rowheader' }, h('b', null, WD[d.getDay()]), ` ${d.getDate()}.`),
        hours.map((hr) => {
          const s = at(d, hr);
          const e = at(d, hr + 1);
          const free = users.filter((u) => isFree(u, +s, +e)).length;
          const past = e <= now;
          const label = `${dayShort(d)}, ${hr} Uhr: ${free === n ? 'alle frei' : `${free} von ${n} frei`}`;
          return h('button.fh-cell', {
            type: 'button',
            role: 'cell',
            class: [past && 'past', free === n && 'all', free === 0 && 'none'].filter(Boolean).join(' '),
            style: { '--fill': fill(free / n) },
            title: label,
            'aria-label': label,
            disabled: past,
            onclick: () => newEvent(s, at(d, Math.min(hr + dur, 24))),
          });
        }),
      )),
    );
  }

  function results() {
    if (!friends.length) {
      return h('div.empty.small.finder-empty', null,
        h('div.empty-art', null, '👯'),
        h('p', null, 'Lade Freunde in einen Kalender ein – dann siehst du hier, wann ihr alle Zeit habt.'),
        h('button.btn.primary.sm', { onclick: () => openInvitePicker() }, icon('userPlus', 16), 'Freunde einladen'),
      );
    }
    if (!picked.size) return h('p.finder-hint', null, 'Wähl oben aus, wer dabei sein soll.');
    if (error) return h('p.form-error', null, error);
    if (!data) return h('div.finder-loading', null, h('span.spin'), 'Ich schau mal, wann ihr Zeit habt …');

    const now = new Date();
    const tm = TIMES.find((t) => t.value === tod);
    const days = daysOf(range, tm, startOfDay(now));
    const all = ids();
    const sugs = days.length ? suggest(data.users, days, tm, dur, now) : [];
    return [
      h('div.section.finder-sugs', null,
        h('h3', null, 'Vorschläge'),
        sugs.length
          ? h('div.sug-list', null, sugs.map((c) => {
            const ok = c.free.length === all.length;
            return h('button.sug', { type: 'button', class: ok ? 'all' : '', onclick: () => newEvent(c.s, c.e) },
              h('span.sug-date', null, h('small', null, WD[c.s.getDay()]), h('b', null, c.s.getDate())),
              h('span.sug-main', null,
                h('strong', null, slotText(c)),
                h('span', null, freeText(c.free, all)),
              ),
              avatarStack(c.free.map(person), 24, 4),
              h('span.sug-add', { 'aria-hidden': 'true' }, icon('plus', 18)),
            );
          }))
          : h('p.finder-hint', null, days.length
            ? 'In diesem Zeitraum findet sich leider nichts, wo genug von euch frei sind. Probier einen anderen Zeitraum oder eine kürzere Dauer.'
            : 'Diese Woche ist kein Wochenende mehr übrig – probier „Nächste 7 Tage“.'),
      ),
      days.length ? h('div.section.finder-map', null,
        h('h3', null, 'Wer kann wann?'),
        heatmap(data.users, days, tm, now),
        h('div.legend.finder-legend', null,
          h('span', null, 'keiner frei'),
          [0, 0.34, 0.67, 1].map((r) => h('i', { style: { '--fill': fill(r) } })),
          h('span', null, 'alle frei'),
        ),
      ) : null,
    ];
  }

  async function share() {
    const now = new Date();
    const tm = TIMES.find((t) => t.value === tod);
    const days = daysOf(range, tm, startOfDay(now));
    const sugs = data && days.length ? suggest(data.users, days, tm, dur, now).slice(0, 3) : [];
    if (!sugs.length) {
      toast('Noch keine Vorschläge zum Teilen.');
      return;
    }
    const all = ids();
    const text = [
      'Wann habt ihr Zeit? Meine Vorschläge:',
      ...sugs.map((c) => `• ${slotText(c)} Uhr (${c.free.length === all.length ? 'alle frei' : `${c.free.length} von ${all.length} frei`})`),
    ].join('\n');
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
    }
    copyText(text, 'Vorschläge kopiert – jetzt einfach in den Chat einfügen');
  }

  const sheet = openSheet({
    className: 'finder-sheet',
    render: () => ({
      title: 'Wann habt ihr Zeit?',
      body: [
        h('p.finder-intro', null, icon('users', 16), 'Ich zeige nur, wann jemand frei ist – nie, was jemand vorhat.'),
        friends.length ? field('Wer ist dabei?', people()) : null,
        friends.length ? h('div.finder-opts', null,
          field('Zeitraum', segmented(RANGES, range, (v) => change(() => (range = v)))),
          field('Tageszeit', segmented(TIMES, tod, (v) => change(() => (tod = v)))),
          field('Dauer', segmented(DURS.map((d) => ({ value: d, label: `${d} h`, title: d === 1 ? '1 Stunde' : `${d} Stunden` })), dur, (v) => change(() => (dur = v)))),
        ) : null,
        results(),
      ],
      foot: friends.length ? [
        h('button.btn.ghost', { onclick: () => sheet.close() }, 'Fertig'),
        h('span.grow'),
        h('button.btn.primary', { onclick: share, disabled: !data || !picked.size }, icon('share', 17), 'Vorschläge teilen'),
      ] : null,
    }),
  });
  load();
  return sheet;
}

// Kurz für Einstiege: Gibt es überhaupt jemanden zum Planen?
export const hasFriends = () => state.calendars.some((c) => c.members.length > 1);

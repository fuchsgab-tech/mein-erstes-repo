// Zustand der App im Browser
import { api } from './api.js';
import { occurrences } from './recur.js';
import { startOfDay } from './time.js';

const load = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
};

export const persist = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* egal */
  }
};

export const state = {
  me: null,
  calendars: [],
  events: new Map(),
  hidden: new Set(load('zg.hidden', [])),
  view: load('zg.view', 'month'),
  cursor: startOfDay(new Date()),
  miniCursor: startOfDay(new Date()),
  search: '',
  listDays: 60,
  lastCalendarId: load('zg.lastCal', null),
  serverPrefs: null,
  online: new Set(),
  activity: [],
  typing: new Map(),
  seenAt: load('zg.seen', new Date(0).toISOString()),
  dragging: false,
};

// Wird von app.js gesetzt, damit andere Module neu zeichnen können
export const hooks = { render() {} };

export const COLORS = [
  { name: 'Koralle', hex: '#f2675b' },
  { name: 'Mandarine', hex: '#f59440' },
  { name: 'Sonne', hex: '#e9b31f' },
  { name: 'Salbei', hex: '#4fb477' },
  { name: 'Minze', hex: '#22b3a0' },
  { name: 'Himmel', hex: '#3d9df2' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Lavendel', hex: '#a46cf0' },
  { name: 'Rosé', hex: '#ec6aa8' },
  { name: 'Schiefer', hex: '#64748b' },
];

export const EMOJIS = ['🌿', '📅', '🏠', '❤️', '👨‍👩‍👧', '🎉', '⚽️', '🎓', '💼', '✈️', '🍕', '🎵', '🐶', '🏋️', '📚', '🎮', '⛰️', '🍷', '🎂', '👯', '🧘', '🚲', '🌸', '⭐️'];

export async function loadAll() {
  const [me, ev, act] = await Promise.all([
    api('GET', '/api/me'),
    api('GET', '/api/events'),
    api('GET', '/api/activity?limit=80'),
  ]);
  state.me = me.user;
  state.serverPrefs = me.prefs;
  state.shareBusy = me.shareBusy !== false;
  state.calendars = me.calendars;
  state.events = new Map(ev.events.map((e) => [e.id, e]));
  state.activity = act.activity;
}

export async function loadPresence() {
  const { online } = await api('GET', '/api/presence');
  state.online = new Set(online);
}

export const unreadCount = () =>
  state.activity.filter((a) => a.userId !== state.me?.id && a.at > state.seenAt).length;

export function markSeen() {
  state.seenAt = new Date().toISOString();
  persist('zg.seen', state.seenAt);
}

export async function loadEvents(calendarId) {
  const { events } = await api('GET', `/api/events?calendarId=${encodeURIComponent(calendarId)}`);
  for (const [id, e] of state.events) if (e.calendarId === calendarId) state.events.delete(id);
  for (const e of events) state.events.set(e.id, e);
}

export async function loadMe() {
  const me = await api('GET', '/api/me');
  state.me = me.user;
  state.serverPrefs = me.prefs;
  state.shareBusy = me.shareBusy !== false;
  state.calendars = me.calendars;
}

export const calById = (id) => state.calendars.find((c) => c.id === id);

export function person(id) {
  if (state.me && id === state.me.id) return state.me;
  for (const c of state.calendars) {
    const m = c.members.find((x) => x.id === id);
    if (m) return m;
  }
  return { id, name: 'Ehemaliges Mitglied', color: '#9b9da4' };
}

export const eventColor = (ev) => ev.color || calById(ev.calendarId)?.color || '#64748b';

// Wer ist dabei? Bei Serien gilt die Zusage pro Datum (orig aus recur.js), sonst für den ganzen Termin
export const attendeesFor = (ev, orig) =>
  (ev.rrule && orig && ev.attendeesByOcc && Object.hasOwn(ev.attendeesByOcc, orig) ? ev.attendeesByOcc[orig] : ev.attendees) || [];

export function setHidden(id, hidden) {
  if (hidden) state.hidden.add(id);
  else state.hidden.delete(id);
  persist('zg.hidden', [...state.hidden]);
}

export function setView(view) {
  state.view = view;
  persist('zg.view', view);
}

export function rememberCalendar(id) {
  state.lastCalendarId = id;
  persist('zg.lastCal', id);
}

export function defaultCalendarId() {
  const visible = state.calendars.filter((c) => !state.hidden.has(c.id));
  if (calById(state.lastCalendarId) && !state.hidden.has(state.lastCalendarId)) return state.lastCalendarId;
  return (visible[0] || state.calendars[0])?.id;
}

const byStart = (a, b) =>
  a.start - b.start || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (b.end - b.start) - (a.end - a.start) ||
  a.ev.title.localeCompare(b.ev.title);

// Alle sichtbaren Termine im Zeitraum [from, to)
export function visibleOccurrences(from, to, { includeHidden = false } = {}) {
  const out = [];
  for (const ev of state.events.values()) {
    if (!includeHidden && state.hidden.has(ev.calendarId)) continue;
    if (!calById(ev.calendarId)) continue;
    for (const o of occurrences(ev, from, to)) out.push(o);
  }
  return out.sort(byStart);
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

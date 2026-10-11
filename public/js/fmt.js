// Deutsche Datums- und Zeittexte
import { occFirstDay, occLastDay } from './recur.js';
import { daysBetween, sameDay, startOfDay } from './time.js';

const F = (o) => new Intl.DateTimeFormat('de-DE', o);
const fMonth = F({ month: 'long' });
const fDayLong = F({ weekday: 'long', day: 'numeric', month: 'long' });
const fDayLongYear = F({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fDayShort = F({ weekday: 'short', day: 'numeric', month: 'short' });
const fDayMonth = F({ day: 'numeric', month: 'long' });
const fWeekday = F({ weekday: 'long' });
const fTime = F({ hour: '2-digit', minute: '2-digit' });
const fDate = F({ day: 'numeric', month: 'short', year: 'numeric' });

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const monthName = (d) => fMonth.format(d);
export const dayLong = (d) => (d.getFullYear() === new Date().getFullYear() ? fDayLong : fDayLongYear).format(d);
export const dayShort = (d) => fDayShort.format(d);
export const dayMonth = (d) => fDayMonth.format(d);
export const weekdayName = (d) => fWeekday.format(d);
export const time = (d) => fTime.format(d);
export const shortDate = (d) => fDate.format(d);

export function relDay(d) {
  const n = daysBetween(startOfDay(new Date()), d);
  return { 0: 'Heute', 1: 'Morgen', '-1': 'Gestern' }[n] || null;
}

// Kurz, für Listen: „14:00 – 15:30“ oder „Ganztägig“
export function whenShort(o, day) {
  if (o.allDay) return 'Ganztägig';
  const first = occFirstDay(o);
  const last = occLastDay(o);
  if (day && !sameDay(first, last)) {
    if (sameDay(day, first)) return `ab ${time(o.start)}`;
    if (sameDay(day, last)) return `bis ${time(o.end)}`;
    return 'Ganztägig';
  }
  return o.end > o.start ? `${time(o.start)} – ${time(o.end)}` : time(o.start);
}

// Ausführlich, für die Detailansicht
export function whenLong(o) {
  const first = occFirstDay(o);
  const last = occLastDay(o);
  if (o.allDay) {
    if (sameDay(first, last)) return [dayLong(first), 'Ganztägig'];
    return [`${dayShort(first)} – ${dayShort(last)}`, `Ganztägig · ${daysBetween(first, last) + 1} Tage`];
  }
  if (sameDay(first, last)) {
    return [dayLong(first), o.end > o.start ? `${time(o.start)} – ${time(o.end)} Uhr` : `${time(o.start)} Uhr`];
  }
  return [`${dayShort(o.start)}, ${time(o.start)} Uhr –`, `${dayShort(o.end)}, ${time(o.end)} Uhr`];
}

export function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  if (s < 7 * 86400) return `vor ${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? 'Tag' : 'Tagen'}`;
  return shortDate(new Date(iso));
}

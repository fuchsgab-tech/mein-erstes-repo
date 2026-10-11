// Zeitgarten – Start der App im Browser
import { api, auth, openStream } from './api.js';
import { h, icon } from './h.js';
import { monthName } from './fmt.js';
import {
  COLORS, calById, hooks, loadAll, loadEvents, loadMe, loadPresence, person, setHidden, setView, state, unreadCount,
} from './state.js';
import { adoptServerPrefs, applyPrefs, prefs, reducedMotion } from './themes.js';
import { addDays, addMonths, sameDay, startOfDay, startOfWeek } from './time.js';
import {
  avatar, avatarStack, busy, closeTopSheet, field, forEachSheet, liveToast, refreshLiveSheets, segmented, sheetOpen,
  swatches, toast,
} from './ui.js';
import { renderList, renderMini, renderMonth, renderWeek } from './views.js';
import { renderToday } from './dashboard.js';
import {
  activityText, actor, inviteCard, openActivity, openCalendar, openDesign, openEditor, openEventById, openImport,
  openInvitePicker, openJoin, openNewCalendar, openProfile,
} from './sheets.js';

const app = document.getElementById('app');
const BASE_TITLE = 'Zeitgarten – gemeinsam planen';
let els = null;
let cleanup = null;
let slide = null;
let lastView = null;

// ---------- Willkommen ----------

const FLOATIES = [
  { t: '☕ Brunch mit Lena', c: '#f59440', x: '6%', y: '12%', d: '0s' },
  { t: '🎂 Omas Geburtstag', c: '#ec6aa8', x: '70%', y: '8%', d: '-2s' },
  { t: '🏖️ Urlaub in Kroatien', c: '#3d9df2', x: '74%', y: '80%', d: '-4s' },
  { t: '⚽️ Training', c: '#4fb477', x: '4%', y: '78%', d: '-1s' },
  { t: '🎉 WG-Party', c: '#a46cf0', x: '40%', y: '91%', d: '-3s' },
];

async function renderWelcome(code) {
  let invite = null;
  if (code) {
    try {
      invite = await api('GET', `/api/invites/${encodeURIComponent(code)}`);
    } catch (e) {
      invite = { error: e.message };
    }
  }
  const valid = invite && !invite.error;
  let color = COLORS[Math.floor(Math.random() * COLORS.length)].hex;
  const nameInput = h('input.input.lg', { placeholder: 'Dein Vorname', maxlength: 40, autofocus: true, autocomplete: 'given-name' });
  const btn = h('button.btn.primary.lg.block', { onclick: () => start() }, valid ? 'Beitreten & loslegen' : 'Los geht’s', icon('arrowR', 18));
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && start());

  async function start() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.remove('shake');
      void nameInput.offsetWidth;
      nameInput.classList.add('shake');
      nameInput.focus();
      return;
    }
    await busy(btn, async () => {
      const r = await api('POST', '/api/users', { name, color });
      auth.set(r.token);
      if (valid) await api('POST', `/api/invites/${encodeURIComponent(code)}/accept`);
      if (code) history.replaceState(null, '', '/');
      await startApp();
      toast(valid ? `Willkommen in „${invite.calendar.name}“!` : `Schön, dass du da bist, ${name}!`);
    });
  }

  app.replaceChildren(h('div.welcome', null,
    FLOATIES.map((f) => h('div.floaty', { style: { '--c': f.c, left: f.x, top: f.y, animationDelay: f.d } }, f.t)),
    h('div.welcome-card', null,
      h('div.brand.big', null, h('img', { src: 'icon.svg', alt: '' }), 'Zeitgarten'),
      invite?.error ? h('p.form-error', null, invite.error) : null,
      valid
        ? inviteCard(invite)
        : h('div.hero', null,
          h('h1', null, 'Gemeinsam planen.', h('br'), h('span.grad', null, 'Einfach schöner.')),
          h('p.muted', null, 'Der Kalender für dich, deine Familie und deine Freunde. Lade sie per Link ein, importiere bestehende Kalender und plant zusammen – live.'),
        ),
      field('Wie heißt du?', nameInput),
      field('Deine Farbe', swatches(color, (c) => (color = c))),
      btn,
      h('p.fine', null, 'Kein Passwort, keine E-Mail – dein Profil wird auf diesem Gerät gespeichert.'),
    ),
  ));
  requestAnimationFrame(() => nameInput.focus());
}

function renderSkeleton() {
  app.replaceChildren(h('div.skeleton', { 'aria-busy': 'true', 'aria-label': 'Lädt' },
    h('div.sk-side', null,
      h('div.sk', { style: { height: '32px', width: '60%' } }),
      h('div.sk', { style: { height: '50px' } }),
      h('div.sk', { style: { height: '220px' } }),
      h('div.sk', { style: { height: '120px' } }),
    ),
    h('div.sk-main', null,
      h('div.sk', { style: { height: '40px', width: '40%' } }),
      h('div.sk', { style: { flex: '1', borderRadius: 'var(--r-xl)' } }),
    ),
  ));
}

// ---------- Grundgerüst ----------

function toggleDrawer(open) {
  els?.shell.classList.toggle('drawer-open', open);
}

function defaultNewDate() {
  const today = startOfDay(new Date());
  if (state.view === 'week') {
    const ws = startOfWeek(state.cursor);
    return today >= ws && today < addDays(ws, 7) ? today : ws;
  }
  if (state.view === 'today') return today;
  return today.getMonth() === state.cursor.getMonth() && today.getFullYear() === state.cursor.getFullYear()
    ? today
    : state.cursor;
}

function buildShell() {
  const sidebar = h('aside.sidebar');
  const topbar = h('header.topbar');
  const view = h('section.view');
  const shell = h('div.shell', null,
    sidebar,
    h('div.scrim', { onclick: () => toggleDrawer(false) }),
    h('main.main', null, topbar, view),
    h('nav.tabbar', { 'aria-label': 'Ansicht' }),
    h('button.fab', { onclick: () => openEditor({ date: defaultNewDate() }), 'aria-label': 'Neuer Termin', title: 'Neuer Termin' }, icon('plus', 28)),
  );
  app.replaceChildren(shell);
  els = { shell, sidebar, topbar, view, tabbar: shell.querySelector('.tabbar') };

  // Wischen zum Blättern (Handy)
  let sx = 0;
  let sy = 0;
  let st = 0;
  view.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    st = Date.now();
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (state.view === 'list' || state.view === 'today' || state.dragging) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st < 600) navigate(dx < 0 ? 1 : -1);
  }, { passive: true });
}

const isOnline = (id) => state.online.has(id);

function calRow(c) {
  const on = !state.hidden.has(c.id);
  const others = c.members.filter((m) => m.id !== state.me.id);
  return h('div.cal-row', { style: { '--c': c.color } },
    h('button.check', {
      class: on ? 'on' : '',
      role: 'checkbox',
      'aria-checked': String(on),
      'aria-label': `${c.name} ${on ? 'ausblenden' : 'einblenden'}`,
      title: on ? 'Ausblenden' : 'Einblenden',
      onclick: () => {
        setHidden(c.id, on);
        render();
      },
    }, icon('check', 14)),
    h('button.cal-name', {
      title: 'Einstellungen & Freunde einladen',
      onclick: () => {
        toggleDrawer(false);
        openCalendar(c.id);
      },
    }, h('span.emoji', null, c.emoji), h('span.name', null, c.name)),
    others.length ? avatarStack(others, 20, 3, isOnline) : null,
  );
}

function renderSidebar() {
  const mini = h('div.mini');
  renderMini(mini, {
    onPick: (d) => {
      state.cursor = d;
      state.miniCursor = d;
      if (state.view === 'today') setView('month');
      toggleDrawer(false);
      render();
    },
  });
  const action = (fn) => () => {
    toggleDrawer(false);
    fn();
  };
  els.sidebar.replaceChildren(
    h('div.brand', null, h('img', { src: 'icon.svg', alt: '' }), 'Zeitgarten'),
    h('button.btn.primary.block.lg.new-btn', { onclick: action(() => openEditor({ date: defaultNewDate() })) }, icon('plus', 20), 'Neuer Termin'),
    mini,
    h('div.side-section', null,
      h('div.side-title', null,
        h('span', null, 'Kalender'),
        h('button.icon-btn.sm', { title: 'Neuer Kalender', 'aria-label': 'Neuer Kalender', onclick: action(openNewCalendar) }, icon('plus', 16)),
      ),
      h('div.cal-list', null, state.calendars.map(calRow)),
    ),
    h('div.side-actions', null,
      h('button.side-link', { onclick: action(openInvitePicker) }, icon('userPlus', 18), 'Freunde einladen'),
      h('button.side-link', { onclick: action(() => openImport()) }, icon('upload', 18), 'Kalender importieren'),
      h('button.side-link.fancy', { onclick: action(openDesign) }, icon('palette', 18), 'Design & Stil'),
    ),
    h('button.me-chip', { onclick: action(openProfile) },
      avatar(state.me, 36, { online: true }),
      h('span.grow', null, h('strong', null, state.me.name), h('span', null, 'Profil & Einstellungen')),
      icon('sliders', 18),
    ),
  );
}

function renderTopbar() {
  const c = state.cursor;
  let title = [monthName(c), c.getFullYear()];
  if (state.view === 'week') {
    const ws = startOfWeek(c);
    const we = addDays(ws, 6);
    if (ws.getMonth() !== we.getMonth()) title = [`${monthName(ws).slice(0, 3)} – ${monthName(we).slice(0, 3)}`, we.getFullYear()];
    else title = [monthName(ws), ws.getFullYear()];
  }
  if (state.view === 'today') title = ['Übersicht', null];
  const unread = unreadCount();
  const online = [...state.online].map(person);
  document.title = unread ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
  const isToday = state.view === 'today';

  const views = [
    { value: 'today', label: 'Heute', icon: 'sun', title: 'Übersicht (H)' },
    { value: 'month', label: 'Monat', icon: 'calendar', title: 'Monat (M)' },
    { value: 'week', label: 'Woche', icon: 'week', title: 'Woche (W)' },
    { value: 'list', label: 'Liste', icon: 'list', title: 'Liste (L)' },
  ];
  els.tabbar.replaceChildren(...views.map((v) => h('button.tab', {
    class: state.view === v.value ? 'on' : '',
    'aria-current': state.view === v.value ? 'page' : null,
    onclick: () => switchView(v.value),
  }, h('span.tab-ic', null, icon(v.icon, 21)), v.label)));

  els.topbar.replaceChildren(...[
    h('button.icon-btn.menu-btn', { onclick: () => toggleDrawer(true), 'aria-label': 'Menü' }, icon('menu')),
    h('h1.title', null, title[0], ' ', h('span.year', null, title[1])),
    isToday ? null : h('div.nav', null,
      h('button.icon-btn', { onclick: () => navigate(-1), 'aria-label': 'Zurück', title: 'Zurück (←)' }, icon('chevL')),
      h('button.icon-btn', { onclick: () => navigate(1), 'aria-label': 'Weiter', title: 'Weiter (→)' }, icon('chevR')),
    ),
    isToday ? null : h('button.btn.sm.today-btn', { onclick: goToday, title: 'Heute (T)' }, 'Heute'),
    h('span.grow'),
    online.length ? h('div.top-online', { title: online.map((p) => p.name).join(', ') },
      avatarStack(online, 26, 3, () => true),
      h('span.lbl', null, online.length === 1 ? `${online[0].name} ist online` : `${online.length} online`),
    ) : null,
    h('button.icon-btn.top-design', { onclick: openDesign, 'aria-label': 'Design & Stil', title: 'Design & Stil' }, icon('palette')),
    h('button.icon-btn', { onclick: openActivity, 'aria-label': `Neuigkeiten${unread ? ` (${unread} neu)` : ''}`, title: 'Neuigkeiten' },
      icon(unread ? 'bellRing' : 'bell'),
      unread ? h('span.badge', null, unread > 9 ? '9+' : unread) : null,
    ),
    segmented(views, state.view, (v) => switchView(v)),
  ].filter(Boolean));
}

function render() {
  if (!els) return;
  const activeId = document.activeElement?.id;
  state.viewFresh = state.view !== lastView;
  lastView = state.view;
  renderSidebar();
  renderTopbar();
  cleanup?.();
  const view = { week: renderWeek, list: renderList, today: renderToday }[state.view] || renderMonth;
  cleanup = view(els.view) || null;
  if (slide) {
    els.view.firstElementChild?.classList.add(`slide-${slide}`);
    slide = null;
  }
  if (activeId === 'search') {
    const s = document.getElementById('search');
    s?.focus();
    s?.setSelectionRange(s.value.length, s.value.length);
  }
  refreshLiveSheets();
}
hooks.render = render;

// Sanfter Übergang zwischen Monaten und Ansichten (wo der Browser es kann)
function transition(dir, fn) {
  const canVt = document.startViewTransition && prefs.motion !== false && !reducedMotion.matches;
  if (!canVt) {
    if (dir) slide = dir;
    fn();
    return;
  }
  document.documentElement.dataset.vt = dir || 'fade';
  const vt = document.startViewTransition(fn);
  vt.finished.finally(() => delete document.documentElement.dataset.vt);
}

function switchView(v) {
  if (v === state.view) return;
  transition(null, () => {
    setView(v);
    render();
  });
}

function navigate(dir) {
  if (state.view === 'today') return;
  transition(dir > 0 ? 'next' : 'prev', () => {
    state.cursor = state.view === 'week' ? addDays(state.cursor, 7 * dir) : addMonths(state.cursor, dir);
    state.miniCursor = state.cursor;
    render();
  });
}

function goToday() {
  const today = startOfDay(new Date());
  const visible = state.view === 'week'
    ? sameDay(startOfWeek(today), startOfWeek(state.cursor))
    : today.getMonth() === state.cursor.getMonth() && today.getFullYear() === state.cursor.getFullYear();
  const go = () => {
    state.cursor = today;
    state.miniCursor = today;
    render();
  };
  if (visible) go();
  else transition(today > state.cursor ? 'next' : 'prev', go);
}

// ---------- Live-Updates von anderen ----------

let source = null;
let liveTimer = null;
let needAll = false;
const pending = new Set();

function scheduleLive() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(flushLive, 200);
}

async function flushLive() {
  try {
    if (needAll) {
      needAll = false;
      pending.clear();
      await loadAll();
      await loadPresence().catch(() => {});
      if (adoptServerPrefs(state.serverPrefs)) toast('Design von deinem anderen Gerät übernommen');
    } else {
      const ids = [...pending];
      pending.clear();
      for (const id of ids) if (calById(id)) await loadEvents(id);
    }
    render();
  } catch (e) {
    if (e.status === 401) {
      auth.set(null);
      location.reload();
    }
  }
}

function typingChanged(eventId) {
  forEachSheet((s) => s.eventId === eventId && s.updateTyping?.());
}

function onTyping(eventId, userId) {
  const map = state.typing.get(eventId) || new Map();
  clearTimeout(map.get(userId));
  map.set(userId, setTimeout(() => {
    map.delete(userId);
    typingChanged(eventId);
  }, 4500));
  state.typing.set(eventId, map);
  typingChanged(eventId);
}

function stopTyping(eventId, userId) {
  const map = state.typing.get(eventId);
  if (!map?.has(userId)) return;
  clearTimeout(map.get(userId));
  map.delete(userId);
  typingChanged(eventId);
}

function onActivity(a) {
  if (state.activity.some((x) => x.id === a.id)) return;
  state.activity.unshift(a);
  state.activity.length = Math.min(state.activity.length, 120);
  if (a.userId === state.me.id) {
    // eigene Aktionen gelten als gelesen
    return;
  }
  if (a.kind === 'comment' && a.eventId) stopTyping(a.eventId, a.userId);
  const { plain } = activityText(a);
  const cal = calById(a.calendarId);
  // Wer den Termin gerade offen hat, sieht die Änderung ohnehin live
  let open = false;
  forEachSheet((sh) => {
    if (a.eventId && sh.eventId === a.eventId && !sh.closed) open = true;
  });
  if (!open) liveToast({
    user: actor(a),
    text: plain,
    sub: cal ? `${cal.emoji} ${cal.name} · gerade eben` : 'gerade eben',
    onClick: () => (a.eventId && state.events.has(a.eventId) ? openEventById(a.eventId) : openActivity()),
  });
  if (prefs.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification('Zeitgarten', { body: plain, icon: 'icon-192.png', tag: a.id });
      n.onclick = () => {
        window.focus();
        if (a.eventId) openEventById(a.eventId);
      };
    } catch {
      /* manche Browser erlauben das nur über Service Worker */
    }
  }
}

function connectLive() {
  source?.close();
  let broken = false;
  source = openStream((msg) => {
    switch (msg.type) {
      case 'presence':
        state.online = new Set(msg.online);
        scheduleLive();
        return;
      case 'online':
        if (msg.online) state.online.add(msg.userId);
        else state.online.delete(msg.userId);
        scheduleLive();
        return;
      case 'typing':
        onTyping(msg.eventId, msg.userId);
        return;
      case 'reaction':
        if (msg.added) forEachSheet((s) => s.eventId === msg.eventId && s.onReaction?.(msg.emoji));
        return;
      case 'activity':
        onActivity(msg.activity);
        scheduleLive();
        return;
      case 'prefs':
        loadMe().then(() => {
          if (adoptServerPrefs(state.serverPrefs)) render();
        }).catch(() => {});
        return;
      case 'calendars':
        needAll = true;
        break;
      default:
        if (msg.calendarId) pending.add(msg.calendarId);
    }
    if (msg.type === 'comments') forEachSheet((s) => s.eventId === msg.eventId && s.reloadComments?.());
    scheduleLive();
  }, {
    onOpen: () => {
      if (broken) {
        needAll = true;
        scheduleLive();
      }
      broken = false;
    },
    onError: () => {
      broken = true;
    },
  });
}

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (els && Date.now() - hiddenAt > 60000) {
    needAll = true;
    scheduleLive();
  }
});

// ---------- Tastatur ----------

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen()) {
    closeTopSheet();
    return;
  }
  if (!els || sheetOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const views = { h: 'today', m: 'month', w: 'week', l: 'list' };
  if (e.key === 'ArrowLeft') navigate(-1);
  else if (e.key === 'ArrowRight') navigate(1);
  else if (e.key === 't') goToday();
  else if (e.key === 'n') {
    e.preventDefault();
    openEditor({ date: defaultNewDate() });
  } else if (e.key === 'd') openDesign();
  else if (views[e.key]) switchView(views[e.key]);
});

// ---------- Start ----------

async function startApp() {
  renderSkeleton();
  await loadAll();
  adoptServerPrefs(state.serverPrefs);
  buildShell();
  lastView = null;
  render();
  connectLive();
}

async function boot() {
  applyPrefs();
  const join = /^\/join\/([\w-]+)\/?$/.exec(location.pathname)?.[1];
  const login = /^\/login\/([\w-]+)\/?$/.exec(location.pathname)?.[1];
  if (login) {
    auth.set(login);
    history.replaceState(null, '', '/');
  }
  if (!auth.token) {
    renderWelcome(join);
    return;
  }
  try {
    await startApp();
  } catch (e) {
    if (e.status === 401) {
      auth.set(null);
      renderWelcome(join);
      return;
    }
    app.replaceChildren(h('div.fatal', null,
      h('div.empty-art', null, '🥀'),
      h('h2', null, 'Keine Verbindung'),
      h('p.muted', null, e.message),
      h('button.btn.primary', { onclick: () => location.reload() }, 'Nochmal versuchen'),
    ));
    return;
  }
  if (join) {
    history.replaceState(null, '', '/');
    openJoin(join);
  } else if (login) {
    toast(`Angemeldet als ${state.me.name}`);
  }
}

boot();

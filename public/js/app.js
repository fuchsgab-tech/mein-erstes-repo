// Zeitgarten – Start der App im Browser
import { api, auth, isDemo, openStream } from './api.js';
import { h, icon } from './h.js';
import { monthName, time } from './fmt.js';
import {
  COLORS, calById, hooks, loadAll, loadEvents, loadMe, loadPresence, person, setHidden, setView, state, unreadCount,
} from './state.js';
import { adoptServerPrefs, applyPrefs, prefs, reducedMotion } from './themes.js';
import { addDays, addMonths, sameDay, startOfDay, startOfWeek } from './time.js';
import {
  avatar, avatarStack, busy, closeAllSheets, copyText, dismissTopSheet, field, forEachSheet, liveToast, openSheet,
  refreshLiveSheets, segmented, sheetOpen, swatches, toast,
} from './ui.js';
import { renderList, renderMini, renderMonth, renderWeek } from './views.js';
import { renderToday } from './dashboard.js';
import { openFinder } from './finder.js';
import './bgfx.js';
import {
  activityText, actor, inviteCard, openActivity, openCalendar, openDesign, openEditor, openEventById, openImport,
  openInvitePicker, openJoin, openLookPicker, openNewCalendar, openProfile,
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

const BAD_LINK = 'Dieser Anmelde-Link funktioniert nicht (mehr). Hol dir auf deinem anderen Gerät einen neuen Link oder Code.';

// Anmelde-Link (…/login/<token>) oder Code (8 Zeichen, mit oder ohne Strich) erkennen
function parseLogin(raw) {
  const s = String(raw || '').trim();
  const link = /\/login\/([\w-]{16,})/.exec(s);
  if (link) return { token: link[1] };
  const code = s.replace(/[\s-]/g, '').toUpperCase();
  if (/^[A-Z0-9]{8}$/.test(code)) return { code: `${code.slice(0, 4)}-${code.slice(4)}` };
  if (/^[\w-]{24,}$/.test(s)) return { token: s };
  return null;
}

const firstName = (name) => String(name || '').split(/\s+/)[0];

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  el.focus();
}

/**
 * Willkommen-Seite. view: 'new' (Profil anlegen), 'login' (Ich hab schon ein Profil) oder
 * 'lost' (gespeichertes Profil kennt der Server nicht mehr).
 */
async function renderWelcome(code, { view = 'new', error = null } = {}) {
  stopLive();
  els = null;
  let invite = null;
  if (code) {
    try {
      invite = await api('GET', `/api/invites/${encodeURIComponent(code)}`);
    } catch (e) {
      invite = { error: e.message };
    }
  }
  const valid = invite && !invite.error;
  const lost = view === 'lost';
  let color = COLORS[Math.floor(Math.random() * COLORS.length)].hex;
  const card = h('div.welcome-card', { 'aria-live': 'polite' });

  // --- Neues Profil ---
  const nameInput = h('input.input.lg', { placeholder: 'Dein Vorname', maxlength: 40, autocomplete: 'given-name', 'aria-label': 'Wie heißt du?' });
  const startBtn = h('button.btn.primary.lg.block', { onclick: () => start() }, valid ? 'Beitreten & loslegen' : 'Los geht’s', icon('arrowR', 18));
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && start());

  async function start() {
    const name = nameInput.value.trim();
    if (!name) {
      shake(nameInput);
      return;
    }
    await busy(startBtn, async () => {
      const r = await api('POST', '/api/users', { name, color });
      auth.set(r.token);
      if (valid) await api('POST', `/api/invites/${encodeURIComponent(code)}/accept`);
      if (code) history.replaceState(null, '', '/');
      await startApp();
      toast(valid ? `Willkommen in „${invite.calendar.name}“!` : `Schön, dass du da bist, ${firstName(name)}!`);
      afterStart({ fresh: true });
    });
  }

  // --- Ich hab schon ein Profil ---
  const loginInput = h('input.input.lg.login-input', {
    placeholder: 'Code oder Link',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    'aria-label': 'Code oder Anmelde-Link',
    'aria-describedby': 'login-help',
  });
  const loginErr = h('p.form-error', { role: 'alert', hidden: !error }, error || '');
  const setLoginError = (msg) => {
    loginErr.textContent = msg || '';
    loginErr.hidden = !msg;
    loginInput.toggleAttribute('aria-invalid', !!msg);
  };
  const loginBtn = h('button.btn.primary.lg.block', { onclick: () => login() }, 'Anmelden', icon('arrowR', 18));
  loginInput.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && login());
  loginInput.addEventListener('input', () => {
    setLoginError(null);
    // Codes schön formatieren: K7QM-3XRP
    const v = loginInput.value;
    const raw = v.replace(/[\s-]/g, '');
    if (/^[a-z0-9]{1,8}$/i.test(raw) && !/[/:.]/.test(v)) {
      const f = raw.toUpperCase().replace(/^(.{4})(.+)$/, '$1-$2');
      if (f !== v) loginInput.value = f;
    }
    loginInput.classList.toggle('is-code', /^[A-Z0-9]{1,4}(-[A-Z0-9]{0,4})?$/.test(loginInput.value));
  });
  const pasteBtn = navigator.clipboard?.readText
    ? h('button.btn.paste-btn', {
      type: 'button',
      title: 'Aus der Zwischenablage einfügen',
      onclick: async () => {
        try {
          const text = (await navigator.clipboard.readText()).trim();
          if (!text) throw new Error('leer');
          loginInput.value = text;
          loginInput.dispatchEvent(new Event('input'));
          login();
        } catch {
          loginInput.focus();
          toast('Halte das Feld gedrückt und wähle „Einsetzen“.');
        }
      },
    }, icon('clipboard', 18), h('span', null, 'Einfügen'))
    : null;

  async function login() {
    const parsed = parseLogin(loginInput.value);
    if (!parsed) {
      setLoginError(loginInput.value.trim()
        ? 'Das sieht nicht nach einem Code oder Anmelde-Link aus. Ein Code hat 8 Zeichen, zum Beispiel K7QM-3XRP.'
        : 'Gib deinen Code ein oder füge deinen Anmelde-Link ein.');
      shake(loginInput);
      return;
    }
    setLoginError(null);
    loginBtn.disabled = true;
    loginBtn.classList.add('loading');
    const prev = auth.token;
    try {
      let token = parsed.token;
      if (parsed.code) {
        try {
          token = (await api('POST', '/api/pair', { code: parsed.code })).token;
        } catch (e) {
          if (e.status === 404) throw new Error('Die Anmeldung mit Code klappt auf diesem Server noch nicht. Nimm bitte deinen Anmelde-Link.');
          throw e;
        }
      }
      // Erst prüfen, ob der Server das Profil kennt – sonst bleibt das bisherige gespeichert
      auth.set(token);
      try {
        await api('GET', '/api/me');
      } catch (e) {
        auth.set(prev);
        throw e.status === 401 ? new Error(parsed.code ? 'Das hat nicht geklappt. Hol dir bitte einen neuen Code.' : BAD_LINK) : e;
      }
    } catch (e) {
      loginBtn.disabled = false;
      loginBtn.classList.remove('loading');
      setLoginError(e.message || 'Da ist etwas schiefgelaufen.');
      shake(loginInput);
      return;
    }
    try {
      await startApp();
    } catch (e) {
      showFatal(e);
      return;
    }
    toast(`Willkommen zurück, ${firstName(state.me.name)}!`);
    afterStart({ join: valid ? code : null });
  }

  // --- Ansichten ---
  const back = (to) => h('button.wc-back', { type: 'button', onclick: () => show(to) }, icon('chevL', 18), 'Zurück');
  const brand = () => h('div.brand.big', null, h('img', { src: 'icon.svg', alt: '' }), 'Zeitgarten');

  const views = {
    new: () => [
      lost ? back('lost') : null,
      brand(),
      // Gerade auf den Home-Bildschirm gelegt? Dann gibt es das Profil meist schon (in Safari)
      !lost && !valid && isIos() && isStandalone()
        ? h('button.wc-tip', { type: 'button', onclick: () => show('login') },
          h('span.wc-tip-ic', { 'aria-hidden': 'true' }, '📲'),
          h('span.grow', null, h('strong', null, 'Schon ein Profil in Safari?'), h('span', null, 'Dann hier mit deinem Code anmelden')),
          icon('chevR', 18))
        : null,
      invite?.error ? h('p.form-error', null, invite.error) : null,
      valid
        ? inviteCard(invite)
        : h('div.hero', null,
          lost
            ? h('h1', null, 'Neu anfangen')
            : h('h1', null, 'Gemeinsam planen.', h('br'), h('span.grad', null, 'Einfach schöner.')),
          h('p.muted', null, lost
            ? 'Leg ein neues Profil an. Deine Freunde können dich danach wieder in ihre Kalender einladen.'
            : 'Der Kalender für dich, deine Familie und deine Freunde. Lade sie per Link ein, importiere bestehende Kalender und plant zusammen – live.'),
        ),
      field('Wie heißt du?', nameInput),
      field('Deine Farbe', swatches(color, (c) => (color = c))),
      startBtn,
      h('p.fine', null, 'Kein Passwort, keine E-Mail – dein Profil wird auf diesem Gerät gespeichert.'),
      h('div.or-sep', null, h('span', null, 'oder')),
      h('button.btn.block.have-profile', { type: 'button', onclick: () => show('login') }, icon('key', 18), 'Ich hab schon ein Profil'),
    ],
    login: () => [
      back(lost ? 'lost' : 'new'),
      h('div.wc-art', { 'aria-hidden': 'true' }, '🔑'),
      h('h1.wc-title', null, 'Willkommen zurück'),
      h('p.muted.wc-lead', null, 'Melde dich mit einem Code von deinem anderen Gerät an – oder mit deinem persönlichen Anmelde-Link.'),
      h('div.login-row', null, loginInput, pasteBtn),
      loginErr,
      loginBtn,
      h('div.wc-help', { id: 'login-help' },
        h('strong', null, 'So bekommst du den Code'),
        h('ol', null,
          h('li', null, 'Öffne Zeitgarten auf einem Gerät, auf dem du angemeldet bist.'),
          h('li', null, 'Tippe auf dein Profil und dann auf „Auf anderem Gerät anmelden“.'),
          h('li', null, 'Gib den Code hier ein. Er gilt 10 Minuten.'),
        ),
      ),
    ],
    lost: () => [
      h('div.wc-art', { 'aria-hidden': 'true' }, '🔍'),
      h('h1.wc-title', null, 'Profil nicht gefunden'),
      h('p.muted.wc-lead', null, 'Dein Profil wurde auf diesem Server nicht gefunden. Vielleicht wurde der Server neu eingerichtet, oder du wurdest auf diesem Gerät abgemeldet.'),
      h('p.muted.wc-lead', null, 'Ist Zeitgarten noch auf einem anderen Gerät offen? Dann hol dir dort einen Code und melde dich hier wieder an.'),
      h('div.wc-actions', null,
        h('button.btn.primary.lg.block', { type: 'button', onclick: () => show('login') }, icon('key', 18), 'Mit Code oder Link anmelden'),
        h('button.btn.lg.block', { type: 'button', onclick: () => show('new') }, icon('sparkle', 18), 'Neu anfangen'),
      ),
      h('p.fine', null, 'Vielleicht nur ein kurzer Aussetzer? ', h('button.link-btn', { type: 'button', onclick: () => location.reload() }, 'Nochmal versuchen')),
    ],
  };

  function show(v, { initial = false } = {}) {
    card.dataset.view = v;
    card.replaceChildren(h('div.wc-view', null, views[v]()));
    requestAnimationFrame(() => {
      if (v === 'lost') {
        if (!initial) card.querySelector('.btn.primary')?.focus({ preventScroll: true });
        return;
      }
      // Am Handy springt sonst sofort die Tastatur auf
      if (v === 'login' || !matchMedia('(pointer: coarse)').matches) (v === 'login' ? loginInput : nameInput).focus({ preventScroll: true });
    });
  }

  show(view, { initial: true });
  app.replaceChildren(h('div.welcome', null,
    FLOATIES.map((f) => h('div.floaty', { style: { '--c': f.c, left: f.x, top: f.y, animationDelay: f.d } }, f.t)),
    card,
  ));
}

function showFatal(e) {
  stopLive();
  els = null;
  app.replaceChildren(h('div.fatal', null,
    h('div.empty-art', null, '🥀'),
    h('h2', null, 'Keine Verbindung'),
    h('p.muted', null, e?.message || 'Der Server antwortet gerade nicht.'),
    h('button.btn.primary', { onclick: () => location.reload() }, 'Nochmal versuchen'),
  ));
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
    h('main.main', null, topbar, wantsIosHint() ? iosHintCard() : null, view),
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
      h('button.side-link', { onclick: action(() => openFinder()) }, icon('users', 18), 'Wann habt ihr Zeit?'),
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
  // Gerade per Einladungslink beigetreten? Dann einmal „Wähl deinen Look“
  if (lookAfterJoin && calById(lookAfterJoin)) {
    lookAfterJoin = null;
    showLook();
  }
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
  } catch {
    /* 401 zeigt app.js über zg:unauthorized, sonst klappt es beim nächsten Mal */
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

function onLiveMessage(msg) {
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
    case 'paired':
      // Ein anderes Gerät hat den Anmelde-Code benutzt: Code im Profil ausblenden
      forEachSheet((s) => s.onPaired?.());
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
}

// ---------- Live-Verbindung: Wiederverbinden nach Abbrüchen ----------
// Bricht die Verbindung ab (Server-Neustart, Funkloch, Handy im Hintergrund), wird mit wachsendem
// Abstand (1 s, 2 s, 4 s … max. 30 s, leicht zufällig) neu verbunden – sofort, wenn die Seite wieder
// sichtbar oder das Netz wieder da ist. Danach wird alles neu geladen. Es gibt immer nur eine Verbindung.

const live = { stream: null, open: false, broken: false, tries: 0, timer: null, probing: false, hiddenAt: 0 };

function connectLive() {
  clearTimeout(live.timer);
  live.timer = null;
  live.stream?.close();
  live.stream = null;
  live.open = false;
  if (!els || !auth.token) return;
  const stream = openStream(onLiveMessage, {
    onOpen: () => {
      if (live.stream !== stream) return;
      live.open = true;
      live.tries = 0;
      if (live.broken) {
        live.broken = false;
        // Was in der Zwischenzeit passiert ist, nachladen
        needAll = true;
        scheduleLive();
        connStatus('ok');
      }
    },
    onError: () => {
      if (live.stream !== stream) return;
      live.stream = null;
      live.open = false;
      liveBroken();
    },
  });
  live.stream = stream;
}

function liveBroken() {
  if (!els) return;
  if (!live.broken) {
    live.broken = true;
    connStatus('wait');
  }
  clearTimeout(live.timer);
  live.timer = null;
  if (navigator.onLine === false) return; // das „online“-Ereignis verbindet neu
  const base = Math.min(30000, 1000 * 2 ** Math.min(live.tries, 5));
  live.tries++;
  live.timer = setTimeout(reconnectLive, Math.round(base * (0.7 + Math.random() * 0.6)));
}

// Erst kurz fragen, ob der Server wieder da ist (und das Profil noch kennt), dann neu verbinden
async function reconnectLive() {
  clearTimeout(live.timer);
  live.timer = null;
  if (!els || live.probing || live.open) return;
  live.probing = true;
  let ok = false;
  try {
    await api('GET', '/api/presence');
    ok = true;
  } catch (e) {
    if (e.status === 401) return; // zg:unauthorized zeigt die Erklärung
  } finally {
    live.probing = false;
  }
  if (!els) return;
  if (ok) connectLive();
  else liveBroken();
}

function reconnectSoon() {
  if (!els || live.open) return;
  live.tries = 0;
  reconnectLive();
}

function stopLive() {
  clearTimeout(live.timer);
  live.timer = null;
  live.stream?.close();
  live.stream = null;
  live.open = false;
  live.broken = false;
  live.tries = 0;
  clearTimeout(liveTimer);
  connStatus(null);
}

// Kleiner Hinweis, solange die Verbindung fehlt (erst nach kurzer Wartezeit, damit nichts flackert)
let pill = null;
let pillTimer = null;

function connStatus(mode) {
  clearTimeout(pillTimer);
  if (mode === 'wait') {
    if (pill?.dataset.mode === 'wait') return;
    pillTimer = setTimeout(() => drawPill('wait'), pill ? 0 : 1500);
    return;
  }
  if (mode === 'ok' && pill?.dataset.mode === 'wait') {
    drawPill('ok');
    pillTimer = setTimeout(() => connStatus(null), 1800);
    return;
  }
  if (!pill) return;
  const old = pill;
  pill = null;
  old.classList.add('out');
  setTimeout(() => old.remove(), 320);
}

function drawPill(mode) {
  if (!pill) {
    pill = h('button.conn-pill', { type: 'button', 'aria-live': 'polite', onclick: () => pill?.dataset.mode === 'wait' && reconnectSoon() });
    document.body.append(pill);
  }
  pill.dataset.mode = mode;
  pill.title = mode === 'wait' ? 'Tippen, um es gleich nochmal zu versuchen' : '';
  pill.replaceChildren(
    mode === 'ok' ? icon('check', 16) : h('span.conn-spin', { 'aria-hidden': 'true' }),
    h('span', null, mode === 'ok' ? 'Wieder verbunden' : 'Verbindung wird wiederhergestellt …'),
  );
}

addEventListener('online', reconnectSoon);
addEventListener('offline', () => {
  if (!els || !live.stream) return;
  live.stream.close();
  live.stream = null;
  live.open = false;
  liveBroken();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    live.hiddenAt = Date.now();
    return;
  }
  if (!els) return;
  const away = live.hiddenAt ? Date.now() - live.hiddenAt : 0;
  live.hiddenAt = 0;
  if (!live.open) {
    reconnectSoon();
    return;
  }
  // Nach langer Pause (Handy im Hintergrund) ist die Verbindung oft schon tot, ohne dass es jemand merkt
  if (away > 5 * 60000) connectLive();
  if (away > 60000) {
    needAll = true;
    scheduleLive();
  }
});

// Server kennt das gespeicherte Profil nicht mehr → freundlich erklären statt leerer Willkommensseite
addEventListener('zg:unauthorized', () => {
  if (!els) return;
  cleanup?.();
  cleanup = null;
  closeAllSheets();
  renderWelcome(null, { view: 'lost' });
});

// ---------- Tastatur ----------

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen() && !e.isComposing) {
    e.preventDefault();
    dismissTopSheet();
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

// ---------- iPhone: Tipp für den Home-Bildschirm ----------

const IOS_HINT_KEY = 'zg.iosHint';

function isIos() {
  const ua = navigator.userAgent || '';
  return /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// Safari selbst – nicht Chrome/Firefox fürs iPhone und keine Browser in anderen Apps
function isIosSafari() {
  const ua = navigator.userAgent || '';
  return isIos() && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|FBAN|FBAV|Instagram|Line\/|Snapchat/.test(ua);
}

const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function wantsIosHint() {
  if (isDemo || isStandalone() || !isIosSafari()) return false;
  try {
    return !localStorage.getItem(IOS_HINT_KEY);
  } catch {
    return true;
  }
}

function dismissIosHint() {
  try {
    localStorage.setItem(IOS_HINT_KEY, String(Date.now()));
  } catch {
    /* dann eben nur bis zum Neuladen */
  }
  const el = document.querySelector('.ios-hint');
  if (!el) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), 320);
}

function iosHintCard() {
  return h('aside.ios-hint', { 'aria-label': 'Tipp: Zeitgarten als App' },
    h('button.ih-main', { type: 'button', onclick: openIosHowTo },
      h('img.ih-icon', { src: 'icon-180.png', alt: '', width: 42, height: 42 }),
      h('span.ih-text', null,
        h('strong', null, 'Zeitgarten als App'),
        h('span', null, 'Auf den Home‑Bildschirm legen'),
      ),
      h('span.ih-cta', null, h('span.ih-cta-lbl', null, 'So geht’s'), icon('chevR', 16)),
    ),
    h('button.icon-btn.sm.ih-x', { type: 'button', 'aria-label': 'Tipp ausblenden', title: 'Ausblenden', onclick: dismissIosHint }, icon('x', 16)),
  );
}

function openIosHowTo() {
  let pair = null; // { code, expiresAt }
  const chip = (ic, text) => h('span.ih-chip', null, ic ? icon(ic, 15) : null, text);
  const step = (n, ...children) => h('li', null, h('span.ih-n', null, n), h('span.ih-step', null, ...children));
  const codeBtn = h('button.btn.primary', {
    onclick: () => busy(codeBtn, async () => {
      try {
        pair = await api('POST', '/api/me/pair-code');
      } catch (e) {
        if (e.status === 404) throw new Error('Das geht auf diesem Server noch nicht. Kopiere stattdessen im Profil deinen Anmelde-Link.');
        throw e;
      }
      sheet.refresh();
    }),
  }, icon('key', 18), 'Code anzeigen');

  const codeBox = () => {
    if (!pair) return null;
    const until = new Date(pair.expiresAt);
    const expired = !(until > new Date());
    return h('div.ih-code', { class: expired ? 'expired' : '' },
      h('span.eyebrow', null, expired ? 'Code abgelaufen' : 'Dein Code'),
      h('strong', { 'aria-label': pair.code.split('').join(' ') }, pair.code),
      h('span.muted', null, expired ? 'Hol dir einfach einen neuen.' : `Gilt bis ${time(until)} Uhr und nur einmal.`),
      expired ? null : h('button.btn.sm', { onclick: () => copyText(pair.code, 'Code kopiert') }, icon('copy', 15), 'Kopieren'),
    );
  };

  const sheet = openSheet({
    className: 'ios-howto',
    render: () => {
      codeBtn.replaceChildren(icon('key', 18), pair ? 'Neuer Code' : 'Code anzeigen');
      return {
        title: 'Auf den Home-Bildschirm',
        body: [
          h('p.muted', null, 'Dann startet Zeitgarten wie eine richtige App – im Vollbild und mit eigenem Symbol.'),
          h('ol.ih-steps', null,
            step(1, 'Tippe in Safari auf ', chip('share', 'Teilen'), '. Bei neuem iOS steckt es hinter ', chip(null, '•••'), '.'),
            step(2, 'Wähle ', chip('plusSquare', 'Zum Home-Bildschirm'), ' und dann „Hinzufügen“.'),
            step(3, 'Öffne Zeitgarten auf dem Home-Bildschirm und tippe auf ', chip('key', 'Ich hab schon ein Profil'), '.'),
            step(4, 'Gib dort einen Code ein. Den bekommst du hier – oder jederzeit unter Profil → „Auf anderem Gerät anmelden“.'),
          ),
          codeBox(),
          h('p.ih-why', null, icon('sparkle', 16), h('span', null, 'Warum nochmal anmelden? Die App auf dem Home-Bildschirm ist für dein iPhone wie ein neues Gerät. Mit dem Code holst du dein Profil mit allen Kalendern dorthin – und dort bleibt es auch nach längeren Pausen gespeichert.')),
        ],
        foot: [
          h('button.btn.ghost', {
            onclick: () => {
              dismissIosHint();
              sheet.close();
            },
          }, 'Nicht mehr zeigen'),
          h('span.grow'),
          codeBtn,
        ],
      };
    },
  });
}

// ---------- Start ----------

const LOOK_KEY = 'zg.lookShown';
let lookAfterJoin = null; // Kalender-ID: nach dem Beitreten einmal den Look wählen lassen
let pendingEventId = null; // Termin aus einem Link /e/<id>

// „Wähl deinen Look“ – für neue Profile immer, nach Einladungen nur einmal pro Gerät
function showLook({ always = false } = {}) {
  try {
    if (!always && localStorage.getItem(LOOK_KEY)) return;
    localStorage.setItem(LOOK_KEY, '1');
  } catch {
    /* trotzdem zeigen */
  }
  setTimeout(() => els && openLookPicker(), 450);
}

async function joinFromLink(code) {
  openJoin(code);
  try {
    const info = await api('GET', `/api/invites/${encodeURIComponent(code)}`);
    if (!calById(info.calendar.id)) lookAfterJoin = info.calendar.id;
  } catch {
    /* openJoin zeigt den Fehler */
  }
}

// Termin aus einem geteilten Link öffnen
function openPendingEvent() {
  const id = pendingEventId;
  pendingEventId = null;
  if (!id) return;
  if (state.events.has(id)) openEventById(id);
  else toast('Diesen Termin kannst du nicht sehen – vielleicht wurde er gelöscht, oder er liegt in einem Kalender, in dem du nicht bist.', { error: true });
}

// Nach dem Start: Einladung, Termin-Link, Look-Auswahl
function afterStart({ join = null, fresh = false } = {}) {
  // /join/…, /login/… und /e/… sind erledigt – Adresse aufräumen
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  if (fresh) showLook({ always: true });
  if (join) joinFromLink(join);
  else openPendingEvent();
  // iPhone löscht Website-Daten sonst nach längerer Pause – um dauerhaften Speicher bitten
  if (isIos()) navigator.storage?.persist?.().catch(() => {});
}

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
  const path = location.pathname;
  const join = /^\/join\/([\w-]+)\/?$/.exec(path)?.[1];
  const login = /^\/login\/([\w-]+)\/?$/.exec(path)?.[1];
  pendingEventId = /^\/e\/([\w-]+)\/?$/.exec(path)?.[1] || null;
  const prev = auth.token;
  if (login) {
    // Der Anmelde-Link soll nicht im Verlauf stehen bleiben
    history.replaceState(null, '', '/');
    auth.set(login);
  }
  if (!auth.token) {
    renderWelcome(join);
    return;
  }
  try {
    await startApp();
  } catch (e) {
    if (e.status !== 401) {
      showFatal(e);
      return;
    }
    if (login) {
      // Falscher Anmelde-Link: bisheriges Profil behalten
      auth.set(prev);
      if (!prev) {
        renderWelcome(join, { view: 'login', error: BAD_LINK });
        return;
      }
      try {
        await startApp();
      } catch (e2) {
        if (e2.status === 401) renderWelcome(join, { view: 'lost' });
        else showFatal(e2);
        return;
      }
      toast(BAD_LINK, { error: true });
      afterStart({ join });
      return;
    }
    renderWelcome(join, { view: 'lost' });
    return;
  }
  if (login) toast(login === prev ? `Du bist schon als ${state.me.name} angemeldet` : `Angemeldet als ${state.me.name}`);
  afterStart({ join });
}

boot();

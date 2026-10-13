// Bausteine der Oberfläche: Fenster (Sheets), Meldungen, Avatare, Farbauswahl
import { h, icon } from './h.js';
import { COLORS, initials } from './state.js';

// ---------- Sheets (Dialoge, auf dem Handy von unten) ----------

const stack = [];
let sheetSeq = 0;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const coarse = () => matchMedia('(pointer: coarse)').matches;
const motionOff = () => document.documentElement.dataset.motion === 'off';
const isTextField = (el) => el?.matches?.('textarea, select, input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])');

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden], [inert]') && el.getClientRects().length);
}

// Hintergrund und untere Fenster sind nicht bedienbar, solange ein Fenster darüber liegt
function updateInert() {
  const app = document.getElementById('app');
  if (app) app.inert = stack.length > 0;
  stack.forEach((s, i) => (s.overlay.inert = i < stack.length - 1));
}

/**
 * Öffnet ein Fenster. `render(sheet)` liefert { title, body, foot, head }.
 * Mit sheet.refresh() wird der Inhalt neu gezeichnet (z. B. nach Live-Updates).
 * `isDirty()` → true: Schließen per Hintergrund, Esc, X oder Wischen fragt erst nach.
 * sheet.close() schließt immer, sheet.requestClose() fragt bei Änderungen nach.
 */
export function openSheet({ render, className, live = false, onClose, isDirty, alert = false }) {
  const overlay = h('div.overlay', { class: alert ? 'alert-overlay' : '' });
  const box = h('div.sheet', { class: [className, alert && 'alert'].filter(Boolean).join(' '), role: alert ? 'alertdialog' : 'dialog', 'aria-modal': 'true', tabindex: '-1' });
  overlay.append(box);
  const titleId = `sheet-title-${++sheetSeq}`;
  const returnFocus = document.activeElement;
  const sheet = { overlay, box, live, closed: false, close, refresh, requestClose, isDirty };

  function refresh() {
    const prev = box.querySelector('.sheet-body')?.scrollTop || 0;
    const active = document.activeElement;
    const r = render(sheet);
    const head = r.head ?? h('div.sheet-head', null,
      h('h2', null, r.title || ''),
      // Das X ist wie Esc: bei ungespeicherten Änderungen erst nachfragen
      h('button.icon-btn', { onclick: requestClose, 'aria-label': 'Schließen', title: 'Schließen' }, icon('x')),
    );
    box.replaceChildren(...[head, h('div.sheet-body', null, r.body), r.foot && h('div.sheet-foot', null, r.foot)].filter(Boolean));
    box.querySelector('.sheet-body').scrollTop = prev;
    // Titel für Vorleseprogramme
    const title = box.querySelector('.sheet-head h2') || box.querySelector('h2');
    if (title?.textContent.trim()) {
      if (!title.id) title.id = titleId;
      box.setAttribute('aria-labelledby', title.id);
    } else box.removeAttribute('aria-labelledby');
    // Eingabefelder, die wiederverwendet werden, behalten den Fokus
    if (active && box.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
  }

  function close() {
    if (sheet.closed) return;
    sheet.closed = true;
    const i = stack.indexOf(sheet);
    if (i >= 0) stack.splice(i, 1);
    updateInert();
    box.style.removeProperty('animation'); // nach dem Wischen wieder normal hinausgleiten
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 220);
    // Fokus zurück dorthin, wo er vorher war (Tastatur am Handy nicht wieder aufklappen)
    const now = document.activeElement;
    if (returnFocus?.isConnected && returnFocus !== document.body && (!now || now === document.body || box.contains(now)) &&
      !(coarse() && isTextField(returnFocus)) && !returnFocus.closest('[inert]')) {
      returnFocus.focus({ preventScroll: true });
    } else if (box.contains(now)) now.blur();
    onClose?.();
  }

  // Schließen durch Nutzer (Hintergrund, Esc, Wischen): bei ungespeicherten Änderungen erst fragen
  function requestClose() {
    if (sheet.closed || sheet.asking) return;
    let dirty = false;
    try {
      dirty = !!isDirty?.();
    } catch {
      dirty = false;
    }
    if (!dirty) {
      close();
      return;
    }
    sheet.asking = true;
    discardDialog().then((discard) => {
      sheet.asking = false;
      if (discard) close();
    });
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) overlay.dataset.down = '1';
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && overlay.dataset.down) requestClose();
    delete overlay.dataset.down;
  });
  if (!alert) swipeToClose(sheet);

  refresh();
  document.getElementById('overlay-root').append(overlay);
  stack.push(sheet);
  updateInert();
  requestAnimationFrame(() => {
    if (sheet.closed || box.contains(document.activeElement)) return;
    const auto = box.querySelector('[autofocus]');
    // Am Handy/Tablet das Fenster selbst fokussieren: kein Fokusrahmen am ersten Knopf
    // und keine Tastatur, die von selbst aufspringt
    const first = auto || (coarse() ? null : focusables(box)[0]);
    if (first) first.focus({ preventScroll: true });
    else box.focus({ preventScroll: true });
  });
  return sheet;
}

// Wischen nach unten schließt das Fenster (Handy) – nur, wenn der Inhalt ganz oben ist
function swipeToClose(sheet) {
  const { box, overlay } = sheet;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let vel = 0;
  let dy = 0;
  let state = 'idle'; // idle | maybe | drag
  let dirty = false;

  // Liegt zwischen Finger und Fenster etwas, das schon gescrollt ist?
  const atTop = (target) => {
    for (let el = target; el && el !== box; el = el.parentElement) {
      if (el.scrollTop > 0 || el.matches('input[type="range"], [data-no-swipe]')) return false;
    }
    return true;
  };
  // Gummiband: je weiter, desto zäher
  const rubber = (x, dim) => (1 - 1 / ((x * 0.55) / dim + 1)) * dim;

  const reset = (animate) => {
    box.classList.remove('dragging');
    overlay.classList.remove('dragging');
    overlay.style.removeProperty('--drag');
    if (animate && !motionOff()) {
      box.style.transition = 'transform 0.36s cubic-bezier(0.2, 0.9, 0.25, 1.15)';
      box.addEventListener('transitionend', () => (box.style.transition = ''), { once: true });
    }
    box.style.transform = '';
  };

  box.addEventListener('touchstart', (e) => {
    state = 'idle';
    if (e.touches.length !== 1 || sheet.closed || !isPhone() || !atTop(e.target)) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = lastY = t.clientY;
    lastT = e.timeStamp;
    vel = 0;
    dy = 0;
    state = 'maybe';
  }, { passive: true });

  box.addEventListener('touchmove', (e) => {
    if (state === 'idle' || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (state === 'maybe') {
      const ddx = t.clientX - startX;
      const ddy = t.clientY - startY;
      if (Math.abs(ddx) < 7 && Math.abs(ddy) < 7) return;
      // nur klar nach unten – sonst normal scrollen
      if (ddy <= 0 || Math.abs(ddx) > Math.abs(ddy) || !atTop(e.target)) {
        state = 'idle';
        return;
      }
      state = 'drag';
      startY = lastY = t.clientY;
      lastT = e.timeStamp;
      try {
        dirty = !!sheet.isDirty?.();
      } catch {
        dirty = false;
      }
      box.style.animation = 'none';
      box.style.transition = 'none';
      box.classList.add('dragging');
      overlay.classList.add('dragging');
    }
    e.preventDefault();
    const dt = Math.max(1, e.timeStamp - lastT);
    vel = 0.75 * ((t.clientY - lastY) / dt) + 0.25 * vel;
    lastY = t.clientY;
    lastT = e.timeStamp;
    dy = t.clientY - startY;
    const off = dy < 0 ? -rubber(-dy, 60) : dirty ? rubber(dy, 140) : dy;
    box.style.transform = `translateY(${off.toFixed(1)}px)`;
    const k = dirty ? 0 : Math.min(1, Math.max(0, off / Math.max(240, box.offsetHeight)));
    overlay.style.setProperty('--drag', (1 - k).toFixed(3));
  }, { passive: false });

  const end = () => {
    if (state !== 'drag') {
      state = 'idle';
      return;
    }
    state = 'idle';
    const far = dy > Math.min(150, box.offsetHeight * 0.3) || (vel > 0.5 && dy > 30);
    if (far && !dirty) {
      box.classList.remove('dragging');
      box.style.transition = '';
      box.style.animation = '';
      sheet.close();
      return;
    }
    reset(true);
    if (far) sheet.requestClose();
  };
  box.addEventListener('touchend', end);
  box.addEventListener('touchcancel', end);
}

// Kleine Rückfrage, bevor Eingaben verloren gehen
function discardDialog() {
  return new Promise((resolve) => {
    let result = false;
    const s = openSheet({
      alert: true,
      className: 'small',
      onClose: () => resolve(result),
      render: () => ({
        head: h('div.alert-head', null,
          h('div.alert-ic', null, icon('edit', 22)),
          h('h2', null, 'Änderungen verwerfen?'),
        ),
        body: h('p.muted', null, 'Was du eingegeben hast, geht dann verloren.'),
        foot: [
          h('button.btn', { autofocus: !coarse(), onclick: () => s.close() }, 'Weiter bearbeiten'),
          h('button.btn.danger-solid', {
            onclick: () => {
              result = true;
              s.close();
            },
          }, 'Verwerfen'),
        ],
      }),
    });
  });
}

// Tab bleibt im obersten Fenster
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !stack.length) return;
  const { box } = stack[stack.length - 1];
  const list = focusables(box);
  const active = document.activeElement;
  if (!list.length) {
    e.preventDefault();
    box.focus();
    return;
  }
  const first = list[0];
  const last = list[list.length - 1];
  if (!box.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && (active === first || active === box)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
});

export const sheetOpen = () => stack.length > 0;

// Schließt das oberste Fenster ohne Rückfrage (aus dem Code)
export function closeTopSheet() {
  stack[stack.length - 1]?.close();
}

// Wie closeTopSheet, aber mit Rückfrage bei ungespeicherten Änderungen (Esc)
export function dismissTopSheet() {
  stack[stack.length - 1]?.requestClose();
}

export function closeAllSheets() {
  for (const s of [...stack]) s.close();
}

export function refreshLiveSheets() {
  for (const s of stack) if (s.live && !s.closed) s.refresh();
}

export function forEachSheet(fn) {
  for (const s of [...stack]) fn(s);
}

// ---------- Rückfragen ----------

export function confirmDialog({ title, text, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const s = openSheet({
      className: 'small',
      onClose: () => resolve(result),
      render: () => ({
        title,
        body: h('p.muted', null, text),
        foot: [
          h('button.btn.ghost', { onclick: () => s.close() }, 'Abbrechen'),
          h(`button.btn.${danger ? 'danger-solid' : 'primary'}`, {
            autofocus: true,
            onclick: () => {
              result = true;
              s.close();
            },
          }, ok),
        ],
      }),
    });
  });
}

export function chooseDialog({ title, text, options }) {
  return new Promise((resolve) => {
    let result = null;
    const s = openSheet({
      className: 'small',
      onClose: () => resolve(result),
      render: () => ({
        title,
        body: [
          text ? h('p.muted', null, text) : null,
          h('div.choices', null, options.map((o) => h(`button.choice${o.danger ? '.danger' : ''}`, {
            onclick: () => {
              result = o.value;
              s.close();
            },
          }, h('strong', null, o.label), o.hint ? h('span', null, o.hint) : null))),
        ],
      }),
    });
  });
}

// ---------- Meldungen ----------

export function toast(text, { error = false, action = null } = {}) {
  const el = h(`div.toast${error ? '.error' : ''}`, { role: 'status' }, icon(error ? 'x' : 'check', 18), h('span', null, text));
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  };
  if (action) {
    el.append(h('button.t-action', {
      onclick: () => {
        dismiss();
        action.run();
      },
    }, action.label));
  }
  document.getElementById('toasts').append(el);
  setTimeout(dismiss, error ? 4200 : action ? 5200 : 2600);
}

// Meldung, wenn jemand anderes etwas gemacht hat
export function liveToast({ user, text, sub = 'Gerade eben', onClick }) {
  const box = document.getElementById('toasts');
  const max = matchMedia('(max-width: 760px)').matches ? 2 : 3;
  while (box.querySelectorAll('.toast.live').length >= max) box.querySelector('.toast.live').remove();
  const el = h('div.toast.live', { role: 'status' },
    avatar(user, 30),
    h('span.tx', null, h('span', null, text), h('small', null, h('span.live-dot'), sub)),
  );
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  };
  el.addEventListener('click', () => {
    dismiss();
    onClick?.();
  });
  box.append(el);
  setTimeout(dismiss, 5000);
}

export function errorToast(e) {
  toast(e?.message || 'Da ist etwas schiefgelaufen.', { error: true });
}

// Führt eine Aktion aus und zeigt Fehler als Meldung; Knopf ist währenddessen gesperrt
export async function busy(button, fn) {
  if (button) {
    button.disabled = true;
    button.classList.add('loading');
  }
  try {
    return await fn();
  } catch (e) {
    errorToast(e);
    return undefined;
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('loading');
    }
  }
}

// ---------- Kleine Bausteine ----------

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export const textOn = (hex) => (luminance(hex) > 0.36 ? '#1c1d22' : '#ffffff');

// Avatar: eigenes Emoji auf der Farbe der Person, sonst Initialen
export function avatar(user, size = 32, { online = false } = {}) {
  const color = /^#[0-9a-f]{6}$/i.test(user.color || '') ? user.color : '#9b9da4';
  const emoji = typeof user.emoji === 'string' && user.emoji.trim() ? user.emoji.trim() : null;
  return h('span.avatar', {
    class: [emoji && 'emoji-av', online && 'online'].filter(Boolean).join(' '),
    title: online ? `${user.name} · online` : user.name,
    role: 'img',
    'aria-label': online ? `${user.name}, online` : user.name,
    style: {
      '--c': color,
      color: textOn(color),
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * (emoji ? 0.56 : 0.4))}px`,
    },
  }, h('span.av-in', { 'aria-hidden': 'true' }, emoji || initials(user.name)));
}

export function avatarStack(users, size = 26, max = 4, isOnline = () => false) {
  const shown = users.slice(0, max);
  return h('span.avatars', null,
    shown.map((u) => avatar(u, size, { online: isOnline(u.id) })),
    users.length > max ? h('span.avatar.more-av', { style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` } }, `+${users.length - max}`) : null,
  );
}

export function swatches(selected, onPick, { allowNone = false, noneColor } = {}) {
  const wrap = h('div.swatches', { role: 'radiogroup' });
  const draw = (cur) => {
    wrap.replaceChildren(...[
      allowNone && h('button.swatch.none', {
        type: 'button',
        class: !cur ? 'on' : '',
        title: 'Kalenderfarbe',
        'aria-label': 'Kalenderfarbe',
        style: { '--c': noneColor || '#9b9da4' },
        onclick: () => (onPick(null), draw(null)),
      }, 'A'),
      ...COLORS.map((c) => h('button.swatch', {
        type: 'button',
        class: cur === c.hex ? 'on' : '',
        title: c.name,
        'aria-label': c.name,
        style: { '--c': c.hex },
        onclick: () => (onPick(c.hex), draw(c.hex)),
      }, cur === c.hex ? icon('check', 16) : null)),
    ].filter(Boolean));
  };
  draw(selected);
  return wrap;
}

export function segmented(options, value, onChange) {
  const wrap = h('div.seg', { role: 'tablist' });
  const draw = (cur) => wrap.replaceChildren(...options.map((o) => h('button', {
    type: 'button',
    role: 'tab',
    class: o.value === cur ? 'on' : '',
    'aria-selected': String(o.value === cur),
    title: o.title || o.label,
    onclick: () => {
      draw(o.value);
      onChange(o.value);
    },
  }, o.icon ? icon(o.icon, 17) : null, o.label ? h('span.seg-label', null, o.label) : null)));
  draw(value);
  return wrap;
}

export function field(label, ...children) {
  return h('div.field', null, label ? h('label.label', null, label) : null, ...children);
}

export async function copyText(text, msg = 'Kopiert!') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

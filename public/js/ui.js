// Bausteine der Oberfläche: Fenster (Sheets), Meldungen, Avatare, Farbauswahl
import { h, icon } from './h.js';
import { COLORS, initials } from './state.js';

// ---------- Sheets (Dialoge, auf dem Handy von unten) ----------

const stack = [];

/**
 * Öffnet ein Fenster. `render(sheet)` liefert { title, body, foot, head }.
 * Mit sheet.refresh() wird der Inhalt neu gezeichnet (z. B. nach Live-Updates).
 */
export function openSheet({ render, className, live = false, onClose }) {
  const overlay = h('div.overlay');
  const box = h('div.sheet', { class: className, role: 'dialog', 'aria-modal': 'true' });
  overlay.append(box);
  const sheet = { overlay, box, live, closed: false, close, refresh };

  function refresh() {
    const prev = box.querySelector('.sheet-body')?.scrollTop || 0;
    const active = document.activeElement;
    const r = render(sheet);
    const head = r.head ?? h('div.sheet-head', null,
      h('h2', null, r.title || ''),
      h('button.icon-btn', { onclick: close, 'aria-label': 'Schließen', title: 'Schließen' }, icon('x')),
    );
    box.replaceChildren(...[head, h('div.sheet-body', null, r.body), r.foot && h('div.sheet-foot', null, r.foot)].filter(Boolean));
    box.querySelector('.sheet-body').scrollTop = prev;
    // Eingabefelder, die wiederverwendet werden, behalten den Fokus
    if (active && box.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
  }

  function close() {
    if (sheet.closed) return;
    sheet.closed = true;
    stack.splice(stack.indexOf(sheet), 1);
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 200);
    onClose?.();
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) overlay.dataset.down = '1';
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && overlay.dataset.down) close();
    delete overlay.dataset.down;
  });

  refresh();
  document.getElementById('overlay-root').append(overlay);
  stack.push(sheet);
  requestAnimationFrame(() => box.querySelector('[autofocus]')?.focus());
  return sheet;
}

export const sheetOpen = () => stack.length > 0;

export function closeTopSheet() {
  stack[stack.length - 1]?.close();
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

export function avatar(user, size = 32, { online = false } = {}) {
  return h('span.avatar', {
    class: online ? 'online' : '',
    title: online ? `${user.name} · online` : user.name,
    style: { '--c': user.color, color: textOn(user.color), width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` },
  }, initials(user.name));
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

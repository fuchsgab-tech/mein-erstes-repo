// Kleine Effekte: Konfetti, Emoji-Regen und Tooltips
import { prefs, reducedMotion } from './themes.js';

let layer = null;
const fxOn = () => prefs.fx !== false && prefs.motion !== false && !reducedMotion.matches;

export function burst(x, y, emojis = ['🎉', '✨', '🥳', '💫'], count = 16, spread = 1) {
  if (!fxOn()) return;
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    document.body.append(layer);
  }
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'fx-p';
    el.textContent = emojis[i % emojis.length];
    layer.append(el);
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15 * spread;
    const dist = 70 + Math.random() * 120;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const rot = (Math.random() - 0.5) * 140;
    const s = 0.7 + Math.random() * 0.7;
    const anim = el.animate([
      { transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(0.2)`, opacity: 1 },
      { transform: `translate(${x + dx}px, ${y + dy}px) translate(-50%, -50%) scale(${s}) rotate(${rot}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x + dx * 1.2}px, ${y + dy + 90}px) translate(-50%, -50%) scale(${s * 0.85}) rotate(${rot * 1.6}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.2,1)' });
    anim.onfinish = () => el.remove();
  }
}

export function burstFrom(el, emojis, count, spread) {
  if (!el?.isConnected) return;
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, emojis, count, spread);
}

// ---------- Tooltip ----------

let tip = null;

export function showTip(el, title, sub) {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
  }
  const r = el.getBoundingClientRect();
  tip.replaceChildren(document.createTextNode(title));
  if (sub) {
    const small = document.createElement('small');
    small.textContent = sub;
    tip.append(small);
  }
  tip.style.left = `${Math.min(window.innerWidth - 80, Math.max(80, r.left + r.width / 2))}px`;
  tip.style.top = `${r.top}px`;
  tip.hidden = false;
}

export function hideTip() {
  if (tip) tip.hidden = true;
}

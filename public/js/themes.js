// Designs & persönliche Darstellung
import { api } from './api.js';
import { EXTRA_SKINS } from './skins/index.js';

export const SKINS = [
  {
    id: 'garten', name: 'Garten', desc: 'Warm & natürlich',
    light: { bg: '#f5f4ef', surface: '#ffffff', accent: '#0f9d76', text: '#1c1d22' },
    dark: { bg: '#0f1012', surface: '#18191d', accent: '#34c79b', text: '#ececef' },
  },
  {
    id: 'aurora', name: 'Aurora', desc: 'Glas & Polarlicht',
    light: { bg: 'radial-gradient(70% 60% at 15% 10%, #c4b5fd, transparent 70%), radial-gradient(60% 60% at 90% 20%, #99f6e4, transparent 70%), radial-gradient(70% 70% at 70% 100%, #fbcfe8, transparent 70%), #eef0fb', surface: 'rgba(255,255,255,.7)', accent: '#7c5cff', text: '#1b1a33' },
    dark: { bg: 'radial-gradient(70% 60% at 15% 10%, #5b21b6, transparent 70%), radial-gradient(60% 60% at 90% 20%, #0e7490, transparent 70%), radial-gradient(70% 70% at 70% 100%, #9d174d, transparent 70%), #0a0a18', surface: 'rgba(22,22,44,.72)', accent: '#a78bfa', text: '#eeeefe' },
  },
  {
    id: 'neon', name: 'Neon', desc: 'Technisch & leuchtend',
    light: { bg: 'linear-gradient(rgba(37,99,235,.08) 1px, transparent 1px) 0 0/14px 14px, linear-gradient(90deg, rgba(37,99,235,.08) 1px, transparent 1px) 0 0/14px 14px, #eef1f6', surface: '#ffffff', accent: '#2563eb', text: '#0b1220' },
    dark: { bg: 'linear-gradient(rgba(34,211,238,.1) 1px, transparent 1px) 0 0/14px 14px, linear-gradient(90deg, rgba(34,211,238,.1) 1px, transparent 1px) 0 0/14px 14px, #05070d', surface: '#0b0f19', accent: '#22d3ee', text: '#e6f1ff', glow: true },
  },
  {
    id: 'sunset', name: 'Sunset', desc: 'Pfirsich & Abendrot',
    light: { bg: 'linear-gradient(160deg, #ffd9c7, #fff5ef 45%, #fbd5ec)', surface: '#ffffff', accent: '#ff5e3a', text: '#2a1612' },
    dark: { bg: 'radial-gradient(80% 60% at 50% 100%, #7c2d12, transparent 70%), radial-gradient(60% 50% at 20% 0%, #701a75, transparent 70%), #170d12', surface: '#21141a', accent: '#ff7a59', text: '#fbeae4' },
  },
  {
    id: 'ozean', name: 'Ozean', desc: 'Frisch & klar',
    light: { bg: 'linear-gradient(180deg, #d7eefc, #f0f9ff 55%, #dcfaf6)', surface: '#ffffff', accent: '#0284c7', text: '#0c1f2c' },
    dark: { bg: 'radial-gradient(80% 60% at 80% 0%, #075985, transparent 70%), radial-gradient(60% 60% at 0% 100%, #115e59, transparent 70%), #06131d', surface: '#0c1d2a', accent: '#38bdf8', text: '#e3f2fb' },
  },
  {
    id: 'pastell', name: 'Pastell', desc: 'Weich & verspielt',
    light: { bg: 'radial-gradient(60% 50% at 10% 10%, #fbcfe8, transparent 70%), radial-gradient(60% 50% at 90% 30%, #ddd6fe, transparent 70%), radial-gradient(60% 60% at 40% 100%, #bae6fd, transparent 70%), #faf6ff', surface: '#ffffff', accent: '#9b6bff', text: '#2b2340' },
    dark: { bg: 'radial-gradient(60% 50% at 10% 10%, #4a1d3f, transparent 70%), radial-gradient(60% 50% at 90% 30%, #2e1d5c, transparent 70%), #14111d', surface: '#1c1828', accent: '#b794ff', text: '#f1ecff' },
  },
  {
    id: 'mono', name: 'Mono', desc: 'Schlicht & scharf',
    light: { bg: '#ffffff', surface: '#ffffff', accent: '#09090b', text: '#09090b', outline: true },
    dark: { bg: '#000000', surface: '#0a0a0a', accent: '#fafafa', text: '#fafafa', outline: true },
  },
  // Live-Stile: bewegter Hintergrund aus bgfx.js, Verzierungen aus skins-live.css
  {
    id: 'jarvis', name: 'Jarvis', desc: 'Live · Hologramm-HUD', live: true,
    light: { bg: 'radial-gradient(circle at 72% 50%, transparent 30%, rgba(0,121,166,.45) 31%, transparent 32.5%, transparent 41%, rgba(0,121,166,.3) 42%, transparent 43.5%), linear-gradient(rgba(0,121,166,.09) 1px, transparent 1px) 0 0/9px 9px, linear-gradient(90deg, rgba(0,121,166,.09) 1px, transparent 1px) 0 0/9px 9px, #eaf5fa', surface: 'rgba(251,254,255,.82)', accent: '#0079a6', text: '#04212d' },
    dark: { bg: 'radial-gradient(circle at 72% 50%, rgba(53,224,255,.38), transparent 22%), radial-gradient(circle at 72% 50%, transparent 30%, rgba(53,224,255,.6) 31%, transparent 32.5%, transparent 41%, rgba(53,224,255,.4) 42%, transparent 43.5%), linear-gradient(rgba(53,224,255,.08) 1px, transparent 1px) 0 0/9px 9px, #01070d', surface: 'rgba(4,20,34,.72)', accent: '#35e0ff', text: '#e3f8ff', glow: true },
  },
  {
    id: 'synthwave', name: 'Synthwave', desc: 'Live · Retro-Neon 1984', live: true,
    light: { bg: 'repeating-linear-gradient(90deg, rgba(214,51,170,.4) 0 1px, transparent 1px 11px) 0 100%/100% 34% no-repeat, radial-gradient(circle at 50% 66%, #ffd9a8 0 13%, #ff9ccf 20%, transparent 21%), linear-gradient(180deg, #d9c8ff 0%, #f8c6ec 52%, #ffd6c4 65.5%, #e2f4ff 66%, #f6e9ff)', surface: 'rgba(255,255,255,.72)', accent: '#c2189a', text: '#2b1145' },
    dark: { bg: 'repeating-linear-gradient(90deg, rgba(255,61,207,.6) 0 1px, transparent 1px 11px) 0 100%/100% 34% no-repeat, radial-gradient(circle at 50% 66%, #ffe66d 0 9%, #ff8a3d 15%, #ff2fa6 20%, transparent 21%), linear-gradient(180deg, #0b0320 0%, #3a0b5e 45%, #b0207a 65.5%, #12022b 66%, #0b0320)', surface: 'rgba(22,8,48,.72)', accent: '#ff3dcf', text: '#fff0fd', glow: true },
  },
  {
    id: 'cyberpunk', name: 'Cyberpunk', desc: 'Live · Night City', live: true,
    light: { bg: 'repeating-linear-gradient(-45deg, #0b0b0b 0 4px, transparent 4px 8px) 0 100%/100% 6px no-repeat, linear-gradient(180deg, transparent 62%, rgba(11,11,11,.85) 62%) 0 0/23px 100%, #f3e600', surface: 'rgba(255,250,190,.9)', accent: '#0b0b0b', text: '#0b0b0b' },
    dark: { bg: 'repeating-linear-gradient(-45deg, #fcee0a 0 4px, transparent 4px 8px) 0 100%/100% 6px no-repeat, linear-gradient(180deg, transparent 58%, rgba(0,240,255,.22) 58% 59%, #120a1a 59%) 0 0/19px 100%, linear-gradient(180deg, #050507 40%, #2a0718), #050507', surface: 'rgba(12,12,16,.86)', accent: '#fcee0a', text: '#f4f1de', glow: true },
  },
  {
    id: 'galaxie', name: 'Galaxie', desc: 'Live · Sterne & Nebel', live: true,
    light: { bg: 'radial-gradient(1px 1px at 18% 24%, #6d5bd0, transparent), radial-gradient(1px 1px at 72% 16%, #6d5bd0, transparent), radial-gradient(1.5px 1.5px at 86% 64%, #6d5bd0, transparent), radial-gradient(50% 50% at 22% 30%, rgba(249,168,212,.75), transparent 70%), radial-gradient(50% 50% at 82% 76%, rgba(165,180,252,.8), transparent 70%), linear-gradient(180deg, #e0e4ff, #f6e8fb 55%, #ffe4ea), #f4ecfb', surface: 'rgba(255,255,255,.7)', accent: '#6b4dff', text: '#1c1838' },
    dark: { bg: 'radial-gradient(1px 1px at 18% 24%, #fff, transparent), radial-gradient(1px 1px at 72% 16%, #fff, transparent), radial-gradient(1.5px 1.5px at 86% 64%, #fff, transparent), radial-gradient(1px 1px at 40% 82%, #fff, transparent), radial-gradient(50% 50% at 24% 30%, rgba(124,58,237,.6), transparent 70%), radial-gradient(50% 50% at 80% 76%, rgba(219,39,119,.45), transparent 70%), radial-gradient(40% 40% at 72% 18%, rgba(37,99,235,.5), transparent 70%), #04030f', surface: 'rgba(14,12,38,.62)', accent: '#a594ff', text: '#f1efff', glow: true },
  },  // Weitere Live-Stile, jeder in einer eigenen Datei unter js/skins/
  ...EXTRA_SKINS.map((m) => m.skin),
];

export const DEFAULT_PREFS = {
  skin: 'garten',
  mode: 'auto',
  accent: null,
  events: 'tint',
  corners: 'round',
  font: 'modern',
  density: 'cozy',
  kw: false,
  motion: true,
  fx: true,
  notify: false,
};

const KEY = 'zg.prefs';

function readLocal() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (p) return p;
    const old = JSON.parse(localStorage.getItem('zg.theme') || 'null'); // ältere Version
    return old ? { mode: old } : {};
  } catch {
    return {};
  }
}

export const prefs = { ...DEFAULT_PREFS, ...readLocal() };

const dark = matchMedia('(prefers-color-scheme: dark)');
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Bei „Automatisch“ zählt eine helle/dunkle Wahl der umgebenden App (data-theme), sonst das System
const hostTheme = () => document.documentElement.dataset.theme;
export const resolvedMode = () => {
  if (prefs.mode !== 'auto') return prefs.mode;
  if (hostTheme() === 'dark' || hostTheme() === 'light') return hostTheme();
  return dark.matches ? 'dark' : 'light';
};

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function applyPrefs() {
  const r = document.documentElement;
  const d = r.dataset;
  d.skin = SKINS.some((s) => s.id === prefs.skin) ? prefs.skin : 'garten';
  d.mode = resolvedMode();
  d.events = prefs.events;
  d.corners = prefs.corners;
  d.font = prefs.font;
  d.density = prefs.density;
  d.motion = prefs.motion && !reducedMotion.matches ? 'on' : 'off';
  if (prefs.accent && /^#[0-9a-f]{6}$/i.test(prefs.accent)) {
    r.style.setProperty('--accent', prefs.accent);
    r.style.setProperty('--on-accent', luminance(prefs.accent) > 0.36 ? '#111214' : '#ffffff');
  } else {
    r.style.removeProperty('--accent');
    r.style.removeProperty('--on-accent');
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const skin = SKINS.find((s) => s.id === d.skin)[d.mode];
    meta.content = /^#/.test(skin.bg) ? skin.bg : skin.bg.match(/#[0-9a-f]{6}(?![\s\S]*#[0-9a-f]{6})/i)?.[0] || '#000000';
  }
}

dark.addEventListener('change', () => prefs.mode === 'auto' && applyPrefs());
new MutationObserver(() => prefs.mode === 'auto' && applyPrefs())
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

let syncTimer = null;
export function setPrefs(patch, { sync = true } = {}) {
  Object.assign(prefs, patch);
  prefs.t = String(Date.now());
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* egal */
  }
  applyPrefs();
  if (sync) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => api('PATCH', '/api/me', { prefs }).catch(() => {}), 600);
  }
}

// Einstellungen vom Server übernehmen, wenn sie neuer sind (z. B. am anderen Gerät geändert)
export function adoptServerPrefs(server) {
  if (!server || !server.t) {
    if (prefs.t) api('PATCH', '/api/me', { prefs }).catch(() => {});
    return false;
  }
  if (Number(server.t) <= Number(prefs.t || 0)) return false;
  setPrefs({ ...DEFAULT_PREFS, ...server }, { sync: false });
  prefs.t = server.t;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* egal */
  }
  return true;
}

applyPrefs();

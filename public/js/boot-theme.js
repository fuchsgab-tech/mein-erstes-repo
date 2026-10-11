// Setzt das gewählte Design, bevor die Seite gezeichnet wird (kein Aufblitzen)
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('zg.prefs') || '{}') || {};
    var d = document.documentElement.dataset;
    var mode = p.mode || 'auto';
    if (mode === 'auto') mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    d.skin = p.skin || 'garten';
    d.mode = mode;
    d.events = p.events || 'tint';
    d.corners = p.corners || 'round';
    d.font = p.font || 'modern';
    d.density = p.density || 'cozy';
    d.motion = p.motion === false || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'on';
    if (p.accent) document.documentElement.style.setProperty('--accent', p.accent);
  } catch {
    document.documentElement.dataset.mode = 'light';
  }
})();

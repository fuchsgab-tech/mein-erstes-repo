// Baut die Demo-Version, die ganz ohne Server läuft:  npm run demo  ->  demo/dist/
// Die Dateien in demo/dist kann man auf jeden statischen Hoster legen (z. B. GitHub Pages).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'demo', 'dist');

fs.rmSync(OUT, { recursive: true, force: true });
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), path.join(OUT, to));
};

for (const f of fs.readdirSync(path.join(ROOT, 'public/js'))) if (f !== 'api.js') copy(`public/js/${f}`, `js/${f}`);
copy('demo/api.js', 'js/api.js'); // statt Server: alles im Browser
copy('server/core.js', 'server/core.js');
copy('server/ics.js', 'server/ics.js');
copy('public/js/time.js', 'public/js/time.js'); // wird von core.js und ics.js eingebunden
copy('public/css/app.css', 'css/app.css');
copy('public/icon.svg', 'icon.svg');
copy('public/icon-192.png', 'icon-192.png');

const head = `<title>Zeitgarten</title>
<link rel="icon" href="icon.svg" type="image/svg+xml">
<script src="js/boot-theme.js"></script>
<link rel="stylesheet" href="css/app.css">
<script type="module" src="js/app.js"></script>`;
const body = `<div id="app"></div>
<div id="overlay-root"></div>
<div id="toasts" aria-live="polite"></div>`;

fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f4ef">
${head}
</head>
<body>
${body}
</body>
</html>
`);

// Variante für ein claude.ai-Artifact: Dort kommt das HTML-Grundgerüst vom Artifact selbst,
// und der Rand für Notch und Home-Leiste ist schon um die Seite gelegt.
fs.writeFileSync(path.join(OUT, 'artifact.html'), `${head}
<style>
  #app, .shell, .skeleton { height: 100%; }
  .welcome, .fatal { min-height: 100%; }
  @media (max-width: 760px) {
    .topbar { padding-top: 8px; }
    .sidebar { padding-top: 18px; }
  }
</style>
${body}
`);

console.log(`Demo gebaut: ${path.relative(ROOT, OUT)}/`);

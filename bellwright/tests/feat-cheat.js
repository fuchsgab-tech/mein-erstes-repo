// BUILD 12 "Spickzettel Gebäudeprioritäten": a Hilfe section right after the job-priority explanation: two short lines
// (Arbeitspriorität = was, Gebäudepriorität = wo; the scale 1 / 5 / ⊘ and buildings without a number), a table
// 1–5 and ⊘ that stacks into cards on phones (no horizontal page scroll at 360), and three rules below it.
// Runs page.html (from mk.js) in local mode, at 360, 390 and 1280 px.
const { chromium } = require('playwright');
const path = require('path');

const SHOTS = path.resolve(__dirname, '../shots-r3');
const LINE_1 = 'Arbeitspriorität = was jemand macht. Gebäudepriorität = wo er es innerhalb eines Jobs zuerst macht.';
const LINE_2 = '1 = am wichtigsten, 5 = Standard, ⊘ = aus. Gebäude ohne Zahl (Wohnzelte, Brunnen, Wegweiser, Rathaus) brauchen keine.';
const ROWS = [
  ['1', 'Kochstellen (Lagerfeuer mit Kochtopf), Forschungstisch, Sägegrube solange ihr viel baut'],
  ['2', 'Werkzeugmacher, Bauernhöfe, Dreschhaus, Holzfällerplatz, Minenlager, Geflügelstall, eine Baustelle, die fertig werden soll'],
  ['3', 'Holzfällerhütte, Jägerlager, Metzgerei, Mischkübel, Webstuhl + Webertisch, Gerbergestell, Räuchergestelle'],
  ['4', 'Fischerlager, Handwerkerecke, Einfache Werkbank, Schwammhütte'],
  ['5', 'Alle Lager (Vorratslager, Scheunen, Lagertruhen), Sammlerhütte + Trockengestelle, Försterei, Komposthaufen, Karawane'],
  ['⊘', 'was ihr gerade nicht braucht'],
];
const RULES = [
  'Höchstens 3–4 Gebäude auf 1.',
  'Eine Baustelle auf 2, bis sie fertig ist, dann wieder 5.',
  'Ein rotes Warnzeichen am Gebäude heißt meist: Werkzeug oder Material fehlt.',
];

const fails = [];
let passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else fails.push(name + (detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 600) : '')); };
const errs = [];
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[360, 740], [390, 844], [1280, 900]]) {
      const mobile = w < 900;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile });
      const P = await ctx.newPage();
      P.on('pageerror', e => errs.push(w + ': ' + e.message));
      P.on('console', m => { if (m.type() === 'error') errs.push(w + ' console: ' + m.text()); });
      await P.goto('file://' + process.cwd() + '/page.html#wissen');
      await P.waitForTimeout(500);
      const r = await P.evaluate(() => {
        const panel = document.getElementById('panel-wissen');
        const secs = [...panel.querySelectorAll(':scope > section')];
        const titles = secs.map(s => (s.querySelector('h2') || {}).textContent || '');
        const sec = document.getElementById('help-buildings');
        if (!sec) return { titles, missing: true };
        const ps = [...sec.querySelectorAll(':scope > p')].map(p => p.textContent);
        const table = sec.querySelector('table');
        const rows = table ? [...table.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent)) : [];
        const heads = table ? [...table.querySelectorAll('thead th')].map(th => th.textContent) : [];
        const rules = [...sec.querySelectorAll('ul li, ol li')].map(li => li.textContent);
        const tr0 = table && table.querySelector('tbody tr');
        const badge = tr0 && tr0.querySelector('td:first-child > span');
        const off = table && [...table.querySelectorAll('tbody tr')].pop().querySelector('td:first-child > span');
        const box = sec.getBoundingClientRect(), tb = table ? table.getBoundingClientRect() : { left: 0, right: 0 };
        return {
          titles, ps, heads, rows, rules,
          headShown: table ? getComputedStyle(table.querySelector('thead')).display !== 'none' : null,
          trDisplay: tr0 ? getComputedStyle(tr0).display : null,
          badgeCls: badge ? badge.className : '', offLabel: off ? off.getAttribute('aria-label') : null, offCls: off ? off.className : '',
          sw: document.documentElement.scrollWidth, vw: innerWidth,
          tableInside: tb.left >= box.left - 0.5 && tb.right <= box.right + 0.5,
          wrapScrolls: table ? table.parentElement.scrollWidth > table.parentElement.clientWidth + 1 : null,
          tabSelected: document.getElementById('tab-wissen').getAttribute('aria-selected'),
        };
      });
      if (r.missing) { check(`${w}: section "Gebäudeprioritäten" exists`, false, r.titles); await ctx.close(); continue; }
      const iJob = r.titles.indexOf('So funktionieren Arbeitsprioritäten im Spiel');
      const iNew = r.titles.indexOf('Gebäudeprioritäten');
      check(`${w}: Hilfe has "Gebäudeprioritäten" right after the job-priority explanation`, iJob >= 0 && iNew === iJob + 1 && r.titles[iNew + 1] === 'Die Jobs', r.titles);
      if (w === 360) {
        check('two short lines: was / wo, then the scale and buildings without a number', r.ps.length >= 2 && norm(r.ps[0]) === LINE_1 && norm(r.ps[1]) === LINE_2, r.ps);
        check('table head: Zahl | Gebäude', r.heads.join('|') === 'Zahl|Gebäude', r.heads);
        check('table rows 1, 2, 3, 4, 5, ⊘ with the buildings from the spec', r.rows.length === ROWS.length && r.rows.every((row, i) => row.length === 2 && norm(row[0]) === ROWS[i][0] && norm(row[1]) === ROWS[i][1]), r.rows);
        check('the numbers wear the plan\'s priority colours (p1 … p5, ⊘ striped like "aus") and ⊘ reads "aus"', /\bp1\b/.test(r.badgeCls) && /\bp0\b/.test(r.offCls) && r.offLabel === 'aus', { b: r.badgeCls, o: r.offCls, l: r.offLabel });
        check('three rules below the table', r.rules.length === 3 && r.rules.every((t, i) => norm(t) === RULES[i]), r.rules);
      }
      if (mobile) {
        check(`${w}: rows stack into cards (no table head, rows are blocks/grids), no horizontal scroll`, r.headShown === false && r.trDisplay !== 'table-row' && r.sw <= r.vw && r.tableInside && !r.wrapScrolls, r);
      } else {
        check('1280: a real table with head, no horizontal scroll', r.headShown === true && r.trDisplay === 'table-row' && r.sw <= r.vw && r.tableInside, r);
      }
      await P.evaluate(() => document.getElementById('help-buildings').scrollIntoView({ block: 'start' }));
      await P.waitForTimeout(350);
      await P.screenshot({ path: path.join(SHOTS, `cheat-${w}.png`) });
      await ctx.close();
    }
  } finally { await browser.close(); }
  check('no page errors', !errs.length, errs.slice(0, 5));
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`feat-cheat: ${passes} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();

// Build test pages: page.html (as published) and expose.html (exposes internals for logic tests)
const fs = require('fs');
const body = fs.readFileSync(process.argv[2], 'utf8');
const wrap = b => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>' + b + '</body></html>';
fs.writeFileSync('page.html', wrap(body));
const idx = body.lastIndexOf('})();\n</script>');
if (idx < 0) throw new Error('IIFE end not found');
const exp = body.slice(0, idx) + 'window.__t = { reloadApplied, compute, normWorker, normSettings, defaultSettings, parseRoster, cleanPhotoResult, JOBS, ATTRS, PHASES, EXAMPLE, state, mergeStat, getUser: () => ({ userNs, myId }), getIngame: () => ({ applied, appliedMeta, names: Object.fromEntries(names) }), relTime, whoWhen, cleanIngame, review: { normName, nameSim, matchScore, rankTargets, matchLevel, autoTarget, rowDoubts, sameAfter, photoPrompt, rosterNames, addReviewCards, rv, openDoubts } };\n' + body.slice(idx);
fs.writeFileSync('expose.html', wrap(exp));
console.log('ok');

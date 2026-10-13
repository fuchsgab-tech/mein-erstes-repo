// Passende Emojis zu Termintiteln („Pizza-Abend“ → 🍕, „Zahnarzt“ → 🦷). Nur fürs Bild:
// Der Titel selbst bleibt, wie er ist. Läuft im Browser und in Node (für die Tests).
//
// Stichwörter (Groß/klein und Umlaute egal, „Fußball“ = „Fussball“, „Müll“ = „Muell“):
//   wort   passt am Wortanfang          („pizza“ → „Pizzaabend“)
//   -wort  am Wortende                  („-arzt“ → „Hausarzt“, aber nicht „Arzt“ allein)
//   *wort  irgendwo im Wort             („*urlaub“ → „Sommerurlaubsplanung“)
//   =wort  nur genau dieses Wort        („=uni“, aber nicht „Uniform“)
//   zwei worte  als Wortfolge           („haare schneiden“)
// Die Reihenfolge ist der Vorrang: Genaueres steht vor Allgemeinem („Tischtennis“ vor „Tennis“,
// „Trauerfeier“ vor „Feier“, „Mittagessen mit Papa“ ist Essen und nicht Familie).

const HINTS = [
  // Ernstes zuerst, damit daraus nie eine Party wird
  ['🕯️', 'beerdigung, trauerfeier, beisetzung, =trauer, gedenk, funeral, advent'],

  // Feste & Feiertage
  ['🎂', '*geburtstag, birthday, =bday, =geb'],
  ['💍', '*hochzeit, wedding, verlobung, standesamt, polterabend, trauung'],
  ['🍼', 'babyparty, babyshower, baby shower, babysitt'],
  ['🥂', 'jga, junggesell, sekt, empfang, jubil, anstossen'],
  ['🏡', 'einweihung, housewarming'],
  ['🎄', 'weihnacht, heiligabend, christmas, xmas'],
  ['🎅', 'nikolaus, wichteln'],
  ['🎆', 'silvester, neujahr, new year'],
  ['🐣', 'ostern, osterbrunch, osterfeuer, ostereier, easter'],
  ['🎃', 'halloween, kuerbis schnitzen'],
  ['🎭', 'karneval, fasching, fasnacht, fastnacht, rosenmontag, theater, -theater, musical, =oper, opern, kabarett, comedy, impro'],
  ['🏮', 'laterne, sankt martin, st martin, martinsumzug'],
  ['🍻', 'oktoberfest, wiesn, stammtisch, feierabend, afterwork, after work, kneipe, =pub, vatertag'],
  ['💐', 'muttertag'],
  ['💕', 'jahrestag, anniversary, =date, date night, valentinstag, rendezvous'],

  // Gesundheit & Pflege
  // Tiere (vor Sport: „Hundetraining“)
  ['🐾', '*tierarzt, tierklinik, =vet'],
  ['🐶', '=hund, =hunde, hundeschule, hundesitter, hundetraining, gassi, welpe, =dog'],
  ['🐱', 'katze, =cat'],
  ['🐴', 'pferd'],
  ['🎣', 'angeln'],
  ['🦷', 'zahn, *zahnarzt, kieferorthop, =kfo, dentist, prophylaxe'],
  ['💉', 'impf, -impfung, blutabnahme'],
  ['🩸', 'blutspende'],
  ['👓', 'optiker, brille'],
  ['💆', '*massage'],
  ['💅', 'kosmetik, manikuere, pedikuere, nagelstudio, =naegel'],
  ['🧖', 'sauna, wellness, =spa, therme'],
  ['🤸', 'physio, krankengymnastik, ergotherapie, osteopath, turnen, turnhalle, gymnastik'],
  ['💇', 'friseur, frisoer, frisur, haarschnitt, haare schneiden, barber, haircut'],
  ['🏥', 'krankenhaus, klinik, =op, operation, hospital'],
  ['💊', 'apotheke, medikament'],
  ['🩺', 'arzt, -arzt, aerztin, -aerztin, *arzttermin, *arztbesuch, doktor, =dr, doctor, praxis, vorsorge, *untersuchung, checkup, check up, =hno, hautarzt, orthopaed, gynaekolog'],

  // Sport
  ['🏓', 'tischtennis, ping pong, pingpong'],
  ['⚽', 'fussball, -fussball, soccer, football, kicken, kicker, bundesliga, =wm, =em'],
  ['🏀', 'basketball'],
  ['🏐', '*volleyball'],
  ['🤾', 'handball'],
  ['🎾', 'tennis, padel'],
  ['🏸', 'badminton, federball, squash'],
  ['🏒', '*hockey'],
  ['⛳', 'golf, minigolf'],
  ['🎳', 'bowling, kegeln'],
  ['🎯', 'darts'],
  ['🎱', 'billard'],
  ['🏇', 'reiten, reitstunde, reitunterricht, reitstall'],
  ['🧗', 'klettern, kletterhalle, bouldern, boulderhalle'],
  ['⛷️', '=ski, skifahren, skiurlaub, skitour, skikurs, skigebiet, skiausflug, skiing, langlauf'],
  ['🏂', 'snowboard'],
  ['⛸️', 'schlittschuh, eislaufen, eisbahn'],
  ['🛷', 'rodeln, schlitten'],
  ['🏄', 'surfen, surfkurs, kitesurf, surfing'],
  ['🤿', 'tauchen, schnorcheln'],
  ['⛵', 'segeln, segeltoern'],
  ['🛶', 'kanu, kajak, paddeln, =sup'],
  ['🥋', 'karate, judo, taekwondo, kampfsport, kung fu, aikido, jiu jitsu'],
  ['🥊', 'boxen, boxtraining, kickboxen'],
  ['🩰', 'ballett'],
  ['💃', 'tanz, salsa, tango, zumba, discofox, dance, dancing'],
  ['🧘', '*yoga, pilates, meditation, meditieren'],
  ['🏊', 'schwimm, freibad, hallenbad, =swim, swimming, aquafit'],
  ['🚴', 'fahrrad, =rad, radtour, radfahren, radeln, radrennen, rennrad, =bike, biken, mountainbike, =mtb, spinning, cycling'],
  ['🏃', 'laufen, lauftreff, lauftraining, laufband, jogg, =run, running, marathon, -marathon, stadtlauf, firmenlauf, spendenlauf, parkrun'],
  ['🥾', 'wander, bergtour, =hike, hiking, trekking'],
  ['🚶', 'spazier, =walk, walking'],
  ['🏆', 'turnier, -turnier, wettkampf, meisterschaft, finale'],
  ['🏋️', '=gym, *fitness, krafttraining, training, -training, workout, crossfit, =sport, sportverein, sportplatz'],

  // Essen & Trinken
  ['🍕', 'pizza, pizzeria'],
  ['🍣', 'sushi'],
  ['🍔', 'burger, -burger'],
  ['🍝', 'pasta, spaghetti, lasagne, italiener'],
  ['🥙', 'doener, kebab, falafel'],
  ['🌮', 'taco, burrito, mexikan'],
  ['🍜', 'ramen, =pho, nudelsuppe'],
  ['🍛', 'curry, =inder, indisch'],
  ['🥞', 'brunch, pfannkuchen, pancake, waffel'],
  ['🥐', 'fruehstueck, breakfast, croissant'],
  ['🍦', '=eis, eisdiele, eiscafe, eis essen, gelato, ice cream'],
  ['☕', 'kaffee, coffee, =cafe, cappuccino, espresso'],
  ['🍰', 'kuchen, -kuchen, torte, -torte'],
  ['🍪', 'plaetzchen, kekse, cookies'],
  ['🧁', 'backen, backkurs, baking'],
  ['🍳', 'kochen, kochkurs, kochabend, cooking'],
  ['🍖', 'grill, =bbq, barbecue'],
  ['🫕', 'raclette, fondue'],
  ['🧺', 'picknick, picnic'],
  ['🍺', 'bier, -bier, biergarten, =beer'],
  ['🍷', '=wein, weinprobe, weinfest, weinabend, weinbar, weinverkostung, wine'],
  ['🍸', 'cocktail, =bar, =drinks'],
  ['🍽️', '=essen, essen gehen, mittagessen, abendessen, familienessen, festessen, geschaeftsessen, teamessen, mittagspause, mensa, restaurant, =dinner, =lunch'],

  // Ausgehen & Kultur
  ['🍿', 'kino, -kino, cinema'],
  ['🎬', 'film, movie'],
  ['📺', 'serie, tatort, fernsehen, =tv, netflix'],
  ['🎶', 'konzert, -konzert, concert, =gig, open air, chor, orchester, =probe, bandprobe, musik'],
  ['🎤', 'karaoke, vortrag, keynote, konferenz, tagung, kongress'],
  ['🎪', 'festival, zirkus, kirmes, jahrmarkt, rummel, volksfest'],
  ['🎢', 'freizeitpark, achterbahn, phantasialand, europapark'],
  ['🏛️', 'museum, -museum'],
  ['🖼️', 'ausstellung, galerie, vernissage'],
  ['🦒', '=zoo, tierpark, wildpark'],
  ['🐠', 'aquarium'],
  ['🕺', 'disco, clubbing, =club'],
  ['🎉', 'party, -party, feier, -feier, =fest, -fest, =fete, sause, abschied'],

  // Unterwegs
  ['🏖️', '*urlaub, *ferien, strand, =beach, =meer, ostsee, nordsee, vacation, holiday'],
  ['✈️', 'flug, abflug, hinflug, rueckflug, heimflug, flight, airport'],
  ['🚆', '=zug, zugfahrt, bahn, =db, =ice, =train'],
  ['🚌', '=bus, busfahrt, flixbus'],
  ['🚕', 'taxi, =uber'],
  ['🏨', 'hotel, airbnb, ferienwohnung, =fewo, uebernachtung, hostel, jugendherberge, check in, checkin'],
  ['⛺', 'camping, campen, zelten, zeltlager'],
  ['🚢', 'kreuzfahrt, schiff, bootstour, =boot'],
  ['🗺️', 'ausflug, -ausflug, sightseeing, stadtfuehrung, stadtrundgang'],
  ['🏔️', '=berge, =alpen, huette, almhuette'],
  ['🛂', 'reisepass, =pass, visum, ausweis'],
  ['🧳', 'reise, -reise, anreise, abreise, =packen, koffer, =trip, staedtetrip, citytrip'],

  // Auto und Kinder vor Schule und Haushalt („Fahrschule“, „Kindergarten“)
  ['🚗', '=auto, autowerkstatt, autowaesche, autohaus, autokauf, autofahrt, =tuev, reifen, inspektion, fahrstunde, fahrschule, fuehrerschein, tanken, waschanlage, mietwagen, roadtrip, =car'],
  ['🔧', 'werkstatt, handwerker, reparatur, -reparatur, reparieren, klempner, elektriker, heizung, installateur, schornsteinfeger, monteur'],
  ['🧸', 'kita, =kiga, kindergarten, krippe, tagesmutter, daycare'],
  ['🧒', 'kinder, =kids, spielplatz, playdate'],
  ['👶', '=baby, hebamme'],

  // Schule, Uni, Arbeit
  ['📝', '*pruefung, klausur, examen, =exam, abitur, =abi, =test'],
  ['🎓', '=uni, universitaet, vorlesung, seminar, studium, abschlussfeier, graduation, lecture'],
  ['🎒', 'einschulung, schulanfang, schulausflug, klassenfahrt'],
  ['🏫', 'schule, -schule, elternabend, elternsprechtag, elterngespraech, unterricht, school'],
  ['📚', 'lernen, lerngruppe, nachhilfe, hausaufgaben, bibliothek, buecherei'],
  ['🤝', 'vorstellungsgespraech, bewerbung, interview, ehrenamt'],
  ['📊', 'praesentation, presentation, praesi, =pitch, quartal, =report'],
  ['👥', 'meeting, -meeting, besprech, sitzung, team, jour fixe, standup, stand up, =daily, workshop, retro'],
  ['📞', '=call, =calls, anruf, telefon, =zoom, videocall, video call'],
  ['💻', 'webinar, hackathon, coding, programmieren, homeoffice, home office'],
  ['⏰', 'deadline, abgabe, =frist, wecker'],
  ['💼', '=arbeit, arbeitstag, arbeiten, =buero, office, =job, kunde, dienstreise, =work, -schicht'],

  // Haushalt
  ['🧹', 'putzen, -putzen, putz, -putz, aufraeumen, sauber machen, staubsaugen, cleaning'],
  ['♻️', 'gelber sack, gelbe tonne, altpapier, altglas, papiertonne, recycling'],
  ['🗑️', '=muell, -muell, muelltonne, muellabfuhr, =tonne, -tonne'],
  ['🧺', 'waesche, -waesche, =waschen, waschmaschine, buegeln, laundry'],
  ['📦', 'umzug, -umzug, umziehen, umzugskarton, =moving, paket, packstation'],
  ['📮', '=post, postamt'],
  ['🛒', 'einkauf, -einkauf, supermarkt, =edeka, =rewe, =aldi, =lidl, kaufland, grocer'],
  ['🛍️', 'shoppen, shopping, bummeln, stadtbummel, flohmarkt'],
  ['🛋️', 'ikea, moebel'],
  ['🔨', 'baumarkt, heimwerk, renovier, streichen, diy'],
  ['🌻', 'garten, -garten, gartenarbeit, rasen, blumen, pflanzen, =giessen, unkraut, hecke, garden'],
  ['🏠', 'wohnung, besichtigung, makler, vermieter, hausverwaltung'],

  // Familie & Liebe
  ['👵', '=oma, =omas, grosseltern, =grandma'],
  ['👴', '=opa, =opas, =grandpa'],
  ['👪', 'familie, -familie, =eltern, family'],
  ['👩', '=mama, =mamas, =mutti, =mom'],
  ['👨', '=papa, =papas, =papi, =dad'],

  // Geld & Ämter
  ['🧾', 'steuer, -steuer, finanzamt, =elster, rechnung, -rechnung, abrechnung, nebenkosten, buchhaltung, quittung, =tax, =taxes'],
  ['💶', 'geld, bank, gehalt, ueberweisung, kredit, budget, sparen, finanzen, =miete, depot, aktien'],
  ['📄', '*versicherung, *vertrag, kuendig, formular, antrag'],
  ['🏛️', '=amt, -amt, behoerde, rathaus, buergerbuero'],
  ['🗳️', '=wahl, briefwahl, wahllokal'],

  // Freizeit
  ['🎮', 'gaming, zocken, playstation, =ps5, xbox, nintendo, =switch, videospiel, konsole, lan party, lanparty, minecraft, fortnite, mario kart'],
  ['🎲', 'spieleabend, spielabend, *brettspiel, spieletreff, game night, games night, kniffel, =uno, =catan'],
  ['♟️', 'schach, chess'],
  ['🃏', 'poker, =skat, doppelkopf, kartenspiel'],
  ['🧩', 'puzzle, escape room, escaperoom'],
  ['🧠', '*quiz'],
  ['📖', 'lesen, -lesen, lesung, -lesung, buchclub, lesekreis, book club, reading'],
  ['🎨', 'malen, malkurs, zeichnen, kunst, basteln, toepfern, atelier'],
  ['🧶', 'stricken, haekeln'],
  ['🧵', 'naehen, naehkurs'],
  ['📸', 'foto, shooting'],
  ['🎸', 'gitarre, guitar'],
  ['🎹', 'klavier, piano'],
  ['🎻', 'geige, violine, cello'],
  ['🥁', 'schlagzeug'],
  ['🎙️', 'podcast'],
  ['⛪', 'kirche, gottesdienst, =messe, taufe, kommunion, konfirmation, firmung, church'],
  ['😴', 'ausschlafen, mittagsschlaf, nickerchen, =schlafen'],
  ['🎁', 'geschenk, =gift, gifts'],
  ['🏞️', 'badesee, =see, =park'],
  ['🤝', 'treffen, =treff'],
  ['🏡', 'besuch, =visit'],
];

// klein, ß → ss, Akzente und Umlaute weg („ä“ und „ae“ werden beide zu „a“)
const norm = (s) => s.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '').replace(/([aou])e/g, '$1');

const RULES = HINTS.flatMap(([emoji, list]) => list.split(',').map((raw) => {
  const p = raw.trim();
  const kind = '-*='.includes(p[0]) ? p[0] : p.includes(' ') ? ' ' : '';
  return { emoji, kind, w: norm(kind === '-' || kind === '*' || kind === '=' ? p.slice(1) : p) };
}));

function matches({ kind, w }, words, line) {
  switch (kind) {
    case '=': return words.includes(w);
    case '*': return words.some((x) => x.includes(w));
    case ' ': return line.includes(` ${w}`);
    case '-': return words.some((x) => x.endsWith(w) && x.length - w.length >= 3);
    default: return words.some((x) => x.startsWith(w));
  }
}

const cache = new Map();

/** Emoji-Vorschlag für einen Titel oder '' */
export function suggestEmoji(title) {
  if (!title || typeof title !== 'string') return '';
  let r = cache.get(title);
  if (r !== undefined) return r;
  const words = norm(title).match(/[a-z0-9]+/g) || [];
  const line = ` ${words.join(' ')}`;
  r = words.length ? RULES.find((rule) => matches(rule, words, line))?.emoji || '' : '';
  if (cache.size > 600) cache.clear();
  cache.set(title, r);
  return r;
}

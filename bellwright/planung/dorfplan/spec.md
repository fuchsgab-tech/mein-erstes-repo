# Masterplan "Neues Dorf" – illustrated map (Bellwright co-op group, German UI)

Goal: a beautiful, CORRECT illustrated master plan image (like a hand-painted medieval parchment map), better than
the AI-generated reference /root/.claude/uploads/463ad377-28a1-5da9-b964-5a5b652dc408/8b51b204-image.jpg (use it only
as STYLE inspiration: painted parchment, small building pictograms, wavy paths, lake, trees). The reference has
content errors that must NOT be repeated (see "Errors to avoid").

## Source of truth for geometry and content
- Original photo of the in-game map: /root/.claude/uploads/463ad377-28a1-5da9-b964-5a5b652dc408/c682e0e0-image.jpg
  (1500x2000). Red circle = current (old) village, blue line = area for the NEW village, yellow = user's marks.
- The lead's previous plan script with all coordinates (ORIGINAL photo pixel coords): dorfplan/draw3.py in the
  same folder as this spec. Use its zone polygons Z, kitchen block, KEY building list with positions, paths, the
  step numbers, the crop (100,430)-(1480,1530) and scale 1.4. Keep the same layout (zones may be smoothed into
  organic rounded shapes, buildings arranged neatly inside their zone).
- Already-rendered lead plan for comparison: dorfplan/dorfplan-detail-2.jpg.

## What the map must show (all labels in correct German)
Terrain traced from the photo (stylized): the light main road (white band) with its exact course through the area
(junction at the north of the core, U-bend west of the workshops, continuing south-east), the dark roads (along the
west/south-west edge and the one from the top centre down to the junction, plus the thin path through the field area
from (380,1130) to (720,800)), the lake on the right (east/south-east), forest/tree glyphs ONLY OUTSIDE the blue area
(inside the blue area the forest is already cleared – including the purple strip), the blue boundary line (keep it,
as the user drew it), and the OLD village in the top right drawn faintly with the label "Altes Dorf" and an arrow/road
"Weg zum alten Dorf".
Zones (inside the blue line, SOUTH of the light road): Dorfkern (orange) at the road junction; "Küche" (red-orange
block) at the LEFT edge of the Dorfkern facing the Ernte-Hof; Wohnen (red) right of the core towards the lake;
Ernte-Hof (purple, already cleared strip between fields and core); Felder & Bauernhöfe (green, 6 field plots divided by
small field paths, 5 with a Bauernhof, 1 "Reserve"); Werkstätten (blue) below the core; Platz für später (grey, empty,
between workshops and lake, small note "Schmelze · Bibliothek"); Ställe & Vieh (brown) at the bottom.
Buildings (pictogram + short label or number badge, consistent): 1 Rathaus + Forschungstisch, 2 Küche (Kochstellen),
3 Essenslager, 4 Vorratslager, 5 Brunnen (2x), 6 Wohnhäuser/Wohnzelte (several), 7 Plumpsklo (edge of housing, away
from kitchen), 8 Dreschhaus, 9 Scheunen (3 shown), 10 Komposthaufen, 11 Bauernhof (5), 12 Sägegrube + Holzfällerplatz
(NORTH edge of workshops), 13 Werkzeugmacher, 14 Webstuhl + Webertisch, 15 Werkbänke + Handwerkerecke, 16 Mischkübel,
17 Geflügelstall, 18 Metzgerei, 19 Gerber (right next to Metzgerei), 20 Räuchergestelle (between Metzger and lake +
one at the Fischer), 21 Fischerlager (on the SHORE, not on water), 22 Holzfäller + Förster (forest north, outside),
23 Sammlerhütte (forest north, outside), 24 Aufmarschplatz + Waffenständer (north of core at the road), 25 Kleine
Karawanenstation (at the road towards the old village).
Paths: main paths (wide, light, dashed or cobbled look) linking core->Ernte-Hof->fields, core->housing,
core->workshops->stables, core->Platz für später, housing->Fischer; field paths thinner.
Step badges (gold circles): 1 Dorfkern, 2 Wohnen, 3 Ernte-Hof + Felder (on both), 4 Werkstätten, 5 Ställe & Vieh.
Title: "Neues Dorf – Masterplan". Compass rose small (N up, matching the photo orientation).
Legend panel below the map (dark parchment): zone colours each next to its OWN zone name and contents; numbered
building list 1–25 (two columns); path legend; "Umzug in Schritten": 1 Dorfkern (Küche, Essenslager, Vorratslager,
Brunnen zuerst), 2 Wohnen, 3 Ernte-Hof + Felder, 4 Werkstätten, 5 Ställe & Vieh, danach altes Dorf abbauen.

## Errors to avoid (they are in the reference)
Core/housing north of the road (outside the blue area); anything built on the lake; invented buildings (Saatgutlager,
Schmiede, Sägemöbi, Town Hall); duplicated or swapped labels; legend colours not matching; cut-off words; missing step
numbers; typos (e.g. "Kocktellen", "Kem", "iila").

## Output
- SVG source + PNG render: dorfplan/masterplan.svg and dorfplan/masterplan.png (width ~2000 px, phone-readable: map
  labels >= 26 px at that width, legend text >= 24 px). Render with Playwright/Chromium
  (executablePath /opt/pw-browsers/chromium), NODE_PATH=$(npm root -g). Fonts available locally only (no web fonts):
  pick a serif that looks medieval-ish from `fc-list` (e.g. a bold serif for titles) and a clean sans for small labels.
- Pure SVG/CSS (filters for paper texture/watercolour are welcome), no external images or network.

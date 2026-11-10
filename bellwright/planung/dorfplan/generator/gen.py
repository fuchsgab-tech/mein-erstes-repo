#!/usr/bin/env python3
"""Generates dorfplan/masterplan.svg - hand-painted parchment master plan for the new village.
Geometry is given in ORIGINAL photo pixels (1500x2000) and mapped with the same crop/scale as draw3.py:
crop (100,430)-(1480,1530), scale 1.4  ->  map 1932 x 1540 px."""
import math, random, sys, os, re
import numpy as np
from PIL import Image, ImageFilter, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
from glyphs import G, BOX, TREE_A, TREE_B, TREE_C, INK

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "masterplan.svg")
PHOTO = "/root/.claude/uploads/463ad377-28a1-5da9-b964-5a5b652dc408/c682e0e0-image.jpg"

CX0, CY0, CX1, CY1, S = 100, 430, 1480, 1530, 1.4
MW, MH = int((CX1 - CX0) * S), int((CY1 - CY0) * S)          # 1932 x 1540
W = 2000
MX, MY = 34, 232                                              # map origin on canvas
def T(p): return ((p[0] - CX0) * S, (p[1] - CY0) * S)
def TP(pts): return [T(p) for p in pts]

F_SERIF = "Caladea"; F_SANS = "Inter"
FONT_FILES = {("serif", 700): "/usr/share/fonts/truetype/crosextra/Caladea-Bold.ttf",
              ("serif", 400): "/usr/share/fonts/truetype/crosextra/Caladea-Regular.ttf",
              ("serif", "i"): "/usr/share/fonts/truetype/crosextra/Caladea-Italic.ttf",
              ("serif", "bi"): "/usr/share/fonts/truetype/crosextra/Caladea-BoldItalic.ttf",
              ("sans", 700): "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
              ("sans", 600): "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf",
              ("sans", 400): "/usr/share/fonts/opentype/inter/Inter-Regular.otf"}
_fc = {}
def text_w(s, fam, wt, size):
    k = (fam, wt, size)
    if k not in _fc: _fc[k] = ImageFont.truetype(FONT_FILES[(fam, wt)], size)
    return _fc[k].getlength(s)

# ----------------------------------------------------------------- geometry helpers
def chaikin(pts, it=3, closed=True):
    for _ in range(it):
        new = []
        n = len(pts)
        rng = range(n) if closed else range(n - 1)
        if not closed: new.append(pts[0])
        for i in rng:
            p, q = pts[i], pts[(i + 1) % n]
            new.append((0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]))
            new.append((0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]))
        if not closed: new.append(pts[-1])
        pts = new
    return pts

def catmull(pts, closed=False):
    """Catmull-Rom through points -> SVG cubic path string."""
    n = len(pts)
    if n < 2: return ""
    P = (lambda i: pts[i % n]) if closed else (lambda i: pts[max(0, min(n - 1, i))])
    d = f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"
    segs = n if closed else n - 1
    for i in range(segs):
        p0, p1, p2, p3 = P(i - 1), P(i), P(i + 1), P(i + 2)
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
    return d + (" Z" if closed else "")

def poly_d(pts, closed=True):
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    return d + (" Z" if closed else "")

def pip(pt, poly):
    x, y = pt; inside = False; n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xin: inside = not inside
    return inside

def seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)

def line_dist(p, pts):
    return min(seg_dist(p, pts[i], pts[i + 1]) for i in range(len(pts) - 1))

def clip_half(poly, a, b, keep_left=True):
    """Sutherland-Hodgman: keep the part of poly on the left (or right) of the directed line a->b."""
    def side(p): return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    out = []
    n = len(poly)
    for i in range(n):
        P, Q = poly[i], poly[(i + 1) % n]
        sp, sq = side(P), side(Q)
        inP = sp >= 0 if keep_left else sp <= 0
        inQ = sq >= 0 if keep_left else sq <= 0
        if inP: out.append(P)
        if inP != inQ:
            t = sp / (sp - sq)
            out.append((P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])))
    return out

def clip_line_to_poly(a, b, poly, steps=400):
    """returns list of segments of a->b that are inside poly (sampled)."""
    segs = []; cur = None
    for i in range(steps + 1):
        t = i / steps
        p = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        if pip(p, poly):
            if cur is None: cur = [p, p]
            else: cur[1] = p
        else:
            if cur: segs.append(cur); cur = None
    if cur: segs.append(cur)
    return segs

def centroid(poly):
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    return sum(xs) / len(xs), sum(ys) / len(ys)

# ----------------------------------------------------------------- terrain (original photo px)
ROAD_MAIN = [(1500,752),(1440,810),(1390,850),(1340,870),(1290,884),(1240,890),(1200,893),(1170,887),(1140,874),
             (1100,857),(1060,845),(1020,836),(975,831),(930,836),(880,851),(832,873),(802,896),(784,930),(775,975),
             (767,1020),(749,1052),(727,1078),(686,1120),(647,1162),(630,1208),(628,1250),(638,1284),(686,1311),
             (736,1327),(790,1342),(845,1367),(895,1405),(930,1455),(955,1530),(965,1570)]
ROAD_TOP = [(548,420),(565,470),(585,520),(600,565),(622,628),(648,695),(678,765),(715,822),(755,862),(792,893)]
ROAD_WEST = [(90,752),(110,785),(128,812),(160,858),(190,892),(215,932),(240,972),(265,1020),(285,1062),(300,1092),
             (314,1120),(335,1156),(362,1183),(393,1205),(433,1233),(489,1261),(544,1283),(600,1300),(656,1312),(705,1320)]
ROAD_SOUTH = [(393,1205),(405,1240),(413,1280),(416,1330),(410,1385),(390,1440),(356,1483),(311,1528),(285,1560)]
ROAD_LEFT = [(90,1350),(140,1334),(183,1322),(230,1313),(267,1311),(322,1317),(361,1338),(413,1360)]
PATH_THIN = [(702,810),(640,866),(580,920),(520,977),(470,1030),(420,1083),(376,1124),(338,1152)]
NORTH_PATHS = [[(860,630),(905,633),(950,638),(1000,622),(1050,620),(1100,625),(1140,632)],
               [(1000,622),(990,670),(975,720),(962,760),(955,800),(950,830)],
               [(870,742),(920,752),(962,760)]]
OLD_VILLAGE_PATH = [(1098,852),(1112,818),(1138,786),(1160,752),(1178,722)]

BLUE1 = [(925,1468),(880,1436),(840,1398),(800,1373),(760,1359),(700,1354),(640,1347),(600,1347),(560,1347),
         (556,1340),(547,1320),(536,1300),(517,1280),(491,1260),(465,1240),(431,1220),(398,1200),(355,1180),
         (313,1160),(291,1140),(273,1100),(243,1060),(218,1020),(204,980),(192,940),(179,900),(164,860),(151,840),
         (136,826),(160,796),(200,774),(240,742),(280,706),(320,678),(360,659),(400,637),(440,619),(480,600),
         (520,584),(560,568),(600,593),(640,627),(680,682),(720,741),(760,799),(800,850),(840,873),(880,882),
         (920,882),(960,865),(1000,860),(1040,873),(1080,890),(1120,908),(1160,918),(1188,922),(1200,940),
         (1210,960),(1224,980),(1237,1000),(1248,1020),(1256,1040),(1262,1070),(1266,1100),(1269,1120),(1270,1140),(1268,1162)]
BLUE2 = [(935,1485),(960,1462),(1000,1428),(1040,1393),(1080,1360),(1120,1325),(1160,1289),(1200,1246),(1240,1194),
         (1260,1169),(1280,1145),(1300,1126),(1320,1112),(1340,1100),(1356,1090)]
BLUE_POLY = BLUE1 + [(1266,1166)] + BLUE2[::-1][:-1]  # closed area of the new village

LAKE = [(1100,1060),(1108,1038),(1128,1020),(1160,1006),(1190,1010),(1215,1025),(1236,1050),(1244,1080),(1240,1105),
        (1230,1125),(1226,1160),(1228,1200),(1245,1216),(1258,1236),(1272,1260),(1283,1288),(1300,1318),(1330,1340),
        (1380,1346),(1430,1354),(1480,1364),(1530,1370),(1530,1600),(1150,1600),(1150,1532),(1162,1502),(1178,1480),
        (1184,1450),(1178,1420),(1162,1395),(1152,1370),(1145,1340),(1144,1300),(1148,1265),(1158,1235),(1166,1205),
        (1169,1172),(1163,1142),(1150,1124),(1127,1108),(1106,1095),(1098,1078)]
CREEK = [(1392,1250),(1389,1280),(1386,1315),(1384,1350)]

OLD_VILLAGE_C = (1265, 655); OLD_VILLAGE_R = (188, 196)

# ----------------------------------------------------------------- zones (original photo px)
ZONES = {
 "feld":  dict(name="Felder &amp; Bauernhöfe", plain="Felder & Bauernhöfe", col="#7fa64c", pts=[(190,812),(330,730),(450,662),(545,614),(586,606),(608,642),(630,700),(658,762),(690,812),(706,848),(690,895),(630,1003),(560,1102),(500,1172),(455,1205),(410,1185),(372,1160),(340,1126),(316,1088),(292,1035),(266,978),(240,925),(210,862)]),
 "ernte": dict(name="Ernte-Hof", col="#8d5bb0", pts=[(712,860),(748,886),(757,935),(748,990),(736,1032),(712,1062),(675,1098),(632,1140),(605,1185),(598,1235),(588,1265),(540,1268),(495,1240),(470,1222),(500,1172),(560,1102),(630,1003),(690,895)]),
 "kern":  dict(name="Dorfkern", col="#e39a36", pts=[(814,898),(900,889),(985,882),(1004,925),(1021,975),(1027,1022),(1004,1052),(940,1060),(898,1046),(860,1026),(812,994)]),
 "wohn":  dict(name="Wohnen", col="#c0453a", pts=[(1030,934),(1114,934),(1132,957),(1190,968),(1188,992),(1134,994),(1100,1018),(1084,1044),(1082,1084),(1052,1086),(1040,1040),(1033,990)]),
 "werk":  dict(name="Werkstätten", col="#4d7fb8", pts=[(782,1044),(872,1036),(902,1088),(916,1150),(927,1214),(840,1240),(766,1248),(705,1168),(738,1098)]),
 "spaet": dict(name="Platz für später", col="#9b978f", pts=[(952,1096),(1040,1088),(1082,1092),(1092,1140),(1098,1195),(1080,1226),(1000,1246),(948,1192)]),
 "vieh":  dict(name="Ställe &amp; Vieh", plain="Ställe & Vieh", col="#a06a36", pts=[(800,1270),(900,1256),(990,1244),(1042,1290),(1064,1345),(1002,1402),(955,1434),(905,1397),(856,1352),(806,1320)]),
}
KITCHEN = [(816,909),(879,903),(885,1008),(816,996)]
KITCHEN_COL = "#d4502a"
ZONE_OP = 0.55; KITCHEN_OP = 0.62

# field dividers (draw3) and plots
DIV_V = ((456,600),(450,1260))
DIV_H1 = ((180,881),(740,857))
DIV_H2 = ((260,1076),(640,1053))

# main paths (wide) and field paths (thin)
MAIN_PATHS = [
  [(818,962),(772,962),(720,961),(662,957)],                                                   # Küche -> Ernte-Hof
  [(704,852),(690,895),(660,950),(630,1003),(595,1052),(560,1102),(525,1142),(495,1178),(466,1206)],  # Ernte-Hof / Felder
  [(990,1004),(1022,1006),(1046,1010)],                                                         # Kern -> Wohnen
  [(930,1058),(931,1090),(932,1150),(936,1205),(930,1236),(918,1262)],                          # Kern -> Werkst. -> Ställe
  [(931,1100),(950,1108),(966,1114)],                                                           # -> Platz für später
  [(1074,1084),(1094,1112),(1108,1150),(1121,1184)],                                           # Wohnen -> Fischer
]

# ----------------------------------------------------------------- buildings
# glyph, orig pos (bottom centre), scale, badge number, badge position (orig px)
B = []
def bld(g, p, s=1.0, n=None, bp=None):
    B.append(dict(g=g, p=p, s=s, n=n, bp=bp))

# Dorfkern: kitchen block (2 Kochstellen + Essenslager), Rathaus + Forschungstisch, Vorratslager x2, Brunnen
bld("fire_pot", (835,963), 0.9)
bld("fire_pot", (862,963), 0.9, 2, (893,950))
bld("barrels", (846,997), 0.8, 3, (893,990))
bld("rathaus", (930,989), 1.0, 1, (966,956))
bld("table_book", (970,989), 1.0)
bld("crates", (1001,983), 0.85, 4, (1002,944))
bld("crates", (922,1040), 0.85, 4, (950,1024))
bld("well", (982,1046), 0.9, 5, (1008,1028))
# 24 Aufmarschplatz (north of the core, at the road) / 25 Karawanenstation (road to the old village)
bld("muster", (1030,926), 0.9, 24, (1066,922))
bld("cart", (1162,954), 0.85, 25, (1124,934))
# Wohnen
for p, g in [((1048,966),"house"),((1072,966),"house"),((1096,966),"house"),((1145,992),"tent"),((1167,990),"tent")]:
    bld(g, p, 0.85)
B[-1]["n"] = 6; B[-1]["bp"] = (1188,980)
bld("well", (1062,1028), 0.85, 5, (1090,1016))
bld("latrine", (1068,1074), 0.85, 7, (1042,1064))
# Ernte-Hof
bld("thresh", (718,926), 1.05, 8, (690,908))
bld("barn", (718,1006), 1.05, 9, (683,1000))
bld("barn", (664,1090), 1.05, 9, (692,1060))
bld("barn", (594,1176), 1.05, 9, (560,1156))
bld("compost", (548,1246), 1.0, 10, (520,1232))
# Felder: 5 Bauernhöfe
bld("farm", (332,854), 1.25, 11, (375,826))
bld("farm", (590,766), 1.25, 11, (633,738))
bld("farm", (352,972), 1.25, 11, (395,944))
bld("farm", (522,922), 1.25, 11, (565,894))
bld("farm", (503,1118), 1.25, 11, (546,1090))
# Werkstätten
bld("sawpit", (802,1082), 1.15, 12, (798,1043))
bld("toolmaker", (862,1082), 1.0, 13, (895,1060))
bld("bench", (765,1152), 1.1, 15, (738,1128))
bld("loom", (850,1152), 1.1, 14, (892,1130))
bld("tub", (806,1188), 1.1, 16, (834,1172))
# Ställe & Vieh
bld("coop", (845,1306), 1.1, 17, (820,1288))
bld("butcher", (930,1296), 1.1, 18, (905,1268))
bld("tanner", (982,1302), 1.0, 19, (1000,1270))
bld("smoke", (1030,1322), 1.0, 20, (1048,1286))
# Fischer (shore), its smoke rack, boat on the water
bld("fisher", (1135,1206), 1.0, 21, (1143,1168))
bld("smoke", (1120,1258), 0.95, 20, (1092,1246))
bld("boat", (1190,1220), 1.3)
# outside, forest north
bld("lumber", (735,690), 1.1, 22, (775,665))
bld("gatherer", (640,524), 1.1, 23, (680,500))

# zone label groups: zone, orig centre, font size, rotation, step number (gold badge in front)
ZLABEL = [
 ("feld", (384,744), 40, -29.2, 3),
 ("ernte", (612,1084), 32, -58.4, 3),
 ("kern", (945,912), 27, 0, 1),
 ("wohn", (1078,986), 27, 0, 2),
 ("werk", (835,1216), 31, 0, 4),
 ("spaet", (1020,1140), 26, 0, None),
 ("vieh", (964,1362), 30, 0, 5),
]

# ----------------------------------------------------------------- photo-derived forest positions
def forest_points():
    img = Image.open(PHOTO).convert("L")
    bl = np.asarray(img.filter(ImageFilter.GaussianBlur(14))).astype(int)
    mask = (bl < 152) & (bl > 55)
    rnd = random.Random(7)
    pts = []
    step = 23
    lake_buf = LAKE
    for gy in range(CY0 - 10, CY1 + 20, step):
        for gx in range(CX0 - 10, CX1 + 20, step):
            x = gx + rnd.uniform(-7, 7) + (step / 2 if (gy // step) % 2 else 0)
            y = gy + rnd.uniform(-7, 7)
            xi, yi = int(min(max(x, 0), 1499)), int(min(max(y, 0), 1999))
            if not mask[yi, xi]: continue
            if pip((x, y), BLUE_POLY): continue
            if line_dist((x, y), BLUE1) < 16 or line_dist((x, y), BLUE2) < 16: continue
            if pip((x, y), LAKE) or line_dist((x, y), LAKE + [LAKE[0]]) < 12: continue
            if line_dist((x, y), ROAD_MAIN) < 22: continue
            if min(line_dist((x, y), r) for r in (ROAD_TOP, ROAD_WEST, ROAD_SOUTH, ROAD_LEFT)) < 16: continue
            if line_dist((x, y), PATH_THIN) < 10: continue
            if min(line_dist((x, y), r) for r in NORTH_PATHS + [OLD_VILLAGE_PATH]) < 12: continue
            # old village houses area (keep trees around, not on the houses)
            if ((x - 1262) / 150) ** 2 + ((y - 668) / 150) ** 2 < 1: continue
            pts.append((x, y))
    return pts

# areas kept free of trees (orig px boxes) - building sites outside, labels
TREE_FREE = [(690,640,790,705), (600,480,690,540), (1080,740,1235,800), (1110,790,1200,860), (1150,780,1345,832)]

# ----------------------------------------------------------------- SVG building
out = []
def add(s): out.append(s)

def halo_text(x, y, s, size, fam=F_SERIF, wt=700, fill=INK, halo="#f6ecd2", hw=7, anchor="middle", rot=0, italic=False, ls=0, extra=""):
    tr = f' transform="rotate({rot} {x:.1f} {y:.1f})"' if rot else ""
    st = ' font-style="italic"' if italic else ""
    lsp = f' letter-spacing="{ls}"' if ls else ""
    add(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{fam}" font-weight="{wt}" font-size="{size}"{st}{lsp} text-anchor="{anchor}"{tr} '
        f'fill="{fill}" stroke="{halo}" stroke-width="{hw}" stroke-linejoin="round" paint-order="stroke" {extra}>{s}</text>')

LABEL_BOXES = []   # (name, x0, y0, x1, y1) in map px for overlap checks

def badge(x, y, n, r=20):  # number badge
    add(f'<g class="badge"><circle cx="{x:.1f}" cy="{y + 1.5:.1f}" r="{r + 1}" fill="#2a1c10" opacity=".25"/>'
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="#fbf3dc" stroke="{INK}" stroke-width="2.6"/>'
        f'<text x="{x:.1f}" y="{y + 9.2:.1f}" font-family="{F_SANS}" font-weight="700" font-size="26" text-anchor="middle" fill="#2a1c10" letter-spacing="-1">{n}</text></g>')
    LABEL_BOXES.append((f"badge{n}", x - r, y - r, x + r, y + r))

def step_badge(x, y, n, r=27):
    add(f'<g><circle cx="{x:.1f}" cy="{y + 2:.1f}" r="{r + 2}" fill="#2a1c10" opacity=".3"/>'
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="url(#gold)" stroke="#3a2410" stroke-width="3"/>'
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r - 5}" fill="none" stroke="#fff3c4" stroke-width="1.4" opacity=".8"/>'
        f'<text x="{x:.1f}" y="{y + 12:.1f}" font-family="{F_SERIF}" font-weight="700" font-size="35" text-anchor="middle" fill="#2a1608">{n}</text></g>')
    LABEL_BOXES.append((f"step{n}", x - r, y - r, x + r, y + r))

def build_svg():
    rnd = random.Random(3)
    LEG_Y = MY + MH + 40
    H = LEG_Y + legend_height()
    add(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
    # ------------------------------------------------ defs
    add('<defs>')
    add('''
<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.25  0 0 0 0 0.12  1.25 0 0 0 -0.52"/>
</filter>
<filter id="stains" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.0035 0.005" numOctaves="4" seed="4" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.37  0 0 0 0 0.16  2.4 0 0 0 -1.0"/>
</filter>
<filter id="fibres" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.012 0.32" numOctaves="2" seed="9" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.30  0 0 0 0 0.15  1.6 0 0 0 -0.82"/>
</filter>
<filter id="wc" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="21" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="0.8" result="b"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="5" result="m"/>
  <feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.55" result="ma"/>
  <feComposite in="b" in2="ma" operator="in" result="mott"/>
  <feComposite in="mott" in2="b" operator="arithmetic" k1="0" k2="0.55" k3="0.45" k4="0"/>
</filter>
<filter id="wcedge" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="21" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="2.2"/>
</filter>
<filter id="rough" x="-2%" y="-2%" width="104%" height="104%">
  <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="2" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="roughbig" x="-2%" y="-2%" width="104%" height="104%">
  <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="6" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
<filter id="soft3" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
<radialGradient id="vign" cx="50%" cy="50%" r="72%">
  <stop offset="0.55" stop-color="#7a4a1c" stop-opacity="0"/>
  <stop offset="0.9" stop-color="#7a4a1c" stop-opacity="0.28"/>
  <stop offset="1" stop-color="#5a3412" stop-opacity="0.5"/>
</radialGradient>
<radialGradient id="mapvign" cx="50%" cy="48%" r="70%">
  <stop offset="0.6" stop-color="#8a5a24" stop-opacity="0"/>
  <stop offset="1" stop-color="#8a5a24" stop-opacity="0.32"/>
</radialGradient>
<radialGradient id="gold" cx="38%" cy="32%" r="75%">
  <stop offset="0" stop-color="#ffe7a0"/><stop offset="0.55" stop-color="#e2b04a"/><stop offset="1" stop-color="#a8741e"/>
</radialGradient>
<linearGradient id="lakeg" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#9cc0c8"/><stop offset="1" stop-color="#6f9fb2"/>
</linearGradient>
<linearGradient id="ribbon" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#f8ecd0"/><stop offset="1" stop-color="#e6cf9e"/>
</linearGradient>
<linearGradient id="ribbonDark" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#c9a468"/><stop offset="1" stop-color="#a27a40"/>
</linearGradient>
''')
    for k, v in G.items():
        add(f'<g id="g-{k}">{v}</g>')
    add(f'<g id="t-a">{TREE_A}</g><g id="t-b">{TREE_B}</g><g id="t-c">{TREE_C}</g>')
    add(f'<clipPath id="mapclip"><rect x="0" y="0" width="{MW}" height="{MH}"/></clipPath>')
    # field crop-row patterns
    add('<pattern id="rowsA" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)"><path d="M0,7 H14" stroke="#4a7428" stroke-width="2.4" opacity=".75"/></pattern>')
    add('<pattern id="rowsB" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(62)"><path d="M0,7 H14" stroke="#4a7428" stroke-width="2.4" opacity=".75"/></pattern>')
    add('<pattern id="rowsC" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)"><path d="M0,6 H12" stroke="#8a6512" stroke-width="2.6" opacity=".7"/></pattern>')
    add('<pattern id="rowsD" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(62)"><path d="M0,6 H12" stroke="#8a6512" stroke-width="2.6" opacity=".7"/></pattern>')
    add('<pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0,4.5 H9" stroke="#8a6a3a" stroke-width="1" opacity=".22"/></pattern>')
    add('<pattern id="waves" width="46" height="26" patternUnits="userSpaceOnUse"><path d="M4,10 q5,-5 10,0 t10,0 M27,22 q5,-5 10,0 t10,0" fill="none" stroke="#3f6f86" stroke-width="1.6" opacity=".55" stroke-linecap="round"/></pattern>')
    add('</defs>')

    # ------------------------------------------------ page background (parchment)
    add(f'<rect width="{W}" height="{H}" fill="#e9d6ab"/>')
    add(f'<rect width="{W}" height="{H}" filter="url(#stains)" opacity=".55"/>')
    add(f'<rect width="{W}" height="{H}" filter="url(#fibres)" opacity=".35"/>')
    add(f'<rect width="{W}" height="{H}" filter="url(#grain)" opacity=".55"/>')
    add(f'<rect width="{W}" height="{H}" fill="url(#vign)"/>')

    build_header()
    # ------------------------------------------------ map
    add(f'<g transform="translate({MX},{MY})">')
    add(f'<rect x="-14" y="-14" width="{MW + 28}" height="{MH + 28}" fill="none" stroke="#3a2a1a" stroke-width="3"/>')
    add(f'<rect x="-8" y="-8" width="{MW + 16}" height="{MH + 16}" fill="none" stroke="#3a2a1a" stroke-width="1.2"/>')
    add('<g clip-path="url(#mapclip)">')
    add(f'<rect width="{MW}" height="{MH}" fill="#efdfb8"/>')
    add(f'<rect width="{MW}" height="{MH}" filter="url(#stains)" opacity=".45"/>')
    add(f'<rect width="{MW}" height="{MH}" fill="url(#hatch)"/>')
    # cleared land inside the blue line: lighter meadow wash
    add(f'<path d="{catmull(TP(BLUE_POLY), True)}" fill="#f5ead0" opacity=".75" filter="url(#wcedge)"/>')
    draw_terrain(rnd)
    draw_zones()
    draw_paths()
    draw_buildings()
    draw_labels()
    draw_compass(150, 1395)
    add(f'<rect width="{MW}" height="{MH}" fill="url(#mapvign)" pointer-events="none"/>')
    add(f'<rect width="{MW}" height="{MH}" filter="url(#grain)" opacity=".35"/>')
    add('</g>')   # clip
    add('</g>')   # map translate
    build_legend(LEG_Y, H)
    add('</svg>')
    return H

def build_header():
    cx = W / 2
    # ribbon tails
    add(f'<g filter="url(#rough)">')
    for sgn in (-1, 1):
        x0 = cx + sgn * 560
        x1 = cx + sgn * 680
        add(f'<path d="M{x0:.0f},70 L{x1:.0f},70 L{x1 - sgn * 34:.0f},112 L{x1:.0f},154 L{x0:.0f},154 Z" fill="url(#ribbonDark)" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>')
        add(f'<path d="M{cx + sgn * 560:.0f},154 L{cx + sgn * 600:.0f},178 L{cx + sgn * 600:.0f},154 Z" fill="#7d5a2c" stroke="{INK}" stroke-width="2" stroke-linejoin="round"/>')
    add(f'<path d="M{cx - 600},34 Q{cx},20 {cx + 600},34 L{cx + 600},154 Q{cx},140 {cx - 600},154 Z" fill="url(#ribbon)" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>')
    add(f'<path d="M{cx - 584},46 Q{cx},33 {cx + 584},46 L{cx + 584},142 Q{cx},129 {cx - 584},142 Z" fill="none" stroke="#8a6a3a" stroke-width="1.4"/>')
    add('</g>')
    add(f'<text x="{cx}" y="112" font-family="{F_SERIF}" font-weight="700" font-size="70" text-anchor="middle" fill="#3a2212" letter-spacing="1">Neues Dorf – Masterplan</text>')
    # little ornaments
    for sgn in (-1, 1):
        x = cx + sgn * 530
        add(f'<g transform="translate({x},92)"><path d="M0,-14 L6,0 L0,14 L-6,0 Z" fill="#b8322a" stroke="{INK}" stroke-width="1.6"/><circle r="2.5" fill="#f3d27a"/></g>')
    add(f'<text x="{cx}" y="{MY - 30}" font-family="{F_SERIF}" font-style="italic" font-size="27" text-anchor="middle" fill="#4a3220">'
        f'Das neue Dorf entsteht innerhalb der blauen Linie – südlich der Straße. Norden ist oben.</text>')

def draw_terrain(rnd):
    # forest wash + trees (only outside the blue line)
    trees = [p for p in forest_points() if not any(b[0] <= p[0] <= b[2] and b[1] <= p[1] <= b[3] for b in TREE_FREE)]
    tm = [T(p) for p in trees]
    add('<g filter="url(#soft)" opacity=".5">')
    for x, y in tm:
        add(f'<circle cx="{x:.0f}" cy="{y - 12:.0f}" r="34" fill="#a3ad72"/>')
    add('</g>')
    # grass tufts in open land (outside the blue line, not in forest)
    gr = random.Random(5)
    img = Image.open(PHOTO).convert("L")
    bl = np.asarray(img.filter(ImageFilter.GaussianBlur(14))).astype(int)
    add('<g stroke="#7d8a4c" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".55">')
    n = 0
    while n < 140:
        x = gr.uniform(CX0 + 5, CX1 - 5); y = gr.uniform(CY0 + 5, CY1 - 5)
        if bl[int(y), int(x)] < 165: continue
        if pip((x, y), BLUE_POLY) or line_dist((x, y), BLUE1) < 18 or line_dist((x, y), BLUE2) < 18: continue
        if pip((x, y), LAKE) or line_dist((x, y), LAKE + [LAKE[0]]) < 14: continue
        if line_dist((x, y), ROAD_MAIN) < 24: continue
        if min(line_dist((x, y), r) for r in (ROAD_TOP, ROAD_WEST, ROAD_SOUTH, ROAD_LEFT, PATH_THIN, OLD_VILLAGE_PATH) + tuple(NORTH_PATHS)) < 16: continue
        if ((x - 1265) / 195) ** 2 + ((y - 655) / 200) ** 2 < 1: continue
        if any(b[0] <= x <= b[2] and b[1] <= y <= b[3] for b in TREE_FREE): continue
        if x < 330 and y > 1330: continue   # compass
        mx, my = T((x, y))
        s = gr.uniform(0.8, 1.2)
        add(f'<path transform="translate({mx:.1f},{my:.1f}) scale({s:.2f})" d="M-6,0 q1,-5 -1,-8 M-1,0 q0,-7 1,-11 M4,0 q1,-5 4,-7"/>')
        n += 1
    add('</g>')
    # lake
    lake_d = catmull(TP(LAKE), True)
    add(f'<path d="{lake_d}" fill="none" stroke="#6f9fb2" stroke-width="22" opacity=".25" filter="url(#soft3)"/>')
    add(f'<path d="{lake_d}" fill="url(#lakeg)" filter="url(#wc)"/>')
    add(f'<path d="{lake_d}" fill="url(#waves)"/>')
    add(f'<path d="{lake_d}" fill="none" stroke="#3d6378" stroke-width="2.6" filter="url(#rough)"/>')
    # shoreline echo lines (classic map style)
    # roads ---------------------------------------------------------
    add('<g filter="url(#rough)">')
    for r in (ROAD_TOP, ROAD_WEST, ROAD_SOUTH, ROAD_LEFT):
        d = catmull(TP(r))
        add(f'<path d="{d}" fill="none" stroke="#4a3320" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>')
        add(f'<path d="{d}" fill="none" stroke="#7d5c3a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>')
    for r in NORTH_PATHS:
        d = catmull(TP(r))
        add(f'<path d="{d}" fill="none" stroke="#5a4028" stroke-width="7" stroke-linecap="round" opacity=".55"/>')
    d = catmull(TP(PATH_THIN))
    add(f'<path d="{d}" fill="none" stroke="#5a4028" stroke-width="6" stroke-linecap="round" stroke-dasharray="14 7" opacity=".85"/>')
    d = catmull(TP(ROAD_MAIN))
    add(f'<path d="{d}" fill="none" stroke="#3a2a1a" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>')
    add(f'<path d="{d}" fill="none" stroke="#fbf4df" stroke-width="23" stroke-linecap="round" stroke-linejoin="round"/>')
    add(f'<path d="{d}" fill="none" stroke="#d8c39a" stroke-width="2" stroke-dasharray="18 14" stroke-linecap="round"/>')
    add('</g>')
    # trees on top of roads' neighbourhood
    order = sorted(range(len(tm)), key=lambda i: tm[i][1])
    add('<g>')
    for i in order:
        x, y = tm[i]
        k = rnd.random()
        g = "t-a" if k < 0.5 else ("t-c" if k < 0.82 else "t-b")
        s = 0.95 + rnd.random() * 0.3
        add(f'<use href="#{g}" transform="translate({x:.1f},{y:.1f}) scale({s:.2f})"/>')
    add('</g>')
    # old village (faint)
    cx, cy = T(OLD_VILLAGE_C)
    add(f'<ellipse cx="{cx:.0f}" cy="{cy:.0f}" rx="{OLD_VILLAGE_R[0] * S:.0f}" ry="{OLD_VILLAGE_R[1] * S:.0f}" fill="#efe2c2" opacity=".55" filter="url(#soft)"/>')
    add(f'<ellipse cx="{cx:.0f}" cy="{cy:.0f}" rx="{OLD_VILLAGE_R[0] * S:.0f}" ry="{OLD_VILLAGE_R[1] * S:.0f}" fill="none" stroke="#a8473a" stroke-width="4" stroke-dasharray="16 10" opacity=".6" filter="url(#rough)"/>')
    vr = random.Random(12)
    vh = []
    for gx in range(1150, 1400, 34):
        for gy in range(560, 820, 34):
            x = gx + vr.uniform(-8, 8); y = gy + vr.uniform(-8, 8)
            if ((x - 1268) / 128) ** 2 + ((y - 680) / 128) ** 2 < 1 and not (1190 < x < 1340 and 640 < y < 705) and not (1150 < x < 1345 and 785 < y < 845):
                vh.append((x, y))
    vh.sort(key=lambda p: p[1])
    add('<g opacity=".5">')
    for x, y in vh:
        mx, my = T((x, y))
        g = "house" if vr.random() < 0.55 else "tent"
        add(f'<use href="#g-{g}" transform="translate({mx:.1f},{my:.1f}) scale(.72)"/>')
    add('</g>')
    # path to the old village + arrow
    pts = TP(OLD_VILLAGE_PATH)
    add(f'<path d="{catmull(pts)}" fill="none" stroke="#5a4028" stroke-width="7" stroke-linecap="round" stroke-dasharray="12 7"/>')
    ax, ay = pts[-1]; bx, by = pts[-2]
    ang = math.degrees(math.atan2(ay - by, ax - bx))
    add(f'<path d="M0,0 L-24,-12 L-18,0 L-24,12 Z" transform="translate({ax:.1f},{ay:.1f}) rotate({ang:.1f})" fill="#5a4028" stroke="{INK}" stroke-width="1.5"/>')
    # blue boundary line (as drawn by the user)
    for line in (BLUE1, BLUE2):
        d = catmull(TP(line))
        add(f'<path d="{d}" fill="none" stroke="#f8f1dc" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>')
        add(f'<path d="{d}" fill="none" stroke="#3a6fd6" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" opacity=".92" filter="url(#rough)"/>')

def zone_path(pts):
    return poly_d(chaikin(TP(pts), 3, True))

def draw_zones():
    for key in ("feld", "ernte", "kern", "wohn", "werk", "spaet", "vieh"):
        z = ZONES[key]
        d = zone_path(z["pts"])
        add(f'<path d="{d}" fill="{z["col"]}" opacity="{ZONE_OP}" filter="url(#wc)"/>')
        add(f'<path d="{d}" fill="none" stroke="{z["col"]}" stroke-width="9" opacity=".55" filter="url(#wcedge)"/>')
        if key == "feld":
            draw_fields()
        add(f'<path d="{d}" fill="none" stroke="#3a2a1a" stroke-width="2.4" stroke-dasharray="12 5 3 5" opacity=".85" filter="url(#rough)"/>')
    # kitchen block
    d = zone_path(KITCHEN)
    add(f'<path d="{d}" fill="{KITCHEN_COL}" opacity="{KITCHEN_OP}" filter="url(#wc)"/>')
    add(f'<path d="{d}" fill="none" stroke="#7a2a12" stroke-width="2.4" opacity=".9" filter="url(#rough)"/>')

def field_plots():
    poly = ZONES["feld"]["pts"]
    (va, vb), (h1a, h1b), (h2a, h2b) = DIV_V, DIV_H1, DIV_H2
    # screen coords (y down): for a downward line "left" is east, for a rightward line "left" is south
    west = clip_half(poly, va, vb, keep_left=False)
    east = clip_half(poly, va, vb, keep_left=True)
    def cx(P): return sum(p[0] for p in P) / len(P)
    if cx(west) > cx(east): west, east = east, west
    plots = {}
    for side, P in (("W", west), ("E", east)):
        A = clip_half(P, h1a, h1b, keep_left=True)
        Bq = clip_half(P, h1a, h1b, keep_left=False)
        top, rest = (A, Bq) if sum(p[1] for p in A) / len(A) < sum(p[1] for p in Bq) / len(Bq) else (Bq, A)
        A = clip_half(rest, h2a, h2b, keep_left=True)
        Bq = clip_half(rest, h2a, h2b, keep_left=False)
        mid, bot = (A, Bq) if sum(p[1] for p in A) / len(A) < sum(p[1] for p in Bq) / len(Bq) else (Bq, A)
        plots[side + "top"], plots[side + "mid"], plots[side + "bot"] = top, mid, bot
    return plots

def draw_fields():
    plots = field_plots()
    fill = {"Wtop": "rowsA", "Etop": "rowsC", "Wmid": "rowsD", "Emid": "rowsB", "Ebot": "rowsA"}
    for k, P in plots.items():
        if len(P) < 3: continue
        d = poly_d(chaikin(TP(P), 2, True))
        if k == "Wbot":
            add(f'<path d="{d}" fill="#f2e7c4" opacity=".55"/>')
            continue
        add(f'<path d="{d}" fill="url(#{fill[k]})" opacity=".9" filter="url(#rough)"/>')

def draw_paths():
    poly = ZONES["feld"]["pts"]
    # field paths (thin)
    add('<g filter="url(#rough)">')
    for a, b in (DIV_V, DIV_H1, DIV_H2):
        for s0, s1 in clip_line_to_poly(a, b, poly):
            p0, p1 = T(s0), T(s1)
            d = f"M{p0[0]:.1f},{p0[1]:.1f} L{p1[0]:.1f},{p1[1]:.1f}"
            add(f'<path d="{d}" fill="none" stroke="#7a5a32" stroke-width="9" stroke-linecap="round" opacity=".55"/>')
            add(f'<path d="{d}" fill="none" stroke="#f3e5bd" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="10 5"/>')
    # main paths (wide, cobbled)
    for pth in MAIN_PATHS:
        d = catmull(TP(pth))
        add(f'<path d="{d}" fill="none" stroke="#6a4a2a" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>')
        add(f'<path d="{d}" fill="none" stroke="#f1dfb0" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>')
        add(f'<path d="{d}" fill="none" stroke="#9c7a4a" stroke-width="5" stroke-linecap="round" stroke-dasharray="0.1 8.5" opacity=".9"/>')
    add('</g>')

GLYPH_BOXES = []
COLL = []   # collision items: (kind, tag, number, polygon[4]) in map px
def rect_poly(x0, y0, x1, y1): return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
def obb(cx, cy, w, h, rot, dx=0.0, dy=0.0):
    """oriented box of w x h whose centre is (dx,dy) in the rotated frame anchored at (cx,cy)."""
    a = math.radians(rot); ca, sa = math.cos(a), math.sin(a)
    pts = []
    for px, py in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        px += dx; py += dy
        pts.append((cx + px * ca - py * sa, cy + px * sa + py * ca))
    return pts

FENCES = [[(818,1312),(818,1340),(880,1342),(884,1316)]]
def draw_fences():
    for f in FENCES:
        pts = TP(f)
        d = poly_d(pts, closed=False)
        add(f'<path d="{d}" fill="none" stroke="#6a4a2a" stroke-width="2.4" stroke-linejoin="round"/>')
        add(f'<path d="{d}" fill="none" stroke="#6a4a2a" stroke-width="1.4" transform="translate(0,-6)"/>')
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            L = math.hypot(x2 - x1, y2 - y1); n = max(1, int(L // 14))
            for i in range(n + 1):
                x = x1 + (x2 - x1) * i / n; y = y1 + (y2 - y1) * i / n
                add(f'<path d="M{x:.1f},{y + 2:.1f} V{y - 10:.1f}" stroke="{INK}" stroke-width="2.2" stroke-linecap="round"/>')
    for p in [(838,1330),(858,1334),(848,1324)]:
        x, y = T(p)
        add(f'<g transform="translate({x:.1f},{y:.1f}) scale(.9)"><ellipse cx="0" cy="-4" rx="5" ry="4" fill="#fbf6ea" stroke="{INK}" stroke-width="1.1"/>'
            f'<circle cx="4" cy="-8" r="2.4" fill="#fbf6ea" stroke="{INK}" stroke-width="1"/><path d="M6,-8 l2,.8 l-2,.8" fill="#e0a030"/></g>')

def draw_buildings():
    draw_fences()
    items = sorted(B, key=lambda b: T(b["p"])[1])
    for b in items:
        x, y = T(b["p"])
        s = b["s"]
        x0, y0, x1, y1 = BOX[b["g"]]
        add(f'<ellipse cx="{x:.1f}" cy="{y + 1:.1f}" rx="{(x1 - x0) * s * 0.5:.1f}" ry="{5 * s:.1f}" fill="#3a2a1a" opacity=".2"/>')
        add(f'<use href="#g-{b["g"]}" transform="translate({x:.1f},{y:.1f}) scale({s})"/>')
        COLL.append(("glyph", b["g"], b["n"], rect_poly(x + x0 * s, y + y0 * s, x + x1 * s, y + y1 * s)))
    for b in items:
        if not b["n"]: continue
        bx, by = T(b["bp"])
        badge(bx, by, b["n"])
        COLL.append(("badge", f"#{b['n']}", b["n"], rect_poly(bx - 20, by - 20, bx + 20, by + 20)))

def label_group(key, p, size, rot, step):
    z = ZONES[key]
    x, y = T(p)
    plain = z.get("plain", z["name"])
    w = text_w(plain, "serif", 700, size)
    r = 21 if size < 34 else 24
    gap = 8
    total = (2 * r + gap if step else 0) + w
    add(f'<g transform="translate({x:.1f},{y:.1f}) rotate({rot})">')
    tx = -total / 2 + (2 * r + gap if step else 0)
    base = size * 0.34
    add(f'<text x="{tx:.1f}" y="{base:.1f}" font-family="{F_SERIF}" font-weight="700" font-size="{size}" fill="{INK}" '
        f'stroke="#f6ecd2" stroke-width="8" stroke-linejoin="round" paint-order="stroke">{z["name"]}</text>')
    if step:
        bx = -total / 2 + r
        add(f'<circle cx="{bx:.1f}" cy="1.5" r="{r + 1.5}" fill="#2a1c10" opacity=".3"/>'
            f'<circle cx="{bx:.1f}" cy="0" r="{r}" fill="url(#gold)" stroke="#3a2410" stroke-width="2.6"/>'
            f'<circle cx="{bx:.1f}" cy="0" r="{r - 4.5}" fill="none" stroke="#fff3c4" stroke-width="1.2" opacity=".8"/>'
            f'<text x="{bx:.1f}" y="{r * 0.45:.1f}" font-family="{F_SERIF}" font-weight="700" font-size="{int(r * 1.3)}" text-anchor="middle" fill="#2a1608" transform="rotate({-rot} {bx:.1f} 0)">{step}</text>')
    add('</g>')
    h = max(size * 0.95, 2 * r if step else 0)
    COLL.append(("label", plain, None, obb(x, y, total, h, rot)))

def plain_label(p, s, size, wt=700, italic=False, fill=INK, anchor="middle", hw=6, tag=None, rot=0):
    x, y = T(p)
    fam_key = ("i" if wt == 400 else "bi") if italic else wt
    w = text_w(re.sub(r"<[^>]+>", " ", s).replace("&amp;", "&").replace("  ", " "), "serif", fam_key, size)
    halo_text(x, y, s, size, wt=wt, italic=italic, fill=fill, hw=hw, anchor=anchor, rot=rot)
    cx = x if anchor == "middle" else x + w / 2
    COLL.append(("label", tag or s, None, obb(cx, y - size * 0.3, w, size * 0.9, rot)))

def draw_labels():
    for key, p, size, rot, step in ZLABEL:
        label_group(key, p, size, rot, step)
    plain_label((848,931), "Küche", 26, fill="#5a1a08")
    plain_label((1020,1172), 'Schmelze<tspan font-style="normal" dx="7">·</tspan><tspan dx="7">Bibliothek</tspan>', 26, wt=400, italic=True, tag="note")
    plain_label((395,1140), "Reserve", 28, italic=True, fill="#3d5a1e")
    plain_label((1262,668), "Altes Dorf", 40, italic=True, fill="#5a2a1e", hw=8)
    plain_label((1158,812), "Weg zum alten Dorf", 27, italic=True, fill="#4a3320", anchor="start")

def draw_compass(x, y, r=78):
    add(f'<g transform="translate({x},{y})">')
    add(f'<circle r="{r + 18}" fill="#f3e6c6" opacity=".85" filter="url(#soft3)"/>')
    add(f'<circle r="{r}" fill="none" stroke="{INK}" stroke-width="2.2"/>')
    add(f'<circle r="{r - 7}" fill="none" stroke="{INK}" stroke-width="1"/>')
    for a in range(0, 360, 15):
        L = 9 if a % 45 == 0 else 5
        ra = math.radians(a)
        add(f'<path d="M{math.sin(ra) * (r - 7):.1f},{-math.cos(ra) * (r - 7):.1f} L{math.sin(ra) * (r - 7 - L):.1f},{-math.cos(ra) * (r - 7 - L):.1f}" stroke="{INK}" stroke-width="1.2"/>')
    # 8-point star
    for a in range(45, 360, 90):
        ra = math.radians(a)
        tip = (math.sin(ra) * (r - 26), -math.cos(ra) * (r - 26))
        l = (math.sin(ra - math.pi / 2) * 8, -math.cos(ra - math.pi / 2) * 8)
        add(f'<path d="M{tip[0]:.1f},{tip[1]:.1f} L{l[0]:.1f},{l[1]:.1f} L{-l[0]:.1f},{-l[1]:.1f} Z" fill="#c9b07a" stroke="{INK}" stroke-width="1.3"/>')
    for a in range(0, 360, 90):
        ra = math.radians(a)
        tip = (math.sin(ra) * (r - 6), -math.cos(ra) * (r - 6))
        l = (math.sin(ra - math.pi / 2) * 12, -math.cos(ra - math.pi / 2) * 12)
        dark = "#3a2a1a" if a == 0 else "#7a5a32"
        add(f'<path d="M{tip[0]:.1f},{tip[1]:.1f} L{l[0]:.1f},{l[1]:.1f} L0,0 Z" fill="{dark}" stroke="{INK}" stroke-width="1.3"/>')
        add(f'<path d="M{tip[0]:.1f},{tip[1]:.1f} L{-l[0]:.1f},{-l[1]:.1f} L0,0 Z" fill="#f3e6c6" stroke="{INK}" stroke-width="1.3"/>')
    add(f'<circle r="5" fill="#d9a441" stroke="{INK}" stroke-width="1.5"/>')
    add('</g>')
    halo_text(x, y - r - 12, "N", 34, hw=6)

# ----------------------------------------------------------------- legend
def swatch(x, y, col, w=58, h=36, op=0.5, kitchen=False):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="#f3e6c8"/>')
    if kitchen:
        add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{ZONES["kern"]["col"]}" opacity="{op}"/>')
        col, op = KITCHEN_COL, KITCHEN_OP
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{col}" opacity="{op}"/>')
    add(f'<rect x="{x + 2.5}" y="{y + 2.5}" width="{w - 5}" height="{h - 5}" rx="3" fill="none" stroke="{col}" stroke-width="4" opacity=".45"/>')
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="none" stroke="#f6e7c0" stroke-width="2"/>')

def legend_height():
    return 64 + 30 + 4 * 84 + 52 + 26 + 13 * 50 + 46 + 24 + 5 * 50 + 22 + 30 + 44 + 30

def build_legend(Y, H):
    X0, X1 = MX - 14, MX + MW + 14
    add(f'<g filter="url(#roughbig)"><rect x="{X0}" y="{Y}" width="{X1 - X0}" height="{H - Y - 30}" rx="10" fill="#2e2117" stroke="#c9a468" stroke-width="3"/></g>')
    add(f'<rect x="{X0}" y="{Y}" width="{X1 - X0}" height="{H - Y - 30}" rx="10" filter="url(#stains)" opacity=".25"/>')
    add(f'<rect x="{X0 + 10}" y="{Y + 10}" width="{X1 - X0 - 20}" height="{H - Y - 50}" rx="6" fill="none" stroke="#8a6a3a" stroke-width="1.2"/>')
    LT = "#f3e6c6"; GOLD = "#e2b04a"; DIM = "#cdb894"
    def head(x, y, s):
        add(f'<text x="{x}" y="{y}" font-family="{F_SERIF}" font-weight="700" font-size="36" fill="{GOLD}" letter-spacing="0.5">{s}</text>')
    def txt(x, y, s, size=25, fill=LT, wt=400, fam=F_SANS):
        add(f'<text x="{x}" y="{y}" font-family="{fam}" font-weight="{wt}" font-size="{size}" fill="{fill}">{s}</text>')
    pad = 56
    xL = X0 + pad; xR = (X0 + X1) / 2 + 20
    y = Y + 64
    head(xL, y, "Bereiche (Farbe = Fläche im Plan)")
    zones_leg = [
        ("kern", "Dorfkern", "Rathaus + Forschungstisch, Vorratslager, Brunnen"),
        (None, "Küche", "Kochstellen + Essenslager, zum Ernte-Hof hin"),
        ("wohn", "Wohnen", "Wohnhäuser / Wohnzelte, Brunnen, Plumpsklo am Rand"),
        ("ernte", "Ernte-Hof", "schon gerodet: Dreschhaus, Scheunen, Kompost"),
        ("feld", "Felder &amp; Bauernhöfe", "6 Feldstücke: 5 Bauernhöfe + 1 Reserve"),
        ("werk", "Werkstätten", "Säge, Werkzeug, Weberei, Werkbänke, Mischkübel"),
        ("spaet", "Platz für später", "frei lassen: Schmelze · Bibliothek"),
        ("vieh", "Ställe &amp; Vieh", "Geflügel, Metzgerei, Gerber, Räuchergestelle"),
    ]
    y0 = y + 30
    for i, (k, name, desc) in enumerate(zones_leg):
        col_i, row = i % 2, i // 2
        x = xL + col_i * (xR - xL)
        yy = y0 + row * 84
        if k: swatch(x, yy, ZONES[k]["col"], op=ZONE_OP)
        else: swatch(x, yy, KITCHEN_COL, op=ZONE_OP, kitchen=True)
        txt(x + 76, yy + 22, name, 28, LT, 700, F_SERIF)
        txt(x + 76, yy + 56, desc, 24, DIM)
    y = y0 + 4 * 84 + 52
    head(xL, y, "Gebäude (Nummern im Plan)")
    names = [
        ("rathaus", "Rathaus + Forschungstisch"), ("fire_pot", "Küche (Kochstellen)"), ("barrels", "Essenslager (neben der Küche)"),
        ("crates", "Vorratslager (2×)"), ("well", "Brunnen (2×)"), ("house", "Wohnhäuser / Wohnzelte"),
        ("latrine", "Plumpsklo (Rand, weg von der Küche)"), ("thresh", "Dreschhaus"), ("barn", "Scheunen (3×)"),
        ("compost", "Komposthaufen"), ("farm", "Bauernhof (5×, je Feldstück einer)"), ("sawpit", "Sägegrube + Holzfällerplatz"),
        ("toolmaker", "Werkzeugmacher"), ("loom", "Webstuhl + Webertisch"), ("bench", "Werkbänke + Handwerkerecke"),
        ("tub", "Mischkübel"), ("coop", "Geflügelstall"), ("butcher", "Metzgerei"),
        ("tanner", "Gerber (direkt neben der Metzgerei)"), ("smoke", "Räuchergestelle (2×)"), ("fisher", "Fischerlager (am Ufer)"),
        ("lumber", "Holzfäller + Förster (Wald im Norden)"), ("gatherer", "Sammlerhütte (Wald im Norden)"),
        ("muster", "Aufmarschplatz + Waffenständer"), ("cart", "Kleine Karawanenstation"),
    ]
    half = 13
    y1 = y + 26
    for i, (g, name) in enumerate(names):
        col_i = 0 if i < half else 1
        row = i if i < half else i - half
        x = xL + col_i * (xR - xL)
        yy = y1 + row * 50
        # icon plate
        add(f'<rect x="{x}" y="{yy}" width="64" height="44" rx="6" fill="#efdfb8"/>')
        x0, y0b, x1b, y1b = BOX[g]
        sc = min(56 / (x1b - x0), 38 / (y1b - y0b), 1.0)
        cxg = x + 32 - (x0 + x1b) / 2 * sc
        add(f'<use href="#g-{g}" transform="translate({cxg:.1f},{yy + 41 - y1b * sc:.1f}) scale({sc:.2f})"/>')
        bx = x + 96
        add(f'<circle cx="{bx}" cy="{yy + 22}" r="19.5" fill="#fbf3dc" stroke="#c9a468" stroke-width="2"/>')
        add(f'<text x="{bx}" y="{yy + 30.5}" font-family="{F_SANS}" font-weight="700" font-size="24" text-anchor="middle" fill="#2a1c10" letter-spacing="-1">{i + 1}</text>')
        txt(bx + 32, yy + 31, name, 25, LT)
    y = y1 + half * 50 + 46
    # bottom row: Wege (left) | Umzug in Schritten (right)
    head(xL, y, "Wege &amp; Grenzen")
    head(xR, y, "Umzug in Schritten")
    yy = y + 24
    rows = [
        ("main", "Hauptwege zwischen den Bereichen"),
        ("field", "Feldwege – teilen die Felder in 6 Stücke"),
        ("road", "Helle Hauptstraße (Bestand)"),
        ("dark", "Dunkle Wege (Bestand)"),
        ("blue", "Blaue Linie = Gebiet für das neue Dorf"),
    ]
    for i, (k, name) in enumerate(rows):
        cy = yy + 22 + i * 50
        x = xL
        add(f'<rect x="{x}" y="{cy - 20}" width="96" height="40" rx="5" fill="#efdfb8"/>')
        a, b = x + 12, x + 84
        if k == "main":
            add(f'<path d="M{a},{cy} H{b}" stroke="#6a4a2a" stroke-width="17" stroke-linecap="round" opacity=".55"/>')
            add(f'<path d="M{a},{cy} H{b}" stroke="#f1dfb0" stroke-width="13" stroke-linecap="round"/>')
            add(f'<path d="M{a},{cy} H{b}" stroke="#9c7a4a" stroke-width="5" stroke-linecap="round" stroke-dasharray="0.1 8.5"/>')
        elif k == "field":
            add(f'<rect x="{x + 4}" y="{cy - 16}" width="88" height="32" fill="#7fa64c" opacity=".5"/>')
            add(f'<path d="M{a},{cy} H{b}" stroke="#7a5a32" stroke-width="9" stroke-linecap="round" opacity=".55"/>')
            add(f'<path d="M{a},{cy} H{b}" stroke="#f3e5bd" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="10 5"/>')
        elif k == "road":
            add(f'<path d="M{a},{cy} H{b}" stroke="#3a2a1a" stroke-width="30" stroke-linecap="butt"/>')
            add(f'<path d="M{a},{cy} H{b}" stroke="#fbf4df" stroke-width="23" stroke-linecap="butt"/>')
        elif k == "dark":
            add(f'<path d="M{a},{cy} H{b}" stroke="#4a3320" stroke-width="15" stroke-linecap="round"/>')
            add(f'<path d="M{a},{cy} H{b}" stroke="#7d5c3a" stroke-width="9" stroke-linecap="round"/>')
        elif k == "blue":
            add(f'<path d="M{a},{cy} H{b}" stroke="#3a6fd6" stroke-width="7.5" stroke-linecap="round"/>')
        txt(x + 116, cy + 9, name, 25, LT)
    steps = [("1", "Dorfkern", "Küche, Essenslager, Vorratslager, Brunnen zuerst"),
             ("2", "Wohnen", ""), ("3", "Ernte-Hof + Felder", ""), ("4", "Werkstätten", ""), ("5", "Ställe &amp; Vieh", "")]
    for i, (n, name, extra) in enumerate(steps):
        cy = yy + 22 + i * 50
        x = xR
        add(f'<circle cx="{x + 22}" cy="{cy}" r="21" fill="url(#gold)" stroke="#f3e6c6" stroke-width="2"/>')
        add(f'<text x="{x + 22}" y="{cy + 10}" font-family="{F_SERIF}" font-weight="700" font-size="29" text-anchor="middle" fill="#2a1608">{n}</text>')
        if extra:
            add(f'<text x="{x + 58}" y="{cy + 9}" font-family="{F_SANS}" font-size="25" fill="{LT}"><tspan font-weight="700">{name}</tspan><tspan fill="{DIM}"> – {extra}</tspan></text>')
        else:
            txt(x + 58, cy + 9, name, 25, LT, 700)
    cy = yy + 22 + 5 * 50
    add(f'<circle cx="{xL + 22}" cy="{cy}" r="21" fill="url(#gold)" stroke="#f3e6c6" stroke-width="2"/>')
    add(f'<text x="{xL + 22}" y="{cy + 10}" font-family="{F_SERIF}" font-weight="700" font-size="29" text-anchor="middle" fill="#2a1608">1</text>')
    add(f'<circle cx="{xL + 74}" cy="{cy}" r="19.5" fill="#fbf3dc" stroke="#c9a468" stroke-width="2"/>')
    add(f'<text x="{xL + 74}" y="{cy + 8.5}" font-family="{F_SANS}" font-weight="700" font-size="24" text-anchor="middle" fill="#2a1c10">1</text>')
    add(f'<text x="{xL + 116}" y="{cy + 9}" font-family="{F_SANS}" font-size="25" fill="{LT}">Gold = Umzugs-Schritt · hell = Gebäude-Nummer</text>')
    add(f'<path d="M{xR + 6},{cy} h32 m-10,-9 l10,9 l-10,9" stroke="{GOLD}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    txt(xR + 58, cy + 9, "danach altes Dorf abbauen", 25, LT, 700)
    return

if __name__ == "__main__":
    H = build_svg()
    svg = "\n".join(out)
    open(OUT, "w").write(svg)
    # overlap report (SAT on convex quads)
    def proj(poly, ax):
        v = [p[0] * ax[0] + p[1] * ax[1] for p in poly]; return min(v), max(v)
    def hit(A, Bp, m=1.0):
        for P in (A, Bp):
            for i in range(len(P)):
                x1, y1 = P[i]; x2, y2 = P[(i + 1) % len(P)]
                ax = (y1 - y2, x2 - x1); L = math.hypot(*ax) or 1; ax = (ax[0] / L, ax[1] / L)
                a0, a1 = proj(A, ax); b0, b1 = proj(Bp, ax)
                if a1 <= b0 + m or b1 <= a0 + m: return False
        return True
    n_bad = 0
    for i in range(len(COLL)):
        for j in range(i + 1, len(COLL)):
            ki, ti, ni, pi_ = COLL[i]; kj, tj, nj, pj = COLL[j]
            if ki == "glyph" and kj == "glyph":
                pass
            if ni is not None and ni == nj: continue          # badge on its own glyph
            if hit(pi_, pj):
                n_bad += 1
                print("overlap", ki, ti, "<->", kj, tj)
    print("overlaps:", n_bad)
    print("svg", OUT, W, H, len(svg) // 1024, "KB")

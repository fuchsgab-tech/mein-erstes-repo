import sys, math
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
orig = Image.open(src).convert("RGBA")
CX0, CY0, CX1, CY1, S = 100, 430, 1480, 1530, 1.4
crop = orig.crop((CX0, CY0, CX1, CY1)); crop = crop.resize((int(crop.width*S), int(crop.height*S)), Image.LANCZOS)
MW, MH = crop.size; PANEL = 1180
canvas = Image.new("RGBA", (MW, MH+PANEL), (22,16,11,255)); canvas.paste(crop, (0,0))
T = lambda p: ((p[0]-CX0)*S, (p[1]-CY0)*S)
TP = lambda pts: [T(p) for p in pts]
fill = Image.new("RGBA", canvas.size, (0,0,0,0)); fd = ImageDraw.Draw(fill)
top = Image.new("RGBA", canvas.size, (0,0,0,0)); td = ImageDraw.Draw(top)
B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"; R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
fz, fm, fs, fb = ImageFont.truetype(B, 36), ImageFont.truetype(B, 26), ImageFont.truetype(B, 24), ImageFont.truetype(B, 21)
fh, fp, fpb, fn = ImageFont.truetype(B, 40), ImageFont.truetype(R, 25), ImageFont.truetype(B, 27), ImageFont.truetype(B, 34)
WHITE, INK, GOLD, PAPER = (255,255,255,255), (20,15,10,255), (217,164,65,255), (240,230,210,255)
def txt(d, xy, s, f, col=WHITE, sw=5): d.text(xy, s, font=f, fill=col, stroke_width=sw, stroke_fill=INK)
def dashed(d, pts, width=12, dash=28, gap=14, col=(245,232,200,255), edge=(60,40,20,255)):
    segs=[]
    for (x1,y1),(x2,y2) in zip(pts, pts[1:]):
        L=math.hypot(x2-x1,y2-y1); t=0
        while t<L:
            a=t/L; b=min(L,t+dash)/L
            segs.append(((x1+(x2-x1)*a, y1+(y2-y1)*a),(x1+(x2-x1)*b, y1+(y2-y1)*b))); t+=dash+gap
    for s_ in segs: d.line(s_, fill=edge, width=width+6)
    for s_ in segs: d.line(s_, fill=col, width=width)
Z = [
 ("kern","Dorfkern",(235,150,35),[(805,905),(985,880),(1030,985),(870,1020),(800,975)],(888,900),(985,895)),
 ("wohn","Wohnen",(185,55,45),[(995,935),(1165,945),(1190,1010),(1075,1080),(1025,1000)],(1018,937),(1188,975)),
 ("ernte","Ernte-Hof",(140,70,175),[(752,845),(822,885),(800,1000),(705,1150),(600,1232),(462,1282),(445,1258),(520,1170),(640,1015),(725,880)],(585,1125),(462,1262)),
 ("feld","Felder & Bauernhöfe",(95,160,55),[(185,815),(545,610),(735,795),(715,860),(630,1000),(505,1160),(430,1240),(390,1200),(295,1130),(225,975)],(205,880),(545,635)),
 ("werk","Werkstätten",(55,110,175),[(725,1040),(880,1030),(925,1215),(765,1245),(690,1160)],(735,1095),(885,1045)),
 ("vieh","Ställe & Vieh",(150,100,45),[(790,1265),(995,1240),(1090,1370),(950,1455),(835,1375)],(840,1405),(1000,1255)),
 ("spaet","Platz für später",(130,130,130),[(950,1095),(1100,1085),(1120,1225),(990,1250),(940,1190)],(955,1105),None),
]
STEP = {"kern":1,"wohn":2,"ernte":3,"feld":3,"werk":4,"vieh":5}
for k,n,c,poly,lab,num in Z: fd.polygon(TP(poly), fill=c+(100,))
# kitchen block at the west edge of the core (short way to the Ernte-Hof)
kitchen = [(806,912),(862,905),(868,1000),(808,982)]
fd.polygon(TP(kitchen), fill=(200,60,30,150))
for k,n,c,poly,lab,num in Z: dashed(td, TP(poly+[poly[0]]), width=8, dash=22, gap=12)
dashed(td, TP(kitchen+[kitchen[0]]), width=6, dash=14, gap=8, col=(255,210,150,255))
# field paths (thin) dividing 6 plots
for line in ([(462,640),(452,1200)], [(205,885),(712,855)], [(268,1075),(585,1055)]):
    dashed(td, TP(line), width=6, dash=16, gap=10)
# main paths
dashed(td, TP([(880,960),(800,900),(735,860),(620,990),(470,1160)]), width=15)   # core -> Ernte-Hof -> fields
dashed(td, TP([(985,930),(1060,975)]), width=15)                                   # core -> housing
dashed(td, TP([(880,1010),(800,1120),(870,1300)]), width=15)                      # core -> workshops -> stables
dashed(td, TP([(990,990),(1015,1100)]), width=11)                                  # core -> later
dashed(td, TP([(1110,1060),(1135,1195)]), width=11)                               # housing -> fisher
td.line(TP([(1000,860),(1180,905),(1235,840)]), fill=WHITE, width=12)
td.polygon(TP([(1235,800),(1265,865),(1205,850)]), fill=WHITE)
txt(td, T((1005,790)), "Weg zum jetzigen Dorf", fs, sw=4)
# numbered buildings: (number, [positions])
KEY = [
 (1,"Rathaus + Forschungstisch",[(920,925)]),
 (2,"Küche: Lagerfeuer mit Kochtopf ×2 + Lagerfeuer",[(832,935)]),
 (3,"Essenslager (direkt neben der Küche)",[(838,972)]),
 (4,"Vorratslager + Lagertruhen",[(955,950),(905,985)]),
 (5,"Brunnen / Wassersammler",[(1000,972),(1050,1012)]),
 (6,"Wohnhäuser / Wohnzelte (in Reihen)",[(1075,990),(1120,992),(1160,995),(1105,1040)]),
 (7,"Plumpsklo (Rand, nicht neben Küche)",[(1078,1062)]),
 (8,"Dreschhaus (nah an Küche und Feldern)",[(735,925)]),
 (9,"Scheunen ×5",[(690,1005),(640,1080),(575,1165)]),
 (10,"Komposthaufen ×2",[(545,1222)]),
 (11,"Bauernhof (je Feldstück einer)",[(360,790),(600,745),(345,965),(545,950),(380,1140)]),
 (12,"Sägegrube + Holzfällerplatz (Stämme kommen von Norden)",[(758,1062)]),
 (13,"Werkzeugmacher",[(840,1062)]),
 (14,"Webstuhl + Webertisch",[(870,1145)]),
 (15,"Werkbänke + Handwerkerecke",[(762,1150)]),
 (16,"Mischkübel",[(830,1210)]),
 (17,"Geflügelstall",[(880,1305)]),
 (18,"Metzgerei + Metzgergestell",[(960,1290)]),
 (19,"Gerbergestell (Häute vom Metzger)",[(1010,1345)]),
 (20,"Räuchergestelle ×3 (Fleisch + Fisch)",[(930,1380),(1110,1262)]),
 (21,"Fischerlager",[(1150,1205)]),
 (22,"Holzfällerhütte + Försterei",[(735,690)]),
 (23,"Sammlerhütte + Trockengestelle",[(640,520)]),
 (24,"Aufmarschplatz + Waffenständer",[(1050,905)]),
 (25,"Kleine Karawanenstation + Karrenwerkbank",[(1150,915)]),
]
def badge(p, n):
    x,y=T(p); r=17
    td.ellipse([x-r,y-r,x+r,y+r], fill=PAPER, outline=INK, width=4)
    s=str(n); w=td.textlength(s,font=fb); td.text((x-w/2,y-13), s, font=fb, fill=INK)
for n,_,ps in KEY:
    for p in ps: badge(p,n)
# zone labels + step badges
for k,n,c,poly,lab,num in Z:
    txt(td, T(lab), n, fz if k!="spaet" else fm)
    if num and k in STEP:
        x,y=T(num); td.ellipse([x-24,y-24,x+24,y+24], fill=GOLD, outline=INK, width=5)
        s=str(STEP[k]); w=td.textlength(s,font=fn); td.text((x-w/2,y-21), s, font=fn, fill=INK)
txt(td, T((955,1140)), "Schmelze · Bibliothek", fs, sw=4)
txt(td, T((700,860)), "Küche", fs, col=(255,210,150,255), sw=4)
# ---------- panel ----------
py = MH + 28; px = 36
td.text((px,py), "Neues Dorf – Plan im Detail", font=fh, fill=GOLD); py += 62
td.text((px,py), "Goldene Zahl = Umzugs-Schritt · helle Zahl = Gebäude (Liste unten)", font=fp, fill=(205,195,175,255)); py += 46
colw = MW//2 - 10
half = (len(KEY)+1)//2
y0 = py
for i,(n,label,_) in enumerate(KEY):
    col = 0 if i < half else 1; row = i if i < half else i-half
    x = px + col*colw; y = y0 + row*40
    td.ellipse([x,y,x+30,y+30], fill=PAPER, outline=INK, width=3)
    s=str(n); w=td.textlength(s,font=fb); td.text((x+15-w/2,y+3), s, font=fb, fill=INK)
    td.text((x+42,y+2), label, font=fp, fill=PAPER)
py = y0 + half*40 + 20
td.text((px,py), "Wege", font=fpb, fill=GOLD); py += 40
dashed(td, [(px,py+14),(px+60,py+14)], width=12, dash=18, gap=8); td.text((px+80,py), "Hauptwege zwischen den Bereichen", font=fp, fill=PAPER)
dashed(td, [(px+colw,py+14),(px+colw+60,py+14)], width=6, dash=12, gap=6); td.text((px+colw+80,py), "Feldwege: teilen die Felder in 6 Stücke", font=fp, fill=PAPER); py += 52
td.text((px,py), "Umzug in Schritten", font=fpb, fill=GOLD); py += 40
for s_ in ["1  Dorfkern: Küche, Essenslager, Vorratslager, Brunnen zuerst – Versorgung reißt nie ab",
           "2  Wohnhäuser    3  Ernte-Hof + Felder    4  Werkstätten    5  Ställe, Metzger, Fischer",
           "Danach das alte Dorf nach und nach abbauen; Material kommt ins neue Lager zurück."]:
    td.text((px,py), s_, font=fp, fill=PAPER); py += 38
img = Image.alpha_composite(Image.alpha_composite(canvas, fill), top).convert("RGB")
img = img.crop((0,0,MW,min(MH+PANEL, py+30)))
img.save(out, quality=90); print("ok", img.size)

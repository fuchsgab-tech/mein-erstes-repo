# Draws the title picture as a vector scene (sharp at any size): a village behind a palisade at dusk, a watchtower, a
# castle on a hill, fog, lit windows and a bell frame in the foreground. Writes titelbild.svg.
import random
R = random.Random(7)
W, H = 1600, 600
o = []
a = o.append

a(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">')
a('''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#090b12"/><stop offset=".42" stop-color="#1b1a20"/><stop offset=".68" stop-color="#4a3320"/><stop offset=".82" stop-color="#8a5a2a"/><stop offset="1" stop-color="#2a1c10"/></linearGradient>
<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffd58a" stop-opacity=".95"/><stop offset=".25" stop-color="#e9a04a" stop-opacity=".55"/><stop offset="1" stop-color="#e9a04a" stop-opacity="0"/></radialGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffc878" stop-opacity=".9"/><stop offset=".35" stop-color="#f08a3c" stop-opacity=".35"/><stop offset="1" stop-color="#f08a3c" stop-opacity="0"/></radialGradient>
<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9b680" stop-opacity="0"/><stop offset=".5" stop-color="#d9b680" stop-opacity=".34"/><stop offset="1" stop-color="#d9b680" stop-opacity="0"/></linearGradient>
<linearGradient id="fog2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f7a5c" stop-opacity="0"/><stop offset=".55" stop-color="#8f7a5c" stop-opacity=".3"/><stop offset="1" stop-color="#8f7a5c" stop-opacity="0"/></linearGradient>
<linearGradient id="vig" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
<filter id="b6" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="b14" x="-20%" y="-80%" width="140%" height="260%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="smoke" x="-400%" y="-20%" width="900%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
</defs>''')
a(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
# low sun behind the castle hill
a('<ellipse cx="1010" cy="420" rx="700" ry="290" fill="url(#sun)"/>')
# stars
for _ in range(70):
    x, y = R.uniform(0, W), R.uniform(0, 210)
    a(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{R.choice([.6,.8,1,1.3]):.1f}" fill="#f3e3c0" opacity="{R.uniform(.25,.8):.2f}"/>')
# clouds: dark bands with a warm underside
for cx, cy, rx, ry, op in [(300, 120, 380, 34, .75), (900, 80, 460, 30, .7), (1380, 150, 340, 30, .7), (640, 200, 300, 22, .55), (1150, 235, 280, 18, .5)]:
    a(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#0a0a10" opacity="{op}" filter="url(#b14)"/>')
    a(f'<ellipse cx="{cx+30}" cy="{cy+ry*.9:.0f}" rx="{rx*.7:.0f}" ry="{ry*.25:.0f}" fill="#c98a4a" opacity="{op*.22:.2f}" filter="url(#b6)"/>')

def ridge(y0, amp, step, seed, color, op=1):
    r = random.Random(seed); pts = [(0, H)]
    x, y = 0, y0
    while x <= W + step:
        pts.append((x, y)); x += r.uniform(step*.5, step*1.4); y = y0 + r.uniform(-amp, amp)
    pts.append((W, H))
    a(f'<polygon points="{" ".join(f"{px:.0f},{py:.0f}" for px, py in pts)}" fill="{color}" opacity="{op}"/>')
ridge(330, 70, 90, 3, '#2b2327')          # far mountains
ridge(375, 48, 70, 5, '#1d1a1d')          # nearer range

# castle on its hill
a('<path d="M700 480 C820 462 880 366 950 358 L1100 358 C1170 366 1230 462 1350 480 Z" fill="#131114"/>')
cas = '#0e0c0f'
def tower(x, base, w, h, roof):
    a(f'<rect x="{x-w/2:.0f}" y="{base-h:.0f}" width="{w}" height="{h}" fill="{cas}"/>')
    a(f'<polygon points="{x-w/2-4:.0f},{base-h:.0f} {x:.0f},{base-h-roof:.0f} {x+w/2+4:.0f},{base-h:.0f}" fill="{cas}"/>')
    a(f'<path d="M{x:.0f} {base-h-roof:.0f}v-{roof*.28:.0f}" stroke="{cas}" stroke-width="2"/>')
a(f'<rect x="925" y="318" width="185" height="42" fill="{cas}"/>')
for bx in range(925, 1110, 12):                      # battlements
    a(f'<rect x="{bx}" y="311" width="7" height="8" fill="{cas}"/>')
for x, w, h, roof in [(940, 22, 78, 34), (985, 30, 112, 52), (1022, 20, 86, 40), (1058, 34, 136, 64), (1096, 22, 74, 36), (1120, 16, 52, 28)]:
    tower(x, 360, w, h, roof)
a(f'<rect x="1000" y="300" width="72" height="60" fill="{cas}"/>')
for x, y in [(985, 285), (1058, 262), (1058, 290), (1022, 300), (940, 305), (1096, 310), (1034, 330), (1012, 338), (968, 336)]:
    a(f'<rect x="{x-1.5}" y="{y}" width="3" height="5" fill="#ffcf85" opacity=".9"/>')
# rim light on the hill
a('<path d="M930 352 L1105 352" stroke="#e9a04a" stroke-width="1" opacity=".35"/>')

a(f'<rect x="-50" y="380" width="{W+100}" height="120" fill="url(#fog)" filter="url(#b6)"/>')

def pine(x, base, h, color):
    w = h * .42; pts = []
    tiers = 5
    left, right = [], []
    for i in range(tiers):
        ty = base - h + h * i / tiers * .92
        by = base - h + h * (i + 1) / tiers * .96
        tw = w * (i + .8) / tiers
        left += [(x - tw * .35, ty), (x - tw, by)]
        right += [(x + tw * .35, ty), (x + tw, by)]
    pts = [(x, base - h - h * .06)] + left + [(x - w * .12, base), (x + w * .12, base)] + right[::-1]
    a(f'<polygon points="{" ".join(f"{px:.1f},{py:.1f}" for px, py in pts)}" fill="{color}"/>')
r = random.Random(11)
x = -20
while x < W + 20:                                   # far tree line
    pine(x, 462 + r.uniform(-6, 8), r.uniform(46, 84), '#15130f'); x += r.uniform(16, 34)
a(f'<rect x="-50" y="430" width="{W+100}" height="90" fill="url(#fog2)" filter="url(#b6)"/>')

# the village
def house(x, base, w, h, roof, lit=(), chimney=True, col='#0d0b09'):
    a(f'<rect x="{x:.0f}" y="{base-h:.0f}" width="{w}" height="{h}" fill="{col}"/>')
    a(f'<polygon points="{x-9:.0f},{base-h:.0f} {x+w/2:.0f},{base-h-roof:.0f} {x+w+9:.0f},{base-h:.0f}" fill="#0a0806"/>')
    a(f'<path d="M{x+w/2:.0f} {base-h-roof:.0f} L{x+w+9:.0f} {base-h:.0f}" stroke="#e9a04a" stroke-width="1.4" opacity=".4"/>')
    if chimney:
        cx = x + w * .26
        a(f'<rect x="{cx:.0f}" y="{base-h-roof*.82:.0f}" width="9" height="{roof*.5:.0f}" fill="#0a0806"/>')
        a(f'<path d="M{cx+4:.0f} {base-h-roof*.84:.0f} c-14 -26 12 -42 -4 -72 c-10 -22 10 -36 2 -58" fill="none" stroke="#b9a689" stroke-width="12" stroke-linecap="round" opacity=".2" filter="url(#smoke)"/>')
    for (fx, fy, ww, wh) in lit:
        wx, wy = x + w * fx, base - h * fy
        a(f'<ellipse cx="{wx+ww/2:.0f}" cy="{wy+wh/2:.0f}" rx="{ww*2.6:.0f}" ry="{wh*2.2:.0f}" fill="url(#glow)" opacity=".8"/>')
        a(f'<rect x="{wx:.0f}" y="{wy:.0f}" width="{ww}" height="{wh}" fill="#ffc46e"/>')
        a(f'<path d="M{wx+ww/2:.0f} {wy:.0f}v{wh}M{wx:.0f} {wy+wh/2:.0f}h{ww}" stroke="#3a2410" stroke-width="1.2"/>')
house(150, 512, 96, 46, 50, [(.56, .78, 14, 16)])
house(292, 518, 74, 40, 44, [(.3, .8, 12, 14)], chimney=False)
house(748, 506, 110, 52, 58, [(.2, .76, 14, 17), (.62, .76, 14, 17)])
house(884, 514, 78, 40, 44, [(.5, .8, 13, 15)], chimney=False)
house(985, 500, 150, 62, 74, [(.14, .74, 15, 19), (.42, .74, 15, 19), (.72, .74, 15, 19)])   # the great hall
house(1180, 512, 92, 44, 50, [(.25, .8, 13, 15)], chimney=False)
house(1470, 516, 100, 46, 52, [(.55, .78, 14, 16)])
# a door glow on the hall
a('<ellipse cx="1062" cy="492" rx="30" ry="22" fill="url(#glow)" opacity=".7"/><path d="M1052 500v-18a10 10 0 0 1 20 0v18z" fill="#ffb95e"/>')

# the watchtower
a('<g transform="translate(96 0)">')
tw = '#080705'
a(f'<path d="M508 520 L526 330 M612 520 L594 330 M512 470 L608 420 M608 470 L512 420 M518 400 L602 360 M602 400 L518 360" stroke="{tw}" stroke-width="9" stroke-linecap="round" fill="none"/>')
a(f'<rect x="498" y="296" width="124" height="40" fill="{tw}"/><rect x="490" y="330" width="140" height="9" fill="{tw}"/>')
for bx in range(498, 622, 15):
    a(f'<rect x="{bx}" y="286" width="9" height="12" fill="{tw}"/>')
a(f'<path d="M506 296 V250 M614 296 V250" stroke="{tw}" stroke-width="8"/>')
a(f'<polygon points="482,254 560,196 638,254" fill="{tw}"/><path d="M560 196 L638 254" stroke="#e9a04a" stroke-width="1.6" opacity=".45"/>')
a('<ellipse cx="560" cy="282" rx="46" ry="34" fill="url(#glow)" opacity=".85"/><rect x="554" y="270" width="12" height="18" rx="2" fill="#ffc46e"/>')
a('</g>')

a(f'<rect x="-50" y="478" width="{W+100}" height="80" fill="url(#fog2)" filter="url(#b6)"/>')

# the palisade in front, with a gate gap left open towards the hall
r = random.Random(23)
x = -6
while x < W + 10:
    w = r.uniform(15, 21); top = 512 + r.uniform(-12, 10)
    if not (900 < x < 960):
        a(f'<polygon points="{x:.1f},{H} {x:.1f},{top+12:.1f} {x+w/2:.1f},{top:.1f} {x+w:.1f},{top+12:.1f} {x+w:.1f},{H}" fill="#060504"/>')
        a(f'<path d="M{x+w/2:.1f} {top:.1f} L{x+w:.1f} {top+12:.1f}" stroke="#e9a04a" stroke-width="1" opacity=".22"/>')
    x += w - 1.5
a('<rect x="-10" y="548" width="1620" height="7" fill="#040302"/>')
# torches on the palisade
for tx in (236, 884, 976, 1288):
    a(f'<path d="M{tx} 512v-34" stroke="#060504" stroke-width="5"/><ellipse cx="{tx}" cy="470" rx="42" ry="38" fill="url(#glow)"/><path d="M{tx-5} 478c-3-9 3-12 5-20 4 8 8 11 5 20z" fill="#ffd58a"/>')

# the bell frame in the foreground: two posts, a beam, a small roof, the bell
bf = '#040302'
a(f'<path d="M1322 600V372 M1462 600V372" stroke="{bf}" stroke-width="20"/>')
a(f'<rect x="1300" y="364" width="184" height="18" fill="{bf}"/>')
a(f'<polygon points="1282,366 1392,300 1502,366" fill="{bf}"/><path d="M1392 300 L1502 366" stroke="#e9a04a" stroke-width="2" opacity=".5"/>')
a(f'<path d="M1322 420 L1360 382 M1462 420 L1424 382" stroke="{bf}" stroke-width="10"/>')
a(f'<path d="M1392 382v14" stroke="{bf}" stroke-width="6"/>')
a(f'<path d="M1392 394c-21 0-32 16-32 38v30l-13 18v7h90v-7l-13-18v-30c0-22-11-38-32-38z" fill="{bf}"/>')
a('<path d="M1424 432v30l13 18" fill="none" stroke="#ffcf85" stroke-width="2.2" opacity=".75" stroke-linecap="round"/><path d="M1402 396c12 4 20 16 22 30" fill="none" stroke="#ffcf85" stroke-width="1.6" opacity=".45" stroke-linecap="round"/>')
a(f'<circle cx="1392" cy="494" r="9" fill="{bf}"/>')

# embers
r = random.Random(41)
for _ in range(46):
    x, y = r.uniform(60, W - 60), r.uniform(250, 560)
    s = r.choice([1.2, 1.6, 2, 2.6])
    a(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{s*2.4:.1f}" fill="#f08a3c" opacity=".16"/><circle cx="{x:.0f}" cy="{y:.0f}" r="{s:.1f}" fill="#ffc46e" opacity="{r.uniform(.45,.95):.2f}"/>')
a(f'<rect width="{W}" height="{H}" fill="url(#vig)"/>')
a('</svg>')
open('titelbild.svg', 'w', encoding='utf8').write('\n'.join(o))
print('ok', sum(len(x) for x in o))

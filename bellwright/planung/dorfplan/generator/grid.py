# overlay an ORIGINAL-photo-pixel grid on a crop of the rendered PNG for layout work
import sys
from PIL import Image, ImageDraw, ImageFont
x0, y0, x1, y1 = map(int, sys.argv[1:5]); out = sys.argv[5]
MX, MY, S = 34, 196, 1.4
im = Image.open('../masterplan.png').convert('RGB')
d = ImageDraw.Draw(im)
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 12)
def C(x, y): return (MX + (x - 100) * S, MY + (y - 430) * S)
for x in range(x0 - x0 % 20, x1 + 1, 20):
    a = C(x, y0); b = C(x, y1)
    d.line([a, b], fill=(255, 0, 0) if x % 100 == 0 else (255, 160, 160), width=1)
for y in range(y0 - y0 % 20, y1 + 1, 20):
    a = C(x0, y); b = C(x1, y)
    d.line([a, b], fill=(255, 0, 0) if y % 100 == 0 else (255, 160, 160), width=1)
for x in range(x0 - x0 % 100, x1 + 1, 100):
    for y in range(y0 - y0 % 100, y1 + 1, 100):
        d.text(C(x, y), f"{x},{y}", font=f, fill=(200, 0, 0))
a = C(x0, y0); b = C(x1, y1)
im.crop((int(a[0]), int(a[1]), int(b[0]), int(b[1]))).save(out)

# Crops head and shoulders (square) from the user's 14 portraits, 240 px, and writes a sheet of round tokens to check.
from PIL import Image, ImageDraw
import os, json, base64, io
D = 'charaktere'
# id, label, file, crop box (x, y, size) in the 784x1168 picture
FIGS = [
  ('vogt', 'Vogt', 'ogNn9.jpg', (92, 150, 600)),
  ('schmiedin', 'Schmiedin', 'g9a7M.jpg', (92, 150, 600)),
  ('jaeger', 'Jäger', 'dxoU7.jpg', (72, 110, 640)),
  ('baeuerin', 'Bäuerin', 'WUh3o.jpg', (72, 60, 640)),
  ('koechin', 'Köchin', 'ECwX9.jpg', (72, 80, 640)),
  ('holzfaeller', 'Holzfäller', 'uTtg8.jpg', (92, 160, 600)),
  ('gelehrte', 'Gelehrter', 'NrK6x.jpg', (72, 60, 640)),
  ('wache', 'Wache', 'dzubN.jpg', (72, 90, 640)),
  ('koenig', 'König', 'C5geW.jpg', (62, 40, 660)),
  ('koenigin', 'Königin', 'otnUe.jpg', (72, 60, 640)),
  ('prinz', 'Prinz', 'BVS9Z.jpg', (72, 50, 640)),
  ('fuerst', 'Fürst', '3fphw.jpg', (72, 60, 640)),
  ('herzog', 'Herzog', '9ZKJE.jpg', (72, 50, 640)),
  ('graf', 'Graf', 'uOppu.jpg', (82, 110, 620)),
]
out = {}
S = 200
sheet = Image.new('RGB', (7 * S, 2 * (S + 24)), '#15110d'); dr = ImageDraw.Draw(sheet)
for i, (fid, label, f, (x, y, sz)) in enumerate(FIGS):
    im = Image.open(os.path.join(D, f)).convert('RGB').crop((x, y, x + sz, y + sz)).resize((240, 240), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=80, optimize=True)
    out[fid] = {'label': label, 'b64': base64.b64encode(buf.getvalue()).decode(), 'bytes': len(buf.getvalue())}
    t = im.resize((S - 16, S - 16)); m = Image.new('L', t.size, 0); ImageDraw.Draw(m).ellipse((0, 0, t.size[0] - 1, t.size[1] - 1), fill=255)
    px, py = (i % 7) * S + 8, (i // 7) * (S + 24) + 4
    sheet.paste(t, (px, py), m); dr.text((px + 4, py + S - 14), label, fill='#efd28a')
    s = im.resize((34, 34), Image.LANCZOS); m2 = Image.new('L', (34, 34), 0); ImageDraw.Draw(m2).ellipse((0, 0, 33, 33), fill=255)
    sheet.paste(s, (px + S - 54, py + S - 44), m2)
sheet.save('fig-sheet.png')
json.dump({'order': [f[0] for f in FIGS], 'figs': out}, open('figs.json', 'w'))
print('total bytes', sum(v['bytes'] for v in out.values()))

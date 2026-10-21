# يقرأ لون الرادار (ومنه dBZ) عند نقطة، مثل ما يسويه التطبيق، للتحقق
import json, math, io, sys, urllib.request
from PIL import Image
lat, lng = float(sys.argv[1]), float(sys.argv[2])
j = json.load(urllib.request.urlopen('https://api.rainviewer.com/public/weather-maps.json'))
f = j['radar']['past'][-1]; host = j['host']; Z = 7; n = 2 ** Z
fx = (lng + 180) / 360 * n; fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
tx, ty = int(fx), int(fy)
for size in (256, 512):
    u = f"{host}{f['path']}/{size}/{Z}/{tx}/{ty}/2/1_1.png"
    r = urllib.request.urlopen(u); b = r.read(); im = Image.open(io.BytesIO(b)).convert('RGBA')
    X, Y = int((fx - tx) * size), int((fy - ty) * size)
    px = [im.getpixel((min(size-1, max(0, X+i)), min(size-1, max(0, Y+k)))) for i in (-2, 0, 2) for k in (-2, 0, 2)]
    print(size, r.status, r.headers.get('access-control-allow-origin'), im.size, 'xy', X, Y, 'px', px[:5], 'nonzero', sum(1 for p in im.getdata() if p[3] > 40))

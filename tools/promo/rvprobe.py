import json, math, urllib.request, io
from PIL import Image
j = json.load(urllib.request.urlopen('https://api.rainviewer.com/public/weather-maps.json'))
def px(lat, lng, z=7):
    n = 256*2**z; r = math.radians(lat); return ((lng+180)/360*n, (1-math.asinh(math.tan(r))/math.pi)/2*n)
for name, lat, lng in [('nafud', 27.86, 42.05), ('buqaa', 27.92, 42.36), ('hail', 27.52, 41.69)]:
    x, y = px(lat, lng); tx, ty = int(x//256), int(y//256); ix, iy = int(x-tx*256), int(y-ty*256)
    row = []
    for f in j['radar']['past']:
        im = Image.open(io.BytesIO(urllib.request.urlopen(f"{j['host']}{f['path']}/256/7/{tx}/{ty}/2/1_1.png").read())).convert('RGBA')
        c = sum(1 for dx in range(-4, 5) for dy in range(-4, 5) if 0 <= ix+dx < 256 and 0 <= iy+dy < 256 and im.getpixel((ix+dx, iy+dy))[3] > 40)
        row.append(c)
    print(name, row)

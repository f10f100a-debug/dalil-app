# يحاكي «العاصفة جايتك» لموقع معيّن: أقرب مطر الآن وقبل 30 د، مع وبدون قناع التشويش الثابت
import json, math, io, sys, urllib.request
from PIL import Image
lat, lng = float(sys.argv[1]), float(sys.argv[2])
Z, R = 7, 150000
j = json.load(urllib.request.urlopen('https://api.rainviewer.com/public/weather-maps.json'))
past = j['radar']['past']; host = j['host']
def px(lat, lng): n = 256*2**Z; r = math.radians(lat); return ((lng+180)/360*n, (1-math.asinh(math.tan(r))/math.pi)/2*n)
cx, cy = px(lat, lng); mpp = 156543.03*math.cos(math.radians(lat))/2**Z; rp = math.ceil(R/mpp)
x0, x1, y0, y1 = int((cx-rp)//256), int((cx+rp)//256), int((cy-rp)//256), int((cy+rp)//256)
W, H = (x1-x0+1)*256, (y1-y0+1)*256; ux, uy = cx-x0*256, cy-y0*256
def grid(f):
    im = Image.new('RGBA', (W, H))
    for tx in range(x0, x1+1):
        for ty in range(y0, y1+1):
            try: im.paste(Image.open(io.BytesIO(urllib.request.urlopen(f"{host}{f['path']}/256/{Z}/{tx}/{ty}/2/1_1.png").read())).convert('RGBA'), ((tx-x0)*256, (ty-y0)*256))
            except Exception as e: pass
    a = im.getchannel('A').load(); return [[1 if a[x, y] > 40 else 0 for x in range(W)] for y in range(H)]
def nearest(G, cl):
    at = lambda x, y: 0 <= x < W and 0 <= y < H and G[y][x] and not (cl and cl[y][x])
    best = None
    for y in range(max(2, int(uy-rp)), min(H-2, int(uy+rp)), 2):
        for x in range(max(2, int(ux-rp)), min(W-2, int(ux+rp)), 2):
            if not at(x, y): continue
            d = math.hypot(x-ux, y-uy)
            if best and d >= best: continue
            if sum(at(x+i, y+k) for i in range(-2, 3) for k in range(-2, 3)) >= 12: best = d
    return best*mpp/1000 if best else None
now, prev, old, mid = past[-1], past[-4], past[0], past[len(past)//2]
Gn, Gp, Go, Gm = map(grid, (now, prev, old, mid))
near = lambda G, x, y: any(0 <= x+i < W and 0 <= y+k < H and G[y+k][x+i] for i in (-1, 0, 1) for k in (-1, 0, 1))
cl = [[1 if Gn[y][x] and near(Go, x, y) and near(Gm, x, y) else 0 for x in range(W)] for y in range(H)]
wet = sum(map(sum, Gn)); masked = sum(map(sum, cl))
a, b = nearest(Gn, cl), nearest(Gp, cl); a0, b0 = nearest(Gn, None), nearest(Gp, None)
print(f"wet px={wet} masked as clutter={masked} | with mask: now={a} prev30={b} | no mask: now={a0} prev30={b0}")

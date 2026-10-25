# فحص: وش يشوف رادار RainViewer في مربع معيّن (نفس طريقة dalil-alerts: z6، لوحة الألوان، فلتر التشويش)
import json, math, sys, io, urllib.request
from PIL import Image
LAT0, LAT1, LNG0, LNG1 = map(float, (sys.argv[1:5] if len(sys.argv) > 4 else (26.0, 28.0, 41.0, 44.5)))
PAL = [[0,0x82,0x7b,0x69],[5,0x92,0x88,0x71],[10,0xce,0xc0,0x87],[15,0x88,0xdd,0xee],[20,0x00,0xa3,0xe0],[25,0x00,0x77,0xaa],[30,0x00,0x55,0x88],[35,0xff,0xee,0x00],[40,0xff,0xaa,0x00],[45,0xff,0x44,0x00],[50,0xc1,0x00,0x00],[55,0xff,0xaa,0xff],[60,0xff,0x77,0xff],[65,0xff,0xff,0xff]]
def dbz(r,g,b,a):
    if a < 40: return -1
    return min(PAL, key=lambda p:(r-p[1])**2+(g-p[2])**2+(b-p[3])**2)[0]
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent":"dalil-probe"}), timeout=60).read()
j = json.loads(get("https://api.rainviewer.com/public/weather-maps.json"))
past = j["radar"]["past"]; Z = 6; STEP = 0.05
tx = lambda lng: (lng+180)/360*2**Z
ty = lambda lat: (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**Z
def grid(path, scheme=2):
    tiles = {}
    for x in range(int(tx(LNG0)), int(tx(LNG1))+1):
        for y in range(int(ty(LAT1)), int(ty(LAT0))+1):
            try: tiles[(x,y)] = Image.open(io.BytesIO(get(f"{j['host']}{path}/256/{Z}/{x}/{y}/{scheme}/0_0.png"))).convert("RGBA")
            except Exception as e: print("tile fail", x, y, e)
    g = {}
    la = LAT0 + STEP/2
    while la < LAT1:
        lo = LNG0 + STEP/2
        while lo < LNG1:
            fx, fy = tx(lo), ty(la); t = tiles.get((int(fx), int(fy)))
            if t: g[(round(la,3), round(lo,3))] = dbz(*t.getpixel((min(255,int(fx%1*256)), min(255,int(fy%1*256)))))
            lo += STEP
        la += STEP
    return g
from datetime import datetime, timezone
fr = {"now": past[-1], "prev": past[-4], "old": past[0]}
for k, f in fr.items(): print(k, datetime.fromtimestamp(f["time"], timezone.utc).isoformat())
G = {k: grid(f["path"]) for k, f in fr.items()}
N, P, O = G["now"], G["prev"], G["old"]
hist = {}
for v in N.values(): hist[v] = hist.get(v, 0) + 1
print("now dBZ histogram:", dict(sorted(hist.items())))
heavy = [k for k, v in N.items() if v >= 45]
clut = [k for k in heavy if O.get(k, -1) >= 0 and P.get(k, -1) >= 0 and O[k] >= N[k] - 10]
print("≥45:", len(heavy), "filtered as clutter:", len(clut))
print("≥40:", sum(1 for v in N.values() if v >= 40))
top = sorted(N.items(), key=lambda kv: -kv[1])[:15]
print("strongest:", [(k, v, "old", O.get(k), "prev", P.get(k)) for k, v in top])

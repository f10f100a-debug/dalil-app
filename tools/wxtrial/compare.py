# مقارنة: صورة رادار دليل (RainViewer نفس ألوان التطبيق) حول نقطة، لأقرب صورة لوقت معيّن (UTC)
import json, math, sys, io, urllib.request, datetime as dt
from PIL import Image, ImageDraw
LAT0, LAT1, LNG0, LNG1 = 26.6, 28.1, 40.4, 42.6
WANT = dt.datetime.fromisoformat(sys.argv[1]).replace(tzinfo=dt.timezone.utc) if len(sys.argv) > 1 else None
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent":"dalil-probe"}), timeout=60).read()
j = json.loads(get("https://api.rainviewer.com/public/weather-maps.json"))
past = j["radar"]["past"]
f = min(past, key=lambda p: abs(p["time"] - WANT.timestamp())) if WANT else past[-1]
when = dt.datetime.fromtimestamp(f["time"], dt.timezone.utc)
print("frame", when.isoformat(), "riyadh", (when + dt.timedelta(hours=3)).strftime("%H:%M"))
Z = 7
tx = lambda lng: (lng+180)/360*2**Z*256
ty = lambda lat: (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**Z*256
X0, X1, Y0, Y1 = int(tx(LNG0)), int(tx(LNG1)), int(ty(LAT1)), int(ty(LAT0))
img = Image.new("RGBA", (X1-X0, Y1-Y0), (245,240,230,255))
for x in range(X0//256, X1//256+1):
    for y in range(Y0//256, Y1//256+1):
        try:
            t = Image.open(io.BytesIO(get(f"{j['host']}{f['path']}/256/{Z}/{x}/{y}/2/1_0.png"))).convert("RGBA")
            img.alpha_composite(t, (x*256-X0, y*256-Y0))
        except Exception as e: print("tile fail", x, y, e)
img = img.resize((img.width*3, img.height*3), Image.NEAREST)
d = ImageDraw.Draw(img)
P = lambda la, lo: ((tx(lo)-X0)*3, (ty(la)-Y0)*3)
for la in [27.0, 27.5, 28.0]:
    d.line([P(la, LNG0), P(la, LNG1)], fill=(120,120,120,255))
    d.text(P(la, LNG0+0.02), f"{la}N", fill=(60,60,60,255))
for lo in [40.5, 41.0, 41.5, 42.0, 42.5]:
    d.line([P(LAT0, lo), P(LAT1, lo)], fill=(120,120,120,255))
    d.text(P(LAT1-0.05, lo+0.01), f"{lo}E", fill=(60,60,60,255))
for name, la, lo in [("HAIL", 27.52, 41.69), ("Qafar", 27.42, 41.65), ("Mawqaq", 27.38, 41.03)]:
    x, y = P(la, lo); d.ellipse([x-6, y-6, x+6, y+6], outline=(0,0,0,255), width=3); d.text((x+8, y-6), name, fill=(0,0,0,255))
img.convert("RGB").save("compare.png")

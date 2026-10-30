# مقارنة «فوقك» القديمة والجديدة على صور الرادار الحالية (RainViewer z7) — يُشغَّل من GitHub
# القديم: صور منعّمة، أي صدى = مطر، «فوقك» إذا طرف كتلة مطر < 4 كم
# الجديد: بدون تنعيم، مطر = 10 dBZ فأكثر، «فوقك» إذا الرادار فوق نقطتك (±1 بكسل ≈ 1.5 كم) ≥15 وكتلة < 4 كم
# الحقيقة: الرادار (بدون تنعيم) فوق نقطتك نفسها ≥20 dBZ = مطر فعلي فوقك
import io, json, math, urllib.request
import numpy as np
from PIL import Image
from scipy import ndimage

Z = 7
PAL = [[0,0x82,0x7b,0x69],[5,0x92,0x88,0x71],[10,0xce,0xc0,0x87],[15,0x88,0xdd,0xee],[20,0x00,0xa3,0xe0],[25,0x00,0x77,0xaa],[30,0x00,0x55,0x88],[35,0xff,0xee,0x00],[40,0xff,0xaa,0x00],[45,0xff,0x44,0x00],[50,0xc1,0x00,0x00],[55,0xff,0xaa,0xff],[60,0xff,0x77,0xff],[65,0xff,0xff,0xff]]
P = np.array([p[1:] for p in PAL], float); D = np.array([p[0] for p in PAL])
BOXES = {"السعودية": (16, 32.5, 34, 56), "تركيا والشام": (30, 42, 26, 45), "أوروبا": (42, 55, -5, 20)}
j = json.load(urllib.request.urlopen("https://api.rainviewer.com/public/weather-maps.json"))
host, path = j["host"], j["radar"]["past"][-1]["path"]
tx = lambda lng: (lng + 180) / 360 * 2**Z
ty = lambda lat: (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2**Z

def mosaic(b, opt):
    la0, la1, lo0, lo1 = b
    x0, x1, y0, y1 = int(tx(lo0)), int(tx(lo1)), int(ty(la1)), int(ty(la0))
    img = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256, 4), np.uint8)
    for X in range(x0, x1 + 1):
        for Y in range(y0, y1 + 1):
            try:
                t = Image.open(io.BytesIO(urllib.request.urlopen(f"{host}{path}/256/{Z}/{X}/{Y}/2/{opt}.png", timeout=20).read())).convert("RGBA")
                img[(Y - y0) * 256:(Y - y0 + 1) * 256, (X - x0) * 256:(X - x0 + 1) * 256] = np.array(t)
            except Exception: pass
    return img

def dbz(img):
    rgb = img[..., :3].reshape(-1, 1, 3).astype(float)
    k = ((rgb - P[None]) ** 2).sum(-1).argmin(-1)
    out = D[k].reshape(img.shape[:2]).astype(float)
    out[img[..., 3] <= 40] = -1
    return out

def mass_dist(wet, mpp):
    # كتلة = 12 من 25 مبلولة في مربع 5×5 (نفس شرط التطبيق) → مسافة كل نقطة لأقرب كتلة
    c = ndimage.uniform_filter(wet.astype(float), 5, mode="constant") * 25
    mass = wet & (c >= 11.5)
    return ndimage.distance_transform_edt(~mass) * mpp

tot = {}
for name, b in BOXES.items():
    sm, raw = mosaic(b, "1_1"), mosaic(b, "0_1")
    dz = dbz(raw)
    mpp = 156543.03 * math.cos(math.radians((b[0] + b[1]) / 2)) / 2**Z
    old_d = mass_dist(sm[..., 3] > 40, mpp)
    new_d = mass_dist(dz >= 10, mpp)
    at_me = ndimage.maximum_filter(dz, 3)            # ±1 بكسل
    old_here = old_d < 4000
    new_here = (at_me >= 15) & (new_d < 4000)
    truth = dz >= 20                                  # مطر فعلي فوق النقطة نفسها
    near20 = ndimage.maximum_filter(dz, 5) >= 20      # فيه مطر ≤ ~2.5 كم
    r = dict(
        old_here=int(old_here.sum()), new_here=int(new_here.sum()), truth=int(truth.sum()),
        old_false=int((old_here & ~near20).sum()), new_false=int((new_here & ~near20).sum()),
        old_miss=int((truth & ~old_here).sum()), new_miss=int((truth & ~new_here).sum()))
    tot[name] = r
    print(f"::notice::{name}: " + json.dumps(r, ensure_ascii=False))
s = {k: sum(v[k] for v in tot.values()) for k in next(iter(tot.values()))}
print("::notice::المجموع: " + json.dumps(s, ensure_ascii=False))

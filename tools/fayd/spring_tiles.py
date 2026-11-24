"""بلاطات خرائط لطبقة الربيع (22 نوفمبر): نقص قطع ربع الدرجة (صور كبيرة) إلى بلاطات 256 بكسل (WebMercator z/x/y) —
نفس طريقة الخريطة الأساسية والرادار: الجوال يحمّل بس اللي على الشاشة وبالدقة المناسبة، فتصير ناعمة وتبان من بعيد.
  t/c/{z}/{x}/{y}.png  التصنيف  z7–z12 (من بعيد: المربع ياخذ أقوى درجة تحته عشان البقع الصغيرة ما تختفي)
  t/s/{z}/{x}/{y}.webp صورة القمر z9–z12 (من بعيد: متوسط الألوان)
بلاطة فاضية ما تنكتب (الخريطة تتعامل مع الناقص كفاضي).
python3 tools/fayd/spring_tiles.py <مجلد الطبقة>"""
import json, math, os, sys
from collections import OrderedDict
import numpy as np
from PIL import Image

D = sys.argv[1]
IX = json.load(open(f"{D}/index.json")); SX = json.load(open(f"{D}/sat.json")) if os.path.exists(f"{D}/sat.json") else {"chunks": []}
CH = IX["ch"]; T = 256
PAL = {int(k): tuple(v) for k, v in IX["pal"].items()}
PRI = {0: 0, 4: 1, 1: 2, 2: 3, 3: 4}          # من بعيد: كثيف > متوسط > خفيف > شجيرات > فاضي
INV = {v: k for k, v in PRI.items()}

def lon2x(lo, z): return (lo + 180) / 360 * 2 ** z
def lat2y(la, z): r = math.radians(la); return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z
def x2lon(x, z): return x / 2 ** z * 360 - 180
def y2lat(y, z): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))

class Chunks:
    def __init__(s, keys, path, res, kind): s.keys, s.path, s.res, s.kind, s.c = set(keys), path, res, kind, OrderedDict()
    def get(s, k):
        if k in s.c: s.c.move_to_end(k); return s.c[k]
        im = Image.open(s.path.format(k[0], k[1]))
        if s.kind == "c":
            A = np.array(im.convert("RGBA")); C = np.zeros(A.shape[:2], "uint8")
            key = (A[..., 0].astype("int32") << 16) | (A[..., 1].astype("int32") << 8) | A[..., 2]
            key[A[..., 3] == 0] = -1
            for c, col in PAL.items(): C[key == ((col[0] << 16) | (col[1] << 8) | col[2])] = c   # ألوان القطع ثابتة (نفس اللوحة)
            v = C
        else: v = np.array(im.convert("RGBA"))   # 24 نوفمبر: صورة القمر فيها شفافية (أطراف تتلاشى — spring_satfade.py)
        s.c[k] = v
        if len(s.c) > 64: s.c.popitem(last=False)
        return v

def render(ch, z, x, y):
    """بلاطة بأعلى دقة: كل بكسل → أقرب مربع في القطع (EPSG:4326) — بدون حلقات بايثون على البكسلات"""
    i = np.arange(T) + .5
    lons = (x + i / T) / 2 ** z * 360 - 180
    lats = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + i / T) / 2 ** z))))
    ka = np.floor(lats / CH + 1e-9).astype(int); kb = np.floor(lons / CH + 1e-9).astype(int)
    n = int(round(CH / ch.res))
    out = np.zeros((T, T) if ch.kind == "c" else (T, T, 4), "uint8"); hit = np.zeros((T, T), bool)
    for a in np.unique(ka):
        rs = ka == a; A0 = round(a * CH, 2)
        r = np.clip(((A0 + CH - lats[rs]) / ch.res).astype(int), 0, n - 1)
        for b in np.unique(kb):
            k = (A0, round(b * CH, 2))
            if k not in ch.keys: continue
            cs = kb == b
            c = np.clip(((lons[cs] - k[1]) / ch.res).astype(int), 0, n - 1)
            out[np.ix_(rs, cs)] = ch.get(k)[np.ix_(r, c)]; hit[np.ix_(rs, cs)] = True
    return out, hit

def save_c(A, p):
    if not A.any(): return False
    os.makedirs(os.path.dirname(p), exist_ok=True)
    im = Image.fromarray(A, "P"); pal = [0, 0, 0] * 256
    for c, col in PAL.items(): pal[c * 3:c * 3 + 3] = col[:3]
    im.putpalette(pal)
    im.save(p, optimize=True, transparency=bytes([0] + [PAL[i][3] if i in PAL else 0 for i in range(1, 256)])); return True

def pyramid(kind, zmax, zmin, chunks, ext):
    keys = [(round(c[0], 2), round(c[1], 2)) for c in chunks]
    if not keys: return 0
    ch = Chunks(keys, f"{D}/{{0:.2f}}_{{1:.2f}}.png" if kind == "c" else f"{D}/sat/{{0:.2f}}_{{1:.2f}}.webp", IX["res"] if kind == "c" else SX["res"], kind)
    tiles = set()
    for a, b in keys:
        x0, x1 = int(lon2x(b, zmax)), int(lon2x(b + CH, zmax)); y0, y1 = int(lat2y(a + CH, zmax)), int(lat2y(a, zmax))
        tiles |= {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}
    made = {}; n = 0
    for x, y in sorted(tiles, key=lambda t: (t[1] // 4, t[0], t[1])):   # شرائط بعرض قطعة تقريبًا → القطع تنقرا مرة وحدة تقريبًا
        A, hit = render(ch, zmax, x, y)
        if not hit.any(): continue
        p = f"{D}/t/{kind}/{zmax}/{x}/{y}.{ext}"
        if kind == "c":
            if save_c(A, p): made[(x, y)] = A; n += 1
        else:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            a = np.where(hit, A[..., 3] / 255.0, 0).astype("float32")   # شفافية = الأطراف المتلاشية
            if not (a > 0).any(): continue
            rgba = np.dstack([A[..., :3], (a * 235).round().astype("uint8")])
            Image.fromarray(rgba, "RGBA").save(p, quality=68, method=4); made[(x, y)] = (A[..., :3], a); n += 1
    for z in range(zmax - 1, zmin - 1, -1):
        par = {}
        for (x, y), v in made.items(): par.setdefault((x // 2, y // 2), []).append(((x % 2, y % 2), v))
        made = {}
        for (x, y), kids in par.items():
            p = f"{D}/t/{kind}/{z}/{x}/{y}.{ext}"
            if kind == "c":
                M = np.zeros((2 * T, 2 * T), "uint8")
                for (dx, dy), A in kids: M[dy * T:(dy + 1) * T, dx * T:(dx + 1) * T] = np.take(np.array([PRI.get(i, 0) for i in range(256)], "uint8"), A)
                Q = M.reshape(T, 2, T, 2).max((1, 3))
                A = np.take(np.array([INV.get(i, 0) for i in range(256)], "uint8"), Q)
                if save_c(A, p): made[(x, y)] = A; n += 1
            else:
                M = np.zeros((2 * T, 2 * T, 3), "float32"); H = np.zeros((2 * T, 2 * T), "float32")
                for (dx, dy), (A, a) in kids: M[dy * T:(dy + 1) * T, dx * T:(dx + 1) * T] = A; H[dy * T:(dy + 1) * T, dx * T:(dx + 1) * T] = a
                w = H.reshape(T, 2, T, 2).sum((1, 3)); S = (M * H[..., None]).reshape(T, 2, T, 2, 3).sum((1, 3))
                A = (S / np.maximum(w, 1e-6)[..., None]).clip(0, 255).astype("uint8"); a = (w / 4).astype("float32")
                os.makedirs(os.path.dirname(p), exist_ok=True)
                Image.fromarray(np.dstack([A, (a * 235).round().astype("uint8")]), "RGBA").save(p, quality=68, method=4); made[(x, y)] = (A, a); n += 1
    return n

# z12 وأقل بلاطات (ناعمة ومن بعيد)، وفوقها القطع الأصلية (1–4 قطع حولك) — عشان حجم البيانات يبقى معقول على مستوى المملكة
nc = pyramid("c", 12, 7, IX["chunks"], "png")
ns = pyramid("s", 12, 9, SX.get("chunks", []), "webp")
IX["tiles"] = {"c": [7, 12], "s": [9, 12]}
json.dump(IX, open(f"{D}/index.json", "w"), ensure_ascii=False)
print(f"::notice::spring tiles: classify {nc} · satellite {ns}")

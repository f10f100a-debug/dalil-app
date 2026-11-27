"""بقع ربيع كبيرة برا الفياض المسجلة — 27 نوفمبر (أبو مالك: «لو فيه بقعة كبر الفيضة وربيعها قوي… مالها اسم»).
من طبقة الربيع (تصنيف ~20 م): مربعات ~200 م اللي ربعها أو أكثر «متوسط/كثيف» → بقع متصلة → اللي مساحتها ≥ 50 هكتار.
نستبعد: البقع اللي فيها فيضة مسجلة (خلال ~1 كم)، والمزارع (ESA WorldCover فئة 40 — إذا وصلنا لها)، والقطع المخفية أصلًا.
الاسم: وصف من أقرب بلدة/قرية (OSM) — «12 كم شرق الشملي». الناتج <مجلد الطبقة>/blobs.json
python3 tools/fayd/spring_blobs.py <مجلد الطبقة>"""
import json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

D = sys.argv[1]
IX = json.load(open(f"{D}/index.json")); RES, CH = IX["res"], IX["ch"]
PAL = {int(k): tuple(v[:3]) for k, v in IX["pal"].items()}   # 1 خفيف · 2 متوسط · 3 كثيف · 4 شجيرات
B = 10                                   # 10 بكسل = 0.002° ≈ 200 م
CELL = RES * B
FR = float(os.environ.get("BLOB_FRAC", "0.25"))     # المربع «ربيع» إذا ربعه متوسط/كثيف
MIN_HA = float(os.environ.get("BLOB_MIN_HA", "50"))

chunks = [c for c in IX["chunks"]]
la_min = min(c[0] for c in chunks); la_max = max(c[0] for c in chunks) + CH
lo_min = min(c[1] for c in chunks); lo_max = max(c[1] for c in chunks) + CH
NRw, NCw = int(round((la_max - la_min) / CELL)), int(round((lo_max - lo_min) / CELL))
M = np.zeros((NRw, NCw), bool); F23 = np.zeros((NRw, NCw), np.float32); F3 = np.zeros((NRw, NCw), np.float32)
n = int(round(CH / RES)); nb = n // B
for c in chunks:
    p = f"{D}/{c[0]:.2f}_{c[1]:.2f}.png"
    if not os.path.exists(p): continue
    A = np.array(Image.open(p).convert("RGBA"))
    if A.shape[0] != n: continue
    rgb = (A[..., 0].astype(np.int32) << 16) | (A[..., 1].astype(np.int32) << 8) | A[..., 2]; rgb[A[..., 3] == 0] = -1
    k2 = (rgb == (PAL[2][0] << 16 | PAL[2][1] << 8 | PAL[2][2])); k3 = (rgb == (PAL[3][0] << 16 | PAL[3][1] << 8 | PAL[3][2]))
    f2 = k2.reshape(nb, B, nb, B).mean((1, 3)); f3 = k3.reshape(nb, B, nb, B).mean((1, 3))
    r0 = int(round((la_max - (c[0] + CH)) / CELL)); c0 = int(round((c[1] - lo_min) / CELL))
    F23[r0:r0 + nb, c0:c0 + nb] = f2 + f3; F3[r0:r0 + nb, c0:c0 + nb] = f3
M = F23 >= FR
lab, nl = ndimage.label(M, structure=np.ones((3, 3), int))
print("cells", int(M.sum()), "blobs", nl, flush=True)
cell_lat = lambda r: la_max - (r + .5) * CELL
cell_lng = lambda cc: lo_min + (cc + .5) * CELL
# مساحة كل بقعة (هكتار) — المربع يصغر شوي مع خط العرض
rows_idx = np.arange(NRw)
area_row = (CELL * 111320) * (CELL * 111320 * np.cos(np.radians(la_max - (rows_idx + .5) * CELL))) / 1e4
idx = np.arange(1, nl + 1)
area = ndimage.sum(np.broadcast_to(area_row[:, None], M.shape), lab, idx)
keep = set(int(i) for i, a in zip(idx, area) if a >= MIN_HA)
# فياض مسجلة (خلال ~1 كم) → مو بقعة جديدة
S = json.load(open("data/fayd-sites.json")); W = 5
for s in S:
    r = int((la_max - s[1]) / CELL); cc = int((s[2] - lo_min) / CELL)
    if 0 <= r < NRw and 0 <= cc < NCw:
        for L in np.unique(lab[max(0, r - W):r + W + 1, max(0, cc - W):cc + W + 1]): keep.discard(int(L))
objs = ndimage.find_objects(lab)
out = []
for L in sorted(keep):
    sl = objs[L - 1]; sub = lab[sl] == L
    f = F23[sl] * sub; f3 = F3[sl] * sub
    rr, cc = np.unravel_index(np.argmax(f), f.shape)
    pr, pc = sl[0].start + rr, sl[1].start + cc
    ha = float(area[L - 1]); mean = float(f[sub].mean()); dense = float(f3.sum() / max(f.sum(), 1e-6))
    # اللي في وسط بقعة كبيرة (نقطة الأعلى خضرة) — عشان «وديني» يوديك للأخضر نفسه
    out.append({"lat": round(cell_lat(pr), 4), "lng": round(cell_lng(pc), 4), "ha": round(ha), "f": round(mean * 100), "d": round(dense * 100),
                "bb": [round(cell_lat(sl[0].stop), 3), round(cell_lng(sl[1].start), 3), round(cell_lat(sl[0].start), 3), round(cell_lng(sl[1].stop), 3)]})
# داخل المملكة بس (شبكة المناطق 0.25°)، وبدون جبال الحجاز وعسير والسهل الغربي — خضرتها شجر ومدرجات زراعية ثابتة مو ربيع بر
# (نفس الحد اللي يخفي القطع «غير المعقولة» في spring_merge.py)
G = json.load(open("data/region-grid.json"))
def region(la, lo):
    i = int((la - G["lat0"]) / G["r"]); j = int((lo - G["lng0"]) / G["r"])
    if not (0 <= i < G["rows"] and 0 <= j < G["cols"]): return -1
    ch = G["g"][i * G["cols"] + j]; return -1 if ch == "." else ord(ch) - 97
west = lambda la, lo: (lo < 38 and la < 28) or (lo < 42.5 and la < 24.5)
n0 = len(out)
for o in out: o["rg"] = region(o["lat"], o["lng"])
# حدود المملكة الدقيقة (Natural Earth) — شبكة المناطق 0.25° تدخل أطراف الأردن والعراق
SAU = json.load(open("data/sau-boundary.json"))["coordinates"]
def inside(la, lo):
    hit = False
    for poly in SAU:
        ring = poly[0]
        for k in range(len(ring) - 1):
            (x1, y1), (x2, y2) = ring[k], ring[k + 1]
            if (y1 > la) != (y2 > la) and lo < x1 + (la - y1) * (x2 - x1) / (y2 - y1): hit = not hit
    return hit
out = [o for o in out if o["rg"] >= 0 and not west(o["lat"], o["lng"]) and inside(o["lat"], o["lng"])]
print("inside KSA, not western highlands:", len(out), "of", n0, flush=True)
out.sort(key=lambda o: -o["ha"])
print("big blobs (≥%d ha, outside fayd)" % MIN_HA, len(out), flush=True)

# المزارع: ESA WorldCover (فئة 40) حول البقعة — إذا ما وصلنا للخدمة نكمل بدونها ونكتب ملاحظة
farm_chk = 0
try:
    import rasterio, urllib.request
    from rasterio.windows import from_bounds
    from rasterio.enums import Resampling
    sys.path.insert(0, os.path.dirname(__file__)); import s2
    from collections import defaultdict
    groups = defaultdict(list)
    for o in out: groups[(math.floor(o["lat"] / 3) * 3, math.floor(o["lng"] / 3) * 3)].append(o)
    for (la0, lo0), L in groups.items():
        body = {"collections": ["esa-worldcover"], "bbox": [lo0 + .5, la0 + .5, lo0 + 2.5, la0 + 2.5], "limit": 4, "sortby": [{"field": "datetime", "direction": "desc"}]}
        with urllib.request.urlopen(urllib.request.Request(s2.STAC, data=json.dumps(body).encode(), headers={"content-type": "application/json", **s2.UA}), timeout=120) as r:
            items = json.load(r)["features"]
        if not items: continue
        href = items[0]["assets"]["map"]["href"]
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3"), rasterio.open(href + "?" + s2.token(href)) as src:
            for o in L:
                s_, w_, n_, e_ = o["bb"]
                try:
                    A = src.read(1, window=from_bounds(w_, s_, e_, n_, src.transform), out_shape=(200, 200), resampling=Resampling.nearest)
                    v = A[A > 0]
                    if v.size: o["crop"] = round(float((v == 40).mean()) * 100); farm_chk += 1
                except Exception: pass
except Exception as e:
    print("::warning::worldcover check skipped:", str(e)[:120], flush=True)
farms = [o for o in out if o.get("crop", 0) >= 25]
out = [o for o in out if o.get("crop", 0) < 25]

# الاسم: أقرب بلدة/قرية (OSM)
P = json.load(open(os.path.join(os.path.dirname(__file__), "osm-places.json")))["p"]
PA = np.array([[p[1], p[2]] for p in P])
DIRS = ["شمال", "شمال شرق", "شرق", "جنوب شرق", "جنوب", "جنوب غرب", "غرب", "شمال غرب"]
for o in out:
    dla = (PA[:, 0] - o["lat"]) * 111.32; dlo = (PA[:, 1] - o["lng"]) * 111.32 * math.cos(math.radians(o["lat"]))
    d2 = dla * dla + dlo * dlo
    # البلدات/القرى أول (أوضح للناس) — الهجر لو أقرب بكثير
    k = int(np.argmin(d2)); kk = [i for i in np.argsort(d2)[:40] if P[i][3] <= 2]
    if kk and d2[kk[0]] < (2.2 ** 2) * d2[k] + 25: k = int(kk[0])
    km = math.sqrt(d2[k]); ang = (math.degrees(math.atan2(-dlo[k], -dla[k])) + 360) % 360
    o["name"] = (f"{km:.0f} كم {DIRS[int((ang + 22.5) // 45) % 8]} {P[k][0]}" if km >= 1.5 else f"عند {P[k][0]}")
out = out[:600]
json.dump({"v": 1, "asof": IX.get("asof"), "min_ha": MIN_HA, "frac": FR, "farm_checked": farm_chk,
           "regions": G["regions"], "b": [[o["lat"], o["lng"], o["ha"], o["f"], o["d"], o["name"], o["rg"]] for o in out]}, open(f"{D}/blobs.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(f"::notice::spring blobs: {len(out)} (≥{MIN_HA:.0f} ha, outside fayd) · farms dropped {len(farms)} · biggest: " +
      " · ".join(f"{o['name']} {o['ha']} ha" for o in out[:6]), flush=True)

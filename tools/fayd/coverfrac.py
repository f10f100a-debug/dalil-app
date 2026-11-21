"""21 نوفمبر (الهرارة والغرب الشمالي: «شجيرات كثيفة قديمة» ورّقت بعد المطر وطلعت ربيع): غطاء الأرض (ESA WorldCover) داخل كل فيضة — شجر 10، شجيرات 20، عشب 30، جرداء 60
نسبة الأراضي الزراعية (ESA WorldCover، فئة 40) داخل كل فيضة — ~600 م حول مركزها (أوسع شوي من مربع القياس 410 م).
13 نوفمبر (فياض مريحات): الخضرة اللي حسبناها جت من محاور زراعية قديمة/مجاورة داخل حدود الفيضة.
الناتج data/fayd-crop.json: {"v":1, "half_m":300, "crop": {رقم الفيضة: نسبة 0–100}} — يُحسب مرة (الخريطة ثابتة 2021)."""
import json, math, sys, os
from collections import defaultdict
import numpy as np, rasterio
from rasterio.windows import from_bounds
from rasterio.enums import Resampling
sys.path.insert(0, os.path.dirname(__file__))
import s2, urllib.request

SITES = json.load(open("data/fayd-sites.json"))
HALF = 300.0
def box(la, lo):
    dla = HALF / 111320.0; dlo = HALF / (111320.0 * math.cos(math.radians(la)))
    return lo - dlo, la - dla, lo + dlo, la + dla
# بلاطات WorldCover 3°×3°
groups = defaultdict(list)
for i, s in enumerate(SITES): groups[(math.floor(s[1] / 3) * 3, math.floor(s[2] / 3) * 3)].append(i)
out = {}
env = lambda: rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2")
for (la0, lo0), ids in sorted(groups.items()):
    body = {"collections": ["esa-worldcover"], "bbox": [lo0 + .5, la0 + .5, lo0 + 2.5, la0 + 2.5], "limit": 4, "sortby": [{"field": "datetime", "direction": "desc"}]}
    try:
        with urllib.request.urlopen(urllib.request.Request(s2.STAC, data=json.dumps(body).encode(), headers={"content-type": "application/json", **s2.UA}), timeout=120) as r:
            items = json.load(r)["features"]
    except Exception as e:
        print("stac fail", la0, lo0, e, flush=True); continue
    if not items: continue
    href = items[0]["assets"]["map"]["href"]
    try:
        with env(), rasterio.open(href + "?" + s2.token(href)) as src:
            for i in ids:
                w, so, e_, n = box(SITES[i][1], SITES[i][2])
                try:
                    A = src.read(1, window=from_bounds(w, so, e_, n, src.transform), out_shape=(60, 60), resampling=Resampling.nearest)
                    v = A[A > 0]
                    if v.size: out[i] = [round(float((v == c).mean()) * 100) for c in (10, 20, 30, 60, 40)]
                except Exception: pass
    except Exception as e:
        print("tile fail", la0, lo0, e, flush=True)
    print("tile", la0, lo0, len(ids), "done", len(out), flush=True)
json.dump({"v": 1, "half_m": HALF, "cls": [10, 20, 30, 60, 40], "cover": out}, open("data/fayd-cover.json", "w"), separators=(",", ":"))
hi = sorted(((v[1], SITES[int(k)][0]) for k, v in out.items() if v[1] >= 30), reverse=True)
print(f"::notice::fayd cover: {len(out)} sites, {len(hi)} with ≥30% shrubland: " + " · ".join(f"{n} {v}%" for v, n in hi[:40])[:3000])

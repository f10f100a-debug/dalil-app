# حالة الفياض: يقرأ صور MODIS (MOD13Q1 + MYD13Q1، 250 م، كل 8 أيام) من Microsoft Planetary Computer
# ويحسب لكل فيضة: خضرتها الآن مقارنة بحالتها في الصيف (الجفاف) وبذروة ربيعها المعتادة.
#   python3 update.py baseline   ← مرة وحدة (أو سنويًا): المعتاد لكل فيضة → data/fayd-base.json
#   python3 update.py            ← كل أسبوع: آخر صورة → data/fayd.json
import json, sys, time, statistics as st, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
import numpy as np, rasterio
from rasterio.warp import transform

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
COLS = ["modis-13Q1-061"]
BBOX = [34.5, 16, 56, 32.5]
SITES = json.load(open("data/fayd-sites.json"))
LAT = [s[1] for s in SITES]; LNG = [s[2] for s in SITES]
_tok = {"t": None, "at": 0}

def token():
    if not _tok["t"] or time.time() - _tok["at"] > 1800:
        with urllib.request.urlopen("https://planetarycomputer.microsoft.com/api/sas/v1/token/modis-13Q1-061", timeout=60) as r:
            _tok["t"] = json.load(r)["token"]; _tok["at"] = time.time()
    return _tok["t"]

def search(dt):
    for k in range(4):
        try: return _search(dt)
        except Exception as e:
            print("search retry", dt, str(e)[:120], flush=True); time.sleep(10 * (k + 1))
    raise RuntimeError("search failed " + dt)

def _search(dt):
    items, body = [], {"collections": COLS, "bbox": BBOX, "datetime": dt, "limit": 100}
    url = STAC
    while url:
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r: j = json.load(r)
        items += j["features"]
        nxt = [l for l in j.get("links", []) if l.get("rel") == "next"]
        url, body = (nxt[0]["href"], nxt[0].get("body", body)) if nxt else (None, None)
    return items

def sample(item):
    """قيمة كل فيضة داخل هذي البلاطة: الربيع الأعلى (المئين 75) في مربع 5×5 بكسل (~1.2 كم)"""
    for k in range(4):
        try:
            href = item["assets"]["250m_16_days_NDVI"]["href"] + "?" + token()
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3"):
                with rasterio.open(href) as src:
                    xs, ys = transform("EPSG:4326", src.crs, LNG, LAT)
                    arr = src.read(1)
                    inv = ~src.transform
                    out = {}
                    for i, (x, y) in enumerate(zip(xs, ys)):
                        c, r = inv * (x, y); c, r = int(c), int(r)
                        if 2 <= r < arr.shape[0] - 2 and 2 <= c < arr.shape[1] - 2:
                            w = arr[r - 2:r + 3, c - 2:c + 3].ravel()
                            w = w[w > -2000]
                            if w.size >= 6: out[i] = float(np.percentile(w, 75)) / 1e4
                    return out
        except Exception as e:
            print("retry", item["id"], str(e)[:100], flush=True); time.sleep(5 * (k + 1))
    return {}

def has_sites(it):
    w, so, e, n = it["bbox"]
    return any(so <= la <= n and w <= lo <= e for la, lo in zip(LAT, LNG))

def by_date(items):
    """نجمع البلاطات حسب تاريخ الصورة (Terra وAqua كل واحد بتاريخه) — بس اللي فيها فياض"""
    g = {}
    for it in items:
        if has_sites(it): g.setdefault(it["properties"]["start_datetime"][:10], []).append(it)
    return dict(sorted(g.items()))

def run_dates(groups):
    res = {}
    flat = [(d, it) for d, its in groups.items() for it in its]
    with ThreadPoolExecutor(6) as ex:
        for (d, it), vals in zip(flat, ex.map(lambda x: sample(x[1]), flat)):
            res.setdefault(d, {}).update(vals)
            print(d, it["id"][:30], len(vals), flush=True)
    return res

import traceback, atexit
T0 = time.time()
def _fail(t, v, tb):
    print("::error::" + (repr(v) + " | " + " / ".join(traceback.format_tb(tb)[-2:])).replace("\n", " ")[:900], flush=True)
sys.excepthook = _fail
atexit.register(lambda: print(f"::notice::time {round(time.time() - T0)}s", flush=True))

if len(sys.argv) > 1 and sys.argv[1] == "baseline":
    peaks = {i: [] for i in range(len(SITES))}; dry = {i: [] for i in range(len(SITES))}
    for y in range(2016, 2026):
        g = by_date(search(f"{y}-02-01T00:00:00Z/{y}-04-01T00:00:00Z"))
        res = run_dates(g)
        print(f"::notice::{y} dates {len(g)} tiles {sum(len(v) for v in g.values())} sites {len(set().union(*[set(r) for r in res.values()]) if res else 0)} t={round(time.time() - T0)}s", flush=True)
        for i in peaks:
            v = [r[i] for r in res.values() if i in r]
            if v: peaks[i].append(max(v))
    for y in (2023, 2024, 2025):
        res = run_dates(by_date(search(f"{y}-08-01T00:00:00Z/{y}-09-20T00:00:00Z")))
        for i in dry:
            v = [r[i] for r in res.values() if i in r]
            if v: dry[i].append(st.median(v))
    base = []
    for i in range(len(SITES)):
        p, d = peaks[i], dry[i]
        if not p or not d: base.append(None); continue
        base.append([round(st.median(d), 3), round(st.median(p), 3), round(max(p), 3)])
    json.dump({"made": time.strftime("%Y-%m-%d"), "base": base}, open("data/fayd-base.json", "w"), separators=(",", ":"))
    print("baseline done", sum(b is not None for b in base))
    sys.exit()

# ---- التحديث الأسبوعي: آخر تاريخ تغطي صوره المنطقة كلها ----
base = json.load(open("data/fayd-base.json"))["base"]
now = time.time()
items = search(time.strftime("%Y-%m-%dT00:00:00Z", time.gmtime(now - 40 * 86400)) + "/" + time.strftime("%Y-%m-%dT23:59:59Z", time.gmtime(now)))
groups = by_date(items)
need = max(len(v) for v in groups.values())
dates = [d for d, v in groups.items() if len(v) >= need - 1][-2:]  # آخر صورتين (Terra وAqua) لتقليل أثر الغيم
res = run_dates({d: groups[d] for d in dates})
rows = []
for i, s in enumerate(SITES):
    b = base[i]; v = [r[i] for r in res.values() if i in r]
    if not b or not v: continue
    dry, med, top = b
    if dry > 0.25: continue                          # خضراء حتى في الصيف = مزارع أو شجر كثيف
    cur = max(v); g = cur - dry
    span = max(0.03, med - dry)
    idx = g / span
    st_ = 0 if g < 0.02 else 1 if idx < 0.6 else 2 if idx < 1.2 else 3 if idx < 2 else 4
    rows.append([i, round(g * 1000), st_])
rows.sort(key=lambda r: -r[1])
json.dump({"asof": dates[-1] if dates else "", "dates": dates, "n": len(SITES), "rows": rows},
          open("data/fayd.json", "w"), separators=(",", ":"))
print("asof", dates, "rows", len(rows), "green", sum(r[2] > 0 for r in rows))

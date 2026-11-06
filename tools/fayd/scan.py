"""فياض بدون اسم: مسح أسبوعي بصور Sentinel-2 (Planetary Computer، مجاني) للبقع اللي خضرت هالموسم وما حولها فيضة من القائمة.
لكل بلاطة (110 كم): صورة «الحين» (آخر 12 يوم، دمج أحدث صورتين صافيتين) مقابل «الجفاف» (25 أغسطس–5 أكتوبر، أعلى خضرة من صورتين).
بكسل 80 م. البقعة الجديدة: NDVI الحين ≥ 0.16 وزاد 0.07 فأكثر، وكانت جرداء بالجفاف (< 0.2).
نشيل: المزارع والعمران والمياه (ESA WorldCover)، البقع الخضراء جدًا الحين (مزارع قمح جديدة)، وأي بقعة خلال 2 كم من فيضة لها اسم.
يكتب data/fayd-new.json (أو fayd-new-pending.json إذا تغيّر العدد كثير — للمراجعة)."""
import json, math, os, sys, time, datetime as dtm
from concurrent.futures import ThreadPoolExecutor
import numpy as np, rasterio
from rasterio.enums import Resampling
from rasterio.warp import transform as wtransform
from scipy import ndimage
sys.path.insert(0, os.path.dirname(__file__))
import s2

BBOX = [37.5, 24.5, 50.0, 32.3]
TEST = os.environ.get("SCAN_ONLY", "")   # نقاط lat:lng للتجربة: نمسح البلاطات اللي تغطيها بس          # الجوف والشمال وحائل والقصيم والشرقية وشمال الرياض
PX = 1372                                # 10980/8 → 80 م
HA = 0.64                                # مساحة البكسل بالهكتار
MIN_HA = 20
NOW_MIN = float(os.environ.get("SCAN_NOW") or 0.13)   # بداية الربيع: NDVI ‏0.13–0.2 على 80 م
D_MIN = float(os.environ.get("SCAN_D") or 0.05)
T0 = time.time()
today = dtm.date.today()
y = today.year if today.month >= 8 else today.year - 1

def env():
    return rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2")

def read_ndvi(it):
    off = 1000 if str(it["properties"].get("s2:processing_baseline", "00.00")) >= "04.00" else 0
    h = {b: it["assets"][b]["href"] for b in ("B04", "B08", "SCL")}
    for k in range(3):
        try:
            with env():
                with rasterio.open(h["B04"] + "?" + s2.token(h["B04"])) as r, rasterio.open(h["B08"] + "?" + s2.token(h["B08"])) as n, \
                     rasterio.open(h["SCL"] + "?" + s2.token(h["SCL"])) as c:
                    R = r.read(1, out_shape=(PX, PX), resampling=Resampling.average).astype("float32")
                    N = n.read(1, out_shape=(PX, PX), resampling=Resampling.average).astype("float32")
                    S = c.read(1, out_shape=(PX, PX), resampling=Resampling.nearest)
                    tr = r.transform * r.transform.scale(r.width / PX, r.height / PX); crs = r.crs
            ok = np.isin(S, (4, 5)) & (R > 0) & (N > 0)
            R = np.clip(R - off, 1, None); N = np.clip(N - off, 1, None)
            nd = np.where(ok, (N - R) / (N + R), np.nan).astype("float32")
            water = S == 6
            return nd, water, tr, crs
        except Exception as e:
            print("read retry", it["id"], str(e)[:120], flush=True); time.sleep(5 * (k + 1))
    return None

def worldcover(tr, crs):
    """فئات ESA WorldCover على نفس شبكة البلاطة (40 زراعة، 50 عمران، 80 مياه، 90 أراضي رطبة)"""
    import urllib.request
    from rasterio.windows import from_bounds
    cols, rows = np.meshgrid(np.arange(PX) + .5, np.arange(PX) + .5)
    xs = tr.c + tr.a * cols; ys = tr.f + tr.e * rows
    lo, la = wtransform(crs, "EPSG:4326", xs.ravel().tolist(), ys.ravel().tolist())
    lo = np.array(lo).reshape(PX, PX); la = np.array(la).reshape(PX, PX)
    bb = [float(lo.min()), float(la.min()), float(lo.max()), float(la.max())]
    out = np.zeros((PX, PX), "uint8")
    try:
        body = {"collections": ["esa-worldcover"], "bbox": bb, "limit": 20, "sortby": [{"field": "datetime", "direction": "desc"}]}
        with urllib.request.urlopen(urllib.request.Request(s2.STAC, data=json.dumps(body).encode(), headers={"content-type": "application/json", **s2.UA}), timeout=120) as r:
            items = json.load(r)["features"]
        seen = set()
        for it in items:
            key = tuple(round(v, 2) for v in it["bbox"])
            if key in seen: continue
            seen.add(key)
            w, so, e, n = it["bbox"]
            a0, b0, a1, b1 = max(w, bb[0]), max(so, bb[1]), min(e, bb[2]), min(n, bb[3])
            if a0 >= a1 or b0 >= b1: continue
            href = it["assets"]["map"]["href"]
            with env(), rasterio.open(href + "?" + s2.token(href)) as src:
                win = from_bounds(a0, b0, a1, b1, src.transform)
                hh = max(1, int(round((b1 - b0) / 0.0007))); ww = max(1, int(round((a1 - a0) / 0.0007)))
                A = src.read(1, window=win, out_shape=(hh, ww), resampling=Resampling.mode)
            inb = (lo >= a0) & (lo < a1) & (la >= b0) & (la < b1) & (out == 0)
            ci = np.clip(((lo[inb] - a0) / (a1 - a0) * ww).astype(int), 0, ww - 1)
            ri = np.clip(((b1 - la[inb]) / (b1 - b0) * hh).astype(int), 0, hh - 1)
            out[inb] = A[ri, ci]
    except Exception as e:
        print("worldcover skipped", str(e)[:150], flush=True)
    return out

def composite(items, how):
    """how=min: أقل قيمة من صورتين صافيتين على الأقل (بقعة تخضر بصورة وحدة = غالبًا غبار/صخر بركاني مو نبات)
       how=max: أعلى قيمة من كل صور الجفاف (أي خضرة بالصيف = مزرعة/شجر/صخر يتذبذب)"""
    stack = []; water = None; geo = None
    for it in items:
        r = read_ndvi(it)
        if r is None: continue
        nd, w, tr, crs = r
        if geo is None: geo = (tr, crs)
        stack.append(nd); water = w if water is None else (water | w)
    if not stack: return None, None, None
    A = np.stack(stack)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if how == "min":
            v = np.nanmin(A, 0); v[np.isfinite(A).sum(0) < 2] = np.nan
        else:
            v = np.nanmax(A, 0)
    return v, water, geo

SITES = json.load(open("data/fayd-sites.json"))
DP = json.load(open("data/desert-places.json"))
LAND = [(p[0], p[1], p[2]) for p in DP["p"] if DP["cats"][p[4]] in ("معلم رئيسي", "معلم", "جبل", "مورد ماء", "نفود", "حرة")]
NAMED = [(s[0], s[1], s[2]) for s in SITES if s]

def km(a, b, c, d): return math.hypot((a - c) * 111.2, (b - d) * 111.2 * math.cos(math.radians(a)))
DIRS = ["شمال", "شمال شرق", "شرق", "جنوب شرق", "جنوب", "جنوب غرب", "غرب", "شمال غرب"]
def label(la, lo):
    best = None
    for nm, a, b in NAMED + LAND:
        if abs(a - la) > .6 or abs(b - lo) > .7: continue
        d = km(la, lo, a, b)
        if not best or d < best[0]: best = (d, nm, a, b)
    if not best: return "خضرة جديدة", ""
    d, nm, a, b = best
    if d < 1.5: return "خضرة جديدة · قرب " + nm, nm
    ang = (math.degrees(math.atan2((lo - b) * math.cos(math.radians(la)), la - a)) + 360) % 360
    return f"خضرة جديدة · {round(d)} كم {DIRS[int((ang + 22.5) // 45) % 8]} {nm}", nm

G = json.load(open("data/region-grid.json"))
def in_ksa(la, lo):
    i = int((la - G["lat0"]) // G["r"]); j = int((lo - G["lng0"]) // G["r"])
    if i < 0 or j < 0 or i >= G["rows"] or j >= G["cols"]: return False
    return 0 <= ord(G["g"][i * G["cols"] + j]) - 97 < len(G["regions"])

def near_named(la, lo, r=2.0):
    return any(abs(a - la) < .03 and abs(b - lo) < .03 and km(la, lo, a, b) < r for _, a, b in NAMED)

def do_tile(tile, now_items, dry_items):
    now, water, geo = composite(now_items[:3], "min")
    if now is None: return []
    dry, w2, g2 = composite(dry_items[:4], "max")
    if dry is None: return []
    tr, crs = geo
    wc = worldcover(tr, crs)
    d = now - dry
    m = (now >= NOW_MIN) & (d >= D_MIN) & (dry < 0.2) & ~water & ~w2 & ~np.isin(wc, (40, 50, 80, 90, 95))
    m = ndimage.binary_opening(m, iterations=1)
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    print(f"::notice::tile {tile}: valid {int(np.isfinite(now).sum())} new-green px {int(m.sum())} patches {n}", flush=True)
    if not n: return []
    idx = np.arange(1, n + 1)
    cnt = ndimage.sum(m, lab, idx)
    out = []
    for k in idx[cnt * HA >= MIN_HA]:
        sel = lab == k
        vals = now[sel]
        p95 = float(np.nanpercentile(vals, 95))
        if p95 > 0.45: continue                       # خضرة قوية مبكرة = زراعة جديدة غالبًا
        rr, cc = np.nonzero(sel)
        ww = d[sel]
        r0 = float((rr * ww).sum() / ww.sum()); c0 = float((cc * ww).sum() / ww.sum())
        x, yv = tr * (c0 + .5, r0 + .5)
        lo, la = wtransform(crs, "EPSG:4326", [x], [yv]); lo, la = lo[0], la[0]
        out.append([round(la, 4), round(lo, 4), round(float(sel.sum()) * HA), round(float(np.nanmean(ww)) * 1000), round(float(np.nanmean(vals)), 3), round(p95, 3), tile])
    return out

def main():
    print("searching…", flush=True)
    nowi = s2.search(BBOX, f"{(today - dtm.timedelta(days=12)).isoformat()}T00:00:00Z/{today.isoformat()}T23:59:59Z", 30)
    dryi = s2.search(BBOX, f"{y}-08-25T00:00:00Z/{y}-10-05T23:59:59Z", 10)
    g = lambda its: {t: sorted([i for i in its if i["properties"].get("s2:mgrs_tile") == t], key=lambda i: (i["properties"]["eo:cloud_cover"] > 5, i["properties"]["datetime"]), reverse=False) for t in {i["properties"].get("s2:mgrs_tile") for i in its}}
    N = {t: sorted(v, key=lambda i: i["properties"]["datetime"], reverse=True) for t, v in g(nowi).items()}
    D = {t: sorted(v, key=lambda i: i["properties"]["eo:cloud_cover"]) for t, v in g(dryi).items()}
    tiles = sorted(set(N) & set(D))
    lim = int(os.environ.get("SCAN_TILES", "0") or 0)
    if TEST:   # نقاط lat:lng → البلاطات اللي تغطيها
        pts = [tuple(map(float, x.split(":"))) for x in TEST.split(",") if ":" in x]
        cov = lambda t: any(i["bbox"][0] + .05 <= lo <= i["bbox"][2] - .05 and i["bbox"][1] + .05 <= la <= i["bbox"][3] - .05 for i in N[t][:1] for la, lo in pts)
        tiles = [t for t in tiles if cov(t)]
    elif lim: tiles = tiles[:lim]
    print(f"::notice::scan tiles {len(tiles)} (now items {len(nowi)}, dry items {len(dryi)})", flush=True)
    found = []
    with ThreadPoolExecutor(6) as ex:
        for k, res in enumerate(ex.map(lambda t: (t, do_tile(t, N[t], D[t])), tiles)):
            t, r = res; found += r
            if k % 10 == 0: print("tile", k, "/", len(tiles), t, len(r), round(time.time() - T0), "s", flush=True)
    # دمج المكرر بين البلاطات + شيل القريب من فيضة لها اسم
    found.sort(key=lambda r: -r[2] * r[3])
    rows = []
    for r in found:
        if not in_ksa(r[0], r[1]) or near_named(r[0], r[1]): continue
        if any(km(r[0], r[1], q[0], q[1]) < 2 for q in rows): continue
        rows.append(r)
    rows = rows[:400]
    out = []
    for la, lo, ha, dg, mean, p95, tile in rows:
        lb, ref = label(la, lo)
        out.append([la, lo, ha, dg, lb])
    nowdate = max((i["properties"]["datetime"][:10] for i in nowi), default=today.isoformat())
    res = {"asof": nowdate, "made": today.isoformat(), "n": len(out), "rows": out}
    try: prev = json.load(open("data/fayd-new.json"))
    except Exception: prev = None
    pn = prev["n"] if prev else 0
    held = "publish" not in sys.argv[1:] and (prev is None or (max(pn, len(out)) >= 10 and abs(len(out) - pn) > 0.5 * max(pn, 1)))
    fn = "data/fayd-new-pending.json" if held else "data/fayd-new.json"
    json.dump(res, open(fn, "w"), ensure_ascii=False, separators=(",", ":"))
    if held:
        open("data/fayd-new-qa.md", "w").write(f"فياض بدون اسم {nowdate}: العدد {pn} → {len(out)} — انحفظ في {fn} للمراجعة.\n\n" + "\n".join(f"- {r[4]} · {r[2]} هكتار · زيادة {r[3]} · {r[0]},{r[1]}" for r in out[:80]))
    print(f"::notice::new green patches {len(out)} (raw {len(found)}) → {fn} t={round(time.time() - T0)}s", flush=True)
    from collections import Counter
    print("::notice::top: " + " · ".join(f"{r[4]} ({r[2]} ه)" for r in out[:40])[:3000], flush=True)

main()

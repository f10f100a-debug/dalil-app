"""طبقة الربيع الدقيقة (21 نوفمبر، تجربة dalil_lab_spring): وين اخضرّت الأرض بعد المطر — فيضة أو مو فيضة.
لكل بكسل 20 م: خضرة الحين (أقل قراءة من آخر صورتين صافيتين خلال 14 يوم) ناقص وسيط الصيف لنفس البكسل.
العشب الصغير يرفعها 0.03–0.05 بس، والصيف ثابت (±0.005) — فالفرق ≥0.03 = نبات جديد.
بعدها مربعات ~100 م (0.001°): نسبة البكسلات اللي اخضرّت.
- الأماكن اللي أغلبها غطاء دائم بخريطة ESA WorldCover (شجر/شجيرات/عشب معمّر ≥50٪) → لون ثاني «شجيرات اخضرّت» (الهرارة والغرب الشمالي)
- زراعة/مباني/ماء → تنشال. وسيط الصيف ≥0.15 (سقي/شجر) → ينشال.
الناتج: data/spring/{lat}_{lng}.png (مربع 1°×1°، 1000×1000) + data/spring/index.json
SPRING_BBOX="غرب,جنوب,شرق,شمال" """
import os, sys, json, time, math, datetime as dtm
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, rasterio, s2, urllib.request
from rasterio.warp import reproject, transform_bounds
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

T0 = time.time()
today = dtm.date.today(); y = today.year
BBOX = [float(x) for x in (os.environ.get("SPRING_BBOX") or "43.5,28.0,45.5,29.5").split(",")]
RES = 0.001; N = 1000
D_MIN = float(os.environ.get("SPRING_D") or 0.03)
OUT = "data/spring"; os.makedirs(OUT, exist_ok=True)
env = lambda: rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="3")
S = 5490   # 20 م

def read(it):
    off = 1000 if str(it["properties"].get("s2:processing_baseline", "00.00")) >= "04.00" else 0
    h = {b: it["assets"][b]["href"] for b in ("B04", "B08", "SCL")}
    for k in range(3):
        try:
            with env():
                with rasterio.open(h["B04"] + "?" + s2.token(h["B04"])) as R, rasterio.open(h["B08"] + "?" + s2.token(h["B08"])) as Nn, \
                     rasterio.open(h["SCL"] + "?" + s2.token(h["SCL"])) as Sc:
                    r = R.read(1, out_shape=(S, S), resampling=Resampling.average).astype("float32")
                    n = Nn.read(1, out_shape=(S, S), resampling=Resampling.average).astype("float32")
                    sc = Sc.read(1, out_shape=(S, S))
                    tr = Sc.transform if Sc.width == S else R.transform * R.transform.scale(R.width / S, R.height / S)
                    ok = np.isin(sc, (4, 5)) & (r > off) & (n > off); del sc
                    r -= off; n -= off
                    nd = np.where(ok, (n - r) / np.maximum(n + r, 1), np.nan).astype("float32")
                    return it["properties"]["datetime"][:10], nd, tr, R.crs
        except Exception as e:
            print("retry", it["id"], str(e)[:120], flush=True); time.sleep(6 * (k + 1))
    return None

def tile_delta(tile, now_items, dry_items):
    now_items = sorted(now_items, key=lambda i: i["properties"]["datetime"], reverse=True)[:5]
    with ThreadPoolExecutor(5) as ex: nows = [x for x in ex.map(read, now_items) if x]
    if not nows: return None
    v1 = np.full((S, S), np.nan, "float32"); v2 = v1.copy(); dates = []
    for d, nd, tr, crs in nows:
        f1 = np.isnan(v1) & np.isfinite(nd); f2 = ~f1 & np.isnan(v2) & np.isfinite(nd)
        if f1.any() or f2.any(): dates.append(d)
        v1[f1] = nd[f1]; v2[f2] = nd[f2]
        if np.isfinite(v2).mean() > .97: break
    now = np.where(np.isfinite(v2), np.fmin(v1, v2), np.nan); del v1, v2, nows
    with ThreadPoolExecutor(5) as ex: drys = [x for x in ex.map(read, dry_items) if x]
    if len(drys) < 2: return None
    dry = np.nanmedian(np.stack([x[1] for x in drys]), 0); del drys
    ok = np.isfinite(now) & np.isfinite(dry) & (dry < 0.15)
    g = np.where(ok, ((now - dry) >= D_MIN).astype("float32"), np.nan)
    dl = np.where(ok, now - dry, np.nan).astype("float32")
    print(f"tile {tile}: now {dates} dry {len(dry_items)} green {round(100 * float(np.nanmean(g)), 2)}% t={round(time.time() - T0)}s", flush=True)
    return g, dl, tr, crs, dates

def worldcover(la0, lo0):
    body = {"collections": ["esa-worldcover"], "bbox": [lo0 + .3, la0 + .3, lo0 + .7, la0 + .7], "limit": 4, "sortby": [{"field": "datetime", "direction": "desc"}]}
    for k in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(s2.STAC, data=json.dumps(body).encode(), headers={"content-type": "application/json", **s2.UA}), timeout=120) as r:
                items = json.load(r)["features"]
            href = items[0]["assets"]["map"]["href"]
            with env(), rasterio.open(href + "?" + s2.token(href)) as src:
                A = src.read(1, window=from_bounds(lo0, la0, lo0 + 1, la0 + 1, src.transform), out_shape=(12000, 12000), resampling=Resampling.nearest)
            blk = lambda m: m.reshape(N, 12, N, 12).mean((1, 3))
            return blk(np.isin(A, (10, 20, 30))), blk(np.isin(A, (40, 50, 80)))
        except Exception as e:
            print("worldcover retry", la0, lo0, str(e)[:120], flush=True); time.sleep(8)
    return np.zeros((N, N)), np.zeros((N, N))

def main():
    w, s_, e, n = BBOX
    nowi = s2.search(BBOX, f"{(today - dtm.timedelta(days=14)).isoformat()}T00:00:00Z/{today.isoformat()}T23:59:59Z", 40)
    dryi = s2.search(BBOX, f"{y}-07-20T00:00:00Z/{y}-10-05T23:59:59Z", 5)
    by = lambda its: {t: [i for i in its if i["properties"].get("s2:mgrs_tile") == t] for t in {i["properties"].get("s2:mgrs_tile") for i in its}}
    NI, DI = by(nowi), by(dryi)
    tiles = sorted(set(NI) & set(DI))
    print(f"::notice::spring layer bbox {BBOX} tiles {len(tiles)}", flush=True)
    chunks = {(la, lo): [np.full((N, N), np.nan, "float32"), np.full((N, N), np.nan, "float32")]
              for la in range(math.floor(s_), math.ceil(n)) for lo in range(math.floor(w), math.ceil(e))}
    alld = set()
    for t in tiles:
        full = sorted([i for i in DI[t] if i["properties"].get("s2:nodata_pixel_percentage", 0) <= 5], key=lambda i: i["properties"]["datetime"])
        dry = full[::max(1, len(full) // 5)][:5] or DI[t][:5]
        r = tile_delta(t, NI[t], dry)
        if r is None: continue
        g, dl, tr, crs, dates = r; alld |= set(dates)
        tb = transform_bounds(crs, "EPSG:4326", *rasterio.transform.array_bounds(S, S, tr))
        for (la, lo), (G, DL) in chunks.items():
            if tb[0] > lo + 1 or tb[2] < lo or tb[1] > la + 1 or tb[3] < la: continue
            dt = from_origin(lo, la + 1, RES, RES)
            for src, dst in ((g, G), (dl, DL)):
                tmp = np.full((N, N), np.nan, "float32")
                reproject(src, tmp, src_transform=tr, src_crs=crs, dst_transform=dt, dst_crs="EPSG:4326", resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan)
                np.fmax(dst, tmp, out=dst)
        del g, dl
    idx = []
    PAL = {1: (200, 230, 110, 150), 2: (108, 194, 74, 190), 3: (34, 139, 58, 215), 4: (176, 140, 80, 150)}
    for (la, lo), (G, DL) in sorted(chunks.items()):
        if not np.isfinite(G).any(): continue
        veg, man = worldcover(la, lo)
        f = np.nan_to_num(G)
        cls = np.zeros((N, N), "uint8")
        cls[f >= .15] = 1; cls[f >= .3] = 2; cls[(f >= .5) & (np.nan_to_num(DL) >= .06)] = 3
        # بقعة وحدة معزولة (100 م) = غالبًا تشويش
        m = cls > 0; nb = sum(np.roll(np.roll(m, a, 0), b, 1) for a in (-1, 0, 1) for b in (-1, 0, 1))
        cls[nb < 2] = 0
        cls[(cls > 0) & (veg >= .5)] = 4
        cls[man >= .3] = 0
        if not cls.any(): continue
        img = np.zeros((N, N, 4), "uint8")
        for c, col in PAL.items(): img[cls == c] = col
        Image.fromarray(img, "RGBA").save(f"{OUT}/{la}_{lo}.png", optimize=True)
        cnt = [int((cls == c).sum()) for c in (1, 2, 3, 4)]
        idx.append([la, lo, cnt]); print("chunk", la, lo, cnt, flush=True)
    old = {}
    try: old = json.load(open(f"{OUT}/index.json"))
    except Exception: pass
    keep = {(c[0], c[1]): c for c in old.get("chunks", []) if not (w <= c[1] + .5 <= e and s_ <= c[0] + .5 <= n)}
    for c in idx: keep[(c[0], c[1])] = c
    json.dump({"v": 1, "asof": max(alld) if alld else today.isoformat(), "res": RES, "pal": {str(k): list(v) for k, v in PAL.items()},
               "chunks": sorted(keep.values())}, open(f"{OUT}/index.json", "w"), ensure_ascii=False)
    print(f"::notice::spring chunks {len(idx)} asof {max(alld) if alld else '-'} t={round(time.time() - T0)}s", flush=True)

main()

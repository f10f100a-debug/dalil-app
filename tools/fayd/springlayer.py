"""طبقة الربيع الدقيقة (21 نوفمبر، تجربة dalil_lab_spring): وين اخضرّت الأرض بعد المطر — فيضة أو مو فيضة.
لكل بكسل 10 م: خضرة الحين (أقل قراءة من آخر صورتين صافيتين خلال 14 يوم) ناقص وسيط الصيف لنفس البكسل.
العشب الصغير يرفعها 0.03–0.05 بس، والصيف ثابت (±0.005) — فالفرق ≥0.03 = نبات جديد.
بعدها مربعات ~20 م (0.0002°): أغلب بكسلاتها اخضرّت = مربع ربيع، ودرجته (خفيفة/متوسطة/كثيفة) من مقدار الزيادة.
- الأماكن اللي أغلبها غطاء دائم بخريطة ESA WorldCover (شجر/شجيرات/عشب معمّر ≥50٪) → لون ثاني «شجيرات اخضرّت» (الهرارة والغرب الشمالي)
- زراعة/مباني/ماء → تنشال. وسيط الصيف ≥0.15 (سقي/شجر) → ينشال.
الناتج: data/spring/{lat}_{lng}.png (مربع ربع درجة، 1250×1250) + data/spring/index.json
SPRING_BBOX="غرب,جنوب,شرق,شمال" """
import os, sys, json, time, math, datetime as dtm
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, rasterio, s2, urllib.request
from rasterio.warp import reproject, transform_bounds
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.windows import from_bounds, Window
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

T0 = time.time()
today = dtm.date.today(); y = today.year
BBOX = [float(x) for x in (os.environ.get("SPRING_BBOX") or "43.5,28.0,45.5,29.5").split(",")]
# 22 نوفمبر (أبو مالك: «نصها فيها ونصها لا» بالشمال): «طرح التغير العام» شال 50–80٪ من ربيع الشمال ونجد (المطر عام هناك
# فالخضرة العامة كانت ربيع حقيقي). نخليه للحجاز وعسير والمدينة والساحل الغربي بس (الجبال اللي فيها المشكلة الأصلية)؛
# والحرّات بالشمال يحميها إخفاء القطع اللي أكثر من ربعها أخضر (spring_merge)
SHIFT = (os.environ.get("SPRING_SHIFT") or ("1" if ((BBOX[0] < 38 and BBOX[1] < 28) or (BBOX[0] < 42 and BBOX[1] < 24.5)) else "0")) == "1"
RES = 0.0002; CH = 0.25; N = 1250          # مربعات ~20 م، قطع ربع درجة
RS = 0.0001; NS = 2500                     # صورة القمر الخام ~10 م
NDVI_PAL = [(-.5, "0c0c0c"), (-.2, "bfbfbf"), (-.1, "dbdbdb"), (0, "eaeaea"), (.025, "fff9cc"), (.05, "ede8b5"), (.075, "ddd89b"), (.1, "ccc682"), (.125, "bcb76b"), (.15, "afc160"), (.175, "a3cc59"), (.2, "91bf51"), (.25, "7fb247"), (.3, "70a33f"), (.35, "609635"), (.4, "4f892d"), (.45, "3f7c23"), (.5, "307016"), (.55, "216011"), (.6, "0f540a")]
D_MIN = float(os.environ.get("SPRING_D") or 0.03)
OUT = os.environ.get("SPRING_OUT") or "data/spring"; os.makedirs(OUT, exist_ok=True)
# صورة القمر الخام (ثقيلة) بس للقطع اللي فيها ربيع (≥ SAT_MIN مربع) وحولها فيضة مسجلة — التعميم 21 نوفمبر
SAT_MIN = int(os.environ.get("SPRING_SAT_MIN") or 5000)   # 22 نوفمبر: كان 20000 فطاحت قطع فياض كثيفة صغيرة (أم قليب) — الاختيار النهائي في spring_satpick
_FS = json.load(open("data/fayd-sites.json"))
FAYD_CH = {(math.floor(x[1] / .25), math.floor(x[2] / .25)) for x in _FS if x and x[0]}
# 28 نوفمبر: جزء حائل علّق 4 ساعات (اتصال وقف بدون رد) — مهلة للاتصال والقراءة، والمحاولات تكمل
env = lambda: rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="3", GDAL_HTTP_TIMEOUT="90", GDAL_HTTP_CONNECTTIMEOUT="20")
Q = 5490   # ربع البلاطة بدقة 10 م (نقسمها 4 عشان الذاكرة)

def read(it, qr, qc):
    off = 1000 if str(it["properties"].get("s2:processing_baseline", "00.00")) >= "04.00" else 0
    h = {b: it["assets"][b]["href"] for b in ("B04", "B08", "SCL")}
    for k in range(3):
        try:
            with env():
                with rasterio.open(h["B04"] + "?" + s2.token(h["B04"])) as R, rasterio.open(h["B08"] + "?" + s2.token(h["B08"])) as Nn, \
                     rasterio.open(h["SCL"] + "?" + s2.token(h["SCL"])) as Sc:
                    w = Window(qc * Q, qr * Q, Q, Q)
                    r = R.read(1, window=w).astype("float32"); n = Nn.read(1, window=w).astype("float32")
                    sc = Sc.read(1, window=Window(qc * Q // 2, qr * Q // 2, Q // 2, Q // 2))
                    sc = np.repeat(np.repeat(sc, 2, 0), 2, 1)[:r.shape[0], :r.shape[1]]
                    ok = np.isin(sc, (4, 5)) & (r > off) & (n > off); del sc
                    r -= off; n -= off
                    nd = np.where(ok, (n - r) / np.maximum(n + r, 1), np.nan).astype("float32")
                    return it["properties"]["datetime"][:10], nd, R.window_transform(w), R.crs
        except Exception as e:
            print("retry", it["id"], str(e)[:120], flush=True); time.sleep(6 * (k + 1))
    return None

def quad_delta(now_items, dry_items, qr, qc):
    with ThreadPoolExecutor(4) as ex: nows = [x for x in ex.map(lambda i: read(i, qr, qc), now_items) if x]
    if not nows: return None
    v1 = np.full(nows[0][1].shape, np.nan, "float32"); v2 = v1.copy(); dates = []
    for d, nd, tr, crs in nows:
        if nd.shape != v1.shape: continue
        f1 = np.isnan(v1) & np.isfinite(nd); f2 = ~f1 & np.isnan(v2) & np.isfinite(nd)
        if f1.any() or f2.any(): dates.append(d)
        v1[f1] = nd[f1]; v2[f2] = nd[f2]
        if np.isfinite(v1).mean() > .97: break
    tr, crs = nows[0][2], nows[0][3]
    # 21 نوفمبر (طراح): كانت «أقل قراءة من آخر صورتين» — صورة 8 نوفمبر كانت الأرض فيها مغمورة/مبلولة بعد المطر (NDVI سالب)
    # فمسحت ربيع 20 نوفمبر كله. الحين: آخر قراءة صافية لكل بكسل (نفس اللي يعرضه Copernicus)
    now = v1; del v2, nows
    with ThreadPoolExecutor(4) as ex: drys = [x[1] for x in ex.map(lambda i: read(i, qr, qc), dry_items) if x and x[1].shape == now.shape]
    if len(drys) < 2: return None
    dry = np.nanmedian(np.stack(drys), 0); del drys
    ok = np.isfinite(now) & np.isfinite(dry) & (dry < 0.15)
    # 22 نوفمبر (الحجاز وعسير طلعت قطع كاملة خضراء): إزاحة عامة بالمنطقة (إضاءة الموسم، رطوبة، غبار، حرّات بركانية) مو ربيع —
    # نطرح وسيط الزيادة لربع البلاطة (~55 كم) إذا كان موجب. العشب يطلع بقع (شعبان وفياض) فما يتأثر
    dd = now - dry; shift = float(np.nanmedian(dd[ok])) if ok.any() else 0.0
    if SHIFT and shift > 0: dd = dd - shift
    g = np.where(ok, (dd >= D_MIN).astype("float32"), np.nan)
    g2 = np.where(ok, (dd >= 0.02).astype("float32"), np.nan)
    dl = np.where(ok, dd, np.nan).astype("float32")
    return g, g2, dl, tr, crs, dates, now

WC = {}
def worldcover(la0, lo0):
    """غطاء دائم (شجر/شجيرات/عشب معمّر) وزراعة/مباني/ماء — نسبة كل ~100 م، مكبّرة لمربعات 20 م"""
    key = (math.floor(la0 / 3) * 3, math.floor(lo0 / 3) * 3)
    for k in range(3):
        try:
            if key not in WC:
                body = {"collections": ["esa-worldcover"], "bbox": [key[1] + 1, key[0] + 1, key[1] + 2, key[0] + 2], "limit": 4, "sortby": [{"field": "datetime", "direction": "desc"}]}
                with urllib.request.urlopen(urllib.request.Request(s2.STAC, data=json.dumps(body).encode(), headers={"content-type": "application/json", **s2.UA}), timeout=120) as r:
                    WC[key] = json.load(r)["features"][0]["assets"]["map"]["href"]
            href = WC[key]
            with env(), rasterio.open(href + "?" + s2.token(href)) as src:
                A = src.read(1, window=from_bounds(lo0, la0, lo0 + CH, la0 + CH, src.transform), out_shape=(3000, 3000), resampling=Resampling.nearest)
            M = N // 5
            blk = lambda m: np.repeat(np.repeat(m.reshape(M, 12, M, 12).mean((1, 3)), 5, 0), 5, 1)
            return blk(np.isin(A, (10, 20, 30))), blk(np.isin(A, (50, 80)))   # الزراعة (40) لا: WorldCover يحسب فياض كثير زراعة (طراح 35٪) — المزارع الحقيقية خضراء بالصيف وتنشال
        except Exception as e:
            print("worldcover retry", la0, lo0, str(e)[:120], flush=True); time.sleep(8)
    return np.zeros((N, N)), np.zeros((N, N))

def cells(f, f2, dl, veg, man):
    """مربعات 20 م: f = نسبة بكسلات 10 م اللي زادت ≥0.03 عن الصيف بالصورتين، f2 نفسها بحد 0.02، dl متوسط الزيادة"""
    nb = lambda m: sum(np.roll(np.roll(m, a, 0), b, 1) for a in (-1, 0, 1) for b in (-1, 0, 1))
    core = f >= .5                           # أغلب المربع زاد ≥0.03
    edge = (f2 >= .5) & (nb(core) >= 1)      # أطراف البقعة (زيادة ≥0.02) جنب قلبها
    m = core | edge
    m &= nb(m) >= 2                          # مربع وحيد بدون جار = تشويش
    cls = np.zeros(f.shape, "uint8")
    cls[m] = 1; cls[m & (dl >= .05)] = 2; cls[m & (dl >= .09)] = 3   # خفيفة / متوسطة / كثيفة
    cls[(cls > 0) & (veg >= .6)] = 4         # غطاء دائم (شجيرات/عشب معمّر) — الهرارة والغرب
    cls[man >= .3] = 0
    return cls

def rng(a, b): 
    x = math.floor(a / CH) * CH
    while x < b: yield round(x, 2); x += CH

def main():
    w, s_, e, n = BBOX
    nowi = s2.search(BBOX, f"{(today - dtm.timedelta(days=14)).isoformat()}T00:00:00Z/{today.isoformat()}T23:59:59Z", 40)
    dryi = s2.search(BBOX, f"{y}-07-20T00:00:00Z/{y}-10-05T23:59:59Z", 5)
    by = lambda its: {t: [i for i in its if i["properties"].get("s2:mgrs_tile") == t] for t in {i["properties"].get("s2:mgrs_tile") for i in its}}
    NI, DI = by(nowi), by(dryi)
    tiles = sorted(set(NI) & set(DI))
    print(f"::notice::spring layer bbox {BBOX} tiles {len(tiles)}", flush=True)
    chunks = {(la, lo): [np.full((N, N), np.nan, "float32") for _ in range(3)] for la in rng(s_, n) for lo in rng(w, e)}
    SAT = {k: None for k in chunks}
    alld = set()
    for t in tiles:
        full = sorted([i for i in DI[t] if i["properties"].get("s2:nodata_pixel_percentage", 0) <= 5], key=lambda i: i["properties"]["datetime"])
        dry = full[::max(1, len(full) // 5)][:5] or DI[t][:5]
        now = sorted(NI[t], key=lambda i: i["properties"]["datetime"], reverse=True)[:5]
        for qr in (0, 1):
            for qc in (0, 1):
                r = quad_delta(now, dry, qr, qc)
                if r is None: continue
                g, g2, dl, tr, crs, dates, nowv = r; alld |= set(dates)
                # صورة القمر الخام (آخر قراءة صافية) بدقة ~10 م — وضع «صورة القمر» زي Copernicus
                tb0 = transform_bounds(crs, "EPSG:4326", *rasterio.transform.array_bounds(nowv.shape[0], nowv.shape[1], tr))
                for key in SAT:
                    la, lo = key
                    if tb0[0] > lo + CH or tb0[2] < lo or tb0[1] > la + CH or tb0[3] < la: continue
                    tmp = np.full((NS, NS), np.nan, "float32")
                    reproject(nowv, tmp, src_transform=tr, src_crs=crs, dst_transform=from_origin(lo, la + CH, RS, RS), dst_crs="EPSG:4326", resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
                    if SAT[key] is None: SAT[key] = np.full((NS, NS), np.nan, "float16")
                    np.fmax(SAT[key], tmp.astype("float16"), out=SAT[key]); del tmp
                del nowv
                tb = transform_bounds(crs, "EPSG:4326", *rasterio.transform.array_bounds(g.shape[0], g.shape[1], tr))
                for (la, lo), (G, G2, DL) in chunks.items():
                    if tb[0] > lo + CH or tb[2] < lo or tb[1] > la + CH or tb[3] < la: continue
                    dt = from_origin(lo, la + CH, RES, RES)
                    for src, dst in ((g, G), (g2, G2), (dl, DL)):
                        tmp = np.full((N, N), np.nan, "float32")
                        reproject(src, tmp, src_transform=tr, src_crs=crs, dst_transform=dt, dst_crs="EPSG:4326", resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan)
                        np.fmax(dst, tmp, out=dst)
                del g, g2, dl
        print(f"tile {t}: now {sorted(alld)[-3:]} t={round(time.time() - T0)}s", flush=True)
    # الخام (مكمّم 0–255) في raw/ — عشان نعيد التصنيف بسرعة بدون تحميل الصور من جديد
    os.makedirs("raw", exist_ok=True)
    for (la, lo), (G, G2, DL) in sorted(chunks.items()):
        if not np.isfinite(G).any(): continue
        veg, man = worldcover(la, lo)
        q = lambda a: np.clip(np.nan_to_num(a) * 255, 0, 255).astype("uint8")
        np.savez_compressed(f"raw/{la:.2f}_{lo:.2f}.npz", f=q(G), f2=q(G2), d=np.clip((np.nan_to_num(DL) + .1) * 500, 0, 255).astype("uint8"), veg=q(veg), man=q(man))
    json.dump({"asof": max(alld) if alld else today.isoformat(), "bbox": BBOX}, open("raw/meta.json", "w"))
    del chunks
    idx = classify("raw", BBOX)
    spr = {(c[0], c[1]): sum(c[2][:3]) for c in idx}
    near = lambda la, lo: any((math.floor(la / .25) + a, math.floor(lo / .25) + b) in FAYD_CH for a in (-1, 0, 1) for b in (-1, 0, 1))
    # صورة القمر بألوان NDVI حق Copernicus (نفس الدرجات) → sat/*.webp
    os.makedirs(f"{OUT}/sat", exist_ok=True); sat = []
    for (la, lo), A in sorted(SAT.items()):
        if A is None or not np.isfinite(A).any(): continue
        if spr.get((la, lo), 0) < SAT_MIN or not near(la + .01, lo + .01): continue
        v = np.nan_to_num(A.astype("float32"), nan=-9); img = np.zeros((NS, NS, 3), "uint8")
        img[:] = (234, 234, 234)
        for t, hx in NDVI_PAL: img[v >= t] = tuple(int(hx[i:i + 2], 16) for i in (0, 2, 4))
        img[v == -9] = (200, 200, 200)
        Image.fromarray(img).save(f"{OUT}/sat/{la:.2f}_{lo:.2f}.webp", quality=60, method=4)
        sat.append([la, lo])
    old = {}
    try: old = json.load(open(f"{OUT}/sat.json"))
    except Exception: pass
    keep = {(c[0], c[1]): c for c in old.get("chunks", []) if not (w <= c[1] + CH / 2 <= e and s_ <= c[0] + CH / 2 <= n)}
    for c in sat: keep[(c[0], c[1])] = c
    json.dump({"v": 1, "gen": int(time.time()), "asof": max(alld) if alld else today.isoformat(), "res": RS, "ch": CH, "chunks": sorted(keep.values())}, open(f"{OUT}/sat.json", "w"))
    print(f"::notice::sat chunks {len(sat)}", flush=True)
    del SAT

def classify(raw, bb):
    w, s_, e, n = bb
    meta = json.load(open(f"{raw}/meta.json")); asof = meta["asof"]
    idx = []
    PAL = {1: (196, 228, 110, 175), 2: (96, 186, 70, 205), 3: (22, 112, 44, 230), 4: (160, 130, 215, 160)}
    for fn in sorted(os.listdir(raw)):
        if not fn.endswith(".npz"): continue
        la, lo = map(float, fn[:-4].split("_")); Z = np.load(f"{raw}/{fn}")
        f = Z["f"] / 255; f2 = Z["f2"] / 255; dl = Z["d"] / 500 - .1; veg = Z["veg"] / 255; man = Z["man"] / 255
        cls = cells(f, f2, dl, veg, man)
        if not cls.any(): continue
        img = np.zeros((N, N, 4), "uint8")
        for c, col in PAL.items(): img[cls == c] = col
        nm = f"{la:.2f}_{lo:.2f}"
        Image.fromarray(img, "RGBA").save(f"{OUT}/{nm}.png", optimize=True)
        cnt = [int((cls == c).sum()) for c in (1, 2, 3, 4)]
        idx.append([la, lo, cnt]); print("chunk", nm, cnt, flush=True)
    alld = {asof}
    old = {}
    try: old = json.load(open(f"{OUT}/index.json"))
    except Exception: pass
    keep = {}
    if old.get("v") == 2:
        keep = {(c[0], c[1]): c for c in old.get("chunks", []) if not (w <= c[1] + CH / 2 <= e and s_ <= c[0] + CH / 2 <= n)}
    else:   # النسخة القديمة (1°، 100 م) — نشيل صورها
        for f_ in os.listdir(OUT):
            if f_.endswith(".png") and "." not in f_[:-4].split("_")[0]: os.remove(f"{OUT}/{f_}")
    for c in idx: keep[(c[0], c[1])] = c
    json.dump({"v": 2, "gen": int(time.time()), "asof": max(alld) if alld else today.isoformat(), "res": RES, "ch": CH, "pal": {str(k): list(v) for k, v in PAL.items()},
               "chunks": sorted(keep.values())}, open(f"{OUT}/index.json", "w"), ensure_ascii=False)
    print(f"::notice::spring chunks {len(idx)} asof {max(alld) if alld else '-'} t={round(time.time() - T0)}s", flush=True)
    return idx

if os.environ.get("SPRING_FROM_RAW"):
    _m = json.load(open(os.environ["SPRING_FROM_RAW"] + "/meta.json")); classify(os.environ["SPRING_FROM_RAW"], _m["bbox"])
else: main()

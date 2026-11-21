"""تجربة طبقة الربيع الدقيقة (21 نوفمبر): لكل بكسل 10 م — الفرق بين خضرة الحين (أقل قراءة من آخر صورتين صافيتين)
ووسيط الصيف لنفس البكسل. العشب الصغير يرفع NDVI شوي بس (0.03–0.06) لكن الصيف ثابت جدًا (±0.005) فالفرق واضح.
SPRING_BOXES="اسم:جنوب:غرب:شمال:شرق;..."  SPRING_PTS="lat:lng:اسم,..."  → diag/spring-*.png + إحصاءات"""
import os, sys, json, time, datetime as dtm
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, rasterio, s2
from rasterio.warp import transform
from rasterio.windows import from_bounds
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw

today = dtm.date.today()
NOW_FROM = os.environ.get("SPRING_NOW_FROM") or (today - dtm.timedelta(days=14)).isoformat()
y = today.year
PTS = [x.split(":") for x in os.environ.get("SPRING_PTS", "").split(",") if x.count(":") >= 1]
os.makedirs("diag", exist_ok=True)

def read(it, bb):
    off = 1000 if str(it["properties"].get("s2:processing_baseline", "00.00")) >= "04.00" else 0
    h = {b: it["assets"][b]["href"] for b in ("B04", "B08", "SCL")}
    for k in range(3):
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3"):
                with rasterio.open(h["B04"] + "?" + s2.token(h["B04"])) as R, rasterio.open(h["B08"] + "?" + s2.token(h["B08"])) as N, \
                     rasterio.open(h["SCL"] + "?" + s2.token(h["SCL"])) as S:
                    xs, ys = transform("EPSG:4326", R.crs, [bb[1], bb[3]], [bb[0], bb[2]])
                    w = from_bounds(min(xs), min(ys), max(xs), max(ys), R.transform).round_offsets().round_lengths()
                    r = R.read(1, window=w, boundless=True, fill_value=0).astype("float32"); n = N.read(1, window=w, boundless=True, fill_value=0).astype("float32")
                    sw = from_bounds(min(xs), min(ys), max(xs), max(ys), S.transform).round_offsets().round_lengths()
                    sc = S.read(1, window=sw, boundless=True, fill_value=0, out_shape=r.shape, resampling=rasterio.enums.Resampling.nearest)
                    ok = np.isin(sc, (4, 5)) & (r > off) & (n > off)
                    r = np.clip(r - off, 1, None); n = np.clip(n - off, 1, None)
                    nd = np.where(ok, (n - r) / (n + r), np.nan).astype("float32")
                    return it["properties"]["datetime"][:10], nd, (w, R.transform, R.crs)
        except Exception as e:
            print("retry", it["id"], str(e)[:120], flush=True); time.sleep(5)
    return None

def box(name, bb):
    s_, w_, n_, e_ = bb
    cov = lambda i: i["bbox"][0] <= w_ and i["bbox"][2] >= e_ and i["bbox"][1] <= s_ and i["bbox"][3] >= n_
    dry = [i for i in s2.search([w_, s_, e_, n_], f"{y}-07-15T00:00:00Z/{y}-10-05T23:59:59Z", 10) if cov(i)]
    now = [i for i in s2.search([w_, s_, e_, n_], f"{NOW_FROM}T00:00:00Z/{today.isoformat()}T23:59:59Z", 40) if cov(i)]
    if not dry or not now: print(name, "no items", len(dry), len(now)); return
    tile = max({i["properties"]["s2:mgrs_tile"] for i in now}, key=lambda t: sum(i["properties"]["s2:mgrs_tile"] == t for i in now + dry))
    dry = [i for i in dry if i["properties"]["s2:mgrs_tile"] == tile][::max(1, len(dry) // 12)][:12]
    now = sorted([i for i in now if i["properties"]["s2:mgrs_tile"] == tile], key=lambda i: i["properties"]["datetime"], reverse=True)[:4]
    with ThreadPoolExecutor(8) as ex:
        D = [x for x in ex.map(lambda i: read(i, bb), dry) if x]; Nw = [x for x in ex.map(lambda i: read(i, bb), now) if x]
    shp = min(x[1].shape for x in D + Nw)
    cut = lambda a: a[:shp[0], :shp[1]]
    base = np.nanmedian(np.stack([cut(x[1]) for x in D]), 0)
    nows = sorted([(d, cut(a)) for d, a, _ in Nw], reverse=True)
    good = [(d, a) for d, a in nows if np.isfinite(a).mean() > .8][:2]
    print(f"== {name} tile {tile} dry {[x[0] for x in D]} now {[d for d, _ in good]} shape {shp}", flush=True)
    if os.environ.get("SPRING_MODE") == "raw":   # 21 نوفمبر: آخر صورة صافية كما هي بألوان NDVI حق Copernicus
        nd = good[0][1]; H, W = nd.shape
        TH = [(-.5, "0c0c0c"), (-.2, "bfbfbf"), (-.1, "dbdbdb"), (0, "eaeaea"), (.025, "fff9cc"), (.05, "ede8b5"), (.075, "ddd89b"), (.1, "ccc682"), (.125, "bcb76b"), (.15, "afc160"), (.175, "a3cc59"), (.2, "91bf51"), (.25, "7fb247"), (.3, "70a33f"), (.35, "609635"), (.4, "4f892d"), (.45, "3f7c23"), (.5, "307016"), (.55, "216011"), (.6, "0f540a")]
        img = np.zeros((H, W, 3), "uint8"); v = np.nan_to_num(nd, nan=0)
        for t, hx in TH: img[v >= t] = tuple(int(hx[i:i + 2], 16) for i in (0, 2, 4))
        im = Image.fromarray(img); dr = ImageDraw.Draw(im)
        for p in PTS:
            la, lo = float(p[0]), float(p[1])
            if s_ <= la <= n_ and w_ <= lo <= e_:
                r, c = int((n_ - la) / (n_ - s_) * H), int((lo - w_) / (e_ - w_) * W); dr.ellipse([c - 9, r - 9, c + 9, r + 9], outline=(220, 0, 0), width=3)
        sc = max(1, 1400 // max(H, W)); im = im.resize((W * sc, H * sc), Image.NEAREST) if sc > 1 else im
        if max(im.size) > 1600: im.thumbnail((1600, 1600))
        im.save(f"diag/raw-{name}-{good[0][0]}.png"); print("raw", name, good[0][0], flush=True); return
    nowv = np.fmin(good[0][1], good[1][1]) if len(good) > 1 else good[0][1]
    d = nowv - base
    ok = np.isfinite(d)
    for th in (0.02, 0.03, 0.04, 0.06, 0.10):
        print(f"   delta>={th}: {round(100 * float((d[ok] >= th).mean()), 1)}%", flush=True)
    print(f"   base med {np.nanmedian(base):.3f}  now med {np.nanmedian(nowv):.3f}  delta med {np.nanmedian(d):.3f} p90 {np.nanpercentile(d, 90):.3f}", flush=True)
    # نقاط: نسبة البكسلات اللي زادت ≥0.03 في مربع 400 م حولها
    H, W = shp; la0, la1, lo0, lo1 = s_, n_, w_, e_
    pix = lambda la, lo: (int((la1 - la) / (la1 - la0) * H), int((lo - lo0) / (lo1 - lo0) * W))
    for p in PTS:
        la, lo = float(p[0]), float(p[1])
        if not (s_ <= la <= n_ and w_ <= lo <= e_): continue
        r, c = pix(la, lo); sl = d[max(0, r - 20):r + 21, max(0, c - 20):c + 21]
        print(f"   PT {p[2] if len(p) > 2 else ''} {la},{lo}: d>=.03 {round(100 * float(np.nanmean(sl >= .03)), 1)}%  d>=.05 {round(100 * float(np.nanmean(sl >= .05)), 1)}%  med d {np.nanmedian(sl):.3f}", flush=True)
    # صورة: رمادي حسب سطوع الصيف، وألوان الزيادة
    g = np.clip((0.2 - np.nan_to_num(base, nan=.1)) * 600, 60, 200).astype("uint8")
    img = np.stack([g, g, g], -1)
    for th, col in ((0.02, (230, 230, 140)), (0.03, (190, 220, 90)), (0.05, (110, 190, 60)), (0.08, (30, 140, 40)), (0.15, (0, 90, 20))):
        img[np.nan_to_num(d) >= th] = col
    im = Image.fromarray(img)
    dr = ImageDraw.Draw(im)
    for p in PTS:
        la, lo = float(p[0]), float(p[1])
        if s_ <= la <= n_ and w_ <= lo <= e_:
            r, c = pix(la, lo); col = (220, 0, 0) if (len(p) > 2 and p[2].endswith("NO")) else (20, 60, 230)
            dr.ellipse([c - 20, r - 20, c + 20, r + 20], outline=col, width=4); dr.text((c + 24, r - 8), p[2] if len(p) > 2 else "", fill=col)
    if max(im.size) > 1600: im.thumbnail((1600, 1600))
    im.save(f"diag/spring-{name}.png")

for b in os.environ.get("SPRING_BOXES", "").split(";"):
    if b.count(":") == 4:
        a = b.split(":"); box(a[0], [float(x) for x in a[1:]])

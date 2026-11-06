"""فياض بدون اسم: مسح أسبوعي بصور Sentinel-2 (Planetary Computer، مجاني) للبقع اللي خضرت هالموسم وما حولها فيضة من القائمة.
لكل بلاطة (110 كم): صورة «الحين» (آخر 12 يوم، دمج أحدث صورتين صافيتين) مقابل «الجفاف» (25 أغسطس–5 أكتوبر، أعلى خضرة من صورتين).
بكسل 40 م، ونقيس «نسبة الأرض اللي خضرت» في كل مربع 200 م (5×5) — كذا تنلقط خضرة الشعبان والمجاري الضيقة
(7 نوفمبر: فيديو قرب فيضة كسر صفية — خط أخضر بشعيب، 19% من المكان، فاته المسح على 80 م).
البكسل الجديد: NDVI الحين ≥ 0.16، زاد 0.06 فأكثر، وكان جرداء بالجفاف (< 0.15). المربع: 15% من أرضه خضرت.
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

BBOX = [38.0, 24.5, 50.0, 32.3]   # شرق 38: نتجنب الساحل والجزر (جزيرة المقيطع طلعت خضرة شاطئ)
TEST = os.environ.get("SCAN_ONLY", "")   # نقاط lat:lng للتجربة: نمسح البلاطات اللي تغطيها بس          # الجوف والشمال وحائل والقصيم والشرقية وشمال الرياض
PX = 2745                                # 10980/4 → 40 م
C = 5                                    # المربع = 5×5 بكسل = 200 م
NC = PX // C                             # 549
HA = 0.16                                # مساحة البكسل بالهكتار
MIN_HA = float(os.environ.get("SCAN_MINHA") or 2.5)     # أقل مساحة خضراء فعلية بالبقعة
NOW_MIN = float(os.environ.get("SCAN_NOW") or 0.16)
D_MIN = float(os.environ.get("SCAN_D") or 0.06)
FRAC = float(os.environ.get("SCAN_FRAC") or 0.15)
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
            ok &= (R + N) >= 1800       # الصخر البركاني الأسود (الحرّات): انعكاسه ضعيف و NDVI يتذبذب عليه — ما نقيسه (القيعان داخل الحرة فاتحة وتنقاس)
            nd = np.where(ok, (N - R) / (N + R), np.nan).astype("float32")
            water = S == 6
            return nd, water, tr, crs
        except Exception as e:
            print("read retry", it["id"], str(e)[:120], flush=True); time.sleep(5 * (k + 1))
    return None

def worldcover(tr, crs, n):
    """فئات ESA WorldCover على نفس شبكة البلاطة (40 زراعة، 50 عمران، 80 مياه، 90 أراضي رطبة)"""
    import urllib.request
    from rasterio.windows import from_bounds
    cols, rows = np.meshgrid(np.arange(n) + .5, np.arange(n) + .5)
    xs = tr.c + tr.a * cols; ys = tr.f + tr.e * rows
    lo, la = wtransform(crs, "EPSG:4326", xs.ravel().tolist(), ys.ravel().tolist())
    lo = np.array(lo).reshape(n, n); la = np.array(la).reshape(n, n)
    bb = [float(lo.min()), float(la.min()), float(lo.max()), float(la.max())]
    out = np.zeros((n, n), "uint8")
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

def composite(items, how, full=False):
    """how=min: لكل بكسل أحدث قراءتين صافيتين (من أي صور، المدارات تغطي أجزاء مختلفة) وناخذ الأقل —
               بقعة تخضر بصورة وحدة = غالبًا غبار/صخر بركاني مو نبات
       how=max: أعلى قيمة من كل صور الجفاف (أي خضرة بالصيف = مزرعة/شجر/صخر يتذبذب)"""
    v = None; v2 = None; water = None; geo = None
    for it in items:
        r = read_ndvi(it)
        if r is None: continue
        nd, w, tr, crs = r
        if geo is None:
            geo = (tr, crs); water = w
            v = nd; v2 = np.full_like(nd, np.nan) if how == "min" else None; cnt = np.isfinite(nd).astype("uint8"); continue
        water |= w
        if how == "min":
            f1 = np.isnan(v) & np.isfinite(nd); f2 = ~f1 & np.isnan(v2) & np.isfinite(nd)
            v[f1] = nd[f1]; v2[f2] = nd[f2]
            if np.isfinite(v2).mean() > 0.97: break
        else:
            v = np.fmax(v, nd); cnt += np.isfinite(nd)
            if not full and (cnt >= 2).mean() > 0.95: break
        del nd
    if v is None: return None, None, None
    if how == "min": v = np.where(np.isfinite(v2), np.fmin(v, v2), np.nan).astype("float32")
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

def rain75(pts):
    import urllib.request, urllib.parse
    out = []
    for k in range(0, len(pts), 80):
        part = pts[k:k + 80]
        q = urllib.parse.urlencode({"latitude": ",".join(str(a) for a, b in part), "longitude": ",".join(str(b) for a, b in part),
                                    "daily": "precipitation_sum", "past_days": 75, "forecast_days": 1, "timezone": "Asia/Riyadh"})
        j = None
        for t in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request("https://api.open-meteo.com/v1/forecast?" + q, headers=s2.UA), timeout=120) as r: j = json.load(r); break
            except Exception as e:
                print("rain retry", str(e)[:80], flush=True); time.sleep(20 * (t + 1))
        if j is None: out += [None] * len(part); continue
        for loc in (j if isinstance(j, list) else [j]): out.append(sum(v or 0 for v in loc["daily"]["precipitation_sum"]))
    return out

def near_named(la, lo, r=2.0):
    return any(abs(a - la) < .03 and abs(b - lo) < .03 and km(la, lo, a, b) < r for _, a, b in NAMED)

def do_tile(tile, now_items, dry_items, last_items=None):
    now, water, geo = composite(now_items[:5], "min")
    if now is None: return []
    dry, w2, g2 = composite(dry_items[:12], "max", True)
    if dry is None: return []
    tr, crs = geo
    # الموسم الماضي (يناير–مايو): أي بكسل وصل NDVI ‏0.7 = زراعة (محاور قمح/برسيم) — الربيع الطبيعي على 40 م ما يوصلها
    # (7 نوفمبر: أغلب بقع حائل والجوف الكبيرة طلعت محاور خضراء بالشتاء والصيف اللي فات)
    last, _, _ = composite(last_items[:8], "max", True) if last_items else (None, None, None)
    farm = (last >= 0.7) if last is not None else np.zeros_like(now, bool)
    if last is not None: farm = ndimage.binary_dilation(farm, iterations=1)     # حواف المحاور
    ok = np.isfinite(now) & np.isfinite(dry) & ~water & ~w2
    g = ok & (now >= NOW_MIN) & (now - dry >= D_MIN) & (dry < 0.15) & ~farm
    hi = g & (now >= 0.55)
    n2 = NC * C
    blk = lambda a: a[:n2, :n2].reshape(NC, C, NC, C).sum((1, 3))
    gc, vc, hc = blk(g), blk(ok), blk(hi)
    trc = tr * tr.scale(C, C)
    wc = worldcover(trc, crs, NC)
    with np.errstate(invalid="ignore", divide="ignore"):
        frac = np.where(vc >= 13, gc / np.maximum(vc, 1), 0)
    m = (frac >= FRAC) & ~np.isin(wc, (40, 50, 80, 90, 95))
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    print(f"tile {tile}: green px {int(g.sum())} cells {int(m.sum())} patches {n} now {[i['properties']['datetime'][:10] for i in now_items[:5]]} ", flush=True)
    if TEST:
        for la, lo in [tuple(map(float, x.split(":"))) for x in TEST.split(",") if ":" in x]:
            xx, yy = wtransform("EPSG:4326", crs, [lo], [la]); c_, r_ = ~tr * (xx[0], yy[0]); c_, r_ = int(c_), int(r_)
            if 3 <= r_ < PX - 3 and 3 <= c_ < PX - 3:
                sl = (slice(r_ - 3, r_ + 4), slice(c_ - 3, c_ + 4))
                print(f"DBG {la},{lo} in {tile}: now {np.round(np.nanmax(now[sl]), 3)} med {np.round(np.nanmedian(now[sl]), 3)} dry {np.round(np.nanmedian(dry[sl]), 3)} green px {int(g[sl].sum())}/49 valid {int(ok[sl].sum())}", flush=True)
    if not n: return []
    idx = np.arange(1, n + 1)
    area = ndimage.sum(gc * m, lab, idx) * HA
    out = []
    for k, a in zip(idx, area):
        if a < MIN_HA:
            if TEST and a >= 1.5:
                rr, cc = np.nonzero(lab == k); x, yv = trc * (cc.mean() + .5, rr.mean() + .5); lo, la = wtransform(crs, "EPSG:4326", [x], [yv])
                if abs(la[0] - 29.955) < .03 and abs(lo[0] - 41.385) < .03: print("SMALL", round(la[0], 4), round(lo[0], 4), round(a, 1), flush=True)
            continue
        sel = lab == k
        ncell = int(sel.sum()); mf = float(frac[sel].mean()); hf = float(hc[sel].sum() / max(1, gc[sel].sum()))
        if hf >= 0.25: continue      # ربعها خضرة قوية (NDVI ≥ 0.55 على 40 م) بأول الموسم = مزرعة جديدة مو ربيع
        rr, cc = np.nonzero(sel); w = gc[sel].astype(float)
        r0 = float((rr * w).sum() / w.sum()); c0 = float((cc * w).sum() / w.sum())
        # أقرب مربع أخضر فعلي للمركز (الشعيب ممكن يكون منحني والمركز خارجه)
        j = int(np.argmin((rr - r0) ** 2 + (cc - c0) ** 2)); r0, c0 = rr[j], cc[j]
        x, yv = trc * (c0 + .5, r0 + .5)
        lo, la = wtransform(crs, "EPSG:4326", [x], [yv]); lo, la = lo[0], la[0]
        out.append([round(la, 4), round(lo, 4), round(a, 1), round(mf * 100), ncell, round(hf, 2), tile])
    return out

def main():
    print("searching…", flush=True)
    nowi = s2.search(BBOX, f"{(today - dtm.timedelta(days=12)).isoformat()}T00:00:00Z/{today.isoformat()}T23:59:59Z", 30)
    dryi = s2.search(BBOX, f"{y}-06-01T00:00:00Z/{y}-10-05T23:59:59Z", 10)   # الصيف كله: أي خضرة بالصيف = سقي
    g = lambda its: {t: sorted([i for i in its if i["properties"].get("s2:mgrs_tile") == t], key=lambda i: (i["properties"]["eo:cloud_cover"] > 5, i["properties"]["datetime"]), reverse=False) for t in {i["properties"].get("s2:mgrs_tile") for i in its}}
    N = {t: sorted(v, key=lambda i: i["properties"]["datetime"], reverse=True) for t, v in g(nowi).items()}
    # الجفاف: صور متفرقة على الصيف (وحدة كل ~3 أسابيع، كاملة أول) + صور المدار الثاني عشان تنغطى كل أجزاء البلاطة
    D = {}
    for t, v in g(dryi).items():
        full = sorted([i for i in v if i["properties"].get("s2:nodata_pixel_percentage", 0) <= 5], key=lambda i: i["properties"]["datetime"])
        part = sorted([i for i in v if i not in full], key=lambda i: i["properties"]["datetime"])
        def spread(xs, gap=20):
            out, ld = [], ""
            for i in xs:
                d = i["properties"]["datetime"][:10]
                if not ld or d > (dtm.date.fromisoformat(ld) + dtm.timedelta(days=gap)).isoformat(): out.append(i); ld = d
            return out
        D[t] = spread(full) + spread(part, 30)
    lasti = s2.search(BBOX, f"{y}-01-10T00:00:00Z/{y}-05-31T23:59:59Z", 5)
    L = {}
    for t, v in g(lasti).items():   # صور متفرقة على الشتاء والربيع (وحدة لكل ~3 أسابيع)
        v = sorted(v, key=lambda i: i["properties"]["datetime"]); pick = []; last_d = ""
        for i in v:
            d = i["properties"]["datetime"][:10]
            if not last_d or d > (dtm.date.fromisoformat(last_d) + dtm.timedelta(days=20)).isoformat(): pick.append(i); last_d = d
        L[t] = pick
    print(f"last-season items {len(lasti)}", flush=True)
    tiles = sorted(set(N) & set(D))
    lim = int(os.environ.get("SCAN_TILES", "0") or 0)
    if TEST:   # نقاط lat:lng → البلاطات اللي تغطيها
        pts = [tuple(map(float, x.split(":"))) for x in TEST.split(",") if ":" in x]
        cov = lambda t: any(i["bbox"][0] <= lo <= i["bbox"][2] and i["bbox"][1] <= la <= i["bbox"][3] for i in N[t] for la, lo in pts)
        tiles = [t for t in tiles if cov(t)]
    elif lim: tiles = tiles[:lim]
    print(f"::notice::scan tiles {len(tiles)} (now items {len(nowi)}, dry items {len(dryi)})", flush=True)
    found = []
    with ThreadPoolExecutor(6) as ex:
        for k, res in enumerate(ex.map(lambda t: (t, do_tile(t, N[t], D[t], L.get(t))), tiles)):
            t, r = res; found += r
            if k % 10 == 0: print("tile", k, "/", len(tiles), t, len(r), round(time.time() - T0), "s", flush=True)
    # دمج المكرر بين البلاطات + شيل القريب من فيضة لها اسم
    found.sort(key=lambda r: -r[2] * r[3])
    if TEST:
        for r in found: print("RAW", r, "named<2km" if near_named(r[0], r[1]) else "", flush=True)
    rows = []
    for r in found:
        if not in_ksa(r[0], r[1]) or near_named(r[0], r[1]): continue
        if any(km(r[0], r[1], q[0], q[1]) < 2 for q in rows): continue
        rows.append(r)
    # بدون مطر = سقي (محاور جديدة في طبرجل وعريفج والشمال) مو ربيع: نطلب 8 ملم فأكثر آخر 75 يوم (Open-Meteo)
    rows = rows[:900]
    mm = rain75([(r[0], r[1]) for r in rows])
    # + الرادار والمحطات (نفس طريقة تحديث الفياض — Open-Meteo يفوّت مطر الشمال كثير)
    try:
        import radar, rainqc, synop
        since75 = (today - dtm.timedelta(days=75)).isoformat()
        SY = json.load(open(synop.FILE)) if os.path.exists(synop.FILE) else None
        R = radar.load(since75); Q = rainqc.QC(R, SY)
        for n_, r in enumerate(rows):
            gq = Q.gauge(r[0], r[1], max_km=50); gd = gq[1] if gq else {}
            rr = 0.0
            for day in R:
                v, _ = Q.radar(day, r[0], r[1])
                if v is None: continue
                rr += rainqc.cap(v, gd.get(day)) if day in gd else v
            gt = sum(v for d, v in gd.items() if d >= since75)
            mm[n_] = max(mm[n_] or 0, rr, gt)
    except Exception as e:
        print("::warning::radar rain skipped: " + str(e)[:150], flush=True)
    kept = [r for r, m in zip(rows, mm) if m is None or m >= 8]
    print(f"::notice::rain check: {len(rows)} → {len(kept)} (dropped {len(rows) - len(kept)} with < 8 mm)", flush=True)
    rows = kept[:400]
    out = []
    for la, lo, ha, pct, ncell, hf, tile in rows:
        lb, ref = label(la, lo)
        out.append([la, lo, round(ha), pct, lb])                  # [lat, lng, هكتار أخضر, % من أرض البقعة, الاسم]
    nowdate = max((i["properties"]["datetime"][:10] for i in nowi), default=today.isoformat())
    res = {"asof": nowdate, "made": today.isoformat(), "n": len(out), "rows": out}
    try: prev = json.load(open("data/fayd-new.json"))
    except Exception: prev = None
    pn = prev["n"] if prev else 0
    held = TEST or lim or "publish" not in sys.argv[1:] and (prev is None or (max(pn, len(out)) >= 10 and abs(len(out) - pn) > 0.5 * max(pn, 1)))
    fn = "data/fayd-new-pending.json" if held else "data/fayd-new.json"
    json.dump(res, open(fn, "w"), ensure_ascii=False, separators=(",", ":"))
    if held:
        open("data/fayd-new-qa.md", "w").write(f"فياض بدون اسم {nowdate}: العدد {pn} → {len(out)} — انحفظ في {fn} للمراجعة.\n\n" + "\n".join(f"- {r[4]} · {r[2]} هكتار خضراء · {r[3]}% من أرضها · {r[0]},{r[1]}" for r in out[:80]))
    print(f"::notice::new green patches {len(out)} (raw {len(found)}) → {fn} t={round(time.time() - T0)}s", flush=True)
    from collections import Counter
    print("::notice::top: " + " · ".join(f"{r[4]} ({r[2]} ه)" for r in out[:40])[:3000], flush=True)

main()

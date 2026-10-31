# حالة الفياض: يقرأ صور MODIS (MOD13Q1 + MYD13Q1، 250 م، كل 8 أيام) من Microsoft Planetary Computer
# ويحسب لكل فيضة: خضرتها الآن مقارنة بحالتها في الصيف (الجفاف) وبذروة ربيعها المعتادة.
#   python3 update.py baseline   ← مرة وحدة (أو سنويًا): المعتاد لكل فيضة → data/fayd-base.json
#   python3 update.py s2base     ← مرة كل موسم (قبل الأمطار): خضرة الصيف لكل فيضة بدقة 10 م من Sentinel-2 → data/fayd-s2base.json
#   python3 update.py            ← مرتين بالأسبوع: آخر صور Sentinel-2 (10 م، بدون غيم) + MODIS للمقارنة بالمعتاد → data/fayd.json
import json, sys, os, time, datetime as dtm, statistics as st, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
import s2, radar, synop
from concurrent.futures import ThreadPoolExecutor
import numpy as np, rasterio
from rasterio.warp import transform

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
COLS = ["modis-13Q1-061"]
BBOX = [34.5, 16, 56, 32.5]
SITES = json.load(open("data/fayd-sites.json"))
LAT = [s[1] for s in SITES]; LNG = [s[2] for s in SITES]
_tok = {"t": None, "at": 0}
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}

_toks = {}
def token(href):
    """رمز وصول لحساب التخزين والحاوية حسب الرابط (يتجدد كل نص ساعة)"""
    acct = href.split("//")[1].split(".")[0]; cont = href.split("/")[3]
    k = acct + "/" + cont; t = _toks.get(k)
    if not t or time.time() - t[1] > 1800:
        with urllib.request.urlopen(urllib.request.Request(f"https://planetarycomputer.microsoft.com/api/sas/v1/token/{acct}/{cont}", headers=UA), timeout=60) as r:
            t = _toks[k] = (json.load(r)["token"], time.time())
    return t[0]

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
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **UA})
        with urllib.request.urlopen(req, timeout=120) as r: j = json.load(r)
        items += j["features"]
        nxt = [l for l in j.get("links", []) if l.get("rel") == "next"]
        url, body = (nxt[0]["href"], nxt[0].get("body", body)) if nxt else (None, None)
    return items

def sample(item):
    """قيمة كل فيضة داخل هذي البلاطة: الربيع الأعلى (المئين 75) في مربع 5×5 بكسل (~1.2 كم)"""
    for k in range(4):
        try:
            raw = item["assets"]["250m_16_days_NDVI"]["href"]
            href = raw + "?" + token(raw)
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

if len(sys.argv) > 1 and sys.argv[1] == "s2base":
    # خضرة الجفاف (قبل مطر الموسم): متوسط 3 قراءات صافية بين 25 أغسطس و5 أكتوبر
    y = dtm.date.today().year if dtm.date.today().month >= 8 else dtm.date.today().year - 1
    res = s2.sample(SITES, f"{y}-08-25", f"{y}-10-05", max_cloud=30, keep=3)
    out = [None] * len(SITES)
    for i, v in res.items():
        out[i] = [round(st.median(x[1] for x in v), 3), round(st.median(x[3] for x in v), 3), len(v)]
    json.dump({"made": time.strftime("%Y-%m-%d"), "season": y, "base": out}, open("data/fayd-s2base.json", "w"), separators=(",", ":"))
    print(f"::notice::s2 base {sum(o is not None for o in out)}/{len(SITES)} t={round(time.time() - T0)}s", flush=True)
    sys.exit()

# ---- التحديث: Sentinel-2 (آخر 12 يوم) + MODIS (آخر صورتين) ----
base = json.load(open("data/fayd-base.json"))["base"]
try: s2base = json.load(open("data/fayd-s2base.json"))["base"]
except Exception: s2base = [None] * len(SITES)
today = dtm.date.today()
cur = s2.sample(SITES, (today - dtm.timedelta(days=12)).isoformat(), today.isoformat(), max_cloud=60, keep=1)
print(f"::notice::s2 current {len(cur)}/{len(SITES)} t={round(time.time() - T0)}s", flush=True)
now = time.time()
items = search(time.strftime("%Y-%m-%dT00:00:00Z", time.gmtime(now - 40 * 86400)) + "/" + time.strftime("%Y-%m-%dT23:59:59Z", time.gmtime(now)))
groups = by_date(items)
need = max(len(v) for v in groups.values())
dates = [d for d, v in groups.items() if len(v) >= need - 1][-2:]  # آخر صورتين (Terra وAqua) لتقليل أثر الغيم
res = run_dates({d: groups[d] for d in dates})
rows = []
s2dates = []
farm = []          # فياض فيها زراعة (خضراء وقت الجفاف بالقمر الدقيق) — ما نقدر نقيس ربيعها
# MODIS بديل فقط إذا صورته حديثة (كانت تُستخدم صور عمرها شهر وتنعرض كأنها «آخر صورة 29 أكتوبر»)
modis_fresh = bool(dates) and (today - dtm.date.fromisoformat(dates[-1])).days <= 16
JUMP = 0.30        # قفزة خضرة فوق هذا في أسابيع = غالبًا محور زراعي جديد (موسم زراعة القمح) مو ربيع → «تحتاج تأكيد»
for i, s in enumerate(SITES):
    b = base[i]; v = [r[i] for r in res.values() if i in r]
    if not b: continue
    dry, med, top = b
    if dry > 0.25: continue                          # خضراء حتى في الصيف = مزارع أو شجر كثيف
    span = max(0.03, med - dry)
    sb, c = s2base[i] if i < len(s2base) else None, cur.get(i)
    if sb and sb[0] >= 0.3:
        farm.append(i); continue                     # القمر الدقيق شافها خضراء قبل المطر = زراعة داخل الفيضة
    if sb and c:
        # Sentinel-2: الفرق عن خضرة نفس الفيضة قبل الموسم (نفس القمر، 10 م) — الأدق
        (d8, p75, mean, gfrac, valid), = c
        g = p75 - sb[0]; gain_frac = gfrac - sb[1]
        started = g >= 0.04 or gain_frac >= 0.10
        idx = g / span
        st_ = 0 if not started else 1 if idx < 0.6 else 2 if idx < 1.2 else 3 if idx < 2 else 4
        check = 1 if g > JUMP else 0
        if check: st_ = 1                            # ما ننبّه عنها ولا نقول «أخضر من المعتاد» لين تتأكد ميدانيًا
        rows.append([i, round(max(0, g) * 1000), st_, round(max(0, gain_frac) * 100), 1, check, d8]); s2dates.append(d8)   # النسبة = زيادة المساحة الخضراء عن قبل الموسم
    elif v and modis_fresh:
        g = max(v) - dry; idx = g / span                 # بديل: MODIS (250 م)
        st_ = 0 if g < 0.02 else 1 if idx < 0.6 else 2 if idx < 1.2 else 3 if idx < 2 else 4
        rows.append([i, round(max(0, g) * 1000), st_, None, 0, 0, dates[-1]])
# الخضرة بدون مطر = سقي (مزارع جديدة) مو ربيع: نتأكد من مطر آخر 75 يوم لكل فيضة تبان خضراء
def rain75(idx):
    out = {}
    for k in range(0, len(idx), 80):
        part = idx[k:k + 80]
        q = urllib.parse.urlencode({"latitude": ",".join(str(SITES[i][1]) for i in part), "longitude": ",".join(str(SITES[i][2]) for i in part),
                                    "daily": "precipitation_sum", "past_days": 75, "forecast_days": 1, "timezone": "Asia/Riyadh"})
        for t in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request("https://api.open-meteo.com/v1/forecast?" + q, headers=UA), timeout=120) as r:
                    j = json.load(r)
                break
            except Exception as e:
                print("rain retry", str(e)[:80], flush=True); time.sleep(20 * (t + 1)); j = None
        if j is None: continue
        for i, loc in zip(part, j if isinstance(j, list) else [j]):
            out[i] = sum(v or 0 for v in loc["daily"]["precipitation_sum"])
    return out
green = [r[0] for r in rows if r[2] > 0]
rain = rain75(green) if green else {}
# + مطر الرادار (يلقط الزخات المحلية اللي النماذج تفوتها)
R = radar.load((today - dtm.timedelta(days=75)).isoformat())
for i in green:
    rr = sum(x for x in (radar.mm_at(rec, SITES[i][1], SITES[i][2]) for rec in R.values()) if x)
    rain[i] = max(rain.get(i, 0), rr)
# + محطات الأرصاد الأرضية خلال 50 كم (مقياس مطر فعلي؛ الملف يحدّثه مؤشر الفقع يوميًا) — وإذا مو موجود نحدّثه هنا
try:
    SY = synop.update(today - dtm.timedelta(days=75), today) if not os.path.exists(synop.FILE) else json.load(open(synop.FILE)); since75 = (today - dtm.timedelta(days=75)).isoformat()
    for i in green:
        g = synop.near(SY, SITES[i][1], SITES[i][2], max_km=50)
        if g: rain[i] = max(rain.get(i, 0), sum(v for d, v in g[1].items() if d >= since75))
except Exception as e:
    print("synop skipped", e)
dropped = []
for r in rows:
    if r[2] > 0 and rain.get(r[0], 0) < 8:
        dropped.append(f"{SITES[r[0]][0]} ({SITES[r[0]][3]}) خضرة {r[1]} مطر {rain.get(r[0], 0):.0f}")
        r[2] = 0; r[1] = min(r[1], 15)
# سجل: الفياض اللي بانت خضراء وشالها فلتر المطر (نراجعها: ربيع فاتته المصادر ولا مزارع مسقية؟)
print("::notice::dropped " + str(len(dropped)) + ": " + " · ".join(dropped)[:3500], flush=True)
print(f"::notice::green {len(green)} → after rain check {sum(r[2] > 0 for r in rows)}", flush=True)
rows.sort(key=lambda r: -r[1])
asof = max(s2dates) if s2dates else (dates[-1] if dates else "")
json.dump({"asof": asof, "dates": dates, "s2": len(s2dates), "n": len(SITES), "rows": rows, "farm": farm},
          open("data/fayd.json", "w"), separators=(",", ":"))
print("asof", dates, "rows", len(rows), "green", sum(r[2] > 0 for r in rows))

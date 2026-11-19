# 19 نوفمبر (طلب أبو مالك: «أهم شي الدقة — هل جا مطر كافي من بعد 16 أكتوبر»): اختبار مصدر رابع مستقل للمطر
# CHIRPS (أقمار صناعية + محطات، مصمم للمناطق الجافة — UCSB، مفتوح) مقابل رقمنا الحالي والمحطات. ما يغيّر التطبيق.
#  1) الموسم الحالي: مجموع CHIRPS من 16 أكتوبر لكل منطقة فقع، جنب fq.json والمحطة.
#  2) مواسم سابقة (2018/2019/2022/2025): CHIRPS مقابل أرشيف ERA5 (Open-Meteo) لـ16 أكتوبر–15 ديسمبر.
import json, os, sys, gzip, io, time, datetime as dt, urllib.request
import numpy as np, rasterio
from rasterio.io import MemoryFile
sys.path.insert(0, os.path.dirname(__file__))
import synop
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
BASE = "https://data.chc.ucsb.edu/products/CHIRPS-2.0"
FQ = json.load(open("data/fq.json")); AREAS = [(r["name"], r["region"], r["lat"], r["lng"]) for r in FQ["rows"]]
CACHE = "/tmp/chirps"; os.makedirs(CACHE, exist_ok=True)

def fetch(url):
    for i in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404): return None
            time.sleep(3)
        except Exception as e:
            print("fetch", url[-40:], str(e)[:60], flush=True); time.sleep(3)
    return None
from concurrent.futures import ThreadPoolExecutor
MODE = os.environ.get("MODE", "current")

def day_tif(d, res):
    """(src, data) ليوم: نجرب النهائي ثم المبدئي"""
    y, m, dd = d.year, d.month, d.day
    name = f"chirps-v2.0.{y}.{m:02d}.{dd:02d}.tif"
    for kind, url in (("final", f"{BASE}/global_daily/tifs/{res}/{y}/{name}.gz"), ("prelim", f"{BASE}/prelim/global_daily/tifs/{res}/{y}/{name}"),
                      ("prelim", f"{BASE}/prelim/global_daily/tifs/{res}/{y}/{name}.gz")):
        p = f"{CACHE}/{res}-{kind}-{name}"
        if os.path.exists(p): return kind, open(p, "rb").read()
        b = fetch(url)
        if b:
            if url.endswith(".gz"): b = gzip.decompress(b)
            open(p, "wb").write(b); return kind, b
    return None, None

def sample(b, pts):
    with MemoryFile(b) as mf, mf.open() as ds:
        arr = ds.read(1); out = []
        for la, lo in pts:
            r, c = ds.index(lo, la)
            # 3×3 حول النقطة (5 كم لكل خلية بدقة p05) — المتوسط، وننتبه للقيم الناقصة (-9999)
            w = arr[max(0, r - 1):r + 2, max(0, c - 1):c + 2].astype(float); w = w[w >= 0]
            out.append(float(w.mean()) if w.size else None)
        return out

pts = [(a[2], a[3]) for a in AREAS]
rep = {"made": dt.date.today().isoformat(), "current": [], "past": {}, "missing": []}
# ---------- 1) الموسم الحالي (دقة 0.05° ≈ 5 كم) ----------
start = dt.date(2026, 10, 16); today = dt.date.today() if MODE == "current" else dt.date(2026, 10, 15)
tot = [0.0] * len(AREAS); last = None; kinds = {}
days = [start + dt.timedelta(days=i) for i in range((today - start).days + 1)]
with ThreadPoolExecutor(8) as ex: res = list(ex.map(lambda d: (d, day_tif(d, "p05")), days))
for d, (kind, b) in res:
    if b:
        for k, v in enumerate(sample(b, pts)):
            if v is not None: tot[k] += v
        last = d.isoformat(); kinds[kind] = kinds.get(kind, 0) + 1
    else: rep["missing"].append(d.isoformat())
print("current done", kinds, flush=True)
SY = json.load(open(synop.FILE)).get("stations", {})
for k, (name, region, la, lo) in enumerate(AREAS):
    row = FQ["rows"][k]; g = synop.near({"stations": SY}, la, lo, 35)
    gt = round(sum(v for dd, v in g[1].items() if start.isoformat() <= dd <= (last or "")), 1) if g else None
    rep["current"].append({"name": name, "region": region, "ours": row["mm"], "chirps": round(tot[k], 1), "gauge": g[0] if g else None, "gauge_mm": gt, "st": row["st"]})
rep["current_until"] = last; rep["kinds"] = kinds
print(f"::notice::CHIRPS الموسم الحالي لين {last} — {kinds} — أيام ناقصة {len(rep['missing'])}")
for r in sorted(rep["current"], key=lambda r: -r["ours"]):
    print(f"::notice::{r['name']}: رقمنا {r['ours']} · أقمار {r['chirps']} · محطة {r['gauge'] or '—'} {'' if r['gauge_mm'] is None else r['gauge_mm']}")
# ---------- 2) مواسم سابقة: CHIRPS (0.25°) مقابل ERA5 ----------
def era5(la, lo, a, b):
    u = f"https://archive-api.open-meteo.com/v1/archive?latitude={la}&longitude={lo}&start_date={a}&end_date={b}&daily=precipitation_sum&timezone=Asia%2FRiyadh"
    b_ = fetch(u); 
    if not b_: return None
    v = json.loads(b_)["daily"]["precipitation_sum"]; return round(sum(x or 0 for x in v), 1)
for Y in ((2018, 2019, 2022, 2025) if MODE == 'past' else ()):
    a, b = dt.date(Y, 10, 16), dt.date(Y, 12, 15); ct = [0.0] * len(AREAS); n = 0
    ds = [a + dt.timedelta(days=i) for i in range((b - a).days + 1)]
    with ThreadPoolExecutor(8) as ex: res = list(ex.map(lambda d: day_tif(d, "p25"), ds))
    for kind, raw in res:
        if raw:
            n += 1
            for k, v in enumerate(sample(raw, pts)):
                if v is not None: ct[k] += v
    rows = []
    for k, (name, region, la, lo) in enumerate(AREAS):
        rows.append({"name": name, "chirps": round(ct[k], 1), "era5": era5(la, lo, a.isoformat(), b.isoformat())})
    rep["past"][str(Y)] = {"days": n, "rows": rows}
    print(f"::notice::موسم {Y} ({n} يوم): " + " · ".join(f"{r['name']} {r['chirps']}/{r['era5']}" for r in rows)[:3500])
json.dump(rep, open(f"data/fq-check-{MODE}.json", "w"), ensure_ascii=False, indent=1)

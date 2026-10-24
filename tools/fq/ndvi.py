# تجربة مؤشر الخضرة (NDVI) للفياض والرياض — MODIS MOD13Q1 (250م، كل 16 يوم) من خدمة ORNL المجانية
# + مطر ERA5 لنفس النقاط، للتحقق هل الأقمار تشوف الخضرة بعد المطر
import json, time, urllib.request, statistics as st

SITES = {  # من بيانات دليل (OSM/GeoNames)
    "فيضة خريم": (25.383, 47.285), "روضة نورة": (25.694, 46.225), "فيضة التنهات": (26.092, 46.491),
    "فيضة الخفس الشمالية": (25.560, 46.408), "روضة الخريمة": (25.406, 45.829), "روضة السبلة": (26.379, 44.980),
    "روضة أم عشر (الصمان)": (27.749, 45.067), "روضة محارب": (28.306, 45.105), "فيضة أم هويشر": (29.151, 45.166),
    "فيضة أبا رواث": (29.451, 43.836), "فيضة البطاحية": (29.160, 42.798), "فيضة الخضاب": (27.809, 42.394),
    "روضة عليان": (31.358, 41.398), "فيضة ابن شامان": (31.298, 41.100),
    "صحراء جرداء (مقارنة)": (24.30, 45.90),
}
UA = {"User-Agent": "dalil-app-study"}

def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            print("http", e.code, url[:110], flush=True)
            if e.code in (400, 404): return None
            time.sleep(15 * (i + 1))
        except Exception as e:
            print("err", str(e)[:80], url[:110], flush=True)
            time.sleep(10 * (i + 1))
    return None

from concurrent.futures import ThreadPoolExecutor
import urllib.error

def ndvi_req(name, lat, lng, y, d0, d1):
    url = (f"https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude={lat}&longitude={lng}&band=250m_16_days_NDVI"
           f"&kmAboveBelow=1&kmLeftRight=1&startDate=A{y}{d0:03d}&endDate=A{y}{d1:03d}")
    rows = []
    for row in (get(url) or {}).get("subset", []):
        vals = sorted(v for v in row["data"] if v > -2000)
        if vals:
            rows.append({"d": row["calendar_date"], "mean": round(st.mean(vals) / 1e4, 3), "p90": round(vals[max(0, int(len(vals) * .9) - 1)] / 1e4, 3)})
    return name, rows

# ذروة الربيع: يناير–أبريل كل سنة (9 صور بطلب واحد) + آخر صور هالسنة (سبتمبر–أكتوبر)
jobs = []
for name, (lat, lng) in SITES.items():
    for y in range(2001, 2027): jobs.append((name, lat, lng, y, 1, 129))
    jobs.append((name, lat, lng, 2026, 241, 300))
out = {"sites": {n: {"lat": la, "lng": lo, "ndvi": []} for n, (la, lo) in SITES.items()}, "asof": time.strftime("%Y-%m-%d")}
t0 = time.time()
with ThreadPoolExecutor(8) as ex:
    for i, (name, rows) in enumerate(ex.map(lambda j: ndvi_req(*j), jobs)):
        out["sites"][name]["ndvi"] += rows
        if i % 40 == 0: print(i, "/", len(jobs), round(time.time() - t0), "s", flush=True)
for s in out["sites"].values(): s["ndvi"].sort(key=lambda r: r["d"])

def rain(item):
    name, s = item
    url = ("https://archive-api.open-meteo.com/v1/archive?latitude=%s&longitude=%s&start_date=2000-09-01&end_date=2026-10-20"
           "&daily=precipitation_sum&timezone=Asia%%2FRiyadh" % (s["lat"], s["lng"]))
    j = get(url, 4)
    m = {}
    if j and "daily" in j:
        for d, p in zip(j["daily"]["time"], j["daily"]["precipitation_sum"]):
            if p: m[d[:7]] = round(m.get(d[:7], 0) + p, 1)
    return name, m
with ThreadPoolExecutor(3) as ex:
    for name, m in ex.map(rain, list(out["sites"].items())):
        out["sites"][name]["rain_month"] = m
        print("rain", name, len(m), flush=True)

json.dump(out, open("fq_ndvi.json", "w"), ensure_ascii=False)

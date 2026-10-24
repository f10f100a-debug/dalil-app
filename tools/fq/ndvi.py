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

def get(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return json.load(r)
        except Exception as e:
            print("retry", i, str(e)[:80], url[:90], flush=True)
            time.sleep(20 * (i + 1))
    return None

def doy(y, d): return f"A{y}{d:03d}"

out = {"sites": {}, "asof": time.strftime("%Y-%m-%d")}
for name, (lat, lng) in SITES.items():
    base = f"https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude={lat}&longitude={lng}&band=250m_16_days_NDVI&kmAboveBelow=1&kmLeftRight=1"
    ser = []
    for y in range(2001, 2027):
        # الموسم: من أكتوبر السنة السابقة إلى أبريل (نقسمه طلبات ≤10 تواريخ)
        spans = [(y - 1, 273, y - 1, 365), (y, 1, y, 129)]
        if y == 2026: spans.append((2026, 130, 2026, 300))
        for (y0, d0, y1, d1) in spans:
            if y0 < 2000 or (y0 == 2000 and d0 < 49): continue
            # قسّم كل 150 يوم (≈9 تواريخ)
            s = d0
            while s <= d1:
                e = min(s + 143, d1)
                j = get(base + f"&startDate={doy(y0, s)}&endDate={doy(y1 if y1 == y0 else y0, e)}")
                for row in (j or {}).get("subset", []):
                    vals = [v for v in row["data"] if v > -2000]
                    if not vals: continue
                    vals.sort()
                    ser.append({"d": row["calendar_date"], "mean": round(st.mean(vals) / 1e4, 3),
                                "p90": round(vals[int(len(vals) * .9) - 1 if len(vals) > 1 else 0] / 1e4, 3)})
                s = e + 1
                time.sleep(0.5)
    uniq = {r["d"]: r for r in ser}
    out["sites"][name] = {"lat": lat, "lng": lng, "ndvi": [uniq[k] for k in sorted(uniq)]}
    print(name, len(uniq), flush=True)

# مطر ERA5 اليومي لنفس النقاط (طلب لكل نقطة)
for name, s in out["sites"].items():
    url = ("https://archive-api.open-meteo.com/v1/archive?latitude=%s&longitude=%s&start_date=2000-09-01&end_date=2026-10-20"
           "&daily=precipitation_sum&timezone=Asia%%2FRiyadh" % (s["lat"], s["lng"]))
    j = None
    for i in range(8):
        j = get(url, 1)
        if j and "daily" in j: break
        time.sleep(90)
    if j and "daily" in j:
        m = {}
        for d, p in zip(j["daily"]["time"], j["daily"]["precipitation_sum"]):
            if p: m[d[:7]] = round(m.get(d[:7], 0) + p, 1)
        s["rain_month"] = m
    print("rain", name, bool(j and "daily" in j), flush=True)
    time.sleep(15)

json.dump(out, open("fq_ndvi.json", "w"), ensure_ascii=False)

# مؤشر الفقع: مطر الموسم (1 أكتوبر – 15 يناير) لمناطق الفقع المعروفة + وقت الظهور المتوقع (تاريخ المطر الكافي + 60–75 يوم)
# المصادر: Open-Meteo (أرشيف ERA5 للماضي + آخر 7 أيام وتوقع 7 أيام من نموذج التوقعات). يُشغَّل يوميًا → data/fq.json
import json, time, datetime as dt, urllib.request, urllib.parse
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
AREAS = [  # الاسم، المنطقة، خط العرض، خط الطول
  ["رفحاء", "الحدود الشمالية", 29.63, 43.49], ["لينة", "الحدود الشمالية", 28.76, 43.83], ["العويقيلة", "الحدود الشمالية", 30.33, 42.25],
  ["عرعر", "الحدود الشمالية", 30.97, 41.02], ["طريف", "الحدود الشمالية", 31.67, 38.66], ["سكاكا", "الجوف", 29.97, 40.20],
  ["دومة الجندل", "الجوف", 29.81, 39.87], ["الجوف - النبك", "الجوف", 31.10, 37.90], ["حفر الباطن", "الشرقية", 28.43, 45.96],
  ["القيصومة", "الشرقية", 28.31, 46.13], ["الدبدبة", "الشرقية", 28.70, 46.80], ["الصمان", "الشرقية", 27.60, 46.20],
  ["النعيرية", "الشرقية", 27.47, 48.49], ["حائل", "حائل", 27.52, 41.69], ["جبة (النفود)", "حائل", 28.02, 40.92],
  ["بقعاء", "حائل", 27.89, 42.40], ["الشملي", "حائل", 26.85, 40.30], ["بريدة", "القصيم", 26.33, 43.97],
  ["الأسياح", "القصيم", 26.58, 44.25], ["الزلفي", "الرياض", 26.30, 44.80], ["الأرطاوية", "الرياض", 26.50, 45.35],
  ["تبوك", "تبوك", 28.38, 36.57], ["تيماء", "تبوك", 27.63, 38.55],
]
GOOD, GREAT = 15, 40          # ملم: مطر يكفي / ممتاز للفقع
today = dt.date.today()
season = today.year if today.month >= 8 else today.year - 1
start, end = dt.date(season, 10, 1), dt.date(season + 1, 1, 15)

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r: return json.load(r)
        except Exception as e:
            print("retry", str(e)[:80], flush=True); time.sleep(20 * (i + 1))
    raise RuntimeError("fetch failed")

lat = ",".join(str(a[2]) for a in AREAS); lng = ",".join(str(a[3]) for a in AREAS)
rain = [dict() for _ in AREAS]   # تاريخ → ملم
if today > start:
    a_end = min(end, today - dt.timedelta(days=6))
    if a_end >= start:
        j = get("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode({"latitude": lat, "longitude": lng, "start_date": start, "end_date": a_end, "daily": "precipitation_sum", "timezone": "Asia/Riyadh"}))
        for k, loc in enumerate(j if isinstance(j, list) else [j]):
            for d, p in zip(loc["daily"]["time"], loc["daily"]["precipitation_sum"]): rain[k][d] = p or 0
# آخر 7 أيام (الأرشيف يتأخر) + توقع 7 أيام
j = get("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({"latitude": lat, "longitude": lng, "daily": "precipitation_sum", "past_days": 7, "forecast_days": 8, "timezone": "Asia/Riyadh"}))
fc = [0.0] * len(AREAS)
for k, loc in enumerate(j if isinstance(j, list) else [j]):
    for d, p in zip(loc["daily"]["time"], loc["daily"]["precipitation_sum"]):
        day = dt.date.fromisoformat(d)
        if day > today: fc[k] += p or 0
        elif start <= day <= end and d not in rain[k]: rain[k][d] = p or 0

rows = []
for k, (name, region, la, lo) in enumerate(AREAS):
    days = sorted(rain[k]); tot = 0.0; reached = None; best = (0.0, None)
    for i, d in enumerate(days):
        tot += rain[k][d]
        if reached is None and tot >= GOOD: reached = d
        s3 = sum(rain[k][x] for x in days[max(0, i - 2):i + 1])
        if s3 > best[0]: best = (s3, d)
    st = 0 if tot < GOOD else 1 if tot < GREAT else 2
    w = None
    if reached:
        r = dt.date.fromisoformat(reached)
        w = [(r + dt.timedelta(days=60)).isoformat(), (r + dt.timedelta(days=75)).isoformat()]
    rows.append({"name": name, "region": region, "lat": la, "lng": lo, "mm": round(tot), "st": st, "best": best[1], "bestmm": round(best[0]),
                 "reached": reached, "window": w, "fc7": round(fc[k])})
json.dump({"asof": today.isoformat(), "season": season, "start": start.isoformat(), "end": end.isoformat(), "good": GOOD, "great": GREAT, "rows": rows},
          open("data/fq.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("::notice::" + " · ".join(f"{r['name']} {r['mm']}" for r in sorted(rows, key=lambda r: -r["mm"])[:8]))

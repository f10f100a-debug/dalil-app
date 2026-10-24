# دراسة توقع الفقع: أمطار موسم الوسم (16 أكتوبر – 6 ديسمبر) لكل موسم من 2016، على شبكة شمال المملكة + مناطق الفقع المعروفة.
# المصدر: Open-Meteo Historical (ERA5 / ERA5-Land / IFS). يُشغَّل من GitHub Actions (الإنترنت مفتوح هناك).
import json, time, urllib.request, urllib.parse, datetime, sys

AREAS = {
  "رفحاء": (29.63, 43.49), "لينة": (28.76, 43.83), "العويقيلة": (30.33, 42.25), "عرعر": (30.97, 41.02),
  "طريف": (31.67, 38.66), "سكاكا": (29.97, 40.20), "دومة الجندل": (29.81, 39.87), "حفر الباطن": (28.43, 45.96),
  "القيصومة": (28.31, 46.13), "الدبدبة": (28.70, 46.80), "الصمان": (27.60, 46.20), "حائل": (27.52, 41.69),
  "جبة (النفود)": (28.02, 40.92), "بقعاء": (27.89, 42.40), "الشملي": (26.85, 40.30), "بريدة": (26.33, 43.97),
  "الأسياح": (26.58, 44.25), "الزلفي": (26.30, 44.80), "الأرطاوية": (26.50, 45.35), "النعيرية": (27.47, 48.49),
  "تبوك": (28.38, 36.57), "تيماء": (27.63, 38.55), "الجوف-النبك": (31.10, 37.90),
}
GRID = [(round(la, 2), round(lo, 2)) for la in [25.0 + i for i in range(8)] for lo in [36.0 + j for j in range(13)]]

def fetch(points, start, end, api="archive"):
    out = []
    for i in range(0, len(points), 40):
        chunk = points[i:i+40]
        q = {"latitude": ",".join(str(p[0]) for p in chunk), "longitude": ",".join(str(p[1]) for p in chunk),
             "daily": "precipitation_sum", "timezone": "Asia/Riyadh"}
        if api == "archive":
            q.update(start_date=start, end_date=end); url = "https://archive-api.open-meteo.com/v1/archive?"
        else:
            q.update(past_days=10, forecast_days=16); url = "https://api.open-meteo.com/v1/forecast?"
        for t in range(5):
            try:
                with urllib.request.urlopen(url + urllib.parse.urlencode(q), timeout=120) as r:
                    j = json.load(r); break
            except Exception as e:
                print("retry", e, file=sys.stderr); time.sleep(20 * (t + 1))
        else:
            raise SystemExit("fetch failed")
        j = j if isinstance(j, list) else [j]
        for p, d in zip(chunk, j):
            out.append({"lat": p[0], "lng": p[1], "time": d["daily"]["time"], "mm": d["daily"]["precipitation_sum"]})
        time.sleep(6)
    return out

def summarize(rows):
    res = []
    for r in rows:
        v = [x or 0 for x in r["mm"]]
        res.append({"lat": r["lat"], "lng": r["lng"], "total": round(sum(v), 1), "eff": sum(1 for x in v if x >= 10),
                    "early": round(sum(x for t, x in zip(r["time"], v) if t[5:] <= "11-15"), 1)})
    return res

pts = list(AREAS.values()) + GRID
names = {v: k for k, v in AREAS.items()}
result = {"areas": AREAS, "seasons": {}}
for y in range(2016, 2026):
    print("season", y, flush=True)
    s = summarize(fetch(pts, f"{y}-10-16", f"{y}-12-06"))
    for x in s: x["name"] = names.get((x["lat"], x["lng"]))
    result["seasons"][str(y)] = s
# الموسم الحالي: من 16 أكتوبر لين أمس (أرشيف + آخر أيام من التوقعات) + توقع 16 يوم
cur = fetch(pts, None, None, api="forecast")
today = datetime.date.today().isoformat()
now = []
for r in cur:
    past = [(t, x or 0) for t, x in zip(r["time"], r["mm"]) if "2026-10-16" <= t < today]
    fut = [(t, x or 0) for t, x in zip(r["time"], r["mm"]) if t >= today and t <= "2026-12-06"]
    now.append({"lat": r["lat"], "lng": r["lng"], "name": names.get((r["lat"], r["lng"])), "past": round(sum(x for _, x in past), 1),
                "fcst": round(sum(x for _, x in fut), 1), "days": [t for t, _ in past]})
result["current"] = {"asof": today, "points": now}
json.dump(result, open("fq_study.json", "w"), ensure_ascii=False)
print("done", len(pts), "points")

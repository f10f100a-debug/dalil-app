# دراسة: من أي تاريخ نحسب مطر الفقع؟ (أ) 1 أكتوبر (ب) 16 أكتوبر دخول الوسم (ج) 27 أكتوبر (د) 28 أكتوبر – 21 نوفمبر (25 يوم، من كلام أهل البادية)
# لكل موسم من 2016 ولكل منطقة فقع: مجموع المطر بكل طريقة حتى 6 ديسمبر (نهاية الوسم) و15 يناير، وتاريخ وصول 25 ملم.
# مصدران مستقلان: Open-Meteo (ERA5) و NASA POWER (MERRA-2 مصحح بالأقمار). يُشغَّل من GitHub Actions.
import json, time, urllib.request, urllib.parse, sys, datetime as dt
UA = {"User-Agent": "dalil-app-study"}
AREAS = {
  "رفحاء": (29.63, 43.49), "لينة": (28.76, 43.83), "العويقيلة": (30.33, 42.25), "عرعر": (30.97, 41.02),
  "طريف": (31.67, 38.66), "سكاكا": (29.97, 40.20), "دومة الجندل": (29.81, 39.87), "حفر الباطن": (28.43, 45.96),
  "القيصومة": (28.31, 46.13), "الدبدبة": (28.70, 46.80), "الصمان": (27.60, 46.20), "حائل": (27.52, 41.69),
  "جبة": (28.02, 40.92), "بقعاء": (27.89, 42.40), "الشملي": (26.85, 40.30), "بريدة": (26.33, 43.97),
  "الأسياح": (26.58, 44.25), "الزلفي": (26.30, 44.80), "الأرطاوية": (26.50, 45.35), "النعيرية": (27.47, 48.49),
  "تبوك": (28.38, 36.57), "تيماء": (27.63, 38.55), "النبك": (31.10, 37.90),
}
def get(url, tries=5):
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r: return json.load(r)
        except Exception as e:
            print("retry", str(e)[:80], file=sys.stderr, flush=True); time.sleep(20 * (t + 1))
    raise SystemExit("fetch failed " + url[:100])

names = list(AREAS); pts = [AREAS[n] for n in names]
# ERA5 (Open-Meteo): كل المناطق بطلب واحد لكل 8 مناطق
era = {}
for i in range(0, len(pts), 8):
    ch = pts[i:i+8]
    j = get("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode({"latitude": ",".join(str(p[0]) for p in ch),
        "longitude": ",".join(str(p[1]) for p in ch), "start_date": "2016-09-01", "end_date": (dt.date.today() - dt.timedelta(days=6)).isoformat(),
        "daily": "precipitation_sum", "timezone": "Asia/Riyadh"}))
    for k, loc in enumerate(j if isinstance(j, list) else [j]):
        era[names[i + k]] = {d: (p or 0) for d, p in zip(loc["daily"]["time"], loc["daily"]["precipitation_sum"])}
    print("era", i, flush=True); time.sleep(8)
# NASA POWER
pw = {}
for n in names:
    la, lo = AREAS[n]
    j = get("https://power.larc.nasa.gov/api/temporal/daily/point?" + urllib.parse.urlencode({"parameters": "PRECTOTCORR", "community": "AG",
        "longitude": lo, "latitude": la, "start": "20160901", "end": (dt.date.today() - dt.timedelta(days=4)).strftime("%Y%m%d"), "format": "JSON"}))
    d = j["properties"]["parameter"]["PRECTOTCORR"]
    pw[n] = {f"{k[:4]}-{k[4:6]}-{k[6:]}": max(0.0, v) for k, v in d.items() if v is not None and v > -900}
    print("power", n, flush=True); time.sleep(1)

STARTS = {"A": ("10-01", "12-06"), "B": ("10-16", "12-06"), "C": ("10-27", "12-06"), "D": ("10-28", "11-21")}
out = {"areas": AREAS, "seasons": {}}
for y in range(2016, 2026):
    out["seasons"][y] = {}
    for n in names:
        row = {}
        for src, S in (("era", era), ("power", pw)):
            s = S[n]
            pre = round(sum(v for d, v in s.items() if f"{y}-10-01" <= d < f"{y}-10-27"), 1)
            r = {"pre16": round(sum(v for d, v in s.items() if f"{y}-10-01" <= d < f"{y}-10-16"), 1),
                 "16to26": round(sum(v for d, v in s.items() if f"{y}-10-16" <= d < f"{y}-10-27"), 1),
                 "post_wasm": round(sum(v for d, v in s.items() if f"{y}-12-07" <= d <= f"{y+1}-01-15"), 1)}
            r["season"] = round(sum(v for d, v in s.items() if f"{y}-10-01" <= d <= f"{y+1}-01-15"), 1)
            for m, (st, en) in STARTS.items():
                days = sorted(d for d in s if f"{y}-{st}" <= d <= f"{y}-{en}")
                tot = 0; reached = None
                for d in days:
                    tot += s[d]
                    if reached is None and tot >= 25: reached = d
                r[m] = round(tot, 1); r[m + "_reach"] = reached
                # الحسبة الحالية تمتد لـ15 يناير
                if m == "A":
                    days2 = sorted(d for d in s if f"{y}-10-01" <= d <= f"{y+1}-01-15"); t2 = 0; r2 = None
                    for d in days2:
                        t2 += s[d]
                        if r2 is None and t2 >= 25: r2 = d
                    r["A_jan"] = round(t2, 1); r["A_jan_reach"] = r2
            row[src] = r
        out["seasons"][y][n] = row
json.dump(out, open("fq_start.json", "w"), ensure_ascii=False)
# ملخص: لكل موسم متوسط المناطق، وكم منطقة تختلف حالتها (أقل/أكثر من 25 و60) بين الطرق
lines = []
for y, rows in out["seasons"].items():
    for src in ("era", "power"):
        v = {m: sum(rows[n][src][m] for n in names) / len(names) for m in ("A", "B", "C", "D", "A_jan", "pre16", "16to26", "season")}
        st = lambda x: 0 if x < 25 else 1 if x < 60 else 2
        diff_BC = sum(1 for n in names if st(rows[n][src]["B"]) != st(rows[n][src]["C"]))
        diff_AC = sum(1 for n in names if st(rows[n][src]["A_jan"]) != st(rows[n][src]["C"]))
        good = {m: sum(1 for n in names if rows[n][src][m] >= 25) for m in ("A_jan", "B", "C", "D")}
        shareD = v["D"] / v["season"] * 100 if v["season"] else 0
        lines.append(f"{y} {src}: avg A {v['A_jan']:.0f} B {v['B']:.0f} C {v['C']:.0f} D {v['D']:.0f} (D={shareD:.0f}% of season) | pre16 {v['pre16']:.1f} 16-26 {v['16to26']:.1f} | areas>=25 A{good['A_jan']} B{good['B']} C{good['C']} D{good['D']}")
print("\n".join(lines))
print("::notice::" + " || ".join(l for l in lines if " era:" in l)[:3900])

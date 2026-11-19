# مؤشر الفقع: مطر الموسم من دخول الوسم (16 أكتوبر – 15 يناير) لمناطق الفقع المعروفة + وقت الظهور المتوقع (تاريخ المطر الكافي + 60–75 يوم)
# المصادر: Open-Meteo (أرشيف ERA5 + نموذج التوقعات لآخر 7 أيام) ومطر رادار الأرصاد المجمّع (radar_daily) — لكل يوم نأخذ الأعلى،
# لأن النماذج تفوّت الزخات الرعدية المحلية والرادار يلقطها. تأكيد إضافي: اخضرار الفياض القريبة. يُشغَّل يوميًا → data/fq.json
import json, time, math, datetime as dt, urllib.request, urllib.parse, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import radar, synop, rainqc
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
GOOD, GREAT = 25, 60          # ملم: مطر يكفي / ممتاز للفقع (مُعايرة على مواسم 2018 و2019 و2022 و2025)
today = dt.date.today()
season = today.year if today.month >= 8 else today.year - 1
# العد من دخول الوسم (16 أكتوبر) — دراسة 25 أكتوبر 2026: مطر قبله نادر في مناطق الفقع، ويُعرض منفصلًا «قبل الوسم» ولا ينحسب
fetch0, start, end = dt.date(season, 10, 1), dt.date(season, 10, 16), dt.date(season + 1, 1, 15)

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r: return json.load(r)
        except Exception as e:
            print("retry", str(e)[:80], flush=True); time.sleep(20 * (i + 1))
    raise RuntimeError("fetch failed")

lat = ",".join(str(a[2]) for a in AREAS); lng = ",".join(str(a[3]) for a in AREAS)
rain = [dict() for _ in AREAS]   # تاريخ → ملم
if today > fetch0:
    a_end = min(end, today - dt.timedelta(days=6))
    if a_end >= fetch0:
        j = get("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode({"latitude": lat, "longitude": lng, "start_date": fetch0, "end_date": a_end, "daily": "precipitation_sum", "timezone": "Asia/Riyadh"}))
        for k, loc in enumerate(j if isinstance(j, list) else [j]):
            for d, p in zip(loc["daily"]["time"], loc["daily"]["precipitation_sum"]): rain[k][d] = p or 0
# آخر 7 أيام (الأرشيف يتأخر) + توقع 7 أيام
j = get("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({"latitude": lat, "longitude": lng, "daily": "precipitation_sum", "past_days": 7, "forecast_days": 8, "timezone": "Asia/Riyadh"}))
fc = [0.0] * len(AREAS)
for k, loc in enumerate(j if isinstance(j, list) else [j]):
    for d, p in zip(loc["daily"]["time"], loc["daily"]["precipitation_sum"]):
        day = dt.date.fromisoformat(d)
        if day > today: fc[k] += p or 0
        elif fetch0 <= day <= end and d not in rain[k]: rain[k][d] = p or 0

# محطات الأرصاد الأرضية (مقياس مطر فعلي) — نحمّلها أول لأنها تنقّي الرادار
SY = None
try:
    SY = synop.update(fetch0, min(end, today))
    if synop.FAILED: print("::warning::synop failed " + " ".join(synop.FAILED))
except Exception as e:
    import traceback; print("::warning::synop skipped " + repr(e) + " " + traceback.format_exc().replace("\n", " | ")[-600:])
    try: SY = json.load(open(synop.FILE))
    except Exception: SY = None

# مطر الرادار: لكل يوم ناخذ الأعلى بين النموذج والرادار — بعد شيل الصدى الكاذب (rainqc)
R = radar.load(fetch0.isoformat())
Q = rainqc.QC(R, SY)
if Q.bad: print("::notice::radar echo days " + " · ".join(f"{d}: " + ",".join(f"{n} {v:.0f}" for _, _, n, v in b) for d, b in sorted(Q.bad.items()) if d >= start.isoformat())[:3000])
radar_days = [0] * len(AREAS)
src = [dict() for _ in AREAS]     # يوم → 'radar' إذا رقم اليوم جاء من الرادار
echo = [0.0] * len(AREAS)
for k, (name, region, la, lo) in enumerate(AREAS):
    for day in R:
        if not (fetch0.isoformat() <= day <= end.isoformat()): continue
        v, why = Q.radar(day, la, lo)
        if v is None: continue
        radar_days[k] += 1
        if why == "echo": echo[k] += radar.mm_at(R[day], la, lo) or 0
        if v > rain[k].get(day, 0): rain[k][day] = min(v, 120); src[k][day] = "radar"

def gkm(la, lo, gname):
    for wid, (n, a, b) in synop.STATIONS.items():
        if n == gname: return 6371 * 2 * math.asin(math.sqrt(math.sin(math.radians(a - la) / 2) ** 2 + math.cos(math.radians(la)) * math.cos(math.radians(a)) * math.sin(math.radians(b - lo) / 2) ** 2))
    return 80
gdist = [None] * len(AREAS)
# المحطة خلال 35 كم تحكم: صفر = صفر، وإلا اليوم ما يتجاوز ضعف رقمها (المطر يختلف شوي من مكان لمكان)
gauge = [None] * len(AREAS); gtot = [0.0] * len(AREAS)
for k, (name, region, la, lo) in enumerate(AREAS):
    g = Q.gauge(la, lo)
    if not g: continue
    gauge[k] = g[0]
    gtot[k] = sum(v for d, v in g[1].items() if start.isoformat() <= d <= end.isoformat())
    for day, v in g[1].items():
        if fetch0.isoformat() <= day <= end.isoformat():
            rain[k][day] = min(0.0 if v <= rainqc.DRY else max(v, min(rain[k].get(day, 0), 1.5 * v)), 150); src[k].pop(day, None)   # 19 نوفمبر: 1.5× بدل الضعف

# 13 نوفمبر (فحص الفقع: بريدة 37 ملم ومحطة القصيم 16): أيام بدون تقرير من المحطة كانت تنحسب من الرادار كامل.
# الحين: إذا فيه محطة خلال 80 كم والمجموع طلع أكثر من ضعفها (أو +15 ملم)، نصغّر أيام الرادار بنفس النسبة.
for k, (name, region, la, lo) in enumerate(AREAS):
    g = Q.gauge(la, lo, max_km=80)
    if not g: continue
    gt = sum(v for d, v in g[1].items() if start.isoformat() <= d <= end.isoformat())
    tot = sum(v for d, v in rain[k].items() if start.isoformat() <= d <= end.isoformat())
    # 19 نوفمبر (اختبار الدقة: بريدة 32 ومحطة القصيم 16، حائل 25 ومحطتها 17، القيصومة 40 ومحطتها 22): الحد يقرب من المحطة كل ما قربت
    gk = gkm(la, lo, g[0]); gdist[k] = gk
    lim = gt * (1 + gk / 80) + 2
    # كل الأيام اللي المحطة ما بلّغت فيها (رادار أو نموذج) — أول تشغيل: بريدة الزايد كان من النموذج مو الرادار
    rad = [d for d in rain[k] if start.isoformat() <= d <= end.isoformat() and d not in g[1] and rain[k][d] > 0]
    rsum = sum(rain[k][d] for d in rad)
    if tot > lim and rsum > 0:
        f = max(0.0, (rsum - (tot - lim)) / rsum)
        for d in rad: rain[k][d] = round(rain[k][d] * f, 1)
        print(f"::notice::fq cap {name}: {tot:.0f} → {lim:.0f} (محطة {g[0]} {gt:.0f} ملم)")

# 19 نوفمبر: مطر الأقمار الصناعية (CHIRPS) — المناطق اللي ما فيها محطة: إذا الرادار أعلى بكثير من الأقمار في نفس الأيام نصغّر أيام الرادار،
# و«مطر كافي» بدون محطة يحتاج الأقمار تقول قريب منه (مصدرين متفقين) — وإلا «غير مؤكد»
import chirps
CH = None
try: CH = chirps.update(AREAS, start, min(end, today))
except Exception as e: print("::warning::chirps skipped " + repr(e)[:200])
ch_cov = [0.0] * len(AREAS); ch_ext = [None] * len(AREAS)
if CH and CH.get("days"):
    cdays = sorted(d for d in CH["days"] if start.isoformat() <= d <= end.isoformat())
    span = max(1, (min(end, today) - start).days)
    for k, (name, region, la, lo) in enumerate(AREAS):
        cv = sum((CH["days"][d]["v"][k] or 0) for d in cdays)
        ours_cov = sum(rain[k].get(d, 0) for d in cdays)
        ch_cov[k] = cv; ch_ext[k] = cv * span / max(1, len(cdays)) if len(cdays) >= 10 else None
        if gdist[k] is not None or len(cdays) < 10: continue
        lim = 1.5 * cv + 10
        if ours_cov > lim:
            rd = [d for d in rain[k] if start.isoformat() <= d <= end.isoformat() and src[k].get(d) == "radar" and rain[k][d] > 0]
            rs = sum(rain[k][d] for d in rd)
            if rs > 0:
                f = max(0.0, (rs - (ours_cov - lim)) / rs)
                for d in rd: rain[k][d] = round(rain[k][d] * f, 1)
                print(f"::notice::fq chirps {name}: رادار {ours_cov:.0f} → {lim:.0f} (أقمار {cv:.0f} في {len(cdays)} يوم)")

# تأكيد من الخضرة: فياض خلال 60 كم صارت «مثل المعتاد» أو أخضر
fy_near = [0] * len(AREAS)
try:
    fy = json.load(open("data/fayd.json")); sites = json.load(open("data/fayd-sites.json"))
    green = [sites[r[0]] for r in fy.get("rows", []) if r[2] >= 2]
    def km(a, b, c, d): return 6371 * 2 * math.asin(math.sqrt(math.sin(math.radians(c - a) / 2) ** 2 + math.cos(math.radians(a)) * math.cos(math.radians(c)) * math.sin(math.radians(d - b) / 2) ** 2))
    for k, a in enumerate(AREAS): fy_near[k] = sum(1 for s in green if km(a[2], a[3], s[1], s[2]) <= 60)
except Exception as e:
    print("fayd confirm skipped", e)

rows = []; days_of = []
for k, (name, region, la, lo) in enumerate(AREAS):
    pre = sum(v for d, v in rain[k].items() if d < start.isoformat())   # قبل الوسم: يُعرض ولا ينحسب
    days = sorted(d for d in rain[k] if d >= start.isoformat()); days_of.append(days); tot = 0.0; reached = None; best = (0.0, None)
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
                 "reached": reached, "window": w, "pre": round(pre), "fc7": round(fc[k]), "radar": radar_days[k], "gauge": gauge[k], "green": fy_near[k],
                 "est": int(not gauge[k] and sum(rain[k][d] for d in days if src[k].get(d) == "radar") >= 0.5 * max(tot, 1)), "echo": round(echo[k]),
                 "sat": None if ch_ext[k] is None else round(ch_ext[k]), "gkm": None if gdist[k] is None else round(gdist[k]),
                 # الثقة: g محطة قريبة · c مصدرين متفقين (رادار/نماذج + أقمار) أو خضرة · u مصدر واحد
                 "conf": "g" if (gdist[k] is not None and gdist[k] <= 35) else ("c" if (fy_near[k] or (ch_ext[k] is not None and ch_ext[k] >= 0.6 * min(tot, GREAT))) else "u")})
for r in rows:
    if r["st"] >= 1 and r["conf"] == "u" and r["sat"] is not None:
        r["unc"] = 1; r["st_raw"] = r["st"]; r["st"] = 0      # 19 نوفمبر: «كافي» من مصدر واحد بس → غير مؤكد (ما ينعرض «مطر جيد»)
# ---- فحص قبل النشر: أي رقم مشكوك فيه ما ينشر كـ«مطر جيد» — يطلع «يحتاج تأكيد» ويوصل تنبيه للمطوّر (Issue في GitHub) ----
try: prev = {r["name"]: r for r in json.load(open("data/fq.json")).get("rows", [])}
except Exception: prev = {}
flags = []
for k, r in enumerate(rows):
    why = []
    if r["gauge"] and r["mm"] > gtot[k] * 1.5 + 5: why.append(f"أعلى بكثير من محطة {r['gauge']} ({gtot[k]:.0f} ملم)")
    if r["est"] and r["st"] >= 1 and not r["green"]: why.append("«مطر جيد» من الرادار بس، بدون محطة ولا خضرة تأكده")
    spike = [d for d in days_of[k] if src[k].get(d) == "radar" and rain[k][d] > 80]
    if spike and not r["gauge"]: why.append("يوم رادار فوق 80 ملم: " + ",".join(spike))
    p0 = prev.get(r["name"])
    if p0 and r["st"] - p0.get("st", 0) >= 2: why.append(f"قفز من {p0.get('mm')} إلى {r['mm']} ملم في تحديث واحد")
    if why:
        r["check"] = 1; r["st_raw"] = r["st"]; r["st"] = 0
        flags.append(f"- **{r['name']}** ({r['region']}): {r['mm']} ملم — " + " · ".join(why))
json.dump({"date": today.isoformat(), "flags": flags}, open("data/fq-qa.json", "w"), ensure_ascii=False, indent=1)
if flags: print("::warning::FQ check " + " | ".join(flags)[:3000])
json.dump({"asof": today.isoformat(), "season": season, "start": start.isoformat(), "end": end.isoformat(), "good": GOOD, "great": GREAT, "radar_days": len(R), "rows": rows},
          open("data/fq.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("::notice::" + " · ".join(f"{r['name']} {r['mm']}" for r in sorted(rows, key=lambda r: -r["mm"])[:8]))

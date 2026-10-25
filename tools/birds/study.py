# دراسة «هجرة الطيور»: متى تعبر الطيور المملكة وجيرانها (أرشيف GBIF العلمي)، وهل الريح الشمالية/البرودة/المطر تزيد العبور.
# يُشغَّل من GitHub Actions (الإنترنت مفتوح هناك). الناتج birds_study.json + ملخص.
import json, time, urllib.request, urllib.parse, sys, math, statistics as stt
UA = {"User-Agent": "dalil-app-study (birds)"}
def get(url, tries=5):
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r: return json.load(r)
        except Exception as e:
            print("retry", str(e)[:80], url[:120], file=sys.stderr, flush=True); time.sleep(6 * (t + 1))
    return None
GB = "https://api.gbif.org/v1/"
SPECIES = {   # الاسم المحلي ← الأسماء العلمية
  "السمان": ["Coturnix coturnix"],
  "الدخل": ["Sylvia atricapilla", "Curruca curruca", "Curruca communis", "Sylvia borin", "Phylloscopus trochilus", "Phylloscopus collybita"],
  "الصفار": ["Oriolus oriolus"],
  "الجرجس": ["Melanocorypha calandra", "Melanocorypha bimaculata"],
  "القميري": ["Streptopelia turtur"],
  "البط": ["Anas crecca", "Anas platyrhynchos", "Spatula querquedula", "Anas acuta", "Mareca penelope", "Spatula clypeata", "Aythya ferina"],
  "الوز": ["Anser anser", "Anser albifrons", "Anser erythropus"],
}
keys = {}
for ar, names in SPECIES.items():
    ks = []
    for n in names:
        j = get(GB + "species/match?" + urllib.parse.urlencode({"name": n, "kingdom": "Animalia"}))
        if j and j.get("usageKey") and j.get("matchType") != "NONE": ks.append(j["usageKey"])
        time.sleep(0.3)
    keys[ar] = ks
    print("keys", ar, ks, flush=True)

COUNTRIES = ["SA", "KW", "JO", "AE", "QA", "BH", "OM"]
BANDS = {"الشمال (>27°)": "27,33", "الوسط (23–27°)": "23,27", "الجنوب (<23°)": "16,23"}
def facet(params, f, lim=40):
    q = [("limit", 0), ("facet", f), ("facetLimit", lim)] + params
    j = get(GB + "occurrence/search?" + urllib.parse.urlencode(q))
    if not j or not j.get("facets"): return {}, (j or {}).get("count", 0)
    return {int(c["name"]): c["count"] for c in j["facets"][0]["counts"]}, j.get("count", 0)

out = {"keys": keys, "monthly": {}, "bands": {}, "weekly": {}, "night": {}}
for ar, ks in keys.items():
    tk = [("taxonKey", k) for k in ks]
    m, n = facet(tk + [("country", c) for c in COUNTRIES] + [("hasCoordinate", "true")], "month", 12)
    out["monthly"][ar] = {"total": n, "by_month": m}
    out["bands"][ar] = {}
    for bn, rng in BANDS.items():
        mb, nb = facet(tk + [("country", "SA"), ("decimalLatitude", rng)], "month", 12)
        out["bands"][ar][bn] = {"total": nb, "by_month": mb}
    print("monthly", ar, n, flush=True)

# أسابيع العبور: سجلات بتاريخها (حتى 3000 لكل نوع) في المملكة والكويت والأردن
for ar, ks in keys.items():
    doy = {}
    for k in ks:
        off = 0
        while off < 1500:
            j = get(GB + "occurrence/search?" + urllib.parse.urlencode([("taxonKey", k), ("country", "SA"), ("country", "KW"), ("country", "JO"), ("limit", 300), ("offset", off)]))
            if not j or not j.get("results"): break
            for r in j["results"]:
                mo, d = r.get("month"), r.get("day")
                if mo and d:
                    w = min(51, (sum([31,28,31,30,31,30,31,31,30,31,30,31][:mo - 1]) + d - 1) // 7)
                    doy[w] = doy.get(w, 0) + 1
            off += 300
            if j.get("endOfRecords"): break
            time.sleep(0.4)
    out["weekly"][ar] = doy
    print("weekly", ar, sum(doy.values()), flush=True)

# مؤشر الليلة: نسبة مشاهدات الطيور المهاجرة الصغيرة/السمان من كل مشاهدات الطيور باليوم (الكويت والمنطقة الشرقية = أكثر هواة)
# مقابل طقس الليلة قبلها (أرشيف ERA5): اتجاه الريح، البرودة، المطر
mig = [k for a in ("السمان", "الدخل", "الصفار", "القميري") for k in keys[a]]
days = {}
for y in range(2014, 2026):
    for mo in (9, 10, 11):
        a, _ = facet([("taxonKey", k) for k in mig] + [("country", "KW"), ("year", y), ("month", mo)], "day", 31)
        b, _ = facet([("taxonKey", 212), ("country", "KW"), ("year", y), ("month", mo)], "day", 31)
        for d, c in b.items():
            if c >= 20: days[f"{y}-{mo:02d}-{d:02d}"] = (a.get(d, 0), c)
        time.sleep(0.3)
    print("days", y, len(days), flush=True)
w = get("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode({"latitude": 29.3, "longitude": 47.9, "start_date": "2014-09-01", "end_date": "2025-11-30",
    "hourly": "wind_direction_10m,wind_speed_10m,temperature_2m,precipitation", "timezone": "Asia/Kuwait"}))
H = w["hourly"]; night = {}
for i, t in enumerate(H["time"]):
    if t[11:13] in ("21", "22", "23", "00", "01", "02", "03"):
        dkey = t[:10] if t[11:13] < "12" else None
        # الليلة تُنسب لصباح اليوم التالي
        import datetime as dt
        day = (dt.date.fromisoformat(t[:10]) + (dt.timedelta(days=1) if t[11:13] >= "21" else dt.timedelta(0))).isoformat()
        o = night.setdefault(day, {"n": 0, "u": 0, "v": 0, "ws": 0, "tmp": 0, "pr": 0})
        dr = math.radians(H["wind_direction_10m"][i] or 0); sp = H["wind_speed_10m"][i] or 0
        o["n"] += 1; o["v"] += -sp * math.cos(dr); o["u"] += -sp * math.sin(dr); o["ws"] += sp; o["tmp"] += H["temperature_2m"][i] or 0; o["pr"] += H["precipitation"][i] or 0
rows = []
for d, (a, b) in days.items():
    o = night.get(d)
    if not o or not o["n"]: continue
    rows.append({"d": d, "ratio": a / b, "mig": a, "all": b, "south_wind": o["v"] / o["n"], "ws": o["ws"] / o["n"], "tmin": o["tmp"] / o["n"], "rain": o["pr"]})
# فرق البرودة عن الليلة قبلها
byd = {r["d"]: r for r in rows}
import datetime as dt
for r in rows:
    p = night.get((dt.date.fromisoformat(r["d"]) - dt.timedelta(days=1)).isoformat())
    r["cooling"] = (p["tmp"] / p["n"] - r["tmin"]) if p and p["n"] else 0
def mean(xs): return sum(xs) / len(xs) if xs else float("nan")
north = [r["ratio"] for r in rows if r["south_wind"] < -2]      # v سالب = ريح من الشمال (تتجه جنوب)
south = [r["ratio"] for r in rows if r["south_wind"] > 1]
cold = [r["ratio"] for r in rows if r["cooling"] > 2]
warm = [r["ratio"] for r in rows if r["cooling"] < -1]
rain = [r["ratio"] for r in rows if r["rain"] > 0.5]
dry = [r["ratio"] for r in rows if r["rain"] == 0]
out["night"] = {"days": len(rows), "north_wind": [len(north), mean(north)], "south_wind": [len(south), mean(south)], "cooling": [len(cold), mean(cold)],
    "warming": [len(warm), mean(warm)], "rain": [len(rain), mean(rain)], "dry": [len(dry), mean(dry)], "rows": rows}
json.dump(out, open("birds_study.json", "w"), ensure_ascii=False)
print("::notice::" + json.dumps({k: v for k, v in out["night"].items() if k != "rows"}, ensure_ascii=False) + " | totals " + json.dumps({a: out["monthly"][a]["total"] for a in keys}, ensure_ascii=False))

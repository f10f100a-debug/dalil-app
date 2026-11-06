"""يفحص منطقة كل فيضة/روضة في data/fayd-sites.json مقابل حدود المناطق الإدارية الرسمية (geoBoundaries SAU ADM1).
الشبكة data/region-grid.json خاناتها 0.25° (~27 كم)، فالفياض القريبة من حدود منطقتين ممكن تنكتب بالمنطقة الغلط.
يكتب data/fayd-regions-report.json، ومع fix يصحح المنطقة في data/fayd-sites.json."""
import json, sys, urllib.request
api = json.load(urllib.request.urlopen("https://www.geoboundaries.org/api/current/gbOpen/SAU/ADM1/", timeout=60))
gj = json.load(urllib.request.urlopen(api["gjDownloadURL"], timeout=120))
# أسماء geoBoundaries (إنجليزي) ← أسماء التطبيق
AR = {"riyadh": "الرياض", "makkah": "مكة", "mecca": "مكة", "madinah": "المدينة", "medina": "المدينة", "al madinah": "المدينة",
      "qassim": "القصيم", "al qasim": "القصيم", "eastern": "الشرقية", "ash sharqiyah": "الشرقية", "asir": "عسير", "tabuk": "تبوك",
      "hail": "حائل", "ha'il": "حائل", "northern borders": "الحدود الشمالية", "al hudud ash shamaliyah": "الحدود الشمالية",
      "jazan": "جازان", "jizan": "جازان", "najran": "نجران", "al bahah": "الباحة", "baha": "الباحة", "al jawf": "الجوف", "jawf": "الجوف"}
def ar(name):
    n = name.lower().replace("province", "").replace("region", "").replace("-", " ").strip()
    for k, v in AR.items():
        if k in n: return v
    return None
polys = []
for f in gj["features"]:
    nm = f["properties"].get("shapeName", ""); r = ar(nm)
    g = f["geometry"]; parts = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    polys.append((r, nm, parts))
print("regions:", [(p[1], p[0]) for p in polys])
def inside(x, y, ring):
    c = False; j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]; xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
        j = i
    return c
def region(lat, lng):
    for r, nm, parts in polys:
        for p in parts:
            if inside(lng, lat, p[0]) and not any(inside(lng, lat, h) for h in p[1:]): return r
    return None
S = json.load(open("data/fayd-sites.json"))
bad = []
for i, s in enumerate(S):
    if not s: continue
    r = region(s[1], s[2])
    if r and len(s) > 3 and r != s[3]: bad.append({"i": i, "name": s[0], "lat": s[1], "lng": s[2], "was": s[3], "is": r})
json.dump({"n": len(S), "wrong": len(bad), "rows": bad}, open("data/fayd-regions-report.json", "w"), ensure_ascii=False, indent=0)
print(f"::notice::fayd sites {len(S)}, wrong region {len(bad)}")
from collections import Counter
print("::notice::" + " · ".join(f"{a}→{b}: {n}" for (a, b), n in Counter((x["was"], x["is"]) for x in bad).most_common(20)))
if "fix" in sys.argv[1:]:
    for x in bad: S[x["i"]][3] = x["is"]
    json.dump(S, open("data/fayd-sites.json", "w"), ensure_ascii=False, separators=(",", ":"))
    print("::notice::fixed")

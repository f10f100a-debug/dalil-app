"""يدوّر على فياض/رياض ناقصة من قائمة دليل: من OpenStreetMap (Overpass) + الفئات اللي انشالت من بياناتنا.
يكتب data/fayd-missing.json للمراجعة (ما يعدّل القائمة)."""
import json, math, os, re, urllib.request, urllib.parse
S = json.load(open("data/fayd-sites.json"))
# EXTRA=1: أسماء المنخفضات اللي يطلع فيها الربيع بالمناطق الثانية (خبراء القصيم وحائل، قيعان تبوك والحماد)
WORDS = "خبراء|خبرا|خبرة|خبره|قاع|قيعان" if os.environ.get("EXTRA") else "روضة|روضه|روض|فيضة|فيضه|فياض|رياض"
NAME = re.compile(r"^(ال)?(" + WORDS + r")\s")
BAD = re.compile(r"سد|قرية|مركز|مزرعة|مزارع|استراحة|محطة|حي |مخطط|شارع|طريق|مدرسة|مسجد|قصر|فندق|مستوصف|بلدية|سوق|مطعم|منتزه|حديقة")
def near(la, lo, km=1.5):
    for s in S:
        if s and abs(s[1] - la) < .02 and abs(s[2] - lo) < .02:
            if math.hypot((s[1] - la) * 111, (s[2] - lo) * 111 * math.cos(math.radians(la))) < km: return True
    return False
cand = {}
# 1) OSM عبر Overpass: أي عنصر اسمه يبدأ بفيضة/روضة/فياض داخل السعودية
q = """[out:json][timeout:180];area["ISO3166-1"="SA"][admin_level=2]->.sa;
(node(area.sa)["name"~"^(ال)?(""" + WORDS + """) "];way(area.sa)["name"~"^(ال)?(""" + WORDS + """) "];relation(area.sa)["name"~"^(ال)?(""" + WORDS + """) "];);out center tags;"""
for url in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
    try:
        j = json.load(urllib.request.urlopen(urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "dalil-app/1.0"}), timeout=240)); break
    except Exception as e: print("overpass", url, str(e)[:100]); j = {"elements": []}
osm = 0
for e in j["elements"]:
    t = e.get("tags", {}); nm = t.get("name", "").strip()
    la = e.get("lat") or e.get("center", {}).get("lat"); lo = e.get("lon") or e.get("center", {}).get("lon")
    if not la or not NAME.match(nm + " ") or BAD.search(nm): continue
    if t.get("highway") or t.get("building") or t.get("amenity") or t.get("shop") or t.get("place") in ("city", "town", "village", "suburb", "neighbourhood", "quarter"): continue
    if t.get("landuse") in ("residential", "commercial", "industrial", "farmland", "orchard"): continue
    osm += 1
    if near(la, lo): continue
    k = (round(la, 2), round(lo, 2))
    cand.setdefault(k, {"name": nm, "lat": round(la, 4), "lng": round(lo, 4), "src": "osm", "tags": {x: t[x] for x in ("natural", "landuse", "place", "water", "wetland") if x in t}})
# 2) بياناتنا: فئات انشالت (معلم رئيسي/معلم)
for f in ("data/desert-places.json", "data/open-places.json"):
    d = json.load(open(f))
    for p in d["p"]:
        nm, la, lo, cat = p[0].strip(), p[1], p[2], d["cats"][p[4]]
        if not NAME.match(nm + " ") or BAD.search(nm) or cat not in ("معلم رئيسي", "معلم", "جبل"): continue
        if near(la, lo): continue
        k = (round(la, 2), round(lo, 2))
        cand.setdefault(k, {"name": nm, "lat": round(la, 4), "lng": round(lo, 4), "src": f.split("/")[-1] + ":" + cat})
# دمج المكرر ضمن 1.5 كم
out = []
for c in cand.values():
    if any(math.hypot((o["lat"] - c["lat"]) * 111, (o["lng"] - c["lng"]) * 96) < 1.5 for o in out): continue
    out.append(c)
json.dump({"osm_total": osm, "n": len(out), "rows": out}, open("data/fayd-missing2.json" if os.environ.get("EXTRA") else "data/fayd-missing.json", "w"), ensure_ascii=False, indent=0)
print(f"::notice::OSM fayd-like {osm}, missing from list {len(out)} (osm {sum(o['src']=='osm' for o in out)})")
G = json.load(open("data/region-grid.json"))
def reg(la, lo):
    i = int((la - G["lat0"]) // G["r"]); j = int((lo - G["lng0"]) // G["r"])
    if i < 0 or j < 0 or i >= G["rows"] or j >= G["cols"]: return "?"
    c = ord(G["g"][i * G["cols"] + j]) - 97
    return G["regions"][c] if 0 <= c < len(G["regions"]) else "?"
from collections import defaultdict
by = defaultdict(list)
for o in out: by[reg(o["lat"], o["lng"])].append(o["name"] + ("" if o["src"] != "osm" else "·" + ",".join(f"{k}={v}" for k, v in o.get("tags", {}).items())))
for k, v in sorted(by.items(), key=lambda x: -len(x[1])): print(f"::notice::{k} {len(v)}: " + " · ".join(v)[:900])

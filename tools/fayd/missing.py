"""يدوّر على فياض/رياض ناقصة من قائمة دليل: من OpenStreetMap (Overpass) + الفئات اللي انشالت من بياناتنا.
يكتب data/fayd-missing.json للمراجعة (ما يعدّل القائمة)."""
import json, math, re, urllib.request, urllib.parse
S = json.load(open("data/fayd-sites.json"))
NAME = re.compile(r"^(ال)?(روضة|روضه|روض|فيضة|فيضه|فياض|رياض)\s")
BAD = re.compile(r"سد|قرية|مركز|مزرعة|مزارع|استراحة|محطة|حي |مخطط|شارع|طريق|مدرسة|مسجد|قصر|فندق|مستوصف|بلدية|سوق|مطعم|منتزه|حديقة")
def near(la, lo, km=1.5):
    for s in S:
        if s and abs(s[1] - la) < .02 and abs(s[2] - lo) < .02:
            if math.hypot((s[1] - la) * 111, (s[2] - lo) * 111 * math.cos(math.radians(la))) < km: return True
    return False
cand = {}
# 1) OSM عبر Overpass: أي عنصر اسمه يبدأ بفيضة/روضة/فياض داخل السعودية
q = """[out:json][timeout:180];area["ISO3166-1"="SA"][admin_level=2]->.sa;
(node(area.sa)["name"~"^(ال)?(روضة|روضه|روض|فيضة|فيضه|فياض|رياض) "];way(area.sa)["name"~"^(ال)?(روضة|روضه|روض|فيضة|فيضه|فياض|رياض) "];relation(area.sa)["name"~"^(ال)?(روضة|روضه|روض|فيضة|فيضه|فياض|رياض) "];);out center tags;"""
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
json.dump({"osm_total": osm, "n": len(out), "rows": out}, open("data/fayd-missing.json", "w"), ensure_ascii=False, indent=0)
print(f"::notice::OSM fayd-like {osm}, missing from list {len(out)} (osm {sum(o['src']=='osm' for o in out)})")
print("::notice::" + " · ".join(o["name"] for o in out if "صفا" in o["name"])[:500])

"""يجلب حدود المملكة من Natural Earth (1:10m) ويحفظها مبسّطة في data/sau-boundary.json لتصفية المواقع خارجها."""
import json, urllib.request
src = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson"
d = json.load(urllib.request.urlopen(src, timeout=120))
f = next(x for x in d["features"] if x["properties"].get("ADM0_A3") == "SAU")
g = f["geometry"]
polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
out = [[[[round(x, 4), round(y, 4)] for x, y in ring] for ring in poly] for poly in polys]
json.dump({"source": "Natural Earth 1:10m (public domain)", "type": "MultiPolygon", "coordinates": out}, open("data/sau-boundary.json", "w"), separators=(",", ":"))
print("::notice::polygons", len(out), "points", sum(len(r) for p in out for r in p))

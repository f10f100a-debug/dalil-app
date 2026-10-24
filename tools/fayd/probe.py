import sys, json, traceback
sys.argv = ["x", "probe"]
src = open("tools/fayd/update.py").read().split("import traceback, atexit")[0]
exec(src)
its = by_date(search("2024-03-01T00:00:00Z/2024-03-20T00:00:00Z"))
d, items = next(iter(its.items()))
it = items[0]
print("item", it["id"], it["bbox"])
href = it["assets"]["250m_16_days_NDVI"]["href"] + "?" + token()
try:
    with rasterio.open(href) as s:
        print("crs", s.crs, s.shape, s.transform)
        xs, ys = transform("EPSG:4326", s.crs, LNG[:3], LAT[:3]); print("pts", xs, ys, [~s.transform * (x, y) for x, y in zip(xs, ys)])
except Exception as e:
    traceback.print_exc()
print("sample", len(sample(it)))

# يجمع ملفات <slug>.json الناتجة من build_region.py في data/maps.json وينسخ الخرائط إلى maps/
import json, sys, glob, os, shutil
SRC, APP = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '../..'
V = int(os.environ.get('MAPS_V', '1'))
regions = []
for f in sorted(glob.glob(os.path.join(SRC, '*.json'))):
    r = json.load(open(f)); r['v'] = V; regions.append(r)
    for suf in ('.pmtiles', '-hs.pmtiles'):
        shutil.copy(os.path.join(SRC, r['id'] + suf), os.path.join(APP, 'maps', r['id'] + suf))
json.dump({'v': V, 'attribution': '© OpenStreetMap contributors (ODbL) · Copernicus DEM GLO-30', 'regions': regions},
          open(os.path.join(APP, 'data', 'maps.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(regions), 'regions,', round(sum(r['vt'] + r['hs'] for r in regions) / 1048576), 'MB')

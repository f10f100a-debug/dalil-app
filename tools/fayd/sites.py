# قائمة الفياض والرياض من بيانات دليل (OSM/GeoNames) — تُبنى مرة وتُحفظ في data/fayd-sites.json
import json, re, math
g = json.load(open('data/region-grid.json'))
def region(lat, lng):
    i, j = math.floor((lat - g['lat0']) / g['r']), math.floor((lng - g['lng0']) / g['r'])
    if not (0 <= i < g['rows'] and 0 <= j < g['cols']): return ''
    c = ord(g['g'][i * g['cols'] + j]) - 97
    return g['regions'][c] if 0 <= c < len(g['regions']) else ''
NAME = re.compile(r'^(ال)?(روضة|روضه|روض|فيضة|فيضه|فياض)\s')
KEEP = {'تجمع مياه', 'سبخة', 'مورد ماء'}
out = []
for f in ['data/desert-places.json', 'data/open-places.json']:
    d = json.load(open(f))
    for p in d['p']:
        name, lat, lng, cat = p[0].strip(), p[1], p[2], d['cats'][p[4]]
        if not NAME.match(name + ' ') or cat not in KEEP or re.search(r'سد|قرية|مركز|مزرعة|استراحة|محطة', name): continue
        if any(abs(o[1] - lat) < .012 and abs(o[2] - lng) < .014 for o in out): continue  # تكرار ضمن ~1.3 كم
        r = region(lat, lng)
        if r: out.append([name, round(lat, 4), round(lng, 4), r])
json.dump(out, open('data/fayd-sites.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out))

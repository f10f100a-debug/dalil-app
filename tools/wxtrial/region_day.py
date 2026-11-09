# أقوى أماكن المطر/البرد في منطقة ليوم محدد: شبكة 0.25° من region-grid، ثلاثة نماذج (ECMWF, GFS, ICON) عبر Open-Meteo
import json, sys, urllib.request, urllib.parse, math, collections, time
REGION, DAY = sys.argv[1], sys.argv[2]
G = json.load(open('data/region-grid.json')); RI = G['regions'].index(REGION)
cells = [(G['lat0'] + (i + .5) * G['r'], G['lng0'] + (j + .5) * G['r']) for i in range(G['rows']) for j in range(G['cols'])
         if ord(G['g'][i * G['cols'] + j]) - 97 == RI]
print('cells', len(cells), flush=True)
P = json.load(open('data/open-places.json')); towns = [x for x in P['p'] if P['cats'][x[4]] in ('معلم رئيسي',)]
def near(la, ln):
    b = min(towns, key=lambda x: (x[1] - la) ** 2 + ((x[2] - ln) * math.cos(math.radians(la))) ** 2)
    d = 111 * math.hypot(b[1] - la, (b[2] - ln) * math.cos(math.radians(la))); return b[0], round(d)
MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless']
res = collections.defaultdict(dict)
for m in MODELS:
    for k in range(0, len(cells), 80):
        ch = cells[k:k + 80]
        q = {'latitude': ','.join(f'{a:.3f}' for a, _ in ch), 'longitude': ','.join(f'{b:.3f}' for _, b in ch),
             'hourly': 'precipitation,weather_code,cape', 'models': m, 'timezone': 'Asia/Riyadh', 'start_date': DAY, 'end_date': DAY}
        for t in range(4):
            try:
                d = json.loads(urllib.request.urlopen('https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode(q), timeout=60).read()); break
            except Exception as e: print('retry', m, e, flush=True); time.sleep(20)
        if isinstance(d, dict): d = [d]
        for c, x in zip(ch, d):
            h = x['hourly']; pr = [v or 0 for v in h['precipitation']]; wc = [v or 0 for v in h['weather_code']]; cp = [v or 0 for v in h['cape']]
            res[c][m] = (round(sum(pr), 1), max(pr), max(wc), max(cp), [i for i, v in enumerate(wc) if v >= 95])
rows = []
for c, v in res.items():
    tots = [v[m][0] for m in MODELS if m in v]; agree = sum(t >= 5 for t in tots)
    thunder = sum(v[m][2] >= 95 for m in MODELS if m in v); hail = sum(v[m][2] in (96, 99) for m in MODELS if m in v)
    cape = max(v[m][3] for m in MODELS if m in v); hrs = sorted({h for m in MODELS if m in v for h in v[m][4]})
    rows.append((sorted(tots)[len(tots) // 2], agree, thunder, hail, cape, c, tots, hrs))
rows.sort(key=lambda r: (r[1], r[0], r[2]), reverse=True)
print('median_mm agree5mm thunder hail_codes maxCAPE  lat,lng  [ECMWF,GFS,ICON]  thunder_hours  nearest')
for r in rows[:25]:
    n, d = near(*r[5]); print(r[0], r[1], r[2], r[3], round(r[4]), f'{r[5][0]:.2f},{r[5][1]:.2f}', r[6], r[7][:1] + r[7][-1:], n, d, 'km')
print('cells with any model >=10mm:', sum(max(r[6]) >= 10 for r in rows), ' median>=5:', sum(r[0] >= 5 for r in rows))

if len(sys.argv) > 4:
    pl, pn = float(sys.argv[3]), float(sys.argv[4])
    near_rows = sorted(rows, key=lambda r: math.hypot(r[5][0] - pl, (r[5][1] - pn) * math.cos(math.radians(pl))))[:12]
    print('--- around point', pl, pn)
    for r in near_rows:
        dk = round(111 * math.hypot(r[5][0] - pl, (r[5][1] - pn) * math.cos(math.radians(pl))))
        n, d = near(*r[5]); print(dk, 'km from point |', r[0], r[1], r[2], r[3], round(r[4]), f'{r[5][0]:.2f},{r[5][1]:.2f}', r[6], r[7][:1] + r[7][-1:], n)

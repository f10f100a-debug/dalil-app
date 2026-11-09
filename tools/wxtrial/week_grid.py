# مطر الأسبوع للمملكة: شبكة 0.5° × 3 نماذج × 7 أيام → JSON مضغوط (يُطبع في السجل للتجربة)
import json, urllib.request, urllib.parse, time, gzip, base64
G = json.load(open('data/region-grid.json'))
cells = []
for i in range(0, G['rows'], 2):
    for j in range(0, G['cols'], 2):
        sub = [G['g'][(i + a) * G['cols'] + j + b] for a in (0, 1) for b in (0, 1) if i + a < G['rows'] and j + b < G['cols']]
        if any(c != '.' for c in sub): cells.append((round(G['lat0'] + (i + 1) * G['r'], 2), round(G['lng0'] + (j + 1) * G['r'], 2)))
print('cells', len(cells), flush=True)
MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless']
out = {'models': MODELS, 'cells': cells, 'days': None, 'p': {}, 'wc': {}}
for m in MODELS:
    P, W = [], []
    for k in range(0, len(cells), 100):
        ch = cells[k:k + 100]
        q = {'latitude': ','.join(str(a) for a, _ in ch), 'longitude': ','.join(str(b) for _, b in ch),
             'daily': 'precipitation_sum,weather_code', 'models': m, 'timezone': 'Asia/Riyadh', 'forecast_days': 7}
        for t in range(5):
            try: d = json.loads(urllib.request.urlopen('https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode(q), timeout=90).read()); break
            except Exception as e: print('retry', m, k, e, flush=True); time.sleep(30)
        d = d if isinstance(d, list) else [d]
        out['days'] = d[0]['daily']['time']
        for x in d:
            P.append([round(v or 0, 1) for v in x['daily']['precipitation_sum']]); W.append([v or 0 for v in x['daily']['weather_code']])
        time.sleep(1)
    out['p'][m] = P; out['wc'][m] = W
s = base64.b64encode(gzip.compress(json.dumps(out, separators=(',', ':')).encode())).decode()
print('B64LEN', len(s)); [print('B64:' + s[i:i + 3000]) for i in range(0, len(s), 3000)]

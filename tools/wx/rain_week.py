# مطر الأسبوع للمملكة (تجربة مخفية): 3 نماذج (ECMWF, GFS, ICON) على شبكة 0.5°، تُنعَّم إلى 0.25° للعرض
# الناتج data/rain-week.json: لكل خلية 0.25° فيها مطر: [صف، عمود، ثم لكل يوم: الوسيط×10، عدد النماذج ≥2 ملم، عدد النماذج برعد]
# + أقوى 5 أماكن لكل منطقة ولكل يوم (بأقرب معلم رئيسي من open-places)
import json, math, time, urllib.request, urllib.parse, datetime
A = 'data/'
G = json.load(open(A + 'region-grid.json')); R, LA0, LN0, NR, NC = G['r'], G['lat0'], G['lng0'], G['rows'], G['cols']
reg = lambda i, j: (ord(G['g'][i * NC + j]) - 97) if 0 <= i < NR and 0 <= j < NC and G['g'][i * NC + j] != '.' else -1
# شبكة الجلب 0.5°: مراكز عند حدود خلايا 0.25° الزوجية
pts = [(i, j) for i in range(0, NR + 1, 2) for j in range(0, NC + 1, 2)
       if any(reg(i + a, j + b) >= 0 for a in (-2, -1, 0, 1) for b in (-2, -1, 0, 1))]
MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless']
P = {m: {} for m in MODELS}; W = {m: {} for m in MODELS}; days = None
for m in MODELS:
    for k in range(0, len(pts), 100):
        ch = pts[k:k + 100]; d = None
        q = {'latitude': ','.join(f'{LA0 + i * R:.2f}' for i, _ in ch), 'longitude': ','.join(f'{LN0 + j * R:.2f}' for _, j in ch),
             'daily': 'precipitation_sum,weather_code', 'models': m, 'timezone': 'Asia/Riyadh', 'forecast_days': 7}
        for t in range(6):
            try: d = json.loads(urllib.request.urlopen('https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode(q), timeout=90).read()); break
            except Exception as e: print('retry', m, k, e, flush=True); time.sleep(30)
        if d is None: raise SystemExit('open-meteo failed')
        d = d if isinstance(d, list) else [d]; days = d[0]['daily']['time']
        for c, x in zip(ch, d):
            P[m][c] = [v or 0 for v in x['daily']['precipitation_sum']]; W[m][c] = [v or 0 for v in x['daily']['weather_code']]
        time.sleep(2)
    print(m, 'ok', flush=True)
def at(m, i, j, day, tab):
    # تنعيم ثنائي الخطي من نقاط 0.5° (المحيطة بمركز خلية 0.25°)
    y, x = i + .5, j + .5; i0, j0 = int(y // 2) * 2, int(x // 2) * 2; fy, fx = (y - i0) / 2, (x - j0) / 2; s = wsum = 0
    for (a, b, w) in ((i0, j0, (1 - fy) * (1 - fx)), (i0 + 2, j0, fy * (1 - fx)), (i0, j0 + 2, (1 - fy) * fx), (i0 + 2, j0 + 2, fy * fx)):
        v = tab[m].get((a, b))
        if v is not None: s += v[day] * w; wsum += w
    return s / wsum if wsum else 0
def thund(m, i, j, day):
    return max(W[m].get((a, b), [0] * 7)[day] for a in (i - i % 2, i - i % 2 + 2) for b in (j - j % 2, j - j % 2 + 2)) >= 95
cells = []; best = {}
O = json.load(open(A + 'open-places.json')); towns = [x for x in O['p'] if O['cats'][x[4]] == 'معلم رئيسي']
def near(la, ln): return min(towns, key=lambda x: (x[1] - la) ** 2 + ((x[2] - ln) * math.cos(math.radians(la))) ** 2)[0]
for i in range(NR):
    for j in range(NC):
        rg = reg(i, j)
        if rg < 0: continue
        row = [i, j]; anyr = False
        for day in range(7):
            v = sorted(at(m, i, j, day, P) for m in MODELS); med = v[1]; ag = sum(x >= 2 for x in v); th = sum(thund(m, i, j, day) for m in MODELS)
            row += [round(med * 10), ag, th]; anyr |= med >= 1 or ag >= 1
            if med >= 1: best.setdefault((rg, day), []).append((ag >= 2, med, ag, th, i, j))
        if anyr: cells.append(row)
top = {}
for (rg, day), lst in best.items():
    lst.sort(reverse=True); out = []; used = set()
    for ok, med, ag, th, i, j in lst:
        la, ln = LA0 + (i + .5) * R, LN0 + (j + .5) * R; n = near(la, ln)
        if n in used: continue
        used.add(n); out.append([n, round(med, 1), ag, th, round(la, 2), round(ln, 2)])
        if len(out) == 5: break
    top.setdefault(G['regions'][rg], [[] for _ in range(7)])[day] = out
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3)))
json.dump({'v': 1, 'at': now.strftime('%Y-%m-%dT%H:%M+03:00'), 'days': days, 'models': ['ECMWF', 'GFS', 'ICON'], 'r': R, 'lat0': LA0, 'lng0': LN0,
           'cells': cells, 'top': top, 'source': 'Open-Meteo (ECMWF IFS, NOAA GFS, DWD ICON)'},
          open(A + 'rain-week.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('cells', len(cells), 'days', days, 'Hail day1', top.get('حائل', [[]] * 7)[1][:3])

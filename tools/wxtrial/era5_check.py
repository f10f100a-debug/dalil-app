# مقارنة خلايا الرادار القوية بمطر ERA5 (Open-Meteo archive): مع برق مقابل بدون برق
import json, sys, urllib.request, urllib.parse, statistics
pts = [x.split(',') for x in open('tools/wxtrial/era5_pts.txt').read().strip().split(';')]
out = []
for k in range(0, len(pts), 60):
    ch = pts[k:k + 60]
    q = {'latitude': ','.join(p[0] for p in ch), 'longitude': ','.join(p[1] for p in ch), 'start_date': '2026-10-26', 'end_date': '2026-11-02',
         'daily': 'precipitation_sum', 'models': 'era5', 'timezone': 'Asia/Riyadh'}
    d = json.loads(urllib.request.urlopen('https://archive-api.open-meteo.com/v1/archive?' + urllib.parse.urlencode(q), timeout=120).read())
    d = d if isinstance(d, list) else [d]
    for p, x in zip(ch, d):
        t = x['daily']['time']; v = x['daily']['precipitation_sum']
        i = t.index(p[2]); mm = max(v[max(0, i - 0):i + 2] or [0])   # نفس اليوم أو اللي بعده (فرق التوقيت)
        out.append((int(p[3]), int(p[4]), mm or 0, p))
for L in (1, 0):
    s = [o for o in out if o[0] == L]
    mm = [o[2] for o in s]
    print('lightning' if L else 'no-lightning', 'n', len(s), 'ERA5>=1mm', sum(m >= 1 for m in mm), 'ERA5>=5mm', sum(m >= 5 for m in mm), 'median', statistics.median(mm))
    east = [o for o in s if 27 <= float(o[3][0]) <= 30.5 and 46.5 <= float(o[3][1]) <= 50.5]
    if east: print('   of which NE-Eastern/Kuwait box', len(east), 'ERA5>=1mm', sum(o[2] >= 1 for o in east))

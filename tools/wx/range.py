# طباعة توقع المطر اليومي لعدة مواقع من 3 نماذج (Open-Meteo) — فحص يدوي
import json, sys, urllib.request, urllib.parse
P = [('حائل',27.52,41.69),('بقعاء',27.89,42.4),('جبة',28.02,40.94),('الشملي',26.86,40.33),('عرعر',30.97,41.02),('طريف',31.67,38.66),
     ('رفحاء',29.63,43.49),('لينة',28.76,43.83),('العويقيلة',30.33,42.25),('سكاكا',29.97,40.2),('القريات',31.33,37.34),('حفر الباطن',28.43,45.96),
     ('القيصومة',28.31,46.13),('الصمان',27.6,46.2),('الدبدبة',28.7,46.8),('النعيرية',27.47,48.48),('تبوك',28.38,36.57),('بريدة',26.33,43.97)]
days = int(sys.argv[1]) if len(sys.argv) > 1 else 9
q = {'latitude': ','.join(str(p[1]) for p in P), 'longitude': ','.join(str(p[2]) for p in P),
     'daily': 'precipitation_sum,precipitation_probability_max', 'models': 'ecmwf_ifs025,gfs_seamless,icon_seamless',
     'forecast_days': days, 'timezone': 'Asia/Riyadh'}
import time
for k in range(5):
    try:
        d = json.load(urllib.request.urlopen('https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode(q), timeout=60)); break
    except Exception as e:
        print('retry', k, e, file=sys.stderr); time.sleep(10)
d = d if isinstance(d, list) else [d]
print('days', ' '.join(t[5:] for t in d[0]['daily']['time']))
for p, x in zip(P, d):
    dl = x['daily']; out = []
    for m in ('ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'):
        v = dl.get('precipitation_sum_' + m) or [None] * days
        out.append(m[:4] + ':' + ','.join('-' if a is None else ('%g' % round(a, 1)) for a in v))
    pr = dl.get('precipitation_probability_max_gfs_seamless') or dl.get('precipitation_probability_max_ecmwf_ifs025') or []
    print(p[0], ' | '.join(out), '| prob:' + ','.join(str(a) for a in pr))

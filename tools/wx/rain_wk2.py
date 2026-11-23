# مطر الأسبوع الثاني (23 نوفمبر، أبو مالك: «الناس ودها تعرف المطر لأسبوعين»): احتمال المطر للأيام 8–14
# من بيانات المركز الأوروبي المفتوحة (ECMWF ENS، 51 تشغيل، 0.25°، رخصة CC BY 4.0 — مسموحة حتى تجاريًا).
# ما نعطي كمية يوم بيوم (بعد أسبوع في الصحراء ضعيفة الدقة) — نعطي احتمال المطر للأسبوع كامل:
#   p2 = نسبة التشغيلات اللي فيها مطر يُذكر (≥ 4 ملم خام ≈ 2 ملم بعد معايرة الأسبوع 0.5)
#   p10 = نسبة التشغيلات اللي فيها مطر جيد (≥ 20 ملم خام ≈ 10 ملم)
# الناتج data/rain-wk2.json على نفس شبكة region-grid (خلايا 0.25° داخل المملكة) + أقوى 3 أماكن لكل منطقة
import json, math, os, sys, datetime
import numpy as np
from ecmwf.opendata import Client
import eccodes

A = 'data/'
G = json.load(open(A + 'region-grid.json')); R, LA0, LN0, NR, NC = G['r'], G['lat0'], G['lng0'], G['rows'], G['cols']
reg = lambda i, j: (ord(G['g'][i * NC + j]) - 97) if G['g'][i * NC + j] != '.' else -1
S0, S1 = 168, 336                    # الأيام 8–14 من تشغيل 00 UTC
STEPS = list(range(S0, S1 + 1, 24))  # 23 نوفمبر: يوم بيوم بعد (أبو مالك: «مافيها اي يوم»)
THD = 2.0                            # يوم فيه مطر: ≥ 2 ملم خام (≈ 1 ملم بعد المعايرة)
TH2, TH10 = 4.0, 20.0                # ملم خام (النماذج تبالغ عندنا ~ضعف — نفس معايرة مطر الأسبوع)

c = Client(source=os.environ.get('ECMWF_SRC', 'ecmwf'))
run = c.latest(stream='enfo', type='pf', param='tp', step=S1, time=0)
print('run', run, flush=True)
fn = 'wk2.grib2'
c.retrieve(date=run, time=0, stream='enfo', type=['cf', 'pf'], param='tp', step=STEPS, target=fn)
print('size', os.path.getsize(fn), flush=True)

# نقرأ: لكل تشغيل (number) ولكل خطوة — مصفوفة القيم (متر تراكمي)
F = {}; grid = None
with open(fn, 'rb') as f:
    while True:
        h = eccodes.codes_grib_new_from_file(f)
        if h is None: break
        try:
            num = eccodes.codes_get(h, 'number'); st = eccodes.codes_get(h, 'endStep')
            if grid is None:
                grid = dict(Ni=eccodes.codes_get(h, 'Ni'), Nj=eccodes.codes_get(h, 'Nj'),
                            la1=eccodes.codes_get(h, 'latitudeOfFirstGridPointInDegrees'), lo1=eccodes.codes_get(h, 'longitudeOfFirstGridPointInDegrees'),
                            di=eccodes.codes_get(h, 'iDirectionIncrementInDegrees'), dj=eccodes.codes_get(h, 'jDirectionIncrementInDegrees'),
                            jpos=eccodes.codes_get(h, 'jScansPositively'))
            F[(num, st)] = eccodes.codes_get_values(h).reshape(grid['Nj'], grid['Ni'])
        finally:
            eccodes.codes_release(h)
nums = sorted({k[0] for k in F if all((k[0], st) in F for st in STEPS)})
print('grid', grid, 'members', len(nums), flush=True)
if len(nums) < 30: raise SystemExit('too few members')

def idx(la, lo):
    j = round((la - grid['la1']) / grid['dj'] * (1 if grid['jpos'] else -1))
    i = round(((lo - grid['lo1']) % 360) / grid['di'])
    return j, i
W = np.stack([(F[(n, S1)] - F[(n, S0)]) * 1000.0 for n in nums])   # ملم لكل تشغيل
W[W < 0] = 0
WD = [np.clip(np.stack([(F[(n, STEPS[k + 1])] - F[(n, STEPS[k])]) * 1000.0 for n in nums]), 0, None) for k in range(7)]   # كل يوم

cells = []; best = {}; bestd = {}
for i in range(NR):
    for j in range(NC):
        rg = reg(i, j)
        if rg < 0: continue
        la, lo = LA0 + (i + .5) * R, LN0 + (j + .5) * R
        # متوسط الأربع نقاط المحيطة بمركز الخلية (شبكة ECMWF على مضاعفات 0.25°)
        v = np.zeros(len(nums)); vd = [np.zeros(len(nums)) for _ in range(7)]
        for a in (la - .125, la + .125):
            for b in (lo - .125, lo + .125):
                y, x = idx(a, b); v += W[:, y, x]
                for k in range(7): vd[k] += WD[k][:, y, x]
        v /= 4
        p2 = round(100 * float((v >= TH2).mean())); p10 = round(100 * float((v >= TH10).mean())); md = float(np.median(v)) * .5
        pd = [round(100 * float((vd[k] / 4 >= THD).mean())) for k in range(7)]
        if p2 >= 10 or max(pd) >= 10: cells.append([i, j, p2, p10, round(md * 10)] + pd)
        if p2 >= 20: best.setdefault(rg, []).append((p2, p10, la, lo))
        for k in range(7):
            if pd[k] >= 15: bestd.setdefault((rg, k), []).append((pd[k], 0, la, lo))

O = json.load(open(A + 'open-places.json')); towns = [x for x in O['p'] if O['cats'][x[4]] == 'معلم رئيسي' and not x[0].startswith(('جزيرة', 'جزر', 'طبق', 'شعب'))]   # أسماء برية مو جزر وشعاب بحرية
def near(la, ln): return min(towns, key=lambda x: (x[1] - la) ** 2 + ((x[2] - ln) * math.cos(math.radians(la))) ** 2)[0]
top = {}
for rg, lst in best.items():
    lst.sort(reverse=True); out = []
    for p2, p10, la, lo in lst:
        if any(((la - o[3]) * 111) ** 2 + ((lo - o[4]) * 111 * math.cos(math.radians(la))) ** 2 < 60 ** 2 for o in out): continue
        out.append([near(la, lo), p2, p10, round(la, 2), round(lo, 2)])
        if len(out) == 3: break
    top[G['regions'][rg]] = out
topd = {}
for (rg, k), lst in bestd.items():
    lst.sort(reverse=True); out = []
    for p, _, la, lo in lst:
        if any(((la - o[3]) * 111) ** 2 + ((lo - o[4]) * 111 * math.cos(math.radians(la))) ** 2 < 60 ** 2 for o in out): continue
        out.append([near(la, lo), p, 0, round(la, 2), round(lo, 2)])
        if len(out) == 3: break
    topd.setdefault(G['regions'][rg], [[] for _ in range(7)])[k] = out

d0 = datetime.date.fromisoformat(str(run)[:10])
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3)))
json.dump({'v': 1, 'at': now.strftime('%Y-%m-%dT%H:%M+03:00'), 'run': str(run)[:16], 'from': str(d0 + datetime.timedelta(days=7)), 'to': str(d0 + datetime.timedelta(days=13)),
           'members': len(nums), 'th': [2, 10], 'r': R, 'lat0': LA0, 'lng0': LN0, 'rows': NR, 'cols': NC,
           'days': [str(d0 + datetime.timedelta(days=7 + k)) for k in range(7)], 'cells': cells, 'top': top, 'topd': topd, 'source': 'ECMWF ENS open data (CC BY 4.0)'},
          open(A + 'rain-wk2.json', 'w'), ensure_ascii=False, separators=(',', ':'))
hi = sorted(((v[0][1], k, v[0][0]) for k, v in top.items() if v), reverse=True)
print(f"::notice::rain-wk2 {d0 + datetime.timedelta(days=7)}→{d0 + datetime.timedelta(days=13)} · members {len(nums)} · cells {len(cells)} · " + " · ".join(f"{k}: {n} {p}%" for p, k, n in hi[:6]), flush=True)

#!/usr/bin/env python3
"""مقارنة أماكن التطبيق (data/desert-places.json) مع مستخرج OSM حسب الاسم والمسافة.
الاستخدام: python3 osm_compare.py osm.csv desert-places.json region-grid.json out.json [radius_km]
"""
import csv, json, math, re, sys, collections

GENERIC = {'جبل', 'جبال', 'قمة', 'راس', 'رأس', 'تل', 'تلعة', 'هضبة', 'حرة', 'نفود', 'نفد', 'عرق', 'رملة', 'رمال',
           'وادي', 'شعيب', 'شعيبة', 'فيضة', 'روضة', 'عين', 'بئر', 'بير', 'قليب', 'قرية', 'هجرة', 'هجر', 'مركز', 'سد', 'غدير', 'ابار', 'آبار', 'قاع', 'خبراء', 'خبرا', 'سبخة', 'خشم', 'ضلع', 'ضليع', 'قارة', 'نازية', 'خور'}
AR_DIAC = re.compile(r'[ً-ْٰـ‌-‏‪-‮]')

def norm(s):
    s = AR_DIAC.sub('', s or '')
    s = re.sub('[أإآٱ]', 'ا', s).replace('ة', 'ه').replace('ى', 'ي').replace('ؤ', 'و').replace('ئ', 'ي')
    s = re.sub(r'[^\w\s]', ' ', s)
    return ' '.join(s.split())

def core(s):
    toks = [t for t in norm(s).split() if t not in {norm(g) for g in GENERIC}]
    toks = [t[2:] if t.startswith('ال') and len(t) > 3 else t for t in toks]
    return ' '.join(toks)

def hav(a, b, c, d):
    r = math.radians; x = math.sin(r(c - a) / 2) ** 2 + math.cos(r(a)) * math.cos(r(c)) * math.sin(r(d - b) / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))

def main():
    osm_csv, app_json, grid_json, out = sys.argv[1:5]
    R = float(sys.argv[5]) if len(sys.argv) > 5 else 2.0
    app = json.load(open(app_json, encoding='utf-8')); grid = json.load(open(grid_json, encoding='utf-8'))

    def region(lat, lng):
        i = math.floor((lat - grid['lat0']) / grid['r']); j = math.floor((lng - grid['lng0']) / grid['r'])
        if i < 0 or j < 0 or i >= grid['rows'] or j >= grid['cols']: return 'خارج الشبكة'
        c = ord(grid['g'][i * grid['cols'] + j]) - 97
        return grid['regions'][c] if 0 <= c < len(grid['regions']) else 'خارج الشبكة'

    A = [dict(i=k, name=p[0], lat=p[1], lng=p[2], region=app['regions'][p[3]], cat=app['cats'][p[4]],
              n=norm(p[0]), c=core(p[0])) for k, p in enumerate(app['p'])]
    O = []
    for row in csv.DictReader(open(osm_csv, encoding='utf-8')):
        lat, lng = float(row['lat']), float(row['lon'])
        O.append(dict(id=row['osm_id'], name=row['name'], type=row['type'], lat=lat, lng=lng,
                      region=region(lat, lng), n=norm(row['name']), c=core(row['name'])))

    # فهرس شبكي للتطبيق (خلايا 0.05°≈5.5كم)
    cell = 0.05; G = collections.defaultdict(list)
    for a in A: G[(int(a['lat'] // cell), int(a['lng'] // cell))].append(a)
    def near(lat, lng):
        ci, cj = int(lat // cell), int(lng // cell)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for a in G.get((ci + di, cj + dj), ()):
                    d = hav(lat, lng, a['lat'], a['lng'])
                    if d <= R: yield a, d

    app_hit = {}; res = []
    for o in O:
        best = None
        for a, d in near(o['lat'], o['lng']):
            lvl = 'exact' if o['n'] == a['n'] else 'core' if o['c'] and o['c'] == a['c'] else \
                  'partial' if o['c'] and a['c'] and (o['c'] in a['c'] or a['c'] in o['c']) and min(len(o['c']), len(a['c'])) >= 3 else None
            if lvl:
                rank = {'exact': 0, 'core': 1, 'partial': 2}[lvl]
                if best is None or (rank, d) < (best[0], best[2]): best = (rank, a, d, lvl)
        if best:
            app_hit.setdefault(best[1]['i'], (o, best[2], best[3]))
            res.append((o, best[1], best[2], best[3]))
        else:
            res.append((o, None, None, None))

    matched = [r for r in res if r[1]]; osm_only = [r[0] for r in res if not r[1]]
    app_only = [a for a in A if a['i'] not in app_hit]
    C = collections.Counter
    rep = dict(
        radius_km=R, app_total=len(A), osm_total=len(O),
        osm_matched=len(matched), app_matched=len(app_hit), osm_only=len(osm_only), app_only=len(app_only),
        match_levels=C(r[3] for r in matched),
        by_osm_type={t: dict(total=n, matched=sum(1 for r in matched if r[0]['type'] == t)) for t, n in C(o['type'] for o in O).items()},
        by_app_cat={c: dict(total=n, matched=sum(1 for a in A if a['cat'] == c and a['i'] in app_hit)) for c, n in C(a['cat'] for a in A).items()},
        osm_only_by_region=C(o['region'] for o in osm_only), app_only_by_region=C(a['region'] for a in app_only),
        osm_only_by_region_type={f"{k[0]}|{k[1]}": v for k, v in C((o['region'], o['type']) for o in osm_only).items()},
        ex_matched=[dict(osm=r[0]['name'], app=r[1]['name'], type=r[0]['type'], cat=r[1]['cat'], km=round(r[2], 2), lvl=r[3], region=r[1]['region'])
                    for r in matched[::max(1, len(matched) // 40)]][:40],
        ex_osm_only={t: [dict(name=o['name'], lat=o['lat'], lng=o['lng'], region=o['region']) for o in osm_only if o['type'] == t][:12]
                     for t in C(o['type'] for o in osm_only)},
        ex_app_only={c: [dict(name=a['name'], lat=a['lat'], lng=a['lng'], region=a['region']) for a in app_only if a['cat'] == c][:10]
                     for c in C(a['cat'] for a in app_only)},
    )
    json.dump(rep, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    csv_out = out.rsplit('.', 1)[0] + '_osm_only.csv'
    with open(csv_out, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['osm_id', 'type', 'name', 'lat', 'lon', 'region'])
        for o in osm_only: w.writerow([o['id'], o['type'], o['name'], o['lat'], o['lng'], o['region']])
    print(json.dumps({k: rep[k] for k in ('app_total', 'osm_total', 'osm_matched', 'app_matched', 'osm_only', 'app_only', 'match_levels')}, ensure_ascii=False))

if __name__ == '__main__':
    main()

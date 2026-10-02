# يضيف إلى قائمة OpenStreetMap (osm-full.json) معالم GeoNames العربية غير الموجودة فيها
# (الآبار والعيون والسباخ والأودية خصوصًا)، فينتج data/open-places.json — كله من مصادر مفتوحة:
# OpenStreetMap (ODbL) و GeoNames (CC BY 4.0).
# الاستعمال: python3 add_geonames.py ../../data/osm-full.json SA.txt ../../data/open-places.json
# SA.txt من https://download.geonames.org/export/dump/SA.zip
import json, re, collections, difflib, sys
from shapely import STRtree
from shapely.geometry import Point
from pyproj import Transformer
OSM, GN, OUT = sys.argv[1:4]
T = Transformer.from_crs(4326, 32638, always_xy=True).transform
TASHKEEL = re.compile(r'[ً-ٰـ]'); AR = re.compile(r'[ء-ي]')
def norm(s):
    s = TASHKEEL.sub('', s).translate(str.maketrans('أإآٱؤئىةٲ', 'ااااوييها'))
    return ' '.join(re.sub(r'[^\w\s]', ' ', s.lower()).split())
GEN = set(norm(w) for w in 'جبل جبال جبيل تل تلال قمة قمه ريع كهف غار مغارة دحل عين عيون بئر ابار نفود عرق عروق رملة رمال طعس طعوس قارة خشم ضلع حزم برقاء ابرق هضبة وادي شعيب قاع روضة خبراء خبرا سبخة فيضة فيضه حرة نقرة مشاش قليب'.split())
def core(s):
    t = norm(s).split()
    while len(t) > 1 and t[0] in GEN: t = t[1:]
    return ' '.join(w[2:] if w.startswith('ال') and len(w) > 3 else w for w in t)
def clean(s): return ' '.join(TASHKEEL.sub('', s).replace('ٲ', 'أ').split())
CAT = {'T.HLL':'جبل','T.HLLS':'جبل','T.MT':'جبل','T.MTS':'جبل','T.RDGE':'جبل','T.PK':'جبل','T.SCRP':'جبل','T.PROM':'جبل','T.MESA':'جبل','T.BUTE':'جبل','T.CLF':'جبل',
 'T.DUNE':'نفود','T.ERG':'نفود','T.SAND':'نفود','T.DUNES':'نفود',
 'H.WAD':'تجمع مياه','H.WADS':'تجمع مياه','H.WADJ':'تجمع مياه','T.DPR':'تجمع مياه','H.PNDI':'تجمع مياه','H.PNDSI':'تجمع مياه','T.PLN':'معلم',
 'H.WLL':'مورد ماء','H.WLLS':'مورد ماء','H.SPNG':'مورد ماء','H.WTRH':'مورد ماء','H.CSTN':'مورد ماء','H.RSV':'مورد ماء',
 'H.SBKH':'سبخة','T.LAVA':'حرة','T.CAVE':'كهف','T.CRTR':'كهف','S.RUIN':'آثار','S.ANS':'آثار','S.HSTS':'آثار','S.FT':'آثار','S.CSTL':'آثار',
 'L.LCTY':'معلم','P.PPL':'معلم رئيسي','P.PPLX':'معلم رئيسي','P.PPLL':'معلم رئيسي','P.PPLQ':'معلم رئيسي','T.TRGD':'معلم','L.AREA':'معلم'}
g = json.load(open(__file__.rsplit('/', 3)[0] + '/data/region-grid.json'))
def reg(lat, lng):
    i = int((lat - g['lat0']) // g['r']); j = int((lng - g['lng0']) // g['r'])
    if i < 0 or j < 0 or i >= g['rows'] or j >= g['cols']: return None
    c = ord(g['g'][i * g['cols'] + j]) - 97
    return g['regions'][c] if 0 <= c < len(g['regions']) else None
osm = json.load(open(OSM))
op = [Point(T(x[2], x[1])) for x in osm['p']]; oc = [core(x[0]) for x in osm['p']]; tree = STRtree(op)
same = lambda a, cs: a in cs or any(len(a) >= 4 and len(c) >= 4 and difflib.SequenceMatcher(None, a, c).ratio() >= 0.86 for c in cs)
add = []; st = collections.Counter(); seen = collections.defaultdict(list)
for l in open(GN, encoding='utf-8'):
    r = l.rstrip('\n').split('\t'); fc = r[6] + '.' + r[7]
    if fc not in CAT: continue
    names = [clean(n) for n in [r[1]] + r[3].split(',') if AR.search(n)]
    names = [n for n in names if len(norm(n).replace(' ', '')) >= 3 and norm(n) not in GEN]
    if not names: st['no_arabic'] += 1; continue
    lat, lng = float(r[4]), float(r[5]); rg = reg(lat, lng)
    if not rg: st['outside'] += 1; continue
    cs = set(core(n) for n in names); p = Point(T(lng, lat))
    if any(same(oc[i], cs) for i in tree.query(p, predicate='dwithin', distance=2000)): st['in_osm'] += 1; continue
    k = core(names[0])
    if any(q.distance(p) < 1000 for q in seen[k]): st['dup'] += 1; continue
    seen[k].append(p); add.append([names[0], round(lat, 5), round(lng, 5), rg, CAT[fc]])
regions = osm['regions'][:]; cats = osm['cats'][:]
def idx(lst, v):
    if v not in lst: lst.append(v)
    return lst.index(v)
p = osm['p'] + [[a[0], a[1], a[2], idx(regions, a[3]), idx(cats, a[4])] for a in add]
res = {'v': 1, 'source': osm['source'] + '; GeoNames (CC BY 4.0) geonames.org', 'osm': len(osm['p']), 'geonames': len(add), 'regions': regions, 'cats': cats, 'p': p}
open(OUT, 'w').write(json.dumps(res, ensure_ascii=False, separators=(',', ':')))
print(dict(st), 'added', len(add), 'total', len(p)); print(collections.Counter(a[4] for a in add))

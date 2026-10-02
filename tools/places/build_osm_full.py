# يبني data/osm-full.json: كل معالم OpenStreetMap البرية المسمّاة في السعودية (جبال، رمال، أودية،
# عيون وآبار، كهوف، قرى وهجر) — بديل نظامي كامل لمواقع «خرائط البر» (رخصة ODbL مع ذكر المصدر).
# المدخل: osm.pkl من مستخرج Overture Maps (انظر tools/mapbuild/README.md).
# الاستعمال: python3 build_osm_full.py osm.pkl osm-full.json
import json, pickle, re, collections, sys
feats = pickle.load(open(sys.argv[1], 'rb')); OUT = sys.argv[2]
AR = re.compile(r'^[ء-ي٠-٩ٰٱ\s\-\'’()0-9]+$')
TASHKEEL = re.compile(r'[ً-ٰٟـ]')
def clean(s):
    s = s.translate(str.maketrans({'ھ': 'ه', 'ہ': 'ه', 'ی': 'ي', 'ې': 'ي', 'ک': 'ك', 'ۃ': 'ة', '‌': '', '‏': '', '‎': ''}))
    return ' '.join(TASHKEEL.sub('', s).replace('(', ' ').replace(')', ' ').split())
def norm(s):
    s = TASHKEEL.sub('', s).translate(str.maketrans('أإآٱؤئىة', 'ااااوييه'))
    return ' '.join(re.sub(r'[^\w\s]', ' ', s.lower()).split())
GEN = set(norm(w) for w in 'جبل جبال جبيل تل تلال قمة قمه ريع كهف غار مغارة دحل عين عيون بئر ابار نفود عرق عروق رملة رمال طعس طعوس قارة خشم ضلع حزم برقاء ابرق هضبة وادي شعيب'.split())
CAT = {'قرى وهجر': 'معلم رئيسي', 'جبال وقمم وتلال': 'جبل', 'رمال ونفود': 'نفود', 'عيون وآبار': 'مورد ماء', 'كهوف وفوهات': 'كهف', 'أودية': 'تجمع مياه'}
REGIONS = ["جازان","حائل","الحدود الشمالية","الجوف","عسير","مكة","الشرقية","نجران","الباحة","تبوك","المدينة","القصيم","الرياض"]
stats = collections.Counter(); out = []
for f in feats:
    if f['group'] not in CAT: continue
    ar = [clean(x) for x in f['names'] if AR.match(clean(x) or 'x')]
    ar = [x for x in ar if len(norm(x).replace(' ', '')) >= 3]
    if not ar: stats['no_arabic'] += 1; continue
    name = ar[0]
    if norm(name) in GEN: stats['generic'] += 1; continue
    cat = CAT[f['group']]
    if cat == 'كهف' and norm(name).split()[0] in ('دحل', 'دحول', 'دحله'): cat = 'دحل'
    out.append(dict(name=name, lat=f['lat'], lng=f['lng'], region=f['region'], cat=cat, osm=f['osm'], n=norm(name), g=f['geom']))
out.sort(key=lambda o: (o['g'].geom_type != 'Point', o['osm']))
kept = []; byname = collections.defaultdict(list)
for o in out:   # الاسم نفسه ضمن 1 كم داخل OSM (قمة مرسومة نقطة ومساحة مثلًا)
    if any(k['g'].distance(o['g']) < 1000 for k in byname[o['n']]): stats['dup'] += 1; continue
    byname[o['n']].append(o); kept.append(o)
regions = REGIONS[:]; cats = []
def idx(lst, v):
    if v not in lst: lst.append(v)
    return lst.index(v)
kept.sort(key=lambda o: (regions.index(o['region']) if o['region'] in regions else 99, o['cat'], o['name']))
res = {'v': 1, 'source': 'OpenStreetMap contributors (ODbL) via Overture Maps 2026-09-23.1', 'regions': regions, 'cats': cats,
       'p': [[o['name'], o['lat'], o['lng'], idx(regions, o['region']), idx(cats, o['cat'])] for o in kept]}
open(OUT, 'w').write(json.dumps(res, ensure_ascii=False, separators=(',', ':')))
print(dict(stats), 'kept', len(kept)); print(collections.Counter(o['cat'] for o in kept))

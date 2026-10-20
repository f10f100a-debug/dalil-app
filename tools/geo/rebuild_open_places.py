import json,re,collections,math
exec(open('tools/geo/sau_poly.py').read())
APP='data/'
d=json.load(open(APP+'open-places.json')); g=json.load(open(APP+'region-grid.json'))
m=json.load(open('missing.json'))['miss']
TASH=re.compile('[ً-ٰٟـ]')
def norm(s):
    s=TASH.sub('',s or '').strip(); s=re.sub('[أإآٱ]','ا',s).replace('ة','ه').replace('ى','ي')
    return re.sub(r'[^\w]','',re.sub(r'\bال','',s))
def hav(a,b,c,d):
    R=6371000;p1,p2=math.radians(a),math.radians(c)
    return 2*R*math.asin(math.sqrt(math.sin((p2-p1)/2)**2+math.cos(p1)*math.cos(p2)*math.sin(math.radians(d-b)/2)**2))
def region(lat,lng):
    R,C=g['rows'],g['cols']; r0=int((lat-g['lat0'])/g['r']); c0=int((lng-g['lng0'])/g['r'])
    for rad in range(0,6):
        best=None
        for r in range(r0-rad,r0+rad+1):
            for c in range(c0-rad,c0+rad+1):
                if 0<=r<R and 0<=c<C:
                    ch=g['g'][r*C+c]
                    if ch!='.':
                        dd=(r-r0)**2+(c-c0)**2
                        if best is None or dd<best[0]: best=(dd,ord(ch)-97)
        if best: return best[1]
    return 12
# 1) حذف ما هو خارج المملكة (بهامش 2 كم)
keep=[];removed=0
for p in d['p']:
    nm,a,lo,ri,ci=p
    if inside(lo,a) or dist_border(lo,a)<2: keep.append(p)
    else: removed+=1
# 2) إضافة المواقع البرية الناقصة من تصدير أوسماند (OSM)
TYPE2CAT={'بئر':3,'عين':3,'بركة/خزان':3,'ماء':3,'أطلال':9,'موقع أثري':9,'رمال/نفود':4,'كثيب':4,'جبل/قمة':1,'جرف':1,'صخرة':1,'حجر':1,'حافة':1,'بركان':10,'فوهة':10,'غار/كهف':5,'موضع/مكان':7,'جزيرة':7,'جزيرة صغيرة':7,'خليج/شرم':7,'رأس':7,'شاطئ':7}
GENERIC={'بئر','غار','معلم أثري','بركه','قليب','جبل','وادي','روضه','عين','ماء','مياه'}
seen=collections.defaultdict(list)
for nm,a,lo,ri,ci in keep: seen[norm(nm)].append((a,lo))
added=0;cnt=collections.Counter()
for name,a,lo,typ in m:
    name=re.sub(r'\s+',' ',name).strip(" .'\"")
    if len(name)<3 or norm(name) in {norm(x) for x in GENERIC}: continue
    if not re.search('[؀-ۿ]',name): continue   # نكتفي بالأسماء العربية
    if typ=='روضة/سبخة/خبراء': ci=8 if re.match(r'^(سبخ|سبخة)',name) else 0
    else: ci=TYPE2CAT.get(typ)
    if ci is None: continue
    k=norm(name)
    if any(hav(a,lo,x,y)<300 for x,y in seen[k]): continue
    seen[k].append((a,lo))
    keep.append([name,round(a,5),round(lo,5),region(a,lo),ci]); added+=1; cnt[d['cats'][ci]]+=1
d['p']=keep; d['v']=2
d['source']='OpenStreetMap contributors (ODbL) via Overture Maps 2026-09-23.1 and OsmAnd export 2026-10-01; GeoNames (CC BY 4.0) geonames.org'
d['osm']=d.get('osm',0)+added
print('removed',removed,'added',added,'total',len(keep),cnt.most_common())
json.dump(d,open(APP+'open-places.json','w'),ensure_ascii=False,separators=(',',':'))

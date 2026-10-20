import json,csv,re,math,collections,sys
from bisect import bisect_left
U='/root/.claude/uploads/9d5ba0b7-c942-5f67-b966-e6cebf562546/'
TASH=re.compile('[ً-ٰٟـ]')
def norm(s):
    s=TASH.sub('',s or '').strip()
    s=re.sub('[أإآٱ]','ا',s).replace('ة','ه').replace('ى','ي').replace('ؤ','و').replace('ئ','ي')
    s=re.sub(r'\b(ال)','',s)  # crude
    s=re.sub(r'[^\w]','',s)
    return s
def hav(a,b,c,d):
    R=6371000;p1,p2=math.radians(a),math.radians(c);dp=p2-p1;dl=math.radians(d-b)
    return 2*R*math.asin(math.sqrt(math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))
idx=collections.defaultdict(list); allpts=[]
def add(name,lat,lng,typ,src):
    for nm in {name}:
        k=norm(nm)
        if k: idx[k].append((lat,lng,typ,src))
n=0
for row in csv.DictReader(open(U+'b00d7e1e-Saudi_Named_POI.csv',encoding='utf-8-sig')):
    lat,lng=float(row['خط العرض']),float(row['خط الطول'])
    names={row['اسم الموقع'],row['الاسم الأصلي'],row['الاسم العربي']}
    for nm in names:
        if nm: add(nm,lat,lng,row['النوع'],'poi')
    allpts.append((lat,lng,row['اسم الموقع'],row['النوع']))
    n+=1
m=0
for row in csv.DictReader(open('/mnt/user-data/uploads/Saudi_Named_Map_Features.csv',encoding='utf-8-sig')):
    if row['طريقة تحديد الإحداثية']!='actual_point': continue
    lat,lng=float(row['خط العرض']),float(row['خط الطول'])
    for nm in {row['اسم الموقع'],row['الاسم الأصلي'],row['الاسم العربي']}:
        if nm: add(nm,lat,lng,row['النوع'],'feat')
    allpts.append((lat,lng,row['اسم الموقع'],row['النوع'])); m+=1
print('osmand poi',n,'feature points',m,'keys',len(idx),file=sys.stderr)
d=json.load(open('data/open-places.json'))
cats=d['cats']
def gn_like(lat,lng):
    f=lambda x: min(abs(x*60-round(x*60)), abs(x*3600-round(x*3600)))<0.02
    return f(lat) and f(lng)
rows=[];buck=collections.Counter();bysrc=collections.defaultdict(collections.Counter);dists=[]
regs=d['regions']
for nm,lat,lng,ri,ci in d['p']:
    src='GeoNames' if gn_like(lat,lng) else 'OSM'
    c=idx.get(norm(nm))
    if not c:
        b='لا يوجد بالاسم'; best=None
    else:
        best=min(c,key=lambda t:hav(lat,lng,t[0],t[1])); dd=hav(lat,lng,best[0],best[1]); dists.append((src,dd))
        b='≤50 م' if dd<=50 else '50–500 م' if dd<=500 else '0.5–2 كم' if dd<=2000 else '2–10 كم' if dd<=10000 else '>10 كم'
    buck[b]+=1; bysrc[src][b]+=1
    rows.append([nm,lat,lng,cats[ci],regs[ri],b,round(hav(lat,lng,best[0],best[1])) if best else '',best[0] if best else '',best[1] if best else '',best[2] if best else ''])
order=['≤50 م','50–500 م','0.5–2 كم','2–10 كم','>10 كم','لا يوجد بالاسم']
print('ALL',len(rows),[(k,buck[k]) for k in order])
for s in []: print(s,sum(bysrc[s].values()),[(k,bysrc[s][k]) for k in order])
import statistics
for s in ['OSM','GeoNames']:
    ds=[x for t,x in dists if t==s]; 
    if ds: print(s,'median m',round(statistics.median(ds)),'p90',round(sorted(ds)[int(len(ds)*.9)]))
w=csv.writer(open('compare_rows.csv','w',encoding='utf-8-sig',newline=''))
w.writerow(['الاسم في دليل','خط العرض (دليل)','خط الطول (دليل)','التصنيف','المنطقة','النتيجة','المسافة بالمتر','خط العرض (أوسماند)','خط الطول (أوسماند)','النوع في أوسماند'])
for r in rows: w.writerow(r)
json.dump({'rows':len(rows)},open('ok.json','w'))

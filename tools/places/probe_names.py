# Wikidata (CC0): كل المعالم داخل السعودية لها إحداثيات واسم عربي — عدّ حسب النوع ومقارنة مع open-places
import urllib.request, json, re, time, collections, urllib.parse, math
def get(u):
    for k in range(6):
        try: return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'DalilApp-probe/1.0 (github.com/f10f100a-debug/dalil-app)', 'Accept': 'application/sparql-results+json'}), timeout=300).read()
        except urllib.error.HTTPError as e:
            print('retry', e.code, flush=True); time.sleep(70)
    raise SystemExit('gave up')
q = '''SELECT ?i ?l ?c ?t WHERE { ?i wdt:P17 wd:Q851; wdt:P625 ?c; wdt:P31 ?t. ?i rdfs:label ?l FILTER(LANG(?l)="ar") }'''
d = json.loads(get('https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(q)))['results']['bindings']
items = {}
for b in d:
    m = re.match(r'Point\(([-\d.]+) ([-\d.]+)\)', b['c']['value'])
    if not m: continue
    i = b['i']['value'].split('/')[-1]
    items.setdefault(i, [b['l']['value'], float(m[2]), float(m[1]), set()])[3].add(b['t']['value'].split('/')[-1])
print('items', len(items))
tc = collections.Counter(t for v in items.values() for t in v[3])
time.sleep(5)
ids = [t for t, _ in tc.most_common(45)]
lab = json.loads(urllib.request.urlopen(urllib.request.Request('https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=ar|en&format=json&ids=' + '|'.join(ids), headers={'User-Agent': 'DalilApp-probe/1.0'})).read())
TASH = re.compile('[ً-ٰٟـ]')
def nk(s):
    s = TASH.sub('', s or ''); s = re.sub('[أإآٱ]', 'ا', s).replace('ة', 'ه').replace('ى', 'ي')
    return re.sub(r'[^\w]', '', re.sub(r'(^|\s)ال', ' ', s))
op = json.load(open('data/open-places.json'))
G = collections.defaultdict(set)
for x in op['p']: G[(round(x[1] * 20), round(x[2] * 20))].add(nk(x[0]))
def known(v):
    a, b = round(v[1] * 20), round(v[2] * 20); k = nk(v[0])
    return any(k in G.get((a + i, b + j), ()) for i in (-1, 0, 1) for j in (-1, 0, 1))
new = collections.Counter(); ex = collections.defaultdict(list)
for i, v in items.items():
    if not known(v):
        for t in v[3]:
            new[t] += 1
            if len(ex[t]) < 3: ex[t].append(v[0])
for t, n in tc.most_common(45):
    L = lab['entities'].get(t, {}).get('labels', {})
    print('WD', t, (L.get('ar') or L.get('en') or {}).get('value'), 'all', n, 'new', new[t], ex[t])
print('new total', sum(1 for v in items.values() if not known(v)))

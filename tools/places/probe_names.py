# عدّ ما في المصادر المفتوحة داخل السعودية: NGA GNS (ملف السعودية) و Wikidata (SPARQL)
import urllib.request, zipfile, io, csv, collections, json, re, sys, urllib.parse
AR = re.compile('[ء-ي]')
def get(u, h=None):
    return urllib.request.urlopen(urllib.request.Request(u, headers=h or {'User-Agent': 'dalil-probe'}), timeout=300).read()
# --- NGA ---
for u in ['https://geonames.nga.mil/geonames/GNSData/fc_files/sa.zip', 'https://geonames.nga.mil/geonames/GNSData/cc_files/sa.zip',
          'https://geonames.nga.mil/gns/html/cntyfile/sa.zip']:
    try:
        z = zipfile.ZipFile(io.BytesIO(get(u))); print('NGA OK', u, z.namelist()); break
    except Exception as e: print('NGA fail', u, e); z = None
if z:
    n = [x for x in z.namelist() if x.endswith('.txt')][0]
    rows = list(csv.DictReader(io.TextIOWrapper(z.open(n), 'utf-8'), delimiter='\t'))
    print('cols', list(rows[0].keys())); print('rows', len(rows))
    ar = [r for r in rows if AR.search(' '.join(str(v) for v in r.values()))]
    print('rows with Arabic script', len(ar))
    k = [c for c in rows[0] if c.lower() in ('dsg', 'desig_cd')][0]
    nt = [c for c in rows[0] if c.lower() in ('nt', 'name_type')]
    print('by type (all):', collections.Counter(r[k] for r in rows).most_common(40))
    print('by type (arabic):', collections.Counter(r[k] for r in ar).most_common(40))
    if nt: print('name types:', collections.Counter(r[nt[0]] for r in rows).most_common())
    for r in ar[:8]: print({c: r[c] for c in r if r[c]})
# --- Wikidata ---
q = '''SELECT ?t (COUNT(DISTINCT ?i) AS ?n) WHERE { ?i wdt:P17 wd:Q851; wdt:P625 ?c; wdt:P31 ?t. ?i rdfs:label ?l FILTER(LANG(?l)="ar") }
GROUP BY ?t ORDER BY DESC(?n) LIMIT 40'''
try:
    d = json.loads(get('https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(q), {'User-Agent': 'dalil-probe/1.0', 'Accept': 'application/sparql-results+json'}))
    ids = [b['t']['value'].split('/')[-1] for b in d['results']['bindings']]
    lab = json.loads(get('https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=ar|en&format=json&ids=' + '|'.join(ids[:50])))
    for b in d['results']['bindings']:
        i = b['t']['value'].split('/')[-1]; L = lab['entities'].get(i, {}).get('labels', {})
        print('WD', i, (L.get('ar') or L.get('en') or {}).get('value'), b['n']['value'])
except Exception as e: print('wikidata fail', e)

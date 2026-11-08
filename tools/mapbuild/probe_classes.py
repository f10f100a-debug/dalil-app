# فحص: وش متوفر في Overture (OpenStreetMap) داخل السعودية لطبقة «تفاصيل البر» — عدّ الأصناف فقط، بدون بناء
import collections, json, sys, time
import pyarrow.dataset as ds, pyarrow.fs as pafs, pyarrow.compute as pc
REL = 'overturemaps-us-west-2/release/2026-09-23.1/theme='
X0, Y0, X1, Y1 = 34.4, 16.3, 55.7, 32.2
s3 = pafs.S3FileSystem(anonymous=True, region='us-west-2')
FLT = (ds.field('bbox', 'xmin') < X1) & (ds.field('bbox', 'xmax') > X0) & (ds.field('bbox', 'ymin') < Y1) & (ds.field('bbox', 'ymax') > Y0)
out = {}
def probe(t, cols, key):
    t0 = time.time()
    d = ds.dataset(REL + t + '/', filesystem=s3, format='parquet')
    cols = [c for c in cols if c in d.schema.names]
    tb = d.to_table(columns=cols, filter=FLT)
    c = collections.Counter()
    named = collections.Counter()
    rows = tb.to_pylist()
    for r in rows:
        k = key(r); c[k] += 1
        n = r.get('names')
        if n and n.get('primary'): named[k] += 1
    out[t] = [[str(k), v, named[k]] for k, v in c.most_common(80)]
    print(f'== {t} ({len(rows)} rows, {round(time.time()-t0)}s) cols={cols}', flush=True)
    for k, v in c.most_common(80): print('  ', k, v, 'named', named[k], flush=True)

probe('base/type=land', ['subtype', 'class', 'names', 'geometry_type'], lambda r: (r.get('subtype'), r.get('class')))
probe('base/type=water', ['subtype', 'class', 'names'], lambda r: (r.get('subtype'), r.get('class')))
probe('base/type=infrastructure', ['subtype', 'class', 'names'], lambda r: (r.get('subtype'), r.get('class')))
probe('base/type=land_use', ['subtype', 'class', 'names'], lambda r: (r.get('subtype'), r.get('class')))
probe('base/type=land_cover', ['subtype'], lambda r: r.get('subtype'))
def surf(r):
    rs = r.get('road_surface') or []
    return (r.get('class'), rs[0].get('value') if rs and isinstance(rs[0], dict) else None)
probe('transportation/type=segment', ['class', 'road_surface', 'names'], surf)
json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else 'probe.json', 'w'), ensure_ascii=False, indent=0)

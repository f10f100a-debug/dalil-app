# يبني ملف خرائط متجهية PMTiles لمنطقة (نموذج الرياض) من بيانات Overture (OSM) و Copernicus DEM وبيانات دليل.
import json, math, gzip, re, sys, glob, collections, time
import numpy as np
import pyarrow.parquet as pq
from shapely import wkb, STRtree, box, ops, simplify, clip_by_rect
from shapely.geometry import Point, LineString, MultiLineString, shape, mapping
from pyproj import Transformer
import mapbox_vector_tile
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid, TileType, Compression

X0, X1, Y0, Y1 = 45.4, 47.9, 23.7, 25.9
ZMIN, ZMAX = 6, 14
OUT = sys.argv[1]
APP = __import__('os').environ.get('DALIL_DATA', '../../data/')
M = Transformer.from_crs(4326, 3857, always_xy=True).transform
R = 20037508.342789244
TK = re.compile(r'[ً-ٰٟـ]')

AR = re.compile(r'[\u0621-\u064A]')
def arname(n):
    # الاسم العربي فقط؛ لا نعرض أسماء لاتينية على الخريطة
    if not n: return None
    for k, v in (n.get('common') or []):
        if k == 'ar' and v: return TK.sub('', v)
    p = n.get('primary')
    return TK.sub('', p) if p and AR.search(p) else None

layers = collections.defaultdict(list)   # name -> [(geom3857, props, minzoom)]
def add(layer, g, props, mz):
    if g is None or g.is_empty: return
    layers[layer].append((ops.transform(M, g), {k: v for k, v in props.items() if v is not None}, mz))

# ---------- الطرق ----------
RC = {'motorway': ('motorway', 6), 'trunk': ('trunk', 6), 'primary': ('primary', 7), 'secondary': ('secondary', 9),
      'tertiary': ('tertiary', 10), 'unclassified': ('minor', 12), 'unknown': ('minor', 12), 'residential': ('minor', 13),
      'living_street': ('minor', 13), 'service': ('service', 14), 'track': ('track', 11)}
for r in pq.read_table('segment.parquet', columns=['subtype', 'class', 'names', 'geometry']).to_pylist():
    if r['subtype'] == 'rail':
        add('roads', wkb.loads(r['geometry']), {'class': 'rail'}, 9); continue
    c = RC.get(r['class'])
    if not c: continue
    add('roads', wkb.loads(r['geometry']), {'class': c[0], 'name': arname(r['names'])}, c[1])

# ---------- استخدامات الأرض ----------
LU = {'residential': 'urban', 'developed': 'urban', 'education': 'urban', 'construction': 'urban', 'military': 'urban',
      'agriculture': 'farm', 'horticulture': 'farm', 'park': 'park', 'managed': 'park', 'recreation': 'park', 'resource_extraction': 'quarry'}
for r in pq.read_table('land_use.parquet', columns=['subtype', 'geometry']).to_pylist():
    k = LU.get(r['subtype'])
    if not k: continue
    g = wkb.loads(r['geometry'])
    if g.geom_type not in ('Polygon', 'MultiPolygon'): continue
    add('landuse', g, {'kind': k}, 8 if k == 'urban' else 10)

# ---------- المياه ----------
for r in pq.read_table('water.parquet', columns=['subtype', 'class', 'names', 'geometry']).to_pylist():
    g = wkb.loads(r['geometry'])
    if g.geom_type in ('Polygon', 'MultiPolygon'):
        if r['subtype'] in ('human_made',): continue
        add('water', g, {'name': arname(r['names'])}, 10)
    elif r['subtype'] in ('stream', 'river'):
        add('waterway', g, {}, 12)   # المجاري غير المسماة وتفاصيلها من التكبير 12
# الأودية المسماة من data/wadis.json (نفس ما يرسمه التطبيق)
W = json.load(open(APP + 'wadis.json')); k = 1 / W['scale']
for name, parts in W['w']:
    lines = []
    for a in parts:
        la = ln = 0; pts = []
        for i in range(0, len(a), 2):
            la += a[i]; ln += a[i + 1]; pts.append((ln * k, la * k))
        if len(pts) > 1: lines.append(LineString(pts))
    g = MultiLineString(lines)
    if g.intersects(box(X0, Y0, X1, Y1)): add('wadi', g, {'name': name}, 8)

# ---------- الأرض: رمال وقمم ----------
for r in pq.read_table('land.parquet', columns=['subtype', 'class', 'names', 'geometry', 'elevation']).to_pylist():
    g = wkb.loads(r['geometry'])
    if r['subtype'] == 'sand' and g.geom_type in ('Polygon', 'MultiPolygon'): add('sand', g, {'name': arname(r['names'])}, 8)
    elif r['class'] in ('peak', 'hill') and g.geom_type == 'Point': add('peaks', g, {'name': arname(r['names']), 'ele': r['elevation']}, 11)
    elif r['class'] == 'cliff' and g.geom_type != 'Point': add('cliff', g, {}, 12)

# ---------- التجمعات السكانية ----------
PL = {'city': 6, 'town': 8, 'village': 10, 'hamlet': 11}
for r in pq.read_table('division.parquet', columns=['subtype', 'class', 'names', 'geometry']).to_pylist():
    g = wkb.loads(r['geometry'])
    if g.geom_type != 'Point': continue
    n = arname(r['names'])
    if not n: continue
    if r['subtype'] == 'locality' and r['class'] in PL: add('places', g, {'name': n, 'kind': r['class']}, PL[r['class']])
    elif r['subtype'] == 'neighborhood': add('places', g, {'name': n, 'kind': 'neighborhood'}, 13)

# ---------- مواقع دليل (خرائط البر + OSM) ----------
for f in ('desert-places.json', 'osm-places.json'):
    d = json.load(open(APP + f))
    for x in d['p']:
        if X0 <= x[2] <= X1 and Y0 <= x[1] <= Y1:
            add('dalil', Point(x[2], x[1]), {'name': x[0], 'kind': d['cats'][x[4]]}, 11)

# ---------- خطوط الكنتور من Copernicus DEM ----------
import rasterio, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
STEP = 3   # ~90 م للكنتور
tiles = sorted(glob.glob('dem/*.tif'))
lat_hi, lon_lo = math.ceil(Y1), math.floor(X0)
nrows = (math.ceil(Y1) - math.floor(Y0)) * 3600; ncols = (math.ceil(X1) - math.floor(X0)) * 3600
dem = np.full((nrows, ncols), np.nan, dtype=np.float32)
for t in tiles:
    m = re.search(r'N(\d+)_00_E(\d+)', t); la, lo = int(m.group(1)), int(m.group(2))
    with rasterio.open(t) as ds:
        a = ds.read(1).astype(np.float32)
    r0 = (lat_hi - (la + 1)) * 3600; c0 = (lo - lon_lo) * 3600
    dem[r0:r0 + 3600, c0:c0 + 3600] = a[:3600, :3600]
np.save('dem_mosaic.npy', dem)
sub = dem[::STEP, ::STEP]
lats = lat_hi - (np.arange(sub.shape[0]) * STEP + 0.5) / 3600
lons = lon_lo + (np.arange(sub.shape[1]) * STEP + 0.5) / 3600
from scipy.ndimage import gaussian_filter
subs = gaussian_filter(np.nan_to_num(sub, nan=float(np.nanmean(sub))), 1.0)
lv = np.arange(math.floor(np.nanmin(subs) / 20) * 20, np.nanmax(subs) + 20, 20)
cs = plt.contour(lons, lats, subs, levels=lv)
nc = 0
for lev, segs in zip(cs.levels, cs.allsegs):
    e = int(round(lev)); mz = 9 if e % 100 == 0 else 11 if e % 50 == 0 else 12
    for s in segs:
        if len(s) < 4: continue
        g = LineString(s).simplify(0.0004)
        if not g.intersects(box(X0, Y0, X1, Y1)): continue
        add('contour', g, {'ele': e, 'idx': 1 if e % 100 == 0 else 0}, mz); nc += 1
print('contours', nc, {k: len(v) for k, v in layers.items()}, flush=True)

# ---------- التقطيع ----------
trees = {n: (STRtree([f[0] for f in fs]), fs) for n, fs in layers.items()}
def tile_bounds(z, x, y):
    s = 2 * R / 2 ** z
    return (-R + x * s, R - (y + 1) * s, -R + (x + 1) * s, R - y * s)
def lonlat_tile(lon, lat, z):
    n = 2 ** z; x = int((lon + 180) / 360 * n); y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y
POLY_LAYERS = {'landuse', 'water', 'sand'}
out = {}
t0 = time.time()
for z in range(ZMIN, ZMAX + 1):
    xa, ya = lonlat_tile(X0, Y1, z); xb, yb = lonlat_tile(X1, Y0, z)
    tol = 2 * R / (256 * 2 ** z) * 0.6
    cnt = 0
    for x in range(xa, xb + 1):
        for y in range(ya, yb + 1):
            b = tile_bounds(z, x, y); buf = (b[2] - b[0]) * 64 / 4096
            bb = (b[0] - buf, b[1] - buf, b[2] + buf, b[3] + buf)
            q = box(*bb); tl = []
            for n, (tree, fs) in trees.items():
                feats = []
                for i in tree.query(q):
                    g, p, mz = fs[i]
                    if mz > z: continue
                    if g.geom_type == 'Point':
                        feats.append({'geometry': g, 'properties': p}); continue
                    c = clip_by_rect(g, *bb)
                    if c.is_empty: continue
                    if n in POLY_LAYERS and c.area < (tol * tol * 4): continue
                    c = simplify(c, tol, preserve_topology=n in POLY_LAYERS)
                    if c.is_empty: continue
                    feats.append({'geometry': c, 'properties': p})
                if feats: tl.append({'name': n, 'features': feats})
            if not tl: continue
            data = mapbox_vector_tile.encode(tl, default_options={'quantize_bounds': b, 'extents': 4096})
            out[zxy_to_tileid(z, x, y)] = gzip.compress(data)
            cnt += 1
    print('z', z, cnt, 'tiles', round(time.time() - t0), 's', flush=True)

with open(OUT, 'wb') as f:
    w = Writer(f)
    for tid in sorted(out): w.write_tile(tid, out[tid])
    e7 = lambda v: int(v * 1e7)
    w.finalize({'tile_type': TileType.MVT, 'tile_compression': Compression.GZIP, 'min_zoom': ZMIN, 'max_zoom': ZMAX,
                'min_lon_e7': e7(X0), 'min_lat_e7': e7(Y0), 'max_lon_e7': e7(X1), 'max_lat_e7': e7(Y1),
                'center_zoom': 9, 'center_lon_e7': e7(46.7), 'center_lat_e7': e7(24.7)},
               {'name': 'Dalil — Riyadh', 'attribution': '© OpenStreetMap contributors · Copernicus DEM',
                'vector_layers': [{'id': n, 'fields': {}} for n in layers]})
print('done', OUT)

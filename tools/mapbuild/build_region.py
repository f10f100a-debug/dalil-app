# يبني خريطة منطقة كاملة: maps/<slug>.pmtiles (متجهية z6–13) و maps/<slug>-hs.pmtiles (تظليل z6–11)
# الاستخدام: python3 build_region.py <slug> <اسم المنطقة كما في data/region-grid.json> <مجلد الإخراج>
# المصادر: OpenStreetMap عبر Overture (S3 العام)، Copernicus DEM GLO-30 (S3 العام)، وبيانات دليل (data/).
import os, sys, json, math, gzip, io, re, time, collections, urllib.request, tempfile
from multiprocessing import Pool
import numpy as np
import pyarrow.dataset as ds, pyarrow.fs as pafs
from shapely import wkb, STRtree, box, ops, simplify, clip_by_rect, unary_union
from shapely.geometry import Point, LineString, MultiLineString
from shapely.prepared import prep
from pyproj import Transformer
import mapbox_vector_tile
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid, TileType, Compression
from scipy.ndimage import gaussian_filter, map_coordinates, distance_transform_edt
from PIL import Image

SLUG, REGION, OUTDIR = sys.argv[1], sys.argv[2], sys.argv[3]
APP = os.environ.get('DALIL_DATA', os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../data/'))
OVERTURE = 'overturemaps-us-west-2/release/2026-09-23.1/theme='
VZ = (6, 13); HZ = (6, 11); PPD = 1200          # بكسل لكل درجة في الارتفاعات (~90 م)
R = 20037508.342789244
M = Transformer.from_crs(4326, 3857, always_xy=True).transform
TK = re.compile(r'[ً-ٰٟـ]'); AR = re.compile(r'[ء-ي]')
t0 = time.time()
def log(*a): print(f'[{SLUG} {round(time.time() - t0)}s]', *a, flush=True)

# ---------- حدود المنطقة من شبكة المناطق (خلايا 0.25°) ----------
G = json.load(open(APP + 'region-grid.json')); RI = G['regions'].index(REGION)
cells = [box(G['lng0'] + j * G['r'], G['lat0'] + i * G['r'], G['lng0'] + (j + 1) * G['r'], G['lat0'] + (i + 1) * G['r'])
         for i in range(G['rows']) for j in range(G['cols']) if ord(G['g'][i * G['cols'] + j]) - 97 == RI]
REG = unary_union(cells).buffer(0.08)            # هامش صغير حتى لا تنقطع الخريطة على الحدود
X0, Y0, X1, Y1 = REG.bounds
REG_M = prep(ops.transform(M, REG))
REG_P = prep(REG)
log('bbox', [round(v, 2) for v in (X0, Y0, X1, Y1)])

def arname(n):
    if not n: return None
    for k, v in (n.get('common') or []):
        if k == 'ar' and v: return TK.sub('', v)
    p = n.get('primary')
    return TK.sub('', p) if p and AR.search(p) else None

layers = collections.defaultdict(list)
def add(layer, g, props, mz):
    if g is None or g.is_empty or not REG_P.intersects(g): return    # ما خارج المنطقة (دول الجوار مثلًا) لا يُحمَّل
    layers[layer].append((ops.transform(M, g), {k: v for k, v in props.items() if v is not None}, mz))

# ---------- Overture (OSM) ----------
s3 = pafs.S3FileSystem(anonymous=True, region='us-west-2')
FLT = (ds.field('bbox', 'xmin') < X1) & (ds.field('bbox', 'xmax') > X0) & (ds.field('bbox', 'ymin') < Y1) & (ds.field('bbox', 'ymax') > Y0)
def overture(t, cols):
    d = ds.dataset(OVERTURE + t + '/', filesystem=s3, format='parquet')
    return d.to_table(columns=[c for c in cols if c in d.schema.names], filter=FLT).to_pylist()

RC = {'motorway': ('motorway', 6), 'trunk': ('trunk', 6), 'primary': ('primary', 7), 'secondary': ('secondary', 9),
      'tertiary': ('tertiary', 10), 'unclassified': ('minor', 12), 'unknown': ('minor', 12), 'residential': ('minor', 13),
      'living_street': ('minor', 13), 'track': ('track', 11)}
for r in overture('transportation/type=segment', ['subtype', 'class', 'names', 'geometry']):
    if r['subtype'] == 'rail': add('roads', wkb.loads(r['geometry']), {'class': 'rail'}, 9); continue
    c = RC.get(r['class'])
    if c: add('roads', wkb.loads(r['geometry']), {'class': c[0], 'name': arname(r['names'])}, c[1])
log('roads', len(layers['roads']))
LU = {'residential': 'urban', 'developed': 'urban', 'education': 'urban', 'construction': 'urban', 'military': 'urban',
      'agriculture': 'farm', 'horticulture': 'farm', 'park': 'park', 'managed': 'park', 'recreation': 'park', 'resource_extraction': 'quarry'}
for r in overture('base/type=land_use', ['subtype', 'geometry']):
    k = LU.get(r['subtype']); g = wkb.loads(r['geometry'])
    if k and g.geom_type in ('Polygon', 'MultiPolygon'): add('landuse', g, {'kind': k}, 8 if k == 'urban' else 10)
for r in overture('base/type=water', ['subtype', 'names', 'geometry']):
    g = wkb.loads(r['geometry'])
    if g.geom_type in ('Polygon', 'MultiPolygon'):
        if r['subtype'] != 'human_made': add('water', g, {'name': arname(r['names'])}, 6 if g.area > 0.05 else 10)
    elif r['subtype'] in ('stream', 'river'): add('waterway', g, {}, 12)
for r in overture('base/type=land', ['subtype', 'class', 'names', 'geometry', 'elevation']):
    g = wkb.loads(r['geometry'])
    if r['subtype'] == 'sand' and g.geom_type in ('Polygon', 'MultiPolygon'): add('sand', g, {'name': arname(r['names'])}, 7)
    elif r['class'] in ('peak', 'hill', 'volcano') and g.geom_type == 'Point': add('peaks', g, {'name': arname(r['names']), 'ele': r['elevation']}, 10)
    elif r['class'] == 'cliff' and g.geom_type != 'Point': add('cliff', g, {}, 12)
PL = {'city': 6, 'town': 8, 'village': 10, 'hamlet': 11}
for r in overture('divisions/type=division', ['subtype', 'class', 'names', 'geometry']):
    g = wkb.loads(r['geometry']); n = arname(r['names'])
    if g.geom_type != 'Point' or not n: continue
    if r['subtype'] == 'locality' and r['class'] in PL: add('places', g, {'name': n, 'kind': r['class']}, PL[r['class']])
    elif r['subtype'] == 'neighborhood': add('places', g, {'name': n, 'kind': 'neighborhood'}, 13)
log('overture done', {k: len(v) for k, v in layers.items()})

# ---------- بيانات دليل: الأودية والمواقع ----------
W = json.load(open(APP + 'wadis.json')); k = 1 / W['scale']
for name, parts in W['w']:
    lines = []
    for a in parts:
        la = ln = 0; pts = []
        for i in range(0, len(a), 2): la += a[i]; ln += a[i + 1]; pts.append((ln * k, la * k))
        if len(pts) > 1: lines.append(LineString(pts))
    g = MultiLineString(lines)
    if g.intersects(REG): add('wadi', g, {'name': name}, 8)
for f in ('desert-places.json', 'osm-places.json'):
    d = json.load(open(APP + f))
    for x in d['p']:
        if REG.contains(Point(x[2], x[1])): add('dalil', Point(x[2], x[1]), {'name': x[0], 'kind': d['cats'][x[4]]}, 11)

# ---------- الارتفاعات: Copernicus DEM مخفّضة إلى ~90 م ----------
LON0, LAT1 = math.floor(X0), math.ceil(Y1)
NX, NY = math.ceil(X1) - LON0, LAT1 - math.floor(Y0)
dem = np.full((NY * PPD, NX * PPD), np.nan, dtype=np.float32)
import rasterio
for la in range(math.floor(Y0), LAT1):
    for lo in range(LON0, math.ceil(X1)):
        if not REG.intersects(box(lo, la, lo + 1, la + 1)): continue
        n = f'Copernicus_DSM_COG_10_N{la:02d}_00_E{lo:03d}_00_DEM'
        tmp = os.path.join(tempfile.gettempdir(), SLUG + n + '.tif')
        try: urllib.request.urlretrieve(f'https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif', tmp)
        except Exception: continue          # بحر: لا يوجد مربع
        with rasterio.open(tmp) as src:
            a = src.read(1, out_shape=(PPD, PPD), resampling=rasterio.enums.Resampling.average).astype(np.float32)
        os.remove(tmp)
        r0 = (LAT1 - (la + 1)) * PPD; c0 = (lo - LON0) * PPD
        dem[r0:r0 + PPD, c0:c0 + PPD] = a
log('dem', dem.shape, 'valid', int(np.isfinite(dem).mean() * 100), '%')
# الفجوات (بحر، أو خارج المنطقة) تُملأ بأقرب ارتفاع صحيح حتى لا تظهر «جروف» وهمية على حدودها،
# وتُخفى بعدها من التظليل والكنتور.
VALID = np.isfinite(dem)
# الملء على شبكة أخشن ×10 يوفّر الذاكرة (المناطق المملوءة مخفية أصلًا)
CF = 10; h, w = dem.shape
coarse = np.nanmean(np.pad(dem, ((0, -h % CF), (0, -w % CF)), constant_values=np.nan).reshape(-(-h // CF), CF, -(-w // CF), CF), axis=(1, 3))
cv = np.isfinite(coarse)
if cv.any():
    _, (ri, ci) = distance_transform_edt(~cv, return_indices=True); coarse = coarse[ri, ci]; del ri, ci
else: coarse = np.zeros_like(coarse)
demf = np.where(VALID, dem, np.repeat(np.repeat(coarse, CF, 0), CF, 1)[:h, :w]).astype(np.float32); del coarse, dem
VALIDU = VALID.astype(np.uint8) * 255   # قناع مخفّف الذاكرة للتظليل

# ---------- الكنتور لكل مربع 1° (أسرع وأخف ذاكرة) ----------
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
nc = 0
for by in range(NY):
    for bx in range(NX):
        lo, la = LON0 + bx, LAT1 - by - 1
        if not REG.intersects(box(lo, la, lo + 1, la + 1)): continue
        sl = (slice(by * PPD, (by + 1) * PPD + 1), slice(bx * PPD, (bx + 1) * PPD + 1))
        if not VALID[sl].any(): continue
        blk = np.ma.masked_array(gaussian_filter(demf[sl], 1.0), mask=~VALID[sl])
        lv = np.arange(math.floor(blk.min() / 20) * 20 + 20, blk.max(), 20)
        if not len(lv): continue
        lats = LAT1 - by - (np.arange(blk.shape[0]) + 0.5) / PPD; lons = lo + (np.arange(blk.shape[1]) + 0.5) / PPD
        cs = plt.contour(lons, lats, blk, levels=lv); plt.close('all')
        for lev, segs in zip(cs.levels, cs.allsegs):
            e = int(round(lev)); mz = 9 if e % 100 == 0 else 11 if e % 50 == 0 else 12
            for s in segs:
                if len(s) < 4: continue
                g = LineString(s).simplify(0.0004)
                if g.intersects(REG): add('contour', g, {'ele': e, 'idx': 1 if e % 100 == 0 else 0}, mz); nc += 1
log('contours', nc)

# ---------- التقطيع (متوازي) ----------
def tile_bounds(z, x, y):
    s = 2 * R / 2 ** z
    return (-R + x * s, R - (y + 1) * s, -R + (x + 1) * s, R - y * s)
def lonlat_tile(lon, lat, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
def tiles_for(zr):
    out = []
    for z in range(zr[0], zr[1] + 1):
        xa, ya = lonlat_tile(X0, Y1, z); xb, yb = lonlat_tile(X1, Y0, z)
        for x in range(xa, xb + 1):
            for y in range(ya, yb + 1):
                if REG_M.intersects(box(*tile_bounds(z, x, y))): out.append((z, x, y))
    return out
TREES = {n: (STRtree([f[0] for f in fs]), fs) for n, fs in layers.items()}
POLY = {'landuse', 'water', 'sand'}
def vtile(zxy):
    z, x, y = zxy; b = tile_bounds(z, x, y); buf = (b[2] - b[0]) * 64 / 4096
    bb = (b[0] - buf, b[1] - buf, b[2] + buf, b[3] + buf); q = box(*bb); tol = 2 * R / (256 * 2 ** z) * 0.6; tl = []
    for n, (tree, fs) in TREES.items():
        feats = []
        for i in tree.query(q):
            g, p, mz = fs[i]
            if mz > z: continue
            if g.geom_type == 'Point':
                if q.contains(g): feats.append({'geometry': g, 'properties': p})
                continue
            c = clip_by_rect(g, *bb)
            if c.is_empty or (n in POLY and c.area < tol * tol * 4): continue
            c = simplify(c, tol, preserve_topology=n in POLY)
            if not c.is_empty: feats.append({'geometry': c, 'properties': p})
        if feats: tl.append({'name': n, 'features': feats})
    if not tl: return None
    return zxy_to_tileid(z, x, y), gzip.compress(mapbox_vector_tile.encode(tl, default_options={'quantize_bounds': b, 'extents': 4096}))

def htile(zxy):
    z, x, y = zxy; n = 2 ** z; N = 258
    px = (np.arange(N) - 1 + 0.5) / 256
    lon = (x + px) / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * (y + px) / n))))
    LON, LAT = np.meshgrid(lon, lat)
    elev = map_coordinates(demf, [(LAT1 - LAT) * PPD - 0.5, (LON - LON0) * PPD - 0.5], order=1, mode='nearest')
    vm = map_coordinates(VALIDU, [(LAT1 - LAT) * PPD - 0.5, (LON - LON0) * PPD - 0.5], order=1, mode='constant', cval=0)[1:-1, 1:-1] / 255.0
    if vm.max() < 0.5: return None
    res = 2 * R / (256 * n) * np.cos(np.radians(LAT)); zf = 1.0 + max(0, 11 - z) * 0.35
    dy, dx = np.gradient(elev * zf); dx /= res; dy /= res
    slope = np.arctan(np.hypot(dx, dy)); aspect = np.arctan2(dy, -dx)
    az, alt = math.radians(135), math.radians(45)
    sh = (np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect))[1:-1, 1:-1]
    flat = math.sin(alt); dark = sh < flat
    a = np.clip(np.where(dark, (flat - sh) / flat * 190, (sh - flat) / (1 - flat) * 90) * vm, 0, 255).astype(np.uint8)
    if a.max() < 8: return None                                  # أرض مستوية تمامًا (أو بحر): لا حاجة لصورة
    rgba = np.zeros((256, 256, 4), np.uint8)
    rgba[..., :3] = np.where(dark[..., None], np.array([60, 40, 20], np.uint8), np.array([255, 250, 235], np.uint8)); rgba[..., 3] = a
    im = Image.fromarray(rgba, 'RGBA').quantize(colors=48, method=Image.Quantize.FASTOCTREE)
    bio = io.BytesIO(); im.save(bio, 'PNG', optimize=True)
    return zxy_to_tileid(z, x, y), bio.getvalue()

def write(path, results, ttype, comp, zr, meta):
    with open(path, 'wb') as f:
        w = Writer(f)
        for tid, data in sorted(results): w.write_tile(tid, data)
        e7 = lambda v: int(v * 1e7)
        w.finalize({'tile_type': ttype, 'tile_compression': comp, 'min_zoom': zr[0], 'max_zoom': zr[1],
                    'min_lon_e7': e7(X0), 'min_lat_e7': e7(Y0), 'max_lon_e7': e7(X1), 'max_lat_e7': e7(Y1),
                    'center_zoom': 8, 'center_lon_e7': e7((X0 + X1) / 2), 'center_lat_e7': e7((Y0 + Y1) / 2)}, meta)
    return os.path.getsize(path)

if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    with Pool(int(os.environ.get('JOBS', '4'))) as pool:
        vt = [r for r in pool.imap_unordered(vtile, tiles_for(VZ), chunksize=16) if r]
        log('vector tiles', len(vt))
        hs = [r for r in pool.imap_unordered(htile, tiles_for(HZ), chunksize=8) if r]
        log('hillshade tiles', len(hs))
    sv = write(os.path.join(OUTDIR, SLUG + '.pmtiles'), vt, TileType.MVT, Compression.GZIP, VZ,
               {'name': 'دليل — ' + REGION, 'attribution': '© OpenStreetMap contributors · Copernicus DEM',
                'vector_layers': [{'id': n, 'fields': {}} for n in layers]})
    sh = write(os.path.join(OUTDIR, SLUG + '-hs.pmtiles'), hs, TileType.PNG, Compression.NONE, HZ,
               {'name': 'دليل — تضاريس ' + REGION, 'attribution': 'Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA'})
    json.dump({'id': SLUG, 'name': REGION, 'bbox': [round(v, 3) for v in (X0, Y0, X1, Y1)], 'vt': sv, 'hs': sh},
              open(os.path.join(OUTDIR, SLUG + '.json'), 'w'), ensure_ascii=False)
    log('done', round(sv / 1048576, 1), 'MB +', round(sh / 1048576, 1), 'MB')

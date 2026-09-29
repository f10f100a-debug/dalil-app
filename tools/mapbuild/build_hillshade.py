# تظليل التضاريس (hillshade) كصور PNG شفافة في PMTiles من Copernicus DEM (dem_mosaic.npy)
import math, sys, io, time
import numpy as np
from scipy.ndimage import map_coordinates
from PIL import Image
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid, TileType, Compression

X0, X1, Y0, Y1 = 45.4, 47.9, 23.7, 25.9
LAT_HI, LON_LO = 26, 45           # زاوية الفسيفساء العليا اليسرى (3600 بكسل لكل درجة)
ZMIN, ZMAX = 7, 12
OUT = sys.argv[1]
dem = np.load('dem_mosaic.npy', mmap_mode='r')
dem = np.nan_to_num(np.asarray(dem, dtype=np.float32), nan=600.0)
R = 20037508.342789244

def lonlat_tile(lon, lat, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

def render(z, x, y):
    n = 2 ** z; N = 258
    px = (np.arange(N) - 1 + 0.5) / 256
    lon = (x + px) / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * (y + px) / n))))
    LON, LAT = np.meshgrid(lon, lat)
    rows = (LAT_HI - LAT) * 3600 - 0.5; cols = (LON - LON_LO) * 3600 - 0.5
    elev = map_coordinates(dem, [rows, cols], order=1, mode='nearest')
    res = 2 * R / (256 * n) * np.cos(np.radians(LAT))      # متر لكل بكسل على الأرض
    zf = 1.0 + max(0, 11 - z) * 0.35                      # تضخيم أكبر عند التصغير حتى تبقى التضاريس مرئية
    dy, dx = np.gradient(elev * zf)
    dx /= res; dy /= res
    slope = np.arctan(np.hypot(dx, dy)); aspect = np.arctan2(dy, -dx)
    az, alt = math.radians(360 - 315 + 90), math.radians(45)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = shade[1:-1, 1:-1]
    flat = math.sin(alt)
    rgba = np.zeros((256, 256, 4), dtype=np.uint8)
    dark = shade < flat
    a = np.where(dark, (flat - shade) / flat * 190, (shade - flat) / (1 - flat) * 90)
    rgba[..., :3] = np.where(dark[..., None], np.array([60, 40, 20], np.uint8), np.array([255, 250, 235], np.uint8))
    rgba[..., 3] = np.clip(a, 0, 255).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA').quantize(colors=48, method=Image.Quantize.FASTOCTREE)
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True); return b.getvalue()

out = {}; t0 = time.time()
for z in range(ZMIN, ZMAX + 1):
    xa, ya = lonlat_tile(X0, Y1, z); xb, yb = lonlat_tile(X1, Y0, z)
    for x in range(xa, xb + 1):
        for y in range(ya, yb + 1):
            out[zxy_to_tileid(z, x, y)] = render(z, x, y)
    print('z', z, (xb - xa + 1) * (yb - ya + 1), round(time.time() - t0), flush=True)
with open(OUT, 'wb') as f:
    w = Writer(f)
    for t in sorted(out): w.write_tile(t, out[t])
    e7 = lambda v: int(v * 1e7)
    w.finalize({'tile_type': TileType.PNG, 'tile_compression': Compression.NONE, 'min_zoom': ZMIN, 'max_zoom': ZMAX,
                'min_lon_e7': e7(X0), 'min_lat_e7': e7(Y0), 'max_lon_e7': e7(X1), 'max_lat_e7': e7(Y1),
                'center_zoom': 9, 'center_lon_e7': e7(46.7), 'center_lat_e7': e7(24.7)},
               {'name': 'Dalil hillshade — Riyadh', 'attribution': 'Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA'})
print('done', sum(len(v) for v in out.values()) // 1024, 'KB')

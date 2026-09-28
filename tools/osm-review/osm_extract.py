#!/usr/bin/env python3
"""استخراج الأماكن البرية من ملف OSM PBF (جبال، قمم، تلال، رمال، أودية، عيون، آبار، قرى، هجر).
الاستخدام: python3 osm_extract.py saudi.osm.pbf out.csv
"""
import csv, sys
import osmium
from osmium import geom

# حدود تقريبية للسعودية لاستبعاد بقية دول الخليج في ملف gcc-states
BBOX = (16.0, 34.0, 32.5, 56.0)

def classify(t):
    n, p, w = t.get('natural'), t.get('place'), t.get('waterway')
    mm = t.get('man_made')
    if n == 'peak': return 'قمة'
    if n in ('hill',): return 'تل'
    if n in ('ridge', 'arete', 'mountain_range') or p == 'mountain_range': return 'جبل'
    if n == 'volcano': return 'جبل'
    if n in ('sand', 'dune', 'desert') or t.get('landform') == 'dune_system': return 'رمال'
    if n == 'valley' or w in ('wadi',): return 'وادي'
    if w in ('river', 'stream', 'dry_stream', 'intermittent'): return 'وادي'
    if n == 'spring': return 'عين'
    if mm == 'water_well' or t.get('amenity') == 'water_well' or n == 'water_well': return 'بئر'
    if p in ('village', 'hamlet', 'isolated_dwelling'):
        name = t.get('name:ar') or t.get('name') or ''
        return 'هجرة' if 'هجر' in name else 'قرية'
    if p == 'locality': return 'موقع'
    return None

def name_of(t):
    return (t.get('name:ar') or t.get('name') or '').strip()

def inside(lat, lon):
    return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]

class H(osmium.SimpleHandler):
    def __init__(self, w):
        super().__init__(); self.w = w; self.n = 0
        self.wkb = geom.WKBFactory()

    def emit(self, kind, osm_id, t, lat, lon, typ):
        if not inside(lat, lon): return
        self.w.writerow([kind + str(osm_id), typ, name_of(t), t.get('name:en', ''),
                         round(lat, 5), round(lon, 5), t.get('ele', '')])
        self.n += 1

    def node(self, n):
        typ = classify(n.tags)
        if typ and name_of(n.tags) and n.location.valid():
            self.emit('n', n.id, n.tags, n.location.lat, n.location.lon, typ)

    def way(self, w):
        # الأودية والسلاسل: نقطة المنتصف على الخط (المساحات المغلقة تُعالَج في area)
        typ = classify(w.tags)
        if not typ or not name_of(w.tags) or w.is_closed() and typ in ('رمال', 'قرية', 'هجرة'): return
        try:
            nodes = [nd.location for nd in w.nodes if nd.location.valid()]
        except osmium.InvalidLocationError:
            return
        if not nodes: return
        mid = nodes[len(nodes) // 2]
        self.emit('w', w.id, w.tags, mid.lat, mid.lon, typ)

    def area(self, a):
        typ = classify(a.tags)
        if typ not in ('رمال', 'قرية', 'هجرة') or not name_of(a.tags): return
        try:
            lat_s = lon_s = 0.0; k = 0
            for ring in a.outer_rings():
                for nd in ring:
                    lat_s += nd.lat; lon_s += nd.lon; k += 1
            if k:
                oid = ('r' if not a.from_way() else 'w') + str(a.orig_id())
                self.emit(oid[0], oid[1:], a.tags, lat_s / k, lon_s / k, typ)
        except Exception:
            pass

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    with open(dst, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['osm_id', 'type', 'name', 'name_en', 'lat', 'lon', 'ele'])
        h = H(w)
        h.apply_file(src, locations=True, idx='flex_mem')
    print('extracted', h.n)

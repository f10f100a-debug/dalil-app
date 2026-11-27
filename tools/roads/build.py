"""«مسار البر» — 28 نوفمبر (أبو مالك: «ابدأ»): شبكة الطرق المعبدة والدروب الترابية من OpenStreetMap (ODbL) لملفات صغيرة
مربعات 0.5° — كل ملف فيه الوصلات بين التقاطعات (رقم التقاطع عام لكل المملكة عشان الملفات تتصل ببعض).
python3 tools/roads/build.py <roads.osm.pbf> <مجلد الناتج>
الملف r/<lat>_<lng>.json = {"v":1,"e":[[a,b,طول_م,نوع(0 معبد/1 ترابي), lat0e5,lng0e5,dlat,dlng,...], ...]}"""
import sys, os, json, math, array
import numpy as np, osmium

SRC, OUT = sys.argv[1], sys.argv[2]; os.makedirs(f"{OUT}/r", exist_ok=True)
PAVED = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}   # بدون residential/service: حواري المدن تكبّر الملفات 10 أضعاف وما تفيد بالبر (أقرب طريق خلال 5 كم يكفي)
DIRT = {"track", "path", "bridleway"}
UNP = {"unpaved", "dirt", "sand", "gravel", "ground", "earth", "compacted", "fine_gravel", "grass", "mud", "rock", "pebblestone"}
def kind(t):
    h = t.get("highway"); s = t.get("surface", "")
    if t.get("access") in ("private", "no") and h not in DIRT: return None
    if h in DIRT: return 1
    if h in ("unclassified", "road"): return 1 if (s in UNP or not s) else 0
    if h in PAVED: return 1 if s in UNP else 0
    return None

class Refs(osmium.SimpleHandler):
    def __init__(s): super().__init__(); s.r = array.array("q"); s.ends = array.array("q")
    def way(s, w):
        if kind(w.tags) is None: return
        ns = [n.ref for n in w.nodes]
        if len(ns) < 2: return
        s.r.extend(ns); s.ends.append(ns[0]); s.ends.append(ns[-1])
h = Refs(); h.apply_file(SRC)
R = np.frombuffer(h.r, dtype=np.int64); u, c = np.unique(R, return_counts=True)
J = np.union1d(u[c > 1], np.frombuffer(h.ends, dtype=np.int64)); del h, R, u, c
print("junctions", len(J), flush=True)

def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0]), np.array(pts[-1]); P = np.array(pts)
    cl = math.cos(math.radians(a[0])); S = np.array([111320.0, 111320.0 * cl])
    A, B, Q = a * S, b * S, P * S; d = B - A; L = np.hypot(*d)
    V = Q - A; dist = np.hypot(V[:, 0], V[:, 1]) if L == 0 else np.abs(d[0] * V[:, 1] - d[1] * V[:, 0]) / L
    i = int(np.argmax(dist))
    if dist[i] <= eps: return [pts[0], pts[-1]]
    return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)

tiles = {}
def hav(a, b):
    p = math.pi / 180; x = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 12742000 * math.asin(math.sqrt(x))
class Edges(osmium.SimpleHandler):
    def __init__(s): super().__init__(); s.n = 0
    def way(s, w):
        k = kind(w.tags)
        if k is None: return
        try: ns = [(n.ref, n.lat, n.lon) for n in w.nodes]
        except osmium.InvalidLocationError: return
        if len(ns) < 2: return
        refs = np.array([x[0] for x in ns], dtype=np.int64)
        pos = np.searchsorted(J, refs); isj = (pos < len(J)) & (J[np.minimum(pos, len(J) - 1)] == refs)
        cut = [i for i in range(len(ns)) if isj[i]]
        for i0, i1 in zip(cut, cut[1:]):
            seg = [(x[1], x[2]) for x in ns[i0:i1 + 1]]
            L = sum(hav(seg[j], seg[j + 1]) for j in range(len(seg) - 1))
            if L < 1: continue
            g = rdp(seg, 12)
            mid = seg[len(seg) // 2]
            key = (math.floor(mid[0] * 2) / 2, math.floor(mid[1] * 2) / 2)
            flat = [round(g[0][0] * 1e5), round(g[0][1] * 1e5)]
            for p, q in zip(g, g[1:]): flat += [round(q[0] * 1e5) - round(p[0] * 1e5), round(q[1] * 1e5) - round(p[1] * 1e5)]
            tiles.setdefault(key, []).append([int(pos[i0]), int(pos[i1]), round(L), k] + flat); s.n += 1
e = Edges(); e.apply_file(SRC, locations=True, idx="flex_mem")
print("edges", e.n, "tiles", len(tiles), flush=True)
# داخل المملكة بس (حدود Natural Earth): مربع فيه أي زاوية أو وسطه داخل الحدود
SAU = json.load(open("data/sau-boundary.json"))["coordinates"]
def inside(la, lo):
    hit = False
    for poly in SAU:
        ring = poly[0]
        for k in range(len(ring) - 1):
            (x1, y1), (x2, y2) = ring[k], ring[k + 1]
            if (y1 > la) != (y2 > la) and lo < x1 + (la - y1) * (x2 - x1) / (y2 - y1): hit = not hit
    return hit
idx = {}
for (la, lo), L in tiles.items():
    if not any(inside(la + a, lo + b) for a in (0, .25, .5) for b in (0, .25, .5)): continue
    name = f"{la:.1f}_{lo:.1f}"
    s = json.dumps({"v": 1, "e": L}, separators=(",", ":"))
    open(f"{OUT}/r/{name}.json", "w").write(s); idx[name] = [len(L), len(s)]
tot = sum(v[1] for v in idx.values())
json.dump({"v": 1, "tile": 0.5, "src": "OpenStreetMap (ODbL)", "asof": os.environ.get("ASOF", ""), "tiles": idx}, open(f"{OUT}/index.json", "w"), separators=(",", ":"))
big = sorted(idx.items(), key=lambda x: -x[1][1])[:5]
print(f"::notice::roads: {e.n} edges · {len(idx)} tiles · {tot/1e6:.1f} MB · biggest " + ", ".join(f"{k} {v[1]/1e6:.1f}MB" for k, v in big), flush=True)

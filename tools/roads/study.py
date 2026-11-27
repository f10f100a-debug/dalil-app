"""دراسة: هل دروب البر في OpenStreetMap كافية نبني عليها «مسار البر» بدون نت؟ — 28 نوفمبر (أبو مالك: «افحص»)
يقرأ ملف طرق المملكة (osmium) ويحسب لكل منطقة: كم كم معبد / ترابي، كثافتها، تغطية المساحة (كم ٪ من المنطقة خلال 1 و3 كم من درب)،
واختبار توجيه: 300 زوج نقاط عشوائية (10–60 كم) — كم ٪ يوصلها مسار على الشبكة، والنسبة بين طول المسار والخط المستقيم.
python3 tools/roads/study.py <ملف .osm.pbf للطرق> <مجلد الناتج>"""
import sys, json, math, random, os
import numpy as np, osmium
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

SRC, OUT = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True)
AREAS = {  # [جنوب، غرب، شمال، شرق]
    "النفود حول حائل": [27.6, 40.5, 28.8, 42.5],
    "الدهناء": [24.6, 46.2, 26.6, 47.6],
    "الصمان": [25.6, 46.9, 28.0, 48.6],
    "روضات شمال الرياض (خريم والتنهات)": [25.3, 46.9, 26.1, 47.7],
    "الأسياح وروضات القصيم": [26.3, 43.4, 27.3, 44.8],
    "الحماد والحدود الشمالية": [30.0, 39.0, 31.6, 41.6],
}
PAVED = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link", "residential", "service", "living_street"}
DIRT = {"track", "path", "bridleway"}
UNPAVED_SURF = {"unpaved", "dirt", "sand", "gravel", "ground", "earth", "compacted", "fine_gravel", "grass", "mud", "rock", "pebblestone"}

def kind(tags):
    h = tags.get("highway"); s = tags.get("surface", "")
    if h in DIRT: return "dirt"
    if h in ("unclassified", "road"): return "dirt" if s in UNPAVED_SURF or not s else "paved"
    if h in PAVED: return "dirt" if s in UNPAVED_SURF else "paved"
    return None

class H(osmium.SimpleHandler):
    def __init__(s):
        super().__init__(); s.edges = []  # (lat1,lng1,lat2,lng2,id1,id2,kind)
    def way(s, w):
        k = kind(w.tags)
        if not k: return
        try: ns = [(n.ref, n.lat, n.lon) for n in w.nodes]
        except osmium.InvalidLocationError: return
        for a, b in zip(ns, ns[1:]): s.edges.append((a[1], a[2], b[1], b[2], a[0], b[0], 0 if k == "paved" else 1))
h = H(); h.apply_file(SRC, locations=True, idx="flex_mem")
E = np.array([e[:4] for e in h.edges]); ID = np.array([e[4:6] for e in h.edges], dtype=np.int64); K = np.array([e[6] for e in h.edges], dtype=np.int8)
del h
def hav(la1, lo1, la2, lo2):
    p = math.pi / 180; a = np.sin((la2 - la1) * p / 2) ** 2 + np.cos(la1 * p) * np.cos(la2 * p) * np.sin((lo2 - lo1) * p / 2) ** 2
    return 12742 * np.arcsin(np.sqrt(a))
L = hav(E[:, 0], E[:, 1], E[:, 2], E[:, 3])
print("segments", len(E), "km paved", round(L[K == 0].sum()), "km dirt", round(L[K == 1].sum()), flush=True)
res = {"all_ksa_bbox": {"paved_km": round(float(L[K == 0].sum())), "dirt_km": round(float(L[K == 1].sum()))}, "areas": {}}
random.seed(7)
for name, (s, w, n, e) in AREAS.items():
    mid = ((E[:, 0] + E[:, 2]) / 2, (E[:, 1] + E[:, 3]) / 2)
    m = (mid[0] >= s) & (mid[0] <= n) & (mid[1] >= w) & (mid[1] <= e)
    Ea, Ia, Ka, La = E[m], ID[m], K[m], L[m]
    area_km2 = (n - s) * 111.32 * (e - w) * 111.32 * math.cos(math.radians((n + s) / 2))
    # التغطية: شبكة 500 م — كم خلية خلال 1 و3 كم من أي طريق/درب
    C = 0.0045; R = int((n - s) / C) + 1; Cc = int((e - w) / C) + 1
    g = np.zeros((R, Cc), bool)
    for (a1, o1, a2, o2), l in zip(Ea, La):
        k = max(1, int(l / 0.3))
        for t in np.linspace(0, 1, k + 1):
            r = int(((a1 + (a2 - a1) * t) - s) / C); c = int(((o1 + (o2 - o1) * t) - w) / C)
            if 0 <= r < R and 0 <= c < Cc: g[r, c] = True
    from scipy.ndimage import distance_transform_edt
    d = distance_transform_edt(~g) * 0.5 if g.any() else np.full(g.shape, 99.0)
    cov1, cov3 = float((d <= 1).mean() * 100), float((d <= 3).mean() * 100)
    # الشبكة: عقد ومكونات
    u, inv = np.unique(Ia.ravel(), return_inverse=True); inv = inv.reshape(-1, 2)
    nN = len(u)
    G = coo_matrix((np.r_[La, La], (np.r_[inv[:, 0], inv[:, 1]], np.r_[inv[:, 1], inv[:, 0]])), shape=(nN, nN)).tocsr() if nN else None
    route = {}
    if nN:
        nc, lab = connected_components(G, directed=False)
        coords = np.zeros((nN, 2)); coords[inv[:, 0]] = Ea[:, :2]; coords[inv[:, 1]] = Ea[:, 2:]
        cl = math.cos(math.radians((n + s) / 2)); XY = np.c_[coords[:, 0] * 111.32, coords[:, 1] * 111.32 * cl]
        T = cKDTree(XY)
        big = np.bincount(lab); comp_share = float(big.max() / nN * 100)
        ok = 0; ratios = []; snaps = []; tries = 0; pairs = []
        while len(pairs) < 300 and tries < 5000:
            tries += 1
            p1 = (random.uniform(s, n), random.uniform(w, e)); p2 = (random.uniform(s, n), random.uniform(w, e))
            dd = float(hav(np.array(p1[0]), np.array(p1[1]), np.array(p2[0]), np.array(p2[1])))
            if 10 <= dd <= 60: pairs.append((p1, p2, dd))
        src = []
        for p1, p2, dd in pairs:
            q = np.array([[p1[0] * 111.32, p1[1] * 111.32 * cl], [p2[0] * 111.32, p2[1] * 111.32 * cl]])
            sd, si = T.query(q); snaps += list(sd); src.append((si, sd, dd))
        starts = np.unique([x[0][0] for x in src])
        D = dijkstra(G, directed=False, indices=starts, limit=400)
        row = {v: i for i, v in enumerate(starts)}
        for si, sd, dd in src:
            if sd[0] > 3 or sd[1] > 3: continue
            r = D[row[si[0]], si[1]]
            if np.isfinite(r): ok += 1; ratios.append((r + sd[0] + sd[1]) / dd)
        route = {"pairs": len(src), "routable_pct": round(ok / max(1, len(src)) * 100), "median_detour": round(float(np.median(ratios)), 2) if ratios else None,
                 "median_snap_km": round(float(np.median(snaps)), 2), "largest_component_pct": round(comp_share), "components": int(nc)}
    res["areas"][name] = {"area_km2": round(area_km2), "paved_km": round(float(La[Ka == 0].sum())), "dirt_km": round(float(La[Ka == 1].sum())),
        "dirt_km_per_100km2": round(float(La[Ka == 1].sum()) / area_km2 * 100, 1), "within_1km_pct": round(cov1), "within_3km_pct": round(cov3), **route}
    print(name, res["areas"][name], flush=True)
    # صورة صغيرة
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
        from matplotlib.collections import LineCollection
        fig, ax = plt.subplots(figsize=(6, 6 * (n - s) / ((e - w) * math.cos(math.radians((n + s) / 2)))), dpi=110)
        for kk, col, lw in ((1, "#B5833A", .5), (0, "#333333", 1.0)):
            sel = Ka == kk; ax.add_collection(LineCollection([[(o1, a1), (o2, a2)] for a1, o1, a2, o2 in Ea[sel]], colors=col, linewidths=lw))
        ax.set_xlim(w, e); ax.set_ylim(s, n); ax.set_aspect(1 / math.cos(math.radians((n + s) / 2))); ax.set_xticks([]); ax.set_yticks([])
        fig.tight_layout(); fig.savefig(f"{OUT}/{list(AREAS).index(name) + 1}.png"); plt.close(fig)
    except Exception as ex: print("plot", ex)
json.dump(res, open(f"{OUT}/roads-study.json", "w"), ensure_ascii=False, indent=1)
print("::notice::" + json.dumps(res, ensure_ascii=False)[:3500])

"""تشخيص: فياض الشمال اللي نزلت خضرتها بين صورة 8 و13 نوفمبر — هل صورة 8 «أرض مبلولة» ولا صورة 13 «غبار»؟
لكل صورة Sentinel-2 من 1 نوفمبر: NDVI (المئين 75) ونسبة الخضرة، والأزرق B02 (يرتفع مع الغبار)، والأحمر B04 (التربة المبلولة أغمق)،
وAOT (سماكة الغبار/الهباء من المعالجة نفسها). ونقيس معها نقاط مرجعية جرداء قريبة (ما تتغير إلا بالغبار أو البلل).
python3 tools/fayd/diag_dates.py "اسم1,اسم2" 2026-11-01 2026-11-14"""
import json, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, rasterio, s2
from rasterio.warp import transform
from rasterio.windows import Window
from concurrent.futures import ThreadPoolExecutor

SITES = json.load(open("data/fayd-sites.json"))
names = sys.argv[1].split(",") if len(sys.argv) > 1 and sys.argv[1] else []
start, end = (sys.argv[2], sys.argv[3]) if len(sys.argv) > 3 else ("2026-11-01", "2026-11-14")
F = {r[0]: r for r in json.load(open("data/fayd.json"))["rows"]}
pick = [i for i, s in enumerate(SITES) if s[0] in names and s[3] in ("الحدود الشمالية", "حائل")]
# مرجع: فياض قريبة (≤40 كم) قراءتها صفر بالصورة الحالية — جرداء
ref = []
for i in pick:
    la, lo = SITES[i][1], SITES[i][2]
    for j, s in enumerate(SITES):
        if j in pick or j in ref: continue
        if abs(s[1] - la) < .35 and abs(s[2] - lo) < .4 and F.get(j) and F[j][3] == 0 and F[j][1] < 10:
            ref.append(j); break
pts = [(i, SITES[i][1], SITES[i][2]) for i in pick + ref]
H = 20
def read(it, inside):
    off = 1000 if str(it["properties"].get("s2:processing_baseline", "00.00")) >= "04.00" else 0
    date = it["properties"]["datetime"][:10]; out = {}
    h = {b: it["assets"][b]["href"] for b in ("B02", "B04", "B08", "SCL", "AOT")}
    for k in range(3):
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3"):
                src = {b: rasterio.open(h[b] + "?" + s2.token(h[b])) for b in h}
                xs, ys = transform("EPSG:4326", src["B04"].crs, [p[2] for p in inside], [p[1] for p in inside])
                inv = ~src["B04"].transform
                for (idx, la, lo), x, y in zip(inside, xs, ys):
                    c, r = inv * (x, y); c, r = int(c), int(r)
                    if not (H <= r < 10980 - H and H <= c < 10980 - H): continue
                    w = Window(c - H, r - H, 2 * H + 1, 2 * H + 1)
                    B = {b: src[b].read(1, window=w).astype("float32") for b in ("B02", "B04", "B08", "AOT")}
                    sw = Window((c - H) // 2, (r - H) // 2, H + 1, H + 1)
                    S = np.repeat(np.repeat(src["SCL"].read(1, window=sw), 2, 0), 2, 1)[:2 * H + 1, :2 * H + 1]
                    ok = np.isin(S, (4, 5, 6)) & (B["B04"] > 0)
                    if ok.mean() < .5: out[idx] = (date, None, None, None, None, None, round(float(ok.mean()), 2), sorted(set(S.ravel().tolist()))); continue
                    R = np.clip(B["B04"][ok] - off, 1, None); N = np.clip(B["B08"][ok] - off, 1, None); BL = np.clip(B["B02"][ok] - off, 1, None)
                    nd = (N - R) / (N + R)
                    out[idx] = (date, round(float(np.percentile(nd, 75)), 3), round(float((nd > .18).mean()), 2), int(np.median(BL)), int(np.median(R)),
                                round(float(np.median(B["AOT"][ok])) / 1000, 3), round(float(ok.mean()), 2), "")
                for s_ in src.values(): s_.close()
            return out
        except Exception as e:
            print("retry", it["id"], str(e)[:100], flush=True); time.sleep(5)
    return out
lats = [p[1] for p in pts]; lngs = [p[2] for p in pts]
items = s2.search([min(lngs) - .1, min(lats) - .1, max(lngs) + .1, max(lats) + .1], f"{start}T00:00:00Z/{end}T23:59:59Z", 100)
jobs = []
for it in items:
    w, so, e, n = it["bbox"]
    ins = [p for p in pts if so <= p[1] <= n and w <= p[2] <= e]
    if ins: jobs.append((it, ins))
print("items", len(items), "jobs", len(jobs), flush=True)
res = {}
with ThreadPoolExecutor(8) as ex:
    for it_out, (it, _) in zip(ex.map(lambda j: read(*j), jobs), jobs):
        for idx, v in it_out.items(): res.setdefault(idx, {})[v[0] + " " + it["id"][-13:-7]] = v[1:] + (it["properties"].get("eo:cloud_cover"),)
lines = ["# تشخيص صور الفياض " + start + " → " + end, "", "الأعمدة: NDVI75 · نسبة الخضرة · الأزرق B02 · الأحمر B04 · AOT · نسبة البكسل الصافي · غيم المشهد٪", ""]
for i in pick + ref:
    lines.append(("## " if i in pick else "## [مرجع جرداء] ") + SITES[i][0] + f" ({SITES[i][3]}) {SITES[i][1]},{SITES[i][2]}")
    for d in sorted(res.get(i, {})):
        v = res[i][d]; lines.append(f"- {d}: " + " · ".join(str(x) for x in v))
    lines.append("")
txt = "\n".join(lines); print(txt)
os.makedirs("diag", exist_ok=True); open("diag/fayd-dates.md", "w").write(txt)

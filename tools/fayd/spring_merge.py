"""دمج أجزاء طبقة الربيع (21 نوفمبر): prev/ = فرع spring-data الحالي، parts/*/ = ناتج كل جزء (فيه part.json بحدوده)
→ out/ : القطع القديمة برا الأجزاء اللي نجحت تبقى، واللي داخلها تتبدل بالجديد. + index.json و sat.json"""
import os, sys, json, shutil, time, glob
CH = 0.25
prev, parts, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(f"{out}/sat", exist_ok=True)
J = lambda p, d: json.load(open(p)) if os.path.exists(p) else d
pi, ps = J(f"{prev}/index.json", {}), J(f"{prev}/sat.json", {})
done = []
for d in sorted(glob.glob(f"{parts}/*/")):
    m = J(f"{d}/part.json", None); ix = J(f"{d}/index.json", None)
    if not m or ix is None: print("skip", d); continue
    done.append((m["bbox"], d, ix, J(f"{d}/sat.json", {"chunks": []})))
inside = lambda c: any(b[0] <= c[1] + CH / 2 <= b[2] and b[1] <= c[0] + CH / 2 <= b[3] for b, *_ in done)
nm = lambda c: f"{c[0]:.2f}_{c[1]:.2f}"
idx, sat, asof, pal = [], [], [pi.get("asof", "")], pi.get("pal")
for c in pi.get("chunks", []):
    if not inside(c) and os.path.exists(f"{prev}/{nm(c)}.png"): shutil.copy(f"{prev}/{nm(c)}.png", f"{out}/{nm(c)}.png"); idx.append(c)
for c in ps.get("chunks", []):
    if not inside(c) and os.path.exists(f"{prev}/sat/{nm(c)}.webp"): shutil.copy(f"{prev}/sat/{nm(c)}.webp", f"{out}/sat/{nm(c)}.webp"); sat.append(c)
for b, d, ix, sx in done:
    asof.append(ix.get("asof", "")); pal = ix.get("pal") or pal
    for c in ix.get("chunks", []):
        if os.path.exists(f"{d}/{nm(c)}.png"): shutil.copy(f"{d}/{nm(c)}.png", f"{out}/{nm(c)}.png"); idx.append(c)
    for c in sx.get("chunks", []):
        if os.path.exists(f"{d}/sat/{nm(c)}.webp"): shutil.copy(f"{d}/sat/{nm(c)}.webp", f"{out}/sat/{nm(c)}.webp"); sat.append(c)
# 22 نوفمبر: قطعة أكثر من ربعها «ربيع» = غالبًا خلل (جبال/حرّات) — ما تنعرض. وصورة القمر لأكثر 120 قطعة ربيع بس (الحجم)
N2 = (CH / 0.0002) ** 2
bad = {(c[0], c[1]) for c in idx if sum(c[2][:3]) / N2 > .25}
idx = [c for c in idx if (c[0], c[1]) not in bad]
spc = {(c[0], c[1]): sum(c[2][:3]) for c in idx}
sat = sorted([c for c in sat if (c[0], c[1]) in spc], key=lambda c: -spc[(c[0], c[1])])[:120]
keep = {f"{c[0]:.2f}_{c[1]:.2f}.webp" for c in sat}
for f in os.listdir(f"{out}/sat"):
    if f not in keep: os.remove(f"{out}/sat/{f}")
print(f"::notice::hidden implausible chunks {len(bad)}")
gen = int(time.time()); a = max(asof)
json.dump({"v": 2, "gen": gen, "asof": a, "res": 0.0002, "ch": CH, "pal": pal, "chunks": sorted(idx)}, open(f"{out}/index.json", "w"), ensure_ascii=False)
json.dump({"v": 1, "gen": gen, "asof": a, "res": 0.0001, "ch": CH, "chunks": sorted(sat)}, open(f"{out}/sat.json", "w"))
print(f"::notice::merged parts {len(done)} · spring chunks {len(idx)} · sat chunks {len(sat)} · asof {a}")

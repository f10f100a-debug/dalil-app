# فحص مؤقت: مقارنة مطر CMORPH بالرادار (24–29 أكتوبر) + مطر الشمال 1–23 أكتوبر
import sys, os, json, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, sat, radar
db = sat.update(dt.date(2026, 10, 1), dt.date.today() - dt.timedelta(days=1))
G = sat.grids(db); R = radar.load("2026-10-24")
print("::notice::days", sorted(G)[:1], sorted(G)[-1:], len(G))
# 1) نفس الخلايا: شبكة الرادار مقابل القمر (أيام فيها الاثنين)
for k in sorted(G):
    if k not in R or R[k]["frames"] < 60: continue
    r = np.array(R[k]["acc"]).reshape(radar.RR, radar.RC) / 10; c = np.array(R[k]["clutter"]).reshape(radar.RR, radar.RC)
    s = G[k]; m = ~c & (np.maximum(r, s) >= 1)
    if m.sum() < 5: continue
    wr, ws = r[m] >= 5, s[m] >= 5
    print(f"::notice::cmp {k} cells={m.sum()} radar_mean={r[m].mean():.1f} sat_mean={s[m].mean():.1f} corr={np.corrcoef(r[m], s[m])[0,1]:.2f} both5={int((wr&ws).sum())} radar5only={int((wr&~ws).sum())} sat5only={int((ws&~wr).sum())}")
# 2) مناطق الفقع: مطر القمر لكل يوم 1–29 أكتوبر
exec(open("tools/fayd/fq.py").read().split("GOOD, GREAT")[0].split("UA =")[1].split("\n", 1)[1])   # AREAS
for name, reg, la, lo in AREAS:
    v = {k: sat.mm_at(G[k], la, lo) for k in sorted(G)}
    pre = sum(x for k, x in v.items() if k < "2026-10-16"); w1 = sum(x for k, x in v.items() if "2026-10-16" <= k < "2026-10-24"); w2 = sum(x for k, x in v.items() if k >= "2026-10-24")
    big = " ".join(f"{k[5:]}:{x:.0f}" for k, x in v.items() if x >= 3)
    print(f"::notice::fq {name} pre={pre:.0f} 16-23={w1:.0f} 24+={w2:.0f} | {big}")

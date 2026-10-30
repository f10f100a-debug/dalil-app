# فحص مؤقت: اتجاه شبكة CMORPH وترتيب البايتات — نقارن 28 أكتوبر بالرادار بعدة احتمالات
import sys, os, gzip, datetime as dt, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, sat, radar
from concurrent.futures import ThreadPoolExecutor
R = radar.load("2026-10-28")["2026-10-28"]
r = np.array(R["acc"]).reshape(radar.RR, radar.RC) / 10; c = np.array(R["clutter"]).reshape(radar.RR, radar.RC)
t0 = dt.datetime(2026, 10, 27, 21)
def raw(t):
    u = sat.URL.format(y=t.year, m=t.month, d=t.day, h=t.hour)
    with urllib.request.urlopen(u, timeout=90) as f: return gzip.decompress(f.read())
with ThreadPoolExecutor(8) as ex: B = list(ex.map(raw, [t0 + dt.timedelta(hours=k) for k in range(24)]))
for end in ["<f4", ">f4"]:
    full = sum(np.where((a := np.frombuffer(b, dtype=end).reshape(2, sat.NY, sat.NX)) < 0, 0, np.nan_to_num(a, posinf=0)).sum(axis=0) * 0.5 for b in B)
    print(f"::notice::{end} global max={full.max():.1f} mean={full.mean():.3f}")
    for flip in [False, True]:
        f = full[::-1] if flip else full
        # الشبكة الأصلية (i من الجنوب) → متوسط خلايا 0.2°
        lat = sat.Y0 + np.arange(sat.NY) * sat.DY; lon = sat.X0 + np.arange(sat.NX) * sat.DX
        g = np.zeros((radar.RR, radar.RC)); n = np.zeros_like(g)
        I = ((lat - 16) / 0.2).astype(int); J = ((lon - 34) / 0.2).astype(int)
        mi = (I >= 0) & (I < radar.RR); mj = (J >= 0) & (J < radar.RC)
        sub = f[np.ix_(mi, mj)]; ii = I[mi]; jj = J[mj]
        for a, i in enumerate(ii): np.add.at(g[i], jj, sub[a]); np.add.at(n[i], jj, 1)
        g /= np.maximum(n, 1)
        m = ~c & (np.maximum(r, g) >= 1)
        cr = np.corrcoef(r[m], g[m])[0, 1] if m.sum() > 5 else 0
        i, j = np.unravel_index(g.argmax(), g.shape)
        print(f"::notice::{end} flip={flip} corr={cr:.2f} sat_mean={g[m].mean():.1f} radar_mean={r[m].mean():.1f} satmax={g.max():.0f}@{16+i*.2:.1f},{34+j*.2:.1f}")
ri, rj = np.unravel_index(np.where(c, 0, r).argmax(), r.shape); print(f"::notice::radar max {r[ri,rj]:.0f}@{16+ri*.2:.1f},{34+rj*.2:.1f}")

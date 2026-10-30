# تجربة: مطر الأقمار الصناعية (CMORPH RT من NOAA، 8 كم كل نص ساعة) لأكتوبر فوق المملكة → مجموع يومي بتوقيت الرياض
import urllib.request, gzip, numpy as np, datetime as dt, sys, time
from concurrent.futures import ThreadPoolExecutor
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
def get(u):
    for t in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120) as r: return r.read()
        except Exception as e: err = e; time.sleep(5 * (t + 1))
    print("fail", u[-40:], str(err)[:60], flush=True); return None
NX, NY, D = 4948, 1649, 0.072756
X0, Y0 = 0.036378, -59.963614
i0, i1 = int((16 - Y0) / D), int((32.5 - Y0) / D) + 1
j0, j1 = int((34 - X0) / D), int((56 - X0) / D) + 1
print("box rows", i0, i1, "cols", j0, j1, flush=True)
hours = [dt.datetime(2026, 9, 30, 21) + dt.timedelta(hours=h) for h in range(24 * 30 + 3)]
sizes = []
def one(h):
    b = get(f"https://ftp.cpc.ncep.noaa.gov/precip/CMORPH_RT/GLOBE/data/{h:%Y}/{h:%Y%m}/CMORPH_V0.x_RT_8km-30min_{h:%Y%m%d%H}.gz")
    if not b: return h, None
    sizes.append(len(b))
    a = np.frombuffer(gzip.decompress(b), "<f4")
    if a.size != 2 * NX * NY: print("size?", a.size, flush=True); return h, None
    a = a.reshape(2, NY, NX)[:, i0:i1, j0:j1].copy()
    a[a < 0] = np.nan
    return h, a
T = time.time()
acc, cnt = {}, {}
with ThreadPoolExecutor(16) as ex:
    for h, a in ex.map(one, hours):
        if a is None: continue
        day = (h + dt.timedelta(hours=3)).date().isoformat()
        if not ("2026-10-01" <= day <= "2026-10-30"): continue
        v = np.nan_to_num(a, nan=0).sum(0) * 0.5
        acc[day] = acc.get(day, 0) + v; cnt[day] = cnt.get(day, 0) + int(np.isfinite(a).all(axis=(1, 2)).sum())
print("cmorph t", round(time.time() - T), "files", len(sizes), "avgMB", round(np.mean(sizes) / 1e6, 1) if sizes else 0, flush=True)
days = sorted(acc)
grid = np.stack([np.round(acc[d] * 10).clip(0, 65535).astype("<u2") for d in days])
np.savez_compressed("cmorph.npz", days=np.array(days), halfhours=np.array([cnt[d] for d in days]), mm10=grid,
                    lat0=Y0 + i0 * D, lng0=X0 + j0 * D, step=D)
for d in days: print("day", d, "halfhours", cnt[d], "max", round(float(acc[d].max()), 1), "wet>10mm px", int((acc[d] > 10).sum()), flush=True)

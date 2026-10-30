# مطر الأقمار الصناعية (NOAA CMORPH RT، ‏8 كم كل نص ساعة، عام بدون حساب، يتأخر ~يوم):
# يسد الأيام اللي ما فيها رادار عندنا (قبل 24 أكتوبر 2026) ويلقط الزخات اللي تفوّتها النماذج.
# الملف: شبكتين float32 (نص ساعة لكل وحدة) 4948×1649، خط الطول من 0.0364° شرق بخطوة 0.072756°،
# خط العرض من 59.9636° جنوب شمالًا بخطوة 0.072771°، الوحدة ملم/ساعة، -999 = ناقص.
# نجمعها لليوم بتوقيت الرياض على نفس شبكة radar_daily (0.2°) ونحفظها في data/sat-rain.json.
import gzip, json, base64, struct, os, datetime as dt, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np

URL = "https://ftp.cpc.ncep.noaa.gov/precip/CMORPH_RT/GLOBE/data/{y}/{y}{m:02d}/CMORPH_V0.x_RT_8km-30min_{y}{m:02d}{d:02d}{h:02d}.gz"
NX, NY, DX, DY, X0, Y0 = 4948, 1649, 0.072756, 0.072771, 0.0363783, -59.963614
LAT0, LNG0, CELL, RR, RC = 16.0, 34.0, 0.2, 83, 110      # نفس شبكة radar_daily
FILE = "data/sat-rain.json"
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
# خانات CMORPH داخل مربع المملكة
JX = np.arange(int((LNG0 - X0) / DX), int((LNG0 + RC * CELL - X0) / DX) + 2)
IY = np.arange(int((LAT0 - Y0) / DY), int((LAT0 + RR * CELL - Y0) / DY) + 2)
LON = X0 + JX * DX; LAT = Y0 + IY * DY
CI = np.clip(((LAT - LAT0) / CELL).astype(int), -1, RR); CJ = np.clip(((LON - LNG0) / CELL).astype(int), -1, RC)

def hour(t):
    """مطر ساعة وحدة (ملم) على مربع المملكة بالدقة الأصلية، أو None إذا الملف مو موجود"""
    u = URL.format(y=t.year, m=t.month, d=t.day, h=t.hour)
    for k in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=90) as r: raw = gzip.decompress(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
        except Exception: pass
    else: return None
    a = np.frombuffer(raw, dtype="<f4").reshape(2, NY, NX)[:, IY[0]:IY[-1] + 1, JX[0]:JX[-1] + 1]
    a = np.where(a < 0, np.nan, a)
    return np.nansum(a, axis=0) * 0.5, np.isnan(a).all(axis=0)

def day(d):
    """مجموع يوم الرياض d (من 21:00 UTC اليوم السابق) على شبكة 0.2° → (مصفوفة ملم، عدد الساعات المتوفرة)"""
    t0 = dt.datetime(d.year, d.month, d.day) - dt.timedelta(hours=3)
    with ThreadPoolExecutor(8) as ex: hs = list(ex.map(hour, [t0 + dt.timedelta(hours=k) for k in range(24)]))
    got = [h for h in hs if h is not None]
    if not got: return None, 0
    fine = sum(h[0] for h in got) * (24 / len(got))
    acc = np.zeros((RR, RC)); n = np.zeros((RR, RC))
    for a, i in enumerate(CI):
        if i < 0 or i >= RR: continue
        ok = (CJ >= 0) & (CJ < RC)
        np.add.at(acc[i], CJ[ok], fine[a, ok]); np.add.at(n[i], CJ[ok], 1)
    return acc / np.maximum(n, 1), len(got)

def load():
    try: return json.load(open(FILE))
    except Exception: return {"days": {}}

def update(since, until):
    """يحسب الأيام الناقصة (أو اللي كانت ناقصة ساعات) من since إلى until ويحفظها"""
    db = load(); d = since; changed = 0
    while d <= until:
        k = d.isoformat(); rec = db["days"].get(k)
        if not rec or rec.get("h", 0) < 24:
            g, h = day(d)
            if g is not None and (not rec or h > rec.get("h", 0)):
                v = np.clip(np.round(g * 10), 0, 65535).astype("<u2").ravel()
                db["days"][k] = {"h": h, "acc": base64.b64encode(v.tobytes()).decode()}; changed += 1
            print("sat", k, h, "h", flush=True)
        d += dt.timedelta(days=1)
    if changed:
        json.dump(db, open(FILE, "w"), separators=(",", ":"))
    return db

def grids(db=None):
    db = db or load(); out = {}
    for k, rec in db["days"].items():
        if rec.get("h", 0) < 18: continue          # يوم ناقص كثير = ما نعتمده
        out[k] = np.frombuffer(base64.b64decode(rec["acc"]), dtype="<u2").reshape(RR, RC) / 10
    return out

def mm_at(g, lat, lng, radius_cells=1):
    """مطر القمر حول نقطة: نفس طريقة الرادار (نص للخلية نفسها ونص لمتوسط ~20 كم حولها)"""
    i, j = int((lat - LAT0) / CELL), int((lng - LNG0) / CELL)
    if not (0 <= i < RR and 0 <= j < RC): return None
    box = g[max(0, i - radius_cells):i + radius_cells + 1, max(0, j - radius_cells):j + radius_cells + 1]
    return round(float(0.5 * g[i, j] + 0.5 * box.mean()), 1)

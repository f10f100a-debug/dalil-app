# مطر الأقمار الصناعية CHIRPS v3 (UCSB، مفتوح، مصمم للمناطق الجافة) لمناطق الفقع — 19 نوفمبر (اختبار الدقة: يأكد المطر بدون محطة)
# نحفظ لكل يوم قيمة كل منطقة في data/chirps-fq.json وننزل بس الأيام الناقصة (والمبدئي يتبدّل بالنهائي لما ينزل).
# ملاحظة: الأقمار تفوّت العواصف الرعدية أحيانًا (عرعر 27 أكتوبر) — نستخدمها تأكيد وتصحيح للرادار، وما تنقص المحطة أبدًا.
import json, os, datetime as dt, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
FILE = "data/chirps-fq.json"
V3 = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily"
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}

ERR = {}
def _get(url):
    for _ in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: return r.read()
        except urllib.error.HTTPError as e:
            ERR[e.code] = ERR.get(e.code, 0) + 1
            if e.code in (403, 404): return None
        except Exception as e: ERR[type(e).__name__] = ERR.get(type(e).__name__, 0) + 1
    return None

def _day(d, pts):
    import rasterio
    from rasterio.io import MemoryFile
    y, m, dd = d.year, d.month, d.day
    for kind, url in (("final", f"{V3}/final/sat/{y}/chirps-v3.0.sat.{y}.{m:02d}.{dd:02d}.tif"),
                      ("prelim", f"{V3}/prelim/sat/{y}/chirps-v3.0.prelim.{y}.{m:02d}.{dd:02d}.tif")):
        b = _get(url)
        if not b: continue
        with MemoryFile(b) as mf, mf.open() as ds:
            arr = ds.read(1); out = []
            for la, lo in pts:
                r, c = ds.index(lo, la); w = arr[max(0, r - 1):r + 2, max(0, c - 1):c + 2].astype(float); w = w[w >= 0]
                out.append(round(float(w.mean()), 2) if w.size else None)
        return {"k": kind, "v": out}
    return None

def update(areas, start, end, max_new=60):
    pts = [(a[2], a[3]) for a in areas]
    try: db = json.load(open(FILE))
    except Exception: db = {}
    if [list(p) for p in db.get("pts") or []] != [list(p) for p in pts]: db = {"pts": pts, "days": {}}
    today = dt.date.today(); want = []
    d = start
    while d <= min(end, today - dt.timedelta(days=1)):
        x = db["days"].get(d.isoformat())
        if x is None or (x["k"] == "prelim" and (today - d).days >= 20): want.append(d)
        d += dt.timedelta(days=1)
    want = want[:max_new]
    try:
        with ThreadPoolExecutor(8) as ex: res = list(ex.map(lambda d: (d, _day(d, pts)), want))
        for d, x in res:
            if x: db["days"][d.isoformat()] = x
    except Exception as e: print("::warning::chirps " + repr(e)[:200])
    print(f"::notice::chirps: طلبنا {len(want)} يوم، صار عندنا {len(db['days'])} — أخطاء {ERR}")
    json.dump(db, open(FILE, "w"), separators=(",", ":"))
    return db

# مطر محطات الأرصاد الأرضية (تقارير SYNOP الخام عبر Ogimet، عامة): قياس فعلي بمقياس المطر — يلقط اللي فوّته الرادار والنماذج
# (طريف 27–28 أكتوبر 2026: المحطة 44 ملم، النماذج والرادار ~6). نفك التقرير بأنفسنا (مجموعة 6RRRt في القسم الأول):
# صفحة Ogimet المفكوكة قرأت رمز غلط (966) على إنه 66 ملم، فنتجاهل أي قيمة 12 ساعة فوق 300 ملم.
# تقرير 00Z (مطر من 3 العصر لـ3 الفجر بتوقيت الرياض) ينحسب لليوم اللي قبله، وتقرير 12Z لنفس اليوم.
# نحفظ المجموع اليومي في data/synop-rain.json ونجيب آخر 5 أيام بس كل مرة (طلب واحد لكل محطة).
import json, time, datetime as dt, urllib.request
FILE = "data/synop-rain.json"
FAILED = []
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
# رقم المحطة: الاسم، خط العرض، خط الطول
STATIONS = {
    40356: ("طريف", 31.69, 38.73), 40357: ("عرعر", 30.91, 41.14), 40360: ("القريات", 31.41, 37.28), 40361: ("الجوف", 29.79, 40.10),
    40362: ("رفحاء", 29.63, 43.49), 40373: ("القيصومة", 28.34, 46.13), 40375: ("تبوك", 28.37, 36.62), 40400: ("الوجه", 26.20, 36.48),
    40394: ("حائل", 27.44, 41.69), 40405: ("القصيم", 26.30, 43.77), 40401: ("العلا", 26.48, 38.12), 40391: ("مطار البحر الأحمر", 25.62, 37.09),
    40430: ("المدينة", 24.55, 39.71), 40439: ("ينبع", 24.14, 38.06), 40438: ("الرياض", 24.71, 46.72),
    40417: ("الدمام", 26.45, 49.81), 40420: ("الأحساء", 25.30, 49.48),
    41031: ("منى", 21.42, 39.87), 41036: ("الطائف", 21.48, 40.54), 41055: ("الباحة", 20.30, 41.63), 41140: ("جازان", 16.90, 42.59),
}
PERIOD = {"1": 6, "2": 12, "3": 18, "4": 24, "5": 1, "6": 2, "7": 3, "8": 9, "9": 15}

def rain12(msg):
    """مطر آخر 12 ساعة (ملم) من تقرير SYNOP، أو None إذا ما فيه مجموعة مطر 12 ساعة صالحة"""
    g = msg.replace("=", " ").split()
    try: g = g[g.index("AAXX") + 3:]     # بعد: AAXX YYGGi IIiii
    except ValueError: return None
    if len(g) < 3: return None
    if g[0][:1] == "4" or g[0][:1] == "3": pass     # iR=3: ما فيه مطر (صفر)، iR=4: ما تم القياس
    sec1, prev = [], 0
    for x in g[2:]:
        if x in ("333", "555", "222") or x.startswith("222"): break
        sec1.append(x)
    if g[0][:1] == "3": return 0.0
    for x in sec1:
        if len(x) != 5 or not x[0].isdigit(): continue
        d = int(x[0])
        if d < prev: break                         # المجموعات بالترتيب 1..9
        prev = d
        if d == 6 and x[1:4].isdigit():
            if PERIOD.get(x[4]) != 12: return None
            rrr = int(x[1:4])
            if rrr >= 990: return 0.0 if rrr == 990 else (rrr - 990) / 10
            return None if rrr > 300 else float(rrr)
    return None

def fetch(wid, begin, end):
    u = f"https://www.ogimet.com/cgi-bin/getsynop?block={wid}&begin={begin:%Y%m%d}0000&end={end:%Y%m%d}2359"
    for k in range(4):
        try:
            t = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=90).read().decode("latin-1")
            if "AAXX" in t or not t.strip(): break
            print("synop odd", wid, t[:120], flush=True)
        except Exception as e:
            print("synop retry", wid, str(e)[:60], flush=True)
        time.sleep(30 * (k + 1))
    else: return None
    out = {}   # يوم الرياض → ملم ؛ الأيام اللي فيها تقارير بدون مطر = 0
    for line in t.splitlines():
        f = line.split(",", 6)
        if len(f) < 7 or f[4] not in ("00", "12"): continue
        v = rain12(f[6])
        day = dt.date(int(f[1]), int(f[2]), int(f[3]))
        if f[4] == "00": day -= dt.timedelta(days=1)
        k = day.isoformat()
        if v is not None: out[k] = round(out.get(k, 0.0) + v, 1)
    return out

def update(since, until):
    try: db = json.load(open(FILE))
    except Exception: db = {"stations": {}}
    for wid in STATIONS:
        rec = db["stations"].setdefault(str(wid), {})
        have = sorted(k for k in rec if k >= since.isoformat())
        begin = since if not have else max(since, dt.date.fromisoformat(have[-1]) - dt.timedelta(days=4))
        got = fetch(wid, begin, until + dt.timedelta(days=1))
        if got is None: FAILED.append(str(wid)); continue
        for k, v in got.items():
            if since.isoformat() <= k <= until.isoformat(): rec[k] = v
        time.sleep(10)
    json.dump(db, open(FILE, "w"), separators=(",", ":"), ensure_ascii=False)
    return db

def near(db, lat, lng, max_km=35):
    """مطر أقرب محطة خلال 35 كم: (اسمها، {يوم: ملم}) أو None"""
    import math
    best = None
    for wid, (name, la, lo) in STATIONS.items():
        k = 6371 * 2 * math.asin(math.sqrt(math.sin(math.radians(la - lat) / 2) ** 2 + math.cos(math.radians(lat)) * math.cos(math.radians(la)) * math.sin(math.radians(lo - lng) / 2) ** 2))
        if k <= max_km and (best is None or k < best[0]): best = (k, wid, name)
    if not best: return None
    return best[2], db["stations"].get(str(best[1]), {})

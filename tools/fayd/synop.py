# مطر محطات الأرصاد الأرضية (تقارير SYNOP عبر Ogimet، عامة): قياس فعلي بمقياس المطر — يلقط اللي فوّته الرادار والنماذج
# (طريف 27–28 أكتوبر 2026: المحطة 44 ملم، النماذج والرادار ~6). كل تقرير 00Z أو 12Z فيه مطر آخر 12 ساعة:
# تقرير 00Z (من 3 العصر لـ3 الفجر بتوقيت الرياض) ينحسب لليوم اللي قبله، وتقرير 12Z لنفس اليوم.
# نحفظ المجموع اليومي في data/synop-rain.json ونجيب آخر أيام بس كل مرة.
import re, json, time, html, datetime as dt, urllib.request
FILE = "data/synop-rain.json"
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
# رقم المحطة: الاسم، خط العرض، خط الطول
STATIONS = {
    40356: ("طريف", 31.69, 38.73), 40357: ("عرعر", 30.91, 41.14), 40360: ("القريات", 31.41, 37.28), 40361: ("الجوف", 29.79, 40.10),
    40362: ("رفحاء", 29.63, 43.49), 40373: ("القيصومة", 28.34, 46.13), 40377: ("حفر الباطن", 27.90, 45.53), 40375: ("تبوك", 28.37, 36.62),
    40394: ("حائل", 27.44, 41.69), 40405: ("القصيم", 26.30, 43.77), 40400: ("الوجه", 26.20, 36.48),
}

def fetch(wid, end, ndays):
    u = f"https://www.ogimet.com/cgi-bin/gsynres?ind={wid}&ndays={ndays}&ano={end.year}&mes={end.month}&day={end.day}&hora=18&lang=en&decoded=yes"
    for k in range(3):
        try:
            t = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read().decode("latin-1")
            break
        except Exception as e:
            print("synop retry", wid, str(e)[:60], flush=True); time.sleep(10 * (k + 1))
    else: return None
    txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", t)))
    if "Decoded synop" not in txt: return None
    out = {}   # يوم الرياض → ملم ؛ الأيام اللي فيها تقارير بدون مطر = 0
    for d, h, p in re.findall(r"(\d\d/\d\d/\d{4}) (\d\d):\d\d((?:(?!\d\d/\d\d/\d{4} \d\d:\d\d).){0,600})", txt):
        if h not in ("00", "12"): continue
        day = dt.date(int(d[6:]), int(d[:2]), int(d[3:5]))
        if h == "00": day -= dt.timedelta(days=1)
        k = day.isoformat(); out.setdefault(k, 0.0)
        for v, per in re.findall(r"(\d+\.\d|Tr)/12h", p):
            out[k] += 0.0 if v == "Tr" else float(v)
    return out

def update(since, until):
    try: db = json.load(open(FILE))
    except Exception: db = {"stations": {}}
    for wid in STATIONS:
        rec = db["stations"].setdefault(str(wid), {})
        # نعيد آخر 4 أيام دائمًا (التقارير تتأخر)، والناقص من بداية الموسم بدفعات 20 يوم
        need = [since + dt.timedelta(days=i) for i in range((until - since).days + 1)]
        need = [d for d in need if d.isoformat() not in rec or d >= until - dt.timedelta(days=3)]
        while need:
            end = min(need[0] + dt.timedelta(days=19), until + dt.timedelta(days=1))
            got = fetch(wid, end, 20)
            if got:
                for k, v in got.items():
                    if since.isoformat() <= k <= until.isoformat(): rec[k] = round(v, 1)
            need = [d for d in need if d > end]
            time.sleep(3)
    json.dump(db, open(FILE, "w"), separators=(",", ":"), ensure_ascii=False)
    return db

def near(db, lat, lng, max_km=35):
    """مطر أقرب محطة خلال 35 كم: {يوم: ملم} أو None"""
    import math
    best = None
    for wid, (name, la, lo) in STATIONS.items():
        k = 6371 * 2 * math.asin(math.sqrt(math.sin(math.radians(la - lat) / 2) ** 2 + math.cos(math.radians(lat)) * math.cos(math.radians(la)) * math.sin(math.radians(lo - lng) / 2) ** 2))
        if k <= max_km and (best is None or k < best[0]): best = (k, wid, name)
    if not best: return None
    return best[2], db["stations"].get(str(best[1]), {})

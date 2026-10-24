# قراءة مطر الرادار اليومي المجمّع (radar_daily) — شبكة 0.2° من 16° إلى 32.5° شمال و34° إلى 56° شرق
# التشويش الثابت: خلية فيها صدى في أكثر من 60٪ من صور اليوم = تشويش (المطر ما يقعد كذا بالصحراء) → تنحسب صفر.
import json, base64, struct, urllib.request
SB = "https://penhpgvjtxytgyrhmetg.supabase.co"
KEY = "sb_publishable_WUbfRD9na71sHZ1rxFwImQ_JGzDOyXw"   # مفتاح عام (نفس اللي في التطبيق)، الجدول للقراءة فقط
LAT0, LNG0, STEP, ROWS, COLS, RS = 16.0, 34.0, 0.05, 330, 440, 4
RR, RC = -(-ROWS // RS), -(-COLS // RS)
CELL = STEP * RS

def load(since):
    req = urllib.request.Request(f"{SB}/rest/v1/radar_daily?select=day,acc,hits,frames&day=gte.{since}&order=day",
                                 headers={"apikey": KEY, "authorization": "Bearer " + KEY})
    out = {}
    try:
        with urllib.request.urlopen(req, timeout=60) as r: rows = json.load(r)
    except Exception as e:
        print("radar load failed", e); return out
    for row in rows:
        n = RR * RC
        acc = struct.unpack("<%dH" % n, base64.b64decode(row["acc"])[:2 * n].ljust(2 * n, b"\0"))
        hits = struct.unpack("<%dH" % n, base64.b64decode(row["hits"])[:2 * n].ljust(2 * n, b"\0"))
        fr = max(1, row["frames"])
        out[row["day"]] = {"acc": acc, "hits": hits, "frames": row["frames"], "clutter": [h > 0.6 * fr for h in hits]}
    return out

def mm_at(day_rec, lat, lng, radius_cells=1):
    """مطر الرادار (ملم) حول نقطة: متوسط الخلايا ضمن ~20 كم بعد استبعاد التشويش. None إذا اليوم ناقص صور كثير."""
    if not day_rec or day_rec["frames"] < 60: return None          # أقل من 10 ساعات تغطية = ما نعتمده
    i, j = int((lat - LAT0) / CELL), int((lng - LNG0) / CELL)
    vals = []
    for a in range(-radius_cells, radius_cells + 1):
        for b in range(-radius_cells, radius_cells + 1):
            y, x = i + a, j + b
            if 0 <= y < RR and 0 <= x < RC:
                k = y * RC + x
                if not day_rec["clutter"][k]: vals.append(day_rec["acc"][k] / 10)
    if not vals: return None
    # المتوسط مع وزن أعلى للخلية نفسها (العاصفة المحلية ما تُخفف كثير)
    centre = day_rec["acc"][i * RC + j] / 10 if 0 <= i < RR and 0 <= j < RC and not day_rec["clutter"][i * RC + j] else 0
    return round(0.5 * centre + 0.5 * sum(vals) / len(vals), 1)

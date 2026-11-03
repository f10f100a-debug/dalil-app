# تنقية مطر الرادار بمحطات الأرصاد (دراسة 1 نوفمبر 2026: القيصومة رادار 51 ملم والمحطة صفر 6 أيام، والجوف رادار 22 والمحطة 8)
# 1) صدى كاذب: محطة قالت «صفر» والرادار فوقها ≥3 ملم يومين ورا بعض → الرادار مو موثوق ضمن 100 كم منها ذاك اليوم.
# 2) المحطة تحكم: محطة خلال 35 كم عندها تقرير لليوم → صفر إذا قالت صفر، وإلا ما يتجاوز ضعف رقمها.
import math
import radar, synop

ECHO_KM, ECHO_MM, DRY = 100, 3.0, 0.2   # 3 نوفمبر: 300 كم شالت مطر حقيقي من فياض الشرقية والرياض

def km(a, b, c, d):
    return 6371 * 2 * math.asin(math.sqrt(math.sin(math.radians(c - a) / 2) ** 2 + math.cos(math.radians(a)) * math.cos(math.radians(c)) * math.sin(math.radians(d - b) / 2) ** 2))

class QC:
    def __init__(self, R, SY):
        self.R, self.st, self.bad = R, (SY or {}).get("stations", {}), {}
        import datetime as _dt
        def dry_wet(day, wid, la, lo):   # المحطة قالت صفر والرادار فوقها مطر؟
            g = self.st.get(str(wid), {}).get(day)
            v = radar.mm_at(R.get(day), la, lo) if day in R else None
            return g is not None and g <= DRY and v is not None and v >= ECHO_MM, v
        for day in R:
            for wid, (name, la, lo) in synop.STATIONS.items():
                hit, v = dry_wet(day, wid, la, lo)
                if not hit: continue
                # الصدى الكاذب يثبت في مكانه: لازم يتكرر يوم قبله أو بعده، والمطر الحقيقي العابر ما ينحسب صدى
                d0 = _dt.date.fromisoformat(day)
                if any(dry_wet((d0 + _dt.timedelta(days=k)).isoformat(), wid, la, lo)[0] for k in (-1, 1)):
                    self.bad.setdefault(day, []).append((la, lo, name, v))

    def radar(self, day, lat, lng):
        """(ملم أو None، السبب) — السبب 'echo' إذا انشال كصدى كاذب"""
        v = radar.mm_at(self.R.get(day), lat, lng)
        if v is None: return None, ""
        if v > 0 and any(km(lat, lng, la, lo) <= ECHO_KM for la, lo, _, _ in self.bad.get(day, [])): return 0.0, "echo"
        return v, "radar"

    def gauge(self, lat, lng, max_km=35):
        """(اسم المحطة، {يوم: ملم}) لأقرب محطة، أو None"""
        return synop.near({"stations": self.st}, lat, lng, max_km)

def cap(value, g):
    """قيمة اليوم بعد حكم المحطة"""
    if g is None: return value
    return 0.0 if g <= DRY else max(g, min(value, 2 * g))

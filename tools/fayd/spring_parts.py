"""أجزاء 2°×2° (محاذية لقطع ربع الدرجة) فيها فياض مسجلة — مناطق الربيع: الأساسي + الغرب + الجنوب"""
import json, os
S = json.load(open("data/fayd-sites.json")); P = [(s[1], s[2]) for s in S if s and s[0]]
one = os.environ.get("BBOX", "").strip()
if one: parts = [[float(x) for x in one.split(",")]]
else:
    parts = []
    for w, s, e, n in [(38, 24.5, 50, 32.5), (36, 24, 38, 32.5), (38, 19.5, 50.5, 24.5)]:
        la = s
        while la < n:
            lo = w
            while lo < e:
                b = [lo, la, min(lo + 2, e), min(la + 2, n)]
                if any(b[1] <= p[0] < b[3] and b[0] <= p[1] < b[2] for p in P): parts.append(b)
                lo += 2
            la += 2
print(json.dumps({"include": [{"i": k, "bbox": ",".join(str(x) for x in b)} for k, b in enumerate(parts)]}))

"""صورة القمر لأكثر 150 قطعة فيها ربيع حول الفياض المسماة (22 نوفمبر).
قبل: الترتيب بكمية الخضرة في القطعة كلها → جبال الحجاز أخذت أغلب الأماكن وأم قليب بدون صورة.
الحين: مجموع (متوسط + كثيف) في نافذة 600 م حول كل فيضة بالقطعة (من fayd-spr.json) — اللي الناس يدورونه.
python3 tools/fayd/spring_satpick.py <مجلد الطبقة>"""
import json, math, os, sys
from collections import Counter
D = sys.argv[1]; TOP = 150
S = json.load(open("data/fayd-sites.json")); F = json.load(open(f"{D}/fayd-spr.json"))["s"]
SX = json.load(open(f"{D}/sat.json")); CH = SX["ch"]
sc = Counter()
for k, v in F.items():
    s = S[int(k)]; sc[(round(math.floor(s[1] / CH) * CH, 2), round(math.floor(s[2] / CH) * CH, 2))] += v[1] + v[2]
key = lambda c: (round(c[0], 2), round(c[1], 2))
ch = sorted([c for c in SX["chunks"] if sc[key(c)] > 0], key=lambda c: -sc[key(c)])[:TOP]
keep = {f"{c[0]:.2f}_{c[1]:.2f}.webp" for c in ch}
for f in os.listdir(f"{D}/sat"):
    if f not in keep: os.remove(f"{D}/sat/{f}")
SX["chunks"] = sorted(ch); json.dump(SX, open(f"{D}/sat.json", "w"))
print(f"::notice::sat chunks {len(ch)} (of {len(sc)} with fayd spring)")

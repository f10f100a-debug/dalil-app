"""درجة كل فيضة من طبقة الربيع الدقيقة (21 نوفمبر): مربعات ~20 م حول مركز الفيضة (600 م)
→ fayd-spr.json: {"asof","gen","s": {رقم: [خفيف, متوسط, كثيف, شجيرات, كل المربعات]}}
python3 tools/fayd/spring_fayd.py <مجلد الطبقة>"""
import json, math, os, sys
import numpy as np
from PIL import Image
D = sys.argv[1]
IX = json.load(open(f"{D}/index.json")); RES, CH = IX["res"], IX["ch"]
PAL = {tuple(v[:3]): int(k) for k, v in IX["pal"].items()}
have = {(round(c[0], 2), round(c[1], 2)) for c in IX["chunks"]}
S = json.load(open("data/fayd-sites.json"))
cache = {}
def cls_img(key):
    if key not in cache:
        A = np.array(Image.open(f"{D}/{key[0]:.2f}_{key[1]:.2f}.png").convert("RGBA"))
        C = np.zeros(A.shape[:2], "uint8")
        for rgb, k in PAL.items(): C[(A[..., 3] > 0) & (np.abs(A[..., :3].astype(int) - rgb).sum(-1) < 12)] = k
        cache[key] = C
        if len(cache) > 60: cache.pop(next(iter(cache)))
    return cache[key]
out = {}
R = 600
for i, s in enumerate(S):
    if not s or not s[0]: continue
    la, lo = s[1], s[2]; dr = R / 111320 / RES; dc = dr / math.cos(math.radians(la))
    cnt = [0, 0, 0, 0]; tot = 0
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            k = (round(math.floor(la / CH) * CH + a * CH, 2), round(math.floor(lo / CH) * CH + b * CH, 2))
            n = int(round(CH / RES)); r0 = (k[0] + CH - la) / RES; c0 = (lo - k[1]) / RES
            rs, re_, cs, ce = max(0, int(r0 - dr)), min(n, int(r0 + dr) + 1), max(0, int(c0 - dc)), min(n, int(c0 + dc) + 1)
            if rs >= re_ or cs >= ce: continue
            tot += (re_ - rs) * (ce - cs)
            if k not in have: continue
            w = cls_img(k)[rs:re_, cs:ce]
            for c in (1, 2, 3, 4): cnt[c - 1] += int((w == c).sum())
    if sum(cnt): out[i] = cnt + [tot]
json.dump({"asof": IX["asof"], "gen": IX.get("gen"), "r": R, "s": out}, open(f"{D}/fayd-spr.json", "w"), separators=(",", ":"))
print(f"::notice::fayd-spr: {len(out)} fayd with layer cells")

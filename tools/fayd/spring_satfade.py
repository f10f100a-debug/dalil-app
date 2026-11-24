"""صورة القمر: أطراف المربعات تتلاشى بالتدريج (~1 كم) بدل الحد الحاد — 24 نوفمبر (أبو مالك: «ايش الفاصل»).
الصورة موجودة بس حول الفياض (مربعات 0.25°)، فالحد الحاد بين مربع فيه صورة ومربع ما فيه كان يبان كأنه فاصل أو خلل.
التلاشي بس على الجهة اللي جارها ما فيه صورة — بين مربعين فيهم صورة يبقى متصل بدون أي أثر.
يكتب الصورة بقناة شفافية (webp RGBA) — spring_tiles.py يقرأ الشفافية للبلاطات.
python3 tools/fayd/spring_satfade.py <مجلد الطبقة>"""
import json, os, sys
import numpy as np
from PIL import Image

D = sys.argv[1]; FADE_DEG = float(os.environ.get("SAT_FADE_DEG", "0.03"))   # ~3 كم (1 كم ما يبان من بعيد — الحد يبقى حاد)
SX = json.load(open(f"{D}/sat.json")); CH, RES = SX["ch"], SX["res"]
key = lambda a, b: (round(a, 2), round(b, 2))
HAVE = {key(c[0], c[1]) for c in SX["chunks"]}

def alpha(a, b, n):
    """قناع 0–1 للقطعة (a,b) = زاويتها الجنوبية الغربية. الصف 0 = الشمال"""
    F = FADE_DEG / RES
    i = np.arange(n) + .5
    dN, dS = i[:, None] * np.ones((1, n)), (n - i)[:, None] * np.ones((1, n))
    dW, dE = np.ones((n, 1)) * i[None, :], np.ones((n, 1)) * (n - i)[None, :]
    miss = lambda da, db: key(a + da * CH, b + db * CH) not in HAVE
    A = np.ones((n, n), "float32")
    for m, d in ((miss(1, 0), dN), (miss(-1, 0), dS), (miss(0, -1), dW), (miss(0, 1), dE)):
        if m: A = np.minimum(A, np.clip(d / F, 0, 1))
    for (da, db), (d1, d2) in (((1, -1), (dN, dW)), ((1, 1), (dN, dE)), ((-1, -1), (dS, dW)), ((-1, 1), (dS, dE))):
        if miss(da, db): A = np.minimum(A, np.clip(np.hypot(d1, d2) / F, 0, 1))   # زاوية: جارها القطري ما فيه صورة
    return A * A * (3 - 2 * A)   # smoothstep — تلاشي ناعم بدون خط

n_done = 0
for c in SX["chunks"]:
    a, b = key(c[0], c[1])
    if all(key(a + da * CH, b + db * CH) in HAVE for da in (-1, 0, 1) for db in (-1, 0, 1)): continue   # محاط بصور — ما يتغير
    p = f"{D}/sat/{a:.2f}_{b:.2f}.webp"
    if not os.path.exists(p): continue
    im = Image.open(p).convert("RGBA"); A = np.array(im)
    A[..., 3] = (A[..., 3].astype("float32") * alpha(a, b, A.shape[0])).round().astype("uint8")
    Image.fromarray(A, "RGBA").save(p, quality=80, method=4); n_done += 1
print(f"::notice::sat fade: {n_done} of {len(SX['chunks'])} chunks have soft edges")

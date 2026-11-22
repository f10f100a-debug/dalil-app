"""درجة ثقة «خضرة جديدة» (22 نوفمبر، أبو مالك: «هي واضحة بالأقمار، هل نحتاج تأكيد الميدان؟»)
القمر يشوف إنها خضراء بس ما يعرف وش هي — بدل «تحتاج تأكيد» لكل بقعة، نفحص كل وحدة:
  1) طبقة الربيع الدقيقة حولها (300 م): فيها ربيع (خفيف/متوسط/كثيف)؟ ولا شجيرات دائمة (بنفسجي)؟
     (الطبقة تقارن آخر صورة بوسيط الصيف → يعني «كانت جرداء بالصيف» + المسح الأسبوعي كشفها بصور ثانية = صورتين مستقلة)
  2) شكلها: دائري (محور زراعي) أو مستطيل مليان = مزرعة غالبًا
  3) مطر آخر 75 يوم (Open-Meteo) ≥ 3 ملم
→ يضيف لكل صف في data/fayd-new.json: [.., ثقة, السبب, الدرجة]
   ثقة 2 = ربيع واضح من القمر (بدون «تحتاج تأكيد») · 1 = تحتاج تأكيد (مع السبب) · 0 = شكلها مزرعة
python3 tools/fayd/newconf.py   (SPRING_DIR=مجلد محلي للطبقة بدل النت · NORAIN=1 بدون فحص المطر)"""
import io, json, math, os, urllib.request, urllib.parse
import numpy as np
from PIL import Image

RB = "https://raw.githubusercontent.com/f10f100a-debug/dalil-app/spring-data/"
SD = os.environ.get("SPRING_DIR")
UA = {"User-Agent": "dalil"}

def get(path):
    if SD: return open(os.path.join(SD, path), "rb").read()
    with urllib.request.urlopen(urllib.request.Request(RB + path, headers=UA), timeout=60) as r: return r.read()

IX = json.loads(get("index.json"))
CH, RES = IX["ch"], IX["res"]; N = int(round(CH / RES))
PAL = {int(k): tuple(v) for k, v in IX["pal"].items()}
KEYS = {(round(c[0], 2), round(c[1], 2)) for c in IX["chunks"]}
CACHE = {}

def chunk(a, b):
    k = (round(a, 2), round(b, 2))
    if k not in KEYS: return None
    if k not in CACHE:
        try:
            A = np.array(Image.open(io.BytesIO(get(f"{k[0]:.2f}_{k[1]:.2f}.png"))).convert("RGBA"))
            C = np.zeros(A.shape[:2], "uint8")
            key = (A[..., 0].astype("int32") << 16) | (A[..., 1].astype("int32") << 8) | A[..., 2]; key[A[..., 3] == 0] = -1
            for c, col in PAL.items(): C[key == ((col[0] << 16) | (col[1] << 8) | col[2])] = c
            CACHE[k] = C
        except Exception as e:
            print("chunk", k, e); CACHE[k] = None
    return CACHE[k]

def window(la, lo, half):
    """مصفوفة تصنيف حول النقطة (±half مربع) — تجمع من القطع المجاورة"""
    W = np.zeros((2 * half + 1, 2 * half + 1), "uint8")
    for i in range(-half, half + 1):
        for j in range(-half, half + 1):
            y, x = la - i * RES, lo + j * RES
            a, b = math.floor(y / CH) * CH, math.floor(x / CH) * CH
            C = chunk(a, b)
            if C is None: continue
            r, c = int((a + CH - y) / RES), int((x - b) / RES)
            if 0 <= r < N and 0 <= c < N: W[i + half, j + half] = C[r, c]
    return W

def shape(W):
    """أكبر بقعة ربيع متصلة قريبة من الوسط: الدائرية (4πA/P²) ونسبة تعبئة المستطيل"""
    S = (W >= 1) & (W <= 3); h = W.shape[0] // 2
    ys, xs = np.nonzero(S)
    if not len(ys): return 0, 0, 0
    d = (ys - h) ** 2 + (xs - h) ** 2; s0 = (ys[d.argmin()], xs[d.argmin()])
    if d.min() > 15 ** 2: return 0, 0, 0
    seen = np.zeros_like(S); st = [s0]; seen[s0] = 1; pts = []
    while st:
        y, x = st.pop(); pts.append((y, x))
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if 0 <= ny < S.shape[0] and 0 <= nx < S.shape[1] and S[ny, nx] and not seen[ny, nx]: seen[ny, nx] = 1; st.append((ny, nx))
    A = len(pts); M = seen.astype(bool)
    P = int((M[:, 1:] != M[:, :-1]).sum() + (M[1:, :] != M[:-1, :]).sum() + M[0, :].sum() + M[-1, :].sum() + M[:, 0].sum() + M[:, -1].sum())
    py, px = zip(*pts); bb = (max(py) - min(py) + 1) * (max(px) - min(px) + 1)
    return A, 4 * math.pi * A / max(P, 1) ** 2, A / bb

def rain(pts):
    out = {}
    if os.environ.get("NORAIN"): return out
    for k in range(0, len(pts), 80):
        part = pts[k:k + 80]
        q = urllib.parse.urlencode({"latitude": ",".join(str(p[0]) for p in part), "longitude": ",".join(str(p[1]) for p in part),
                                    "daily": "precipitation_sum", "past_days": 75, "forecast_days": 1, "timezone": "Asia/Riyadh"})
        try:
            with urllib.request.urlopen(urllib.request.Request("https://api.open-meteo.com/v1/forecast?" + q, headers=UA), timeout=120) as r: j = json.load(r)
            for i, loc in enumerate(j if isinstance(j, list) else [j]): out[k + i] = sum(v or 0 for v in loc["daily"]["precipitation_sum"])
        except Exception as e: print("rain", e)
    return out

D = json.load(open("data/fayd-new.json")); rows = D["rows"]
R = rain([(r[0], r[1]) for r in rows])
stat = {}
for i, r in enumerate(rows):
    r[:] = r[:6]
    W = window(r[0], r[1], 15)                      # 300 م
    n1, n2, n3, n4 = (int((W == v).sum()) for v in (1, 2, 3, 4)); sp = n1 + n2 + n3; tot = W.size
    lv = 3 if n3 / tot >= .05 else 2 if (n2 + n3) / tot >= .04 else 1 if sp >= 5 else 0
    A, circ, fill = shape(window(r[0], r[1], 40))   # 800 م للشكل
    mm = R.get(i)
    # دائرة بالبكسلات: 4πA/P² ≈ π²/16 ≈ 0.62 وتعبئة مربعها ≈ π/4 ≈ 0.79 · المستطيل: ≈ 0.79 وتعبئة ≈ 1 · الروضة الطبيعية متعرجة (≈ 0.03–0.4)
    farm = (circ >= .55 and .7 <= fill <= .86 and 150 <= A <= 4000) or (circ >= .5 and fill >= .9 and A >= 60)
    if farm: c, why = 0, "farm"
    elif sp < 5: c, why = 1, "nolayer" if n4 < 5 else "shrub"
    elif n4 > sp: c, why = 1, "shrub"
    elif mm is not None and mm < 3: c, why = 1, "norain"
    elif lv >= 2: c, why = 2, ""
    else: c, why = 1, "light"
    r += [c, why, lv]; stat[(c, why)] = stat.get((c, why), 0) + 1
json.dump(D, open("data/fayd-new.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("::notice::new-green confidence: " + " · ".join(f"{k[0]}{('/' + k[1]) if k[1] else ''}={v}" for k, v in sorted(stat.items())), flush=True)

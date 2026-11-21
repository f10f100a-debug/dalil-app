"""18 نوفمبر (فياض مريحات): حماية الفياض من خضرة المزارع حولها.
1) فيضة جنبها (≤5 كم) فيضة بنفس الاسم مستبعدة كمزارع → تُستبعد معها (نفس المكان، المحاور حولها).
2) فيضة فيها زراعة 10٪ فأكثر (من 21 نوفمبر: حتى الثلث فأكثر ما تنشال) (WorldCover) أو جنبها (≤3 كم) فيضة مستبعدة كمزارع → تبقى ظاهرة بس «حولها مزارع — تحتاج تأكيد» (check=8)
   بدون تنبيه وبرا «وين أطلع» (st=1)، لين يأكدها بلاغ من الميدان.
تشغيل مستقل: python3 tools/fayd/farmguard.py  → يطبّقها على data/fayd.json الحالي."""
import json, math, re

def _base(n):
    return re.sub(r"^(فياض|فيضة|روضة|روضه|خبراء|خبرا|قاع)\s+", "", n.strip())

def _km(a, b):
    la = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[1] - b[1]) * 111, (a[2] - b[2]) * 111 * math.cos(la))

def guard(rows, farm, SITES, CROP):
    fs = set(farm); out = []; gone = []; marked = []
    for r in rows:
        i = r[0]; s = SITES[i]
        if r[2] > 0 and r[5] != 5:
            near = [f for f in fs if f != i and abs(SITES[f][1] - s[1]) < .06 and abs(SITES[f][2] - s[2]) < .07]
            if any(_base(SITES[f][0]) == _base(s[0]) and _km(SITES[f], s) <= 5 for f in near):
                farm.append(i); gone.append(s[0] + " (" + s[3] + ")"); continue
            c = CROP.get(str(i), 0)
            if c >= 10 or any(_km(SITES[f], s) <= 3 for f in near):
                r[2] = 1; r[5] = r[5] or 8; marked.append(f"{s[0]} ({s[3]}) زراعة {c}٪")
        out.append(r)
    rows[:] = out
    return gone, marked

if __name__ == "__main__":
    SITES = json.load(open("data/fayd-sites.json"))
    CROP = json.load(open("data/fayd-crop.json"))["crop"]
    j = json.load(open("data/fayd.json"))
    gone, marked = guard(j["rows"], j["farm"], SITES, CROP)
    print("استُبعدت:", gone); print("حولها مزارع:", marked)
    json.dump(j, open("data/fayd.json", "w"), separators=(",", ":"))

# يبني data/birds.json للتطبيق من نتائج الدراسة (tools/birds/data/*.json — أرشيف GBIF يوم بيوم).
# لكل طير ونطاق (north: شمال 27°، all: المملكة والخليج): نوافذ العبور (10–90٪ من المشاهدات) والذروة (متوسط 15 يوم)،
# وتوزيع الأشهر (للشريط)، وعدد المشاهدات والسنوات (للثقة).
import json
F = json.load(open("tools/birds/data/birds_full.json")); Q = json.load(open("tools/birds/data/birds_qata.json"))
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
def window(doy, a, b, top=0.9):
    idx = list(range(a, b + 1)) if a <= b else list(range(a, 365)) + list(range(0, b + 1))
    s = sum(doy[i] for i in idx)
    if s < 15: return None
    c = 0; lo = hi = None
    for i in idx:
        c += doy[i]
        if lo is None and c >= 0.1 * s: lo = i
        if hi is None and c >= top * s: hi = i
    sm = [sum(doy[(i + k) % 365] for k in range(-7, 8)) for i in idx]
    pk = idx[max(range(len(sm)), key=lambda j: sm[j])]
    return [lo, hi, pk, s]
def months(doy):
    out = []; i = 0
    for m in range(12): out.append(sum(doy[i:i + DAYS[m]])); i += DAYS[m]
    t = sum(out) or 1
    return [round(x / t * 100) for x in out]
# العابرة: نهاية العبور = 85٪ من المشاهدات (الذيل الأخير متأخرات قليلة متفرقة)، والمشتّية 90٪
def scope(o, kind="pass"):
    doy = o["doy"]; yrs = sum(1 for c in o["years"].values() if c >= 3); top = 0.85 if kind == "pass" else 0.9
    return {"n": o["n"], "years": yrs, "months": months(doy), "aut": window(doy, 212, 364, top), "spr": window(doy, 31, 151, top), "win": window(doy, 305, 59)}
KIND = {"السمان": "pass", "الدخل": "pass", "الصفار": "pass", "القميري": "pass", "الجرجس": "winter", "البط": "winter", "الوز": "winter"}
SCI = {"السمان": "Coturnix coturnix", "الدخل": "Sylvia borin · Curruca communis · Phylloscopus trochilus", "الصفار": "Oriolus oriolus", "القميري": "Streptopelia turtur",
       "الجرجس": "Melanocorypha calandra · bimaculata", "البط": "Anas crecca · acuta · Spatula clypeata · Mareca · Aythya", "الوز": "Anser"}
NOTE = {"البط": "عند السدود والبحيرات وبحيرات الصرف والسواحل", "الوز": "قليل، ويتركز عند المسطحات المائية",
        "الجرجس": "في السهول والمزارع المفتوحة", "القميري": "", "السمان": "", "الدخل": "", "الصفار": ""}
# الأنواع المختارة لكل مجموعة (من الحساب لكل نوع birds_species.json): نستبعد الأنواع المشتّية/المقيمة عشان ما تخرب مواعيد العبور
#  الدخل: العابرة فقط (ودخلة الأشجار المخططة Curruca nisoria مستبعدة لأن مشاهداتها بنوفمبر غير منطقية) — نستبعد النقشارة وأبو قلنسوة والدخلة البيضاء الصغيرة وغيرها لأنها تشتّي عندنا
#  البط: زوار الشتاء — نستبعد البلبول (الخضاري) المقيم/الأليف، والحمراوي (Aythya nyroca) المقيم، والحذاف الصيفي العابر
SP = json.load(open("tools/birds/data/birds_species.json"))
PICK = {"الدخل": ["Sylvia borin", "Curruca communis", "Phylloscopus trochilus", "Phylloscopus sibilatrix"],
        "البط": ["Anas crecca", "Anas acuta", "Spatula clypeata", "Mareca penelope", "Mareca strepera", "Aythya ferina", "Aythya fuligula"],
        "الوز": ["Anser anser", "Anser albifrons", "Anser erythropus"],
        "الجرجس": ["Melanocorypha calandra", "Melanocorypha bimaculata"]}
def merged(ar):
    if ar not in PICK: return F[ar]
    o = {}
    for sc in ("north", "all"):
        doy = [0] * 365; years = {}
        for nm in PICK[ar]:
            v = SP[ar][nm][sc]
            for i, c in enumerate(v["doy"]): doy[i] += c
            for y, c in v["years"].items(): years[y] = years.get(y, 0) + c
        o[sc] = {"doy": doy, "n": sum(doy), "years": years}
    return o
birds = []
for ar, kind in KIND.items():
    o = merged(ar)
    birds.append({"id": ar, "kind": kind, "sci": SCI[ar], "note": NOTE[ar], "protected": ar == "القميري",
                  "north": scope(o["north"], kind), "all": scope(o["all"], kind)})
# القطا: مقيم — توزيع الأشهر لكل الأنواع مجتمعة + قائمة الأنواع
qd = [0] * 365; qn = 0; types = []
AR = {"القطا النبطاء (الخطاف)": "النبطاء (الخطاف)", "القطا كستنائي البطن": "كستنائي البطن", "القطا المخطط": "المخطط", "القطا المرقط": "المرقط",
      "القطا أسود البطن (الجونية)": "الجوني", "القطا المتوج": "المتوج"}
for k, o in Q.items():
    for i, c in enumerate(o["all"]["doy"]): qd[i] += c
    types.append({"name": AR.get(k, k), "sci": o["sci"], "n": o["all"]["n"]})
types.sort(key=lambda t: -t["n"])
birds.append({"id": "القطا", "kind": "resident", "sci": "Pterocles", "note": "يتنقّل حسب الماء والمطر، ويرد الموارد الصبح", "protected": False,
              "types": types, "all": {"n": sum(qd), "years": 40, "months": months(qd)}, "north": {"n": sum(o["north"]["n"] for o in Q.values()), "years": 4, "months": months(qd)}})
json.dump({"v": 1, "src": "GBIF.org", "birds": birds}, open("data/birds.json", "w"), ensure_ascii=False, separators=(",", ":"))
for b in birds:
    for sc in ("north", "all"):
        s = b[sc]; print(b["id"], sc, s["n"], s["years"], s.get("aut"), s.get("spr"), s.get("win"))

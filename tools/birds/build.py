# يبني data/birds.json للتطبيق من نتائج الدراسة (tools/birds/data/*.json — أرشيف GBIF يوم بيوم).
# لكل طير ونطاق (north: شمال 27°، all: المملكة والخليج): نوافذ العبور (10–90٪ من المشاهدات) والذروة (متوسط 15 يوم)،
# وتوزيع الأشهر (للشريط)، وعدد المشاهدات والسنوات (للثقة).
import json
F = json.load(open("tools/birds/data/birds_full.json")); Q = json.load(open("tools/birds/data/birds_qata.json"))
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
def window(doy, a, b):
    idx = list(range(a, b + 1)) if a <= b else list(range(a, 365)) + list(range(0, b + 1))
    s = sum(doy[i] for i in idx)
    if s < 15: return None
    c = 0; lo = hi = None
    for i in idx:
        c += doy[i]
        if lo is None and c >= 0.1 * s: lo = i
        if hi is None and c >= 0.9 * s: hi = i
    sm = [sum(doy[(i + k) % 365] for k in range(-7, 8)) for i in idx]
    pk = idx[max(range(len(sm)), key=lambda j: sm[j])]
    return [lo, hi, pk, s]
def months(doy):
    out = []; i = 0
    for m in range(12): out.append(sum(doy[i:i + DAYS[m]])); i += DAYS[m]
    t = sum(out) or 1
    return [round(x / t * 100) for x in out]
def scope(o):
    doy = o["doy"]; yrs = sum(1 for c in o["years"].values() if c >= 3)
    return {"n": o["n"], "years": yrs, "months": months(doy), "aut": window(doy, 212, 364), "spr": window(doy, 31, 151), "win": window(doy, 305, 59)}
KIND = {"السمان": "pass", "الدخل": "pass", "الصفار": "pass", "القميري": "pass", "الجرجس": "winter", "البط": "winter", "الوز": "winter"}
SCI = {"السمان": "Coturnix coturnix", "الدخل": "Sylvia · Curruca · Phylloscopus", "الصفار": "Oriolus oriolus", "القميري": "Streptopelia turtur",
       "الجرجس": "Melanocorypha calandra · bimaculata", "البط": "Anas · Spatula · Mareca · Aythya", "الوز": "Anser"}
NOTE = {"البط": "عند السدود والبحيرات وبحيرات الصرف والسواحل", "الوز": "قليل، ويتركز عند المسطحات المائية",
        "الجرجس": "في السهول والمزارع المفتوحة", "القميري": "", "السمان": "", "الدخل": "", "الصفار": ""}
birds = []
for ar, kind in KIND.items():
    o = F[ar]
    birds.append({"id": ar, "kind": kind, "sci": SCI[ar], "note": NOTE[ar], "protected": ar == "القميري",
                  "north": scope(o["north"]), "all": scope(o["all"])})
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

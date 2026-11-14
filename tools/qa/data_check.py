"""فحص البيانات اليومي (14 نوفمبر): يمسك اللي يفوت قبل ما يشوفه الناس —
بيانات قديمة (مسح مجدول ما اشتغل: 14 نوفمبر مسح السبت ما اشتغل)، فيضة «مثل المعتاد» ونسبتها تحت 20٪،
فياض كثيرة على صورة قديمة، وتغيّر جماعي محجوز. يكتب data/data-qa.md إذا فيه شي (وينبّه جوال المطوّر)، ويحذفه إذا كله سليم."""
import json, datetime as dt, os, sys
today = dt.date.today(); probs = []
def age(s):
    try: return (today - dt.date.fromisoformat(str(s)[:10])).days
    except Exception: return 999
def load(f):
    try: return json.load(open(f))
    except Exception as e: probs.append(f"{f}: ما انقرأ ({e})"); return None
F = load("data/fayd.json")
if F:
    if age(F.get("asof")) > 6: probs.append(f"الفياض: أحدث صورة {F.get('asof')} (عمرها {age(F.get('asof'))} يوم) — التحديث اليومي ما اشتغل؟")
    bad = [r for r in F["rows"] if r[2] >= 2 and r[5] != 5 and (r[3] or 0) < 20 and r[4] == 1]
    if bad: probs.append(f"الفياض: {len(bad)} فيضة درجتها «مثل المعتاد» أو أعلى ونسبتها تحت 20٪ (رقم الموقع: {', '.join(str(r[0]) for r in bad[:8])})")
    old = [r for r in F["rows"] if r[2] > 0 and age(r[6]) > 10]
    if len(old) >= 5: probs.append(f"الفياض: {len(old)} فيضة خضراء صورتها أقدم من 10 أيام")
N = load("data/fayd-new.json")
if N and age(N.get("made") or N.get("asof")) > 8: probs.append(f"الفياض بدون اسم: آخر مسح {N.get('made')} — مسح السبت ما اشتغل؟")
Q = load("data/fq.json")
if Q and age(Q.get("asof")) > 2: probs.append(f"مؤشر الفقع: آخر تحديث {Q.get('asof')}")
W = load("data/rain-week.json")
if W and age(W.get("at")) > 1: probs.append(f"مطر الأسبوع: آخر تحديث {W.get('at')}")
if os.path.exists("data/fayd-pending.json"): probs.append("الفياض: فيه تحديث محجوز للمراجعة (data/fayd-pending.json)")
if probs:
    open("data/data-qa.md", "w").write(f"فحص البيانات {today}: {len(probs)} ملاحظة — {probs[0][:90]}\n\n" + "\n".join("- " + p for p in probs) + "\n")
    print("\n".join(probs)); sys.exit(1)
if os.path.exists("data/data-qa.md"): os.remove("data/data-qa.md")
print("data ok")

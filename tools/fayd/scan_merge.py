"""20 نوفمبر: دمج أجزاء المسح الأسبوعي (الأساسي + الغرب: تبوك والعلا + الجنوب: المدينة ووادي الدواسر) → data/fayd-new.json
كل جزء يشتغل بوظيفة لحاله (المسح الكامل يتعدى ساعتين). نشيل المكرر بين الأجزاء (خلال 2 كم: نخلي الأكبر)،
ونفس حماية النشر القديمة: إذا العدد تغيّر أكثر من النص → ملف انتظار + تنبيه للمطوّر."""
import glob, json, math, sys, datetime as dtm

def km(a, b): return math.hypot((a[0] - b[0]) * 111.2, (a[1] - b[1]) * 111.2 * math.cos(math.radians(a[0])))
parts = sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].endswith('*') else "parts/**/part-*.json", recursive=True))
mode = [a for a in sys.argv[1:] if not a.endswith('*')]
if not parts: sys.exit("no parts")
rows, asof, names = [], "", []
for f in parts:
    d = json.load(open(f)); names.append(f"{f.split('/')[-1]}:{d['n']}")
    rows += d["rows"]; asof = max(asof, d.get("asof", ""))
rows.sort(key=lambda r: -r[2] * r[3])
out = []
for r in rows:
    if any(km(r, q) < 2 for q in out): continue
    out.append(r)
print(f"::notice::merged {' '.join(names)} → {len(out)}", flush=True)
if not any("part-main" in f for f in parts): sys.exit("main part missing — not publishing")
res = {"asof": asof, "made": dtm.date.today().isoformat(), "n": len(out), "rows": out}
try: prev = json.load(open("data/fayd-new.json"))
except Exception: prev = None
pn = prev["n"] if prev else 0
held = "publish" not in mode and (prev is None or (max(pn, len(out)) >= 10 and abs(len(out) - pn) > 0.5 * max(pn, 1)))
fn = "data/fayd-new-pending.json" if held else "data/fayd-new.json"
json.dump(res, open(fn, "w"), ensure_ascii=False, separators=(",", ":"))
if held:
    open("data/fayd-new-qa.md", "w").write(f"فياض بدون اسم {asof}: العدد {pn} → {len(out)} — انحفظ في {fn} للمراجعة.\n\n" + "\n".join(f"- {r[4]} · {r[2]} هكتار خضراء · {r[3]}% من أرضها · {r[0]},{r[1]}" for r in out[:80]))
print(f"::notice::new green patches {len(out)} → {fn}", flush=True)

# يبني guide/dalil-guide.pdf: python3 tools/guide/build.py <مجلد اللقطات والخطوط> <ملف HTML الناتج>
import sys, os, html, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("content", os.path.join(here, "content.py")); C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)
src, out = sys.argv[1], sys.argv[2]
AR = "٠١٢٣٤٥٦٧٨٩"; ar = lambda n: "".join(AR[int(d)] for d in str(n))
e = html.escape
css = f"""
@font-face{{font-family:N;src:url('fonts/NotoNaskhArabic-Regular.ttf')}}
@font-face{{font-family:N;font-weight:700;src:url('fonts/NotoNaskhArabic-Bold.ttf')}}
@font-face{{font-family:N;font-weight:600;src:url('fonts/NotoNaskhArabic-SemiBold.ttf')}}
@page{{size:A4;margin:0}}
*{{box-sizing:border-box}} body{{margin:0;font-family:N,"Noto Color Emoji",sans-serif;color:#2A241C;direction:rtl}}
.pg{{width:210mm;height:297mm;padding:14mm 13mm;page-break-after:always;position:relative;overflow:hidden;background:#FBF8F2}}
.cover{{background:linear-gradient(170deg,#F6EEDD,#EADBBE);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}}
.cover img{{width:46mm;border-radius:10mm;box-shadow:0 6px 20px #0003}} .cover h1{{font-size:44pt;margin:14mm 0 2mm}} .cover h2{{font-size:20pt;color:#8A6A3A;font-weight:600;margin:0}}
.pill{{display:inline-block;margin-top:9mm;background:#fff;border-radius:99px;padding:2mm 7mm;font-size:12pt}} .by{{margin-top:12mm;color:#6b5d48;font-size:11pt}}
.toc h1{{font-size:24pt;color:#8A6A3A;border-bottom:2px solid #E2CFA8;padding-bottom:3mm}} .toc .c{{margin:5mm 0;font-size:14pt;font-weight:700}} .toc .s{{font-size:10pt;color:#7a6b55;font-weight:400;margin-top:1mm;line-height:1.7}}
.chap{{background:#C8964E;color:#fff;border-radius:5mm;padding:4mm 6mm;display:flex;align-items:center;gap:4mm;font-size:20pt;font-weight:700;margin-bottom:5mm}}
.chap .n{{width:12mm;height:12mm;border-radius:50%;background:#2A241C;display:grid;place-items:center;font-size:16pt}}
.card{{background:#fff;border:1px solid #E8DCC6;border-radius:5mm;padding:6mm}}
.card h3{{margin:0;font-size:17pt;color:#8A5A1A;display:flex;align-items:center;gap:3mm}} .b{{font-size:9pt;color:#fff;background:#2F7D4A;border-radius:99px;padding:.6mm 3mm;font-weight:600}} .b.m{{background:#C8964E}}
.intro{{color:#6b5d48;font-size:11pt;margin:2mm 0 5mm;line-height:1.7}}
.row{{display:flex;gap:7mm;align-items:flex-start}} .shot{{flex:0 0 66mm}} .shot img{{width:66mm;border-radius:6mm;border:1px solid #ddd;box-shadow:0 3px 12px #0002}}
ol{{margin:0;padding:0;list-style:none;flex:1}} li{{display:flex;gap:3mm;margin-bottom:4mm;font-size:11pt;line-height:1.65}}
li .k{{flex:0 0 7mm;height:7mm;border-radius:50%;background:#2A241C;color:#E8C48A;display:grid;place-items:center;font-size:9.5pt;font-weight:700}} li b{{display:block;font-size:11.5pt}}
.tip{{margin-top:5mm;background:#FFF6DD;border:1px solid #F0D99A;border-radius:4mm;padding:3mm 4mm;font-size:10.5pt;line-height:1.7}}
.foot{{position:absolute;bottom:7mm;left:13mm;right:13mm;display:flex;justify-content:space-between;font-size:8.5pt;color:#a08f74}}
.info li{{display:block}}
"""
pages = [f"""<div class="pg cover"><img src="icon.png"><h1>دليل المستخدم</h1><h2>دليل — بوصلة البر</h2><div class="pill">آخر تحديث: {e(C.UPDATED)}</div><div class="by">تصميم وتطوير: أبو مالك اللهيبي</div></div>"""]
toc = "".join(f'<div class="c">{ar(i+1)}. {e(t)}<div class="s">{" · ".join(e(s["t"]) for s in secs)}</div></div>' for i, (t, secs) in enumerate(C.CH))
pages.append(f'<div class="pg toc"><h1>المحتويات</h1>{toc}</div>')
pno = 3
for ci, (ct, secs) in enumerate(C.CH):
    for si, s in enumerate(secs):
        img = s["img"] + ".png"
        if not os.path.exists(os.path.join(src, img)): print("missing", img); 
        badge = f'<span class="b{" m" if s["b"] == "محسّن" else ""}">{e(s["b"])}</span>' if s.get("b") else ""
        items = "".join(f'<li><span class="k">{ar(k+1)}</span><span><b>{e(a)}</b>{e(d)}</span></li>' for k, (a, d) in enumerate(s["items"]))
        tip = f'<div class="tip">💡 {e(s["tip"])}</div>' if s.get("tip") else ""
        chap = f'<div class="chap"><span class="n">{ar(ci+1)}</span>{e(ct)}</div>' if si == 0 else ""
        pages.append(f'<div class="pg">{chap}<div class="card"><h3>{e(s["t"])} {badge}</h3><div class="intro">{e(s["intro"])}</div><div class="row"><div class="shot"><img src="{img}"></div><ol>{items}</ol></div>{tip}</div><div class="foot"><span>دليل — بوصلة البر · دليل المستخدم</span><span>{ar(pno)}</span></div></div>')
        pno += 1
info = """<div class="pg"><div class="chap"><span class="n">ℹ</span>معلومات عامة</div><div class="card info"><ol>
<li><b>التطبيق</b>دليل - بوصلة البر. مجاني بالكامل وبدون تسجيل حساب.</li>
<li><b>وين تلقاه</b>الآيفون من App Store، ومن المتصفح على أي جوال: f10f100a-debug.github.io/dalil-app — وتقدر تضيفه للشاشة الرئيسية.</li>
<li><b>الخصوصية</b>موقعك ما يُحفظ عندنا. أماكنك في جوالك. مواقع الغرفة تنتقل بين الأعضاء ولا تُخزَّن، والرسائل الصوتية تنحذف بعد ساعة.</li>
<li><b>الدعم والاقتراحات</b>dalilbarr.app@gmail.com</li>
<li><b>المصادر</b>الرادار: RainViewer · الطقس: Open-Meteo · المحطات: Ogimet · الأقمار: NASA وSentinel‑2 · الخرائط: OpenStreetMap وCopernicus DEM.</li>
</ol><div class="tip">⚠️ الطقس والرادار والفقع تقديرات تساعدك تقرر، والإنذارات الرسمية من المركز الوطني للأرصاد.</div></div></div>"""
pages.append(info)
open(out, "w").write(f'<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>دليل المستخدم — دليل بوصلة البر</title><style>{css}</style></head><body>{"".join(pages)}</body></html>')
print("pages", len(pages))

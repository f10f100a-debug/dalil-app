# تجربة: مقياس المطر الفعلي من محطات الأرصاد السعودية (تقارير SYNOP عبر OGIMET) لأكتوبر
import urllib.request, re, time, collections
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
def get(u):
    for t in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120) as r: return r.read().decode("latin1")
        except Exception as e: print("retry", str(e)[:80], flush=True); time.sleep(30)
    return ""
txt = ""
for a, b in [("202610010000", "202610102359"), ("202610110000", "202610202359"), ("202610210000", "202610302359")]:
    t = get(f"https://www.ogimet.com/cgi-bin/getsynop?block=40&begin={a}&end={b}"); print("chunk", a, len(t), t[:150].replace("\n", " | ") if len(t) < 400 else "", flush=True); txt += t; time.sleep(20)
st = collections.defaultdict(list)
for line in txt.splitlines():
    p = line.split(",")
    if len(p) < 7 or not p[0].isdigit(): continue
    wmo, y, m, d, h = p[0], p[1], p[2], p[3], p[4]; rep = p[6] if len(p) > 6 else ""
    st[wmo].append((f"{y}-{m}-{d} {h}", rep.strip()))
print("stations", len(st), flush=True)
for wmo in sorted(st):
    rows = st[wmo]
    hits = []
    for t, rep in rows:
        g = rep.replace("=", "").split()
        # القسم 1: 6RRRt بعد مجموعة الضغط؛ القسم 333: 7RRRR (24 ساعة)
        try: k = g.index("AAXX") if "AAXX" in g else -1
        except: k = -1
        sec1 = g[:g.index("333")] if "333" in g else g
        sec3 = g[g.index("333")+1:] if "333" in g else []
        r6 = [x for x in sec1[4:] if re.fullmatch(r"6\d{3}[0-9/]", x)]
        r24 = [x for x in sec3 if re.fullmatch(r"7\d{4}", x)]
        ww = [x for x in sec1[4:] if re.fullmatch(r"7\d{4}", x) or re.fullmatch(r"7\d\d//", x)]
        if r6 or r24: hits.append(f"{t} {' '.join(r6 + ['24h:' + x for x in r24])}")
    print("ST", wmo, "reports", len(rows), "with-rain-groups", len(hits))
    for h in hits[:40]: print("   ", h)

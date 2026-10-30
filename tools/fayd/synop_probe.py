# فحص مؤقت: مطر محطات الأرصاد الأرضية (SYNOP عبر Ogimet) للشمال، أكتوبر 2026
import re, time, urllib.request, html
IDS = [40356, 40357, 40360, 40361, 40362, 40373, 40375, 40377, 40394, 40405, 40372, 40363, 40366, 40400, 40368]
res = []
for wid in IDS:
    out = []; name = "?"; n = 0
    for day in (30, 11):
        u = f"https://www.ogimet.com/cgi-bin/gsynres?ind={wid}&ndays=20&ano=2026&mes=10&day={day}&hora=18&lang=en&decoded=yes"
        try:
            t = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "dalil-app/1.0"}), timeout=60).read().decode("latin-1")
        except Exception as e:
            out.append("ERR" + str(e)[:40]); continue
        m = re.search(r"<B>([^<]*)\(Saudi Arabia\)", t, re.I) or re.search(r"([A-Za-z' -]+)\(Saudi Arabia\)", t)
        if m: name = m.group(1).strip()
        n += len(t)
        txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", t)))
        for d, h, p in re.findall(r"(\d\d/\d\d/2026) (\d\d:\d\d)((?:(?!\d\d/\d\d/2026).){0,600})", txt, re.S):
            q = re.findall(r"(\d+\.\d|Tr)/(\d+)h", p)
            for v, per in q:
                if v != "0.0": out.append(f"{d[3:5]}/{d[:2]} {h[:2]}Z {v}/{per}h")
        time.sleep(3)
    res.append(f"{wid} {name}[{n}]: " + (" ".join(sorted(set(out))) or "no rain"))
print("::notice::" + " || ".join(res[:8])); print("::notice::" + " || ".join(res[8:]))

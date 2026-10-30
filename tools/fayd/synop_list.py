# فحص مؤقت: كل محطات السعودية اللي ترسل SYNOP + إحداثياتها + هل فيها مطر
import sys, os, csv, io, urllib.request, collections
sys.path.insert(0, os.path.dirname(__file__)); import synop
UA = {"User-Agent": "dalil-app/1.0"}
t = urllib.request.urlopen(urllib.request.Request("https://www.ogimet.com/cgi-bin/getsynop?state=Saud&begin=202610010000&end=202610302359", headers=UA), timeout=120).read().decode("latin-1")
cnt = collections.Counter(); grp = collections.Counter(); wet = collections.Counter(); tot = collections.Counter()
for line in t.splitlines():
    f = line.split(",", 6)
    if len(f) < 7: continue
    cnt[f[0]] += 1
    if f[4] in ("00", "12"):
        v = synop.rain12(f[6])
        if v is not None: grp[f[0]] += 1; tot[f[0]] += v; wet[f[0]] += v > 0
coords = {}
try:
    h = urllib.request.urlopen(urllib.request.Request("https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv", headers=UA), timeout=120).read().decode("latin-1")
    for r in csv.reader(io.StringIO(h)):
        if len(r) > 7 and r[3] == "SA" and r[0][:5].isdigit(): coords[r[0][:5]] = (r[2], r[6], r[7])
except Exception as e: print("::warning::isd", e)
rows = [f"{k} {coords.get(k, ('?', '', ''))[0][:18]} {coords.get(k, ('', '?', '?'))[1]},{coords.get(k, ('', '?', '?'))[2]} n={cnt[k]} rr={grp[k]} wet={wet[k]} tot={tot[k]:.0f}" for k in sorted(cnt)]
print(f"::notice::{len(rows)} stations, bytes {len(t)}")
for i in range(0, len(rows), 12): print("::notice::" + " || ".join(rows[i:i + 12]))

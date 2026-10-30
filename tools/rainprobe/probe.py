# تجربة: تقارير SYNOP الخام لمحطات السعودية (403xx–41xxx) لأكتوبر عبر OGIMET
import urllib.request, time
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
def get(u):
    for t in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120) as r: return r.read().decode("latin1")
        except Exception as e: print("retry", str(e)[:80], flush=True); time.sleep(30)
    return ""
out = []
for blk in ("40", "41"):
    for a, b in [("202610010000", "202610102359"), ("202610110000", "202610202359"), ("202610210000", "202610302359")]:
        t = get(f"https://www.ogimet.com/cgi-bin/getsynop?block={blk}&begin={a}&end={b}"); time.sleep(20)
        out += [l for l in t.splitlines() if l[:3] in ("403", "404", "410", "411") and l[:5] >= "40350"]
open("synop_sa.txt", "w").write("\n".join(out)); print("lines", len(out))

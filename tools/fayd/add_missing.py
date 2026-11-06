"""يضيف الفياض الناقصة (data/fayd-missing.json) لآخر data/fayd-sites.json — الأرقام القديمة ما تتغير (المتابَعة والتنبيهات مربوطة فيها).
يستبعد الهجر والمزارع والمكرر. المنطقة مبدئيًا من الشبكة، وcheck_regions.py fix يصححها بالحدود الرسمية."""
import json, math, sys
S = json.load(open("data/fayd-sites.json")); M = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "data/fayd-missing.json"))["rows"]
G = json.load(open("data/region-grid.json"))
def reg(la, lo):
    i = int((la - G["lat0"]) // G["r"]); j = int((lo - G["lng0"]) // G["r"])
    if i < 0 or j < 0 or i >= G["rows"] or j >= G["cols"]: return ""
    c = ord(G["g"][i * G["cols"] + j]) - 97
    return G["regions"][c] if 0 <= c < len(G["regions"]) else ""
SKIP_PLACE = {"hamlet", "farm", "square", "village", "town", "neighbourhood", "suburb"}
added = 0
for m in M:
    t = m.get("tags", {})
    if t.get("place") in SKIP_PLACE or t.get("landuse") in ("construction", "farmland", "residential", "salt_pond", "basin"): continue
    if t.get("water") or t.get("natural") in ("water", "mud") or t.get("wetland") in ("saltmarsh", "saltern", "tidalflat"): continue   # سبخات وبرك مو قيعان ربيع
    la, lo = m["lat"], m["lng"]; r = reg(la, lo)
    if not r: continue
    if any(s and math.hypot((s[1] - la) * 111, (s[2] - lo) * 111 * math.cos(math.radians(la))) < 1.5 for s in S): continue
    S.append([m["name"], la, lo, r]); added += 1
json.dump(S, open("data/fayd-sites.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(f"::notice::added {added}, total {len(S)}")

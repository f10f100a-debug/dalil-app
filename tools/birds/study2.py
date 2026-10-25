# هجرة الطيور — الحساب الكامل: كل المشاهدات (بدون عيّنة) يومًا بيوم عبر facet=day لكل شهر.
# نطاقان: (1) المملكة والخليج والأردن كاملة (2) الشمال: خط عرض 27–33° (شمال المملكة والكويت والأردن) — الأقرب لأهل الشمال.
import json, time, urllib.request, urllib.parse, sys
UA = {"User-Agent": "dalil-app-study (birds)"}
def get(url, tries=5):
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r: return json.load(r)
        except Exception as e:
            print("retry", str(e)[:80], file=sys.stderr, flush=True); time.sleep(6 * (t + 1))
    return None
GB = "https://api.gbif.org/v1/"
prev = json.load(open("tools/birds/keys.json"))
COUNTRIES = ["SA", "KW", "JO", "AE", "QA", "BH", "OM"]
SCOPES = {"all": [("country", c) for c in COUNTRIES], "north": [("country", "SA"), ("country", "KW"), ("country", "JO"), ("decimalLatitude", "27,33")]}
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
out = {}
for ar, ks in prev.items():
    out[ar] = {}
    for sc, filt in SCOPES.items():
        doy = [0] * 365; years = {}
        for mo in range(1, 13):
            q = [("taxonKey", k) for k in ks] + filt + [("month", mo), ("limit", 0), ("facet", "day"), ("facetLimit", 31)]
            j = get(GB + "occurrence/search?" + urllib.parse.urlencode(q))
            for c in ((j or {}).get("facets") or [{}])[0].get("counts", []):
                d = int(c["name"])
                if d <= DAYS[mo - 1]: doy[sum(DAYS[:mo - 1]) + d - 1] += c["count"]
            time.sleep(0.25)
        q = [("taxonKey", k) for k in ks] + filt + [("limit", 0), ("facet", "year"), ("facetLimit", 60)]
        j = get(GB + "occurrence/search?" + urllib.parse.urlencode(q))
        for c in ((j or {}).get("facets") or [{}])[0].get("counts", []): years[c["name"]] = c["count"]
        out[ar][sc] = {"doy": doy, "n": sum(doy), "years": years}
        print(ar, sc, sum(doy), flush=True)
json.dump(out, open("birds_full.json", "w"), ensure_ascii=False)
print("::notice::" + json.dumps({a: {s: v["n"] for s, v in o.items()} for a, o in out.items()}, ensure_ascii=False))

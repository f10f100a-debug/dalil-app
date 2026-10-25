# هجرة الطيور — الحساب لكل نوع لوحده (عشان ما تختلط الأنواع المشتّية مع العابرة، مثل النقشارة مع الدخل).
# نفس طريقة study2.py (كل المشاهدات يومًا بيوم) لكن لكل اسم علمي، والنتيجة birds_species.json.
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
GROUPS = {
    "الدخل": ["Sylvia atricapilla", "Sylvia borin", "Curruca communis", "Curruca curruca", "Phylloscopus trochilus", "Phylloscopus sibilatrix",
             "Phylloscopus collybita", "Curruca melanocephala", "Curruca nana", "Curruca mystacea", "Curruca nisoria", "Curruca crassirostris"],
    "البط": ["Anas platyrhynchos", "Anas crecca", "Anas acuta", "Spatula clypeata", "Spatula querquedula", "Mareca penelope", "Mareca strepera",
            "Aythya ferina", "Aythya fuligula", "Aythya nyroca"],
    "الوز": ["Anser anser", "Anser albifrons", "Anser erythropus"],
    "الجرجس": ["Melanocorypha calandra", "Melanocorypha bimaculata"],
}
COUNTRIES = ["SA", "KW", "JO", "AE", "QA", "BH", "OM"]
SCOPES = {"all": [("country", c) for c in COUNTRIES], "north": [("country", "SA"), ("country", "KW"), ("country", "JO"), ("decimalLatitude", "27,33")]}
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
out = {}
for g, names in GROUPS.items():
    out[g] = {}
    for nm in names:
        m = get(GB + "species/match?" + urllib.parse.urlencode({"name": nm, "class": "Aves"})) or {}
        k = m.get("usageKey"); acc = m.get("acceptedUsageKey") or k
        if not k or m.get("rank") != "SPECIES": print("no match", nm, m.get("rank"), flush=True); continue
        o = {"key": acc, "matched": m.get("scientificName")}
        for sc, filt in SCOPES.items():
            doy = [0] * 365; years = {}
            for mo in range(1, 13):
                q = [("taxonKey", acc)] + filt + [("month", mo), ("limit", 0), ("facet", "day"), ("facetLimit", 31)]
                j = get(GB + "occurrence/search?" + urllib.parse.urlencode(q))
                for c in ((j or {}).get("facets") or [{}])[0].get("counts", []):
                    d = int(c["name"])
                    if d <= DAYS[mo - 1]: doy[sum(DAYS[:mo - 1]) + d - 1] += c["count"]
                time.sleep(0.2)
            q = [("taxonKey", acc)] + filt + [("limit", 0), ("facet", "year"), ("facetLimit", 60)]
            j = get(GB + "occurrence/search?" + urllib.parse.urlencode(q))
            for c in ((j or {}).get("facets") or [{}])[0].get("counts", []): years[c["name"]] = c["count"]
            o[sc] = {"doy": doy, "n": sum(doy), "years": years}
        out[g][nm] = o
        print(g, nm, o["all"]["n"], o["north"]["n"], flush=True)
json.dump(out, open("birds_species.json", "w"), ensure_ascii=False)
print("::notice::" + json.dumps({g: {n: [v["all"]["n"], v["north"]["n"]] for n, v in o.items()} for g, o in out.items()}, ensure_ascii=False))

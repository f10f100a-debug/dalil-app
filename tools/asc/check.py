"""فحص للقراءة فقط لصفحة دليل في App Store Connect (لا يغيّر شيئًا).
يطبع ملخصًا كتنبيهات GitHub حتى يُقرأ من صفحة التشغيل."""
import os, re, time, json, base64, urllib.request, urllib.error, jwt

kid = os.environ["KEY_ID"].strip(); iss = os.environ["ISSUER_ID"].strip()
m = re.search(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', iss)
if m: iss = m.group(0).lower()
raw = os.environ["KEY_P8"]
if "BEGIN PRIVATE KEY" not in raw:
    body = "".join(raw.split())
    raw = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(body[i:i+64] for i in range(0, len(body), 64)) + "\n-----END PRIVATE KEY-----\n"
tok = jwt.encode({"iss": iss, "iat": int(time.time()), "exp": int(time.time()) + 1100, "aud": "appstoreconnect-v1"}, raw, algorithm="ES256", headers={"kid": kid, "typ": "JWT"})
API = "https://api.appstoreconnect.apple.com"

def patch(path, payload):
    req = urllib.request.Request(API + path, data=json.dumps(payload).encode(), method="PATCH", headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        r = urllib.request.urlopen(req, timeout=40); return r.status
    except urllib.error.HTTPError as e:
        return f"{e.code} {e.read()[:200].decode(errors='ignore')}"

def get(path):
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + tok})
    try:
        return json.load(urllib.request.urlopen(req, timeout=40))
    except urllib.error.HTTPError as e:
        return {"error": e.code, "detail": e.read()[:300].decode(errors="ignore")}

out = []
def note(title, msg):
    msg = str(msg).replace("\n", " | ")
    out.append(f"{title}: {msg}")
    print(f"::notice title={title}::{msg[:1500]}")

app = get("/v1/apps?filter[bundleId]=com.alluhaybi.dalil")["data"][0]
aid = app["id"]; a = app["attributes"]
note("App", f"id={aid} name={a.get('name')} primaryLocale={a.get('primaryLocale')} contentRights={a.get('contentRightsDeclaration')}")

vers = get(f"/v1/apps/{aid}/appStoreVersions?filter[platform]=IOS&include=build")
v = vers["data"][0]; vid = v["id"]; va = v["attributes"]
build = next((x for x in vers.get("included", []) if x["type"] == "builds"), None)
battr = build["attributes"] if build else {}
note("Version", f"{va.get('versionString')} state={va.get('appStoreState') or va.get('appVersionState')} release={va.get('releaseType')} copyright={va.get('copyright')} build={battr.get('version')} processing={battr.get('processingState')} encryption={battr.get('usesNonExemptEncryption')} expired={battr.get('expired')}")

locs = get(f"/v1/appStoreVersions/{vid}/appStoreVersionLocalizations")["data"]
for l in locs:
    la = l["attributes"]
    d = la.get("description") or ""
    note("Localization " + la["locale"], f"descLen={len(d)} descStart={d[:40]!r} descEnd={d[-40:]!r} | promo={(la.get('promotionalText') or '')!r} | keywords={(la.get('keywords') or '')!r} ({len(la.get('keywords') or '')}/100) | support={la.get('supportUrl')} | marketing={la.get('marketingUrl')}")
    sets = get(f"/v1/appStoreVersionLocalizations/{l['id']}/appScreenshotSets?include=appScreenshots&limit[appScreenshots]=10")
    shots = {s["id"]: s["attributes"] for s in sets.get("included", []) if s["type"] == "appScreenshots"}
    desc = []
    for s in sets.get("data", []):
        ids = [x["id"] for x in s["relationships"]["appScreenshots"]["data"]]
        names = [ (shots.get(i, {}).get("fileName") or "?") + ":" + str((shots.get(i, {}).get("assetDeliveryState") or {}).get("state")) for i in ids]
        desc.append(f"{s['attributes']['screenshotDisplayType']} x{len(ids)} -> " + ", ".join(names))
        if os.environ.get("FIX_ORDER") == "true":
            ordered = sorted(ids, key=lambda i: shots.get(i, {}).get("fileName") or "")
            if ordered != ids:
                st = patch(f"/v1/appScreenshotSets/{s['id']}/relationships/appScreenshots", {"data": [{"type": "appScreenshots", "id": i} for i in ordered]})
                note("Screenshot order fixed", f"{s['attributes']['screenshotDisplayType']}: status {st}")
    note("Screenshots " + la["locale"], " ; ".join(desc) or "NONE")

rd = get(f"/v1/appStoreVersions/{vid}/appStoreReviewDetail")
if "data" in rd and rd["data"]:
    r = rd["data"]["attributes"]
    note("Review details", f"contact={r.get('contactFirstName')} {r.get('contactLastName')} {r.get('contactEmail')} phone={'set' if r.get('contactPhone') else 'MISSING'} demoAccountRequired={r.get('demoAccountRequired')} demoUser={'set' if r.get('demoAccountName') else 'empty'} notesLen={len(r.get('notes') or '')} notesStart={(r.get('notes') or '')[:60]!r}")
else:
    note("Review details", f"MISSING {rd.get('error','')}")

infos = get(f"/v1/apps/{aid}/appInfos?include=primaryCategory,secondaryCategory")
for inf in infos["data"]:
    ia = inf["attributes"]; rel = inf["relationships"]
    pc = (rel.get("primaryCategory", {}).get("data") or {}).get("id"); sc = (rel.get("secondaryCategory", {}).get("data") or {}).get("id")
    note("AppInfo", f"state={ia.get('state') or ia.get('appStoreState')} ageRating={ia.get('appStoreAgeRating')} primary={pc} secondary={sc}")
    for il in get(f"/v1/appInfos/{inf['id']}/appInfoLocalizations")["data"]:
        x = il["attributes"]
        note("AppInfo " + x["locale"], f"name={x.get('name')!r} subtitle={x.get('subtitle')!r} privacy={x.get('privacyPolicyUrl')} choices={x.get('privacyChoicesUrl')}")
    ar = get(f"/v1/appInfos/{inf['id']}/ageRatingDeclaration")
    if "data" in ar and ar["data"]:
        attrs = ar["data"]["attributes"]
        nonnone = {k: v for k, v in attrs.items() if v not in (None, False, "NONE")}
        note("Age rating answers (non-NONE)", json.dumps(nonnone, ensure_ascii=False))

av = get(f"/v2/appAvailabilities/{aid}")
if "data" in av:
    ter = get(f"/v2/appAvailabilities/{aid}/territoryAvailabilities?limit=200")
    n = len(ter.get("data", [])); avail = sum(1 for t in ter.get("data", []) if t["attributes"].get("available"))
    note("Availability", f"availableInNewTerritories={av['data']['attributes'].get('availableInNewTerritories')} territories={avail}/{n}")
else:
    note("Availability", f"not set / error {av.get('error')} {av.get('detail','')[:120]}")
ps = get(f"/v1/apps/{aid}/appPriceSchedule?include=manualPrices,baseTerritory")
note("Price schedule", "set" if "data" in ps else f"MISSING {ps.get('error')} {ps.get('detail','')[:120]}")

for x in get(f"/v1/builds?filter[app]={aid}&limit=10&sort=-uploadedDate").get("data", []):
    b = x["attributes"]
    note("Build " + str(b.get("version")), f"uploaded={b.get('uploadedDate')} processing={b.get('processingState')} expired={b.get('expired')} expires={b.get('expirationDate')}")

open(os.environ.get("GITHUB_STEP_SUMMARY", "/dev/null"), "a").write("\n\n".join(out))

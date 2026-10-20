"""فحص TestFlight: المجموعات والمختبرين والبناءات المتاحة لكل مجموعة."""
import os, importlib.util
spec = importlib.util.spec_from_file_location("asc", os.path.join(os.path.dirname(__file__), "asc_common.py"))
asc = importlib.util.module_from_spec(spec); spec.loader.exec_module(asc)
aid = asc.app_id()
for g in asc.get(f"/v1/apps/{aid}/betaGroups?limit=20").get("data", []):
    a = g["attributes"]
    builds = [b["attributes"].get("version") for b in asc.get(f"/v1/betaGroups/{g['id']}/builds?limit=10").get("data", [])]
    testers = asc.get(f"/v1/betaGroups/{g['id']}/betaTesters?limit=20").get("data", [])
    ts = []
    for t in testers:
        ta = t["attributes"]; em = ta.get("email") or ""
        ts.append(f"{em[:3]}***{em[em.find('@'):] if '@' in em else ''} invite={ta.get('inviteType')} state={ta.get('state')}")
    print(f"::warning::Group {a.get('name')} internal={a.get('isInternalGroup')} allBuilds={a.get('hasAccessToAllBuilds')} builds={builds} testers={ts}")
for b in asc.get(f"/v1/builds?filter[app]={aid}&limit=3&sort=-uploadedDate&include=buildBetaDetail").get("data", []):
    print(f"::warning::Build {b['attributes'].get('version')} processing={b['attributes'].get('processingState')}")

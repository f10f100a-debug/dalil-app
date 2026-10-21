"""يرسل الإصدار المحدد للمراجعة (بطلب صريح من المطوّر)."""
import os, sys, importlib.util
spec = importlib.util.spec_from_file_location("asc", os.path.join(os.path.dirname(__file__), "asc_common.py"))
asc = importlib.util.module_from_spec(spec); spec.loader.exec_module(asc)
VERSION = os.environ["VERSION"].strip()
aid = asc.app_id()
vers = asc.get(f"/v1/apps/{aid}/appStoreVersions?filter[platform]=IOS&filter[versionString]={VERSION}")["data"]
if not vers: asc.note("Submit", "version not found"); sys.exit(1)
v = vers[0]; asc.note("Version", f"{VERSION} state={v['attributes'].get('appStoreState')}")
b = asc.get(f"/v1/appStoreVersions/{v['id']}/build")
asc.note("Build", (b.get("data") or {}).get("attributes", {}).get("version"))
# طلب مراجعة مفتوح أو جديد
subs = asc.get(f"/v1/reviewSubmissions?filter[app]={aid}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW,UNRESOLVED_ISSUES")
rs = (subs.get("data") or [None])[0]
if not rs:
    r = asc.post("/v1/reviewSubmissions", {"data": {"type": "reviewSubmissions", "attributes": {"platform": "IOS"}, "relationships": {"app": {"data": {"type": "apps", "id": aid}}}}})
    if "data" not in r: asc.note("Create submission", r); sys.exit(1)
    rs = r["data"]
asc.note("Submission", rs["id"])
r = asc.post("/v1/reviewSubmissionItems", {"data": {"type": "reviewSubmissionItems", "relationships": {
    "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": rs["id"]}},
    "appStoreVersion": {"data": {"type": "appStoreVersions", "id": v["id"]}}}}})
asc.note("Add item", "OK" if "data" in r else r)
asc.note("Submit", asc.patch(f"/v1/reviewSubmissions/{rs['id']}", {"data": {"type": "reviewSubmissions", "id": rs["id"], "attributes": {"submitted": True}}}))
v2 = asc.get(f"/v1/appStoreVersions/{v['id']}")["data"]
asc.note("State now", v2["attributes"].get("appStoreState"))

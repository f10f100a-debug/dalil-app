"""يسحب الإصدار من المراجعة (بطلب صريح من المطوّر) حتى يُرفع بناء جديد."""
import os, sys, importlib.util
spec = importlib.util.spec_from_file_location("asc", os.path.join(os.path.dirname(__file__), "asc_common.py"))
asc = importlib.util.module_from_spec(spec); spec.loader.exec_module(asc)
aid = asc.app_id()
subs = asc.get(f"/v1/reviewSubmissions?filter[app]={aid}&filter[platform]=IOS&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES")
rows = subs.get("data") or []
if not rows: asc.note("Cancel", "no open submission"); sys.exit(0)
for rs in rows:
    asc.note("Cancel " + rs["id"] + " (" + rs["attributes"].get("state", "") + ")",
             asc.patch(f"/v1/reviewSubmissions/{rs['id']}", {"data": {"type": "reviewSubmissions", "id": rs["id"], "attributes": {"canceled": True}}}))

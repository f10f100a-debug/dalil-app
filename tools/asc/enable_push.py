"""يفعّل قدرة التنبيهات (Push) على معرّف التطبيق ويطبع رقم الفريق (Team ID) اللازم لمفتاح APNs."""
import os, importlib.util
spec = importlib.util.spec_from_file_location("asc", os.path.join(os.path.dirname(__file__), "asc_common.py"))
asc = importlib.util.module_from_spec(spec); spec.loader.exec_module(asc)
b = asc.get("/v1/bundleIds?filter[identifier]=com.alluhaybi.dalil&include=bundleIdCapabilities")
bid = next(x for x in b["data"] if x["attributes"]["identifier"] == "com.alluhaybi.dalil")
caps = [x["attributes"].get("capabilityType") for x in b.get("included", []) if x["type"] == "bundleIdCapabilities"]
print(f"::warning::bundleId={bid['id']} teamId(seedId)={bid['attributes'].get('seedId')} caps={caps}")
if "PUSH_NOTIFICATIONS" not in caps:
    r = asc.post("/v1/bundleIdCapabilities", {"data": {"type": "bundleIdCapabilities", "attributes": {"capabilityType": "PUSH_NOTIFICATIONS"},
        "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bid["id"]}}}}})
    print("::warning::enable push: " + ("OK" if "data" in r else str(r)[:300]))

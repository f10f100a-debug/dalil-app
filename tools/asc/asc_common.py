"""أدوات مشتركة للتعامل مع App Store Connect API (مفتاح من أسرار GitHub)."""
import os, re, time, json, urllib.request, urllib.error, jwt

kid = os.environ["KEY_ID"].strip(); iss = os.environ["ISSUER_ID"].strip()
m = re.search(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', iss)
if m: iss = m.group(0).lower()
raw = os.environ["KEY_P8"]
if "BEGIN PRIVATE KEY" not in raw:
    body = "".join(raw.split())
    raw = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(body[i:i+64] for i in range(0, len(body), 64)) + "\n-----END PRIVATE KEY-----\n"
tok = jwt.encode({"iss": iss, "iat": int(time.time()), "exp": int(time.time()) + 1100, "aud": "appstoreconnect-v1"}, raw, algorithm="ES256", headers={"kid": kid, "typ": "JWT"})
API = "https://api.appstoreconnect.apple.com"

def _req(method, path, payload=None):
    req = urllib.request.Request(API + path, data=json.dumps(payload).encode() if payload is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        r = urllib.request.urlopen(req, timeout=40); txt = r.read()
        return json.loads(txt) if txt else {"status": r.status}
    except urllib.error.HTTPError as e:
        return {"error": e.code, "detail": e.read()[:400].decode(errors="ignore")}

get = lambda p: _req("GET", p)
post = lambda p, d: _req("POST", p, d)
def patch(p, d):
    r = _req("PATCH", p, d)
    return r.get("error") and f"{r['error']} {r.get('detail','')[:200]}" or "OK"

def note(title, msg):
    msg = str(msg).replace("\n", " | ")
    print(f"::notice title={title}::{msg[:1500]}")

def app_id():
    return get("/v1/apps?filter[bundleId]=com.alluhaybi.dalil")["data"][0]["id"]

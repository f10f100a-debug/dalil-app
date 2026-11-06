# خضرة الفياض من Copernicus Data Space (Sentinel Hub Statistical API) — نفس قمر Sentinel-2، والصور توصل فيه أول.
# نفس طريقة s2.py: مربع ~410 م حول مركز الفيضة، إزالة الغيم بطبقة SCL، NDVI (المئين 75 والمتوسط) ونسبة البكسلات > 0.18.
# المفتاح من أسرار GitHub (CDSE_CLIENT_ID / CDSE_CLIENT_SECRET) — ما يُطبع ولا يُحفظ.
import json, math, os, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics"
HALF_M = int(os.environ.get("CDSE_HALF_M", "205"))
EVAL = """//VERSION=3
function setup(){return{input:[{bands:["B04","B08","SCL","dataMask"]}],output:[{id:"ndvi",bands:1,sampleType:"FLOAT32"},{id:"green",bands:1,sampleType:"FLOAT32"},{id:"dataMask",bands:1}]}}
function evaluatePixel(s){var ok=s.dataMask==1&&(s.SCL==4||s.SCL==5||s.SCL==6)&&s.B04>0&&s.B08>0;var n=(s.B08-s.B04)/(s.B08+s.B04);
return{ndvi:[n],green:[n>0.18?1:0],dataMask:[ok?1:0]}}"""
_tok = [None, 0]
calls = 0

def available():
    return bool(os.environ.get("CDSE_CLIENT_ID") and os.environ.get("CDSE_CLIENT_SECRET"))

def token():
    if _tok[0] and time.time() - _tok[1] < 240: return _tok[0]
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": os.environ["CDSE_CLIENT_ID"],
                                   "client_secret": os.environ["CDSE_CLIENT_SECRET"]}).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body), timeout=60) as r:
        _tok[0] = json.load(r)["access_token"]; _tok[1] = time.time()
    return _tok[0]

def _one(idx, lat, lng, start, end, series=False):
    global calls
    dla = HALF_M / 111320; dlo = dla / max(0.2, math.cos(math.radians(lat)))
    poly = [[lng - dlo, lat - dla], [lng + dlo, lat - dla], [lng + dlo, lat + dla], [lng - dlo, lat + dla], [lng - dlo, lat - dla]]
    req = {"input": {"bounds": {"geometry": {"type": "Polygon", "coordinates": [poly]}, "properties": {"crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84"}},
                     "data": [{"type": "sentinel-2-l2a", "dataFilter": {"maxCloudCoverage": int(os.environ.get("CDSE_MAXCC", "100"))}}]},
           "aggregation": {"timeRange": {"from": start + "T00:00:00Z", "to": end + "T23:59:59Z"}, "aggregationInterval": {"of": "P1D", "lastIntervalBehavior": "EXTEND"},
                           "evalscript": EVAL, "resx": 0.00009, "resy": 0.00009},
           "calculations": {"ndvi": {"statistics": {"default": {"percentiles": {"k": [75, 95, 99]}}}}}}
    for k in range(4):
        try:
            calls += 1
            r = urllib.request.Request(STATS_URL, data=json.dumps(req).encode(), headers={"content-type": "application/json", "authorization": "Bearer " + token()})
            with urllib.request.urlopen(r, timeout=90) as resp: j = json.load(resp)
            best = None; ser = []
            if os.environ.get("CDSE_DEBUG"): print("cdse raw", idx, [(it["interval"]["from"][:10], it.get("outputs",{}).get("ndvi",{}).get("bands",{}).get("B0",{}).get("stats",{})) for it in j.get("data", [])], flush=True)
            for it in j.get("data", []):
                o = it.get("outputs", {}); nd = o.get("ndvi", {}).get("bands", {}).get("B0", {}).get("stats", {})
                gr = o.get("green", {}).get("bands", {}).get("B0", {}).get("stats", {})
                n = nd.get("sampleCount", 0); nod = nd.get("noDataCount", n)
                if not n or nd.get("mean") in (None, "NaN"): continue
                valid = 1 - nod / n
                if valid < 0.7: continue
                d = it["interval"]["from"][:10]
                p75 = nd.get("percentiles", {}).get("75.0")
                v = (d, round(float(p75), 3), round(float(nd["mean"]), 3), round(float(gr.get("mean", 0)), 3), round(valid, 2))
                pc = nd.get("percentiles", {})
                ser.append((d, v[1], round(float(pc.get("95.0") or 0), 3), round(float(pc.get("99.0") or 0), 3), v[3]))
                if not best or d > best[0]: best = v
            return idx, (sorted(ser) if series else best)
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(10 * (k + 1)); continue
            print("cdse http", e.code, e.read()[:200], flush=True); return idx, None
        except Exception as e:
            print("cdse retry", str(e)[:120], flush=True); time.sleep(5 * (k + 1))
    return idx, None

def sample(sites, start, end, workers=2):
    """sites: [(idx, lat, lng)] → {idx: [(date, p75, mean, gfrac, valid)]} لأحدث صورة صافية (نفس شكل s2.sample)"""
    out = {}
    with ThreadPoolExecutor(workers) as ex:
        for idx, v in ex.map(lambda s: _one(s[0], s[1], s[2], start, end), sites):
            if v: out[idx] = [v]
    return out

def series(sites, start, end, workers=2):
    """sites: [(idx, lat, lng)] → {idx: [(date, p75, p95, p99, gfrac)]} لكل صورة صافية بالفترة (طلب واحد لكل فيضة)"""
    out = {}
    with ThreadPoolExecutor(workers) as ex:
        for idx, v in ex.map(lambda s: _one(s[0], s[1], s[2], start, end, True), sites):
            if v: out[idx] = v
    return out

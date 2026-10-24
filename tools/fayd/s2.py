# خضرة الفياض بدقة 10 م من Sentinel-2 L2A (Planetary Computer) مع إزالة الغيم والظلال بطبقة SCL.
# لكل فيضة: مربع ~410 م حول مركزها → NDVI (المئين 75 والمتوسط) ونسبة البكسلات الخضراء (NDVI > 0.18).
import json, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np, rasterio
from rasterio.warp import transform
from rasterio.windows import Window

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
HALF = 20           # 41×41 بكسل × 10 م
GREEN = 0.18
_toks = {}

def token(href):
    acct = href.split("//")[1].split(".")[0]; cont = href.split("/")[3]
    k = acct + "/" + cont; t = _toks.get(k)
    if not t or time.time() - t[1] > 1800:
        for i in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(f"https://planetarycomputer.microsoft.com/api/sas/v1/token/{acct}/{cont}", headers=UA), timeout=60) as r:
                    t = _toks[k] = (json.load(r)["token"], time.time()); break
            except Exception as e:
                print("token retry", e, flush=True); time.sleep(5 * (i + 1))
    return t[0]

def search(bbox, dt, max_cloud):
    items, url = [], STAC
    body = {"collections": ["sentinel-2-l2a"], "bbox": bbox, "datetime": dt, "limit": 200,
            "query": {"eo:cloud_cover": {"lt": max_cloud}}, "sortby": [{"field": "datetime", "direction": "desc"}]}
    while url:
        for k in range(4):
            try:
                req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **UA})
                with urllib.request.urlopen(req, timeout=120) as r: j = json.load(r); break
            except Exception as e:
                print("s2 search retry", str(e)[:100], flush=True); time.sleep(10 * (k + 1))
        else: raise RuntimeError("s2 search failed")
        items += j["features"]
        nxt = [l for l in j.get("links", []) if l.get("rel") == "next"]
        url, body = (nxt[0]["href"], nxt[0].get("body", body)) if nxt else (None, None)
    return items

def _read_item(it, sites):
    """sites: [(idx, lat, lng)] داخل حدود البلاطة → {idx: (date, p75, mean, gfrac, valid)}"""
    out = {}
    off = 1000 if str(it["properties"].get("s2:processing_baseline", "00.00")) >= "04.00" else 0
    date = it["properties"]["datetime"][:10]
    hrefs = {b: it["assets"][b]["href"] for b in ("B04", "B08", "SCL")}
    for k in range(3):
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2"):
                with rasterio.open(hrefs["B04"] + "?" + token(hrefs["B04"])) as red, rasterio.open(hrefs["B08"] + "?" + token(hrefs["B08"])) as nir, \
                     rasterio.open(hrefs["SCL"] + "?" + token(hrefs["SCL"])) as scl:
                    xs, ys = transform("EPSG:4326", red.crs, [s[2] for s in sites], [s[1] for s in sites])
                    inv = ~red.transform
                    for (idx, la, lo), x, y in zip(sites, xs, ys):
                        c, r = inv * (x, y); c, r = int(c), int(r)
                        if not (HALF <= r < red.height - HALF and HALF <= c < red.width - HALF): continue
                        win = Window(c - HALF, r - HALF, 2 * HALF + 1, 2 * HALF + 1)
                        R = red.read(1, window=win).astype("float32"); N = nir.read(1, window=win).astype("float32")
                        sw = Window((c - HALF) // 2, (r - HALF) // 2, HALF + 1, HALF + 1)
                        S = scl.read(1, window=sw)
                        S = np.repeat(np.repeat(S, 2, 0), 2, 1)[:R.shape[0], :R.shape[1]]
                        if S.shape != R.shape: continue
                        ok = np.isin(S, (4, 5, 6)) & (R > 0) & (N > 0)
                        valid = float(ok.mean())
                        if valid < 0.7: continue
                        R = np.clip(R[ok] - off, 1, None); N = np.clip(N[ok] - off, 1, None)
                        nd = (N - R) / (N + R)
                        out[idx] = (date, round(float(np.percentile(nd, 75)), 3), round(float(nd.mean()), 3), round(float((nd > GREEN).mean()), 3), round(valid, 2))
            return out
        except Exception as e:
            print("s2 retry", it["id"], str(e)[:120], flush=True); time.sleep(5 * (k + 1))
    return out

def sample(SITES, start, end, max_cloud=60, keep=1):
    """أحدث قراءة صافية لكل فيضة (keep>1 = أحدث keep قراءات) بين start و end"""
    lats = [s[1] for s in SITES]; lngs = [s[2] for s in SITES]
    bbox = [min(lngs) - .1, min(lats) - .1, max(lngs) + .1, max(lats) + .1]
    items = search(bbox, f"{start}T00:00:00Z/{end}T23:59:59Z", max_cloud)
    jobs = []
    for it in items:
        w, s, e, n = it["bbox"]
        inside = [(i, la, lo) for i, (la, lo) in enumerate(zip(lats, lngs)) if s <= la <= n and w <= lo <= e]
        if inside: jobs.append((it, inside))
    print(f"s2 {start}→{end}: items {len(items)} with sites {len(jobs)}", flush=True)
    res = {}
    t0 = time.time()
    with ThreadPoolExecutor(12) as ex:
        for n, out in enumerate(ex.map(lambda j: _read_item(*j), jobs)):
            for idx, v in out.items(): res.setdefault(idx, []).append(v)
            if n % 25 == 0: print("s2", n, "/", len(jobs), round(time.time() - t0), "s", flush=True)
    return {i: sorted(v, key=lambda x: x[0], reverse=True)[:keep] for i, v in res.items()}

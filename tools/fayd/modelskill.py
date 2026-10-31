# دقة نماذج الطقس في المطر مقابل محطات الأرصاد الأرضية (مقياس فعلي): لكل نموذج، يوم بيوم من بداية أكتوبر
# المصدر: Open-Meteo «التوقعات السابقة» (historical-forecast: أقرب تشغيل لكل يوم) — مجاني. النتيجة → data/model-skill.json
# يوم ممطر = 1 ملم فأكثر. CSI = أصاب ÷ (أصاب + فات + إنذار كاذب).
import json, os, sys, time, datetime as dt, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
import synop
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
MODELS = ["ecmwf_ifs025", "ecmwf_aifs025_single", "gfs_seamless", "icon_seamless"]
NAME = {"ecmwf_ifs025": "الأوروبي", "ecmwf_aifs025_single": "الأوروبي بالذكاء الاصطناعي (AIFS)", "gfs_seamless": "الأمريكي", "icon_seamless": "الألماني"}
WET = 1.0

def get(url):
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r: return json.load(r)
        except Exception as e:
            print("retry", str(e)[:100], flush=True); time.sleep(15 * (k + 1))
    return None

def run(since, until):
    SY = json.load(open(synop.FILE))["stations"]
    ids = [w for w in synop.STATIONS if SY.get(str(w))]
    q = urllib.parse.urlencode({"latitude": ",".join(str(synop.STATIONS[w][1]) for w in ids), "longitude": ",".join(str(synop.STATIONS[w][2]) for w in ids),
                                "start_date": since.isoformat(), "end_date": until.isoformat(), "daily": "precipitation_sum", "models": ",".join(MODELS), "timezone": "Asia/Riyadh"})
    j = get("https://historical-forecast-api.open-meteo.com/v1/forecast?" + q)
    if j is None: raise RuntimeError("open-meteo failed")
    locs = j if isinstance(j, list) else [j]
    stat = {m: {"n": 0, "hit": 0, "miss": 0, "fa": 0, "err": 0.0, "wet_n": 0, "avail": 0} for m in MODELS}
    obs_wet = 0
    for w, loc in zip(ids, locs):
        D = loc.get("daily", {}); T = D.get("time", [])
        for i, day in enumerate(T):
            o = SY[str(w)].get(day)
            if o is None: continue
            ow = o >= WET; obs_wet += ow
            for m in MODELS:
                v = (D.get("precipitation_sum_" + m) or [None] * len(T))[i]
                if v is None: continue
                s = stat[m]; s["n"] += 1; fw = v >= WET
                if ow and fw: s["hit"] += 1
                elif ow: s["miss"] += 1
                elif fw: s["fa"] += 1
                if ow or fw: s["err"] += abs(v - o); s["wet_n"] += 1
    out = {"asof": dt.date.today().isoformat(), "since": since.isoformat(), "until": until.isoformat(), "stations": len(ids), "obs_wet_days": obs_wet, "models": {}}
    for m, s in stat.items():
        h, mi, fa = s["hit"], s["miss"], s["fa"]
        out["models"][m] = {"name": NAME[m], "days": s["n"], "hit": h, "miss": mi, "fa": fa,
                            "csi": round(h / (h + mi + fa), 3) if h + mi + fa else None, "pod": round(h / (h + mi), 3) if h + mi else None,
                            "far": round(fa / (h + fa), 3) if h + fa else None, "mae_wet": round(s["err"] / s["wet_n"], 1) if s["wet_n"] else None}
    json.dump(out, open("data/model-skill.json", "w"), ensure_ascii=False, separators=(",", ":"))
    print("::notice::model skill " + " · ".join(f"{v['name']}: CSI {v['csi']} POD {v['pod']} FAR {v['far']} ({v['days']}d)" for v in out["models"].values()) + f" | obs wet days {obs_wet}", flush=True)
    return out

if __name__ == "__main__":
    today = dt.date.today()
    season = today.year if today.month >= 8 else today.year - 1
    run(dt.date(season, 10, 1), today - dt.timedelta(days=2))

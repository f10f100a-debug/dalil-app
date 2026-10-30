import urllib.request, re
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
def get(u, n=None):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=90) as r:
            b = r.read(n) if n else r.read(); return r.status, b
    except Exception as e: return str(e)[:120], b""
def ls(name, url, n=6, pat=None):
    s, b = get(url); t = b.decode("utf8", "replace")
    rows = re.findall(r'href="([^"?#]+)"[^\n]*?(\d{4}-\d\d-\d\d \d\d:\d\d|\d\d-\w{3}-\d{4} \d\d:\d\d)?\s*([\d.]+[KMG]?)?', t)
    if pat: rows = [r for r in rows if re.search(pat, r[0])]
    print("LS", name, s, "count", len(rows)); [print("   ", r) for r in rows[:3] + [("...",)] + rows[-n:]]
ls("CMORPH2NRT", "https://ftp.cpc.ncep.noaa.gov/precip/CMORPH2/CMORPH2NRT/")
ls("CMORPH2NRT/DATA", "https://ftp.cpc.ncep.noaa.gov/precip/CMORPH2/CMORPH2NRT/DATA/")
ls("CMORPH2NRT/DATA/2026", "https://ftp.cpc.ncep.noaa.gov/precip/CMORPH2/CMORPH2NRT/DATA/2026/")
ls("CMORPH2NRT/DATA/2026/202610", "https://ftp.cpc.ncep.noaa.gov/precip/CMORPH2/CMORPH2NRT/DATA/2026/202610/")
ls("CMORPH_RT 202610", "https://ftp.cpc.ncep.noaa.gov/precip/CMORPH_RT/GLOBE/data/2026/202610/", 3)
ls("CMORPH_RT GLOBE", "https://ftp.cpc.ncep.noaa.gov/precip/CMORPH_RT/GLOBE/")
ls("CMORPH_RT root", "https://ftp.cpc.ncep.noaa.gov/precip/CMORPH_RT/")
ls("PERSIANN-CCS 26", "https://persiann.eng.uci.edu/CHRSdata/PERSIANN-CCS/daily/", 4, r"1d26")
ls("PDIR 26", "https://persiann.eng.uci.edu/CHRSdata/PDIRNow/PDIRNowdaily/", 4, r"1d26")
ls("CPC global daily", "https://ftp.cpc.ncep.noaa.gov/precip/CPC_UNI_PRCP/GAUGE_GLB/RT/2026/", 4)

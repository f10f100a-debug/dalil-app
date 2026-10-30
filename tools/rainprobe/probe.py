# فحص مؤقت: (1) تقارير المطارات (METAR) من أرشيف IEM لأيام المطر في الشمال، (2) مصادر مطر الأقمار الصناعية المتاحة بدون حساب
import urllib.request, re, csv, io, collections
UA = {"User-Agent": "dalil-app/1.0 (+https://dalilbarr.com)"}
def get(u, n=None):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=90) as r:
            b = r.read(n) if n else r.read(); return r.status, b
    except Exception as e: return str(e)[:120], b""
ST = ["OEHL","OERR","OERF","OESK","OETR","OEPJ","OETB","OEGS","OEPA","OEDM","OEJF"]   # حائل عرعر رفحاء الجوف طريف القريات تبوك القصيم القيصومة الدوادمي الجوف-ق
u = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?" + "&".join("station="+s for s in ST) + "&data=wxcodes&data=metar&year1=2026&month1=10&day1=1&year2=2026&month2=10&day2=31&tz=Asia%2FRiyadh&format=onlycomma&missing=M&report_type=3&report_type=4"
s, b = get(u); print("IEM", s, len(b))
days = collections.defaultdict(set)
for row in csv.DictReader(io.StringIO(b.decode("utf8", "replace"))):
    wx = row.get("wxcodes", "M")
    if wx and wx != "M" and re.search(r"RA|TS|SH|DZ|GR|GS", wx):
        days[(row["station"], row["valid"][:10])].add(wx)
for k in sorted(days): print("WX", k[0], k[1], " ".join(sorted(days[k]))[:120])
for name, url in [
  ("CMORPH-NCEI-daily", "https://www.ncei.noaa.gov/data/cmorph-high-resolution-global-precipitation-estimates/access/daily/0.25deg/2026/10/"),
  ("CMORPH-NCEI-30min", "https://www.ncei.noaa.gov/data/cmorph-high-resolution-global-precipitation-estimates/access/30min/8km/2026/10/"),
  ("CPC-CMORPH-RT", "https://ftp.cpc.ncep.noaa.gov/precip/CMORPH_RT/GLOBE/data/2026/202610/"),
  ("CPC-CMORPH2", "https://ftp.cpc.ncep.noaa.gov/precip/CMORPH2/"),
  ("CHIRP-daily", "https://data.chc.ucsb.edu/products/CHIRP/daily/"),
  ("PERSIANN-CCS-daily", "https://persiann.eng.uci.edu/CHRSdata/PERSIANN-CCS/daily/"),
  ("PDIR-daily", "https://persiann.eng.uci.edu/CHRSdata/PDIRNow/PDIRNowdaily/"),
  ("IMERG-GESDISC", "https://gpm1.gesdisc.eosdis.nasa.gov/data/GPM_L3/GPM_3IMERGDE.07/2026/"),
]:
    s, b = get(url, 400000); t = b.decode("utf8", "replace")
    links = re.findall(r'href="([^"?#]+)"', t)
    print("SRC", name, s, len(t), "last:", links[-6:])

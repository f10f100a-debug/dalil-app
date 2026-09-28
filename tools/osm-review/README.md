# مراجعة أماكن التطبيق مقابل OSM

أدوات مراجعة فقط. لا تغيّر التطبيق ولا تُحمَّل فيه.

```bash
pip install osmium
curl -LO https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf
python3 tools/osm-review/osm_extract.py gcc-states-latest.osm.pbf osm.csv
python3 tools/osm-review/osm_compare.py osm.csv data/desert-places.json data/region-grid.json report.json 2
```

المخرجات: `report.json` (الأرقام والتوزيع والأمثلة) و`report_osm_only.csv` (ما عند OSM فقط).

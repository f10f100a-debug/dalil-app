# بناء خريطة البر (PMTiles)

يبني ملفي `maps/<region>.pmtiles` (خرائط متجهية) و `maps/<region>-hillshade.pmtiles` (تظليل التضاريس) من مصادر مفتوحة:

- **OpenStreetMap عبر Overture Maps** (S3 العام `overturemaps-us-west-2`): الطرق، استخدامات الأرض، المياه، الرمال والقمم، التجمعات السكانية. رخصة ODbL.
- **Copernicus DEM GLO-30** (S3 العام `copernicus-dem-30m`): الكنتور وتظليل التضاريس. يُسمح بالاستخدام التجاري مع ذكر المصدر.
- **بيانات دليل** من `data/`: الأودية (`wadis.json`) ومواقع خرائط البر و OSM.

## الخطوات (نموذج الرياض: 45.4–47.9 شرقًا، 23.7–25.9 شمالًا)

```sh
pip install pyarrow shapely pyproj mapbox-vector-tile pmtiles rasterio scipy matplotlib pillow
python3 extract_overture.py            # segment/land_use/land/water/division .parquet
# نزّل مربعات DEM إلى dem/ (N23–N25 × E045–E047):
#   https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N24_00_E046_00_DEM/Copernicus_DSM_COG_10_N24_00_E046_00_DEM.tif
python3 build_vector.py riyadh.pmtiles        # يحفظ أيضًا dem_mosaic.npy
python3 build_hillshade.py riyadh-hillshade.pmtiles
```

لتغيير المنطقة عدّل `X0, X1, Y0, Y1` في الملفات الثلاثة (و `LAT_HI, LON_LO` في build_hillshade.py).

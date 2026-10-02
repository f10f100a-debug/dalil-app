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

## كل المناطق (الطريقة المعتمدة)

`build_region.py` يبني منطقة كاملة من حدودها في `data/region-grid.json` دفعة واحدة (يستخرج من Overture مباشرة، وينزّل مربعات DEM ويخفّضها إلى ~90 م ثم يحذفها):

```sh
python3 build_region.py riyadh الرياض out/     # → out/riyadh.pmtiles (z6–13) و out/riyadh-hs.pmtiles (z6–11) و out/riyadh.json
# بعد بناء المناطق كلها:
MAPS_V=1 python3 make_manifest.py out/ ../..    # ينسخ الخرائط إلى maps/ ويكتب data/maps.json
```

ارفع `MAPS_V` عند إعادة البناء حتى تُنزَّل النسخة الجديدة بدل المحفوظة في الأجهزة.

## قائمة المواقع من المصادر المفتوحة (data/open-places.json)
`tools/places/build_osm_full.py` يبني كل المعالم البرية المسمّاة بالعربية من مستخرج Overture (osm.pkl الذي ينتجه سكربت المقارنة)،
بعد حذف التكرار داخل OSM (الاسم نفسه ضمن 1 كم). الناتج tools/places/osm-full.json، ثم `tools/places/add_geonames.py` يضيف معالم GeoNames العربية غير الموجودة في OSM (CC BY 4.0) فينتج data/open-places.json.
يُستخدم بديلًا نظاميًا كاملًا لمواقع «خرائط البر» حين يُختار «المصادر المفتوحة» في الإعدادات.

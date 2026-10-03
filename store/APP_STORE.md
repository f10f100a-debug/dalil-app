# دليل — بيانات صفحة المتجر (App Store Connect)

جاهزة للنسخ عند إنشاء التطبيق في App Store Connect. الحدود بين الأقواس هي حدود أبل.

## معلومات أساسية
| الحقل | القيمة |
|---|---|
| الاسم (30) | دليل - بوصلة البر |
| العنوان الفرعي (30) | ملاحة البر بدون إنترنت |
| اللغة الأساسية | العربية |
| الفئة الأساسية | Navigation (الملاحة) |
| الفئة الثانوية | Travel (السفر) |
| السعر | مجاني — بلا إعلانات وبلا مشتريات داخل التطبيق |
| رابط سياسة الخصوصية | https://f10f100a-debug.github.io/dalil-app/privacy.html |
| رابط الدعم | https://f10f100a-debug.github.io/dalil-app/support.html |
| حقوق النشر | © 2026 أبو مالك اللهيبي |

## الكلمات المفتاحية (100 حرف، مفصولة بفواصل بلا مسافات)
```
بوصلة,بر,كشتة,رحلات,خرائط,بدون انترنت,GPS,تتبع,مسار,ربيع,أمطار,سيول,وادي,نفود,القبلة,طقس,مخيم
```

## النص الترويجي (170 — يمكن تغييره دون مراجعة)
خرائط البر للمملكة بدون إنترنت، بوصلة دقيقة، تتبع مسارك والعودة منه، وحالة الربيع والأمطار والسحب — كل ما تحتاجه في طلعتك في تطبيق واحد.

## الوصف (4000)
دليل رفيقك في البر: يعمل حين تنقطع الشبكة.

خرائط البر بدون إنترنت
• خرائط رسمية مفصّلة لكل مناطق المملكة الـ13 من OpenStreetMap مع التضاريس وخطوط الارتفاع والأودية.
• احفظ منطقتك مرة واحدة وتعمل الخريطة كاملة بلا شبكة.
• أنماط: البر، طبوغرافي، فضائي، وعرض ثلاثي الأبعاد.

بوصلة وتوجيه
• بوصلة دقيقة مع اتجاه القبلة.
• توجّه إلى أي مكان بالبوصلة أو على الخريطة، مع المسافة والوقت المتوقع.
• احفظ موقع السيارة وارجع إليها.

التتبع والمسارات
• سجّل مسارك وارجع منه خطوة بخطوة.
• شارك المسار بصيغة GPX.

أكثر من 40 ألف موقع بري
• جبال وأودية ونفود وآبار وقرى من مصادر مفتوحة، مع البحث و«بالقرب منك».
• أقرب نقطة على الوادي للوصول إليه.

الأجواء
• الطقس والرياح لسبعة أيام، والغبار ومدى الرؤية.
• الربيع: نسبة الاخضرار حولك من صور الأقمار الصناعية وأمطار آخر 30 يومًا، وطبقة الغطاء النباتي على الخريطة.
• طبقة السحب الآن والمطر لآخر الساعات مع تحريك لمعرفة اتجاهها.
• تنبيهات السيول والأمطار، وصور الأحداث من مستخدمي منطقتك.

خرائطك أنت
• استورد KML وKMZ وGPX وGeoJSON وCSV وOSM وMBTiles وPMTiles وGeoTIFF وخرائط OziExplorer وملفات OsmAnd — تُحفظ في جوالك فقط.

خصوصيتك
• بلا حساب وبلا إعلانات. أماكنك ومساراتك تبقى في جوالك.

تنبيه: التطبيق مساعد للملاحة، احمل دائمًا ماءً كافيًا ووسيلة اتصال وأخبر أحدًا بوجهتك. التحذيرات الرسمية مرجعها المركز الوطني للأرصاد.

## English (optional localization)
- **Name:** Dalil - Desert Compass
- **Subtitle:** Offline desert navigation
- **Keywords:** compass,desert,offline maps,GPS,tracking,trail,saudi,camping,qibla,weather,rain,wadi,dunes,4x4
- **Promotional text:** Offline desert maps of Saudi Arabia, an accurate compass, track recording and backtracking, plus vegetation, rain and live cloud layers — everything for your trip in one app.

## ملاحظات للمراجع (App Review Information → Notes)
```
Dalil is a free offline navigation app for desert trips in Saudi Arabia. No account or login is required.
- Location is used on-device for the map, compass and track recording.
- To test offline maps: Settings → "حفظ خرائط المناطق" → save a region, then enable Airplane Mode.
- The "Events" section shows user-submitted flood/rain photos. Users can report any photo (Report button); reported content is reviewed and removed by the developer, and photos expire automatically.
- Weather: Open-Meteo. Imagery layers: NASA GIBS and EUMETSAT. Map data: © OpenStreetMap contributors.
```

## نموذج الخصوصية في App Store Connect (App Privacy)
- **هل يجمع التطبيق بيانات؟** نعم (قليلة).
- **التتبع (Tracking):** لا.
- البيانات المجمّعة — كلها **غير مرتبطة بهوية المستخدم (Not Linked to You)**:
  | النوع في أبل | ما هو عندنا | الغرض |
  |---|---|---|
  | Location → Coarse Location | اسم المنطقة يوميًا | Analytics |
  | Location → Precise Location | موقع صورة الحدث فقط إن اختار المستخدم إرفاقه | App Functionality |
  | User Content → Photos or Videos | صور الأحداث المنشورة | App Functionality |
  | User Content → Other User Content | وصف الحدث والاسم المستعار | App Functionality |
  | Identifiers → Device ID | رقم عشوائي للجهاز في الأحداث | App Functionality (منع الإساءة) |

## التصنيف العمري (Age Rating)
- المحتوى المنشور من المستخدمين (صور الأحداث): **نعم** — مع وجود إبلاغ ومراجعة وحذف.
- بقية الأسئلة: لا.
- المتوقع: **+12** غالبًا بسبب المحتوى من المستخدمين (أو 4+ إن لم تعتبره أبل كذلك).

## المواد المطلوبة
- [x] أيقونة 1024×1024 بلا شفافية: `store/icon-1024.png` (مكبّرة من 512 — يُفضّل لاحقًا تصميم أصلي بدقة 1024).
- [ ] لقطات شاشة آيفون 6.9 بوصة (1320×2868) — 3 إلى 10 لقطات: البوصلة، الخريطة، الأماكن، الأجواء/الربيع، الاستيراد.
- [ ] (اختياري) لقطات آيباد 13 بوصة إن دعمنا الآيباد.

## نقاط تُحسم قبل الإرسال
1. تصحيح اسم البائع (اللقب) لدى أبل — طلب الدعم مُرسل.
2. أبل تطلب في التطبيقات ذات المحتوى من المستخدمين (البند 1.2): فلترة، وإبلاغ، و**حظر المستخدم المسيء**، ووسيلة تواصل. الإبلاغ والتواصل موجودان؛ الحظر يتم من لوحة الإدارة بحذف المحتوى — قد يطلب المراجع زر «حظر» داخل التطبيق.

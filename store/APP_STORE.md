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
| بريد الدعم (App Review → Contact) | dalilbarr.app@gmail.com |

## الكلمات المفتاحية (100 حرف، مفصولة بفواصل بلا مسافات)
```
بوصلة,بر,كشتة,رحلات,خرائط,بدون انترنت,GPS,تتبع,مسار,ربيع,أمطار,سيول,وادي,نفود,القبلة,طقس,مخيم
```

## النص الترويجي (170 — يمكن تغييره دون مراجعة)
خرائط البر للمملكة بدون إنترنت، بوصلة دقيقة، تتبع مسارك والعودة منه، وحالة الربيع والأمطار والسحب — كل ما تحتاجه في طلعتك في تطبيق واحد.

## الوصف (4000)
دليل رفيقك في البر: يعمل حين تنقطع الشبكة.

خرائط البر بدون إنترنت
• خرائط مفصّلة لكل مناطق المملكة الـ13 من OpenStreetMap مع التضاريس وخطوط الارتفاع والأودية.
• احفظ منطقتك مرة واحدة وتعمل الخريطة كاملة بلا شبكة.
• أنماط: البر، طبوغرافي، فضائي، وعرض ثلاثي الأبعاد.

بوصلة وتوجيه
• بوصلة دقيقة مع اتجاه القبلة.
• توجّه إلى أي مكان بالبوصلة أو على الخريطة، مع المسافة والوقت المتوقع.
• احفظ موقع السيارة وارجع إليها.

التتبع والمسارات
• سجّل مسارك وارجع منه خطوة بخطوة.
• شارك المسار بصيغة GPX.

نحو 40 ألف موقع بري داخل المملكة
• جبال وأودية ونفود وآبار وقرى من مصادر مفتوحة، مع البحث و«بالقرب منك».
• أقرب نقطة على الوادي للوصول إليه.

الأجواء
• الطقس والرياح لسبعة أيام، والغبار ومدى الرؤية.
• الربيع: نسبة الاخضرار حولك من صور الأقمار الصناعية وأمطار آخر 30 يومًا، وطبقة الغطاء النباتي على الخريطة.
• طبقة السحب الآن والمطر لآخر الساعات مع تحريك لمعرفة اتجاهها.
• صور السيول والأمطار من مستخدمي منطقتك فور نشرها.

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
انسخ النص الإنجليزي كما هو. لا يحتاج حساب تجربة: اختر **Sign-in required: No**.
```
Dalil is a free offline navigation app for desert trips in Saudi Arabia (the app UI is in Arabic). No account, no ads, no in-app purchases.

Demo video (60 s): https://f10f100a-debug.github.io/dalil-app/assets/dalil-demo.mp4

Native, on-device features to test (tab bar, right to left):
1. Compass (البوصلة): live device compass with Qibla direction; tap "حفظ موقعي" to save the current spot, then navigate back to it with distance/bearing/ETA.
2. Places (الأماكن): about 40,000 offline desert places (wadis, mountains, wells) with search and "nearby"; tap "توجّه" to navigate to one.
3. Map (الخريطة): offline vector maps with terrain and contours; record a GPS track under "تسجيل المسار" and follow it back ("ارجع من نفس المسار"); export as GPX.
4. Offline mode: Settings (الإعدادات) → "حفظ خرائط المناطق للاستخدام بدون إنترنت" → save one region, then enable Airplane Mode: map, compass, places and tracking keep working.
5. Weather (الأجواء): 7-day weather and wind (Open-Meteo), vegetation and rain layers (NASA GIBS).

Location is used on-device only (When In Use). Motion is used for the compass. Camera/Photos are used only if the user chooses to post an event photo.

User-generated content (Weather → Events / الأحداث): users can post flood/rain photos. Safeguards (Guideline 1.2):
- Users must agree to posting terms with zero tolerance for objectionable content before their first post (terms: https://f10f100a-debug.github.io/dalil-app/support.html#terms).
- Every photo is reviewed and approved by the developer before it becomes visible.
- Any user can report a photo (auto-hidden after 3 reports) and "Block this poster" (hides all their photos immediately and notifies the developer).
- Reports are handled within 24 hours; photos expire automatically after 3 days.
- Contact: dalilbarr.app@gmail.com

Data sources: © OpenStreetMap contributors, Copernicus DEM, NASA GIBS, EUMETSAT, Open-Meteo.
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
- [x] أيقونة 1024×1024 بلا شفافية: `store/icon-1024.png` (مرسومة بدقة 1024).
- [ ] لقطات شاشة آيفون 6.9 بوصة (1320×2868) — 3 إلى 10 لقطات: البوصلة، الخريطة، الأماكن، الأجواء/الربيع، الاستيراد.
- [ ] (اختياري) لقطات آيباد 13 بوصة إن دعمنا الآيباد.

## نقاط تُحسم قبل الإرسال
1. تصحيح اسم البائع (اللقب) لدى أبل — طلب الدعم مُرسل.
2. ✅ متطلبات البند 1.2 (المحتوى من المستخدمين) مكتملة: مراجعة مسبقة قبل النشر، وإبلاغ (إخفاء تلقائي بعد 3 بلاغات)، و«حظر هذا الناشر» داخل التطبيق (منذ 3.24)، ووسيلة تواصل في صفحة الدعم.

---

# الإصدار 1.1 — غرفة الرحلة

## ما الجديد (What's New) — يُلصق في خانة الإصدار 1.1
```
جديد: غرفة الرحلة 🏕️
• تكلّم مع جماعتك بضغطة زر مثل اللاسلكي — حتى 15 شخصًا.
• شوف مواقعهم على الخريطة وكم يبعدون عنك واتجاههم، وتوجّه لأي واحد بالبوصلة.
• نقطة تجمّع يحددها أي عضو، وتنبيه إذا ابتعد أحد عن القافلة أكثر من 3 كم.
• زر استغاثة يرسل موقعك لكل أعضاء الغرفة فورًا.
• غرف خاصة برقم ورمز سري، تنتهي بعد 24 ساعة، والرسائل الصوتية تُحذف بعد ساعة.
```

## إضافة لملاحظات المراجع (تُضاف في آخر النص الإنجليزي)
```
NEW IN 1.1 — Trip room (غرفة الرحلة), a private push-to-talk room for a travelling group:
- Compass tab → "غرفة الرحلة" → "إنشاء غرفة" (create): enter any name and a 4-digit PIN, tick the terms box, tap the gold button.
- Hold "اضغط مطوّلًا وتكلّم" to record a voice message (microphone is used only while holding this button).
- To see a second member, open https://f10f100a-debug.github.io/dalil-app/?room=ROOMCODE in any desktop browser and join with the same PIN; both members then see each other's distance/direction, the map markers, voice messages, the rally point and the SOS alert.
- Location is shared only with members of a room the user joined, only while the app is open, and is not stored on our server. Voice messages are deleted after 1 hour; rooms expire after 24 hours.
- Safeguards (Guideline 1.2): users accept zero-tolerance terms before joining (https://f10f100a-debug.github.io/dalil-app/support.html#room-terms); any member can mute another member; a member muted by 3 members is removed automatically; any member can report another (the latest voice message is kept for review); reports are handled by the developer within 24 hours and offenders are banned from rooms.
```

## تحديث نموذج الخصوصية (App Privacy) قبل إرسال 1.1
أضف هذه الأنواع (كلها **Not Linked to You** و**بدون تتبع**، والغرض **App Functionality**):
| النوع في أبل | ما هو عندنا |
|---|---|
| User Content → Audio Data | الرسائل الصوتية في غرفة الرحلة (تُحذف بعد ساعة) |
| Location → Precise Location | موجود مسبقًا — الآن أيضًا موقعك لأعضاء غرفة الرحلة (لا يُخزَّن) |
| User Content → Other User Content | موجود — أضف: الاسم الذي تكتبه في الغرفة |

## الأذونات الجديدة في التطبيق
- الميكروفون: «لإرسال رسائل صوتية لأعضاء غرفة الرحلة عند الضغط على «اضغط وتكلّم» فقط.»

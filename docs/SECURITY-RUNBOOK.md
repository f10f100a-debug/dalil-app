# خطة الطوارئ الأمنية — دليل

> ورقة واحدة: إذا صار اختراق (أو شك فيه) نمشي عليها بالترتيب. **لا تُكتب هنا أي كلمة سر أو مفتاح** — المستودع عام.

## 0. الوقاية (مرة وحدة)
- [ ] **التحقق بخطوتين** على: GitHub · Supabase · Cloudflare (dalilbarr.app@gmail.com) · Apple Developer · إيميل dalilbarr.app@gmail.com. واحفظ **رموز الاسترداد** خارج الجوال.
- [ ] كلمة سر مختلفة لكل حساب (مدير كلمات السر في الآيفون).
- [ ] نسخة احتياطية يومية لقاعدة البيانات: `.github/workflows/db-backup.yml` (مشفّرة، تبقى 90 يومًا).
  - السر `SUPABASE_DB_URL`: من Supabase ← Connect ← **Session pooler**.
  - السر `BACKUP_PASSPHRASE`: كلمة سر التشفير، 16 حرفًا أو أكثر، **محفوظة عندك فقط**.
- [ ] مرة بالشهر: نزّل آخر نسخة (Actions ← DB backup ← Artifacts) واحفظها في Google Drive. إذا انسرق حساب GitHub تروح نسخه معه.

## 1. أول 15 دقيقة: أوقف الضرر
| الإجراء | كيف |
|---|---|
| إيقاف تنبيهات المطر التلقائية | لوحة الإدارة ← «تنبيهات المطر التلقائية» ← إيقاف (أو SQL: `update app_config set value='off' where key='auto_alerts'`) |
| تغيير كلمات سر المشرفين | لوحة الإدارة ← المشرفين (المالك). عطّل أي مشرف مشبوه |
| مراجعة سجل الإدارة | لوحة الإدارة ← السجل: من سوّى وش ومتى |
| إيقاف دالة مخترقة مؤقتًا | Supabase ← Edge Functions ← الدالة ← Delete أو إعادة نشر نسخة سليمة من GitHub |

## 2. غيّر المفاتيح (حسب اللي انكشف)
| المفتاح | أين يُغيَّر | ملاحظة |
|---|---|---|
| كلمة سر قاعدة البيانات | Supabase ← Database ← Reset password | حدّث سر `SUPABASE_DB_URL` في GitHub |
| مفاتيح Supabase (service/secret) | Supabase ← API Keys ← إنشاء جديد وإلغاء القديم | الدوال تقرأه تلقائيًا من البيئة |
| مفتاح الجدولة `cron_key` | `update private_config set value=encode(gen_random_bytes(24),'hex') where key='cron_key'` | الجدولة تقرأه من الجدول نفسه |
| مفتاح تنبيهات Apple (APNs .p8) | Apple Developer ← Keys ← Revoke + مفتاح جديد | حدّث `apns_key_p8` و`apns_key_id` في `private_config` |
| مفتاح App Store Connect | App Store Connect ← Users and Access ← Keys | حدّث أسرار GitHub `ASC_*` |
| Cloudflare | تغيير كلمة السر + مراجعة Workers و DNS | الـ Worker يُبنى من مجلد `links/` |

## 3. استرجاع الكود
- كل تعديل له تاريخ في GitHub. ارجع لآخر نسخة سليمة: `git revert <commit>` ثم `git push`، وموقع التطبيق يتحدّث خلال دقائق.
- دوال السيرفر: أعد نشرها من `supabase/functions/` (نفس الملفات في GitHub).

## 4. استرجاع قاعدة البيانات
1. GitHub ← Actions ← **DB backup** ← اختر يومًا قبل الاختراق ← نزّل الملف.
2. تأكد من سلامته: `sha256sum -c dalil-db-YYYY-MM-DD.sha256`
3. فك التشفير: `gpg --decrypt --output dalil.dump dalil-db-YYYY-MM-DD.dump.gpg` (يطلب كلمة سر التشفير)
4. الاسترجاع (يمسح الجداول الحالية ويرجّع النسخة):
   `docker run --rm -i -e DB="<رابط Session pooler>" -v "$PWD":/w postgres:17 pg_restore --clean --if-exists --no-owner --no-privileges -d "$DB" /w/dalil.dump`
5. افحص: لوحة الإدارة تفتح، والغرف تشتغل (`Rooms self-test`)، والتنبيهات التلقائية تشتغل.

## 5. بعد الحادثة
- اكتب ملخص: وش صار، متى، وش انكشف، وش تغيّر.
- **بيانات المستخدمين:** التطبيق ما يحفظ أسماء حقيقية ولا أرقام ولا مواقع دائمة، والأماكن والمسارات في جوالاتهم. إذا انكشف شيء يخصهم، بلّغهم عبر تنبيه من لوحة الإدارة وتحديث صفحة الخصوصية.

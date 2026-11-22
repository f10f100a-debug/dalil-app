-- 22 نوفمبر: نشر الإدارة بدقة أعلى (صورة 2048 + فيديو 1080p حتى 15 ثانية) — سلة events حدها 8 ميقا
-- سلة pending (رفع المشتركين) تبقى 3 ميقا، ودالة dalil-public تفحص 3 ميقا للفيديو بنفسها
update storage.buckets set file_size_limit = 8388608 where id = 'events';

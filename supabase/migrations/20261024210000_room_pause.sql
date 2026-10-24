-- «إيقاف مؤقت» في غرفة الرحلة (صلاة/اجتماع): ما يوصل العضو صوت ولا إشعارات إلا الاستغاثة، ساعة كحد أقصى
alter table public.room_members add column if not exists paused_at timestamptz, add column if not exists paused_until timestamptz;
create index if not exists room_members_paused_until on public.room_members (paused_until) where paused_until is not null;
-- نهاية الإيقاف: كل دقيقة، ويُستدعى فقط إذا فيه عضو انتهت مدته (إشعار «انتهى الإيقاف المؤقت · فاتتك N رسائل»)
select cron.schedule('dalil-room-pause-tick','* * * * *', $$select net.http_post(url:='https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-rooms?a=pause_tick', headers:=jsonb_build_object('x-cron-key',(select value from public.private_config where key='cron_key'),'content-type','application/json'), body:='{}'::jsonb, timeout_milliseconds:=30000) where exists (select 1 from public.room_members where paused_until <= now())$$);
-- (تحديث) نفس المهمة تنظّف الغرف المنتهية وتطلّع جوالات الآيفون من قناة اللاسلكي
select cron.unschedule('dalil-room-pause-tick');
select cron.schedule('dalil-room-tick','* * * * *', $$select net.http_post(url:='https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-rooms?a=tick', headers:=jsonb_build_object('x-cron-key',(select value from public.private_config where key='cron_key'),'content-type','application/json'), body:='{}'::jsonb, timeout_milliseconds:=30000) where exists (select 1 from public.room_members where paused_until <= now()) or exists (select 1 from public.rooms where expires_at < now())$$);

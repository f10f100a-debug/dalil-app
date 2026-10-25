-- «حارس دليل»: سجل الفحص (7 أيام) + فحص كل ساعة
create table if not exists public.guard_log (at timestamptz primary key default now(), checks jsonb not null);
alter table public.guard_log enable row level security;
select cron.schedule('dalil-guard','7 * * * *', $$select net.http_post(url:='https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-guard?a=run', headers:=jsonb_build_object('x-cron-key',(select value from public.private_config where key='cron_key'),'content-type','application/json'), body:='{}'::jsonb, timeout_milliseconds:=90000)$$);

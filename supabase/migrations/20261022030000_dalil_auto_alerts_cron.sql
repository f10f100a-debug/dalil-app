-- تشغيل dalil-alerts كل 10 دقائق
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule('dalil-auto-alerts','*/10 * * * *', $$select net.http_post(url:='https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-alerts', headers:=jsonb_build_object('x-cron-key',(select value from public.private_config where key='cron_key'),'content-type','application/json'), body:='{}'::jsonb, timeout_milliseconds:=60000)$$);

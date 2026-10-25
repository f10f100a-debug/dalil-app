-- تنبيه اخضرار الفياض: نطاق كل مشترك وموقعه المقرّب (0.25° ≈ 25 كم) والفياض اللي يتابعها
create table if not exists public.fayd_watch (
  kind text not null check (kind in ('web','ios')),
  sub text not null,
  km int not null default 0 check (km in (0,50,100,250,500)),
  lat real, lng real,
  follow int[] not null default '{}',
  sent int[] not null default '{}',
  season int,
  last_sent timestamptz,
  updated_at timestamptz not null default now(),
  primary key (kind, sub)
);
alter table public.fayd_watch enable row level security;
-- مرتين باليوم (بعد تحديث الفياض الثلاثاء والجمعة)؛ الدالة تتجاهل إذا ما تغيّرت البيانات
select cron.schedule('dalil-fayd-alerts','20 5,17 * * *', $$select net.http_post(url:='https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-fayd?a=run', headers:=jsonb_build_object('x-cron-key',(select value from public.private_config where key='cron_key'),'content-type','application/json'), body:='{}'::jsonb, timeout_milliseconds:=120000) where exists (select 1 from public.fayd_watch)$$);

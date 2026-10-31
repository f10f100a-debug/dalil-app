-- تجربة صامتة: تنبؤ الرادار +30 د ومقارنته بالحقيقة (ومقارنة بافتراض «المطر يبقى مكانه»)
create table if not exists public.wx_nowcast (
  id bigint generated always as identity primary key,
  made timestamptz not null unique,
  valid timestamptz not null,
  cells int, blocks int, moved int,
  mask text, base text,
  hit int, miss int, fa int,
  p_hit int, p_miss int, p_fa int,
  obs_cells int,
  verified_at timestamptz
);
create index if not exists wx_nowcast_valid on public.wx_nowcast (valid) where verified_at is null;
alter table public.wx_nowcast enable row level security;

-- النتيجة: CSI للتنبؤ مقابل «ما يتحرك»
create or replace function public.wx_nowcast_stats(since timestamptz default now() - interval '14 days')
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'runs', count(*),
    'csi', round(sum(hit)::numeric / nullif(sum(hit) + sum(miss) + sum(fa), 0), 3),
    'csi_persist', round(sum(p_hit)::numeric / nullif(sum(p_hit) + sum(p_miss) + sum(p_fa), 0), 3),
    'pod', round(sum(hit)::numeric / nullif(sum(hit) + sum(miss), 0), 3),
    'far', round(sum(fa)::numeric / nullif(sum(hit) + sum(fa), 0), 3),
    'better_runs', count(*) filter (where hit::numeric / nullif(hit + miss + fa, 0) > p_hit::numeric / nullif(p_hit + p_miss + p_fa, 0))
  ) from public.wx_nowcast where verified_at is not null and made >= since;
$$;
revoke all on function public.wx_nowcast_stats(timestamptz) from public, anon, authenticated;

select cron.schedule('dalil-nowcast', '6-59/10 * * * *', $c$select net.http_post(url:='https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-nowcast', headers:=jsonb_build_object('x-cron-key',(select value from public.private_config where key='cron_key'),'content-type','application/json'), body:='{}'::jsonb, timeout_milliseconds:=90000)$c$);

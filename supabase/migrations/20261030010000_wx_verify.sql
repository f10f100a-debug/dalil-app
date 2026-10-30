-- قياس دقة رادار دليل: مقارنة الرادار فوق كل مطار سعودي بتقرير المطار نفسه (METAR) — للوحة الإدارة فقط
create table if not exists public.wx_verify (
  id bigserial primary key,
  station text not null, name text, lat real, lng real,
  obs_at timestamptz not null, frame timestamptz not null,
  wx text, raw text,
  obs_cat smallint not null,      -- 0 ما فيه، 1 مطر بالجوار (VC)، 2 مطر، 3 رعد أو مطر غزير
  dbz_here smallint,              -- أقوى صدى فوق المطار (±1.5 كم) = نفس حساب «فوقك» في التطبيق
  dbz_near smallint,              -- أقوى صدى خلال ~5 كم
  unique (station, obs_at)
);
alter table public.wx_verify enable row level security;
create index if not exists wx_verify_obs on public.wx_verify (obs_at desc);

create or replace function public.wx_verify_stats(since timestamptz)
returns json language sql security definer set search_path = public as $$
  with v as (select * from wx_verify where obs_at >= since)
  select json_build_object(
    'n', (select count(*) from v),
    'rain_obs', (select count(*) from v where obs_cat >= 2),
    'rain_caught', (select count(*) from v where obs_cat >= 2 and dbz_here >= 15),
    'radar_yes', (select count(*) from v where dbz_here >= 15),
    'radar_confirmed', (select count(*) from v where dbz_here >= 15 and obs_cat >= 1),
    'heavy_obs', (select count(*) from v where obs_cat = 3),
    'heavy_caught', (select count(*) from v where obs_cat = 3 and dbz_here >= 35),
    'recent', (select coalesce(json_agg(r order by r.obs_at desc), '[]') from (
       select station, name, obs_at, wx, obs_cat, dbz_here, dbz_near from v
       where obs_cat >= 1 or dbz_here >= 15 order by obs_at desc limit 25) r));
$$;
revoke all on function public.wx_verify_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.wx_verify_stats(timestamptz) to service_role;

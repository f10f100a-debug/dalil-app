-- «وين نزل البرد اليوم؟»: خلايا رادار ≥55 dBZ مع برق داخل المملكة آخر 24 ساعة (من تجربة wx_trial_cells)،
-- مجمّعة على شبكة 0.2° (~22 كم) — بدون برق = غالبًا تشويش (الكويت والخليج يطلع فيها ≥55 بدون برق ساعات)
-- + بلاغات الناس «🧊 برد» (rain_reports level=3) حولها، أو لحالها إذا ما فيه خلية رادار قريبة.
create or replace function public.recent_hail()
returns json language sql stable security definer set search_path = public as $$
  with c as (
    select frame, lat, lng, max_dbz, region from wx_trial_cells
    where frame > now() - interval '24 hours' and n55 > 0 and lightning is true and region is not null),
  g as (
    select max(frame) last, max(max_dbz) dbz, max(region) region,
           (array_agg(lat order by frame desc))[1] lat, (array_agg(lng order by frame desc))[1] lng
    from c group by round(lat * 5), round(lng * 5)),
  r as (select lat::float8 lat, lng::float8 lng, at from rain_reports where level = 3 and at > now() - interval '24 hours')
  select coalesce(json_agg(x order by x.t desc), '[]'::json) from (
    select round(g.lat::numeric, 3) lat, round(g.lng::numeric, 3) lng, g.last t, g.dbz, g.region,
           (select count(*) from r where abs(r.lat - g.lat) < 0.18 and abs(r.lng - g.lng) < 0.2) rep, 'radar' src from g
    union all
    select round(r.lat::numeric, 3), round(r.lng::numeric, 3), r.at, null, null, 1, 'report' from r
    where not exists (select 1 from g where abs(r.lat - g.lat) < 0.18 and abs(r.lng - g.lng) < 0.2)
    limit 60) x;
$$;
grant execute on function public.recent_hail() to anon, authenticated;

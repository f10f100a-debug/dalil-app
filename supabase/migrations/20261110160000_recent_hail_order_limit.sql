-- 10 نوفمبر مساءً: كان limit 60 بدون ترتيب يقطع أماكن عشوائية في الأيام الكثيرة (68 مكان → طاحت الغزالة جنوب حائل). نرتب الأحدث أول والحد 150.
CREATE OR REPLACE FUNCTION public.recent_hail()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with c as (
    select frame, lat, lng, max_dbz, region from wx_trial_cells
    where frame > now() - interval '24 hours' and n55 > 0 and lightning is true and region is not null),
  g as (
    select max(frame) last, max(max_dbz) dbz, max(region) region,
           (array_agg(lat order by frame desc))[1] lat, (array_agg(lng order by frame desc))[1] lng
    from c group by round(lat * 5), round(lng * 5)),
  r as (select lat::float8 lat, lng::float8 lng, at, ip_hash from rain_reports where level = 3 and at > now() - interval '24 hours'),
  lone as (
    select r.*, (select count(distinct r2.ip_hash) from r r2 where abs(r2.lat - r.lat) < 0.18 and abs(r2.lng - r.lng) < 0.2) n
    from r where not exists (select 1 from g where abs(r.lat - g.lat) < 0.18 and abs(r.lng - g.lng) < 0.2)),
  lone2 as (
    select distinct on (round(lat * 5), round(lng * 5)) lat, lng, at, n from lone where n >= 2
    order by round(lat * 5), round(lng * 5), at desc)
  select coalesce(json_agg(x order by x.t desc), '[]'::json) from (
    select round(g.lat::numeric, 3) lat, round(g.lng::numeric, 3) lng, g.last t, g.dbz, g.region,
           (select count(distinct r.ip_hash) from r where abs(r.lat - g.lat) < 0.18 and abs(r.lng - g.lng) < 0.2) rep, 'radar' src from g
    union all
    select round(lat::numeric, 3), round(lng::numeric, 3), at, null, null, n, 'report' from lone2
    order by 3 desc limit 150) x;
$function$;

-- أيام البرق لكل خلية من شبكة مطر الرادار (0.2°، نفس radar_daily): الخلية + الخلايا المجاورة لأي خلية رادار فيها برق ذاك اليوم.
-- تستخدمها tools/fayd/radar.py: الخلايا اللي فيها صدى أغلب الأيام (تشويش مزمن مثل شمال الشرقية) ما ينحسب مطرها إلا في أيام البرق.
create or replace function public.radar_lightning_days(p_since date)
returns json language sql stable security definer set search_path = public as $$
  with c as (
    select distinct date(frame at time zone 'Asia/Riyadh') d, floor((lat - 16) / 0.2)::int ri, floor((lng - 34) / 0.2)::int ci
    from wx_trial_cells where lightning is true and frame >= p_since::timestamptz - interval '3 hours'),
  n as (select distinct d, (ri + a) * 110 + (ci + b) k from c, generate_series(-1, 1) a, generate_series(-1, 1) b
        where ri + a between 0 and 82 and ci + b between 0 and 109)
  select coalesce(json_object_agg(d, ks), '{}'::json) from (select d::text d, array_agg(k order by k) ks from n group by d) x;
$$;
grant execute on function public.radar_lightning_days(date) to anon, authenticated;

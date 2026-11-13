-- 13 نوفمبر: آخر تنبؤ رادار +30 د (قناع خلايا ≥30 dBZ) للعرض التجريبي على الخريطة
create or replace function public.nowcast_latest()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('made', made, 'valid', valid, 'mask', mask)
  from wx_nowcast where mask is not null and made > now() - interval '40 minutes'
  order by made desc limit 1;
$$;
grant execute on function public.nowcast_latest() to anon, authenticated;

-- آخر تنبيهات المطر للعرض داخل التطبيق (قائمة «آخر التنبيهات»): آخر 48 ساعة، لمنطقة وحدة أو الكل
create or replace function public.recent_alerts(p_region text default '')
returns table(at timestamptz, region text, title text, body text, kind text)
language sql stable security definer set search_path = public as $$
  select a.at, a.region, a.title, a.body, a.kind
  from public.auto_alerts a
  where a.at > now() - interval '48 hours'
    and (coalesce(p_region, '') = '' or a.region = p_region)
    and coalesce(a.sent_web, 0) + coalesce(a.sent_ios, 0) > 0
  order by a.at desc
  limit 20;
$$;
grant execute on function public.recent_alerts(text) to anon, authenticated;

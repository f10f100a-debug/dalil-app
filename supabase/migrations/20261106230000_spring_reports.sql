-- «🌱 ربيع عندك؟»: بلاغ من الميدان (ما فيه / بداية / متوسط / كثيف) بموقع تقريبي ~1 كم، يظهر للناس 3 أيام على طبقة الربيع،
-- ونستخدمه لتأكيد اللي يشوفه القمر الصناعي. بدون هوية (بصمة مختصرة للجهاز والشبكة لمنع التكرار)، ويُحذف بعد 9 شهور.
create table if not exists public.spring_reports (
  id bigserial primary key,
  at timestamptz not null default now(),
  lat numeric(7,2) not null,
  lng numeric(7,2) not null,
  level smallint not null check (level between 0 and 3),
  dev text not null default '',
  ip text not null default ''
);
create index if not exists spring_reports_at on public.spring_reports (at);
create index if not exists spring_reports_dev on public.spring_reports (dev, at);
alter table public.spring_reports enable row level security;

create or replace function public.report_spring(p_lat float8, p_lng float8, p_level int, p_dev text)
returns json language plpgsql security definer set search_path = public as $$
declare
  hdr json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ipraw text := coalesce(hdr->>'cf-connecting-ip', split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1), '');
  iph text := left(md5('dalil-spring|' || ipraw), 16);
  devh text := left(md5('dalil-dev|' || coalesce(p_dev, '')), 16);
  la numeric := round(p_lat::numeric, 2); lo numeric := round(p_lng::numeric, 2);
begin
  if p_lat is null or p_lng is null or p_lat not between 15 and 33 or p_lng not between 33 and 57 or p_level not between 0 and 3
     or coalesce(length(p_dev), 0) not between 8 and 80 then return json_build_object('error', 'bad_request'); end if;
  if (select count(*) from spring_reports where ip = iph and at > now() - interval '1 day') >= 30 then return json_build_object('error', 'limit'); end if;
  update spring_reports set level = p_level, at = now() where dev = devh and lat = la and lng = lo and at > now() - interval '1 day';
  if not found then insert into spring_reports(lat, lng, level, dev, ip) values (la, lo, p_level, devh, iph); end if;
  delete from spring_reports where at < now() - interval '270 days';
  return json_build_object('ok', true);
end $$;
revoke all on function public.report_spring(float8, float8, int, text) from public;
grant execute on function public.report_spring(float8, float8, int, text) to anon, authenticated;

create or replace function public.spring_reports_recent()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('lat', lat, 'lng', lng, 'level', level, 'at', at)), '[]')
  from (select lat, lng, level, at from spring_reports where at > now() - interval '72 hours' order by at desc limit 1000) x
$$;
grant execute on function public.spring_reports_recent() to anon, authenticated;

-- مناطق تأكد فيها الربيع من الميدان: خانة ~5 كم (0.05°) فيها بلاغ «ربيع» (بداية فأكثر) من جهازين مختلفين على الأقل خلال آخر p_days يوم
create or replace function public.spring_field_points(p_days int default 10)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('lat', la, 'lng', lo, 'level', lv, 'n', n, 'at', at)), '[]')
  from (select round(avg(lat), 3) la, round(avg(lng), 3) lo, max(level) lv, count(distinct dev) n, max(at) at
        from spring_reports
        where level >= 1 and at > now() - make_interval(days => least(greatest(coalesce(p_days, 10), 1), 30))
        group by round(lat * 20), round(lng * 20)
        having count(distinct dev) >= 2) x
$$;
grant execute on function public.spring_field_points(int) to anon, authenticated;

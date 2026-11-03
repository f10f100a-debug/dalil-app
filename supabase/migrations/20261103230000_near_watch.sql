-- «نبّهني حسب موقعي» (اختياري، مطفي افتراضيًا): موقع تقريبي (مقرّب 0.05° ≈ 5 كم) يرسله التطبيق كل ما ينفتح، ويُحذف بعد 24 ساعة.
-- المرحلة الحالية: تجريب صامت — نحسب مين كان بيوصله تنبيه «متجه نحوك» ونسجّله بدون إرسال، لين نراجع النتائج.
create table if not exists public.near_watch (
  kind text not null check (kind in ('web','ios')),
  sub text not null,
  lat real not null, lng real not null,
  mode smallint not null default 1 check (mode in (1,2)),   -- 1 = موقعي + منطقتي، 2 = موقعي بس
  updated_at timestamptz not null default now(),
  primary key (kind, sub)
);
alter table public.near_watch enable row level security;

-- من التطبيق: لازم يكون اشتراك تنبيهات حقيقي. mode 0 = إيقاف (يحذف الموقع فورًا)
create or replace function public.set_near_watch(p_kind text, p_sub text, p_mode int, p_lat float8 default null, p_lng float8 default null)
returns json language plpgsql security definer set search_path = public as $$
declare k text := case when p_kind in ('web','ios') then p_kind end;
        s text := case when p_kind = 'ios' then lower(p_sub) else p_sub end;
begin
  if k is null or s is null or length(s) > 1000 then return json_build_object('error','bad_request'); end if;
  if k = 'ios' and not exists (select 1 from push_native where token = s) then return json_build_object('error','not_subscribed'); end if;
  if k = 'web' and not exists (select 1 from push_subs where endpoint = s) then return json_build_object('error','not_subscribed'); end if;
  if coalesce(p_mode,0) not in (1,2) then delete from near_watch where kind = k and sub = s; return json_build_object('ok',true,'off',true); end if;
  if p_lat is null or p_lng is null or p_lat not between 15 and 34 or p_lng not between 33 and 57 then return json_build_object('error','bad_location'); end if;
  insert into near_watch(kind, sub, lat, lng, mode, updated_at)
  values (k, s, round(p_lat::numeric * 20) / 20, round(p_lng::numeric * 20) / 20, p_mode, now())
  on conflict (kind, sub) do update set lat = excluded.lat, lng = excluded.lng, mode = excluded.mode, updated_at = now();
  return json_build_object('ok',true);
end $$;
revoke all on function public.set_near_watch(text,text,int,float8,float8) from public;
grant execute on function public.set_near_watch(text,text,int,float8,float8) to anon, authenticated;

-- المطابقة: خلية فيها برق و ≥50 dBZ، تتحرك نحو المستخدم (±45° من اتجاهها)، خلال 60 كم وتوصله خلال 90 دقيقة — أو فوقه (أقل من 8 كم)
-- p_w = [{"id":..,"lat":..,"lng":..}] — نفس الدالة للتجربة على نقاط وهمية وللتشغيل الحقيقي
create or replace function public.near_hits(p_from timestamptz, p_to timestamptz, p_w jsonb)
returns table(id text, frame timestamptz, kind text, km real, dir text, eta_min int, dbz int, cell_lat real, cell_lng real)
language sql stable set search_path = public as $$
  with w as (select x->>'id' id, (x->>'lat')::float8 la, (x->>'lng')::float8 lo from jsonb_array_elements(p_w) x),
  c as (select frame, lat, lng, max_dbz, n55, mv_kmh,
          (array_position(array['شمال','شمال شرق','شرق','جنوب شرق','جنوب','جنوب غرب','غرب','شمال غرب'], mv_dir) - 1) * 45 mv_deg
        from wx_trial_cells where frame > p_from and frame <= p_to and lightning and max_dbz >= 50),
  m as (select w.id, c.*,
          12742 * asin(sqrt(sin(radians(w.la - c.lat) / 2) ^ 2 + cos(radians(c.lat)) * cos(radians(w.la)) * sin(radians(w.lo - c.lng) / 2) ^ 2)) d,
          degrees(atan2(sin(radians(w.lo - c.lng)) * cos(radians(w.la)),
                        cos(radians(c.lat)) * sin(radians(w.la)) - sin(radians(c.lat)) * cos(radians(w.la)) * cos(radians(w.lo - c.lng)))) b
        from w join c on abs(w.la - c.lat) < 0.6 and abs(w.lo - c.lng) < 0.7)
  select m.id, m.frame, case when m.n55 > 0 then 'hail' else 'storm' end, round(m.d::numeric, 1)::real,
         -- اتجاه العاصفة من المستخدم (وين هي منه)
         (array['شمال','شمال شرق','شرق','جنوب شرق','جنوب','جنوب غرب','غرب','شمال غرب'])[(round(((m.b + 180)::numeric % 360) / 45)::int % 8) + 1],
         case when m.d < 8 then 0 else round(m.d / m.mv_kmh * 60)::int end, m.max_dbz, m.lat::real, m.lng::real
  from m
  where m.d < 8 or (m.d <= 60 and m.mv_deg is not null and m.mv_kmh >= 8
        and abs(((m.b - m.mv_deg)::numeric + 540) % 360 - 180) <= 45 and m.d / m.mv_kmh * 60 <= 90)
$$;
revoke all on function public.near_hits(timestamptz,timestamptz,jsonb) from public, anon, authenticated;

-- سجل التجربة الصامتة (بدون أي رمز اشتراك: بصمة مختصرة فقط)
create table if not exists public.near_dry_log (
  at timestamptz not null default now(), frame timestamptz not null, who text not null, kind text not null,
  km real, dir text, eta_min int, dbz int, cell_lat real, cell_lng real
);
create index if not exists near_dry_log_who_idx on public.near_dry_log (who, frame desc);
alter table public.near_dry_log enable row level security;

-- التشغيل كل 10 دقايق في الدالة dalil-near (تحذف المواقع بعد 24 ساعة، وتسجّل المطابقات بدون إرسال)
grant execute on function public.near_hits(timestamptz,timestamptz,jsonb) to service_role;
select cron.schedule('dalil-near-dry','3-59/10 * * * *', $$select net.http_post(url:='https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-near', headers:=jsonb_build_object('x-cron-key',(select value from public.private_config where key='cron_key'),'content-type','application/json'), body:='{}'::jsonb, timeout_milliseconds:=60000)$$);

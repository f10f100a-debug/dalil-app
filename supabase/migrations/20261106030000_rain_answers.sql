-- «نزل عندك مطر؟»: جواب بضغطة (لا / خفيف / غزير / سيل) بعد ما الرادار يشوف مطر حولك.
-- نحفظ موقع تقريبي (مقرّب 0.05° ≈ 5 كم) + الجواب + الوقت، بدون أي هوية. الهدف: كشف صدى الرادار الكاذب
-- (ناس كثير قالوا «لا» والرادار يقول مطر) واستخدام البلاغات كمحطة إضافية للفقع والفياض. تنحذف بعد الموسم (9 شهور).
create table if not exists public.rain_answers (
  id bigserial primary key,
  at timestamptz not null default now(),
  day date not null default (now() at time zone 'Asia/Riyadh')::date,
  lat numeric(6,2) not null,
  lng numeric(6,2) not null,
  ans smallint not null check (ans between 0 and 3),   -- 0 لا ما نزل · 1 خفيف · 2 غزير · 3 سيل
  radar_mm real,                                        -- وش كان الرادار يقول وقتها (للمقارنة)
  src text not null default 'card' check (src in ('card','push','map')),
  dev text not null default '',                         -- بصمة مختصرة للجهاز (لمنع التكرار فقط)
  ip text not null default ''
);
create index if not exists rain_answers_day on public.rain_answers (day);
create index if not exists rain_answers_dev on public.rain_answers (dev, day);
alter table public.rain_answers enable row level security;

-- مطر الرادار اليوم حول نقطة (أعلى قيمة في مربع 3×3 من خلايا 0.2° ≈ 60 كم) — من radar_daily، مع استبعاد الصدى الثابت
create or replace function public.rain_near_today(p_lat float8, p_lng float8)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  rc constant int := 110; rr constant int := 83;
  ci int := floor((p_lat - 16.0) / 0.2); cj int := floor((p_lng - 34.0) / 0.2);
  r record; a bytea; h bytea; k int; v real; best real := 0; bday date; thr real;
  today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if ci < 1 or ci >= rr - 1 or cj < 1 or cj >= rc - 1 then return json_build_object('mm', 0); end if;
  for r in select d.day, d.acc, d.hits, d.frames from radar_daily d
           where d.day = today or (d.day = today - 1 and extract(hour from now() at time zone 'Asia/Riyadh') < 10) loop
    a := decode(r.acc, 'base64'); h := decode(r.hits, 'base64'); thr := greatest(6, 0.6 * r.frames);
    for di in -1..1 loop for dj in -1..1 loop
      k := (ci + di) * rc + (cj + dj);
      if 2 * k + 1 < length(a) and (get_byte(h, 2 * k) + 256 * get_byte(h, 2 * k + 1)) <= thr then
        v := (get_byte(a, 2 * k) + 256 * get_byte(a, 2 * k + 1)) / 10.0;
        if v > best then best := v; bday := r.day; end if;
      end if;
    end loop; end loop;
  end loop;
  return json_build_object('mm', round(best::numeric, 1), 'day', bday);
end $$;
grant execute on function public.rain_near_today(float8, float8) to anon, authenticated;

-- حفظ الجواب: جواب واحد لكل جهاز في اليوم (يقدر يعدّله)، وحد 30 جواب لكل شبكة في اليوم
create or replace function public.answer_rain(p_lat float8, p_lng float8, p_ans int, p_dev text, p_src text default 'card')
returns json language plpgsql security definer set search_path = public as $$
declare
  hdr json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ipraw text := coalesce(hdr->>'cf-connecting-ip', split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1), '');
  iph text := left(md5('dalil-rain|' || ipraw), 16);
  devh text := left(md5('dalil-dev|' || coalesce(p_dev, '')), 16);
  today date := (now() at time zone 'Asia/Riyadh')::date;
  mm real;
begin
  if p_lat is null or p_lng is null or p_lat not between 15 and 33 or p_lng not between 33 and 57 or p_ans not between 0 and 3
     or coalesce(length(p_dev), 0) not between 8 and 80 then return json_build_object('error', 'bad_request'); end if;
  if (select count(*) from rain_answers where ip = iph and day = today) >= 30 then return json_build_object('error', 'limit'); end if;
  select (rain_near_today(p_lat, p_lng)->>'mm')::real into mm;
  update rain_answers set ans = p_ans, at = now(), lat = round(p_lat::numeric * 20) / 20, lng = round(p_lng::numeric * 20) / 20, radar_mm = mm
   where dev = devh and day = today;
  if not found then
    insert into rain_answers(lat, lng, ans, radar_mm, src, dev, ip)
    values (round(p_lat::numeric * 20) / 20, round(p_lng::numeric * 20) / 20, p_ans, mm,
            case when p_src in ('card','push','map') then p_src else 'card' end, devh, iph);
  end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.answer_rain(float8, float8, int, text, text) from public;
grant execute on function public.answer_rain(float8, float8, int, text, text) to anon, authenticated;

-- للخريطة: أجوبة آخر 24 ساعة (موقع تقريبي + الجواب + الوقت فقط)
create or replace function public.rain_answers_recent()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('lat', lat, 'lng', lng, 'ans', ans, 'at', at)), '[]')
  from (select lat, lng, ans, at from rain_answers where at > now() - interval '24 hours' order by at desc limit 1000) x
$$;
grant execute on function public.rain_answers_recent() to anon, authenticated;
-- الحذف بعد الموسم (أقدم من 9 شهور) في الدالة dalil-near مع تنظيف المواقع

-- «مطر عندي الآن»: بلاغات المستخدمين (موقع تقريبي ~1 كم) تظهر للجميع 3 ساعات ثم تُحذف خلال يوم
create table if not exists public.rain_reports (
  id bigserial primary key,
  at timestamptz not null default now(),
  lat numeric(7,2) not null,
  lng numeric(7,2) not null,
  level smallint not null check (level between 1 and 3),
  ip_hash text not null default ''
);
create index if not exists rain_reports_at on public.rain_reports (at);
create index if not exists rain_reports_ip on public.rain_reports (ip_hash, at);
alter table public.rain_reports enable row level security;
revoke select on public.rain_reports from anon, authenticated;   -- ip_hash لا يُقرأ من الخارج
grant select (lat, lng, level, at) on public.rain_reports to anon, authenticated;
create policy rain_reports_recent on public.rain_reports for select to anon, authenticated using (at > now() - interval '3 hours');

-- «الأحداث» والتنبيهات لتطبيق دليل.
-- القراءة العامة: الأحداث المعتمدة غير المنتهية فقط (أعمدة محددة).
-- كل الكتابة تتم عبر Edge Functions بمفتاح الخدمة. الجداول الأخرى بلا سياسات = لا وصول عام.
-- ملاحظة: مفاتيح VAPID وكلمة سر الإدارة (مُجزّأة) وملح عناوين IP تُحفظ في app_config خارج المستودع.
create extension if not exists pgcrypto;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 days',
  status text not null default 'pending' check (status in ('pending','approved','rejected','hidden')),
  kind text not null check (kind in ('rain','flood','spring','dust','road','other')),
  caption text not null default '' check (char_length(caption) <= 140),
  nickname text not null default '' check (char_length(nickname) <= 24),
  region text not null default '' check (char_length(region) <= 40),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  photo_path text not null,
  thumb_path text not null,
  width int, height int,
  reports int not null default 0,
  device text not null default '' check (char_length(device) <= 64),
  ip_hash text not null default '',
  approved_at timestamptz
);
create index events_public_idx on public.events (status, expires_at desc, created_at desc);
create index events_ip_idx on public.events (ip_hash, created_at);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant select (id, created_at, expires_at, kind, caption, nickname, region, lat, lng, photo_path, thumb_path, width, height) on public.events to anon, authenticated;
create policy "public reads approved live events" on public.events
  for select to anon, authenticated
  using (status = 'approved' and expires_at > now());

create table public.push_subs (
  endpoint text primary key check (char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  region text not null default '' check (char_length(region) <= 40),
  created_at timestamptz not null default now(),
  last_ok timestamptz
);
alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon, authenticated;

create table public.reports (
  event_id uuid not null references public.events(id) on delete cascade,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  primary key (event_id, ip_hash)
);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

create table public.admin_attempts (
  ip_hash text not null,
  at timestamptz not null default now(),
  ok boolean not null
);
create index admin_attempts_idx on public.admin_attempts (ip_hash, at);
alter table public.admin_attempts enable row level security;
revoke all on public.admin_attempts from anon, authenticated;

create table public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('events', 'events', true, 1048576, array['image/jpeg']),
       ('pending', 'pending', false, 1048576, array['image/jpeg']);

-- إشراف غرفة الرحلة: حفظ التسجيل المبلّغ عنه للمراجعة، ومنع المخالفين من الغرف.
alter table public.room_members add column if not exists ip_hash text;
alter table public.room_reports add column if not exists voice_path text;
alter table public.room_reports add column if not exists target_ip text;
alter table public.room_reports add column if not exists room_code text;
create index if not exists room_reports_status_idx on public.room_reports (status, created_at desc);
create table if not exists public.room_bans (
  ip_hash text primary key,
  reason text,
  created_at timestamptz not null default now(),
  until timestamptz
);
alter table public.room_bans enable row level security;

-- تقارير أخطاء التطبيق (بدون بيانات شخصية): الرسالة ومكانها وإصدار التطبيق، تُحذف بعد 14 يومًا
create table if not exists public.client_errors (
  id bigserial primary key,
  at timestamptz not null default now(),
  ip_hash text not null default '',
  ver text not null default '',
  page text not null default '',
  msg text not null default '',
  src text not null default ''
);
create index if not exists client_errors_at on public.client_errors (at);
create index if not exists client_errors_ip on public.client_errors (ip_hash, at);
alter table public.client_errors enable row level security;

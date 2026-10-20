-- تنبيهات تطبيق الآيفون الأصلية (APNs): رمز الجهاز والمنطقة فقط.
create table if not exists public.push_native (
  token text primary key check (token ~ '^[0-9a-f]{64,200}$'),
  region text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_native_region_idx on public.push_native (region);
alter table public.push_native enable row level security;

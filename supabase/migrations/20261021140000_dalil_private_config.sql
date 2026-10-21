create table if not exists public.private_config (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.private_config enable row level security;
revoke all on public.private_config from anon, authenticated;
-- القيم (مفتاح APNs) تُدخل يدويًا ولا تُحفظ في المستودع

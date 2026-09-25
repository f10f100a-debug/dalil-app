-- مشرفون متعددون بصلاحيات، وسجل عمليات.
create table public.admins (
  username text primary key check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  role text not null default 'moderator' check (role in ('owner','moderator')),
  perms text[] not null default '{moderate}',
  pass_salt text not null,
  pass_hash text not null,
  pass_iter int not null default 210000,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login timestamptz
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create table public.admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  username text not null,
  action text not null,
  detail text not null default '' check (char_length(detail) <= 200)
);
create index admin_log_at_idx on public.admin_log (at desc);
alter table public.admin_log enable row level security;
revoke all on public.admin_log from anon, authenticated;

-- نُقل المالك (admin) من app_config ثم حُذفت مفاتيح كلمة السر القديمة من app_config.

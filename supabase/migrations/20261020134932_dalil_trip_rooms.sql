-- غرفة الرحلة: غرف برقم سري (حتى 15 عضوًا) تنتهي بعد 24 ساعة.
-- المواقع لا تُخزَّن هنا: تنتقل مباشرة بين الأعضاء عبر Realtime Broadcast.
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  pin_hash text not null,
  name text not null default '',
  secret text not null,
  rally jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  ip_hash text
);
create index rooms_expires_idx on public.rooms (expires_at);

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  member_id text not null,
  token_hash text not null,
  name text not null,
  color text not null,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  kicked boolean not null default false,
  left_room boolean not null default false,
  primary key (room_id, member_id)
);

create table public.room_mutes (
  room_id uuid not null references public.rooms(id) on delete cascade,
  muter_id text not null,
  target_id text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, muter_id, target_id)
);

create table public.room_voice (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  member_id text not null,
  path text not null,
  mime text not null,
  duration real,
  created_at timestamptz not null default now()
);
create index room_voice_room_idx on public.room_voice (room_id, created_at desc);

create table public.room_reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete set null,
  reporter_id text,
  target_id text,
  target_name text,
  reason text,
  voice_id uuid,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table public.room_attempts (
  ip_hash text not null,
  kind text not null,
  created_at timestamptz not null default now()
);
create index room_attempts_idx on public.room_attempts (ip_hash, kind, created_at);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_mutes enable row level security;
alter table public.room_voice enable row level security;
alter table public.room_reports enable row level security;
alter table public.room_attempts enable row level security;
-- لا سياسات: الوصول فقط عبر الدالة dalil-rooms (service role).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('room-voice', 'room-voice', false, 600000, array['audio/mp4','audio/aac','audio/webm','audio/ogg','audio/mpeg','audio/x-m4a'])
on conflict (id) do nothing;

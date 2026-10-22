-- من سمع كل رسالة صوتية في غرفة الرحلة (علامة «سمعها فلان»)، تُحذف مع الرسالة
create table if not exists public.room_voice_heard (
  voice_id uuid not null references public.room_voice(id) on delete cascade,
  member_id text not null,
  at timestamptz not null default now(),
  primary key (voice_id, member_id)
);
alter table public.room_voice_heard enable row level security;
revoke all on public.room_voice_heard from anon, authenticated;

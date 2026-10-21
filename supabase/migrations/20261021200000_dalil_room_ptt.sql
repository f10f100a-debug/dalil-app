-- 1.4: رمز اللاسلكي (Apple PushToTalk) لكل عضو في الغرفة — يُحذف عند الخروج
alter table public.room_members add column if not exists ptt_token text
  check (ptt_token is null or ptt_token ~ '^[0-9a-f]{64,200}$');

alter table public.room_members add column if not exists push_token text check (push_token is null or push_token ~ '^[0-9a-f]{64,200}$');
alter table public.room_members add column if not exists last_push_at timestamptz;

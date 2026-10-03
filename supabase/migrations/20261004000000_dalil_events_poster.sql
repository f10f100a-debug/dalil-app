-- معرّف ناشر مجهول للحظر داخل التطبيق (متطلب أبل 1.2): بصمة من رقم الجهاز العشوائي، لا يكشف الرقم نفسه.
alter table public.events add column if not exists poster text generated always as (case when device = '' then '' else left(md5('dalil-poster:' || device), 16) end) stored;
grant select (poster) on public.events to anon, authenticated;

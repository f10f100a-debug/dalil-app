-- غرفة الرحلة: «أبو سعود» كان يطلع مرتين — دخل مرة (من المتصفح غالبًا) وما اشتغل، وبعد دقيقة ونص دخل من التطبيق.
-- (1) دخول جديد بنفس الاسم ومن نفس الشبكة: النسخة القديمة تنشال إذا ما اشتغلت أبدًا بعد دخولها (آخر ظهور = لحظة الدخول)
--     ومرّت عليها دقيقة. أي عضو اشتغل ولو مرة (حتى لو جواله مقفل الحين) ما ينلمس.
create or replace function public.room_member_dedupe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update room_members o set left_room = true
   where o.room_id = new.room_id and o.member_id <> new.member_id
     and not o.kicked and not o.left_room
     and o.ip_hash = new.ip_hash
     and lower(regexp_replace(btrim(o.name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(new.name), '\s+', ' ', 'g'))
     and o.last_seen < now() - interval '1 minute'
     and o.last_seen - o.joined_at < interval '1 minute';
  return new;
end $$;
create or replace trigger room_member_dedupe after insert on public.room_members for each row execute function public.room_member_dedupe();

-- (2) «شبح»: دخل وما اشتغل ولا مرة بعد دخوله، وما سجّل تطبيق (لا تنبيهات ولا لاسلكي)، ومرّت 30 دقيقة → يختفي ولا ينحسب من الـ 15
create or replace function public.room_ghosts_cleanup() returns integer
language sql security definer set search_path = public as $$
  with g as (
    update room_members set left_room = true
     where not kicked and not left_room
       and last_seen < now() - interval '30 minutes'
       and last_seen - joined_at < interval '1 minute'
       and push_token is null and ptt_token is null
    returning 1)
  select count(*)::int from g;
$$;
revoke all on function public.room_ghosts_cleanup() from public, anon, authenticated;
revoke all on function public.room_member_dedupe() from public, anon, authenticated;
select cron.schedule('dalil-room-ghosts', '*/5 * * * *', $$select public.room_ghosts_cleanup()$$);

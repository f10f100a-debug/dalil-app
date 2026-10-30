-- الحارس يرجّع يشغّل جدول تلقائي موقوف (جداول دليل فقط) — إصلاح تلقائي
create or replace function public.guard_cron_enable(j text)
returns boolean language plpgsql security definer set search_path = cron, public as $$
declare jid bigint;
begin
  if j !~ '^dalil-[a-z0-9-]+$' then return false; end if;
  select jobid into jid from cron.job where jobname = j and not active;
  if jid is null then return false; end if;
  perform cron.alter_job(jid, active := true);
  return true;
end $$;
revoke all on function public.guard_cron_enable(text) from public, anon, authenticated;
grant execute on function public.guard_cron_enable(text) to service_role;

-- حارس دليل: حالة الجداول التلقائية (pg_cron) — للخدمة فقط
create or replace function public.guard_cron_status()
returns table(jobname text, schedule text, active boolean, runs24 bigint, fails24 bigint, last_run timestamptz, last_err text)
language sql security definer set search_path = cron, pg_catalog as $$
  select j.jobname::text, j.schedule::text, j.active,
    count(d.*) filter (where d.start_time > now() - interval '24 hours'),
    count(d.*) filter (where d.status = 'failed' and d.start_time > now() - interval '24 hours'),
    max(d.start_time),
    (select left(d2.return_message, 120) from cron.job_run_details d2 where d2.jobid = j.jobid and d2.status = 'failed' order by d2.start_time desc limit 1)
  from cron.job j left join cron.job_run_details d on d.jobid = j.jobid
  where j.jobname like 'dalil-%'
  group by j.jobid, j.jobname, j.schedule, j.active;
$$;
revoke all on function public.guard_cron_status() from public, anon, authenticated;
grant execute on function public.guard_cron_status() to service_role;

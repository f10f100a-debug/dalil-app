-- تجربة صامتة (أسبوعين): «أقرب مطر غزير وبرد» — نسجّل بدون عرض للمستخدمين، ونقارن بعدين بالبرق وبلاغات الناس وERA5
create table if not exists public.wx_trial_cells (
  id bigserial primary key,
  frame timestamptz not null,          -- وقت صورة الرادار
  lat real not null, lng real not null, -- مركز الخلية
  region text,
  max_dbz smallint not null,           -- أعلى قوة بالخلية
  n int not null,                      -- عدد خانات ≥45 (كل خانة ~5 كم)
  n55 int not null default 0,          -- خانات ≥55 (احتمال برد)
  lightning boolean,                   -- برق خلال ~10 كم (null = بيانات البرق ما وصلت)
  mv_kmh smallint, mv_dir text
);
create index if not exists wx_trial_cells_frame on public.wx_trial_cells(frame);
create table if not exists public.wx_trial_fc (
  id bigserial primary key,
  made_at timestamptz not null default now(),
  lat real not null, lng real not null, region text,
  kind text not null,                  -- heavy (≥10 ملم/3 س باتفاق نموذجين) أو storm (طاقة عواصف عالية)
  agree smallint not null,             -- كم نموذج متفق
  win_from timestamptz not null, win_to timestamptz not null,
  mm real, cape real
);
create index if not exists wx_trial_fc_made on public.wx_trial_fc(made_at);
alter table public.wx_trial_cells enable row level security;
alter table public.wx_trial_fc enable row level security;
-- توقعات التجربة: مرتين باليوم (7:40ص و7:40م بتوقيت الرياض)
select cron.schedule('dalil-wx-trial-fc', '40 4,16 * * *', $$select net.http_post(url:='https://penhpgvjtxytgyrhmetg.supabase.co/functions/v1/dalil-alerts?a=fc', headers:=jsonb_build_object('x-cron-key',(select value from public.private_config where key='cron_key'),'content-type','application/json'), body:='{}'::jsonb, timeout_milliseconds:=120000)$$);

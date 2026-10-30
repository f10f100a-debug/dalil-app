-- نوع تنبيه المطر: storm (عادي) أو city («الآن على المدينة» — مرة لكل مدينة كل 12 ساعة)
alter table public.auto_alerts add column if not exists kind text not null default 'storm';

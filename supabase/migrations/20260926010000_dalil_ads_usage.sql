-- الإعلانات المباشرة (يديرها صاحب التطبيق) + عدّاد استخدام مجهول الهوية.
create table public.ads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  active boolean not null default false,
  title text not null check (char_length(title) between 1 and 60),
  body text not null default '' check (char_length(body) <= 140),
  image_path text check (image_path is null or char_length(image_path) <= 80),
  cta_label text not null default 'زيارة' check (char_length(cta_label) between 1 and 24),
  cta_url text not null check (char_length(cta_url) <= 500 and (cta_url like 'https://%' or cta_url like 'tel:%')),
  region text not null default '' check (char_length(region) <= 40),
  placement text not null default 'both' check (placement in ('events','places','both')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null default now() + interval '30 days',
  advertiser text not null default '' check (char_length(advertiser) <= 60)
);
alter table public.ads enable row level security;
revoke all on public.ads from anon, authenticated;
grant select (id, title, body, image_path, cta_label, cta_url, region, placement) on public.ads to anon, authenticated;
create policy "public reads running ads" on public.ads for select to anon, authenticated
  using (active and now() between starts_at and ends_at);

create table public.ad_stats (
  ad_id uuid not null references public.ads(id) on delete cascade,
  day date not null,
  region text not null default '',
  impressions int not null default 0,
  clicks int not null default 0,
  primary key (ad_id, day, region)
);
alter table public.ad_stats enable row level security;
revoke all on public.ad_stats from anon, authenticated;

create table public.usage_daily (
  day date not null,
  region text not null default '',
  opens int not null default 0,
  primary key (day, region)
);
alter table public.usage_daily enable row level security;
revoke all on public.usage_daily from anon, authenticated;

-- منع التكرار: كل بصمة IP (مملّحة) تُحسب مرة واحدة يوميًا لكل مفتاح. تُحذف بعد يومين.
create table public.ping_seen (
  ip_hash text not null,
  day date not null,
  key text not null check (char_length(key) <= 60),
  primary key (ip_hash, day, key)
);
alter table public.ping_seen enable row level security;
revoke all on public.ping_seen from anon, authenticated;

create or replace function public.dalil_count(p_ip text, p_key text, p_region text, p_ad uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Riyadh')::date; n int;
begin
  insert into ping_seen(ip_hash, day, key) values (p_ip, d, p_key) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  if p_kind = 'open' then
    insert into usage_daily(day, region, opens) values (d, p_region, 1)
      on conflict (day, region) do update set opens = usage_daily.opens + 1;
  elsif p_kind = 'imp' then
    insert into ad_stats(ad_id, day, region, impressions) values (p_ad, d, p_region, 1)
      on conflict (ad_id, day, region) do update set impressions = ad_stats.impressions + 1;
  elsif p_kind = 'click' then
    insert into ad_stats(ad_id, day, region, clicks) values (p_ad, d, p_region, 1)
      on conflict (ad_id, day, region) do update set clicks = ad_stats.clicks + 1;
  end if;
  delete from ping_seen where day < d - 2;
  return true;
end $$;
revoke all on function public.dalil_count(text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.dalil_count(text, text, text, uuid, text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ads', 'ads', true, 524288, array['image/jpeg']);

-- «تعرف اسمها؟»: اقتراح اسم لفيضة اكتشفها القمر الصناعي بدون اسم. نحفظ الاسم + مكان البقعة (من ملف عام) + بصمة مختصرة لمنع التكرار.
-- المطوّر يراجع الاقتراحات، والاسم المؤكد ينضاف لقائمة الفياض (data/fayd-sites.json).
create table if not exists public.fayd_name_suggest (
  id bigserial primary key,
  at timestamptz not null default now(),
  lat numeric(7,4) not null,
  lng numeric(7,4) not null,
  name text not null check (length(name) between 2 and 40),
  dev text not null default '',
  ip text not null default '',
  status smallint not null default 0          -- 0 جديد · 1 مقبول · 2 مرفوض
);
create index if not exists fayd_name_suggest_at on public.fayd_name_suggest (at);
alter table public.fayd_name_suggest enable row level security;

create or replace function public.suggest_fayd_name(p_lat float8, p_lng float8, p_name text, p_dev text)
returns json language plpgsql security definer set search_path = public as $$
declare
  hdr json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ipraw text := coalesce(hdr->>'cf-connecting-ip', split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1), '');
  iph text := left(md5('dalil-fname|' || ipraw), 16);
  devh text := left(md5('dalil-dev|' || coalesce(p_dev, '')), 16);
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if p_lat is null or p_lng is null or p_lat not between 15 and 33 or p_lng not between 33 and 57
     or length(nm) not between 2 and 40 or nm ~ '(https?:|www\.|[<>@#]|[0-9]{5,})'
     or coalesce(length(p_dev), 0) not between 8 and 80 then return json_build_object('error', 'bad_request'); end if;
  if (select count(*) from fayd_name_suggest where ip = iph and at > now() - interval '1 day') >= 20 then return json_build_object('error', 'limit'); end if;
  update fayd_name_suggest set name = nm, at = now()
   where dev = devh and abs(lat - p_lat::numeric) < 0.005 and abs(lng - p_lng::numeric) < 0.005 and status = 0;
  if not found then
    insert into fayd_name_suggest(lat, lng, name, dev, ip) values (round(p_lat::numeric, 4), round(p_lng::numeric, 4), nm, devh, iph);
  end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.suggest_fayd_name(float8, float8, text, text) from public;
grant execute on function public.suggest_fayd_name(float8, float8, text, text) to anon, authenticated;

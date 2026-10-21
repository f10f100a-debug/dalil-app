-- فيديو قصير للأحداث (حتى 10 ثوانٍ، مضغوط في الجوال) — يبقى ضمن الخطة المجانية
alter table public.events add column if not exists video_path text, add column if not exists video_dur real;
grant select (video_path, video_dur) on public.events to anon, authenticated;
update storage.buckets set file_size_limit = 3145728, allowed_mime_types = array['image/jpeg','video/mp4'] where id in ('events','pending');

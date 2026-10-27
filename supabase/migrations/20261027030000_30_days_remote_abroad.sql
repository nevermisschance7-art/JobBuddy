-- 1. Remote jobs limited to other countries ("Remote - US only") a user still wants to see,
--    e.g. to work as a contractor. Shown with a "Potential restriction" chip.
alter table public.filters
  add column remote_extra_countries text[] not null default '{}';

-- 2. Keep jobs for 30 days (was 60): open jobs posted more than 30 days ago are deleted daily
--    unless someone applied.
create or replace function public.prune_stale_jobs()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted int;
begin
  delete from public.jobs j
  where j.posted_at < now() - interval '30 days'
    and not exists (select 1 from public.applications a where a.job_id = j.id);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- 3. Shorter stored descriptions (6,000 characters is enough to match and tailor on).
update public.jobs set description_text = left(description_text, 6000)
where length(description_text) > 6000;

select public.prune_stale_jobs();

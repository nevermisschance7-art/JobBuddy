-- More jobs: store remote tech jobs posted within 7 days (was 48 hours) and keep them
-- 10 days (was 4), unless someone has an application for them.
-- source_runs.dropped: per run, how many listed jobs were not stored and why
-- (too_old, no_date, not_remote, not_tech, unreadable).

alter table public.source_runs add column dropped jsonb not null default '{}';

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
  where (j.posted_at < now() - interval '10 days' or j.posted_at is null)
    and not exists (select 1 from public.applications a where a.job_id = j.id);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

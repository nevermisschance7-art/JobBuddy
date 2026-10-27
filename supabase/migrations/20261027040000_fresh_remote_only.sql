-- Fresh remote jobs only: stored when posted in the last 48 hours, kept for 4 days.

-- 1. Three more employer systems.
alter table public.companies drop constraint companies_ats_check;
alter table public.companies add constraint companies_ats_check check (
  ats in ('greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'teamtailor',
          'workday', 'personio', 'recruitee')
);

-- 2. Delete open jobs posted more than 4 days ago (or with no posting date) unless someone
--    applied. Runs hourly now that the window is short.
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
  where (j.posted_at < now() - interval '4 days' or j.posted_at is null)
    and not exists (select 1 from public.applications a where a.job_id = j.id);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

select cron.unschedule('prune-stale-jobs');
select cron.schedule('prune-stale-jobs', '41 * * * *', $$select public.prune_stale_jobs()$$);

-- 3. Remove what the new rules no longer keep: office and hybrid jobs.
delete from public.jobs j
where coalesce(j.remote_type, '') <> 'remote'
  and not exists (select 1 from public.applications a where a.job_id = j.id);

select public.prune_stale_jobs();

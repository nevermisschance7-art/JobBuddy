-- Keep the free database small: open jobs posted more than 60 days ago are rarely worth
-- applying to. Delete them daily unless someone applied (matches cascade).

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
  where j.posted_at < now() - interval '60 days'
    and not exists (select 1 from public.applications a where a.job_id = j.id);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function public.prune_stale_jobs() from public, anon, authenticated;

select cron.schedule('prune-stale-jobs', '37 3 * * *', $$select public.prune_stale_jobs()$$);
select public.prune_stale_jobs();

-- Daily counts for the charts: jobs posted (by their real posting date) and applications
-- sent, per UTC day for the last p_days days (jobs are kept 10 days, so 10 is the default).

-- One user: jobs that passed their filters, and their applications. Runs as the caller, so
-- RLS limits it to their own rows.
create or replace function public.my_daily_activity(p_days int default 10)
returns table (day date, jobs_posted int, applied int)
language sql
stable
security invoker
set search_path = ''
as $$
  with days as (
    select (current_date - g)::date as d from generate_series(0, least(p_days, 60) - 1) g
  )
  select
    d,
    (select count(*) from public.user_job_matches m
       join public.jobs j on j.id = m.job_id
      where m.user_id = (select auth.uid()) and m.passed_filters
        and j.posted_at >= d and j.posted_at < d + 1)::int,
    (select count(*) from public.applications a
      where a.user_id = (select auth.uid())
        and a.applied_at >= d and a.applied_at < d + 1)::int
  from days
  order by d;
$$;

-- The whole team (admin page): all stored jobs and all applications. Server only.
create or replace function public.team_daily_activity(p_days int default 10)
returns table (day date, jobs_posted int, applied int)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select (current_date - g)::date as d from generate_series(0, least(p_days, 60) - 1) g
  )
  select
    d,
    (select count(*) from public.jobs j where j.posted_at >= d and j.posted_at < d + 1)::int,
    (select count(*) from public.applications a where a.applied_at >= d and a.applied_at < d + 1)::int
  from days
  order by d;
$$;

revoke execute on function public.team_daily_activity(int) from public, anon, authenticated;

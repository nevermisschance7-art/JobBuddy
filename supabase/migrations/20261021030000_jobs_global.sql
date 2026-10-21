-- Worldwide jobs: remote regions (e.g. a remote job limited to Europe), tags from boards,
-- and a dedupe key so the same job from several sources is stored once.

alter table public.jobs
  add column remote_regions text[] not null default '{}',
  add column tags text[] not null default '{}',
  add column dedupe_key text;

create index jobs_dedupe_key_idx on public.jobs (dedupe_key) where closed_at is null;
create index jobs_remote_regions_idx on public.jobs using gin (remote_regions);
create index jobs_source_open_idx on public.jobs (source, company_id) where closed_at is null;

-- Run counts per source for the health page.
alter table public.source_runs
  add column jobs_updated int not null default 0,
  add column jobs_closed int not null default 0;

-- Discovery bookkeeping on companies (prompt 5 uses these too).
alter table public.companies
  add column jobs_open int not null default 0,
  add column last_error text;

-- Bookkeeping helpers for the fetch worker (service role only).

create or replace function public.mark_jobs_seen(ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.jobs
  set last_seen_at = now(), missed_runs = 0, closed_at = null
  where id = any(ids);
$$;

-- A job missing from a complete employer listing: closed after 2 runs in a row.
create or replace function public.mark_jobs_missed(ids uuid[])
returns int
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.jobs
    set missed_runs = missed_runs + 1,
        closed_at = case when missed_runs + 1 >= 2 then now() else closed_at end
    where id = any(ids) and closed_at is null
    returning closed_at
  )
  select count(*)::int from updated where closed_at is not null;
$$;

-- Aggregators only list their newest jobs, so absence proves nothing there.
-- Their jobs close once not seen for p_days.
create or replace function public.close_stale_jobs(p_source text, p_days int)
returns int
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.jobs
    set closed_at = now()
    where source = p_source
      and closed_at is null
      and last_seen_at < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*)::int from updated;
$$;

revoke execute on function public.mark_jobs_seen(uuid[]) from public, anon, authenticated;
revoke execute on function public.mark_jobs_missed(uuid[]) from public, anon, authenticated;
revoke execute on function public.close_stale_jobs(text, int) from public, anon, authenticated;
grant execute on function public.mark_jobs_seen(uuid[]) to service_role;
grant execute on function public.mark_jobs_missed(uuid[]) to service_role;
grant execute on function public.close_stale_jobs(text, int) to service_role;

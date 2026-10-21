-- Company discovery: when each company was last verified and where it was found,
-- plus per-system counts for the health page.

alter table public.companies
  add column checked_at timestamptz,
  add column discovered_via text not null default 'seed'
    check (discovered_via in ('seed', 'job_links', 'common_crawl', 'manual'));

create index companies_inactive_checked_idx on public.companies (checked_at) where not active;

create view public.company_stats
with (security_invoker = true)
as
select
  ats,
  count(*) filter (where active) as active,
  count(*) filter (where not active) as inactive,
  coalesce(sum(jobs_open) filter (where active), 0) as jobs_open,
  max(created_at) as last_added_at
from public.companies
group by ats;

grant select on public.company_stats to authenticated, service_role;

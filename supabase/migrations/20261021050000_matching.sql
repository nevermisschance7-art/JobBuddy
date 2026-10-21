-- Matching support.
-- profiles.matched_at: when this user's matches were last fully rescored. A CV or filter
-- change after that triggers a full rescore; otherwise only new or changed jobs are scored.

alter table public.profiles add column matched_at timestamptz;

-- Set by the fetch worker only when a job is new or its content changed. updated_at also
-- moves when a job is merely seen again, so it can't drive incremental matching.
alter table public.jobs add column content_updated_at timestamptz not null default now();
create index jobs_content_updated_idx on public.jobs (content_updated_at) where closed_at is null;
revoke update on public.profiles from authenticated;
grant update (display_name, time_zone, tone, min_score, alert_settings, onboarded_at)
  on public.profiles to authenticated;

-- Open jobs changed since p_since, with cosine similarity to a CV embedding computed in the
-- database, so job vectors never leave it. Descriptions are trimmed for the rule checks.
create or replace function public.jobs_for_matching(
  p_cv extensions.vector,
  p_since timestamptz,
  p_limit int,
  p_offset int
)
returns table (
  id uuid,
  title text,
  company_name text,
  countries text[],
  remote_regions text[],
  remote_type text,
  employment_type text,
  seniority text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  description_text text,
  tags text[],
  posted_at timestamptz,
  similarity real
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.id, j.title, j.company_name, j.countries, j.remote_regions, j.remote_type,
    j.employment_type, j.seniority, j.salary_min, j.salary_max, j.salary_currency,
    left(j.description_text, 8000), j.tags, j.posted_at,
    (1 - (j.embedding operator(extensions.<=>) p_cv))::real
  from public.jobs j
  where j.closed_at is null
    and j.embedding is not null
    and j.content_updated_at >= p_since
  order by j.id
  limit p_limit offset p_offset;
$$;

revoke execute on function public.jobs_for_matching(extensions.vector, timestamptz, int, int)
  from public, anon, authenticated;
grant execute on function public.jobs_for_matching(extensions.vector, timestamptz, int, int)
  to service_role;

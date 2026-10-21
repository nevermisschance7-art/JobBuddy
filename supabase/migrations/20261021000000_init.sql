-- JobBuddy initial schema.
-- Shared data (companies, jobs): readable by signed-in users, written only by the service role.
-- Personal data: readable and writable only by its owner (RLS on user_id = auth.uid()).

create extension if not exists vector with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Personal tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  time_zone text not null default 'UTC',
  tone text not null default 'kind' check (tone in ('kind', 'funny', 'plain')),
  min_score int not null default 55 check (min_score between 0 and 100),
  alert_settings jsonb not null default jsonb_build_object(
    'enabled_types', jsonb_build_array('daily_summary', 'hot_match', 'application_ready', 'weekly_nudge', 'needs_fixing'),
    'quiet_hours', jsonb_build_object('start', '22:00', 'end', '08:00'),
    'daily_summary_time', '09:00',
    'humour', true
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cvs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  original_file text,
  resume_json jsonb,
  confirmed boolean not null default false,
  embedding extensions.vector(384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.filters (
  user_id uuid primary key references auth.users (id) on delete cascade,
  countries_allowed text[] not null default '{}',
  needs_sponsorship boolean not null default false,
  remote_types text[] not null default '{remote,hybrid,onsite}'
    check (remote_types <@ array['remote', 'hybrid', 'onsite']),
  hybrid_max_office_days int check (hybrid_max_office_days between 0 and 5),
  home_location text,
  max_commute_km int check (max_commute_km >= 0),
  seniority_levels text[] not null default '{}',
  must_have_skills text[] not null default '{}',
  excluded_skills text[] not null default '{}',
  excluded_companies text[] not null default '{}',
  salary_floor numeric check (salary_floor >= 0),
  salary_currency text check (salary_currency ~ '^[A-Z]{3}$'),
  employment_types text[] not null default '{full_time}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sensitive answers. Never sent to an LLM.
create table public.fixed_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value text not null,
  applies_to_country text check (applies_to_country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, key, applies_to_country)
);

-- Keys are AES-GCM encrypted by the app server; the database never sees plaintext.
create table public.ai_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('gemini', 'groq', 'openrouter')),
  encrypted_key text not null,
  last_error text,
  quota_reset_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- ---------------------------------------------------------------------------
-- Shared tables
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ats text not null check (ats in ('greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'teamtailor')),
  slug text not null,
  website text,
  active boolean not null default true,
  last_ok_at timestamptz,
  fail_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ats, slug)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  canonical_url text not null,
  apply_url text not null,
  title text not null,
  company_id uuid references public.companies (id) on delete set null,
  company_name text not null,
  locations jsonb not null default '[]',
  countries text[] not null default '{}',
  remote_type text check (remote_type in ('remote', 'hybrid', 'onsite')),
  employment_type text not null default 'unknown'
    check (employment_type in ('full_time', 'part_time', 'contract', 'temporary', 'unknown')),
  seniority text not null default 'unknown'
    check (seniority in ('junior', 'mid', 'senior', 'lead', 'principal', 'unknown')),
  salary_min numeric,
  salary_max numeric,
  salary_currency text check (salary_currency ~ '^[A-Z]{3}$'),
  description_text text not null default '',
  -- Only from a real creation/publication field of the source, never crawl time.
  posted_at timestamptz,
  date_source text not null default 'unknown' check (date_source in ('source_field', 'unknown')),
  -- A source's "updated" field. Not a posting date.
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missed_runs int not null default 0,
  closed_at timestamptz,
  embedding extensions.vector(384),
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id),
  constraint posted_at_matches_date_source
    check ((posted_at is null) = (date_source = 'unknown'))
);

-- ---------------------------------------------------------------------------
-- Personal tables that reference jobs
-- ---------------------------------------------------------------------------

create table public.user_job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  score int not null check (score between 0 and 100),
  breakdown jsonb not null default '{}',
  passed_filters boolean not null,
  reasons_failed text[] not null default '{}',
  status text not null default 'new'
    check (status in ('new', 'seen', 'saved', 'dismissed', 'preparing', 'applied')),
  dismissed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- restrict: a job someone applied to is never pruned
  job_id uuid not null references public.jobs (id) on delete restrict,
  status text not null default 'prepared'
    check (status in ('prepared', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'ghosted', 'withdrawn')),
  applied_at timestamptz,
  tailored_cv_pdf text,
  tailored_cv_docx text,
  tailored_resume_json jsonb,
  answers jsonb not null default '[]',
  last_reply_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create table public.answer_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question_text text not null,
  question_embedding extensions.vector(384),
  final_answer text not null,
  job_id uuid references public.jobs (id) on delete set null,
  times_reused int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.employer_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid references public.applications (id) on delete set null,
  from_domain text not null,
  subject text,
  snippet text check (char_length(snippet) <= 300),
  received_at timestamptz not null,
  classification text check (classification in ('rejection', 'interview', 'assessment', 'offer', 'other')),
  confidence real check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Worker bookkeeping. Service role only.
create table public.source_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  jobs_seen int not null default 0,
  jobs_new int not null default 0,
  errors jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'cvs', 'filters', 'fixed_answers', 'ai_keys', 'companies', 'jobs',
    'user_job_matches', 'applications', 'answer_memory', 'employer_messages', 'events', 'source_runs'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index jobs_posted_at_idx on public.jobs (posted_at desc nulls last);
create index jobs_last_seen_at_idx on public.jobs (last_seen_at);
create index jobs_countries_idx on public.jobs using gin (countries);
create index jobs_open_idx on public.jobs (closed_at) where closed_at is null;
create index jobs_canonical_url_idx on public.jobs (canonical_url);
create index jobs_company_id_idx on public.jobs (company_id);
create index jobs_embedding_idx on public.jobs
  using hnsw (embedding extensions.vector_cosine_ops);

create index cvs_user_id_idx on public.cvs (user_id);
create index cvs_embedding_idx on public.cvs
  using hnsw (embedding extensions.vector_cosine_ops);

create index fixed_answers_user_id_idx on public.fixed_answers (user_id);
create index ai_keys_user_id_idx on public.ai_keys (user_id);

create index user_job_matches_inbox_idx on public.user_job_matches (user_id, score desc)
  where passed_filters;
create index user_job_matches_job_id_idx on public.user_job_matches (job_id);

create index applications_user_status_idx on public.applications (user_id, status);
create index applications_job_id_idx on public.applications (job_id);

create index answer_memory_user_id_idx on public.answer_memory (user_id);
create index answer_memory_job_id_idx on public.answer_memory (job_id);
create index answer_memory_embedding_idx on public.answer_memory
  using hnsw (question_embedding extensions.vector_cosine_ops);

create index employer_messages_user_id_idx on public.employer_messages (user_id, received_at desc);
create index employer_messages_application_id_idx on public.employer_messages (application_id);

create index events_user_unread_idx on public.events (user_id, created_at desc) where not read;

create index source_runs_source_idx on public.source_runs (source, started_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.cvs enable row level security;
alter table public.filters enable row level security;
alter table public.fixed_answers enable row level security;
alter table public.ai_keys enable row level security;
alter table public.companies enable row level security;
alter table public.jobs enable row level security;
alter table public.user_job_matches enable row level security;
alter table public.applications enable row level security;
alter table public.answer_memory enable row level security;
alter table public.employer_messages enable row level security;
alter table public.events enable row level security;
alter table public.source_runs enable row level security;

-- Owner-only access to personal tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'cvs', 'filters', 'fixed_answers', 'ai_keys',
    'user_job_matches', 'applications', 'answer_memory', 'employer_messages', 'events'
  ] loop
    execute format(
      'create policy "owner can read" on public.%I for select to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can insert" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can update" on public.%I for update to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "owner can delete" on public.%I for delete to authenticated
         using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- Shared tables: any signed-in user can read; only the service role (which bypasses RLS) writes.
create policy "signed-in users can read" on public.companies
  for select to authenticated using (true);
create policy "signed-in users can read" on public.jobs
  for select to authenticated using (true);

-- source_runs: RLS on with no policies, so only the service role can touch it.

-- ---------------------------------------------------------------------------
-- New user setup: create the profile and filters rows on sign-up
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  );
  insert into public.filters (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Storage: private "cvs" bucket, one folder per user (<user_id>/...)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cvs', 'cvs', false, 10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

create policy "owner can read own cv files" on storage.objects
  for select to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner can upload own cv files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner can update own cv files" on storage.objects
  for update to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner can delete own cv files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Daily cleanup: drop jobs closed > 30 days ago that nobody applied to.
-- Keeps the free database small. Matches cascade; answer_memory.job_id is set null.
-- ---------------------------------------------------------------------------

create or replace function public.prune_closed_jobs()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted int;
begin
  delete from public.jobs j
  where j.closed_at < now() - interval '30 days'
    and not exists (select 1 from public.applications a where a.job_id = j.id);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function public.prune_closed_jobs() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

select cron.schedule('prune-closed-jobs', '17 3 * * *', $$select public.prune_closed_jobs()$$);

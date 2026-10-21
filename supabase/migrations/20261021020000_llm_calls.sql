-- One row per LLM call, for the usage page. No prompt or response content is stored.

create table public.llm_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  task text not null,
  provider text not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  latency_ms int not null,
  ok boolean not null,
  error_kind text,
  created_at timestamptz not null default now()
);

create index llm_calls_user_created_idx on public.llm_calls (user_id, created_at desc);

alter table public.llm_calls enable row level security;

create policy "owner can read" on public.llm_calls
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owner can insert" on public.llm_calls
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Keep the free database small: drop call logs older than 90 days.
select cron.schedule(
  'prune-llm-calls', '27 3 * * *',
  $$delete from public.llm_calls where created_at < now() - interval '90 days'$$
);

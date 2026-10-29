-- Answers the user typed into form fields JobBuddy couldn't fill (address line, post code,
-- "which status allows you to work"...). The extension fills them next time. Personal to
-- the user, never sent to any AI (unlike answer_memory, which drafts use as style examples).
create table public.learned_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null check (char_length(question) <= 500),
  answer text not null check (char_length(answer) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, question)
);
create index learned_answers_user_idx on public.learned_answers (user_id);

alter table public.learned_answers enable row level security;
create policy "owner can read" on public.learned_answers
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owner can insert" on public.learned_answers
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owner can update" on public.learned_answers
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner can delete" on public.learned_answers
  for delete to authenticated using (user_id = (select auth.uid()));

create trigger set_updated_at before update on public.learned_answers
  for each row execute function public.set_updated_at();

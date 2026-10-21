-- "Explain match" is generated on demand by the AI router and cached here.
alter table public.user_job_matches
  add column explanation text,
  add column explained_at timestamptz;

-- Inbox paging: a user's visible matches by score.
create index user_job_matches_inbox_status_idx
  on public.user_job_matches (user_id, status, score desc)
  where passed_filters;

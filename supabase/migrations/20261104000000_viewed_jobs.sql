-- When the user first opened or read a job on the board ("Viewed" badge). New = never
-- opened; Applied = status preparing or applied.
alter table public.user_job_matches add column if not exists viewed_at timestamptz;

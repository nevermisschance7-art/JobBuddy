-- Answers remember the company they were written for, so "Why Acme?" and "Why Beta?" count
-- as the same question. Jobs are deleted after 4 days, so job_id alone loses this.
-- Questions are compared by wording in the app (no embedding needed on the web server).
alter table public.answer_memory add column company text;

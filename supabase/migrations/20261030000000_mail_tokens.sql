-- Employer replies from Gmail. The user runs a small Google Apps Script in their own Google
-- account; it calls /api/mail/* with a personal mail key. Only the key's sha256 hash is stored.
-- The server creates and checks keys with the service role; users can see and delete their own.
create table public.mail_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.mail_tokens enable row level security;
create policy "owner can read" on public.mail_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owner can delete" on public.mail_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- What the script reports: good news (interview, assessment, offer, next step), rejections and
-- receipts. Never whole mails: sender domain, subject, a 300 character snippet and a Gmail link.
alter table public.employer_messages
  drop constraint if exists employer_messages_classification_check;
alter table public.employer_messages
  add constraint employer_messages_classification_check check (
    classification in (
      'rejection', 'interview', 'assessment', 'offer', 'next_step', 'received', 'other'
    )
  );
alter table public.employer_messages
  add column company text check (char_length(company) <= 200),
  add column gmail_url text check (char_length(gmail_url) <= 300),
  add constraint employer_messages_user_gmail_url_key unique (user_id, gmail_url);

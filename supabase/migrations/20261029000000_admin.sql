-- Admin dashboard. Admins and disabled accounts live in their own tables with RLS on and no
-- policies: only the server (service role) reads or writes them, so no user can make
-- themselves admin or undo a block through the API.

create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

create table public.blocked_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  blocked_at timestamptz not null default now()
);
alter table public.blocked_users enable row level security;

-- The owner's account.
insert into public.admin_users (user_id)
select user_id from public.profiles where username = 'never-miss'
on conflict do nothing;

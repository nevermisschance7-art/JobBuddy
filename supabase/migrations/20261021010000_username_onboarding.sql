-- Username sign-in and onboarding progress.
-- The username is fixed after sign-up: the auth email is derived from it.

alter table public.profiles
  add column username text unique
    check (username ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  add column onboarded_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uname text := new.raw_user_meta_data ->> 'username';
begin
  insert into public.profiles (user_id, username, display_name)
  values (
    new.id,
    uname,
    coalesce(uname, new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  );
  insert into public.filters (user_id) values (new.id);
  return new;
end;
$$;

-- Users may edit their profile, but not their username.
revoke update on public.profiles from authenticated;
grant update (display_name, time_zone, tone, min_score, alert_settings, onboarded_at)
  on public.profiles to authenticated;

-- Admins are named in the server's settings (ADMIN_USERNAMES, plus ADMIN_PASSWORD), so this
-- table isn't needed. blocked_users stays: disabled accounts, server-only.
drop table if exists public.admin_users;

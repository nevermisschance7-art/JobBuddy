-- GitHub's own schedule runs late or skips runs on the free tier, so the database starts the
-- "Fetch jobs" workflow every 2 hours instead. The token lives in Vault (secret
-- 'github_dispatch_token', a fine-grained token that can only start this repo's workflows);
-- it is added outside migrations and never committed.

create extension if not exists pg_net with schema extensions;

create or replace function public.start_fetch_run()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  request_id bigint;
begin
  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'github_dispatch_token';
  if token is null then
    raise warning 'github_dispatch_token missing from vault; fetch run not started';
    return null;
  end if;

  select net.http_post(
    url := 'https://api.github.com/repos/nevermisschance7-art/JobBuddy/actions/workflows/fetch-jobs.yml/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'JobBuddy-scheduler',
      'Content-Type', 'application/json'
    )
  ) into request_id;
  return request_id;
end;
$$;

revoke execute on function public.start_fetch_run() from public, anon, authenticated;

select cron.schedule('start-fetch-run', '15 */2 * * *', $$select public.start_fetch_run()$$);

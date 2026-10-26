-- One call per fetch run instead of one per company: record which boards worked.
create or replace function public.record_company_results(results jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.companies c
  set
    last_ok_at = case when r.ok then now() else c.last_ok_at end,
    fail_count = case when r.ok then 0 else c.fail_count + 1 end,
    jobs_open = case when r.ok then r.jobs_open else c.jobs_open end,
    last_error = case when r.ok then null else left(r.error, 300) end
  from jsonb_to_recordset(results) as r(id uuid, ok boolean, jobs_open int, error text)
  where c.id = r.id;
$$;

revoke execute on function public.record_company_results(jsonb) from public, anon, authenticated;
grant execute on function public.record_company_results(jsonb) to service_role;

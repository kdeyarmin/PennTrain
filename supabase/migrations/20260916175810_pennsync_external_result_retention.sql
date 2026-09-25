begin;
create function public.cm_integration_expire_results()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare affected integer;
begin
 with expired as (
  select id from public.cm_integration_jobs
  where result_encrypted is not null and result_expires_at is not null and result_expires_at<=now()
  order by result_expires_at,id for update skip locked limit 1000
 )
 update public.cm_integration_jobs j set result_encrypted=null
 from expired where j.id=expired.id;
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function public.cm_integration_expire_results() from public,anon,authenticated;
grant execute on function public.cm_integration_expire_results() to service_role;
comment on function public.cm_integration_expire_results() is 'Clears at most 1000 expired encrypted integration results; retains idempotency evidence, file records and all unrelated tables.';
commit;
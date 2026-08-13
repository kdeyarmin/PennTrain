-- One open certification attempt per employee per checklist version, for real.
--
-- start_certification_attempt only enforced that with an EXISTS check. Two
-- assessors (or a double-click) both pass the check and insert; there is no
-- unique index on (employee_id, certification_version_id). approve_certification_attempt
-- would then issue two qualifications for the same definition.
--
-- Close any extras (keep the newest), then add a partial unique index. The
-- RPC still raises the same 23505 message; the index is what makes two
-- concurrent starts unable to both succeed.

with ranked as (
  select id,
         row_number() over (
           partition by employee_id, certification_version_id
           order by created_at desc, id desc
         ) as rn
  from public.certification_attempts
  where status in ('in_progress', 'submitted')
)
update public.certification_attempts a
set status = 'voided'
from ranked
where a.id = ranked.id and ranked.rn > 1;

create unique index if not exists certification_attempts_one_open
  on public.certification_attempts (employee_id, certification_version_id)
  where status in ('in_progress', 'submitted');

create or replace function public.start_certification_attempt(
  p_employee_id uuid,
  p_certification_version_id uuid,
  p_observed_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_blockers text[];
  v_id uuid;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(
    v_employee.organization_id, 'qualifications.manage', v_employee.facility_id);

  if p_observed_at > now() then
    raise exception 'An observation cannot be recorded in the future' using errcode = '22023';
  end if;

  v_blockers := app_private.certification_attempt_blockers(
    p_certification_version_id, p_employee_id, auth.uid(), p_observed_at);
  if cardinality(v_blockers) > 0 then
    raise exception 'This attempt could never be approved: %', array_to_string(v_blockers, '; ')
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.certification_attempts a
    where a.employee_id = p_employee_id
      and a.certification_version_id = p_certification_version_id
      and a.status in ('in_progress', 'submitted')
  ) then
    raise exception 'An attempt for this certification is already open for this employee'
      using errcode = '23505';
  end if;

  begin
    insert into public.certification_attempts(
      organization_id, facility_id, employee_id, certification_version_id,
      assessor_profile_id, status, observed_at, created_by
    ) values (
      v_employee.organization_id, v_employee.facility_id, p_employee_id, p_certification_version_id,
      auth.uid(), 'in_progress', p_observed_at, auth.uid()
    ) returning id into v_id;
  exception
    when unique_violation then
      raise exception 'An attempt for this certification is already open for this employee'
        using errcode = '23505';
  end;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v_employee.organization_id, auth.uid(), 'certification_attempt', v_id::text,
    'certification_attempt.started',
    jsonb_build_object('employeeId', p_employee_id, 'versionId', p_certification_version_id));
  return v_id;
end $$;

revoke all on function public.start_certification_attempt(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.start_certification_attempt(uuid, uuid, timestamptz)
  to authenticated;

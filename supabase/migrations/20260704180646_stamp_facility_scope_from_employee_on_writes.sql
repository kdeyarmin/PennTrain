-- employee_training_records_insert/update and practicums_insert/update RLS policies check
-- organization_id = current_org_id() and is_assigned_to_facility(facility_id) against the row's
-- own literal columns, never against the referenced employee's real employees.facility_id.
-- Neither table had a stamp-from-employee trigger (unlike course_assignments and, since
-- 20260704164627_fix_codex_review_findings.sql, competency_records), so a facility_manager/
-- trainer assigned only to Facility A could insert/update a record for an employee who actually
-- belongs to Facility B in the same org while claiming facility_id=A -- misattributing/
-- corrupting facility-level compliance reporting for a regulated healthcare-training product.
-- Both tables have employee_id uuid not null, so the existing stamp_scope_from_employee()
-- (already used by course_assignments/competency_records) applies directly.
create trigger stamp_scope before insert on public.employee_training_records
  for each row execute function public.stamp_scope_from_employee();

create trigger stamp_scope before insert on public.practicums
  for each row execute function public.stamp_scope_from_employee();

-- training_documents has the identical gap, but its employee_id is nullable (facility-wide/
-- roster uploads legitimately have no single employee) -- stamp_scope_from_employee() would
-- wrongly raise "employee null not found" on those. This variant only overwrites
-- organization_id/facility_id from the employee row when employee_id is actually present;
-- null-employee_id uploads keep trusting the caller's own facility_id, which is still validated
-- by is_assigned_to_facility(facility_id) against the caller's own assignment (there is no
-- employee row to spoof against in that case).
create or replace function public.stamp_scope_from_employee_if_present()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  if new.employee_id is not null then
    select organization_id, facility_id into v_org, v_fac from public.employees where id = new.employee_id;
    if v_org is null then
      raise exception 'employee % not found', new.employee_id using errcode = 'foreign_key_violation';
    end if;
    new.organization_id := v_org;
    new.facility_id     := v_fac;
  end if;
  return new;
end;
$function$;

create trigger stamp_scope before insert on public.training_documents
  for each row execute function public.stamp_scope_from_employee_if_present();

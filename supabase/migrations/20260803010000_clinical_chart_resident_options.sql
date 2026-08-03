-- Caregiver clinical charting: resident picker for the employee-facing surface at /me/residents.
--
-- Employees have no direct RLS reach to public.residents (residents_select has no employee
-- branch -- see 20260705183133_resident_compliance_registry_rls.sql) and carry zero org-wide
-- clinical.* permissions by design; app_private.clinical_record_visible is their only clinical
-- read path (20260725100000_ehr_foundation_and_guardrail_supersession.sql). This mirrors the
-- shape of get_change_event_resident_options (20260713190000_structured_change_of_condition.sql),
-- which solves the same "which residents can I act on" need for change-of-condition reporting,
-- but composes clinical_record_visible directly instead of re-deriving the employee-facility
-- check inline, and evaluates it per resident row so a multi-facility employee sees residents at
-- every facility they are assigned to, not just the one row a single `select ... into` would
-- capture. This intentionally checks only clinical_record_visible (not clinical_module_enabled /
-- facility_clinical_enabled) to stay consistent with the existing read RPCs it feeds into --
-- get_resident_clinical_chart and get_resident_clinical_observations gate the same way; only the
-- write path (assert_clinical_contributor) additionally requires the org/facility capability
-- switches to be on.
create or replace function public.get_clinical_chart_resident_options()
returns table (id uuid, first_name text, last_name text, room text, facility_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.first_name, r.last_name, r.room, r.facility_id
  from public.residents r
  where r.status in ('active', 'temporarily_out', 'hospital_leave')
    and app_private.clinical_record_visible(r.organization_id, r.facility_id)
  order by r.last_name, r.first_name;
$$;
revoke all on function public.get_clinical_chart_resident_options() from public, anon, service_role;
grant execute on function public.get_clinical_chart_resident_options() to authenticated;

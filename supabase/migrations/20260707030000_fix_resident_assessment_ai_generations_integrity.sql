-- Two integrity gaps in the previous migration's resident_assessment_ai_generations table:
--
-- 1. Its insert/update policies let the same org_admin/facility_manager whose AI call is being
--    audited freely write (and later rewrite) their own row -- e.g. changing a "failed" row to
--    "completed" with a fabricated response_summary, defeating the point of an audit trail.
--    Tightened to platform_admin-only, matching course_ai_generations' tamper-resistance
--    convention. The (not-yet-enabled) generate-resident-assessment-summary edge function is
--    expected to write this table via the service-role client, which bypasses RLS entirely --
--    normal callers were never meant to write here directly, only read their own org/facility's
--    history via the unchanged select policy.
--
-- 2. Nothing tied a row's organization_id/facility_id to the actual resident_assessment_forms row
--    it references -- a facility_manager assigned to Facility A (passing the old insert policy's
--    facility_id=A check) could insert a row whose resident_assessment_form_id points at a form
--    belonging to Facility B, misattributing the audit trail. A BEFORE INSERT trigger now derives
--    organization_id/facility_id from the referenced form itself, mirroring
--    stamp_scope_from_resident()'s existing pattern for resident-scoped tables.

drop policy resident_assessment_ai_generations_insert on public.resident_assessment_ai_generations;
drop policy resident_assessment_ai_generations_update on public.resident_assessment_ai_generations;

create policy resident_assessment_ai_generations_insert on public.resident_assessment_ai_generations for insert to authenticated with check (
  public.is_platform_admin()
);
create policy resident_assessment_ai_generations_update on public.resident_assessment_ai_generations for update to authenticated using (
  public.is_platform_admin()
) with check (
  public.is_platform_admin()
);

create or replace function public.stamp_scope_from_resident_assessment_form()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  if new.resident_assessment_form_id is not null then
    select organization_id, facility_id into v_org, v_fac
    from public.resident_assessment_forms where id = new.resident_assessment_form_id;
    if v_org is not null then
      new.organization_id := v_org;
      new.facility_id := v_fac;
    end if;
  end if;
  return new;
end;
$function$;

create trigger stamp_scope before insert on public.resident_assessment_ai_generations
  for each row execute function public.stamp_scope_from_resident_assessment_form();

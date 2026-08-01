-- C2 completeness: effectiveness verify also requires no open corrective actions.
-- mark_plan_of_correction_corrected already enforces this; verify re-checks so a
-- violation cannot be verified if actions were reopened after corrected.

create or replace function public.verify_plan_of_correction(p_violation_id uuid, p_notes text)
returns public.dhs_violations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.dhs_violations%rowtype;
  v_open integer;
begin
  v := public.assert_can_manage_violation(p_violation_id);

  if v.status not in ('corrected', 'verified') then
    raise exception 'Verify is only valid after the plan of correction is marked corrected'
      using errcode = '55000';
  end if;

  if length(btrim(coalesce(p_notes, ''))) < 12 then
    raise exception 'Effectiveness notes are required (min 12 characters) before verification'
      using errcode = '22023';
  end if;

  select count(*) into v_open
  from public.corrective_actions
  where violation_id = p_violation_id
    and coalesce(status, '') not in ('completed', 'cancelled');

  if v_open > 0 then
    raise exception 'All corrective actions must be completed or cancelled before verification'
      using errcode = '22023';
  end if;

  update public.dhs_violations set
    status = 'verified',
    verified_at = coalesce(verified_at, now()),
    verified_by_profile_id = coalesce(verified_by_profile_id, auth.uid()),
    effectiveness_notes = btrim(p_notes),
    effectiveness_reviewed_at = now(),
    effectiveness_reviewed_by_profile_id = auth.uid(),
    updated_at = now()
  where id = p_violation_id
  returning * into v;

  return v;
end;
$$;

revoke all on function public.verify_plan_of_correction(uuid, text) from public, anon;
grant execute on function public.verify_plan_of_correction(uuid, text) to authenticated;

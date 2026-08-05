-- The release-cohort mechanism must not be one-way (BACKLOG.md G11).
--
-- `20260802030000_remove_pilot_program.sql` retired the CareBase pilot program: it released the four
-- gated features globally, deleted the `carebase-pilot-2026` cohort, deleted the Pilot Cohort
-- Console, and dropped `unassign_organization_release_cohort` as "console-only" with "no other
-- caller". Every one of those steps was right, and this migration does not undo any of them.
--
-- What it did not intend, and says so in its own words: "The general release-flag / cohort /
-- kill-switch mechanism itself is untouched." It is not untouched. `assign_organization_release_cohort`
-- survived and is still granted to `authenticated`; its counterpart was dropped. So a platform admin
-- can put an organization into a release cohort and **nothing supported can take it out** -- the only
-- remaining route is a direct DELETE against `organization_release_cohorts`.
--
-- That is the same shape as the survey-packet guest grants (G9): a control that can be applied and
-- not withdrawn. It is worth stating plainly that assign was equally console-only, so the asymmetry
-- looks like an oversight in an otherwise deliberate removal rather than a decision.
--
-- The function below is the original from `20260731210000`, restored byte-for-byte: same AAL2 gate,
-- same platform-admin check, same 8-character reason minimum, same audit row. Restoring the exit
-- from a mechanism the removal explicitly kept is not re-adding the pilot program.
--
-- Rollback: drop the function again -- and revoke `assign_organization_release_cohort` at the same
-- time, so the pair stays symmetric either way.

create or replace function public.unassign_organization_release_cohort(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_feature_key text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may unassign release cohorts'
      using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'A meaningful unassign reason is required'
      using errcode = '22023';
  end if;

  delete from public.organization_release_cohorts a
  where a.organization_id = p_organization_id
    and a.cohort_id = p_cohort_id
    and a.feature_key = p_feature_key;

  get diagnostics v_deleted = row_count;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    p_organization_id,
    auth.uid(),
    'organization_release_cohorts',
    p_organization_id::text,
    'cohort_unassigned',
    jsonb_build_object(
      'cohort_id', p_cohort_id,
      'feature_key', p_feature_key,
      'reason', trim(p_reason),
      'deleted', v_deleted > 0
    )
  );

  return v_deleted > 0;
end;
$$;

revoke all on function public.unassign_organization_release_cohort(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.unassign_organization_release_cohort(uuid, uuid, text, text)
  to authenticated;

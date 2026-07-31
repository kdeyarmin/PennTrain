-- Pilot cohort console support (2026-07-31)
-- Unenroll + list audit legal holds for platform-admin operator UI.
-- Writes remain SECURITY DEFINER + AAL2 / platform_admin gated like set_release_flag.

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

create or replace function public.list_audit_legal_holds()
returns table (
  id uuid,
  organization_id uuid,
  facility_id uuid,
  reason text,
  starts_at timestamptz,
  ends_at timestamptz,
  released_at timestamptz,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may list legal holds'
      using errcode = '42501';
  end if;
  return query
  select h.id, h.organization_id, h.facility_id, h.reason, h.starts_at, h.ends_at,
         h.released_at, h.created_by, h.created_at
  from app_private.audit_legal_holds h
  order by h.released_at nulls first, h.created_at desc
  limit 200;
end;
$$;

revoke all on function public.list_audit_legal_holds() from public, anon;
grant execute on function public.list_audit_legal_holds() to authenticated;

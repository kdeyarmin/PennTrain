-- Catalog authorship belongs to the super admin. Enrollment, assignments, class
-- management, and learner runtime permissions are unchanged.
create or replace function public.unpublish_course(p_course_id uuid, p_reason text)
returns public.courses
language plpgsql security definer set search_path = '' as $$
declare
  v_course public.courses%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  -- Check before looking up/locking a course: tenant admins cannot retire content,
  -- including courses owned by their organization.
  if not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only super admins can unpublish courses' using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('course_unpublish');
  select * into v_course from public.courses where id = p_course_id for update;
  if v_course.id is null then raise exception 'Course not found' using errcode = 'P0002'; end if;
  if length(v_reason) < 8 then
    raise exception 'A reason of at least 8 characters is required' using errcode = '22023';
  end if;
  update public.courses set status = 'archived', updated_at = now()
  where id = p_course_id returning * into v_course;
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_course.organization_id, auth.uid(), 'course', p_course_id::text,
    'unpublished', jsonb_build_object('reason', v_reason)
  );
  return v_course;
end;
$$;
revoke all on function public.unpublish_course(uuid, text) from public, anon;
grant execute on function public.unpublish_course(uuid, text) to authenticated;

-- Package ingestion and PDF/video media share this helper. Read-only inspection
-- keeps its existing tenant scope; every draft mutation requires a super admin.
create or replace function app_private.assert_learning_package_scope(p_actor uuid, p_version uuid, p_draft boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_version public.course_versions; v_course public.courses; v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = p_actor and is_active for share;
  if not found or v_profile.role not in ('platform_admin', 'org_admin', 'facility_manager', 'trainer')
    or not exists (select 1 from auth.users where id = p_actor and deleted_at is null and not coalesce(is_anonymous, false)
      and (banned_until is null or banned_until <= clock_timestamp())) then
    raise exception 'Package not found.' using errcode = '42501';
  end if;
  if p_draft and v_profile.role <> 'platform_admin' then
    raise exception 'Only super admins can change course packages and media.' using errcode = '42501';
  end if;
  select * into v_version from public.course_versions where id = p_version;
  if not found then raise exception 'Course version not found.' using errcode = 'P0002'; end if;
  select * into v_course from public.courses where id = v_version.course_id;
  if v_version.organization_id is distinct from v_course.organization_id
    or (v_profile.role <> 'platform_admin' and (v_course.organization_id is null
      or v_profile.organization_id is distinct from v_course.organization_id
      or not exists (select 1 from public.organizations where id = v_course.organization_id
        and subscription_status not in ('suspended', 'canceled')))) then
    raise exception 'Package not found.' using errcode = '42501';
  end if;
  if p_draft and v_version.status <> 'draft' then raise exception 'An editable draft is required.' using errcode = '40001'; end if;
  return v_course.id;
end;
$$;
revoke all on function app_private.assert_learning_package_scope(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- Quarantine changes which authored course content is available to learners, so
-- it follows the same catalog authority as unpublishing a course.
create or replace function public.quarantine_learning_package(p_package_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_pkg public.learning_packages%rowtype;
begin
  if not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only super admins can quarantine course packages' using errcode = '42501';
  end if;
  -- Preserve the version-before-package lock order used by publication.
  perform 1 from public.course_versions where id = (
    select course_version_id from public.learning_packages where id = p_package_id
  ) for update;
  select * into v_pkg from public.learning_packages where id = p_package_id for update;
  if not found then raise exception 'Package not found' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Quarantine reason required' using errcode = '22023';
  end if;
  update public.learning_packages set
    validation_status = 'quarantined',
    validation_results = coalesce(validation_results, '{}'::jsonb) || jsonb_build_object(
      'quarantined_by', auth.uid(), 'quarantined_at', now(), 'reason', btrim(p_reason)
    )
  where id = p_package_id;
  return true;
end;
$$;
revoke all on function public.quarantine_learning_package(uuid, text) from public, anon;
grant execute on function public.quarantine_learning_package(uuid, text) to authenticated;

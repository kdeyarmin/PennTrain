-- All comprehensive-standard and generic publish-readiness checks return zero
-- issues (verified immediately before this migration): the block-8 Kevin HeyGen
-- video re-hosted successfully, block 5 now ships as text, and designed minutes
-- (180) exactly match the catalog duration. Publish the course the same way
-- publish_course_version() would, using the privileged-write escape hatch
-- because this migration runs with no authenticated platform_admin JWT --
-- the enforce_course_version_publish_ready trigger still runs unconditionally
-- and would reject this update if anything were actually incomplete.
do $publish$
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.course_versions
  set status = 'published',
      published_at = coalesce(published_at, now())
  where id = '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid;

  update public.courses
  set status = 'published',
      current_version_id = '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid
  where id = 'e2c03f97-74e5-4fb7-b4f1-ced867d37950'::uuid;
end;
$publish$;

do $verify$
declare
  v_course_status text;
  v_version_status text;
begin
  select status into v_course_status from public.courses where id = 'e2c03f97-74e5-4fb7-b4f1-ced867d37950'::uuid;
  select status into v_version_status from public.course_versions where id = '23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid;
  if v_course_status <> 'published' or v_version_status <> 'published' then
    raise exception 'Expected course and version to be published, got course=% version=%', v_course_status, v_version_status;
  end if;
end;
$verify$;

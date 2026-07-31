-- Report the next commit sequence number from start_learning_runtime_session.
--
-- learning_runtime_sessions is unique per (package, assignment), so relaunching an in-progress
-- package reactivates the existing session and keeps its learning_runtime_commits rows. The launch
-- payload did not say how far that session had already got, so the client restarted numbering at 1
-- -- but commit_learning_runtime_state (20260712023823) enforces
--
--   p_sequence_number = coalesce(max(sequence_number) + 1, 1)
--
-- and raises 'Runtime commit sequence conflict' (40001) otherwise. So after a session had recorded
-- even one commit, every later save on a relaunch failed: a learner who closed a package and came
-- back could not record progress or completion at all.
--
-- 'nextSequenceNumber' lets the client resume numbering where the session left off. A new session
-- reports 1, which is what the client already assumed, so nothing changes for that path. The
-- function body is otherwise identical to 20260731150000.

create or replace function public.start_learning_runtime_session(
  p_assignment_id uuid,
  p_package_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.course_assignments%rowtype;
  v_employee public.employees%rowtype;
  v_package public.learning_packages%rowtype;
  v_session public.learning_runtime_sessions%rowtype;
  v_nonce text;
  v_nonce_hash text;
  v_registration text;
  v_next_sequence integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_assignment
  from public.course_assignments
  where id = p_assignment_id
  for share;

  if not found then
    raise exception 'Course assignment not found' using errcode = 'P0002';
  end if;

  select * into v_employee
  from public.employees e
  where e.id = v_assignment.employee_id;

  if not found or v_employee.profile_id is distinct from auth.uid() then
    raise exception 'Runtime launch is outside caller identity' using errcode = '42501';
  end if;

  if v_assignment.status = 'canceled' then
    raise exception 'Assignment is not available for launch' using errcode = '55000';
  end if;

  if p_package_id is not null then
    select * into v_package
    from public.learning_packages
    where id = p_package_id
      and validation_status = 'accepted'
      and course_version_id = v_assignment.course_version_id;
  else
    select * into v_package
    from public.learning_packages
    where validation_status = 'accepted'
      and course_version_id = v_assignment.course_version_id
      and (organization_id is null or organization_id = v_assignment.organization_id)
    order by validated_at desc nulls last
    limit 1;
  end if;

  if not found then
    raise exception 'No accepted learning package is available for this assignment'
      using errcode = 'P0002';
  end if;

  v_nonce := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_nonce_hash := encode(extensions.digest(convert_to(v_nonce, 'utf8'), 'sha256'), 'hex');

  select * into v_session
  from public.learning_runtime_sessions s
  where s.package_id = v_package.id
    and s.assignment_id = v_assignment.id
  for update;

  if found then
    -- One session row per package+assignment (unique). Reactivate or extend it.
    update public.learning_runtime_sessions
    set state = 'active',
        launch_nonce_sha256 = v_nonce_hash,
        expires_at = now() + interval '4 hours',
        launched_at = case when state = 'active' and expires_at > now() then launched_at else now() end
    where id = v_session.id
    returning * into v_session;

    select coalesce(max(c.sequence_number) + 1, 1) into v_next_sequence
    from public.learning_runtime_commits c
    where c.runtime_session_id = v_session.id;

    return jsonb_build_object(
      'sessionId', v_session.id,
      'packageId', v_package.id,
      'assignmentId', v_assignment.id,
      'employeeId', v_employee.id,
      'standard', v_session.runtime_standard,
      'entryPoint', v_package.entry_point,
      'storageBucket', v_package.storage_bucket,
      'storagePath', v_package.storage_path,
      'registrationKey', v_session.registration_key,
      'launchNonce', v_nonce,
      'expiresAt', v_session.expires_at,
      'nextSequenceNumber', v_next_sequence,
      'reused', true
    );
  end if;

  v_registration := 'reg:' || v_assignment.id::text || ':' || replace(gen_random_uuid()::text, '-', '');

  insert into public.learning_runtime_sessions (
    organization_id, package_id, assignment_id, employee_id,
    registration_key, runtime_standard, launch_nonce_sha256, expires_at
  ) values (
    v_assignment.organization_id,
    v_package.id,
    v_assignment.id,
    v_employee.id,
    v_registration,
    v_package.standard_type,
    v_nonce_hash,
    now() + interval '4 hours'
  )
  returning * into v_session;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'packageId', v_package.id,
    'assignmentId', v_assignment.id,
    'employeeId', v_employee.id,
    'standard', v_session.runtime_standard,
    'entryPoint', v_package.entry_point,
    'storageBucket', v_package.storage_bucket,
    'storagePath', v_package.storage_path,
    'registrationKey', v_session.registration_key,
    'launchNonce', v_nonce,
    'expiresAt', v_session.expires_at,
    'nextSequenceNumber', 1,
    'reused', false
  );
end;
$$;

revoke all on function public.start_learning_runtime_session(uuid, uuid) from public, anon;
grant execute on function public.start_learning_runtime_session(uuid, uuid) to authenticated;

comment on function public.start_learning_runtime_session(uuid, uuid) is
  'Opens or reactivates a learner runtime session for an accepted SCORM/xAPI package on the assignment, reporting the next commit sequence number.';

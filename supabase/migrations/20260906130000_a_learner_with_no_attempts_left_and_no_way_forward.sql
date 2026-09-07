-- A learner with no attempts left and no way forward, and an external id hidden in somebody's name.
--
-- BACKLOG J2, J39, J50 and J40.
--
-- J2. The attempt cap is real and server-side (`enforce_quiz_attempt_cap`, 20260706181240), the
-- seeded quizzes carry `max_attempts = 3`, and a published quiz is immutable. When a learner
-- exhausts the attempts on a comprehensive final assessment there is no way out of it in the
-- product: Mark Complete is hidden for comprehensive versions and refused by the RPC, no screen
-- resets attempts, `protect_course_assignment_fields` reverts a client status write, and the
-- one-open-assignment index added by 20260905060000 refuses a replacement assignment while the
-- dead one is still open. TakeQuiz says "Contact your trainer or facility manager about next
-- steps"; there were none. The annual requirement the course satisfies stays unmet for ever.
--
-- Two RPCs, because there are two legitimate answers a manager might give: another attempt, or
-- this assignment is finished and a different one is coming. Both take a reason, because both are
-- an override of a control that exists for a reason -- an assessment somebody has already failed
-- three times.
--
-- The allowance is a COLUMN, not a manager-inserted blank attempt row. The cap trigger already
-- exempts managers, so a manager can insert an attempt today; what they cannot do is let the
-- LEARNER insert one, which is the thing that was missing.
--
-- J39. The bulk resident import stores the source system's external id in
-- `residents.preferred_name`. That is a real field: it is printed on the face sheet, it is freely
-- editable by anyone who can edit a resident, and it is resolved organization-wide -- so editing a
-- resident's preferred name silently breaks re-import matching, and two facilities' ids collide.
-- `external_id` is the column it should always have been, scoped per facility.
--
-- J50. `facility_units` is classified `modules.carebase` while its only page sits behind the
-- Workforce route list, so a Workforce-tier tenant reaches a page whose table the module wall
-- refuses. Units are a scheduling and staffing concept -- `shift_assignments.unit_id`,
-- `service_workload_profiles.unit_id`, `open_shift_opportunities.unit_id` are all Workforce -- so
-- the table follows them.
--
-- J40. `data_import_jobs`, `_rows` and `_events` were classified in 20260906120000 but their
-- tenant RLS lets a facility manager read every facility's import ledger, including roster and
-- census snapshots for buildings they do not manage. The scoping predicate every other
-- facility-scoped table uses is `is_assigned_to_facility`.

-- ---------------------------------------------------------------------------
-- J2 -- another attempt, or a different assignment
-- ---------------------------------------------------------------------------

-- PER QUIZ, not per assignment. A course version may carry more than one `quiz` block -- nothing
-- constrains it to one, and the player gates on each -- and an assignment-wide integer was added to
-- the cap of EVERY one of them by enforce_quiz_attempt_cap below. So granting a retry on an
-- exhausted final assessment also raised the limit on the module quizzes the learner had not
-- failed, without a manager ever deciding that, while the dialog and the notification both spoke
-- about one more attempt at one assessment (BACKLOG J93).
--
-- A jsonb map rather than a second table: the value here is a counter, the audited event is the
-- `course_assignment.attempt_granted` row in audit_logs, and course_assignments already carries the
-- RLS and module classification this belongs under. The bound the integer column had is kept as a
-- jsonpath check -- `strict` so an array value is not silently unwrapped into a valid number -- and
-- it is the bound that matters, since it is what caps attempts.
alter table public.course_assignments
  add column if not exists additional_quiz_attempts jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(additional_quiz_attempts) = 'object'
      and not jsonb_path_exists(
        additional_quiz_attempts,
        'strict $.* ? (@.type() != "number" || @ < 0 || @ > 20 || @.floor() != @)'
      )
    );

comment on column public.course_assignments.additional_quiz_attempts is
  'Extra attempts a manager has granted on this assignment, keyed by quiz id, on top of each '
  'quiz''s own max_attempts. Written only by grant_additional_quiz_attempt. Keyed by quiz because a '
  'course version may hold several quiz blocks and a grant is a decision about ONE of them '
  '(BACKLOG J93). Before BACKLOG J2 a learner who exhausted the cap on a comprehensive final '
  'assessment was stuck for good: the quiz is immutable, Mark Complete is refused, no screen resets '
  'attempts, and the one-open-assignment index refused a replacement while the dead one stayed '
  'open.';

-- The single-writer contract, enforced rather than asserted (BACKLOG J94).
--
-- The column comment says this is written only by grant_additional_quiz_attempt, and nothing made
-- that true: `course_assignments_update` gives an org_admin, facility_manager or trainer an
-- ordinary UPDATE on the row, and `protect_course_assignment_fields` restored only `status` and
-- `completed_at`. A manager could therefore set the map directly -- twenty attempts on every quiz
-- in the version -- with no reason recorded, no check that the quiz belongs to the assignment's
-- course version, no `course_assignment.attempt_granted` audit row and no notification to the
-- learner. A comment is not a control.
create or replace function public.protect_course_assignment_fields()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'assigned';
    new.completed_at := null;
    -- A new assignment starts with no granted attempts, whatever the insert said.
    new.additional_quiz_attempts := '{}'::jsonb;
  else
    new.status := old.status;
    new.completed_at := old.completed_at;
    new.additional_quiz_attempts := old.additional_quiz_attempts;
  end if;
  return new;
end;
$function$;

create or replace function public.enforce_quiz_attempt_cap()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_max integer;
  v_used integer;
  v_granted integer;
begin
  if public.is_platform_admin() or (select public.current_role()) in ('org_admin','facility_manager','trainer') then
    return new;
  end if;

  select max_attempts into v_max from public.quizzes where id = new.quiz_id;
  if v_max is null then
    return new;
  end if;

  -- BACKLOG J2. The cap is the quiz's, plus whatever a manager has deliberately granted for THIS
  -- quiz on this assignment. Granting is audited and takes a reason; the cap itself is unchanged
  -- for everyone who has not been given one, and unchanged for every other quiz block in the same
  -- course version, which an assignment-wide counter did not manage (BACKLOG J93).
  select coalesce((a.additional_quiz_attempts ->> new.quiz_id::text)::integer, 0) into v_granted
  from public.course_assignments a where a.id = new.assignment_id;
  v_max := v_max + coalesce(v_granted, 0);

  select count(*) into v_used
  from public.quiz_attempts
  where assignment_id = new.assignment_id and quiz_id = new.quiz_id;

  if v_used >= v_max then
    raise exception 'maximum of % attempt(s) already used for this quiz', v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- The signature gained p_quiz_id, so the two-argument form has to go rather than be replaced:
-- `create or replace` would leave the old one beside it, and PostgREST would keep offering a call
-- that grants an attempt at every quiz in the version.
drop function if exists public.grant_additional_quiz_attempt(uuid, text);

create or replace function public.grant_additional_quiz_attempt(
  p_assignment_id uuid,
  p_quiz_id uuid,
  p_reason text
)
returns public.course_assignments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment public.course_assignments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_granted integer;
  v_quiz_title text;
begin
  select * into v_assignment from public.course_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Course assignment not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_content_permission(v_assignment.organization_id, 'training.sessions.manage');
  -- ...and then BOTH halves of `course_assignments_update`, which this function stands in for.
  -- assert_content_permission is organization-wide, and facility_manager and trainer hold
  -- training.sessions.manage across the whole organization; the policy additionally requires the
  -- caller to be one of org_admin/facility_manager/trainer AND assigned to the row's facility. This
  -- function is SECURITY DEFINER, so none of that runs on its own.
  --
  -- The facility test alone is NOT the policy, and an earlier version of this comment claimed it
  -- was. `is_assigned_to_facility` is a READ predicate: it answers true for an auditor at every
  -- facility in their organization, so a guard built only from it would admit a read-only role the
  -- policy names nowhere. No builtin role template grants an auditor training.sessions.manage
  -- today, so this half is defence in depth rather than a live hole -- but the whole value of
  -- restating a policy is that it keeps holding when the grants around it change.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_platform_admin() then
    if not (public.current_role() = any (array['org_admin', 'facility_manager', 'trainer'])) then
      raise exception 'This role may not change course assignments' using errcode = '42501';
    end if;
    if not public.is_assigned_to_facility(v_assignment.facility_id) then
      raise exception 'This course assignment belongs to a facility outside your scope'
        using errcode = '42501';
    end if;
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Say why another attempt is being granted -- at least a sentence'
      using errcode = '22023';
  end if;
  if v_assignment.status in ('completed', 'canceled') then
    raise exception 'This assignment is already finished' using errcode = '55000';
  end if;

  -- The quiz has to belong to the version this assignment is FOR. Without this the caller could
  -- name any quiz in the installation and raise its cap for this learner, and the check is cheap:
  -- quizzes hang off a course_block, and a block belongs to exactly one course version.
  if not exists (
    select 1
    from public.quizzes q
    join public.course_blocks b on b.id = q.course_block_id
    where q.id = p_quiz_id and b.course_version_id = v_assignment.course_version_id
  ) then
    raise exception 'That quiz is not part of the course version this assignment was made from'
      using errcode = '23514';
  end if;

  v_granted := coalesce((v_assignment.additional_quiz_attempts ->> p_quiz_id::text)::integer, 0);
  if v_granted >= 20 then
    raise exception 'This assignment has already been granted the maximum extra attempts at that quiz'
      using errcode = '23514';
  end if;

  -- The trigger above restores this column for every non-privileged writer, this definer function
  -- included, so the write is made under the same transaction-local escape hatch the other trusted
  -- RPCs use -- opened here and closed immediately after, exactly as cancel_course_assignment
  -- does below. Set here rather than at the top: everything above is authorization, and a bypass
  -- that outlives a refusal is a bypass nobody meant to grant. Closed straight after the update
  -- because the audit and notification inserts that follow carry triggers of their own, and those
  -- should run under the caller's rights rather than through the escape hatch.
  perform set_config('app.privileged_write', 'on', true);
  update public.course_assignments
  set additional_quiz_attempts = jsonb_set(
        coalesce(additional_quiz_attempts, '{}'::jsonb),
        array[p_quiz_id::text],
        to_jsonb(v_granted + 1),
        true
      ),
      updated_at = now()
  where id = v_assignment.id
  returning * into v_assignment;
  perform set_config('app.privileged_write', '', true);

  insert into public.audit_logs(organization_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (
    v_assignment.organization_id, auth.uid(), 'course_assignment.attempt_granted',
    'course_assignments', v_assignment.id::text,
    jsonb_build_object(
      'reason', v_reason,
      'employeeId', v_assignment.employee_id,
      'courseId', v_assignment.course_id,
      'quizId', p_quiz_id,
      'additionalAttemptsGranted', v_granted + 1
    )
  );

  -- /me/courses, not /me/trainings. Two reasons, and the second is the one that makes this a
  -- defect rather than a preference.
  --
  -- By CONTENT: MyTrainings reads employee_training_records; this message is about a course
  -- ASSIGNMENT and its quiz, which is MyCourses (useListCourseAssignments) and the TakeCourse /
  -- TakeQuiz routes under it. The old link landed the learner on a page with no assignment on it.
  --
  -- By ROLE: the recipient is resolved through public.employees, so it is whatever role that
  -- profile holds -- and a facility_manager, trainer or auditor can hold an employee record.
  -- /me/trainings is ProtectedRoute-gated to `employee` alone, so every one of those was sent to a
  -- route that redirects them away from a notification addressed to them. /me/courses is ANY_ROLE
  -- precisely because taking an assigned course is not an employee-only act. Same defect as the
  -- credential notifications in 20260906280000; that one needed the route widened, this one only
  -- needed the right route.
  -- Names the assessment the grant was actually made for. "the final assessment" was true while
  -- the grant was assignment-wide and is a wrong answer now that it is per quiz: a learner given a
  -- retry on a module check would be sent back to an assessment whose limit did not move (J94).
  select q.title into v_quiz_title from public.quizzes q where q.id = p_quiz_id;

  insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
  select v_assignment.organization_id, e.profile_id, 'course_assigned',
    'Another attempt is available',
    'Your manager has given you another attempt at '
      || coalesce(nullif(btrim(coalesce(v_quiz_title, '')), ''), 'an assessment')
      || ' in this course.',
    '/me/courses'
  from public.employees e
  where e.id = v_assignment.employee_id and e.profile_id is not null;

  return v_assignment;
end;
$function$;

comment on function public.grant_additional_quiz_attempt(uuid, uuid, text) is
  'Gives one more attempt at ONE quiz on this assignment, on top of that quiz''s own max_attempts, '
  'with a recorded reason. The exit from the trap BACKLOG J2 describes: a learner who exhausted the '
  'cap on a comprehensive final assessment could not be helped by anything in the product, and the '
  'annual requirement the course satisfies stayed unmet for ever. The quiz is named by the caller '
  'and checked against the assignment''s course version, because a version may hold several quiz '
  'blocks and granting across all of them is not the decision the manager made (BACKLOG J93).';

revoke all on function public.grant_additional_quiz_attempt(uuid, uuid, text) from public, anon;
grant execute on function public.grant_additional_quiz_attempt(uuid, uuid, text) to authenticated;

create or replace function public.cancel_course_assignment(
  p_assignment_id uuid,
  p_reason text
)
returns public.course_assignments
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment public.course_assignments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_assignment from public.course_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Course assignment not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_content_permission(v_assignment.organization_id, 'training.sessions.manage');
  -- ...and then BOTH halves of `course_assignments_update`, which this function stands in for.
  -- assert_content_permission is organization-wide, and facility_manager and trainer hold
  -- training.sessions.manage across the whole organization; the policy additionally requires the
  -- caller to be one of org_admin/facility_manager/trainer AND assigned to the row's facility. This
  -- function is SECURITY DEFINER, so none of that runs on its own.
  --
  -- The facility test alone is NOT the policy, and an earlier version of this comment claimed it
  -- was. `is_assigned_to_facility` is a READ predicate: it answers true for an auditor at every
  -- facility in their organization, so a guard built only from it would admit a read-only role the
  -- policy names nowhere. No builtin role template grants an auditor training.sessions.manage
  -- today, so this half is defence in depth rather than a live hole -- but the whole value of
  -- restating a policy is that it keeps holding when the grants around it change.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_platform_admin() then
    if not (public.current_role() = any (array['org_admin', 'facility_manager', 'trainer'])) then
      raise exception 'This role may not change course assignments' using errcode = '42501';
    end if;
    if not public.is_assigned_to_facility(v_assignment.facility_id) then
      raise exception 'This course assignment belongs to a facility outside your scope'
        using errcode = '42501';
    end if;
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Say why this assignment is being cancelled -- at least a sentence'
      using errcode = '22023';
  end if;
  if v_assignment.status = 'completed' then
    raise exception 'A completed assignment cannot be cancelled' using errcode = '55000';
  end if;
  if v_assignment.status = 'canceled' then
    return v_assignment;
  end if;

  -- The check constraint requires status, canceled_at and cancellation_reason to move together,
  -- and protect_course_assignment_fields reverts a client status write -- which is why this has to
  -- be a definer RPC rather than a table update from the page.
  perform set_config('app.privileged_write', 'on', true);
  update public.course_assignments
  set status = 'canceled',
      canceled_at = now(),
      cancellation_reason = v_reason,
      updated_at = now()
  where id = v_assignment.id
  returning * into v_assignment;
  perform set_config('app.privileged_write', '', true);

  insert into public.audit_logs(organization_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (
    v_assignment.organization_id, auth.uid(), 'course_assignment.canceled',
    'course_assignments', v_assignment.id::text,
    jsonb_build_object(
      'reason', v_reason,
      'employeeId', v_assignment.employee_id,
      'courseId', v_assignment.course_id
    )
  );

  return v_assignment;
end;
$function$;

comment on function public.cancel_course_assignment(uuid, text) is
  'Closes a course assignment as cancelled, with a recorded reason, so a replacement can be '
  'assigned -- the one-open-assignment index added by 20260905060000 refuses one while the dead '
  'assignment is still open, and no screen could close it (BACKLOG J2). A completed assignment is '
  'refused: cancelling it would erase the evidence of the training.';

revoke all on function public.cancel_course_assignment(uuid, text) from public, anon;
grant execute on function public.cancel_course_assignment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- J39 -- the external id gets its own column
-- ---------------------------------------------------------------------------

alter table public.residents
  add column if not exists external_id text
    check (external_id is null or length(btrim(external_id)) between 1 and 200);

comment on column public.residents.external_id is
  'The identifier this resident carries in the system they were imported from. Scoped per '
  'facility, never shown as a name, and not editable through the resident form. The bulk import '
  'used to keep it in `preferred_name` (BACKLOG J39) -- a field printed on the face sheet, freely '
  'editable, and resolved organization-wide, so editing a preferred name broke re-import matching '
  'and two facilities'' identifiers collided.';

create unique index if not exists residents_external_id_key
  on public.residents (organization_id, facility_id, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- J50 -- units follow the shifts that reference them
-- ---------------------------------------------------------------------------

update app_private.product_module_resources
set module_key = 'modules.workforce', classified_at = now()
where resource_schema = 'public' and resource_name = 'facility_units'
  and module_key <> 'modules.workforce';

do $do$
begin
  drop policy if exists product_module_entitlement on public.facility_units;
  create policy product_module_entitlement on public.facility_units
    as restrictive for all to authenticated
    using ((select app_private.has_product_module('modules.workforce')))
    with check ((select app_private.has_product_module('modules.workforce')));
end;
$do$;

-- ---------------------------------------------------------------------------
-- J40 -- the import ledger is scoped to the facilities the manager manages
-- ---------------------------------------------------------------------------

do $do$
declare
  v_table text;
begin
  foreach v_table in array array['data_import_jobs', 'data_import_rows', 'data_import_events']
  loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table
    ) then
      raise exception 'public.% is missing', v_table;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table and column_name = 'facility_id'
    ) then
      -- data_import_rows and data_import_events carry no facility of their own; they are scoped by
      -- the job they belong to, which is the same rule one level down.
      execute format('drop policy if exists import_ledger_facility_scope on public.%I', v_table);
      execute format($fmt$
        create policy import_ledger_facility_scope on public.%I
        as restrictive for all to authenticated
        using (
          (select public.is_platform_admin())
          or (select public."current_role"()) in ('org_admin', 'auditor')
          or exists (
            select 1 from public.data_import_jobs j
            where j.id = %I.job_id
              and (j.facility_id is null or public.is_assigned_to_facility(j.facility_id))
          )
        )
      $fmt$, v_table, v_table);
      continue;
    end if;

    -- BACKLOG J40. Restrictive, so it composes with whatever the table's own tenant policy already
    -- says rather than widening anything: a facility manager sees the import ledger for the
    -- facilities they are assigned to, and an org_admin, auditor or platform admin sees the
    -- organization's. A row with no facility (an organization-wide import) stays visible to the
    -- roles that are not facility-scoped.
    execute format('drop policy if exists import_ledger_facility_scope on public.%I', v_table);
    execute format($fmt$
      create policy import_ledger_facility_scope on public.%I
      as restrictive for all to authenticated
      using (
        (select public.is_platform_admin())
        or (select public."current_role"()) in ('org_admin', 'auditor')
        or facility_id is null
        or public.is_assigned_to_facility(facility_id)
      )
    $fmt$, v_table);
  end loop;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Cancelling an assignment has to reach the copy already on the learner's device.
--
-- `cancel_course_assignment` above closes the assignment on the server and frees the
-- one-open-per-course index. It does not reach `sync_offline_learning_action`, which checks that
-- the caller owns the assignment and never asks what state it is in -- so a learner who downloaded
-- the course before the cancellation keeps studying it, keeps queueing checkpoints, and keeps being
-- told each sync succeeded. The cancellation only surfaces when they finish and
-- complete_course_assignment refuses by name, after the hours are spent.
--
-- `rejected` rather than a new outcome value: it is already in
-- offline_sync_receipts_outcome_check, and the reason goes in conflict_detail so the client can say
-- WHICH terminal state it is rather than showing the generic refusal. Placed above the version
-- check, because a cancelled assignment is not a conflict to reconcile -- there is nothing to
-- reconcile it with.
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef(
    'public.sync_offline_learning_action(uuid,uuid,text,integer,integer,text,timestamptz,jsonb)'::regprocedure);

  if position($probe$v_assignment.status in ('canceled','completed')$probe$ in v_def) > 0 then
    raise notice 'sync_offline_learning_action already refuses a closed assignment';
  else
    v_old := $old$  if v_device.status<>'active' or v_device.wipe_required_at is not null then v_outcome:='wipe_required';$old$;
    if position(v_old in v_def) = 0 then
      raise exception 'sync_offline_learning_action no longer opens the outcome cascade this migration patches';
    end if;
    v_new := $patch$  if v_device.status<>'active' or v_device.wipe_required_at is not null then v_outcome:='wipe_required';
  elsif v_assignment.status in ('canceled','completed') then v_outcome:='rejected';$patch$;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$case when v_outcome='conflict' then jsonb_build_object('expectedServerVersion',v_server_version) else '{}' end$old$;
    if position(v_old in v_def) = 0 then
      raise exception 'sync_offline_learning_action no longer writes the conflict detail this migration patches';
    end if;
    v_new := $patch$case when v_outcome='conflict' then jsonb_build_object('expectedServerVersion',v_server_version) when v_outcome='rejected' then jsonb_build_object('assignmentStatus',v_assignment.status) else '{}' end$patch$;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

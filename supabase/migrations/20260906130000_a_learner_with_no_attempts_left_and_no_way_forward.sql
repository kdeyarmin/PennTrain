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

alter table public.course_assignments
  add column if not exists additional_attempts_granted integer not null default 0
    check (additional_attempts_granted between 0 and 20);

comment on column public.course_assignments.additional_attempts_granted is
  'Extra quiz attempts a manager has granted on this assignment, on top of the quiz''s '
  'max_attempts. Written only by grant_additional_quiz_attempt. Before BACKLOG J2 a learner who '
  'exhausted the cap on a comprehensive final assessment was stuck for good: the quiz is '
  'immutable, Mark Complete is refused, no screen resets attempts, and the one-open-assignment '
  'index refused a replacement while the dead one stayed open.';

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

  -- BACKLOG J2. The cap is the quiz's, plus whatever a manager has deliberately granted on this
  -- assignment. Granting is audited and takes a reason; the cap itself is unchanged for everyone
  -- who has not been given one.
  select coalesce(additional_attempts_granted, 0) into v_granted
  from public.course_assignments where id = new.assignment_id;
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

create or replace function public.grant_additional_quiz_attempt(
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
  -- ...and the FACILITY the assignment belongs to. assert_content_permission is organization-wide,
  -- and both facility_manager and trainer hold training.sessions.manage across the organization.
  -- This function is SECURITY DEFINER, so `course_assignments_update` -- which additionally
  -- requires `is_assigned_to_facility(facility_id)` for exactly those two roles -- never runs.
  -- Without this line either of them could pass any assignment id in their organization and change
  -- a learner at a site they have no part in, through an RPC, past the policy written to stop it.
  -- is_assigned_to_facility is already true for org_admin and platform_admin, so this restates the
  -- policy rather than narrowing it.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.is_platform_admin()
     and not public.is_assigned_to_facility(v_assignment.facility_id) then
    raise exception 'This course assignment belongs to a facility outside your scope'
      using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Say why another attempt is being granted -- at least a sentence'
      using errcode = '22023';
  end if;
  if v_assignment.status in ('completed', 'canceled') then
    raise exception 'This assignment is already finished' using errcode = '55000';
  end if;

  update public.course_assignments
  set additional_attempts_granted = coalesce(additional_attempts_granted, 0) + 1,
      updated_at = now()
  where id = v_assignment.id
  returning * into v_assignment;

  insert into public.audit_logs(organization_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (
    v_assignment.organization_id, auth.uid(), 'course_assignment.attempt_granted',
    'course_assignments', v_assignment.id::text,
    jsonb_build_object(
      'reason', v_reason,
      'employeeId', v_assignment.employee_id,
      'courseId', v_assignment.course_id,
      'additionalAttemptsGranted', v_assignment.additional_attempts_granted
    )
  );

  insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
  select v_assignment.organization_id, e.profile_id, 'course_assigned',
    'Another attempt is available',
    'Your manager has given you another attempt at the final assessment.',
    '/me/trainings'
  from public.employees e
  where e.id = v_assignment.employee_id and e.profile_id is not null;

  return v_assignment;
end;
$function$;

comment on function public.grant_additional_quiz_attempt(uuid, text) is
  'Gives one more attempt at this assignment''s quiz, on top of the quiz''s own max_attempts, with '
  'a recorded reason. The exit from the trap BACKLOG J2 describes: a learner who exhausted the cap '
  'on a comprehensive final assessment could not be helped by anything in the product, and the '
  'annual requirement the course satisfies stayed unmet for ever.';

revoke all on function public.grant_additional_quiz_attempt(uuid, text) from public, anon;
grant execute on function public.grant_additional_quiz_attempt(uuid, text) to authenticated;

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
  -- ...and the FACILITY the assignment belongs to. assert_content_permission is organization-wide,
  -- and both facility_manager and trainer hold training.sessions.manage across the organization.
  -- This function is SECURITY DEFINER, so `course_assignments_update` -- which additionally
  -- requires `is_assigned_to_facility(facility_id)` for exactly those two roles -- never runs.
  -- Without this line either of them could pass any assignment id in their organization and change
  -- a learner at a site they have no part in, through an RPC, past the policy written to stop it.
  -- is_assigned_to_facility is already true for org_admin and platform_admin, so this restates the
  -- policy rather than narrowing it.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.is_platform_admin()
     and not public.is_assigned_to_facility(v_assignment.facility_id) then
    raise exception 'This course assignment belongs to a facility outside your scope'
      using errcode = '42501';
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

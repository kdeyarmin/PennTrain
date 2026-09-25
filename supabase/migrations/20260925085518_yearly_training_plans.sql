-- A yearly course bundle has an administrator-entered deadline. Existing
-- organization-wide curricula remain legacy plans until explicitly replaced.
alter table public.training_plans
  add column facility_id uuid references public.facilities(id) on delete restrict,
  add column training_year integer,
  add column due_date date,
  add constraint training_plans_annual_fields_check check (
    (facility_id is null and training_year is null and due_date is null)
    or (facility_id is not null and training_year between 1990 and 2200
        and training_year is not null and due_date is not null)
  );
create index training_plans_facility_year_idx on public.training_plans(facility_id, training_year);
comment on column public.training_plans.due_date is
  'Explicit required-completion date entered by the administrator; never calculated from the training year.';

-- Policies resolve this private helper by OID. Its definer rights allow the
-- internal entitlement lookup without granting clients private-schema USAGE;
-- every authorization decision remains tied to the authenticated caller.
create function app_private.can_manage_training_plan(p_org uuid, p_facility uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.current_session_unlocked()
    and app_private.has_product_module('modules.train')
    and exists (select 1 from public.organizations o where o.id = p_org
      and o.subscription_status not in ('suspended', 'canceled'))
    and (public.is_platform_admin() or (
      p_org = public.current_org_id()
      and public.current_role() in ('org_admin', 'trainer', 'facility_manager')
      and (p_facility is not null or public.current_role() in ('org_admin', 'trainer'))
    ))
    and (p_facility is null or (
      public.is_assigned_to_facility(p_facility)
      and exists (select 1 from public.facilities f where f.id = p_facility
        and f.organization_id = p_org and f.is_active)
    ));
$$;
revoke all on function app_private.can_manage_training_plan(uuid, uuid) from public, anon;
grant execute on function app_private.can_manage_training_plan(uuid, uuid) to authenticated;

drop policy training_plans_select on public.training_plans;
create policy training_plans_select on public.training_plans for select to authenticated using (
  (select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (facility_id is null or (select public.current_role()) = 'org_admin'
      or public.is_assigned_to_facility(facility_id))
  )
);
drop policy training_plans_insert on public.training_plans;
create policy training_plans_insert on public.training_plans for insert to authenticated
  with check (app_private.can_manage_training_plan(organization_id, facility_id));
drop policy training_plans_update on public.training_plans;
create policy training_plans_update on public.training_plans for update to authenticated
  using (app_private.can_manage_training_plan(organization_id, facility_id))
  with check (app_private.can_manage_training_plan(organization_id, facility_id));
drop policy training_plans_delete on public.training_plans;
create policy training_plans_delete on public.training_plans for delete to authenticated using (
  app_private.can_manage_training_plan(organization_id, facility_id)
  and (facility_id is not null or (select public.is_platform_admin())
    or (select public.current_role()) = 'org_admin')
);

drop policy training_plan_items_select on public.training_plan_items;
create policy training_plan_items_select on public.training_plan_items for select to authenticated
  using (exists (select 1 from public.training_plans p where p.id = training_plan_id));
drop policy training_plan_items_insert on public.training_plan_items;
create policy training_plan_items_insert on public.training_plan_items for insert to authenticated
  with check (exists (select 1 from public.training_plans p where p.id = training_plan_id
    and app_private.can_manage_training_plan(p.organization_id, p.facility_id)));
drop policy training_plan_items_update on public.training_plan_items;
create policy training_plan_items_update on public.training_plan_items for update to authenticated
  using (exists (select 1 from public.training_plans p where p.id = training_plan_id
    and app_private.can_manage_training_plan(p.organization_id, p.facility_id)))
  with check (exists (select 1 from public.training_plans p where p.id = training_plan_id
    and app_private.can_manage_training_plan(p.organization_id, p.facility_id)));
drop policy training_plan_items_delete on public.training_plan_items;
create policy training_plan_items_delete on public.training_plan_items for delete to authenticated
  using (exists (select 1 from public.training_plans p where p.id = training_plan_id
    and app_private.can_manage_training_plan(p.organization_id, p.facility_id)));

-- Trigger lookups must see all provenance even when the caller cannot read a
-- former learner. These private trigger functions do not grant table access.
create function app_private.guard_training_plan_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and exists (
    select 1 from public.course_assignments a where a.training_plan_id = old.id
  ) then
    if tg_op = 'DELETE' and old.facility_id is not null then
      raise exception 'A used training plan cannot be deleted' using errcode = '55000';
    end if;
    if tg_op = 'UPDATE' and (old.facility_id is not null or new.facility_id is not null) and (
      new.organization_id is distinct from old.organization_id
      or new.facility_id is distinct from old.facility_id
      or new.training_year is distinct from old.training_year) then
      raise exception 'A used training plan cannot change organization, facility, or year' using errcode = '55000';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.facility_id is not null and not exists (
    select 1 from public.facilities f where f.id = new.facility_id
      and f.organization_id = new.organization_id and f.is_active
  ) then
    raise exception 'Training plan facility must be active and belong to its organization' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.training_plan_items i left join public.courses c on c.id = i.course_id
    where i.training_plan_id = new.id and (
      (new.facility_id is not null and i.course_id is null)
      or (c.organization_id is not null and c.organization_id <> new.organization_id)
    )
  ) then
    raise exception 'Training plan items do not match the plan scope' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_training_plan_scope() from public, anon, authenticated, service_role;
create trigger guard_training_plan_scope before insert or update or delete on public.training_plans
  for each row execute function app_private.guard_training_plan_scope();

create function app_private.guard_training_plan_item_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan public.training_plans;
begin
  if tg_op = 'UPDATE' and new.training_plan_id is distinct from old.training_plan_id then
    raise exception 'Move a course by removing and adding the training plan item' using errcode = '55000';
  end if;
  -- Every item edit and application locks the parent, giving apply one bundle.
  select * into v_plan from public.training_plans
    where id = case when tg_op = 'DELETE' then old.training_plan_id else new.training_plan_id end for update;
  if tg_op = 'DELETE' then return old; end if;
  if v_plan.facility_id is not null and new.course_id is null then
    raise exception 'Yearly training plans contain courses only' using errcode = '23514';
  end if;
  if new.course_id is not null and not exists (
    select 1 from public.courses c where c.id = new.course_id
      and (c.organization_id is null or c.organization_id = v_plan.organization_id)
  ) then
    raise exception 'Training plan course is outside the organization' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.course_id is distinct from old.course_id and exists (
    select 1 from public.course_assignments a where a.training_plan_item_id = old.id
  ) then
    raise exception 'Remove and add a new item to change an assigned plan course' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_training_plan_item_scope() from public, anon, authenticated, service_role;
create trigger guard_training_plan_item_scope before insert or update or delete on public.training_plan_items
  for each row execute function app_private.guard_training_plan_item_scope();

create function app_private.guard_yearly_assignment_provenance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_plan public.training_plans;
begin
  if tg_op = 'UPDATE' and new.training_plan_id is distinct from old.training_plan_id
    and exists (select 1 from public.training_plans p
      where p.id in (old.training_plan_id, new.training_plan_id) and p.facility_id is not null) then
    raise exception 'Yearly training assignment provenance is immutable' using errcode = '55000';
  end if;
  if new.training_plan_id is null then
    -- Legacy parent deletion has two independent SET NULL foreign-key actions;
    -- the item reference can be cleared later in that same statement.
    if new.training_plan_item_id is not null and (tg_op = 'INSERT' or old.training_plan_id is null) then
      raise exception 'A training plan item requires its parent plan' using errcode = '23514';
    end if;
    return new;
  end if;
  select * into v_plan from public.training_plans where id = new.training_plan_id for key share;
  if new.training_plan_item_id is not null and not exists (
    select 1 from public.training_plan_items i where i.id = new.training_plan_item_id
      and i.training_plan_id = new.training_plan_id and i.course_id = new.course_id
  ) then
    raise exception 'Assignment course and training plan item must match' using errcode = '23514';
  end if;
  if v_plan.facility_id is not null and (
    new.organization_id is distinct from v_plan.organization_id
    or (tg_op = 'INSERT' and (new.facility_id is distinct from v_plan.facility_id
      or new.training_plan_item_id is null or new.due_date is distinct from v_plan.due_date))
  ) then
    raise exception 'Yearly assignment must match the plan facility, course, and explicit deadline' using errcode = '23514';
  end if;
  -- Existing protect_course_assignment_evidence_identity rejects direct UPDATE
  -- scope changes. The authorized workforce lifecycle can move unfinished
  -- assignments to a new facility while retaining their original plan. Later
  -- completion/deadline writes must still work on those transferred rows.
  if tg_op = 'UPDATE' and v_plan.facility_id is not null
    and new.due_date is distinct from old.due_date and old.status = 'overdue'
    and new.due_date >= public.pa_today() then
    -- The same restoration rule as recalculate_course_assignment_statuses,
    -- applied immediately when the administrator extends the deadline.
    new.status := case when exists (select 1 from public.course_progress p
      where p.assignment_id = old.id)
      then 'in_progress' else 'assigned' end;
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_yearly_assignment_provenance() from public, anon, authenticated, service_role;
-- After stamp_scope, so checking the server-derived employee facility is sufficient.
create trigger validate_yearly_assignment_provenance before insert or update on public.course_assignments
  for each row execute function app_private.guard_yearly_assignment_provenance();

-- Builtin facility managers receive facility-scoped grants. Checking this
-- permission at organization scope rejects their legitimate cancellations.
-- Keep the role, organization, facility, session, and assurance boundaries.
create or replace function public.cancel_course_assignment(p_assignment_id uuid, p_reason text)
returns public.course_assignments language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.course_assignments;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_assignment from public.course_assignments where id = p_assignment_id for update;
  if not found then raise exception 'Course assignment not found' using errcode = 'P0002'; end if;
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' and not public.is_platform_admin() then
    if auth.uid() is null or not public.current_session_unlocked()
      or public.current_org_id() is distinct from v_assignment.organization_id
      or not coalesce(public.current_role() in ('org_admin', 'facility_manager', 'trainer'), false)
      or not public.is_assigned_to_facility(v_assignment.facility_id)
      or not app_private.has_product_module('modules.train') then
      raise exception 'This course assignment belongs to a facility outside your scope' using errcode = '42501';
    end if;
    perform public.assert_identity_assurance('workforce_admin');
    if public.current_role() <> 'org_admin' and not public.has_effective_permission(
      'training.sessions.manage', 'facility', v_assignment.facility_id, now()) then
      raise exception 'Required content permission is missing: training.sessions.manage' using errcode = '42501';
    end if;
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Say why this assignment is being cancelled -- at least a sentence' using errcode = '22023';
  end if;
  if v_assignment.status = 'completed' then
    raise exception 'A completed assignment cannot be cancelled' using errcode = '55000';
  end if;
  if v_assignment.status = 'canceled' then return v_assignment; end if;
  perform set_config('app.privileged_write', 'on', true);
  update public.course_assignments set status = 'canceled', canceled_at = now(),
    cancellation_reason = v_reason, updated_at = now()
    where id = v_assignment.id returning * into v_assignment;
  perform set_config('app.privileged_write', '', true);
  insert into public.audit_logs(organization_id, actor_profile_id, action, entity_type, entity_id, metadata)
    values(v_assignment.organization_id, auth.uid(), 'course_assignment.canceled', 'course_assignments',
      v_assignment.id::text, jsonb_build_object('reason', v_reason,
        'employeeId', v_assignment.employee_id, 'courseId', v_assignment.course_id));
  return v_assignment;
end;
$$;
revoke all on function public.cancel_course_assignment(uuid, text) from public, anon;
grant execute on function public.cancel_course_assignment(uuid, text) to authenticated;

create function public.apply_yearly_training_plan(p_plan_id uuid, p_employee_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.training_plans;
  v_employee public.employees;
  v_item record;
  v_assignment public.course_assignments;
  v_id uuid;
  v_assigned integer := 0;
  v_updated integer := 0;
  v_canceled integer := 0;
  v_completed integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.current_session_unlocked() then
    raise exception 'Current unlocked session required' using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('workforce_admin');
  -- SELECT FOR UPDATE applies both SELECT and UPDATE USING policies. The
  -- latter is the manager-scope predicate above, so a readable plan alone is
  -- insufficient. Keep this RPC invoker and the private schema inaccessible.
  select * into v_plan from public.training_plans where id = p_plan_id for update;
  if not found then
    raise exception 'Training manager access required for this plan' using errcode = '42501';
  end if;
  if v_plan.facility_id is null or v_plan.training_year is null or v_plan.due_date is null then
    raise exception 'Choose a yearly plan with a facility, year, and explicit required-completion date' using errcode = '22023';
  end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if not found or v_employee.organization_id is distinct from v_plan.organization_id
    or v_employee.facility_id is distinct from v_plan.facility_id or v_employee.status <> 'active' then
    raise exception 'Choose an active student in the plan facility' using errcode = '42501';
  end if;
  -- Validate every current item before any assignment is changed. Empty bundles
  -- deliberately allow withdrawing all unfinished plan-owned courses.
  if exists (
    select 1 from public.training_plan_items i
    left join public.courses c on c.id = i.course_id
    left join public.course_versions cv on cv.id = c.current_version_id and cv.course_id = c.id
    where i.training_plan_id = v_plan.id and (
      i.course_id is null or c.id is null or cv.id is null
      or (c.organization_id is not null and c.organization_id <> v_plan.organization_id)
      or c.status <> 'published' or cv.status <> 'published'
      or (cv.ai_generated and cv.ai_reviewed_at is null)
    )
  ) then
    raise exception 'Every plan course must have a published, reviewed current version in this organization or the global catalog' using errcode = '23514';
  end if;
  for v_assignment in
    select a.* from public.course_assignments a
    where a.employee_id = p_employee_id and a.training_plan_id = v_plan.id
      and a.status in ('assigned', 'in_progress', 'overdue', 'paused')
      and not exists (select 1 from public.training_plan_items i
        where i.training_plan_id = v_plan.id and i.course_id = a.course_id)
    order by a.id for update
  loop
    perform public.cancel_course_assignment(v_assignment.id, 'Course removed from yearly training plan: ' || v_plan.name);
    v_canceled := v_canceled + 1;
  end loop;
  for v_item in
    select i.id, c.id as course_id, c.title, c.current_version_id
    from public.training_plan_items i join public.courses c on c.id = i.course_id
    where i.training_plan_id = v_plan.id order by c.id
  loop
    if exists (select 1 from public.course_assignments a where a.employee_id = p_employee_id
      and a.course_id = v_item.course_id and a.training_plan_id = v_plan.id and a.status = 'completed') then
      v_completed := v_completed + 1;
      continue;
    end if;
    select * into v_assignment from public.course_assignments a
      where a.employee_id = p_employee_id and a.course_id = v_item.course_id
        and a.status in ('assigned', 'in_progress', 'overdue', 'paused') for update;
    if not found then
      -- Completion can win while the open-row lock is waiting. Recheck after
      -- that wait rather than creating a second copy of a just-completed course.
      if exists (select 1 from public.course_assignments a where a.employee_id = p_employee_id
        and a.course_id = v_item.course_id and a.training_plan_id = v_plan.id and a.status = 'completed') then
        v_completed := v_completed + 1;
        continue;
      end if;
      v_id := null;
      insert into public.course_assignments(organization_id, facility_id, employee_id, course_id,
        course_version_id, assigned_by, due_date, training_plan_id, training_plan_item_id)
      values(v_plan.organization_id, v_plan.facility_id, p_employee_id, v_item.course_id,
        v_item.current_version_id, auth.uid(), v_plan.due_date, v_plan.id, v_item.id)
      on conflict (employee_id, course_id) where status in ('assigned', 'in_progress', 'overdue', 'paused')
        do nothing returning id into v_id;
      if v_id is not null then
        v_assigned := v_assigned + 1;
        continue;
      end if;
      -- Another assigner won the one-open-course race. Report the real row;
      -- never adopt or overwrite someone else's assignment.
      select * into v_assignment from public.course_assignments a
        where a.employee_id = p_employee_id and a.course_id = v_item.course_id
          and a.status in ('assigned', 'in_progress', 'overdue', 'paused') for update;
      if not found then
        raise exception 'Assignment changed during plan application; retry the plan' using errcode = '40001';
      end if;
    end if;
    if v_assignment.training_plan_id = v_plan.id then
      if v_assignment.due_date is distinct from v_plan.due_date then
        update public.course_assignments set due_date = v_plan.due_date where id = v_assignment.id;
        v_updated := v_updated + 1;
      end if;
    else
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'course_id', v_item.course_id, 'title', v_item.title,
        'assignment_id', v_assignment.id, 'due_date', v_assignment.due_date));
    end if;
  end loop;
  return jsonb_build_object('assigned', v_assigned, 'updated', v_updated, 'canceled', v_canceled,
    'already_completed', v_completed, 'conflicts', v_conflicts);
end;
$$;
revoke all on function public.apply_yearly_training_plan(uuid, uuid) from public, anon;
grant execute on function public.apply_yearly_training_plan(uuid, uuid) to authenticated;
comment on function public.apply_yearly_training_plan(uuid, uuid) is
  'Explicitly apply the current yearly course bundle to one active student. Atomic and repeatable; preserves completed evidence and unrelated open assignments. Edits are applied only when called again.';

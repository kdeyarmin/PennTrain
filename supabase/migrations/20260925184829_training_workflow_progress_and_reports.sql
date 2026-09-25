-- Training activity and required obligations have different denominators.
-- Old rows remain required: historical self-enrollment cannot be inferred safely
-- from assigned_by (administrators can assign themselves) or a missing due date.
alter table public.course_assignments
  add column is_required boolean not null default true,
  add column assignment_origin text not null default 'administrator'
    check (assignment_origin in ('administrator','self_enrolled','plan','legacy'));
update public.course_assignments set assignment_origin='legacy';
comment on column public.course_assignments.assignment_origin is
  'Server-recorded provenance. Legacy rows are conservatively required until a training manager reviews them.';

create function app_private.guard_training_assignment_purpose()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.training_plan_id is not null then
      new.assignment_origin:='plan';
      new.is_required:=coalesce((select i.is_required from public.training_plan_items i
        where i.training_plan_id=new.training_plan_id and i.course_id=new.course_id limit 1),true);
    elsif new.assignment_origin='self_enrolled' then
      if not coalesce(current_setting('app.training_self_enrollment',true),'')='true' then
        raise exception 'Self enrollment must use the course enrollment action' using errcode='42501';
      end if;
      new.is_required:=false;
    else
      new.assignment_origin:='administrator';
    end if;
  elsif new.assignment_origin is distinct from old.assignment_origin then
    raise exception 'Assignment provenance is immutable' using errcode='42501';
  end if;
  if tg_op='UPDATE' and new.is_required is distinct from old.is_required then
    if auth.uid() is null or not coalesce(app_private.can_manage_training_plan(old.organization_id,old.facility_id),false) then
      raise exception 'Training manager access required' using errcode='42501';
    end if;
    perform public.assert_identity_assurance('workforce_admin');
    if old.training_plan_id is not null and new.is_required is distinct from
      (select i.is_required from public.training_plan_items i where i.training_plan_id=old.training_plan_id and i.course_id=old.course_id limit 1) then
      raise exception 'Change the plan requirement and reapply the plan' using errcode='22023';
    end if;
    if old.status='completed' then
      raise exception 'Completed assignment purpose is retained in history' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_training_assignment_purpose() from public,anon,authenticated;
create trigger training_assignment_purpose before insert or update on public.course_assignments
  for each row execute function app_private.guard_training_assignment_purpose();

-- Enrollment survives an all-conflict application with zero new assignments.
create table public.training_plan_enrollments (
  training_plan_id uuid not null references public.training_plans(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  applied_snapshot jsonb,
  resolved_assignments jsonb not null default '{}'::jsonb check(jsonb_typeof(resolved_assignments)='object'),
  applied_at timestamptz not null default now(),
  applied_by uuid references public.profiles(id) on delete set null,
  primary key(training_plan_id,employee_id)
);
create index training_plan_enrollments_employee_idx on public.training_plan_enrollments(employee_id);
create index training_plan_enrollments_facility_idx on public.training_plan_enrollments(facility_id);
create index training_plan_enrollments_organization_idx on public.training_plan_enrollments(organization_id);
create index training_plan_enrollments_actor_idx on public.training_plan_enrollments(applied_by);
alter table public.training_plan_enrollments enable row level security;
grant select,insert,update on public.training_plan_enrollments to authenticated;
create policy training_plan_enrollments_read on public.training_plan_enrollments for select to authenticated
using (exists(select 1 from public.training_plans p where p.id=training_plan_id and p.organization_id=training_plan_enrollments.organization_id)
  and exists(select 1 from public.employees e where e.id=employee_id));
create policy training_plan_enrollments_insert on public.training_plan_enrollments for insert to authenticated
with check (app_private.can_manage_training_plan(organization_id,facility_id)
  and exists(select 1 from public.training_plans p where p.id=training_plan_id and p.organization_id=training_plan_enrollments.organization_id and p.facility_id=training_plan_enrollments.facility_id)
  and exists(select 1 from public.employees e where e.id=employee_id and e.organization_id=training_plan_enrollments.organization_id and e.facility_id=training_plan_enrollments.facility_id));
create policy training_plan_enrollments_update on public.training_plan_enrollments for update to authenticated
using (app_private.can_manage_training_plan(organization_id,facility_id))
with check (app_private.can_manage_training_plan(organization_id,facility_id)
  and exists(select 1 from public.training_plans p where p.id=training_plan_id and p.organization_id=training_plan_enrollments.organization_id and p.facility_id=training_plan_enrollments.facility_id)
  and exists(select 1 from public.employees e where e.id=employee_id and e.organization_id=training_plan_enrollments.organization_id and e.facility_id=training_plan_enrollments.facility_id));
comment on table public.training_plan_enrollments is
  'Durable yearly-plan membership and explicit cross-assignment resolutions. NULL legacy snapshots require reapplication. Does not itself award completion or change another assignment deadline.';
insert into public.training_plan_enrollments(training_plan_id,employee_id,organization_id,facility_id,applied_at)
select a.training_plan_id,a.employee_id,p.organization_id,p.facility_id,min(a.assigned_at)
from public.course_assignments a join public.training_plans p on p.id=a.training_plan_id
where p.facility_id is not null group by a.training_plan_id,a.employee_id,p.organization_id,p.facility_id;

revoke all on public.training_plan_enrollments from public,anon,authenticated;
grant select,insert,update on public.training_plan_enrollments to authenticated;
grant all on public.training_plan_enrollments to service_role;
create policy training_plan_enrollments_scope on public.training_plan_enrollments as restrictive for all to authenticated
using (app_private.can_read_train_scope(organization_id,facility_id,employee_id))
with check (app_private.can_read_train_scope(organization_id,facility_id,employee_id));
create policy sms_mfa_session_required on public.training_plan_enrollments as restrictive for all to authenticated
using ((select public.current_sms_mfa_satisfied())) with check ((select public.current_sms_mfa_satisfied()));
create policy impersonation_session_lifetime on public.training_plan_enrollments as restrictive for all to authenticated
using ((select public.current_impersonation_session_live())) with check ((select public.current_impersonation_session_live()));
create policy product_module_entitlement on public.training_plan_enrollments as restrictive for all to authenticated
using ((select app_private.has_product_module('modules.train'))) with check ((select app_private.has_product_module('modules.train')));
create trigger audit_log after insert or update or delete on public.training_plan_enrollments
for each row execute function public.audit_log_trigger();
insert into app_private.audit_entity_manifest(table_name,audit_mode,contains_regulated_data,rationale)
values('training_plan_enrollments','row_trigger',true,'Audited plan applications and explicit assignment resolutions; employee and plan identity are recorded in the row history.');
insert into app_private.product_module_resources(resource_schema,resource_name,module_key)
values('public','training_plan_enrollments','modules.train');

create function app_private.guard_training_plan_enrollment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(app_private.can_manage_training_plan(new.organization_id,new.facility_id),false) then
    raise exception 'Training manager access required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('workforce_admin');
  if tg_op='UPDATE' and (new.training_plan_id,new.employee_id,new.organization_id,new.facility_id)
    is distinct from (old.training_plan_id,old.employee_id,old.organization_id,old.facility_id) then
    raise exception 'Plan enrollment identity is immutable' using errcode='42501'; end if;
  if (tg_op='INSERT' or new.applied_snapshot is distinct from old.applied_snapshot)
    and coalesce(current_setting('app.training_plan_apply',true),'')<>'true' then
    raise exception 'Apply the plan to update its application snapshot' using errcode='42501'; end if;
  if coalesce(current_setting('app.training_plan_apply',true),'')='true' then
    select coalesce(jsonb_object_agg(r.key,r.value),'{}') into new.resolved_assignments
    from jsonb_each_text(new.resolved_assignments) r where exists (
      select 1 from public.course_assignments a join public.training_plan_items i on i.course_id=a.course_id
      where a.id::text=r.value and a.course_id::text=r.key and i.training_plan_id=new.training_plan_id
        and a.employee_id=new.employee_id and a.facility_id=new.facility_id and a.status<>'canceled');
  end if;
  if exists(select 1 from jsonb_each_text(new.resolved_assignments) r where not exists(
    select 1 from public.course_assignments a join public.training_plan_items i on i.course_id=a.course_id
    where a.id::text=r.value and a.course_id::text=r.key and i.training_plan_id=new.training_plan_id
      and a.employee_id=new.employee_id and a.organization_id=new.organization_id and a.facility_id=new.facility_id
      and a.status<>'canceled')) then
    raise exception 'Resolved assignments must belong to this employee, facility and plan course' using errcode='22023'; end if;
  new.applied_by:=auth.uid();
  if coalesce(current_setting('app.training_plan_apply',true),'')='true' then new.applied_at:=now();
  elsif tg_op='UPDATE' then new.applied_at:=old.applied_at; end if;
  return new;
end;
$$;
revoke all on function app_private.guard_training_plan_enrollment() from public,anon,authenticated;
create trigger guard_training_plan_enrollment before insert or update on public.training_plan_enrollments
for each row execute function app_private.guard_training_plan_enrollment();

create function public.get_training_plan_progress(p_plan_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_plan public.training_plans; v_snapshot jsonb; v_result jsonb;
begin
  if auth.uid() is null or not public.current_session_unlocked() then
    raise exception 'Current unlocked session required' using errcode='42501'; end if;
  select * into v_plan from public.training_plans where id=p_plan_id;
  if not found then raise exception 'Plan is outside your access' using errcode='42501'; end if;
  select jsonb_build_object('due_date',v_plan.due_date,'items',coalesce(jsonb_agg(jsonb_build_array(i.id,i.course_id,i.is_required) order by i.id),'[]'))
    into v_snapshot from public.training_plan_items i where i.training_plan_id=p_plan_id;
  with coverage as (
    select n.employee_id,concat_ws(' ',e.first_name,e.last_name) as student,
      n.applied_snapshot is distinct from v_snapshot as needs_reapply,n.applied_at,
      coalesce(jsonb_agg(jsonb_build_object('course_id',i.course_id,'title',c.title,'required',i.is_required,
        'assignment_id',a.id,'status',coalesce(a.status,'missing'),'due_date',a.due_date,
        'conflict_assignment_id',conflict.id,'conflict_due_date',conflict.due_date)
        order by i.sort_order,i.id) filter(where i.id is not null),'[]') as items,
      count(*) filter(where i.is_required) as required,
      count(*) filter(where i.is_required and a.status='completed') as completed,
      count(*) filter(where i.is_required and a.id is null) as unresolved
    from public.training_plan_enrollments n join public.employees e on e.id=n.employee_id
    left join public.training_plan_items i on i.training_plan_id=n.training_plan_id
    left join public.courses c on c.id=i.course_id
    left join lateral (select ca.* from public.course_assignments ca where ca.employee_id=n.employee_id and ca.course_id=i.course_id
      and ca.organization_id=n.organization_id and ca.facility_id=n.facility_id
      and (ca.training_plan_id=n.training_plan_id or ca.id::text=n.resolved_assignments->>i.course_id::text)
      and ca.status<>'canceled' order by (ca.status='completed') desc,ca.assigned_at desc,ca.id limit 1) a on true
    left join lateral (select ca.id,ca.due_date from public.course_assignments ca where ca.employee_id=n.employee_id and ca.course_id=i.course_id
      and ca.facility_id=n.facility_id and ca.status in ('assigned','in_progress','overdue','paused') and a.id is null
      order by ca.id limit 1) conflict on true
    where n.training_plan_id=p_plan_id group by n.employee_id,e.first_name,e.last_name,n.applied_snapshot,n.applied_at
  ) select coalesce(jsonb_agg(to_jsonb(coverage) order by student,employee_id),'[]') into v_result from coverage;
  return v_result;
end;
$$;
revoke all on function public.get_training_plan_progress(uuid) from public,anon;
grant execute on function public.get_training_plan_progress(uuid) to authenticated;

create function public.resolve_training_plan_assignment(p_plan_id uuid,p_employee_id uuid,p_assignment_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare v_plan public.training_plans; v_assignment public.course_assignments;
begin
  select * into v_plan from public.training_plans where id=p_plan_id for no key update;
  if not found then raise exception 'Plan is outside your access' using errcode='42501'; end if;
  perform public.assert_yearly_training_plan_employee(p_plan_id,p_employee_id);
  select * into v_assignment from public.course_assignments where id=p_assignment_id for update;
  if not found or v_assignment.employee_id<>p_employee_id or v_assignment.facility_id<>v_plan.facility_id
    or v_assignment.organization_id<>v_plan.organization_id or v_assignment.status='canceled'
    or not exists(select 1 from public.training_plan_items where training_plan_id=p_plan_id and course_id=v_assignment.course_id) then
    raise exception 'Choose this student''s existing assignment for a course in this plan' using errcode='22023'; end if;
  update public.training_plan_enrollments set resolved_assignments=resolved_assignments||jsonb_build_object(v_assignment.course_id::text,p_assignment_id)
    where training_plan_id=p_plan_id and employee_id=p_employee_id;
  if not found then raise exception 'Apply the plan before resolving assignments' using errcode='22023'; end if;
end;
$$;
revoke all on function public.resolve_training_plan_assignment(uuid,uuid,uuid) from public,anon;
grant execute on function public.resolve_training_plan_assignment(uuid,uuid,uuid) to authenticated;

-- Certificate identity is captured once; PDF retries never follow mutable catalog names.
alter table public.certificates add column course_title_snapshot text,
  add column course_code_snapshot text, add column course_version_snapshot text;
update public.certificates cert set course_title_snapshot=coalesce(cv.title,c.title),
  course_code_snapshot=c.catalog_code,course_version_snapshot=coalesce(cv.version_label,'v'||cv.version_number::text)
from public.courses c left join public.course_assignments a on a.course_id=c.id
left join public.course_versions cv on cv.id=a.course_version_id
where cert.course_id=c.id and cert.course_assignment_id=a.id;
update public.certificates cert set course_title_snapshot=c.title,course_code_snapshot=c.catalog_code
from public.courses c where cert.course_id=c.id and cert.course_title_snapshot is null;
create function app_private.snapshot_training_certificate()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    new.course_title_snapshot:=old.course_title_snapshot;
    new.course_code_snapshot:=old.course_code_snapshot;
    new.course_version_snapshot:=old.course_version_snapshot;
  else
    select coalesce(cv.title,c.title),c.catalog_code,coalesce(cv.version_label,'v'||cv.version_number::text)
      into new.course_title_snapshot,new.course_code_snapshot,new.course_version_snapshot
    from public.courses c left join public.course_assignments a on a.id=new.course_assignment_id and a.course_id=c.id
      left join public.course_versions cv on cv.id=a.course_version_id where c.id=new.course_id;
  end if;
  return new;
end;
$$;
revoke all on function app_private.snapshot_training_certificate() from public,anon,authenticated;
create trigger snapshot_training_certificate before insert or update on public.certificates
  for each row execute function app_private.snapshot_training_certificate();


create or replace function public.self_enroll_course(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_employee public.employees;
  v_course public.courses;
  v_version_status text;
  v_version_ai_generated boolean;
  v_version_ai_reviewed_at timestamptz;
  v_assignment public.course_assignments;
  v_assignment_id uuid;
  v_pa_today date := (now() at time zone 'America/New_York')::date;
  v_self_service_renewal_window_days constant integer := 30;
begin
  if auth.uid() is null or public.current_role() is null or not public.current_session_unlocked()
    or not app_private.has_product_module('modules.train') then
    raise exception 'an active authenticated profile is required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_employee from public.employees where profile_id = auth.uid();
  if not found then
    perform public.ensure_employee_record(auth.uid());
    select * into v_employee from public.employees where profile_id = auth.uid();
    if not found then
      raise exception 'no employee record for current user' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Administrative/auditor profiles are deliberately provisioned as inactive
  -- pseudo-employees by ensure_employee_record() so their own learning never
  -- pollutes workforce-compliance denominators. They may still take training.
  -- A real employee who is inactive, or anyone marked terminated, stays blocked;
  -- on-leave employees may complete assigned learning.
  if v_employee.status = 'terminated'
     or (v_employee.status = 'inactive' and public.current_role() = 'employee') then
    raise exception 'inactive or terminated employees may not self-enroll in courses'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_course from public.courses where id = p_course_id;
  if not found or v_course.status <> 'published' or v_course.current_version_id is null then
    raise exception 'course is not available to enroll in' using errcode = 'invalid_parameter_value';
  end if;

  if v_course.organization_id is not null
     and v_course.organization_id <> v_employee.organization_id then
    raise exception 'course is not available to enroll in' using errcode = 'invalid_parameter_value';
  end if;

  select status, ai_generated, ai_reviewed_at
    into v_version_status, v_version_ai_generated, v_version_ai_reviewed_at
  from public.course_versions
  where id = v_course.current_version_id;

  if v_version_status is distinct from 'published'
     or (v_version_ai_generated and v_version_ai_reviewed_at is null) then
    raise exception 'course is not available to enroll in' using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_employee.id::text || ':' || p_course_id::text, 0)
  );

  select * into v_assignment
  from public.course_assignments
  where employee_id = v_employee.id
    and course_id = p_course_id
    and status in ('assigned', 'in_progress', 'overdue', 'paused')
  order by assigned_at desc
  limit 1;

  if found then
    return v_assignment.id;
  end if;

  select * into v_assignment
  from public.course_assignments
  where employee_id = v_employee.id
    and course_id = p_course_id
    and status = 'completed'
  order by completion_recorded_at desc, assigned_at desc
  limit 1;

  if found
     and (
       v_course.recurrence_interval_days is null
       or v_assignment.completion_recorded_at is null
       or ((v_assignment.completion_recorded_at at time zone 'America/New_York')::date
           + greatest(
               v_course.recurrence_interval_days - v_self_service_renewal_window_days,
               1
             )) > v_pa_today
     ) then
    return v_assignment.id;
  end if;

  perform set_config('app.training_self_enrollment','true',true);
  insert into public.course_assignments (
    organization_id,
    facility_id,
    employee_id,
    course_id,
    course_version_id,
    assigned_by, assignment_origin, is_required
  ) values (
    v_employee.organization_id,
    v_employee.facility_id,
    v_employee.id,
    p_course_id,
    v_course.current_version_id,
    auth.uid(), 'self_enrolled', false
  )
  returning id into v_assignment_id;

  perform set_config('app.training_self_enrollment','false',true);
  return v_assignment_id;
end;
$function$;

create or replace function public.apply_yearly_training_plan(p_plan_id uuid, p_employee_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.training_plans;
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
  -- A locking SELECT applies both SELECT and UPDATE USING policies. The
  -- latter is the manager-scope predicate above, so a readable plan alone is
  -- insufficient. NO KEY UPDATE serializes plan edits and apply calls while
  -- allowing assignment completion to take its parent KEY SHARE lock.
  select * into v_plan from public.training_plans where id = p_plan_id for no key update;
  if not found then
    raise exception 'Training manager access required for this plan' using errcode = '42501';
  end if;
  if v_plan.facility_id is null or v_plan.training_year is null or v_plan.due_date is null then
    raise exception 'Choose a yearly plan with a facility, year, and explicit required-completion date' using errcode = '22023';
  end if;
  perform public.assert_yearly_training_plan_employee(p_plan_id, p_employee_id);
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
    select i.id, i.is_required, c.id as course_id, c.title, c.current_version_id
    from public.training_plan_items i join public.courses c on c.id = i.course_id
    where i.training_plan_id = v_plan.id order by c.id
  loop
    -- An explicitly resolved requirement reuses that exact assignment, including
    -- after completion, without taking ownership or changing its deadline.
    select ca.* into v_assignment from public.training_plan_enrollments n
      join public.course_assignments ca on ca.id::text=n.resolved_assignments->>v_item.course_id::text
      where n.training_plan_id=p_plan_id and n.employee_id=p_employee_id
        and ca.employee_id=p_employee_id and ca.course_id=v_item.course_id
        and ca.facility_id=v_plan.facility_id and ca.status<>'canceled';
    if found then
      if v_assignment.status='completed' then v_completed:=v_completed+1; end if;
      continue;
    end if;
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
        course_version_id, assigned_by, due_date, training_plan_id)
      values(v_plan.organization_id, v_plan.facility_id, p_employee_id, v_item.course_id,
        v_item.current_version_id, auth.uid(), v_plan.due_date, v_plan.id)
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
      if v_assignment.due_date is distinct from v_plan.due_date or v_assignment.is_required is distinct from v_item.is_required then
        update public.course_assignments set due_date = v_plan.due_date, is_required = v_item.is_required where id = v_assignment.id;
        v_updated := v_updated + 1;
      end if;
    else
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'course_id', v_item.course_id, 'title', v_item.title,
        'assignment_id', v_assignment.id, 'due_date', v_assignment.due_date));
    end if;
  end loop;
  perform set_config('app.training_plan_apply','true',true);
  insert into public.training_plan_enrollments(training_plan_id,employee_id,organization_id,facility_id,applied_snapshot,applied_at,applied_by)
  select p_plan_id,p_employee_id,v_plan.organization_id,v_plan.facility_id,
    jsonb_build_object('due_date',v_plan.due_date,'items',coalesce(jsonb_agg(jsonb_build_array(i.id,i.course_id,i.is_required) order by i.id),'[]')),
    now(),auth.uid() from public.training_plan_items i where i.training_plan_id=p_plan_id
  on conflict(training_plan_id,employee_id) do update set applied_snapshot=excluded.applied_snapshot,applied_at=excluded.applied_at,applied_by=excluded.applied_by;
  perform set_config('app.training_plan_apply','false',true);
  return jsonb_build_object('assigned' , v_assigned, 'updated', v_updated, 'canceled', v_canceled,
    'already_completed', v_completed, 'conflicts', v_conflicts);
end;
$$;

-- A current plan can require an otherwise elective assignment without changing
-- that assignment's owner, deadline or original classification.
create function public.training_assignment_is_required(p_assignment_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce((select a.is_required or exists(
    select 1 from public.training_plan_enrollments n join public.training_plan_items i on i.training_plan_id=n.training_plan_id
    where n.employee_id=a.employee_id and n.facility_id=a.facility_id and i.course_id=a.course_id and i.is_required
      and (a.training_plan_id=n.training_plan_id or n.resolved_assignments->>a.course_id::text=a.id::text))
    from public.course_assignments a where a.id=p_assignment_id),false);
$$;
revoke all on function public.training_assignment_is_required(uuid) from public,anon;
grant execute on function public.training_assignment_is_required(uuid) to authenticated;
create function public.get_training_required_assignments(p_employee_id uuid)
returns uuid[] language sql stable security invoker set search_path='' as $$
  select coalesce(array_agg(a.id),'{}'::uuid[]) from public.course_assignments a
    where a.employee_id=p_employee_id and (a.is_required or public.training_assignment_is_required(a.id));
$$;
revoke all on function public.get_training_required_assignments(uuid) from public,anon;
grant execute on function public.get_training_required_assignments(uuid) to authenticated;

create or replace function public.get_training_progress_report(
  p_organization_id uuid,
  p_facility_id uuid default null,
  p_course_search text default '',
  p_status text default 'all',
  p_date_basis text default 'assigned',
  p_date_from date default null,
  p_date_through date default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_employee_id uuid default null,
  p_plan_id uuid default null,
  p_purpose text default 'all',
  p_department text default '',
  p_training_year integer default null,
  p_deadline text default 'all'
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.current_session_unlocked()
    or not coalesce(public.current_role() in ('platform_admin','org_admin','facility_manager','trainer','auditor'),false) then
    raise exception 'Training reporting access required' using errcode='42501';
  end if;
  -- Full staff exports use the same assurance policy as the training evidence workspace.
  -- Trainers/auditors retain their configured policy; privileged sessions must still be fresh.
  perform public.assert_identity_assurance('compliance_profile_admin');
  if p_organization_id is null or (not public.is_platform_admin() and p_organization_id is distinct from public.current_org_id())
    or not exists(select 1 from public.organizations where id=p_organization_id) then
    raise exception 'Organization is outside your access' using errcode='42501';
  end if;
  if not public.is_platform_admin() and not exists(select 1 from public.get_effective_entitlements()
    where feature_key in ('modules.train','modules.carebase') and is_entitled) then
    raise exception 'Training reporting access required' using errcode='42501';
  end if;
  if p_facility_id is not null and not exists(select 1 from public.facilities
    where id=p_facility_id and organization_id=p_organization_id) then
    raise exception 'Facility is outside your access' using errcode='42501';
  end if;
  if p_status is null or p_status not in ('all','assigned','in_progress','completed','overdue','paused','canceled')
    or p_date_basis is null or p_date_basis not in ('assigned','completed','certificate','due')
    or p_limit is null or (p_limit not between 1 and 500 and p_limit <> 10000)
    or p_purpose not in ('all','required','optional') or p_purpose is null
    or p_deadline not in ('all','overdue','due_soon') or p_deadline is null
    or (p_training_year is not null and p_training_year not between 1990 and 2200)
    or length(coalesce(p_department,''))>200
    or p_offset is null or p_offset < 0 or (p_limit=10000 and p_offset<>0)
    or length(coalesce(p_course_search,'')) > 200
    or (p_date_from is not null and p_date_through is not null and p_date_from > p_date_through) then
    raise exception 'Invalid training report filters' using errcode='22023';
  end if;

  with enrollment as materialized (
    select a.id, a.employee_id,
      coalesce(nullif(btrim(concat_ws(' ',e.first_name,e.last_name)),''),'Student record '||a.employee_id::text) as student,
      a.facility_id, f.name as facility, a.course_id, coalesce(cv.title,c.title,'Course unavailable') as course,
      (a.is_required or public.training_assignment_is_required(a.id)) as is_required,a.assignment_origin,a.training_plan_id,plan.name as plan_name,plan.training_year,
      e.department,coalesce(cv.version_label,'v'||cv.version_number::text) as course_version,
      coalesce(credits.hours,0) as credit_hours,
      a.status, a.assigned_at, a.due_date, a.completed_at,
      case when a.status='completed' then 100 else coalesce(cp.percent_complete,0) end as percent_complete,
      cert.id as certificate_id, cert.credential_number, cert.issued_at as certificate_issued_at,
      cert.pdf_status as certificate_pdf_status,
      case p_date_basis when 'completed' then (a.completed_at at time zone 'America/New_York')::date
        when 'due' then a.due_date
        when 'certificate' then (cert.issued_at at time zone 'America/New_York')::date
        else (a.assigned_at at time zone 'America/New_York')::date end as filter_date
    from public.course_assignments a
    left join public.training_plans plan on plan.id=a.training_plan_id
    left join lateral(select max(credit_hours) as hours from public.course_completion_credits cc where cc.course_assignment_id=a.id) credits on true
    -- Historical assignments remain in their original facility after a staff transfer.
    -- Preserve authorized assignment rows even when current employee RLS hides the profile.
    left join public.employees e on e.id=a.employee_id and e.organization_id=a.organization_id
    join public.facilities f on f.id=a.facility_id and f.organization_id=a.organization_id
    left join public.courses c on c.id=a.course_id
    left join public.course_versions cv on cv.id=a.course_version_id and cv.course_id=a.course_id
    left join public.course_progress cp on cp.assignment_id=a.id
    -- The assignment FK is unique; do not join by employee/course, which duplicates annual renewals.
    left join public.certificates cert on cert.course_assignment_id=a.id
      and cert.organization_id=a.organization_id and cert.employee_id=a.employee_id
    where a.organization_id=p_organization_id
      and (p_facility_id is null or a.facility_id=p_facility_id)
      and (p_employee_id is null or a.employee_id=p_employee_id)
      and (p_plan_id is null or a.training_plan_id=p_plan_id or exists(select 1 from public.training_plan_enrollments n
        where n.training_plan_id=p_plan_id and n.employee_id=a.employee_id and n.resolved_assignments->>a.course_id::text=a.id::text))
      and (p_purpose='all' or (a.is_required or public.training_assignment_is_required(a.id))=(p_purpose='required'))
      and (coalesce(p_department,'')='' or e.department=p_department)
      and (p_training_year is null or coalesce(plan.training_year,extract(year from coalesce(a.due_date,(a.assigned_at at time zone 'America/New_York')::date))::integer)=p_training_year)
      and (p_deadline='all' or (a.status not in ('completed','canceled','paused') and
        ((p_deadline='overdue' and a.due_date<public.pa_today()) or (p_deadline='due_soon' and a.due_date between public.pa_today() and public.pa_today()+7))))
      and (p_status='all'  or a.status=p_status)
      and (btrim(coalesce(p_course_search,''))='' or strpos(lower(coalesce(cv.title,c.title,'')),lower(btrim(p_course_search)))>0)
  ), filtered as materialized (
    select * from enrollment where filter_date is not null
      and (p_date_from is null or filter_date >= p_date_from)
      and (p_date_through is null or filter_date <= p_date_through)
  ), page as (
    select * from filtered order by assigned_at desc,id limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'organization_name',(select name from public.organizations where id=p_organization_id),
    'facility_name',(select name from public.facilities where id=p_facility_id),
    'generated_at',now(),'date_basis',p_date_basis,'limit',p_limit,'offset',p_offset,
    'total',count(*),'students',count(distinct employee_id),
    'completed',count(*) filter(where status='completed'),
    'in_progress',count(*) filter(where status='in_progress'),
    'not_started',count(*) filter(where status='assigned'),
    'canceled',count(*) filter(where status='canceled'),
    'completion_denominator',count(*) filter(where status<>'canceled'),
    'certificates',count(certificate_id),
    'required_total',count(*) filter(where is_required and status<>'canceled'),
    'required_completed',count(*) filter(where is_required and status='completed'),
    'optional_total',count(*) filter(where not is_required and status<>'canceled'),
    -- The reserved export size reads its complete result in this one MVCC snapshot.
    -- Avoid constructing a large partial payload when the result exceeds the export bound.
    'rows',case when p_limit=10000 and count(*)>10000 then '[]'::jsonb
      else coalesce((select jsonb_agg(to_jsonb(page) order by assigned_at desc,id) from page),'[]'::jsonb) end
  ) into v_result from filtered;
  if p_limit=10000 and (v_result->>'total')::bigint>10000 then
    raise exception 'This report exceeds 10,000 enrollments. Narrow the dates, course or facility before exporting; no partial report was created.' using errcode='54000';
  end if;
  return v_result;
end;
$$;

revoke all on function public.get_training_progress_report(uuid,uuid,text,text,text,date,date,integer,integer,uuid,uuid,text,text,integer,text) from public,anon;
grant execute on function public.get_training_progress_report(uuid,uuid,text,text,text,date,date,integer,integer,uuid,uuid,text,text,integer,text) to authenticated;

-- A deliberate annual assignment exemption is distinct from an overlooked employee.
-- It never waives evidence, qualification, or regulatory requirements.
create table public.training_assignment_exemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  training_year integer not null check(training_year between 1990 and 2200),
  reason text not null check(length(btrim(reason)) between 10 and 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(employee_id,training_year)
);
create index training_assignment_exemptions_scope_idx on public.training_assignment_exemptions(organization_id,facility_id);
create index training_assignment_exemptions_facility_idx on public.training_assignment_exemptions(facility_id);
create index training_assignment_exemptions_actor_idx on public.training_assignment_exemptions(created_by);
alter table public.training_assignment_exemptions enable row level security;
revoke all on public.training_assignment_exemptions from public,anon,authenticated;
grant select on public.training_assignment_exemptions to authenticated;
grant all on public.training_assignment_exemptions to service_role;
create policy training_assignment_exemptions_read on public.training_assignment_exemptions for select to authenticated
using (app_private.can_read_train_scope(organization_id,facility_id,employee_id));
create policy sms_mfa_session_required on public.training_assignment_exemptions as restrictive for all to authenticated
using ((select public.current_sms_mfa_satisfied())) with check ((select public.current_sms_mfa_satisfied()));
create policy impersonation_session_lifetime on public.training_assignment_exemptions as restrictive for all to authenticated
using ((select public.current_impersonation_session_live())) with check ((select public.current_impersonation_session_live()));
create policy product_module_entitlement on public.training_assignment_exemptions as restrictive for all to authenticated
using ((select app_private.has_product_module('modules.train'))) with check ((select app_private.has_product_module('modules.train')));
create trigger audit_log after insert or update or delete on public.training_assignment_exemptions
for each row execute function public.audit_log_trigger();
insert into app_private.audit_entity_manifest(table_name,audit_mode,contains_regulated_data,rationale)
values('training_assignment_exemptions','row_trigger',true,'Manager rationale for an annual assignment exemption and every change/removal are audited; does not waive training qualifications.');
insert into app_private.product_module_resources(resource_schema,resource_name,module_key)
values('public','training_assignment_exemptions','modules.train');
create function public.set_training_assignment_exemption(p_employee_id uuid,p_training_year integer,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_employee public.employees;
begin
  select * into v_employee from public.employees where id=p_employee_id for update;
  if not found or auth.uid() is null or not coalesce(app_private.can_manage_training_plan(v_employee.organization_id,v_employee.facility_id),false) then
    raise exception 'Training manager access required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('workforce_admin');
  if p_training_year is null or p_training_year not between 1990 and 2200 then raise exception 'Choose a valid training year' using errcode='22023'; end if;
  if p_reason is null then
    delete from public.training_assignment_exemptions where employee_id=p_employee_id and training_year=p_training_year;
  else
    if length(btrim(p_reason)) not between 10 and 1000 then raise exception 'Explain the assignment exemption in 10 to 1000 characters' using errcode='22023'; end if;
    insert into public.training_assignment_exemptions(organization_id,facility_id,employee_id,training_year,reason,created_by)
    values(v_employee.organization_id,v_employee.facility_id,p_employee_id,p_training_year,btrim(p_reason),auth.uid())
    on conflict(employee_id,training_year) do update set reason=excluded.reason,created_by=excluded.created_by,created_at=now(),facility_id=excluded.facility_id;
  end if;
end;
$$;
revoke all on function public.set_training_assignment_exemption(uuid,integer,text) from public,anon;
grant execute on function public.set_training_assignment_exemption(uuid,integer,text) to authenticated;

create function public.get_training_roster_progress(p_facility_id uuid,p_search text default '',p_state text default 'all',
  p_training_year integer default null,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_org uuid; v_result jsonb;
begin
  select organization_id into v_org from public.facilities where id=p_facility_id;
  if v_org is null then raise exception 'Facility is outside your access' using errcode='42501'; end if;
  -- Reuse the current report's role, tenant, entitlement and fresh-session checks.
  perform public.get_training_enrollment_report(v_org,p_facility_id,p_limit=>1);
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset<0
    or length(coalesce(p_search,''))>200 or p_state is null
    or p_state not in ('all','exempt','no_assignments','overdue','due_soon','complete','in_progress','not_started','plan_attention','needs_invite','needs_activation')
    or (p_training_year is not null and p_training_year not between 1990 and 2200) then
    raise exception 'Invalid staff progress filters' using errcode='22023'; end if;
  with plan_progress as materialized (
    select (entry->>'employee_id')::uuid as employee_id,
      bool_or((entry->>'needs_reapply')::boolean or (entry->>'unresolved')::integer>0 ) as attention,
      bool_or((entry->>'required')::integer>(entry->>'completed')::integer) as incomplete
    from public.training_plans p cross join lateral jsonb_array_elements(public.get_training_plan_progress(p.id)) entry
    where p.facility_id=p_facility_id and (p_training_year is null or p.training_year=p_training_year)
    group by (entry->>'employee_id')::uuid
  ), roster as materialized (
    select e.id as employee_id,e.first_name,e.last_name,concat_ws(' ',e.first_name,e.last_name) as student,e.email,e.department,e.profile_id,
      invite.id as invitation_id,invite.last_sent_at,invite.last_error,
      exemption.reason as exemption_reason,exemption.training_year as exemption_year,
      case when invite.accepted_at is not null then 'activated' when e.email is null or btrim(e.email)='' then 'needs_email'
        when invite.status is not null then invite.status when e.profile_id is not null then 'linked' else 'not_invited' end as account_status,
      coalesce(a.required_total,0) as required_total,coalesce(a.required_completed,0) as required_completed,
      coalesce(a.optional_total,0) as optional_total,coalesce(a.overdue,0) as overdue,coalesce(a.due_soon,0) as due_soon,a.next_due,
      coalesce(pp.attention,false) as plan_attention,
      case when coalesce(a.overdue,0)>0 then 'overdue' when coalesce(pp.attention,false) then 'plan_attention'
        when coalesce(a.required_total,0)=0 and exemption.id is not null and not coalesce(pp.incomplete,false) then 'exempt'
        when coalesce(a.required_total,0)=0 then 'no_assignments'
        when a.required_total=a.required_completed and not coalesce(pp.incomplete,false) then 'complete' when a.due_soon>0 then 'due_soon'
        when a.started>0 or a.required_completed>0 then 'in_progress' else 'not_started' end as state
    from public.employees e
    left join lateral(select i.* from public.user_invitation_lifecycle i where i.organization_id=e.organization_id
      and (i.employee_id=e.id or (i.invited_user_id=e.profile_id and i.invited_role='employee'))
      order by i.last_sent_at desc,i.id limit 1) invite on true
    left join public.training_assignment_exemptions exemption on exemption.employee_id=e.id and exemption.facility_id=e.facility_id
      and exemption.training_year=coalesce(p_training_year,extract(year from public.pa_today())::int)
    left join plan_progress pp on pp.employee_id=e.id
    left join lateral(select count(*) filter(where (ca.is_required or public.training_assignment_is_required(ca.id)) and ca.status<>'canceled') as required_total,
      count(*) filter(where (ca.is_required or public.training_assignment_is_required(ca.id)) and ca.status='completed') as required_completed,
      count(*) filter(where not (ca.is_required or public.training_assignment_is_required(ca.id)) and ca.status<>'canceled') as optional_total,
      count(*) filter(where (ca.is_required or public.training_assignment_is_required(ca.id)) and ca.status not in ('completed','canceled','paused') and ca.due_date<public.pa_today()) as overdue,
      count(*) filter(where (ca.is_required or public.training_assignment_is_required(ca.id)) and ca.status not in ('completed','canceled','paused') and ca.due_date between public.pa_today() and public.pa_today()+7) as due_soon,
      count(*) filter(where (ca.is_required or public.training_assignment_is_required(ca.id)) and ca.status in ('in_progress','overdue')) as started,
      min(ca.due_date) filter(where (ca.is_required or public.training_assignment_is_required(ca.id)) and ca.status not in ('completed','canceled','paused')) as next_due
      from public.course_assignments ca left join public.training_plans tp on tp.id=ca.training_plan_id
      where ca.employee_id=e.id and ca.facility_id=p_facility_id and (p_training_year is null or
        coalesce(tp.training_year,extract(year from coalesce(ca.due_date,(ca.assigned_at at time zone 'America/New_York')::date))::integer)=p_training_year)) a on true
    where e.facility_id=p_facility_id and e.status='active'
  ), searched as materialized (
    select * from roster where coalesce(p_search,'')='' or strpos(lower(student||' '||coalesce(email,'')),lower(p_search))>0
  ), filtered as materialized (
    select * from searched where p_state='all' or state=p_state
      or (p_state='needs_invite' and account_status in ('needs_email','not_invited'))
      or (p_state='needs_activation' and account_status not in ('activated','needs_email','not_invited'))
  ), page as (select * from filtered order by student,employee_id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from filtered),'active_staff',count(*),
    'setup',jsonb_build_object(
      'profile_complete',(select coalesce(nullif(btrim(address),'') is not null and nullif(btrim(license_number),'') is not null
        and nullif(btrim(phone),'') is not null and nullif(btrim(administrator_name),'') is not null,false) from public.facilities where id=p_facility_id),
      'has_policy',exists(select 1 from public.training_facility_policies where facility_id=p_facility_id and effective_from<=public.pa_today()),
      'staff_count',(select count(*) from roster),
      'plan_count',(select count(*) from public.training_plans where facility_id=p_facility_id),
      'assigned_staff',(select count(*) from roster where required_total>0)),
    'exempt',count(*) filter(where state='exempt'),'no_assignments',count(*) filter(where state='no_assignments'),'overdue',count(*) filter(where overdue>0),
    'due_soon',count(*) filter(where due_soon>0),'complete',count(*) filter(where state='complete'),
    'plan_attention',count(*) filter(where plan_attention),
    'needs_invite',count(*) filter(where account_status in ('needs_email','not_invited')),
    'needs_activation',count(*) filter(where account_status not in ('activated','needs_email','not_invited')),
    'rows',coalesce((select jsonb_agg(to_jsonb(page) order by student,employee_id) from page),'[]')) into v_result from searched;
  return v_result;
end;
$$;
revoke all on function public.get_training_roster_progress(uuid,text,text,integer,integer,integer) from public,anon;
grant execute on function public.get_training_roster_progress(uuid,text,text,integer,integer,integer) to authenticated;

-- One completion ledger projection. Automatic course credits retain their own
-- provenance; external/observed qualifications still require separate review.
create function public.get_training_completion_evidence(p_facility_id uuid,p_employee_id uuid default null,p_limit integer default 500,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_org uuid; v_result jsonb;
begin
  select organization_id into v_org from public.facilities where id=p_facility_id;
  if v_org is null then raise exception 'Facility is outside your access' using errcode='42501'; end if;
  perform public.get_training_enrollment_report(v_org,p_facility_id,p_limit=>1);
  if p_limit is null or p_limit not between 1 and 500 or p_offset is null or p_offset<0 then
    raise exception 'Invalid evidence page' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into v_result from (
    select a.id,a.employee_id,a.id as course_assignment_id,coalesce(cv.title,c.title) as title,
      (a.completed_at at time zone 'America/New_York')::date as completed_on,a.completed_at,
      coalesce((select max(cc.credit_hours)*60 from public.course_completion_credits cc where cc.course_assignment_id=a.id),0) as minutes,
      'online'::text as delivery,coalesce(cert.training_provider,'Integrated course completion')::text as provider,
      'course:'||a.id::text as source_reference,coalesce(cert.provider_credential,'Published course version and server-issued credit')::text as provider_qualification,
      coalesce((select array_agg(distinct mapped.topic) from public.course_completion_credits cc
        cross join lateral (select case
          when cc.topic_code in ('PCH-2600.65-F1','ALR-2800.65-I1') then 'med_self_admin'
          when cc.topic_code in ('PCH-2600.65-F3','ALR-2800.65-I3') then 'dementia'
          when cc.topic_code in ('PCH-2600.65-F4','ALR-2800.65-I4') then 'infection'
          when cc.topic_code in ('PCH-2600.65-F6','ALR-2800.65-I6') then 'safe_management'
          when cc.topic_code in ('PCH-2600.65-G3','ALR-2800.65-J3') then 'rights'
          else null end as topic) mapped
        where cc.course_assignment_id=a.id and mapped.topic is not null),array[]::text[]) as topics,
      coalesce(credit.allocations,'{}'::jsonb) as allocations,null::date as valid_until,
      'verified'::text as status,'Online completion; separate observed or facility-specific requirements still apply.'::text as review_note,
      null::uuid as evidence_document_id,cert.id as certificate_id,true as automatic
    from public.course_assignments a join public.courses c on c.id=a.course_id
    left join public.course_versions cv on cv.id=a.course_version_id
    left join public.certificates cert on cert.course_assignment_id=a.id
    left join lateral(select jsonb_object_agg(bucket,minutes) as allocations from (
      select case tt.hour_bucket when 'general_annual' then 'base' when 'alr_dementia' then 'dementia_annual' when 'sdcu_dementia' then 'special_annual' end as bucket,
        max(cc.credit_hours)*60 as minutes
      from public.course_completion_credits cc join public.training_types tt on tt.id=cc.training_type_id
      where cc.course_assignment_id=a.id and tt.hour_bucket in ('general_annual','alr_dementia','sdcu_dementia')
      group by tt.hour_bucket) buckets) credit on true
    where a.facility_id=p_facility_id and a.status='completed' and (p_employee_id is null or a.employee_id=p_employee_id)
      -- A linked reviewed/manual event takes precedence, preventing duplicate hours.
      and not exists(select 1 from public.training_evidence_events e where e.course_assignment_id=a.id and e.status='verified')
    order by a.id limit p_limit offset p_offset
  ) t;
  return v_result;
end;
$$;
revoke all on function public.get_training_completion_evidence(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.get_training_completion_evidence(uuid,uuid,integer,integer) to authenticated;

create or replace function app_private.guard_training_plan_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and (exists (
    select 1 from public.course_assignments a where a.training_plan_id = old.id
  ) or exists(select 1 from public.training_plan_enrollments n where n.training_plan_id=old.id)) then
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

create or replace function public.verify_certificate(p_slug text)
returns table(
  employee_name text,
  course_title text,
  organization_name text,
  issued_at timestamptz,
  expires_at timestamptz,
  is_valid boolean,
  course_code text,
  course_version text,
  credential_number text,
  training_provider text,
  provider_credential text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    (e.first_name || ' ' || e.last_name)::text,
    coalesce(cert.course_title_snapshot,c.title),
    o.name,
    cert.issued_at,
    cert.expires_at,
    (cert.expires_at is null or cert.expires_at > now()),
    case when cert.course_title_snapshot is not null then cert.course_code_snapshot else c.catalog_code end,
    case when cert.course_title_snapshot is not null then cert.course_version_snapshot else cv.title_version end,
    cert.credential_number,
    -- Switched on provider_snapshot_at, NOT on whether each field happens to be null. A
    -- coalesce per field would read a legitimately empty credential as "no snapshot" and serve
    -- whatever the live profile says today -- so adding a credential to the profile would
    -- retroactively put one on certificates issued without it, which is the exact restatement
    -- this migration exists to stop. pp is consulted only for rows issued before snapshotting.
    case when cert.provider_snapshot_at is not null
         then cert.training_provider else pp.provider_full_name end,
    case when cert.provider_snapshot_at is not null
         then cert.provider_credential else pp.credential end
  from public.certificates cert
  join public.employees     e on e.id = cert.employee_id
  join public.courses       c on c.id = cert.course_id
  join public.organizations o on o.id = cert.organization_id
  left join public.course_provider_profiles pp on pp.course_id = c.id
  left join lateral (
    -- The version the learner actually took, not whatever the course points at today: a
    -- certificate issued in 2026 must keep saying 2026.1 after 2027.1 publishes.
    select coalesce(cvv.version_label, 'v' || cvv.version_number::text) as title_version
    from public.course_assignments ca
    join public.course_versions cvv on cvv.id = ca.course_version_id
    where ca.id = cert.course_assignment_id
  ) cv on true
  where cert.slug = p_slug;
$fn$;

-- Preserve the current passport's governed-credit accounting and privacy rules.
-- Only replace its mutable title projection; fail if the expected source changes.
do $patch$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('public.verify_training_passport(text)'::regprocedure);
  if position($old$'courseTitle', c.title$old$ in v_definition)=0 then
    raise exception 'Passport title projection changed; review snapshot integration'; end if;
  execute replace(v_definition,$old$'courseTitle', c.title$old$,$new$'courseTitle', coalesce(cert.course_title_snapshot,c.title)$new$);
end;
$patch$;

-- Copying annual plans is one transaction and never copies enrollment or completion.
create function public.copy_yearly_training_plan(p_plan_id uuid,p_training_year integer,p_due_date date,p_name text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_plan public.training_plans; v_new uuid;
begin
  perform public.assert_identity_assurance('workforce_admin');
  select * into v_plan from public.training_plans where id=p_plan_id for no key update;
  if not found or v_plan.facility_id is null then raise exception 'Choose an authorized yearly plan' using errcode='42501'; end if;
  if p_training_year is null or p_training_year not between 1990 and 2200 or p_due_date is null
    or p_name is null or length(btrim(p_name)) not between 1 and 200 then
    raise exception 'Enter a plan name, year and completion deadline' using errcode='22023'; end if;
  insert into public.training_plans(organization_id,facility_id,training_year,due_date,name,description,created_by)
    values(v_plan.organization_id,v_plan.facility_id,p_training_year,p_due_date,btrim(p_name),v_plan.description,auth.uid()) returning id into v_new;
  insert into public.training_plan_items(training_plan_id,course_id,is_required,sort_order)
    select v_new,course_id,is_required,sort_order from public.training_plan_items where training_plan_id=p_plan_id;
  return v_new;
end;
$$;
revoke all on function public.copy_yearly_training_plan(uuid,integer,date,text) from public,anon;
grant execute on function public.copy_yearly_training_plan(uuid,integer,date,text) to authenticated;

-- Existing daily job and notification delivery pipeline; unfinished required work
-- receives at most one reminder per seven days, including after its deadline.
create or replace function public.queue_course_assignment_due_reminders()
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('training-deadline-reminders',0));
  insert into public.notifications(organization_id,profile_id,notification_type,title,body,link)
  select ca.organization_id,e.profile_id,'course_assignment_due_soon',
    case when ca.due_date<public.pa_today() then 'Required training is overdue' else 'Required training is due soon' end,
    coalesce(cv.title,c.title)||' is due '||to_char(ca.due_date,'Mon DD, YYYY')||'. Open My Learning to start or continue.',
    '/me/courses/'||ca.id
  from public.course_assignments ca join public.employees e on e.id=ca.employee_id
  join public.profiles p on p.id=e.profile_id join public.organizations o on o.id=ca.organization_id
  join public.courses c on c.id=ca.course_id left join public.course_versions cv on cv.id=ca.course_version_id
  where (ca.is_required or public.training_assignment_is_required(ca.id)) and ca.status in ('assigned','in_progress','overdue') and ca.due_date<=public.pa_today()+7
    and e.status='active' and p.is_active and o.subscription_status not in ('suspended','canceled')
    and exists(select 1 from public.get_effective_entitlements(ca.organization_id) ent where ent.feature_key='modules.train' and ent.is_entitled)
    and not exists(select 1 from public.notifications n where n.profile_id=e.profile_id
      and n.notification_type='course_assignment_due_soon' and n.link='/me/courses/'||ca.id and n.created_at>now()-interval '7 days');
  insert into public.notifications(organization_id,profile_id,notification_type,title,body,link)
  select f.organization_id,p.id,'training_overdue_summary','Overdue required training',
    count(*)||' required course assignments are overdue at '||f.name||'. Review staff progress and follow up.',
    '/app/train?facilityId='||f.id||'&tab=enrollments&deadline=overdue'
  from public.facilities f join public.course_assignments a on a.facility_id=f.id
  join public.employees e on e.id=a.employee_id
  join public.organizations o on o.id=f.organization_id
  join public.profiles p on p.organization_id=f.organization_id and p.is_active and p.role in ('org_admin','facility_manager')
  where f.is_active and e.status='active' and (a.is_required or public.training_assignment_is_required(a.id)) and a.status in ('assigned','in_progress','overdue') and a.due_date<public.pa_today()
    and o.subscription_status not in ('suspended','canceled')
    and exists(select 1 from public.get_effective_entitlements(f.organization_id) ent where ent.feature_key='modules.train' and ent.is_entitled)
    and (p.role='org_admin' or exists(select 1 from public.facility_assignments fa where fa.profile_id=p.id and fa.facility_id=f.id))
    and not exists(select 1 from public.notifications n where n.profile_id=p.id and n.notification_type='training_overdue_summary'
      and n.link='/app/train?facilityId='||f.id||'&tab=enrollments&deadline=overdue' and n.created_at>now()-interval '7 days')
  group by f.id,f.organization_id,f.name,p.id;
end;
$$;
revoke all on function public.queue_course_assignment_due_reminders() from public,anon,authenticated;

-- Scoped, minimal reminder receipts. Do not expose notification recipient addresses,
-- other notification bodies, or provider payloads to a facility administrator.
create function public.get_training_reminder_receipts(p_facility_id uuid,p_employee_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_org uuid; v_result jsonb;
begin
  if auth.uid() is null or not public.current_session_unlocked() then raise exception 'Current unlocked session required' using errcode='42501'; end if;
  select organization_id into v_org from public.facilities where id=p_facility_id;
  if not coalesce(app_private.can_read_train_scope(v_org,p_facility_id),false) then raise exception 'Facility is outside your access' using errcode='42501'; end if;
  perform public.get_training_enrollment_report(v_org,p_facility_id,p_limit=>1);
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') into v_result from (
    select n.id,concat_ws(' ',e.first_name,e.last_name) as student,n.created_at,n.read_at,
      coalesce(cv.title,c.title) as course,a.due_date,
      coalesce((select jsonb_agg(jsonb_build_object('channel',d.channel,'status',d.status,
        'delivered_at',d.delivered_at,'error_code',d.error_code,'skip_reason',d.skip_reason) order by d.created_at)
        from public.notification_deliveries d where d.notification_id=n.id),'[]') as deliveries
    from public.notifications n join public.employees e on e.profile_id=n.profile_id and e.organization_id=n.organization_id
    join public.course_assignments a on n.link='/me/courses/'||a.id and a.employee_id=e.id and a.facility_id=p_facility_id
    join public.courses c on c.id=a.course_id left join public.course_versions cv on cv.id=a.course_version_id
    where e.facility_id=p_facility_id and n.notification_type='course_assignment_due_soon'
      and (p_employee_id is null or e.id=p_employee_id)
    order by n.created_at desc,n.id limit 100
  ) t;
  return v_result;
end;
$$;
revoke all on function public.get_training_reminder_receipts(uuid,uuid) from public,anon;
grant execute on function public.get_training_reminder_receipts(uuid,uuid) to authenticated;

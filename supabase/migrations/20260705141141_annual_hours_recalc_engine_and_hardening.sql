-- §2600.65/§2800.65/§6400.52 annual-hours engine, phase 2 (behavior), per ROADMAP.md Tier 2.2:
--   * recalculate_all_compliance() had a leftover `grant ... to authenticated` (kept only because
--     of a dead client hook, useRecalculateCompliance) letting ANY signed-in user of ANY org
--     trigger a full unauthenticated-by-role, cross-tenant recompute. Split into a core worker
--     (recalculate_compliance_core, no grants at all -- callable only by its owner, i.e. the
--     nightly pg_cron job) and a new org-scoped, authorization-checked RPC
--     (recalculate_org_compliance) for on-demand refreshes, matching the same
--     revoke-all-grants-and-let-the-owner-run-it pattern already used successfully for
--     escalate_unactioned_alerts/send_monday_digest in 20260705061816.
--   * complete_training_class() unconditionally called the global, all-orgs recalc after
--     completing one class -- decoupled to call the org-scoped core instead.
--   * complete_course_assignment() bridged to employee_training_records (the courses.training_type_id
--     link added in the previous migration) and gained a minimum-seat-time completion-integrity
--     check on the learner's own self-completion path.
--   * The hour-bucket rollup itself: aggregates employee_training_records hours (which already
--     cover manual entries, training-class completions, and now LMS course completions) into
--     employee_training_hour_buckets per (employee, year, bucket), applying the general bucket's
--     6-hour OJT cap and each facility type's own required-hours training-type row.

create or replace function public.recalculate_compliance_core(p_organization_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.employee_training_records r
  set
    due_date = case
      when r.completion_date is null or tt.renewal_interval_days is null then null
      else r.completion_date + tt.renewal_interval_days
    end,
    status = case
      when r.status in ('not_applicable','pending_review') then r.status
      when r.completion_date is null then 'missing'
      when tt.renewal_interval_days is null then 'compliant'
      when (r.completion_date + tt.renewal_interval_days) < current_date then 'expired'
      when (r.completion_date + tt.renewal_interval_days) <= current_date + tt.warning_days_default then 'due_soon'
      else 'compliant'
    end
  from public.training_types tt
  where r.training_type_id = tt.id
    and (p_organization_id is null or r.organization_id = p_organization_id);

  update public.practicums p
  set status = case
    when p.due_date is null then 'missing'
    when p.due_date < current_date then 'expired'
    when p.due_date <= current_date + p.reminder_days then 'due_soon'
    else 'compliant'
  end
  where (p_organization_id is null or p.organization_id = p_organization_id);

  with computed as (
    select
      r.id as training_record_id, r.organization_id, r.facility_id, r.employee_id,
      case
        when r.status = 'expired' then 'overdue'
        when r.due_date <= current_date + 7 then 'due_7'
        when r.due_date <= current_date + 14 then 'due_14'
        when r.due_date <= current_date + 30 then 'due_30'
        when r.due_date <= current_date + 60 then 'due_60'
        else 'due_90'
      end as computed_alert_type,
      case when r.status = 'expired' then 'critical' else 'warning' end as computed_severity,
      tt.name || ' — ' || e.first_name || ' ' || e.last_name as computed_title,
      case when r.status = 'expired'
        then tt.name || ' has expired for ' || e.first_name || ' ' || e.last_name
        else tt.name || ' is due soon for ' || e.first_name || ' ' || e.last_name
      end as computed_message
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    join public.employees e on e.id = r.employee_id
    where r.status in ('due_soon','expired')
      and (p_organization_id is null or r.organization_id = p_organization_id)
  ),
  alert_rank as (
    select unnest(array['due_90','due_60','due_30','due_14','due_7','overdue']) as alert_type,
           unnest(array[0,1,2,3,4,5]) as rank
  ),
  escalations as (
    update public.alerts a
    set alert_type = c.computed_alert_type,
        severity = c.computed_severity,
        title = c.computed_title,
        message = c.computed_message
    from computed c
    join alert_rank new_rank on new_rank.alert_type = c.computed_alert_type
    join alert_rank old_rank on old_rank.alert_type = a.alert_type
    where a.training_record_id = c.training_record_id
      and a.status = 'open'
      and new_rank.rank > old_rank.rank
    returning a.training_record_id
  )
  insert into public.alerts (organization_id, facility_id, employee_id, training_record_id, alert_type, title, message, severity)
  select c.organization_id, c.facility_id, c.employee_id, c.training_record_id,
         c.computed_alert_type, c.computed_title, c.computed_message, c.computed_severity
  from computed c
  where not exists (
    select 1 from public.alerts a where a.training_record_id = c.training_record_id and a.status = 'open'
  );

  -- Annual-hours bucket rollup. Only the current calendar training_year is (re)computed here --
  -- past years are left frozen once the year ends. Scoped to active employees whose facility_type
  -- has an applicable hour_bucket training_type; an employee whose facility_type is e.g. 'NH' only
  -- ever gets a general_annual row (no dementia supplement exists for that setting today).
  with bucket_years as (
    select extract(year from current_date)::int as training_year
  ),
  employee_bucket_candidates as (
    select e.id as employee_id, e.organization_id, e.facility_id, f.facility_type, bt.bucket_type
    from public.employees e
    join public.facilities f on f.id = e.facility_id
    cross join (values ('general_annual'), ('alr_dementia'), ('sdcu_dementia')) as bt(bucket_type)
    where e.status = 'active'
      and (p_organization_id is null or e.organization_id = p_organization_id)
  ),
  applicable_types as (
    select distinct on (ebc.employee_id, ebc.bucket_type)
      ebc.employee_id, ebc.organization_id, ebc.facility_id, ebc.bucket_type, tt.required_hours
    from employee_bucket_candidates ebc
    join public.training_types tt
      on tt.hour_bucket = ebc.bucket_type
     and tt.is_active
     and (tt.applies_to_facility_type = ebc.facility_type or tt.applies_to_facility_type = 'BOTH')
     and (tt.organization_id is null or tt.organization_id = ebc.organization_id)
    order by ebc.employee_id, ebc.bucket_type, (tt.organization_id is not null) desc
  ),
  earned as (
    select
      at.employee_id, at.bucket_type,
      sum(case when r.completion_method is distinct from 'on_the_job' then coalesce(r.hours, 0) else 0 end) as non_ojt_hours,
      sum(case when r.completion_method = 'on_the_job' then coalesce(r.hours, 0) else 0 end) as ojt_hours_raw
    from applicable_types at
    join public.training_types tt2 on tt2.hour_bucket = at.bucket_type
      and (tt2.organization_id is null or tt2.organization_id = at.organization_id)
    join public.employee_training_records r
      on r.employee_id = at.employee_id
     and r.training_type_id = tt2.id
     and r.completion_date is not null
     and extract(year from r.completion_date)::int = (select training_year from bucket_years)
    group by at.employee_id, at.bucket_type
  )
  insert into public.employee_training_hour_buckets (
    organization_id, facility_id, employee_id, training_year, bucket_type, required_hours, completed_hours, ojt_hours, status
  )
  select
    at.organization_id, at.facility_id, at.employee_id, (select training_year from bucket_years), at.bucket_type,
    at.required_hours,
    coalesce(e.non_ojt_hours, 0) + least(coalesce(e.ojt_hours_raw, 0), case when at.bucket_type = 'general_annual' then 6 else 0 end),
    coalesce(e.ojt_hours_raw, 0),
    case
      when coalesce(e.non_ojt_hours, 0) + least(coalesce(e.ojt_hours_raw, 0), case when at.bucket_type = 'general_annual' then 6 else 0 end) >= at.required_hours
        then 'compliant'
      when (make_date((select training_year from bucket_years), 12, 31) - current_date) <= 90 then 'due_soon'
      else 'incomplete'
    end
  from applicable_types at
  left join earned e on e.employee_id = at.employee_id and e.bucket_type = at.bucket_type
  on conflict (employee_id, training_year, bucket_type) do update set
    organization_id = excluded.organization_id,
    facility_id = excluded.facility_id,
    required_hours = excluded.required_hours,
    completed_hours = excluded.completed_hours,
    ojt_hours = excluded.ojt_hours,
    status = excluded.status;
end;
$$;
revoke all on function public.recalculate_compliance_core(uuid) from public, anon, authenticated;

create or replace function public.recalculate_all_compliance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_compliance_core(null);
end;
$$;
revoke all on function public.recalculate_all_compliance() from public, anon, authenticated;

-- On-demand org refresh: org_admin/facility_manager can force their own org's statuses/hour
-- buckets to recompute immediately instead of waiting for the 6am cron, so a newly recorded
-- training doesn't look stale for up to 24 hours.
create or replace function public.recalculate_org_compliance(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.is_platform_admin()
    or (p_organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager'))
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;
  perform public.recalculate_compliance_core(p_organization_id);
end;
$$;
revoke all on function public.recalculate_org_compliance(uuid) from public;
grant execute on function public.recalculate_org_compliance(uuid) to authenticated;

-- Decouple complete_training_class() from the global, all-orgs recalc -- one facility completing
-- one class should not force a platform-wide recompute.
create or replace function public.complete_training_class(p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class record;
  v_attendee record;
  v_record_id uuid;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if v_class is null then
    raise exception 'training class not found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id()
        and (public.current_role() in ('org_admin','facility_manager')
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid())))
  ) then
    raise exception 'not authorized to complete this training class';
  end if;

  for v_attendee in
    select * from public.training_class_attendees where class_id = p_class_id and attended = true and training_record_id is null
  loop
    insert into public.employee_training_records (
      organization_id, facility_id, employee_id, training_type_id,
      completion_date, status, trainer_name, hours, completion_method
    )
    select
      v_class.organization_id, coalesce(v_class.facility_id, e.facility_id), v_attendee.employee_id, v_class.training_type_id,
      v_class.class_date, 'compliant',
      (select first_name || ' ' || last_name from public.profiles where id = v_class.trainer_profile_id),
      v_class.duration_hours, 'in_person'
    from public.employees e where e.id = v_attendee.employee_id
    returning id into v_record_id;

    update public.training_class_attendees set training_record_id = v_record_id where id = v_attendee.id;
  end loop;

  update public.training_classes set status = 'completed' where id = p_class_id;

  perform public.recalculate_compliance_core(v_class.organization_id);
end;
$$;
revoke all on function public.complete_training_class(uuid) from public;
grant execute on function public.complete_training_class(uuid) to authenticated;

-- LMS-compliance bridge + completion-integrity control.
create or replace function public.complete_course_assignment(p_assignment_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_org uuid; v_emp uuid; v_course_id uuid; v_is_self boolean;
  v_course record; v_progress record; v_record_id uuid; v_min_seconds numeric;
begin
  select organization_id, employee_id, course_id into v_org, v_emp, v_course_id
  from public.course_assignments where id = p_assignment_id;
  if v_org is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = 'no_data_found';
  end if;

  v_is_self := public.owns_employee(v_emp);
  if not (
    public.is_platform_admin()
    or (v_org = public.current_org_id() and public."current_role"() in ('org_admin','facility_manager','trainer'))
    or v_is_self
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  select * into v_course from public.courses where id = v_course_id;

  -- Completion-integrity control: a learner completing their OWN assignment must have had the
  -- course open for a minimum stretch of time proportional to its nominal length (10%, floor 60
  -- seconds), so a 12-hour course clicked through in 90 seconds cannot become defensible survey
  -- evidence. Only gates the self-completion path (v_is_self) -- an admin/trainer completing a
  -- paper/in-person session on someone else's behalf supplies its own out-of-band evidence.
  if v_is_self then
    select * into v_progress from public.course_progress where assignment_id = p_assignment_id;
    v_min_seconds := greatest(60, round(coalesce(v_course.estimated_duration_minutes, 0)::numeric * 60 * 0.10));
    if v_progress.started_at is null then
      raise exception 'This course has not been started yet -- open it and work through at least one lesson before marking it complete.'
        using errcode = 'check_violation';
    end if;
    if extract(epoch from (now() - v_progress.started_at)) < v_min_seconds then
      raise exception 'This course needs to stay open for at least % minute(s) before it can be marked complete -- % minute(s) have elapsed so far.',
        ceil(v_min_seconds / 60.0), floor(extract(epoch from (now() - v_progress.started_at)) / 60.0)
        using errcode = 'check_violation', hint = 'Continue through the course content, then try again.';
    end if;
  end if;

  perform set_config('app.privileged_write', 'on', true);
  update public.course_assignments
     set status = 'completed', completed_at = now()
   where id = p_assignment_id;

  -- LMS-compliance bridge: if this course satisfies a specific annual-hours training type, record
  -- (or refresh) the matching employee_training_records row -- "find current record, else insert",
  -- mirroring the manual-entry UI's findCurrentRecord pattern (EmployeeDetail.tsx/TrainingMatrix.tsx)
  -- rather than accumulating a duplicate row per completion.
  if v_course.training_type_id is not null then
    select id into v_record_id from public.employee_training_records
    where employee_id = v_emp and training_type_id = v_course.training_type_id
    order by due_date desc nulls last, completion_date desc nulls last, created_at desc
    limit 1;

    if v_record_id is not null then
      update public.employee_training_records
      set completion_date = current_date,
          status = 'compliant',
          completion_method = 'online',
          training_provider = 'CareMetric Train LMS',
          hours = round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
          notes = 'Auto-recorded on completion of course "' || v_course.title || '".'
      where id = v_record_id;
    else
      insert into public.employee_training_records (
        organization_id, facility_id, employee_id, training_type_id,
        completion_date, status, hours, completion_method, training_provider, notes
      )
      select v_org, e.facility_id, v_emp, v_course.training_type_id,
        current_date, 'compliant', round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
        'online', 'CareMetric Train LMS', 'Auto-recorded on completion of course "' || v_course.title || '".'
      from public.employees e where e.id = v_emp;
    end if;
  end if;

  perform public.recalculate_compliance_core(v_org);
end;
$function$;
revoke all on function public.complete_course_assignment(uuid) from public;
grant execute on function public.complete_course_assignment(uuid) to authenticated;
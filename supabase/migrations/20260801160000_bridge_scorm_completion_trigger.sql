-- B4: Bridge SCORM/xAPI runtime completion → course assignment + training record / hour bucket.
-- Uses an AFTER INSERT trigger on learning_runtime_commits so we do not replace
-- commit_learning_runtime_state (which has extensive pgTAP coverage). The bridge runs only
-- on the first completed commit for a session.
--
-- Security: bridge_learning_runtime_completion is INTERNAL only. Date fields use public.pa_today().

create or replace function public.bridge_learning_runtime_completion(
  p_runtime_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.learning_runtime_sessions%rowtype;
  v_assignment public.course_assignments%rowtype;
  v_course record;
  v_record_id uuid;
  v_hours numeric(6,2);
  v_today date := public.pa_today();
begin
  select * into v_session
  from public.learning_runtime_sessions
  where id = p_runtime_session_id;

  if not found then
    return null;
  end if;

  -- Only act when session has been marked completed (the commit path sets this).
  if v_session.state is distinct from 'completed' then
    return null;
  end if;

  select * into v_assignment
  from public.course_assignments
  where id = v_session.assignment_id;

  if not found then
    return null;
  end if;

  -- Quiz integrity: if this course version still has unpassed quiz blocks, leave the runtime
  -- session completed but do not flip the assignment or write a training record yet.
  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = v_assignment.course_version_id
      and cb.block_type = 'quiz'
      and not exists (
        select 1
        from public.quizzes qz
        join public.quiz_attempts qa on qa.quiz_id = qz.id
        where qz.course_block_id = cb.id
          and qa.assignment_id = v_assignment.id
          and qa.passed = true
      )
  ) then
    return null;
  end if;

  select c.*
  into v_course
  from public.courses c
  where c.id = v_assignment.course_id;

  perform set_config('app.privileged_write', 'on', true);

  if v_assignment.status is distinct from 'completed' then
    update public.course_assignments
    set status = 'completed',
        completed_at = coalesce(completed_at, now())
    where id = v_assignment.id;
  end if;

  if v_course.training_type_id is null then
    return null;
  end if;

  v_hours := round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2);

  select id into v_record_id
  from public.employee_training_records
  where employee_id = v_assignment.employee_id
    and training_type_id = v_course.training_type_id
  order by due_date desc nulls last, completion_date desc nulls last, created_at desc
  limit 1;

  if v_record_id is not null then
    update public.employee_training_records
    set completion_date = v_today,
        status = 'compliant',
        completion_method = 'online',
        training_provider = 'CareMetric CareBase Training Suite',
        hours = v_hours,
        notes = case
          when notes is null or notes = '' then
            'Auto-recorded from SCORM/xAPI runtime session ' || v_session.id::text ||
            ' on course "' || v_course.title || '".'
          when position(v_session.id::text in notes) > 0 then
            notes
          else
            notes || E'\nAuto-recorded from SCORM/xAPI runtime session ' || v_session.id::text || '.'
        end
    where id = v_record_id;
  else
    insert into public.employee_training_records (
      organization_id, facility_id, employee_id, training_type_id,
      completion_date, status, hours, completion_method, training_provider, notes
    )
    select
      v_assignment.organization_id,
      e.facility_id,
      v_assignment.employee_id,
      v_course.training_type_id,
      v_today,
      'compliant',
      v_hours,
      'online',
      'CareMetric CareBase Training Suite',
      'Auto-recorded from SCORM/xAPI runtime session ' || v_session.id::text ||
        ' on course "' || v_course.title || '".'
    from public.employees e
    where e.id = v_assignment.employee_id
    returning id into v_record_id;
  end if;

  perform public.recalculate_compliance_core(v_assignment.organization_id);

  return v_record_id;
end;
$function$;

revoke all on function public.bridge_learning_runtime_completion(uuid) from public, anon, authenticated, service_role;

comment on function public.bridge_learning_runtime_completion(uuid) is
  'B4 internal: On SCORM/xAPI runtime completion, complete the assignment and upsert employee_training_records / hour buckets when the course maps to a training_type. Not granted to clients.';

-- Trigger function: fire only on first completed commit for a session.
create or replace function public.trg_bridge_learning_runtime_completion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if NEW.completion_status = 'completed' then
    -- Only the first completed commit should bridge (idempotent via assignment status check inside).
    if not exists (
      select 1 from public.learning_runtime_commits c
      where c.runtime_session_id = NEW.runtime_session_id
        and c.completion_status = 'completed'
        and c.id <> NEW.id
    ) then
      begin
        perform public.bridge_learning_runtime_completion(NEW.runtime_session_id);
      exception
        when others then
          raise warning 'bridge_learning_runtime_completion failed for %: %', NEW.runtime_session_id, SQLERRM;
      end;
    end if;
  end if;
  return NEW;
end;
$$;

revoke all on function public.trg_bridge_learning_runtime_completion() from public, anon, authenticated, service_role;

drop trigger if exists trg_bridge_learning_runtime_completion on public.learning_runtime_commits;
create trigger trg_bridge_learning_runtime_completion
  after insert on public.learning_runtime_commits
  for each row
  execute function public.trg_bridge_learning_runtime_completion();

comment on function public.trg_bridge_learning_runtime_completion() is
  'B4: AFTER INSERT on learning_runtime_commits, bridge first completed commit into assignment + training records.';

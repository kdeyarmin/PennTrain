-- Personal, per-profile notification feed (training assignments, quiz results,
-- certificates, competency evaluations, training due/expired) across every
-- role. This is deliberately separate from `alerts`, which its own comment
-- documents as "internal ops tool: admin/facility roles only, no employee
-- self-access" -- notifications is the opposite: every profile sees only
-- their own rows, and it exists specifically to serve employee/trainer roles
-- that alerts does not.
--
-- Rows are written exclusively by SECURITY DEFINER trigger functions (same
-- pattern as audit_log_trigger): there is no INSERT/UPDATE/DELETE policy for
-- ordinary clients, and marking a notification read goes through the two
-- RPCs below rather than a direct table UPDATE.

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null
                      constraint notifications_notification_type_check
                      check (notification_type in (
                        'course_assigned', 'quiz_graded', 'certificate_issued',
                        'training_due_soon', 'training_expired', 'competency_recorded'
                      )),
  title             text not null,
  body              text,
  link              text,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index notifications_profile_created_idx on public.notifications(profile_id, created_at desc);

create index notifications_profile_unread_idx on public.notifications(profile_id) where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications for select to authenticated using (
  public.is_platform_admin() or profile_id = (select auth.uid())
);

create or replace function public.mark_notification_read(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update public.notifications set read_at = now()
  where id = p_id and profile_id = auth.uid() and read_at is null;
end;
$function$;

revoke all on function public.mark_notification_read(uuid) from public;

grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read()
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update public.notifications set read_at = now()
  where profile_id = auth.uid() and read_at is null;
end;
$function$;

revoke all on function public.mark_all_notifications_read() from public;

grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger functions: one per event source. Each looks up the target
-- employee's profile_id and silently no-ops if that employee has no linked
-- login (profile_id is null) -- there's no one to notify.
-- ---------------------------------------------------------------------------

create or replace function public.notify_course_assigned()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_profile_id uuid; v_course_title text;
begin
  select profile_id into v_profile_id from public.employees where id = new.employee_id;
  if v_profile_id is null then return new; end if;
  select title into v_course_title from public.courses where id = new.course_id;
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (
    new.organization_id, v_profile_id, 'course_assigned',
    'New training assigned',
    coalesce(v_course_title, 'A training item') ||
      case when new.due_date is not null then ' — due ' || to_char(new.due_date, 'Mon DD, YYYY') else '' end,
    '/me/courses/' || new.id
  );
  return new;
end;
$function$;

create trigger notify_course_assigned after insert on public.course_assignments
  for each row execute function public.notify_course_assigned();

create or replace function public.notify_quiz_graded()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_profile_id uuid; v_quiz_title text;
begin
  select profile_id into v_profile_id from public.employees where id = new.employee_id;
  if v_profile_id is null then return new; end if;
  select title into v_quiz_title from public.quizzes where id = new.quiz_id;
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (
    new.organization_id, v_profile_id, 'quiz_graded',
    case when new.passed then 'Quiz passed' else 'Quiz not passed' end,
    coalesce(v_quiz_title, 'Quiz') || ' — scored ' || coalesce(new.score_percent::text, '0') || '%',
    '/me/courses/' || new.assignment_id
  );
  return new;
end;
$function$;

create trigger notify_quiz_graded after update on public.quiz_attempts
  for each row
  when (old.submitted_at is null and new.submitted_at is not null)
  execute function public.notify_quiz_graded();

create or replace function public.notify_certificate_issued()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_profile_id uuid; v_course_title text;
begin
  select profile_id into v_profile_id from public.employees where id = new.employee_id;
  if v_profile_id is null then return new; end if;
  select title into v_course_title from public.courses where id = new.course_id;
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (
    new.organization_id, v_profile_id, 'certificate_issued',
    'Certificate issued',
    'Your certificate for ' || coalesce(v_course_title, 'this course') || ' is ready.',
    '/me/certificates'
  );
  return new;
end;
$function$;

create trigger notify_certificate_issued after insert on public.certificates
  for each row execute function public.notify_certificate_issued();

create or replace function public.notify_competency_recorded()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_profile_id uuid; v_template_name text;
begin
  select profile_id into v_profile_id from public.employees where id = new.employee_id;
  if v_profile_id is null then return new; end if;
  select name into v_template_name from public.competency_templates where id = new.template_id;
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (
    new.organization_id, v_profile_id, 'competency_recorded',
    'Competency evaluation recorded',
    coalesce(v_template_name, 'A competency checklist') || ' — result: ' || replace(new.overall_result, '_', ' '),
    '/me'
  );
  return new;
end;
$function$;

create trigger notify_competency_recorded after insert on public.competency_records
  for each row execute function public.notify_competency_recorded();

-- Piggybacks on `alerts`, which already dedupes against reopening a new alert
-- while one is still open for the same training record -- so this can't spam
-- a notification every recalculation cycle, only on a genuinely new alert row.
create or replace function public.notify_training_alert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_profile_id uuid;
begin
  if new.employee_id is null
     or new.alert_type not in ('due_90', 'due_60', 'due_30', 'due_14', 'due_7', 'overdue') then
    return new;
  end if;
  select profile_id into v_profile_id from public.employees where id = new.employee_id;
  if v_profile_id is null then return new; end if;
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (
    new.organization_id, v_profile_id,
    case when new.alert_type = 'overdue' then 'training_expired' else 'training_due_soon' end,
    new.title, new.message, '/me'
  );
  return new;
end;
$function$;

create trigger notify_training_alert after insert on public.alerts
  for each row execute function public.notify_training_alert();

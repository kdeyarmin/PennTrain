-- Backfilled from the live database; see 20260704190000 for why this file is a reconstruction
-- rather than the original recovered SQL.
--
-- A per-user notification feed: courses assigned, certificates issued, competency evaluations
-- recorded, and quizzes graded all drop a row here via AFTER triggers on the source tables.

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title             text not null,
  body              text,
  link              text,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);
create index notifications_profile_created_idx on public.notifications(profile_id, created_at desc);
create index notifications_profile_unread_idx on public.notifications(profile_id) where read_at is null;

alter table public.notifications enable row level security;

-- Read-only from the client's point of view: rows are only ever written by the SECURITY
-- DEFINER notify_*() triggers below, and only ever updated (read_at) by the mark_*_read() RPCs,
-- both of which bypass RLS -- so there is deliberately no insert/update/delete policy here.
create policy notifications_select on public.notifications for select to authenticated using (
  profile_id = (select auth.uid())
);

create or replace function public.mark_notification_read(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update public.notifications set read_at = now()
  where id = p_id and profile_id = auth.uid() and read_at is null;
end;
$function$;

create or replace function public.mark_all_notifications_read()
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update public.notifications set read_at = now()
  where profile_id = auth.uid() and read_at is null;
end;
$function$;

grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

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
    'New course assigned',
    coalesce(v_course_title, 'A course') ||
      case when new.due_date is not null then ' — due ' || to_char(new.due_date, 'Mon DD, YYYY') else '' end,
    '/me/courses/' || new.id
  );
  return new;
end;
$function$;
create trigger notify_course_assigned after insert on public.course_assignments
  for each row execute function public.notify_course_assigned();

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
  for each row execute function public.notify_quiz_graded();

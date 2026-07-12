-- Certificate notifications are emitted for the profile attached to the completed assignment's
-- employees row. After self-enrollment was opened to every role, admins/trainers/auditors can earn
-- certificates too, but /me/certificates remains an employee-only page. Keep employee learners on
-- their certificate list and send every other self-learner back to the role-safe course list.

create or replace function public.notify_certificate_issued()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_profile_id uuid;
  v_profile_role text;
  v_course_title text;
begin
  select e.profile_id, p.role
    into v_profile_id, v_profile_role
    from public.employees e
    left join public.profiles p on p.id = e.profile_id
    where e.id = new.employee_id;

  if v_profile_id is null then return new; end if;

  select title into v_course_title from public.courses where id = new.course_id;

  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (
    new.organization_id, v_profile_id, 'certificate_issued',
    'Certificate issued',
    'Your certificate for ' || coalesce(v_course_title, 'this course') || ' is ready.',
    case when v_profile_role = 'employee' then '/me/certificates' else '/me/courses' end
  );

  return new;
end;
$function$;

update public.notifications n
set link = '/me/courses'
from public.profiles p
where n.profile_id = p.id
  and n.notification_type = 'certificate_issued'
  and n.link = '/me/certificates'
  and p.role <> 'employee';

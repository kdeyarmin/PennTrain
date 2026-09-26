-- Training-only automation uses the existing daily reminder job and delivery queue.
-- Links are authenticated live views; no exported staff data is placed in email.
create table app_private.training_reminder_policies (
  facility_id uuid primary key references public.facilities(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  learner_enabled boolean not null default true,
  lead_days integer not null default 7 check (lead_days between 0 and 60),
  repeat_days integer not null default 7 check (repeat_days between 1 and 30),
  digest_enabled boolean not null default true,
  digest_weekday integer not null default 1 check (digest_weekday between 1 and 7),
  escalation_days integer not null default 14 check (escalation_days between 1 and 90),
  recipient_ids uuid[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (cardinality(recipient_ids) <= 50)
);
create table app_private.training_report_schedules (
  id uuid primary key default extensions.gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  filters jsonb not null check (jsonb_typeof(filters) = 'object'),
  frequency text not null check (frequency in ('weekly','monthly')),
  delivery_day integer not null check (delivery_day between 1 and 28),
  recipient_ids uuid[] not null check (cardinality(recipient_ids) between 1 and 50),
  enabled boolean not null default true,
  next_run_on date not null,
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (frequency <> 'weekly' or delivery_day <= 7)
);
create index training_report_schedules_due_idx on app_private.training_report_schedules(next_run_on) where enabled;
create index training_report_schedules_facility_idx on app_private.training_report_schedules(facility_id);
create index training_report_schedules_org_idx on app_private.training_report_schedules(organization_id);
create index training_report_schedules_creator_idx on app_private.training_report_schedules(created_by);
create index training_reminder_policies_org_idx on app_private.training_reminder_policies(organization_id);
create index training_reminder_policies_actor_idx on app_private.training_reminder_policies(updated_by);
create table app_private.training_report_schedule_runs (
  schedule_id uuid not null references app_private.training_report_schedules(id) on delete cascade,
  scheduled_on date not null,
  queued_at timestamptz not null default now(),
  recipient_count integer not null default 0,
  notification_ids uuid[] not null default '{}',
  primary key(schedule_id,scheduled_on)
);
alter table app_private.training_reminder_policies enable row level security;
alter table app_private.training_report_schedules enable row level security;
alter table app_private.training_report_schedule_runs enable row level security;
revoke all on app_private.training_reminder_policies,app_private.training_report_schedules,app_private.training_report_schedule_runs from public,anon,authenticated;
create trigger audit_log after insert or update or delete on app_private.training_reminder_policies for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on app_private.training_report_schedules for each row execute function public.audit_log_trigger();
insert into app_private.audit_entity_manifest(table_schema,table_name,audit_mode,contains_regulated_data,rationale) values
  ('app_private','training_reminder_policies','row_trigger',false,'Training reminder cadence and authorized follow-up audience changes.'),
  ('app_private','training_report_schedules','row_trigger',true,'Saved training report filters, schedule, and scoped recipient changes.');

create function app_private.training_manager_has_scope(p_profile uuid,p_facility uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join public.facilities f on f.id=p_facility
    join public.organizations o on o.id=f.organization_id
    where p.id=p_profile and p.is_active and f.is_active and o.subscription_status not in ('suspended','canceled')
      and (p.role='platform_admin' or (p.organization_id=f.organization_id and
        (p.role='org_admin' or (p.role='facility_manager' and exists(select 1 from public.facility_assignments a where a.profile_id=p.id and a.facility_id=f.id)))))
      and exists(select 1 from public.get_effective_entitlements(f.organization_id) e where e.feature_key='modules.train' and e.is_entitled))
$$;
revoke all on function app_private.training_manager_has_scope(uuid,uuid) from public,anon,authenticated;

create function app_private.assert_training_automation_access(p_facility uuid,p_manage boolean default false)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_org uuid;
begin
  if auth.uid() is null or not public.current_session_unlocked() or not coalesce(public.current_role() in ('platform_admin','org_admin','facility_manager','trainer','auditor'),false) then
    raise exception 'Training reporting access required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('compliance_profile_admin');
  select organization_id into v_org from public.facilities where id=p_facility and is_active;
  if v_org is null or not coalesce(app_private.can_read_train_scope(v_org,p_facility),false)
    or not exists(select 1 from public.organizations where id=v_org and subscription_status<>'suspended')
    or not exists(select 1 from public.get_effective_entitlements(v_org) e where e.feature_key='modules.train' and e.is_entitled)
    or (p_manage and not app_private.training_manager_has_scope(auth.uid(),p_facility)) then
    raise exception 'Facility is outside your training access' using errcode='42501'; end if;
  return v_org;
end;
$$;
revoke all on function app_private.assert_training_automation_access(uuid,boolean) from public,anon;
grant execute on function app_private.assert_training_automation_access(uuid,boolean) to authenticated;

create function app_private.training_report_next_date(p_frequency text,p_day integer,p_from date)
returns date language plpgsql immutable set search_path='' as $$
declare v_date date;
begin
  if p_from is null or p_frequency is null or p_frequency not in ('weekly','monthly') or p_day is null
    or p_day<1 or p_day>case when p_frequency='weekly' then 7 else 28 end then
    raise exception 'Choose a weekly weekday or a monthly day from 1 to 28' using errcode='22023'; end if;
  if p_frequency='weekly' then return p_from+((p_day-extract(isodow from p_from)::integer+7)%7); end if;
  v_date:=date_trunc('month',p_from)::date+p_day-1;
  if v_date<p_from then v_date:=(date_trunc('month',p_from)+interval '1 month')::date+p_day-1; end if;
  return v_date;
end;
$$;
revoke all on function app_private.training_report_next_date(text,integer,date) from public,anon,authenticated;

create function app_private.validate_training_report_filters(p_facility uuid,p_filters jsonb)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if p_filters is null or jsonb_typeof(p_filters)<>'object' or octet_length(p_filters::text)>3000
    or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('employeeId','planId','purpose','department','trainingYear','deadline','courseSearch','status','dateBasis','dateFrom','dateThrough'))
    or exists(select 1 from jsonb_each(p_filters) e where jsonb_typeof(e.value) not in ('string','number'))
    or coalesce(p_filters->>'status','all') not in ('all','assigned','in_progress','completed','overdue','paused','canceled')
    or coalesce(p_filters->>'purpose','all') not in ('all','required','optional')
    or coalesce(p_filters->>'deadline','all') not in ('all','overdue','due_soon')
    or coalesce(p_filters->>'dateBasis','assigned') not in ('assigned','completed','certificate','due')
    or length(coalesce(p_filters->>'department',''))>200 or length(coalesce(p_filters->>'courseSearch',''))>200
    or (p_filters ? 'trainingYear' and (p_filters->>'trainingYear')::integer not between 1990 and 2200)
    or (nullif(p_filters->>'dateFrom','')::date> nullif(p_filters->>'dateThrough','')::date) then
    raise exception 'Invalid saved training report filters' using errcode='22023'; end if;
  if nullif(p_filters->>'employeeId','') is not null and not exists(select 1 from public.employees where id=(p_filters->>'employeeId')::uuid and facility_id=p_facility) then
    raise exception 'Employee filter is outside this facility' using errcode='22023'; end if;
  if nullif(p_filters->>'planId','') is not null and not exists(select 1 from public.training_plans where id=(p_filters->>'planId')::uuid and facility_id=p_facility) then
    raise exception 'Plan filter is outside this facility' using errcode='22023'; end if;
end;
$$;
revoke all on function app_private.validate_training_report_filters(uuid,jsonb) from public,anon,authenticated;

create function public.get_training_automation(p_facility_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_org uuid; v_settings jsonb;
begin
  v_org:=app_private.assert_training_automation_access(p_facility_id);
  select to_jsonb(p)-'organization_id'-'updated_by' into v_settings from app_private.training_reminder_policies p where facility_id=p_facility_id;
  return jsonb_build_object('settings',coalesce(v_settings,jsonb_build_object('learner_enabled',true,'lead_days',7,'repeat_days',7,'digest_enabled',true,'digest_weekday',1,'escalation_days',14,'recipient_ids','[]'::jsonb)),
    'recipients',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',concat_ws(' ',p.first_name,p.last_name),'role',p.role) order by p.last_name,p.first_name,p.id)
      from public.profiles p where p.organization_id=v_org and p.role in ('org_admin','facility_manager') and app_private.training_manager_has_scope(p.id,p_facility_id)),'[]'),
    'schedules',coalesce((select jsonb_agg(to_jsonb(s)-'organization_id'-'created_by' || jsonb_build_object('runs',
      coalesce((select jsonb_agg(to_jsonb(r) order by r.scheduled_on desc) from (select scheduled_on,queued_at,recipient_count from app_private.training_report_schedule_runs where schedule_id=s.id order by scheduled_on desc limit 5) r),'[]'::jsonb)) order by s.name,s.id)
      from app_private.training_report_schedules s where s.facility_id=p_facility_id),'[]'));
end;
$$;
revoke all on function public.get_training_automation(uuid) from public,anon;
grant execute on function public.get_training_automation(uuid) to authenticated;

create function public.save_training_reminder_policy(p_facility_id uuid,p_settings jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_ids uuid[];
begin
  v_org:=app_private.assert_training_automation_access(p_facility_id,true);
  if p_settings is null or jsonb_typeof(p_settings)<>'object'
    or not p_settings ?& array['learner_enabled','lead_days','repeat_days','digest_enabled','digest_weekday','escalation_days','recipient_ids']
    or exists(select 1 from jsonb_object_keys(p_settings) k where k not in ('learner_enabled','lead_days','repeat_days','digest_enabled','digest_weekday','escalation_days','recipient_ids'))
    or jsonb_typeof(p_settings->'recipient_ids')<>'array' or jsonb_typeof(p_settings->'learner_enabled')<>'boolean' or jsonb_typeof(p_settings->'digest_enabled')<>'boolean'
    or exists(select 1 from jsonb_each(p_settings) e where e.key in ('lead_days','repeat_days','digest_weekday','escalation_days') and jsonb_typeof(e.value)<>'number')
    or (p_settings->>'lead_days')::integer not between 0 and 60 or (p_settings->>'repeat_days')::integer not between 1 and 30
    or (p_settings->>'digest_weekday')::integer not between 1 and 7 or (p_settings->>'escalation_days')::integer not between 1 and 90 then
    raise exception 'Invalid reminder settings' using errcode='22023'; end if;
  select coalesce(array_agg(distinct v::uuid),'{}') into v_ids from jsonb_array_elements_text(p_settings->'recipient_ids') v;
  if cardinality(v_ids)>50 or array_position(v_ids,null) is not null or exists(select 1 from unnest(v_ids) id where not app_private.training_manager_has_scope(id,p_facility_id)
    or not exists(select 1 from public.profiles p where p.id=id and p.organization_id=v_org and p.role in ('org_admin','facility_manager'))) then
    raise exception 'Choose active administrators for this facility' using errcode='22023'; end if;
  insert into app_private.training_reminder_policies(facility_id,organization_id,learner_enabled,lead_days,repeat_days,digest_enabled,digest_weekday,escalation_days,recipient_ids,updated_by)
  values(p_facility_id,v_org,(p_settings->>'learner_enabled')::boolean,(p_settings->>'lead_days')::integer,(p_settings->>'repeat_days')::integer,
    (p_settings->>'digest_enabled')::boolean,(p_settings->>'digest_weekday')::integer,(p_settings->>'escalation_days')::integer,v_ids,auth.uid())
  on conflict(facility_id) do update set learner_enabled=excluded.learner_enabled,lead_days=excluded.lead_days,repeat_days=excluded.repeat_days,
    digest_enabled=excluded.digest_enabled,digest_weekday=excluded.digest_weekday,escalation_days=excluded.escalation_days,recipient_ids=excluded.recipient_ids,updated_by=auth.uid(),updated_at=now();
end;
$$;
revoke all on function public.save_training_reminder_policy(uuid,jsonb) from public,anon;
grant execute on function public.save_training_reminder_policy(uuid,jsonb) to authenticated;

create function public.save_training_report_schedule(p_facility_id uuid,p_name text,p_filters jsonb,p_frequency text,p_delivery_day integer,p_recipient_ids uuid[],p_schedule_id uuid default null,p_enabled boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_id uuid; v_next date;
begin
  v_org:=app_private.assert_training_automation_access(p_facility_id,true);
  perform pg_advisory_xact_lock(hashtextextended('training-report-schedules:'||p_facility_id,0));
  -- Pausing remains possible after a recipient leaves or a saved employee moves.
  -- Do not make stopping a schedule depend on its old filters still being usable.
  if p_schedule_id is not null and p_enabled=false then
    update app_private.training_report_schedules set enabled=false,updated_at=now() where id=p_schedule_id and facility_id=p_facility_id returning id into v_id;
    if v_id is null then raise exception 'Report schedule is outside this facility' using errcode='42501'; end if;
    return v_id;
  end if;
  perform app_private.validate_training_report_filters(p_facility_id,p_filters);
  v_next:=app_private.training_report_next_date(p_frequency,p_delivery_day,public.pa_today());
  if p_name is null or length(btrim(p_name)) not between 1 and 120 or p_enabled is null or p_recipient_ids is null
    or cardinality(p_recipient_ids) not between 1 and 50 or array_position(p_recipient_ids,null) is not null
    or exists(select 1 from unnest(p_recipient_ids) id where not app_private.training_manager_has_scope(id,p_facility_id)
      or not exists(select 1 from public.profiles p where p.id=id and p.organization_id=v_org and p.role in ('org_admin','facility_manager'))) then
    raise exception 'Enter a report name and choose active facility administrators' using errcode='22023'; end if;
  if p_schedule_id is null then
    if (select count(*) from app_private.training_report_schedules where facility_id=p_facility_id)>=30 then
      raise exception 'This facility already has 30 report schedules; edit an existing schedule' using errcode='22023'; end if;
    insert into app_private.training_report_schedules(facility_id,organization_id,name,filters,frequency,delivery_day,recipient_ids,enabled,next_run_on,created_by)
    values(p_facility_id,v_org,btrim(p_name),p_filters,p_frequency,p_delivery_day,p_recipient_ids,p_enabled,v_next,auth.uid()) returning id into v_id;
  else
    update app_private.training_report_schedules set name=btrim(p_name),filters=p_filters,frequency=p_frequency,delivery_day=p_delivery_day,
      recipient_ids=p_recipient_ids,enabled=p_enabled,next_run_on=v_next,updated_at=now(),created_by=auth.uid()
    where id=p_schedule_id and facility_id=p_facility_id returning id into v_id;
    if v_id is null then raise exception 'Report schedule is outside this facility' using errcode='42501'; end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_training_report_schedule(uuid,text,jsonb,text,integer,uuid[],uuid,boolean) from public,anon;
grant execute on function public.save_training_report_schedule(uuid,text,jsonb,text,integer,uuid[],uuid,boolean) to authenticated;

create function public.get_saved_training_report(p_schedule_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_row app_private.training_report_schedules;
begin
  select * into v_row from app_private.training_report_schedules where id=p_schedule_id;
  if not found then raise exception 'Saved training report is unavailable' using errcode='42501'; end if;
  perform app_private.assert_training_automation_access(v_row.facility_id);
  return jsonb_build_object('id',v_row.id,'name',v_row.name,'filters',v_row.filters,'organizationId',v_row.organization_id,'facilityId',v_row.facility_id);
end;
$$;
revoke all on function public.get_saved_training_report(uuid) from public,anon;
grant execute on function public.get_saved_training_report(uuid) to authenticated;

-- Fix the earlier summary producer's unregistered type without replacing unrelated values.
do $register$
declare v_definition text;
begin
  select pg_get_constraintdef(oid) into v_definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_notification_type_check';
  if v_definition is null then raise exception 'Notification type constraint is missing'; end if;
  alter table public.notifications drop constraint notifications_notification_type_check;
  execute 'alter table public.notifications add constraint notifications_notification_type_check check (('||substring(v_definition from 8 for length(v_definition)-8)||') or notification_type in (''training_overdue_summary'',''training_escalation_summary''))';
end;
$register$;

insert into public.notification_templates(organization_id,template_key,channel,version,status,subject_template,body_template,allowed_variables)
select null,k,c,1,'active','{{title}}','{{body}} Open your training workspace: {{action_url}}',array['title','body','action_url']
from unnest(array['training_overdue_summary','training_escalation_summary','report_subscription_ready']) k cross join unnest(array['email','sms','web_push']) c
on conflict(organization_id,template_key,channel,version) do nothing;

create function app_private.process_training_report_schedules(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare s app_private.training_report_schedules; v_today date:=(p_now at time zone 'America/New_York')::date; v_profile uuid; v_notification uuid; v_ids uuid[]; v_count integer:=0;
begin
  for s in select * from app_private.training_report_schedules where enabled and next_run_on<=v_today order by next_run_on,id for update skip locked loop
    if not app_private.training_manager_has_scope(s.created_by,s.facility_id) then continue; end if;
    if not exists(select 1 from app_private.training_report_schedule_runs where schedule_id=s.id and scheduled_on=s.next_run_on) then
      v_ids:='{}';
      for v_profile in select distinct p.id from public.profiles p where p.id=any(s.recipient_ids) and p.organization_id=s.organization_id
        and p.role in ('org_admin','facility_manager') and app_private.training_manager_has_scope(p.id,s.facility_id) loop
        insert into public.notifications(organization_id,profile_id,notification_type,title,body,link)
        values(s.organization_id,v_profile,'report_subscription_ready','Your scheduled training report is ready',
          'Open the saved Training report with your current facility permissions. This message contains no employee records.',
          '/app/train?facilityId='||s.facility_id||'&tab=enrollments&savedTrainingReport='||s.id) returning id into v_notification;
        perform public.enqueue_preferred_notification_delivery(s.organization_id,v_profile,v_notification,'digest');
        v_ids:=array_append(v_ids,v_notification);
      end loop;
      insert into app_private.training_report_schedule_runs(schedule_id,scheduled_on,queued_at,recipient_count,notification_ids)
      values(s.id,s.next_run_on,p_now,cardinality(v_ids),v_ids);
      v_count:=v_count+1;
    end if;
    update app_private.training_report_schedules set next_run_on=app_private.training_report_next_date(s.frequency,s.delivery_day,v_today+1) where id=s.id;
  end loop;
  return v_count;
end;
$$;
revoke all on function app_private.process_training_report_schedules(timestamptz) from public,anon,authenticated;

create function app_private.queue_configured_training_reminders(p_now timestamptz default now())
returns void language plpgsql security definer set search_path='' as $$
declare v_today date:=(p_now at time zone 'America/New_York')::date; f record; p record; v_notification uuid; v_overdue integer; v_escalated integer; v_type text; v_link text;
begin
  perform pg_advisory_xact_lock(hashtextextended('training-deadline-reminders',0));
  insert into public.notifications(organization_id,profile_id,notification_type,title,body,link)
  select a.organization_id,e.profile_id,'course_assignment_due_soon',case when a.due_date<v_today then 'Required training is overdue' else 'Required training is due soon' end,
    coalesce(cv.title,c.title)||' is due '||to_char(a.due_date,'Mon DD, YYYY')||'. Open My Learning to start or continue.','/me/courses/'||a.id
  from public.course_assignments a join public.employees e on e.id=a.employee_id and e.facility_id=a.facility_id
  join public.profiles p on p.id=e.profile_id join public.organizations o on o.id=a.organization_id
  join public.facilities fac on fac.id=a.facility_id
  join public.courses c on c.id=a.course_id left join public.course_versions cv on cv.id=a.course_version_id
  left join app_private.training_reminder_policies policy on policy.facility_id=a.facility_id
  where coalesce(policy.learner_enabled,true) and (a.is_required or public.training_assignment_is_required(a.id))
    and a.status in ('assigned','in_progress','overdue') and a.due_date<=v_today+coalesce(policy.lead_days,7)
    and e.status='active' and p.is_active and fac.is_active and o.subscription_status<>'suspended'
    and exists(select 1 from public.get_effective_entitlements(a.organization_id) ent where ent.feature_key='modules.train' and ent.is_entitled)
    and not exists(select 1 from public.notifications n where n.profile_id=e.profile_id and n.notification_type='course_assignment_due_soon'
      and n.link='/me/courses/'||a.id and n.created_at>p_now-make_interval(days=>coalesce(policy.repeat_days,7)));
  for f in select fac.id,fac.organization_id,coalesce(policy.digest_enabled,true) as digest_enabled,coalesce(policy.digest_weekday,1) as weekday,
    coalesce(policy.escalation_days,14) as escalation_days,coalesce(policy.recipient_ids,'{}'::uuid[]) as recipients
    from public.facilities fac join public.organizations o on o.id=fac.organization_id
    left join app_private.training_reminder_policies policy on policy.facility_id=fac.id
    where fac.is_active and o.subscription_status<>'suspended'
    and exists(select 1 from public.get_effective_entitlements(fac.organization_id) ent where ent.feature_key='modules.train' and ent.is_entitled) loop
    select count(*),count(*) filter(where a.due_date<=v_today-f.escalation_days) into v_overdue,v_escalated
      from public.course_assignments a join public.employees e on e.id=a.employee_id and e.facility_id=a.facility_id
      where a.facility_id=f.id and e.status='active' and (a.is_required or public.training_assignment_is_required(a.id))
        and a.status in ('assigned','in_progress','overdue') and a.due_date<v_today;
    foreach v_type in array array['training_overdue_summary','training_escalation_summary'] loop
      if (v_type='training_overdue_summary' and (not f.digest_enabled or extract(isodow from v_today)<>f.weekday or v_overdue=0))
        or (v_type='training_escalation_summary' and (not f.digest_enabled or v_escalated=0)) then continue; end if;
      v_link:='/app/train?facilityId='||f.id||'&tab=enrollments&deadline=overdue';
      for p in select pr.id from public.profiles pr where pr.organization_id=f.organization_id and pr.role in ('org_admin','facility_manager')
        and (cardinality(f.recipients)=0 or pr.id=any(f.recipients)) and app_private.training_manager_has_scope(pr.id,f.id) loop
        if exists(select 1 from public.notifications n where n.profile_id=p.id and n.notification_type=v_type and n.link=v_link and n.created_at>p_now-interval '7 days') then continue; end if;
        insert into public.notifications(organization_id,profile_id,notification_type,title,body,link)
        values(f.organization_id,p.id,v_type,case when v_type='training_escalation_summary' then 'Training follow-up needs attention' else 'Weekly training follow-up' end,
          case when v_type='training_escalation_summary' then 'Required training has passed your escalation threshold. Review overdue work in your facility workspace.' else 'Required training is overdue. Review staff progress and follow up in your facility workspace.' end,v_link)
          returning id into v_notification;
        perform public.enqueue_preferred_notification_delivery(f.organization_id,p.id,v_notification,'digest');
      end loop;
    end loop;
  end loop;
  perform app_private.process_training_report_schedules(p_now);
end;
$$;
revoke all on function app_private.queue_configured_training_reminders(timestamptz) from public,anon,authenticated;

-- The registered/controlled existing daily job still invokes this public entry point.
create or replace function public.queue_course_assignment_due_reminders()
returns void language plpgsql security definer set search_path='' as $$
begin perform app_private.queue_configured_training_reminders(now()); end;
$$;
revoke all on function public.queue_course_assignment_due_reminders() from public,anon,authenticated;

create function public.get_training_report_analytics(p_facility_id uuid,p_filters jsonb default '{}'::jsonb,p_stalled_days integer default 14)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_org uuid; v_report jsonb; v_result jsonb;
begin
  v_org:=app_private.assert_training_automation_access(p_facility_id);
  if p_stalled_days is null or p_stalled_days not between 7 and 90 then raise exception 'Choose 7 to 90 days without progress' using errcode='22023'; end if;
  -- The existing report owns filter validation, RLS, effective required status, and its
  -- complete-snapshot export bound. Analytics cannot silently use only the first page.
  v_report:=public.get_training_progress_report(v_org,p_facility_id,coalesce(p_filters->>'courseSearch',''),coalesce(p_filters->>'status','all'),
    coalesce(p_filters->>'dateBasis','assigned'),nullif(p_filters->>'dateFrom','')::date,nullif(p_filters->>'dateThrough','')::date,10000,0,
    nullif(p_filters->>'employeeId','')::uuid,nullif(p_filters->>'planId','')::uuid,coalesce(p_filters->>'purpose','all'),coalesce(p_filters->>'department',''),
    nullif(p_filters->>'trainingYear','')::integer,coalesce(p_filters->>'deadline','all'));
  with rows as materialized(select * from jsonb_to_recordset(v_report->'rows') as r(id uuid,employee_id uuid,student text,course text,status text,is_required boolean,department text,completed_at timestamptz,assigned_at timestamptz,percent_complete integer)),
  departments as(select coalesce(nullif(department,''),'Not specified') as department,count(distinct employee_id) as students,
    count(*) filter(where is_required and status<>'canceled') as required,count(*) filter(where is_required and status='completed') as completed,
    count(*) filter(where status='assigned') as not_started from rows group by 1),
  months as(select generate_series(date_trunc('month',public.pa_today())-interval '11 months',date_trunc('month',public.pa_today()),interval '1 month')::date as month),
  trend as(select to_char(m.month,'YYYY-MM') as month,count(r.id) as completions from months m left join rows r on r.status='completed'
    and (r.completed_at at time zone 'America/New_York')::date>=m.month and (r.completed_at at time zone 'America/New_York')::date<(m.month+interval '1 month')::date group by m.month),
  stalled as materialized(select r.id,r.employee_id,r.student,r.course,r.percent_complete,cp.updated_at as last_progress_at from rows r join public.course_progress cp on cp.assignment_id=r.id
    where r.status in ('in_progress','overdue') and cp.started_at is not null and cp.updated_at<=now()-make_interval(days=>p_stalled_days))
  select jsonb_build_object('matching_enrollments',(v_report->>'total')::integer,'stalled_days',p_stalled_days,
    'departments',coalesce((select jsonb_agg(to_jsonb(d) order by department) from departments d),'[]'),
    'months',coalesce((select jsonb_agg(to_jsonb(t) order by month) from trend t),'[]'),
    'stalled_total',(select count(*) from stalled),'stalled',coalesce((select jsonb_agg(to_jsonb(s) order by last_progress_at,id) from (select * from stalled order by last_progress_at,id limit 50) s),'[]')) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_training_report_analytics(uuid,jsonb,integer) from public,anon;
grant execute on function public.get_training_report_analytics(uuid,jsonb,integer) to authenticated;

-- Recheck facility authority immediately before a provider attempt, not only when
-- a report is queued. The existing attempt command still owns consent, quiet hours,
-- retries, and receipt creation. Unrelated notification paths are unchanged.
create function app_private.training_delivery_scope_is_current(p_delivery_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare d public.notification_deliveries; n public.notifications; v_facility uuid; v_schedule uuid;
begin
  select * into d from public.notification_deliveries where id=p_delivery_id;
  select * into n from public.notifications where id=d.notification_id;
  if n.notification_type='course_assignment_due_soon' then
    return exists(select 1 from public.course_assignments a join public.employees e on e.id=a.employee_id and e.facility_id=a.facility_id
      join public.profiles p on p.id=e.profile_id join public.organizations o on o.id=a.organization_id
      join public.facilities f on f.id=a.facility_id
      left join app_private.training_reminder_policies policy on policy.facility_id=a.facility_id
      where n.link='/me/courses/'||a.id and e.profile_id=d.profile_id and a.organization_id=d.organization_id and e.status='active'
        and p.is_active and p.organization_id=d.organization_id and f.is_active and o.subscription_status<>'suspended' and coalesce(policy.learner_enabled,true)
        and (a.is_required or public.training_assignment_is_required(a.id)) and a.status in ('assigned','in_progress','overdue')
        and exists(select 1 from public.get_effective_entitlements(a.organization_id) ent where ent.feature_key='modules.train' and ent.is_entitled));
  end if;
  if n.notification_type not in ('training_overdue_summary','training_escalation_summary','report_subscription_ready') or n.notification_type is null then return true; end if;
  if n.notification_type='report_subscription_ready' and coalesce(n.link,'') not like '/app/train?%' then return true; end if;
  if coalesce(n.link,'') !~ '^/app/train\?facilityId=[0-9a-f-]{36}&tab=enrollments&' then return false; end if;
  v_facility:=substring(n.link from 'facilityId=([0-9a-f-]{36})')::uuid;
  if not app_private.training_manager_has_scope(d.profile_id,v_facility)
    or not exists(select 1 from public.facilities f join public.profiles p on p.organization_id=f.organization_id where f.id=v_facility and f.organization_id=d.organization_id and p.id=d.profile_id and p.role in ('org_admin','facility_manager')) then return false; end if;
  if n.notification_type='report_subscription_ready' then
    v_schedule:=substring(n.link from 'savedTrainingReport=([0-9a-f-]{36})')::uuid;
    return exists(select 1 from app_private.training_report_schedules s where s.id=v_schedule and s.facility_id=v_facility and s.enabled
      and d.profile_id=any(s.recipient_ids) and app_private.training_manager_has_scope(s.created_by,s.facility_id));
  end if;
  return not exists(select 1 from app_private.training_reminder_policies p where p.facility_id=v_facility
    and (not p.digest_enabled or (cardinality(p.recipient_ids)>0 and not d.profile_id=any(p.recipient_ids))));
end;
$$;
revoke all on function app_private.training_delivery_scope_is_current(uuid) from public,anon,authenticated;
do $guard$
declare v_definition text; v_needle text:='if v_delivery.id is null or v_delivery.status <> ''processing'' then return; end if;';
begin
  select pg_get_functiondef('public.begin_notification_delivery_attempt(uuid,text,text)'::regprocedure) into v_definition;
  if position(v_needle in v_definition)=0 then raise exception 'Notification attempt guard changed; review Training scope integration'; end if;
  execute replace(v_definition,v_needle,v_needle || E'\n  if not app_private.training_delivery_scope_is_current(p_delivery_id) then\n    update public.notification_deliveries set status=''skipped'', skip_reason=''Training facility access or subscription changed'', finalized_at=now() where id=p_delivery_id;\n    return;\n  end if;');
end;
$guard$;

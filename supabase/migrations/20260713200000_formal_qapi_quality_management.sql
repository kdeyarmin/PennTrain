-- Priority 6: governed QAPI projects aggregate existing operational signals.
-- Source records remain authoritative; work_items remains the owned action engine.

insert into public.work_item_templates(
  template_key,name,source_type,default_priority,due_interval,approval_required,
  escalation_after,default_owner_role
) values ('qapi.project_action','QAPI project action','qapi','high',interval '14 days',true,interval '2 days','facility_manager')
on conflict(organization_id,template_key) do nothing;

create table public.qapi_projects(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict,
 project_number text not null,
 title text not null, problem_statement text not null, source_of_concern text not null,
 source_type text, source_id uuid,
 baseline_data text, measurable_objective text, target_description text,
 target_value numeric, start_date date not null default current_date,
 target_completion_date date not null,
 project_lead_profile_id uuid references public.profiles(id),
 team_members jsonb not null default '[]',
 root_cause_method text check(root_cause_method is null or root_cause_method in('five_whys','fishbone','other')),
 root_cause_analysis text, planned_interventions text,
 measurement_frequency text, audit_sample text,
 barriers text, adjustments text, effectiveness_determination text,
 sustainment_period text, status text not null default 'proposed'
   check(status in('proposed','active','monitoring','pending_closure','closed','canceled')),
 final_closure_approved_by uuid references public.profiles(id),
 final_closure_approved_at timestamptz, closed_at timestamptz,
 created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,project_number),
 check(target_completion_date>=start_date),
 check(status<>'closed' or final_closure_approved_at is not null)
);
create index qapi_projects_queue_idx on public.qapi_projects(organization_id,facility_id,status,target_completion_date);
create unique index qapi_projects_source_dedupe_idx on public.qapi_projects(organization_id,source_type,source_id)
 where source_type is not null and source_id is not null;

create table public.qapi_action_items(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict,
 project_id uuid not null references public.qapi_projects(id) on delete cascade,
 work_item_id uuid not null references public.work_items(id) on delete restrict,
 action_type text not null check(action_type in('immediate','systemic','training','monitoring')),
 created_at timestamptz not null default now(), unique(project_id,work_item_id)
);
create table public.qapi_measurements(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict,
 project_id uuid not null references public.qapi_projects(id) on delete cascade,
 period_start date not null, period_end date not null,
 numerator numeric not null, denominator numeric, result_value numeric not null,
 sample_description text, result_notes text, source_snapshot jsonb not null default '{}',
 recorded_by uuid references public.profiles(id), recorded_at timestamptz not null default now(),
 check(period_end>=period_start)
);
create index qapi_measurements_project_idx on public.qapi_measurements(project_id,period_end desc);
create table public.qapi_meeting_notes(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict,
 project_id uuid not null references public.qapi_projects(id) on delete cascade,
 held_at timestamptz not null, attendees text not null, notes text not null,
 barriers text, adjustments text, created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create table public.qapi_project_history(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict,
 project_id uuid not null references public.qapi_projects(id) on delete restrict,
 event_type text not null, prior_status text, resulting_status text,
 reason text not null, actor_profile_id uuid references public.profiles(id),
 evidence jsonb not null default '{}', occurred_at timestamptz not null default now()
);

do $$declare t text;begin foreach t in array array['qapi_projects','qapi_action_items','qapi_measurements','qapi_meeting_notes','qapi_project_history'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 execute format('grant all on table public.%I to service_role',t);
 execute format('grant select on table public.%I to authenticated',t);
end loop;end$$;
create policy qapi_projects_select on public.qapi_projects for select to authenticated
 using(app_private.admission_row_visible(organization_id,facility_id));
create policy qapi_actions_select on public.qapi_action_items for select to authenticated
 using(app_private.admission_row_visible(organization_id,facility_id));
create policy qapi_measurements_select on public.qapi_measurements for select to authenticated
 using(app_private.admission_row_visible(organization_id,facility_id));
create policy qapi_meetings_select on public.qapi_meeting_notes for select to authenticated
 using(app_private.admission_row_visible(organization_id,facility_id));
create policy qapi_history_select on public.qapi_project_history for select to authenticated
 using(app_private.admission_row_visible(organization_id,facility_id));
create trigger prevent_qapi_history_mutation before update or delete on public.qapi_project_history
 for each row execute function app_private.prevent_phase5_evidence_mutation();
create trigger prevent_qapi_measurement_mutation before update or delete on public.qapi_measurements
 for each row execute function app_private.prevent_phase5_evidence_mutation();

create or replace function public.get_qapi_source_metrics(p_facility_id uuid,p_from date,p_through date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_fac public.facilities%rowtype;begin
 select * into v_fac from public.facilities where id=p_facility_id;
 if not found or not app_private.admission_row_visible(v_fac.organization_id,v_fac.id) then raise exception 'QAPI metrics outside scope' using errcode='42501';end if;
 return jsonb_build_object(
  'falls',(select count(*) from public.resident_change_events where facility_id=v_fac.id and category='fall' and identified_at::date between p_from and p_through),
  'medicationIncidents',(select count(*) from public.incidents where facility_id=v_fac.id and incident_type='medication_error' and occurred_at::date between p_from and p_through),
  'hospitalTransfers',(select count(*) from public.resident_change_events where facility_id=v_fac.id and (category in('emergency_department_visit','hospital_return') or emergency_transfer) and identified_at::date between p_from and p_through),
  'missedServices',(select count(*) from public.resident_service_task_instances where facility_id=v_fac.id and status='not_completed' and scheduled_start::date between p_from and p_through),
  'lateServices',(select count(*) from public.resident_service_task_instances where facility_id=v_fac.id and status='completed_late' and scheduled_start::date between p_from and p_through),
  'lateAssessments',(select count(*) from public.resident_compliance_items where facility_id=v_fac.id and status='expired' and item_type in('initial_assessment_15day','annual_reassessment','significant_change_reassessment','support_plan_30day')),
  'trainingGaps',(select count(*) from public.employee_training_records where facility_id=v_fac.id and status in('missing','expired')),
  'citationRecurrence',(select count(*) from (select citation_topic_id from public.dhs_violations where facility_id=v_fac.id and inspection_date between p_from and p_through group by citation_topic_id having count(*)>1)x),
  'inspectionDeficiencies',(select count(*) from public.inspection_events where facility_id=v_fac.id and result in('fail','deficiency_noted') and performed_date between p_from and p_through),
  'nutritionExceptions',(select count(*) from public.resident_change_events where facility_id=v_fac.id and category in('appetite_intake_change','weight_concern') and identified_at::date between p_from and p_through),
  'currentInactiveStaff',(select count(*) from public.employees where facility_id=v_fac.id and status<>'active'),
  'complaints',jsonb_build_object('available',false,'count',0),
  'appointmentFailures',jsonb_build_object('available',false,'count',0),
  'periodStart',p_from,'periodEnd',p_through
 );end$$;

create or replace function public.create_qapi_project(
 p_facility_id uuid,p_title text,p_problem_statement text,p_source_of_concern text,
 p_baseline_data text,p_measurable_objective text,p_target_description text,
 p_target_value numeric,p_target_completion_date date,p_project_lead uuid,
 p_source_type text default null,p_source_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_fac public.facilities%rowtype;v_id uuid;v_num text;begin
 select * into v_fac from public.facilities where id=p_facility_id;
 if not found then raise exception 'Facility not found' using errcode='P0002';end if;
 perform app_private.assert_admission_manager(v_fac.organization_id,v_fac.id);
 perform pg_advisory_xact_lock(hashtext(v_fac.organization_id::text));
 if length(btrim(p_title))<3 or length(btrim(p_problem_statement))<10 or p_target_completion_date<current_date then raise exception 'Invalid QAPI project' using errcode='22023';end if;
 if p_source_type is not null and p_source_id is not null then select id into v_id from public.qapi_projects where organization_id=v_fac.organization_id and source_type=p_source_type and source_id=p_source_id;if v_id is not null then return v_id;end if;end if;
 perform pg_advisory_xact_lock(hashtext('qapi_project_numbering'), hashtext(v_fac.organization_id::text));
 v_num:='QAPI-'||to_char(current_date,'YYYY')||'-'||lpad((select (count(*)+1)::text from public.qapi_projects where organization_id=v_fac.organization_id),4,'0');
 insert into public.qapi_projects(organization_id,facility_id,project_number,title,problem_statement,source_of_concern,source_type,source_id,baseline_data,measurable_objective,target_description,target_value,target_completion_date,project_lead_profile_id,created_by)
 values(v_fac.organization_id,v_fac.id,v_num,btrim(p_title),btrim(p_problem_statement),btrim(p_source_of_concern),p_source_type,p_source_id,p_baseline_data,p_measurable_objective,p_target_description,p_target_value,p_target_completion_date,p_project_lead,auth.uid()) returning id into v_id;
 insert into public.qapi_project_history(organization_id,facility_id,project_id,event_type,resulting_status,reason,actor_profile_id)
 values(v_fac.organization_id,v_fac.id,v_id,'created','proposed','QAPI project created',auth.uid()) on conflict do nothing;
 return v_id;end$$;

create or replace function public.update_qapi_project_plan(
 p_project_id uuid,p_status text,p_team_members jsonb,p_root_cause_method text,
 p_root_cause_analysis text,p_planned_interventions text,p_measurement_frequency text,
 p_audit_sample text,p_barriers text,p_adjustments text,p_effectiveness text,p_sustainment text,p_reason text
) returns boolean language plpgsql security definer set search_path='' as $$
declare v public.qapi_projects%rowtype;begin select * into v from public.qapi_projects where id=p_project_id for update;
 if not found then raise exception 'QAPI project not found' using errcode='P0002';end if;perform app_private.assert_admission_manager(v.organization_id,v.facility_id);
 if p_status not in('proposed','active','monitoring','pending_closure','closed','canceled') or length(btrim(p_reason))<5 then raise exception 'Invalid QAPI transition' using errcode='22023';end if;
 if p_status='pending_closure' and (length(btrim(coalesce(p_root_cause_analysis,'')))<10 or not exists(select 1 from public.qapi_action_items where project_id=v.id) or not exists(select 1 from public.qapi_measurements where project_id=v.id) or length(btrim(coalesce(p_effectiveness,'')))<5) then raise exception 'QAPI closure evidence incomplete' using errcode='55000';end if;
 if p_status='closed' and v.status<>'pending_closure' then raise exception 'Project requires pending closure review' using errcode='55000';end if;
 update public.qapi_projects set status=p_status,team_members=coalesce(p_team_members,'[]'),root_cause_method=p_root_cause_method,root_cause_analysis=nullif(btrim(p_root_cause_analysis),''),planned_interventions=nullif(btrim(p_planned_interventions),''),measurement_frequency=nullif(btrim(p_measurement_frequency),''),audit_sample=nullif(btrim(p_audit_sample),''),barriers=nullif(btrim(p_barriers),''),adjustments=nullif(btrim(p_adjustments),''),effectiveness_determination=nullif(btrim(p_effectiveness),''),sustainment_period=nullif(btrim(p_sustainment),''),final_closure_approved_by=case when p_status='closed' then auth.uid() else final_closure_approved_by end,final_closure_approved_at=case when p_status='closed' then now() else final_closure_approved_at end,closed_at=case when p_status='closed' then now() else closed_at end,updated_at=now() where id=v.id;
 insert into public.qapi_project_history(organization_id,facility_id,project_id,event_type,prior_status,resulting_status,reason,actor_profile_id) values(v.organization_id,v.facility_id,v.id,'plan_updated',v.status,p_status,btrim(p_reason),auth.uid());return true;end$$;

create or replace function public.add_qapi_action(
 p_project_id uuid,p_title text,p_description text,p_action_type text,p_owner uuid,p_due_at timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.qapi_projects%rowtype;v_work uuid;v_id uuid;v_template uuid;begin select * into v from public.qapi_projects where id=p_project_id;
 if not found then raise exception 'QAPI project not found' using errcode='P0002';end if;perform app_private.assert_admission_manager(v.organization_id,v.facility_id);
 select id into v_template from public.work_item_templates where template_key='qapi.project_action' and (organization_id=v.organization_id or organization_id is null) order by organization_id nulls last limit 1;
 insert into public.work_items(organization_id,facility_id,template_id,source_type,source_id,deduplication_key,title,description,owner_profile_id,priority,due_at,created_by)
 values(v.organization_id,v.facility_id,v_template,'qapi',v.id,'qapi:'||v.id||':'||extensions.gen_random_uuid(),btrim(p_title),p_description,p_owner,'high',p_due_at,auth.uid()) returning id into v_work;
 insert into public.work_item_history(organization_id,facility_id,work_item_id,event_type,resulting_state,actor_profile_id,reason) values(v.organization_id,v.facility_id,v_work,'created','open',auth.uid(),'QAPI project created owned action');
 insert into public.qapi_action_items(organization_id,facility_id,project_id,work_item_id,action_type) values(v.organization_id,v.facility_id,v.id,v_work,p_action_type) returning id into v_id;
 insert into public.qapi_project_history(organization_id,facility_id,project_id,event_type,prior_status,resulting_status,reason,actor_profile_id,evidence) values(v.organization_id,v.facility_id,v.id,'action_added',v.status,v.status,'QAPI action added',auth.uid(),jsonb_build_object('workItemId',v_work));return v_id;end$$;

create or replace function public.record_qapi_measurement(p_project_id uuid,p_start date,p_end date,p_numerator numeric,p_denominator numeric,p_notes text,p_sample text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.qapi_projects%rowtype;v_id uuid;v_result numeric;begin select * into v from public.qapi_projects where id=p_project_id;
 if not found then raise exception 'QAPI project not found' using errcode='P0002';end if;perform app_private.assert_admission_manager(v.organization_id,v.facility_id);
 v_result:=case when p_denominator is null or p_denominator=0 then p_numerator else round(p_numerator/p_denominator*100,2) end;
 insert into public.qapi_measurements(organization_id,facility_id,project_id,period_start,period_end,numerator,denominator,result_value,sample_description,result_notes,source_snapshot,recorded_by)
 values(v.organization_id,v.facility_id,v.id,p_start,p_end,p_numerator,p_denominator,v_result,p_sample,p_notes,public.get_qapi_source_metrics(v.facility_id,p_start,p_end),auth.uid()) returning id into v_id;return v_id;end$$;

create or replace function public.add_qapi_meeting_note(p_project_id uuid,p_held_at timestamptz,p_attendees text,p_notes text,p_barriers text,p_adjustments text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.qapi_projects%rowtype;v_id uuid;begin select * into v from public.qapi_projects where id=p_project_id;
 if not found then raise exception 'QAPI project not found' using errcode='P0002';end if;perform app_private.assert_admission_manager(v.organization_id,v.facility_id);
 insert into public.qapi_meeting_notes(organization_id,facility_id,project_id,held_at,attendees,notes,barriers,adjustments,created_by) values(v.organization_id,v.facility_id,v.id,p_held_at,btrim(p_attendees),btrim(p_notes),nullif(btrim(p_barriers),''),nullif(btrim(p_adjustments),''),auth.uid()) returning id into v_id;return v_id;end$$;

revoke all on function public.get_qapi_source_metrics(uuid,date,date),public.create_qapi_project(uuid,text,text,text,text,text,text,numeric,date,uuid,text,uuid),public.update_qapi_project_plan(uuid,text,jsonb,text,text,text,text,text,text,text,text,text,text),public.add_qapi_action(uuid,text,text,text,uuid,timestamptz),public.record_qapi_measurement(uuid,date,date,numeric,numeric,text,text),public.add_qapi_meeting_note(uuid,timestamptz,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_qapi_source_metrics(uuid,date,date) to authenticated;
grant execute on function public.create_qapi_project(uuid,text,text,text,text,text,text,numeric,date,uuid,text,uuid),public.update_qapi_project_plan(uuid,text,jsonb,text,text,text,text,text,text,text,text,text,text),public.add_qapi_action(uuid,text,text,text,uuid,timestamptz),public.record_qapi_measurement(uuid,date,date,numeric,numeric,text,text),public.add_qapi_meeting_note(uuid,timestamptz,text,text,text,text) to authenticated;

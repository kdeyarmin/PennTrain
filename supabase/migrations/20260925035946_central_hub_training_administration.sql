-- Support Hub owns the operator UI. These service-only entry points accept the
-- live, explicitly mapped Hub authority already verified by the native adapter.
-- No native JWT, Auth session or impersonation identity is synthesized.
create function app_private.provision_training_facility_core(p_actor uuid,p_request_id uuid,p_organization_name text,p_facility_name text,p_facility_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_package uuid; v_facility uuid;
begin
  if p_request_id is null or length(btrim(coalesce(p_organization_name,''))) not between 2 and 200
    or length(btrim(coalesce(p_facility_name,''))) not between 2 and 200
    or coalesce(p_facility_type,'') not in ('PCH','ALR') then raise exception 'Organization, facility and PCH/ALR license type are required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  if exists(select 1 from public.organizations where id=p_request_id) then
    if not exists(select 1 from app_private.module_access_terms where organization_id=p_request_id and granted_by=p_actor
      and reason='Complimentary Train facility provisioning') then raise exception 'Provisioning request already used' using errcode='22023'; end if;
    select id into v_facility from public.facilities where organization_id=p_request_id order by created_at,id limit 1;
    return jsonb_build_object('organization_id',p_request_id,'facility_id',v_facility);
  end if;
  select id into v_package from public.packages where name='CareMetric Train' and is_active;
  if v_package is null then raise exception 'Train package unavailable' using errcode='22023'; end if;
  perform set_config('app.privileged_write','on',true);
  insert into public.organizations(id,name,slug,package_id,subscription_status,trial_ends_at)
    values(p_request_id,btrim(p_organization_name),'train-'||p_request_id::text,v_package,'trial',now());
  insert into public.facilities(organization_id,name,facility_type)
    values(p_request_id,btrim(p_facility_name),p_facility_type) returning id into v_facility;
  insert into app_private.module_access_terms(organization_id,module_key,source,reason,granted_by)
    values(p_request_id,'modules.train','complimentary','Complimentary Train facility provisioning',p_actor);
  insert into public.audit_logs(organization_id,actor_profile_id,action,entity_type,entity_id,metadata)
    values(p_request_id,p_actor,'train_facility.provisioned','organizations',p_request_id::text,jsonb_build_object('facility_id',v_facility));
  return jsonb_build_object('organization_id',p_request_id,'facility_id',v_facility);
end;
$$;
create function app_private.manage_module_access_term_core(p_actor uuid,p_organization_id uuid,p_module_key text,p_source text,
  p_reason text,p_ends_at timestamptz default null,p_revoke_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_old text; v_module text;
begin
  if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then
    raise exception 'Record a reason of 10 to 1000 characters' using errcode='22023'; end if;
  select subscription_status into v_old from public.organizations where id=p_organization_id for update;
  if not found then raise exception 'Organization not found' using errcode='22023'; end if;
  if p_revoke_id is not null then
    update app_private.module_access_terms set revoked_at=now()
      where id=p_revoke_id and organization_id=p_organization_id and revoked_at is null returning id,module_key into v_id,v_module;
    if v_id is null then raise exception 'Active access term not found' using errcode='22023'; end if;
    -- Reconcile membership immediately, keeping an administrative suspension intact.
    if v_old<>'suspended' and not app_private.has_independent_module_access(p_organization_id)
      and exists(select 1 from public.billing_accounts where organization_id=p_organization_id and billing_state='canceled') then
      perform set_config('app.privileged_write','on',true);
      update public.organizations set subscription_status='canceled' where id=p_organization_id;
    end if;
  else
    v_module:=p_module_key;
    insert into app_private.module_access_terms(organization_id,module_key,source,ends_at,reason,granted_by)
      values(p_organization_id,p_module_key,p_source,p_ends_at,btrim(p_reason),p_actor) returning id into v_id;
    if v_old='canceled' then
      perform set_config('app.privileged_write','on',true);
      update public.organizations set subscription_status='active' where id=p_organization_id;
    end if;
  end if;
  insert into public.audit_logs(organization_id,actor_profile_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,p_actor,case when p_revoke_id is null then 'module_access.granted' else 'module_access.revoked' end,
      'module_access_terms',v_id::text,jsonb_build_object('module',v_module,'reason',p_reason));
  return jsonb_build_object('id',v_id);
end;
$$;
revoke all on function app_private.provision_training_facility_core(uuid,uuid,text,text,text),
 app_private.manage_module_access_term_core(uuid,uuid,text,text,text,timestamptz,uuid) from public,anon,authenticated,service_role;

create or replace function public.provision_training_facility(p_request_id uuid,p_organization_name text,p_facility_name text,p_facility_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
  return app_private.provision_training_facility_core(auth.uid(),p_request_id,p_organization_name,p_facility_name,p_facility_type);
end;
$$;
create or replace function public.manage_module_access_term(p_organization_id uuid,p_module_key text,p_source text,
 p_reason text,p_ends_at timestamptz default null,p_revoke_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
  return app_private.manage_module_access_term_core(auth.uid(),p_organization_id,p_module_key,p_source,p_reason,p_ends_at,p_revoke_id);
end;
$$;

create table app_private.training_admin_commands (
 hub_user_id uuid not null, request_id uuid not null, actor_profile_id uuid not null,
 hub_session_id uuid not null, authentication_method text not null check(authentication_method in ('jwt_aal2','app_sms')),
 operation jsonb not null check(jsonb_typeof(operation)='object'), result jsonb not null,
 created_at timestamptz not null default clock_timestamp(), primary key(hub_user_id,request_id)
);
alter table app_private.training_admin_commands enable row level security;
revoke all on app_private.training_admin_commands from public,anon,authenticated,service_role;
create function app_private.protect_training_admin_command() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Training command receipts are immutable' using errcode='42501'; end;
$$;
create trigger protect_training_admin_command before update or delete on app_private.training_admin_commands
 for each row execute function app_private.protect_training_admin_command();
revoke all on function app_private.protect_training_admin_command() from public,anon,authenticated,service_role;

create function app_private.training_admin_keys(p_value jsonb,p_keys text[]) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='object' and p_value ?& p_keys and p_value-p_keys='{}'::jsonb,false);
$$;
revoke all on function app_private.training_admin_keys(jsonb,text[]) from public,anon,authenticated,service_role;

-- Private report query preserves the existing PA date, assigned-version and exact-export semantics.
-- One enrollment is one assignment, including annual repeats. This private query runs
-- only behind verified mapped platform-owner delegation with explicit tenant predicates.
-- Its calculations mirror the caller-RLS public report; it does not borrow a customer session.
create function app_private.training_admin_enrollment_report(
  p_organization_id uuid,
  p_facility_id uuid default null,
  p_course_search text default '',
  p_status text default 'all',
  p_date_basis text default 'assigned',
  p_date_from date default null,
  p_date_through date default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_result jsonb;
begin
  if p_status is null or p_status not in ('all','assigned','in_progress','completed','overdue','paused','canceled')
    or p_date_basis is null or p_date_basis not in ('assigned','completed','certificate')
    or p_limit is null or (p_limit not between 1 and 500 and p_limit <> 10000)
    or p_offset is null or p_offset < 0 or (p_limit=10000 and p_offset<>0)
    or length(coalesce(p_course_search,'')) > 200
    or (p_date_from is not null and p_date_through is not null and p_date_from > p_date_through) then
    raise exception 'Invalid training report filters' using errcode='22023';
  end if;

  with enrollment as materialized (
    select a.id, a.employee_id,
      coalesce(nullif(btrim(concat_ws(' ',e.first_name,e.last_name)),''),'Student record '||a.employee_id::text) as student,
      a.facility_id, f.name as facility, a.course_id, coalesce(cv.title,c.title,'Course unavailable') as course,
      a.status, a.assigned_at, a.due_date, a.completed_at,
      case when a.status='completed' then 100 else coalesce(cp.percent_complete,0) end as percent_complete,
      cert.id as certificate_id, cert.credential_number, cert.issued_at as certificate_issued_at,
      cert.pdf_status as certificate_pdf_status,
      case p_date_basis when 'completed' then (a.completed_at at time zone 'America/New_York')::date
        when 'certificate' then (cert.issued_at at time zone 'America/New_York')::date
        else (a.assigned_at at time zone 'America/New_York')::date end as filter_date
    from public.course_assignments a
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
      and (p_status='all' or a.status=p_status)
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
revoke all on function app_private.training_admin_enrollment_report(uuid,uuid,text,text,text,date,date,integer,integer)
 from public,anon,authenticated,service_role;

create function public.platform_admin_training(
 p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
 p_authentication_method text,p_operation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 op text:=p_operation->>'operation'; org uuid; fac uuid; lim integer; off integer; search text; action text;
 params jsonb; reason text; request_id uuid; receipt app_private.training_admin_commands; result jsonb; payload jsonb;
 employee public.employees; assignment public.course_assignments; cert public.certificates;
 target uuid; version_id uuid; event_id uuid; previous_write text:=coalesce(current_setting('app.privileged_write',true),'');
begin
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 if jsonb_typeof(p_operation) is distinct from 'object' or p_operation->>'domain' is distinct from 'training.v1'
  or octet_length(p_operation::text)>8192 then raise exception 'Invalid training operation' using errcode='22023'; end if;
 org:=(p_operation->>'organizationId')::uuid;
 if op='apply' then
  if not app_private.training_admin_keys(p_operation,array['domain','operation','requestId','action','organizationId','parameters','reason']) then raise exception 'Invalid training command' using errcode='22023'; end if;
  request_id:=(p_operation->>'requestId')::uuid; action:=p_operation->>'action'; params:=p_operation->'parameters'; reason:=btrim(p_operation->>'reason');
  if request_id is null or jsonb_typeof(params) is distinct from 'object' or reason is null or length(reason) not between 10 and 500 or reason ~ '[[:cntrl:]]'
   or action is null or action not in ('facilities.provision','students.create','students.update','students.setActive','enrollments.assign','enrollments.cancel','access.grant','access.revoke')
   or (action='facilities.provision') is distinct from (org is null) then raise exception 'Invalid training command' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_hub_user::text||request_id::text,0));
  select * into receipt from app_private.training_admin_commands where hub_user_id=p_hub_user and training_admin_commands.request_id=platform_admin_training.request_id;
  if found then
   if receipt.operation is distinct from p_operation or receipt.actor_profile_id is distinct from p_actor then raise exception 'Request ID already used' using errcode='40001'; end if;
   return receipt.result || jsonb_build_object('replayed',true);
  end if;
 else
  if op not in ('facilities.list','students.list','courses.list','access.list','enrollments.report','certificates.read') or op is null then raise exception 'Invalid training read' using errcode='22023'; end if;
 end if;
 if org is not null then
  perform 1 from public.organizations where id=org and (op<>'apply' or not is_demo) for update;
  if not found then raise exception 'Organization unavailable' using errcode='P0002'; end if;
 elsif op<>'apply' then raise exception 'Explicit organization required' using errcode='22023'; end if;
 -- A queued request can wait on organization or receipt locks; authority must remain fresh.
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);

 if op in ('facilities.list','students.list','courses.list') then
  if not app_private.training_admin_keys(p_operation,case when op='students.list' then array['domain','operation','organizationId','facilityId','limit','offset','search','status'] else array['domain','operation','organizationId','limit','offset','search'] end) then raise exception 'Invalid training list' using errcode='22023'; end if;
  lim:=(p_operation->>'limit')::integer; off:=(p_operation->>'offset')::integer; search:=p_operation->>'search'; fac:=(p_operation->>'facilityId')::uuid;
  if lim is null or lim not between 1 and 100 or off is null or off not between 0 and 1000000 or search is null or length(search)>100 or search ~ '[[:cntrl:]]' then raise exception 'Invalid training list' using errcode='22023'; end if;
  if op='students.list' and (fac is null or p_operation->>'status' is null or p_operation->>'status' not in ('all','active','inactive')) then raise exception 'Invalid student status' using errcode='22023'; end if;
  if fac is not null and not exists(select 1 from public.facilities where id=fac and organization_id=org) then raise exception 'Facility outside organization' using errcode='42501'; end if;
  if op='facilities.list' then
   with records as materialized(select id,name,jsonb_build_object('id',id,'name',name,'facilityType',facility_type,'isActive',is_active) as value
    from public.facilities where organization_id=org and strpos(lower(name),lower(search))>0),
   page as(select * from records order by name,id limit lim offset off)
   select jsonb_build_object('items',coalesce((select jsonb_agg(value order by name,id) from page),'[]'::jsonb),'total',(select count(*) from records),'limit',lim,'offset',off) into payload;
  elsif op='students.list' then
   with records as materialized(select id,last_name,first_name,jsonb_build_object('id',id,'firstName',first_name,'lastName',last_name,'email',email,'jobTitle',job_title,'hireDate',hire_date,'isActive',status='active','status',status,'profileId',profile_id) as value
    from public.employees where organization_id=org and (fac is null or facility_id=fac)
     and (p_operation->>'status'='all' or (status='active')=(p_operation->>'status'='active'))
     and strpos(lower(first_name||' '||last_name||' '||coalesce(email,'')),lower(search))>0),
   page as(select * from records order by last_name,first_name,id limit lim offset off)
   select jsonb_build_object('items',coalesce((select jsonb_agg(value order by last_name,first_name,id) from page),'[]'::jsonb),'total',(select count(*) from records),'limit',lim,'offset',off) into payload;
  else
   with records as materialized(select c.id,c.title,jsonb_build_object('id',c.id,'title',coalesce(v.title,c.title),'versionId',v.id) as value
    from public.courses c join public.course_versions v on v.id=c.current_version_id and v.course_id=c.id
    where (c.organization_id is null or c.organization_id=org) and c.status='published' and v.status='published'
     and (v.organization_id is null or v.organization_id=org) and (not v.ai_generated or v.ai_reviewed_at is not null)
     and strpos(lower(coalesce(v.title,c.title)),lower(search))>0),
   page as(select * from records order by title,id limit lim offset off)
   select jsonb_build_object('items',coalesce((select jsonb_agg(value order by title,id) from page),'[]'::jsonb),'total',(select count(*) from records),'limit',lim,'offset',off) into payload;
  end if;
 elsif op='access.list' then
  if not app_private.training_admin_keys(p_operation,array['domain','operation','organizationId','limit','offset']) then raise exception 'Invalid access request' using errcode='22023'; end if;
  lim:=(p_operation->>'limit')::integer; off:=(p_operation->>'offset')::integer;
  if lim is null or lim not between 1 and 100 or off is null or off not between 0 and 1000000 then raise exception 'Invalid access pagination' using errcode='22023'; end if;
  with records as materialized(select t.id,t.created_at,jsonb_build_object('id',t.id,'moduleKey',t.module_key,'source',t.source,'startsAt',t.starts_at,'endsAt',t.ends_at,'revokedAt',t.revoked_at,'reason',t.reason) as value
   from app_private.module_access_terms t where t.organization_id=org),
  page as(select * from records order by created_at desc,id limit lim offset off)
  select jsonb_build_object('items',coalesce((select jsonb_agg(value order by created_at desc,id) from page),'[]'::jsonb),
   'total',(select count(*) from records),'limit',lim,'offset',off) into payload;
 elsif op='enrollments.report' then
  if not app_private.training_admin_keys(p_operation,array['domain','operation','organizationId','facilityId','courseSearch','status','dateBasis','dateFrom','dateThrough','limit','offset']) then raise exception 'Invalid enrollment report' using errcode='22023'; end if;
  fac:=(p_operation->>'facilityId')::uuid;
  if fac is not null and not exists(select 1 from public.facilities where id=fac and organization_id=org) then raise exception 'Facility outside organization' using errcode='42501'; end if;
  payload:=app_private.training_admin_enrollment_report(org,fac,p_operation->>'courseSearch',p_operation->>'status',p_operation->>'dateBasis',
   (p_operation->>'dateFrom')::date,(p_operation->>'dateThrough')::date,(p_operation->>'limit')::integer,(p_operation->>'offset')::integer);
 elsif op='certificates.read' then
  if not app_private.training_admin_keys(p_operation,array['domain','operation','organizationId','certificateId']) then raise exception 'Invalid certificate request' using errcode='22023'; end if;
  select * into cert from public.certificates where id=(p_operation->>'certificateId')::uuid and organization_id=org;
  if not found then raise exception 'Certificate outside organization' using errcode='P0002'; end if;
  payload:=jsonb_build_object('certificateId',cert.id,'status',cert.pdf_status,'url',null,'expiresAt',null,
   '_storageBucket',cert.pdf_storage_bucket,'_storagePath',cert.pdf_storage_path);
 elsif op='apply' then
  if action='facilities.provision' then
   if not app_private.training_admin_keys(params,array['organizationName','facilityName','facilityType']) then raise exception 'Invalid provision parameters' using errcode='22023'; end if;
   result:=app_private.provision_training_facility_core(p_actor,request_id,params->>'organizationName',params->>'facilityName',params->>'facilityType');
   org:=(result->>'organization_id')::uuid;
   result:=jsonb_build_object('organizationId',org,'facilityId',result->>'facility_id');
  elsif action='students.create' then
   if not app_private.training_admin_keys(params,array['facilityId','firstName','lastName','email','jobTitle','hireDate']) then raise exception 'Invalid student parameters' using errcode='22023'; end if;
   fac:=(params->>'facilityId')::uuid;
   if not exists(select 1 from public.facilities where id=fac and organization_id=org and is_active) then raise exception 'Facility outside organization or inactive' using errcode='42501'; end if;
   if length(btrim(coalesce(params->>'firstName',''))) not between 1 and 100 or length(btrim(coalesce(params->>'lastName',''))) not between 1 and 100
    or length(btrim(coalesce(params->>'jobTitle',''))) not between 1 and 200 or (params->>'hireDate')::date>public.pa_today()
    or params->>'hireDate' is null or (params->>'email' is not null and (length(params->>'email')>320 or params->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')) then raise exception 'Invalid student values' using errcode='22023'; end if;
   insert into public.employees(organization_id,facility_id,first_name,last_name,email,job_title,hire_date,status)
    values(org,fac,btrim(params->>'firstName'),btrim(params->>'lastName'),lower(params->>'email'),btrim(params->>'jobTitle'),(params->>'hireDate')::date,'active') returning id into target;
   result:=jsonb_build_object('employeeId',target);
  elsif action in ('students.update','students.setActive') then
   if not app_private.training_admin_keys(params,case action when 'students.update' then array['employeeId','firstName','lastName','email','jobTitle'] else array['employeeId','active','effectiveDate'] end) then raise exception 'Invalid student parameters' using errcode='22023'; end if;
   select * into employee from public.employees where id=(params->>'employeeId')::uuid and organization_id=org for update;
   if not found then raise exception 'Student outside organization' using errcode='42501'; end if;
   if action='students.update' then
    if length(btrim(coalesce(params->>'firstName',''))) not between 1 and 100 or length(btrim(coalesce(params->>'lastName',''))) not between 1 and 100
     or length(btrim(coalesce(params->>'jobTitle',''))) not between 1 and 200
     or (params->>'email' is not null and (length(params->>'email')>320 or params->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
     or (employee.profile_id is not null and employee.email is distinct from lower(params->>'email')) then raise exception 'Invalid student values or linked login email change' using errcode='22023'; end if;
    update public.employees set first_name=btrim(params->>'firstName'),last_name=btrim(params->>'lastName'),email=lower(params->>'email'),job_title=btrim(params->>'jobTitle') where id=employee.id;
   else
    if jsonb_typeof(params->'active') is distinct from 'boolean' or params->>'effectiveDate' is null then raise exception 'Invalid lifecycle parameters' using errcode='22023'; end if;
    event_id:=public.apply_employee_lifecycle_transition(employee.id,
     case when (params->>'active')::boolean then case employee.status when 'terminated' then 'rehire' when 'on_leave' then 'return' else 'hire' end else 'terminate' end,
     (params->>'effectiveDate')::date,null,reason);
   end if;
   result:=jsonb_build_object('employeeId',employee.id);
  elsif action='enrollments.assign' then
   if not app_private.training_admin_keys(params,array['employeeId','courseId','versionId','dueDate']) then raise exception 'Invalid enrollment parameters' using errcode='22023'; end if;
   select * into employee from public.employees where id=(params->>'employeeId')::uuid and organization_id=org and status='active' for update;
   if not found then raise exception 'Active student outside organization' using errcode='42501'; end if;
   if not exists(select 1 from public.facilities where id=employee.facility_id and organization_id=org and is_active) then raise exception 'Student facility is inactive' using errcode='22023'; end if;
   if not exists(select 1 from public.courses c join public.course_versions v on v.course_id=c.id where c.id=(params->>'courseId')::uuid
    and v.id=(params->>'versionId')::uuid and (c.organization_id is null or c.organization_id=org) and (v.organization_id is null or v.organization_id=org)
    and c.status='published' and v.status='published' and (not v.ai_generated or v.ai_reviewed_at is not null)) then raise exception 'Published course unavailable' using errcode='22023'; end if;
   select id into target from public.course_assignments where employee_id=employee.id and course_id=(params->>'courseId')::uuid and status in ('assigned','in_progress','overdue','paused');
   if target is not null then result:=jsonb_build_object('assignmentId',target,'alreadyAssigned',true);
   else
    insert into public.course_assignments(organization_id,facility_id,employee_id,course_id,course_version_id,due_date,assigned_by)
     values(org,employee.facility_id,employee.id,(params->>'courseId')::uuid,(params->>'versionId')::uuid,(params->>'dueDate')::date,p_actor) returning id into target;
    result:=jsonb_build_object('assignmentId',target,'alreadyAssigned',false);
   end if;
  elsif action='enrollments.cancel' then
   if not app_private.training_admin_keys(params,array['assignmentId']) then raise exception 'Invalid cancellation parameters' using errcode='22023'; end if;
   select * into assignment from public.course_assignments where id=(params->>'assignmentId')::uuid and organization_id=org for update;
   if not found then raise exception 'Enrollment outside organization' using errcode='42501'; end if;
   if assignment.status='completed' then raise exception 'Completed training cannot be canceled' using errcode='55000'; end if;
   if assignment.status<>'canceled' then
    perform set_config('app.privileged_write','on',true);
    update public.course_assignments set status='canceled',canceled_at=now(),cancellation_reason=reason where id=assignment.id;
    perform set_config('app.privileged_write',previous_write,true);
   end if;
   result:=jsonb_build_object('assignmentId',assignment.id);
  elsif action='access.grant' then
   if not app_private.training_admin_keys(params,array['moduleKey','source','endsAt']) or params->>'moduleKey' is null or params->>'source' is null then raise exception 'Invalid access parameters' using errcode='22023'; end if;
   result:=app_private.manage_module_access_term_core(p_actor,org,params->>'moduleKey',params->>'source',reason,(params->>'endsAt')::timestamptz,null);
   result:=jsonb_build_object('termId',result->>'id');
  else
   if not app_private.training_admin_keys(params,array['termId']) or params->>'termId' is null then raise exception 'Invalid revocation parameters' using errcode='22023'; end if;
   result:=app_private.manage_module_access_term_core(p_actor,org,null,null,reason,null,(params->>'termId')::uuid);
   result:=jsonb_build_object('termId',result->>'id');
  end if;
  perform set_config('app.privileged_write',previous_write,true);
  payload:=jsonb_build_object('requestId',request_id,'action',action,'organizationId',org,'replayed',false,'result',result);
  insert into app_private.training_admin_commands(hub_user_id,request_id,actor_profile_id,hub_session_id,authentication_method,operation,result)
   values(p_hub_user,request_id,p_actor,p_hub_session,p_authentication_method,p_operation,payload);
 end if;
 perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
 insert into public.audit_logs(organization_id,actor_profile_id,action,entity_type,entity_id,metadata)
  values(org,p_actor,'hub.training.'||coalesce(action,op),'organizations',org::text,
   jsonb_build_object('hubUserId',p_hub_user,'hubSessionId',p_hub_session,'authenticationMethod',p_authentication_method,'requestId',request_id,'reason',reason));
 return payload;
end;
$$;
revoke all on function public.platform_admin_training(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.platform_admin_training(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb) to service_role;

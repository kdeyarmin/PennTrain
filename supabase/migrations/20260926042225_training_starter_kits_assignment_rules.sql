-- Reusable global course kits never carry inferred deadlines. A facility manager
-- must review a selection and explicitly enter the year and completion date.
create table public.training_starter_kits (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  description text not null default '' check (length(description)<=3000),
  items jsonb not null default '[]' check (jsonb_typeof(items)='array' and jsonb_array_length(items)<=100),
  is_published boolean not null default false,
  revision integer not null default 1 check (revision>0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index training_starter_kits_actor_idx on public.training_starter_kits(updated_by);
create table public.training_starter_kit_selections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  kit_id uuid not null references public.training_starter_kits(id) on delete restrict,
  selected_by uuid references public.profiles(id) on delete set null,
  selected_at timestamptz not null default now(),
  copied_plan_id uuid references public.training_plans(id) on delete restrict,
  copied_revision integer,
  check ((copied_plan_id is null)=(copied_revision is null))
);
create unique index training_starter_selection_pending_idx on public.training_starter_kit_selections(facility_id,kit_id) where copied_plan_id is null;
create index training_starter_selection_org_idx on public.training_starter_kit_selections(organization_id);
create index training_starter_selection_kit_idx on public.training_starter_kit_selections(kit_id);
create index training_starter_selection_actor_idx on public.training_starter_kit_selections(selected_by);
create index training_starter_selection_plan_idx on public.training_starter_kit_selections(copied_plan_id);
create table public.training_plan_assignment_rules (
  training_plan_id uuid primary key references public.training_plans(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  job_title text check (job_title is null or length(btrim(job_title)) between 1 and 160),
  department text check (department is null or length(btrim(department)) between 1 and 160),
  is_enabled boolean not null default true,
  automatic_enabled boolean not null default false,
  approved_snapshot text,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  check (job_title is not null or department is not null),
  check (not automatic_enabled or approved_snapshot is not null)
);
create index training_plan_rules_org_idx on public.training_plan_assignment_rules(organization_id);
create index training_plan_rules_facility_idx on public.training_plan_assignment_rules(facility_id);
create index training_plan_rules_actor_idx on public.training_plan_assignment_rules(updated_by);

alter table public.training_starter_kits enable row level security;
alter table public.training_starter_kit_selections enable row level security;
alter table public.training_plan_assignment_rules enable row level security;
revoke all on public.training_starter_kits,public.training_starter_kit_selections,public.training_plan_assignment_rules from public,anon,authenticated;
grant select,insert,update on public.training_starter_kits,public.training_starter_kit_selections,public.training_plan_assignment_rules to authenticated;
grant all on public.training_starter_kits,public.training_starter_kit_selections,public.training_plan_assignment_rules to service_role;
create policy training_starter_kits_read on public.training_starter_kits for select to authenticated
using (public.is_platform_admin() or (is_published and public.current_role() in ('org_admin','trainer','facility_manager')));
create policy training_starter_kits_insert on public.training_starter_kits for insert to authenticated with check (public.is_platform_admin());
create policy training_starter_kits_update on public.training_starter_kits for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy training_starter_selection_read on public.training_starter_kit_selections for select to authenticated
using (app_private.can_manage_training_plan(organization_id,facility_id));
create policy training_starter_selection_insert on public.training_starter_kit_selections for insert to authenticated
with check (app_private.can_manage_training_plan(organization_id,facility_id));
create policy training_starter_selection_update on public.training_starter_kit_selections for update to authenticated
using (app_private.can_manage_training_plan(organization_id,facility_id)) with check (app_private.can_manage_training_plan(organization_id,facility_id));
create policy training_plan_rules_read on public.training_plan_assignment_rules for select to authenticated
using (app_private.can_manage_training_plan(organization_id,facility_id));
create policy training_plan_rules_insert on public.training_plan_assignment_rules for insert to authenticated
with check (app_private.can_manage_training_plan(organization_id,facility_id));
create policy training_plan_rules_update on public.training_plan_assignment_rules for update to authenticated
using (app_private.can_manage_training_plan(organization_id,facility_id)) with check (app_private.can_manage_training_plan(organization_id,facility_id));

do $$ declare v_table text; begin
  foreach v_table in array array['training_starter_kits','training_starter_kit_selections','training_plan_assignment_rules'] loop
    execute format('create policy sms_mfa_session_required on public.%I as restrictive for all to authenticated using ((select public.current_sms_mfa_satisfied())) with check ((select public.current_sms_mfa_satisfied()))',v_table);
    execute format('create policy impersonation_session_lifetime on public.%I as restrictive for all to authenticated using ((select public.current_impersonation_session_live())) with check ((select public.current_impersonation_session_live()))',v_table);
    execute format('create policy product_module_entitlement on public.%I as restrictive for all to authenticated using ((select app_private.has_product_module(''modules.train''))) with check ((select app_private.has_product_module(''modules.train'')))',v_table);
    execute format('create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()',v_table);
    insert into app_private.audit_entity_manifest(table_name,audit_mode,contains_regulated_data,rationale)
      values(v_table,'row_trigger',false,'Training kit authoring, facility adoption and assignment rule changes retain actor and revision history.');
    insert into app_private.product_module_resources(resource_schema,resource_name,module_key) values('public',v_table,'modules.train');
  end loop;
end $$;

create function app_private.guard_training_starter_kit()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_item jsonb;
begin
  if auth.uid() is null or not public.current_session_unlocked() or not public.is_platform_admin() then
    raise exception 'Platform administrator access required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('workforce_admin');
  if jsonb_typeof(new.items)<>'array' or jsonb_array_length(new.items)>100 then raise exception 'Choose up to 100 courses' using errcode='22023'; end if;
  if new.is_published and jsonb_array_length(new.items)=0 then raise exception 'Add courses before publishing a starter kit' using errcode='22023'; end if;
  if (select count(*) from jsonb_array_elements(new.items))<>(select count(distinct value->>'course_id') from jsonb_array_elements(new.items)) then
    raise exception 'A starter kit cannot repeat a course' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(new.items) loop
    if jsonb_typeof(v_item)<>'object' or jsonb_typeof(v_item->'is_required') is distinct from 'boolean'
      or not exists(select 1 from public.courses c join public.course_versions cv on cv.id=c.current_version_id and cv.course_id=c.id
        where c.id::text=v_item->>'course_id' and c.organization_id is null and c.status='published' and cv.status='published'
          and (not cv.ai_generated or cv.ai_reviewed_at is not null)) then
      raise exception 'Starter kits require published, reviewed global courses and a required flag' using errcode='23514'; end if;
  end loop;
  new.name:=btrim(new.name); new.updated_at:=now(); new.updated_by:=auth.uid();
  new.revision:=case when tg_op='UPDATE' then old.revision+1 else 1 end;
  return new;
end $$;
revoke all on function app_private.guard_training_starter_kit() from public,anon,authenticated,service_role;
create trigger guard_training_starter_kit before insert or update on public.training_starter_kits for each row execute function app_private.guard_training_starter_kit();

create function app_private.guard_training_kit_selection()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or not public.current_session_unlocked() then raise exception 'Current unlocked session required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('workforce_admin');
  if not exists(select 1 from public.facilities f where f.id=new.facility_id and f.organization_id=new.organization_id and f.is_active)
    or not exists(select 1 from public.training_starter_kits k where k.id=new.kit_id and k.is_published) then
    raise exception 'Choose an available starter kit and active facility' using errcode='23514'; end if;
  if tg_op='UPDATE' and ((new.organization_id,new.facility_id,new.kit_id,new.selected_by,new.selected_at) is distinct from
      (old.organization_id,old.facility_id,old.kit_id,old.selected_by,old.selected_at) or old.copied_plan_id is not null) then
    raise exception 'Starter kit selection history cannot be rewritten' using errcode='55000'; end if;
  if new.copied_plan_id is not null and not exists(select 1 from public.training_plans p where p.id=new.copied_plan_id
      and p.organization_id=new.organization_id and p.facility_id=new.facility_id) then
    raise exception 'Copied plan must belong to the selected facility' using errcode='23514'; end if;
  if tg_op='INSERT' then new.selected_by:=auth.uid(); new.selected_at:=now(); end if;
  return new;
end $$;
revoke all on function app_private.guard_training_kit_selection() from public,anon,authenticated,service_role;
create trigger guard_training_kit_selection before insert or update on public.training_starter_kit_selections for each row execute function app_private.guard_training_kit_selection();

create function public.save_training_starter_kit(p_id uuid default null,p_revision integer default null,p_name text default null,p_description text default '',p_items jsonb default '[]',p_is_published boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_kit public.training_starter_kits;
begin
  if p_id is null then
    insert into public.training_starter_kits(name,description,items,is_published) values(p_name,coalesce(p_description,''),p_items,p_is_published) returning * into v_kit;
  else
    update public.training_starter_kits set name=p_name,description=coalesce(p_description,''),items=p_items,is_published=p_is_published
      where id=p_id and revision=p_revision returning * into v_kit;
    if not found then raise exception 'Starter kit changed or is unavailable; refresh before saving' using errcode='40001'; end if;
  end if;
  return to_jsonb(v_kit);
end $$;
create function public.select_training_starter_kit(p_facility_id uuid,p_kit_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_org uuid;
begin
  if auth.uid() is null or not public.current_session_unlocked() then raise exception 'Current unlocked session required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('workforce_admin');
  select organization_id into v_org from public.facilities where id=p_facility_id;
  if v_org is null then raise exception 'Training manager access required' using errcode='42501'; end if;
  insert into public.training_starter_kit_selections(organization_id,facility_id,kit_id) values(v_org,p_facility_id,p_kit_id)
    on conflict(facility_id,kit_id) where copied_plan_id is null do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.training_starter_kit_selections where facility_id=p_facility_id and kit_id=p_kit_id and copied_plan_id is null; end if;
  if v_id is null then raise exception 'Training manager access required' using errcode='42501'; end if;
  return v_id;
end $$;
create function public.copy_training_starter_kit(p_selection_id uuid,p_revision integer,p_training_year integer,p_due_date date,p_name text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_selection public.training_starter_kit_selections; v_kit public.training_starter_kits; v_plan uuid;
begin
  if auth.uid() is null or not public.current_session_unlocked() then raise exception 'Current unlocked session required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('workforce_admin');
  select * into v_selection from public.training_starter_kit_selections where id=p_selection_id for update;
  if not found then raise exception 'Training manager access required' using errcode='42501'; end if;
  if v_selection.copied_plan_id is not null then return v_selection.copied_plan_id; end if;
  select * into v_kit from public.training_starter_kits where id=v_selection.kit_id and is_published;
  if not found or v_kit.revision is distinct from p_revision then raise exception 'Starter kit changed; review the current courses before copying' using errcode='40001'; end if;
  if p_due_date is null or p_due_date<public.pa_today() or p_training_year is null or p_training_year not between 1990 and 2200 or length(btrim(coalesce(p_name,''))) not between 2 and 160 then
    raise exception 'Enter a plan name, training year and completion deadline today or later' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(v_kit.items) item left join public.courses c on c.id::text=item->>'course_id'
    left join public.course_versions cv on cv.id=c.current_version_id and cv.course_id=c.id
    where c.id is null or c.organization_id is not null or c.status<>'published' or cv.status is distinct from 'published' or (cv.ai_generated and cv.ai_reviewed_at is null)) then
    raise exception 'A kit course is unavailable; ask the owner to update this kit' using errcode='23514'; end if;
  insert into public.training_plans(organization_id,facility_id,training_year,due_date,name,description,created_by)
    values(v_selection.organization_id,v_selection.facility_id,p_training_year,p_due_date,btrim(p_name),v_kit.description,auth.uid()) returning id into v_plan;
  insert into public.training_plan_items(training_plan_id,course_id,is_required,sort_order)
    select v_plan,(item->>'course_id')::uuid,(item->>'is_required')::boolean,ordinality::integer-1 from jsonb_array_elements(v_kit.items) with ordinality items(item,ordinality);
  update public.training_starter_kit_selections set copied_plan_id=v_plan,copied_revision=v_kit.revision where id=v_selection.id;
  return v_plan;
end $$;

create function app_private.guard_training_assignment_rule()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or not public.current_session_unlocked() then raise exception 'Current unlocked session required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('workforce_admin');
  if not exists(select 1 from public.training_plans p where p.id=new.training_plan_id and p.organization_id=new.organization_id and p.facility_id=new.facility_id) then
    raise exception 'Assignment rule must belong to its facility plan' using errcode='23514'; end if;
  if tg_op='UPDATE' and (new.training_plan_id,new.organization_id,new.facility_id) is distinct from (old.training_plan_id,old.organization_id,old.facility_id) then
    raise exception 'Assignment rule scope cannot be changed' using errcode='55000'; end if;
  new.job_title:=nullif(btrim(new.job_title),''); new.department:=nullif(btrim(new.department),'');
  new.updated_at:=now(); new.updated_by:=auth.uid(); new.revision:=case when tg_op='UPDATE' then old.revision+1 else 1 end;
  return new;
end $$;
revoke all on function app_private.guard_training_assignment_rule() from public,anon,authenticated,service_role;
create trigger guard_training_assignment_rule before insert or update on public.training_plan_assignment_rules for each row execute function app_private.guard_training_assignment_rule();
create function public.save_training_assignment_rule(p_plan_id uuid,p_job_title text,p_department text,p_is_enabled boolean,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_plan public.training_plans; v_rule public.training_plan_assignment_rules;
begin
  select * into v_plan from public.training_plans where id=p_plan_id for no key update;
  if not found or v_plan.facility_id is null then raise exception 'Choose an authorized facility learning plan' using errcode='42501'; end if;
  if exists(select 1 from public.training_plan_assignment_rules where training_plan_id=p_plan_id) then
    update public.training_plan_assignment_rules set job_title=p_job_title,department=p_department,is_enabled=p_is_enabled,automatic_enabled=false,approved_snapshot=null
      where training_plan_id=p_plan_id and revision=p_revision returning * into v_rule;
    if not found then raise exception 'Assignment rule changed; refresh before saving' using errcode='40001'; end if;
  else
    insert into public.training_plan_assignment_rules(training_plan_id,organization_id,facility_id,job_title,department,is_enabled)
      values(p_plan_id,v_plan.organization_id,v_plan.facility_id,p_job_title,p_department,p_is_enabled) returning * into v_rule;
  end if;
  return to_jsonb(v_rule);
end $$;
create function public.preview_training_assignment_rule(p_plan_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_plan public.training_plans; v_rule public.training_plan_assignment_rules; v_courses jsonb; v_staff jsonb; v_fingerprint text;
begin
  if auth.uid() is null or not public.current_session_unlocked() then raise exception 'Current unlocked session required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('workforce_admin');
  select * into v_rule from public.training_plan_assignment_rules where training_plan_id=p_plan_id;
  if not found then raise exception 'Save a rule for an authorized plan before previewing' using errcode='42501'; end if;
  select * into v_plan from public.training_plans where id=p_plan_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'course_id',c.id,'title',c.title,'is_required',i.is_required,'version_id',c.current_version_id,
    'available',c.status='published' and cv.status='published' and (not cv.ai_generated or cv.ai_reviewed_at is not null)) order by i.sort_order,i.id),'[]') into v_courses
    from public.training_plan_items i join public.courses c on c.id=i.course_id left join public.course_versions cv on cv.id=c.current_version_id and cv.course_id=c.id where i.training_plan_id=p_plan_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'first_name',e.first_name,'last_name',e.last_name,'job_title',e.job_title,'department',e.department,
    'already_enrolled',exists(select 1 from public.training_plan_enrollments n where n.training_plan_id=p_plan_id and n.employee_id=e.id),
    'existing_assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'course_id',a.course_id,'status',a.status,'due_date',a.due_date,'plan_id',a.training_plan_id) order by a.id)
      from public.course_assignments a where a.employee_id=e.id and a.status<>'canceled' and exists(select 1 from public.training_plan_items i where i.training_plan_id=p_plan_id and i.course_id=a.course_id)),'[]')) order by e.last_name,e.first_name,e.id),'[]') into v_staff
    from public.employees e where e.facility_id=v_rule.facility_id and e.organization_id=v_rule.organization_id and e.status='active' and v_rule.is_enabled
      and (v_rule.job_title is null or lower(btrim(e.job_title))=lower(v_rule.job_title)) and (v_rule.department is null or lower(btrim(e.department))=lower(v_rule.department));
  v_fingerprint:=md5(jsonb_build_array(v_rule.revision,v_plan.due_date,v_plan.training_year,v_courses,v_staff)::text);
  return jsonb_build_object('fingerprint',v_fingerprint,
    'automatic_fingerprint',md5(jsonb_build_array(v_rule.job_title,v_rule.department,v_rule.is_enabled,v_plan.due_date,v_plan.training_year,v_courses)::text),
    'due_date',v_plan.due_date,'training_year',v_plan.training_year,'courses',v_courses,'employees',v_staff,
    'can_apply',v_rule.is_enabled and v_plan.due_date>=public.pa_today() and jsonb_array_length(v_courses)>0 and not exists(select 1 from jsonb_array_elements(v_courses) c where c->>'available' is distinct from 'true'));
end $$;
create function public.apply_training_assignment_rule(p_plan_id uuid,p_fingerprint text,p_employee_ids uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_preview jsonb; v_employee uuid; v_result jsonb; v_results jsonb:='[]';
begin
  -- Match the normal plan-application lock order; a course edit, date edit, rule
  -- edit or staff/assignment change invalidates the review before any writes.
  perform 1 from public.training_plans where id=p_plan_id for no key update;
  perform 1 from public.training_plan_assignment_rules where training_plan_id=p_plan_id for update;
  if p_employee_ids is null or cardinality(p_employee_ids) not between 1 and 100 or array_position(p_employee_ids,null) is not null then
    raise exception 'Select between 1 and 100 employees to review and apply' using errcode='22023'; end if;
  for v_employee in select distinct value from unnest(p_employee_ids) value order by value loop
    perform public.assert_yearly_training_plan_employee(p_plan_id,v_employee);
  end loop;
  v_preview:=public.preview_training_assignment_rule(p_plan_id);
  if v_preview->>'fingerprint' is distinct from p_fingerprint then raise exception 'Plan, rule or employee assignments changed; refresh the preview' using errcode='40001'; end if;
  if not (v_preview->>'can_apply')::boolean then raise exception 'Enable the rule and review published courses with a completion deadline today or later' using errcode='22023'; end if;
  for v_employee in select distinct value from unnest(p_employee_ids) value order by value loop
    if not exists(select 1 from jsonb_array_elements(v_preview->'employees') e where e->>'id'=v_employee::text) then
      raise exception 'Every selected employee must still match the facility rule' using errcode='42501'; end if;
    -- Assistance fills missing enrollments only. Reconciliation of an existing
    -- plan remains the separate, explicitly reviewed Apply Plan workflow.
    if exists(select 1 from public.training_plan_enrollments where training_plan_id=p_plan_id and employee_id=v_employee) then
      v_result:=jsonb_build_object('already_enrolled',true,'assigned',0);
    else
      v_result:=public.apply_yearly_training_plan(p_plan_id,v_employee);
      if exists(select 1 from public.course_assignments a join jsonb_array_elements(v_preview->'courses') c on c->>'course_id'=a.course_id::text
        where a.employee_id=v_employee and a.training_plan_id=p_plan_id and a.status in ('assigned','in_progress','overdue','paused') and a.course_version_id::text is distinct from c->>'version_id') then
        raise exception 'A published course version changed during assignment; refresh the preview' using errcode='40001'; end if;
    end if;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('employee_id',v_employee,'result',v_result));
  end loop;
  return v_results;
end $$;

revoke all on function public.save_training_starter_kit(uuid,integer,text,text,jsonb,boolean),public.select_training_starter_kit(uuid,uuid),public.copy_training_starter_kit(uuid,integer,integer,date,text),public.save_training_assignment_rule(uuid,text,text,boolean,integer),public.preview_training_assignment_rule(uuid),public.apply_training_assignment_rule(uuid,text,uuid[]) from public,anon;
grant execute on function public.save_training_starter_kit(uuid,integer,text,text,jsonb,boolean),public.select_training_starter_kit(uuid,uuid),public.copy_training_starter_kit(uuid,integer,integer,date,text),public.save_training_assignment_rule(uuid,text,text,boolean,integer),public.preview_training_assignment_rule(uuid),public.apply_training_assignment_rule(uuid,text,uuid[]) to authenticated;
comment on table public.training_starter_kits is 'Owner-reviewed global course bundles. No deadline defaults or automatic compliance claims.';
comment on table public.training_plan_assignment_rules is 'Exact job-title/department matching assistance. Staff must be reviewed and explicitly selected; existing plan enrollments and individual deadlines are preserved.';

create function public.approve_training_assignment_automation(p_plan_id uuid,p_fingerprint text,p_enabled boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare v_preview jsonb;
begin
  perform 1 from public.training_plans where id=p_plan_id for no key update;
  perform 1 from public.training_plan_assignment_rules where training_plan_id=p_plan_id for update;
  v_preview:=public.preview_training_assignment_rule(p_plan_id);
  if p_enabled and (v_preview->>'fingerprint' is distinct from p_fingerprint or not (v_preview->>'can_apply')::boolean) then
    raise exception 'Refresh and review a current plan with a completion deadline today or later before enabling automation' using errcode='40001'; end if;
  update public.training_plan_assignment_rules set automatic_enabled=p_enabled,
    approved_snapshot=case when p_enabled then v_preview->>'automatic_fingerprint' else null end where training_plan_id=p_plan_id;
end $$;
revoke all on function public.approve_training_assignment_automation(uuid,text,boolean) from public,anon;
grant execute on function public.approve_training_assignment_automation(uuid,text,boolean) to authenticated;

-- This is deliberately an invoker trigger: only a current, authorized manager
-- can apply approved rules while saving staff. Service/HR imports and stale
-- approvals remain visible as unassigned matching staff in the review screen.
create function app_private.apply_approved_training_staff_rules()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_rule public.training_plan_assignment_rules; v_current public.training_plan_assignment_rules;
  v_plan public.training_plans; v_courses jsonb; v_snapshot text; v_application jsonb;
begin
  if auth.uid() is null or not public.current_session_unlocked() or new.status<>'active' then return new; end if;
  for v_rule in select * from public.training_plan_assignment_rules r where r.facility_id=new.facility_id and r.organization_id=new.organization_id
    and r.is_enabled and r.automatic_enabled and (r.job_title is null or lower(btrim(new.job_title))=lower(r.job_title))
    and (r.department is null or lower(btrim(new.department))=lower(r.department)) order by r.training_plan_id
  loop
    begin
      -- A staff edit already holds its employee lock. Never wait in the reverse
      -- order of a concurrent manual plan application; that staff stays pending.
      select * into v_plan from public.training_plans where id=v_rule.training_plan_id for no key update nowait;
      select * into v_current from public.training_plan_assignment_rules where training_plan_id=v_rule.training_plan_id for share nowait;
      if not found or not v_current.is_enabled or not v_current.automatic_enabled or v_plan.due_date<public.pa_today()
        or (v_current.job_title is not null and lower(btrim(new.job_title)) is distinct from lower(v_current.job_title))
        or (v_current.department is not null and lower(btrim(new.department)) is distinct from lower(v_current.department)) then continue; end if;
      if exists(select 1 from public.training_plan_enrollments where training_plan_id=v_rule.training_plan_id and employee_id=new.id) then continue; end if;
      if exists(select 1 from public.course_assignments a join public.training_plan_items i on i.course_id=a.course_id
        where i.training_plan_id=v_rule.training_plan_id and a.employee_id=new.id and a.status in ('assigned','in_progress','overdue','paused')
          and a.training_plan_id is distinct from v_rule.training_plan_id) then
        -- A manager must review an existing individual/other-plan assignment.
        -- Keep the whole match pending rather than silently enrolling a partial
        -- bundle whose conflicts were never presented to the administrator.
        continue;
      end if;
      -- Recheck only this plan's approved curriculum. Building the full roster
      -- preview on every imported employee would turn bulk onboarding quadratic.
      select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'course_id',c.id,'title',c.title,'is_required',i.is_required,'version_id',c.current_version_id,
        'available',c.status='published' and cv.status='published' and (not cv.ai_generated or cv.ai_reviewed_at is not null)) order by i.sort_order,i.id),'[]') into v_courses
        from public.training_plan_items i join public.courses c on c.id=i.course_id left join public.course_versions cv on cv.id=c.current_version_id and cv.course_id=c.id where i.training_plan_id=v_rule.training_plan_id;
      v_snapshot:=md5(jsonb_build_array(v_current.job_title,v_current.department,v_current.is_enabled,v_plan.due_date,v_plan.training_year,v_courses)::text);
      if v_snapshot=v_current.approved_snapshot and jsonb_array_length(v_courses)>0
        and not exists(select 1 from jsonb_array_elements(v_courses) c where c->>'available' is distinct from 'true') then
        v_application:=public.apply_yearly_training_plan(v_rule.training_plan_id,new.id);
        if jsonb_array_length(v_application->'conflicts')>0 then
          raise exception 'An existing assignment requires manager review' using errcode='40001'; end if;
        -- A publisher can advance a global course without editing this plan.
        -- If that race occurs during application, roll back this employee's
        -- application instead of assigning a version the manager never approved.
        if exists(select 1 from public.course_assignments a join jsonb_array_elements(v_courses) c on c->>'course_id'=a.course_id::text
          where a.employee_id=new.id and a.training_plan_id=v_rule.training_plan_id and a.status in ('assigned','in_progress','overdue','paused') and a.course_version_id::text is distinct from c->>'version_id') then
          raise exception 'A published course version changed during automatic assignment' using errcode='40001'; end if;
      end if;
    exception when insufficient_privilege or check_violation or lock_not_available or serialization_failure or invalid_parameter_value then
      -- The saved staff member remains a pending match. No assignment is partly
      -- applied because the exception block rolls back its entire application.
      null;
    end;
  end loop;
  return new;
end $$;
revoke all on function app_private.apply_approved_training_staff_rules() from public,anon,authenticated,service_role;
create trigger apply_approved_training_staff_rules after insert or update of job_title,department,facility_id,status on public.employees
for each row execute function app_private.apply_approved_training_staff_rules();

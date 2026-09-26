-- Training-owned welcome, observed practice and learner-submitted outside evidence.
-- Private rows can only be reached through the current-session, facility-scoped command.
create table app_private.training_facility_welcome (
  facility_id uuid primary key references public.facilities(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  welcome_message text not null default '' check(length(welcome_message)<=2000),
  contact_name text not null default '' check(length(contact_name)<=160),
  contact_email text not null default '' check(length(contact_email)<=254 and (contact_email='' or contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
create index training_welcome_org_idx on app_private.training_facility_welcome(organization_id);
create index training_welcome_actor_idx on app_private.training_facility_welcome(updated_by);
create table app_private.training_practice_templates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  title text not null check(length(btrim(title)) between 3 and 160),
  instructions text not null default '' check(length(instructions)<=3000),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 30),
  archived boolean not null default false, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index training_practice_template_facility_idx on app_private.training_practice_templates(facility_id,created_at);
create index training_practice_template_org_idx on app_private.training_practice_templates(organization_id);
create index training_practice_template_actor_idx on app_private.training_practice_templates(created_by);
create table app_private.training_practice_observations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  employee_id uuid not null references public.employees(id), template_id uuid not null references app_private.training_practice_templates(id),
  title_snapshot text not null, employee_name_snapshot text not null, evaluator_name_snapshot text not null,
  items_snapshot jsonb not null, observed_on date not null, notes text not null check(length(btrim(notes)) between 10 and 3000),
  result text not null check(result in ('demonstrated','needs_practice')),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  voided_by uuid references public.profiles(id), voided_at timestamptz, void_reason text,
  check((voided_by is null)=(voided_at is null)), check(voided_at is null or coalesce(length(btrim(void_reason)) between 10 and 2000,false))
);
create index training_practice_observation_scope_idx on app_private.training_practice_observations(facility_id,employee_id,created_at);
create index training_practice_observation_org_idx on app_private.training_practice_observations(organization_id);
create index training_practice_observation_employee_idx on app_private.training_practice_observations(employee_id);
create index training_practice_observation_template_idx on app_private.training_practice_observations(template_id);
create index training_practice_observation_actor_idx on app_private.training_practice_observations(created_by);
create index training_practice_observation_void_actor_idx on app_private.training_practice_observations(voided_by);
revoke all on app_private.training_facility_welcome,app_private.training_practice_templates,app_private.training_practice_observations from public,anon,authenticated,service_role;
create trigger audit_log after insert or update or delete on app_private.training_facility_welcome for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on app_private.training_practice_templates for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on app_private.training_practice_observations for each row execute function public.audit_log_trigger();

insert into app_private.audit_entity_manifest(table_schema,table_name,audit_mode,contains_regulated_data,rationale) values
('app_private','training_facility_welcome','row_trigger',false,'Facility training welcome and support contact changes retain actor history.'),
('app_private','training_practice_templates','row_trigger',false,'Facility practice checklist authoring and retirement retain actor history.'),
('app_private','training_practice_observations','row_trigger',true,'Signed practice observations and correction reasons preserve dated snapshots.');

-- Document metadata also grants Storage read access. Registering an external
-- upload must therefore prove ownership of the actual object, not a client-sent
-- employee ID or uploaded_by_profile_id. A private lookup avoids the circular
-- Storage -> document -> Storage RLS dependency. Existing metadata is not proof
-- of provenance; learner submission independently checks the object below.
create function app_private.owns_training_external_upload(p_org uuid,p_facility uuid,p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and p_bucket='external-uploads'
    and split_part(p_path,'/',1)=p_org::text and split_part(p_path,'/',2)=p_facility::text
    and nullif(split_part(p_path,'/',3),'') is not null
    and exists(select 1 from storage.objects o where o.bucket_id=p_bucket and o.name=p_path and o.owner_id=auth.uid()::text);
$$;
revoke all on function app_private.owns_training_external_upload(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function app_private.owns_training_external_upload(uuid,uuid,text,text) to authenticated;
create policy training_external_document_upload_owner on public.training_documents as restrictive for insert to authenticated
  with check(storage_bucket<>'external-uploads' or app_private.owns_training_external_upload(organization_id,facility_id,storage_bucket,storage_path));

create function public.training_experience(p_action text,p_facility_id uuid default null,p_employee_id uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_org uuid; v_facility uuid := p_facility_id; v_employee public.employees; v_self boolean; v_manager boolean; v_reader boolean;
  v_template app_private.training_practice_templates; v_item jsonb; v_items jsonb := '[]'; v_id uuid; v_doc public.training_documents;
  v_result text; v_event public.training_evidence_events; v_offset integer; v_today date := (now() at time zone 'America/New_York')::date;
begin
  if auth.uid() is null or not public.current_session_unlocked() or not app_private.has_product_module('modules.train')
    or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then
    raise exception 'Active Training access required' using errcode='42501'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or length(p_data::text)>30000 then
    raise exception 'Invalid training request' using errcode='22023'; end if;
  if p_employee_id is not null then select * into v_employee from public.employees where id=p_employee_id;
  elsif p_facility_id is null then select * into v_employee from public.employees where profile_id=auth.uid(); end if;
  v_self := coalesce(v_employee.profile_id=auth.uid() and v_employee.organization_id=public.current_org_id() and v_employee.status='active',false);
  v_facility := coalesce(v_facility,v_employee.facility_id);
  select organization_id into v_org from public.facilities where id=v_facility and is_active;
  if v_org is null or not exists(select 1 from public.organizations where id=v_org and subscription_status not in ('suspended','canceled'))
    or (p_employee_id is not null and (v_employee.id is null or v_employee.facility_id<>v_facility or v_employee.organization_id<>v_org)) then
    raise exception 'Training facility or student unavailable' using errcode='42501'; end if;
  v_manager := app_private.can_manage_training_plan(v_org,v_facility);
  v_reader := app_private.can_read_train_scope(v_org,v_facility,null) and public.current_role() in ('platform_admin','org_admin','facility_manager','trainer','auditor');
  if not v_reader and not (v_self and v_employee.facility_id=v_facility) then
    raise exception 'Training facility access required' using errcode='42501'; end if;

  if v_reader then perform public.assert_identity_assurance('compliance_profile_admin'); end if;
  if p_action='welcome' then
    return jsonb_build_object('facility_id',v_facility,'facility_name',(select name from public.facilities where id=v_facility),
      'organization_id',v_org,'organization_name',(select name from public.organizations where id=v_org),
      'logo_path',(select branding_logo_path from public.organization_settings where organization_id=v_org),
      'welcome',coalesce((select to_jsonb(w) from app_private.training_facility_welcome w where facility_id=v_facility),'{}'),
      'setup',case when v_manager then jsonb_build_object(
        'staff',(select count(*) from public.employees where facility_id=v_facility and status='active'),
        'portal_ready',(select count(*) from public.employees where facility_id=v_facility and status='active' and profile_id is not null),
        'plans',(select count(*) from public.training_plans where facility_id=v_facility),
        'assigned',(select count(*) from public.course_assignments a join public.employees e on e.id=a.employee_id where e.facility_id=v_facility)
      ) else null end);
  elsif p_action='records' then
    v_offset := greatest(0,coalesce((p_data->>'offset')::integer,0));
    return jsonb_build_object('templates',coalesce((select jsonb_agg(to_jsonb(t) order by t.title) from app_private.training_practice_templates t where t.facility_id=v_facility),'[]'),
      'submission_document_ids',case when v_self and v_offset=0 then coalesce((select jsonb_agg(d.id order by d.created_at desc,d.id)
        from public.training_documents d where d.employee_id=v_employee.id and d.organization_id=v_org and d.facility_id=v_facility
        and d.document_type in ('external_certificate','transcript')
        and app_private.owns_training_external_upload(d.organization_id,d.facility_id,d.storage_bucket,d.storage_path)),'[]') else '[]'::jsonb end,
      'observations',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc,o.id) from
        (select * from app_private.training_practice_observations where facility_id=v_facility
        and (case when v_reader then p_employee_id is null or employee_id=p_employee_id else employee_id=v_employee.id end)
        order by created_at desc,id limit 500 offset v_offset)o),'[]'),
      'external',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id) from
        (select e.*, concat_ws(' ',s.first_name,s.last_name) as employee_name from public.training_evidence_events e join public.employees s on s.id=e.employee_id
        where e.facility_id=v_facility and e.source_reference like 'learner-submission:%'
        and (case when v_reader then p_employee_id is null or e.employee_id=p_employee_id else e.employee_id=v_employee.id end)
        order by e.created_at desc,e.id limit 500 offset v_offset)e),'[]'));
  end if;

  -- Re-read under the same staff lock used by lifecycle updates. A concurrent
  -- move or termination must finish before the mutation's scope is accepted.
  if p_action in ('submit_external','observe') then
    select * into v_employee from public.employees where id=v_employee.id for no key update;
    if v_employee.id is null or v_employee.organization_id<>v_org or v_employee.facility_id<>v_facility or v_employee.status<>'active' then
      raise exception 'Active student in this facility required' using errcode='42501'; end if;
    v_self := coalesce(v_employee.profile_id=auth.uid() and v_employee.organization_id=public.current_org_id(),false);
  end if;
  if p_action='submit_external' then
    if not v_self then raise exception 'Submit evidence for your own active student account' using errcode='42501'; end if;
    select * into v_doc from public.training_documents where id=(p_data->>'document_id')::uuid and employee_id=v_employee.id
      and organization_id=v_org and facility_id=v_facility and storage_bucket='external-uploads' and document_type in ('external_certificate','transcript') for share;
    if not found then
      raise exception 'Upload your certificate or transcript before submitting' using errcode='22023'; end if;
    -- Keep both metadata and the actual object stable until the evidence row is
    -- inserted and its immutability guards become effective. Legacy metadata can
    -- name another person's object, even with a forged uploaded_by_profile_id.
    perform 1 from storage.objects where bucket_id=v_doc.storage_bucket and name=v_doc.storage_path
      and owner_id=auth.uid()::text and split_part(name,'/',1)=v_org::text and split_part(name,'/',2)=v_facility::text
      and nullif(split_part(name,'/',3),'') is not null for share;
    if not found then raise exception 'Upload your own copy of the certificate or transcript before submitting; files uploaded by someone else cannot be submitted from your account' using errcode='42501'; end if;
    if nullif(p_data->>'completed_on','') is null or (p_data->>'completed_on')::date>v_today then
      raise exception 'Enter the actual completion date, today or earlier' using errcode='22023'; end if;
    insert into public.training_evidence_events(organization_id,facility_id,employee_id,title,completed_on,minutes,delivery,provider,source_reference,evidence_document_id,created_by)
    values(v_org,v_facility,v_employee.id,btrim(p_data->>'title'),(p_data->>'completed_on')::date,(p_data->>'minutes')::integer,'external',btrim(p_data->>'provider'),
      'learner-submission:'||v_doc.id::text,v_doc.id,auth.uid())
    on conflict(employee_id,source_reference) do nothing returning id into v_id;
    if v_id is null then
      select * into v_event from public.training_evidence_events where employee_id=v_employee.id and source_reference='learner-submission:'||v_doc.id::text;
      if v_event.title is distinct from btrim(p_data->>'title') or v_event.provider is distinct from btrim(p_data->>'provider')
        or v_event.completed_on is distinct from (p_data->>'completed_on')::date or v_event.minutes is distinct from (p_data->>'minutes')::integer then
        raise exception 'This evidence was already submitted with different details; upload a correction separately' using errcode='22023'; end if;
      v_id:=v_event.id;
    end if;
    return jsonb_build_object('id',v_id);
  end if;
  if not v_manager then raise exception 'Training administrator access required' using errcode='42501'; end if;
  perform public.assert_identity_assurance('compliance_profile_admin');
  if p_action='save_welcome' then
    insert into app_private.training_facility_welcome(facility_id,organization_id,welcome_message,contact_name,contact_email,updated_by)
      values(v_facility,v_org,btrim(coalesce(p_data->>'welcome_message','')),btrim(coalesce(p_data->>'contact_name','')),btrim(coalesce(p_data->>'contact_email','')),auth.uid())
    on conflict(facility_id) do update set welcome_message=excluded.welcome_message,contact_name=excluded.contact_name,
      contact_email=excluded.contact_email,updated_by=auth.uid(),updated_at=now();
    return jsonb_build_object('saved',true);
  elsif p_action='save_template' then
    if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 30 then
      raise exception 'Enter 1 to 30 observable steps' using errcode='22023'; end if;
    for v_item in select value from jsonb_array_elements(p_data->'items') loop
      if jsonb_typeof(v_item)<>'string' or length(btrim(v_item#>>'{}')) not between 3 and 300 then
        raise exception 'Each step must contain 3 to 300 characters' using errcode='22023'; end if;
    end loop;
    insert into app_private.training_practice_templates(organization_id,facility_id,title,instructions,items,created_by)
      values(v_org,v_facility,btrim(p_data->>'title'),coalesce(p_data->>'instructions',''),p_data->'items',auth.uid()) returning id into v_id;
  elsif p_action='archive_template' then
    update app_private.training_practice_templates set archived=true where id=(p_data->>'id')::uuid and facility_id=v_facility returning id into v_id;
    if v_id is null then raise exception 'Template unavailable' using errcode='42501'; end if;
  elsif p_action='observe' then
    if v_employee.id is null or v_employee.status<>'active' or v_employee.profile_id=auth.uid() then
      raise exception 'Choose an active student other than yourself' using errcode='22023'; end if;
    select * into v_template from app_private.training_practice_templates where id=(p_data->>'template_id')::uuid and facility_id=v_facility and not archived for share;
    if not found then raise exception 'Active practice checklist required' using errcode='42501'; end if;
    if coalesce((p_data->>'attested')::boolean,false)=false or nullif(p_data->>'observed_on','') is null or (p_data->>'observed_on')::date>v_today then
      raise exception 'Confirm personal observation and enter its actual date' using errcode='22023'; end if;
    if jsonb_typeof(p_data->'results') is distinct from 'array' or jsonb_array_length(p_data->'results')<>jsonb_array_length(v_template.items) then
      raise exception 'Assess every checklist step' using errcode='22023'; end if;
    v_result := 'demonstrated';
    for v_item in select jsonb_build_object('label',t.value#>>'{}','result',p_data->'results'->>(t.ordinality::integer-1)) from jsonb_array_elements(v_template.items) with ordinality t(value,ordinality) loop
      if v_item->>'result' is null or v_item->>'result' not in ('demonstrated','needs_practice','not_observed') then
        raise exception 'Assess every checklist step' using errcode='22023'; end if;
      if v_item->>'result'<>'demonstrated' then v_result:='needs_practice'; end if;
      v_items:=v_items||jsonb_build_array(v_item);
    end loop;
    insert into app_private.training_practice_observations(organization_id,facility_id,employee_id,template_id,title_snapshot,employee_name_snapshot,evaluator_name_snapshot,items_snapshot,observed_on,notes,result,created_by)
    values(v_org,v_facility,v_employee.id,v_template.id,v_template.title,concat_ws(' ',v_employee.first_name,v_employee.last_name),
      (select concat_ws(' ',first_name,last_name) from public.profiles where id=auth.uid()),v_items,(p_data->>'observed_on')::date,btrim(p_data->>'notes'),v_result,auth.uid()) returning id into v_id;
  elsif p_action='void_observation' then
    if coalesce(length(btrim(p_data->>'reason')),0) not between 10 and 2000 then
      raise exception 'Record a correction reason of 10 to 2000 characters' using errcode='22023'; end if;
    update app_private.training_practice_observations set voided_by=auth.uid(),voided_at=now(),void_reason=btrim(p_data->>'reason')
    where id=(p_data->>'id')::uuid and facility_id=v_facility and voided_at is null returning id into v_id;
    if v_id is null then raise exception 'Current observation unavailable' using errcode='42501'; end if;
  elsif p_action='review_external' then
    select * into v_event from public.training_evidence_events where id=(p_data->>'id')::uuid and facility_id=v_facility and source_reference like 'learner-submission:%' for update;
    if not found or v_event.created_by=auth.uid() then raise exception 'Another training administrator must review this evidence' using errcode='42501'; end if;
    return public.save_training_workspace_item('review',v_facility,v_event.employee_id,p_data);
  else raise exception 'Unknown training action' using errcode='22023'; end if;
  return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.training_experience(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.training_experience(text,uuid,uuid,jsonb) to authenticated;

-- A learner submission seals its supporting evidence even while review is pending.
-- Corrections use a new upload/submission; rejected or voided records retain the
-- original proof. Guards also cover the older public review command and trusted
-- service writes, rather than relying only on this screen's command boundary.
create function app_private.protect_learner_training_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.source_reference like 'learner-submission:%' then
    if tg_op='DELETE' then raise exception 'Submitted training evidence is retained; void it with a reason' using errcode='55000'; end if;
    if (to_jsonb(new)-array['status','reviewed_by','reviewed_at','review_note']) is distinct from
      (to_jsonb(old)-array['status','reviewed_by','reviewed_at','review_note']) then
      raise exception 'Submitted training evidence is immutable; submit a correction separately' using errcode='55000'; end if;
    if new.status is distinct from old.status or new.reviewed_by is distinct from old.reviewed_by then
      if auth.uid()=old.created_by or new.reviewed_by=old.created_by then
        raise exception 'Another training administrator must review this evidence' using errcode='42501'; end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function app_private.protect_learner_training_evidence() from public,anon,authenticated,service_role;
create trigger protect_learner_training_evidence before update or delete on public.training_evidence_events
  for each row execute function app_private.protect_learner_training_evidence();

create function app_private.protect_submitted_training_document() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.training_evidence_events e where e.evidence_document_id=old.id and e.source_reference like 'learner-submission:%') then
    raise exception 'This document supports submitted training evidence; upload a correction separately' using errcode='55000'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function app_private.protect_submitted_training_document() from public,anon,authenticated,service_role;
create trigger protect_submitted_training_document before update or delete on public.training_documents
  for each row execute function app_private.protect_submitted_training_document();

create function app_private.training_external_upload_is_sealed(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_bucket='external-uploads' and exists(select 1 from public.training_documents d
    join public.training_evidence_events e on e.evidence_document_id=d.id
    where d.storage_bucket=p_bucket and d.storage_path=p_path and e.source_reference like 'learner-submission:%');
$$;
revoke all on function app_private.training_external_upload_is_sealed(text,text) from public,anon;
grant execute on function app_private.training_external_upload_is_sealed(text,text) to authenticated;
create policy submitted_training_upload_no_overwrite on storage.objects as restrictive for update to authenticated
  using (not app_private.training_external_upload_is_sealed(bucket_id,name))
  with check (not app_private.training_external_upload_is_sealed(bucket_id,name));
create policy submitted_training_upload_no_delete on storage.objects as restrictive for delete to authenticated
  using (not app_private.training_external_upload_is_sealed(bucket_id,name));

create function app_private.protect_submitted_training_upload() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if app_private.training_external_upload_is_sealed(old.bucket_id,old.name) then
    if tg_op='DELETE' then raise exception 'Submitted training files cannot be removed' using errcode='55000'; end if;
    -- Storage may update access bookkeeping after reads. File versions, paths,
    -- owners and metadata identify the original proof and cannot be rewritten.
    -- path_tokens is a stored generated column derived from name. PostgreSQL
    -- computes NEW generated values after BEFORE triggers, so comparing it here
    -- would reject harmless bookkeeping updates. The source name stays sealed.
    if (to_jsonb(new)-array['last_accessed_at','updated_at','path_tokens']) is distinct from
      (to_jsonb(old)-array['last_accessed_at','updated_at','path_tokens']) then
      raise exception 'Submitted training files cannot be replaced or renamed' using errcode='55000'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function app_private.protect_submitted_training_upload() from public,anon,authenticated,service_role;
create trigger protect_submitted_training_upload before update or delete on storage.objects
  for each row execute function app_private.protect_submitted_training_upload();

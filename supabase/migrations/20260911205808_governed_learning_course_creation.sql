-- New global courses use the same native writer and durable authoring ledger.
-- A first draft has explicit creation provenance, never an invented source version.
alter table app_private.learning_authoring_drafts
  add column provenance_kind text not null default 'cloned_version',
  alter column source_version_id drop not null,
  add constraint learning_authoring_draft_provenance_check check(
    (provenance_kind='cloned_version' and source_version_id is not null)
    or (provenance_kind='new_course' and source_version_id is null and source_revision is null));

create function app_private.learning_course_has_creation_provenance(p_course uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_private.learning_authoring_drafts d
    join public.course_versions v on v.id=d.version_id join public.courses c on c.id=v.course_id
    where c.id=p_course and c.organization_id is null and v.organization_id is null and d.provenance_kind='new_course');
$$;

create function app_private.learning_creation_options(p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_more boolean;
begin
  if p_offset is null or p_offset not between 0 and 10000 then raise exception 'Invalid creation options page.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',name) order by name,id),'[]'::jsonb) into v_result
    from (select id,name from public.training_types where organization_id is null and is_active order by name,id offset p_offset limit 100) rows;
  if exists(select 1 from jsonb_array_elements(v_result) item where not app_private.learning_structure_text(item->'label',1,500,false)) then
    raise exception 'Training type label is not valid for governed creation.' using errcode='22023'; end if;
  select exists(select 1 from public.training_types where organization_id is null and is_active order by name,id offset (p_offset+100) limit 1) into v_more;
  return jsonb_build_object('trainingTypes',v_result,'nextOffset',case when v_more and p_offset+100<=10000 then p_offset+100 else null end);
end;
$$;

create function public.get_learning_creation_options(p_actor uuid,p_hub_user uuid,p_hub_session uuid,
  p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_offset integer,p_authentication_method text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.learning_creation_options(p_offset);
end;
$$;
create function public.get_native_learning_creation_options(p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.current_native_learning_authority();
  return app_private.learning_creation_options(p_offset);
end;
$$;

create function app_private.learning_creation_plan(p_course uuid,p_parameters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_version uuid; v_type public.training_types; v_course jsonb:=p_parameters->'course'; v_definition jsonb:=p_parameters->'version';
  v_before jsonb; v_after jsonb; v_id uuid;
begin
  if p_course is null or not coalesce(app_private.learning_structure_keys(p_parameters,array['versionId','course','version'],array['versionId','course','version']),false)
    or not coalesce(app_private.learning_structure_keys(v_course,array['title','description','category','estimatedDurationMinutes','trainingTypeId'],array['title','description','category','estimatedDurationMinutes','trainingTypeId']),false)
    or not coalesce(app_private.learning_structure_keys(v_definition,array['title','description'],array['title','description']),false)
    or app_private.learning_structure_bytes(p_parameters)>24576
    or jsonb_typeof(p_parameters->'versionId') is distinct from 'string'
    or coalesce(p_parameters->>'versionId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or not coalesce(app_private.learning_structure_text(v_course->'title',1,300,false),false)
    or not coalesce(app_private.learning_structure_text(v_definition->'title',1,300,false),false)
    or (v_course->'description'<>'null'::jsonb and not coalesce(app_private.learning_structure_text(v_course->'description',0,12000,true),false))
    or (v_definition->'description'<>'null'::jsonb and not coalesce(app_private.learning_structure_text(v_definition->'description',0,12000,true),false))
    or (v_course->'category'<>'null'::jsonb and not coalesce(app_private.learning_structure_text(v_course->'category',1,300,false),false))
    or (v_course->'estimatedDurationMinutes'<>'null'::jsonb and not coalesce(app_private.learning_structure_number(v_course->'estimatedDurationMinutes',1,1440),false))
    or (v_course->'trainingTypeId'<>'null'::jsonb and (jsonb_typeof(v_course->'trainingTypeId') is distinct from 'string'
      or coalesce(v_course->>'trainingTypeId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))
    or p_parameters::text ~* '([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_?token|refresh_?token|service_?role_?key|authorization|password|client_?secret|storage_?(path|bucket)|video_?url|playback_?(url|token)|signed_?url|api_?key|token|secret|secret_?key|signing_?secret)"[[:space:]]*:)' then
    raise exception 'Invalid governed course creation.' using errcode='22023';
  end if;
  v_version:=(p_parameters->>'versionId')::uuid;
  if v_version=p_course then raise exception 'Course and version identities must be distinct.' using errcode='22023'; end if;
  -- Consistent order also covers crossed course/version ID pairs in concurrent requests.
  for v_id in select x from unnest(array[p_course,v_version]) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended('learning-create:'||v_id::text,0));
  end loop;
  if exists(select 1 from public.courses where id in (p_course,v_version)) or exists(select 1 from public.course_versions where id in (p_course,v_version)) then
    raise exception 'Creation identities are already in use.' using errcode='40001'; end if;
  if v_course->'trainingTypeId'<>'null'::jsonb then
    select * into v_type from public.training_types where id=(v_course->>'trainingTypeId')::uuid for share;
    if not found or v_type.organization_id is not null or not v_type.is_active then
      raise exception 'Choose a current active global training type.' using errcode='40001'; end if;
  end if;
  v_before:=jsonb_build_object('courseId',p_course,'versionId',v_version,'exists',false);
  v_after:=jsonb_build_object('courseId',p_course,'versionId',v_version,'courseStatus','draft','status','draft',
    'versionNumber',1,'title',v_definition->>'title','currentVersionId',null,'aiReviewRequired',false,'contentStandard','comprehensive');
  return jsonb_build_object('before',v_before,'after',v_after,'stateDigest',encode(extensions.digest(
    jsonb_build_object('before',v_before,'parameters',p_parameters,'trainingType',to_jsonb(v_type))::text,'sha256'),'hex'));
end;
$$;

create function app_private.create_governed_learning_course_core(p_actor uuid,p_course uuid,p_parameters jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_course jsonb:=p_parameters->'course'; v_definition jsonb:=p_parameters->'version'; v_version uuid:=(p_parameters->>'versionId')::uuid;
begin
  perform app_private.learning_creation_plan(p_course,p_parameters);
  insert into public.courses(id,organization_id,title,description,category,status,estimated_duration_minutes,training_type_id,created_by,current_version_id)
    values(p_course,null,v_course->>'title',v_course->>'description',v_course->>'category','draft',
      (v_course->>'estimatedDurationMinutes')::integer,(v_course->>'trainingTypeId')::uuid,p_actor,null);
  insert into public.course_versions(id,course_id,organization_id,version_number,title,description,status,published_at,
    ai_generated,ai_reviewed_at,ai_reviewed_by,content_standard,version_label,credited_duration_rationale)
    values(v_version,p_course,null,1,v_definition->>'title',v_definition->>'description','draft',null,false,null,null,'comprehensive',null,null);
  insert into app_private.learning_authoring_drafts(version_id,source_version_id,source_revision,created_by,provenance_kind)
    values(v_version,null,null,p_actor,'new_course');
end;
$$;
revoke all on function app_private.learning_course_has_creation_provenance(uuid),app_private.learning_creation_options(integer),
  app_private.learning_creation_plan(uuid,jsonb),app_private.create_governed_learning_course_core(uuid,uuid,jsonb),
  public.get_learning_creation_options(uuid,uuid,uuid,timestamptz,timestamptz,integer,text),public.get_native_learning_creation_options(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_learning_creation_options(uuid,uuid,uuid,timestamptz,timestamptz,integer,text) to service_role;
grant execute on function public.get_native_learning_creation_options(integer) to authenticated;

create function app_private.learning_creation_status(p_actor uuid,p_principal uuid,p_course uuid,p_version uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_id uuid;
begin
  if p_course is null or p_version is null or p_request is null or p_actor is null or p_principal is null then
    raise exception 'Creation recovery identities required.' using errcode='22023'; end if;
  for v_id in select x from unnest(array[p_course,p_version]) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended('learning-create:'||v_id::text,0));
  end loop;
  -- Current authority is verified by the wrapper; original session expiry does
  -- not erase an immutable creation receipt belonging to that same principal.
  select * into v_row from app_private.platform_admin_commands where actor_profile_id=p_actor and hub_user_id=p_principal
    and action='learning.createCourse' and target_id=p_course and request_id=p_request
    and lower(parameters->>'versionId')=p_version::text and applied_at is not null
    order by applied_at,id limit 1;
  if found then return jsonb_build_object('status','applied','result',v_row.result); end if;
  if exists(select 1 from public.courses where id in(p_course,p_version)) or exists(select 1 from public.course_versions where id in(p_course,p_version)) then
    raise exception 'Creation identities exist without the matching receipt.' using errcode='40001'; end if;
  return jsonb_build_object('status','absent','result',null);
end;
$$;
create function public.get_learning_creation_status(p_actor uuid,p_hub_user uuid,p_hub_session uuid,
  p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_course_id uuid,p_version_id uuid,p_request_id uuid,p_authentication_method text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.learning_creation_status(p_actor,p_hub_user,p_course_id,p_version_id,p_request_id);
end;
$$;
create function public.get_native_learning_creation_status(p_course_id uuid,p_version_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_authority jsonb;
begin
  v_authority:=app_private.current_native_learning_authority();
  return app_private.learning_creation_status((v_authority->>'actorId')::uuid,(v_authority->>'actorId')::uuid,p_course_id,p_version_id,p_request_id);
end;
$$;
revoke all on function app_private.learning_creation_status(uuid,uuid,uuid,uuid,uuid),
  public.get_learning_creation_status(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,uuid,text),public.get_native_learning_creation_status(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_learning_creation_status(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,uuid,text) to service_role;
grant execute on function public.get_native_learning_creation_status(uuid,uuid,uuid) to authenticated;

-- Reuse the reviewed existing authorization, replay and business-rule bodies.
alter table app_private.platform_admin_commands drop constraint platform_admin_commands_action_check;
alter table app_private.platform_admin_commands add constraint platform_admin_commands_action_check check(action in ('users.setActive','organizations.setSuspension','billing.setAccessOverride','learning.cloneVersion','learning.publishVersion','learning.patchDraft','learning.reviewDraft','learning.editStructure','learning.createCourse'));

create or replace function app_private.learning_draft_plan(p_action text,p_course uuid,p_parameters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_version public.course_versions; v_course public.courses; v_revision text; v_before jsonb; v_after jsonb;
begin
  if p_action='learning.createCourse' then return app_private.learning_creation_plan(p_course,p_parameters); end if;
  if p_action is null or p_action not in ('learning.patchDraft','learning.reviewDraft','learning.editStructure') or p_parameters is null
    or jsonb_typeof(p_parameters)<>'object' or not(p_parameters ?& array['versionId','sourceRevision'])
    or jsonb_typeof(p_parameters->'versionId') is distinct from 'string' or jsonb_typeof(p_parameters->'sourceRevision') is distinct from 'string'
    or coalesce(p_parameters->>'versionId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or coalesce(p_parameters->>'sourceRevision','') !~ '^[0-9a-f]{64}$'
    or (p_action='learning.patchDraft' and (not(p_parameters ? 'patch') or p_parameters-array['versionId','sourceRevision','patch']<>'{}'::jsonb))
    or (p_action='learning.editStructure' and (not(p_parameters ? 'changes') or p_parameters-array['versionId','sourceRevision','changes']<>'{}'::jsonb))
    or (p_action='learning.reviewDraft' and (p_parameters->'reviewed' is distinct from 'true'::jsonb or p_parameters-array['versionId','sourceRevision','reviewed']<>'{}'::jsonb)) then
    raise exception 'Invalid governed draft operation.' using errcode='22023';
  end if;
  perform app_private.lock_learning_authoring_source(p_course,(p_parameters->>'versionId')::uuid);
  select * into v_version from public.course_versions where id=(p_parameters->>'versionId')::uuid;
  select * into v_course from public.courses where id=p_course;
  if v_version.status<>'draft' or not (v_course.status='published' or (v_course.status='draft' and v_course.current_version_id is null and app_private.learning_course_has_creation_provenance(v_course.id))) or not app_private.is_governed_global_draft(v_version.id) then
    raise exception 'An active global governed draft is required.' using errcode='42501';
  end if;
  v_revision:=encode(extensions.digest(app_private.learning_source_payload(p_course,v_version.id),'sha256'),'hex');
  if v_revision is distinct from p_parameters->>'sourceRevision' then raise exception 'Source changed since review.' using errcode='40001'; end if;
  if p_action='learning.patchDraft' then perform app_private.validate_learning_draft_patch(v_version.id,p_parameters->'patch');
  elsif p_action='learning.editStructure' then perform app_private.learning_structure_model(v_version.id,p_parameters->'changes');
  elsif not v_version.ai_generated then raise exception 'Only AI-generated drafts need this review action.' using errcode='22023'; end if;
  v_before:=jsonb_build_object('courseId',p_course,'versionId',v_version.id,'versionNumber',v_version.version_number,
    'status','draft','title',v_version.title,'currentVersionId',v_course.current_version_id,'sourceRevision',v_revision);
  v_after:=(v_before-'sourceRevision')||jsonb_build_object('title',case when p_action='learning.patchDraft' and p_parameters->'patch'->'version' ? 'title'
    then p_parameters->'patch'->'version'->>'title' else v_version.title end,'aiReviewRequired',p_action in ('learning.patchDraft','learning.editStructure') and v_version.ai_generated);
  return jsonb_build_object('before',v_before,'after',v_after,'stateDigest',encode(extensions.digest(v_before::text,'sha256'),'hex'));
end;
$$;

create or replace function app_private.apply_learning_draft_command(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_authority_expires timestamptz,
  p_command uuid,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_version public.course_versions; v_result jsonb; v_at timestamptz;
begin
  select * into v_row from app_private.platform_admin_commands where id=p_command for update;
  if not found or v_row.action not in ('learning.patchDraft','learning.reviewDraft','learning.editStructure','learning.createCourse') or v_row.actor_profile_id is distinct from p_actor
    or v_row.hub_user_id is distinct from p_principal or v_row.hub_session_id is distinct from p_session or v_row.authentication_method is distinct from p_method then
    raise exception 'Preview belongs to another operation or administrator session.' using errcode='42501'; end if;
  if p_digest is distinct from v_row.preview_digest then raise exception 'Preview changed.' using errcode='40001'; end if;
  if v_row.applied_at is not null then return v_row.result||jsonb_build_object('replayed',true); end if;
  if v_row.expires_at<=clock_timestamp() then raise exception 'Preview expired.' using errcode='40001'; end if;
  v_plan:=app_private.learning_draft_plan(v_row.action,v_row.target_id,v_row.parameters);
  if v_row.expires_at<=clock_timestamp() or p_authority_expires is null or p_authority_expires<=clock_timestamp()
    or v_plan->>'stateDigest' is distinct from v_row.state_digest or v_plan->'after' is distinct from v_row.after_state then
    raise exception 'Source or authority changed since preview.' using errcode='40001'; end if;
  if v_row.action='learning.createCourse' then
    perform app_private.create_governed_learning_course_core(p_actor,v_row.target_id,v_row.parameters);
  elsif v_row.action='learning.patchDraft' then
    perform app_private.patch_learning_draft_core((v_row.parameters->>'versionId')::uuid,v_row.parameters->'patch');
  elsif v_row.action='learning.editStructure' then
    perform app_private.edit_learning_structure_core((v_row.parameters->>'versionId')::uuid,v_row.parameters->'changes');
  else
    perform app_private.review_learning_draft_core(p_actor,p_method,(v_row.parameters->>'versionId')::uuid,v_row.parameters->>'sourceRevision');
  end if;
  select * into v_version from public.course_versions where id=(v_row.parameters->>'versionId')::uuid;
  v_at:=clock_timestamp();
  v_result:=jsonb_build_object('commandId',v_row.id,'action',v_row.action,'courseId',v_row.target_id,'versionId',v_version.id,
    'versionNumber',v_version.version_number,'status','draft','sourceRevision',encode(extensions.digest(
      app_private.learning_source_payload(v_row.target_id,v_version.id),'sha256'),'hex'),'appliedAt',v_at,'replayed',false);
  if v_row.action='learning.createCourse' then
    v_result:=v_result||jsonb_build_object('courseStatus','draft','currentVersionId',null,'contentStandard','comprehensive');
  end if;
  insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,
    request_id,correlation_id,reason,old_values,new_values,metadata)
  values(null,p_actor,p_principal::text,'governed_learning_draft',v_version.id::text,'governed_learning_draft_applied',
    case when p_method='native_session' then 'native_editor' else 'hub_delegate' end,v_row.id::text,v_row.request_id::text,v_row.reason,
    v_row.before_state,v_row.after_state,jsonb_build_object('principalId',p_principal,'sessionId',p_session,'authenticationMethod',p_method,
      'commandAction',v_row.action,'reviewedSourceRevision',v_row.parameters->>'sourceRevision','resultSourceRevision',v_result->>'sourceRevision'));
  update app_private.platform_admin_commands set applied_at=v_at,result=v_result where id=v_row.id;
  return v_result;
end;
$$;

create or replace function public.preview_learning_authoring_command(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
  p_request_id uuid,p_action text,p_course_id uuid,p_parameters jsonb,p_reason text,p_authentication_method text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_id uuid:=gen_random_uuid();
  v_expiry timestamptz:=least(clock_timestamp()+interval '5 minutes',p_assurance_expires_at); v_reason text:=btrim(p_reason); v_digest text;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  if p_action in ('learning.patchDraft','learning.reviewDraft','learning.editStructure','learning.createCourse') then
    return app_private.preview_learning_draft_command(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_assurance_expires_at,
      p_request_id,p_action,p_course_id,p_parameters,p_reason);
  end if;
  if p_action is null or p_action not in ('learning.cloneVersion','learning.publishVersion') or p_request_id is null
    or v_reason is null or length(v_reason) not between 10 and 500 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'Invalid learning command' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform-admin-preview:'||p_hub_session::text||':'||p_request_id::text,0));
  select * into v_row from app_private.platform_admin_commands where hub_user_id=p_hub_user and hub_session_id=p_hub_session and request_id=p_request_id for update;
  if found then
    if v_row.actor_profile_id<>p_actor or v_row.authentication_method<>p_authentication_method or v_row.action<>p_action
      or v_row.target_id is distinct from p_course_id or v_row.parameters is distinct from p_parameters or v_row.reason<>v_reason then
      raise exception 'Request identifier already has different inputs' using errcode='40001';
    end if;
  else
    v_plan:=app_private.learning_authoring_plan(p_action,p_course_id,p_parameters);
    v_digest:=encode(extensions.digest(jsonb_build_object('commandId',v_id,'actor',p_actor,'hubUser',p_hub_user,
      'session',p_hub_session,'authenticationMethod',p_authentication_method,'action',p_action,'target',p_course_id,
      'parameters',p_parameters,'reason',v_reason,'plan',v_plan,'expiresAt',v_expiry)::text,'sha256'),'hex');
    insert into app_private.platform_admin_commands(id,request_id,actor_profile_id,hub_user_id,hub_session_id,authentication_method,
      action,target_id,parameters,reason,before_state,after_state,state_digest,preview_digest,expires_at)
    values(v_id,p_request_id,p_actor,p_hub_user,p_hub_session,p_authentication_method,p_action,p_course_id,p_parameters,v_reason,
      v_plan->'before',v_plan->'after',v_plan->>'stateDigest',v_digest,v_expiry) returning * into v_row;
  end if;
  if v_row.expires_at<=clock_timestamp() then raise exception 'Preview expired' using errcode='40001'; end if;
  return jsonb_build_object('commandId',v_row.id,'action',v_row.action,'courseId',v_row.target_id,'reason',v_row.reason,
    'expiresAt',v_row.expires_at,'previewDigest',v_row.preview_digest,'before',v_row.before_state,'after',v_row.after_state);
end;
$$;

create or replace function public.apply_learning_authoring_command(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
  p_command_id uuid,p_expected_digest text,p_authentication_method text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_version public.course_versions; v_result jsonb; v_applied timestamptz;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  if exists(select 1 from app_private.platform_admin_commands where id=p_command_id and action in ('learning.patchDraft','learning.reviewDraft','learning.editStructure','learning.createCourse')) then
    return app_private.apply_learning_draft_command(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_assurance_expires_at,p_command_id,p_expected_digest);
  end if;
  select * into v_row from app_private.platform_admin_commands where id=p_command_id for update;
  if not found then raise exception 'Preview not found' using errcode='P0002'; end if;
  if v_row.action not in ('learning.cloneVersion','learning.publishVersion') or v_row.actor_profile_id<>p_actor
    or v_row.hub_user_id<>p_hub_user or v_row.hub_session_id<>p_hub_session or v_row.authentication_method<>p_authentication_method then
    raise exception 'Preview belongs to another operation or administrator session' using errcode='42501';
  end if;
  if p_expected_digest is distinct from v_row.preview_digest then raise exception 'Preview changed' using errcode='40001'; end if;
  if v_row.applied_at is not null then return v_row.result||jsonb_build_object('replayed',true); end if;
  if v_row.expires_at<=clock_timestamp() then raise exception 'Preview expired' using errcode='40001'; end if;
  v_plan:=app_private.learning_authoring_plan(v_row.action,v_row.target_id,v_row.parameters);
  if v_row.expires_at<=clock_timestamp() or p_assurance_expires_at<=clock_timestamp() then raise exception 'Preview expired' using errcode='40001'; end if;
  if v_plan->>'stateDigest' is distinct from v_row.state_digest or v_plan->'after' is distinct from v_row.after_state then
    raise exception 'Source changed since preview' using errcode='40001';
  end if;
  if v_row.action='learning.cloneVersion' then
    v_version:=app_private.clone_course_version_core(p_actor,(v_row.parameters->>'versionId')::uuid,v_row.target_id,null,
      (v_row.after_state->>'versionNumber')::integer,v_row.parameters->>'title',v_row.parameters->>'sourceRevision');
  else
    perform app_private.publish_course_version_core((v_row.parameters->>'versionId')::uuid);
    select * into v_version from public.course_versions where id=(v_row.parameters->>'versionId')::uuid;
  end if;
  v_applied:=clock_timestamp();
  v_result:=jsonb_build_object('commandId',v_row.id,'action',v_row.action,'courseId',v_row.target_id,'versionId',v_version.id,
    'versionNumber',v_version.version_number,'status',v_version.status,'appliedAt',v_applied,'replayed',false);
  insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,
    request_id,correlation_id,reason,old_values,new_values,metadata)
  values(null,p_actor,p_hub_user::text,'central_learning_authoring',v_version.id::text,'central_learning_authoring_applied','hub_delegate',
    v_row.id::text,v_row.request_id::text,v_row.reason,v_row.before_state,v_row.after_state,
    jsonb_build_object('hubUserId',p_hub_user,'hubSessionId',p_hub_session,'authenticationMethod',p_authentication_method,
      'commandAction',v_row.action,'sourceRevision',v_row.parameters->>'sourceRevision'));
  update app_private.platform_admin_commands set applied_at=v_applied,result=v_result where id=v_row.id;
  return v_result;
end;
$$;

create or replace function app_private.learning_authoring_plan(p_action text,p_course uuid,p_parameters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_course public.courses; v_version public.course_versions; v_revision text; v_next integer;
  v_before jsonb; v_after jsonb; v_dependencies jsonb;
begin
  if p_action not in ('learning.cloneVersion','learning.publishVersion') or p_action is null
    or jsonb_typeof(p_parameters) is distinct from 'object'
    or p_parameters-array['versionId','sourceRevision','title']<>'{}'::jsonb
    or not(p_parameters ?& array['versionId','sourceRevision'])
    or jsonb_typeof(p_parameters->'sourceRevision') is distinct from 'string'
    or jsonb_typeof(p_parameters->'versionId') is distinct from 'string'
    or coalesce(p_parameters->>'sourceRevision','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_parameters->>'versionId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or (p_action='learning.cloneVersion' and (jsonb_typeof(p_parameters->'title') is distinct from 'string'
      or length(btrim(p_parameters->>'title')) not between 1 and 300 or p_parameters->>'title' ~ '[[:cntrl:]]'))
    or (p_action='learning.publishVersion' and p_parameters ? 'title') then
    raise exception 'Invalid learning authoring command' using errcode='22023';
  end if;
  perform app_private.lock_learning_authoring_source(p_course,(p_parameters->>'versionId')::uuid);
  select * into v_course from public.courses where id=p_course;
  select * into v_version from public.course_versions where id=(p_parameters->>'versionId')::uuid;
  if v_course.organization_id is not null or v_version.organization_id is not null or not (v_course.status='published' or (v_course.status='draft' and v_course.current_version_id is null and app_private.learning_course_has_creation_provenance(v_course.id))) then
    raise exception 'Only active global catalog courses may be authored through the Hub' using errcode='42501';
  end if;
  if p_action='learning.cloneVersion' and (v_version.status<>'published' or v_course.current_version_id is distinct from v_version.id) then
    raise exception 'The current published source version is required' using errcode='40001';
  end if;
  if p_action='learning.publishVersion' then perform app_private.assert_learning_draft_review(v_version.id); end if;
  if p_action='learning.publishVersion' and (v_version.status<>'draft' or not exists(select 1 from app_private.learning_authoring_drafts where version_id=v_version.id)) then
    raise exception 'A governed editable draft is required' using errcode='40001';
  end if;
  v_revision:=encode(extensions.digest(app_private.learning_source_payload(p_course,v_version.id),'sha256'),'hex');
  if v_revision is distinct from p_parameters->>'sourceRevision' then raise exception 'Source changed since review' using errcode='40001'; end if;
  select coalesce(max(version_number),0)+1 into v_next from public.course_versions where course_id=p_course;
  select coalesce(jsonb_agg(to_jsonb(d) order by source_package_id),'[]'::jsonb) into v_dependencies
    from app_private.learning_authoring_package_dependencies d where version_id=v_version.id;
  v_before:=jsonb_build_object('courseId',p_course,'versionId',v_version.id,'versionNumber',v_version.version_number,
    'status',v_version.status,'title',v_version.title,'currentVersionId',v_course.current_version_id,'sourceRevision',v_revision);
  if p_action='learning.cloneVersion' then
    v_after:=jsonb_build_object('status','draft','title',btrim(p_parameters->>'title'),'versionNumber',v_next,
      'aiReviewRequired',v_version.ai_generated,'sourceVersionId',v_version.id);
  else
    -- Preview is advisory only; apply re-runs these same current native guards.
    if v_version.ai_generated and v_version.ai_reviewed_at is null then
      raise exception 'The new draft requires its own AI review before publication' using errcode='42501';
    end if;
    perform app_private.assert_learning_authoring_ready(v_version.id);
    perform app_private.assert_learning_authoring_packages(v_version.id);
    v_after:=v_before||jsonb_build_object('status','published','currentVersionId',v_version.id);
  end if;
  return jsonb_build_object('before',v_before,'after',v_after,'stateDigest',encode(extensions.digest(
    jsonb_build_object('before',v_before,'nextVersion',v_next,'dependencies',v_dependencies)::text,'sha256'),'hex'));
end;
$$;

create or replace function public.inspect_learning_authoring_course(p_actor uuid,p_hub_user uuid,p_hub_session uuid,
  p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_course_id uuid,p_authentication_method text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  select jsonb_build_object('courseId',c.id,'title',c.title,'currentVersionId',c.current_version_id,
    'versions',coalesce((select jsonb_agg(jsonb_build_object('versionId',v.id,'versionNumber',v.version_number,
      'title',v.title,'status',v.status,'aiReviewRequired',v.ai_generated and v.ai_reviewed_at is null,
      'governed',exists(select 1 from app_private.learning_authoring_drafts d where d.version_id=v.id),
      'sourceRevision',encode(extensions.digest(app_private.learning_source_payload(c.id,v.id),'sha256'),'hex'),
      'unresolvedPackages',case when app_private.learning_authoring_needs_standard_package(v.id) then 1 else 0 end+(select count(*) from app_private.learning_authoring_package_dependencies d
        left join public.learning_packages p on p.id=d.replacement_package_id where d.version_id=v.id and
          (p.id is null or p.course_version_id<>v.id or p.organization_id is distinct from v.organization_id
            or p.validation_status<>'accepted' or p.content_sha256 is distinct from d.replacement_sha256 or p.validated_at is null or p.immutable_at is null)))
      order by v.version_number desc) from (select * from public.course_versions where course_id=c.id and organization_id is null
      order by version_number desc limit 20) v),'[]'::jsonb)) into v_result
  from public.courses c where c.id=p_course_id and c.organization_id is null and (c.status='published' or (c.status='draft' and c.current_version_id is null and app_private.learning_course_has_creation_provenance(c.id)));
  if v_result is null then raise exception 'Active global course not found' using errcode='P0002'; end if;
  return v_result;
end;
$$;

create or replace function app_private.publish_course_version_core(p_course_version_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_version public.course_versions; v_prior text:=coalesce(current_setting('app.privileged_write',true),'');
begin
  perform 1 from public.courses where id=(select course_id from public.course_versions where id=p_course_version_id) for update;
  select * into v_version from public.course_versions where id=p_course_version_id for update;
  if not found then raise exception 'Course version % not found.',p_course_version_id using errcode='P0002'; end if;
  if v_version.ai_generated and v_version.ai_reviewed_at is null then
    raise exception 'course_version % is AI-generated and has not been reviewed; mark it reviewed before publishing',v_version.id using errcode='42501';
  end if;
  perform app_private.assert_learning_authoring_ready(p_course_version_id);
  perform app_private.assert_learning_authoring_packages(p_course_version_id);
  perform set_config('app.privileged_write','on',true);
  update public.course_versions set status='published',published_at=coalesce(published_at,now()) where id=p_course_version_id;
  update public.courses set current_version_id=p_course_version_id,
    status=case when status='draft' and app_private.learning_course_has_creation_provenance(id) then 'published' else status end
    where id=v_version.course_id;
  perform set_config('app.privileged_write',v_prior,true);
  return p_course_version_id;
end;
$$;

-- Governed version definitions only; native completion remains the sole credit writer.
create function app_private.learning_credit_policy_model(p_version uuid,p_change jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_version public.course_versions; v_row public.course_compliance_credits; v_type public.training_types;
  v_entry jsonb; v_resolved jsonb:='[]'; v_types jsonb:='[]'; v_ids uuid[]; v_removed uuid[]; v_missing uuid[];
  v_id uuid; v_changed boolean:=false; v_definition jsonb; v_old jsonb; v_policy jsonb:=p_change->'policy';
begin
  if not coalesce(app_private.learning_structure_keys(p_change,array['policy','credits','removedCreditIds'],array['policy','credits','removedCreditIds']),false)
    or not coalesce(app_private.learning_structure_keys(v_policy,array['versionLabel','creditedDurationRationale'],array[]::text[]),false)
    or app_private.learning_structure_bytes(p_change)>24576
    or jsonb_typeof(p_change->'credits') is distinct from 'array' or jsonb_array_length(p_change->'credits')>100
    or jsonb_typeof(p_change->'removedCreditIds') is distinct from 'array' or jsonb_array_length(p_change->'removedCreditIds')>100
    or (v_policy ? 'versionLabel' and v_policy->'versionLabel'<>'null'::jsonb and not coalesce(app_private.learning_structure_text(v_policy->'versionLabel',1,300,false),false))
    or (v_policy ? 'creditedDurationRationale' and v_policy->'creditedDurationRationale'<>'null'::jsonb
      and (not coalesce(app_private.learning_structure_text(v_policy->'creditedDurationRationale',40,12000,true),false) or length(regexp_replace(v_policy->>'creditedDurationRationale','^[[:space:]]+|[[:space:]]+$','','g'))<40))
    or p_change::text ~* '([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_?token|refresh_?token|service_?role_?key|authorization|password|client_?secret|storage_?(path|bucket)|video_?url|playback_?(url|token)|signed_?url|api_?key|token|secret|secret_?key|signing_?secret)"[[:space:]]*:)' then
    raise exception 'Invalid governed credit policy.' using errcode='22023'; end if;
  select * into v_version from public.course_versions where id=p_version and status='draft' for update;
  if not found or not app_private.is_governed_global_draft(p_version) then raise exception 'A global governed draft is required.' using errcode='42501'; end if;
  perform app_private.assert_learning_structure_history(p_version);
  if (v_policy ? 'versionLabel' and v_version.version_label is distinct from v_policy->>'versionLabel')
    or (v_policy ? 'creditedDurationRationale' and v_version.credited_duration_rationale is distinct from v_policy->>'creditedDurationRationale') then v_changed:=true; end if;
  if exists(select 1 from jsonb_array_elements(p_change->'removedCreditIds') x where jsonb_typeof(x)<>'string'
    or (x#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
    raise exception 'Invalid removed credit identity.' using errcode='22023'; end if;
  select coalesce(array_agg((x#>>'{}')::uuid order by (x#>>'{}')::uuid),array[]::uuid[]) into v_removed from jsonb_array_elements(p_change->'removedCreditIds') x;
  v_ids:=array[]::uuid[];
  for v_entry in select value from jsonb_array_elements(p_change->'credits') loop
    if jsonb_typeof(v_entry->'creditId') is distinct from 'string'
      or coalesce(v_entry->>'creditId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'Invalid credit identity.' using errcode='22023'; end if;
    v_id:=(v_entry->>'creditId')::uuid; v_ids:=array_append(v_ids,v_id);
    select * into v_row from public.course_compliance_credits where id=v_id for update;
    if found and (v_row.course_version_id<>p_version or v_row.course_id<>v_version.course_id) then
      raise exception 'Credit identity belongs to another version.' using errcode='42501'; end if;
    v_old:=case when v_row.id is null then null else jsonb_build_object('creditId',v_row.id,'trainingTypeId',v_row.training_type_id,
      'topicCode',v_row.topic_code,'creditHours',to_char(v_row.credit_hours,'FM9990.00'),'creditMode',v_row.credit_mode,'citationNote',v_row.citation_note,'isActive',v_row.is_active) end;
    if coalesce(app_private.learning_structure_keys(v_entry,array['creditId','preserve'],array['creditId','preserve']),false) and v_entry->'preserve'='true'::jsonb then
      if v_old is null then raise exception 'Preserved credit no longer exists.' using errcode='40001'; end if;
      v_definition:=v_old;
    else
      if not coalesce(app_private.learning_structure_keys(v_entry,array['creditId','trainingTypeId','topicCode','creditHours','creditMode','citationNote','isActive'],array['creditId','trainingTypeId','topicCode','creditHours','creditMode','citationNote','isActive']),false)
        or jsonb_typeof(v_entry->'trainingTypeId') is distinct from 'string'
        or coalesce(v_entry->>'trainingTypeId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or jsonb_typeof(v_entry->'topicCode') is distinct from 'string' or length(v_entry->>'topicCode')>128 or coalesce(v_entry->>'topicCode','') !~ '^[A-Z0-9][A-Z0-9._-]*$'
        or jsonb_typeof(v_entry->'creditHours') is distinct from 'string' or coalesce(v_entry->>'creditHours','') !~ '^(0|[1-9][0-9]{0,3})[.][0-9]{2}$' or v_entry->>'creditHours'='0.00'
        or coalesce(v_entry->>'creditMode','') not in ('automatic','verified_only') or jsonb_typeof(v_entry->'isActive') is distinct from 'boolean'
        or not coalesce(app_private.learning_structure_text(v_entry->'citationNote',1,12000,true),false) or length(regexp_replace(v_entry->>'citationNote','^[[:space:]]+|[[:space:]]+$','','g'))<1 then
        raise exception 'Invalid credit definition.' using errcode='22023'; end if;
      if v_row.id is not null and v_row.training_type_id is distinct from (v_entry->>'trainingTypeId')::uuid then
        raise exception 'Remove and add a new credit identity to change its training association.' using errcode='40001'; end if;
      v_definition:=v_entry||jsonb_build_object('creditId',v_id,'trainingTypeId',(v_entry->>'trainingTypeId')::uuid);
      if v_definition is distinct from v_old then
        select * into v_type from public.training_types where id=(v_entry->>'trainingTypeId')::uuid for share;
        if not found or v_type.organization_id is not null or not v_type.is_active then
          raise exception 'Choose a current active global training type for changed credit definitions.' using errcode='40001'; end if;
        v_types:=v_types||jsonb_build_array(to_jsonb(v_type)); v_changed:=true;
      end if;
    end if;
    v_resolved:=v_resolved||jsonb_build_array(v_definition);
  end loop;
  if (select count(*)<>count(distinct x) from unnest(v_ids||v_removed) x)
    or (select count(*)<>count(distinct x->>'trainingTypeId') from jsonb_array_elements(v_resolved) x) then
    raise exception 'Credit identities and training associations must be distinct.' using errcode='22023'; end if;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_missing from public.course_compliance_credits
    where course_version_id=p_version and not(id=any(v_ids));
  if v_missing is distinct from v_removed then raise exception 'Review every removed credit identity explicitly.' using errcode='40001'; end if;
  if cardinality(v_removed)>0 then v_changed:=true; end if;
  if not v_changed then raise exception 'No credit policy changes to apply.' using errcode='22023'; end if;
  return jsonb_build_object('credits',v_resolved,'policy',v_policy,'trainingTypes',v_types);
end;
$$;

create function app_private.edit_learning_credit_policy_core(p_version uuid,p_change jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_model jsonb; v_credit jsonb; v_course uuid;
begin
  v_model:=app_private.learning_credit_policy_model(p_version,p_change);
  select course_id into v_course from public.course_versions where id=p_version;
  delete from public.course_compliance_credits where course_version_id=p_version
    and id in(select (value#>>'{}')::uuid from jsonb_array_elements(p_change->'removedCreditIds'));
  for v_credit in select value from jsonb_array_elements(v_model->'credits') loop
    if exists(select 1 from public.course_compliance_credits where id=(v_credit->>'creditId')::uuid and course_version_id=p_version) then
      update public.course_compliance_credits set topic_code=v_credit->>'topicCode',credit_hours=(v_credit->>'creditHours')::numeric,
        credit_mode=v_credit->>'creditMode',citation_note=v_credit->>'citationNote',is_active=(v_credit->>'isActive')::boolean
      where id=(v_credit->>'creditId')::uuid and course_version_id=p_version and
        (topic_code,credit_hours,credit_mode,citation_note,is_active) is distinct from
        (v_credit->>'topicCode',(v_credit->>'creditHours')::numeric,v_credit->>'creditMode',v_credit->>'citationNote',(v_credit->>'isActive')::boolean);
    else
      insert into public.course_compliance_credits(id,course_id,course_version_id,training_type_id,topic_code,credit_hours,credit_mode,citation_note,is_active)
        values((v_credit->>'creditId')::uuid,v_course,p_version,(v_credit->>'trainingTypeId')::uuid,v_credit->>'topicCode',
          (v_credit->>'creditHours')::numeric,v_credit->>'creditMode',v_credit->>'citationNote',(v_credit->>'isActive')::boolean);
    end if;
  end loop;
  update public.course_versions set
    version_label=case when p_change->'policy' ? 'versionLabel' then p_change->'policy'->>'versionLabel' else version_label end,
    credited_duration_rationale=case when p_change->'policy' ? 'creditedDurationRationale' then p_change->'policy'->>'creditedDurationRationale' else credited_duration_rationale end
    where id=p_version;
end;
$$;
revoke all on function app_private.learning_credit_policy_model(uuid,jsonb),app_private.edit_learning_credit_policy_core(uuid,jsonb)
  from public,anon,authenticated,service_role;

-- Extend the same authenticated transaction and immutable command ledger.
alter table app_private.platform_admin_commands drop constraint platform_admin_commands_action_check;
alter table app_private.platform_admin_commands add constraint platform_admin_commands_action_check check(action in ('users.setActive','organizations.setSuspension','billing.setAccessOverride','learning.cloneVersion','learning.publishVersion','learning.patchDraft','learning.reviewDraft','learning.editStructure','learning.editCreditPolicy','learning.createCourse'));

create or replace function app_private.learning_draft_plan(p_action text,p_course uuid,p_parameters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_version public.course_versions; v_course public.courses; v_revision text; v_before jsonb; v_after jsonb; v_credit_model jsonb;
begin
  if p_action='learning.createCourse' then return app_private.learning_creation_plan(p_course,p_parameters); end if;
  if p_action is null or p_action not in ('learning.patchDraft','learning.reviewDraft','learning.editStructure','learning.editCreditPolicy') or p_parameters is null
    or jsonb_typeof(p_parameters)<>'object' or not(p_parameters ?& array['versionId','sourceRevision'])
    or jsonb_typeof(p_parameters->'versionId') is distinct from 'string' or jsonb_typeof(p_parameters->'sourceRevision') is distinct from 'string'
    or coalesce(p_parameters->>'versionId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or coalesce(p_parameters->>'sourceRevision','') !~ '^[0-9a-f]{64}$'
    or (p_action='learning.patchDraft' and (not(p_parameters ? 'patch') or p_parameters-array['versionId','sourceRevision','patch']<>'{}'::jsonb))
    or (p_action='learning.editStructure' and (not(p_parameters ? 'changes') or p_parameters-array['versionId','sourceRevision','changes']<>'{}'::jsonb))
    or (p_action='learning.editCreditPolicy' and (not(p_parameters ?& array['policy','credits','removedCreditIds'])
      or p_parameters-array['versionId','sourceRevision','policy','credits','removedCreditIds']<>'{}'::jsonb or app_private.learning_structure_bytes(p_parameters)>24576))
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
  elsif p_action='learning.editCreditPolicy' then v_credit_model:=app_private.learning_credit_policy_model(v_version.id,p_parameters-array['versionId','sourceRevision']);
  elsif not v_version.ai_generated then raise exception 'Only AI-generated drafts need this review action.' using errcode='22023'; end if;
  v_before:=jsonb_build_object('courseId',p_course,'versionId',v_version.id,'versionNumber',v_version.version_number,
    'status','draft','title',v_version.title,'currentVersionId',v_course.current_version_id,'sourceRevision',v_revision);
  v_after:=(v_before-'sourceRevision')||jsonb_build_object('title',case when p_action='learning.patchDraft' and p_parameters->'patch'->'version' ? 'title'
    then p_parameters->'patch'->'version'->>'title' else v_version.title end,'aiReviewRequired',p_action in ('learning.patchDraft','learning.editStructure','learning.editCreditPolicy') and v_version.ai_generated);
  return jsonb_build_object('before',v_before,'after',v_after,'stateDigest',encode(extensions.digest((case when p_action='learning.editCreditPolicy' then jsonb_build_object('before',v_before,'trainingTypes',v_credit_model->'trainingTypes') else v_before end)::text,'sha256'),'hex'));
end;
$$;

create or replace function app_private.apply_learning_draft_command(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_authority_expires timestamptz,
  p_command uuid,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_version public.course_versions; v_result jsonb; v_at timestamptz;
begin
  select * into v_row from app_private.platform_admin_commands where id=p_command for update;
  if not found or v_row.action not in ('learning.patchDraft','learning.reviewDraft','learning.editStructure','learning.editCreditPolicy','learning.createCourse') or v_row.actor_profile_id is distinct from p_actor
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
  elsif v_row.action='learning.editCreditPolicy' then
    perform app_private.edit_learning_credit_policy_core((v_row.parameters->>'versionId')::uuid,v_row.parameters-array['versionId','sourceRevision']);
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
  if p_action in ('learning.patchDraft','learning.reviewDraft','learning.editStructure','learning.editCreditPolicy','learning.createCourse') then
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
  if exists(select 1 from app_private.platform_admin_commands where id=p_command_id and action in ('learning.patchDraft','learning.reviewDraft','learning.editStructure','learning.editCreditPolicy','learning.createCourse')) then
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


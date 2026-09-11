-- Course-wide provider documentation has one explicit-actor, current-session writer.
-- Existing issuance snapshots and legacy live-profile fallback readers are unchanged.
create table app_private.learning_provider_commands (
  id uuid primary key default gen_random_uuid(), request_id uuid not null,
  actor_id uuid not null, principal_id uuid not null, session_id uuid not null,
  authentication_method text not null check(authentication_method in ('native_session','app_sms','jwt_aal2')),
  course_id uuid not null, patch jsonb not null, reason text not null, context_revision text not null,
  plan jsonb not null, preview_digest text not null, expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(), applied_at timestamptz, result jsonb,
  unique(principal_id,session_id,request_id), check((applied_at is null)=(result is null))
);
alter table app_private.learning_provider_commands enable row level security;
revoke all on app_private.learning_provider_commands from public,anon,authenticated,service_role;
-- The identifiers are historical pseudonymous evidence, not FKs that block native erasure.
create function app_private.guard_learning_provider_command() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' or old.applied_at is not null or new.applied_at is null or new.result is null
    or to_jsonb(old)-array['applied_at','result'] is distinct from to_jsonb(new)-array['applied_at','result'] then
    raise exception 'Provider command evidence is immutable.' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger learning_provider_command_immutable before update or delete on app_private.learning_provider_commands
  for each row execute function app_private.guard_learning_provider_command();

create function app_private.learning_provider_profile(p_row jsonb) returns jsonb
language sql immutable set search_path='' as $$
select case when p_row is null or p_row='null'::jsonb then null else jsonb_build_object(
  'id',p_row->'id','signatureRecordedAt',p_row->'provider_signature_recorded_at',
  'providerFullName',p_row->'provider_full_name',
  'courseAuthor',p_row->'course_author',
  'signatureName',p_row->'provider_signature_name',
  'contentVersion',p_row->'content_version',
  'lastClinicalReviewDate',p_row->'last_clinical_review_date',
  'reviewedBy',p_row->'reviewed_by',
  'nextReviewDue',p_row->'next_review_due',
  'regulationReviewDate',p_row->'regulation_review_date',
  'reviewNotes',p_row->'review_notes') end;
$$;
create function app_private.learning_provider_context(p_course uuid,p_global_only boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_course public.courses; v_provider jsonb; v_versions jsonb; v_drafts jsonb; v_legacy bigint; v_count bigint; v_impact jsonb; v_revision text;
begin
  -- This matches the shared authoring lock order and serializes missing-profile creation.
  select * into v_course from public.courses where id=p_course for update;
  if not found then raise exception 'Course not found.' using errcode='P0002'; end if;
  if p_global_only and v_course.organization_id is not null then raise exception 'Global course required.' using errcode='42501'; end if;
  perform 1 from public.course_versions where course_id=p_course order by id for update;
  perform 1 from public.course_provider_profiles where course_id=p_course for update;
  select to_jsonb(p) into v_provider from public.course_provider_profiles p where course_id=p_course;
  select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]'),count(*) into v_versions,v_count from public.course_versions v where course_id=p_course;
  select coalesce(jsonb_agg(jsonb_build_object('versionId',v.id,'title',v.title,'aiGenerated',v.ai_generated,
      'reviewInvalidated',v.ai_generated and exists(select 1 from app_private.learning_draft_reviews r where r.version_id=v.id and r.revoked_at is null)) order by v.id),'[]')
    into v_drafts from public.course_versions v join app_private.learning_authoring_drafts d on d.version_id=v.id
    where v.course_id=p_course and v.status='draft' and v.organization_id is null;
  if jsonb_array_length(v_drafts)>100 then raise exception 'Provider impact exceeds the review limit.' using errcode='22023'; end if;
  select count(*) into v_legacy from public.certificates where course_id=p_course and provider_snapshot_at is null;
  v_impact:=jsonb_build_object('versionCount',v_count::text,'legacyFallbackCertificates',v_legacy::text,'governedDrafts',v_drafts);
  -- This is intentionally NOT the version-specific governed source digest. Full rows preserve
  -- CAS sensitivity to credential columns and course policy which this editor cannot change.
  v_revision:=encode(extensions.digest(jsonb_build_object('contract','carebase.provider-context.v1','course',to_jsonb(v_course),
    'provider',v_provider,'versions',v_versions,'impact',v_impact)::text,'sha256'),'hex');
  return jsonb_build_object('courseId',p_course,'courseTitle',v_course.title,'courseStatus',v_course.status,
    'providerContextRevision',v_revision,'profile',app_private.learning_provider_profile(v_provider),'impact',v_impact);
end;
$$;
create function app_private.learning_provider_plan(p_course uuid,p_global_only boolean,p_revision text,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_context jsonb; v_changes jsonb:='[]'; v_profile jsonb; v_key text; v_value jsonb; v_text text; v_date date;
  v_signature text:='retain'; v_last date; v_next date;
begin
  if p_revision is null or p_revision !~ '^[0-9a-f]{64}$' or p_patch is null or jsonb_typeof(p_patch)<>'object'
    or not exists(select 1 from jsonb_object_keys(p_patch)) or octet_length(p_patch::text)>32768
    or exists(select 1 from jsonb_object_keys(p_patch) k where k<>all(array['providerFullName','courseAuthor','signatureName','contentVersion','lastClinicalReviewDate','reviewedBy','nextReviewDue','regulationReviewDate','reviewNotes']))
    or p_patch::text ~* '([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_?token|refresh_?token|service_?role_?key|authorization|password|client_?secret|storage_?(path|bucket)|video_?url|playback_?(url|token)|signed_?url|api_?key|token|secret|secret_?key|signing_?secret)"[[:space:]]*:)' then
    raise exception 'Invalid provider patch.' using errcode='22023'; end if;
  if octet_length(p_patch::text)-greatest(2*(select count(*) from jsonb_object_keys(p_patch))::integer-1,0)>24576 then
    raise exception 'Provider patch exceeds the review limit.' using errcode='22023'; end if;
  for v_key,v_value in select key,value from jsonb_each(p_patch) loop
    if v_value='null'::jsonb then
      if v_key='providerFullName' then raise exception 'Provider full name is required.' using errcode='22023'; end if;
      continue;
    end if;
    if jsonb_typeof(v_value)<>'string' then raise exception 'Provider fields must be text or null.' using errcode='22023'; end if;
    v_text:=p_patch->>v_key;
    if v_text ~* '([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_?token|refresh_?token|service_?role_?key|authorization|password|client_?secret|storage_?(path|bucket)|video_?url|playback_?(url|token)|signed_?url|api_?key|token|secret|secret_?key|signing_?secret)"[[:space:]]*:)' then raise exception 'Provider text contains excluded credentials.' using errcode='22023'; end if;
    if v_key in ('lastClinicalReviewDate','nextReviewDue','regulationReviewDate') then
      if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(v_text,4)='0000' then raise exception 'Invalid calendar date.' using errcode='22023'; end if;
      begin v_date:=v_text::date; exception when others then raise exception 'Invalid calendar date.' using errcode='22023'; end;
      if to_char(v_date,'YYYY-MM-DD')<>v_text then raise exception 'Invalid calendar date.' using errcode='22023'; end if;
    elsif v_key='reviewNotes' then
      if length(v_text)>12000 or length(regexp_replace(v_text,'^[[:space:]]+|[[:space:]]+$','','g'))=0
        or regexp_replace(v_text,E'[\t\r\n]','','g') ~ '[[:cntrl:]]' then raise exception 'Invalid provider notes.' using errcode='22023'; end if;
    elsif length(v_text) not between 1 and (case when v_key='contentVersion' then 300 else 500 end)
      or v_text<>regexp_replace(v_text,'^[[:space:]]+|[[:space:]]+$','','g') or v_text ~ '[[:cntrl:]]' then
      raise exception 'Invalid provider text.' using errcode='22023';
    end if;
  end loop;
  v_context:=app_private.learning_provider_context(p_course,p_global_only);
  if v_context->>'providerContextRevision' is distinct from p_revision then raise exception 'Provider context changed; refresh before editing.' using errcode='40001'; end if;
  v_profile:=coalesce(nullif(v_context->'profile','null'), '{}');
  if v_profile='{}'::jsonb and not p_patch?'providerFullName' then raise exception 'A new provider record requires the full name.' using errcode='22023'; end if;
  for v_key,v_value in select key,value from jsonb_each(p_patch) order by key loop
    if coalesce(v_profile->v_key,'null') is distinct from v_value then
      v_changes:=v_changes||jsonb_build_array(jsonb_build_object('field',v_key,'before',coalesce(v_profile->v_key,'null'),'after',v_value));
    end if;
  end loop;
  if jsonb_array_length(v_changes)=0 then raise exception 'No provider changes to apply.' using errcode='22023'; end if;
  if p_patch?'signatureName' and coalesce(v_profile->'signatureName','null') is distinct from p_patch->'signatureName' then
    v_signature:=case when p_patch->'signatureName'='null'::jsonb then 'clear' else 'record' end;
  end if;
  v_last:=((v_profile||p_patch)->>'lastClinicalReviewDate')::date;
  v_next:=((v_profile||p_patch)->>'nextReviewDue')::date;
  if v_last is not null and v_next is not null and v_next<v_last then raise exception 'Next review must not precede the last review.' using errcode='23514'; end if;
  return jsonb_build_object('changes',v_changes,'signatureTimestampAction',v_signature,'impact',v_context->'impact');
end;
$$;
create function app_private.preview_learning_provider_command(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_expires timestamptz,
  p_request uuid,p_course uuid,p_revision text,p_patch jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.learning_provider_commands; v_plan jsonb; v_id uuid:=gen_random_uuid(); v_expiry timestamptz; v_digest text;
begin
  if p_request is null or p_actor is null or p_principal is null or p_session is null or p_method is null or p_method not in ('native_session','app_sms','jwt_aal2')
    or p_expires is null or p_expires<=clock_timestamp() or p_reason is null or length(p_reason) not between 10 and 500
    or p_reason<>regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g') or p_reason ~ '[[:cntrl:]]' then
    raise exception 'Invalid provider command.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('learning-provider:'||p_session::text||':'||p_request::text,0));
  select * into v_row from app_private.learning_provider_commands where principal_id=p_principal and session_id=p_session and request_id=p_request for update;
  if found then
    if v_row.actor_id is distinct from p_actor or v_row.authentication_method is distinct from p_method or v_row.course_id is distinct from p_course
      or v_row.context_revision is distinct from p_revision or v_row.patch is distinct from p_patch or v_row.reason is distinct from p_reason then
      raise exception 'Request already has different inputs.' using errcode='40001'; end if;
  else
    v_plan:=app_private.learning_provider_plan(p_course,p_method<>'native_session',p_revision,p_patch);
    v_expiry:=least(clock_timestamp()+interval '5 minutes',p_expires);
    v_digest:=encode(extensions.digest(jsonb_build_object('commandId',v_id,'actor',p_actor,'principal',p_principal,'session',p_session,
      'method',p_method,'courseId',p_course,'contextRevision',p_revision,'patch',p_patch,'plan',v_plan,'reason',p_reason,'expiresAt',v_expiry)::text,'sha256'),'hex');
    insert into app_private.learning_provider_commands(id,request_id,actor_id,principal_id,session_id,authentication_method,course_id,patch,reason,
      context_revision,plan,preview_digest,expires_at) values(v_id,p_request,p_actor,p_principal,p_session,p_method,p_course,p_patch,p_reason,p_revision,v_plan,v_digest,v_expiry) returning * into v_row;
  end if;
  if v_row.applied_at is null and v_row.expires_at<=clock_timestamp() then raise exception 'Provider preview expired.' using errcode='40001'; end if;
  return jsonb_build_object('commandId',v_row.id,'courseId',v_row.course_id,'action','learning.editProviderPolicy','reason',v_row.reason,
    'providerContextRevision',v_row.context_revision,'previewDigest',v_row.preview_digest,'expiresAt',v_row.expires_at)||v_row.plan;
end;
$$;
create function app_private.apply_learning_provider_command(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_expires timestamptz,p_command uuid,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.learning_provider_commands; v_plan jsonb; v_old public.course_provider_profiles; v_new public.course_provider_profiles;
  v_context jsonb; v_data jsonb:='{}'; v_at timestamptz; v_result jsonb; v_org uuid;
begin
  select * into v_row from app_private.learning_provider_commands where id=p_command for update;
  if not found or v_row.actor_id is distinct from p_actor or v_row.principal_id is distinct from p_principal or v_row.session_id is distinct from p_session
    or v_row.authentication_method is distinct from p_method then raise exception 'Provider preview belongs to another administrator session.' using errcode='42501'; end if;
  if p_digest is distinct from v_row.preview_digest then raise exception 'Provider preview digest changed.' using errcode='40001'; end if;
  if v_row.applied_at is not null then return v_row.result||jsonb_build_object('replayed',true); end if;
  if v_row.expires_at<=clock_timestamp() then raise exception 'Provider preview expired.' using errcode='40001'; end if;
  v_plan:=app_private.learning_provider_plan(v_row.course_id,p_method<>'native_session',v_row.context_revision,v_row.patch);
  if v_plan is distinct from v_row.plan or v_row.expires_at<=clock_timestamp() or p_expires is null or p_expires<=clock_timestamp() then
    raise exception 'Provider source or authority changed.' using errcode='40001'; end if;
  select * into v_old from public.course_provider_profiles where course_id=v_row.course_id;
  if v_row.patch?'providerFullName' then v_data:=v_data||jsonb_build_object('provider_full_name',v_row.patch->'providerFullName'); end if;
  if v_row.patch?'courseAuthor' then v_data:=v_data||jsonb_build_object('course_author',v_row.patch->'courseAuthor'); end if;
  if v_row.patch?'signatureName' then v_data:=v_data||jsonb_build_object('provider_signature_name',v_row.patch->'signatureName'); end if;
  if v_row.patch?'contentVersion' then v_data:=v_data||jsonb_build_object('content_version',v_row.patch->'contentVersion'); end if;
  if v_row.patch?'lastClinicalReviewDate' then v_data:=v_data||jsonb_build_object('last_clinical_review_date',v_row.patch->'lastClinicalReviewDate'); end if;
  if v_row.patch?'reviewedBy' then v_data:=v_data||jsonb_build_object('reviewed_by',v_row.patch->'reviewedBy'); end if;
  if v_row.patch?'nextReviewDue' then v_data:=v_data||jsonb_build_object('next_review_due',v_row.patch->'nextReviewDue'); end if;
  if v_row.patch?'regulationReviewDate' then v_data:=v_data||jsonb_build_object('regulation_review_date',v_row.patch->'regulationReviewDate'); end if;
  if v_row.patch?'reviewNotes' then v_data:=v_data||jsonb_build_object('review_notes',v_row.patch->'reviewNotes'); end if;
  v_at:=clock_timestamp();
  if v_plan->>'signatureTimestampAction'='record' then v_data:=v_data||jsonb_build_object('provider_signature_recorded_at',v_at);
  elsif v_plan->>'signatureTimestampAction'='clear' then v_data:=v_data||jsonb_build_object('provider_signature_recorded_at',null); end if;
  v_new:=jsonb_populate_record(v_old,v_data||jsonb_build_object('updated_by',p_actor));
  if v_old.id is null then
    insert into public.course_provider_profiles(course_id,provider_full_name,course_author,provider_signature_name,provider_signature_recorded_at,
      content_version,last_clinical_review_date,reviewed_by,next_review_due,regulation_review_date,review_notes,updated_by)
    values(v_row.course_id,v_new.provider_full_name,v_new.course_author,v_new.provider_signature_name,v_new.provider_signature_recorded_at,
      v_new.content_version,v_new.last_clinical_review_date,v_new.reviewed_by,v_new.next_review_due,v_new.regulation_review_date,v_new.review_notes,p_actor) returning * into v_new;
  else
    update public.course_provider_profiles set provider_full_name=v_new.provider_full_name,course_author=v_new.course_author,
      provider_signature_name=v_new.provider_signature_name,provider_signature_recorded_at=v_new.provider_signature_recorded_at,
      content_version=v_new.content_version,last_clinical_review_date=v_new.last_clinical_review_date,reviewed_by=v_new.reviewed_by,
      next_review_due=v_new.next_review_due,regulation_review_date=v_new.regulation_review_date,review_notes=v_new.review_notes,updated_by=p_actor
      where id=v_old.id returning * into v_new;
  end if;
  -- Existing definition triggers revoke affected draft AI review. No review is fabricated.
  v_context:=app_private.learning_provider_context(v_row.course_id,p_method<>'native_session');
  v_result:=jsonb_build_object('commandId',v_row.id,'courseId',v_row.course_id,'action','learning.editProviderPolicy','providerId',v_new.id,
    'providerContextRevision',v_context->>'providerContextRevision','appliedAt',v_at,'replayed',false);
  select organization_id into v_org from public.courses where id=v_row.course_id;
  insert into public.audit_logs(organization_id,actor_profile_id,actor_subject_id,entity_type,entity_id,action,source,request_id,correlation_id,reason,old_values,new_values,metadata)
    values(v_org,p_actor,p_principal::text,'course_provider_profiles',v_new.id::text,'learning_provider_policy_applied',
      case when p_method='native_session' then 'native_editor' else 'hub_delegate' end,v_row.id::text,v_row.request_id::text,v_row.reason,
      to_jsonb(v_old),to_jsonb(v_new),jsonb_build_object('principalId',p_principal,'sessionId',p_session,'authenticationMethod',p_method,
        'previousContextRevision',v_row.context_revision,'resultContextRevision',v_result->>'providerContextRevision','reviewedImpact',v_plan->'impact'));
  update app_private.learning_provider_commands set applied_at=v_at,result=v_result where id=v_row.id;
  return v_result;
end;
$$;

create function app_private.current_native_provider_authority() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin
  v_auth:=app_private.current_native_learning_authority();
  -- Keep the actual protected identity and session stable through the provider transaction.
  perform 1 from public.profiles p join auth.users u on u.id=p.id join auth.sessions s on s.user_id=p.id
    where p.id=(v_auth->>'actorId')::uuid and s.id=(v_auth->>'sessionId')::uuid for share of p,u,s;
  if not found then raise exception 'Current native administrator session required.' using errcode='28000'; end if;
  return app_private.current_native_learning_authority();
end;
$$;
revoke all on function app_private.current_native_provider_authority() from public,anon,authenticated,service_role;

create function public.get_learning_provider_context(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_course_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.learning_provider_context(p_course_id,true);
end;
$$;
revoke all on function public.get_learning_provider_context(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_learning_provider_context(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid) to service_role;

create function public.preview_learning_provider_command(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_request_id uuid,p_course_id uuid,p_context_revision text,p_patch jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.preview_learning_provider_command(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_assurance_expires_at,p_request_id,p_course_id,p_context_revision,p_patch,p_reason);
end;
$$;
revoke all on function public.preview_learning_provider_command(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.preview_learning_provider_command(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,text,jsonb,text) to service_role;

create function public.apply_learning_provider_command(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_command_id uuid,p_expected_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.apply_learning_provider_command(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_assurance_expires_at,p_command_id,p_expected_digest);
end;
$$;
revoke all on function public.apply_learning_provider_command(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.apply_learning_provider_command(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text) to service_role;

create function public.get_native_learning_provider_context(p_course_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Current native administrator required.' using errcode='42501'; end if;
  v_auth:=app_private.current_native_provider_authority();
  return app_private.learning_provider_context(p_course_id,false);
end;
$$;
revoke all on function public.get_native_learning_provider_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_native_learning_provider_context(uuid) to authenticated;

create function public.preview_native_learning_provider_command(p_request_id uuid,p_course_id uuid,p_context_revision text,p_patch jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Current native administrator required.' using errcode='42501'; end if;
  v_auth:=app_private.current_native_provider_authority();
  return app_private.preview_learning_provider_command((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,(v_auth->>'sessionId')::uuid,'native_session',(v_auth->>'expiresAt')::timestamptz,p_request_id,p_course_id,p_context_revision,p_patch,p_reason);
end;
$$;
revoke all on function public.preview_native_learning_provider_command(uuid,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.preview_native_learning_provider_command(uuid,uuid,text,jsonb,text) to authenticated;

create function public.apply_native_learning_provider_command(p_command_id uuid,p_expected_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Current native administrator required.' using errcode='42501'; end if;
  v_auth:=app_private.current_native_provider_authority();
  return app_private.apply_learning_provider_command((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,(v_auth->>'sessionId')::uuid,'native_session',(v_auth->>'expiresAt')::timestamptz,p_command_id,p_expected_digest);
end;
$$;
revoke all on function public.apply_native_learning_provider_command(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.apply_native_learning_provider_command(uuid,text) to authenticated;

-- The native card performs explicit preview and apply, just as the Hub does.
revoke insert,update,delete on public.course_provider_profiles from authenticated,service_role;
drop policy course_provider_profiles_insert on public.course_provider_profiles;
drop policy course_provider_profiles_update on public.course_provider_profiles;
drop policy course_provider_profiles_delete on public.course_provider_profiles;
revoke all on function app_private.guard_learning_provider_command(),app_private.learning_provider_profile(jsonb),
  app_private.learning_provider_context(uuid,boolean),app_private.learning_provider_plan(uuid,boolean,text,jsonb),
  app_private.preview_learning_provider_command(uuid,uuid,uuid,text,timestamptz,uuid,uuid,text,jsonb,text),
  app_private.apply_learning_provider_command(uuid,uuid,uuid,text,timestamptz,uuid,text) from public,anon,authenticated,service_role;

create function app_private.learning_provider_command_status(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_expires timestamptz,p_command uuid,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.learning_provider_commands; v_preview jsonb;
begin
  select * into v_row from app_private.learning_provider_commands where id=p_command for share;
  if not found or v_row.actor_id is distinct from p_actor or v_row.principal_id is distinct from p_principal then
    raise exception 'Provider receipt belongs to another administrator.' using errcode='42501'; end if;
  if p_digest is distinct from v_row.preview_digest then raise exception 'Provider receipt digest changed.' using errcode='40001'; end if;
  v_preview:=jsonb_build_object('commandId',v_row.id,'courseId',v_row.course_id,'action','learning.editProviderPolicy','reason',v_row.reason,
    'providerContextRevision',v_row.context_revision,'previewDigest',v_row.preview_digest,'expiresAt',v_row.expires_at)||v_row.plan;
  return jsonb_build_object('preview',v_preview,'result',v_row.result,'canApplyThisSession',v_row.applied_at is null
    and v_row.session_id=p_session and v_row.authentication_method=p_method and v_row.expires_at>clock_timestamp() and p_expires>clock_timestamp());
end;
$$;
create function app_private.list_learning_provider_commands(p_actor uuid,p_principal uuid,p_global_only boolean,p_course uuid,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_rows jsonb; v_more boolean;
begin
  if p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'Invalid provider page.' using errcode='22023'; end if;
  if not exists(select 1 from public.courses where id=p_course and (not p_global_only or organization_id is null)) then
    raise exception 'Accessible course required.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('commandId',id,'expectedDigest',preview_digest,'expiresAt',expires_at,'appliedAt',applied_at)
    order by (applied_at is null) desc,created_at desc,id),'[]') into v_rows from (select * from app_private.learning_provider_commands
    where actor_id=p_actor and principal_id=p_principal and course_id=p_course order by (applied_at is null) desc,created_at desc,id limit 20 offset p_offset) q;
  select exists(select 1 from app_private.learning_provider_commands where actor_id=p_actor and principal_id=p_principal and course_id=p_course offset p_offset+20 limit 1) into v_more;
  return jsonb_build_object('items',v_rows,'nextOffset',case when v_more and p_offset+20<=10000 then p_offset+20 else null end);
end;
$$;

create function public.get_learning_provider_status(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_command_id uuid,p_expected_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.learning_provider_command_status(p_actor,p_hub_user,p_hub_session,p_authentication_method,p_assurance_expires_at,p_command_id,p_expected_digest);
end;
$$;
revoke all on function public.get_learning_provider_status(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_learning_provider_status(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text) to service_role;

create function public.list_learning_provider_commands(p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,p_course_id uuid,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  return app_private.list_learning_provider_commands(p_actor,p_hub_user,true,p_course_id,p_offset);
end;
$$;
revoke all on function public.list_learning_provider_commands(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_learning_provider_commands(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,integer) to service_role;

create function public.get_native_learning_provider_status(p_command_id uuid,p_expected_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Current native administrator required.' using errcode='42501'; end if;
  v_auth:=app_private.current_native_provider_authority();
  return app_private.learning_provider_command_status((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,(v_auth->>'sessionId')::uuid,'native_session',(v_auth->>'expiresAt')::timestamptz,p_command_id,p_expected_digest);
end;
$$;
revoke all on function public.get_native_learning_provider_status(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_native_learning_provider_status(uuid,text) to authenticated;

create function public.list_native_learning_provider_commands(p_course_id uuid,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_auth jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Current native administrator required.' using errcode='42501'; end if;
  v_auth:=app_private.current_native_provider_authority();
  return app_private.list_learning_provider_commands((v_auth->>'actorId')::uuid,(v_auth->>'actorId')::uuid,false,p_course_id,p_offset);
end;
$$;
revoke all on function public.list_native_learning_provider_commands(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_native_learning_provider_commands(uuid,integer) to authenticated;
revoke all on function app_private.learning_provider_command_status(uuid,uuid,uuid,text,timestamptz,uuid,text),app_private.list_learning_provider_commands(uuid,uuid,boolean,uuid,integer) from public,anon,authenticated,service_role;

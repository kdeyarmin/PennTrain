-- Governed global drafts only. Native media/package acceptance and every learner
-- writer remain unchanged. Both interfaces use the same CAS edit/review core.
create table app_private.learning_draft_reviews (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.course_versions(id) on delete cascade,
  reviewed_source_revision text not null check(reviewed_source_revision ~ '^[0-9a-f]{64}$'),
  material_revision text not null check(material_revision ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null,
  authentication_method text not null check(authentication_method in ('native_session','jwt_aal2','app_sms')),
  reviewed_at timestamptz not null,
  revoked_at timestamptz
);
create unique index learning_draft_reviews_current on app_private.learning_draft_reviews(version_id) where revoked_at is null;
create index learning_draft_reviews_version on app_private.learning_draft_reviews(version_id);
alter table app_private.learning_draft_reviews enable row level security;
revoke all on app_private.learning_draft_reviews from public,anon,authenticated,service_role;

create function app_private.protect_learning_draft_review() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.revoked_at is not null or new.revoked_at is null
    or to_jsonb(new)-'revoked_at' is distinct from to_jsonb(old)-'revoked_at' then
    raise exception 'Draft review evidence is immutable.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function app_private.protect_learning_draft_review() from public,anon,authenticated,service_role;
create trigger learning_draft_review_immutable before update on app_private.learning_draft_reviews
  for each row execute function app_private.protect_learning_draft_review();

create function app_private.is_governed_global_draft(p_version uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_private.learning_authoring_drafts d join public.course_versions v on v.id=d.version_id
    join public.courses c on c.id=v.course_id where v.id=p_version and v.organization_id is null and c.organization_id is null);
$$;

create function app_private.learning_material_revision(p_version uuid) returns text
language sql stable security definer set search_path='' as $$
  -- Approval time is evidence, not course material. Every other governed field
  -- (including publication state, package validation and provider policy) remains.
  select encode(extensions.digest(jsonb_set(app_private.learning_source_payload(v.course_id,v.id)::jsonb,
    '{version,aiReviewedAt}','null'::jsonb)::text,'sha256'),'hex') from public.course_versions v where v.id=p_version;
$$;

create function app_private.invalidate_learning_draft_review(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_current app_private.learning_draft_reviews;
begin
  select * into v_current from app_private.learning_draft_reviews where version_id=p_version and revoked_at is null;
  if not found or not exists(select 1 from public.course_versions where id=p_version and status='draft') then return; end if;
  if v_current.material_revision is not distinct from app_private.learning_material_revision(p_version) then return; end if;
  update app_private.learning_draft_reviews set revoked_at=clock_timestamp() where id=v_current.id and revoked_at is null;
  update public.course_versions set ai_reviewed_at=null,ai_reviewed_by=null where id=p_version and status='draft'
    and (ai_reviewed_at is not null or ai_reviewed_by is not null);
end;
$$;

create function app_private.assert_learning_draft_review(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_version public.course_versions; v_review app_private.learning_draft_reviews;
begin
  if not app_private.is_governed_global_draft(p_version) then return; end if;
  select * into v_version from public.course_versions where id=p_version;
  if not v_version.ai_generated then return; end if;
  select * into v_review from app_private.learning_draft_reviews where version_id=p_version and revoked_at is null;
  if not found or v_review.material_revision is distinct from app_private.learning_material_revision(p_version)
    or v_version.ai_reviewed_at is distinct from v_review.reviewed_at or v_version.ai_reviewed_by is distinct from v_review.actor_id then
    raise exception 'Review the exact current draft before publishing.' using errcode='23514';
  end if;
end;
$$;

create function app_private.guard_learning_draft_review() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not app_private.is_governed_global_draft(old.id) then return new; end if;
  if new.course_id is distinct from old.course_id or new.organization_id is distinct from old.organization_id then
    raise exception 'A governed version cannot be reassigned.' using errcode='42501';
  end if;
  if old.ai_generated and not new.ai_generated then
    raise exception 'A governed AI draft cannot remove its review requirement.' using errcode='42501';
  end if;
  if (new.ai_reviewed_at,new.ai_reviewed_by) is distinct from (old.ai_reviewed_at,old.ai_reviewed_by)
    and (new.ai_reviewed_at is not null or new.ai_reviewed_by is not null)
    and coalesce(current_setting('app.learning_review_write',true),'')<>'on' then
    raise exception 'Use the exact-draft review action.' using errcode='42501';
  end if;
  if old.status<>'published' and new.status='published' then
    if to_jsonb(new)-array['status','published_at'] is distinct from to_jsonb(old)-array['status','published_at'] then
      raise exception 'Save and review definition changes before publishing.' using errcode='23514';
    end if;
    perform app_private.assert_learning_draft_review(old.id);
  end if;
  return new;
end;
$$;
create trigger learning_draft_review_guard before update on public.course_versions
  for each row execute function app_private.guard_learning_draft_review();

create function app_private.lock_learning_draft_writer(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
  if not app_private.is_governed_global_draft(p_version) then return; end if;
  select status into v_status from public.course_versions where id=p_version;
  if v_status<>'draft' then return; end if;
  select status into v_status from public.course_versions where id=p_version for update;
  if not found or v_status<>'draft' then raise exception 'The draft changed while saving.' using errcode='40001'; end if;
end;
$$;

create function app_private.learning_definition_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_old jsonb:=case when tg_op<>'INSERT' then to_jsonb(old) end;
  v_new jsonb:=case when tg_op<>'DELETE' then to_jsonb(new) end;
  v_row jsonb; v_version uuid; v_course uuid;
begin
  if tg_op='UPDATE' and v_old is not distinct from v_new then return new; end if;
  for v_row in select value from jsonb_array_elements(jsonb_build_array(v_old,v_new)) where value<>'null'::jsonb loop
    v_version:=null; v_course:=null;
    case tg_table_name
      when 'course_versions' then v_version:=(v_row->>'id')::uuid;
      when 'course_blocks','course_compliance_credits','learning_packages' then v_version:=(v_row->>'course_version_id')::uuid;
      when 'quizzes' then select course_version_id into v_version from public.course_blocks where id=(v_row->>'course_block_id')::uuid;
      when 'quiz_questions' then select b.course_version_id into v_version from public.quizzes q join public.course_blocks b on b.id=q.course_block_id where q.id=(v_row->>'quiz_id')::uuid;
      when 'quiz_answers','quiz_question_explanations' then select b.course_version_id into v_version from public.quiz_questions z join public.quizzes q on q.id=z.quiz_id join public.course_blocks b on b.id=q.course_block_id where z.id=(v_row->>'question_id')::uuid;
      when 'courses' then v_course:=(v_row->>'id')::uuid;
      when 'course_provider_profiles' then v_course:=(v_row->>'course_id')::uuid;
      else raise exception 'Unsupported definition trigger' using errcode='22023';
    end case;
    if v_course is not null then
      for v_version in select d.version_id from app_private.learning_authoring_drafts d join public.course_versions v on v.id=d.version_id
        where v.course_id=v_course and v.status='draft' and v.organization_id is null order by d.version_id loop
        if tg_when='BEFORE' then perform app_private.lock_learning_draft_writer(v_version);
        else perform app_private.invalidate_learning_draft_review(v_version); end if;
      end loop;
    elsif v_version is not null then
      if tg_when='BEFORE' then perform app_private.lock_learning_draft_writer(v_version);
      else perform app_private.invalidate_learning_draft_review(v_version); end if;
    end if;
  end loop;
  return coalesce(new,old);
end;
$$;
do $$ declare v_table text; begin
  foreach v_table in array array['courses','course_versions','course_blocks','quizzes','quiz_questions','quiz_answers',
    'quiz_question_explanations','course_compliance_credits','course_provider_profiles','learning_packages'] loop
    execute format('create trigger learning_definition_review_lock before insert or update or delete on public.%I for each row execute function app_private.learning_definition_changed()',v_table);
    execute format('create trigger learning_definition_review_invalidation after insert or update or delete on public.%I for each row execute function app_private.learning_definition_changed()',v_table);
  end loop;
end; $$;

create function app_private.validate_learning_draft_patch(p_version uuid,p_patch jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_update jsonb; v_block public.course_blocks; v_version public.course_versions; v_changed boolean:=false; v_key text; v_compact_bytes integer;
begin
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch-array['version','blocks']<>'{}'::jsonb or p_patch='{}'::jsonb
    or octet_length(p_patch::text)>32768 then raise exception 'Invalid bounded draft patch.' using errcode='22023'; end if;
  -- JSONB prints a space after each colon/comma. Count compact JSON bytes like
  -- the two transports without modifying spaces inside the actual prose.
  select octet_length(p_patch::text)-greatest(2*count(*)::integer-1,0) into v_compact_bytes from jsonb_object_keys(p_patch);
  if p_patch::text ~* '([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_?token|refresh_?token|service_?role_?key|authorization|password|client_?secret|storage_?(path|bucket)|video_?url|playback_?(url|token)|signed_?url|api_?key|token|secret|secret_?key|signing_?secret)"[[:space:]]*:)' then
    raise exception 'Draft text contains an excluded credential field.' using errcode='22023'; end if;
  select * into v_version from public.course_versions where id=p_version and status='draft';
  if not found or not app_private.is_governed_global_draft(p_version) then raise exception 'Governed global draft required.' using errcode='42501'; end if;
  if p_patch ? 'version' then
    v_update:=p_patch->'version';
    if jsonb_typeof(v_update)<>'object' or v_update='{}'::jsonb or v_update-array['title','description']<>'{}'::jsonb
      or (v_update ? 'title' and (jsonb_typeof(v_update->'title')<>'string' or length(v_update->>'title') not between 1 and 300
        or v_update->>'title'<>btrim(v_update->>'title') or v_update->>'title' ~ '[[:cntrl:]]'))
      or (v_update ? 'description' and (jsonb_typeof(v_update->'description') not in ('string','null') or length(v_update->>'description')>12000)) then
      raise exception 'Invalid editable version fields.' using errcode='22023';
    end if;
    select v_compact_bytes-greatest(2*count(*)::integer-1,0) into v_compact_bytes from jsonb_object_keys(v_update);
    v_changed:=v_changed or (v_update ? 'title' and v_update->>'title' is distinct from v_version.title)
      or (v_update ? 'description' and v_update->>'description' is distinct from v_version.description);
  end if;
  if p_patch ? 'blocks' then
    if jsonb_typeof(p_patch->'blocks')<>'array' or jsonb_array_length(p_patch->'blocks') not between 1 and 20
      or exists(select 1 from jsonb_array_elements(p_patch->'blocks') b group by lower(b->>'blockId') having count(*)>1) then
      raise exception 'Invalid editable block list.' using errcode='22023';
    end if;
    v_compact_bytes:=v_compact_bytes-greatest(jsonb_array_length(p_patch->'blocks')-1,0);
    for v_update in select value from jsonb_array_elements(p_patch->'blocks') loop
      if jsonb_typeof(v_update)<>'object' or v_update-array['blockId','title','content','transcript','estimatedMinutes']<>'{}'::jsonb
        or v_update-'blockId'='{}'::jsonb or coalesce(v_update->>'blockId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception 'Invalid editable block fields.' using errcode='22023';
      end if;
      select v_compact_bytes-greatest(2*count(*)::integer-1,0) into v_compact_bytes from jsonb_object_keys(v_update);
      select * into v_block from public.course_blocks where id=(v_update->>'blockId')::uuid and course_version_id=p_version and organization_id is null;
      if not found then raise exception 'Block is outside this global draft.' using errcode='42501'; end if;
      if v_update ? 'title' and (jsonb_typeof(v_update->'title') not in ('string','null') or length(v_update->>'title')>300
        or v_update->>'title'<>btrim(v_update->>'title') or v_update->>'title' ~ '[[:cntrl:]]') then
        raise exception 'Invalid block title.' using errcode='22023';
      end if;
      if v_update ?| array['content','transcript','estimatedMinutes'] and (jsonb_typeof(v_block.body) not in ('object','null')) then
        raise exception 'Review this legacy block in its native editor.' using errcode='22023';
      end if;
      foreach v_key in array array['content','transcript'] loop
        if v_update ? v_key and v_block.body ? v_key and jsonb_typeof(v_block.body->v_key) not in ('string','null') then
          raise exception 'Review this legacy field in its native editor.' using errcode='22023';
        end if;
        if v_update ? v_key and (jsonb_typeof(v_update->v_key)<>'string' or length(v_update->>v_key)>12000
          or (v_key='content' and v_block.block_type<>'text') or (v_key='transcript' and v_block.block_type<>'video')) then
          raise exception 'Field does not match this block type.' using errcode='22023';
        end if;
      end loop;
      if v_update ? 'estimatedMinutes' and v_block.body ? 'estimated_minutes'
        and jsonb_typeof(v_block.body->'estimated_minutes') not in ('number','null') then
        raise exception 'Review this legacy field in its native editor.' using errcode='22023';
      end if;
      if v_update ? 'estimatedMinutes' and (v_block.block_type not in ('text','video') or jsonb_typeof(v_update->'estimatedMinutes')<>'number'
        or (v_update->>'estimatedMinutes')::numeric<>trunc((v_update->>'estimatedMinutes')::numeric)
        or (v_update->>'estimatedMinutes')::numeric not between 0 and 1440) then raise exception 'Invalid estimated minutes.' using errcode='22023'; end if;
      v_changed:=v_changed or (v_update ? 'title' and v_update->>'title' is distinct from v_block.title)
        or (v_update ? 'content' and v_update->'content' is distinct from v_block.body->'content')
        or (v_update ? 'transcript' and v_update->'transcript' is distinct from v_block.body->'transcript')
        or (v_update ? 'estimatedMinutes' and v_update->'estimatedMinutes' is distinct from v_block.body->'estimated_minutes');
    end loop;
  end if;
  if v_compact_bytes>24576 then raise exception 'Invalid bounded draft patch.' using errcode='22023'; end if;
  if not v_changed then raise exception 'The draft patch has no changes.' using errcode='22023'; end if;
end;
$$;

create function app_private.patch_learning_draft_core(p_version uuid,p_patch jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_update jsonb; v_body jsonb;
begin
  perform app_private.validate_learning_draft_patch(p_version,p_patch);
  if p_patch ? 'version' then
    v_update:=p_patch->'version';
    update public.course_versions set title=case when v_update ? 'title' then v_update->>'title' else title end,
      description=case when v_update ? 'description' then v_update->>'description' else description end where id=p_version;
  end if;
  for v_update in select value from jsonb_array_elements(coalesce(p_patch->'blocks','[]'::jsonb)) loop
    select body into v_body from public.course_blocks where id=(v_update->>'blockId')::uuid;
    if v_update ? 'content' then v_body:=coalesce(nullif(v_body,'null'::jsonb),'{}'::jsonb)||jsonb_build_object('content',v_update->'content'); end if;
    if v_update ? 'transcript' then v_body:=coalesce(nullif(v_body,'null'::jsonb),'{}'::jsonb)||jsonb_build_object('transcript',v_update->'transcript'); end if;
    if v_update ? 'estimatedMinutes' then v_body:=coalesce(nullif(v_body,'null'::jsonb),'{}'::jsonb)||jsonb_build_object('estimated_minutes',v_update->'estimatedMinutes'); end if;
    update public.course_blocks set title=case when v_update ? 'title' then v_update->>'title' else title end,body=v_body
      where id=(v_update->>'blockId')::uuid and course_version_id=p_version;
  end loop;
end;
$$;

create function app_private.review_learning_draft_core(p_actor uuid,p_method text,p_version uuid,p_revision text) returns void
language plpgsql security definer set search_path='' as $$
declare v_material text; v_at timestamptz:=clock_timestamp(); v_prior text:=coalesce(current_setting('app.learning_review_write',true),'');
begin
  if not app_private.is_governed_global_draft(p_version) or not exists(select 1 from public.course_versions where id=p_version and status='draft' and ai_generated) then
    raise exception 'An AI-generated governed draft is required.' using errcode='42501'; end if;
  v_material:=app_private.learning_material_revision(p_version);
  update app_private.learning_draft_reviews set revoked_at=v_at where version_id=p_version and revoked_at is null;
  insert into app_private.learning_draft_reviews(version_id,reviewed_source_revision,material_revision,actor_id,authentication_method,reviewed_at)
    values(p_version,p_revision,v_material,p_actor,p_method,v_at);
  perform set_config('app.learning_review_write','on',true);
  update public.course_versions set ai_reviewed_at=v_at,ai_reviewed_by=p_actor where id=p_version;
  perform set_config('app.learning_review_write',v_prior,true);
exception when others then perform set_config('app.learning_review_write',v_prior,true); raise;
end;
$$;

revoke all on function app_private.is_governed_global_draft(uuid),app_private.learning_material_revision(uuid),app_private.lock_learning_draft_writer(uuid),
  app_private.invalidate_learning_draft_review(uuid),app_private.assert_learning_draft_review(uuid),app_private.guard_learning_draft_review(),
  app_private.learning_definition_changed(),app_private.validate_learning_draft_patch(uuid,jsonb),
  app_private.patch_learning_draft_core(uuid,jsonb),app_private.review_learning_draft_core(uuid,text,uuid,text)
  from public,anon,authenticated,service_role;

-- Native sessions are identified as such; they never impersonate Hub SMS/AAL2.
alter table app_private.platform_admin_commands drop constraint platform_admin_commands_authentication_method_check;
alter table app_private.platform_admin_commands add constraint platform_admin_commands_authentication_method_check
  check(authentication_method in ('native_session','jwt_aal2','app_sms'));
alter table app_private.platform_admin_commands drop constraint platform_admin_commands_action_check;
alter table app_private.platform_admin_commands add constraint platform_admin_commands_action_check
  check(action in ('users.setActive','organizations.setSuspension','billing.setAccessOverride','learning.cloneVersion',
    'learning.publishVersion','learning.patchDraft','learning.reviewDraft'));

create function app_private.learning_draft_plan(p_action text,p_course uuid,p_parameters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_version public.course_versions; v_course public.courses; v_revision text; v_before jsonb; v_after jsonb;
begin
  if p_action is null or p_action not in ('learning.patchDraft','learning.reviewDraft') or p_parameters is null
    or jsonb_typeof(p_parameters)<>'object' or not(p_parameters ?& array['versionId','sourceRevision'])
    or jsonb_typeof(p_parameters->'versionId') is distinct from 'string' or jsonb_typeof(p_parameters->'sourceRevision') is distinct from 'string'
    or coalesce(p_parameters->>'versionId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or coalesce(p_parameters->>'sourceRevision','') !~ '^[0-9a-f]{64}$'
    or (p_action='learning.patchDraft' and (not(p_parameters ? 'patch') or p_parameters-array['versionId','sourceRevision','patch']<>'{}'::jsonb))
    or (p_action='learning.reviewDraft' and (p_parameters->'reviewed' is distinct from 'true'::jsonb or p_parameters-array['versionId','sourceRevision','reviewed']<>'{}'::jsonb)) then
    raise exception 'Invalid governed draft operation.' using errcode='22023';
  end if;
  perform app_private.lock_learning_authoring_source(p_course,(p_parameters->>'versionId')::uuid);
  select * into v_version from public.course_versions where id=(p_parameters->>'versionId')::uuid;
  select * into v_course from public.courses where id=p_course;
  if v_version.status<>'draft' or v_course.status<>'published' or not app_private.is_governed_global_draft(v_version.id) then
    raise exception 'An active global governed draft is required.' using errcode='42501';
  end if;
  v_revision:=encode(extensions.digest(app_private.learning_source_payload(p_course,v_version.id),'sha256'),'hex');
  if v_revision is distinct from p_parameters->>'sourceRevision' then raise exception 'Source changed since review.' using errcode='40001'; end if;
  if p_action='learning.patchDraft' then perform app_private.validate_learning_draft_patch(v_version.id,p_parameters->'patch');
  elsif not v_version.ai_generated then raise exception 'Only AI-generated drafts need this review action.' using errcode='22023'; end if;
  v_before:=jsonb_build_object('courseId',p_course,'versionId',v_version.id,'versionNumber',v_version.version_number,
    'status','draft','title',v_version.title,'currentVersionId',v_course.current_version_id,'sourceRevision',v_revision);
  v_after:=(v_before-'sourceRevision')||jsonb_build_object('title',case when p_action='learning.patchDraft' and p_parameters->'patch'->'version' ? 'title'
    then p_parameters->'patch'->'version'->>'title' else v_version.title end,'aiReviewRequired',p_action='learning.patchDraft' and v_version.ai_generated);
  return jsonb_build_object('before',v_before,'after',v_after,'stateDigest',encode(extensions.digest(v_before::text,'sha256'),'hex'));
end;
$$;

create function app_private.preview_learning_draft_command(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_authority_expires timestamptz,
  p_request uuid,p_action text,p_course uuid,p_parameters jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_id uuid:=gen_random_uuid(); v_reason text:=btrim(p_reason);
  v_expiry timestamptz:=least(clock_timestamp()+interval '5 minutes',p_authority_expires); v_digest text;
begin
  if p_actor is null or p_principal is null or p_session is null or p_request is null or p_method is null
    or p_method not in ('native_session','jwt_aal2','app_sms') or p_authority_expires is null or p_authority_expires<=clock_timestamp()
    or v_reason is null or length(v_reason) not between 10 and 500 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'Invalid draft authority or reason.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('platform-admin-preview:'||p_session::text||':'||p_request::text,0));
  select * into v_row from app_private.platform_admin_commands where hub_user_id=p_principal and hub_session_id=p_session and request_id=p_request for update;
  if found then
    if v_row.actor_profile_id<>p_actor or v_row.authentication_method<>p_method or v_row.action<>p_action
      or v_row.target_id is distinct from p_course or v_row.parameters is distinct from p_parameters or v_row.reason<>v_reason then
      raise exception 'Request identifier already has different inputs.' using errcode='40001'; end if;
  else
    v_plan:=app_private.learning_draft_plan(p_action,p_course,p_parameters);
    v_digest:=encode(extensions.digest(jsonb_build_object('commandId',v_id,'actor',p_actor,'principal',p_principal,'session',p_session,
      'authenticationMethod',p_method,'action',p_action,'courseId',p_course,'parameters',p_parameters,'reason',v_reason,'plan',v_plan,'expiresAt',v_expiry)::text,'sha256'),'hex');
    insert into app_private.platform_admin_commands(id,request_id,actor_profile_id,hub_user_id,hub_session_id,authentication_method,
      action,target_id,parameters,reason,before_state,after_state,state_digest,preview_digest,expires_at)
    values(v_id,p_request,p_actor,p_principal,p_session,p_method,p_action,p_course,p_parameters,v_reason,v_plan->'before',v_plan->'after',
      v_plan->>'stateDigest',v_digest,v_expiry) returning * into v_row;
  end if;
  if v_row.expires_at<=clock_timestamp() and v_row.applied_at is null then raise exception 'Preview expired.' using errcode='40001'; end if;
  return jsonb_build_object('commandId',v_row.id,'action',v_row.action,'courseId',v_row.target_id,'reason',v_row.reason,
    'expiresAt',v_row.expires_at,'previewDigest',v_row.preview_digest,'before',v_row.before_state,'after',v_row.after_state);
end;
$$;

create function app_private.apply_learning_draft_command(p_actor uuid,p_principal uuid,p_session uuid,p_method text,p_authority_expires timestamptz,
  p_command uuid,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_version public.course_versions; v_result jsonb; v_at timestamptz;
begin
  select * into v_row from app_private.platform_admin_commands where id=p_command for update;
  if not found or v_row.action not in ('learning.patchDraft','learning.reviewDraft') or v_row.actor_profile_id is distinct from p_actor
    or v_row.hub_user_id is distinct from p_principal or v_row.hub_session_id is distinct from p_session or v_row.authentication_method is distinct from p_method then
    raise exception 'Preview belongs to another operation or administrator session.' using errcode='42501'; end if;
  if p_digest is distinct from v_row.preview_digest then raise exception 'Preview changed.' using errcode='40001'; end if;
  if v_row.applied_at is not null then return v_row.result||jsonb_build_object('replayed',true); end if;
  if v_row.expires_at<=clock_timestamp() then raise exception 'Preview expired.' using errcode='40001'; end if;
  v_plan:=app_private.learning_draft_plan(v_row.action,v_row.target_id,v_row.parameters);
  if v_row.expires_at<=clock_timestamp() or p_authority_expires is null or p_authority_expires<=clock_timestamp()
    or v_plan->>'stateDigest' is distinct from v_row.state_digest or v_plan->'after' is distinct from v_row.after_state then
    raise exception 'Source or authority changed since preview.' using errcode='40001'; end if;
  if v_row.action='learning.patchDraft' then
    perform app_private.patch_learning_draft_core((v_row.parameters->>'versionId')::uuid,v_row.parameters->'patch');
  else
    perform app_private.review_learning_draft_core(p_actor,p_method,(v_row.parameters->>'versionId')::uuid,v_row.parameters->>'sourceRevision');
  end if;
  select * into v_version from public.course_versions where id=(v_row.parameters->>'versionId')::uuid;
  v_at:=clock_timestamp();
  v_result:=jsonb_build_object('commandId',v_row.id,'action',v_row.action,'courseId',v_row.target_id,'versionId',v_version.id,
    'versionNumber',v_version.version_number,'status','draft','sourceRevision',encode(extensions.digest(
      app_private.learning_source_payload(v_row.target_id,v_version.id),'sha256'),'hex'),'appliedAt',v_at,'replayed',false);
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

create function app_private.current_native_learning_authority() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_session auth.sessions; v_session_id uuid;
begin
  if not public.is_platform_admin() or not exists(select 1 from auth.users where id=auth.uid() and deleted_at is null
    and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=clock_timestamp())) then
    raise exception 'Current native administrator required.' using errcode='42501'; end if;
  begin v_session_id:=(auth.jwt()->>'session_id')::uuid;
  exception when others then raise exception 'Current native session required.' using errcode='28000'; end;
  select * into v_session from auth.sessions where id=v_session_id and user_id=auth.uid();
  if not found or v_session.created_at<clock_timestamp()-interval '8 hours' or v_session.created_at>clock_timestamp()+interval '5 minutes'
    or (v_session.not_after is not null and v_session.not_after<=clock_timestamp()) then
    raise exception 'Sign in again before editing or approving a governed draft.' using errcode='28000'; end if;
  return jsonb_build_object('actorId',auth.uid(),'sessionId',v_session.id,'expiresAt',least(v_session.created_at+interval '8 hours',coalesce(v_session.not_after,'infinity'::timestamptz)));
end;
$$;

create function public.get_native_learning_draft_source(p_version_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_authority jsonb; v_course uuid; v_payload text;
begin
  if not public.is_platform_admin() then raise exception 'Current native administrator required.' using errcode='42501'; end if;
  if not app_private.is_governed_global_draft(p_version_id) then return null; end if;
  v_authority:=app_private.current_native_learning_authority();
  select course_id into v_course from public.course_versions where id=p_version_id and status='draft';
  if not found then raise exception 'Editable draft required.' using errcode='40001'; end if;
  v_payload:=app_private.learning_source_payload(v_course,p_version_id);
  if octet_length(v_payload)>2000000 then raise exception 'Source exceeds the governed review limit.' using errcode='22023'; end if;
  return jsonb_build_object('courseId',v_course,'versionId',p_version_id,'sourceRevision',encode(extensions.digest(v_payload,'sha256'),'hex'),'payload',v_payload);
end;
$$;

create function public.preview_native_learning_draft_command(p_request_id uuid,p_action text,p_course_id uuid,p_parameters jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_authority jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Current native administrator required.' using errcode='42501'; end if;
  v_authority:=app_private.current_native_learning_authority();
  return app_private.preview_learning_draft_command((v_authority->>'actorId')::uuid,(v_authority->>'actorId')::uuid,
    (v_authority->>'sessionId')::uuid,'native_session',(v_authority->>'expiresAt')::timestamptz,p_request_id,p_action,p_course_id,p_parameters,p_reason);
end;
$$;
create function public.apply_native_learning_draft_command(p_command_id uuid,p_expected_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_authority jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Current native administrator required.' using errcode='42501'; end if;
  v_authority:=app_private.current_native_learning_authority();
  return app_private.apply_learning_draft_command((v_authority->>'actorId')::uuid,(v_authority->>'actorId')::uuid,
    (v_authority->>'sessionId')::uuid,'native_session',(v_authority->>'expiresAt')::timestamptz,p_command_id,p_expected_digest);
end;
$$;
create function public.execute_native_learning_draft_command(p_request_id uuid,p_action text,p_course_id uuid,p_parameters jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_preview jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Current native administrator required.' using errcode='42501'; end if;
  -- The native form is itself the reviewed change. Preview and apply share one
  -- transaction and request identity; a lost response is recoverable unchanged.
  v_preview:=public.preview_native_learning_draft_command(p_request_id,p_action,p_course_id,p_parameters,p_reason);
  return public.apply_native_learning_draft_command((v_preview->>'commandId')::uuid,v_preview->>'previewDigest');
end;
$$;
revoke all on function app_private.learning_draft_plan(text,uuid,jsonb),
  app_private.preview_learning_draft_command(uuid,uuid,uuid,text,timestamptz,uuid,text,uuid,jsonb,text),
  app_private.apply_learning_draft_command(uuid,uuid,uuid,text,timestamptz,uuid,text),app_private.current_native_learning_authority(),
  public.get_native_learning_draft_source(uuid),public.preview_native_learning_draft_command(uuid,text,uuid,jsonb,text),
  public.apply_native_learning_draft_command(uuid,text),public.execute_native_learning_draft_command(uuid,text,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.get_native_learning_draft_source(uuid),public.preview_native_learning_draft_command(uuid,text,uuid,jsonb,text),
  public.apply_native_learning_draft_command(uuid,text),public.execute_native_learning_draft_command(uuid,text,uuid,jsonb,text) to authenticated;

-- Extend the existing delegated endpoints without changing existing clone/publish rules or ACLs.
create or replace function public.preview_learning_authoring_command(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
  p_request_id uuid,p_action text,p_course_id uuid,p_parameters jsonb,p_reason text,p_authentication_method text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_id uuid:=gen_random_uuid();
  v_expiry timestamptz:=least(clock_timestamp()+interval '5 minutes',p_assurance_expires_at); v_reason text:=btrim(p_reason); v_digest text;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  if p_action in ('learning.patchDraft','learning.reviewDraft') then
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
  if exists(select 1 from app_private.platform_admin_commands where id=p_command_id and action in ('learning.patchDraft','learning.reviewDraft')) then
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
  if v_course.organization_id is not null or v_version.organization_id is not null or v_course.status<>'published' then
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

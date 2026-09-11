-- One native definition writer for native and delegated course-version cloning.
-- Learner history, private bytes, paid generation ownership and approvals are not cloned.
create table app_private.learning_authoring_drafts (
  version_id uuid primary key references public.course_versions(id) on delete cascade,
  source_version_id uuid not null,
  source_revision text,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
create table app_private.learning_authoring_package_dependencies (
  version_id uuid not null references app_private.learning_authoring_drafts(version_id) on delete cascade,
  source_package_id uuid not null,
  source_sha256 text not null,
  source_definition jsonb not null,
  replacement_package_id uuid,
  replacement_sha256 text,
  resolved_by uuid,
  resolved_at timestamptz,
  primary key(version_id,source_package_id)
);
alter table app_private.learning_authoring_drafts enable row level security;
alter table app_private.learning_authoring_package_dependencies enable row level security;
revoke all on app_private.learning_authoring_drafts,app_private.learning_authoring_package_dependencies from public,anon,authenticated,service_role;

create function app_private.lock_learning_authoring_source(p_course uuid,p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Parent FOR UPDATE locks also prevent new FK descendants while definitions are copied.
  perform 1 from public.courses where id=p_course for update;
  if not found then raise exception 'Course not found' using errcode='P0002'; end if;
  perform 1 from public.course_versions where id=p_version and course_id=p_course for update;
  if not found then raise exception 'Course version not found' using errcode='P0002'; end if;
  perform 1 from public.course_blocks where course_version_id=p_version order by id for update;
  perform 1 from public.quizzes q join public.course_blocks b on b.id=q.course_block_id
    where b.course_version_id=p_version order by q.id for update of q;
  perform 1 from public.quiz_questions q join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id
    where b.course_version_id=p_version order by q.id for update of q;
  perform 1 from public.quiz_answers a join public.quiz_questions q on q.id=a.question_id
    join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id
    where b.course_version_id=p_version order by a.id for update of a;
  perform 1 from public.quiz_question_explanations e join public.quiz_questions q on q.id=e.question_id
    join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id
    where b.course_version_id=p_version order by e.question_id for update of e;
  perform 1 from public.course_compliance_credits where course_version_id=p_version order by id for update;
  perform 1 from public.learning_packages where course_version_id=p_version order by id for update;
  perform 1 from public.course_provider_profiles where course_id=p_course for share;
end;
$$;

create function app_private.clone_course_version_core(p_actor uuid,p_source uuid,p_course uuid,p_organization uuid,
  p_version_number integer,p_title text,p_source_revision text default null) returns public.course_versions
language plpgsql security definer set search_path='' as $$
declare
  v_source public.course_versions;
  v_result public.course_versions;
  v_block public.course_blocks;
  v_quiz public.quizzes;
  v_question public.quiz_questions;
  v_block_id uuid;
  v_quiz_id uuid;
  v_question_id uuid;
  v_next integer;
begin
  perform app_private.lock_learning_authoring_source(p_course,p_source);
  select * into v_source from public.course_versions where id=p_source;
  if v_source.organization_id is distinct from p_organization or not exists(select 1 from public.courses
    where id=p_course and organization_id is not distinct from p_organization) then
    raise exception 'Course and source tenant do not match' using errcode='42501';
  end if;
  if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and is_active and role='platform_admin') then
    raise exception 'Active platform administrator required' using errcode='42501';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 300 or p_title ~ '[[:cntrl:]]' then
    raise exception 'Invalid version title' using errcode='22023';
  end if;
  select coalesce(max(version_number),0)+1 into v_next from public.course_versions where course_id=p_course;
  if p_version_number is distinct from v_next then raise exception 'Course versions changed; refresh before cloning' using errcode='40001'; end if;
  -- Reject inconsistent descendants rather than silently dropping tenant-owned content.
  if exists(select 1 from public.course_blocks b where b.course_version_id=p_source and b.organization_id is distinct from p_organization)
    or exists(select 1 from public.quizzes q join public.course_blocks b on b.id=q.course_block_id where b.course_version_id=p_source and q.organization_id is distinct from p_organization)
    or exists(select 1 from public.quiz_questions q join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=p_source and q.organization_id is distinct from p_organization)
    or exists(select 1 from public.quiz_answers a join public.quiz_questions q on q.id=a.question_id join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=p_source and a.organization_id is distinct from p_organization)
    or exists(select 1 from public.quiz_question_explanations e join public.quiz_questions q on q.id=e.question_id join public.quizzes z on z.id=q.quiz_id join public.course_blocks b on b.id=z.course_block_id where b.course_version_id=p_source and e.organization_id is distinct from p_organization)
    or exists(select 1 from public.course_compliance_credits where course_version_id=p_source and course_id<>p_course) then
    raise exception 'Source definitions have inconsistent tenant or course ownership' using errcode='42501';
  end if;
  insert into public.course_versions(course_id,organization_id,version_number,title,description,status,
    ai_generated,ai_reviewed_at,ai_reviewed_by,content_standard,version_label,credited_duration_rationale)
  values(p_course,p_organization,v_next,btrim(p_title),v_source.description,'draft',v_source.ai_generated,null,null,
    v_source.content_standard,v_source.version_label,v_source.credited_duration_rationale) returning * into v_result;
  insert into app_private.learning_authoring_drafts(version_id,source_version_id,source_revision,created_by)
    values(v_result.id,p_source,p_source_revision,p_actor);
  for v_block in select * from public.course_blocks where course_version_id=p_source order by sort_order,id loop
    insert into public.course_blocks(course_version_id,organization_id,block_type,sort_order,title,body,document_id,video_url)
    values(v_result.id,p_organization,v_block.block_type,v_block.sort_order,v_block.title,
      case when v_block.block_type='video' and jsonb_typeof(v_block.body)='object' then v_block.body-'heygen' else v_block.body end,
      v_block.document_id,v_block.video_url) returning id into v_block_id;
    for v_quiz in select * from public.quizzes where course_block_id=v_block.id order by id loop
      insert into public.quizzes(course_block_id,organization_id,title,passing_score_percent,max_attempts,quiz_kind,
        shuffle_questions,shuffle_answers,reveals_answers_after_attempt)
      values(v_block_id,p_organization,v_quiz.title,v_quiz.passing_score_percent,v_quiz.max_attempts,v_quiz.quiz_kind,
        v_quiz.shuffle_questions,v_quiz.shuffle_answers,v_quiz.reveals_answers_after_attempt) returning id into v_quiz_id;
      for v_question in select * from public.quiz_questions where quiz_id=v_quiz.id order by sort_order,id loop
        insert into public.quiz_questions(quiz_id,organization_id,question_text,question_type,sort_order,points,topic_code,topic_label)
        values(v_quiz_id,p_organization,v_question.question_text,v_question.question_type,v_question.sort_order,
          v_question.points,v_question.topic_code,v_question.topic_label) returning id into v_question_id;
        insert into public.quiz_answers(question_id,organization_id,answer_text,is_correct,sort_order)
          select v_question_id,p_organization,answer_text,is_correct,sort_order from public.quiz_answers where question_id=v_question.id;
        insert into public.quiz_question_explanations(question_id,organization_id,explanation)
          select v_question_id,p_organization,explanation from public.quiz_question_explanations where question_id=v_question.id;
      end loop;
    end loop;
  end loop;
  insert into public.course_compliance_credits(course_id,course_version_id,training_type_id,topic_code,credit_hours,credit_mode,citation_note,is_active)
    select p_course,v_result.id,training_type_id,topic_code,credit_hours,credit_mode,citation_note,is_active
      from public.course_compliance_credits where course_id=p_course and course_version_id=p_source;
  -- No package row is cloned: the native acceptance worker overwrites its storage path.
  -- Only a separately registered, newly accepted artifact can resolve these dependencies.
  insert into app_private.learning_authoring_package_dependencies(version_id,source_package_id,source_sha256,source_definition)
    select v_result.id,id,content_sha256,jsonb_build_object('standard',standard_type,'entryPoint',entry_point,
      'manifest',manifest,'capabilities',capabilities,'connectivityMode',connectivity_mode)
    from public.learning_packages where course_version_id=p_source and organization_id is not distinct from p_organization;
  -- Cloning an incomplete draft cannot make its unresolved requirements disappear.
  insert into app_private.learning_authoring_package_dependencies(version_id,source_package_id,source_sha256,source_definition)
    select v_result.id,d.source_package_id,d.source_sha256,d.source_definition
    from app_private.learning_authoring_package_dependencies d where d.version_id=p_source
      and not exists(select 1 from public.learning_packages p where p.id=d.replacement_package_id and p.course_version_id=p_source)
    on conflict(version_id,source_package_id) do nothing;
  return v_result;
end;
$$;

create function public.clone_course_version(p_source_version_id uuid,p_course_id uuid,p_version_number integer,p_title text,
  p_organization_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_version public.course_versions;
begin
  if not public.is_platform_admin() then raise exception 'Only platform admins can clone course versions.' using errcode='42501'; end if;
  v_version:=app_private.clone_course_version_core(auth.uid(),p_source_version_id,p_course_id,p_organization_id,p_version_number,p_title);
  return v_version.id;
end;
$$;

create function app_private.assert_learning_authoring_packages(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from app_private.learning_authoring_package_dependencies d
    left join public.learning_packages p on p.id=d.replacement_package_id
    where d.version_id=p_version and (p.id is null or p.course_version_id<>p_version
      or p.validation_status<>'accepted' or p.content_sha256 is distinct from d.replacement_sha256
      or p.validated_at is null or p.immutable_at is null)) then
    raise exception 'Cloned package dependencies require separately registered and accepted replacement artifacts before publication.' using errcode='23514';
  end if;
end;
$$;
create function app_private.guard_learning_authoring_publication() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='published' then perform app_private.assert_learning_authoring_packages(new.id); end if;
  return new;
end;
$$;
create trigger learning_authoring_publication before update of status on public.course_versions
  for each row execute function app_private.guard_learning_authoring_publication();

create function public.resolve_learning_authoring_package(p_version_id uuid,p_source_package_id uuid,p_replacement_package_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_source public.learning_packages; v_new public.learning_packages; v_org uuid;
begin
  if not public.is_platform_admin() then raise exception 'Only platform admins can resolve course packages.' using errcode='42501'; end if;
  select organization_id into v_org from public.course_versions where id=p_version_id and status='draft' for update;
  if not found then raise exception 'Editable draft not found' using errcode='P0002'; end if;
  perform 1 from app_private.learning_authoring_package_dependencies where version_id=p_version_id and source_package_id=p_source_package_id for update;
  if not found then raise exception 'Package dependency not found' using errcode='P0002'; end if;
  select * into v_source from public.learning_packages where id=p_source_package_id for share;
  if not found then raise exception 'Original package must remain available for artifact isolation verification' using errcode='40001'; end if;
  select * into v_new from public.learning_packages where id=p_replacement_package_id for share;
  if not found or v_new.course_version_id<>p_version_id or v_new.organization_id is distinct from v_org
    or v_new.validation_status<>'accepted' or v_new.validated_at is null or v_new.immutable_at is null
    or (v_new.storage_bucket=v_source.storage_bucket and v_new.storage_path=v_source.storage_path)
    or v_new.standard_type<>v_source.standard_type then
    raise exception 'A separate accepted replacement artifact in this draft is required' using errcode='23514';
  end if;
  update app_private.learning_authoring_package_dependencies set replacement_package_id=v_new.id,replacement_sha256=v_new.content_sha256,
    resolved_by=auth.uid(),resolved_at=clock_timestamp() where version_id=p_version_id and source_package_id=p_source_package_id;
end;
$$;

revoke all on function app_private.lock_learning_authoring_source(uuid,uuid),
  app_private.clone_course_version_core(uuid,uuid,uuid,uuid,integer,text,text),
  app_private.assert_learning_authoring_packages(uuid),app_private.guard_learning_authoring_publication(),
  public.clone_course_version(uuid,uuid,integer,text,uuid),public.resolve_learning_authoring_package(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.clone_course_version(uuid,uuid,integer,text,uuid),
  public.resolve_learning_authoring_package(uuid,uuid,uuid) to authenticated;

-- The live publisher was inventoried before extraction (2026-09-11,
-- pg_get_functiondef MD5 395d01029053456a422d72de8d504dc7). Keep its business
-- rules and database triggers; the caller supplies separately verified authority.
create function app_private.publish_course_version_core(p_course_version_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_version public.course_versions; v_prior text:=coalesce(current_setting('app.privileged_write',true),'');
begin
  select * into v_version from public.course_versions where id=p_course_version_id for update;
  if not found then raise exception 'Course version % not found.',p_course_version_id using errcode='P0002'; end if;
  if v_version.ai_generated and v_version.ai_reviewed_at is null then
    raise exception 'course_version % is AI-generated and has not been reviewed; mark it reviewed before publishing',v_version.id using errcode='42501';
  end if;
  perform public.assert_course_version_publish_ready(p_course_version_id);
  perform app_private.assert_learning_authoring_packages(p_course_version_id);
  perform set_config('app.privileged_write','on',true);
  update public.course_versions set status='published',published_at=coalesce(published_at,now()) where id=p_course_version_id;
  update public.courses set current_version_id=p_course_version_id where id=v_version.course_id;
  perform set_config('app.privileged_write',v_prior,true);
  return p_course_version_id;
end;
$$;
create or replace function public.publish_course_version(p_course_version_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'Only platform admins can publish course versions.' using errcode='42501'; end if;
  return app_private.publish_course_version_core(p_course_version_id);
end;
$$;

alter table app_private.platform_admin_commands drop constraint platform_admin_commands_action_check;
alter table app_private.platform_admin_commands add constraint platform_admin_commands_action_check
  check(action in ('users.setActive','organizations.setSuspension','billing.setAccessOverride','learning.cloneVersion','learning.publishVersion'));

create function app_private.learning_authoring_plan(p_action text,p_course uuid,p_parameters jsonb) returns jsonb
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
    perform public.assert_course_version_publish_ready(v_version.id);
    perform app_private.assert_learning_authoring_packages(v_version.id);
    v_after:=v_before||jsonb_build_object('status','published','currentVersionId',v_version.id);
  end if;
  return jsonb_build_object('before',v_before,'after',v_after,'stateDigest',encode(extensions.digest(
    jsonb_build_object('before',v_before,'nextVersion',v_next,'dependencies',v_dependencies)::text,'sha256'),'hex'));
end;
$$;

create function public.preview_learning_authoring_command(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
  p_request_id uuid,p_action text,p_course_id uuid,p_parameters jsonb,p_reason text,p_authentication_method text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_id uuid:=gen_random_uuid();
  v_expiry timestamptz:=least(clock_timestamp()+interval '5 minutes',p_assurance_expires_at); v_reason text:=btrim(p_reason); v_digest text;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
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

create function public.apply_learning_authoring_command(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,
  p_command_id uuid,p_expected_digest text,p_authentication_method text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row app_private.platform_admin_commands; v_plan jsonb; v_version public.course_versions; v_result jsonb; v_applied timestamptz;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
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
revoke all on function app_private.publish_course_version_core(uuid),app_private.learning_authoring_plan(text,uuid,jsonb),
  public.preview_learning_authoring_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,uuid,jsonb,text,text),
  public.apply_learning_authoring_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.preview_learning_authoring_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,uuid,jsonb,text,text),
  public.apply_learning_authoring_command(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text) to service_role;

create function public.inspect_learning_authoring_course(p_actor uuid,p_hub_user uuid,p_hub_session uuid,
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
      'unresolvedPackages',(select count(*) from app_private.learning_authoring_package_dependencies d
        left join public.learning_packages p on p.id=d.replacement_package_id where d.version_id=v.id and
          (p.id is null or p.validation_status<>'accepted' or p.content_sha256 is distinct from d.replacement_sha256)))
      order by v.version_number desc) from (select * from public.course_versions where course_id=c.id and organization_id is null
      order by version_number desc limit 20) v),'[]'::jsonb)) into v_result
  from public.courses c where c.id=p_course_id and c.organization_id is null and c.status='published';
  if v_result is null then raise exception 'Active global course not found' using errcode='P0002'; end if;
  return v_result;
end;
$$;
revoke all on function public.inspect_learning_authoring_course(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.inspect_learning_authoring_course(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text) to service_role;

create function public.get_learning_authoring_source(p_actor uuid,p_hub_user uuid,p_hub_session uuid,
  p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_course_id uuid,p_version_id uuid,p_authentication_method text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_payload text;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  v_payload:=app_private.learning_source_payload(p_course_id,p_version_id);
  if v_payload is null then raise exception 'Global source version not found' using errcode='P0002'; end if;
  if octet_length(v_payload)>2000000 then raise exception 'Source exceeds governed snapshot limit' using errcode='22023'; end if;
  if v_payload ~* '([?&](token|access_token|signature|sig|key|policy|jwt|auth|h|hdnts|hdnea|key-pair-id|api_key|apikey|x-amz-[a-z-]+|x-goog-[a-z-]+)=|"(access_token|refresh_token|service_role_key|authorization|accessToken|refreshToken|password|client_secret|storage_path|storage_bucket|video_url|playback_url|signed_url)"[[:space:]]*:)' then
    raise exception 'Source contains an excluded credential or storage field; review it in CareBase before exporting' using errcode='42501';
  end if;
  return jsonb_build_object('courseId',p_course_id,'versionId',p_version_id,'sourceRevision',encode(extensions.digest(v_payload,'sha256'),'hex'),'payload',v_payload);
end;
$$;
revoke all on function public.get_learning_authoring_source(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_learning_authoring_source(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text) to service_role;

create function public.list_learning_authoring_dependencies(p_version_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'Only platform admins can inspect course dependencies.' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(item order by version_number desc,source_package_id) from (
    select v.version_number,d.source_package_id,jsonb_build_object('versionId',v.id,'versionTitle',v.title,'versionNumber',v.version_number,
      'courseTitle',c.title,'sourcePackageId',d.source_package_id,'sourceSha256',d.source_sha256,
      'standard',d.source_definition->>'standard','replacementPackageId',d.replacement_package_id,
      'resolved',p.id is not null and p.validation_status='accepted' and p.content_sha256=d.replacement_sha256) item
    from app_private.learning_authoring_package_dependencies d join public.course_versions v on v.id=d.version_id
      join public.courses c on c.id=v.course_id left join public.learning_packages p on p.id=d.replacement_package_id
    where v.status='draft' and (p_version_id is null or v.id=p_version_id)
    order by v.created_at desc,d.source_package_id limit 100
  ) rows),'[]'::jsonb);
end;
$$;
revoke all on function public.list_learning_authoring_dependencies(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_learning_authoring_dependencies(uuid) to authenticated;

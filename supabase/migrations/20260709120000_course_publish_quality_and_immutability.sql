-- Course publishing quality gates and published-content immutability hardening.
-- The UI shows the same checklist for authoring clarity, but these database
-- functions are the source of truth for direct API calls and future clients.

create or replace function public.get_course_version_publish_issues(p_version_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_issues text[] := array[]::text[];
  v_exists boolean;
  v_label text;
  v_question_count integer;
  v_answer_count integer;
  v_correct_count integer;
  rec record;
begin
  if not public.is_platform_admin()
     and coalesce(current_setting('app.privileged_write', true), '') is distinct from 'on' then
    raise exception 'Only platform admins can inspect course publish readiness.'
      using errcode = 'insufficient_privilege';
  end if;

  select exists(select 1 from public.course_versions where id = p_version_id) into v_exists;
  if not v_exists then
    return array['Course version not found.'];
  end if;

  if not exists(select 1 from public.course_blocks where course_version_id = p_version_id) then
    return array['Add at least one content block before publishing.'];
  end if;

  for rec in
    select id, block_type, sort_order, title, body, video_url, document_id
      from public.course_blocks
     where course_version_id = p_version_id
     order by sort_order, created_at
  loop
    v_label := coalesce(nullif(btrim(rec.title), ''), 'Block ' || (rec.sort_order + 1));

    if rec.block_type = 'text' and coalesce(btrim(rec.body ->> 'content'), '') = '' then
      v_issues := array_append(v_issues, v_label || ': add lesson text.');
    end if;

    if rec.block_type = 'video' and coalesce(btrim(rec.video_url), '') = '' then
      v_issues := array_append(v_issues, v_label || ': add a finished video URL before publishing.');
    end if;

    if rec.block_type in ('pdf', 'scorm') and rec.document_id is null then
      v_issues := array_append(v_issues, v_label || ': attach a document.');
    end if;

    if rec.block_type = 'quiz'
       and not exists(select 1 from public.quizzes where course_block_id = rec.id) then
      v_issues := array_append(v_issues, v_label || ': configure the quiz.');
    end if;
  end loop;

  for rec in
    select q.id, q.title, cb.title as block_title, cb.sort_order
      from public.quizzes q
      join public.course_blocks cb on cb.id = q.course_block_id
     where cb.course_version_id = p_version_id
     order by cb.sort_order
  loop
    select count(*) into v_question_count
      from public.quiz_questions
     where quiz_id = rec.id;

    if v_question_count = 0 then
      v_label := coalesce(nullif(btrim(rec.block_title), ''), rec.title, 'Block ' || (rec.sort_order + 1));
      v_issues := array_append(v_issues, v_label || ': add at least one question.');
    end if;
  end loop;

  for rec in
    select qq.id, qq.question_text, qq.question_type, cb.sort_order
      from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      join public.course_blocks cb on cb.id = q.course_block_id
     where cb.course_version_id = p_version_id
     order by cb.sort_order, qq.sort_order
  loop
    select count(*), count(*) filter (where is_correct)
      into v_answer_count, v_correct_count
      from public.quiz_answers
     where question_id = rec.id;

    v_label := left(coalesce(nullif(btrim(rec.question_text), ''), 'Question'), 80);

    if v_answer_count < 2 then
      v_issues := array_append(v_issues, v_label || ': add at least two answer choices.');
    end if;

    if v_correct_count = 0 then
      v_issues := array_append(v_issues, v_label || ': mark at least one correct answer.');
    end if;

    if rec.question_type in ('single_choice', 'true_false') and v_correct_count > 1 then
      v_issues := array_append(v_issues, v_label || ': single-choice questions can have only one correct answer.');
    end if;
  end loop;

  return v_issues;
end;
$function$;

create or replace function public.assert_course_version_publish_ready(p_version_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_issues text[];
  v_message text;
begin
  v_issues := public.get_course_version_publish_issues(p_version_id);
  if coalesce(array_length(v_issues, 1), 0) > 0 then
    v_message := array_to_string(v_issues, ' ');
    if length(v_message) > 600 then
      v_message := left(v_message, 600) || '...';
    end if;
    raise exception 'Course version is not ready to publish: %', v_message
      using errcode = 'check_violation';
  end if;
end;
$function$;

create or replace function public.enforce_course_version_publish_ready()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'published' then
    if new.ai_generated and new.ai_reviewed_at is null then
      raise exception 'course_version % is AI-generated and has not been reviewed; mark it reviewed before publishing', new.id
        using errcode = 'insufficient_privilege';
    end if;

    perform public.assert_course_version_publish_ready(new.id);
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_course_version_publish_ready on public.course_versions;
create trigger enforce_course_version_publish_ready
  before insert or update on public.course_versions
  for each row execute function public.enforce_course_version_publish_ready();

create or replace function public.validate_course_catalog_publication()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_version public.course_versions%rowtype;
begin
  if new.status is distinct from 'published' then
    return new;
  end if;

  if new.current_version_id is null then
    raise exception 'A published course must have a current published version.'
      using errcode = 'check_violation';
  end if;

  select * into v_version
    from public.course_versions
   where id = new.current_version_id;

  if not found or v_version.course_id is distinct from new.id then
    raise exception 'Course current_version_id must reference a version of the same course.'
      using errcode = 'check_violation';
  end if;

  if v_version.status is distinct from 'published' then
    raise exception 'A published course must point to a published course version.'
      using errcode = 'check_violation';
  end if;

  if v_version.ai_generated and v_version.ai_reviewed_at is null then
    raise exception 'The current version is AI-generated and has not been reviewed.'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.assert_course_version_publish_ready(new.current_version_id);

  return new;
end;
$function$;

drop trigger if exists validate_course_catalog_publication on public.courses;
create trigger validate_course_catalog_publication
  before insert or update on public.courses
  for each row execute function public.validate_course_catalog_publication();

create or replace function public.publish_course_version(p_course_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_version public.course_versions%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can publish course versions.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_version
    from public.course_versions
   where id = p_course_version_id;

  if not found then
    raise exception 'Course version % not found.', p_course_version_id
      using errcode = 'no_data_found';
  end if;

  if v_version.ai_generated and v_version.ai_reviewed_at is null then
    raise exception 'course_version % is AI-generated and has not been reviewed; mark it reviewed before publishing', v_version.id
      using errcode = 'insufficient_privilege';
  end if;

  perform public.assert_course_version_publish_ready(p_course_version_id);
  perform set_config('app.privileged_write', 'on', true);

  update public.course_versions
     set status = 'published',
         published_at = coalesce(published_at, now())
   where id = p_course_version_id;

  update public.courses
     set current_version_id = p_course_version_id
   where id = v_version.course_id;

  return p_course_version_id;
end;
$function$;

-- Published content is immutable for ordinary users, including platform_admin.
-- Only trusted server-side paths that deliberately set app.privileged_write can
-- correct a published row, and those paths should audit why the correction was made.
create or replace function public.lock_published_course_version()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'cannot delete published (immutable) course version %; create a new version', old.id
        using errcode = '0A000';
    end if;
    return old;
  end if;

  if old.status = 'published' then
    raise exception 'course version % is published and immutable; create a new version to make changes', old.id
      using errcode = '0A000';
  end if;

  return new;
end;
$function$;

create or replace function public.lock_published_course_block()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_ver uuid;
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  v_ver := case when tg_op = 'DELETE' then old.course_version_id else new.course_version_id end;
  if public.course_version_is_published(v_ver) then
    raise exception 'course_block belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.enforce_quiz_block_rules()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_ver uuid;
  v_type text;
  v_block uuid;
begin
  v_block := case when tg_op = 'DELETE' then old.course_block_id else new.course_block_id end;

  select cb.course_version_id, cb.block_type into v_ver, v_type
    from public.course_blocks cb
   where cb.id = v_block;

  if tg_op <> 'DELETE' and v_type is distinct from 'quiz' then
    raise exception 'a quiz may only attach to a course_block of block_type = ''quiz'' (block % is %)',
      v_block, coalesce(v_type, '<missing>') using errcode = 'check_violation';
  end if;

  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if public.course_version_is_published(v_ver) then
    raise exception 'quiz belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.lock_published_quiz_question()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_ver uuid;
  v_quiz uuid;
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  v_quiz := case when tg_op = 'DELETE' then old.quiz_id else new.quiz_id end;
  select cb.course_version_id into v_ver
    from public.quizzes qz
    join public.course_blocks cb on cb.id = qz.course_block_id
   where qz.id = v_quiz;

  if public.course_version_is_published(v_ver) then
    raise exception 'quiz_question belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.lock_published_quiz_answer()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_ver uuid;
  v_q uuid;
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  v_q := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  select cb.course_version_id into v_ver
    from public.quiz_questions qq
    join public.quizzes qz on qz.id = qq.quiz_id
    join public.course_blocks cb on cb.id = qz.course_block_id
   where qq.id = v_q;

  if public.course_version_is_published(v_ver) then
    raise exception 'quiz_answer belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.lock_published_quiz_question_explanation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_ver uuid;
  v_q uuid;
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  v_q := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  select cb.course_version_id into v_ver
    from public.quiz_questions qq
    join public.quizzes qz on qz.id = qq.quiz_id
    join public.course_blocks cb on cb.id = qz.course_block_id
   where qq.id = v_q;

  if public.course_version_is_published(v_ver) then
    raise exception 'quiz_question_explanation belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.admin_emergency_update_course_block(
  p_course_block_id uuid,
  p_reason text,
  p_title text default null,
  p_body jsonb default null,
  p_video_url text default null,
  p_document_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old public.course_blocks%rowtype;
  v_new public.course_blocks%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can make emergency course content corrections.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(coalesce(btrim(p_reason), '')) < 10 then
    raise exception 'A reason of at least 10 characters is required for emergency course content corrections.'
      using errcode = 'check_violation';
  end if;

  select * into v_old
    from public.course_blocks
   where id = p_course_block_id;

  if not found then
    raise exception 'Course block % not found.', p_course_block_id
      using errcode = 'no_data_found';
  end if;

  perform set_config('app.privileged_write', 'on', true);

  update public.course_blocks
     set title = coalesce(p_title, title),
         body = coalesce(p_body, body),
         video_url = coalesce(p_video_url, video_url),
         document_id = coalesce(p_document_id, document_id)
   where id = p_course_block_id
   returning * into v_new;

  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    v_new.organization_id,
    auth.uid(),
    'course_blocks',
    v_new.id::text,
    'course_block_emergency_corrected',
    to_jsonb(v_old),
    jsonb_build_object('reason', p_reason, 'row', to_jsonb(v_new))
  );
end;
$function$;

-- Course document rows should be readable anywhere their storage object is
-- readable: system-catalog documents for every authenticated learner and
-- org-scoped course documents for that organization.
alter policy training_documents_select on public.training_documents using (
  public.is_platform_admin()
  or (
    storage_bucket = 'course-documents'
    and (
      split_part(storage_path, '/', 1) = 'system'
      or split_part(storage_path, '/', 1) = (select public.current_org_id())::text
    )
  )
  or (employee_id is not null and exists (
    select 1 from public.employees e
     where e.id = training_documents.employee_id
       and e.profile_id = (select auth.uid())
  ))
  or (
    organization_id = (select public.current_org_id())
    and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id))
  )
);

revoke all on function public.get_course_version_publish_issues(uuid) from public;
revoke all on function public.assert_course_version_publish_ready(uuid) from public;
revoke all on function public.publish_course_version(uuid) from public;
revoke all on function public.admin_emergency_update_course_block(uuid, text, text, jsonb, text, uuid) from public;

grant execute on function public.get_course_version_publish_issues(uuid) to authenticated, service_role;
grant execute on function public.assert_course_version_publish_ready(uuid) to service_role;
grant execute on function public.publish_course_version(uuid) to authenticated, service_role;
grant execute on function public.admin_emergency_update_course_block(uuid, text, text, jsonb, text, uuid) to authenticated, service_role;

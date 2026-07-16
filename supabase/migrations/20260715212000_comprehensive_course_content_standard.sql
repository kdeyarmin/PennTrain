-- A published duration must describe the curriculum learners actually receive.
--
-- Earlier catalog seeds could label a few paragraphs as a 12- or 24-hour
-- annual course.  `comprehensive` versions opt in to a stronger, database-
-- enforced contract: explicit designed time on every step, complete learning
-- objectives, application work, sources, a meaningful assessment, and a
-- designed-time total that exactly matches the catalog duration.

alter table public.course_versions
  add column content_standard text not null default 'legacy'
  constraint course_versions_content_standard_check
  check (content_standard in ('legacy', 'comprehensive'));

comment on column public.course_versions.content_standard is
  'comprehensive versions must satisfy the duration, application, sourcing, and assessment publication gate; legacy preserves historical versions.';

comment on column public.course_progress.learning_tools is
  'Learner notes and confidence by course block; comprehensive self-completion requires a substantive note for each scenario and practice block.';

create or replace function public.get_course_version_designed_minutes(p_version_id uuid)
returns integer
language sql
stable
security definer
set search_path = 'public'
as $function$
  -- Match the complete supported range before casting. In particular, do not
  -- cast arbitrary JSON text and then test its bounds: a very large digit
  -- string would raise integer-out-of-range instead of becoming a readiness
  -- issue. Return NULL rather than overflowing the function's integer contract
  -- in the theoretical case that the valid per-block values exceed int4 when
  -- summed.
  select case
    when totals.designed_minutes <= 2147483647
      then totals.designed_minutes::integer
    else null
  end
  from (
    select coalesce(sum((cb.body ->> 'estimated_minutes')::smallint), 0)::bigint
      as designed_minutes
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and coalesce(cb.body ->> 'estimated_minutes', '')
        ~ '^([1-9]|[1-9][0-9]|1[01][0-9]|120)$'
  ) totals;
$function$;

comment on function public.get_course_version_designed_minutes(uuid) is
  'Returns the overflow-safe sum of valid 1-120 designed block minutes for a course version; invalid values are excluded and an int4-total overflow returns NULL.';

create or replace function public.get_comprehensive_course_version_issues(p_version_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
declare
  v_issues text[] := array[]::text[];
  v_version public.course_versions%rowtype;
  v_course public.courses%rowtype;
  v_block_count integer;
  v_required_blocks integer;
  v_designed_minutes integer;
  v_question_count integer;
  v_required_questions integer;
begin
  if not public.is_platform_admin()
     and coalesce(current_setting('app.privileged_write', true), '') is distinct from 'on' then
    raise exception 'Only platform administrators can inspect comprehensive course publish readiness.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_version
  from public.course_versions
  where id = p_version_id;

  if not found then
    return array['Course version not found.'];
  end if;

  if v_version.content_standard <> 'comprehensive' then
    return v_issues;
  end if;

  select * into v_course
  from public.courses
  where id = v_version.course_id;

  if not found then
    return array['Owning course not found.'];
  end if;

  if coalesce(v_course.estimated_duration_minutes, 0) < 15 then
    v_issues := array_append(v_issues, 'Set a course duration of at least 15 minutes.');
  end if;

  if concat_ws(' ', v_course.title, v_course.description, v_version.title, v_version.description)
       ~* '\m(starter|placeholder|sample course|no-credit starter)\M' then
    v_issues := array_append(v_issues, 'Remove starter, placeholder, and sample-course language from a comprehensive version.');
  end if;

  select count(*) into v_block_count
  from public.course_blocks cb
  where cb.course_version_id = p_version_id;

  v_required_blocks := greatest(
    8,
    ceil(coalesce(v_course.estimated_duration_minutes, 0) / 45.0)::integer + 3
  );
  if v_block_count < v_required_blocks then
    v_issues := array_append(
      v_issues,
      format('Add at least %s sequenced learning steps for this duration.', v_required_blocks)
    );
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and (
        cb.body is null
        or coalesce(cb.body ->> 'estimated_minutes', '')
          !~ '^([1-9]|[1-9][0-9]|1[01][0-9]|120)$'
      )
  ) then
    v_issues := array_append(v_issues, 'Every step needs 1-120 explicit estimated_minutes.');
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and coalesce(btrim(cb.body ->> 'activity_type'), '') not in (
        'objectives',
        'instruction',
        'guided_instruction',
        'scenario',
        'practice',
        'facility_verification',
        'sources',
        'assessment'
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Every step needs a supported activity_type.'
    );
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.block_type = 'text'
      and length(coalesce(btrim(cb.body ->> 'content'), '')) < 120
  ) then
    v_issues := array_append(v_issues, 'Every written learning step needs at least 120 characters of substantive content.');
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.block_type = 'text'
      and cb.body ->> 'activity_type' in (
        'instruction', 'guided_instruction', 'scenario', 'practice',
        'facility_verification'
      )
      and cardinality(
        regexp_split_to_array(btrim(coalesce(cb.body ->> 'content', '')), E'\\s+')
      ) < greatest(
        80,
        4 * case
          when coalesce(cb.body ->> 'estimated_minutes', '')
            ~ '^([1-9]|[1-9][0-9]|1[01][0-9]|120)$'
            then (cb.body ->> 'estimated_minutes')::smallint
          else 0
        end
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Expand long instruction and application steps so their learner-visible guidance and work are credible for the designed time.'
    );
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' in ('scenario', 'practice')
      and coalesce(cb.body ->> 'content', '') ~* '(recommended response|correct answer)[[:space:]]*:'
  ) then
    v_issues := array_append(
      v_issues,
      'Withhold recommended responses and correct answers until after the learner completes applied work.'
    );
  end if;

  if not exists (
    select 1 from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' = 'objectives'
  ) then
    v_issues := array_append(v_issues, 'Add a measurable learning-objectives step.');
  end if;

  if (
    select count(*) from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' in (
        'instruction', 'guided_instruction', 'practice', 'facility_verification'
      )
  ) < 4 then
    v_issues := array_append(v_issues, 'Add at least four substantive instruction or guided-practice steps.');
  end if;

  if (
    select count(*) from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' in ('scenario', 'practice')
  ) < 2 then
    v_issues := array_append(v_issues, 'Add at least two scenario or practice steps.');
  end if;

  if not exists (
    select 1 from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' = 'sources'
  ) then
    v_issues := array_append(v_issues, 'Add a sources and scope step.');
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' = 'sources'
      and (
        cb.block_type <> 'text'
        or length(coalesce(btrim(cb.body ->> 'content'), '')) < 160
        or coalesce(cb.body ->> 'content', '') !~* 'https?://[^[:space:]]+'
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Add substantive source context and at least one http(s) citation to every sources step.'
    );
  end if;

  -- System catalog courses make regulatory claims for many organizations, so
  -- their authority must include a government-hosted primary source. An
  -- organization-authored comprehensive course still needs an http(s) source,
  -- but may properly cite its own official policy or a non-government standard.
  if v_course.organization_id is null and exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.body ->> 'activity_type' = 'sources'
      and coalesce(cb.body ->> 'content', '')
        !~* 'https?://([[:alnum:]-]+\.)*[[:alnum:]-]+\.gov([/:?#]|[[:space:]]|$)'
  ) then
    v_issues := array_append(
      v_issues,
      'System course sources must include an official government http(s) URL.'
    );
  end if;

  if not exists (
    select 1 from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.block_type = 'quiz'
      and cb.body ->> 'activity_type' = 'assessment'
  ) then
    v_issues := array_append(v_issues, 'Add a timed final assessment step.');
  end if;

  if exists (
    select 1
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and (
        q.passing_score_percent < 80
        or q.max_attempts is null
        or q.max_attempts not between 1 and 5
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Use an assessment passing score of at least 80 percent and one to five allowed attempts.'
    );
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
    group by cb.sort_order
    having count(*) > 1
  ) then
    v_issues := array_append(v_issues, 'Course step sort orders must be unique.');
  end if;

  v_designed_minutes := public.get_course_version_designed_minutes(p_version_id);
  if v_designed_minutes is null then
    v_issues := array_append(
      v_issues,
      'Designed step time exceeds the supported course-duration range.'
    );
  elsif v_designed_minutes <> coalesce(v_course.estimated_duration_minutes, 0) then
    v_issues := array_append(
      v_issues,
      format(
        'Designed step time (%s minutes) must equal the catalog duration (%s minutes).',
        v_designed_minutes,
        coalesce(v_course.estimated_duration_minutes, 0)
      )
    );
  end if;

  select count(*) into v_question_count
  from public.quiz_questions qq
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  where cb.course_version_id = p_version_id;

  v_required_questions := greatest(
    5,
    least(12, ceil(coalesce(v_course.estimated_duration_minutes, 0) / 60.0)::integer)
  );
  if v_question_count < v_required_questions then
    v_issues := array_append(
      v_issues,
      format('Add at least %s final-assessment questions for this duration.', v_required_questions)
    );
  end if;

  if exists (
    select 1
    from public.quiz_questions qq
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    left join public.quiz_question_explanations qx on qx.question_id = qq.id
    where cb.course_version_id = p_version_id
      and length(coalesce(btrim(qx.explanation), '')) < 60
  ) then
    v_issues := array_append(v_issues, 'Every assessment question needs a useful answer explanation.');
  end if;

  if exists (
    select 1
    from public.quiz_questions qq
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and length(btrim(qq.question_text)) < 25
  ) then
    v_issues := array_append(v_issues, 'Every assessment prompt needs at least 25 characters of context.');
  end if;

  if exists (
    select 1
    from public.quiz_answers qa
    join public.quiz_questions qq on qq.id = qa.question_id
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and length(btrim(qa.answer_text)) < 15
  ) then
    v_issues := array_append(v_issues, 'Every assessment choice needs at least 15 characters of meaningful text.');
  end if;

  if exists (
    select 1
    from public.quiz_questions qq
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and (
        (select count(*) from public.quiz_answers qa where qa.question_id = qq.id) <> 4
        or (select count(*) from public.quiz_answers qa where qa.question_id = qq.id and qa.is_correct) <> 1
        or (
          select count(distinct lower(btrim(qa.answer_text)))
          from public.quiz_answers qa
          where qa.question_id = qq.id
        ) <> 4
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Every assessment question needs exactly four unique choices and one correct answer.'
    );
  end if;

  if exists (
    select 1
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and (select count(*) from public.quiz_questions qq where qq.quiz_id = q.id) >= 8
      and (
        select count(distinct lower(btrim(qa.answer_text)))
        from public.quiz_questions qq
        join public.quiz_answers qa on qa.question_id = qq.id
        where qq.quiz_id = q.id
          and not qa.is_correct
      ) < ceil(
        0.75 * (
          select count(*)
          from public.quiz_questions qq
          join public.quiz_answers qa on qa.question_id = qq.id
          where qq.quiz_id = q.id
            and not qa.is_correct
        )
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Replace repeated generic distractors with plausible course-specific assessment choices.'
    );
  end if;

  if exists (
    select 1
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and (
        select count(*) from public.quiz_questions qq where qq.quiz_id = q.id
      ) >= 8
      and (
        select count(distinct qa.sort_order)
        from public.quiz_questions qq
        join public.quiz_answers qa on qa.question_id = qq.id and qa.is_correct
        where qq.quiz_id = q.id
      ) < 3
  ) then
    v_issues := array_append(v_issues, 'Vary correct-answer positions across at least three choices.');
  end if;

  return v_issues;
end;
$function$;

create or replace function public.enforce_comprehensive_course_version_ready()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_issues text[];
begin
  if new.status = 'published' and new.content_standard = 'comprehensive' then
    v_issues := public.get_comprehensive_course_version_issues(new.id);
    if coalesce(array_length(v_issues, 1), 0) > 0 then
      raise exception 'Comprehensive course version is not ready to publish: %',
        array_to_string(v_issues, ' ')
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_comprehensive_course_version_ready on public.course_versions;
create trigger enforce_comprehensive_course_version_ready
  before insert or update of status, content_standard on public.course_versions
  for each row execute function public.enforce_comprehensive_course_version_ready();

-- A catalog duration is part of the learner's published evidence contract. An
-- ordinary metadata edit must not make a current comprehensive curriculum look
-- longer or shorter after publication. Trusted migrations and the eventual
-- atomic new-version publication path can deliberately opt in via the same
-- transaction-local privileged-write flag used by the content immutability
-- guards. Status archival and current_version_id-only writes do not fire this
-- trigger.
create or replace function public.protect_published_comprehensive_course_duration()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
begin
  if new.estimated_duration_minutes is not distinct from old.estimated_duration_minutes
     or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return new;
  end if;

  if exists (
    select 1
    from public.course_versions cv
    where cv.id = old.current_version_id
      and cv.course_id = old.id
      and cv.status = 'published'
      and cv.content_standard = 'comprehensive'
  ) then
    raise exception 'published comprehensive course duration is immutable; create and publish a new version'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_published_comprehensive_course_duration on public.courses;
create trigger protect_published_comprehensive_course_duration
  before update of estimated_duration_minutes on public.courses
  for each row execute function public.protect_published_comprehensive_course_duration();

-- A published historical version can remain immutable after its catalog course
-- is archived. Prevent direct inserts from using that version to bypass the
-- normal published-course availability checks, while leaving existing
-- assignments untouched.
create or replace function public.validate_course_assignment_version()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_version_status text;
  v_course_status text;
  v_version_course_id uuid;
  v_current_version_id uuid;
  v_ai_generated boolean;
  v_ai_reviewed_at timestamptz;
begin
  select cv.status, cv.course_id, cv.ai_generated, cv.ai_reviewed_at,
         c.status, c.current_version_id
    into v_version_status, v_version_course_id, v_ai_generated, v_ai_reviewed_at,
         v_course_status, v_current_version_id
  from public.course_versions cv
  join public.courses c on c.id = new.course_id
  where cv.id = new.course_version_id;

  if v_version_status is null then
    raise exception 'course version % or course % not found', new.course_version_id, new.course_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_version_course_id is distinct from new.course_id then
    raise exception 'course version % does not belong to course %', new.course_version_id, new.course_id
      using errcode = 'check_violation';
  end if;

  if v_current_version_id is distinct from new.course_version_id then
    raise exception 'new assignments must use the course current version'
      using errcode = 'check_violation';
  end if;

  if v_course_status <> 'published' then
    raise exception 'cannot create a new assignment for an archived or draft course'
      using errcode = 'check_violation';
  end if;

  if v_version_status <> 'published' then
    raise exception 'cannot assign course_version %; it is not published', new.course_version_id
      using errcode = 'check_violation';
  end if;

  if v_ai_generated and v_ai_reviewed_at is null then
    raise exception 'cannot assign course_version %; its AI-generated content has not completed the required review', new.course_version_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_course_assignment_version() from public, anon, authenticated;

-- Once a completion is certified, the progress row that supported it becomes
-- immutable evidence. Review mode may read it but cannot move the last step,
-- lower completion, erase applied responses, or rewrite video state.
create or replace function public.protect_completed_course_progress_evidence()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_old_assignment_id uuid := case when tg_op = 'INSERT' then null else old.assignment_id end;
  v_new_assignment_id uuid := case when tg_op = 'DELETE' then null else new.assignment_id end;
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE'
     and new.assignment_id is distinct from old.assignment_id then
    raise exception 'course progress assignment is immutable'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.course_assignments ca
    where ca.id in (v_old_assignment_id, v_new_assignment_id)
      and ca.status = 'completed'
  ) then
    raise exception 'completed course progress evidence is immutable'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists protect_completed_course_progress_evidence on public.course_progress;
create trigger protect_completed_course_progress_evidence
  before insert or update or delete on public.course_progress
  for each row execute function public.protect_completed_course_progress_evidence();

create or replace function public.protect_completed_quiz_attempt_evidence()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_old_assignment_id uuid := case when tg_op = 'INSERT' then null else old.assignment_id end;
  v_new_assignment_id uuid := case when tg_op = 'DELETE' then null else new.assignment_id end;
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and (
       new.organization_id is distinct from old.organization_id
       or new.facility_id is distinct from old.facility_id
       or new.assignment_id is distinct from old.assignment_id
       or new.quiz_id is distinct from old.quiz_id
       or new.employee_id is distinct from old.employee_id
       or new.attempt_number is distinct from old.attempt_number
       or new.started_at is distinct from old.started_at
     ) then
    raise exception 'quiz attempt assignment, quiz, learner, scope, and sequence are immutable'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from public.course_assignments ca
    where ca.id in (v_old_assignment_id, v_new_assignment_id)
      and ca.status = 'completed'
  ) then
    raise exception 'completed course quiz evidence is immutable'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create trigger protect_completed_quiz_attempt_evidence
  before insert or update or delete on public.quiz_attempts
  for each row execute function public.protect_completed_quiz_attempt_evidence();

create or replace function public.protect_completed_quiz_answer_evidence()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_old_attempt_id uuid := case when tg_op = 'INSERT' then null else old.attempt_id end;
  v_new_attempt_id uuid := case when tg_op = 'DELETE' then null else new.attempt_id end;
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and (
       new.attempt_id is distinct from old.attempt_id
       or new.question_id is distinct from old.question_id
     ) then
    raise exception 'quiz answer attempt and question are immutable'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.quiz_attempts qa
    join public.course_assignments ca on ca.id = qa.assignment_id
    where qa.id in (v_old_attempt_id, v_new_attempt_id)
      and ca.status = 'completed'
  ) then
    raise exception 'completed course quiz evidence is immutable'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create trigger protect_completed_quiz_answer_evidence
  before insert or update or delete on public.quiz_attempt_answers
  for each row execute function public.protect_completed_quiz_answer_evidence();

-- The legacy completion RPC intentionally uses a light 10%-of-duration anti-
-- click-through check. Comprehensive courses carry regulatory training time,
-- so every completion path must instead reach every step, respond to every
-- applied activity, pass every quiz, and span the full designed duration.
-- Instructor-led or external evidence belongs in the attendance/training-record
-- workflows rather than a one-click completion of an online assignment.
create or replace function public.require_comprehensive_self_completion()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_duration_minutes integer;
  v_progress public.course_progress%rowtype;
  v_final_block_id uuid;
begin
  if tg_op <> 'UPDATE'
     or old.status = 'completed'
     or new.status <> 'completed'
     or not exists (
       select 1
       from public.course_versions cv
       where cv.id = new.course_version_id
         and cv.content_standard = 'comprehensive'
     ) then
    return new;
  end if;

  -- Seat time belongs to the immutable version pinned to this assignment.
  -- A later catalog version or duration change must not rewrite an in-flight
  -- learner's completion threshold.
  v_duration_minutes := public.get_course_version_designed_minutes(new.course_version_id);

  select * into v_progress
  from public.course_progress cp
  where cp.assignment_id = new.id;

  if v_progress.started_at is null
     or coalesce(v_progress.percent_complete, 0) < 100 then
    raise exception 'Comprehensive training requires 100 percent course progress before completion.'
      using errcode = 'check_violation';
  end if;

  select cb.id into v_final_block_id
  from public.course_blocks cb
  where cb.course_version_id = new.course_version_id
  order by cb.sort_order desc, cb.id desc
  limit 1;

  if v_progress.last_block_id is distinct from v_final_block_id then
    raise exception 'Comprehensive training requires reaching the final course step.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = new.course_version_id
      and cb.body ->> 'activity_type' in ('scenario', 'practice')
      and length(
        btrim(coalesce(v_progress.learning_tools -> 'notes' ->> cb.id::text, ''))
      ) < 80
  ) then
    raise exception 'Comprehensive training requires a written response for every applied scenario and practice step.'
      using errcode = 'check_violation',
            hint = 'Return to each applied activity and record what you would do on the job.';
  end if;

  if extract(epoch from (now() - v_progress.started_at))
       < coalesce(v_duration_minutes, 0) * 60 then
    raise exception 'Comprehensive training requires the full designed engagement time of % minute(s).',
      coalesce(v_duration_minutes, 0)
      using errcode = 'check_violation',
            hint = 'Continue the assigned instruction and application work, then try again.';
  end if;

  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = new.course_version_id
      and cb.block_type = 'quiz'
      and not exists (
        select 1
        from public.quizzes q
        join public.quiz_attempts qa on qa.quiz_id = q.id
        where q.course_block_id = cb.id
          and qa.assignment_id = new.id
          and qa.passed
      )
  ) then
    raise exception 'Comprehensive training requires a passing attempt for every assessment.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

drop trigger if exists require_comprehensive_self_completion on public.course_assignments;
create trigger require_comprehensive_self_completion
  before update of status on public.course_assignments
  for each row execute function public.require_comprehensive_self_completion();

revoke all on function public.get_course_version_designed_minutes(uuid) from public, anon, authenticated;
revoke all on function public.get_comprehensive_course_version_issues(uuid) from public, anon;
revoke all on function public.enforce_comprehensive_course_version_ready() from public, anon, authenticated, service_role;
revoke all on function public.protect_published_comprehensive_course_duration() from public, anon, authenticated, service_role;
revoke all on function public.require_comprehensive_self_completion() from public, anon, authenticated, service_role;
revoke all on function public.protect_completed_course_progress_evidence() from public, anon, authenticated, service_role;
revoke all on function public.protect_completed_quiz_attempt_evidence() from public, anon, authenticated, service_role;
revoke all on function public.protect_completed_quiz_answer_evidence() from public, anon, authenticated, service_role;

grant execute on function public.get_course_version_designed_minutes(uuid) to service_role;
grant execute on function public.get_comprehensive_course_version_issues(uuid) to authenticated, service_role;

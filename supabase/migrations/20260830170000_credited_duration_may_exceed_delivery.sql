-- A version may deliver its course's credited duration in less step time than the catalog claims,
-- when the training provider records why.
--
-- The ask behind this: the annual diabetes course is credited as a four-hour course and its
-- written v2026.1 genuinely takes that long, but the video-led v2026.2 delivers the same
-- curriculum in about an hour. The comprehensive content standard required designed step time to
-- EQUAL the catalog duration exactly, so v2026.2 could never publish while the course stayed at
-- 240 minutes.
--
-- Worth being clear about which rule was actually in the way, because it is not the one it looks
-- like. validate_course_duration_for_compliance_credit() only fires when a course carries an
-- active course_compliance_credits row, and the diabetes course carries none; with the catalog
-- duration at 240 minutes that trigger would in any case permit up to 4.00 credit hours, which is
-- the number the course is meant to carry. It is untouched here, and so is every other course.
--
-- What changes is one branch of get_comprehensive_course_version_issues(). Exact equality remains
-- the default and remains the point of the standard -- 20260715212000 added it because earlier
-- seeds could label a few paragraphs a 24-hour annual course. The exception is opt-in per version,
-- requires 40 characters of written justification, is audited on every change, and only ever
-- permits delivering in LESS time than the catalog credits. A version whose steps exceed the
-- catalog duration is still rejected: that is the direction in which a learner is credited for
-- less than they were asked to do.
--
-- The learner-facing consequence is the one that was wanted. require_comprehensive_self_completion()
-- measures engagement against the VERSION's designed step time, not the catalog duration, so
-- v2026.2 asks for about an hour rather than four. complete_course_assignment()'s own floor stays
-- at ten percent of the catalog duration, twenty-four minutes here. The course continues to
-- record 4.00 hours on employee_training_records, because estimated_duration_minutes stays 240.
--
-- Because that difference is now real, it must not be discoverable only by arithmetic: the course
-- authoring screen prints both numbers and the rationale wherever it prints the duration.

alter table public.course_versions
  add column credited_duration_rationale text
    constraint course_versions_credited_duration_rationale_check
    check (
      credited_duration_rationale is null
      or length(btrim(credited_duration_rationale)) >= 40
    );

comment on column public.course_versions.credited_duration_rationale is
  'The training provider''s written determination that this version delivers the course''s credited duration in less designed step time than the catalog duration claims. Null means the two must match exactly, which is the default and the norm. Never permits designed step time to exceed the catalog duration.';

-- A credited-duration variance is a compliance-affecting claim about a published course, so who
-- introduced, changed, or withdrew one has to be reconstructable afterwards -- the same reason a
-- passing-score change is audited rather than trusted to whichever screen made it.
create or replace function public.audit_credited_duration_rationale()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.credited_duration_rationale is not distinct from old.credited_duration_rationale then
    return new;
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values
  )
  values (
    new.organization_id,
    auth.uid(),
    'course_versions',
    new.id::text,
    'course_credited_duration_rationale_changed',
    jsonb_build_object('credited_duration_rationale', old.credited_duration_rationale),
    jsonb_build_object('credited_duration_rationale', new.credited_duration_rationale)
  );
  return new;
end;
$function$;

revoke all on function public.audit_credited_duration_rationale()
  from public, anon, authenticated, service_role;

create trigger audit_credited_duration_rationale
  after update of credited_duration_rationale on public.course_versions
  for each row execute function public.audit_credited_duration_rationale();

-- Reproduced in full from 20260830120000 with one branch changed; everything else is byte-identical.
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
        'assessment',
        'attestation'
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
    from public.course_blocks cb
    where cb.course_version_id = p_version_id
      and cb.block_type = 'attestation'
      and (
        length(coalesce(btrim(cb.body ->> 'attestation_text'), '')) < 40
        or coalesce(btrim(cb.body ->> 'attestation_version'), '') = ''
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Give every attestation step a statement of at least 40 characters and an attestation_version.'
    );
  end if;

  if exists (
    select 1
    from public.quizzes q
    join public.course_blocks cb on cb.id = q.course_block_id
    where cb.course_version_id = p_version_id
      and (
        q.passing_score_percent < 80
        or (q.max_attempts is not null and q.max_attempts not between 1 and 5)
      )
  ) then
    v_issues := array_append(
      v_issues,
      'Use an assessment passing score of at least 80 percent, and either unlimited attempts or a cap of one to five.'
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

  -- Designed step time against the catalog duration.
  --
  -- The default is still exact equality, and that default is the whole reason this standard
  -- exists: earlier catalog seeds could label a few paragraphs a 12- or 24-hour annual course,
  -- and nothing stopped them. A version that says nothing about the difference must not have one.
  --
  -- The exception is opt-in, per version, and has to be argued in writing.
  -- credited_duration_rationale is the training provider's recorded determination that this
  -- version delivers the course's credited duration in less step time than the catalog claims --
  -- a video-led rebuild of a written course being the case it was added for. It only ever permits
  -- delivering in LESS time. A version whose steps exceed the catalog duration is still rejected,
  -- because that is the direction where a learner is credited for less than they were asked to do.
  v_designed_minutes := public.get_course_version_designed_minutes(p_version_id);
  if v_designed_minutes is null then
    v_issues := array_append(
      v_issues,
      'Designed step time exceeds the supported course-duration range.'
    );
  elsif v_version.credited_duration_rationale is null then
    if v_designed_minutes <> coalesce(v_course.estimated_duration_minutes, 0) then
      v_issues := array_append(
        v_issues,
        format(
          'Designed step time (%s minutes) must equal the catalog duration (%s minutes), or record a credited_duration_rationale explaining the difference.',
          v_designed_minutes,
          coalesce(v_course.estimated_duration_minutes, 0)
        )
      );
    end if;
  elsif v_designed_minutes > coalesce(v_course.estimated_duration_minutes, 0) then
    v_issues := array_append(
      v_issues,
      format(
        'Designed step time (%s minutes) exceeds the catalog duration (%s minutes); a rationale can shorten delivery, never lengthen it past what the course credits.',
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

-- Record the determination on the diabetes course's video version. v2026.1 is untouched: its
-- designed step time already equals the catalog duration exactly, so it needs no rationale and
-- keeps the strict rule.
update public.course_versions
set credited_duration_rationale =
  'Credited as a four-hour course. v2026.1 delivers that curriculum in writing and takes the full '
  || 'four hours; this version delivers the same twelve modules, the same thirty-question '
  || 'examination at 90 percent, and the same attestation as thirty minutes of presenter video, '
  || 'which a learner completes in about an hour. The credited duration reflects the instructional '
  || 'content and assessment the training provider determined the course carries, not the fastest '
  || 'path through the video. Determined by the course''s CDCES training provider of record; see '
  || 'course_provider_profiles for the responsible provider and the clinical review dates.'
where id = 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid;

do $verify$
declare
  v_course_minutes integer;
  v_designed integer;
  v_rationale text;
  v_issues text[];
begin
  select c.estimated_duration_minutes, cv.credited_duration_rationale
    into v_course_minutes, v_rationale
  from public.course_versions cv
  join public.courses c on c.id = cv.course_id
  where cv.id = 'e4bac606-1e4d-502d-ad34-017266b664cb'::uuid;

  if v_rationale is null then
    raise exception 'the diabetes video version did not receive its credited-duration rationale';
  end if;
  if v_course_minutes <> 240 then
    raise exception 'the diabetes course should still credit 240 minutes, found %', v_course_minutes;
  end if;

  select public.get_course_version_designed_minutes('e4bac606-1e4d-502d-ad34-017266b664cb'::uuid)
    into v_designed;
  if v_designed <> 60 then
    raise exception 'the diabetes video version should deliver in 60 minutes, found %', v_designed;
  end if;

  -- The gate now accepts the version. Everything else it checks is unchanged, so a non-empty
  -- result here would mean this migration broke a rule it was not supposed to touch.
  perform set_config('app.privileged_write', 'on', true);
  v_issues := public.get_comprehensive_course_version_issues('e4bac606-1e4d-502d-ad34-017266b664cb'::uuid);
  perform set_config('app.privileged_write', 'off', true);

  if coalesce(array_length(v_issues, 1), 0) > 0 then
    raise exception 'the diabetes video version still reports publish issues: %',
      array_to_string(v_issues, ' ');
  end if;
end;
$verify$;

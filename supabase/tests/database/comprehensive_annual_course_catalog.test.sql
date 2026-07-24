-- Catalog-wide proof that the regulatory annual courses are complete,
-- individually assignable, duration-aligned, and safely crosswalked.

begin;
select plan(30);

select has_column(
  'public',
  'course_versions',
  'content_standard',
  'course versions identify the comprehensive content standard'
);

select has_function(
  'public',
  'get_course_version_designed_minutes',
  array['uuid'],
  'designed course time is calculated by the database'
);

select has_function(
  'public',
  'get_comprehensive_course_version_issues',
  array['uuid'],
  'comprehensive publication readiness is inspectable'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_comprehensive_course_version_issues(uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot inspect draft course readiness'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_course_version_designed_minutes(uuid)',
    'EXECUTE'
  ),
  'learners cannot use the internal designed-time helper directly'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    where c.organization_id is null
      and c.status = 'published'
      and c.catalog_code is not null
  ),
  71,
  'the published system catalog contains 71 individually cataloged modules (70 annual, plus one one-time new-hire orientation)'
);

select results_eq(
  $$
    select
      count(*)::integer,
      count(*) filter (where c.training_type_id is not null)::integer
    from public.courses c
    where c.organization_id is null
      and c.status = 'archived'
      and c.catalog_code is null
  $$,
  $$ values (8, 8) $$,
  'all eight aggregate courses are archived while retaining the bridge needed by already-open historical assignments'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    left join public.course_versions cv on cv.id = c.current_version_id
    where c.organization_id is null
      and c.status = 'published'
      and c.catalog_code is not null
      and (
        cv.id is null
        or cv.status <> 'published'
        or cv.content_standard <> 'comprehensive'
      )
  ),
  0,
  'every published individual annual module points to a comprehensive version'
);

select is(
  (
    select count(*)::integer
    from public.course_compliance_credits cc
    join public.courses c on c.id = cc.course_id
    where c.organization_id is null
      and c.catalog_code is not null
      and cc.is_active
      and cc.course_version_id is distinct from c.current_version_id
  ),
  0,
  'no superseded starter version retains an active regulatory mapping'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    join public.course_versions cv on cv.id = c.current_version_id
    where c.organization_id is null
      and c.status = 'published'
      and cv.content_standard = 'comprehensive'
      and public.get_course_version_designed_minutes(cv.id)
        <> c.estimated_duration_minutes
  ),
  0,
  'every comprehensive curriculum exactly matches its catalog duration'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    join public.course_blocks cb on cb.course_version_id = c.current_version_id
    where c.organization_id is null
      and c.status = 'published'
      and (
        coalesce(cb.body ->> 'estimated_minutes', '') !~ '^[1-9][0-9]*$'
        or (cb.body ->> 'estimated_minutes')::integer > 120
        or coalesce(cb.body ->> 'activity_type', '') = ''
      )
  ),
  0,
  'every learning step has valid designed time and purpose metadata'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    join public.course_blocks cb on cb.course_version_id = c.current_version_id
    where c.organization_id is null
      and c.status = 'published'
      and cb.block_type = 'text'
      and cb.body ->> 'activity_type' in ('instruction', 'scenario', 'practice')
      and cardinality(
        regexp_split_to_array(btrim(coalesce(cb.body ->> 'content', '')), E'\\s+')
      ) < greatest(80, 4 * (cb.body ->> 'estimated_minutes')::integer)
  ),
  0,
  'every instruction and applied block contains credible learner-visible work for its designed time'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    where c.organization_id is null
      and c.status = 'published'
      and not exists (
        select 1
        from public.course_blocks cb
        where cb.course_version_id = c.current_version_id
          and cb.body ->> 'activity_type' = 'objectives'
      )
  ),
  0,
  'every individual annual module begins with learning objectives'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    where c.organization_id is null
      and c.status = 'published'
      and (
        select count(*)
        from public.course_blocks cb
        where cb.course_version_id = c.current_version_id
          and cb.body ->> 'activity_type' in ('scenario', 'practice')
      ) < 2
  ),
  0,
  'every individual annual module includes at least two applied activities'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    where c.organization_id is null
      and c.status = 'published'
      and not exists (
        select 1
        from public.course_blocks cb
        where cb.course_version_id = c.current_version_id
          and cb.body ->> 'activity_type' = 'sources'
          and cb.body ->> 'content' like '%https://%'
      )
  ),
  0,
  'every individual annual module cites an official source in learner content'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    where c.organization_id is null
      and c.status = 'published'
      and (
        select count(*)
        from public.quiz_questions qq
        join public.quizzes q on q.id = qq.quiz_id
        join public.course_blocks cb on cb.id = q.course_block_id
        where cb.course_version_id = c.current_version_id
      ) < 8
  ),
  0,
  'every individual annual module has at least eight final-assessment questions'
);

select is(
  (
    select count(*)::integer
    from public.quiz_questions qq
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.courses c on c.current_version_id = cb.course_version_id
    left join public.quiz_question_explanations qx on qx.question_id = qq.id
    where c.organization_id is null
      and c.status = 'published'
      and length(coalesce(btrim(qx.explanation), '')) < 60
  ),
  0,
  'every final-assessment question includes remediation feedback'
);

select is(
  (
    select count(*)::integer
    from public.quiz_questions qq
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.courses c on c.current_version_id = cb.course_version_id
    where c.organization_id is null
      and c.status = 'published'
      and (
        (
          select count(*) from public.quiz_answers qa where qa.question_id = qq.id
        ) <> 4
        or (
          select count(distinct lower(btrim(qa.answer_text)))
          from public.quiz_answers qa
          where qa.question_id = qq.id
        ) <> 4
      )
  ),
  0,
  'every final-assessment question provides four unique answer choices'
);

select is(
  (
    select count(*)::integer
    from public.quiz_questions qq
    join public.quizzes q on q.id = qq.quiz_id
    join public.course_blocks cb on cb.id = q.course_block_id
    join public.courses c on c.current_version_id = cb.course_version_id
    where c.organization_id is null
      and c.status = 'published'
      and (
        select count(*)
        from public.quiz_answers qa
        where qa.question_id = qq.id and qa.is_correct
      ) <> 1
  ),
  0,
  'every single-choice final question has one correct answer'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    join public.course_versions cv on cv.id = c.current_version_id
    join public.course_blocks cb on cb.course_version_id = cv.id
    join public.quizzes q on q.course_block_id = cb.id
    where c.organization_id is null
      and c.status = 'published'
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
  ),
  0,
  'every final assessment uses predominantly distinct course-specific distractors'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    join public.course_versions cv on cv.id = c.current_version_id
    where c.organization_id is null
      and c.status = 'published'
      and concat_ws(' ', c.title, c.description, cv.title, cv.description)
        ~* '\m(starter|placeholder|no-credit starter)\M'
  ),
  0,
  'published comprehensive curricula contain no starter or placeholder claims'
);

select results_eq(
  $$
    select split_part(c.catalog_code, '-', 2) as track,
           count(*)::integer,
           sum(c.estimated_duration_minutes)::integer
    from public.courses c
    where c.organization_id is null
      and c.status = 'published'
      and (
        c.catalog_code like 'PA-NH-AIDE-%'
        or c.catalog_code like 'PA-HHA-AIDE-%'
        or c.catalog_code like 'PA-HOS-AIDE-%'
      )
    group by split_part(c.catalog_code, '-', 2)
    order by track
  $$,
  $$
    values
      ('HHA'::text, 11, 720),
      ('HOS'::text, 12, 720),
      ('NH'::text, 11, 720)
  $$,
  'each clinical aide pathway contains its complete 12-hour module set'
);

select results_eq(
  $$
    select tt.code, sum(cc.credit_hours)::numeric(6,2)
    from public.course_compliance_credits cc
    join public.training_types tt on tt.id = cc.training_type_id
    join public.courses c on c.id = cc.course_id
      and c.current_version_id = cc.course_version_id
    where c.status = 'published'
      and (
        (tt.code = 'DIRECT-ANNUAL' and c.catalog_code not in (
          'PA-DHS-ANNUAL-MENTAL-ILLNESS-ID',
          'PA-DHS-ANNUAL-NEW-POPULATIONS',
          'PA-PCH-2600-236-DEMENTIA-FOUNDATIONS'
        ))
        or
        (tt.code = 'ALR-DIRECT-ANNUAL' and c.catalog_code not in (
          'PA-DHS-ANNUAL-MENTAL-ILLNESS-ID',
          'PA-DHS-ANNUAL-NEW-POPULATIONS'
        ))
      )
      and cc.is_active
    group by tt.code
    order by tt.code
  $$,
  $$
    values
      ('ALR-DIRECT-ANNUAL'::text, 16.00::numeric),
      ('DIRECT-ANNUAL'::text, 12.00::numeric)
  $$,
  'the unconditional PCH and ALR individual modules total the statutory minimums'
);

select is(
  (
    select sum(cc.credit_hours)::numeric(6,2)
    from public.course_compliance_credits cc
    join public.training_types tt on tt.id = cc.training_type_id
    join public.courses c on c.id = cc.course_id
      and c.current_version_id = cc.course_version_id
    where c.status = 'published'
      and tt.code = 'DEMENTIA'
      and c.catalog_code like 'PA-ALR-2800-69-DEMENTIA-PART-%'
      and cc.is_active
  ),
  2.00::numeric,
  'the two ALR general dementia modules total the additional annual two hours'
);

select results_eq(
  $$
    select tt.code, cc.credit_hours::numeric(6,2), cc.credit_mode
    from public.course_compliance_credits cc
    join public.training_types tt on tt.id = cc.training_type_id
    join public.courses c on c.id = cc.course_id
      and c.current_version_id = cc.course_version_id
    where c.status = 'published'
      and tt.code in (
        'PCH-DEMENTIA-UNIT',
        'ALR-DEMENTIA-SCU-ANNUAL',
        'ALR-INRBI-SCU-ANNUAL'
      )
    order by tt.code
  $$,
  $$
    values
      ('ALR-DEMENTIA-SCU-ANNUAL'::text, 8.00::numeric, 'verified_only'::text),
      ('ALR-INRBI-SCU-ANNUAL'::text, 8.00::numeric, 'verified_only'::text),
      ('PCH-DEMENTIA-UNIT'::text, 6.00::numeric, 'verified_only'::text)
  $$,
  'specialty-unit annual curricula carry full verified-only hours'
);

select is(
  (
    select count(*)::integer
    from public.course_compliance_credits cc
    join public.training_types tt on tt.id = cc.training_type_id
    join public.courses c on c.id = cc.course_id
      and c.current_version_id = cc.course_version_id
    where c.organization_id is null
      and c.status = 'published'
      and tt.code in ('HHA-AIDE-ANNUAL', 'HOS-AIDE-ANNUAL')
      and cc.credit_mode <> 'verified_only'
  ),
  0,
  'home-health and hospice aide hours always require employer RN verification'
);

select is(
  (
    select count(*)::integer
    from public.course_compliance_credits cc
    join public.courses c on c.id = cc.course_id
      and c.current_version_id = cc.course_version_id
    where c.organization_id is null
      and c.status = 'published'
      and c.catalog_code is not null
      and cc.is_active
      and cc.credit_mode <> 'verified_only'
  ),
  0,
  'all system-course credit awaits employer audience and evidence verification'
);

select results_eq(
  $$
    select count(*)::integer,
           sum(c.estimated_duration_minutes)::integer
    from public.courses c
    where c.organization_id is null
      and c.status = 'published'
      and c.catalog_code like 'PA-GH-6400-%'
      and c.catalog_code not like '%FIRE%'
      and c.catalog_code not like '%FIRST-AID%'
  $$,
  $$ values (14, 1440) $$,
  'the Chapter 6400 core is split into fourteen modules totaling 24 hours'
);

select is(
  (
    select count(*)::integer
    from public.courses c
    where c.organization_id is null
      and c.status = 'published'
      and c.catalog_code is not null
      and (
        c.recurrence_interval_days <> 365
        or c.training_type_id is not null
      )
  ),
  0,
  'individual annual modules recur annually and use only version-scoped credit mappings'
);

select set_config('app.privileged_write', 'on', true);
select is(
  (
    select count(*)::integer
    from public.courses c
    join public.course_versions cv on cv.id = c.current_version_id
    where c.organization_id is null
      and c.status = 'published'
      and coalesce(array_length(public.get_comprehensive_course_version_issues(cv.id), 1), 0) > 0
  ),
  0,
  'the database publication audit reports no comprehensive catalog issues'
);
select set_config('app.privileged_write', 'off', true);

select * from finish();
rollback;

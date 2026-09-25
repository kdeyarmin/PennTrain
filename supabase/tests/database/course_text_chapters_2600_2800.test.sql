-- BACKLOG.md REG28. Pins 20260925120400: platform course text says what Chapters 2600 / 2800 and
-- 6 Pa. Code 15.151 say about restraints, self-administration, fire-safety delivery and reporting.
begin;
select plan(11);

create temporary view pch_alf_platform_text as
select b.id, cv.status,
       coalesce(b.body->>'content', '') || ' ' || coalesce(b.body->>'script', '') as body_text
from public.course_blocks b
join public.course_versions cv on cv.id = b.course_version_id
join public.courses c on c.id = cv.course_id
where c.organization_id is null
  -- Nursing home, hospice and home health aide courses answer to other rules (REG11).
  and c.title !~* '(nursing home|hospice|home health)';

select is(
  (select count(*)::int from pch_alf_platform_text
   where body_text ~* '(unnecessary physical or chemical restraint|restraints may only be used|regulates their use narrowly|unauthorized restraint|specific approved intervention)'),
  0,
  'no PCH/ALF course says a restraint can be justified or authorized (2600.202 / 2800.202)'
);
select ok(
  (select body_text like '%2600.42(p) and 2800.42(p)%' and body_text like '%2600.202 and 2800.202%'
   from pch_alf_platform_text where id = 'cdfcf3a6-03b5-45ce-a17d-68d19ccb9c1a'),
  'the resident-rights course cites the right to be free from restraints and the prohibition'
);
select ok(
  (select bool_and(body_text like '%basket hold%') from pch_alf_platform_text
   where id in ('ecfaef18-2ad4-5cb6-9c87-ffba8dbe4396', '6e9ed303-c5d3-5010-9f80-ab2fab0ce776',
                '29d45fbf-abb5-5b84-8129-c4bcf84b9773')),
  'the safe-management course and its draft script say no hold is allowed, not even a basket hold'
);
select is(
  (select question_text ~* 'restraint' from public.quiz_questions where id = 'f708a1af-dab5-4760-b9fc-5dbf8c87a861'),
  false,
  'the rights quiz no longer grades a "safety basis" as the condition for using a restraint'
);
select ok(
  (select explanation like '%prohibit them outright%' from public.quiz_question_explanations
   where question_id = 'f708a1af-dab5-4760-b9fc-5dbf8c87a861'),
  'and its explanation says restraints are prohibited'
);

select is(
  (select count(*)::int from pch_alf_platform_text where body_text ~* 'presumed to self-administer'),
  0,
  'no course says residents are presumed to self-administer (2600.181(c), (e))'
);
select is(
  (select count(*)::int from public.quiz_answers a
   where a.answer_text ~* 'presumed to self-administer'),
  0,
  'and no quiz grades that answer'
);
select ok(
  (select bool_and(a.is_correct and a.answer_text like '%assessed the resident%')
   from public.quiz_answers a
   where a.id in ('669db167-579f-447f-a345-eb1b2193e8c5', '4433de84-a091-4c5c-9838-6d28f303d40f')),
  'the graded answer, same id, is now the physician / PA / CRNP assessment'
);

select ok(
  (select body_text like '%fire safety expert%' and body_text like '%2600.65(g)(1)%'
   from pch_alf_platform_text where id = '4b92e9b2-df95-4795-aa7c-ff387055f1d0'),
  'the fire-safety course says it counts only when a fire safety expert or trained staff person delivers it'
);

select ok(
  (select body_text like '%within 48 hours%' and body_text like '%15.151(a)%'
   from pch_alf_platform_text where id = '99ed5d84-8608-47a9-85c2-8adc19924497'),
  'the abuse-reporting course names the oral report to the agency and the 48-hour written report'
);
select ok(
  (select body_text like '%administrator or employee%' from pch_alf_platform_text
   where id = '57532d38-6084-41f6-a493-1877451ad3d9'),
  'and every administrator and employee is a reporter, not only direct-contact staff'
);

select * from finish();
rollback;

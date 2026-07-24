-- The comprehensive content standard requires every quiz answer choice to have
-- at least 15 characters of meaningful text. Three single-word/short distractors
-- on the "which category" exploitation question fell short. Lengthen them without
-- changing which answer is correct or the question's meaning.
update public.quiz_answers
set answer_text = 'Financial exploitation'
where question_id = 'df0d0452-061b-43f6-813b-f220b348debc'::uuid
  and answer_text = 'Exploitation';

update public.quiz_answers
set answer_text = 'Neglect of care needs'
where question_id = 'df0d0452-061b-43f6-813b-f220b348debc'::uuid
  and answer_text = 'Neglect';

update public.quiz_answers
set answer_text = 'Physical abuse of a resident'
where question_id = 'df0d0452-061b-43f6-813b-f220b348debc'::uuid
  and answer_text = 'Physical abuse';

do $sanity$
declare
  v_issues text[];
begin
  perform set_config('app.privileged_write', 'on', true);
  v_issues := public.get_comprehensive_course_version_issues('23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid);
  raise notice 'comprehensive-standard issues: %', v_issues;
end;
$sanity$;

-- The comprehensive content standard requires every quiz answer choice to have
-- at least 15 characters of meaningful text. Three single-word/short distractors
-- on the "which category" exploitation question fell short. Lengthen them without
-- changing which answer is correct or the question's meaning. Each UPDATE asserts
-- exactly one row affected: this migration exists to enforce a publishability
-- gate, so a silent no-op (if the source answer_text or question_id ever drifted
-- from what's expected) must fail the migration rather than leave the choice
-- short and let the later sanity check's RAISE NOTICE go unread in CI logs.
do $fix_answers$
declare
  v_updated integer;
begin
  update public.quiz_answers
  set answer_text = 'Financial exploitation'
  where question_id = 'df0d0452-061b-43f6-813b-f220b348debc'::uuid
    and answer_text = 'Exploitation';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one "Exploitation" answer choice, updated %', v_updated;
  end if;

  update public.quiz_answers
  set answer_text = 'Neglect of care needs'
  where question_id = 'df0d0452-061b-43f6-813b-f220b348debc'::uuid
    and answer_text = 'Neglect';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one "Neglect" answer choice, updated %', v_updated;
  end if;

  update public.quiz_answers
  set answer_text = 'Physical abuse of a resident'
  where question_id = 'df0d0452-061b-43f6-813b-f220b348debc'::uuid
    and answer_text = 'Physical abuse';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one "Physical abuse" answer choice, updated %', v_updated;
  end if;
end;
$fix_answers$;

do $sanity$
declare
  v_issues text[];
begin
  perform set_config('app.privileged_write', 'on', true);
  v_issues := public.get_comprehensive_course_version_issues('23ca08d4-afef-4b88-9db6-2f693d58588f'::uuid);
  raise notice 'comprehensive-standard issues: %', v_issues;
end;
$sanity$;

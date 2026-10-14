-- Three published standalone in-service courses credited nothing.
--
-- 20260726010100 / 010300 / 010400 added Falls Prevention, Emergency Preparedness and Medication
-- Self-Administration Support to the PA-DHS-STANDALONE- series beside Infection Control, but only
-- Infection Control was given a compliance crosswalk (its own INFECTION training type). The video
-- versions that replaced them (20260726020000 / 090000 / 110000) carried that gap forward, so a
-- learner who finished one of these hour-long courses earned a certificate that counted toward no
-- requirement. The October 9, 2026 catalog review found them; there is no dedicated training type
-- for these subjects, so each is credited the way the PA-DHS-ANNUAL- course on the same subject is:
-- toward the PCH direct-care annual hours (DIRECT-ANNUAL, 55 Pa. Code 2600.65) and the ALF
-- direct-care annual hours (ALR-DIRECT-ANNUAL, 2800.65), under the same annual topic codes.
--
-- The two sets now overlap by design. They credit the same annual topic, and a learner who takes
-- both is credited for both, because both hours were spent; the topic is satisfied either way.
-- Facilities should assign one per topic.
--
-- 1.00 hour each: the courses are designed at sixty minutes, and validate_course_compliance_credit
-- refuses more. Every crosswalk is verified_only, as on every other platform course, so a
-- completion never creates regulatory credit until the employer verifies it.
--
-- Safe Management (PA-DHS-STANDALONE-SAFE-MANAGEMENT) is deliberately left out. Lesson 9 of its
-- published version still narrates the restraint guidance that 20260925120400 corrected in the
-- text, and it is not credited until that lesson is re-rendered and a new version is published.
--
-- Each course is credited on the version it currently serves. In production that is the video
-- version (0515864b... / edc5dd31... / 3c06e92e...). Anywhere the renders were never re-hosted --
-- a fresh local stack, CI, a preview branch -- 20260726100000 / 030000 / 120000 left the video
-- version in draft and the course on its published written version 1, and that version is
-- credited instead, so the catalog reads the same everywhere. The current version must be
-- published and carry no crosswalk yet, or this migration fails rather than guess.
--
-- A published version's crosswalk is immutable outside migrations
-- (lock_published_course_compliance_credit); `app.privileged_write` is the transaction-local
-- bypass, as in 20260925120400.

do $credit$
declare
  r record;
  v_version uuid;
  v_inserted integer;
begin
  perform set_config('app.privileged_write', 'on', true);

  for r in select * from (values
    ('29c5d1d2-dc44-56d4-8511-a274750db906'::uuid,
     'PCH-2600.65-G2',
     $txt$1.00 PCH hour for emergency preparedness under 55 Pa. Code Section 2600.65(g)(2), contingent on facility-plan and role verification. The 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split.$txt$,
     'ALR-2800.65-J2',
     $txt$1.00 ALF hour for emergency preparedness under 55 Pa. Code Section 2800.65(j)(2), contingent on facility-plan and role verification. The 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split.$txt$),
    ('ecb3a79a-b428-5d92-99ec-73f190ad60c1'::uuid,
     'PCH-2600.65-G5',
     $txt$1.00 PCH hour for falls prevention under 55 Pa. Code Section 2600.65(g)(5). The 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split.$txt$,
     'ALR-2800.65-J5',
     $txt$1.00 ALF hour for falls prevention under 55 Pa. Code Section 2800.65(j)(5). The 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split.$txt$),
    ('704324fe-a160-5397-9157-7c6d1e1d1e6f'::uuid,
     'PCH-2600.65-F1',
     $txt$1.00 hour for the PCH medication self-administration annual topic under 55 Pa. Code Section 2600.65(f)(1); this is not medication-administration authorization or administrator continuing education. The 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split.$txt$,
     'ALR-2800.65-I1',
     $txt$1.00 hour for the ALF medication self-administration annual topic under 55 Pa. Code Section 2800.65(i)(1); this is not medication-administration authorization or administrator continuing education. The 1.00-hour allocation is PennTrain curriculum design, not a regulator-issued hour split.$txt$)
  ) v(course_id, pch_topic, pch_note, alf_topic, alf_note)
  loop
    select cv.id into v_version
    from public.courses c
    join public.course_versions cv on cv.id = c.current_version_id
    where c.id = r.course_id and c.organization_id is null and cv.status = 'published';
    if v_version is null then
      raise exception 'course % has no current published platform version to credit', r.course_id;
    end if;
    if exists (select 1 from public.course_compliance_credits where course_version_id = v_version) then
      raise exception 'course version % already carries a compliance crosswalk', v_version;
    end if;

    insert into public.course_compliance_credits (
      course_id, course_version_id, training_type_id, topic_code,
      credit_hours, credit_mode, citation_note
    )
    select r.course_id, v_version, t.id, x.topic_code, 1.00, 'verified_only', x.citation_note
    from (values ('DIRECT-ANNUAL', r.pch_topic, r.pch_note), ('ALR-DIRECT-ANNUAL', r.alf_topic, r.alf_note))
      x(type_code, topic_code, citation_note)
    join public.training_types t on t.organization_id is null and t.code = x.type_code;
    get diagnostics v_inserted = row_count;
    if v_inserted <> 2 then
      raise exception 'expected two crosswalks for course version %, inserted %', v_version, v_inserted;
    end if;
  end loop;
end
$credit$;

-- Medication-administration training types, read against the Department's Regulatory Compliance
-- Guides.
--
-- 2600.190(a) / 2800.190(a) (identical) let a staff person administer medications after completing
-- a Department-approved course "that includes the passing of the Department's performance-based
-- competency test within the past 2 years". 20260705143706 read that as a two-year certificate and
-- gave MED-INIT and MED-RENEW a 730-day renewal with the note "Department course + performance
-- test valid 2 years". The Department reads it differently. Both RCGs (Chapter 2600 and Chapter
-- 2800, revised August 1, 2021, discussion of 190(a), Q/A July 2015):
--
--   "a staff member who passed the medication administration course initially must complete the
--    annual practicum as defined by the course every year. The medication administration
--    course/test does not have to be completed every two years."
--
-- and "Trainers are required to take a recertification class every three years."
--
-- This migration changes what the four rows SAY, not what they DO. Their renewal intervals, and
-- therefore every existing record's status and the med-pass roster's authorizedToday, are
-- unchanged: dropping the two-year clock would clear staff the product currently flags, and that
-- is the owner's call (BACKLOG REG22). What changes:
--
--   * Every note cites both chapters (REG20(a): they cited only 2600.190) and states the RCG reading
--     next to the two-year default, so an administrator reading the requirement can see that the
--     Department accepts the annual practicum in its place.
--   * MED-RENEW was named "Medication Administration Annual Renewal" and described as an "annual
--     renewal" while renewing every 730 days. It is the two-year repeat of the course and test.
--   * TRAINER-CERT said only "Configurable sample". Neither chapter requires a general trainer
--     certification; the one trainer credential the chapters rely on is medication Train-the-Trainer,
--     recertified every three years per the RCG. Its 730-day cycle is recorded as a default.

update public.training_types
set citation_note = '55 Pa. Code 2600.190(a) / 2800.190(a) -- a Department-approved medications '
      || 'administration course including the performance-based competency test "within the past 2 '
      || 'years". DHS''s Regulatory Compliance Guides (revised August 1, 2021) read this as met by the '
      || 'course''s annual practicum: once the course is passed, the practicum is completed every year '
      || 'and "the medication administration course/test does not have to be completed every two '
      || 'years." The 2-year renewal here is a configurable default, stricter than that reading. Not '
      || 'legal advice.'
where code = 'MED-INIT' and organization_id is null;

update public.training_types
set name = 'Medication Administration Recertification (2-Year)',
    description = 'Repeat of the Department-approved medication administration course and competency test, tracked on a 2-year cycle.',
    citation_note = '55 Pa. Code 2600.190(a) / 2800.190(a) -- the course and performance-based '
      || 'competency test "within the past 2 years". DHS''s Regulatory Compliance Guides (revised '
      || 'August 1, 2021) do not require repeating them while the staff person completes the '
      || 'course''s annual practicum every year: "the medication administration course/test does not '
      || 'have to be completed every two years." This 2-year repeat is a configurable default, '
      || 'stricter than that reading. Not legal advice.'
where code = 'MED-RENEW' and organization_id is null;

update public.training_types
set citation_note = '55 Pa. Code 2600.190(b) / 2800.190(b) -- a Department-approved diabetes patient '
      || 'education program completed within the past 12 months, in addition to the medications '
      || 'administration course, before a staff person may administer insulin injections; the record '
      || 'is kept under 2600.190(c) / 2800.190(c). Configurable sample, not legal advice.'
where code = 'DIABETES-EDU' and organization_id is null;

update public.training_types
set citation_note = 'Neither 55 Pa. Code Chapter 2600 nor Chapter 2800 requires a general trainer '
      || 'certification. The trainer credential the chapters rely on is the Department''s medication '
      || 'administration Train-the-Trainer course (2600.190(a) / 2800.190(a)), whose trainers take a '
      || 'recertification class every three years per DHS''s Regulatory Compliance Guides. The 2-year '
      || 'renewal here is a configurable default. Not legal advice.'
where code = 'TRAINER-CERT' and organization_id is null;

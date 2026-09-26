-- The licensed-NHA exemption turns on a date the administrator profile did not record.
--
-- 55 Pa. Code 2600.64(g): "A licensed nursing home administrator who is employed as an
-- administrator prior to October 24, 2006, is exempt from the training and educational
-- requirements of this chapter if the administrator continues to meet the requirements of the
-- Department of State. A licensed nursing home administrator hired as an administrator after
-- October 23, 2006, shall complete and pass the Department-approved personal care home
-- administrator competency-based training test." 2800.64(g) is the same rule for January 18, 2011,
-- the day Chapter 2800 took effect: employed "prior to" it is exempt, hired "after" it takes the
-- assisted living test.
--
-- administrator_profiles records the NHA license and the competency test, but not when the person
-- became an administrator. The rule pack (src/lib/administratorRulePacks.ts) could not tell an
-- exempt NHA from one who owes the test, so it read every licensed NHA as qualified -- including
-- one hired last year with no test on file. It now reads a licensed NHA as qualified only with a
-- passed test on file or this date before the chapter's cutoff. Nullable: no existing profile has
-- a value until somebody records one, and until then an untested NHA reads as missing evidence.

alter table public.administrator_profiles
  add column first_employed_as_administrator_on date;

comment on column public.administrator_profiles.first_employed_as_administrator_on is
  'The date this person was first employed as an administrator. Decides the licensed-NHA '
  'exemption: employed before 2006-10-24 (2600.64(g)) or 2011-01-18 (2800.64(g)) is exempt; '
  'hired later must pass the Department competency-based test.';

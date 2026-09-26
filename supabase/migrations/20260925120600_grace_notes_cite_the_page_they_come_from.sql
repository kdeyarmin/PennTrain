-- The grace-period notes cite the page and the list the Department actually printed.
--
-- BACKLOG.md REG34. 20260804000000 and 20260804170000 justified the 15-day annual grace on the PCH
-- medical evaluation and the ALF annual reassessment from "p.5 Grace Periods table" of each
-- Regulatory Compliance Guide (both revised August 1, 2021). Read against the guides themselves:
--
--   * The Grace Periods list is on p.4 of BOTH guides. In the 2600 guide the "does NOT apply" list
--     (Q/A April 2016-General) is on p.4 as well; in the 2800 guide it runs onto p.5.
--   * That list names eight provisions, not one: 25(a), 25(e) [2600] / 25(h) [2800], 51-52,
--     141(a), 224(a), 225(a), 227(a) and 231(c). What the notes meant is that 141(a) is its only
--     medical-evaluation entry, which is true and is what the PCH row relies on.
--   * The 2800 note said the list carves out "2800.225(a) - Initial assessments". That is the
--     guide's label, carried over from Chapter 2600, where 2600.225(a) is the initial assessment.
--     In Chapter 2800 the initial assessment is 2800.224(a), which the list names separately;
--     2800.225(a) is "Additional assessments" -- the annual, significant-change and Department-
--     requested cycle -- and the same guide's grace list names its (a)(1) for 15 days. The guide
--     contradicts itself; the row keeps 15 days on the reading its label and its grace list share.
--   * The ALF initial medical evaluation rows said "the 15-day figure both RCGs give for this
--     citation is an annual-cycle grace". The 2800 guide also gives one following admission: "The
--     Department allows a 15-day grace period following admission for completion of the initial
--     medical evaluation for all residents" (2800.22(a)(1) discussion, p.25). Its exclusion list
--     names the same evaluation. Grace stays 0, and BACKLOG REG25 carries the decision; the note
--     now says why.
--
-- Notes only. grace_period_days and every other column are untouched.

update public.resident_compliance_rule_packs
set notes = 'The annual cycle of 2600.141, split out from the initial evaluation by 20260804170000. '
      'Grace 15 days: PA DHS 2600 RCG p.4 Grace Periods list names "Medical evaluations (2600.141)" '
      'among the items allowed 15 days, and p.118 restates it under 2600.141(b)(1). The "does NOT '
      'apply" list on the same page (Q/A April 2016) names eight provisions, and its only medical-'
      'evaluation entry is 2600.141(a), the initial evaluation. That figure was confirmed by '
      '20260804000000 and could not be applied until this row existed to carry it.'
where organization_id is null and state = 'PA' and facility_type = 'PCH'
  and item_type = 'annual_medical_evaluation' and citation_ref = '2600.141';

update public.resident_compliance_rule_packs
set notes = '15-day grace: PA DHS 2800 RCG p.4 Grace Periods list names "Completion of ANNUAL Resident '
      'Assessments (2800.225(a)(1))" among the items allowed 15 days -- the same evidentiary standard '
      'already accepted for 2600.225 and 2800.141 in this table. The "does NOT apply" list that follows '
      'on p.5 (Q/A April 2016) names eight provisions, among them 2800.224(a), the ALF initial '
      'assessment, and "2800.225(a) - Initial assessments". That second label is carried over from '
      'Chapter 2600: in Chapter 2800, 225(a) is the additional-assessment cycle whose (a)(1) the grace '
      'list names. The guide contradicts itself; this row follows the grace list and the label, so the '
      'annual and significant-change cycle takes 15 days and the initial assessment stays at zero.'
where organization_id is null and state = 'PA' and facility_type = 'ALR'
  and item_type = 'annual_reassessment' and citation_ref = '2800.225';

update public.resident_compliance_rule_packs
set notes = 'The INITIAL evaluation only, since 20260804170000 split the annual cycle into '
      'annual_medical_evaluation. Grace stays 0, and the 2800 RCG contradicts itself on it: the p.5 '
      '"does NOT apply" list (Q/A April 2016) names "2800.141(a)- Initial medical evaluations", while '
      'the 2800.22(a)(1) discussion (p.25) says "The Department allows a 15-day grace period following '
      'admission for completion of the initial medical evaluation for all residents". This row follows '
      'the exclusion list and the regulation text; BACKLOG REG25 holds the decision.'
where organization_id is null and state = 'PA' and facility_type = 'ALR'
  and item_type = 'medical_evaluation';

-- The ALF quarterly support plan review gets the five days the Department allows.
--
-- 20260925110000 added `support_plan_quarterly_review` (2800.227(c): "The residence shall review
-- each resident's final support plan on a quarterly basis") with no grace, so a review due on day
-- 90 read overdue on day 91. The Department's Regulatory Compliance Guide for Chapter 2800 (March 1,
-- 2015 edition, revised August 1, 2021), "Grace Periods":
--
--   "Unless there is a specific grace period or timeline specified in the applicable section, a
--    5-day flex or grace period is allowed for any item that has a time line of less than one
--    year."
--
-- Its exceptions are fire extinguisher inspections (2800.131(f)), fire drills (2800.132(a)) and the
-- initial admission documents (2800.25(a), (h); 2800.51-52; 2800.141(a); 2800.224(a); 2800.225(a);
-- 2800.227(a); 2800.231(c)). The quarterly review under 2800.227(c) is none of them, so it takes the
-- five days, as the annual items take their fifteen. The initial final support plan (2800.227(a))
-- stays at zero: that one is on the list.
--
-- Open review items copy the grace from the pack when they are created, so they are updated too,
-- except where the organization has its own quarterly-review pack (its override stands). Statuses
-- are then recalculated, which moves a review 1-5 days past due from `expired` back to `due_soon`.

update public.resident_compliance_rule_packs
set grace_period_days = 5,
    notes = '55 Pa. Code 2800.227(c): "The residence shall review each resident''s final support '
      || 'plan on a quarterly basis and modify as necessary." Created by '
      || 'complete_resident_compliance_item when an ALF support plan is completed; renews every 90 '
      || 'days from the date of the review. 5-day grace: the PA DHS 2800 RCG allows 5 days on any '
      || 'item with a timeline under a year unless the section is on its exceptions list, and '
      || '2800.227(c) is not (20260925120200). Chapter 2600 has no quarterly review, so there is no '
      || 'PCH row.'
where organization_id is null
  and state = 'PA'
  and facility_type = 'ALR'
  and item_type = 'support_plan_quarterly_review'
  and grace_period_days = 0;

update public.resident_compliance_items i
set grace_period_days = 5
from public.facilities f
where f.id = i.facility_id
  and f.facility_type = 'ALR'
  and coalesce(f.state, 'PA') = 'PA'
  and i.item_type = 'support_plan_quarterly_review'
  and i.completed_date is null
  and i.grace_period_days = 0
  and not exists (
    select 1
    from public.resident_compliance_rule_packs rp
    where rp.organization_id = i.organization_id
      and rp.item_type = 'support_plan_quarterly_review'
      and rp.facility_type = 'ALR'
      and rp.is_active
  );

select public.recalculate_resident_compliance_statuses();

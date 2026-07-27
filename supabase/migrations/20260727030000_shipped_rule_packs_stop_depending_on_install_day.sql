-- Shipped reference data should not be dated by the clock that installed it.
--
-- Two catalogues ship with the product and rely on the `effective_from` column default to date
-- themselves: the mandatory workforce baseline profile (20260711200634) and the ten global PA
-- support-plan mapping rules (20260726040000). Neither insert names a date, so each row records
-- whichever calendar day its migration happened to run on.
--
-- That was already fragile -- the effective date of a rule pack is a property of the pack, not of
-- the deployment window -- and under the UTC day it was also wrong. `supabase db reset` on this
-- branch at 21:00 ET produced:
--
--     select distinct effective_from from public.support_plan_assessment_mapping_rules;  -- 2026-07-27
--     select public.pa_today();                                                          -- 2026-07-26
--
-- and match_support_plan_rules asks `pa_today() between effective_from and coalesce(effective_to,
-- pa_today())`. So every shipped rule was dormant: a finalized mobility review proposed nothing, and
-- explain_employee_compliance_profile could not see the mandatory baseline it is supposed to apply
-- to every active employee. In production the same thing happens to any facility that installs
-- during a Pennsylvania evening -- the pack sits inert until the following morning, silently, with
-- the product reporting no applicable rules rather than an error.
--
-- 20260727010000 changed the column DEFAULT to public.pa_today(), which fixes the next install but
-- not the rows already written. This dates the two shipped catalogues explicitly, to the day their
-- own migration was authored. The effect is that both are effective from a day in the past rather
-- than a day that moves, which is what "shipped with the product" should mean; nothing else about
-- either row changes.
--
-- Scoped deliberately. Only rows that ship with the product are touched -- is_system_managed for the
-- profile catalogue, and organization_id/facility_id both null for the global rule pack. A tenant's
-- own profile or rule keeps `effective_from` defaulting to public.pa_today(), because for a rule an
-- operator writes today, effective today is the correct and expected reading.

update public.compliance_profile_definitions
set effective_from = date '2026-07-11'
where is_system_managed;

update public.support_plan_assessment_mapping_rules
set effective_from = date '2026-07-26'
where organization_id is null and facility_id is null;

-- resident_unscheduled_services_select was the only policy still naming auth.uid() bare.
--
-- Eighty-five policies in this schema reference auth.uid(). Eighty-four write it as
-- `(select auth.uid())`, which lets the planner hoist it into an InitPlan evaluated once per query
-- instead of leaving a function call in a per-row filter. This one, added by 20260726060100, wrote
-- it bare, and `supabase db advisors` has been reporting it as auth_rls_initplan ever since.
--
-- Wrapping a STABLE function in a scalar subquery cannot change what it returns, so this is a
-- consistency change with no behavioural component. It is deliberately NOT presented as a
-- performance fix, because it was measured and it is not one:
--
--     count(*) over 50,000 rows, as shipped              103,460 ms
--     count(*) over 50,000 rows, with (select auth.uid()) 101,155 ms
--
-- EXPLAIN says why -- the employees lookup was already a `hashed SubPlan` with loops=1, so it was
-- never per-row and there was nothing left to hoist. The 103 seconds are spent in
-- public.is_assigned_to_facility(), reached through app_private.admission_row_visible(), at about
-- 0.42 ms per row; that function is SECURITY DEFINER with `SET search_path TO ''` and therefore
-- cannot be inlined, and it is called by 215 policies across 126 tables.
--
-- That is a real and much larger finding, and it is written up with its measurements in
-- docs/audits/RLS_ROW_FILTER_COST.md rather than fixed here. Two candidate rewrites were tried
-- while measuring: the fast one silently dropped the session-lock, profile-active, facility-active
-- and subscription-status checks that live inside is_assigned_to_facility, and would have returned
-- rows this policy denies; the semantically-identical one scans every tenant's facilities and gets
-- slower as the deployment grows. Neither belongs in a commit whose subject is a scalar subquery.
--
-- The rest of the expression is reproduced verbatim from 20260726060100.

alter policy resident_unscheduled_services_select on public.resident_unscheduled_services
using (
  app_private.admission_row_visible(organization_id, facility_id)
  or exists (
    select 1
    from public.employees e
    where e.profile_id = (select auth.uid())
      and e.status = 'active'
      and e.facility_id = resident_unscheduled_services.facility_id
  )
);

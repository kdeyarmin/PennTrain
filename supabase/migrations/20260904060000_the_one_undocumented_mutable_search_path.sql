-- The seventh mutable search_path is the one nobody argued for.
--
-- THE FINDING. `supabase db advisors` reports seven `function_search_path_mutable` warnings. Six
-- are the `pa_*` day helpers (pa_today, pa_day, pa_clock, pa_now, pa_midnight, pa_week_start), and
-- those are deliberate: 20260727050000 makes the case in detail -- it schema-qualifies every name
-- inside them instead of pinning, because a SET clause makes a function non-inlinable and these
-- six are called per-row across compliance recalculation, and because no browser role holds CREATE
-- on public so nothing can plant a shadowing object anyway. That is a reviewed exception with its
-- reasoning written down.
--
-- The seventh, `app_private.clinical_disclosure_allowed(text)`, is not any of that. It is a
-- one-line SQL function with no reasoning recorded anywhere, and it sits on the clinical
-- disclosure path: `app_private.assert_clinical_disclosure_allowed` -- which IS `security definer`
-- with `set search_path = ''` -- calls it to decide whether resident clinical data may leave the
-- system through FHIR write-back, an organization export, or the designated-person portal.
--
-- The practical risk today is low for the same reason the six are defensible: the function is
-- revoked from public, anon and authenticated, and it references no unqualified object -- its body
-- is `select p_consent = 'granted'`, which touches nothing resolvable through a search_path. So
-- this is not a live vulnerability, and it is not being presented as one.
--
-- It is fixed because the advisor list is a review surface, and its value is entirely in every
-- entry being either absent or explained. Six explained warnings and one unexplained one costs a
-- reviewer the same work as seven unexplained ones: they still have to open each and decide. The
-- cheap resolution is to remove the one that has no argument for staying, which leaves a list
-- where every remaining entry is a decision on the record.
--
-- WHY PINNING IS FREE HERE, where 20260727050000 argued it was not. That migration's objection was
-- inlining: a SET clause stops PostgreSQL inlining a SQL function, and the day helpers are
-- evaluated per row in compliance sweeps. This function is called once per disclosure decision,
-- not per row, so the same cost is not worth measuring.
--
-- BLAST RADIUS. One ALTER FUNCTION. No signature, grant, body or caller changes.
--
-- Rollback: alter function app_private.clinical_disclosure_allowed(text) reset search_path;

alter function app_private.clinical_disclosure_allowed(text) set search_path = '';

comment on function app_private.clinical_disclosure_allowed(text) is
  'True only for a granted clinical-data consent posture. search_path is pinned (20260904060000): it is the sole predicate behind app_private.assert_clinical_disclosure_allowed, which gates every outbound clinical disclosure path, and unlike the six pa_* day helpers it is not called per row, so the inlining cost that justifies leaving those unpinned does not apply.';

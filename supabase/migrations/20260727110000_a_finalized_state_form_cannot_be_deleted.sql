-- Finalizing a state assessment form stops it being edited. It does not stop it being deleted.
--
-- resident_assessment_forms holds the RASP and ASP -- the Pennsylvania support-plan assessments a
-- DHS inspector asks for by name. `authenticated` holds SELECT, INSERT, UPDATE and DELETE on it
-- directly, so both write paths are governed by row policies rather than by an RPC. The UPDATE policy
-- is careful:
--
--   resident_assessment_forms_update  USING and WITH CHECK:
--     is_platform_admin() or (org matches and role in (org_admin, facility_manager)
--                             and is_assigned_to_facility(...) and status = 'draft')
--
-- `status = 'draft'` appears in both halves, so a finalized form cannot be edited, and cannot be
-- edited INTO or OUT OF the finalized state by a direct write. That is right. The DELETE policy next
-- to it:
--
--   resident_assessment_forms_delete  USING:
--     is_platform_admin() or (org matches and role = 'org_admin')
--
-- No status. Verified rather than read off the policy -- signed in as an ordinary org_admin over
-- PostgREST's own role:
--
--     update public.resident_assessment_forms set content = '...' where id = <finalized>;  -- 0 rows
--     delete from public.resident_assessment_forms where id = <finalized>;                 -- 1 row
--
-- The weaker operation is refused and the stronger one is allowed. Editing a finalized assessment
-- changes what it says; deleting it means there is no assessment on file at all.
--
-- WHY NOBODY NOTICED: THE PROTECTION LOOKED LIKE IT WAS THERE. Four tables reference a form with
-- ON DELETE RESTRICT -- resident_service_requirements, resident_service_task_instances,
-- resident_support_plans and support_plan_proposals -- so a form that produced downstream records
-- really is undeletable, with a 23503. That covers the common case and hides the gap. But those rows
-- exist only if the assessment produced at least one service requirement, and
-- app_private.insert_service_requirement returns early when `planDescription` is empty. So:
--
--     a finalized ASP that recorded services       -> DELETE refused (23503)
--     a finalized ASP that recorded no services    -> DELETE succeeds, 1 row
--
-- Both measured. The immutability of a finalized state form was a side effect of referential
-- integrity, not a rule -- and it held for exactly the residents with the most documented needs,
-- while a resident assessed as needing nothing had their assessment left deletable. The audit trigger
-- records the deletion, so there is a trace; a trace of the record is not the record.
--
-- THIS IS THE ONLY TABLE WITH THAT ASYMMETRY. Sweeping every policy pair in public for an UPDATE qual
-- that constrains a lifecycle column while the DELETE qual next to it does not returns exactly one
-- table: this one. (The first sweep returned 23, all false positives -- the pattern contained
-- `signed`, which matches `is_as-signed-_to_facility`. The companion test carries the corrected
-- sweep as a ratchet.)
--
-- THE FIX is to mirror the UPDATE policy rather than invent a new rule: platform_admin unrestricted,
-- as it already is for UPDATE, and tenant roles limited to drafts. Deleting a draft is legitimate --
-- it is abandoning a work in progress -- and nothing in the client, the tests or any RPC deletes a
-- form at all, so no working call site changes. A finalized form that was wrong is corrected the way
-- the product already corrects one: clone it, finalize the clone, and the original is marked
-- superseded, which keeps the trail instead of erasing it.
--
-- Rollback: restore the previous USING expression, dropping the status clause.

alter policy resident_assessment_forms_delete on public.resident_assessment_forms
  using (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public."current_role"()) = 'org_admin'
      -- Mirrors resident_assessment_forms_update. A finalized RASP/ASP is superseded, never removed.
      and status = 'draft'
    )
  );

-- Four regulatory gates that existed only in React (BACKLOG.md I14, database half).
--
-- The pattern is the same in each: an RPC enforces a rule, the UI calls that RPC, and PostgREST
-- will happily accept the same write without it. RLS decides WHO may write the row; nothing
-- decided WHICH COLUMNS or WHICH TRANSITIONS, so the rule lived in the client.
--
-- HOW A DIRECT WRITE IS TOLD APART FROM AN RPC. Inside a SECURITY DEFINER function owned by
-- `postgres`, `current_user` is `postgres`; a PostgREST call from a signed-in user runs as
-- `authenticated`, and a worker as `service_role`. That is the discriminator used below. It is
-- not `current_setting('role')`, which PostgREST sets once per request and which stays
-- 'authenticated' inside a definer -- the mistake worth naming, because
-- protect_incident_creation_state already reads that and therefore also fires inside the RPCs.
--
-- These RAISE rather than silently reverting, unlike protect_profile_privileged_fields. Reverting
-- is right for a field a user may legitimately try to change and simply may not (their own role);
-- it is wrong for a compliance transition, where the caller would be told the incident closed and
-- the record would say otherwise. Each guard fires only when the value ACTUALLY changes, so a
-- full-row update carrying an unchanged column still works -- which matters, because that is how
-- supabase-js updates are usually written.
--
-- There is deliberately no blanket platform-admin bypass. On a customer's regulatory record the
-- vendor is not a privileged writer, and every one of these transitions has an RPC that a platform
-- admin can call like anyone else. `app.privileged_write` stays as the escape hatch, and it needs
-- a real database session to set.
--
-- 1. THE INCIDENT APPROVAL GATE WAS SATISFIABLE BY WRITING THE COLUMN THAT PROVES IT.
-- enforce_incident_final_report_before_close does require both a final report date and
-- `administrator_approved_at` before an incident may close -- that part of the ledger is sound.
-- But `administrator_approved_at` is an ordinary updatable column, so the gate is passed by
-- PATCHing it and then closing, never touching approve_incident_investigation and never recording
-- who approved. Same for `reportability_status`: determine_incident_reportability writes the
-- rationale, the determined-by, the audit row and (since 20260905080000) re-anchors the notification
-- deadline; a PATCH writes the status alone and none of that happens. The product's own UI uses
-- both RPCs and never writes these columns, so locking them costs nothing that works today.
--
-- 2. CLOSING AN INCIDENT NEVER STAMPED closed_at. The column exists, protect_incident_creation_state
-- blanks it on insert, and nothing ever wrote it -- so every closed incident in the system says it
-- closed at no particular time, and the incident file cannot show when the facility finished. It is
-- stamped here, with the profile that closed it, and cleared on reopening.
--
-- 3. REOPENING WAS SILENT AND UNRESTRICTED. `closed` -> `investigating` was an ordinary status
-- write available to any facility_manager. Reopening a closed investigation is a real thing that
-- happens -- new information arrives -- so it stays possible, but it is an org_admin's decision and
-- it now clears the closure stamps rather than leaving a row that claims to be both.
--
-- 4. THE POC LADDER SKIPPED ITS OWN GATE. docs/design/POC_LIFECYCLE.md rule 5 says a violation
-- reaches `verified` only after its corrective actions are closed, and verify_plan_of_correction
-- enforces exactly that. `status` is an ordinary column, so PATCH status='verified' walks past it,
-- past submit_plan_of_correction's evidence requirements, and past the escalation re-arming. The
-- violations page writes only descriptive fields (citation, description, severity, due date,
-- surveyor), never status.
--
-- 5. DELETING A RESIDENT DESTROYED THE RECORD OF THEIR CARE. `residents_delete` admitted org_admin,
-- and 31 foreign keys cascade from that row -- including `resident_assessment_forms`, which holds
-- finalized state-approved assessments, and `resident_documents`, which holds everything uploaded
-- about them. A finalized assessment cannot be deleted directly (20260727110000 saw to that) and
-- then evaporates when the parent goes. No UI path deletes a resident; this was REST-only. Now
-- platform admin only, which makes destroying a resident's file a support action with a person on
-- the other end rather than one DELETE.
--
-- 6. AND AN EVIDENCE DOCUMENT COULD BE DELETED OUT FROM UNDER THE RECORD THAT CITED IT. Eight
-- foreign keys point at `resident_documents` with ON DELETE SET NULL, so deleting a discharge
-- summary silently emptied `hospital_transfer_episodes.discharge_document_id` and the episode then
-- read as though no summary had ever been filed. Deleting a referenced document now refuses and
-- names what refers to it.
--
-- Rollback: drop the four triggers and their functions, and restore residents_delete from
-- 20260705183133. Nothing here changes stored data.

-- In `public`, not `app_private`: this is called from BEFORE UPDATE triggers that run as the
-- invoker, and `authenticated` has no USAGE on app_private -- putting it there made every ordinary
-- incident and violation update fail with "permission denied for schema app_private". SECURITY
-- INVOKER is load-bearing for the same reason the check works at all: a definer would rewrite
-- current_user to the owner and the function would always answer true.
create or replace function public.write_is_through_a_trusted_path()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Inside a SECURITY DEFINER RPC current_user is the function's owner, not the caller's role;
  -- a direct PostgREST write is 'authenticated'. The GUC is the database-session escape hatch.
  select current_user <> 'authenticated'
      or coalesce(current_setting('app.privileged_write', true), '') = 'on';
$$;

comment on function public.write_is_through_a_trusted_path() is
  'True when the current write is running inside a SECURITY DEFINER RPC, as a worker role, or under '
  'the app.privileged_write escape hatch -- rather than as a direct PostgREST write from a signed-in '
  'user. Used by the column guards that keep regulatory transitions on their RPCs.';

create or replace function public.protect_incident_workflow_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.write_is_through_a_trusted_path() then
    if new.administrator_approved_at is distinct from old.administrator_approved_at
       or new.administrator_approved_by is distinct from old.administrator_approved_by
       or new.administrator_approval_note is distinct from old.administrator_approval_note then
      raise exception 'Administrator approval is recorded by approve_incident_investigation, not by writing the column.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.reportability_status is distinct from old.reportability_status
       or new.reportability_determined_at is distinct from old.reportability_determined_at
       or new.reportability_determined_by is distinct from old.reportability_determined_by
       or new.reportability_rationale is distinct from old.reportability_rationale then
      raise exception 'Reportability is determined by determine_incident_reportability, not by writing the column.'
        using errcode = 'insufficient_privilege';
    end if;
    -- Reopening is legitimate -- new information arrives after an investigation closes -- but it is
    -- the administrator's call, not every facility manager's.
    if old.status = 'closed' and new.status is distinct from 'closed'
       and coalesce(public."current_role"(), '') <> 'org_admin' then
      raise exception 'Only an organization administrator may reopen a closed incident.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Stamp the closure. Nothing wrote these before, so every closed incident recorded no closing
  -- time and no closer.
  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at := coalesce(new.closed_at, now());
    new.closed_by_profile_id := coalesce(new.closed_by_profile_id, auth.uid());
  elsif new.status is distinct from 'closed' and old.status = 'closed' then
    new.closed_at := null;
    new.closed_by_profile_id := null;
  end if;

  return new;
end;
$$;

-- Named to sort after enforce_incident_final_report_before_close, so the closure gate is evaluated
-- on the values the caller supplied rather than on a closed_at this trigger has just stamped.
create trigger z_protect_incident_workflow_columns
  before update on public.incidents
  for each row execute function public.protect_incident_workflow_columns();

create or replace function public.protect_violation_status_ladder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not public.write_is_through_a_trusted_path() then
    raise exception 'A violation status moves only through submit_plan_of_correction, mark_plan_of_correction_corrected and verify_plan_of_correction, which enforce the plan and corrective-action gates.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger protect_status_ladder
  before update on public.dhs_violations
  for each row execute function public.protect_violation_status_ladder();

-- A resident's file is not an org_admin's to destroy with one DELETE.
drop policy if exists residents_delete on public.residents;
create policy residents_delete on public.residents
  for delete to authenticated
  using (public.is_platform_admin());

create or replace function public.protect_referenced_resident_document()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_referrer text;
begin
  select r.label into v_referrer
  from (
    select 'a hospital transfer episode' as label from public.hospital_transfer_episodes
      where discharge_document_id = old.id
    union all
    select 'a resident appointment' from public.resident_appointments
      where uploaded_document_id = old.id
    union all
    select 'a durable medical equipment item' from public.resident_dme_items
      where supporting_document_id = old.id
    union all
    select 'a legal record' from public.resident_legal_records where document_id = old.id
    union all
    select 'a property inventory item' from public.resident_property_items where document_id = old.id
    union all
    select 'the resident''s rights acknowledgement' from public.residents
      where resident_rights_document_id = old.id
    union all
    select 'the resident''s photo' from public.residents where photo_document_id = old.id
    union all
    select 'the resident''s contract' from public.residents where contract_document_id = old.id
  ) r
  limit 1;

  if v_referrer is not null then
    -- Every one of these foreign keys is ON DELETE SET NULL, so without this the delete succeeds
    -- and the record that cited the document quietly reads as though nothing was ever filed.
    raise exception 'This document is filed as %; detach it there before deleting it.', v_referrer
      using errcode = 'foreign_key_violation';
  end if;
  return old;
end;
$$;

create trigger protect_referenced_document
  before delete on public.resident_documents
  for each row execute function public.protect_referenced_resident_document();

revoke all on function public.protect_incident_workflow_columns() from public, anon, authenticated;
revoke all on function public.protect_violation_status_ladder() from public, anon, authenticated;
revoke all on function public.protect_referenced_resident_document() from public, anon, authenticated;
revoke all on function public.write_is_through_a_trusted_path() from public, anon, authenticated;
grant execute on function public.write_is_through_a_trusted_path() to authenticated, service_role;

comment on function public.protect_incident_workflow_columns() is
  'Keeps incident approval and reportability on their RPCs, restricts reopening a closed incident '
  'to org_admin, and stamps closed_at/closed_by_profile_id -- which nothing wrote before.';
comment on function public.protect_violation_status_ladder() is
  'Keeps the plan-of-correction status ladder on the RPCs that enforce its gates (POC_LIFECYCLE.md '
  'rule 5). Direct writes to dhs_violations.status are refused.';
comment on function public.protect_referenced_resident_document() is
  'Refuses to delete a resident document that another record cites as evidence. The referencing '
  'foreign keys are ON DELETE SET NULL, so the delete would otherwise succeed silently.';

-- 7. A THIRTY-QUESTION FINAL EXAM WAS PASSABLE BY ELIMINATION.
--
-- The answer KEY is already properly gated: TakeQuiz only fetches it once the learner passed, used
-- every attempt, or the quiz opted in as a knowledge check -- and the database constrains that
-- opt-in to quiz_kind = 'knowledge_check', so an examination can never carry it. That part holds.
--
-- What leaked is narrower and sufficient: `quiz_attempt_answers.is_correct`, which the owner could
-- read for a submitted attempt. After failing, the learner is told exactly WHICH questions they got
-- wrong. Retake, change only those, and a 30-question exam with unlimited attempts converges in a
-- handful of tries without the learner ever knowing the material. For PA-required annual training
-- that is a certificate the facility cannot stand behind at survey.
--
-- The owner keeps reading their answers while the attempt is IN PROGRESS -- resuming a
-- half-finished quiz depends on it, and `is_correct` is null until the attempt is graded anyway --
-- and once the result can no longer be used to game a retake. Peers and managers who could already
-- read the rows through can_read_employee_peer_data are unaffected: they are not the ones retaking.
drop policy if exists quiz_attempt_answers_select on public.quiz_attempt_answers;
create policy quiz_attempt_answers_select on public.quiz_attempt_answers
  for select to authenticated
  using (
    exists (
      select 1
      from public.quiz_attempts qa
      where qa.id = quiz_attempt_answers.attempt_id
        and (
          public.is_platform_admin()
          or public.can_read_employee_peer_data(qa.organization_id, qa.facility_id)
          or (
            public.owns_employee(qa.employee_id)
            and (
              qa.submitted_at is null
              or qa.passed is true
              or exists (
                select 1 from public.quizzes q
                where q.id = qa.quiz_id
                  and (
                    q.quiz_kind = 'knowledge_check'
                    -- Exhausted: no attempts left to game.
                    or (q.max_attempts is not null and qa.attempt_number >= q.max_attempts)
                  )
              )
            )
          )
        )
    )
  );

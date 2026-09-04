-- Completed course assignments that never got a certificate, because they completed before
-- issuance became atomic.
--
-- THE FINDING. The second of the two counters keeping `phase1-synthetic-health` permanently red
-- (the first is 20260904030000's) is `completedAssignmentsWithoutCertificate: 1`. The row is
-- real: a course assignment in the demo organization, status 'completed', completed_at
-- 2026-07-05, against a published version, with no certificates row pointing at it.
--
-- It is not a live defect. 20260711154819 made completion and issuance one transaction --
-- `complete_course_assignment` issues the certificate in the same statement that flips the
-- status, and `protect_certificate_write` keeps any other writer out -- so no assignment
-- completed after 2026-07-11 15:48:19 UTC can reach this state. This row completed six days
-- before that, when the two were separate steps and the second one could simply not happen.
--
-- WHY REPAIR IT RATHER THAN EXEMPT IT. The counter is correct and the invariant it states is one
-- worth keeping: a completed assignment without a certificate is a learner who finished their
-- training and has nothing to show a surveyor. Silencing the counter for old rows would leave
-- that learner exactly as un-certificated while removing the only thing that says so. Issuing the
-- certificate makes the counter true instead of ignored.
--
-- THE CUTOFF IS THE LOAD-BEARING PART. This repairs only assignments completed strictly before
-- atomic issuance shipped. A missing certificate on a RECENT completion would mean the atomic
-- path itself failed, which is a live P1 -- and a backfill with no cutoff would quietly repair it
-- on every deploy, so the invariant would report zero while the bug that produced it kept
-- running. The cutoff keeps this a one-time historical repair and leaves the counter able to
-- catch a real regression tomorrow.
--
-- IT GOES THROUGH THE NORMAL WRITE PATH, TRIGGERS AND ALL. `app.privileged_write` is the same
-- escape hatch `issue_certificate` sets, and the certificates triggers then fire as they would
-- for any issuance: `enqueue_certificate_artifacts` queues the PDF job (which is wanted -- a
-- certificate row with no PDF is only half a repair), `notify_certificate_issued` notifies the
-- learner, and `audit_log_trigger` records the write. The notification is a deliberate accepted
-- side effect: the learner is being told about a certificate that genuinely should have existed
-- since July. On the demo tenant, which is where the one known row lives, provider delivery is
-- suppressed by its own trigger anyway.
--
-- `issue_certificate` itself cannot be called here: it authorizes against `auth.uid()`, and a
-- migration has no JWT, so it would raise `insufficient_privilege` for every row. The insert
-- below mirrors its column list exactly -- organization, facility, employee, course, assignment,
-- and completed_at as issued_at -- and leaves slug, credential_number and pdf_status to the same
-- column defaults that function relies on.
--
-- BLAST RADIUS. On production, one row in the demo organization. On a fresh database, zero.
-- Idempotent: `where not exists` plus the unique index on course_assignment_id means a re-run
-- inserts nothing.
--
-- Rollback: delete certificates whose course_assignment_id is in the set below and whose
-- created_at falls in this deploy's window. The queued PDF jobs are harmless if left.

do $$
declare
  v_repaired integer;
begin
  perform set_config('app.privileged_write', 'on', true);

  insert into public.certificates (
    organization_id, facility_id, employee_id, course_id, course_assignment_id, issued_at
  )
  select
    ca.organization_id, ca.facility_id, ca.employee_id, ca.course_id, ca.id,
    coalesce(ca.completed_at, ca.updated_at, now())
  from public.course_assignments ca
  where ca.status = 'completed'
    -- Strictly before atomic issuance (20260711154819). See the header: a missing certificate
    -- after this instant is a live failure of the atomic path and must stay visible.
    and coalesce(ca.completed_at, ca.updated_at) < timestamptz '2026-07-11 15:48:19+00'
    and not exists (
      select 1 from public.certificates c where c.course_assignment_id = ca.id
    );

  get diagnostics v_repaired = row_count;
  raise notice 'Issued % certificate(s) for completions that predate atomic issuance.', v_repaired;
end;
$$;

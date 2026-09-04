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

-- BOUNDED, LIKE THE OPERATIONAL REPAIR IT MIRRORS. `public.reconcile_course_completion_certificates`
-- (20260711154819) already solves the "completed with no certificate" repair for operators, and it
-- caps every invocation with `limit` + `for update ... skip locked` for a reason: each inserted row
-- fires `enqueue_certificate_artifacts` and `notify_certificate_issued`, so an unbounded pass over a
-- large backlog would hold locks on the whole matching set and run every trigger inside one
-- transaction -- here, the DEPLOY's transaction. This block keeps the same rails.
--
-- WHY NOT JUST CALL THAT RPC. It has no cutoff by design: it is meant to repair whatever is missing
-- right now, including a recent completion. That is correct for an operator who has already
-- diagnosed the cause, and wrong for an unattended migration -- see the cutoff note above. So this
-- keeps the RPC's bounding and adds the cutoff the RPC deliberately lacks.
--
-- WHAT HAPPENS IF THE CAP IS HIT. Nothing silent. The remaining pre-cutoff rows are counted and
-- raised as a warning naming the RPC to finish the job, so the deploy stays bounded and the work
-- left over is visible and has a documented tool. Expected in practice: production has one such
-- row, a fresh database has none, so the cap is a guard rail rather than a step in the plan.

do $$
declare
  v_repair_cap  constant integer := 500;
  v_repaired    integer;
  v_remaining   bigint;
begin
  perform set_config('app.privileged_write', 'on', true);

  with missing as (
    select ca.id, ca.organization_id, ca.facility_id, ca.employee_id, ca.course_id,
           coalesce(ca.completed_at, ca.updated_at, now()) as issued_at
    from public.course_assignments ca
    where ca.status = 'completed'
      -- Strictly before atomic issuance (20260711154819). See the header: a missing certificate
      -- after this instant is a live failure of the atomic path and must stay visible.
      and coalesce(ca.completed_at, ca.updated_at) < timestamptz '2026-07-11 15:48:19+00'
      and not exists (
        select 1 from public.certificates c where c.course_assignment_id = ca.id
      )
    order by ca.completed_at, ca.id
    limit v_repair_cap
    for update of ca skip locked
  )
  insert into public.certificates (
    organization_id, facility_id, employee_id, course_id, course_assignment_id, issued_at
  )
  select organization_id, facility_id, employee_id, course_id, id, issued_at
  from missing
  -- Closes the window between the `not exists` probe and this insert: a concurrent
  -- `complete_course_assignment` issuing the same certificate loses the race harmlessly instead
  -- of failing the deploy on the unique key.
  on conflict (course_assignment_id) do nothing;

  get diagnostics v_repaired = row_count;

  select count(*) into v_remaining
  from public.course_assignments ca
  where ca.status = 'completed'
    and coalesce(ca.completed_at, ca.updated_at) < timestamptz '2026-07-11 15:48:19+00'
    and not exists (
      select 1 from public.certificates c where c.course_assignment_id = ca.id
    );

  raise notice 'Issued % certificate(s) for completions that predate atomic issuance.', v_repaired;

  if v_remaining > 0 then
    raise warning 'ATTENTION: % pre-cutoff completion(s) still have no certificate; this migration repairs at most % per deploy. Finish with: select public.reconcile_course_completion_certificates(null, 500); (service role, repeat until missing_certificates_remaining is 0).',
      v_remaining, v_repair_cap;
  end if;
end;
$$;

-- The certificate PDF worker reads three tables the service role was deliberately narrowed off,
-- so every certificate PDF fails to render.
--
-- THE FINDING. The first certificate ever issued on production (by 20260904040000, the one
-- completion that predates atomic issuance) queued its PDF job at 14:15 UTC on 2026-09-04. The
-- worker claimed it five times, five minutes apart, and every attempt died on the same Postgres
-- error, visible in the log stream but nowhere in the product:
--
--     permission denied for table course_assignments
--
-- After the fifth attempt `certificate_pdf_jobs.attempt_count` reached `max_attempts`, the job
-- went to `failed`, `certificates.pdf_status` went to `failed`, and `phase1-synthetic-health` --
-- which had recorded its first success in the life of the project at 14:22 that day -- went red
-- again on `certificatePdfJobsExhausted: 1`. The `certificates` storage bucket holds zero objects.
--
-- WHY. 20260711190100_narrow_service_role_core_table_access revoked the service role's access
-- to every core table and restored only the direct PostgREST commands that the Edge Functions
-- of that day had been audited to need. `course_assignments`, `quiz_attempts` and `quizzes` were
-- not among them, because nothing read them directly then. 20260830210000's work on certificate
-- provenance then taught `generate-certificate-pdf` to print the course version the learner
-- actually took and their best final-exam score -- read straight from those three tables with
-- the service-role client (`loadCertificateDetail`). Correct on any stack whose base image
-- grants new tables to `service_role` by default, which is what a developer's stack does, and
-- exactly what the narrowing migration exists to prevent on the deployment.
--
-- Nothing caught it because nothing could: the edge-function suite mocks the client, the pgTAP
-- suite never renders a PDF, the browser journey asserts the certificate ROW and its public
-- verification page, and production had never issued a certificate before 2026-09-04. This is
-- the same shape as every finding in BACKLOG Tier H -- a signal that read healthy for a reason
-- unrelated to health -- one layer closer to the customer, because a learner's certificate is
-- what a surveyor asks to see.
--
-- WHAT THIS MIGRATION DOES.
--   1. Grants SELECT (only) on the three tables to `service_role`, the same shape as the
--      narrowing migration's own restore list. SELECT is the whole of what the worker does with
--      them: one assignment by id, its version, the passed final-exam attempts for that
--      assignment. No write grant is added, and the pgTAP suite asserts both directions.
--   2. Adds `app_private.requeue_exhausted_certificate_pdf_jobs(p_limit)`: a bounded, locked
--      reset of jobs that have spent every attempt, back to `pending` with a zero attempt count,
--      and their certificates back to `pending`. Nothing in the product could do this before --
--      PHASE1_OPERATIONS.md tells the operator to "retry or replay the durable PDF job through
--      the control plane", and the control plane has no such control (BACKLOG I-tier records
--      that gap). The function is `app_private` and executable by nobody but the owner, so the
--      only caller today is this file; an operator surface can wrap it later.
--   3. Calls it once, so the job that exhausted itself against the missing grant renders on
--      the worker's next five-minute tick without anyone touching production by hand. On a
--      clean database it requeues nothing.
--
-- WHY REQUEUE EVERY EXHAUSTED JOB RATHER THAN ONLY THE ONES WITH THIS ERROR. The worker stored
-- the failure as the literal string "[object Object]" -- the PostgREST error is a plain object,
-- not an Error instance, and the worker only unwrapped the latter (fixed in the same change
-- set, `_shared/errorMessage.ts`) -- so there is no error text to match on. And every exhausted
-- job that exists at this deploy failed under the missing grant, because no certificate PDF has
-- ever rendered on this deployment. The reset is bounded, counted, and reported.
--
-- Rollback: `revoke select on public.course_assignments, public.quiz_attempts, public.quizzes
-- from service_role;` and `drop function app_private.requeue_exhausted_certificate_pdf_jobs`.
-- There is no behavioural reason to: the revoke would put every certificate PDF back to failing.

grant select on table
  public.course_assignments,
  public.quiz_attempts,
  public.quizzes
to service_role;

create or replace function app_private.requeue_exhausted_certificate_pdf_jobs(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_requeued integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000' using errcode = 'invalid_parameter_value';
  end if;

  -- `certificates` writes go through protect_certificate_write; this is the same escape hatch
  -- claim_certificate_pdf_jobs and finish_certificate_pdf_job set for the worker's own writes.
  perform set_config('app.privileged_write', 'on', true);

  with exhausted as (
    select j.id, j.certificate_id
    from public.certificate_pdf_jobs j
    where j.status = 'failed'
      and j.attempt_count >= j.max_attempts
    order by j.requested_at, j.id
    limit p_limit
    for update of j skip locked
  ), requeued as (
    update public.certificate_pdf_jobs j
    set status = 'pending',
        attempt_count = 0,
        current_run_id = null,
        worker_id = null,
        locked_at = null,
        available_at = now(),
        completed_at = null
    from exhausted e
    where j.id = e.id
    returning j.certificate_id
  ), certificate_state as (
    update public.certificates c
    set pdf_status = 'pending',
        pdf_attempt_count = 0
    from requeued r
    where c.id = r.certificate_id
    returning c.id
  )
  select count(*) into v_requeued from certificate_state;

  return v_requeued;
end;
$function$;

revoke all on function app_private.requeue_exhausted_certificate_pdf_jobs(integer)
  from public, anon, authenticated;

comment on function app_private.requeue_exhausted_certificate_pdf_jobs(integer) is
  'Resets certificate PDF jobs that have spent every attempt back to pending (attempt_count 0) '
  'and their certificates to pdf_status pending, so the cron worker renders them again. Bounded '
  'by p_limit, row-locked with skip locked, returns the number requeued. Added by 20260904110000 '
  'after every production render failed on a missing service_role grant; the operator-facing '
  'wrapper is still to come (BACKLOG Tier I).';

do $$
declare
  v_requeued integer;
begin
  v_requeued := app_private.requeue_exhausted_certificate_pdf_jobs(500);
  raise notice 'Requeued % exhausted certificate PDF job(s) for the worker''s next tick.', v_requeued;
end;
$$;

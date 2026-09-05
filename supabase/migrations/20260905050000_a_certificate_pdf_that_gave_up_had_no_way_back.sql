-- A certificate PDF that gave up had no way back, and said the opposite.
--
-- THE FINDING. `certificate_pdf_jobs` gives each certificate five attempts. `claim_certificate_pdf_jobs`
-- only ever claims a job with `attempt_count < max_attempts`, so once those are spent the job is
-- invisible to every worker, cron and manual alike. The employee's "Retry PDF" button calls
-- generate-certificate-pdf, which claims nothing, finds no finished artifact, and answers
--
--     409  "Certificate PDF is already being prepared. Please try again shortly."
--
-- which is the opposite of what happened: nothing is being prepared, nothing ever will be, and
-- trying again shortly does nothing at all. The employee is told to wait for an event that cannot
-- occur, on the only copy of a training certificate they may need to show an inspector.
--
-- PHASE1_OPERATIONS.md says an operator can "retry or replay the durable PDF job through the
-- control plane". No such control existed in the product. 20260904110000 added
-- `app_private.requeue_exhausted_certificate_pdf_jobs`, which is reachable only by someone with a
-- database session -- a fix for that day's stranded job, not a control anyone can use.
--
-- WHAT THIS ADDS. `public.requeue_certificate_pdf(uuid)`: one certificate, callable by the people
-- who would be asked about it -- a platform admin, an org_admin in the certificate's organization,
-- or the employee whose certificate it is. It refuses anything that is not actually exhausted, and
-- says which state it found, so it cannot be used to jog a job that is merely waiting its turn or
-- currently leased by a worker.
--
-- The holder is admitted deliberately. The alternative is a dead button plus a support round-trip
-- during a pilot, and the abuse ceiling is low: a requeue only applies to a job with no attempts
-- left, so a second one is impossible until the worker has spent five more (at roughly five-minute
-- intervals). One person tapping repeatedly gets one fresh attempt series, not a render loop.
--
-- Rollback: drop the function. That returns the exhausted-job path to a 409 that misdescribes it.

create or replace function public.requeue_certificate_pdf(p_certificate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cert public.certificates%rowtype;
  v_job public.certificate_pdf_jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_cert from public.certificates where id = p_certificate_id;
  if not found then
    raise exception 'Certificate not found' using errcode = 'P0002';
  end if;

  if not (
    public.is_platform_admin()
    or (v_cert.organization_id = public.current_org_id()
        and public.current_profile_active()
        and public.current_role() = 'org_admin')
    or public.owns_employee(v_cert.employee_id)
  ) then
    raise exception 'Not authorized to requeue this certificate PDF' using errcode = '42501';
  end if;

  -- One job per certificate: certificate_pdf_jobs_certificate_id_key, written by the
  -- enqueue_certificate_artifacts trigger when the certificate is issued.
  select * into v_job
  from public.certificate_pdf_jobs
  where certificate_id = p_certificate_id
  for update;

  if not found then
    raise exception 'This certificate has no PDF job to requeue' using errcode = 'P0002';
  end if;

  -- Only a job that has given up. A job that is pending, leased, or has attempts left is already
  -- going to be picked up, and saying so is more useful than silently pretending to do something.
  if v_job.status = 'succeeded' then
    raise exception 'This certificate PDF has already been prepared' using errcode = '22023';
  end if;
  if v_job.attempt_count < v_job.max_attempts then
    raise exception 'This certificate PDF is still being retried automatically' using errcode = '22023';
  end if;

  -- `certificates` writes go through protect_certificate_write; this is the same escape hatch
  -- claim_certificate_pdf_jobs and finish_certificate_pdf_job set for the worker's own writes.
  perform set_config('app.privileged_write', 'on', true);

  update public.certificate_pdf_jobs
  set status = 'pending',
      attempt_count = 0,
      current_run_id = null,
      worker_id = null,
      locked_at = null,
      available_at = now(),
      completed_at = null
  where id = v_job.id;

  update public.certificates
  set pdf_status = 'pending',
      pdf_attempt_count = 0
  where id = p_certificate_id;

  perform set_config('app.privileged_write', 'off', true);

  return jsonb_build_object(
    'certificateId', p_certificate_id,
    'jobId', v_job.id,
    'status', 'pending',
    'previousAttempts', v_job.attempt_count,
    'lastError', v_job.last_error_message
  );
end;
$$;

revoke all on function public.requeue_certificate_pdf(uuid) from public, anon;
grant execute on function public.requeue_certificate_pdf(uuid) to authenticated;

comment on function public.requeue_certificate_pdf(uuid) is
  'Gives an exhausted certificate PDF job a fresh set of attempts. Platform admin, org_admin in the certificate organization, or the certificate holder. Refuses any job that is not exhausted.';

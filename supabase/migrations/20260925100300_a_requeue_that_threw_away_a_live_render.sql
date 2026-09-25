-- requeue_certificate_pdf (20260905050000) said it refused a job "currently leased by a worker" and
-- did not: its only guards were `status = 'succeeded'` and `attempt_count < max_attempts`, and
-- claim_certificate_pdf_jobs increments attempt_count when it hands a job out -- so during the
-- fifth attempt the row reads status = 'processing', attempt_count = 5 = max_attempts, and passes
-- both. generate-certificate-pdf reports "exhausted" from attempt_count alone, the page then calls
-- this RPC, and it reset the job under the worker: the worker's finish_certificate_pdf_job became
-- a run-id mismatch, its uploaded PDF was never recorded, a second five-attempt series began, and
-- the employee was told to wait again. A lease younger than the claim's own 15-minute stale window
-- is a render in progress and is refused with a reason; an older one is abandoned and requeueable.
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
  -- claim_certificate_pdf_jobs increments attempt_count as it hands a job out, so the final attempt
  -- sits at attempt_count = max_attempts while still leased. Resetting it makes the worker's finish
  -- a run-id mismatch and throws away the PDF it is writing. Only a lease older than the claim's own
  -- 15-minute stale window is genuinely abandoned.
  if v_job.status = 'processing'
     and v_job.locked_at is not null
     and v_job.locked_at >= now() - interval '15 minutes' then
    raise exception 'This certificate PDF is being rendered right now. Try again in a few minutes.'
      using errcode = '22023';
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

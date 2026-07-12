-- Phase 1 / recommendation #1: make course completion, certificate issuance, and the
-- durable follow-up work one replay-safe transaction.
--
-- The previous browser flow called complete_course_assignment() and issue_certificate()
-- in separate requests. A network error or closed tab between those calls left a valid
-- completion with no certificate. The database is the only layer that can make that
-- invariant atomic under retries and concurrent submissions, so issuance now happens in
-- complete_course_assignment() while the legacy issue_certificate() RPC remains as an
-- idempotent compatibility endpoint.

-- ---------------------------------------------------------------------------
-- Certificate identity and observable PDF state
-- ---------------------------------------------------------------------------

alter table public.certificates
  add column credential_number text,
  add column pdf_status text not null default 'pending',
  add column pdf_attempt_count integer not null default 0,
  add column pdf_last_attempt_at timestamptz,
  add column pdf_ready_at timestamptz,
  add column pdf_last_error text;

-- Existing slugs are already unique, random, and immutable. Deriving the one-time
-- backfill from them avoids generating a second identity for an already-issued award.
update public.certificates
set credential_number = 'CMT-' || upper(slug),
    pdf_status = case
      when pdf_storage_bucket is not null and pdf_storage_path is not null then 'ready'
      else 'pending'
    end,
    pdf_ready_at = case
      when pdf_storage_bucket is not null and pdf_storage_path is not null then updated_at
      else null
    end;

alter table public.certificates
  alter column credential_number set not null,
  alter column credential_number set default ('CMT-' || upper(encode(extensions.gen_random_bytes(10), 'hex'))),
  add constraint certificates_credential_number_key unique (credential_number),
  add constraint certificates_pdf_status_check
    check (pdf_status in ('pending', 'processing', 'ready', 'failed')) not valid,
  add constraint certificates_pdf_attempt_count_check
    check (pdf_attempt_count >= 0) not valid,
  add constraint certificates_pdf_storage_consistency_check
    check (
      (pdf_status = 'ready' and pdf_storage_bucket is not null and pdf_storage_path is not null and pdf_ready_at is not null)
      or pdf_status <> 'ready'
    ) not valid;

alter table public.certificates validate constraint certificates_pdf_status_check;
alter table public.certificates validate constraint certificates_pdf_attempt_count_check;
alter table public.certificates validate constraint certificates_pdf_storage_consistency_check;

-- ---------------------------------------------------------------------------
-- Certificate-specific transactional outbox and durable PDF jobs
-- ---------------------------------------------------------------------------

create table public.certificate_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  certificate_id uuid not null references public.certificates(id) on delete cascade,
  course_assignment_id uuid,
  event_type text not null
    constraint certificate_lifecycle_events_type_check
    check (event_type in ('certificate_issued')),
  idempotency_key text not null unique,
  correlation_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  delivery_status text not null default 'pending'
    constraint certificate_lifecycle_events_delivery_status_check
    check (delivery_status in ('pending', 'published', 'failed')),
  delivery_attempt_count integer not null default 0
    constraint certificate_lifecycle_events_attempt_count_check
    check (delivery_attempt_count >= 0),
  last_delivery_attempt_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certificate_lifecycle_events_certificate_type_key unique (certificate_id, event_type)
);

create index certificate_lifecycle_events_delivery_idx
  on public.certificate_lifecycle_events(delivery_status, created_at)
  where delivery_status in ('pending', 'failed');
create index certificate_lifecycle_events_org_created_idx
  on public.certificate_lifecycle_events(organization_id, created_at desc);

create table public.certificate_pdf_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  certificate_id uuid not null unique references public.certificates(id) on delete cascade,
  correlation_id uuid not null,
  job_key text not null unique,
  status text not null default 'pending'
    constraint certificate_pdf_jobs_status_check
    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  attempt_count integer not null default 0
    constraint certificate_pdf_jobs_attempt_count_check
    check (attempt_count >= 0),
  max_attempts integer not null default 5
    constraint certificate_pdf_jobs_max_attempts_check
    check (max_attempts > 0),
  current_run_id uuid,
  worker_id uuid,
  requested_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certificate_pdf_jobs_processing_consistency_check check (
    (status = 'processing' and current_run_id is not null and worker_id is not null and locked_at is not null)
    or status <> 'processing'
  )
);

create index certificate_pdf_jobs_claim_idx
  on public.certificate_pdf_jobs(available_at, requested_at)
  where status in ('pending', 'failed');
create index certificate_pdf_jobs_stale_idx
  on public.certificate_pdf_jobs(locked_at)
  where status = 'processing';
create index certificate_pdf_jobs_org_created_idx
  on public.certificate_pdf_jobs(organization_id, created_at desc);

create trigger set_updated_at before update on public.certificate_lifecycle_events
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.certificate_pdf_jobs
  for each row execute function public.set_updated_at();

alter table public.certificate_lifecycle_events enable row level security;
alter table public.certificate_pdf_jobs enable row level security;

-- Learners and facility-scoped staff may observe lifecycle state for certificates they can
-- already select. No browser role can create, claim, or finish jobs/events.
create policy certificate_lifecycle_events_select
on public.certificate_lifecycle_events for select to authenticated
using (
  (select public.is_platform_admin())
  or exists (
    select 1
    from public.certificates c
    where c.id = certificate_lifecycle_events.certificate_id
      and (
        public.owns_employee(c.employee_id)
        or (
          c.organization_id = (select public.current_org_id())
          and public.is_assigned_to_facility(c.facility_id)
        )
      )
  )
);

create policy certificate_pdf_jobs_select
on public.certificate_pdf_jobs for select to authenticated
using (
  (select public.is_platform_admin())
  or exists (
    select 1
    from public.certificates c
    where c.id = certificate_pdf_jobs.certificate_id
      and (
        public.owns_employee(c.employee_id)
        or (
          c.organization_id = (select public.current_org_id())
          and public.is_assigned_to_facility(c.facility_id)
        )
      )
  )
);

revoke all on table public.certificate_lifecycle_events from public, anon, authenticated;
revoke all on table public.certificate_pdf_jobs from public, anon, authenticated;
grant select on table public.certificate_lifecycle_events to authenticated;
grant select on table public.certificate_pdf_jobs to authenticated;
grant all on table public.certificate_lifecycle_events to service_role;
grant all on table public.certificate_pdf_jobs to service_role;

create or replace function public.enqueue_certificate_artifacts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.certificate_lifecycle_events (
    organization_id, certificate_id, course_assignment_id, event_type,
    idempotency_key, correlation_id, payload
  )
  values (
    new.organization_id,
    new.id,
    new.course_assignment_id,
    'certificate_issued',
    'certificate_issued:' || new.id::text,
    coalesce(new.course_assignment_id, new.id),
    jsonb_build_object(
      'certificate_id', new.id,
      'course_assignment_id', new.course_assignment_id,
      'employee_id', new.employee_id,
      'course_id', new.course_id,
      'credential_number', new.credential_number,
      'issued_at', new.issued_at
    )
  )
  on conflict (certificate_id, event_type) do nothing;

  insert into public.certificate_pdf_jobs (
    organization_id, certificate_id, correlation_id, job_key, status, completed_at
  )
  values (
    new.organization_id,
    new.id,
    coalesce(new.course_assignment_id, new.id),
    'certificate_pdf:' || new.id::text,
    case when new.pdf_status = 'ready' then 'succeeded' else 'pending' end,
    case when new.pdf_status = 'ready' then coalesce(new.pdf_ready_at, now()) else null end
  )
  on conflict (certificate_id) do nothing;

  return new;
end;
$function$;

revoke all on function public.enqueue_certificate_artifacts() from public, anon, authenticated;

create trigger enqueue_certificate_artifacts
after insert on public.certificates
for each row execute function public.enqueue_certificate_artifacts();

-- Backfill lifecycle state for certificates that predate the trigger. This does not mint
-- missing historical certificates; the bounded reconciliation RPC below does that safely.
insert into public.certificate_lifecycle_events (
  organization_id, certificate_id, course_assignment_id, event_type,
  idempotency_key, correlation_id, payload
)
select
  c.organization_id,
  c.id,
  c.course_assignment_id,
  'certificate_issued',
  'certificate_issued:' || c.id::text,
  coalesce(c.course_assignment_id, c.id),
  jsonb_build_object(
    'certificate_id', c.id,
    'course_assignment_id', c.course_assignment_id,
    'employee_id', c.employee_id,
    'course_id', c.course_id,
    'credential_number', c.credential_number,
    'issued_at', c.issued_at
  )
from public.certificates c
on conflict (certificate_id, event_type) do nothing;

insert into public.certificate_pdf_jobs (
  organization_id, certificate_id, correlation_id, job_key, status, completed_at
)
select
  c.organization_id,
  c.id,
  coalesce(c.course_assignment_id, c.id),
  'certificate_pdf:' || c.id::text,
  case when c.pdf_status = 'ready' then 'succeeded' else 'pending' end,
  c.pdf_ready_at
from public.certificates c
on conflict (certificate_id) do nothing;

-- ---------------------------------------------------------------------------
-- Atomic, idempotent completion and compatibility issuance RPCs
-- ---------------------------------------------------------------------------

create or replace function public.complete_course_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_assignment public.course_assignments%rowtype;
  v_is_self boolean;
  v_was_completed boolean;
  v_course record;
  v_progress record;
  v_record_id uuid;
  v_certificate_id uuid;
  v_min_seconds numeric;
begin
  -- This row lock is the concurrency boundary: only one transaction can transition and
  -- issue for an assignment at a time. Replays wait, then reuse the committed certificate.
  select ca.* into v_assignment
  from public.course_assignments ca
  where ca.id = p_assignment_id
  for update of ca;

  if v_assignment.id is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = 'no_data_found';
  end if;

  v_is_self := public.owns_employee(v_assignment.employee_id);
  if not (
    public.is_platform_admin()
    or (
      v_assignment.organization_id = public.current_org_id()
      and (
        public."current_role"() = 'org_admin'
        or (
          public."current_role"() in ('facility_manager', 'trainer')
          and public.is_assigned_to_facility(v_assignment.facility_id)
        )
      )
    )
    or v_is_self
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  v_was_completed := v_assignment.status = 'completed';
  select * into v_course from public.courses where id = v_assignment.course_id;

  -- Integrity gates apply only to a learner's first transition. A replay of an already-valid
  -- completion must be able to repair a missing certificate without rewriting evidence dates.
  if v_is_self and not v_was_completed then
    select * into v_progress
    from public.course_progress
    where assignment_id = p_assignment_id;

    v_min_seconds := greatest(
      60,
      round(coalesce(v_course.estimated_duration_minutes, 0)::numeric * 60 * 0.10)
    );

    if v_progress.started_at is null then
      raise exception 'This course has not been started yet -- open it and work through at least one lesson before marking it complete.'
        using errcode = 'check_violation';
    end if;

    if extract(epoch from (now() - v_progress.started_at)) < v_min_seconds then
      raise exception 'This course needs to stay open for at least % minute(s) before it can be marked complete -- % minute(s) have elapsed so far.',
        ceil(v_min_seconds / 60.0),
        floor(extract(epoch from (now() - v_progress.started_at)) / 60.0)
        using errcode = 'check_violation', hint = 'Continue through the course content, then try again.';
    end if;

    if exists (
      select 1
      from public.course_blocks cb
      where cb.course_version_id = v_assignment.course_version_id
        and cb.block_type = 'quiz'
        and not exists (
          select 1
          from public.quizzes qz
          join public.quiz_attempts qa on qa.quiz_id = qz.id
          where qz.course_block_id = cb.id
            and qa.assignment_id = p_assignment_id
            and qa.passed = true
        )
    ) then
      raise exception 'This course has one or more quizzes that must be passed before it can be marked complete.'
        using errcode = 'check_violation', hint = 'Take (and pass) every quiz in this course, then try again.';
    end if;
  end if;

  perform set_config('app.privileged_write', 'on', true);

  if not v_was_completed then
    update public.course_assignments
    set status = 'completed', completed_at = now()
    where id = p_assignment_id;

    -- The compliance bridge is transition-only. A retry must never move the evidence's
    -- completion date forward or add annual hours a second time.
    if v_course.training_type_id is not null then
      select id into v_record_id
      from public.employee_training_records
      where employee_id = v_assignment.employee_id
        and training_type_id = v_course.training_type_id
      order by due_date desc nulls last, completion_date desc nulls last, created_at desc
      limit 1
      for update;

      if v_record_id is not null then
        update public.employee_training_records
        set completion_date = current_date,
            status = 'compliant',
            completion_method = 'online',
            training_provider = 'CareMetric Train LMS',
            hours = round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
            notes = 'Auto-recorded on completion of course "' || v_course.title || '".'
        where id = v_record_id;
      else
        insert into public.employee_training_records (
          organization_id, facility_id, employee_id, training_type_id,
          completion_date, status, hours, completion_method, training_provider, notes
        )
        values (
          v_assignment.organization_id,
          v_assignment.facility_id,
          v_assignment.employee_id,
          v_course.training_type_id,
          current_date,
          'compliant',
          round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
          'online',
          'CareMetric Train LMS',
          'Auto-recorded on completion of course "' || v_course.title || '".'
        );
      end if;
    end if;
  end if;

  insert into public.certificates (
    organization_id, facility_id, employee_id, course_id, course_assignment_id,
    issued_at, expires_at
  )
  values (
    v_assignment.organization_id,
    v_assignment.facility_id,
    v_assignment.employee_id,
    v_assignment.course_id,
    v_assignment.id,
    coalesce(v_assignment.completed_at, now()),
    null
  )
  on conflict (course_assignment_id) do nothing
  returning id into v_certificate_id;

  if v_certificate_id is null then
    select id into v_certificate_id
    from public.certificates
    where course_assignment_id = p_assignment_id;
  end if;

  if v_certificate_id is null then
    raise exception 'certificate reconciliation failed for assignment %', p_assignment_id;
  end if;

  if not v_was_completed then
    perform public.recalculate_compliance_core(v_assignment.organization_id);
  end if;
end;
$function$;

revoke all on function public.complete_course_assignment(uuid) from public, anon;
grant execute on function public.complete_course_assignment(uuid) to authenticated;

create or replace function public.issue_certificate(
  p_employee_id uuid,
  p_course_id uuid,
  p_course_assignment_id uuid default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_assignment public.course_assignments%rowtype;
  v_id uuid;
begin
  if p_course_assignment_id is null then
    raise exception 'course_assignment_id is required to issue a certificate'
      using errcode = 'invalid_parameter_value';
  end if;

  select ca.* into v_assignment
  from public.course_assignments ca
  where ca.id = p_course_assignment_id
  for update of ca;

  if v_assignment.id is null then
    raise exception 'course_assignment % not found', p_course_assignment_id
      using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_assignment.organization_id = public.current_org_id()
      and (
        public."current_role"() = 'org_admin'
        or (
          public."current_role"() in ('facility_manager', 'trainer')
          and public.is_assigned_to_facility(v_assignment.facility_id)
        )
      )
    )
    or public.owns_employee(v_assignment.employee_id)
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_assignment.employee_id <> p_employee_id
     or v_assignment.course_id <> p_course_id
     or v_assignment.status <> 'completed' then
    raise exception 'course_assignment % is not a completed assignment of employee % for course %',
      p_course_assignment_id, p_employee_id, p_course_id
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.privileged_write', 'on', true);

  insert into public.certificates (
    organization_id, facility_id, employee_id, course_id, course_assignment_id,
    issued_at, expires_at
  )
  values (
    v_assignment.organization_id,
    v_assignment.facility_id,
    v_assignment.employee_id,
    v_assignment.course_id,
    v_assignment.id,
    coalesce(v_assignment.completed_at, now()),
    p_expires_at
  )
  on conflict (course_assignment_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.certificates
    where course_assignment_id = p_course_assignment_id;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.issue_certificate(uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.issue_certificate(uuid, uuid, uuid, timestamptz) to authenticated;

-- Bounded, repeatable repair for historical completed assignments. Run through the service-role
-- API until missing_certificates_remaining reaches zero; every invocation has a predictable lock
-- and transaction footprint, and the same uniqueness/trigger rails as live completion.
create or replace function public.reconcile_course_completion_certificates(
  p_organization_id uuid default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_created integer := 0;
  v_events_repaired integer := 0;
  v_jobs_repaired integer := 0;
  v_remaining bigint := 0;
begin
  if p_limit < 1 or p_limit > 5000 then
    raise exception 'p_limit must be between 1 and 5000' using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('app.privileged_write', 'on', true);

  with missing as (
    select ca.id, ca.organization_id, ca.facility_id, ca.employee_id, ca.course_id, ca.completed_at
    from public.course_assignments ca
    left join public.certificates c on c.course_assignment_id = ca.id
    where ca.status = 'completed'
      and c.id is null
      and (p_organization_id is null or ca.organization_id = p_organization_id)
    order by ca.completed_at, ca.id
    limit p_limit
    for update of ca skip locked
  )
  insert into public.certificates (
    organization_id, facility_id, employee_id, course_id, course_assignment_id, issued_at
  )
  select organization_id, facility_id, employee_id, course_id, id, coalesce(completed_at, now())
  from missing
  on conflict (course_assignment_id) do nothing;

  get diagnostics v_created = row_count;

  insert into public.certificate_lifecycle_events (
    organization_id, certificate_id, course_assignment_id, event_type,
    idempotency_key, correlation_id, payload
  )
  select
    c.organization_id,
    c.id,
    c.course_assignment_id,
    'certificate_issued',
    'certificate_issued:' || c.id::text,
    coalesce(c.course_assignment_id, c.id),
    jsonb_build_object(
      'certificate_id', c.id,
      'course_assignment_id', c.course_assignment_id,
      'employee_id', c.employee_id,
      'course_id', c.course_id,
      'credential_number', c.credential_number,
      'issued_at', c.issued_at
    )
  from public.certificates c
  where p_organization_id is null or c.organization_id = p_organization_id
  on conflict (certificate_id, event_type) do nothing;

  get diagnostics v_events_repaired = row_count;

  insert into public.certificate_pdf_jobs (
    organization_id, certificate_id, correlation_id, job_key, status, completed_at
  )
  select
    c.organization_id,
    c.id,
    coalesce(c.course_assignment_id, c.id),
    'certificate_pdf:' || c.id::text,
    case when c.pdf_status = 'ready' then 'succeeded' else 'pending' end,
    c.pdf_ready_at
  from public.certificates c
  where p_organization_id is null or c.organization_id = p_organization_id
  on conflict (certificate_id) do nothing;

  get diagnostics v_jobs_repaired = row_count;

  select count(*) into v_remaining
  from public.course_assignments ca
  left join public.certificates c on c.course_assignment_id = ca.id
  where ca.status = 'completed'
    and c.id is null
    and (p_organization_id is null or ca.organization_id = p_organization_id);

  return jsonb_build_object(
    'certificates_created', v_created,
    'events_repaired', v_events_repaired,
    'pdf_jobs_repaired', v_jobs_repaired,
    'missing_certificates_remaining', v_remaining
  );
end;
$function$;

revoke all on function public.reconcile_course_completion_certificates(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_course_completion_certificates(uuid, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Service-role worker protocol for durable, retry-safe PDF rendering
-- ---------------------------------------------------------------------------

create or replace function public.claim_certificate_pdf_jobs(
  p_worker_id uuid,
  p_certificate_id uuid default null,
  p_limit integer default 10
)
returns table (
  job_id uuid,
  certificate_id uuid,
  correlation_id uuid,
  run_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception 'p_limit must be between 1 and 50' using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('app.privileged_write', 'on', true);

  return query
  with candidates as (
    select j.id
    from public.certificate_pdf_jobs j
    where (p_certificate_id is null or j.certificate_id = p_certificate_id)
      and j.attempt_count < j.max_attempts
      and (
        (j.status in ('pending', 'failed') and j.available_at <= now())
        or (j.status = 'processing' and j.locked_at < now() - interval '15 minutes')
      )
    order by j.available_at, j.requested_at
    limit p_limit
    for update of j skip locked
  ), claimed as (
    update public.certificate_pdf_jobs j
    set status = 'processing',
        attempt_count = j.attempt_count + 1,
        current_run_id = gen_random_uuid(),
        worker_id = p_worker_id,
        locked_at = now(),
        last_started_at = now(),
        last_error_code = null,
        last_error_message = null
    from candidates c
    where j.id = c.id
    returning j.id, j.certificate_id, j.correlation_id, j.current_run_id, j.attempt_count
  ), certificate_state as (
    update public.certificates cert
    set pdf_status = 'processing',
        pdf_attempt_count = claimed.attempt_count,
        pdf_last_attempt_at = now(),
        pdf_last_error = null
    from claimed
    where cert.id = claimed.certificate_id
    returning cert.id
  )
  select c.id, c.certificate_id, c.correlation_id, c.current_run_id, c.attempt_count
  from claimed c;
end;
$function$;

revoke all on function public.claim_certificate_pdf_jobs(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_certificate_pdf_jobs(uuid, uuid, integer)
  to service_role;

create or replace function public.finish_certificate_pdf_job(
  p_job_id uuid,
  p_run_id uuid,
  p_bucket text default null,
  p_path text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.certificate_pdf_jobs%rowtype;
  v_success boolean;
  v_retry boolean;
begin
  select j.* into v_job
  from public.certificate_pdf_jobs j
  where j.id = p_job_id
  for update of j;

  if v_job.id is null
     or v_job.status <> 'processing'
     or v_job.current_run_id is distinct from p_run_id then
    return false;
  end if;

  v_success := p_bucket is not null and p_path is not null and p_error_message is null;
  v_retry := not v_success and v_job.attempt_count < v_job.max_attempts;

  perform set_config('app.privileged_write', 'on', true);

  if v_success then
    update public.certificate_pdf_jobs
    set status = 'succeeded',
        current_run_id = null,
        worker_id = null,
        locked_at = null,
        completed_at = now(),
        last_error_code = null,
        last_error_message = null
    where id = v_job.id;

    update public.certificates
    set pdf_storage_bucket = p_bucket,
        pdf_storage_path = p_path,
        pdf_status = 'ready',
        pdf_attempt_count = v_job.attempt_count,
        pdf_last_attempt_at = now(),
        pdf_ready_at = now(),
        pdf_last_error = null
    where id = v_job.certificate_id;
  else
    update public.certificate_pdf_jobs
    set status = case when v_retry then 'pending' else 'failed' end,
        current_run_id = null,
        worker_id = null,
        locked_at = null,
        available_at = case
          when v_retry then now() + make_interval(secs => least(3600, 30 * (2 ^ greatest(0, v_job.attempt_count - 1))))
          else available_at
        end,
        completed_at = case when v_retry then null else now() end,
        last_error_code = left(coalesce(p_error_code, 'render_failed'), 120),
        last_error_message = left(coalesce(p_error_message, 'Certificate PDF generation failed'), 2000)
    where id = v_job.id;

    update public.certificates
    set pdf_status = case when v_retry then 'pending' else 'failed' end,
        pdf_attempt_count = v_job.attempt_count,
        pdf_last_attempt_at = now(),
        pdf_last_error = left(coalesce(p_error_message, 'Certificate PDF generation failed'), 2000)
    where id = v_job.certificate_id;
  end if;

  return true;
end;
$function$;

revoke all on function public.finish_certificate_pdf_job(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_certificate_pdf_job(uuid, uuid, text, text, text, text)
  to service_role;

-- Keep the original trusted setter compatible for a rolling deployment. It now also closes the
-- durable job so an old Edge Function instance cannot leave a ready PDF looking pending.
create or replace function public.set_certificate_pdf(
  p_certificate_id uuid,
  p_bucket text,
  p_path text
)
returns public.certificates
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_row public.certificates;
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.certificates
  set pdf_storage_bucket = p_bucket,
      pdf_storage_path = p_path,
      pdf_status = 'ready',
      pdf_last_attempt_at = now(),
      pdf_ready_at = now(),
      pdf_last_error = null
  where id = p_certificate_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'certificate % not found', p_certificate_id using errcode = 'no_data_found';
  end if;

  update public.certificate_pdf_jobs
  set status = 'succeeded',
      current_run_id = null,
      worker_id = null,
      locked_at = null,
      completed_at = now(),
      last_error_code = null,
      last_error_message = null
  where certificate_id = p_certificate_id;

  return v_row;
end;
$function$;

revoke all on function public.set_certificate_pdf(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_certificate_pdf(uuid, text, text) to service_role;

-- Render queued certificates independently of the completion request. The Edge Function also
-- supports an authenticated, one-certificate fast path for a user clicking Download.
select cron.schedule(
  'process-certificate-pdf-jobs',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/generate-certificate-pdf',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', coalesce((
           select decrypted_secret
           from vault.decrypted_secrets
           where name = 'cron_shared_secret'
           limit 1
         ), '')
       ),
       body := jsonb_build_object('batchSize', 10)
     ); $$
);

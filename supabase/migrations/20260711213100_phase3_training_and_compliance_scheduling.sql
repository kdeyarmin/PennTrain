alter table public.training_classes
  add column capacity integer not null default 20 check (capacity between 1 and 1000),
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column room_name text,
  add column resource_requirements jsonb not null default '{}'::jsonb,
  add column makeup_of_class_id uuid references public.training_classes(id) on delete set null,
  add column cancellation_reason text,
  add column rescheduled_to_class_id uuid references public.training_classes(id) on delete set null,
  add column completion_approved_by uuid references public.profiles(id),
  add column completion_approved_at timestamptz,
  add column lock_version integer not null default 1 check (lock_version > 0);

alter table public.training_classes drop constraint training_classes_status_check;
alter table public.training_classes add constraint training_classes_status_check
check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'));
alter table public.training_classes add constraint training_classes_time_valid
check (ends_at is null or starts_at is not null and ends_at > starts_at);

alter table public.shift_assignments drop constraint shift_assignments_source_check;
alter table public.shift_assignments add constraint shift_assignments_source_check
check (source in ('manual', 'auto_fill', 'self_service', 'swap'));
alter table public.shift_assignments drop constraint shift_assignments_employee_id_shift_date_key;
alter table public.shift_assignments add constraint shift_assignments_employee_id_shift_date_key
unique (employee_id, shift_date) deferrable initially immediate;

create table public.training_session_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  class_id uuid not null references public.training_classes(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  registration_status text not null check (registration_status in (
    'registered', 'waitlisted', 'cancelled', 'attended', 'no_show', 'makeup_required'
  )),
  waitlist_position integer check (waitlist_position is null or waitlist_position > 0),
  registration_source text not null check (registration_source in ('employee', 'manager', 'import')),
  registered_by uuid references public.profiles(id),
  registered_at timestamptz not null default now(),
  canceled_at timestamptz,
  cancellation_reason text,
  attendance_recorded_at timestamptz,
  training_record_id uuid references public.employee_training_records(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, employee_id),
  check ((registration_status = 'waitlisted') = (waitlist_position is not null))
);
create index training_session_registrations_queue_idx
on public.training_session_registrations(class_id, registration_status, waitlist_position);
create trigger set_updated_at before update on public.training_session_registrations
for each row execute function public.set_updated_at();

create table public.training_attendance_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  registration_id uuid not null unique references public.training_session_registrations(id) on delete restrict,
  attendance_status text not null check (attendance_status in ('attended', 'no_show', 'partial')),
  check_in_at timestamptz,
  check_out_at timestamptz,
  seat_minutes integer check (seat_minutes is null or seat_minutes >= 0),
  evidence jsonb not null default '{}'::jsonb,
  attendee_signature_sha256 text check (attendee_signature_sha256 ~ '^[0-9a-f]{64}$'),
  recorder_signature_sha256 text not null check (recorder_signature_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_checksum_sha256 text not null check (evidence_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  check (check_out_at is null or check_in_at is not null and check_out_at >= check_in_at)
);

create table public.training_session_completion_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  class_id uuid not null unique references public.training_classes(id) on delete restrict,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  attendee_count integer not null check (attendee_count >= 0),
  training_record_count integer not null check (training_record_count >= 0),
  evidence_checksum_sha256 text not null check (evidence_checksum_sha256 ~ '^[0-9a-f]{64}$')
);

create table public.schedule_eligibility_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  max_weekly_hours numeric(5,2) not null default 40 check (max_weekly_hours between 1 and 168),
  warning_weekly_hours numeric(5,2) not null default 36 check (warning_weekly_hours between 0 and 168),
  minimum_rest_hours numeric(5,2) not null default 8 check (minimum_rest_hours between 0 and 24),
  claim_deadline_hours integer not null default 4 check (claim_deadline_hours between 0 and 720),
  swap_deadline_hours integer not null default 24 check (swap_deadline_hours between 0 and 720),
  manager_approval_required boolean not null default false,
  waitlist_enabled boolean not null default true,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (warning_weekly_hours <= max_weekly_hours)
);
create trigger set_updated_at before update on public.schedule_eligibility_policies
for each row execute function public.set_updated_at();

insert into public.schedule_eligibility_policies(organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

create or replace function app_private.provision_phase3_schedule_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.schedule_eligibility_policies(organization_id)
  values (new.id) on conflict (organization_id) do nothing;
  return new;
end;
$$;
revoke all on function app_private.provision_phase3_schedule_policy()
from public, anon, authenticated, service_role;
create trigger provision_phase3_schedule_policy
after insert on public.organizations
for each row execute function app_private.provision_phase3_schedule_policy();

create table public.schedule_eligibility_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  block_code text not null,
  scope_type text not null check (scope_type in ('facility', 'shift', 'class')),
  scope_id uuid,
  reason text not null check (length(btrim(reason)) >= 8),
  authority_reference text not null check (length(btrim(authority_reference)) >= 3),
  effective_from timestamptz not null default now(),
  expires_at timestamptz not null,
  granted_by uuid not null references public.profiles(id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revocation_reason text,
  created_at timestamptz not null default now(),
  check (expires_at > effective_from),
  check (block_code not in ('lifecycle_inactive', 'confirmed_exclusion'))
);
create index schedule_eligibility_overrides_active_idx
on public.schedule_eligibility_overrides(employee_id, facility_id, block_code, expires_at)
where revoked_at is null;

create table public.shift_eligibility_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  shift_definition_id uuid not null references public.shift_definitions(id) on delete cascade,
  required_qualification_keys text[] not null default array[]::text[],
  required_credential_types text[] not null default array[]::text[],
  required_training_type_ids uuid[] not null default array[]::uuid[],
  is_active boolean not null default true,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, shift_definition_id)
);
create trigger set_updated_at before update on public.shift_eligibility_requirements
for each row execute function public.set_updated_at();

create table public.schedule_eligibility_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  decision_context text not null check (decision_context in ('manager_assignment', 'open_shift_claim', 'shift_swap', 'training_registration')),
  target_type text not null check (target_type in ('shift', 'open_shift', 'swap', 'class')),
  target_id uuid,
  evaluated_for_start timestamptz not null,
  evaluated_for_end timestamptz not null,
  outcome text not null check (outcome in ('eligible', 'warning', 'blocked')),
  hard_blocks text[] not null default array[]::text[],
  warnings text[] not null default array[]::text[],
  applied_override_ids uuid[] not null default array[]::uuid[],
  source_snapshot jsonb not null,
  source_checksum_sha256 text not null check (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  evaluated_by uuid references public.profiles(id),
  evaluated_at timestamptz not null default now(),
  check (evaluated_for_end > evaluated_for_start)
);
create index schedule_eligibility_decisions_employee_idx
on public.schedule_eligibility_decisions(employee_id, evaluated_at desc);

create table public.employee_availability_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete cascade,
  availability_type text not null check (availability_type in ('available', 'unavailable', 'preferred')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  recurrence_rule text,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index employee_availability_windows_employee_idx
on public.employee_availability_windows(employee_id, starts_at, ends_at);
create trigger set_updated_at before update on public.employee_availability_windows
for each row execute function public.set_updated_at();

create table public.open_shift_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  unit_id uuid references public.facility_units(id) on delete set null,
  shift_definition_id uuid references public.shift_definitions(id) on delete set null,
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  slots integer not null default 1 check (slots between 1 and 100),
  required_qualification_keys text[] not null default array[]::text[],
  required_credential_types text[] not null default array[]::text[],
  required_training_type_ids uuid[] not null default array[]::uuid[],
  status text not null default 'open' check (status in ('draft', 'open', 'filled', 'closed', 'canceled')),
  claim_deadline timestamptz not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index open_shift_opportunities_open_idx
on public.open_shift_opportunities(facility_id, shift_date, status);
create trigger set_updated_at before update on public.open_shift_opportunities
for each row execute function public.set_updated_at();

create table public.open_shift_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null references public.open_shift_opportunities(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  claim_status text not null check (claim_status in ('approved', 'pending_approval', 'waitlisted', 'declined', 'canceled', 'rejected')),
  waitlist_position integer,
  eligibility_decision_id uuid not null references public.schedule_eligibility_decisions(id) on delete restrict,
  shift_assignment_id uuid references public.shift_assignments(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  unique (opportunity_id, employee_id),
  check ((claim_status = 'waitlisted') = (waitlist_position is not null))
);

create table public.shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  requester_employee_id uuid not null references public.employees(id) on delete restrict,
  requester_assignment_id uuid not null references public.shift_assignments(id) on delete restrict,
  target_employee_id uuid not null references public.employees(id) on delete restrict,
  target_assignment_id uuid not null references public.shift_assignments(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'canceled', 'expired')),
  reason text not null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  requester_decision_id uuid references public.schedule_eligibility_decisions(id) on delete restrict,
  target_decision_id uuid references public.schedule_eligibility_decisions(id) on delete restrict,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  check (requester_employee_id <> target_employee_id),
  check (requester_assignment_id <> target_assignment_id),
  check (expires_at > requested_at)
);

create or replace function app_private.trainer_is_qualified(
  p_trainer_profile_id uuid,
  p_training_type_id uuid,
  p_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    join public.training_types t on t.id = p_training_type_id
    where e.profile_id = p_trainer_profile_id
      and e.status = 'active'
      and public.employee_has_active_qualification(
        e.id, 'trainer.' || lower(regexp_replace(t.code, '[^a-zA-Z0-9_.-]+', '-', 'g')), p_at
      )
  );
$$;
revoke all on function app_private.trainer_is_qualified(uuid,uuid,timestamptz)
from public, anon, authenticated, service_role;

create or replace function public.register_for_training_session(
  p_class_id uuid,
  p_employee_id uuid
)
returns table(registration_id uuid, registration_status text, waitlist_position integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.training_classes%rowtype;
  v_employee public.employees%rowtype;
  v_count integer;
  v_status text;
  v_position integer;
  v_id uuid;
  v_is_self boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('training-class:' || p_class_id::text, 0));
  select * into v_class from public.training_classes where id = p_class_id for update;
  select * into v_employee from public.employees where id = p_employee_id;
  if v_class.id is null or v_employee.id is null then
    raise exception 'Training class or employee not found' using errcode = 'P0002';
  end if;
  v_is_self := v_employee.profile_id = auth.uid();
  if not v_is_self then
    perform app_private.assert_phase3_admin(v_class.organization_id, 'training.sessions.manage', v_class.facility_id);
  end if;
  if v_employee.organization_id <> v_class.organization_id
     or v_employee.status <> 'active'
     or v_class.status not in ('scheduled', 'in_progress') then
    raise exception 'Employee or class is not eligible for registration' using errcode = '23514';
  end if;
  if not app_private.trainer_is_qualified(
    v_class.trainer_profile_id, v_class.training_type_id,
    coalesce(v_class.starts_at, v_class.class_date::timestamptz)
  ) then
    raise exception 'The assigned trainer is not qualified for this training type'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.training_session_registrations r where r.class_id = p_class_id and r.employee_id = p_employee_id) then
    return query select r.id, r.registration_status, r.waitlist_position
    from public.training_session_registrations r
    where r.class_id = p_class_id and r.employee_id = p_employee_id;
    return;
  end if;
  select count(*)::integer into v_count
  from public.training_session_registrations r
  where r.class_id = p_class_id and r.registration_status in ('registered', 'attended');
  if v_count < v_class.capacity then
    v_status := 'registered'; v_position := null;
  else
    v_status := 'waitlisted';
    select coalesce(max(r.waitlist_position), 0) + 1 into v_position
    from public.training_session_registrations r
    where r.class_id = p_class_id and r.registration_status = 'waitlisted';
  end if;
  insert into public.training_session_registrations(
    organization_id, facility_id, class_id, employee_id, registration_status,
    waitlist_position, registration_source, registered_by
  ) values (
    v_class.organization_id, coalesce(v_class.facility_id, v_employee.facility_id),
    v_class.id, v_employee.id, v_status, v_position,
    case when v_is_self then 'employee' else 'manager' end,
    app_private.current_actor_profile_id()
  ) returning id into v_id;
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_class.organization_id, v_employee.profile_id, 'training_registration_changed',
    'Training registration ' || v_status,
    v_class.class_name || ' registration status: ' || v_status,
    '/app/my-trainings'
  where v_employee.profile_id is not null;
  return query select v_id, v_status, v_position;
end;
$$;

create or replace function public.record_training_attendance(
  p_registration_id uuid,
  p_attendance_status text,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_evidence jsonb,
  p_attendee_signature_sha256 text,
  p_recorder_signature_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration public.training_session_registrations%rowtype;
  v_class public.training_classes%rowtype;
  v_id uuid;
  v_checksum text;
begin
  select * into v_registration from public.training_session_registrations
  where id = p_registration_id for update;
  select * into v_class from public.training_classes where id = v_registration.class_id;
  if v_registration.id is null then raise exception 'Registration not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(v_registration.organization_id, 'training.sessions.manage', v_registration.facility_id);
  if auth.uid() <> v_class.trainer_profile_id and public.current_role() not in ('org_admin','facility_manager','platform_admin') then
    raise exception 'Only the trainer or a training administrator may record attendance' using errcode = '42501';
  end if;
  if p_attendance_status not in ('attended', 'no_show', 'partial')
     or p_recorder_signature_sha256 !~ '^[0-9a-f]{64}$'
     or p_attendance_status = 'attended' and p_attendee_signature_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Signed attendance evidence is required' using errcode = '22023';
  end if;
  v_checksum := encode(extensions.digest(convert_to(jsonb_build_object(
    'registrationId', v_registration.id, 'status', p_attendance_status,
    'checkInAt', p_check_in_at, 'checkOutAt', p_check_out_at,
    'evidence', coalesce(p_evidence, '{}'::jsonb),
    'attendeeSignature', p_attendee_signature_sha256,
    'recorderSignature', p_recorder_signature_sha256
  )::text, 'utf8'), 'sha256'), 'hex');
  insert into public.training_attendance_evidence(
    organization_id, facility_id, registration_id, attendance_status,
    check_in_at, check_out_at, seat_minutes, evidence,
    attendee_signature_sha256, recorder_signature_sha256,
    evidence_checksum_sha256, recorded_by
  ) values (
    v_registration.organization_id, v_registration.facility_id, v_registration.id,
    p_attendance_status, p_check_in_at, p_check_out_at,
    case when p_check_in_at is not null and p_check_out_at is not null
      then greatest(0, extract(epoch from (p_check_out_at - p_check_in_at))::integer / 60) else null end,
    coalesce(p_evidence, '{}'::jsonb), p_attendee_signature_sha256,
    p_recorder_signature_sha256, v_checksum, auth.uid()
  ) returning id into v_id;
  update public.training_session_registrations set
    registration_status = case p_attendance_status when 'attended' then 'attended' when 'no_show' then 'no_show' else 'makeup_required' end,
    waitlist_position = null, attendance_recorded_at = now()
  where id = v_registration.id;
  return v_id;
end;
$$;

create or replace function public.approve_training_session_completion(
  p_class_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.training_classes%rowtype;
  v_registration public.training_session_registrations%rowtype;
  v_training_record_id uuid;
  v_receipt_id uuid;
  v_count integer := 0;
  v_attendee_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('training-complete:' || p_class_id::text, 0));
  select * into v_class from public.training_classes where id = p_class_id for update;
  if not found then raise exception 'Training class not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(v_class.organization_id, 'training.sessions.manage', v_class.facility_id);
  if not app_private.trainer_is_qualified(
    v_class.trainer_profile_id, v_class.training_type_id,
    coalesce(v_class.starts_at, v_class.class_date::timestamptz)
  ) then raise exception 'Unqualified trainer cannot approve completion' using errcode = '42501'; end if;
  select id into v_receipt_id from public.training_session_completion_receipts where class_id = p_class_id;
  if v_receipt_id is not null then return v_receipt_id; end if;
  if v_class.status not in ('scheduled', 'in_progress') or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Training class is not ready for completion' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.training_session_registrations r
    where r.class_id = p_class_id and r.registration_status = 'attended'
      and not exists (select 1 from public.training_attendance_evidence a where a.registration_id = r.id and a.attendance_status = 'attended')
  ) then raise exception 'Every attended registration requires signed evidence' using errcode = '23514'; end if;
  select count(*)::integer into v_attendee_count
  from public.training_session_registrations r where r.class_id = p_class_id and r.registration_status = 'attended';
  if v_attendee_count > v_class.capacity then
    raise exception 'Attended roster exceeds locked class capacity' using errcode = '23514';
  end if;
  for v_registration in
    select * from public.training_session_registrations
    where class_id = p_class_id and registration_status = 'attended'
    order by registered_at for update
  loop
    if v_registration.training_record_id is null then
      select r.id into v_training_record_id
      from public.employee_training_records r
      where r.employee_id = v_registration.employee_id
        and r.training_type_id = v_class.training_type_id
        and r.status in ('missing', 'due_soon', 'expired', 'pending_review')
      order by r.created_at, r.id limit 1 for update;
      if v_training_record_id is null then
        insert into public.employee_training_records(
          organization_id, facility_id, employee_id, training_type_id,
          completion_date, status, trainer_name, hours, completion_method,
          verified_by_profile_id, verified_at, approval_status, review_comments
        ) select
          v_class.organization_id, v_registration.facility_id,
          v_registration.employee_id, v_class.training_type_id,
          v_class.class_date, 'compliant', p.first_name || ' ' || p.last_name,
          v_class.duration_hours, 'in_person', auth.uid(), now(), 'approved', btrim(p_reason)
        from public.profiles p where p.id = v_class.trainer_profile_id
        returning id into v_training_record_id;
      else
        update public.employee_training_records r set
          facility_id = v_registration.facility_id,
          completion_date = v_class.class_date,
          due_date = case when t.renewal_interval_days is null then null
            else v_class.class_date + t.renewal_interval_days end,
          status = 'compliant',
          trainer_name = p.first_name || ' ' || p.last_name,
          hours = v_class.duration_hours,
          completion_method = 'in_person',
          verified_by_profile_id = auth.uid(), verified_at = now(),
          approval_status = 'approved', review_comments = btrim(p_reason)
        from public.training_types t, public.profiles p
        where r.id = v_training_record_id
          and t.id = v_class.training_type_id
          and p.id = v_class.trainer_profile_id;
      end if;
      update public.training_session_registrations
      set training_record_id = v_training_record_id where id = v_registration.id;
      if not exists (
        select 1 from public.training_class_attendees a
        where a.class_id = p_class_id and a.employee_id = v_registration.employee_id
      ) then
        insert into public.training_class_attendees(class_id, employee_id, attended, training_record_id)
        values (p_class_id, v_registration.employee_id, true, v_training_record_id);
      else
        update public.training_class_attendees set attended = true, training_record_id = v_training_record_id
        where class_id = p_class_id and employee_id = v_registration.employee_id;
      end if;
      v_count := v_count + 1;
    end if;
  end loop;
  update public.training_classes set
    status = 'completed', completion_approved_by = auth.uid(), completion_approved_at = now(),
    lock_version = lock_version + 1
  where id = p_class_id;
  insert into public.training_session_completion_receipts(
    organization_id, class_id, approved_by, attendee_count,
    training_record_count, evidence_checksum_sha256
  ) values (
    v_class.organization_id, v_class.id, auth.uid(), v_attendee_count, v_count,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'classId', v_class.id, 'attendeeCount', v_attendee_count,
      'recordCount', v_count, 'reason', btrim(p_reason)
    )::text, 'utf8'), 'sha256'), 'hex')
  ) returning id into v_receipt_id;
  return v_receipt_id;
end;
$$;

create or replace function public.evaluate_schedule_eligibility(
  p_employee_id uuid,
  p_facility_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_required_qualification_keys text[] default array[]::text[],
  p_required_credential_types text[] default array[]::text[],
  p_required_training_type_ids uuid[] default array[]::uuid[],
  p_exclude_assignment_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_policy public.schedule_eligibility_policies%rowtype;
  v_block text;
  v_training_type_id uuid;
  v_blocks text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_override_ids uuid[] := array[]::uuid[];
  v_unresolved text[] := array[]::text[];
  v_hours numeric := 0;
  v_duration numeric;
  v_snapshot jsonb;
  v_outcome text;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'Eligibility interval must have positive duration' using errcode = '22023';
  end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  if not (
    session_user = 'postgres'
    or
    coalesce(auth.jwt()->>'role', '') = 'service_role'
    or public.is_platform_admin()
    or v_employee.profile_id = auth.uid()
    or public.current_org_id() = v_employee.organization_id
  ) then raise exception 'Eligibility evaluation is outside caller scope' using errcode = '42501'; end if;
  select * into v_policy from public.schedule_eligibility_policies
  where organization_id = v_employee.organization_id;
  if not found then
    v_policy.max_weekly_hours := 40;
    v_policy.warning_weekly_hours := 36;
    v_policy.minimum_rest_hours := 8;
  end if;
  if v_employee.status <> 'active' then v_blocks := array_append(v_blocks, 'lifecycle_inactive'); end if;
  if not exists (
    select 1 from public.employee_facility_assignments a
    where a.employee_id = p_employee_id and a.facility_id = p_facility_id
  ) then v_blocks := array_append(v_blocks, 'facility_not_assigned'); end if;
  if exists (
    select 1 from public.exclusion_screening_matches m
    where m.employee_id = p_employee_id and m.status = 'confirmed_exclusion'
  ) then v_blocks := array_append(v_blocks, 'confirmed_exclusion'); end if;
  foreach v_block in array coalesce(p_required_qualification_keys, array[]::text[])
  loop
    if not public.employee_has_active_qualification(p_employee_id, v_block, p_starts_at) then
      v_blocks := array_append(v_blocks, 'qualification:' || v_block);
    end if;
  end loop;
  foreach v_block in array coalesce(p_required_credential_types, array[]::text[])
  loop
    if not exists (
      select 1 from public.employee_credentials c
      where c.employee_id = p_employee_id and c.credential_type = v_block
        and c.status = 'compliant'
        and (c.issue_date is null or c.issue_date <= p_starts_at::date)
        and (c.expiration_date is null or c.expiration_date >= p_ends_at::date)
    ) then v_blocks := array_append(v_blocks, 'credential:' || v_block); end if;
  end loop;
  foreach v_training_type_id in array coalesce(p_required_training_type_ids, array[]::uuid[])
  loop
    if not exists (
      select 1 from public.employee_training_records r
      where r.employee_id = p_employee_id and r.training_type_id = v_training_type_id
        and r.status = 'compliant' and r.approval_status = 'approved'
        and (r.completion_date is null or r.completion_date <= p_starts_at::date)
        and (r.due_date is null or r.due_date >= p_ends_at::date)
    ) then v_blocks := array_append(v_blocks, 'training:' || v_training_type_id::text); end if;
  end loop;
  if exists (
    select 1 from public.shift_assignments s
    where s.employee_id = p_employee_id
      and s.id <> all(coalesce(p_exclude_assignment_ids, array[]::uuid[]))
      and s.status in ('scheduled', 'confirmed')
      and tstzrange(
        s.shift_date + s.start_time,
        s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end,
        '[)'
      ) && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then v_blocks := array_append(v_blocks, 'schedule_conflict'); end if;
  select coalesce(sum(
    extract(epoch from (
      s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end
      - (s.shift_date + s.start_time)
    )) / 3600
  ), 0) into v_hours
  from public.shift_assignments s
  where s.employee_id = p_employee_id
    and s.id <> all(coalesce(p_exclude_assignment_ids, array[]::uuid[]))
    and s.status in ('scheduled', 'confirmed', 'completed')
    and s.shift_date between date_trunc('week', p_starts_at)::date
      and (date_trunc('week', p_starts_at) + interval '6 days')::date;
  v_duration := extract(epoch from (p_ends_at - p_starts_at)) / 3600;
  if v_hours + v_duration > v_policy.max_weekly_hours then
    v_blocks := array_append(v_blocks, 'weekly_hours_limit');
  elsif v_hours + v_duration > v_policy.warning_weekly_hours then
    v_warnings := array_append(v_warnings, 'weekly_hours_warning');
  end if;
  if exists (
    select 1 from public.employee_availability_windows a
    where a.employee_id = p_employee_id and a.availability_type = 'unavailable'
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then v_warnings := array_append(v_warnings, 'outside_availability'); end if;
  foreach v_block in array v_blocks
  loop
    if v_block in ('lifecycle_inactive', 'confirmed_exclusion') then
      v_unresolved := array_append(v_unresolved, v_block);
    else
      declare v_override_id uuid;
      begin
        select o.id into v_override_id
        from public.schedule_eligibility_overrides o
        where o.employee_id = p_employee_id and o.facility_id = p_facility_id
          and o.block_code = v_block and o.revoked_at is null
          and o.effective_from <= p_starts_at and o.expires_at >= p_ends_at
        order by o.created_at desc limit 1;
        if v_override_id is null then
          v_unresolved := array_append(v_unresolved, v_block);
        else
          v_override_ids := array_append(v_override_ids, v_override_id);
        end if;
      end;
    end if;
  end loop;
  v_outcome := case when cardinality(v_unresolved) > 0 then 'blocked'
    when cardinality(v_warnings) > 0 or cardinality(v_override_ids) > 0 then 'warning'
    else 'eligible' end;
  select jsonb_build_object(
    'policyUpdatedAt', v_policy.updated_at,
    'employeeStatus', v_employee.status,
    'facilityAssignmentIds', coalesce((select jsonb_agg(a.id order by a.id) from public.employee_facility_assignments a where a.employee_id = p_employee_id), '[]'::jsonb),
    'qualificationIds', coalesce((select jsonb_agg(q.id order by q.id) from public.employee_qualifications q where q.employee_id = p_employee_id and q.effective_from <= p_starts_at and (q.effective_to is null or q.effective_to > p_starts_at)), '[]'::jsonb),
    'credentialIds', coalesce((select jsonb_agg(c.id order by c.id) from public.employee_credentials c where c.employee_id = p_employee_id), '[]'::jsonb),
    'weeklyHoursBefore', v_hours,
    'requestedHours', v_duration
  ) into v_snapshot;
  return jsonb_build_object(
    'outcome', v_outcome,
    'hardBlocks', to_jsonb(v_unresolved),
    'warnings', to_jsonb(v_warnings),
    'appliedOverrideIds', to_jsonb(v_override_ids),
    'sourceSnapshot', v_snapshot,
    'sourceChecksumSha256', encode(extensions.digest(convert_to(v_snapshot::text, 'utf8'), 'sha256'), 'hex')
  );
end;
$$;

create or replace function app_private.persist_schedule_eligibility_decision(
  p_employee_id uuid,
  p_facility_id uuid,
  p_context text,
  p_target_type text,
  p_target_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_result jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_employee public.employees%rowtype; v_id uuid;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  insert into public.schedule_eligibility_decisions(
    organization_id, facility_id, employee_id, decision_context, target_type,
    target_id, evaluated_for_start, evaluated_for_end, outcome, hard_blocks,
    warnings, applied_override_ids, source_snapshot, source_checksum_sha256,
    evaluated_by
  ) values (
    v_employee.organization_id, p_facility_id, p_employee_id, p_context, p_target_type,
    p_target_id, p_starts_at, p_ends_at, p_result->>'outcome',
    array(select jsonb_array_elements_text(p_result->'hardBlocks')),
    array(select jsonb_array_elements_text(p_result->'warnings')),
    array(select jsonb_array_elements_text(p_result->'appliedOverrideIds'))::uuid[],
    p_result->'sourceSnapshot', p_result->>'sourceChecksumSha256',
    app_private.current_actor_profile_id()
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app_private.persist_schedule_eligibility_decision(uuid,uuid,text,text,uuid,timestamptz,timestamptz,jsonb)
from public, anon, authenticated, service_role;

create or replace function public.create_schedule_eligibility_override(
  p_employee_id uuid,
  p_facility_id uuid,
  p_block_code text,
  p_scope_type text,
  p_scope_id uuid,
  p_reason text,
  p_authority_reference text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_employee public.employees%rowtype; v_id uuid;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found or v_employee.facility_id <> p_facility_id and not public.is_employee_assigned_to_facility(p_employee_id, p_facility_id) then
    raise exception 'Employee is outside override facility' using errcode = '23514';
  end if;
  perform app_private.assert_phase3_admin(v_employee.organization_id, 'scheduling.eligibility.override', p_facility_id);
  if p_block_code in ('lifecycle_inactive', 'confirmed_exclusion')
     or p_scope_type not in ('facility','shift','class')
     or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'Override is not permitted or is too broad' using errcode = '22023';
  end if;
  insert into public.schedule_eligibility_overrides(
    organization_id, facility_id, employee_id, block_code, scope_type,
    scope_id, reason, authority_reference, expires_at, granted_by
  ) values (
    v_employee.organization_id, p_facility_id, p_employee_id, p_block_code,
    p_scope_type, p_scope_id, btrim(p_reason), btrim(p_authority_reference),
    p_expires_at, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_open_shift(
  p_opportunity_id uuid
)
returns table(claim_id uuid, claim_status text, shift_assignment_id uuid, eligibility_decision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.open_shift_opportunities%rowtype;
  v_employee public.employees%rowtype;
  v_policy public.schedule_eligibility_policies%rowtype;
  v_result jsonb;
  v_decision_id uuid;
  v_claim_id uuid;
  v_assignment_id uuid;
  v_claim_status text;
  v_filled integer;
  v_position integer;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('open-shift:' || p_opportunity_id::text, 0));
  select * into v_open from public.open_shift_opportunities where id = p_opportunity_id for update;
  select * into v_employee from public.employees where profile_id = auth.uid() and status = 'active';
  if v_open.id is null or v_employee.id is null then raise exception 'Open shift or active employee not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.open_shift_claims c where c.opportunity_id = v_open.id and c.employee_id = v_employee.id) then
    return query select c.id, c.claim_status, c.shift_assignment_id, c.eligibility_decision_id
    from public.open_shift_claims c where c.opportunity_id = v_open.id and c.employee_id = v_employee.id;
    return;
  end if;
  if v_open.status <> 'open' or v_open.claim_deadline < now()
     or v_open.organization_id <> v_employee.organization_id then
    raise exception 'Open shift is unavailable' using errcode = '55000';
  end if;
  v_starts := v_open.shift_date + v_open.start_time;
  v_ends := v_open.shift_date + v_open.end_time
    + case when v_open.end_time <= v_open.start_time then interval '1 day' else interval '0' end;
  v_result := public.evaluate_schedule_eligibility(
    v_employee.id, v_open.facility_id, v_starts, v_ends,
    v_open.required_qualification_keys, v_open.required_credential_types,
    v_open.required_training_type_ids, array[]::uuid[]
  );
  v_decision_id := app_private.persist_schedule_eligibility_decision(
    v_employee.id, v_open.facility_id, 'open_shift_claim', 'open_shift', v_open.id,
    v_starts, v_ends, v_result
  );
  if v_result->>'outcome' = 'blocked' then
    raise exception 'Open shift claim blocked: %', v_result->'hardBlocks' using errcode = '23514';
  end if;
  select * into v_policy from public.schedule_eligibility_policies where organization_id = v_open.organization_id;
  select count(*)::integer into v_filled from public.open_shift_claims c
  where c.opportunity_id = v_open.id and c.claim_status in ('approved','pending_approval');
  if v_filled < v_open.slots then
    v_claim_status := case when v_policy.manager_approval_required then 'pending_approval' else 'approved' end;
    if v_claim_status = 'approved' then
      insert into public.shift_assignments(
        organization_id, schedule_id, facility_id, employee_id, unit_id,
        shift_definition_id, shift_date, start_time, end_time, status, source
      ) values (
        v_open.organization_id, v_open.schedule_id, v_open.facility_id,
        v_employee.id, v_open.unit_id, v_open.shift_definition_id,
        v_open.shift_date, v_open.start_time, v_open.end_time, 'confirmed', 'self_service'
      ) returning id into v_assignment_id;
    end if;
    v_position := null;
  elsif v_policy.waitlist_enabled then
    v_claim_status := 'waitlisted';
    select coalesce(max(c.waitlist_position),0) + 1 into v_position
    from public.open_shift_claims c where c.opportunity_id = v_open.id and c.claim_status = 'waitlisted';
  else
    raise exception 'Open shift capacity is filled' using errcode = '23514';
  end if;
  insert into public.open_shift_claims(
    organization_id, opportunity_id, employee_id, claim_status,
    waitlist_position, eligibility_decision_id, shift_assignment_id
  ) values (
    v_open.organization_id, v_open.id, v_employee.id, v_claim_status,
    v_position, v_decision_id, v_assignment_id
  ) returning id into v_claim_id;
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  ) values (
    v_open.organization_id, v_employee.profile_id, 'open_shift_claim_changed',
    'Open shift claim ' || v_claim_status,
    'Your open shift request is ' || replace(v_claim_status, '_', ' ') || '.',
    '/app/my-schedule'
  );
  if v_assignment_id is not null and v_filled + 1 >= v_open.slots then
    update public.open_shift_opportunities set status = 'filled' where id = v_open.id;
  end if;
  return query select v_claim_id, v_claim_status, v_assignment_id, v_decision_id;
end;
$$;

create or replace function public.request_shift_swap(
  p_requester_assignment_id uuid,
  p_target_assignment_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester public.shift_assignments%rowtype;
  v_target public.shift_assignments%rowtype;
  v_employee public.employees%rowtype;
  v_policy public.schedule_eligibility_policies%rowtype;
  v_id uuid;
begin
  select * into v_requester from public.shift_assignments where id = p_requester_assignment_id;
  select * into v_target from public.shift_assignments where id = p_target_assignment_id;
  select * into v_employee from public.employees where id = v_requester.employee_id;
  if v_requester.id is null or v_target.id is null or v_employee.profile_id <> auth.uid()
     or v_requester.organization_id <> v_target.organization_id
     or v_requester.facility_id <> v_target.facility_id
     or v_requester.shift_date < current_date or v_target.shift_date < current_date then
    raise exception 'Shift swap is outside employee scope' using errcode = '42501';
  end if;
  select * into v_policy from public.schedule_eligibility_policies where organization_id = v_requester.organization_id;
  if least(
    v_requester.shift_date + v_requester.start_time,
    v_target.shift_date + v_target.start_time
  ) <= now() + make_interval(hours => v_policy.swap_deadline_hours) then
    raise exception 'Shift swap deadline has passed' using errcode = '55000';
  end if;
  insert into public.shift_swap_requests(
    organization_id, facility_id, requester_employee_id, requester_assignment_id,
    target_employee_id, target_assignment_id, reason, expires_at
  ) values (
    v_requester.organization_id, v_requester.facility_id, v_requester.employee_id,
    v_requester.id, v_target.employee_id, v_target.id, btrim(p_reason),
    least(v_requester.shift_date + v_requester.start_time, v_target.shift_date + v_target.start_time)
      - make_interval(hours => v_policy.swap_deadline_hours)
  ) returning id into v_id;
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_requester.organization_id, e.profile_id, 'shift_swap_changed',
    'Shift swap requested', 'A coworker requested a governed shift swap.',
    '/app/my-schedule'
  from public.employees e where e.id = v_target.employee_id and e.profile_id is not null;
  return v_id;
end;
$$;

create or replace function public.decide_shift_swap(
  p_swap_request_id uuid,
  p_approve boolean,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_swap public.shift_swap_requests%rowtype;
  v_a public.shift_assignments%rowtype;
  v_b public.shift_assignments%rowtype;
  v_a_start timestamptz; v_a_end timestamptz; v_b_start timestamptz; v_b_end timestamptz;
  v_a_result jsonb; v_b_result jsonb;
  v_a_decision uuid; v_b_decision uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('shift-swap:' || p_swap_request_id::text, 0));
  select * into v_swap from public.shift_swap_requests where id = p_swap_request_id for update;
  if not found or v_swap.status <> 'pending' or v_swap.expires_at <= now() then
    raise exception 'Shift swap is not pending' using errcode = '55000';
  end if;
  perform app_private.assert_phase3_admin(v_swap.organization_id, 'scheduling.self_service.manage', v_swap.facility_id);
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Decision reason is required' using errcode = '22023'; end if;
  if not p_approve then
    update public.shift_swap_requests set status = 'rejected', decided_by = auth.uid(),
      decided_at = now(), decision_reason = btrim(p_reason) where id = v_swap.id;
    return true;
  end if;
  select * into v_a from public.shift_assignments where id = v_swap.requester_assignment_id for update;
  select * into v_b from public.shift_assignments where id = v_swap.target_assignment_id for update;
  if v_a.employee_id <> v_swap.requester_employee_id or v_b.employee_id <> v_swap.target_employee_id
     or v_a.status not in ('scheduled','confirmed') or v_b.status not in ('scheduled','confirmed') then
    raise exception 'Shift assignments changed after swap request' using errcode = '40001';
  end if;
  v_a_start := v_a.shift_date + v_a.start_time;
  v_a_end := v_a.shift_date + v_a.end_time + case when v_a.end_time <= v_a.start_time then interval '1 day' else interval '0' end;
  v_b_start := v_b.shift_date + v_b.start_time;
  v_b_end := v_b.shift_date + v_b.end_time + case when v_b.end_time <= v_b.start_time then interval '1 day' else interval '0' end;
  v_a_result := public.evaluate_schedule_eligibility(
    v_a.employee_id, v_b.facility_id, v_b_start, v_b_end,
    array[]::text[], array[]::text[], array[]::uuid[], array[v_a.id,v_b.id]
  );
  v_b_result := public.evaluate_schedule_eligibility(
    v_b.employee_id, v_a.facility_id, v_a_start, v_a_end,
    array[]::text[], array[]::text[], array[]::uuid[], array[v_a.id,v_b.id]
  );
  v_a_decision := app_private.persist_schedule_eligibility_decision(
    v_a.employee_id, v_b.facility_id, 'shift_swap', 'swap', v_swap.id, v_b_start, v_b_end, v_a_result
  );
  v_b_decision := app_private.persist_schedule_eligibility_decision(
    v_b.employee_id, v_a.facility_id, 'shift_swap', 'swap', v_swap.id, v_a_start, v_a_end, v_b_result
  );
  if v_a_result->>'outcome' = 'blocked' or v_b_result->>'outcome' = 'blocked' then
    raise exception 'Swap eligibility is blocked' using errcode = '23514';
  end if;
  update public.shift_swap_requests set
    requester_decision_id = v_a_decision, target_decision_id = v_b_decision,
    decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason)
  where id = v_swap.id;
  set constraints shift_assignments_employee_id_shift_date_key deferred;
  update public.shift_assignments set
    employee_id = case id when v_a.id then v_b.employee_id else v_a.employee_id end,
    source = 'swap', notes = concat_ws(E'\n', nullif(notes,''), '[approved swap ' || v_swap.id || '] ' || btrim(p_reason))
  where id in (v_a.id, v_b.id);
  update public.shift_swap_requests set
    status = 'approved'
  where id = v_swap.id;
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_swap.organization_id, e.profile_id, 'shift_swap_changed',
    'Shift swap approved', 'The approved swap is reflected in your schedule.',
    '/app/my-schedule'
  from public.employees e
  where e.id in (v_swap.requester_employee_id, v_swap.target_employee_id)
    and e.profile_id is not null;
  return true;
end;
$$;

create or replace function app_private.enforce_shift_assignment_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requirement public.shift_eligibility_requirements%rowtype;
  v_result jsonb;
  v_starts timestamptz;
  v_ends timestamptz;
  v_decision_id uuid;
begin
  if tg_op = 'UPDATE' and new.employee_id = old.employee_id
     and new.facility_id = old.facility_id and new.shift_date = old.shift_date
     and new.start_time = old.start_time and new.end_time = old.end_time then
    return new;
  end if;
  if new.source = 'swap' and exists (
    select 1 from public.shift_swap_requests r
    where r.status = 'pending' and r.decided_by = auth.uid()
      and r.requester_decision_id is not null and r.target_decision_id is not null
      and (r.requester_assignment_id = new.id or r.target_assignment_id = new.id)
  ) then return new; end if;
  select * into v_requirement from public.shift_eligibility_requirements r
  where r.facility_id = new.facility_id and r.shift_definition_id = new.shift_definition_id
    and r.is_active;
  v_starts := new.shift_date + new.start_time;
  v_ends := new.shift_date + new.end_time
    + case when new.end_time <= new.start_time then interval '1 day' else interval '0' end;
  v_result := public.evaluate_schedule_eligibility(
    new.employee_id, new.facility_id, v_starts, v_ends,
    coalesce(v_requirement.required_qualification_keys, array[]::text[]),
    coalesce(v_requirement.required_credential_types, array[]::text[]),
    coalesce(v_requirement.required_training_type_ids, array[]::uuid[]),
    case when tg_op = 'UPDATE' then array[new.id] else array[]::uuid[] end
  );
  if v_result->>'outcome' = 'blocked' then
    raise exception 'Shift assignment blocked by eligibility: %', v_result->'hardBlocks'
      using errcode = '23514';
  end if;
  v_decision_id := app_private.persist_schedule_eligibility_decision(
    new.employee_id, new.facility_id, 'manager_assignment', 'shift', new.id,
    v_starts, v_ends, v_result
  );
  return new;
end;
$$;
revoke all on function app_private.enforce_shift_assignment_eligibility()
from public, anon, authenticated, service_role;
create trigger enforce_shift_assignment_eligibility
before insert or update of employee_id, facility_id, shift_date, start_time, end_time
on public.shift_assignments
for each row execute function app_private.enforce_shift_assignment_eligibility();

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (notification_type in (
  'course_assigned', 'quiz_graded', 'certificate_issued',
  'training_due_soon', 'training_expired', 'competency_recorded',
  'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
  'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
  'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
  'support_ticket_update', 'workforce_lifecycle_changed', 'training_registration_changed',
  'open_shift_claim_changed', 'shift_swap_changed', 'credential_renewal_changed',
  'qualification_changed'
));

create trigger prevent_training_attendance_mutation
before update or delete on public.training_attendance_evidence
for each row execute function app_private.prevent_phase3_evidence_mutation();
create trigger prevent_training_completion_receipt_mutation
before update or delete on public.training_session_completion_receipts
for each row execute function app_private.prevent_phase3_evidence_mutation();
create trigger prevent_schedule_decision_mutation
before update or delete on public.schedule_eligibility_decisions
for each row execute function app_private.prevent_phase3_evidence_mutation();

alter table public.training_session_registrations enable row level security;
alter table public.training_attendance_evidence enable row level security;
alter table public.training_session_completion_receipts enable row level security;
alter table public.schedule_eligibility_policies enable row level security;
alter table public.schedule_eligibility_overrides enable row level security;
alter table public.shift_eligibility_requirements enable row level security;
alter table public.schedule_eligibility_decisions enable row level security;
alter table public.employee_availability_windows enable row level security;
alter table public.open_shift_opportunities enable row level security;
alter table public.open_shift_claims enable row level security;
alter table public.shift_swap_requests enable row level security;

create policy training_registrations_select on public.training_session_registrations
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
);
create policy training_attendance_select on public.training_attendance_evidence
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or exists (
    select 1 from public.training_session_registrations r
    join public.employees e on e.id = r.employee_id
    where r.id = registration_id and e.profile_id = (select auth.uid())
  )
);
create policy training_completion_receipts_select on public.training_session_completion_receipts
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy schedule_eligibility_policies_select on public.schedule_eligibility_policies
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy schedule_eligibility_policies_manage on public.schedule_eligibility_policies
for update to authenticated using (
  (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) = 'org_admin'
  ))
) with check (
  (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) = 'org_admin'
  ))
);
create policy schedule_overrides_select on public.schedule_eligibility_overrides
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
);
create policy shift_requirements_select on public.shift_eligibility_requirements
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy shift_requirements_manage on public.shift_eligibility_requirements
for all to authenticated using (
  (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
  ))
) with check (
  (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
  ))
);
create policy schedule_decisions_select on public.schedule_eligibility_decisions
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
);
create policy employee_availability_select on public.employee_availability_windows
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
);
create policy employee_availability_manage on public.employee_availability_windows
for all to authenticated using (
  employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
  or ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
  ))
) with check (
  employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
  or ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
  ))
);
create policy open_shift_opportunities_select on public.open_shift_opportunities
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy open_shift_opportunities_manage on public.open_shift_opportunities
for all to authenticated using (
  (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
  ))
) with check (
  (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
  ))
);
create policy open_shift_claims_select on public.open_shift_claims
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
);
create policy shift_swap_requests_select on public.shift_swap_requests
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or requester_employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
  or target_employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
);

revoke all on table
  public.training_session_registrations, public.training_attendance_evidence,
  public.training_session_completion_receipts, public.schedule_eligibility_policies,
  public.schedule_eligibility_overrides, public.shift_eligibility_requirements,
  public.schedule_eligibility_decisions, public.employee_availability_windows,
  public.open_shift_opportunities, public.open_shift_claims,
  public.shift_swap_requests
from public, anon, authenticated, service_role;

grant select on table public.training_session_registrations,
  public.training_attendance_evidence, public.training_session_completion_receipts,
  public.schedule_eligibility_overrides, public.schedule_eligibility_decisions,
  public.open_shift_claims, public.shift_swap_requests to authenticated;
grant select, update on table public.schedule_eligibility_policies to authenticated;
grant select, insert, update, delete on table public.shift_eligibility_requirements,
  public.employee_availability_windows, public.open_shift_opportunities to authenticated;

grant select, insert, update on table public.training_session_registrations,
  public.training_attendance_evidence, public.training_session_completion_receipts,
  public.schedule_eligibility_overrides, public.schedule_eligibility_decisions,
  public.open_shift_claims, public.shift_swap_requests to service_role;
grant select on table public.schedule_eligibility_policies,
  public.shift_eligibility_requirements, public.employee_availability_windows,
  public.open_shift_opportunities to service_role;

revoke all on function public.register_for_training_session(uuid,uuid),
  public.record_training_attendance(uuid,text,timestamptz,timestamptz,jsonb,text,text),
  public.approve_training_session_completion(uuid,text),
  public.evaluate_schedule_eligibility(uuid,uuid,timestamptz,timestamptz,text[],text[],uuid[],uuid[]),
  public.create_schedule_eligibility_override(uuid,uuid,text,text,uuid,text,text,timestamptz),
  public.claim_open_shift(uuid), public.request_shift_swap(uuid,uuid,text),
  public.decide_shift_swap(uuid,boolean,text)
from public, anon, authenticated, service_role;

grant execute on function public.register_for_training_session(uuid,uuid),
  public.record_training_attendance(uuid,text,timestamptz,timestamptz,jsonb,text,text),
  public.approve_training_session_completion(uuid,text),
  public.evaluate_schedule_eligibility(uuid,uuid,timestamptz,timestamptz,text[],text[],uuid[],uuid[]),
  public.create_schedule_eligibility_override(uuid,uuid,text,text,uuid,text,text,timestamptz),
  public.claim_open_shift(uuid), public.request_shift_swap(uuid,uuid,text),
  public.decide_shift_swap(uuid,boolean,text)
to authenticated;
grant execute on function public.evaluate_schedule_eligibility(uuid,uuid,timestamptz,timestamptz,text[],text[],uuid[],uuid[])
to service_role;

insert into app_private.audit_entity_manifest(
  table_name, audit_mode, contains_regulated_data, rationale
)
select table_name, audit_mode, true, rationale
from (values
  ('training_session_registrations', 'row_trigger', 'Capacity and waitlist operations'),
  ('training_attendance_evidence', 'domain_evidence', 'Signed append-only attendance evidence'),
  ('training_session_completion_receipts', 'domain_evidence', 'Idempotent class completion evidence'),
  ('schedule_eligibility_policies', 'row_trigger', 'Tenant scheduling policy'),
  ('schedule_eligibility_overrides', 'row_trigger', 'Bounded qualification override evidence'),
  ('shift_eligibility_requirements', 'row_trigger', 'Shift qualification contract'),
  ('schedule_eligibility_decisions', 'domain_evidence', 'Append-only explainable eligibility decision'),
  ('employee_availability_windows', 'row_trigger', 'Employee scheduling availability'),
  ('open_shift_opportunities', 'row_trigger', 'Open shift capacity contract'),
  ('open_shift_claims', 'row_trigger', 'Employee claim and waitlist workflow'),
  ('shift_swap_requests', 'row_trigger', 'Governed shift swap workflow')
) v(table_name, audit_mode, rationale)
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'training_session_registrations', 'schedule_eligibility_policies',
    'schedule_eligibility_overrides', 'shift_eligibility_requirements',
    'employee_availability_windows', 'open_shift_opportunities',
    'open_shift_claims', 'shift_swap_requests'
  ] loop
    execute format(
      'create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()',
      v_table
    );
  end loop;
end;
$$;

comment on function public.evaluate_schedule_eligibility(uuid,uuid,timestamptz,timestamptz,text[],text[],uuid[],uuid[]) is
  'Single explainable eligibility engine for manager assignment, class registration, open-shift claims, and swaps.';

-- Narrow read model for operators. It runs with the caller's RLS scope and never
-- returns source HRIS payloads or credential extraction evidence.
create or replace function public.get_qualified_workforce_control_plane()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'hris', jsonb_build_object(
      'activeSources', (select count(*) from public.hris_source_systems where status in ('pilot', 'active')),
      'runningImports', (select count(*) from public.hris_import_runs where status in ('staging', 'validated', 'blocked', 'applying')),
      'failedImports', (select count(*) from public.hris_import_runs where status = 'failed'),
      'openExceptions', (select count(*) from public.hris_import_exceptions where resolved_at is null)
    ),
    'qualifications', jsonb_build_object(
      'active', (select count(*) from public.employee_qualifications where state = 'active' and (effective_to is null or effective_to > now())),
      'suspended', (select count(*) from public.employee_qualifications where state = 'suspended'),
      'revoked', (select count(*) from public.employee_qualifications where state = 'revoked'),
      'attemptsAwaitingReview', (select count(*) from public.certification_attempts where status = 'submitted')
    ),
    'credentialRenewals', jsonb_build_object(
      'awaitingExtraction', (select count(*) from public.credential_renewal_submissions where status in ('uploaded', 'scanning')),
      'awaitingHumanReview', (select count(*) from public.credential_renewal_submissions where status = 'needs_review'),
      'rejected', (select count(*) from public.credential_renewal_submissions where status = 'rejected')
    ),
    'instructorLedTraining', jsonb_build_object(
      'scheduledClasses', (select count(*) from public.training_classes where status in ('scheduled', 'in_progress')),
      'waitlistedLearners', (select count(*) from public.training_session_registrations where registration_status = 'waitlisted'),
      'attendanceAwaitingApproval', (select count(*) from public.training_session_registrations where registration_status = 'attended' and training_record_id is null),
      'completionReceipts', (select count(*) from public.training_session_completion_receipts)
    ),
    'scheduling', jsonb_build_object(
      'blockedDecisions', (select count(*) from public.schedule_eligibility_decisions where outcome = 'blocked' and evaluated_at >= now() - interval '30 days'),
      'activeOverrides', (select count(*) from public.schedule_eligibility_overrides where revoked_at is null and expires_at > now()),
      'openShiftClaims', (select count(*) from public.open_shift_claims where claim_status in ('pending_approval', 'waitlisted')),
      'pendingSwaps', (select count(*) from public.shift_swap_requests where status = 'pending')
    ),
    'recentEligibilityDecisions', coalesce((
      select jsonb_agg(to_jsonb(recent) order by recent.evaluated_at desc)
      from (
        select id, facility_id, employee_id, decision_context, outcome,
          hard_blocks, warnings, evaluated_for_start, evaluated_for_end, evaluated_at
        from public.schedule_eligibility_decisions
        order by evaluated_at desc
        limit 10
      ) recent
    ), '[]'::jsonb),
    'generatedAt', now()
  );
$$;
revoke all on function public.get_qualified_workforce_control_plane() from public, anon;
grant execute on function public.get_qualified_workforce_control_plane() to authenticated, service_role;

-- P2 security remediation: controlled compliance evidence, immutable completed
-- classes, atomic public quotas, scoped consent, private course videos, and
-- transactional identity revocation. This migration intentionally follows the
-- earlier P1 tenant-isolation migration so its active-profile helpers are used.

-- ---------------------------------------------------------------------------
-- Tenant-consistent work items
-- ---------------------------------------------------------------------------

create or replace function app_private.enforce_work_item_facility_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.facilities f
    where f.id = new.facility_id
      and f.organization_id = new.organization_id
  ) then
    raise exception 'work item facility does not belong to its organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_work_item_facility_scope()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_work_item_facility_scope on public.work_items;
create trigger enforce_work_item_facility_scope
before insert or update of organization_id, facility_id on public.work_items
for each row execute function app_private.enforce_work_item_facility_scope();

-- ---------------------------------------------------------------------------
-- Authoritative compliance evidence is written only through checked RPCs
-- ---------------------------------------------------------------------------

create or replace function public.save_training_record(
  p_record_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.employee_training_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.employee_training_records%rowtype;
  v_candidate public.employee_training_records%rowtype;
  v_result public.employee_training_records%rowtype;
  v_employee public.employees%rowtype;
  v_role text := public.current_role();
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'training record payload must be an object' using errcode = '22023';
  end if;

  if p_record_id is not null then
    select * into v_existing
    from public.employee_training_records
    where id = p_record_id
    for update;
    if not found then
      raise exception 'training record not found' using errcode = 'P0002';
    end if;
    v_candidate := jsonb_populate_record(v_existing, p_payload);
    v_candidate.id := v_existing.id;
    v_candidate.created_at := v_existing.created_at;
    if v_candidate.employee_id is distinct from v_existing.employee_id
       or v_candidate.training_type_id is distinct from v_existing.training_type_id then
      raise exception 'training record identity fields cannot be changed' using errcode = '22023';
    end if;
  else
    v_candidate := jsonb_populate_record(null::public.employee_training_records, p_payload);
    v_candidate.id := extensions.gen_random_uuid();
    v_candidate.status := coalesce(v_candidate.status, 'missing');
    v_candidate.document_required := coalesce(v_candidate.document_required, false);
    v_candidate.created_at := now();
  end if;

  select * into v_employee
  from public.employees
  where id = v_candidate.employee_id;
  if not found or v_employee.status = 'terminated' then
    raise exception 'active employee not found' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.training_types t
    where t.id = v_candidate.training_type_id
      and (t.organization_id is null or t.organization_id = v_employee.organization_id)
  ) then
    raise exception 'training type is outside the employee organization' using errcode = '23514';
  end if;
  if v_candidate.external_certificate_document_id is not null and not exists (
    select 1 from public.training_documents d
    where d.id = v_candidate.external_certificate_document_id
      and d.organization_id = v_employee.organization_id
      and d.employee_id = v_employee.id
  ) then
    raise exception 'training evidence document is outside the employee scope' using errcode = '23514';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_employee.organization_id = public.current_org_id()
      and v_role in ('org_admin', 'facility_manager', 'trainer')
      and public.is_assigned_to_facility(v_employee.facility_id)
    )
  ) then
    raise exception 'not authorized to write training evidence' using errcode = '42501';
  end if;

  v_candidate.organization_id := v_employee.organization_id;
  v_candidate.facility_id := v_employee.facility_id;
  v_candidate.updated_at := now();
  -- Caller-supplied verifier identity/timestamps are never authoritative. Every
  -- controlled write records the authenticated reviewer responsible for it.
  v_candidate.verified_by_profile_id := auth.uid();
  v_candidate.verified_at := now();

  if p_record_id is null then
    insert into public.employee_training_records
    select (v_candidate).*
    returning * into v_result;
  else
    update public.employee_training_records r set
      employee_id = v_candidate.employee_id,
      training_type_id = v_candidate.training_type_id,
      completion_date = v_candidate.completion_date,
      due_date = v_candidate.due_date,
      status = v_candidate.status,
      trainer_name = v_candidate.trainer_name,
      trainer_credentials = v_candidate.trainer_credentials,
      training_provider = v_candidate.training_provider,
      certificate_number = v_candidate.certificate_number,
      score = v_candidate.score,
      hours = v_candidate.hours,
      notes = v_candidate.notes,
      document_required = v_candidate.document_required,
      completion_method = v_candidate.completion_method,
      verified_by_profile_id = v_candidate.verified_by_profile_id,
      verified_at = v_candidate.verified_at,
      approval_status = v_candidate.approval_status,
      review_comments = v_candidate.review_comments,
      external_certificate_document_id = v_candidate.external_certificate_document_id,
      updated_at = v_candidate.updated_at
    where r.id = p_record_id
    returning * into v_result;
  end if;
  return v_result;
end;
$$;

revoke all on function public.save_training_record(uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_training_record(uuid, jsonb) to authenticated;

create or replace function public.save_practicum(
  p_practicum_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.practicums
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.practicums%rowtype;
  v_candidate public.practicums%rowtype;
  v_result public.practicums%rowtype;
  v_employee public.employees%rowtype;
  v_role text := public.current_role();
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'practicum payload must be an object' using errcode = '22023';
  end if;

  if p_practicum_id is not null then
    select * into v_existing
    from public.practicums
    where id = p_practicum_id
    for update;
    if not found then
      raise exception 'practicum not found' using errcode = 'P0002';
    end if;
    v_candidate := jsonb_populate_record(v_existing, p_payload);
    v_candidate.id := v_existing.id;
    v_candidate.created_at := v_existing.created_at;
  else
    v_candidate := jsonb_populate_record(null::public.practicums, p_payload);
    v_candidate.id := extensions.gen_random_uuid();
    v_candidate.mar_review_completed := false;
    v_candidate.direct_observation_completed := false;
    v_candidate.remediation_required := coalesce(v_candidate.remediation_required, false);
    v_candidate.reminder_days := coalesce(v_candidate.reminder_days, 30);
    v_candidate.status := coalesce(v_candidate.status, 'missing');
    v_candidate.created_at := now();
  end if;

  select * into v_employee
  from public.employees
  where id = v_candidate.employee_id;
  if not found or v_employee.status = 'terminated' then
    raise exception 'active employee not found' using errcode = '23503';
  end if;
  if not (
    public.is_platform_admin()
    or (
      v_employee.organization_id = public.current_org_id()
      and v_role in ('org_admin', 'facility_manager', 'trainer')
      and public.is_assigned_to_facility(v_employee.facility_id)
    )
  ) then
    raise exception 'not authorized to verify practicum evidence' using errcode = '42501';
  end if;

  if v_candidate.certificate_document_id is not null and not exists (
    select 1 from public.training_documents d
    where d.id = v_candidate.certificate_document_id
      and d.organization_id = v_employee.organization_id
      and d.employee_id = v_employee.id
  ) then
    raise exception 'practicum certificate is outside the employee scope' using errcode = '23514';
  end if;
  if v_candidate.observation_document_id is not null and not exists (
    select 1 from public.training_documents d
    where d.id = v_candidate.observation_document_id
      and d.organization_id = v_employee.organization_id
      and d.employee_id = v_employee.id
  ) then
    raise exception 'practicum observation is outside the employee scope' using errcode = '23514';
  end if;

  v_candidate.organization_id := v_employee.organization_id;
  v_candidate.facility_id := v_employee.facility_id;
  v_candidate.verified_by_profile_id := auth.uid();
  v_candidate.verified_at := now();
  v_candidate.updated_at := now();

  if p_practicum_id is null then
    insert into public.practicums
    select (v_candidate).*
    returning * into v_result;
  else
    update public.practicums p set
      employee_id = v_candidate.employee_id,
      practicum_year = v_candidate.practicum_year,
      completion_date = v_candidate.completion_date,
      observed_by = v_candidate.observed_by,
      remediation_required = v_candidate.remediation_required,
      remediation_notes = v_candidate.remediation_notes,
      notes = v_candidate.notes,
      due_date = v_candidate.due_date,
      status = v_candidate.status,
      verified_by_profile_id = v_candidate.verified_by_profile_id,
      verified_at = v_candidate.verified_at,
      reminder_days = v_candidate.reminder_days,
      certificate_document_id = v_candidate.certificate_document_id,
      observation_document_id = v_candidate.observation_document_id,
      window1_observation_date = v_candidate.window1_observation_date,
      window1_observation_by = v_candidate.window1_observation_by,
      window1_mar_review_date = v_candidate.window1_mar_review_date,
      window1_mar_review_by = v_candidate.window1_mar_review_by,
      window2_observation_date = v_candidate.window2_observation_date,
      window2_observation_by = v_candidate.window2_observation_by,
      window2_mar_review_date = v_candidate.window2_mar_review_date,
      window2_mar_review_by = v_candidate.window2_mar_review_by,
      window1_evidence_document_id = v_candidate.window1_evidence_document_id,
      window2_evidence_document_id = v_candidate.window2_evidence_document_id,
      updated_at = v_candidate.updated_at
    where p.id = p_practicum_id
    returning * into v_result;
  end if;
  return v_result;
end;
$$;

revoke all on function public.save_practicum(uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_practicum(uuid, jsonb) to authenticated;

revoke insert, update, delete on public.employee_training_records from authenticated;
revoke insert, update, delete on public.practicums from authenticated;
revoke insert, update, delete on public.employee_training_hour_buckets from authenticated;

-- Keep command grants aligned with the repository's RLS/grant consistency invariant,
-- but make every direct mutation policy deny. SECURITY DEFINER RPCs above remain the
-- sole mutation path and execute their explicit tenant/actor checks first.
grant insert, update, delete on public.employee_training_records to authenticated;
grant insert, update, delete on public.practicums to authenticated;
grant insert, update, delete on public.employee_training_hour_buckets to authenticated;
alter policy employee_training_records_insert on public.employee_training_records
  with check (false);
alter policy employee_training_records_update on public.employee_training_records
  using (false) with check (false);
alter policy employee_training_records_delete on public.employee_training_records
  using (false);
alter policy practicums_insert on public.practicums with check (false);
alter policy practicums_update on public.practicums using (false) with check (false);
alter policy practicums_delete on public.practicums using (false);
alter policy employee_training_hour_buckets_write on public.employee_training_hour_buckets
  using (false) with check (false);

-- ---------------------------------------------------------------------------
-- Completed classes and attendee evidence are immutable outside audited RPCs
-- ---------------------------------------------------------------------------

create or replace function app_private.lock_completed_training_class()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'completed'
     and coalesce(current_setting('app.completed_class_correction', true), '') <> 'on' then
    raise exception 'completed training classes are immutable; use the audited correction RPC'
      using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function app_private.lock_completed_training_class()
from public, anon, authenticated, service_role;

drop trigger if exists lock_completed_training_class on public.training_classes;
create trigger lock_completed_training_class
before update or delete on public.training_classes
for each row execute function app_private.lock_completed_training_class();

create or replace function app_private.lock_completed_training_attendee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_id uuid := case when tg_op = 'DELETE' then old.class_id else new.class_id end;
begin
  if exists (
    select 1 from public.training_classes tc
    where tc.id = v_class_id and tc.status = 'completed'
  ) and coalesce(current_setting('app.completed_class_correction', true), '') <> 'on' then
    raise exception 'completed class attendance is immutable; use the audited correction RPC'
      using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function app_private.lock_completed_training_attendee()
from public, anon, authenticated, service_role;

drop trigger if exists lock_completed_training_attendee on public.training_class_attendees;
create trigger lock_completed_training_attendee
before insert or update or delete on public.training_class_attendees
for each row execute function app_private.lock_completed_training_attendee();

drop policy if exists training_class_attendees_insert_lock on public.training_class_attendees;
create policy training_class_attendees_insert_lock
on public.training_class_attendees as restrictive
for insert to authenticated with check (
  exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and tc.status <> 'completed'
  )
);

drop policy if exists training_class_attendees_delete_lock on public.training_class_attendees;
create policy training_class_attendees_delete_lock
on public.training_class_attendees as restrictive
for delete to authenticated using (
  exists (
    select 1 from public.training_classes tc
    where tc.id = training_class_attendees.class_id
      and tc.status <> 'completed'
  )
);

create or replace function app_private.assert_completed_class_corrector(
  p_organization_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.is_platform_admin()
    or (
      public.current_profile_active()
      and public.current_org_id() = p_organization_id
      and public.current_role() = 'org_admin'
    )
  ) then
    raise exception 'completed class correction requires an organization administrator'
      using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('compliance_profile_admin');
end;
$$;

revoke all on function app_private.assert_completed_class_corrector(uuid)
from public, anon, authenticated, service_role;

create or replace function public.correct_completed_training_class(
  p_class_id uuid,
  p_patch jsonb,
  p_reason text
)
returns public.training_classes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.training_classes%rowtype;
  v_new public.training_classes%rowtype;
begin
  select * into v_old from public.training_classes where id = p_class_id for update;
  if not found or v_old.status <> 'completed' then
    raise exception 'completed training class not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_completed_class_corrector(v_old.organization_id);
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'a correction reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_patch) <> 'object'
     or p_patch - array['class_name', 'location', 'notes', 'roster_document_id'] <> '{}'::jsonb then
    raise exception 'only descriptive completed-class fields may be corrected' using errcode = '22023';
  end if;
  if p_patch ? 'roster_document_id'
     and nullif(p_patch ->> 'roster_document_id', '') is not null
     and not exists (
       select 1 from public.training_documents d
       where d.id = (p_patch ->> 'roster_document_id')::uuid
         and d.organization_id = v_old.organization_id
         and (v_old.facility_id is null or d.facility_id = v_old.facility_id)
     ) then
    raise exception 'roster document is outside the completed class scope' using errcode = '23514';
  end if;

  perform set_config('app.completed_class_correction', 'on', true);
  update public.training_classes set
    class_name = case when p_patch ? 'class_name' then p_patch ->> 'class_name' else class_name end,
    location = case when p_patch ? 'location' then p_patch ->> 'location' else location end,
    notes = case when p_patch ? 'notes' then p_patch ->> 'notes' else notes end,
    roster_document_id = case
      when p_patch ? 'roster_document_id' and nullif(p_patch ->> 'roster_document_id', '') is not null
        then (p_patch ->> 'roster_document_id')::uuid
      when p_patch ? 'roster_document_id' then null
      else roster_document_id
    end
  where id = p_class_id
  returning * into v_new;

  insert into public.audit_logs(
    organization_id, actor_profile_id, entity_type, entity_id, action,
    old_values, new_values
  ) values (
    v_old.organization_id, auth.uid(), 'training_class', p_class_id::text,
    'completed_class_correction', to_jsonb(v_old),
    jsonb_build_object('record', to_jsonb(v_new), 'reason', btrim(p_reason))
  );
  return v_new;
end;
$$;

revoke all on function public.correct_completed_training_class(uuid, jsonb, text)
from public, anon, authenticated, service_role;
grant execute on function public.correct_completed_training_class(uuid, jsonb, text)
to authenticated;

create or replace function public.correct_completed_class_attendee(
  p_class_id uuid,
  p_employee_id uuid,
  p_action text,
  p_attended boolean,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.training_classes%rowtype;
  v_employee public.employees%rowtype;
  v_attendee public.training_class_attendees%rowtype;
  v_before jsonb;
  v_record_id uuid;
  v_hours numeric;
begin
  select * into v_class from public.training_classes where id = p_class_id for update;
  if not found or v_class.status <> 'completed' then
    raise exception 'completed training class not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_completed_class_corrector(v_class.organization_id);
  if p_action not in ('upsert', 'delete')
     or length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'valid correction action and reason are required' using errcode = '22023';
  end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if not found or v_employee.organization_id <> v_class.organization_id then
    raise exception 'employee is outside the completed class organization' using errcode = '23514';
  end if;
  select * into v_attendee
  from public.training_class_attendees
  where class_id = p_class_id and employee_id = p_employee_id
  for update;
  v_before := case when found then to_jsonb(v_attendee) else null end;

  perform set_config('app.completed_class_correction', 'on', true);
  if p_action = 'delete' then
    if v_attendee.id is null then return false; end if;
    v_record_id := v_attendee.training_record_id;
    update public.training_class_attendees
    set training_record_id = null
    where id = v_attendee.id;
    if v_record_id is not null then
      delete from public.employee_training_records where id = v_record_id;
    end if;
    delete from public.training_class_attendees where id = v_attendee.id;
  else
    if v_attendee.id is null then
      insert into public.training_class_attendees(class_id, employee_id, attended, checkin_method)
      values (p_class_id, p_employee_id, coalesce(p_attended, false), 'manual')
      returning * into v_attendee;
    else
      update public.training_class_attendees
      set attended = coalesce(p_attended, attended), checkin_method = 'manual'
      where id = v_attendee.id
      returning * into v_attendee;
    end if;

    if v_attendee.attended and v_attendee.training_record_id is null then
      v_hours := case
        when v_attendee.checked_in_at is not null and v_attendee.checked_out_at is not null
          then greatest(round(extract(epoch from (v_attendee.checked_out_at - v_attendee.checked_in_at)) / 3600.0, 2), 0)
        else v_class.duration_hours
      end;
      insert into public.employee_training_records(
        organization_id, facility_id, employee_id, training_type_id,
        completion_date, status, trainer_name, hours, completion_method,
        verified_by_profile_id, verified_at
      ) values (
        v_class.organization_id, coalesce(v_class.facility_id, v_employee.facility_id),
        p_employee_id, v_class.training_type_id, v_class.class_date, 'compliant',
        (select first_name || ' ' || last_name from public.profiles where id = v_class.trainer_profile_id),
        v_hours, 'in_person', auth.uid(), now()
      ) returning id into v_record_id;
      update public.training_class_attendees
      set training_record_id = v_record_id
      where id = v_attendee.id
      returning * into v_attendee;
    elsif not v_attendee.attended and v_attendee.training_record_id is not null then
      v_record_id := v_attendee.training_record_id;
      update public.training_class_attendees
      set training_record_id = null
      where id = v_attendee.id
      returning * into v_attendee;
      delete from public.employee_training_records where id = v_record_id;
    end if;
  end if;

  insert into public.audit_logs(
    organization_id, actor_profile_id, entity_type, entity_id, action,
    old_values, new_values
  ) values (
    v_class.organization_id, auth.uid(), 'training_class_attendee',
    coalesce(v_attendee.id::text, p_class_id::text || ':' || p_employee_id::text),
    'completed_attendance_correction', v_before,
    jsonb_build_object(
      'action', p_action, 'attended', p_attended,
      'reason', btrim(p_reason), 'classId', p_class_id, 'employeeId', p_employee_id
    )
  );
  perform public.recalculate_compliance_core(v_class.organization_id);
  return true;
end;
$$;

revoke all on function public.correct_completed_class_attendee(uuid, uuid, text, boolean, text)
from public, anon, authenticated, service_role;
grant execute on function public.correct_completed_class_attendee(uuid, uuid, text, boolean, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Identity deactivation and atomic public-endpoint quotas
-- ---------------------------------------------------------------------------

create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_role text default null,
  p_organization_id uuid default null,
  p_is_active boolean default null,
  p_email text default null
)
returns public.profiles
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_old public.profiles%rowtype;
  v_row public.profiles%rowtype;
begin
  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'profile % not found', p_user_id using errcode = 'no_data_found';
  end if;

  perform set_config('app.privileged_write', 'on', true);
  update public.profiles set
    first_name = coalesce(p_first_name, first_name),
    last_name = coalesce(p_last_name, last_name),
    role = coalesce(p_role, role),
    organization_id = coalesce(p_organization_id, organization_id),
    is_active = coalesce(p_is_active, is_active),
    email = coalesce(p_email, email)
  where id = p_user_id
  returning * into v_row;

  if v_row.organization_id is distinct from v_old.organization_id then
    delete from public.facility_assignments fa
    where fa.profile_id = p_user_id
      and not exists (
        select 1 from public.facilities f
        where f.id = fa.facility_id
          and f.organization_id = v_row.organization_id
      );

    update public.employees e
    set profile_id = null, updated_at = now()
    where e.profile_id = p_user_id
      and e.organization_id is distinct from v_row.organization_id;
  end if;

  -- auth.sessions owns both access-session and refresh-token state in GoTrue.
  -- Keeping this inside the profile transaction closes the deactivation race.
  if v_old.is_active and not v_row.is_active then
    delete from auth.sessions where user_id = p_user_id;
  end if;

  return v_row;
end;
$function$;

revoke all on function public.admin_update_profile(uuid, text, text, text, uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.admin_update_profile(uuid, text, text, text, uuid, boolean, text)
to service_role;

create or replace function public.reserve_signup_attempt(
  p_email_hash text,
  p_ip_hash text,
  p_max_ip_per_hour integer,
  p_max_email_per_day integer,
  p_max_orgs_per_day integer,
  p_legal_accepted boolean,
  p_service_agreement_version text,
  p_baa_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_email_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$'
     or least(p_max_ip_per_hour, p_max_email_per_day, p_max_orgs_per_day) < 1 then
    raise exception 'invalid signup reservation' using errcode = '22023';
  end if;

  -- Fixed lock order serializes every quota dimension, including the global org cap.
  perform pg_advisory_xact_lock(hashtextextended('signup:global', 0));
  perform pg_advisory_xact_lock(hashtextextended('signup:ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('signup:email:' || p_email_hash, 0));

  if (select count(*) from public.signup_attempts
      where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour')
     >= p_max_ip_per_hour then
    raise exception 'signup_ip_rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.signup_attempts
      where email_hash = p_email_hash and created_at >= now() - interval '1 day')
     >= p_max_email_per_day then
    raise exception 'signup_email_rate_limited' using errcode = 'P0001';
  end if;
  if (
    (select count(*) from public.organizations where created_at >= now() - interval '1 day')
    + (select count(*) from public.signup_attempts
       where error_code = 'reserved' and created_at >= now() - interval '1 day')
  ) >= p_max_orgs_per_day then
    raise exception 'signup_organization_quota_reached' using errcode = 'P0001';
  end if;

  insert into public.signup_attempts(
    email_hash, ip_hash, success, error_code, legal_accepted,
    service_agreement_version, baa_version
  ) values (
    p_email_hash, p_ip_hash, false, 'reserved', p_legal_accepted,
    p_service_agreement_version, p_baa_version
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finalize_signup_attempt(
  p_attempt_id uuid, p_success boolean, p_error_code text default null
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update public.signup_attempts
    set success = p_success,
        error_code = case when p_success then null else left(coalesce(p_error_code, 'failed'), 100) end
    where id = p_attempt_id and error_code = 'reserved'
    returning 1
  )
  select exists(select 1 from changed);
$$;

revoke all on function public.reserve_signup_attempt(text, text, integer, integer, integer, boolean, text, text)
from public, anon, authenticated;
revoke all on function public.finalize_signup_attempt(uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.reserve_signup_attempt(text, text, integer, integer, integer, boolean, text, text)
to service_role;
grant execute on function public.finalize_signup_attempt(uuid, boolean, text)
to service_role;

create or replace function public.reserve_confidential_intake_attempt(
  p_ip_hash text, p_facility_id uuid, p_limit integer default 5
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' or p_limit < 1 then
    raise exception 'invalid intake reservation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('confidential-intake:' || p_ip_hash, 0));
  if (select count(*) from public.confidential_intake_attempts
      where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour') >= p_limit then
    raise exception 'confidential_intake_rate_limited' using errcode = 'P0001';
  end if;
  insert into public.confidential_intake_attempts(ip_hash, facility_id, success, error_code)
  values (p_ip_hash, p_facility_id, false, 'reserved') returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finalize_confidential_intake_attempt(
  p_attempt_id bigint, p_success boolean, p_error_code text default null
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update public.confidential_intake_attempts
    set success = p_success,
        error_code = case when p_success then null else left(coalesce(p_error_code, 'failed'), 100) end
    where id = p_attempt_id and error_code = 'reserved'
    returning 1
  )
  select exists(select 1 from changed);
$$;

revoke all on function public.reserve_confidential_intake_attempt(text, uuid, integer)
from public, anon, authenticated;
revoke all on function public.finalize_confidential_intake_attempt(bigint, boolean, text)
from public, anon, authenticated;
grant execute on function public.reserve_confidential_intake_attempt(text, uuid, integer)
to service_role;
grant execute on function public.finalize_confidential_intake_attempt(bigint, boolean, text)
to service_role;

-- ---------------------------------------------------------------------------
-- Revocable, class-window-bound check-in tokens
-- ---------------------------------------------------------------------------

alter table public.class_checkin_tokens
  add column token_kind text not null default 'live'
    check (token_kind in ('live', 'printed')),
  add column not_before timestamptz not null default now(),
  add column revoked_at timestamptz,
  add column last_used_at timestamptz;

create or replace function public.generate_class_checkin_token(
  p_class_id uuid, p_long_lived boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.training_classes%rowtype;
  v_token text;
  v_not_before timestamptz;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if not found then raise exception 'training class not found' using errcode = 'P0002'; end if;
  if v_class.status <> 'draft' then
    raise exception 'This class is no longer accepting check-ins.' using errcode = '23514';
  end if;
  if not (
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id()
        and public.current_profile_active()
        and (public.current_role() = 'org_admin'
             or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(v_class.facility_id))
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid()
                 and public.is_assigned_to_facility(v_class.facility_id))))
  ) then
    raise exception 'not authorized to run check-in for this training class' using errcode = '42501';
  end if;

  delete from public.class_checkin_tokens where expires_at < now() - interval '1 day';
  if p_long_lived then
    v_not_before := v_class.class_date::timestamp at time zone 'UTC';
    if now() >= v_not_before + interval '1 day' then
      raise exception 'The class check-in window has ended.' using errcode = '22023';
    end if;
    update public.class_checkin_tokens
    set revoked_at = now()
    where class_id = p_class_id and token_kind = 'printed' and revoked_at is null;
  else
    v_not_before := now();
  end if;

  insert into public.class_checkin_tokens(class_id, token_kind, not_before, expires_at)
  values (
    p_class_id, case when p_long_lived then 'printed' else 'live' end, v_not_before,
    case when p_long_lived then v_not_before + interval '1 day' else now() + interval '45 seconds' end
  ) returning token into v_token;
  return v_token;
end;
$$;

create or replace function public.checkin_via_token(p_token text)
returns public.training_class_attendees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_row public.class_checkin_tokens%rowtype;
  v_class public.training_classes%rowtype;
  v_employee public.employees%rowtype;
  v_attendee public.training_class_attendees%rowtype;
begin
  select * into v_token_row from public.class_checkin_tokens where token = p_token for update;
  if not found or v_token_row.revoked_at is not null or now() < v_token_row.not_before
     or v_token_row.expires_at < now() then
    raise exception 'This check-in code is not active. Please scan the current QR code again.'
      using errcode = '22000';
  end if;
  select * into v_class from public.training_classes where id = v_token_row.class_id;
  if v_class.status <> 'draft' then
    raise exception 'This class is no longer accepting check-ins.' using errcode = '23514';
  end if;
  select * into v_employee from public.employees
  where profile_id = auth.uid() and organization_id = v_class.organization_id
    and status <> 'terminated';
  if not found then
    raise exception 'No active employee record found for your account in this organization'
      using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_class.id::text || ':' || v_employee.id::text));
  select * into v_attendee from public.training_class_attendees
  where class_id = v_class.id and employee_id = v_employee.id;
  if not found then
    insert into public.training_class_attendees(class_id, employee_id, attended, checked_in_at, checkin_method)
    values (v_class.id, v_employee.id, true, now(), 'qr') returning * into v_attendee;
  elsif v_attendee.checked_in_at is null then
    update public.training_class_attendees
    set attended = true, checked_in_at = now(), checkin_method = 'qr'
    where id = v_attendee.id returning * into v_attendee;
  elsif v_attendee.checked_out_at is null then
    update public.training_class_attendees set checked_out_at = now()
    where id = v_attendee.id returning * into v_attendee;
  else
    raise exception 'You have already checked in and out for this class.' using errcode = '22000';
  end if;
  update public.class_checkin_tokens set last_used_at = now() where id = v_token_row.id;
  return v_attendee;
end;
$$;

create or replace function public.revoke_class_checkin_tokens(p_class_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.training_classes%rowtype;
  v_changed integer;
begin
  select * into v_class from public.training_classes where id = p_class_id;
  if not found then raise exception 'training class not found' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A revocation reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if not (
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id() and public.current_profile_active()
        and (public.current_role() = 'org_admin'
             or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(v_class.facility_id))
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid())))
  ) then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.class_checkin_tokens set revoked_at = now()
  where class_id = p_class_id and revoked_at is null and expires_at >= now();
  get diagnostics v_changed = row_count;
  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v_class.organization_id, auth.uid(), 'training_class', p_class_id::text,
          'checkin_tokens_revoked', jsonb_build_object('reason', btrim(p_reason), 'count', v_changed));
  return v_changed;
end;
$$;

revoke all on function public.generate_class_checkin_token(uuid, boolean) from public, anon;
revoke all on function public.checkin_via_token(text) from public, anon;
revoke all on function public.revoke_class_checkin_tokens(uuid, text) from public, anon;
grant execute on function public.generate_class_checkin_token(uuid, boolean) to authenticated;
grant execute on function public.checkin_via_token(text) to authenticated;
grant execute on function public.revoke_class_checkin_tokens(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Private course videos and tenant-scoped notification consent
-- ---------------------------------------------------------------------------

update storage.buckets set public = false where id = 'course-videos';

drop policy if exists "course-videos authenticated read" on storage.objects;
create policy "course-videos authenticated read" on storage.objects
for select to authenticated using (
  bucket_id = 'course-videos'
  and (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.course_blocks b
      join public.course_versions cv on cv.id = b.course_version_id
      where b.id::text = split_part(storage.filename(storage.objects.name), '.', 1)
        and cv.status = 'published'
        and public.current_profile_active()
        and (storage.foldername(storage.objects.name))[1]
              = coalesce(b.organization_id::text, 'system')
        and (b.organization_id is null or b.organization_id = public.current_org_id())
    )
  )
);

create or replace function public.record_notification_consent_event(
  p_channel text,
  p_action text,
  p_provider text,
  p_provider_event_id text,
  p_recipient_fingerprint text,
  p_occurred_at timestamptz,
  p_source text,
  p_attempt_id uuid default null,
  p_recipient text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile_id uuid;
  v_organization_id uuid;
  v_attempt_channel text;
  v_attempt_recipient text;
  v_event_id uuid;
  v_changed integer := 0;
  v_match_count integer := 0;
  v_recipient_email text := lower(btrim(p_recipient));
begin
  if p_channel not in ('email', 'sms') or p_action not in ('opt_in', 'opt_out', 'help')
     or p_provider not in ('twilio', 'sendgrid') or nullif(btrim(p_provider_event_id), '') is null
     or length(p_provider_event_id) > 512 or nullif(btrim(p_source), '') is null
     or p_recipient_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid notification consent event' using errcode = '22023';
  end if;

  if p_attempt_id is not null then
    select d.profile_id, d.organization_id, d.channel, d.recipient
    into v_profile_id, v_organization_id, v_attempt_channel, v_attempt_recipient
    from public.notification_delivery_attempts a
    join public.notification_deliveries d on d.id = a.delivery_id
    where a.id = p_attempt_id;
    if v_profile_id is null or v_attempt_channel <> p_channel then
      raise exception 'Consent event attempt does not match the channel' using errcode = '22023';
    end if;
    if p_channel = 'sms' and p_recipient is not null
       and public.notification_phone_key(v_attempt_recipient) <> public.notification_phone_key(p_recipient) then
      raise exception 'Consent event recipient does not match the delivery attempt' using errcode = '22023';
    elsif p_channel = 'email' and p_recipient is not null
       and lower(btrim(v_attempt_recipient)) <> v_recipient_email then
      raise exception 'Consent event recipient does not match the delivery attempt' using errcode = '22023';
    end if;
  elsif p_channel = 'sms' and p_recipient is not null then
    -- A phone number is not a tenant key. Infer scope only when prior delivery
    -- evidence identifies exactly one organization, then exactly one active profile.
    select count(distinct d.organization_id), (array_agg(distinct d.organization_id))[1]
    into v_match_count, v_organization_id
    from public.notification_deliveries d
    where d.channel = 'sms'
      and public.notification_phone_key(d.recipient) = public.notification_phone_key(p_recipient);
    if v_match_count <> 1 then v_organization_id := null; end if;
    if v_organization_id is not null then
      select count(*), (array_agg(id))[1] into v_match_count, v_profile_id
      from public.profiles
      where organization_id = v_organization_id and is_active
        and public.notification_phone_key(phone) = public.notification_phone_key(p_recipient);
      if v_match_count <> 1 then v_profile_id := null; end if;
    end if;
  elsif p_channel = 'email' and p_recipient is not null then
    select count(*), (array_agg(id))[1] into v_match_count, v_profile_id
    from public.profiles where lower(btrim(email)) = v_recipient_email and is_active;
    if v_match_count = 1 then
      select organization_id into v_organization_id from public.profiles where id = v_profile_id;
    else v_profile_id := null;
    end if;
  end if;

  insert into public.notification_consent_events(
    organization_id, profile_id, attempt_id, channel, action, provider,
    provider_event_id, recipient_fingerprint, source, occurred_at
  ) values (
    v_organization_id, v_profile_id, p_attempt_id, p_channel, p_action, p_provider,
    p_provider_event_id, p_recipient_fingerprint, left(p_source, 100), coalesce(p_occurred_at, now())
  ) on conflict(provider, provider_event_id) do nothing returning id into v_event_id;
  if v_event_id is null or p_action = 'help'
     or (p_channel = 'sms' and v_profile_id is null) then return 0; end if;

  if exists (
    select 1 from public.notification_consent_events e
    where e.id <> v_event_id and e.channel = p_channel
      and (
        (p_channel = 'email' and e.recipient_fingerprint = p_recipient_fingerprint)
        or (p_channel = 'sms' and e.organization_id = v_organization_id and e.profile_id = v_profile_id)
      )
      and e.action in ('opt_in', 'opt_out') and e.occurred_at > coalesce(p_occurred_at, now())
  ) then return 0; end if;

  if p_channel = 'sms' then
    update public.profiles
    set sms_opt_in = (p_action = 'opt_in'),
        sms_consent_at = case when p_action = 'opt_in' then coalesce(p_occurred_at, now()) else sms_consent_at end,
        sms_opt_out_at = case when p_action = 'opt_out' then coalesce(p_occurred_at, now()) else null end
    where id = v_profile_id and organization_id = v_organization_id;
  else
    update public.profiles
    set email_opt_out = (p_action = 'opt_out'),
        email_opt_out_at = case when p_action = 'opt_out' then coalesce(p_occurred_at, now()) else null end
    where p_recipient is not null and lower(btrim(email)) = v_recipient_email;
  end if;
  get diagnostics v_changed = row_count;

  if p_action = 'opt_out' then
    update public.notification_deliveries
    set status = 'skipped', skip_reason = upper(p_channel) || ' recipient opted out', finalized_at = now()
    where channel = p_channel and status in ('pending', 'processing')
      and (
        (p_channel = 'sms' and organization_id = v_organization_id and profile_id = v_profile_id)
        or (p_channel = 'email' and p_recipient is not null
            and lower(btrim(recipient)) = v_recipient_email)
      );
  end if;
  return v_changed;
end;
$function$;

revoke all on function public.record_notification_consent_event(
  text, text, text, text, text, timestamptz, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.record_notification_consent_event(
  text, text, text, text, text, timestamptz, text, uuid, text
) to service_role;

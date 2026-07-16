-- Individual recurring courses need assignment-specific compliance evidence.
--
-- The original LMS bridge stores one courses.training_type_id and updates the most recent
-- employee_training_records row for that type. That is safe for the eight legacy all-in-one
-- annual courses, but it cannot represent several independently completed classes contributing
-- to the same annual-hours requirement: each completion would overwrite the previous class's
-- hours. This migration adds a many-to-many regulatory crosswalk and an immutable completion
-- credit ledger while preserving the legacy bridge for existing courses and assignments.

-- BEGIN annual-audience-applicability
-- Facility type alone cannot prove that an employee belongs to a role- or unit-specific annual
-- training audience. Keep those requirement shells visible for employer triage, but do not place
-- them in compliance denominators or annual-hour buckets until an employer confirms applicability
-- by moving the employee_training_records row from pending_review to an active requirement status
-- (normally missing). A completed record remains evidence; not_applicable remains an explicit
-- employer decision.
alter table public.training_types
  add column audience_verification_required boolean not null default false;

alter table public.employee_training_records
  add column audience_decision_at timestamptz;

comment on column public.training_types.audience_verification_required is
  'When true, facility type is only a catalog prefilter. The auto-instantiated employee requirement remains pending_review and is excluded from annual-hour rollups until an employer confirms this exact audience by changing the record to an active requirement status such as missing.';
comment on column public.employee_training_records.audience_decision_at is
  'Server-stamped when the audience decision category changes among pending_review, not_applicable, and applicable. The most recent stamp is the canonical decision for an employee and exact training type; older completion evidence remains historical evidence.';

create or replace function public.enforce_system_annual_audience_verification()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
begin
  if new.organization_id is null
     and new.code = any (array[
       'DIRECT-ANNUAL',
       'ALR-DIRECT-ANNUAL',
       'GH-DIRECT-ANNUAL',
       'GH-OTHER-ANNUAL',
       'NH-AIDE-ANNUAL',
       'HHA-AIDE-ANNUAL',
       'HOS-AIDE-ANNUAL',
       'ADMIN-ANNUAL',
       'DEMENTIA',
       'PCH-DEMENTIA-UNIT',
       'ALR-DEMENTIA-SCU-ANNUAL',
       'ALR-INRBI-SCU-ANNUAL'
     ]::text[]) then
    new.audience_verification_required := true;
  end if;

  return new;
end;
$function$;

create trigger enforce_system_annual_audience_verification
  before insert or update of organization_id, code, audience_verification_required
  on public.training_types
  for each row execute function public.enforce_system_annual_audience_verification();

revoke all on function public.enforce_system_annual_audience_verification()
  from public, anon, authenticated, service_role;

update public.training_types
set audience_verification_required = true
where organization_id is null
  and code = any (array[
    'DIRECT-ANNUAL',
    'ALR-DIRECT-ANNUAL',
    'GH-DIRECT-ANNUAL',
    'GH-OTHER-ANNUAL',
    'NH-AIDE-ANNUAL',
    'HHA-AIDE-ANNUAL',
    'HOS-AIDE-ANNUAL',
    'ADMIN-ANNUAL',
    'DEMENTIA',
    'PCH-DEMENTIA-UNIT',
    'ALR-DEMENTIA-SCU-ANNUAL',
    'ALR-INRBI-SCU-ANNUAL'
  ]::text[]);

update public.training_types
set description = case code
      when 'GH-DIRECT-ANNUAL' then
        'Twenty-four annual training hours related to job skills and knowledge for direct service workers, direct supervisors of direct service workers, and program specialists.'
      else
        'Twelve annual training hours for management, program, administrative and fiscal staff; covered dietary, housekeeping, maintenance and ancillary staff; covered consultants and contractors who work alone with individuals; volunteers who work alone with individuals; and paid or unpaid interns who work alone with individuals, subject to the exceptions in 55 Pa. Code Section 6400.52(b).'
    end,
    required_roles_text = case code
      when 'GH-DIRECT-ANNUAL' then
        'Direct service workers; direct supervisors of direct service workers; and program specialists under 55 Pa. Code Section 6400.52(a).'
      else
        'Management, program, administrative and fiscal staff persons; dietary, housekeeping, maintenance and ancillary staff persons, except persons employed or contracted by the building owner when the licensed facility does not own the building; consultants and contractors paid or contracted by the home who work alone with individuals, except those providing service for fewer than 30 days in a 12-month period who are licensed, certified or registered by the Department of State in a health care or social service field; volunteers who work alone with individuals; and paid and unpaid interns who work alone with individuals under 55 Pa. Code Section 6400.52(b).'
    end,
    citation_note = case code
      when 'GH-DIRECT-ANNUAL' then
        '55 Pa. Code Section 6400.52(a) -- 24 hours each year for direct service workers, their direct supervisors, and program specialists. Employer audience verification is required.'
      else
        '55 Pa. Code Section 6400.52(b) -- 12 hours each year for the listed other-staff, contractor, volunteer, and intern audiences, subject to the building-owner and short-term licensed-professional exceptions. Employer audience verification is required.'
    end,
    hour_bucket = 'general_annual'
where organization_id is null
  and code in ('GH-DIRECT-ANNUAL', 'GH-OTHER-ANNUAL');

-- Existing auto-created missing shells did not record an audience decision. Move only incomplete
-- shells to triage; completed evidence and an employer's explicit not_applicable decision survive.
update public.employee_training_records r
set status = 'pending_review'
from public.training_types tt
where tt.id = r.training_type_id
  and tt.audience_verification_required
  and r.status = 'missing'
  and r.completion_date is null;

-- A learner may have several records for one recurring training type. Preserve every evidence
-- row, but keep a separate, server-controlled chronology for the audience decision. This avoids
-- treating any old compliant/expired row as a permanent audience confirmation after an employer
-- has made a newer pending_review or not_applicable decision.
update public.employee_training_records r
set audience_decision_at = coalesce(r.updated_at, r.created_at)
from public.training_types tt
where tt.id = r.training_type_id
  and tt.audience_verification_required;

create index employee_training_records_audience_decision_idx
  on public.employee_training_records(
    employee_id,
    training_type_id,
    audience_decision_at desc,
    created_at desc,
    id desc
  );

create or replace function public.stamp_training_audience_decision()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_verification_required boolean := false;
  v_old_category text;
  v_new_category text;
begin
  select tt.audience_verification_required
    into v_verification_required
  from public.training_types tt
  where tt.id = new.training_type_id;

  if not coalesce(v_verification_required, false) then
    new.audience_decision_at := null;
    return new;
  end if;

  v_new_category := case
    when new.status = 'pending_review' then 'pending_review'
    when new.status = 'not_applicable' then 'not_applicable'
    else 'applicable'
  end;

  if tg_op = 'INSERT' then
    new.audience_decision_at := clock_timestamp();
    return new;
  end if;

  v_old_category := case
    when old.status = 'pending_review' then 'pending_review'
    when old.status = 'not_applicable' then 'not_applicable'
    else 'applicable'
  end;

  if new.employee_id is distinct from old.employee_id
     or new.training_type_id is distinct from old.training_type_id
     or v_new_category is distinct from v_old_category
     or old.audience_decision_at is null then
    new.audience_decision_at := clock_timestamp();
  else
    -- Ignore client-supplied timestamp changes and routine status changes inside the applicable
    -- category (missing/compliant/due_soon/expired).
    new.audience_decision_at := old.audience_decision_at;
  end if;

  return new;
end;
$function$;

create trigger stamp_training_audience_decision
  before insert or update of employee_id, training_type_id, status, audience_decision_at
  on public.employee_training_records
  for each row execute function public.stamp_training_audience_decision();

revoke all on function public.stamp_training_audience_decision()
  from public, anon, authenticated, service_role;

create or replace function public.current_training_audience_status(
  p_employee_id uuid,
  p_training_type_id uuid
)
returns text
language sql
stable
security definer
set search_path = 'public'
as $function$
  select r.status
  from public.employee_training_records r
  where r.employee_id = p_employee_id
    and r.training_type_id = p_training_type_id
  order by
    r.audience_decision_at desc nulls last,
    r.created_at desc,
    r.id desc
  limit 1
$function$;

revoke all on function public.current_training_audience_status(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.instantiate_missing_requirements(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_emp record;
begin
  select e.id, e.organization_id, e.facility_id, e.status, e.administers_medications, e.trainer_status,
         f.facility_type, coalesce(f.state, 'PA') as facility_state
    into v_emp
  from public.employees e
  join public.facilities f on f.id = e.facility_id
  where e.id = p_employee_id;

  if v_emp.id is null or v_emp.status <> 'active' then
    return;
  end if;

  insert into public.employee_training_records (
    organization_id,
    facility_id,
    employee_id,
    training_type_id,
    status,
    document_required
  )
  select
    v_emp.organization_id,
    v_emp.facility_id,
    v_emp.id,
    tt.id,
    case when tt.audience_verification_required then 'pending_review' else 'missing' end,
    tt.document_required
  from public.training_types tt
  where tt.is_active
    and tt.state = v_emp.facility_state
    and (tt.organization_id is null or tt.organization_id = v_emp.organization_id)
    and (tt.applies_to_facility_type = 'BOTH' or tt.applies_to_facility_type = v_emp.facility_type)
    and (coalesce(tt.applies_to_administers_meds, false) = false or v_emp.administers_medications)
    and (coalesce(tt.applies_to_trainers, false) = false or v_emp.trainer_status)
    and not exists (
      select 1
      from public.employee_training_records r
      where r.employee_id = v_emp.id
        and r.training_type_id = tt.id
    );

  if v_emp.administers_medications then
    insert into public.practicums (
      organization_id,
      facility_id,
      employee_id,
      practicum_year,
      status
    )
    select
      v_emp.organization_id,
      v_emp.facility_id,
      v_emp.id,
      extract(year from current_date)::integer,
      'missing'
    where not exists (
      select 1
      from public.practicums p
      where p.employee_id = v_emp.id
        and p.practicum_year = extract(year from current_date)::integer
    );
  end if;

  insert into public.employee_credentials (
    organization_id,
    facility_id,
    employee_id,
    credential_type,
    status
  )
  select
    v_emp.organization_id,
    v_emp.facility_id,
    v_emp.id,
    ct.credential_type,
    'missing'
  from (values ('act34_criminal_history'), ('tb_screening')) as ct(credential_type)
  where not exists (
    select 1
    from public.employee_credentials c
    where c.employee_id = v_emp.id
      and c.credential_type = ct.credential_type
  );
end;
$function$;

revoke all on function public.instantiate_missing_requirements(uuid)
  from public, anon, authenticated, service_role;
-- END annual-audience-applicability

alter table public.courses
  add column catalog_code text,
  add column recurrence_interval_days integer
    check (recurrence_interval_days is null or recurrence_interval_days > 0);

alter table public.course_assignments
  add column completion_recorded_at timestamptz;

update public.course_assignments
set completion_recorded_at = completed_at
where status = 'completed';

alter table public.course_assignments
  add constraint course_assignments_completion_evidence_check
  check ((status = 'completed') = (completion_recorded_at is not null));

comment on column public.courses.catalog_code is
  'Stable machine-readable identifier for seeded/system or organization course catalogs; titles remain editable display text.';
comment on column public.courses.recurrence_interval_days is
  'Renewal cycle after completion. Self-enrollment opens during the final 30 days so annual learning can finish before expiration; NULL reuses the prior assignment indefinitely.';
comment on column public.course_assignments.completion_recorded_at is
  'Protected first-completion evidence used for recurring eligibility and regulatory credit; ordinary assignment edits cannot move this timestamp.';

create unique index courses_system_catalog_code_uk
  on public.courses (catalog_code)
  where organization_id is null and catalog_code is not null;
create unique index courses_org_catalog_code_uk
  on public.courses (organization_id, catalog_code)
  where organization_id is not null and catalog_code is not null;

-- Forward-correct regulatory metadata that was inaccurate or too narrow in the original catalog.
update public.training_types
set description = 'Six additional structured dementia-care training hours each year for direct care staff assigned to a Personal Care Home secured dementia care unit.',
    citation_note = '55 Pa. Code Section 2600.236 -- 6 hours/year related to dementia care and services, in addition to the 12 hours required by Section 2600.65.'
where organization_id is null and code = 'PCH-DEMENTIA-UNIT';

update public.training_types
set description = 'Two hours of dementia-specific training each year for assisted living administrative staff, direct care staff, ancillary staff, substitute personnel, and volunteers, after the initial 4 hours within 30 days of hire.',
    citation_note = '55 Pa. Code Section 2800.69 -- 4 hours within 30 days of hire and at least 2 hours annually thereafter for administrative staff, direct care staff, ancillary staff, substitute personnel, and volunteers; additional to other Chapter 2800 training.'
where organization_id is null and code = 'DEMENTIA';

select set_config('app.privileged_write', 'on', true);

update public.courses
set description = 'Legacy bundled course for 6 additional yearly dementia-care hours for Personal Care Home secured dementia care unit staff under 55 Pa. Code Section 2600.236.'
where organization_id is null
  and title = 'Personal Care Home Dementia Care Unit Training';

select set_config('app.privileged_write', 'off', true);

create table public.course_compliance_credits (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  course_version_id uuid not null references public.course_versions(id) on delete cascade,
  training_type_id uuid not null references public.training_types(id) on delete restrict,
  topic_code text not null check (topic_code ~ '^[A-Z0-9][A-Z0-9._-]*$'),
  credit_hours numeric(6,2) not null check (credit_hours > 0),
  credit_mode text not null default 'automatic'
    check (credit_mode in ('automatic', 'verified_only')),
  citation_note text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_compliance_credits_version_type_uk
    unique (course_version_id, training_type_id)
);

comment on table public.course_compliance_credits is
  'Version-scoped regulatory crosswalk from one independently takeable course to one or more applicable training requirements. automatic rows become immutable credit evidence only after full progress, quiz, and engagement checks; verified_only rows document coverage that still needs qualified facilitator/source verification.';
comment on column public.course_compliance_credits.credit_hours is
  'Designed instructional credit for this course, deliberately independent from aggregate annual required hours.';
comment on column public.course_compliance_credits.credit_mode is
  'automatic credits a completed online assignment; verified_only requires separate qualified-source/facilitator evidence and is never auto-credited.';

create index course_compliance_credits_course_idx
  on public.course_compliance_credits(course_id) where is_active;
create index course_compliance_credits_version_idx
  on public.course_compliance_credits(course_version_id) where is_active;
create index course_compliance_credits_training_type_idx
  on public.course_compliance_credits(training_type_id) where is_active;

create trigger set_updated_at before update on public.course_compliance_credits
  for each row execute function public.set_updated_at();

create or replace function public.validate_course_compliance_credit()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_minutes integer;
  v_version_course_id uuid;
begin
  select c.estimated_duration_minutes, cv.course_id
    into v_minutes, v_version_course_id
  from public.course_versions cv
  join public.courses c on c.id = cv.course_id
  where cv.id = new.course_version_id;

  if v_version_course_id is distinct from new.course_id then
    raise exception 'course version % does not belong to course %', new.course_version_id, new.course_id
      using errcode = 'check_violation';
  end if;

  if v_minutes is null or v_minutes <= 0 then
    raise exception 'course % must have a positive estimated duration before compliance credit is configured', new.course_id
      using errcode = 'check_violation';
  end if;

  if new.credit_hours > round(v_minutes::numeric / 60.0, 2) then
    raise exception 'course compliance credit % hours exceeds the course''s designed duration of % minutes',
      new.credit_hours, v_minutes
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

create trigger validate_course_compliance_credit
  before insert or update of course_id, course_version_id, credit_hours
  on public.course_compliance_credits
  for each row execute function public.validate_course_compliance_credit();

revoke all on function public.validate_course_compliance_credit()
  from public, anon, authenticated, service_role;

create or replace function public.lock_published_course_compliance_credit()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_old_status text;
  v_new_status text;
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select status into v_old_status
    from public.course_versions
    where id = old.course_version_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select status into v_new_status
    from public.course_versions
    where id = new.course_version_id;
  end if;

  -- Inspect both sides of an UPDATE. Checking only NEW would let a caller move
  -- a mapping off a published immutable version onto a draft version.
  if v_old_status = 'published' or v_new_status = 'published' then
    raise exception 'published course compliance mappings are immutable; publish a new course version'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create trigger lock_published_course_compliance_credit
  before insert or update or delete on public.course_compliance_credits
  for each row execute function public.lock_published_course_compliance_credit();

revoke all on function public.lock_published_course_compliance_credit()
  from public, anon, authenticated, service_role;

create or replace function public.validate_course_duration_for_compliance_credit()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
begin
  if exists (
    select 1
    from public.course_compliance_credits cc
    where cc.course_id = new.id
      and cc.is_active
      and (
        new.estimated_duration_minutes is null
        or new.estimated_duration_minutes <= 0
        or cc.credit_hours > round(new.estimated_duration_minutes::numeric / 60.0, 2)
      )
  ) then
    raise exception 'course duration cannot be shorter than an active compliance credit'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

create trigger validate_course_duration_for_compliance_credit
  before update of estimated_duration_minutes on public.courses
  for each row execute function public.validate_course_duration_for_compliance_credit();

revoke all on function public.validate_course_duration_for_compliance_credit()
  from public, anon, authenticated, service_role;

create table public.course_completion_credits (
  id uuid primary key default gen_random_uuid(),
  course_assignment_id uuid not null
    references public.course_assignments(id) on delete restrict,
  course_id uuid not null references public.courses(id) on delete restrict,
  course_version_id uuid not null references public.course_versions(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  training_type_id uuid not null references public.training_types(id) on delete restrict,
  topic_code text not null,
  credit_hours numeric(6,2) not null check (credit_hours > 0),
  training_year integer not null check (training_year between 2000 and 2200),
  citation_note text not null,
  credited_at timestamptz not null,
  credited_by_profile_id uuid references public.profiles(id) on delete set null,
  evidence_mode text not null default 'course_completion'
    check (evidence_mode = 'course_completion'),
  created_at timestamptz not null default now(),
  constraint course_completion_credits_assignment_type_topic_uk
    unique (course_assignment_id, training_type_id, topic_code)
);

comment on table public.course_completion_credits is
  'Immutable, assignment-specific regulatory credit created on the first completed transition. Annual rollups sum these rows without overwriting another individual course completion.';

create index course_completion_credits_employee_year_idx
  on public.course_completion_credits(employee_id, training_year);
create index course_completion_credits_org_year_idx
  on public.course_completion_credits(organization_id, training_year);
create index course_completion_credits_training_type_idx
  on public.course_completion_credits(training_type_id);

alter table public.course_compliance_credits enable row level security;
alter table public.course_completion_credits enable row level security;

create policy course_compliance_credits_select
  on public.course_compliance_credits
  for select to authenticated
  using (
    exists (
      select 1
      from public.courses c
      where c.id = course_compliance_credits.course_id
        and (
          public.is_platform_admin()
          or c.organization_id is null
          or c.organization_id = public.current_org_id()
        )
    )
  );

create policy course_completion_credits_select
  on public.course_completion_credits
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      organization_id = public.current_org_id()
      and (
        public.owns_employee(employee_id)
        or public.current_role() in ('org_admin', 'auditor')
        or public.is_assigned_to_facility(facility_id)
      )
    )
  );

revoke all on table public.course_compliance_credits from public, anon, authenticated;
revoke all on table public.course_completion_credits from public, anon, authenticated;
grant select on table public.course_compliance_credits to authenticated;
grant select on table public.course_completion_credits to authenticated;
grant all on table public.course_compliance_credits to service_role;
grant all on table public.course_completion_credits to service_role;

create or replace function public.guard_course_completion_transition()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare
  v_privileged boolean := coalesce(current_setting('app.privileged_write', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' then
      raise exception 'completed assignments must use complete_course_assignment()'
        using errcode = '55000';
    end if;
    new.completion_recorded_at := null;
    return new;
  end if;

  if old.status <> 'completed' and new.status = 'completed' then
    if not v_privileged then
      raise exception 'completed assignments must use complete_course_assignment()'
        using errcode = '55000';
    end if;
    new.completion_recorded_at := coalesce(new.completed_at, now());
  elsif old.status = 'completed' then
    if new.status <> 'completed' then
      raise exception 'a completed course assignment cannot be reopened directly'
        using errcode = '55000';
    end if;
    if new.completion_recorded_at is distinct from old.completion_recorded_at
       and not v_privileged then
      raise exception 'course completion evidence is immutable'
        using errcode = '55000';
    end if;
  else
    new.completion_recorded_at := null;
  end if;

  return new;
end;
$function$;

create trigger guard_course_completion_transition
  before insert or update on public.course_assignments
  for each row execute function public.guard_course_completion_transition();

revoke all on function public.guard_course_completion_transition()
  from public, anon, authenticated, service_role;

-- Assignment identity is the join point for progress, quiz attempts,
-- certificates, and regulatory evidence. It cannot be repointed to a different
-- learner, facility, course, or version after creation. Completed assignments
-- likewise cannot be deleted and leave a detached certificate behind.
create or replace function public.protect_course_assignment_evidence_identity()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'completed' then
      raise exception 'completed course assignment evidence is immutable'
        using errcode = '55000';
    end if;
    return old;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.facility_id is distinct from old.facility_id
     or new.employee_id is distinct from old.employee_id
     or new.course_id is distinct from old.course_id
     or new.course_version_id is distinct from old.course_version_id
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at then
    raise exception 'course assignment learner, scope, course, and version are immutable'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;

create trigger protect_course_assignment_evidence_identity
  before update or delete on public.course_assignments
  for each row execute function public.protect_course_assignment_evidence_identity();

revoke all on function public.protect_course_assignment_evidence_identity()
  from public, anon, authenticated, service_role;

create or replace function public.protect_course_progress_timing()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.started_at := now();
  else
    new.started_at := coalesce(old.started_at, now());
  end if;

  return new;
end;
$function$;

create trigger protect_course_progress_timing
  before insert or update on public.course_progress
  for each row execute function public.protect_course_progress_timing();

revoke all on function public.protect_course_progress_timing()
  from public, anon, authenticated, service_role;

create or replace function public.lock_course_completion_credit()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
begin
  if coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  raise exception 'course completion credit is immutable'
    using errcode = '55000';
end;
$function$;

create trigger lock_course_completion_credit
  before update or delete on public.course_completion_credits
  for each row execute function public.lock_course_completion_credit();

revoke all on function public.lock_course_completion_credit()
  from public, anon, authenticated, service_role;

create or replace function public.record_course_completion_credits()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_required_seconds numeric;
  v_started_at timestamptz;
  v_percent_complete integer;
  v_last_block_id uuid;
  v_final_block_id uuid;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  select max(cc.credit_hours * 3600)
    into v_required_seconds
  from public.course_compliance_credits cc
  join public.training_types tt on tt.id = cc.training_type_id
  join public.facilities f on f.id = new.facility_id
  where cc.course_id = new.course_id
    and cc.course_version_id = new.course_version_id
    and cc.is_active
    and cc.credit_mode = 'automatic'
    and tt.is_active
    and tt.state = coalesce(f.state, 'PA')
    and (tt.organization_id is null or tt.organization_id = new.organization_id)
    and (tt.applies_to_facility_type = 'BOTH' or tt.applies_to_facility_type = f.facility_type);

  if v_required_seconds is not null then
    select cp.started_at, cp.percent_complete, cp.last_block_id
      into v_started_at, v_percent_complete, v_last_block_id
    from public.course_progress cp
    where cp.assignment_id = new.id;

    if v_started_at is null or coalesce(v_percent_complete, 0) < 100 then
      raise exception 'automatic compliance credit requires 100 percent course progress'
        using errcode = 'check_violation';
    end if;

    if extract(epoch from (new.completion_recorded_at - v_started_at)) < v_required_seconds then
      raise exception 'automatic compliance credit requires the full credited engagement time'
        using errcode = 'check_violation';
    end if;

    select cb.id into v_final_block_id
    from public.course_blocks cb
    where cb.course_version_id = new.course_version_id
    order by cb.sort_order desc, cb.id desc
    limit 1;

    if v_last_block_id is distinct from v_final_block_id then
      raise exception 'automatic compliance credit requires reaching the final course block'
        using errcode = 'check_violation';
    end if;

    if exists (
      select 1
      from public.course_blocks cb
      where cb.course_version_id = new.course_version_id
        and cb.block_type = 'quiz'
        and not exists (
          select 1
          from public.quizzes qz
          join public.quiz_attempts qa on qa.quiz_id = qz.id
          where qz.course_block_id = cb.id
            and qa.assignment_id = new.id
            and qa.passed = true
        )
    ) then
      raise exception 'automatic compliance credit requires a passing attempt for every quiz'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.course_completion_credits (
    course_assignment_id,
    course_id,
    course_version_id,
    organization_id,
    facility_id,
    employee_id,
    training_type_id,
    topic_code,
    credit_hours,
    training_year,
    citation_note,
    credited_at,
    credited_by_profile_id,
    evidence_mode
  )
  select
    new.id,
    new.course_id,
    new.course_version_id,
    new.organization_id,
    new.facility_id,
    new.employee_id,
    cc.training_type_id,
    cc.topic_code,
    cc.credit_hours,
    extract(year from (new.completion_recorded_at at time zone 'America/New_York'))::integer,
    cc.citation_note,
    new.completion_recorded_at,
    auth.uid(),
    'course_completion'
  from public.course_compliance_credits cc
  join public.training_types tt on tt.id = cc.training_type_id
  join public.facilities f on f.id = new.facility_id
  where cc.course_id = new.course_id
    and cc.course_version_id = new.course_version_id
    and cc.is_active
    and cc.credit_mode = 'automatic'
    and tt.is_active
    and tt.state = coalesce(f.state, 'PA')
    and (tt.organization_id is null or tt.organization_id = new.organization_id)
    and (
      tt.applies_to_facility_type = 'BOTH'
      or tt.applies_to_facility_type = f.facility_type
    )
  on conflict (course_assignment_id, training_type_id, topic_code) do nothing;

  return new;
end;
$function$;

revoke all on function public.record_course_completion_credits()
  from public, anon, authenticated;

create trigger record_course_completion_credits
  after update on public.course_assignments
  for each row execute function public.record_course_completion_credits();

-- A recurring course reuses an open assignment, but a completed assignment may be followed by a
-- fresh assignment once the configured renewal interval has elapsed. Canceled lifecycle work is
-- also replaceable. The advisory lock preserves double-click/retry idempotency.
create or replace function public.self_enroll_course(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_employee public.employees;
  v_course public.courses;
  v_version_status text;
  v_version_ai_generated boolean;
  v_version_ai_reviewed_at timestamptz;
  v_assignment public.course_assignments;
  v_assignment_id uuid;
  v_pa_today date := (now() at time zone 'America/New_York')::date;
  v_self_service_renewal_window_days constant integer := 30;
begin
  if auth.uid() is null or public.current_role() is null then
    raise exception 'an active authenticated profile is required'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_employee from public.employees where profile_id = auth.uid();
  if not found then
    perform public.ensure_employee_record(auth.uid());
    select * into v_employee from public.employees where profile_id = auth.uid();
    if not found then
      raise exception 'no employee record for current user' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Administrative/auditor profiles are deliberately provisioned as inactive
  -- pseudo-employees by ensure_employee_record() so their own learning never
  -- pollutes workforce-compliance denominators. They may still take training.
  -- A real employee who is inactive, or anyone marked terminated, stays blocked;
  -- on-leave employees may complete assigned learning.
  if v_employee.status = 'terminated'
     or (v_employee.status = 'inactive' and public.current_role() = 'employee') then
    raise exception 'inactive or terminated employees may not self-enroll in courses'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_course from public.courses where id = p_course_id;
  if not found or v_course.status <> 'published' or v_course.current_version_id is null then
    raise exception 'course is not available to enroll in' using errcode = 'invalid_parameter_value';
  end if;

  if v_course.organization_id is not null
     and v_course.organization_id <> v_employee.organization_id then
    raise exception 'course is not available to enroll in' using errcode = 'invalid_parameter_value';
  end if;

  select status, ai_generated, ai_reviewed_at
    into v_version_status, v_version_ai_generated, v_version_ai_reviewed_at
  from public.course_versions
  where id = v_course.current_version_id;

  if v_version_status is distinct from 'published'
     or (v_version_ai_generated and v_version_ai_reviewed_at is null) then
    raise exception 'course is not available to enroll in' using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_employee.id::text || ':' || p_course_id::text, 0)
  );

  select * into v_assignment
  from public.course_assignments
  where employee_id = v_employee.id
    and course_id = p_course_id
    and status in ('assigned', 'in_progress', 'overdue', 'paused')
  order by assigned_at desc
  limit 1;

  if found then
    return v_assignment.id;
  end if;

  select * into v_assignment
  from public.course_assignments
  where employee_id = v_employee.id
    and course_id = p_course_id
    and status = 'completed'
  order by completion_recorded_at desc, assigned_at desc
  limit 1;

  if found
     and (
       v_course.recurrence_interval_days is null
       or v_assignment.completion_recorded_at is null
       or ((v_assignment.completion_recorded_at at time zone 'America/New_York')::date
           + greatest(
               v_course.recurrence_interval_days - v_self_service_renewal_window_days,
               1
             )) > v_pa_today
     ) then
    return v_assignment.id;
  end if;

  insert into public.course_assignments (
    organization_id,
    facility_id,
    employee_id,
    course_id,
    course_version_id,
    assigned_by
  ) values (
    v_employee.organization_id,
    v_employee.facility_id,
    v_employee.id,
    p_course_id,
    v_course.current_version_id,
    auth.uid()
  )
  returning id into v_assignment_id;

  return v_assignment_id;
end;
$function$;

revoke all on function public.self_enroll_course(uuid) from public, anon;
grant execute on function public.self_enroll_course(uuid) to authenticated;

-- Add assignment-specific course credit to the existing annual rollup, tighten legacy training
-- record contributions to the learner's state/facility type, and apply the six-hour supervised
-- OJT allowance only to PCH general annual hours (55 Pa. Code Section 2600.65(e)(2)).
create or replace function public.recalculate_compliance_core(p_organization_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_pa_today date := (now() at time zone 'America/New_York')::date;
begin
  update public.employee_training_records r
  set
    due_date = case
      when r.completion_date is null or tt.renewal_interval_days is null then null
      else r.completion_date + tt.renewal_interval_days
    end,
    status = case
      when r.status in ('not_applicable','pending_review') then r.status
      when r.completion_date is null then 'missing'
      when tt.renewal_interval_days is null then 'compliant'
      when (r.completion_date + tt.renewal_interval_days) < v_pa_today then 'expired'
      when (r.completion_date + tt.renewal_interval_days) <= v_pa_today + tt.warning_days_default then 'due_soon'
      else 'compliant'
    end
  from public.training_types tt
  where r.training_type_id = tt.id
    and (p_organization_id is null or r.organization_id = p_organization_id);

  update public.practicums p
  set status = case
    when p.due_date is null then 'missing'
    when p.due_date < v_pa_today then 'expired'
    when p.due_date <= v_pa_today + p.reminder_days then 'due_soon'
    else 'compliant'
  end
  where (p_organization_id is null or p.organization_id = p_organization_id);

  with computed as (
    select
      r.id as training_record_id,
      r.organization_id,
      r.facility_id,
      r.employee_id,
      case
        when r.status = 'expired' then 'overdue'
        when r.due_date <= v_pa_today + 7 then 'due_7'
        when r.due_date <= v_pa_today + 14 then 'due_14'
        when r.due_date <= v_pa_today + 30 then 'due_30'
        when r.due_date <= v_pa_today + 60 then 'due_60'
        else 'due_90'
      end as computed_alert_type,
      case when r.status = 'expired' then 'critical' else 'warning' end as computed_severity,
      tt.name || ' -- ' || e.first_name || ' ' || e.last_name as computed_title,
      case when r.status = 'expired'
        then tt.name || ' has expired for ' || e.first_name || ' ' || e.last_name
        else tt.name || ' is due soon for ' || e.first_name || ' ' || e.last_name
      end as computed_message
    from public.employee_training_records r
    join public.training_types tt on tt.id = r.training_type_id
    join public.employees e on e.id = r.employee_id
    where r.status in ('due_soon','expired')
      and (p_organization_id is null or r.organization_id = p_organization_id)
  ),
  alert_rank as (
    select unnest(array['due_90','due_60','due_30','due_14','due_7','overdue']) as alert_type,
           unnest(array[0,1,2,3,4,5]) as rank
  ),
  to_escalate as (
    select a.id as alert_id,
           c.computed_alert_type,
           c.computed_severity,
           c.computed_title,
           c.computed_message
    from computed c
    join public.alerts a
      on a.training_record_id = c.training_record_id and a.status = 'open'
    join alert_rank new_rank on new_rank.alert_type = c.computed_alert_type
    join alert_rank old_rank on old_rank.alert_type = a.alert_type
    where new_rank.rank > old_rank.rank
  ),
  escalations as (
    update public.alerts a
    set alert_type = te.computed_alert_type,
        severity = te.computed_severity,
        title = te.computed_title,
        message = te.computed_message
    from to_escalate te
    where a.id = te.alert_id
    returning a.training_record_id
  )
  insert into public.alerts (
    organization_id,
    facility_id,
    employee_id,
    training_record_id,
    alert_type,
    title,
    message,
    severity
  )
  select
    c.organization_id,
    c.facility_id,
    c.employee_id,
    c.training_record_id,
    c.computed_alert_type,
    c.computed_title,
    c.computed_message,
    c.computed_severity
  from computed c
  where not exists (
    select 1
    from public.alerts a
    where a.training_record_id = c.training_record_id and a.status = 'open'
  );

  -- Remove a current-year bucket when no applicable baseline training type remains confirmed.
  -- For a regulated bucket, an applicable system type is always the baseline: an organization-
  -- specific type may contribute additional earned hours, but it cannot replace, weaken, or
  -- materialize the denominator while the mandatory system audience still awaits confirmation.
  delete from public.employee_training_hour_buckets b
  using public.employees e, public.facilities f
  where b.employee_id = e.id
    and f.id = e.facility_id
    and b.training_year = extract(year from v_pa_today)::integer
    and (p_organization_id is null or b.organization_id = p_organization_id)
    and not exists (
      select 1
      from public.training_types tt
      where tt.hour_bucket = b.bucket_type
        and tt.is_active
        and tt.state = coalesce(f.state, 'PA')
        and (tt.applies_to_facility_type = f.facility_type or tt.applies_to_facility_type = 'BOTH')
        and (tt.organization_id is null or tt.organization_id = e.organization_id)
        and coalesce(tt.required_hours, 0) > 0
        and (
          tt.organization_id is null
          or not exists (
            select 1
            from public.training_types system_tt
            where system_tt.organization_id is null
              and system_tt.hour_bucket = b.bucket_type
              and system_tt.is_active
              and system_tt.state = coalesce(f.state, 'PA')
              and (
                system_tt.applies_to_facility_type = f.facility_type
                or system_tt.applies_to_facility_type = 'BOTH'
              )
              and coalesce(system_tt.required_hours, 0) > 0
          )
        )
        and (
          not tt.audience_verification_required
          or public.current_training_audience_status(e.id, tt.id)
               not in ('pending_review', 'not_applicable')
        )
    );

  with bucket_years as (
    select extract(year from v_pa_today)::integer as training_year
  ),
  employee_bucket_candidates as (
    select
      e.id as employee_id,
      e.organization_id,
      e.facility_id,
      f.facility_type,
      coalesce(f.state, 'PA') as facility_state,
      bt.bucket_type
    from public.employees e
    join public.facilities f on f.id = e.facility_id
    cross join (values ('general_annual'), ('alr_dementia'), ('sdcu_dementia')) as bt(bucket_type)
    where e.status = 'active'
      and (p_organization_id is null or e.organization_id = p_organization_id)
  ),
  applicable_types as (
    select distinct on (ebc.employee_id, ebc.bucket_type)
      ebc.employee_id,
      ebc.organization_id,
      ebc.facility_id,
      ebc.facility_type,
      ebc.facility_state,
      ebc.bucket_type,
      tt.id as training_type_id,
      tt.required_hours
    from employee_bucket_candidates ebc
    join public.training_types tt
      on tt.hour_bucket = ebc.bucket_type
     and tt.is_active
     and tt.state = ebc.facility_state
     and (tt.applies_to_facility_type = ebc.facility_type or tt.applies_to_facility_type = 'BOTH')
     and (tt.organization_id is null or tt.organization_id = ebc.organization_id)
     and coalesce(tt.required_hours, 0) > 0
     and (
       tt.organization_id is null
       or not exists (
         select 1
         from public.training_types system_tt
         where system_tt.organization_id is null
           and system_tt.hour_bucket = ebc.bucket_type
           and system_tt.is_active
           and system_tt.state = ebc.facility_state
           and (
             system_tt.applies_to_facility_type = ebc.facility_type
             or system_tt.applies_to_facility_type = 'BOTH'
           )
           and coalesce(system_tt.required_hours, 0) > 0
       )
     )
     and (
       not tt.audience_verification_required
       or public.current_training_audience_status(ebc.employee_id, tt.id)
            not in ('pending_review', 'not_applicable')
     )
    order by
      ebc.employee_id,
      ebc.bucket_type,
      (tt.organization_id is null) desc,
      tt.required_hours desc,
      tt.created_at,
      tt.id
  ),
  creditable_types as (
    -- Regulatory evidence stays isolated to the selected exact system type. Organization-specific
    -- types in the same bucket may add earned hours, but never supply or lower the denominator.
    select
      at.employee_id,
      at.bucket_type,
      at.training_type_id
    from applicable_types at
    union
    select
      at.employee_id,
      at.bucket_type,
      custom_tt.id as training_type_id
    from applicable_types at
    join public.training_types custom_tt
      on custom_tt.organization_id = at.organization_id
     and custom_tt.hour_bucket = at.bucket_type
     and custom_tt.is_active
     and custom_tt.state = at.facility_state
     and (
       custom_tt.applies_to_facility_type = at.facility_type
       or custom_tt.applies_to_facility_type = 'BOTH'
     )
     and (
       not custom_tt.audience_verification_required
       or public.current_training_audience_status(at.employee_id, custom_tt.id)
            not in ('pending_review', 'not_applicable')
     )
  ),
  legacy_earned as (
    select
      ct.employee_id,
      ct.bucket_type,
      sum(case when r.completion_method is distinct from 'on_the_job' then coalesce(r.hours, 0) else 0 end) as non_ojt_hours,
      sum(case when r.completion_method = 'on_the_job' then coalesce(r.hours, 0) else 0 end) as ojt_hours_raw
    from creditable_types ct
    join public.employee_training_records r
      on r.employee_id = ct.employee_id
     and r.training_type_id = ct.training_type_id
     and r.status not in ('pending_review', 'not_applicable')
     and r.completion_date is not null
     and extract(year from r.completion_date)::integer = (select training_year from bucket_years)
    group by ct.employee_id, ct.bucket_type
  ),
  course_earned as (
    select
      ct.employee_id,
      ct.bucket_type,
      sum(cc.credit_hours) as course_hours
    from creditable_types ct
    join public.course_completion_credits cc
      on cc.employee_id = ct.employee_id
     and cc.training_type_id = ct.training_type_id
     and cc.training_year = (select training_year from bucket_years)
    group by ct.employee_id, ct.bucket_type
  ),
  earned as (
    select
      at.employee_id,
      at.bucket_type,
      coalesce(le.non_ojt_hours, 0) as non_ojt_hours,
      coalesce(le.ojt_hours_raw, 0) as ojt_hours_raw,
      coalesce(ce.course_hours, 0) as course_hours
    from applicable_types at
    left join legacy_earned le
      on le.employee_id = at.employee_id and le.bucket_type = at.bucket_type
    left join course_earned ce
      on ce.employee_id = at.employee_id and ce.bucket_type = at.bucket_type
  )
  insert into public.employee_training_hour_buckets (
    organization_id,
    facility_id,
    employee_id,
    training_year,
    bucket_type,
    required_hours,
    completed_hours,
    ojt_hours,
    status
  )
  select
    at.organization_id,
    at.facility_id,
    at.employee_id,
    (select training_year from bucket_years),
    at.bucket_type,
    at.required_hours,
    e.non_ojt_hours
      + e.course_hours
      + least(
          e.ojt_hours_raw,
          case
            when at.bucket_type = 'general_annual' and at.facility_type = 'PCH' then 6
            else 0
          end
        ),
    e.ojt_hours_raw,
    case
      when e.non_ojt_hours
             + e.course_hours
             + least(
                 e.ojt_hours_raw,
                 case
                   when at.bucket_type = 'general_annual' and at.facility_type = 'PCH' then 6
                   else 0
                 end
               ) >= at.required_hours
        then 'compliant'
      when (make_date((select training_year from bucket_years), 12, 31) - v_pa_today) <= 90
        then 'due_soon'
      else 'incomplete'
    end
  from applicable_types at
  join earned e on e.employee_id = at.employee_id and e.bucket_type = at.bucket_type
  on conflict (employee_id, training_year, bucket_type) do update set
    organization_id = excluded.organization_id,
    facility_id = excluded.facility_id,
    required_hours = excluded.required_hours,
    completed_hours = excluded.completed_hours,
    ojt_hours = excluded.ojt_hours,
    status = excluded.status;
end;
$function$;

revoke all on function public.recalculate_compliance_core(uuid)
  from public, anon, authenticated;

-- Phase 2.2-2.3: effective workforce lifecycle and governed compliance profiles.
--
-- The existing employees row remains the compatibility projection. Person
-- identity, employment episodes, suspensions, and evidence are additive and
-- effective-dated; lifecycle fields on employees become transition-RPC owned.

create table public.workforce_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete restrict,
  external_ref text,
  first_name text not null check (length(trim(first_name)) between 1 and 120),
  last_name text not null check (length(trim(last_name)) between 1 and 120),
  email text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index workforce_people_profile_uidx
  on public.workforce_people(profile_id) where profile_id is not null;
create unique index workforce_people_external_ref_uidx
  on public.workforce_people(organization_id, external_ref)
  where external_ref is not null;
create index workforce_people_org_idx
  on public.workforce_people(organization_id, is_active);
create trigger set_updated_at before update on public.workforce_people
for each row execute function public.set_updated_at();

create table public.workforce_employee_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  person_id uuid not null references public.workforce_people(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  source text not null default 'manual'
    check (source in ('manual', 'legacy_shadow_backfill', 'import', 'scim', 'api')),
  created_at timestamptz not null default now(),
  constraint workforce_employee_link_window_check
    check (effective_to is null or effective_to >= effective_from)
);

create index workforce_employee_links_employee_idx
  on public.workforce_employee_links(employee_id, effective_from, effective_to);
create index workforce_employee_links_person_idx
  on public.workforce_employee_links(person_id, effective_from, effective_to);
create unique index workforce_employee_links_current_employee_uidx
  on public.workforce_employee_links(employee_id) where effective_to is null;
create unique index workforce_employee_links_current_person_uidx
  on public.workforce_employee_links(person_id) where effective_to is null;

create table public.employment_episodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  person_id uuid not null references public.workforce_people(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  started_on date not null,
  ended_on date,
  episode_status text not null default 'active'
    check (episode_status in ('active', 'closed')),
  start_reason text not null default 'hire',
  end_reason text,
  previous_episode_id uuid references public.employment_episodes(id) on delete restrict,
  source text not null default 'manual'
    check (source in ('manual', 'legacy_shadow_backfill', 'import', 'scim', 'api')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employment_episode_window_check check (
    (episode_status = 'active' and ended_on is null and end_reason is null)
    or (episode_status = 'closed' and ended_on is not null
      and ended_on >= started_on and length(trim(end_reason)) > 0)
  )
);

create unique index employment_episodes_active_employee_uidx
  on public.employment_episodes(employee_id) where episode_status = 'active';
create index employment_episodes_employee_history_idx
  on public.employment_episodes(employee_id, started_on desc);
create index employment_episodes_scope_idx
  on public.employment_episodes(organization_id, facility_id, episode_status);
create trigger set_updated_at before update on public.employment_episodes
for each row execute function public.set_updated_at();

create table public.employment_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  person_id uuid not null references public.workforce_people(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  employment_episode_id uuid references public.employment_episodes(id) on delete restrict,
  event_type text not null check (event_type in (
    'legacy_backfill', 'hired', 'rehired', 'transferred', 'leave_started', 'leave_ended',
    'terminated', 'access_suspended', 'access_restored'
  )),
  from_status text,
  to_status text,
  effective_on date not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  correlation_id text not null default gen_random_uuid()::text,
  created_at timestamptz not null default now()
);

create index employment_lifecycle_events_employee_idx
  on public.employment_lifecycle_events(employee_id, effective_on desc, created_at desc);
create index employment_lifecycle_events_scope_idx
  on public.employment_lifecycle_events(organization_id, facility_id, created_at desc);
create unique index employment_lifecycle_events_correlation_uidx
  on public.employment_lifecycle_events(correlation_id);

-- Lifecycle disposition policy v1:
--   * leave pauses active course/roster work and calls off future shifts;
--   * return resumes only work paused by the lifecycle policy (shifts stay
--     called off because a replacement may already have been scheduled);
--   * transfer preserves active courses at the target facility, removes future
--     old-facility rosters, and calls off old-facility shifts;
--   * termination cancels incomplete courses and future roster/shift work;
--   * access-only suspension changes authentication, not work commitments.
alter table public.course_assignments
  drop constraint course_assignments_status_check;
alter table public.course_assignments
  add constraint course_assignments_status_check check (
    status in ('assigned', 'in_progress', 'completed', 'overdue', 'paused', 'canceled')
  ),
  add column lifecycle_previous_status text,
  add column lifecycle_disposition text,
  add column lifecycle_event_id uuid
    references public.employment_lifecycle_events(id) on delete restrict,
  add column canceled_at timestamptz,
  add column cancellation_reason text,
  add constraint course_assignment_lifecycle_previous_status_check check (
    lifecycle_previous_status is null
    or lifecycle_previous_status in ('assigned', 'in_progress', 'overdue', 'paused')
  ),
  add constraint course_assignment_lifecycle_disposition_check check (
    lifecycle_disposition is null
    or lifecycle_disposition in ('leave', 'termination')
  ),
  add constraint course_assignment_cancellation_check check (
    (status = 'canceled' and canceled_at is not null
      and nullif(trim(cancellation_reason), '') is not null)
    or (status <> 'canceled' and canceled_at is null and cancellation_reason is null)
  );

alter table public.training_class_attendees
  add column lifecycle_disposition text not null default 'active'
    check (lifecycle_disposition in ('active', 'paused', 'removed')),
  add column lifecycle_event_id uuid
    references public.employment_lifecycle_events(id) on delete restrict,
  add column lifecycle_reason text,
  add column lifecycle_dispositioned_at timestamptz;

alter table public.notifications
  drop constraint notifications_notification_type_check;
alter table public.notifications
  add constraint notifications_notification_type_check check (notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued',
    'training_due_soon', 'training_expired', 'competency_recorded',
    'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
    'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
    'support_ticket_update', 'workforce_lifecycle_changed'
  ));

create table public.employment_lifecycle_dispositions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_id uuid references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  lifecycle_event_id uuid not null
    references public.employment_lifecycle_events(id) on delete restrict,
  target_type text not null check (target_type in (
    'shift_assignment', 'schedule', 'course_assignment', 'training_class_attendee'
  )),
  target_id uuid not null,
  disposition_action text not null check (disposition_action in (
    'called_off', 'schedule_roster_changed', 'paused', 'resumed',
    'canceled', 'transferred', 'removed'
  )),
  prior_state jsonb not null,
  resulting_state jsonb not null,
  policy_version text not null default '2026-07-11.workforce-lifecycle.v1',
  created_at timestamptz not null default now(),
  unique (lifecycle_event_id, target_type, target_id, disposition_action)
);

create index employment_lifecycle_dispositions_employee_idx
  on public.employment_lifecycle_dispositions(employee_id, created_at desc);
create index employment_lifecycle_dispositions_event_idx
  on public.employment_lifecycle_dispositions(lifecycle_event_id);

create table app_private.workforce_lifecycle_integration_outbox (
  event_id uuid primary key
    references public.employment_lifecycle_events(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_type text not null default 'workforce.employee.lifecycle.changed',
  event_schema_version text not null default '2026-07-11',
  correlation_id text not null unique,
  actor_subject text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

alter table app_private.workforce_lifecycle_integration_outbox enable row level security;
revoke all on table app_private.workforce_lifecycle_integration_outbox
from public, anon, authenticated, service_role;
grant select, insert, update on table app_private.workforce_lifecycle_integration_outbox
to service_role;

create table public.employee_access_suspensions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  suspension_type text not null
    check (suspension_type in ('manual', 'leave', 'termination', 'compliance_hold')),
  effective_from timestamptz not null,
  effective_to timestamptz,
  reason text not null check (length(trim(reason)) > 0),
  profile_was_active boolean not null,
  created_by_event_id uuid not null
    references public.employment_lifecycle_events(id) on delete restrict,
  released_by_event_id uuid
    references public.employment_lifecycle_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint employee_access_suspension_window_check check (
    effective_to is null or effective_to > effective_from
  ),
  constraint employee_access_suspension_release_check check (
    (effective_to is null and released_by_event_id is null)
    or (effective_to is not null and released_by_event_id is not null)
  )
);

create index employee_access_suspensions_employee_idx
  on public.employee_access_suspensions(employee_id, effective_from, effective_to);
create unique index employee_access_suspensions_open_type_uidx
  on public.employee_access_suspensions(employee_id, suspension_type)
  where effective_to is null;

create table public.workforce_backfill_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  exception_code text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint workforce_backfill_exception_resolution_check check (
    (status = 'open' and resolved_at is null)
    or (status in ('resolved', 'ignored') and resolved_at is not null)
  )
);

create unique index workforce_backfill_exception_open_uidx
  on public.workforce_backfill_exceptions(employee_id, exception_code)
  where status = 'open';

create table public.compliance_profile_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_.-]{2,95}$'),
  version integer not null default 1 check (version > 0),
  name text not null check (length(trim(name)) between 1 and 180),
  description text not null default '',
  profile_kind text not null default 'primary'
    check (profile_kind in ('baseline', 'primary', 'extension')),
  is_mandatory_baseline boolean not null default false,
  is_system_managed boolean not null default false,
  is_active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compliance_profile_window_check
    check (effective_to is null or effective_to > effective_from),
  constraint compliance_profile_baseline_shape_check check (
    (is_mandatory_baseline and is_system_managed
      and organization_id is null and profile_kind = 'baseline')
    or (not is_mandatory_baseline and profile_kind <> 'baseline')
  )
);

create unique index compliance_profile_system_code_version_uidx
  on public.compliance_profile_definitions(code, version)
  where organization_id is null;
create unique index compliance_profile_org_code_version_uidx
  on public.compliance_profile_definitions(organization_id, code, version)
  where organization_id is not null;
create unique index compliance_profile_mandatory_baseline_uidx
  on public.compliance_profile_definitions(is_mandatory_baseline)
  where is_mandatory_baseline and is_active;
create trigger set_updated_at before update on public.compliance_profile_definitions
for each row execute function public.set_updated_at();

create table public.compliance_profile_requirements (
  id uuid primary key default gen_random_uuid(),
  profile_definition_id uuid not null
    references public.compliance_profile_definitions(id) on delete restrict,
  requirement_key text not null
    check (requirement_key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  label text not null,
  is_mandatory boolean not null default true,
  minimum_hours numeric not null default 0 check (minimum_hours >= 0),
  renewal_days integer check (renewal_days is null or renewal_days > 0),
  evidence_required boolean not null default true,
  rule jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_definition_id, requirement_key)
);

create index compliance_profile_requirements_key_idx
  on public.compliance_profile_requirements(requirement_key);
create trigger set_updated_at before update on public.compliance_profile_requirements
for each row execute function public.set_updated_at();

create table public.compliance_profile_mapping_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  profile_definition_id uuid not null
    references public.compliance_profile_definitions(id) on delete restrict,
  name text not null,
  priority integer not null default 100,
  facility_type text check (facility_type is null or facility_type in ('PCH', 'ALR')),
  worker_type text check (
    worker_type is null or worker_type in ('regular', 'agency', 'substitute', 'volunteer')
  ),
  job_title_pattern text,
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compliance_profile_mapping_window_check
    check (effective_to is null or effective_to > effective_from),
  constraint compliance_profile_mapping_predicate_check check (
    facility_type is not null or worker_type is not null or job_title_pattern is not null
  )
);

create index compliance_profile_mapping_rules_org_idx
  on public.compliance_profile_mapping_rules(organization_id, is_active, priority);
create trigger set_updated_at before update on public.compliance_profile_mapping_rules
for each row execute function public.set_updated_at();

create table public.employee_compliance_profile_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  profile_definition_id uuid not null
    references public.compliance_profile_definitions(id) on delete restrict,
  effective_from date not null default current_date,
  effective_to date,
  source text not null default 'manual'
    check (source in ('manual', 'legacy_shadow_backfill', 'mapping_rule', 'import', 'scim', 'api')),
  reason text not null default '',
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint employee_compliance_assignment_window_check
    check (effective_to is null or effective_to > effective_from)
);

create index employee_compliance_assignments_employee_idx
  on public.employee_compliance_profile_assignments(
    employee_id, effective_from, effective_to
  );
create unique index employee_compliance_assignments_current_uidx
  on public.employee_compliance_profile_assignments(employee_id, profile_definition_id)
  where effective_to is null;

create table public.compliance_profile_resolution_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  exception_code text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint compliance_resolution_exception_status_check check (
    (status = 'open' and resolved_at is null)
    or (status in ('resolved', 'ignored') and resolved_at is not null)
  )
);

create unique index compliance_resolution_exception_open_uidx
  on public.compliance_profile_resolution_exceptions(employee_id, exception_code)
  where status = 'open';

create or replace function app_private.prevent_immutable_workforce_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'employment lifecycle evidence is append-only'
    using errcode = '55000';
end;
$$;

revoke all on function app_private.prevent_immutable_workforce_evidence_mutation()
from public, anon, authenticated, service_role;

create trigger prevent_employment_lifecycle_event_mutation
before update or delete on public.employment_lifecycle_events
for each row execute function app_private.prevent_immutable_workforce_evidence_mutation();
create trigger prevent_employment_lifecycle_disposition_mutation
before update or delete on public.employment_lifecycle_dispositions
for each row execute function app_private.prevent_immutable_workforce_evidence_mutation();

create or replace function app_private.validate_workforce_employee_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.workforce_people p
    join public.employees e on e.id = new.employee_id
    where p.id = new.person_id
      and p.organization_id = new.organization_id
      and e.organization_id = new.organization_id
  ) then
    raise exception 'person and employee must belong to the link organization'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.workforce_employee_links existing
    where existing.id <> new.id
      and (existing.employee_id = new.employee_id or existing.person_id = new.person_id)
      and daterange(existing.effective_from, existing.effective_to, '[)')
          && daterange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception 'person or employee already has an overlapping workforce link'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_workforce_employee_link()
from public, anon, authenticated, service_role;
create trigger validate_workforce_employee_link
before insert or update on public.workforce_employee_links
for each row execute function app_private.validate_workforce_employee_link();

create or replace function app_private.protect_employee_lifecycle_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.status, old.hire_date, old.termination_date, old.facility_id)
       is distinct from
     (new.status, new.hire_date, new.termination_date, new.facility_id)
     and coalesce(current_setting('app.lifecycle_transition', true), '') <> 'on' then
    raise exception 'employee lifecycle fields must be changed through apply_employee_lifecycle_transition'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.protect_employee_lifecycle_fields()
from public, anon, authenticated, service_role;
create trigger protect_employee_lifecycle_fields
before update on public.employees
for each row execute function app_private.protect_employee_lifecycle_fields();

create or replace function app_private.protect_employment_episode_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'employment episodes are retained evidence and cannot be deleted'
      using errcode = '55000';
  elsif coalesce(current_setting('app.lifecycle_transition', true), '') <> 'on' then
    raise exception 'employment episodes may only be closed by the lifecycle transition RPC'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.protect_employment_episode_mutation()
from public, anon, authenticated, service_role;
create trigger protect_employment_episode_mutation
before update or delete on public.employment_episodes
for each row execute function app_private.protect_employment_episode_mutation();

create or replace function app_private.validate_compliance_profile_mapping_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.compliance_profile_definitions p
    where p.id = new.profile_definition_id
      and (p.organization_id is null or p.organization_id = new.organization_id)
      and p.is_active
  ) then
    raise exception 'compliance profile is inactive or belongs to another organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_compliance_profile_mapping_rule()
from public, anon, authenticated, service_role;
create trigger validate_compliance_profile_mapping_rule
before insert or update on public.compliance_profile_mapping_rules
for each row execute function app_private.validate_compliance_profile_mapping_rule();

create or replace function app_private.validate_employee_compliance_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_profile_kind text;
begin
  select * into v_employee from public.employees where id = new.employee_id;
  if v_employee.id is null then
    raise exception 'employee % not found', new.employee_id using errcode = '23503';
  end if;

  new.organization_id := v_employee.organization_id;
  new.facility_id := v_employee.facility_id;

  if not exists (
    select 1 from public.compliance_profile_definitions p
    where p.id = new.profile_definition_id
      and p.is_active
      and (p.organization_id is null or p.organization_id = v_employee.organization_id)
  ) then
    raise exception 'compliance profile is inactive or belongs to another organization'
      using errcode = '23514';
  end if;

  select p.profile_kind into v_profile_kind
  from public.compliance_profile_definitions p
  where p.id = new.profile_definition_id;

  if exists (
    select 1 from public.employee_compliance_profile_assignments existing
    where existing.id <> new.id
      and existing.employee_id = new.employee_id
      and existing.profile_definition_id = new.profile_definition_id
      and daterange(existing.effective_from, existing.effective_to, '[)')
          && daterange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception 'employee already has this compliance profile in the requested window'
      using errcode = '23P01';
  end if;

  if v_profile_kind = 'primary' and exists (
    select 1
    from public.employee_compliance_profile_assignments existing
    join public.compliance_profile_definitions existing_profile
      on existing_profile.id = existing.profile_definition_id
    where existing.id <> new.id
      and existing.employee_id = new.employee_id
      and existing_profile.profile_kind = 'primary'
      and daterange(existing.effective_from, existing.effective_to, '[)')
          && daterange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception 'employee already has a primary compliance profile in this window'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_employee_compliance_assignment()
from public, anon, authenticated, service_role;
create trigger validate_employee_compliance_assignment
before insert or update on public.employee_compliance_profile_assignments
for each row execute function app_private.validate_employee_compliance_assignment();

-- The mandatory baseline is always part of resolution. Organization profiles
-- may strengthen it but cannot lower hours, lengthen renewal, remove mandatory
-- status, or remove evidence from a requirement with the same key.
insert into public.compliance_profile_definitions(
  code, version, name, description, profile_kind,
  is_mandatory_baseline, is_system_managed
) values (
  'mandatory-baseline', 1, 'Mandatory workforce baseline',
  'Minimum evidence and screening controls applied to every active employee',
  'baseline', true, true
);

insert into public.compliance_profile_requirements(
  profile_definition_id, requirement_key, label, is_mandatory,
  minimum_hours, renewal_days, evidence_required, rule
)
select p.id, v.requirement_key, v.label, true,
  v.minimum_hours, v.renewal_days, true, v.rule
from public.compliance_profile_definitions p
cross join (values
  ('workforce.identity', 'Verified workforce identity', 0::numeric, null::integer,
    '{"evidenceType":"identity-verification"}'::jsonb),
  ('workforce.background_screening', 'Background and exclusion screening', 0::numeric, 365,
    '{"evidenceType":"screening-result"}'::jsonb),
  ('workforce.orientation', 'Documented role and facility orientation', 1::numeric, null::integer,
    '{"evidenceType":"completion-record"}'::jsonb)
) v(requirement_key, label, minimum_hours, renewal_days, rule)
where p.code = 'mandatory-baseline' and p.is_mandatory_baseline;

create or replace function app_private.enforce_compliance_requirement_baseline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_baseline boolean;
  v_floor record;
begin
  if tg_op = 'DELETE' then
    select p.is_mandatory_baseline into v_is_baseline
    from public.compliance_profile_definitions p
    where p.id = old.profile_definition_id;
    if v_is_baseline then
      raise exception 'mandatory baseline requirements cannot be deleted'
        using errcode = '42501';
    end if;
    return old;
  end if;

  select p.is_mandatory_baseline into v_is_baseline
  from public.compliance_profile_definitions p
  where p.id = new.profile_definition_id;

  if v_is_baseline and tg_op = 'UPDATE' then
    if (old.is_mandatory and not new.is_mandatory)
       or new.minimum_hours < old.minimum_hours
       or (old.renewal_days is not null
           and (new.renewal_days is null or new.renewal_days > old.renewal_days))
       or (old.evidence_required and not new.evidence_required) then
      raise exception 'mandatory baseline requirements may only be strengthened'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select
    r.is_mandatory,
    r.minimum_hours,
    r.renewal_days,
    r.evidence_required
  into v_floor
  from public.compliance_profile_requirements r
  join public.compliance_profile_definitions p
    on p.id = r.profile_definition_id
  where p.is_mandatory_baseline and p.is_active
    and r.requirement_key = new.requirement_key;

  if found and (
    (v_floor.is_mandatory and not new.is_mandatory)
    or new.minimum_hours < v_floor.minimum_hours
    or (v_floor.renewal_days is not null
        and (new.renewal_days is null or new.renewal_days > v_floor.renewal_days))
    or (v_floor.evidence_required and not new.evidence_required)
  ) then
    raise exception 'requirement % weakens the mandatory baseline', new.requirement_key
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_compliance_requirement_baseline()
from public, anon, authenticated, service_role;
create trigger enforce_compliance_requirement_baseline
before insert or update or delete on public.compliance_profile_requirements
for each row execute function app_private.enforce_compliance_requirement_baseline();

create or replace function app_private.protect_mandatory_compliance_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_mandatory_baseline and (
    tg_op = 'DELETE'
    or not new.is_mandatory_baseline
    or not new.is_active
    or new.organization_id is not null
  ) then
    raise exception 'mandatory baseline profile cannot be removed or disabled'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function app_private.protect_mandatory_compliance_profile()
from public, anon, authenticated, service_role;
create trigger protect_mandatory_compliance_profile
before update or delete on public.compliance_profile_definitions
for each row execute function app_private.protect_mandatory_compliance_profile();

-- Legacy shadow backfill. Every employee gets a durable person identity and
-- link. Missing/contradictory dates remain visible in the exception queue.
insert into public.workforce_people(
  organization_id, profile_id, external_ref,
  first_name, last_name, email, phone, is_active
)
select e.organization_id, e.profile_id, 'legacy-employee:' || e.id::text,
  e.first_name, e.last_name, e.email, e.phone, e.status <> 'terminated'
from public.employees e;

insert into public.workforce_employee_links(
  organization_id, person_id, employee_id, effective_from, effective_to, source
)
select e.organization_id, p.id, e.id,
  coalesce(e.hire_date, e.created_at::date),
  case when e.status = 'terminated' then e.termination_date else null end,
  'legacy_shadow_backfill'
from public.employees e
join public.workforce_people p
  on p.external_ref = 'legacy-employee:' || e.id::text
where e.status <> 'terminated'
   or e.termination_date is null
   or e.termination_date >= coalesce(e.hire_date, e.created_at::date);

insert into public.employment_episodes(
  organization_id, facility_id, person_id, employee_id,
  started_on, ended_on, episode_status, start_reason, end_reason, source
)
select e.organization_id, e.facility_id, p.id, e.id,
  coalesce(e.hire_date, e.created_at::date),
  case when e.status = 'terminated' then e.termination_date else null end,
  case when e.status = 'terminated' then 'closed' else 'active' end,
  'legacy_hire',
  case when e.status = 'terminated' then 'legacy_termination' else null end,
  'legacy_shadow_backfill'
from public.employees e
join public.workforce_people p
  on p.external_ref = 'legacy-employee:' || e.id::text
where e.status in ('active', 'on_leave')
   or (e.status = 'terminated' and e.termination_date is not null
       and e.termination_date >= coalesce(e.hire_date, e.created_at::date));

insert into public.employment_lifecycle_events(
  organization_id, facility_id, person_id, employee_id,
  employment_episode_id, event_type, from_status, to_status,
  effective_on, reason, evidence
)
select e.organization_id, e.facility_id, p.id, e.id, ep.id,
  'legacy_backfill', null, e.status,
  coalesce(e.hire_date, e.created_at::date),
  'Phase 2 legacy workforce shadow backfill',
  jsonb_build_object(
    'legacyHireDate', e.hire_date,
    'legacyTerminationDate', e.termination_date,
    'legacyStatus', e.status
  )
from public.employees e
join public.workforce_people p
  on p.external_ref = 'legacy-employee:' || e.id::text
left join public.employment_episodes ep on ep.employee_id = e.id;

insert into public.workforce_backfill_exceptions(
  organization_id, employee_id, exception_code, details
)
select e.organization_id, e.id, 'missing_hire_date',
  jsonb_build_object('status', e.status, 'fallbackDate', e.created_at::date)
from public.employees e
where e.status = 'active' and e.hire_date is null
on conflict do nothing;

insert into public.workforce_backfill_exceptions(
  organization_id, employee_id, exception_code, details
)
select e.organization_id, e.id, 'invalid_employment_window',
  jsonb_build_object('hireDate', e.hire_date, 'terminationDate', e.termination_date)
from public.employees e
where e.status = 'terminated'
  and (e.termination_date is null
       or e.termination_date < coalesce(e.hire_date, e.created_at::date))
on conflict do nothing;

insert into public.employee_compliance_profile_assignments(
  organization_id, facility_id, employee_id, profile_definition_id,
  effective_from, source, reason
)
select e.organization_id, e.facility_id, e.id, p.id,
  coalesce(e.hire_date, e.created_at::date),
  'legacy_shadow_backfill', 'Mandatory baseline assigned during Phase 2 backfill'
from public.employees e
cross join public.compliance_profile_definitions p
where e.status = 'active' and p.is_mandatory_baseline and p.is_active;

-- Existing inactive employment/access states are projected into explicit
-- suspensions. The historical lifecycle event becomes the immutable cause.
insert into public.employee_access_suspensions(
  organization_id, facility_id, employee_id, profile_id, suspension_type,
  effective_from, reason, profile_was_active, created_by_event_id
)
select e.organization_id, e.facility_id, e.id, e.profile_id,
  case when e.status = 'terminated' then 'termination'
       when e.status = 'on_leave' then 'leave'
       else 'manual' end,
  coalesce(e.termination_date::timestamptz, e.updated_at),
  'Legacy ' || e.status || ' state projected into access suspension',
  p.is_active, event.id
from public.employees e
join public.profiles p on p.id = e.profile_id
join lateral (
  select le.id from public.employment_lifecycle_events le
  where le.employee_id = e.id order by le.created_at desc limit 1
) event on true
where e.status in ('terminated', 'on_leave', 'inactive');

select set_config('app.privileged_write', 'on', true);
update public.profiles p
set is_active = false
where p.is_active and exists (
  select 1 from public.employee_access_suspensions s
  where s.profile_id = p.id and s.effective_to is null
);
select set_config('app.privileged_write', '', true);

create or replace function app_private.align_profile_facility_scope(
  p_profile_id uuid,
  p_source_facility_id uuid,
  p_target_facility_id uuid,
  p_effective_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_membership_id uuid;
  v_template_id uuid;
  v_effective_at timestamptz := greatest(now(), p_effective_on::timestamptz);
begin
  select * into v_profile from public.profiles where id = p_profile_id;
  if v_profile.id is null
     or v_profile.role not in ('facility_manager', 'trainer') then
    return;
  end if;
  if not exists (
    select 1 from public.facilities f
    where f.id = p_target_facility_id
      and f.organization_id = v_profile.organization_id
      and f.is_active
  ) then
    raise exception 'target facility is outside the profile organization or inactive'
      using errcode = '23514';
  end if;

  if p_source_facility_id is not null
     and p_source_facility_id is distinct from p_target_facility_id then
    delete from public.facility_assignments
    where profile_id = p_profile_id and facility_id = p_source_facility_id;

    for v_membership_id in
      select m.id
      from public.enterprise_scope_memberships m
      where m.profile_id = p_profile_id
        and m.scope_type = 'facility'
        and m.facility_id = p_source_facility_id
        and m.effective_to is null
    loop
      update public.enterprise_access_grants
      set effective_to = greatest(v_effective_at, effective_from),
          reason = case when reason = '' then 'Ended by workforce facility transfer'
                        else reason || '; ended by workforce facility transfer' end
      where membership_id = v_membership_id and effective_to is null;
      update public.enterprise_scope_memberships
      set effective_to = greatest(v_effective_at, effective_from),
          reason = case when reason is null then 'Ended by workforce facility transfer'
                        else reason || '; ended by workforce facility transfer' end
      where id = v_membership_id;
    end loop;
  end if;

  insert into public.facility_assignments(profile_id, facility_id)
  values (p_profile_id, p_target_facility_id)
  on conflict (profile_id, facility_id) do nothing;

  select m.id into v_membership_id
  from public.enterprise_scope_memberships m
  where m.profile_id = p_profile_id
    and m.scope_type = 'facility'
    and m.facility_id = p_target_facility_id
    and m.effective_to is null
  order by m.effective_from desc limit 1;

  if v_membership_id is null then
    insert into public.enterprise_scope_memberships(
      profile_id, scope_type, facility_id, effective_from,
      source, legacy_role, reason
    ) values (
      p_profile_id, 'facility', p_target_facility_id, v_effective_at,
      'api', v_profile.role, 'Aligned with workforce facility lifecycle'
    ) returning id into v_membership_id;
  end if;

  select id into v_template_id
  from public.role_templates where built_in_role = v_profile.role and is_active;
  if v_template_id is not null and not exists (
    select 1 from public.enterprise_access_grants g
    where g.membership_id = v_membership_id
      and g.role_template_id = v_template_id
      and g.effective_to is null
  ) then
    insert into public.enterprise_access_grants(
      membership_id, role_template_id, effective_from, source, reason
    ) values (
      v_membership_id, v_template_id, v_effective_at, 'api',
      'Aligned with workforce facility lifecycle'
    );
  end if;
end;
$$;

revoke all on function app_private.align_profile_facility_scope(
  uuid, uuid, uuid, date
) from public, anon, authenticated, service_role;

create or replace function app_private.current_actor_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p where p.id = auth.uid();
$$;

revoke all on function app_private.current_actor_profile_id()
from public, anon, authenticated, service_role;

create or replace function app_private.shadow_new_employee_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person_id uuid;
  v_episode_id uuid;
  v_baseline_id uuid;
  v_start date := coalesce(new.hire_date, new.created_at::date);
begin
  insert into public.workforce_people(
    organization_id, profile_id, external_ref,
    first_name, last_name, email, phone, is_active
  ) values (
    new.organization_id, new.profile_id, 'employee:' || new.id::text,
    new.first_name, new.last_name, new.email, new.phone,
    new.status <> 'terminated'
  )
  on conflict (organization_id, external_ref) where external_ref is not null
  do update set
    profile_id = coalesce(excluded.profile_id, public.workforce_people.profile_id),
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    phone = excluded.phone
  returning id into v_person_id;

  insert into public.workforce_employee_links(
    organization_id, person_id, employee_id, effective_from, effective_to, source
  ) values (
    new.organization_id, v_person_id, new.id, v_start,
    case when new.status = 'terminated' then new.termination_date else null end,
    'api'
  );

  if new.status in ('active', 'on_leave')
     or (new.status = 'terminated' and new.termination_date is not null
         and new.termination_date >= v_start) then
    insert into public.employment_episodes(
      organization_id, facility_id, person_id, employee_id,
      started_on, ended_on, episode_status, start_reason, end_reason, source
    ) values (
      new.organization_id, new.facility_id, v_person_id, new.id, v_start,
      case when new.status = 'terminated' then new.termination_date else null end,
      case when new.status = 'terminated' then 'closed' else 'active' end,
      'created', case when new.status = 'terminated' then 'created_terminated' else null end,
      'api'
    ) returning id into v_episode_id;
  end if;

  insert into public.employment_lifecycle_events(
    organization_id, facility_id, person_id, employee_id,
    employment_episode_id, event_type, from_status, to_status,
    effective_on, reason, evidence, actor_profile_id
  ) values (
    new.organization_id, new.facility_id, v_person_id, new.id,
    v_episode_id, case when new.status = 'terminated' then 'terminated' else 'hired' end,
    null, new.status, v_start, 'Employee creation',
    jsonb_build_object('source', 'employee_insert'), app_private.current_actor_profile_id()
  );

  select id into v_baseline_id
  from public.compliance_profile_definitions
  where is_mandatory_baseline and is_active;

  if new.status = 'active' and v_baseline_id is not null then
    insert into public.employee_compliance_profile_assignments(
      organization_id, facility_id, employee_id, profile_definition_id,
      effective_from, source, reason
    ) values (
      new.organization_id, new.facility_id, new.id, v_baseline_id,
      v_start, 'api', 'Mandatory baseline assigned at employee creation'
    );
  end if;

  if new.status = 'active' and new.hire_date is null then
    insert into public.workforce_backfill_exceptions(
      organization_id, employee_id, exception_code, details
    ) values (
      new.organization_id, new.id, 'missing_hire_date',
      jsonb_build_object('fallbackDate', v_start)
    ) on conflict do nothing;
  end if;
  if new.profile_id is not null and new.status <> 'terminated' then
    perform app_private.align_profile_facility_scope(
      new.profile_id, null, new.facility_id, v_start
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.shadow_new_employee_lifecycle()
from public, anon, authenticated, service_role;
create trigger shadow_new_employee_lifecycle
after insert on public.employees
for each row execute function app_private.shadow_new_employee_lifecycle();

create or replace function app_private.sync_workforce_person_from_employee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workforce_people p
  set profile_id = new.profile_id,
      first_name = new.first_name,
      last_name = new.last_name,
      email = new.email,
      phone = new.phone
  from public.workforce_employee_links l
  where l.employee_id = new.id
    and l.person_id = p.id
    and l.effective_to is null;
  return new;
end;
$$;

revoke all on function app_private.sync_workforce_person_from_employee()
from public, anon, authenticated, service_role;
create trigger sync_workforce_person_from_employee
after update of profile_id, first_name, last_name, email, phone on public.employees
for each row execute function app_private.sync_workforce_person_from_employee();

create or replace function app_private.disposition_workforce_lifecycle_dependents(
  p_lifecycle_event_id uuid,
  p_transition text,
  p_source_facility_id uuid,
  p_target_facility_id uuid,
  p_effective_on date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.employment_lifecycle_events%rowtype;
  v_employee public.employees%rowtype;
  v_row record;
  v_schedule_id uuid;
  v_schedule_ids uuid[] := array[]::uuid[];
  v_shift_count integer := 0;
  v_schedule_count integer := 0;
  v_course_count integer := 0;
  v_training_count integer := 0;
  v_summary jsonb;
  v_title text;
begin
  select * into v_event
  from public.employment_lifecycle_events where id = p_lifecycle_event_id;
  if v_event.id is null then
    raise exception 'lifecycle event % not found', p_lifecycle_event_id
      using errcode = 'P0002';
  end if;
  select * into v_employee from public.employees where id = v_event.employee_id;

  if p_transition in ('leave', 'terminate', 'transfer') then
    for v_row in
      select s.*
      from public.shift_assignments s
      where s.employee_id = v_event.employee_id
        and s.shift_date >= p_effective_on
        and s.status in ('scheduled', 'confirmed')
        and (p_transition <> 'transfer' or s.facility_id = p_source_facility_id)
      for update
    loop
      insert into public.employment_lifecycle_dispositions(
        organization_id, facility_id, employee_id, lifecycle_event_id,
        target_type, target_id, disposition_action, prior_state, resulting_state
      ) values (
        v_event.organization_id, v_row.facility_id, v_event.employee_id, v_event.id,
        'shift_assignment', v_row.id, 'called_off',
        jsonb_build_object('status', v_row.status, 'shiftDate', v_row.shift_date,
          'scheduleId', v_row.schedule_id),
        jsonb_build_object('status', 'called_off', 'policyTransition', p_transition)
      ) on conflict do nothing;
      update public.shift_assignments
      set status = 'called_off',
          notes = concat_ws(E'\n', nullif(notes, ''),
            '[workforce lifecycle ' || p_transition || '] ' || trim(p_reason))
      where id = v_row.id;
      v_schedule_ids := array_append(v_schedule_ids, v_row.schedule_id);
      v_shift_count := v_shift_count + 1;
    end loop;

    foreach v_schedule_id in array coalesce(v_schedule_ids, array[]::uuid[])
    loop
      if not exists (
        select 1 from public.employment_lifecycle_dispositions d
        where d.lifecycle_event_id = v_event.id
          and d.target_type = 'schedule' and d.target_id = v_schedule_id
      ) then
        insert into public.employment_lifecycle_dispositions(
          organization_id, facility_id, employee_id, lifecycle_event_id,
          target_type, target_id, disposition_action, prior_state, resulting_state
        )
        select v_event.organization_id, s.facility_id, v_event.employee_id, v_event.id,
          'schedule', s.id, 'schedule_roster_changed',
          jsonb_build_object('status', s.status, 'periodStart', s.period_start,
            'periodEnd', s.period_end),
          jsonb_build_object('status', s.status,
            'employeeAssignmentDispositioned', true)
        from public.schedules s where s.id = v_schedule_id;
        update public.schedules set updated_at = now() where id = v_schedule_id;
        v_schedule_count := v_schedule_count + 1;
      end if;
    end loop;
  end if;

  if p_transition = 'leave' then
    for v_row in
      select c.* from public.course_assignments c
      where c.employee_id = v_event.employee_id
        and c.status in ('assigned', 'in_progress', 'overdue')
      for update
    loop
      insert into public.employment_lifecycle_dispositions(
        organization_id, facility_id, employee_id, lifecycle_event_id,
        target_type, target_id, disposition_action, prior_state, resulting_state
      ) values (
        v_event.organization_id, v_row.facility_id, v_event.employee_id, v_event.id,
        'course_assignment', v_row.id, 'paused',
        jsonb_build_object('status', v_row.status, 'dueDate', v_row.due_date),
        jsonb_build_object('status', 'paused', 'reason', 'employment_leave')
      );
      update public.course_assignments
      set lifecycle_previous_status = v_row.status,
          lifecycle_disposition = 'leave', lifecycle_event_id = v_event.id,
          status = 'paused'
      where id = v_row.id;
      v_course_count := v_course_count + 1;
    end loop;
  elsif p_transition = 'return' then
    for v_row in
      select c.* from public.course_assignments c
      where c.employee_id = v_event.employee_id
        and c.status = 'paused' and c.lifecycle_disposition = 'leave'
      for update
    loop
      insert into public.employment_lifecycle_dispositions(
        organization_id, facility_id, employee_id, lifecycle_event_id,
        target_type, target_id, disposition_action, prior_state, resulting_state
      ) values (
        v_event.organization_id, v_row.facility_id, v_event.employee_id, v_event.id,
        'course_assignment', v_row.id, 'resumed',
        jsonb_build_object('status', 'paused'),
        jsonb_build_object('status', v_row.lifecycle_previous_status,
          'reason', 'employment_return')
      );
      update public.course_assignments
      set status = v_row.lifecycle_previous_status,
          lifecycle_previous_status = null, lifecycle_disposition = null,
          lifecycle_event_id = null
      where id = v_row.id;
      v_course_count := v_course_count + 1;
    end loop;
  elsif p_transition = 'terminate' then
    for v_row in
      select c.* from public.course_assignments c
      where c.employee_id = v_event.employee_id
        and c.status not in ('completed', 'canceled')
      for update
    loop
      insert into public.employment_lifecycle_dispositions(
        organization_id, facility_id, employee_id, lifecycle_event_id,
        target_type, target_id, disposition_action, prior_state, resulting_state
      ) values (
        v_event.organization_id, v_row.facility_id, v_event.employee_id, v_event.id,
        'course_assignment', v_row.id, 'canceled',
        jsonb_build_object('status', v_row.status, 'dueDate', v_row.due_date),
        jsonb_build_object('status', 'canceled', 'reason', 'employment_termination')
      );
      update public.course_assignments
      set lifecycle_previous_status = v_row.status,
          lifecycle_disposition = 'termination', lifecycle_event_id = v_event.id,
          status = 'canceled', canceled_at = now(),
          cancellation_reason = trim(p_reason)
      where id = v_row.id;
      v_course_count := v_course_count + 1;
    end loop;
  elsif p_transition = 'transfer' then
    for v_row in
      select c.* from public.course_assignments c
      where c.employee_id = v_event.employee_id
        and c.facility_id = p_source_facility_id
        and c.status not in ('completed', 'canceled')
      for update
    loop
      insert into public.employment_lifecycle_dispositions(
        organization_id, facility_id, employee_id, lifecycle_event_id,
        target_type, target_id, disposition_action, prior_state, resulting_state
      ) values (
        v_event.organization_id, p_target_facility_id, v_event.employee_id, v_event.id,
        'course_assignment', v_row.id, 'transferred',
        jsonb_build_object('facilityId', v_row.facility_id, 'status', v_row.status),
        jsonb_build_object('facilityId', p_target_facility_id, 'status', v_row.status)
      );
      update public.course_assignments
      set facility_id = p_target_facility_id where id = v_row.id;
      v_course_count := v_course_count + 1;
    end loop;
  end if;

  if p_transition in ('leave', 'terminate', 'transfer', 'return') then
    for v_row in
      select a.*, c.facility_id as class_facility_id, c.class_date, c.status as class_status
      from public.training_class_attendees a
      join public.training_classes c on c.id = a.class_id
      where a.employee_id = v_event.employee_id
        and c.class_date >= p_effective_on
        and c.status = 'draft'
        and (
          (p_transition = 'leave' and a.lifecycle_disposition = 'active')
          or (p_transition = 'return' and a.lifecycle_disposition = 'paused')
          or (p_transition = 'terminate' and a.lifecycle_disposition <> 'removed')
          or (p_transition = 'transfer' and a.lifecycle_disposition <> 'removed'
              and c.facility_id = p_source_facility_id)
        )
      for update of a
    loop
      insert into public.employment_lifecycle_dispositions(
        organization_id, facility_id, employee_id, lifecycle_event_id,
        target_type, target_id, disposition_action, prior_state, resulting_state
      ) values (
        v_event.organization_id, v_row.class_facility_id, v_event.employee_id, v_event.id,
        'training_class_attendee', v_row.id,
        case when p_transition = 'return' then 'resumed'
             when p_transition = 'leave' then 'paused' else 'removed' end,
        jsonb_build_object('disposition', v_row.lifecycle_disposition,
          'classDate', v_row.class_date),
        jsonb_build_object('disposition',
          case when p_transition = 'return' then 'active'
               when p_transition = 'leave' then 'paused' else 'removed' end,
          'transition', p_transition)
      );
      update public.training_class_attendees
      set lifecycle_disposition = case
            when p_transition = 'return' then 'active'
            when p_transition = 'leave' then 'paused'
            else 'removed' end,
          lifecycle_event_id = case when p_transition = 'return' then null else v_event.id end,
          lifecycle_reason = case when p_transition = 'return' then null else trim(p_reason) end,
          lifecycle_dispositioned_at = now()
      where id = v_row.id;
      v_training_count := v_training_count + 1;
    end loop;
  end if;

  v_summary := jsonb_build_object(
    'policyVersion', '2026-07-11.workforce-lifecycle.v1',
    'transition', p_transition,
    'shiftsDispositioned', v_shift_count,
    'schedulesTouched', v_schedule_count,
    'courseAssignmentsDispositioned', v_course_count,
    'trainingRosterEntriesDispositioned', v_training_count
  );

  v_title := case p_transition
    when 'terminate' then 'Employment ended'
    when 'leave' then 'Employment leave started'
    when 'return' then 'Employment leave ended'
    when 'transfer' then 'Facility transfer completed'
    when 'rehire' then 'Employment rehire completed'
    when 'suspend_access' then 'Workforce access suspended'
    when 'restore_access' then 'Workforce access restored'
    else 'Workforce lifecycle updated'
  end;

  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select distinct v_event.organization_id, recipients.profile_id,
    'workforce_lifecycle_changed', v_title,
    trim(p_reason) || ' Disposition summary: ' || v_summary::text,
    '/app/employees/' || v_event.employee_id::text
  from (
    select v_employee.profile_id
    where v_employee.profile_id is not null
    union
    select p.id
    from public.profiles p
    where p.organization_id = v_event.organization_id and p.is_active
      and (
        p.role = 'org_admin'
        or (p.role = 'facility_manager' and exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id = p.id
            and fa.facility_id in (p_source_facility_id, p_target_facility_id)
        ))
      )
  ) recipients(profile_id);

  insert into app_private.workforce_lifecycle_integration_outbox(
    event_id, organization_id, correlation_id, actor_subject, payload
  ) values (
    v_event.id, v_event.organization_id, v_event.correlation_id,
    coalesce(v_event.actor_profile_id::text, 'service_role'),
    jsonb_build_object(
      'schemaVersion', '2026-07-11',
      'eventVersion', 1,
      'eventId', v_event.id,
      'eventType', 'workforce.employee.lifecycle.changed',
      'occurredAt', v_event.created_at,
      'employeeId', v_event.employee_id,
      'personId', v_event.person_id,
      'employmentEpisodeId', v_event.employment_episode_id,
      'organizationId', v_event.organization_id,
      'facilityId', v_event.facility_id,
      'transition', p_transition,
      'fromStatus', v_event.from_status,
      'toStatus', v_event.to_status,
      'effectiveOn', p_effective_on,
      'reason', trim(p_reason),
      'disposition', v_summary
    )
  ) on conflict (event_id) do nothing;

  if to_regclass('app_private.integration_event_log') is not null then
    execute $dynamic$
      insert into app_private.integration_event_log(
        event_id, organization_id, event_type, event_schema_version,
        occurred_at, correlation_id, causation_id, actor_subject, payload
      )
      select event_id, organization_id, event_type, event_schema_version,
        created_at, correlation_id, event_id::text, actor_subject, payload
      from app_private.workforce_lifecycle_integration_outbox
      where event_id = $1
      on conflict (event_id) do nothing
    $dynamic$ using v_event.id;
    update app_private.workforce_lifecycle_integration_outbox
    set published_at = coalesce(published_at, now())
    where event_id = v_event.id;
  end if;

  return v_summary;
end;
$$;

revoke all on function app_private.disposition_workforce_lifecycle_dependents(
  uuid, text, uuid, uuid, date, text
) from public, anon, authenticated, service_role;

create or replace function app_private.flush_workforce_lifecycle_integration_outbox(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_published integer := 0;
begin
  if to_regclass('app_private.integration_event_log') is null then
    return 0;
  end if;
  for v_event_id in
    select o.event_id
    from app_private.workforce_lifecycle_integration_outbox o
    where o.published_at is null
    order by o.created_at
    limit least(greatest(p_limit, 1), 1000)
    for update skip locked
  loop
    execute $dynamic$
      insert into app_private.integration_event_log(
        event_id, organization_id, event_type, event_schema_version,
        occurred_at, correlation_id, causation_id, actor_subject, payload
      )
      select event_id, organization_id, event_type, event_schema_version,
        created_at, correlation_id, event_id::text, actor_subject, payload
      from app_private.workforce_lifecycle_integration_outbox
      where event_id = $1
      on conflict (event_id) do nothing
    $dynamic$ using v_event_id;
    update app_private.workforce_lifecycle_integration_outbox
    set published_at = now() where event_id = v_event_id;
    v_published := v_published + 1;
  end loop;
  return v_published;
end;
$$;

revoke all on function app_private.flush_workforce_lifecycle_integration_outbox(integer)
from public, anon, authenticated, service_role;
grant execute on function app_private.flush_workforce_lifecycle_integration_outbox(integer)
to service_role;

create or replace function public.preview_employee_lifecycle_transition(
  p_employee_id uuid,
  p_transition text,
  p_effective_on date default current_date,
  p_facility_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_person_id uuid;
  v_episode public.employment_episodes%rowtype;
  v_target_facility uuid;
  v_allowed boolean := true;
  v_reasons text[] := array[]::text[];
  v_target_status text;
  v_is_service boolean := coalesce(auth.jwt()->>'role', '') = 'service_role';
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then
    raise exception 'employee % not found', p_employee_id using errcode = 'P0002';
  end if;

  v_target_facility := coalesce(p_facility_id, v_employee.facility_id);
  if not v_is_service and not app_private.profile_has_effective_permission(
    auth.uid(), 'workforce.lifecycle.manage', 'facility', v_target_facility, now()
  ) then
    raise exception 'Not authorized to manage this employee lifecycle'
      using errcode = '42501';
  end if;

  if p_transition = 'transfer' and not v_is_service
     and not app_private.profile_has_effective_permission(
       auth.uid(), 'workforce.lifecycle.manage', 'facility', v_employee.facility_id, now()
     ) then
    raise exception 'Transfer requires lifecycle permission at the source facility'
      using errcode = '42501';
  end if;

  if p_transition not in (
    'hire', 'rehire', 'transfer', 'leave', 'return', 'terminate',
    'suspend_access', 'restore_access'
  ) then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'unsupported_transition');
  end if;
  if p_effective_on is null then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'effective_date_required');
  elsif p_effective_on > current_date then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'future_effective_date_not_supported');
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'reason_required');
  end if;

  if not exists (
    select 1 from public.facilities f
    where f.id = v_target_facility
      and f.organization_id = v_employee.organization_id
      and f.is_active
  ) then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'target_facility_outside_organization_or_inactive');
  end if;

  select l.person_id into v_person_id
  from public.workforce_employee_links l
  where l.employee_id = p_employee_id
  order by (l.effective_to is null) desc, l.effective_from desc
  limit 1;
  if v_person_id is null then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'workforce_person_link_missing');
  end if;

  select * into v_episode
  from public.employment_episodes e
  where e.employee_id = p_employee_id and e.episode_status = 'active';

  case p_transition
    when 'hire' then
      v_target_status := 'active';
      if v_employee.status not in ('inactive', 'terminated') or v_episode.id is not null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'hire_requires_no_active_episode');
      end if;
    when 'rehire' then
      v_target_status := 'active';
      if v_employee.status <> 'terminated' or v_episode.id is not null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'rehire_requires_terminated_employee');
      end if;
    when 'transfer' then
      v_target_status := v_employee.status;
      if v_episode.id is null or v_employee.status not in ('active', 'on_leave') then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'transfer_requires_active_episode');
      elsif v_target_facility = v_employee.facility_id then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'transfer_requires_new_facility');
      end if;
    when 'leave' then
      v_target_status := 'on_leave';
      if v_employee.status <> 'active' or v_episode.id is null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'leave_requires_active_employment');
      end if;
    when 'return' then
      v_target_status := 'active';
      if v_employee.status <> 'on_leave' or v_episode.id is null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'return_requires_leave_state');
      end if;
    when 'terminate' then
      v_target_status := 'terminated';
      if v_employee.status = 'terminated' or v_episode.id is null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'terminate_requires_active_episode');
      end if;
    when 'suspend_access' then
      v_target_status := v_employee.status;
      if v_employee.profile_id is null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'linked_profile_required');
      elsif exists (
        select 1 from public.employee_access_suspensions s
        where s.employee_id = p_employee_id
          and s.suspension_type = 'manual' and s.effective_to is null
      ) then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'manual_access_suspension_already_open');
      end if;
    when 'restore_access' then
      v_target_status := v_employee.status;
      if v_employee.status <> 'active' then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'access_restore_requires_active_employment');
      end if;
      if not exists (
        select 1 from public.employee_access_suspensions s
        where s.employee_id = p_employee_id
          and s.suspension_type = 'manual' and s.effective_to is null
      ) then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'no_manual_access_suspension');
      end if;
    else
      v_target_status := v_employee.status;
  end case;

  if v_episode.id is not null and p_effective_on < v_episode.started_on then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'effective_date_precedes_active_episode');
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'reasons', to_jsonb(v_reasons),
    'employeeId', v_employee.id,
    'personId', v_person_id,
    'organizationId', v_employee.organization_id,
    'facilityId', v_target_facility,
    'currentStatus', v_employee.status,
    'targetStatus', v_target_status,
    'activeEpisodeId', v_episode.id,
    'effectiveOn', p_effective_on
  );
end;
$$;

revoke all on function public.preview_employee_lifecycle_transition(
  uuid, text, date, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.preview_employee_lifecycle_transition(
  uuid, text, date, uuid, text
) to authenticated, service_role;

create or replace function public.apply_employee_lifecycle_transition(
  p_employee_id uuid,
  p_transition text,
  p_effective_on date default current_date,
  p_facility_id uuid default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview jsonb;
  v_employee public.employees%rowtype;
  v_person_id uuid;
  v_episode_id uuid;
  v_prior_episode_id uuid;
  v_event_id uuid;
  v_target_facility uuid;
  v_event_type text;
  v_should_restore boolean := false;
  v_sessions_revoked integer := 0;
  v_disposition_summary jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform app_private.assert_phase2_aal2();
  select * into v_employee
  from public.employees where id = p_employee_id for update;
  if v_employee.id is null then
    raise exception 'employee % not found', p_employee_id using errcode = 'P0002';
  end if;

  v_preview := public.preview_employee_lifecycle_transition(
    p_employee_id, p_transition, p_effective_on, p_facility_id, p_reason
  );
  if not coalesce((v_preview->>'allowed')::boolean, false) then
    raise exception 'Lifecycle transition rejected: %', v_preview->'reasons'
      using errcode = '22023';
  end if;

  v_target_facility := (v_preview->>'facilityId')::uuid;
  v_person_id := (v_preview->>'personId')::uuid;
  v_episode_id := nullif(v_preview->>'activeEpisodeId', '')::uuid;
  perform set_config('app.lifecycle_transition', 'on', true);

  if p_transition in ('terminate', 'leave', 'suspend_access')
     and v_employee.profile_id is not null then
    delete from auth.sessions where user_id = v_employee.profile_id;
    get diagnostics v_sessions_revoked = row_count;
  end if;

  if p_transition in ('hire', 'rehire') then
    if p_transition = 'rehire' then
      select id into v_prior_episode_id
      from public.employment_episodes
      where employee_id = p_employee_id and episode_status = 'closed'
      order by ended_on desc, created_at desc limit 1;
      v_event_type := 'rehired';
    else
      v_event_type := 'hired';
    end if;

    insert into public.employment_episodes(
      organization_id, facility_id, person_id, employee_id,
      started_on, episode_status, start_reason, previous_episode_id, source
    ) values (
      v_employee.organization_id, v_target_facility, v_person_id, p_employee_id,
      p_effective_on, 'active', p_transition, v_prior_episode_id, 'api'
    ) returning id into v_episode_id;

    update public.employees
    set facility_id = v_target_facility,
        status = 'active',
        hire_date = p_effective_on,
        termination_date = null
    where id = p_employee_id;

    if v_employee.profile_id is not null then
      perform app_private.align_profile_facility_scope(
        v_employee.profile_id, v_employee.facility_id,
        v_target_facility, p_effective_on
      );
    end if;

    update public.workforce_employee_links
    set effective_to = p_effective_on
    where employee_id = p_employee_id and effective_to is null;
    insert into public.workforce_employee_links(
      organization_id, person_id, employee_id, effective_from, source
    ) values (
      v_employee.organization_id, v_person_id, p_employee_id,
      p_effective_on, 'api'
    );

    insert into public.employment_lifecycle_events(
      organization_id, facility_id, person_id, employee_id,
      employment_episode_id, event_type, from_status, to_status,
      effective_on, reason, evidence, actor_profile_id
    ) values (
      v_employee.organization_id, v_target_facility, v_person_id, p_employee_id,
      v_episode_id, v_event_type, v_employee.status, 'active',
      p_effective_on, trim(p_reason),
      jsonb_build_object('priorEpisodeId', v_prior_episode_id), app_private.current_actor_profile_id()
    ) returning id into v_event_id;

    select coalesce(bool_or(profile_was_active), false) into v_should_restore
    from public.employee_access_suspensions
    where employee_id = p_employee_id and effective_to is null;
    update public.employee_access_suspensions
    set effective_to = greatest(v_now, effective_from + interval '1 microsecond'),
        released_by_event_id = v_event_id
    where employee_id = p_employee_id and effective_to is null;
    update public.workforce_people set is_active = true where id = v_person_id;

  elsif p_transition = 'transfer' then
    v_prior_episode_id := v_episode_id;
    update public.employment_episodes
    set episode_status = 'closed', ended_on = p_effective_on,
        end_reason = 'transfer: ' || trim(p_reason)
    where id = v_prior_episode_id;

    insert into public.employment_episodes(
      organization_id, facility_id, person_id, employee_id,
      started_on, episode_status, start_reason, previous_episode_id, source
    ) values (
      v_employee.organization_id, v_target_facility, v_person_id, p_employee_id,
      p_effective_on, 'active', 'transfer', v_prior_episode_id, 'api'
    ) returning id into v_episode_id;

    update public.employees
    set facility_id = v_target_facility
    where id = p_employee_id;

    if v_employee.profile_id is not null then
      perform app_private.align_profile_facility_scope(
        v_employee.profile_id, v_employee.facility_id,
        v_target_facility, p_effective_on
      );
    end if;

    insert into public.employment_lifecycle_events(
      organization_id, facility_id, person_id, employee_id,
      employment_episode_id, event_type, from_status, to_status,
      effective_on, reason, evidence, actor_profile_id
    ) values (
      v_employee.organization_id, v_target_facility, v_person_id, p_employee_id,
      v_episode_id, 'transferred', v_employee.status, v_employee.status,
      p_effective_on, trim(p_reason),
      jsonb_build_object(
        'fromFacilityId', v_employee.facility_id,
        'toFacilityId', v_target_facility,
        'previousEpisodeId', v_prior_episode_id
      ), app_private.current_actor_profile_id()
    ) returning id into v_event_id;

  elsif p_transition = 'terminate' then
    update public.employment_episodes
    set episode_status = 'closed', ended_on = p_effective_on,
        end_reason = trim(p_reason)
    where id = v_episode_id;
    update public.employees
    set status = 'terminated', termination_date = p_effective_on
    where id = p_employee_id;
    update public.workforce_employee_links
    set effective_to = p_effective_on
    where employee_id = p_employee_id and effective_to is null;

    insert into public.employment_lifecycle_events(
      organization_id, facility_id, person_id, employee_id,
      employment_episode_id, event_type, from_status, to_status,
      effective_on, reason, evidence, actor_profile_id
    ) values (
      v_employee.organization_id, v_employee.facility_id, v_person_id, p_employee_id,
      v_episode_id, 'terminated', v_employee.status, 'terminated',
      p_effective_on, trim(p_reason),
      jsonb_build_object('revokedSessionCount', v_sessions_revoked), app_private.current_actor_profile_id()
    ) returning id into v_event_id;

    if v_employee.profile_id is not null then
      insert into public.employee_access_suspensions(
        organization_id, facility_id, employee_id, profile_id,
        suspension_type, effective_from, reason, profile_was_active,
        created_by_event_id
      ) values (
        v_employee.organization_id, v_employee.facility_id, p_employee_id,
        v_employee.profile_id, 'termination', v_now, trim(p_reason),
        coalesce((select bool_or(profile_was_active)
                  from public.employee_access_suspensions
                  where employee_id = p_employee_id and effective_to is null), false)
          or coalesce((select is_active from public.profiles
                       where id = v_employee.profile_id), false),
        v_event_id
      ) on conflict (employee_id, suspension_type) where effective_to is null
        do nothing;
    end if;
    update public.workforce_people set is_active = false where id = v_person_id;

  elsif p_transition in ('leave', 'return') then
    v_event_type := case when p_transition = 'leave' then 'leave_started' else 'leave_ended' end;
    update public.employees
    set status = case when p_transition = 'leave' then 'on_leave' else 'active' end
    where id = p_employee_id;

    insert into public.employment_lifecycle_events(
      organization_id, facility_id, person_id, employee_id,
      employment_episode_id, event_type, from_status, to_status,
      effective_on, reason, evidence, actor_profile_id
    ) values (
      v_employee.organization_id, v_employee.facility_id, v_person_id, p_employee_id,
      v_episode_id, v_event_type, v_employee.status,
      case when p_transition = 'leave' then 'on_leave' else 'active' end,
      p_effective_on, trim(p_reason),
      jsonb_build_object('revokedSessionCount', v_sessions_revoked), app_private.current_actor_profile_id()
    ) returning id into v_event_id;

    if p_transition = 'leave' and v_employee.profile_id is not null then
      insert into public.employee_access_suspensions(
        organization_id, facility_id, employee_id, profile_id,
        suspension_type, effective_from, reason, profile_was_active,
        created_by_event_id
      ) values (
        v_employee.organization_id, v_employee.facility_id, p_employee_id,
        v_employee.profile_id, 'leave', v_now, trim(p_reason),
        coalesce((select is_active from public.profiles
                  where id = v_employee.profile_id), false), v_event_id
      );
    else
      select coalesce(bool_or(profile_was_active), false) into v_should_restore
      from public.employee_access_suspensions
      where employee_id = p_employee_id and suspension_type = 'leave'
        and effective_to is null;
      update public.employee_access_suspensions
      set effective_to = greatest(v_now, effective_from + interval '1 microsecond'),
          released_by_event_id = v_event_id
      where employee_id = p_employee_id and suspension_type = 'leave'
        and effective_to is null;
    end if;

  else
    v_event_type := case when p_transition = 'suspend_access'
      then 'access_suspended' else 'access_restored' end;
    insert into public.employment_lifecycle_events(
      organization_id, facility_id, person_id, employee_id,
      employment_episode_id, event_type, from_status, to_status,
      effective_on, reason, evidence, actor_profile_id
    ) values (
      v_employee.organization_id, v_employee.facility_id, v_person_id, p_employee_id,
      v_episode_id, v_event_type, v_employee.status, v_employee.status,
      p_effective_on, trim(p_reason),
      jsonb_build_object('revokedSessionCount', v_sessions_revoked), app_private.current_actor_profile_id()
    ) returning id into v_event_id;

    if p_transition = 'suspend_access' then
      insert into public.employee_access_suspensions(
        organization_id, facility_id, employee_id, profile_id,
        suspension_type, effective_from, reason, profile_was_active,
        created_by_event_id
      ) values (
        v_employee.organization_id, v_employee.facility_id, p_employee_id,
        v_employee.profile_id, 'manual', v_now, trim(p_reason),
        coalesce((select is_active from public.profiles
                  where id = v_employee.profile_id), false), v_event_id
      );
    else
      select coalesce(bool_or(profile_was_active), false) into v_should_restore
      from public.employee_access_suspensions
      where employee_id = p_employee_id and suspension_type = 'manual'
        and effective_to is null;
      update public.employee_access_suspensions
      set effective_to = greatest(v_now, effective_from + interval '1 microsecond'),
          released_by_event_id = v_event_id
      where employee_id = p_employee_id and suspension_type = 'manual'
        and effective_to is null;
    end if;
  end if;

  perform set_config('app.privileged_write', 'on', true);
  v_disposition_summary := app_private.disposition_workforce_lifecycle_dependents(
    v_event_id, p_transition, v_employee.facility_id,
    v_target_facility, p_effective_on, p_reason
  );

  if v_employee.profile_id is not null then
    if p_transition in ('terminate', 'leave', 'suspend_access') then
      update public.profiles set is_active = false where id = v_employee.profile_id;
    elsif v_should_restore and not exists (
      select 1 from public.employee_access_suspensions s
      where s.profile_id = v_employee.profile_id and s.effective_to is null
    ) then
      update public.profiles set is_active = true where id = v_employee.profile_id;
    end if;
  end if;

  perform set_config('app.privileged_write', '', true);

  return v_event_id;
end;
$$;

revoke all on function public.apply_employee_lifecycle_transition(
  uuid, text, date, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_employee_lifecycle_transition(
  uuid, text, date, uuid, text
) to authenticated, service_role;

create or replace function public.is_employee_access_active(
  p_employee_id uuid,
  p_at timestamptz default now()
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
    left join public.profiles p on p.id = e.profile_id
    where e.id = p_employee_id
      and e.status = 'active'
      and (e.profile_id is null or p.is_active)
      and not exists (
        select 1 from public.employee_access_suspensions s
        where s.employee_id = e.id
          and s.effective_from <= p_at
          and (s.effective_to is null or s.effective_to > p_at)
      )
  );
$$;

revoke all on function public.is_employee_access_active(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.is_employee_access_active(uuid, timestamptz)
to authenticated, service_role;

create or replace function app_private.resolve_employee_compliance_profiles(
  p_employee_id uuid,
  p_on date default current_date
)
returns table (
  profile_definition_id uuid,
  profile_code text,
  profile_name text,
  assignment_source text,
  explanation text
)
language sql
stable
security definer
set search_path = ''
as $$
  with employee_context as (
    select e.*, f.facility_type
    from public.employees e
    join public.facilities f on f.id = e.facility_id
    where e.id = p_employee_id
  ), candidates as (
    select p.id, p.code, p.name,
      'mandatory_baseline'::text as assignment_source,
      'Mandatory baseline applies to every employee'::text as explanation,
      0 as source_rank
    from public.compliance_profile_definitions p
    where p.is_mandatory_baseline and p.is_active
      and p.effective_from <= p_on
      and (p.effective_to is null or p.effective_to > p_on)

    union all

    select p.id, p.code, p.name, a.source,
      coalesce(nullif(a.reason, ''), 'Effective-dated explicit assignment'),
      1
    from public.employee_compliance_profile_assignments a
    join public.compliance_profile_definitions p
      on p.id = a.profile_definition_id and p.is_active
    where a.employee_id = p_employee_id
      and a.effective_from <= p_on
      and (a.effective_to is null or a.effective_to > p_on)
      and p.effective_from <= p_on
      and (p.effective_to is null or p.effective_to > p_on)

    union all

    select p.id, p.code, p.name, 'mapping_rule',
      'Matched rule: ' || r.name,
      2
    from employee_context e
    join public.compliance_profile_mapping_rules r
      on r.organization_id = e.organization_id and r.is_active
      and r.effective_from <= p_on
      and (r.effective_to is null or r.effective_to > p_on)
      and (r.facility_type is null or r.facility_type = e.facility_type)
      and (r.worker_type is null or r.worker_type = e.worker_type)
      and (r.job_title_pattern is null or e.job_title ilike r.job_title_pattern)
    join public.compliance_profile_definitions p
      on p.id = r.profile_definition_id and p.is_active
      and p.effective_from <= p_on
      and (p.effective_to is null or p.effective_to > p_on)
  ), ranked as (
    select c.*, row_number() over (
      partition by c.id order by c.source_rank, c.assignment_source
    ) as row_number
    from candidates c
  )
  select id, code, name, assignment_source, explanation
  from ranked where row_number = 1
  order by source_rank, code;
$$;

revoke all on function app_private.resolve_employee_compliance_profiles(uuid, date)
from public, anon, authenticated, service_role;

create or replace function public.explain_employee_compliance_profile(
  p_employee_id uuid,
  p_on date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_is_service boolean := coalesce(auth.jwt()->>'role', '') = 'service_role';
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then
    raise exception 'employee % not found', p_employee_id using errcode = 'P0002';
  end if;
  if not v_is_service and public.current_role() is null then
    raise exception 'An active authenticated profile is required'
      using errcode = '42501';
  end if;
  if not v_is_service
     and v_employee.profile_id is distinct from auth.uid()
     and not app_private.profile_has_effective_permission(
       auth.uid(), 'workforce.compliance.read', 'facility', v_employee.facility_id, now()
     ) then
    raise exception 'Not authorized to inspect this compliance profile'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'employeeId', v_employee.id,
    'asOf', p_on,
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.profile_definition_id,
        'code', p.profile_code,
        'name', p.profile_name,
        'source', p.assignment_source,
        'explanation', p.explanation
      ) order by p.profile_code)
      from app_private.resolve_employee_compliance_profiles(p_employee_id, p_on) p
    ), '[]'::jsonb),
    'requirements', coalesce((
      with effective_requirements as (
        select r.*
        from app_private.resolve_employee_compliance_profiles(p_employee_id, p_on) p
        join public.compliance_profile_requirements r
          on r.profile_definition_id = p.profile_definition_id
      ), reduced as (
        select requirement_key,
          min(label) as label,
          bool_or(is_mandatory) as is_mandatory,
          max(minimum_hours) as minimum_hours,
          min(renewal_days) filter (where renewal_days is not null) as renewal_days,
          bool_or(evidence_required) as evidence_required,
          jsonb_agg(distinct profile_definition_id) as profile_ids
        from effective_requirements
        group by requirement_key
      )
      select jsonb_agg(jsonb_build_object(
        'key', requirement_key,
        'label', label,
        'mandatory', is_mandatory,
        'minimumHours', minimum_hours,
        'renewalDays', renewal_days,
        'evidenceRequired', evidence_required,
        'profileIds', profile_ids
      ) order by requirement_key)
      from reduced
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.explain_employee_compliance_profile(uuid, date)
from public, anon, authenticated, service_role;
grant execute on function public.explain_employee_compliance_profile(uuid, date)
to authenticated, service_role;

create or replace function public.upsert_compliance_profile_assignment(
  p_employee_id uuid,
  p_profile_definition_id uuid,
  p_effective_from date default current_date,
  p_effective_to date default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_assignment_id uuid;
  v_existing public.employee_compliance_profile_assignments%rowtype;
  v_is_service boolean := coalesce(auth.jwt()->>'role', '') = 'service_role';
begin
  perform app_private.assert_phase2_aal2();
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then
    raise exception 'employee % not found', p_employee_id using errcode = 'P0002';
  end if;
  if not v_is_service and not app_private.profile_has_effective_permission(
    auth.uid(), 'workforce.compliance.manage', 'facility', v_employee.facility_id, now()
  ) then
    raise exception 'Not authorized to assign compliance profiles'
      using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Assignment reason is required' using errcode = '22023';
  end if;

  select * into v_existing
  from public.employee_compliance_profile_assignments
  where employee_id = p_employee_id
    and profile_definition_id = p_profile_definition_id
    and effective_to is null
  for update;

  if v_existing.id is not null
     and v_existing.effective_from = p_effective_from
     and v_existing.effective_to is not distinct from p_effective_to
     and v_existing.reason = trim(p_reason)
     and v_existing.source = 'api' then
    return v_existing.id;
  end if;

  if v_existing.id is not null then
    if p_effective_from <= v_existing.effective_from then
      raise exception 'superseding assignment must begin after the existing assignment start (%)',
        v_existing.effective_from using errcode = '22007';
    end if;
    update public.employee_compliance_profile_assignments
    set effective_to = p_effective_from
    where id = v_existing.id;
  end if;

  insert into public.employee_compliance_profile_assignments(
    organization_id, facility_id, employee_id, profile_definition_id,
    effective_from, effective_to, source, reason, assigned_by
  ) values (
    v_employee.organization_id, v_employee.facility_id, p_employee_id,
    p_profile_definition_id, p_effective_from, p_effective_to, 'api',
    trim(p_reason), app_private.current_actor_profile_id()
  ) returning id into v_assignment_id;

  return v_assignment_id;
end;
$$;

revoke all on function public.upsert_compliance_profile_assignment(
  uuid, uuid, date, date, text
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_compliance_profile_assignment(
  uuid, uuid, date, date, text
) to authenticated, service_role;

create or replace function public.get_workforce_compliance_control_plane()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_role() is null then
    raise exception 'An active authenticated profile is required'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'people', (
        select count(*) from public.workforce_people p
        where app_private.profile_has_effective_permission(
          auth.uid(), 'workforce.lifecycle.read', 'organization', p.organization_id, now()
        ) or p.profile_id = auth.uid()
      ),
      'activeEpisodes', (
        select count(*) from public.employment_episodes e
        where e.episode_status = 'active'
          and app_private.profile_has_effective_permission(
            auth.uid(), 'workforce.lifecycle.read', 'facility', e.facility_id, now()
          )
      ),
      'openAccessSuspensions', (
        select count(*) from public.employee_access_suspensions s
        where s.effective_to is null
          and app_private.profile_has_effective_permission(
            auth.uid(), 'workforce.lifecycle.read', 'facility', s.facility_id, now()
          )
      ),
      'activeComplianceAssignments', (
        select count(*) from public.employee_compliance_profile_assignments a
        where a.effective_from <= current_date
          and (a.effective_to is null or a.effective_to > current_date)
          and app_private.profile_has_effective_permission(
            auth.uid(), 'workforce.compliance.read', 'facility', a.facility_id, now()
          )
      )
    ),
    'workforceExceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'employeeId', e.employee_id, 'code', e.exception_code,
        'details', e.details, 'status', e.status, 'createdAt', e.created_at
      ) order by e.created_at)
      from public.workforce_backfill_exceptions e
      join public.employees employee on employee.id = e.employee_id
      where e.status = 'open'
        and app_private.profile_has_effective_permission(
          auth.uid(), 'workforce.lifecycle.manage', 'facility', employee.facility_id, now()
        )
    ), '[]'::jsonb),
    'complianceExceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'employeeId', e.employee_id, 'code', e.exception_code,
        'details', e.details, 'status', e.status, 'createdAt', e.created_at
      ) order by e.created_at)
      from public.compliance_profile_resolution_exceptions e
      where e.status = 'open'
        and app_private.profile_has_effective_permission(
          auth.uid(), 'workforce.compliance.manage', 'facility', e.facility_id, now()
        )
    ), '[]'::jsonb),
    'recentTransitions', coalesce((
      select jsonb_agg(to_jsonb(recent) order by recent.created_at desc)
      from (
        select e.id, e.employee_id, e.event_type, e.from_status,
          e.to_status, e.effective_on, e.reason, e.created_at
        from public.employment_lifecycle_events e
        where app_private.profile_has_effective_permission(
          auth.uid(), 'workforce.evidence.read', 'facility', e.facility_id, now()
        )
        order by e.created_at desc limit 50
      ) recent
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_workforce_compliance_control_plane()
from public, anon, authenticated, service_role;
grant execute on function public.get_workforce_compliance_control_plane()
to authenticated;

alter table public.workforce_people enable row level security;
alter table public.workforce_employee_links enable row level security;
alter table public.employment_episodes enable row level security;
alter table public.employment_lifecycle_events enable row level security;
alter table public.employment_lifecycle_dispositions enable row level security;
alter table public.employee_access_suspensions enable row level security;
alter table public.workforce_backfill_exceptions enable row level security;
alter table public.compliance_profile_definitions enable row level security;
alter table public.compliance_profile_requirements enable row level security;
alter table public.compliance_profile_mapping_rules enable row level security;
alter table public.employee_compliance_profile_assignments enable row level security;
alter table public.compliance_profile_resolution_exceptions enable row level security;

create policy workforce_people_select on public.workforce_people
for select to authenticated using (
  (profile_id = (select auth.uid()) and (select public.current_role()) is not null)
  or public.has_effective_permission(
    'workforce.lifecycle.read', 'organization', organization_id
  )
);

create policy workforce_employee_links_select on public.workforce_employee_links
for select to authenticated using (
  exists (
    select 1 from public.workforce_people p
    where p.id = person_id
      and p.profile_id = (select auth.uid())
      and (select public.current_role()) is not null
  )
  or public.has_effective_permission(
    'workforce.lifecycle.read', 'organization', organization_id
  )
);

create policy employment_episodes_select on public.employment_episodes
for select to authenticated using (
  ((select public.current_role()) is not null and public.owns_employee(employee_id))
  or public.has_effective_permission(
    'workforce.lifecycle.read', 'facility', facility_id
  )
);

create policy employment_lifecycle_events_select
on public.employment_lifecycle_events
for select to authenticated using (
  ((select public.current_role()) is not null and public.owns_employee(employee_id))
  or public.has_effective_permission(
    'workforce.evidence.read', 'facility', facility_id
  )
);

create policy employment_lifecycle_dispositions_select
on public.employment_lifecycle_dispositions
for select to authenticated using (
  ((select public.current_role()) is not null and public.owns_employee(employee_id))
  or public.has_effective_permission(
    'workforce.evidence.read', 'facility', facility_id
  )
);

create policy employee_access_suspensions_select
on public.employee_access_suspensions
for select to authenticated using (
  public.has_effective_permission(
    'workforce.lifecycle.read', 'facility', facility_id
  )
);

create policy workforce_backfill_exceptions_select
on public.workforce_backfill_exceptions
for select to authenticated using (
  public.has_effective_permission(
    'workforce.lifecycle.manage', 'organization', organization_id
  )
);
create policy workforce_backfill_exceptions_update
on public.workforce_backfill_exceptions
for update to authenticated using (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and public.has_effective_permission(
    'workforce.lifecycle.manage', 'organization', organization_id
  )
) with check (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and public.has_effective_permission(
    'workforce.lifecycle.manage', 'organization', organization_id
  )
);

create policy compliance_profile_definitions_select
on public.compliance_profile_definitions
for select to authenticated using (
  (organization_id is null and (select public.current_role()) is not null)
  or (organization_id is not null and public.has_effective_permission(
    'workforce.compliance.read', 'organization', organization_id
  ))
);
create policy compliance_profile_definitions_insert
on public.compliance_profile_definitions
for insert to authenticated with check (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and organization_id is not null
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
  and not is_system_managed and not is_mandatory_baseline
);
create policy compliance_profile_definitions_update
on public.compliance_profile_definitions
for update to authenticated using (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and organization_id is not null
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
  and not is_system_managed
) with check (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and organization_id is not null
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
  and not is_system_managed
);

create policy compliance_profile_requirements_select
on public.compliance_profile_requirements
for select to authenticated using (
  exists (
    select 1 from public.compliance_profile_definitions p
    where p.id = profile_definition_id
  )
);
create policy compliance_profile_requirements_insert
on public.compliance_profile_requirements
for insert to authenticated with check (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and exists (
    select 1 from public.compliance_profile_definitions p
    where p.id = profile_definition_id
      and p.organization_id is not null and not p.is_system_managed
      and public.has_effective_permission(
        'workforce.compliance.manage', 'organization', p.organization_id
      )
  )
);
create policy compliance_profile_requirements_update
on public.compliance_profile_requirements
for update to authenticated using (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and exists (
    select 1 from public.compliance_profile_definitions p
    where p.id = profile_definition_id
      and p.organization_id is not null and not p.is_system_managed
      and public.has_effective_permission(
        'workforce.compliance.manage', 'organization', p.organization_id
      )
  )
) with check (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and exists (
    select 1 from public.compliance_profile_definitions p
    where p.id = profile_definition_id
      and p.organization_id is not null and not p.is_system_managed
      and public.has_effective_permission(
        'workforce.compliance.manage', 'organization', p.organization_id
      )
  )
);

create policy compliance_profile_mapping_rules_select
on public.compliance_profile_mapping_rules
for select to authenticated using (
  public.has_effective_permission(
    'workforce.compliance.read', 'organization', organization_id
  )
);
create policy compliance_profile_mapping_rules_insert
on public.compliance_profile_mapping_rules
for insert to authenticated with check (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
);
create policy compliance_profile_mapping_rules_update
on public.compliance_profile_mapping_rules
for update to authenticated using (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
) with check (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
);

create policy employee_compliance_assignments_select
on public.employee_compliance_profile_assignments
for select to authenticated using (
  (
    (select public.current_role()) is not null
    and exists (
      select 1 from public.employees e
      where e.id = employee_id and e.profile_id = (select auth.uid())
    )
  )
  or public.has_effective_permission(
    'workforce.compliance.read', 'facility', facility_id
  )
);

create policy compliance_resolution_exceptions_select
on public.compliance_profile_resolution_exceptions
for select to authenticated using (
  public.has_effective_permission(
    'workforce.compliance.manage', 'facility', facility_id
  )
);
create policy compliance_resolution_exceptions_update
on public.compliance_profile_resolution_exceptions
for update to authenticated using (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and public.has_effective_permission(
    'workforce.compliance.manage', 'facility', facility_id
  )
) with check (
  coalesce(auth.jwt()->>'aal', '') = 'aal2'
  and public.has_effective_permission(
    'workforce.compliance.manage', 'facility', facility_id
  )
);

revoke all on table public.workforce_people,
  public.workforce_employee_links,
  public.employment_episodes,
  public.employment_lifecycle_events,
  public.employment_lifecycle_dispositions,
  public.employee_access_suspensions,
  public.workforce_backfill_exceptions,
  public.compliance_profile_definitions,
  public.compliance_profile_requirements,
  public.compliance_profile_mapping_rules,
  public.employee_compliance_profile_assignments,
  public.compliance_profile_resolution_exceptions
from public, anon, authenticated, service_role;

grant select on table public.workforce_people,
  public.workforce_employee_links,
  public.employment_episodes,
  public.employment_lifecycle_events,
  public.employment_lifecycle_dispositions,
  public.employee_access_suspensions,
  public.workforce_backfill_exceptions,
  public.compliance_profile_definitions,
  public.compliance_profile_requirements,
  public.compliance_profile_mapping_rules,
  public.employee_compliance_profile_assignments,
  public.compliance_profile_resolution_exceptions
to authenticated;
grant update on table public.workforce_backfill_exceptions,
  public.compliance_profile_resolution_exceptions
to authenticated;
grant insert, update on table public.compliance_profile_definitions,
  public.compliance_profile_requirements,
  public.compliance_profile_mapping_rules
to authenticated;

grant select on table public.workforce_people,
  public.workforce_employee_links,
  public.employment_episodes,
  public.employment_lifecycle_events,
  public.employment_lifecycle_dispositions,
  public.employee_access_suspensions,
  public.workforce_backfill_exceptions,
  public.compliance_profile_definitions,
  public.compliance_profile_requirements,
  public.compliance_profile_mapping_rules,
  public.employee_compliance_profile_assignments,
  public.compliance_profile_resolution_exceptions
to service_role;

revoke update, delete, truncate on table public.employment_lifecycle_events,
  public.employment_lifecycle_dispositions
from authenticated, service_role;

insert into app_private.audit_entity_manifest(
  table_name, audit_mode, contains_regulated_data, rationale
)
select table_name, audit_mode, true, rationale
from (values
  ('workforce_people', 'row_trigger', 'Phase 2 regulated workforce identity'),
  ('workforce_employee_links', 'row_trigger', 'Phase 2 effective person-employment link'),
  ('employment_episodes', 'row_trigger', 'Phase 2 effective employment episode'),
  ('employment_lifecycle_events', 'domain_evidence', 'Append-only workforce lifecycle evidence'),
  ('employment_lifecycle_dispositions', 'domain_evidence', 'Append-only lifecycle dependent disposition evidence'),
  ('employee_access_suspensions', 'row_trigger', 'Phase 2 access suspension governance'),
  ('workforce_backfill_exceptions', 'row_trigger', 'Phase 2 visible workforce migration exceptions'),
  ('compliance_profile_definitions', 'row_trigger', 'Phase 2 governed compliance profile'),
  ('compliance_profile_requirements', 'row_trigger', 'Phase 2 governed compliance requirements'),
  ('compliance_profile_mapping_rules', 'row_trigger', 'Phase 2 governed profile mapping'),
  ('employee_compliance_profile_assignments', 'row_trigger', 'Phase 2 effective profile assignment'),
  ('compliance_profile_resolution_exceptions', 'row_trigger', 'Phase 2 visible compliance exceptions')
) as v(table_name, audit_mode, rationale)
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'workforce_people', 'workforce_employee_links', 'employment_episodes',
    'employee_access_suspensions', 'workforce_backfill_exceptions',
    'compliance_profile_definitions', 'compliance_profile_requirements',
    'compliance_profile_mapping_rules', 'employee_compliance_profile_assignments',
    'compliance_profile_resolution_exceptions'
  ] loop
    execute format('create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()', v_table);
  end loop;
end;
$$;

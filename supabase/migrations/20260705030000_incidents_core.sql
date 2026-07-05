-- Incident & complaint tracking. Every facility type CareMetric Train serves (PCH/ALR/NH/HHA/HOS/GH)
-- carries a mandatory incident-reporting duty with a hard external-notification deadline (PA
-- DHS reportable incidents, CMS F609 abuse/neglect self-reporting, ODP Enterprise Incident
-- Management) -- none of which lived in the app before now.
--
-- CareMetric Train has no resident/EHR data model at all (it's a staff-training app, not a clinical
-- records system) -- resident_identifier below is deliberately a free-text field, never a FK to
-- a resident entity that doesn't and shouldn't exist here.
--
-- organization_id/facility_id on `incidents` are client-supplied and RLS-validated directly
-- (like training_classes/alerts) rather than stamped from a parent row -- there's no single
-- employee or other record an incident is "owned by" to derive scope from.

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  incident_type text not null check (incident_type in (
    'death','elopement','abuse_allegation','neglect_allegation','medication_error',
    'significant_injury','assault','fire','environmental_emergency','other')),
  occurred_at timestamptz not null,
  reported_at timestamptz not null default now(),
  reported_by_profile_id uuid references public.profiles(id),
  resident_identifier text,
  location_detail text,
  narrative text not null,
  severity text not null default 'moderate' check (severity in ('minor','moderate','major','critical')),
  status text not null default 'reported' check (status in ('reported','investigating','closed')),
  investigator_profile_id uuid references public.profiles(id),
  investigator_name text,
  investigation_started_at timestamptz,
  investigation_findings text,
  root_cause text,
  closed_at timestamptz,
  closed_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incidents_org_idx on public.incidents(organization_id);
create index incidents_facility_idx on public.incidents(facility_id);

create trigger set_updated_at before update on public.incidents
  for each row execute function public.set_updated_at();

create trigger audit_log after insert or update or delete on public.incidents
  for each row execute function public.audit_log_trigger();

-- Staff involved/witnesses. A pure detail/join table (like training_class_attendees), so no
-- audit_log trigger of its own -- the parent incident's audit trail covers the incident's
-- lifecycle, and this table's own inserts/deletes aren't independently audit-worthy.
create table public.incident_staff_involved (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  involvement_type text not null check (involvement_type in ('involved_party','witness','first_responder','reporter')),
  statement text,
  created_at timestamptz not null default now()
);
create index incident_staff_involved_org_idx on public.incident_staff_involved(organization_id);
create index incident_staff_involved_incident_idx on public.incident_staff_involved(incident_id);
create index incident_staff_involved_employee_idx on public.incident_staff_involved(employee_id);

-- Required external notifications (state hotline, family/guardian, law enforcement, licensing
-- agency) with a due-by timer and completion tracking.
create table public.incident_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  notification_type text not null check (notification_type in (
    'state_hotline','family_guardian','law_enforcement','licensing_agency','other')),
  due_at timestamptz not null,
  completed_at timestamptz,
  completed_by_profile_id uuid references public.profiles(id),
  notification_method text,
  reference_number text,
  notes text,
  status text not null default 'pending' check (status in ('pending','completed','overdue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incident_notifications_org_idx on public.incident_notifications(organization_id);
create index incident_notifications_incident_idx on public.incident_notifications(incident_id);

create trigger audit_log after insert or update or delete on public.incident_notifications
  for each row execute function public.audit_log_trigger();

-- Evidence documents (photos, witness statements, investigation reports). No employee_id --
-- unlike credential documents, an incident document has no single-person owner.
create table public.incident_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  storage_bucket text not null default 'incident-documents',
  storage_path text not null,
  file_name text not null,
  file_type text not null,
  file_size integer,
  document_label text,
  uploaded_by_profile_id uuid references public.profiles(id),
  retain_until date,
  created_at timestamptz not null default now()
);
create index incident_documents_org_idx on public.incident_documents(organization_id);
create index incident_documents_incident_idx on public.incident_documents(incident_id);

create trigger audit_log after insert or update or delete on public.incident_documents
  for each row execute function public.audit_log_trigger();

-- Corrective actions -- polymorphic from the start (Phase 3 adds an inspection_event_id branch
-- for facility-inspection findings, reusing this same table rather than duplicating it).
create table public.corrective_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  incident_id uuid references public.incidents(id) on delete cascade,
  description text not null,
  owner_profile_id uuid references public.profiles(id),
  owner_name text,
  due_date date not null,
  completed_date date,
  status text not null default 'open' check (status in ('open','in_progress','completed','overdue','cancelled')),
  verification_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corrective_actions_one_parent_check check (num_nonnulls(incident_id) = 1)
);
create index corrective_actions_org_idx on public.corrective_actions(organization_id);
create index corrective_actions_incident_idx on public.corrective_actions(incident_id);

create trigger set_updated_at before update on public.corrective_actions
  for each row execute function public.set_updated_at();

create trigger audit_log after insert or update or delete on public.corrective_actions
  for each row execute function public.audit_log_trigger();

-- Scope-stamping triggers, same rationale as stamp_scope_from_employee (a client-controlled
-- facility_id on these child tables could otherwise defeat is_assigned_to_facility() RLS).
create or replace function public.stamp_scope_from_incident()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  select organization_id, facility_id into v_org, v_fac from public.incidents where id = new.incident_id;
  if v_org is null then
    raise exception 'incident % not found', new.incident_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_fac;
  return new;
end;
$function$;

create trigger stamp_scope before insert or update on public.incident_staff_involved
  for each row execute function public.stamp_scope_from_incident();
create trigger stamp_scope before insert or update on public.incident_notifications
  for each row execute function public.stamp_scope_from_incident();
create trigger stamp_scope before insert on public.incident_documents
  for each row execute function public.stamp_scope_from_incident();

-- Only an incident_id branch exists so far -- Phase 3 will `create or replace` this to add an
-- inspection_event_id branch once inspection_events exists.
create or replace function public.stamp_scope_from_corrective_action_parent()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  if new.incident_id is not null then
    select organization_id, facility_id into v_org, v_fac from public.incidents where id = new.incident_id;
    if v_org is null then
      raise exception 'incident % not found', new.incident_id using errcode = 'foreign_key_violation';
    end if;
  else
    raise exception 'corrective_actions row must reference exactly one parent';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_fac;
  return new;
end;
$function$;

create trigger stamp_scope before insert or update on public.corrective_actions
  for each row execute function public.stamp_scope_from_corrective_action_parent();

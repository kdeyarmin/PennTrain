-- Tier 3.2 (ROADMAP.md): Violation -> Plan-of-Correction workflow. dhs_violations holds a
-- cited violation from an actual DHS inspection report (distinct from inspection_items/
-- inspection_events, which track this org's OWN equipment/fire-drill upkeep, not a surveyor's
-- findings). corrective_actions -- already polymorphic on incident_id/inspection_event_id per
-- its own Phase-2 comment anticipating "facility-inspection findings" -- gets a third parent
-- branch here rather than a new table, so a POC's corrective tasks reuse the exact same
-- ownership/due-date/retraining-link machinery incidents already use.
create table public.dhs_violations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  citation_topic_id uuid references public.dhs_citation_topics(id),
  citation_ref text,
  inspection_date date not null,
  surveyor_name text,
  description text not null,
  severity text not null default 'moderate' check (severity in ('low', 'moderate', 'high')),
  status text not null default 'open' check (status in ('open', 'poc_submitted', 'corrected', 'verified')),
  poc_due_date date,
  poc_submitted_at timestamptz,
  verified_at timestamptz,
  verified_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dhs_violations_org_idx on public.dhs_violations(organization_id);
create index dhs_violations_facility_idx on public.dhs_violations(facility_id);

create trigger set_updated_at before update on public.dhs_violations
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.dhs_violations
  for each row execute function public.audit_log_trigger();

create table public.violation_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  violation_id uuid not null references public.dhs_violations(id) on delete cascade,
  storage_bucket text not null default 'violation-documents',
  storage_path text not null,
  file_name text not null,
  file_type text not null,
  file_size integer,
  document_label text,
  document_type text not null default 'evidence' check (document_type in ('evidence', 'poc')),
  uploaded_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index violation_documents_org_idx on public.violation_documents(organization_id);
create index violation_documents_violation_idx on public.violation_documents(violation_id);

create trigger audit_log after insert or update or delete on public.violation_documents
  for each row execute function public.audit_log_trigger();

create or replace function public.stamp_scope_from_violation()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  select organization_id, facility_id into v_org, v_fac from public.dhs_violations where id = new.violation_id;
  if v_org is null then
    raise exception 'violation % not found', new.violation_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_fac;
  return new;
end;
$function$;
create trigger stamp_scope before insert on public.violation_documents
  for each row execute function public.stamp_scope_from_violation();

-- Widen corrective_actions to a third parent (mirrors 20260705040200_corrective_actions_inspection_link.sql
-- widening it from incident-only to incident-or-inspection).
alter table public.corrective_actions add column violation_id uuid references public.dhs_violations(id) on delete cascade;
create index corrective_actions_violation_idx on public.corrective_actions(violation_id);

alter table public.corrective_actions drop constraint corrective_actions_one_parent_check;
alter table public.corrective_actions add constraint corrective_actions_one_parent_check
  check (num_nonnulls(incident_id, inspection_event_id, violation_id) = 1);

create or replace function public.stamp_scope_from_corrective_action_parent()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  if new.incident_id is not null then
    select organization_id, facility_id into v_org, v_fac from public.incidents where id = new.incident_id;
    if v_org is null then
      raise exception 'incident % not found', new.incident_id using errcode = 'foreign_key_violation';
    end if;
  elsif new.inspection_event_id is not null then
    select organization_id, facility_id into v_org, v_fac from public.inspection_events where id = new.inspection_event_id;
    if v_org is null then
      raise exception 'inspection event % not found', new.inspection_event_id using errcode = 'foreign_key_violation';
    end if;
  elsif new.violation_id is not null then
    select organization_id, facility_id into v_org, v_fac from public.dhs_violations where id = new.violation_id;
    if v_org is null then
      raise exception 'violation % not found', new.violation_id using errcode = 'foreign_key_violation';
    end if;
  else
    raise exception 'corrective_actions row must reference exactly one parent';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_fac;
  return new;
end;
$function$;

create extension if not exists pg_trgm;

-- The full OIG LEIE (and, if configured, SAM.gov) exclusion list -- replaced wholesale on each
-- monthly ingestion run (source-scoped delete + bulk insert), not incrementally diffed. Not
-- organization-scoped: this is one shared public federal dataset, not per-tenant data. No RLS
-- policy is defined below (deny-by-default), so this table is reachable only via the
-- SECURITY DEFINER matching function and the service-role ingestion job -- no authenticated role
-- has any legitimate reason to browse ~80k raw exclusion records directly.
create table public.exclusion_list_entries (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('oig_leie','sam_exclusions')),
  last_name text,
  first_name text,
  middle_name text,
  business_name text,
  dob date,
  exclusion_type text,
  exclusion_date date,
  reinstate_date date,
  waiver_date date,
  npi text,
  upin text,
  raw jsonb,
  imported_at timestamptz not null default now()
);
alter table public.exclusion_list_entries enable row level security;

create index exclusion_list_entries_source_idx on public.exclusion_list_entries(source);
create index exclusion_list_entries_last_name_trgm_idx on public.exclusion_list_entries using gin (upper(last_name) gin_trgm_ops);
create index exclusion_list_entries_first_name_trgm_idx on public.exclusion_list_entries using gin (upper(first_name) gin_trgm_ops);

-- The review queue: candidate roster/exclusion-list matches an admin must confirm or dismiss.
-- Fuzzy name matching has real false-positive risk (common names, no DOB on the roster to
-- cross-check) -- this table is deliberately a queue for human review, never an automatic block.
create table public.exclusion_screening_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  exclusion_list_entry_id uuid not null references public.exclusion_list_entries(id) on delete cascade,
  source text not null check (source in ('oig_leie','sam_exclusions')),
  match_score numeric not null,
  matched_name text not null,
  status text not null default 'pending_review' check (status in ('pending_review','confirmed_exclusion','false_positive')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_notes text,
  created_at timestamptz not null default now(),
  constraint exclusion_screening_matches_uk unique (employee_id, exclusion_list_entry_id)
);
create index exclusion_screening_matches_org_idx on public.exclusion_screening_matches(organization_id);
create index exclusion_screening_matches_facility_idx on public.exclusion_screening_matches(facility_id);
create index exclusion_screening_matches_status_idx on public.exclusion_screening_matches(status) where status = 'pending_review';

alter table public.exclusion_screening_matches enable row level security;

create policy exclusion_screening_matches_select on public.exclusion_screening_matches for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);

-- No insert policy for authenticated -- rows are created only by the SECURITY DEFINER matching
-- function (service-role/cron context), never directly by a client.
create policy exclusion_screening_matches_update on public.exclusion_screening_matches for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

create trigger audit_log after insert or update or delete on public.exclusion_screening_matches
  for each row execute function public.audit_log_trigger();

-- Widen the alerts feed so a new match surfaces on the existing Alerts dashboard the same way
-- credential/training/incident alerts already do.
alter table public.alerts drop constraint alerts_alert_type_check;
alter table public.alerts add constraint alerts_alert_type_check check (alert_type in (
  'due_90','due_60','due_30','due_14','due_7','overdue','missing_document',
  'course_assigned','certificate_expiring','external_cert_pending_review',
  'competency_due','training_plan_assigned','inservice_scheduled','credential_expiring',
  'exclusion_match_found'));

alter table public.alerts add column exclusion_screening_match_id uuid references public.exclusion_screening_matches(id) on delete cascade;
create index alerts_exclusion_screening_match_idx on public.alerts(exclusion_screening_match_id);

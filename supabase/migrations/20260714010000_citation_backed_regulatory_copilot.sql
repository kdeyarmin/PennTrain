-- Priority 16: citation-backed regulatory AI copilot.
--
-- The copilot is deliberately a read-only synthesis surface. It may record its
-- own immutable audit receipt, but it has no command path to findings, plans,
-- resident records, incident reportability, or scheduling eligibility.

insert into public.platform_settings (key, value)
values ('ai_compliance_copilot_enabled', 'false'::jsonb)
on conflict (key) do nothing;

create table public.compliance_copilot_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  intent text not null check (intent in (
    'employee_blocked',
    'due_next_30_days',
    'missing_medical_evaluations',
    'citation_evidence',
    'recurring_citations',
    'readiness_score',
    'draft_plan_of_correction',
    'mock_survey_request',
    'overdue_support_plans',
    'effectiveness_reviews'
  )),
  question text not null check (length(btrim(question)) between 3 and 2000),
  subject_type text check (subject_type in ('employee', 'violation', 'citation')),
  subject_reference text,
  jurisdiction_code text not null check (length(btrim(jurisdiction_code)) between 2 and 50),
  facility_type text not null check (facility_type in ('PCH', 'ALR')),
  as_of_date date not null,
  determination_kind text not null check (determination_kind in (
    'recommendation', 'confirmed_system_determination'
  )),
  status text not null check (status in ('completed', 'failed')),
  model text,
  rule_sources jsonb not null default '[]'::jsonb check (jsonb_typeof(rule_sources) = 'array'),
  evidence_used jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_used) = 'array'),
  missing_information jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_information) = 'array'),
  response jsonb not null default '{}'::jsonb check (jsonb_typeof(response) = 'object'),
  safeguards jsonb not null check (
    jsonb_typeof(safeguards) = 'object'
    and safeguards @> '{"readOnly":true,"humanConfirmationRequired":true}'::jsonb
  ),
  request_checksum_sha256 text not null check (request_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  response_checksum_sha256 text check (response_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  check (
    (status = 'completed'
      and model is not null
      and response <> '{}'::jsonb
      and response_checksum_sha256 is not null
      and error_message is null)
    or
    (status = 'failed'
      and length(btrim(coalesce(error_message, ''))) >= 3
      and response = '{}'::jsonb
      and response_checksum_sha256 is null)
  ),
  check ((subject_type is null) = (subject_reference is null))
);

create index compliance_copilot_runs_facility_history_idx
  on public.compliance_copilot_runs(facility_id, created_at desc);
create index compliance_copilot_runs_requester_history_idx
  on public.compliance_copilot_runs(requested_by, created_at desc);
create index compliance_copilot_runs_intent_idx
  on public.compliance_copilot_runs(organization_id, intent, created_at desc);

create trigger prevent_compliance_copilot_run_mutation
before update or delete on public.compliance_copilot_runs
for each row execute function app_private.prevent_phase5_evidence_mutation();

alter table public.compliance_copilot_runs enable row level security;

create policy compliance_copilot_runs_select
on public.compliance_copilot_runs
for select to authenticated
using (
  (select public.current_role()) in ('platform_admin', 'org_admin', 'facility_manager', 'auditor')
  and app_private.admission_row_visible(organization_id, facility_id)
);

revoke all on table public.compliance_copilot_runs
from public, anon, authenticated, service_role;
grant select on table public.compliance_copilot_runs to authenticated;
grant select, insert on table public.compliance_copilot_runs to service_role;

comment on table public.compliance_copilot_runs is
  'Immutable, facility-scoped receipts for citation-backed AI synthesis. The table records no authority to mutate operational compliance state.';
comment on column public.compliance_copilot_runs.rule_sources is
  'Exact governed rule-version snapshots cited by the response, including jurisdiction, authority, source URI, effective dates, and version.';
comment on column public.compliance_copilot_runs.evidence_used is
  'Facility-scoped system evidence provided to the model and referenced by stable evidence IDs.';
comment on column public.compliance_copilot_runs.determination_kind is
  'Labels the response as a recommendation or a confirmed snapshot of existing system data; neither grants approval authority.';

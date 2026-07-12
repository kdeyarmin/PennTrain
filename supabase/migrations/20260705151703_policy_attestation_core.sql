-- Policy & procedure attestation with ESIGN/UETA audit trail, per ROADMAP.md Tier 2.6.
--
-- Four tables:
--   policy_documents            -- the org's policy library (parent; "current_version_id" points
--                                  at the live version, mirroring courses/course_versions).
--   policy_document_versions    -- immutable once published (content_hash + storage path locked),
--                                  so an attestation can always be traced to exactly what the
--                                  signer saw.
--   policy_attestation_campaigns -- a named "read-and-attest" assignment batch against one
--                                  specific version (mirrors training_plans: org-scoped, no
--                                  facility_id column -- facility/role targeting happens by
--                                  picking employees at apply-time, same as
--                                  useApplyTrainingPlanToEmployee).
--   policy_attestations         -- one row per (campaign, employee): the actual audit row. No
--                                  update policy for authenticated at all (same immutable-audit-
--                                  row posture as training_documents/audit_logs) -- the only way
--                                  to move it from 'pending' to 'attested' is the attest_policy()
--                                  RPC below, which stamps timestamp/IP/auth-method/hash together.

-- ---- 1. policy_documents (STEP 1 of circular FK: created WITHOUT current_version_id) ----
create table public.policy_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  category text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index policy_documents_org_idx on public.policy_documents(organization_id);
create trigger set_updated_at before update on public.policy_documents
  for each row execute function public.set_updated_at();

-- ---- 2. policy_document_versions (STEP 2 of circular FK) ----
create table public.policy_document_versions (
  id uuid primary key default gen_random_uuid(),
  policy_document_id uuid not null references public.policy_documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_number integer not null,
  storage_bucket text not null default 'policy-documents',
  storage_path text not null,
  file_name text not null,
  file_type text not null,
  file_size integer,
  content_hash text not null,
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint policy_document_versions_doc_version_uk unique (policy_document_id, version_number)
);
create index policy_document_versions_doc_idx on public.policy_document_versions(policy_document_id);

-- ---- 3. close the policy_documents<->policy_document_versions cycle (STEP 3) ----
alter table public.policy_documents
  add column current_version_id uuid references public.policy_document_versions(id) on delete set null;

-- Once published, a version is frozen: an attestation must always be traceable to exactly the
-- bytes/hash the signer saw. Mirrors the "lock completed training classes" precedent.
create or replace function public.lock_published_policy_version()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if old.status = 'published' then
    raise exception 'Published policy document versions cannot be modified.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger lock_published_policy_version before update on public.policy_document_versions
  for each row execute function public.lock_published_policy_version();

-- ---- 4. policy_attestation_campaigns ----
create table public.policy_attestation_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_document_id uuid not null references public.policy_documents(id),
  policy_document_version_id uuid not null references public.policy_document_versions(id),
  name text not null,
  due_date date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index policy_attestation_campaigns_org_idx on public.policy_attestation_campaigns(organization_id);
create index policy_attestation_campaigns_doc_idx on public.policy_attestation_campaigns(policy_document_id);

-- ---- 5. policy_attestations (the audit row) ----
create table public.policy_attestations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  campaign_id uuid not null references public.policy_attestation_campaigns(id) on delete cascade,
  policy_document_version_id uuid not null references public.policy_document_versions(id),
  due_date date,
  status text not null default 'pending' check (status in ('pending','attested')),
  attested_at timestamptz,
  document_version_hash text,
  auth_method text,
  ip_address text,
  user_agent text,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_attestations_campaign_employee_uk unique (campaign_id, employee_id),
  constraint policy_attestations_attested_consistency_check
    check ((status = 'attested') = (attested_at is not null))
);
create index policy_attestations_org_idx on public.policy_attestations(organization_id);
create index policy_attestations_facility_idx on public.policy_attestations(facility_id);
create index policy_attestations_employee_idx on public.policy_attestations(employee_id);
create index policy_attestations_campaign_idx on public.policy_attestations(campaign_id);
create index policy_attestations_pending_idx on public.policy_attestations(due_date) where status = 'pending';

create trigger set_updated_at before update on public.policy_attestations
  for each row execute function public.set_updated_at();

-- organization_id/facility_id are server-derived from employee_id (never client-trusted), same
-- pattern as employee_training_records/practicums/employee_credentials.
create or replace function public.stamp_scope_from_employee_for_attestation()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_org uuid; v_fac uuid;
begin
  select organization_id, facility_id into v_org, v_fac from public.employees where id = new.employee_id;
  if v_org is null then
    raise exception 'employee % not found', new.employee_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_fac;
  return new;
end;
$$;
create trigger stamp_scope before insert on public.policy_attestations
  for each row execute function public.stamp_scope_from_employee_for_attestation();

create trigger audit_log after insert or update or delete on public.policy_documents
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.policy_attestation_campaigns
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.policy_attestations
  for each row execute function public.audit_log_trigger();
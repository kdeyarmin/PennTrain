-- Training types (configurable compliance requirement catalog)
create table public.training_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  code text not null,
  name text not null,
  category text not null,
  description text,
  applies_to_facility_type text not null default 'BOTH' check (applies_to_facility_type in ('PCH','ALR','BOTH')),
  applies_to_administers_meds boolean,
  applies_to_trainers boolean,
  renewal_interval_days integer,
  warning_days_default integer not null default 90,
  document_required boolean not null default false,
  is_system_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  required_hours numeric(6,2),
  accepted_evidence_types jsonb,
  admin_approval_required boolean not null default false,
  citation_note text,
  required_roles_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_types_organization_id_idx on public.training_types(organization_id);
create trigger set_updated_at before update on public.training_types
  for each row execute function public.set_updated_at();

-- Employee training records (per-employee compliance status per training type)
create table public.employee_training_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  training_type_id uuid not null references public.training_types(id),
  completion_date date,
  due_date date,
  status text not null default 'missing'
    check (status in ('compliant','due_soon','expired','missing','not_applicable','pending_review')),
  trainer_name text,
  trainer_credentials text,
  training_provider text,
  certificate_number text,
  score numeric(5,2),
  hours numeric(6,2),
  notes text,
  document_required boolean not null default false,
  completion_method text check (completion_method in ('in_person','online','hybrid','manual_entry')),
  verified_by_profile_id uuid references public.profiles(id),
  verified_at timestamptz,
  approval_status text check (approval_status in ('pending','approved','rejected')),
  review_comments text,
  external_certificate_document_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employee_training_records_org_idx on public.employee_training_records(organization_id);
create index employee_training_records_facility_idx on public.employee_training_records(facility_id);
create index employee_training_records_employee_idx on public.employee_training_records(employee_id);
create trigger set_updated_at before update on public.employee_training_records
  for each row execute function public.set_updated_at();

-- Annual training-hour rollups
create table public.employee_training_hour_buckets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  training_year integer not null,
  required_hours numeric(6,2) not null default 12,
  completed_hours numeric(6,2) not null default 0,
  status text not null default 'incomplete' check (status in ('compliant','due_soon','incomplete','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, training_year)
);
create index employee_training_hour_buckets_org_idx on public.employee_training_hour_buckets(organization_id);
create trigger set_updated_at before update on public.employee_training_hour_buckets
  for each row execute function public.set_updated_at();

-- Medication administration practicums (PA-specific annual observation/MAR review)
create table public.practicums (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid not null references public.employees(id) on delete cascade,
  practicum_year integer not null,
  completion_date date,
  observed_by text,
  mar_review_completed boolean not null default false,
  direct_observation_completed boolean not null default false,
  remediation_required boolean not null default false,
  remediation_notes text,
  notes text,
  due_date date,
  status text not null default 'missing' check (status in ('compliant','due_soon','expired','missing')),
  verified_by_profile_id uuid references public.profiles(id),
  verified_at timestamptz,
  reminder_days integer not null default 30,
  certificate_document_id uuid,
  observation_document_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index practicums_org_idx on public.practicums(organization_id);
create index practicums_facility_idx on public.practicums(facility_id);
create index practicums_employee_idx on public.practicums(employee_id);
create trigger set_updated_at before update on public.practicums
  for each row execute function public.set_updated_at();

-- Documents (uploaded evidence: certificates, rosters, practicum forms, transcripts, etc.)
create table public.training_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id),
  employee_id uuid references public.employees(id),
  training_record_id uuid references public.employee_training_records(id),
  file_name text not null,
  storage_bucket text not null,
  storage_path text not null,
  file_type text not null,
  file_size integer,
  uploaded_by_profile_id uuid references public.profiles(id),
  document_type text not null default 'other'
    check (document_type in ('certificate','roster','practicum_form','transcript','external_certificate','competency_attachment','other')),
  created_at timestamptz not null default now()
);
create index training_documents_org_idx on public.training_documents(organization_id);
create index training_documents_facility_idx on public.training_documents(facility_id);

-- Now that training_documents exists, wire up the deferred circular references.
alter table public.employee_training_records
  add constraint employee_training_records_external_cert_doc_fkey
  foreign key (external_certificate_document_id) references public.training_documents(id);

alter table public.practicums
  add constraint practicums_certificate_document_fkey
  foreign key (certificate_document_id) references public.training_documents(id);
alter table public.practicums
  add constraint practicums_observation_document_fkey
  foreign key (observation_document_id) references public.training_documents(id);

-- Alerts / notifications
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id),
  employee_id uuid references public.employees(id),
  training_record_id uuid references public.employee_training_records(id),
  practicum_id uuid references public.practicums(id),
  course_assignment_id uuid,
  certificate_id uuid,
  competency_record_id uuid,
  alert_type text not null check (alert_type in (
    'due_90','due_60','due_30','due_14','due_7','overdue','missing_document',
    'course_assigned','certificate_expiring','external_cert_pending_review',
    'competency_due','training_plan_assigned','inservice_scheduled')),
  title text not null,
  message text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  status text not null default 'open' check (status in ('open','dismissed','resolved')),
  assigned_to_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index alerts_org_idx on public.alerts(organization_id);
create index alerts_facility_idx on public.alerts(facility_id);

-- Audit logs
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  actor_profile_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id text,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs(organization_id, created_at desc);

-- Live training classes (in-service sessions)
create table public.training_classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id),
  trainer_profile_id uuid not null references public.profiles(id),
  training_type_id uuid not null references public.training_types(id),
  class_name text not null,
  class_date date not null,
  location text,
  duration_hours numeric(4,2) not null default 1,
  status text not null default 'draft' check (status in ('draft','completed','cancelled')),
  notes text,
  roster_document_id uuid references public.training_documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_classes_org_idx on public.training_classes(organization_id);
create index training_classes_facility_idx on public.training_classes(facility_id);
create trigger set_updated_at before update on public.training_classes
  for each row execute function public.set_updated_at();

create table public.training_class_attendees (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.training_classes(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  attended boolean not null default true,
  training_record_id uuid references public.employee_training_records(id),
  created_at timestamptz not null default now()
);
create index training_class_attendees_class_idx on public.training_class_attendees(class_id);

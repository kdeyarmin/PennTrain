-- Compliance Command Center (task Area 1): a generic, user-definable facility compliance
-- requirement register. Existing compliance tracking is domain-split and hardcoded --
-- `training_types`/`employee_training_records` (training only), `resident_compliance_items`
-- (a fixed 5-value RASP enum), `inspection_items` (a fixed equipment enum), `compliance_profile_*`
-- (employee credential/training baselines), and `work_items` (a downstream remediation queue that
-- always derives from a source event). None let an authorized user define an arbitrary recurring
-- facility obligation (fire-drill log, required posting, EP annual review, licensing renewal,
-- policy review) organized by facility/building/category/regulation/responsible-person, with the
-- full requested status lifecycle, evidence, notes, completion verification, history, reminders,
-- supervisor escalation, and cross-facility templates. This migration adds that register.
--
-- Rollback: this migration is additive (new tables, functions, storage bucket, one cron job, and a
-- widened notifications CHECK). To reverse, see the paired down migration in
-- docs/migrations/20260726000000_compliance_command_center_rollback.sql -- it drops the cron job,
-- the four tables (CASCADE), the storage bucket + policies, restores the prior notifications CHECK,
-- and drops the helper functions. No pre-existing table is altered destructively.

------------------------------------------------------------------------------------------------
-- 1. Requirement definitions (and reusable cross-facility templates).
------------------------------------------------------------------------------------------------
-- A live requirement has a facility (is_template=false). A template has no facility (is_template=true)
-- and is copied into one or more facilities as live requirements via copy_compliance_requirement.
create table public.compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete cascade,
  building_id uuid references public.facility_buildings(id) on delete set null,
  category text not null check (category in (
    'resident_records', 'assessments_support_plans', 'employee_records', 'training_credentials',
    'medication_admin_training', 'fire_emergency_preparedness', 'physical_site_inspections',
    'incident_reporting', 'quality_management', 'resident_agreements', 'required_postings',
    'policies_procedures', 'licensing_survey_prep', 'other'
  )),
  title text not null check (length(trim(title)) between 1 and 200),
  description text,
  regulation_citation text,
  -- Chapter tag so the register can filter/score by PA 55 Pa. Code Ch. 2600 (PCH) vs Ch. 2800 (ALF/ALR).
  regulation_chapter text check (regulation_chapter in ('2600', '2800', 'other')),
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  recurrence text not null default 'annual'
    check (recurrence in ('one_time', 'monthly', 'quarterly', 'semiannual', 'annual', 'custom')),
  custom_interval_days integer check (custom_interval_days is null or custom_interval_days between 1 and 3650),
  anchor_date date,
  warning_days integer not null default 14 check (warning_days between 0 and 365),
  requires_evidence boolean not null default true,
  requires_review boolean not null default false,
  is_template boolean not null default false,
  source_template_id uuid references public.compliance_requirements(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A template is org-scoped (no facility); a live requirement must have a facility.
  constraint compliance_requirement_template_scope
    check ((is_template and facility_id is null) or (not is_template and facility_id is not null)),
  -- A custom cadence needs an interval; the fixed cadences must not carry one.
  constraint compliance_requirement_custom_interval
    check ((recurrence = 'custom') = (custom_interval_days is not null))
);
create index compliance_requirements_org_idx on public.compliance_requirements(organization_id);
create index compliance_requirements_facility_idx on public.compliance_requirements(facility_id) where facility_id is not null;
create index compliance_requirements_building_idx on public.compliance_requirements(building_id) where building_id is not null;
create index compliance_requirements_responsible_idx on public.compliance_requirements(responsible_profile_id) where responsible_profile_id is not null;
create index compliance_requirements_active_idx on public.compliance_requirements(organization_id, is_active) where not is_template;
create index compliance_requirements_template_idx on public.compliance_requirements(organization_id) where is_template;
-- One live copy of a given template per facility: makes copy_compliance_requirement's anti-duplicate
-- deploy atomic (ON CONFLICT) instead of a race-prone read-then-insert.
create unique index compliance_requirements_template_facility_uniq
  on public.compliance_requirements(source_template_id, facility_id) where source_template_id is not null;

alter table public.compliance_requirements enable row level security;
grant select on public.compliance_requirements to authenticated;

create trigger set_updated_at before update on public.compliance_requirements
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.compliance_requirements
  for each row execute function public.audit_log_trigger();

------------------------------------------------------------------------------------------------
-- 2. Requirement instances: one due occurrence per cycle, generated from a live requirement.
------------------------------------------------------------------------------------------------
create table public.compliance_requirement_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  building_id uuid references public.facility_buildings(id) on delete set null,
  requirement_id uuid not null references public.compliance_requirements(id) on delete cascade,
  period_start date,
  due_date date not null,
  status text not null default 'not_started' check (status in (
    'not_started', 'in_progress', 'awaiting_review', 'complete',
    'overdue', 'not_applicable', 'exception_approved'
  )),
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  completion_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  exception_reason text,
  exception_approved_by uuid references public.profiles(id) on delete set null,
  exception_approved_at timestamptz,
  na_reason text,
  -- Denormalized count so the "missing evidence" view is a cheap indexed filter; maintained by the
  -- attach/detach evidence RPCs, never client-writable.
  evidence_count integer not null default 0 check (evidence_count >= 0),
  reminder_sent_on date,
  escalation_level integer not null default 0 check (escalation_level between 0 and 20),
  last_escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One occurrence per requirement per due date -- protects the recurrence generator (and manual
  -- "generate now") against creating duplicate rows for the same cycle.
  unique (requirement_id, due_date)
);
create index compliance_instances_org_idx on public.compliance_requirement_instances(organization_id);
create index compliance_instances_facility_status_idx on public.compliance_requirement_instances(facility_id, status);
create index compliance_instances_due_idx on public.compliance_requirement_instances(status, due_date);
create index compliance_instances_requirement_idx on public.compliance_requirement_instances(requirement_id);
create index compliance_instances_responsible_idx on public.compliance_requirement_instances(responsible_profile_id) where responsible_profile_id is not null;

alter table public.compliance_requirement_instances enable row level security;
grant select on public.compliance_requirement_instances to authenticated;

create trigger set_updated_at before update on public.compliance_requirement_instances
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.compliance_requirement_instances
  for each row execute function public.audit_log_trigger();

------------------------------------------------------------------------------------------------
-- 3. Append-only history: who completed / reviewed / reopened / changed / commented.
------------------------------------------------------------------------------------------------
create table public.compliance_requirement_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete cascade,
  requirement_id uuid not null references public.compliance_requirements(id) on delete cascade,
  instance_id uuid references public.compliance_requirement_instances(id) on delete cascade,
  event_type text not null check (event_type in (
    'requirement_created', 'requirement_updated', 'requirement_archived', 'requirement_reactivated',
    'template_copied', 'instance_generated', 'status_changed', 'completed', 'reviewed',
    'reopened', 'exception_approved', 'marked_not_applicable', 'assigned', 'note_added',
    'evidence_added', 'evidence_removed'
  )),
  prior_status text,
  new_status text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index compliance_events_requirement_idx on public.compliance_requirement_events(requirement_id, created_at desc);
create index compliance_events_instance_idx on public.compliance_requirement_events(instance_id, created_at desc) where instance_id is not null;
create index compliance_events_org_idx on public.compliance_requirement_events(organization_id, created_at desc);

alter table public.compliance_requirement_events enable row level security;
grant select on public.compliance_requirement_events to authenticated;

------------------------------------------------------------------------------------------------
-- 4. Evidence documents -- mirrors resident_documents / incident_documents exactly (own bucket,
--    no employee owner, {org}/{facility}/... storage path scoped by RLS).
------------------------------------------------------------------------------------------------
create table public.compliance_requirement_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  requirement_id uuid not null references public.compliance_requirements(id) on delete cascade,
  instance_id uuid references public.compliance_requirement_instances(id) on delete cascade,
  storage_bucket text not null default 'compliance-evidence',
  storage_path text not null,
  file_name text not null,
  file_type text not null,
  file_size integer,
  document_label text,
  uploaded_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index compliance_documents_requirement_idx on public.compliance_requirement_documents(requirement_id);
create index compliance_documents_instance_idx on public.compliance_requirement_documents(instance_id) where instance_id is not null;
create index compliance_documents_org_idx on public.compliance_requirement_documents(organization_id);

alter table public.compliance_requirement_documents enable row level security;
grant select on public.compliance_requirement_documents to authenticated;

create trigger audit_log after insert or update or delete on public.compliance_requirement_documents
  for each row execute function public.audit_log_trigger();

------------------------------------------------------------------------------------------------
-- 5. RLS select policies. Standard org+role+assigned-facility shape (auditor reads org-wide;
--    facility_manager is scoped to assigned facilities). All writes are through the SECURITY
--    DEFINER RPCs in the paired migration -- there are deliberately no insert/update/delete
--    policies, so a client cannot bypass the workflow/history/notification logic.
------------------------------------------------------------------------------------------------
create policy compliance_requirements_select on public.compliance_requirements
  for select to authenticated using (
    (select public.is_platform_admin())
    or (organization_id = (select public.current_org_id())
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or facility_id is null
             or public.is_assigned_to_facility(facility_id)))
  );

create policy compliance_instances_select on public.compliance_requirement_instances
  for select to authenticated using (
    (select public.is_platform_admin())
    or (organization_id = (select public.current_org_id())
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or public.is_assigned_to_facility(facility_id)))
  );

create policy compliance_events_select on public.compliance_requirement_events
  for select to authenticated using (
    (select public.is_platform_admin())
    or (organization_id = (select public.current_org_id())
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or facility_id is null
             or public.is_assigned_to_facility(facility_id)))
  );

create policy compliance_documents_select on public.compliance_requirement_documents
  for select to authenticated using (
    (select public.is_platform_admin())
    or (organization_id = (select public.current_org_id())
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or public.is_assigned_to_facility(facility_id)))
  );

------------------------------------------------------------------------------------------------
-- 6. Evidence storage bucket (private). Path convention {org_id}/{facility_id}/... enforced by the
--    same folder-segment RLS as incident-documents / resident-documents.
------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('compliance-evidence', 'compliance-evidence', false)
on conflict (id) do nothing;

create policy "compliance-evidence read" on storage.objects for select to authenticated using (
  bucket_id = 'compliance-evidence'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid))))
  )
);

create policy "compliance-evidence write" on storage.objects for insert to authenticated with check (
  bucket_id = 'compliance-evidence'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid))
  )
);

create policy "compliance-evidence delete" on storage.objects for delete to authenticated using (
  bucket_id = 'compliance-evidence'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) = 'org_admin')
  )
);

------------------------------------------------------------------------------------------------
-- 7. Notification types for reminders / assignment / escalation. Re-declare the full current list
--    plus the four new compliance-requirement types (additive; nothing removed).
------------------------------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (
  notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued',
    'training_due_soon', 'training_expired', 'competency_recorded',
    'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
    'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
    'support_ticket_update', 'workforce_lifecycle_changed', 'training_registration_changed',
    'open_shift_claim_changed', 'shift_swap_changed', 'credential_renewal_changed',
    'qualification_changed', 'course_assignment_due_soon',
    'shift_handoff_assigned', 'shift_handoff_escalated', 'shift_handoff_resolved',
    'time_off_request_changed', 'portal_message_received', 'schedule_published',
    'announcement_published', 'manager_weekly_digest',
    'automation_action_due', 'report_subscription_ready', 'resident_portal_request',
    'billing_trial_expiring',
    'compliance_requirement_assigned', 'compliance_requirement_due_soon',
    'compliance_requirement_overdue', 'compliance_requirement_awaiting_review'
  )
);

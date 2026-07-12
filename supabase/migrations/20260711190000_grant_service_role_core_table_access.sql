-- service_role bypasses RLS but still needs explicit object privileges for
-- direct PostgREST calls. Grant only the commands used by production Edge
-- Functions and the disposable release-journey bootstrap. Privileged RPCs are
-- SECURITY DEFINER and do not justify direct access to their backing tables.

grant select, insert, delete
  on table
    public.organizations,
    public.resident_documents,
    public.violation_documents
  to service_role;

grant select, insert, update
  on table public.resident_assessment_ai_generations
  to service_role;

grant select, update
  on table
    public.incidents,
    public.policy_attestations
  to service_role;

grant select, insert
  on table
    public.facilities,
    public.employees,
    public.courses,
    public.course_versions,
    public.course_blocks
  to service_role;

grant insert
  on table public.facility_assignments
  to service_role;

grant select
  on table
    public.alerts,
    public.certificates,
    public.corrective_actions,
    public.dhs_citation_topics,
    public.dhs_violations,
    public.employee_credentials,
    public.employee_training_records,
    public.inspection_items,
    public.notification_deliveries,
    public.notifications,
    public.platform_settings,
    public.policy_attestation_campaigns,
    public.policy_documents,
    public.practicums,
    public.profiles,
    public.resident_assessment_forms,
    public.resident_compliance_items,
    public.residents,
    public.training_types
  to service_role;

-- Dedicated earlier migrations retain their narrower grants for audit_logs,
-- signup_attempts, notification evidence/templates, and exclusion refresh
-- state. Do not widen those append-only or RPC-owned boundaries here.

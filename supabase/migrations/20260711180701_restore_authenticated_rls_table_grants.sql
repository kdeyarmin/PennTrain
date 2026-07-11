-- RLS policies define which rows a caller may access, but they do not grant
-- the underlying table privileges. Restore the Data API command grants that
-- match every active authenticated policy without widening any row policy.
--
-- The groups below are the final policy command matrix after the complete
-- migration chain. Keeping the grants grouped by command set makes RPC-only,
-- append-only, and read-only boundaries explicit.

grant select, insert, update, delete
  on table
    public.administrator_profiles,
    public.alerts,
    public.competency_record_items,
    public.competency_records,
    public.competency_template_items,
    public.competency_templates,
    public.corrective_actions,
    public.course_assignments,
    public.course_blocks,
    public.course_progress,
    public.course_versions,
    public.courses,
    public.dhs_violations,
    public.employee_background_check_profiles,
    public.employee_credentials,
    public.employee_facility_assignments,
    public.employee_onboarding_items,
    public.employee_schedule_preferences,
    public.employee_training_hour_buckets,
    public.employee_training_records,
    public.employees,
    public.entrance_conference_items,
    public.facilities,
    public.facility_assignments,
    public.facility_units,
    public.help_articles,
    public.incident_notifications,
    public.incident_staff_involved,
    public.incidents,
    public.inspection_events,
    public.inspection_items,
    public.onboarding_checklist_templates,
    public.organization_settings,
    public.organizations,
    public.packages,
    public.platform_settings,
    public.policy_documents,
    public.practicums,
    public.quiz_answers,
    public.quiz_attempt_answers,
    public.quiz_attempts,
    public.quiz_question_explanations,
    public.quiz_questions,
    public.quizzes,
    public.resident_assessment_forms,
    public.resident_compliance_items,
    public.resident_informal_supports,
    public.residents,
    public.schedules,
    public.shift_assignments,
    public.shift_definitions,
    public.training_class_attendees,
    public.training_classes,
    public.training_plan_items,
    public.training_plans,
    public.training_types
  to authenticated;

-- Evidence/document tables deliberately expose no direct UPDATE path.
grant select, insert, delete
  on table
    public.administrator_ce_entries,
    public.employee_checkin_logs,
    public.employee_credential_documents,
    public.incident_documents,
    public.policy_attestation_campaigns,
    public.policy_attestations,
    public.resident_documents,
    public.training_documents,
    public.violation_documents
  to authenticated;

grant select, insert
  on table
    public.course_feedback,
    public.support_ticket_messages
  to authenticated;

grant select, insert, update
  on table
    public.course_ai_generations,
    public.policy_document_versions,
    public.resident_assessment_ai_generations,
    public.support_tickets
  to authenticated;

-- Operational, immutable, and provider evidence stays client read-only.
grant select
  on table
    public.audit_logs,
    public.certificate_lifecycle_events,
    public.certificate_pdf_jobs,
    public.certificates,
    public.dhs_citation_topics,
    public.exclusion_refresh_runs,
    public.exclusion_source_snapshots,
    public.exclusion_source_state,
    public.notification_channel_policies,
    public.notification_consent_events,
    public.notification_deliveries,
    public.notification_delivery_attempts,
    public.notification_provider_events,
    public.notification_spend_alerts,
    public.notification_spend_policies,
    public.notification_templates,
    public.notifications,
    public.resident_compliance_rule_packs
  to authenticated;

grant select, update
  on table
    public.exclusion_screening_matches,
    public.profiles
  to authenticated;

-- Trusted service workflows bootstrap tenants and publishable course fixtures
-- through PostgREST. Grant only their direct commands; privileged profile
-- changes continue through admin_update_profile(), and certificate writes
-- continue through the atomic completion/certificate RPC path.
grant select, insert
  on table
    public.organizations,
    public.facilities,
    public.courses,
    public.course_versions
  to service_role;

grant insert
  on table
    public.facility_assignments,
    public.employees,
    public.course_blocks
  to service_role;

grant select
  on table public.certificates
  to service_role;

-- Repair environments that applied the original 20260711190000 migration
-- while it still granted ALL on every core table. Revoke that complete scope,
-- then restore only the direct PostgREST commands audited for production Edge
-- Functions and disposable release-journey setup.
revoke all
  on table
    public.packages,
    public.organizations,
    public.organization_settings,
    public.facilities,
    public.profiles,
    public.facility_assignments,
    public.employees,
    public.training_types,
    public.employee_training_records,
    public.employee_training_hour_buckets,
    public.practicums,
    public.training_documents,
    public.alerts,
    public.training_classes,
    public.training_class_attendees,
    public.courses,
    public.course_versions,
    public.course_blocks,
    public.quizzes,
    public.quiz_questions,
    public.quiz_answers,
    public.course_assignments,
    public.course_progress,
    public.quiz_attempts,
    public.quiz_attempt_answers,
    public.training_plans,
    public.training_plan_items,
    public.competency_templates,
    public.competency_template_items,
    public.competency_records,
    public.competency_record_items,
    public.certificates,
    public.notifications,
    public.course_feedback,
    public.quiz_question_explanations,
    public.employee_credentials,
    public.employee_credential_documents,
    public.incidents,
    public.incident_staff_involved,
    public.incident_notifications,
    public.incident_documents,
    public.corrective_actions,
    public.inspection_items,
    public.inspection_events,
    public.notification_deliveries,
    public.policy_documents,
    public.policy_document_versions,
    public.policy_attestation_campaigns,
    public.policy_attestations,
    public.employee_background_check_profiles,
    public.exclusion_screening_matches,
    public.administrator_profiles,
    public.administrator_ce_entries,
    public.class_checkin_tokens,
    public.dhs_citation_topics,
    public.entrance_conference_items,
    public.dhs_violations,
    public.violation_documents,
    public.onboarding_checklist_templates,
    public.employee_onboarding_items,
    public.employee_checkin_logs,
    public.residents,
    public.resident_compliance_items,
    public.resident_documents,
    public.course_ai_generations,
    public.platform_settings,
    public.employee_facility_assignments,
    public.facility_units,
    public.shift_definitions,
    public.employee_schedule_preferences,
    public.schedules,
    public.shift_assignments,
    public.resident_compliance_rule_packs,
    public.resident_informal_supports,
    public.resident_assessment_forms,
    public.support_tickets,
    public.support_ticket_messages,
    public.help_articles,
    public.resident_assessment_ai_generations
  from service_role;

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

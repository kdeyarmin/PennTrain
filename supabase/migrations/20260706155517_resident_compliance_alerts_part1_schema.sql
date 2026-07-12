alter table public.alerts add column resident_compliance_item_id uuid references public.resident_compliance_items(id);
create index alerts_resident_compliance_item_idx on public.alerts(resident_compliance_item_id);

alter table public.alerts drop constraint alerts_alert_type_check;
alter table public.alerts add constraint alerts_alert_type_check check (alert_type in (
  'due_90','due_60','due_30','due_14','due_7','overdue','missing_document',
  'course_assigned','certificate_expiring','external_cert_pending_review',
  'competency_due','training_plan_assigned','inservice_scheduled','credential_expiring',
  'incident_notification_overdue','corrective_action_overdue','inspection_due','exclusion_match_found',
  'resident_compliance_due_soon'));

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued', 'training_due_soon', 'training_expired',
    'competency_recorded', 'missing_document', 'certificate_expiring', 'practicum_due_soon',
    'practicum_expired', 'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due'
  ));

-- Keep database-backed Help Center copy aligned with the role gates in the app shell.
-- The original seed predates trainer access to Pending Approvals, so update existing databases
-- without hand-editing the generated seed migration.

update public.help_articles
set content = jsonb_set(
  content,
  '{answer}',
  to_jsonb('platform_admin is CareMetric Train staff -- confined to /admin, with the only ability to author courses and quizzes. org_admin and facility_manager work in /app: org_admin sees every facility in the organization, facility_manager is scoped to the facility (or facilities) they''re assigned to. auditor gets the same /app compliance reporting views with zero ability to create, edit, or delete anything -- it''s read-only by database policy, not just hidden buttons. trainer works across /trainer and training-related /app pages: scheduling and running live classes, monitoring retraining, browsing courses, assigning courses and training plans, recording competencies/practicums, reviewing pending external certificates, and read access to facilities/employees. employee is self-service in /me: their own training records, assigned courses, certificates, credentials, schedule, and documents.'::text),
  true
)
where article_type = 'faq'
  and title = 'What are the six roles, and what does each one actually see?';

update public.help_articles
set content = jsonb_set(
  content,
  '{answer}',
  to_jsonb('Yes -- employees can upload documents such as an external certificate for training they completed outside the platform. It doesn''t automatically count toward compliance, though: it lands in Pending Approvals, where an org admin, facility manager, or trainer reviews it and confirms (or declines) whether it satisfies a training requirement before it affects that employee''s compliance status.'::text),
  true
)
where article_type = 'faq'
  and title = 'Can employees upload their own documents, like an external certificate?';

update public.help_articles
set content = jsonb_set(
  content,
  '{audience}',
  '["org_admin","facility_manager","trainer"]'::jsonb,
  true
)
where article_type = 'job_aide'
  and title = 'Approve an Externally-Uploaded Certificate';

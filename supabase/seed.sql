insert into packages (name, learner_limit, facility_limit, features) values
('Starter',25,1,'{"core_lms":true,"basic_reports":true,"external_uploads":true}'),
('Compliance Plus',100,5,'{"compliance_templates":true,"medication_tracking":true,"competencies":true,"binder_export":true}'),
('Enterprise',10000,1000,'{"advanced_reporting":true,"custom_templates":true,"api_ready":true,"priority_support":true}') on conflict (name) do nothing;

insert into organizations (name, subscription_status, package_name)
select 'Demo Care Group','trial','Compliance Plus'
where not exists (select 1 from organizations where name = 'Demo Care Group');

with org_row as (select id from organizations where name = 'Demo Care Group' limit 1)
insert into facilities (organization_id, name, address)
select id, 'Oakview Personal Care', '100 Oak Lane' from org_row where not exists (select 1 from facilities where name = 'Oakview Personal Care')
union all
select id, 'Riverbend Assisted Living', '22 River Road' from org_row where not exists (select 1 from facilities where name = 'Riverbend Assisted Living');

with org_row as (select id from organizations where name = 'Demo Care Group' limit 1)
insert into courses (organization_id, title, description, category, target_roles, estimated_minutes, credit_hours, course_type, required, renewal_period_days, certificate_eligible, tags, regulatory_topics)
select id, 'Resident Rights and Dignity Essentials', 'Original resident rights orientation and annual refresher.', 'Resident Rights', array['Direct Care Staff','Administrator'], 45, 0.75, 'reading_quiz', true, 365, true, array['rights','orientation'], array['resident_rights'] from org_row where not exists (select 1 from courses where title = 'Resident Rights and Dignity Essentials')
union all
select id, 'Recognizing and Reporting Abuse or Neglect', 'Original abuse, neglect, exploitation recognition and reporting training.', 'Abuse, Neglect, and Exploitation', array['All Staff'], 60, 1.00, 'video_attestation', true, 365, true, array['abuse','reporting'], array['abuse_reporting'] from org_row where not exists (select 1 from courses where title = 'Recognizing and Reporting Abuse or Neglect')
union all
select id, 'Medication Administration Documentation Tracker', 'Documentation workflow for outside medication administration certification evidence.', 'Medication Administration Tracking', array['Medication Technician'], 30, 0.50, 'external_certificate', true, 365, true, array['medication','certificate'], array['medication_tracking'] from org_row where not exists (select 1 from courses where title = 'Medication Administration Documentation Tracker');

with org_row as (select id from organizations where name = 'Demo Care Group' limit 1)
insert into compliance_requirements (organization_id, name, category, required_roles, required_hours, renewal_period_days, due_date_rule, accepted_evidence_types, external_certificate_allowed, admin_approval_required, notes, citation)
select id, 'Administrator annual training tracking', 'Administrator Training', array['Administrator'], 24, 365, 'calendar_year', array['course','external_certificate','inservice'], true, false, 'Configurable sample requirement; not legal advice.', 'Verify current federal, state, and local requirements.' from org_row where not exists (select 1 from compliance_requirements where name = 'Administrator annual training tracking')
union all
select id, 'Direct care staff annual training tracking', 'Direct Care Staff Training', array['Direct Care Staff','Medication Technician'], 12, 365, 'hire_date_anniversary', array['course','competency','inservice'], true, false, 'Configurable sample requirement; not legal advice.', 'Verify current federal, state, and local requirements.' from org_row where not exists (select 1 from compliance_requirements where name = 'Direct care staff annual training tracking')
union all
select id, 'Medication administration certification tracking', 'Medication Administration Tracking', array['Medication Technician'], 0, 365, 'expiration_date', array['external_certificate','observation_checklist'], true, true, 'Tracks documentation and renewal dates only unless configured otherwise.', 'Verify whether specific training is accepted by the applicable agency.' from org_row where not exists (select 1 from compliance_requirements where name = 'Medication administration certification tracking');

-- Demo auth users are created through Supabase Auth; recommended demo emails:
-- super@caremetric.test, admin@caremetric.test, facility@caremetric.test, trainer@caremetric.test, learner@caremetric.test, auditor@caremetric.test (password: DemoPass!2026)

insert into packages (name, learner_limit, facility_limit, features) values
('Starter',25,1,'{"core_lms":true,"basic_reports":true,"external_uploads":true}'),
('Compliance Plus',100,5,'{"compliance_templates":true,"medication_tracking":true,"competencies":true,"binder_export":true}'),
('Enterprise',10000,1000,'{"advanced_reporting":true,"custom_templates":true,"api_ready":true,"priority_support":true}') on conflict (name) do nothing;
insert into organizations (name, subscription_status, package_name) values ('Demo Care Group','trial','Compliance Plus') on conflict do nothing;
-- Demo auth users are created through Supabase Auth; recommended demo emails:
-- super@caremetric.test, admin@caremetric.test, facility@caremetric.test, trainer@caremetric.test, learner@caremetric.test, auditor@caremetric.test (password: DemoPass!2026)

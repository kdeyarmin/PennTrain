-- pgTAP coverage for 20260925120700: online-only first aid / CPR / obstructed-airway evidence
-- cannot be verified (2600.63(b) / 2800.63(b); both RCGs: online training with no hands-on
-- practice "will not be considered when measuring compliance").
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(7);

insert into public.organizations(id, name, slug, subscription_status) values
  ('a2630000-0000-4000-8000-000000000001', 'Resuscitation Evidence Org', 'resuscitation-evidence-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('a2630000-0000-4000-8000-000000000011', 'a2630000-0000-4000-8000-000000000001', 'Evidence ALF', 'ALR');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'a2630000-0000-4000-8000-000000000101', 'authenticated',
   'authenticated', 'resuscitation-admin@test.local', 'x', now(), '{}', '{}', now(), now(),
   '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('a2630000-0000-4000-8000-000000000101', 'a2630000-0000-4000-8000-000000000001',
   'resuscitation-admin@test.local', 'Rae', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.employees(id, organization_id, facility_id, first_name, last_name, job_title) values
  ('a2630000-0000-4000-8000-000000000021', 'a2630000-0000-4000-8000-000000000001',
   'a2630000-0000-4000-8000-000000000011', 'Casey', 'Aide', 'Direct care');

create or replace function pg_temp.evidence(p_ref text, p_delivery text, p_topics text[])
returns void language sql as $$
  insert into public.training_evidence_events(
    organization_id, facility_id, employee_id, title, completed_on, minutes, delivery, provider,
    source_reference, provider_qualification, topics, valid_until, created_by
  ) values (
    'a2630000-0000-4000-8000-000000000001', 'a2630000-0000-4000-8000-000000000011',
    'a2630000-0000-4000-8000-000000000021', 'Heartsaver first aid CPR', current_date - 10, 240,
    p_delivery, 'Certified trainer', p_ref, 'American Heart Association instructor card on file',
    p_topics, current_date + 700, 'a2630000-0000-4000-8000-000000000101'
  );
$$;

select pg_temp.evidence('cpr-online', 'online', array['first_aid', 'cpr']);
select pg_temp.evidence('cpr-hybrid', 'hybrid', array['first_aid', 'cpr', 'airway']);
select pg_temp.evidence('cpr-external', 'external', array['cpr']);
select pg_temp.evidence('rights-online', 'online', array['rights']);

select throws_ok(
  $$update public.training_evidence_events set status = 'verified', review_note = 'Certificate reviewed'
    where source_reference = 'cpr-online'$$,
  '22023', null,
  'an online-only first aid / CPR course cannot be verified -- DHS does not consider it'
);

select lives_ok(
  $$update public.training_evidence_events set status = 'verified', review_note = 'Skills session attended'
    where source_reference = 'cpr-hybrid'$$,
  'a course with a hands-on skills session (hybrid) verifies'
);

select lives_ok(
  $$update public.training_evidence_events set status = 'verified', review_note = 'Agency card checked'
    where source_reference = 'cpr-external'$$,
  'a certifying agency''s card (external) verifies'
);

select lives_ok(
  $$update public.training_evidence_events set status = 'verified', review_note = 'Rights module reviewed'
    where source_reference = 'rights-online'$$,
  'online delivery is still fine for topics that need no hands-on practice'
);

select lives_ok(
  $$update public.training_evidence_events set status = 'rejected', review_note = 'Online only; not accepted'
    where source_reference = 'cpr-online'$$,
  'the online-only course can still be rejected with its reason'
);

select throws_ok(
  $$insert into public.training_evidence_events(
      organization_id, facility_id, employee_id, title, completed_on, minutes, delivery, provider,
      source_reference, topics, status, created_by
    ) values (
      'a2630000-0000-4000-8000-000000000001', 'a2630000-0000-4000-8000-000000000011',
      'a2630000-0000-4000-8000-000000000021', 'Online airway module', current_date - 1, 60,
      'online', 'Web provider', 'airway-online-direct', array['airway'], 'verified',
      'a2630000-0000-4000-8000-000000000101'
    )$$,
  '22023', null,
  'nor can it be written as verified in one step'
);

-- A row verified before the trigger existed stays voidable, which is how the workspace corrects it.
alter table public.training_evidence_events disable trigger refuse_online_only_resuscitation_evidence;
select pg_temp.evidence('cpr-online-legacy', 'online', array['cpr']);
update public.training_evidence_events set status = 'verified', review_note = 'Verified before the rule'
 where source_reference = 'cpr-online-legacy';
alter table public.training_evidence_events enable trigger refuse_online_only_resuscitation_evidence;

select lives_ok(
  $$update public.training_evidence_events set status = 'void', review_note = 'Online only; DHS does not count it'
    where source_reference = 'cpr-online-legacy'$$,
  'an online course verified before this rule can be voided'
);

select * from finish();
rollback;

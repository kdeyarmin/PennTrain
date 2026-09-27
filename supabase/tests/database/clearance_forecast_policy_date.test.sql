begin;
select plan(4);

insert into public.organizations(id, name, slug, subscription_status) values
  ('d2600000-0000-4000-8000-000000000001', 'Policy date forecast', 'policy-date-forecast', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('d2600000-0000-4000-8000-000000000011', 'd2600000-0000-4000-8000-000000000001', 'Policy Date Home', 'PCH');
insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
values('00000000-0000-0000-0000-000000000000', 'd2600000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'policy-date-forecast@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('d2600000-0000-4000-8000-000000000101', 'd2600000-0000-4000-8000-000000000001', 'policy-date-forecast@test.local', 'Policy', 'Admin', 'org_admin', true);
select set_config('app.privileged_write', 'off', true);
insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, status, cleared_for_unsupervised_duty
) values (
  'd2600000-0000-4000-8000-000000000201', 'd2600000-0000-4000-8000-000000000001',
  'd2600000-0000-4000-8000-000000000011', 'Earlier', 'Policy', 'Caregiver', 'active', true
);
delete from public.employee_credentials where employee_id = 'd2600000-0000-4000-8000-000000000201';
delete from public.employee_training_records where employee_id = 'd2600000-0000-4000-8000-000000000201';
insert into public.employee_credentials(
  id, organization_id, facility_id, employee_id, credential_type, credential_label,
  status, expiration_date, policy_renewal_due_date
) values (
  'd2600000-0000-4000-8000-000000000301', 'd2600000-0000-4000-8000-000000000001',
  'd2600000-0000-4000-8000-000000000011', 'd2600000-0000-4000-8000-000000000201',
  'other', 'First aid', 'compliant', public.pa_today() + 400, public.pa_today() + 15
);

set local role service_role;
select is(
  (public.get_workforce_readiness_forecast('d2600000-0000-4000-8000-000000000011')
    -> 'horizons' -> 0 ->> 'credentialEvents')::int,
  1,
  'a facility renewal inside 30 days is a forecast event even when the document expires later'
);
select is(
  public.get_workforce_readiness_forecast('d2600000-0000-4000-8000-000000000011')
    -> 'risks' -> 0 -> 'reasons' -> 0 ->> 'riskDate',
  (public.pa_today() + 15)::text,
  'the forecast dates the clearance on the facility renewal, not the later document expiration'
);

reset role;
insert into public.employee_credentials(
  id, organization_id, facility_id, employee_id, credential_type, credential_label,
  status, expiration_date, policy_renewal_due_date
) values (
  'd2600000-0000-4000-8000-000000000302', 'd2600000-0000-4000-8000-000000000001',
  'd2600000-0000-4000-8000-000000000011', 'd2600000-0000-4000-8000-000000000201',
  'immunization', 'Flu shot', 'compliant', public.pa_today() + 10, public.pa_today() - 5
);
select lives_ok(
  $$select public.queue_manager_weekly_digests()$$,
  'the manager digest runs'
);
select is(
  (select (item->>'count')::int
   from public.manager_digest_snapshots s,
        lateral jsonb_array_elements(s.items) as item
   where s.profile_id = 'd2600000-0000-4000-8000-000000000101'
     and item->>'key' = 'credentials'),
  1,
  'the 30-day digest counts the upcoming facility renewal and not a document date whose policy date has passed'
);

select * from finish();
rollback;

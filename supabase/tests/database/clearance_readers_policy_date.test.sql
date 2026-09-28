begin;
select plan(8);

insert into public.organizations(id, name, slug, subscription_status) values
  ('e2710000-0000-4000-8000-000000000001', 'Clearance reader org', 'clearance-reader-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('e2710000-0000-4000-8000-000000000011', 'e2710000-0000-4000-8000-000000000001', 'Reader Home', 'NH');
insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, status, hire_date
) values (
  'e2710000-0000-4000-8000-000000000101', 'e2710000-0000-4000-8000-000000000001',
  'e2710000-0000-4000-8000-000000000011', 'Shift', 'Nurse', 'Nurse', 'active', public.pa_today() - 400
);
delete from public.employee_credentials
where employee_id = 'e2710000-0000-4000-8000-000000000101';
insert into public.employee_credentials(
  id, organization_id, facility_id, employee_id, credential_type, credential_label,
  status, issue_date, expiration_date, policy_renewal_due_date, verified_at
) values (
  'e2710000-0000-4000-8000-000000000201', 'e2710000-0000-4000-8000-000000000001',
  'e2710000-0000-4000-8000-000000000011', 'e2710000-0000-4000-8000-000000000101',
  'rn_license', 'Nurse license', 'due_soon', public.pa_today() - 30,
  public.pa_today() + 400, public.pa_today() + 2, now()
);

select ok(
  public.evaluate_schedule_eligibility(
    'e2710000-0000-4000-8000-000000000101',
    'e2710000-0000-4000-8000-000000000011',
    public.pa_midnight(public.pa_today() + 10) + time '08:00',
    public.pa_midnight(public.pa_today() + 10) + time '16:00',
    array[]::text[], array['rn_license']::text[], array[]::uuid[], array[]::uuid[]
  )->'hardBlocks' @> '["credential:rn_license"]'::jsonb,
  'a facility renewal before the shift blocks even when the document expires later'
);

select is(
  public.staff_emergency_qualification_mask(
    'e2710000-0000-4000-8000-000000000101',
    public.pa_midnight(public.pa_today() + 10) + time '08:00',
    public.pa_midnight(public.pa_today() + 10) + time '16:00'
  ),
  0,
  'a license does not cover an interval that starts after the facility renewal'
);

update public.employee_credentials
set policy_renewal_due_date = null, expiration_date = public.pa_today() + 45
where id = 'e2710000-0000-4000-8000-000000000201';

select ok(
  not (
    public.evaluate_schedule_eligibility(
      'e2710000-0000-4000-8000-000000000101',
      'e2710000-0000-4000-8000-000000000011',
      public.pa_midnight(public.pa_today() + 3) + time '08:00',
      public.pa_midnight(public.pa_today() + 3) + time '16:00',
      array[]::text[], array['rn_license']::text[], array[]::uuid[], array[]::uuid[]
    )->'hardBlocks' @> '["credential:rn_license"]'::jsonb
  ),
  'a due-soon license with no facility renewal still covers a shift inside the document date'
);

select is(
  public.staff_emergency_qualification_mask(
    'e2710000-0000-4000-8000-000000000101',
    public.pa_midnight(public.pa_today() + 3) + time '08:00',
    public.pa_midnight(public.pa_today() + 3) + time '16:00'
  ),
  7,
  'a license with no facility renewal still counts through its document expiration'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', 'e2710000-0000-4000-8000-000000000301',
  'authenticated', 'authenticated', 'clearance-reader@test.local', 'x', now(),
  '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('e2710000-0000-4000-8000-000000000301', 'e2710000-0000-4000-8000-000000000001',
   'clearance-reader@test.local', 'Report', 'Admin', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, status, hire_date
) values (
  'e2710000-0000-4000-8000-000000000102', 'e2710000-0000-4000-8000-000000000001',
  'e2710000-0000-4000-8000-000000000011', 'Report', 'Staff', 'Aide', 'active', public.pa_today() - 20
);
delete from public.employee_credentials
where employee_id = 'e2710000-0000-4000-8000-000000000102';
insert into public.employee_credentials(
  id, organization_id, facility_id, employee_id, credential_type, credential_label,
  status, expiration_date, policy_renewal_due_date
) values
  ('e2710000-0000-4000-8000-000000000202', 'e2710000-0000-4000-8000-000000000001',
   'e2710000-0000-4000-8000-000000000011', 'e2710000-0000-4000-8000-000000000102',
   'other', 'Document only', 'compliant', public.pa_today() + 12, null),
  ('e2710000-0000-4000-8000-000000000203', 'e2710000-0000-4000-8000-000000000001',
   'e2710000-0000-4000-8000-000000000011', 'e2710000-0000-4000-8000-000000000102',
   'immunization', 'Policy first', 'due_soon', public.pa_today() + 400, public.pa_today() + 15),
  ('e2710000-0000-4000-8000-000000000204', 'e2710000-0000-4000-8000-000000000001',
   'e2710000-0000-4000-8000-000000000011', 'e2710000-0000-4000-8000-000000000102',
   'i9_employment_eligibility', 'Already passed', 'expired', public.pa_today() + 15, public.pa_today() - 1);

create or replace function pg_temp.act_as(p_id uuid) returns void
language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text,
    true
  );
  set local role authenticated;
end
$$;

select pg_temp.act_as('e2710000-0000-4000-8000-000000000301');

select is(
  public.generate_paged_compliance_report(
    'credential-status', 'e2710000-0000-4000-8000-000000000011', null,
    public.pa_today() + 10, public.pa_today() + 20
  )->'headers'->>3,
  'Due',
  'the credential status report dates the row on the governing due date'
);
select is(
  (public.generate_paged_compliance_report(
    'credential-status', 'e2710000-0000-4000-8000-000000000011', null,
    public.pa_today() + 10, public.pa_today() + 20
  )->>'totalRows')::int,
  2,
  'a past facility renewal drops out of the window even when the document date is inside it'
);
select is(
  (
    select string_agg(item->>1, ',' order by item->>3)
    from jsonb_array_elements(
      public.generate_paged_compliance_report(
        'credential-status', 'e2710000-0000-4000-8000-000000000011', null,
        public.pa_today() + 10, public.pa_today() + 20
      )->'rows'
    ) item
  ),
  'Document only,Policy first',
  'the report keeps a document-only date and a facility renewal inside the window'
);
select is(
  (
    select string_agg(item->>3, ',' order by item->>3)
    from jsonb_array_elements(
      public.generate_paged_compliance_report(
        'credential-status', 'e2710000-0000-4000-8000-000000000011', null,
        public.pa_today() + 10, public.pa_today() + 20
      )->'rows'
    ) item
  ),
  (public.pa_today() + 12)::text || ',' || (public.pa_today() + 15)::text,
  'the printed date is the earlier of the document expiration and the facility renewal'
);

select * from finish();
rollback;

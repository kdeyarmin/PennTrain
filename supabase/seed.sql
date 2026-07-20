-- Demo/seed data for CareMetric CareBase.
-- Safe to re-run: every insert is guarded by ON CONFLICT DO NOTHING or a WHERE NOT EXISTS-style
-- subquery keyed on a unique natural key (slug, name, email).

-- Packages catalog
insert into public.packages (name, learner_limit, facility_limit, price_monthly_cents, features, sort_order) values
  ('Starter', 25, 1, 9900, '{"modules.train": true, "modules.carebase": true, "compliance_binder": false, "medication_tracking": false, "competency_checklists": false}'::jsonb, 1),
  ('Compliance Plus', 100, 5, 29900, '{"modules.train": true, "modules.carebase": true, "compliance_binder": true, "medication_tracking": true, "competency_checklists": true}'::jsonb, 2),
  ('Enterprise', null, null, null, '{"modules.train": true, "modules.carebase": true, "compliance_binder": true, "medication_tracking": true, "competency_checklists": true, "custom_compliance_templates": true, "api_access": true}'::jsonb, 3),
  ('CareMetric Train', null, null, null, '{"modules.train": true, "modules.carebase": false}'::jsonb, 10),
  ('CareMetric CareBase', null, null, null, '{"modules.train": true, "modules.carebase": true}'::jsonb, 20)
on conflict (name) do nothing;

-- Demo organizations
insert into public.organizations (name, slug, contact_name, contact_email, contact_phone, address, city, state, zip, subscription_status, plan_name, package_id)
select 'Sunrise Healthcare Group', 'sunrise-healthcare', 'Dr. Robert Chen', 'robert.chen@sunrisehealthcare.com', '215-555-0100',
  '100 Corporate Blvd', 'Philadelphia', 'PA', '19103', 'active', 'Compliance Plus', p.id
from public.packages p where p.name = 'Compliance Plus'
on conflict (slug) do nothing;

update public.organizations
set is_demo = true, demo_seed_version = 1, updated_at = now()
where slug = 'sunrise-healthcare';

insert into public.organizations (name, slug, contact_name, contact_email, contact_phone, address, city, state, zip, subscription_status, plan_name, package_id)
select 'Maple Grove Senior Living', 'maple-grove', 'Patricia Nguyen', 'patricia.nguyen@maplegrove.com', '412-555-0200',
  '50 Maple Grove Way', 'Pittsburgh', 'PA', '15222', 'trial', 'Starter', p.id
from public.packages p where p.name = 'Starter'
on conflict (slug) do nothing;

-- Facilities
insert into public.facilities (organization_id, name, facility_type, address, city, state, zip, administrator_name, administrator_email)
select o.id, 'Sunrise Manor', 'PCH', '100 Corporate Blvd', 'Philadelphia', 'PA', '19103', 'Dr. Robert Chen', 'robert.chen@sunrisehealthcare.com'
from public.organizations o where o.slug = 'sunrise-healthcare'
and not exists (select 1 from public.facilities f where f.organization_id = o.id and f.name = 'Sunrise Manor');

insert into public.facilities (organization_id, name, facility_type, address, city, state, zip)
select o.id, 'Sunrise Gardens', 'ALR', '200 Corporate Blvd', 'Philadelphia', 'PA', '19103'
from public.organizations o where o.slug = 'sunrise-healthcare'
and not exists (select 1 from public.facilities f where f.organization_id = o.id and f.name = 'Sunrise Gardens');

insert into public.facilities (organization_id, name, facility_type, address, city, state, zip)
select o.id, 'Maple Grove Residence', 'PCH', '50 Maple Grove Way', 'Pittsburgh', 'PA', '15222'
from public.organizations o where o.slug = 'maple-grove'
and not exists (select 1 from public.facilities f where f.organization_id = o.id and f.name = 'Maple Grove Residence');

-- Local-only demo Supabase Auth users. Hosted environments create their own public-demo
-- users through the Admin API and inject only those synthetic credentials at deploy time.
-- Inserted directly into auth.users/auth.identities (rather than via the Admin API) since this
-- script runs in contexts with no service-role key available; mirrors Supabase's documented
-- direct-SQL seed pattern. The handle_new_user() trigger auto-provisions the matching profiles row.
do $$
declare
  v_user_id uuid;
begin
  if not exists (select 1 from auth.users where email = 'admin@sunrisehealthcare.com') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'admin@sunrisehealthcare.com', extensions.crypt('demo123', extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','org_admin',
        'organization_id', (select id::text from public.organizations where slug = 'sunrise-healthcare')),
      jsonb_build_object('first_name','Robert','last_name','Chen'),
      now(), now(), '', '', '', '', '', '', false, false
    ) returning id into v_user_id;
    insert into auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_user_id, v_user_id::text, jsonb_build_object('sub', v_user_id::text, 'email', 'admin@sunrisehealthcare.com'), 'email', now(), now(), now());
  end if;

  if not exists (select 1 from auth.users where email = 'manager@sunrisemanor.com') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'manager@sunrisemanor.com', extensions.crypt('demo123', extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','facility_manager',
        'organization_id', (select id::text from public.organizations where slug = 'sunrise-healthcare')),
      jsonb_build_object('first_name','Dana','last_name','Brooks'),
      now(), now(), '', '', '', '', '', '', false, false
    ) returning id into v_user_id;
    insert into auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_user_id, v_user_id::text, jsonb_build_object('sub', v_user_id::text, 'email', 'manager@sunrisemanor.com'), 'email', now(), now(), now());
    insert into public.facility_assignments (profile_id, facility_id)
    select v_user_id, f.id from public.facilities f
    join public.organizations o on o.id = f.organization_id
    where o.slug = 'sunrise-healthcare' and f.name = 'Sunrise Manor';
    insert into public.employees (organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status)
    select o.id, f.id, v_user_id, 'Dana', 'Brooks', 'manager@sunrisemanor.com', 'Facility Administrator', '2023-03-01', 'active'
    from public.organizations o, public.facilities f where o.slug = 'sunrise-healthcare' and f.name = 'Sunrise Manor';
  end if;

  if not exists (select 1 from auth.users where email = 'trainer@sunrisehealthcare.com') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'trainer@sunrisehealthcare.com', extensions.crypt('demo123', extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','trainer',
        'organization_id', (select id::text from public.organizations where slug = 'sunrise-healthcare')),
      jsonb_build_object('first_name','Casey','last_name','Nguyen'),
      now(), now(), '', '', '', '', '', '', false, false
    ) returning id into v_user_id;
    insert into auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_user_id, v_user_id::text, jsonb_build_object('sub', v_user_id::text, 'email', 'trainer@sunrisehealthcare.com'), 'email', now(), now(), now());
    insert into public.facility_assignments (profile_id, facility_id)
    select v_user_id, f.id from public.facilities f
    join public.organizations o on o.id = f.organization_id
    where o.slug = 'sunrise-healthcare' and f.name in ('Sunrise Manor', 'Sunrise Gardens');
    insert into public.employees (organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status, trainer_status)
    select o.id, f.id, v_user_id, 'Casey', 'Nguyen', 'trainer@sunrisehealthcare.com', 'Staff Trainer', '2022-08-15', 'active', true
    from public.organizations o, public.facilities f where o.slug = 'sunrise-healthcare' and f.name = 'Sunrise Manor';
  end if;

  if not exists (select 1 from auth.users where email = 'admin@maplegrove.com') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'admin@maplegrove.com', extensions.crypt('demo123', extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','org_admin',
        'organization_id', (select id::text from public.organizations where slug = 'maple-grove')),
      jsonb_build_object('first_name','Patricia','last_name','Nguyen'),
      now(), now(), '', '', '', '', '', '', false, false
    ) returning id into v_user_id;
    insert into auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_user_id, v_user_id::text, jsonb_build_object('sub', v_user_id::text, 'email', 'admin@maplegrove.com'), 'email', now(), now(), now());
  end if;

  if not exists (select 1 from auth.users where email = 'auditor@sunrisehealthcare.com') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'auditor@sunrisehealthcare.com', extensions.crypt('demo123', extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','auditor',
        'organization_id', (select id::text from public.organizations where slug = 'sunrise-healthcare')),
      jsonb_build_object('first_name','Jordan','last_name','Patel'),
      now(), now(), '', '', '', '', '', '', false, false
    ) returning id into v_user_id;
    insert into auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_user_id, v_user_id::text, jsonb_build_object('sub', v_user_id::text, 'email', 'auditor@sunrisehealthcare.com'), 'email', now(), now(), now());
  end if;

  if not exists (select 1 from auth.users where email = 'employee@sunrisehealthcare.com') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      'employee@sunrisehealthcare.com', extensions.crypt('demo123', extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','employee',
        'organization_id', (select id::text from public.organizations where slug = 'sunrise-healthcare')),
      jsonb_build_object('first_name','Avery','last_name','Johnson'),
      now(), now(), '', '', '', '', '', '', false, false
    ) returning id into v_user_id;
    insert into auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_user_id, v_user_id::text, jsonb_build_object('sub', v_user_id::text, 'email', 'employee@sunrisehealthcare.com'), 'email', now(), now(), now());
    insert into public.employees (organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status, administers_medications)
    select o.id, f.id, v_user_id, 'Avery', 'Johnson', 'employee@sunrisehealthcare.com', 'Direct Care Staff', '2026-02-12', 'active', true
    from public.organizations o, public.facilities f where o.slug = 'sunrise-healthcare' and f.name = 'Sunrise Manor';
  end if;
end $$;

-- Every person and operational record in the public demo tenant is synthetic.
update public.employees e
set is_synthetic = true, updated_at = now()
from public.organizations o
where e.organization_id = o.id and o.slug = 'sunrise-healthcare';

select app_private.seed_demo_organization(id)
from public.organizations
where slug = 'sunrise-healthcare' and is_demo;

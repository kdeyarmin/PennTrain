-- Demo/seed data for CareMetric Train.
-- Safe to re-run: every insert is guarded by ON CONFLICT DO NOTHING or a WHERE NOT EXISTS-style
-- subquery keyed on a unique natural key (slug, name, email).

-- Packages catalog
insert into public.packages (name, learner_limit, facility_limit, price_monthly_cents, features, sort_order) values
  ('Starter', 25, 1, 9900, '{"compliance_binder": false, "medication_tracking": false, "competency_checklists": false}'::jsonb, 1),
  ('Compliance Plus', 100, 5, 29900, '{"compliance_binder": true, "medication_tracking": true, "competency_checklists": true}'::jsonb, 2),
  ('Enterprise', null, null, null, '{"compliance_binder": true, "medication_tracking": true, "competency_checklists": true, "custom_compliance_templates": true, "api_access": true}'::jsonb, 3)
on conflict (name) do nothing;

-- Demo organizations
insert into public.organizations (name, slug, contact_name, contact_email, contact_phone, address, city, state, zip, subscription_status, plan_name, package_id)
select 'Sunrise Healthcare Group', 'sunrise-healthcare', 'Dr. Robert Chen', 'robert.chen@sunrisehealthcare.com', '215-555-0100',
  '100 Corporate Blvd', 'Philadelphia', 'PA', '19103', 'active', 'Compliance Plus', p.id
from public.packages p where p.name = 'Compliance Plus'
on conflict (slug) do nothing;

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

-- Auth users are intentionally not seeded here. Never ship reusable platform_admin or demo
-- passwords in source-controlled SQL; create environment-specific users via Supabase Admin API,
-- invite-user, or signup-organization so credentials are generated and rotated per environment.

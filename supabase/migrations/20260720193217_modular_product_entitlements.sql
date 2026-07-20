-- CareMetric commercial product modules.
--
-- The application has one shared identity/directory shell and two independently entitled
-- products:
--   * modules.train    - LMS, course delivery, assignments, records, and certificates
--   * modules.carebase - resident/workforce/operations/compliance/forms/reporting; includes Train
--
-- Existing packages retain the complete experience through true defaults. New contracts can use
-- the two named packages below, while platform administrators can still compose custom packages
-- through the existing typed package-entitlement engine.

insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value, is_active
)
values
  (
    'modules.train',
    'CareMetric Train',
    'Online courses, assignments, learning plans, training records, and certificates',
    'boolean', 'true'::jsonb, true
  ),
  (
    'modules.carebase',
    'CareMetric CareBase',
    'Resident, workforce, forms, operations, compliance, and reporting suite; includes CareMetric Train',
    'boolean', 'true'::jsonb, true
  )
on conflict (feature_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  value_type = excluded.value_type,
  is_active = true,
  updated_at = now();

insert into public.packages (
  name, learner_limit, facility_limit, price_monthly_cents, features, sort_order, is_active
)
values
  (
    'CareMetric Train', null, null, null,
    '{"modules.train":true,"modules.carebase":false}'::jsonb,
    10, true
  ),
  (
    'CareMetric CareBase', null, null, null,
    '{"modules.train":true,"modules.carebase":true}'::jsonb,
    20, true
  )
on conflict (name) do update set
  features = coalesce(public.packages.features, '{}'::jsonb) || excluded.features,
  is_active = true,
  updated_at = now();

-- Private resource registry. Every existing RLS-protected public business table is classified as
-- Train, CareBase, or part of the shared core. Only non-core resources need a row here.
create table app_private.product_module_resources (
  resource_schema text not null default 'public' check (resource_schema = 'public'),
  resource_name text not null check (resource_name ~ '^[a-z][a-z0-9_]{1,62}$'),
  module_key text not null check (module_key in ('modules.train', 'modules.carebase')),
  classified_at timestamptz not null default now(),
  primary key (resource_schema, resource_name)
);

comment on table app_private.product_module_resources is
  'Authoritative module classification for tenant-facing Data API tables. Core tables are intentionally absent.';

revoke all on app_private.product_module_resources from public, anon, authenticated;
grant all on app_private.product_module_resources to service_role;

-- Storage is one shared table, so classify its buckets separately. Unknown future buckets fail
-- closed for organization users until a product owner deliberately assigns them to a module.
create table app_private.product_module_storage_buckets (
  bucket_id text primary key,
  module_key text not null check (module_key in ('core', 'modules.train', 'modules.carebase'))
);

insert into app_private.product_module_storage_buckets (bucket_id, module_key)
values
  ('org-branding', 'core'),
  ('support-ticket-attachments', 'core'),
  ('organization-exports', 'core'),
  ('external-uploads', 'modules.train'),
  ('signin-sheets', 'modules.train'),
  ('course-documents', 'modules.train'),
  ('certificates', 'modules.train'),
  ('course-videos', 'modules.train'),
  ('class-notices', 'modules.train'),
  ('competency-attachments', 'modules.carebase'),
  ('binder-exports', 'modules.carebase'),
  ('credential-documents', 'modules.carebase'),
  ('incident-documents', 'modules.carebase'),
  ('incident-reports', 'modules.carebase'),
  ('policy-documents', 'modules.carebase'),
  ('administrator-documents', 'modules.carebase'),
  ('violation-documents', 'modules.carebase'),
  ('resident-documents', 'modules.carebase'),
  ('work-item-evidence', 'modules.carebase'),
  ('maintenance-documents', 'modules.carebase'),
  ('state-form-analyzer', 'modules.carebase'),
  ('emergency-documents', 'modules.carebase');

revoke all on app_private.product_module_storage_buckets from public, anon, authenticated;
grant all on app_private.product_module_storage_buckets to service_role;

-- The security-definer is intentionally private and accepts no organization id: callers can only
-- evaluate their own trusted profile organization. Platform administrators retain cross-tenant
-- support access, while a missing/inactive entitlement fails closed.
create or replace function app_private.has_product_module(p_module_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  if p_module_key not in ('modules.train', 'modules.carebase') then
    return false;
  end if;
  if coalesce(auth.jwt()->>'role', '') = 'service_role' or public.is_platform_admin() then
    return true;
  end if;
  if auth.uid() is null then return false; end if;
  v_org_id := public.current_org_id();
  if v_org_id is null then return false; end if;
  if p_module_key = 'modules.train' then
    return public.has_effective_entitlement(v_org_id, 'modules.train', 1, now())
      or public.has_effective_entitlement(v_org_id, 'modules.carebase', 1, now());
  end if;
  return public.has_effective_entitlement(v_org_id, p_module_key, 1, now());
end;
$$;

revoke all on function app_private.has_product_module(text) from public, anon;
grant execute on function app_private.has_product_module(text) to authenticated, service_role;

create or replace function app_private.has_product_module_for_bucket(p_bucket_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_module_key text;
begin
  if public.is_platform_admin() then return true; end if;
  select b.module_key
  into v_module_key
  from app_private.product_module_storage_buckets b
  where b.bucket_id = p_bucket_id;
  if not found then return false; end if;
  if v_module_key = 'core' then return true; end if;
  return app_private.has_product_module(v_module_key);
end;
$$;

revoke all on function app_private.has_product_module_for_bucket(text) from public, anon;
grant execute on function app_private.has_product_module_for_bucket(text) to authenticated, service_role;

-- Train owns learning delivery. CareBase owns every other tenant business surface except the
-- explicit shared shell below. Classification is data-driven so this migration covers the whole
-- current schema rather than protecting only the handful of tables visible in one route.
insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
select
  n.nspname,
  c.relname,
  case
    when c.relname ~ '^(course|courses$|quiz|quizzes$|certificate|certificates$|training_|employee_training_|learning_|offline_content_|governed_content_|class_checkin_|lti_|xapi_)'
      then 'modules.train'
    else 'modules.carebase'
  end
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relrowsecurity
  and c.relname not in (
    -- Tenant identity and learner/facility directory shared by every product.
    'organizations', 'organization_settings', 'facilities', 'facility_assignments',
    'employees', 'employee_facility_assignments', 'profiles',
    -- Contract, release, and billing metadata power the entitlement decision itself.
    'packages', 'package_entitlements', 'package_billing_prices',
    'feature_definitions', 'feature_kill_switches', 'release_flags', 'release_cohorts',
    'organization_release_cohorts', 'organization_entitlement_grants',
    'billing_accounts', 'billing_invoices', 'billing_subscriptions', 'billing_subscription_items',
    -- Account communications, support, navigation, and product telemetry remain shared shell.
    'help_articles', 'support_tickets', 'support_ticket_messages',
    'notifications', 'notification_channel_policies', 'notification_consent_events',
    'notification_deliveries', 'notification_delivery_attempts', 'notification_escalation_rules',
    'notification_provider_events', 'notification_spend_alerts', 'notification_spend_policies',
    'notification_templates', 'push_subscriptions',
    'org_announcements', 'org_announcement_receipts', 'navigation_preferences',
    'product_changelog_reads', 'product_events', 'request_demo_submissions',
    'session_lock_events'
  )
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

-- Restrictive policies compose with every existing role/organization/facility policy: both the
-- old authorization rule AND this commercial module rule must pass. anon/public guest workflows
-- are unchanged because this policy is deliberately scoped to authenticated callers.
do $$
declare
  v_resource record;
begin
  for v_resource in
    select resource_schema, resource_name, module_key
    from app_private.product_module_resources
    order by resource_schema, resource_name
  loop
    execute format(
      'drop policy if exists product_module_entitlement on %I.%I',
      v_resource.resource_schema,
      v_resource.resource_name
    );
    execute format(
      'create policy product_module_entitlement on %I.%I as restrictive for all to authenticated using ((select app_private.has_product_module(%L))) with check ((select app_private.has_product_module(%L)))',
      v_resource.resource_schema,
      v_resource.resource_name,
      v_resource.module_key,
      v_resource.module_key
    );
  end loop;
end;
$$;

-- Storage policies also compose restrictively with every existing per-bucket ownership policy.
-- Public/anon behavior is unchanged; all current private buckets are explicitly classified above.
drop policy if exists product_module_entitlement on storage.objects;
create policy product_module_entitlement
on storage.objects
as restrictive
for all
to authenticated
using ((select app_private.has_product_module_for_bucket(bucket_id)))
with check ((select app_private.has_product_module_for_bucket(bucket_id)));

-- Make the dependency explicit at the contract boundary: any package that enables CareBase must
-- also enable Train. The package editor mirrors this rule in the UI; the trigger protects SQL and
-- integration writes as well.
create or replace function app_private.enforce_carebase_includes_train()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((new.features ->> 'modules.carebase')::boolean, false) then
    new.features := coalesce(new.features, '{}'::jsonb) || '{"modules.train":true}'::jsonb;
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_carebase_includes_train() from public, anon, authenticated;
create trigger enforce_carebase_includes_train
before insert or update of features on public.packages
for each row execute function app_private.enforce_carebase_includes_train();

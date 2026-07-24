-- Modular pillar packages.
--
-- The single large `modules.carebase` product is decomposed into independently entitled
-- operational pillars so facilities can buy tiered bundles below the full care-operations suite:
--
--   * modules.train      - LMS, course delivery, assignments, records, and certificates (unchanged)
--   * modules.workforce  - credentialing, competencies, screening, scheduling, and practicums
--   * modules.compliance - inspections, survey day, violations, complaints, forms, evidence, QAPI, policies
--   * modules.billing    - resident financial operations (rate agreements, statements, receivables, payments)
--   * modules.carebase   - the all-inclusive suite. Now includes Train, Workforce, Compliance, and Billing.
--
-- Backward compatibility: `modules.carebase` remains the umbrella entitlement, so every existing
-- CareBase customer keeps access to every pillar table through the has_product_module dependency
-- below and the packages compatibility trigger. The three new pillar definitions default to FALSE,
-- so a Train-only facility does not silently gain the pillars. Cross-pillar directory/record tables
-- (the resident directory and the staff credential/administrator records) are promoted to the shared
-- core shell -- like the employee directory -- because the Compliance and Billing pillars operate on
-- residents and staff records without also purchasing full Care Operations.
--
-- The customer-facing catalog is a tier ladder (Train -> Essentials -> Professional -> CareBase ->
-- Portfolio). The pillar modules are the entitlement building blocks; platform administrators can
-- still compose any custom pillar combination in Admin > Packages & billing.

-- 1. Allow the new module keys in the private classification registries.
alter table app_private.product_module_resources
  drop constraint if exists product_module_resources_module_key_check;
alter table app_private.product_module_resources
  add constraint product_module_resources_module_key_check
  check (module_key in (
    'modules.train', 'modules.workforce', 'modules.compliance', 'modules.billing', 'modules.carebase'
  ));

alter table app_private.product_module_storage_buckets
  drop constraint if exists product_module_storage_buckets_module_key_check;
alter table app_private.product_module_storage_buckets
  add constraint product_module_storage_buckets_module_key_check
  check (module_key in (
    'core', 'modules.train', 'modules.workforce', 'modules.compliance', 'modules.billing', 'modules.carebase'
  ));

-- 2. Typed definitions for the three new pillars. They default OFF so only packages that explicitly
--    enable a pillar (or the all-inclusive CareBase bundle) grant it.
insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value, is_active
)
values
  (
    'modules.workforce', 'CareMetric Workforce',
    'Credentialing, competencies, background and exclusion screening, scheduling, and practicums',
    'boolean', 'false'::jsonb, true
  ),
  (
    'modules.compliance', 'CareMetric Compliance',
    'Inspection readiness, survey day, violations, complaints, state forms, evidence, QAPI, and policies',
    'boolean', 'false'::jsonb, true
  ),
  (
    'modules.billing', 'CareMetric Billing',
    'Resident financial operations: rate agreements, statements, receivables, payments, and personal funds',
    'boolean', 'false'::jsonb, true
  )
on conflict (feature_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  value_type = excluded.value_type,
  is_active = true,
  updated_at = now();

-- 3. Caller-scoped module check. CareBase is the all-inclusive bundle, so it grants every pillar.
--    This preserves access for every existing CareBase customer even though the pillar tables now
--    carry pillar-specific restrictive policies. A missing/inactive entitlement still fails closed.
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
  if p_module_key not in (
    'modules.train', 'modules.workforce', 'modules.compliance', 'modules.billing', 'modules.carebase'
  ) then
    return false;
  end if;
  if coalesce(auth.jwt()->>'role', '') = 'service_role' or public.is_platform_admin() then
    return true;
  end if;
  if auth.uid() is null then return false; end if;
  v_org_id := public.current_org_id();
  if v_org_id is null then return false; end if;
  -- CareBase includes every operational pillar (Train, Workforce, Compliance, Billing).
  if public.has_effective_entitlement(v_org_id, 'modules.carebase', 1, now()) then
    return true;
  end if;
  return public.has_effective_entitlement(v_org_id, p_module_key, 1, now());
end;
$$;

revoke all on function app_private.has_product_module(text) from public, anon;
grant execute on function app_private.has_product_module(text) to authenticated, service_role;

-- 4. Contract boundary: any package that enables CareBase enables every bundled pillar. Replaces the
--    original CareBase-includes-Train trigger. Legacy packages without a modules.carebase key keep
--    full access because the key defaults to true here, exactly as before.
drop trigger if exists enforce_carebase_includes_train on public.packages;
drop function if exists app_private.enforce_carebase_includes_train();

create or replace function app_private.enforce_carebase_bundle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((new.features ->> 'modules.carebase')::boolean, true) then
    new.features := coalesce(new.features, '{}'::jsonb) || jsonb_build_object(
      'modules.train', true,
      'modules.workforce', true,
      'modules.compliance', true,
      'modules.billing', true
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_carebase_bundle() from public, anon, authenticated;
create trigger enforce_carebase_bundle
before insert or update of features on public.packages
for each row execute function app_private.enforce_carebase_bundle();

-- 5. Promote cross-pillar directory/record tables to the shared core shell.
--    * residents / resident_contacts: the Compliance and Billing pillars identify and bill residents
--      without purchasing full Care Operations, so the base resident directory joins them like the
--      shared employee directory.
--    * employee_credentials / employee_credential_documents / administrator_profiles /
--      administrator_ce_entries: staff qualification RECORDS surfaced on the core employee and
--      facility directory pages AND read by both the Compliance readiness pages and the Workforce
--      credentialing pages. Only the credentialing WORKFLOW routes are commercially gated (to the
--      Workforce module); the underlying records stay in the shared directory shell so every care
--      tier renders a consistent staff record.
--    Tenant/role/facility RLS still governs which rows each user may see; only the commercial module
--    gate is relaxed here. Resident CARE records and staff scheduling/screening records remain
--    classified under their pillars.
do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'residents', 'resident_contacts',
    'employee_credentials', 'employee_credential_documents',
    'administrator_profiles', 'administrator_ce_entries'
  ]
  loop
    delete from app_private.product_module_resources
      where resource_schema = 'public' and resource_name = v_name;
    execute format('drop policy if exists product_module_entitlement on public.%I', v_name);
  end loop;
end;
$$;

-- 6. Reclassify the pillar-owned tables and rebuild each restrictive policy with the new module key.
--    Everything not listed here stays classified as modules.carebase (Care Operations), which is the
--    safe direction: CareBase retains access through the dependency above, and no lower tier can read
--    a care-operations table it did not buy. Ambiguous/shared tables are intentionally left as-is.
do $$
declare
  v_row record;
begin
  for v_row in
    select resource_name, module_key from (values
      -- Billing: resident financial operations. Exclusive to useResidentFinancialOperations; the
      -- resident-portal payment links and the residency agreement remain Care Operations.
      ('resident_financial_accounts', 'modules.billing'),
      ('resident_financial_history', 'modules.billing'),
      ('resident_financial_statements', 'modules.billing'),
      ('resident_financial_transactions', 'modules.billing'),
      ('resident_personal_fund_accounts', 'modules.billing'),
      ('resident_personal_fund_payee_profiles', 'modules.billing'),
      ('resident_personal_fund_reconciliations', 'modules.billing'),
      ('resident_personal_fund_transactions', 'modules.billing'),
      ('resident_accounting_exports', 'modules.billing'),
      ('resident_rate_agreements', 'modules.billing'),
      -- Workforce: scheduling, screening, competency, and staff lifecycle. The credentialing RECORD
      -- backbone (employee_credentials, administrator_profiles, and children) is promoted to core
      -- above because the Compliance readiness pages read it too; only the workflow routes are gated.
      ('schedules', 'modules.workforce'),
      ('shift_assignments', 'modules.workforce'),
      ('shift_definitions', 'modules.workforce'),
      ('service_workload_profiles', 'modules.workforce'),
      ('employee_schedule_preferences', 'modules.workforce'),
      ('employee_availability_windows', 'modules.workforce'),
      ('schedule_eligibility_decisions', 'modules.workforce'),
      ('schedule_eligibility_overrides', 'modules.workforce'),
      ('schedule_eligibility_policies', 'modules.workforce'),
      ('shift_eligibility_requirements', 'modules.workforce'),
      ('shift_report_acknowledgements', 'modules.workforce'),
      ('shift_report_entries', 'modules.workforce'),
      ('shift_swap_requests', 'modules.workforce'),
      ('open_shift_claims', 'modules.workforce'),
      ('open_shift_opportunities', 'modules.workforce'),
      ('workforce_time_off_requests', 'modules.workforce'),
      ('employee_background_check_profiles', 'modules.workforce'),
      ('exclusion_list_entries', 'modules.workforce'),
      ('exclusion_refresh_runs', 'modules.workforce'),
      ('exclusion_screening_matches', 'modules.workforce'),
      ('exclusion_source_snapshots', 'modules.workforce'),
      ('exclusion_source_state', 'modules.workforce'),
      ('competency_record_items', 'modules.workforce'),
      ('competency_records', 'modules.workforce'),
      ('competency_template_items', 'modules.workforce'),
      ('competency_templates', 'modules.workforce'),
      ('employee_qualifications', 'modules.workforce'),
      ('employee_onboarding_items', 'modules.workforce'),
      ('employee_checkin_logs', 'modules.workforce'),
      ('employee_access_suspensions', 'modules.workforce'),
      ('employee_compliance_profile_assignments', 'modules.workforce'),
      ('credential_renewal_submissions', 'modules.workforce'),
      ('qualification_lifecycle_events', 'modules.workforce'),
      ('assessor_qualifications', 'modules.workforce'),
      ('onboarding_checklist_templates', 'modules.workforce'),
      ('practicums', 'modules.workforce'),
      ('workforce_people', 'modules.workforce'),
      ('workforce_employee_links', 'modules.workforce'),
      ('workforce_backfill_exceptions', 'modules.workforce'),
      ('employment_episodes', 'modules.workforce'),
      ('employment_lifecycle_events', 'modules.workforce'),
      ('employment_lifecycle_dispositions', 'modules.workforce'),
      ('hris_source_systems', 'modules.workforce'),
      ('hris_import_runs', 'modules.workforce'),
      ('hris_import_rows', 'modules.workforce'),
      ('hris_import_exceptions', 'modules.workforce'),
      ('hris_identity_links', 'modules.workforce'),
      ('certification_attempt_items', 'modules.workforce'),
      ('certification_attempts', 'modules.workforce'),
      ('certification_checklist_items', 'modules.workforce'),
      ('certification_definition_versions', 'modules.workforce'),
      ('certification_definitions', 'modules.workforce'),
      -- Compliance: inspections, survey, violations, complaints, evidence, QAPI, policies, regulatory
      -- engine, and the resident/inspection compliance tables. Care Operations pages that also read
      -- inspection_items / corrective_actions / resident_compliance_items keep access because the
      -- CareBase bundle includes Compliance.
      ('binder_export_jobs', 'modules.compliance'),
      ('complaint_corrective_actions', 'modules.compliance'),
      ('complaint_history', 'modules.compliance'),
      ('complaint_interviews', 'modules.compliance'),
      ('complaint_monitoring_entries', 'modules.compliance'),
      ('complaints', 'modules.compliance'),
      ('compliance_copilot_runs', 'modules.compliance'),
      ('compliance_profile_definitions', 'modules.compliance'),
      ('compliance_profile_mapping_rules', 'modules.compliance'),
      ('compliance_profile_requirements', 'modules.compliance'),
      ('compliance_profile_resolution_exceptions', 'modules.compliance'),
      ('copilot_action_drafts', 'modules.compliance'),
      ('corrective_actions', 'modules.compliance'),
      ('dhs_citation_topics', 'modules.compliance'),
      ('dhs_violations', 'modules.compliance'),
      ('entrance_conference_items', 'modules.compliance'),
      ('evidence_collection_artifacts', 'modules.compliance'),
      ('evidence_collections', 'modules.compliance'),
      ('evidence_guest_access_events', 'modules.compliance'),
      ('evidence_guest_comments', 'modules.compliance'),
      ('evidence_guest_grants', 'modules.compliance'),
      ('inspection_events', 'modules.compliance'),
      ('inspection_items', 'modules.compliance'),
      ('inspection_war_room_requests', 'modules.compliance'),
      ('inspection_war_rooms', 'modules.compliance'),
      ('mock_inspection_runs', 'modules.compliance'),
      ('policy_attestation_campaigns', 'modules.compliance'),
      ('policy_attestations', 'modules.compliance'),
      ('policy_audience_rules', 'modules.compliance'),
      ('policy_delivery_events', 'modules.compliance'),
      ('policy_document_versions', 'modules.compliance'),
      ('policy_documents', 'modules.compliance'),
      ('policy_version_links', 'modules.compliance'),
      ('qapi_action_items', 'modules.compliance'),
      ('qapi_measurements', 'modules.compliance'),
      ('qapi_meeting_notes', 'modules.compliance'),
      ('qapi_project_history', 'modules.compliance'),
      ('qapi_projects', 'modules.compliance'),
      ('regulatory_change_proposals', 'modules.compliance'),
      ('regulatory_rule_fixture_runs', 'modules.compliance'),
      ('regulatory_rule_golden_fixtures', 'modules.compliance'),
      ('regulatory_rule_pack_templates', 'modules.compliance'),
      ('regulatory_rule_packs', 'modules.compliance'),
      ('regulatory_rule_shadow_differences', 'modules.compliance'),
      ('regulatory_rule_shadow_reconciliations', 'modules.compliance'),
      ('regulatory_rule_shadow_runs', 'modules.compliance'),
      ('regulatory_rule_versions', 'modules.compliance'),
      ('resident_compliance_items', 'modules.compliance'),
      ('resident_compliance_rule_packs', 'modules.compliance'),
      ('survey_day_checklist_items', 'modules.compliance'),
      ('survey_day_events', 'modules.compliance'),
      ('survey_day_sessions', 'modules.compliance'),
      ('violation_documents', 'modules.compliance')
    ) as t(resource_name, module_key)
  loop
    -- Only reclassify tables that actually exist as RLS-eligible relations in this deployment.
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_row.resource_name
        and c.relkind in ('r', 'p')
    ) then
      continue;
    end if;

    insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
    values ('public', v_row.resource_name, v_row.module_key)
    on conflict (resource_schema, resource_name) do update set
      module_key = excluded.module_key,
      classified_at = now();

    execute format(
      'drop policy if exists product_module_entitlement on public.%I',
      v_row.resource_name
    );
    execute format(
      'create policy product_module_entitlement on public.%I as restrictive for all to authenticated using ((select app_private.has_product_module(%L))) with check ((select app_private.has_product_module(%L)))',
      v_row.resource_name,
      v_row.module_key,
      v_row.module_key
    );
  end loop;
end;
$$;

-- 7. Reclassify pillar-owned private storage buckets. Care-operations buckets (resident, incident,
--    maintenance, emergency, work-item) stay under CareBase.
update app_private.product_module_storage_buckets set module_key = 'modules.workforce'
  where bucket_id in ('competency-attachments', 'credential-documents', 'administrator-documents');
update app_private.product_module_storage_buckets set module_key = 'modules.compliance'
  where bucket_id in ('binder-exports', 'policy-documents', 'violation-documents', 'state-form-analyzer');

-- 8. Tier ladder. CareBase stays $499/mo and remains the all-inclusive recommended suite; the new
--    resident-priced tiers slot in beneath it. Existing packages keep their live prices unchanged.
update public.packages
set features = coalesce(features, '{}'::jsonb) || '{"modules.workforce":false,"modules.compliance":false,"modules.billing":false}'::jsonb,
    updated_at = now()
where name = 'CareMetric Train';

update public.packages
set description = 'The all-inclusive care operations suite: CareMetric Train, Workforce, Compliance, and Billing plus resident records, medication, dietary, incidents, emergency, maintenance, and reporting.',
    features = coalesce(features, '{}'::jsonb) || '{"modules.train":true,"modules.workforce":true,"modules.compliance":true,"modules.billing":true,"modules.carebase":true}'::jsonb,
    updated_at = now()
where name = 'CareMetric CareBase';

update public.packages
set features = coalesce(features, '{}'::jsonb) || '{"modules.train":true,"modules.workforce":true,"modules.compliance":true,"modules.billing":true,"modules.carebase":true}'::jsonb,
    updated_at = now()
where name = 'CareMetric Portfolio';

insert into public.packages (
  name, description, pricing_strategy, price_monthly_cents, features,
  is_recommended, contact_sales, trial_days, annual_discount_percent,
  learner_limit, facility_limit, sort_order, is_active
)
values
  (
    'CareMetric Essentials',
    'Training plus survey-ready compliance: inspection readiness, survey day, violations, complaints, state forms, evidence, QAPI, and policy attestation. Priced by active resident.',
    'hybrid', 29900,
    '{"modules.train":true,"modules.compliance":true,"modules.workforce":false,"modules.billing":false,"modules.carebase":false}'::jsonb,
    false, false, 30, 16.67, null, null, 12, true
  ),
  (
    'CareMetric Professional',
    'Everything in Essentials plus workforce credentialing and scheduling and resident billing operations. The complete compliance, workforce, and financial toolkit, priced by active resident.',
    'hybrid', 39900,
    '{"modules.train":true,"modules.compliance":true,"modules.workforce":true,"modules.billing":true,"modules.carebase":false}'::jsonb,
    false, false, 30, 16.67, null, null, 14, true
  )
on conflict (name) do update set
  description = excluded.description,
  pricing_strategy = excluded.pricing_strategy,
  price_monthly_cents = excluded.price_monthly_cents,
  features = coalesce(public.packages.features, '{}'::jsonb) || excluded.features,
  is_recommended = excluded.is_recommended,
  contact_sales = excluded.contact_sales,
  trial_days = excluded.trial_days,
  annual_discount_percent = excluded.annual_discount_percent,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

-- 9. Draft display prices for the new tiers. Stripe IDs are intentionally omitted; a platform admin
--    connects each row to an immutable Stripe Price before customer checkout is enabled. Structure
--    mirrors the CareBase resident pricing: base fee including 25 residents, then a per-resident
--    overage ($4/month, $40/year).
insert into public.package_billing_prices (
  package_id, stripe_price_id, display_name, currency, recurring_interval,
  interval_count, billing_metric, pricing_model, base_amount_cents,
  unit_amount_cents, included_quantity, minimum_quantity, maximum_quantity,
  is_primary, is_active, sort_order
)
select p.id, null, v.display_name, 'usd', v.recurring_interval, 1,
  'active_resident', 'flat_plus_overage', v.base_amount_cents,
  v.unit_amount_cents, 25, 1, null, true, true, v.sort_order
from public.packages p
join (values
  ('CareMetric Essentials'::text, 'Monthly active residents'::text, 'month'::text, 29900, 400, 10),
  ('CareMetric Essentials'::text, 'Annual active residents'::text, 'year'::text, 299000, 4000, 20),
  ('CareMetric Professional'::text, 'Monthly active residents'::text, 'month'::text, 39900, 400, 10),
  ('CareMetric Professional'::text, 'Annual active residents'::text, 'year'::text, 399000, 4000, 20)
) v(package_name, display_name, recurring_interval, base_amount_cents, unit_amount_cents, sort_order)
  on p.name = v.package_name
where not exists (
  select 1 from public.package_billing_prices x
  where x.package_id = p.id
    and x.recurring_interval = v.recurring_interval
    and x.billing_metric = 'active_resident'
    and x.effective_to is null
);

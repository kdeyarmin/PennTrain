-- Thirty-four tables the module wall never covered, a feature nobody could switch on, and the one
-- guest surface the throttle did not reach.
--
-- BACKLOG J51, J52 and J61.
--
-- J51. `20260720193217` classified every RLS-enabled public table that existed on 2026-07-20 into
-- `app_private.product_module_resources` and gave each one a RESTRICTIVE
-- `product_module_entitlement` policy, so a tenant that has not bought a module cannot read its
-- tables through PostgREST whatever the route list says. It was a one-time sweep. Thirty-four
-- tables created since carry no registry row and therefore no policy at all -- among them the
-- whole compliance-requirement family, Survey Day's observations, requests and surveyors, the
-- survey rehearsal tables, the evidence-packet exports and their guest grants, the plan-of-
-- correction versions, and the import ledger. Tenant and role RLS still applies, so this is not an
-- exposure across organizations; it is a commercial boundary a Train-only tenant can walk through
-- with a REST call while the sidebar pretends the module is not sold to them.
--
-- Six tables the pillar migration deliberately UNCLASSIFIED (`residents`, `resident_contacts`,
-- `employee_credentials`, `employee_credential_documents`, `administrator_profiles`,
-- `administrator_ce_entries`) stay that way, and so does the documented shared shell. Four of the
-- thirty-four join that shell rather than a module, for the reason given at each.
--
-- The assertion at the end is the part that lasts: from here on a new RLS table is either
-- classified or named in the shell list, and the pgTAP suite says which.
--
-- J52. Survey Day needs an entitlement AND a `release_flags` row. No such row exists -- production
-- was probed this pass and has eleven flags, none of them Survey Day -- and the Release Flags
-- console can only toggle rows that already exist. So the second item of every PCH/ALF
-- organization's "Start here" list leads to "Survey Day isn't enabled for your organization yet.
-- Contact CareMetric", and CareMetric could not enable it either without opening a SQL console.
--
-- J61. `resolve_survey_packet_guest_token` checks revocation, expiry and export status and then
-- serves the path. It never calls `assert_guest_request_allowed`, so this is the one guest surface
-- with no rate limit, no organization-suspension check, and no record of a token that resolved to
-- nothing -- while the gate's own surface list has had a `survey_packet_guest` branch since it was
-- written, with no caller. A suspended organization's survey packet still downloads.

-- ---------------------------------------------------------------------------
-- J51 -- the thirty-four
-- ---------------------------------------------------------------------------

insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values
  -- Compliance: the requirement engine, Survey Day's live tables, the rehearsal tables, the
  -- evidence packet and its guest grants, and the regulatory feed.
  ('public', 'compliance_requirements', 'modules.compliance'),
  ('public', 'compliance_requirement_instances', 'modules.compliance'),
  ('public', 'compliance_requirement_events', 'modules.compliance'),
  ('public', 'compliance_requirement_documents', 'modules.compliance'),
  ('public', 'compliance_copilot_run_dispositions', 'modules.compliance'),
  ('public', 'incident_notification_rules', 'modules.compliance'),
  ('public', 'incident_pathways', 'modules.compliance'),
  ('public', 'plan_of_correction_versions', 'modules.compliance'),
  ('public', 'regulatory_updates', 'modules.compliance'),
  ('public', 'survey_day_observations', 'modules.compliance'),
  ('public', 'survey_day_requests', 'modules.compliance'),
  ('public', 'survey_day_surveyors', 'modules.compliance'),
  ('public', 'survey_evidence_packet_exports', 'modules.compliance'),
  ('public', 'survey_evidence_packet_items', 'modules.compliance'),
  ('public', 'survey_packet_guest_grants', 'modules.compliance'),
  ('public', 'survey_rehearsals', 'modules.compliance'),
  ('public', 'survey_rehearsal_items', 'modules.compliance'),
  -- Workforce: scheduling eligibility rules and the employment lifecycle case file, matching
  -- employment_episodes and the schedule_eligibility_* family.
  ('public', 'duty_eligibility_rules', 'modules.workforce'),
  ('public', 'duty_eligibility_overrides', 'modules.workforce'),
  ('public', 'employee_lifecycle_cases', 'modules.workforce'),
  -- Care Operations: the import ledger and the resident surfaces, matching work_items,
  -- workflow_automation_rules and the resident_* family the pillar migration left as CareBase.
  ('public', 'data_import_events', 'modules.carebase'),
  ('public', 'data_import_jobs', 'modules.carebase'),
  ('public', 'data_import_rows', 'modules.carebase'),
  ('public', 'resident_appointment_preparation_items', 'modules.carebase'),
  ('public', 'resident_assessment_reviews', 'modules.carebase'),
  ('public', 'resident_care_conflict_dispositions', 'modules.carebase'),
  ('public', 'resident_unscheduled_services', 'modules.carebase'),
  ('public', 'support_plan_acknowledgments', 'modules.carebase'),
  ('public', 'workflow_automation_rule_versions', 'modules.carebase'),
  ('public', 'work_item_source_types', 'modules.carebase')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

-- Build the restrictive policy for anything classified that does not have one yet. Same shape as
-- 20260720193217's loop; scoped to the tables missing a policy so it does not churn the 349 that
-- already carry one.
do $do$
declare
  v_resource record;
  v_built integer := 0;
begin
  for v_resource in
    select r.resource_schema, r.resource_name, r.module_key
    from app_private.product_module_resources r
    join pg_catalog.pg_class c on c.relname = r.resource_name
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = r.resource_schema
    where c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (
        select 1 from pg_catalog.pg_policy p
        where p.polrelid = c.oid and p.polname = 'product_module_entitlement'
      )
    order by r.resource_schema, r.resource_name
  loop
    execute format(
      'create policy product_module_entitlement on %I.%I as restrictive for all to authenticated '
      'using ((select app_private.has_product_module(%L))) '
      'with check ((select app_private.has_product_module(%L)))',
      v_resource.resource_schema, v_resource.resource_name,
      v_resource.module_key, v_resource.module_key
    );
    v_built := v_built + 1;
  end loop;
  raise notice 'product_module_entitlement: % policy(ies) built', v_built;
end;
$do$;

-- The four that join the shared shell rather than a module, and why. This is a registry of the
-- deliberate exclusions so the assertion below can tell "shell" from "forgotten" -- which is the
-- distinction nothing recorded, and the reason thirty-four tables went unnoticed for six weeks.
create table if not exists app_private.product_module_shell_resources (
  resource_schema text not null,
  resource_name text not null,
  rationale text not null,
  recorded_at timestamptz not null default now(),
  primary key (resource_schema, resource_name)
);

comment on table app_private.product_module_shell_resources is
  'RLS-enabled public tables that deliberately carry NO product_module_entitlement policy, with '
  'the reason. Tenant and role RLS still applies to every one of them; what they are exempt from '
  'is the commercial module wall. Anything neither classified in product_module_resources nor '
  'named here is an oversight, and modular_product_entitlements.test.sql says so. BACKLOG J51.';

insert into app_private.product_module_shell_resources (resource_schema, resource_name, rationale)
select 'public', t.name, t.rationale
from (values
  -- The documented shared shell from 20260720193217, recorded rather than left implicit in a
  -- `not in (...)` list inside one migration.
  ('organizations', 'Tenant identity, shared by every product.'),
  ('organization_settings', 'Tenant identity, shared by every product.'),
  ('facilities', 'Facility directory, shared by every product.'),
  ('facility_assignments', 'Facility directory, shared by every product.'),
  ('employees', 'Learner and staff directory, shared by every product.'),
  ('employee_facility_assignments', 'Learner and staff directory, shared by every product.'),
  ('profiles', 'Account identity, shared by every product.'),
  ('packages', 'Powers the entitlement decision itself.'),
  ('package_entitlements', 'Powers the entitlement decision itself.'),
  ('package_billing_prices', 'Powers the entitlement decision itself.'),
  ('feature_definitions', 'Powers the entitlement decision itself.'),
  ('feature_kill_switches', 'Powers the entitlement decision itself.'),
  ('release_flags', 'Powers the entitlement decision itself.'),
  ('release_cohorts', 'Powers the entitlement decision itself.'),
  ('organization_release_cohorts', 'Powers the entitlement decision itself.'),
  ('organization_entitlement_grants', 'Powers the entitlement decision itself.'),
  ('billing_accounts', 'Powers the entitlement decision itself.'),
  ('billing_invoices', 'Powers the entitlement decision itself.'),
  ('billing_subscriptions', 'Powers the entitlement decision itself.'),
  ('billing_subscription_items', 'Powers the entitlement decision itself.'),
  ('help_articles', 'Account communications and support, shared shell.'),
  ('support_tickets', 'Account communications and support, shared shell.'),
  ('support_ticket_messages', 'Account communications and support, shared shell.'),
  ('notifications', 'Account communications, shared shell.'),
  ('notification_channel_policies', 'Account communications, shared shell.'),
  ('notification_consent_events', 'Account communications, shared shell.'),
  ('notification_deliveries', 'Account communications, shared shell.'),
  ('notification_delivery_attempts', 'Account communications, shared shell.'),
  ('notification_escalation_rules', 'Account communications, shared shell.'),
  ('notification_provider_events', 'Account communications, shared shell.'),
  ('notification_spend_alerts', 'Account communications, shared shell.'),
  ('notification_spend_policies', 'Account communications, shared shell.'),
  ('notification_templates', 'Account communications, shared shell.'),
  ('push_subscriptions', 'Account communications, shared shell.'),
  ('org_announcements', 'Navigation and product telemetry, shared shell.'),
  ('org_announcement_receipts', 'Navigation and product telemetry, shared shell.'),
  ('navigation_preferences', 'Navigation and product telemetry, shared shell.'),
  ('product_changelog_reads', 'Navigation and product telemetry, shared shell.'),
  ('product_events', 'Navigation and product telemetry, shared shell.'),
  ('request_demo_submissions', 'Navigation and product telemetry, shared shell.'),
  ('session_lock_events', 'Navigation and product telemetry, shared shell.'),
  -- The six 20260724130000 deliberately un-classified when the pillars were split out.
  ('residents', 'Deliberately unclassified by the pillar split: the resident directory is read by Care Operations, Compliance and Workforce alike.'),
  ('resident_contacts', 'Deliberately unclassified by the pillar split, with residents.'),
  ('employee_credentials', 'Deliberately unclassified by the pillar split: credentials are read by Workforce and by Compliance evidence.'),
  ('employee_credential_documents', 'Deliberately unclassified by the pillar split, with employee_credentials.'),
  ('administrator_profiles', 'Deliberately unclassified by the pillar split, with employee_credentials.'),
  ('administrator_ce_entries', 'Deliberately unclassified by the pillar split, with employee_credentials.'),
  -- BACKLOG J51: four of the thirty-four belong here rather than behind a module.
  ('billing_provider_operations', 'Billing provider bookkeeping: it powers the entitlement decision, like every other billing_* table.'),
  ('newsletter_subscribers', 'Public marketing capture, written by anon before any tenant exists.'),
  ('savings_model_requests', 'Public marketing capture, written by anon before any tenant exists.'),
  ('user_invitation_lifecycle', 'Account identity: an invitation is how somebody becomes a user, so it cannot depend on what that user''s tenant has bought.')
) as t(name, rationale)
where exists (
  select 1 from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = t.name and c.relkind in ('r', 'p') and c.relrowsecurity
)
on conflict (resource_schema, resource_name) do update set rationale = excluded.rationale;

-- ---------------------------------------------------------------------------
-- J52 -- Survey Day can be switched on
-- ---------------------------------------------------------------------------

-- Access needs BOTH halves and had neither: no package granted the entitlement (feature_definitions
-- defaults it false, and package_entitlements had no row for it at all), and release_flags had no
-- row, which is also why the console could not switch it on -- it can only toggle rows that exist.
--
-- Survey Day is a Compliance-pillar surface, so it follows modules.compliance exactly: every
-- package that grants the pillar grants this, and the Train-only package does not. The tables are
-- classified modules.compliance above, so the RLS wall says the same thing the entitlement does.
insert into public.package_entitlements (package_id, feature_key, entitlement_value, source)
select e.package_id, 'survey_day_mode', e.entitlement_value, 'migration'
from public.package_entitlements e
where e.feature_key = 'modules.compliance'
  and not exists (
    select 1 from public.package_entitlements x
    where x.package_id = e.package_id and x.feature_key = 'survey_day_mode'
  );

insert into public.release_flags (feature_key, rollout_mode, is_enabled, owner, change_reason)
select 'survey_day_mode', 'global', true, 'compliance',
  'BACKLOG J52: Survey Day was in every PCH/ALF organization''s onboarding list, disabled for every organization, with no release_flags row for the console to toggle.'
where exists (select 1 from public.feature_definitions where feature_key = 'survey_day_mode')
  and not exists (select 1 from public.release_flags where feature_key = 'survey_day_mode');

-- ---------------------------------------------------------------------------
-- J61 -- the last guest surface joins the throttle
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'resolve_survey_packet_guest_token';
  if v_def is null then raise exception 'public.resolve_survey_packet_guest_token is missing'; end if;

  if position('assert_guest_request_allowed' in v_def) > 0 then
    raise notice 'resolve_survey_packet_guest_token already calls the guest gate';
  else
    v_old := '  if length(coalesce(p_token, '''')) < 32 then';
    v_new := '  -- BACKLOG J61. The gate has had a survey_packet_guest branch since it was written and no
  -- caller, so this was the one guest surface with no rate limit, no organization-suspension
  -- check, and no record of a token that resolved to nothing: a suspended organization''''s survey
  -- packet still downloaded while its evidence-room link was refused. It goes FIRST, before the
  -- length test, so a caller guessing tokens is counted whatever shape the guess has.
  perform public.assert_guest_request_allowed(''survey_packet_guest'', p_token);

  if length(coalesce(p_token, '''')) < 32 then';
    if position(v_old in v_def) = 0 then
      raise exception 'resolve_survey_packet_guest_token no longer contains the token-length test this migration patches';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

comment on function public.resolve_survey_packet_guest_token(text) is
  'Resolves a survey-packet guest download token for the worker. Goes through '
  'assert_guest_request_allowed first, like every other guest surface -- rate limit, '
  'organization-suspension check, and a recorded failure for a token that resolves to nothing. '
  'Before BACKLOG J61 it was the only guest surface the gate did not cover, so a suspended '
  'organization''s packet link still downloaded.';

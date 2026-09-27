-- The signed "support plan needs no change" review was an RLS table with a
-- tenant select policy and nothing else. Database CI requires every public RLS
-- table to carry the SMS session gate, the impersonation lifetime gate, a
-- module classification with its restrictive entitlement policy, and an audit
-- manifest row. This table had none of those, so the suite failed closed.
--
-- Incident reporting is the Compliance surface (the same module as incidents).
-- CareBase still reaches it because that bundle includes Compliance. A signed
-- decision that a major incident did not need a plan revision is regulated
-- follow-through, so the audit_log trigger records every insert, update and
-- delete. The unclassified ceiling is unchanged.

insert into app_private.product_module_resources(resource_schema, resource_name, module_key)
values ('public', 'incident_support_plan_reviews', 'modules.compliance')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

create policy product_module_entitlement
  on public.incident_support_plan_reviews
  as restrictive
  for all
  to authenticated
  using ((select app_private.has_product_module('modules.compliance')))
  with check ((select app_private.has_product_module('modules.compliance')));

create policy sms_mfa_session_required
  on public.incident_support_plan_reviews
  as restrictive
  for all
  to authenticated
  using ((select public.current_sms_mfa_satisfied()))
  with check ((select public.current_sms_mfa_satisfied()));

create policy impersonation_session_lifetime
  on public.incident_support_plan_reviews
  as restrictive
  for all
  to authenticated
  using ((select public.current_impersonation_session_live()))
  with check ((select public.current_impersonation_session_live()));

create trigger audit_log
  after insert or update or delete
  on public.incident_support_plan_reviews
  for each row
  execute function public.audit_log_trigger();

insert into app_private.audit_entity_manifest(table_name, audit_mode, contains_regulated_data, rationale)
values (
  'incident_support_plan_reviews',
  'row_trigger',
  true,
  'A signed decision that a major incident did not require a support-plan revision is regulated incident follow-through. The audit_log trigger records every insert, update and delete.'
)
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

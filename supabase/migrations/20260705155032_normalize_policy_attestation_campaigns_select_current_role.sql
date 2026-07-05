-- Supersedes the quick-fix from create_policy_attestation_campaigns_select_temp3: replaces the
-- bare-quoted "current_role"() workaround with this codebase's established RLS convention --
-- current_org_id()/current_role() wrapped in `(select public. ...)` (see
-- fix_rls_initplan_bare_auth_uid.sql) -- for consistency with every other policy in the schema.
drop policy policy_attestation_campaigns_select on public.policy_attestation_campaigns;

create policy policy_attestation_campaigns_select on public.policy_attestation_campaigns
  for select to authenticated
  using (
    public.is_platform_admin()
    or (organization_id = (select public.current_org_id()) and (select public.current_role()) = any (array['org_admin','facility_manager','auditor']))
    or exists (select 1 from public.policy_attestations pa where pa.campaign_id = policy_attestation_campaigns.id and public.owns_employee(pa.employee_id))
  );

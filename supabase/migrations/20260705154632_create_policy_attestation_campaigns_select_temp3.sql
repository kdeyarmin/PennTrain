-- Quick-fix reinstatement after the drop above -- adds the missing employee-visibility clause
-- (see MyAttestations.tsx: an attesting employee couldn't otherwise read the campaign backing
-- their own attestation). Superseded a few migrations later by
-- normalize_policy_attestation_campaigns_select_current_role, which replaces the bare-quoted
-- "current_role"() below with this codebase's normal (select public.current_role()) convention.
create policy policy_attestation_campaigns_select on public.policy_attestation_campaigns
  for select to authenticated
  using (
    is_platform_admin()
    or (organization_id = current_org_id() and "current_role"() = any (array['org_admin','facility_manager','auditor']))
    or exists (select 1 from public.policy_attestations pa where pa.campaign_id = policy_attestation_campaigns.id and owns_employee(pa.employee_id))
  );

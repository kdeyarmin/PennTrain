alter table public.policy_documents enable row level security;
alter table public.policy_document_versions enable row level security;
alter table public.policy_attestation_campaigns enable row level security;
alter table public.policy_attestations enable row level security;

-- policy_documents / policy_document_versions: org-wide readable (any authenticated member of the
-- org must be able to see what they're being asked to attest to, regardless of which facility
-- they're assigned), write restricted to org_admin/facility_manager (policy authoring).
create policy policy_documents_select on public.policy_documents for select to authenticated using (
  public.is_platform_admin() or organization_id = (select public.current_org_id())
);
create policy policy_documents_write on public.policy_documents for all to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager'))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager'))
);

create policy policy_document_versions_select on public.policy_document_versions for select to authenticated using (
  public.is_platform_admin() or organization_id = (select public.current_org_id())
);
create policy policy_document_versions_write on public.policy_document_versions for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager'))
);
create policy policy_document_versions_update on public.policy_document_versions for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager'))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager'))
);

-- policy_attestation_campaigns: admin-side visibility (org_admin/facility_manager manage,
-- auditor reads for oversight).
create policy policy_attestation_campaigns_select on public.policy_attestation_campaigns for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager','auditor'))
);
create policy policy_attestation_campaigns_write on public.policy_attestation_campaigns for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager'))
);
create policy policy_attestation_campaigns_delete on public.policy_attestation_campaigns for delete to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- policy_attestations: the individual can see their own row (self-service "My Attestations");
-- org_admin/auditor see the whole org; facility_manager is scoped to their assigned facilities.
-- No update policy for authenticated at all -- attested_at/ip/hash/auth_method are only ever set
-- by the attest_policy() RPC (security definer), matching training_documents/audit_logs'
-- immutable-once-written posture for anything evidentiary.
create policy policy_attestations_select on public.policy_attestations for select to authenticated using (
  public.is_platform_admin()
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);
create policy policy_attestations_insert on public.policy_attestations for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy policy_attestations_delete on public.policy_attestations for delete to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
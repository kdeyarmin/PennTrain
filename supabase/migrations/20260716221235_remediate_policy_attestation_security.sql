-- Forward-only repair for the policy authoring and attestation trust boundary.
--
-- 1. Bind documents, versions, campaigns, and employee assignments with
--    composite tenant/parent constraints.
-- 2. Make every new attestation a server-derived pending assignment so a
--    browser role cannot insert completed legal evidence.
-- 3. Enforce the existing fresh-AAL2 privileged-session policy at direct
--    table and Storage policy-document write boundaries.

-- The composite keys below let PostgreSQL enforce both parent identity and
-- tenant identity instead of accepting independently valid UUIDs.
alter table public.policy_documents
  add constraint policy_documents_id_org_uk unique (id, organization_id);

alter table public.policy_document_versions
  add constraint policy_document_versions_identity_uk
    unique (id, policy_document_id, organization_id),
  add constraint policy_document_versions_document_org_fk
    foreign key (policy_document_id, organization_id)
    references public.policy_documents(id, organization_id)
    on delete cascade;

alter table public.policy_attestation_campaigns
  add constraint policy_attestation_campaigns_identity_uk
    unique (id, policy_document_version_id, organization_id),
  add constraint policy_attestation_campaigns_document_version_fk
    foreign key (policy_document_version_id, policy_document_id, organization_id)
    references public.policy_document_versions(id, policy_document_id, organization_id);

alter table public.policy_attestations
  add constraint policy_attestations_campaign_version_fk
    foreign key (campaign_id, policy_document_version_id, organization_id)
    references public.policy_attestation_campaigns(id, policy_document_version_id, organization_id)
    on delete cascade;

-- A document may point only at its own published version. Keeping this as a
-- trigger preserves the existing ON DELETE SET NULL behavior of the original
-- current_version_id foreign key.
create or replace function public.validate_policy_document_current_version()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.current_version_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.policy_document_versions v
    where v.id = new.current_version_id
      and v.policy_document_id = new.id
      and v.organization_id = new.organization_id
      and v.status = 'published'
  ) then
    raise exception 'Current policy version must be a published version of the same document and organization.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists validate_policy_document_current_version
  on public.policy_documents;
create trigger validate_policy_document_current_version
before insert or update of current_version_id, organization_id
on public.policy_documents
for each row execute function public.validate_policy_document_current_version();

-- Assignment inserts remain available to authorized managers, but the
-- protected evidence fields and related identifiers are authoritative. The
-- employee and campaign determine the complete pending row.
create or replace function public.stamp_scope_from_employee_for_attestation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_employee_org uuid;
  v_employee_facility uuid;
  v_campaign_org uuid;
  v_campaign_version uuid;
  v_campaign_due_date date;
begin
  if new.status <> 'pending'
     or new.attested_at is not null
     or new.document_version_hash is not null
     or new.auth_method is not null
     or new.ip_address is not null
     or new.user_agent is not null
     or new.reminder_sent_at is not null then
    raise exception 'Policy attestations must be created as pending assignments without attestation evidence.'
      using errcode = '23514';
  end if;

  select e.organization_id, e.facility_id
  into v_employee_org, v_employee_facility
  from public.employees e
  where e.id = new.employee_id;

  if v_employee_org is null then
    raise exception 'employee % not found', new.employee_id
      using errcode = '23503';
  end if;

  select c.organization_id, c.policy_document_version_id, c.due_date
  into v_campaign_org, v_campaign_version, v_campaign_due_date
  from public.policy_attestation_campaigns c
  where c.id = new.campaign_id;

  if v_campaign_org is null then
    raise exception 'policy attestation campaign % not found', new.campaign_id
      using errcode = '23503';
  end if;

  if v_campaign_org <> v_employee_org then
    raise exception 'Policy campaign and employee must belong to the same organization.'
      using errcode = '23514';
  end if;

  new.organization_id := v_employee_org;
  new.facility_id := v_employee_facility;
  new.policy_document_version_id := v_campaign_version;
  new.due_date := v_campaign_due_date;
  new.status := 'pending';
  new.attested_at := null;
  new.document_version_hash := null;
  new.auth_method := null;
  new.ip_address := null;
  new.user_agent := null;
  new.reminder_sent_at := null;
  new.created_at := statement_timestamp();
  new.updated_at := new.created_at;
  return new;
end;
$function$;

-- Add policy administration to the program-wide MFA floor and to every
-- existing tenant policy. Tenant administrators may strengthen this baseline
-- but cannot remove it.
update public.identity_security_policies p
set sensitive_operations = (
  select array_agg(distinct operation order by operation)
  from unnest(
    p.sensitive_operations || array['policy_document_admin']::text[]
  ) operation
), updated_at = now();

alter table public.identity_security_policies
  alter column sensitive_operations set default array[
    'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
    'session_revocation', 'break_glass', 'scim_credential_rotation',
    'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
    'billing_admin', 'integration_admin', 'evidence_grant_revoke',
    'schedule_unpublish', 'course_unpublish', 'policy_document_admin'
  ]::text[];

alter table public.identity_security_policies
  drop constraint identity_security_policy_mfa_floor;
alter table public.identity_security_policies
  add constraint identity_security_policy_mfa_floor check (
    require_aal2
    and privileged_roles @> array['org_admin', 'facility_manager']::text[]
    and sensitive_operations @> array[
      'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
      'session_revocation', 'break_glass', 'scim_credential_rotation',
      'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
      'billing_admin', 'integration_admin', 'evidence_grant_revoke',
      'schedule_unpublish', 'course_unpublish', 'policy_document_admin'
    ]::text[]
  );

create or replace function public.identity_operation_requires_aal2(p_operation text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_role text := public.current_role();
  v_org_id uuid := public.current_org_id();
  v_policy public.identity_security_policies%rowtype;
  v_baseline text[] := array[
    'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
    'session_revocation', 'break_glass', 'scim_credential_rotation',
    'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
    'billing_admin', 'integration_admin', 'evidence_grant_revoke',
    'schedule_unpublish', 'course_unpublish', 'policy_document_admin'
  ]::text[];
begin
  if v_role = 'platform_admin' then
    return p_operation = any(v_baseline);
  end if;

  select * into v_policy
  from public.identity_security_policies
  where organization_id = v_org_id;

  if not found then
    return v_role = any(array['org_admin', 'facility_manager']::text[])
      and p_operation = any(v_baseline);
  end if;

  return v_policy.require_aal2
    and v_role = any(v_policy.privileged_roles)
    and p_operation = any(v_policy.sensitive_operations);
end;
$function$;

-- Direct Data API policy authoring now enforces the same current-assurance
-- decision as the browser session gate.
drop policy if exists policy_documents_write on public.policy_documents;
create policy policy_documents_write
on public.policy_documents for all to authenticated
using (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
    )
  )
)
with check (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
    )
  )
);

drop policy if exists policy_document_versions_write
  on public.policy_document_versions;
create policy policy_document_versions_write
on public.policy_document_versions for insert to authenticated
with check (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
    )
  )
);

drop policy if exists policy_document_versions_update
  on public.policy_document_versions;
create policy policy_document_versions_update
on public.policy_document_versions for update to authenticated
using (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
    )
  )
)
with check (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
    )
  )
);

drop policy if exists policy_attestation_campaigns_write
  on public.policy_attestation_campaigns;
create policy policy_attestation_campaigns_write
on public.policy_attestation_campaigns for insert to authenticated
with check (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
    )
  )
);

drop policy if exists policy_attestation_campaigns_delete
  on public.policy_attestation_campaigns;
create policy policy_attestation_campaigns_delete
on public.policy_attestation_campaigns for delete to authenticated
using (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) = 'org_admin'
    )
  )
);

drop policy if exists policy_attestations_insert on public.policy_attestations;
create policy policy_attestations_insert
on public.policy_attestations for insert to authenticated
with check (
  (select public.identity_assurance_is_current('policy_document_admin'))
  and status = 'pending'
  and attested_at is null
  and document_version_hash is null
  and auth_method is null
  and ip_address is null
  and user_agent is null
  and reminder_sent_at is null
  and (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id)
    )
  )
);

-- Storage policy changes are additive policy replacements only; the bucket and
-- its managed schema remain owned by Supabase.
drop policy if exists "policy-documents write" on storage.objects;
create policy "policy-documents write"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'policy-documents'
  and (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and exists (
        select 1
        from public.policy_documents d
        where d.id::text = (storage.foldername(name))[2]
          and d.organization_id = (select public.current_org_id())
      )
    )
  )
);

drop policy if exists "policy-documents delete" on storage.objects;
create policy "policy-documents delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'policy-documents'
  and (select public.identity_assurance_is_current('policy_document_admin'))
  and (
    public.is_platform_admin()
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (select public.current_role()) = 'org_admin'
    )
  )
);

-- These buckets were created after the original July 20 classification sweep.
-- The restrictive Storage policy (and cleanup authorization) intentionally denies
-- unclassified buckets. Register their existing owning modules so entitled users
-- can upload/read/delete evidence without weakening role, tenant or path policies.
insert into app_private.product_module_storage_buckets(bucket_id, module_key)
values ('compliance-evidence', 'modules.compliance'), ('learning-packages', 'modules.train')
on conflict (bucket_id) do update set module_key = excluded.module_key;

-- These nine Compliance commands use shared definer scope guards: requirement
-- upsert/activation/copy/generation, occurrence transitions/assignment, notes and
-- evidence attachment/removal. Module RLS does not constrain their definer writes.
-- Enforce Compliance access in both guards while retaining the existing trusted
-- service/platform exemptions and every organization, role and facility check.
create or replace function app_private.assert_compliance_manager(p_org uuid, p_fac uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.is_platform_admin() then
    return;
  end if;
  if not coalesce(app_private.has_product_module('modules.compliance'), false) then
    raise exception 'Compliance access is required' using errcode = '42501';
  end if;
  if auth.uid() is null
     or (select public.current_org_id()) is distinct from p_org
     or (select public.current_role()) not in ('org_admin', 'facility_manager')
     or (p_fac is not null and (select public.current_role()) = 'facility_manager'
         and not public.is_assigned_to_facility(p_fac)) then
    raise exception 'Compliance operation is outside caller scope' using errcode = '42501';
  end if;
end $$;
revoke all on function app_private.assert_compliance_manager(uuid, uuid) from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- Stricter guard for org-wide templates (no facility to scope by): require an org admin. A facility
-- manager is scoped to assigned facilities and must not create/edit/archive shared org templates.
------------------------------------------------------------------------------------------------
create or replace function app_private.assert_compliance_org_admin(p_org uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.is_platform_admin() then
    return;
  end if;
  if not coalesce(app_private.has_product_module('modules.compliance'), false) then
    raise exception 'Compliance access is required' using errcode = '42501';
  end if;
  if auth.uid() is null
     or (select public.current_org_id()) is distinct from p_org
     or (select public.current_role()) <> 'org_admin' then
    raise exception 'Only an organization administrator can manage org-wide compliance templates' using errcode = '42501';
  end if;
end $$;
revoke all on function app_private.assert_compliance_org_admin(uuid) from public, anon, authenticated, service_role;

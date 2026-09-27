-- The resource registry is keyed by (resource_schema, resource_name). Resolve
-- the document kind on the parameter side so only its one catalog row can need
-- an entitlement evaluation. Calling document_deletion_kind on every catalog
-- row leaves an opaque function filter whose order relative to the expensive
-- module check is chosen by the planner. Unclassified core resources still
-- require their bucket permission but have no additional table-module gate.
create or replace function app_private.can_manage_document_deletion(p_kind text, p_org uuid, p_facility uuid, p_bucket text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.current_session_unlocked()
    and public.current_impersonation_session_live() and public.current_sms_mfa_satisfied()
    and app_private.has_product_module_for_bucket(p_bucket)
    and (p_bucket <> 'course-documents' or public.is_platform_admin())
    and (p_bucket <> 'learning-packages' or public.is_platform_admin() or public.current_role() = 'org_admin')
    and not exists(select 1 from app_private.product_module_resources r where r.resource_schema = 'public'
      and r.resource_name = case p_kind
        when 'training' then 'training_documents'
        when 'maintenance' then 'maintenance_documents'
        when 'credential' then 'employee_credential_documents'
        when 'incident' then 'incident_documents'
        when 'violation' then 'violation_documents'
        when 'compliance' then 'compliance_requirement_documents'
      end
      and not app_private.has_product_module(r.module_key))
    and (public.is_platform_admin() or (public.current_org_id() = p_org and (
      (p_kind in ('credential','incident','violation') and public.current_role() = 'org_admin')
      or (p_kind in ('training','maintenance') and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(p_facility))
      or (p_kind = 'compliance' and (public.current_role() = 'org_admin' or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(p_facility))))
    )));
$$;

-- CREATE OR REPLACE retains the existing owner, private schema boundary and ACL.

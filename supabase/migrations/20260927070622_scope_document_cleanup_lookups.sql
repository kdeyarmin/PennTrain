-- Match the existing bucket/hash index before checking exact path and authority.
-- The raw path comparison remains necessary: a hash match alone grants no access.
create or replace function app_private.operational_cleanup_object_visible(p_bucket text, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from app_private.document_deletions d where d.completed_at is null
      and ((d.document_kind = 'credential' and p_bucket = 'credential-documents')
        or (d.document_kind = 'training' and p_bucket = 'external-uploads'))
      and d.storage_bucket = p_bucket
      and d.storage_path_sha256 = pg_catalog.encode(extensions.digest(p_path, 'sha256'), 'hex')
      and d.storage_path = p_path
      and position(d.organization_id::text || '/' || d.facility_id::text || '/' in p_path) = 1
      and app_private.can_manage_document_deletion(d.document_kind, d.organization_id, d.facility_id, d.storage_bucket));
$$;

-- Ordinary actors only need their own tenant's pending receipts. Use the existing
-- generated-column index before per-receipt authorization, without an OR branch
-- that would also consider every other tenant. Platform operators retain their
-- cross-tenant queue, including accounts without an organization assignment.
create or replace function public.list_pending_document_deletions(p_document_kind text default null, p_facility_id uuid default null)
returns table(document_kind text, document_id uuid, facility_id uuid, storage_bucket text, storage_path text, file_name text, requested_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.is_platform_admin() then
    return query
      select d.document_kind, d.document_id, d.facility_id, d.storage_bucket, d.storage_path, d.file_name, d.requested_at
      from app_private.document_deletions d where d.completed_at is null
        and (p_document_kind is null or d.document_kind = p_document_kind)
        and (p_facility_id is null or d.facility_id = p_facility_id)
        and app_private.can_manage_document_deletion(d.document_kind, d.organization_id, d.facility_id, d.storage_bucket)
      order by d.requested_at, d.document_kind, d.document_id;
  else
    return query
      select d.document_kind, d.document_id, d.facility_id, d.storage_bucket, d.storage_path, d.file_name, d.requested_at
      from app_private.document_deletions d where d.completed_at is null
        and d.pending_organization_id = public.current_org_id()
        and (p_document_kind is null or d.document_kind = p_document_kind)
        and (p_facility_id is null or d.facility_id = p_facility_id)
        and app_private.can_manage_document_deletion(d.document_kind, d.organization_id, d.facility_id, d.storage_bucket)
      order by d.requested_at, d.document_kind, d.document_id;
  end if;
end;
$$;

-- CREATE OR REPLACE retains the existing function owners and EXECUTE grants.

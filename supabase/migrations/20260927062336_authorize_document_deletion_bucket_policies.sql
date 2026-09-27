-- Invoker SQL resolves function names with the caller's schema privileges. Keep
-- app_private inaccessible and bind the bucket guards in restrictive RLS policies
-- instead, just like the existing Storage/product-module policies. These add an
-- AND condition to existing DELETE policies; they never grant permission to a row.
do $$
declare t text;
begin
  foreach t in array array['training_documents','maintenance_documents','employee_credential_documents','incident_documents','violation_documents'] loop
    execute format($policy$
      create policy document_deletion_bucket_access on public.%I as restrictive
      for delete to authenticated using (
        app_private.has_product_module_for_bucket(storage_bucket)
        and (storage_bucket <> 'course-documents' or public.is_platform_admin())
        and (storage_bucket <> 'learning-packages' or public.is_platform_admin() or public.current_role() = 'org_admin')
      )
    $policy$, t);
  end loop;
end;
$$;

create or replace function public.begin_document_deletion(p_document_kind text, p_document_id uuid)
returns table(document_kind text, document_id uuid, storage_bucket text, storage_path text)
language plpgsql security invoker set search_path = '' as $$
begin
  case p_document_kind
    when 'training' then
      return query delete from public.training_documents d where d.id = p_document_id
        returning p_document_kind, d.id, d.storage_bucket, d.storage_path;
    when 'maintenance' then
      return query delete from public.maintenance_documents d where d.id = p_document_id
        returning p_document_kind, d.id, d.storage_bucket, d.storage_path;
    when 'credential' then
      return query delete from public.employee_credential_documents d where d.id = p_document_id
        returning p_document_kind, d.id, d.storage_bucket, d.storage_path;
    when 'incident' then
      return query delete from public.incident_documents d where d.id = p_document_id
        returning p_document_kind, d.id, d.storage_bucket, d.storage_path;
    when 'violation' then
      return query delete from public.violation_documents d where d.id = p_document_id
        returning p_document_kind, d.id, d.storage_bucket, d.storage_path;
    when 'compliance' then
      -- The existing public definer RPC enforces its manager scope and commits
      -- count/audit changes together. The authorized receipt read also checks
      -- bucket/module access; a missing receipt aborts and rolls back every write.
      perform public.remove_compliance_evidence(p_document_id);
      return query select d.document_kind, d.document_id, d.storage_bucket, d.storage_path
        from public.list_pending_document_deletions('compliance') d where d.document_id = p_document_id;
    else raise exception 'Unsupported document kind.' using errcode = '22023';
  end case;
  if not found then
    raise exception 'The document could not be deleted. Refresh the list and pending deletions before retrying.' using errcode = 'P0002';
  end if;
end;
$$;

-- CREATE OR REPLACE keeps the existing grants; reiterate the intended API roles.
revoke all on function public.begin_document_deletion(text,uuid) from public, anon, service_role;
grant execute on function public.begin_document_deletion(text,uuid) to authenticated;

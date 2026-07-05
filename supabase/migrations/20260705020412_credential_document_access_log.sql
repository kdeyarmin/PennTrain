-- Storage signed-URL downloads don't pass through Postgres row policies, so reads of sensitive
-- credential documents were never audited (audit_log_trigger only fires on table writes). This
-- RPC is called by the frontend immediately before requesting a signed URL for a credential
-- document, so "who looked at this clearance letter" is on record like every other write already
-- is. It's SECURITY DEFINER (so it can insert into audit_logs, which has no client insert policy
-- at all -- see 20260704053527_group_b_rls_policies.sql), which means it has to hand-replicate
-- employee_credential_documents_select's real authorization logic rather than relying on RLS.
-- That's a second copy of the same rule that can drift if the real policy ever changes without
-- this being revisited -- keep both in sync by hand.
create or replace function public.log_document_access(p_document_table text, p_document_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_org_id uuid;
  v_employee_id uuid;
  v_facility_id uuid;
  v_authorized boolean := false;
begin
  if p_document_table = 'employee_credential_documents' then
    select organization_id, employee_id, facility_id
      into v_org_id, v_employee_id, v_facility_id
    from public.employee_credential_documents where id = p_document_id;

    if v_org_id is null then
      raise exception 'document not found';
    end if;

    -- Mirrors employee_credential_documents_select in
    -- 20260705020410_employee_credentials_rls.sql -- keep in sync if that policy changes.
    v_authorized := public.is_platform_admin()
      or public.owns_employee(v_employee_id)
      or (v_org_id = (select public.current_org_id())
          and ((select public.current_role()) in ('org_admin','auditor')
               or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(v_facility_id))));
  else
    raise exception 'unsupported document table: %', p_document_table;
  end if;

  if not v_authorized then
    raise exception 'not authorized to access this document' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_logs (organization_id, actor_profile_id, entity_type, entity_id, action)
  values (v_org_id, auth.uid(), p_document_table, p_document_id::text, 'document_viewed');
end;
$function$;

revoke all on function public.log_document_access(text, uuid) from public;
revoke all on function public.log_document_access(text, uuid) from anon;
grant execute on function public.log_document_access(text, uuid) to authenticated;

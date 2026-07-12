-- Support for the generate-certificate-pdf Edge Function.
--
-- protect_certificate_write() (Group C, 20260704073252) puts a BEFORE INSERT OR UPDATE OR DELETE
-- trigger on public.certificates that only lets a write through when is_platform_admin() is true or
-- the txn-local app.privileged_write GUC is 'on' -- both resolve via auth.uid()/set_config() and are
-- never true for a plain service-role UPDATE issued directly from an Edge Function's adminClient:
-- service-role connections carry no auth.uid() (no matching profiles row), and there is no preceding
-- set_config() call in that request's own transaction. RLS is irrelevant here (service_role bypasses
-- RLS already) -- this trigger is a separate enforcement layer that fires regardless of role, so a
-- bare `adminClient.from("certificates").update(...)` from generate-certificate-pdf would fail with
-- "certificates are not directly writable by clients; use issue_certificate() / service role".
--
-- The storage-bucket migration (20260704073438) anticipated the *bucket* write being service-role-only,
-- but the certificates *table* row (pdf_storage_bucket/pdf_storage_path) still needs a sanctioned path.
-- Same fix already applied once for profiles (admin_update_profile, 20260704142921): a SECURITY DEFINER
-- RPC that flips the GUC internally, revoked from public/anon/authenticated and granted to service_role
-- only -- reachable exclusively from a trusted Edge Function holding the service-role key, never
-- directly from a browser client. This function has no internal authorization check of its own by
-- design: the calling Edge Function is responsible for having already verified (via its RLS-scoped
-- callerClient read of the certificate row) that the caller is allowed to see this certificate before
-- ever reaching this RPC.
create or replace function public.set_certificate_pdf(
  p_certificate_id uuid,
  p_bucket         text,
  p_path           text
)
returns public.certificates
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.certificates;
begin
  perform set_config('app.privileged_write', 'on', true);
  update public.certificates
     set pdf_storage_bucket = p_bucket,
         pdf_storage_path   = p_path
   where id = p_certificate_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'certificate % not found', p_certificate_id using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$function$;

revoke all on function public.set_certificate_pdf(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_certificate_pdf(uuid, text, text) to service_role;

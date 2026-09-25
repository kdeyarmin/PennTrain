-- The five 20260916 PennSync integration migrations were recovered exactly from
-- the hosted migration ledger. Keep those historical bytes unchanged; attach
-- the current schema-wide security and audit metadata in a forward migration.
-- These service-only tables retain no permissive browser policy or table grant.
begin;

do $$
declare t text;
begin
  foreach t in array array['cm_integration_jobs','cm_integration_files','cm_integration_daily_budget'] loop
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('create policy sms_mfa_session_required on public.%I as restrictive for all to authenticated using ((select public.current_sms_mfa_satisfied())) with check ((select public.current_sms_mfa_satisfied()))',t);
    execute format('create policy impersonation_session_lifetime on public.%I as restrictive for all to authenticated using ((select public.current_impersonation_session_live())) with check ((select public.current_impersonation_session_live()))',t);
  end loop;
end $$;

-- These are server-side integration infrastructure shared across products, not
-- tenant-facing module data. Classification does not grant access: the tables
-- retain RLS, no browser privileges and no permissive browser policies.
insert into app_private.product_module_shell_resources(resource_schema,resource_name,rationale)
values
  ('public','cm_integration_jobs',
   'Shared service-only integration execution receipts and encrypted result cache, keyed by application and hashed actor rather than a facility module. Idempotency, ownership and outcome tracking protect all integration operations. Browser access remains revoked; this classification grants no customer data access or product entitlement.'),
  ('public','cm_integration_files',
   'Shared service-only private integration file bindings, keyed by application and hashed actor. File registration and object ownership support integration operations across products; they are not a tenant-facing module directory. Browser access remains revoked and the integration storage bucket remains private.'),
  ('public','cm_integration_daily_budget',
   'Shared service-only integration rate-limit counters per application, hashed actor and UTC day. These operational provider quotas govern attempts across products, not Pennsylvania facility clinical or training dates. Browser access remains revoked; classification does not grant an entitlement or permit an operation.')
on conflict(resource_schema,resource_name) do update set rationale=excluded.rationale;

insert into app_private.audit_entity_manifest(table_name,audit_mode,contains_regulated_data,rationale)
values
  ('cm_integration_jobs','not_required',true,
   'Service-only integration execution receipts and temporary encrypted result cache. The receipt itself retains the hashed actor, operation, payload digest, attempt count, ownership claim, outcome and timestamps; it is not facility clinical or training evidence. A generic row audit would duplicate encrypted results and outlive the cache retention policy. Treat cached results as potentially regulated, preserve the existing receipt and expiration lifecycle, and expose no browser grant.'),
  ('cm_integration_files','not_required',true,
   'Service-only append-only file binding receipts recording hashed actor, object path, content type, size, digest and creation time. The receipt itself is the evidence of registration; file contents remain in private object storage and may contain regulated data. Generic row logging would duplicate the same binding without observing object downloads. No browser grants or permissive policies exist.'),
  ('cm_integration_daily_budget','not_required',false,
   'Service-only operational rate-limit counters keyed by application, hashed actor and UTC day. No prompts, recipients, file contents or clinical records are stored. Mutable aggregate attempt counts are enforcement state, not clinical or training evidence; the corresponding execution receipt records the operation. No browser grants or permissive policies exist.')
on conflict(table_name) do update set
  audit_mode=excluded.audit_mode,
  contains_regulated_data=excluded.contains_regulated_data,
  rationale=excluded.rationale,
  updated_at=now();

commit;

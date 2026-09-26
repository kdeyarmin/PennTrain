-- Outbound vendor authentication is separate from hashed inbound API credentials.
-- No credential value is stored in public tables or supplied by the browser.
alter table public.fhir_integration_sources
  add column writeback_contract_reference text,
  add column writeback_conditional_create_confirmed boolean not null default false;

create function public.set_fhir_source_writeback(
  p_source_id uuid, p_enabled boolean, p_contract_reference text default null,
  p_conditional_create_confirmed boolean default false
) returns void language plpgsql security definer set search_path='' as $$
declare v_source public.fhir_integration_sources%rowtype;
begin
  if auth.uid() is null or not public.current_sms_mfa_satisfied()
     or not public.current_impersonation_session_live()
     or not public.identity_assurance_is_current('identity_admin')
     or not app_private.has_product_module('modules.carebase') then
    raise exception 'Current identity verification and CareBase access are required' using errcode='42501';
  end if;
  select * into v_source from public.fhir_integration_sources where id=p_source_id for update;
  if v_source.id is null then raise exception 'FHIR source is unavailable' using errcode='42501'; end if;
  if p_enabled then
    perform app_private.assert_clinical_integration_scope(v_source.organization_id,v_source.facility_id,'clinical.integration.manage');
  elsif not public.is_platform_admin() and (
    public.current_org_id() is distinct from v_source.organization_id
    or not public.is_assigned_to_facility(v_source.facility_id)
    or not (public.current_role()='org_admin'
      or public.has_effective_permission('clinical.integration.manage','facility',v_source.facility_id,now())
      or public.has_effective_permission('clinical.integration.manage','organization',v_source.organization_id,now()))
  ) then
    -- Clinical capability may already be off. Revocation still requires the same
    -- tenant/facility manager authorization, but must remain possible then.
    raise exception 'Clinical integration access denied' using errcode='42501';
  end if;
  if p_enabled is null or (p_enabled and (
    v_source.status <> 'active' or coalesce(v_source.fhir_base_url,'') !~ '^https://'
    or length(btrim(coalesce(p_contract_reference,''))) not between 5 and 2000
    or not coalesce(p_conditional_create_confirmed,false)
  )) then
    raise exception 'An active HTTPS source, vendor contract reference and confirmed conditional-create support are required' using errcode='22023';
  end if;
  update public.fhir_integration_sources set
    writeback_enabled=p_enabled,
    writeback_contract_reference=case when p_enabled then btrim(p_contract_reference) else writeback_contract_reference end,
    writeback_conditional_create_confirmed=case when p_enabled then true else writeback_conditional_create_confirmed end
  where id=p_source_id;
  if not p_enabled then
    update public.fhir_writeback_queue set status='skipped',last_error='Write-back disabled by the facility',updated_at=now()
    where source_id=p_source_id and status='pending';
  end if;
end;
$$;
revoke all on function public.set_fhir_source_writeback(uuid,boolean,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_fhir_source_writeback(uuid,boolean,text,boolean) to authenticated;

-- Add a source filter to the existing trusted drain contract. The worker supplies
-- only source IDs whose server-held credential matches their current metadata.
drop function public.claim_fhir_writeback_batch(integer,integer);
create function public.claim_fhir_writeback_batch(
  p_limit integer default 20, p_stale_after_seconds integer default 300,
  p_source_ids uuid[] default null
) returns setof public.fhir_writeback_queue language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only the trusted write-back worker may claim deliveries' using errcode='42501';
  end if;
  update public.fhir_writeback_queue w set status='skipped',
    last_error='clinical_data_consent does not allow disclosure',updated_at=now()
  where w.status in ('pending','in_flight') and not exists (
    select 1 from public.residents r where r.id=w.resident_id
      and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
  );
  return query update public.fhir_writeback_queue q
  set status='in_flight',attempts=q.attempts+1,updated_at=now()
  where q.id in (
    select w.id from public.fhir_writeback_queue w
    where w.target_url is not null
      and (p_source_ids is null or w.source_id=any(p_source_ids))
      and (w.status='pending' or (w.status='in_flight' and w.updated_at < now()-make_interval(secs=>greatest(coalesce(p_stale_after_seconds,300),30))))
      and exists(select 1 from public.fhir_integration_sources s where s.id=w.source_id and s.writeback_enabled and s.status='active'
        and app_private.facility_clinical_enabled(s.facility_id))
      and exists(select 1 from public.residents r where r.id=w.resident_id and app_private.clinical_disclosure_allowed(r.clinical_data_consent))
    order by w.created_at limit least(greatest(coalesce(p_limit,20),1),100)
    for update of w skip locked
  ) returning q.*;
end;
$$;
revoke all on function public.claim_fhir_writeback_batch(integer,integer,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.claim_fhir_writeback_batch(integer,integer,uuid[]) to service_role;

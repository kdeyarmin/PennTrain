-- REG18: signed_at is the actual signature time; created_at remains the import time.
-- Historical undated imports are preserved as recorded and are not silently backdated.
alter table public.resident_agreement_signatures add column signed_document_id uuid references public.resident_documents(id) on delete restrict;
create index resident_agreement_signed_document_idx on public.resident_agreement_signatures(signed_document_id) where signed_document_id is not null;
create or replace function app_private.insert_resident_agreement_outcome_evidence(
  p_version_id uuid,
  p_outcome text,
  p_signer_name text,
  p_signer_role text,
  p_relationship text,
  p_legal_authority text,
  p_authentication_method text,
  p_attestation text,
  p_reason text,
  p_witness_name text,
  p_witness_relationship text,
  p_ip_evidence text,
  p_device_evidence text,
  p_guest_grant_id uuid,
  p_recorded_by uuid,
  p_copy_delivered_at timestamptz,
  p_copy_delivery_method text,
  p_signed_at timestamptz,
  p_signed_document_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_version public.resident_agreement_versions%rowtype;
  v_id uuid;
begin
  select * into v_version from public.resident_agreement_versions where id = p_version_id;
  if not found or v_version.status <> 'active'
    or p_outcome not in ('signed', 'refused', 'unable_to_sign')
    or p_signer_role not in ('resident', 'designated_person', 'guardian', 'power_of_attorney', 'other')
    or p_authentication_method not in ('staff_session', 'external_link', 'resident_portal', 'wet_signature_import')
    or length(btrim(coalesce(p_signer_name, ''))) < 2
    or length(btrim(coalesce(p_relationship, ''))) < 2
    or length(btrim(coalesce(p_attestation, ''))) < 5
    or (p_outcome <> 'signed' and length(btrim(coalesce(p_reason, ''))) < 5)
    or ((p_copy_delivered_at is null) <> (p_copy_delivery_method is null))
    or (p_copy_delivery_method is not null and p_copy_delivery_method not in ('email','portal','printed','mail','in_person','other'))
  then raise exception 'Resident agreement response is invalid' using errcode = '22023'; end if;
  if p_authentication_method='wet_signature_import' then
    if p_signed_at is null or not isfinite(p_signed_at) or p_signed_at>statement_timestamp() or p_signed_document_id is null then
      raise exception 'Wet-signature imports require the actual past signing time and signed resident document' using errcode='23514'; end if;
    if not exists(select 1 from public.resident_documents d where d.id=p_signed_document_id
      and d.resident_id=v_version.resident_id and d.organization_id=v_version.organization_id and d.facility_id=v_version.facility_id
      and length(btrim(d.storage_path))>0) then
      raise exception 'Signed document must belong to this resident and facility' using errcode='23514'; end if;
    if p_copy_delivered_at is not null and (p_copy_delivered_at<p_signed_at or p_copy_delivered_at>statement_timestamp()) then
      raise exception 'Copy delivery must follow the actual signing and cannot be future dated' using errcode='23514'; end if;
  elsif p_signed_at is not null or p_signed_document_id is not null then
    raise exception 'Only a documented wet-signature import may supply a historical signing time' using errcode='23514';
  end if;
  insert into public.resident_agreement_signatures(
    organization_id, facility_id, resident_id, agreement_id, agreement_version_id,
    outcome, signer_name, signer_role, relationship, legal_authority,
    authentication_method, attestation, reason, witness_name, witness_relationship,
    ip_hash, device_hash, guest_grant_id, copy_delivered_at, copy_delivery_method, recorded_by, signed_at, signed_document_id
  ) values (
    v_version.organization_id, v_version.facility_id, v_version.resident_id, v_version.agreement_id,
    v_version.id, p_outcome, btrim(p_signer_name), p_signer_role, btrim(p_relationship),
    nullif(btrim(p_legal_authority), ''), p_authentication_method, btrim(p_attestation),
    nullif(btrim(p_reason), ''), nullif(btrim(p_witness_name), ''),
    nullif(btrim(p_witness_relationship), ''),
    case when nullif(p_ip_evidence, '') is null then null else encode(extensions.digest(convert_to(p_ip_evidence, 'utf8'), 'sha256'), 'hex') end,
    case when nullif(p_device_evidence, '') is null then null else encode(extensions.digest(convert_to(p_device_evidence, 'utf8'), 'sha256'), 'hex') end,
    p_guest_grant_id, p_copy_delivered_at, p_copy_delivery_method, p_recorded_by,
    case when p_authentication_method='wet_signature_import' then p_signed_at else now() end, p_signed_document_id
  ) returning id into v_id;
  insert into public.resident_agreement_history(
    organization_id, facility_id, resident_id, agreement_id, agreement_version_id,
    signature_id, guest_grant_id, event_type, summary, evidence, actor_profile_id
  ) values (
    v_version.organization_id, v_version.facility_id, v_version.resident_id,
    v_version.agreement_id, v_version.id, v_id, p_guest_grant_id, p_outcome,
    'Resident agreement response recorded', jsonb_build_object(
      'outcome', p_outcome, 'signerRole', p_signer_role,
      'authenticationMethod', p_authentication_method,
      'signedAt',case when p_authentication_method='wet_signature_import' then p_signed_at else now() end,
      'signedDocumentId',p_signed_document_id,'recordedAt',now(),
      'witnessRecorded', nullif(btrim(p_witness_name), '') is not null
    ), p_recorded_by
  );
  perform app_private.refresh_resident_agreement_status(v_version.agreement_id);
  return v_id;
end;
$$;

revoke all on function app_private.insert_resident_agreement_outcome_evidence(uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz,text,timestamptz,uuid) from public,anon,authenticated,service_role;
create or replace function app_private.insert_resident_agreement_outcome(
  p_version_id uuid,
  p_outcome text,
  p_signer_name text,
  p_signer_role text,
  p_relationship text,
  p_legal_authority text,
  p_authentication_method text,
  p_attestation text,
  p_reason text,
  p_witness_name text,
  p_witness_relationship text,
  p_ip_evidence text,
  p_device_evidence text,
  p_guest_grant_id uuid,
  p_recorded_by uuid,
  p_copy_delivered_at timestamptz,
  p_copy_delivery_method text
)
returns uuid language sql security definer set search_path='' as $$
 select app_private.insert_resident_agreement_outcome_evidence(p_version_id,p_outcome,p_signer_name,p_signer_role,p_relationship,
  p_legal_authority,p_authentication_method,p_attestation,p_reason,p_witness_name,p_witness_relationship,p_ip_evidence,p_device_evidence,
  p_guest_grant_id,p_recorded_by,p_copy_delivered_at,p_copy_delivery_method,null,null);
$$;
create function public.record_resident_agreement_wet_outcome(
 p_version_id uuid,p_outcome text,p_signer_name text,p_signer_role text,p_relationship text,p_legal_authority text,
 p_attestation text,p_reason text,p_witness_name text,p_witness_relationship text,p_signed_at timestamptz,p_signed_document_id uuid,
 p_device_evidence text default null,p_copy_delivered_at timestamptz default null,p_copy_delivery_method text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare version_row public.resident_agreement_versions;
begin
 select * into version_row from public.resident_agreement_versions where id=p_version_id;
 if not found then raise exception 'Agreement version not found' using errcode='P0002'; end if;
 perform app_private.assert_resident_regulatory_manager(version_row.organization_id,version_row.facility_id);
 return app_private.insert_resident_agreement_outcome_evidence(p_version_id,p_outcome,p_signer_name,p_signer_role,p_relationship,
  p_legal_authority,'wet_signature_import',p_attestation,p_reason,p_witness_name,p_witness_relationship,null,p_device_evidence,
  null,auth.uid(),p_copy_delivered_at,p_copy_delivery_method,p_signed_at,p_signed_document_id);
end $$;
revoke all on function public.record_resident_agreement_wet_outcome(uuid,text,text,text,text,text,text,text,text,text,timestamptz,uuid,text,timestamptz,text) from public,anon;
grant execute on function public.record_resident_agreement_wet_outcome(uuid,text,text,text,text,text,text,text,text,text,timestamptz,uuid,text,timestamptz,text) to authenticated,service_role;

-- Later imports can reveal an earlier signature. Append a correction linked to
-- that signed document; never rewrite the original sourced duty or reset the
-- rescission period using a later signer.
do $$ declare body text; marker text; begin
 select pg_get_functiondef('app_private.validate_regulatory_source()'::regprocedure) into body;
 marker:=$old$  if tg_op='INSERT' and (exists(select 1 from public.resident_agreement_signatures s
    where s.agreement_id=v_agreement and s.outcome='signed' and s.signed_at<v_anchor)
   or exists(select 1 from public.resident_regulatory_actions d join public.resident_agreement_signatures s on s.id=d.source_signature_id
    where s.agreement_id=v_agreement and d.action_type='contract_rescission_window' and s.id<>new.source_signature_id)) then
   raise exception 'A later signer cannot restart the original contract rescission window' using errcode='23514'; end if;$old$;
 if position(marker in body)=0 then raise exception 'Original rescission source guard changed'; end if;
 execute replace(body,marker,$new$  if tg_op='INSERT' and (exists(select 1 from public.resident_agreement_signatures s
    where s.agreement_id=v_agreement and s.outcome='signed' and s.signed_at<v_anchor)
   or (exists(select 1 from public.resident_regulatory_actions d join public.resident_agreement_signatures s on s.id=d.source_signature_id
     where s.agreement_id=v_agreement and d.action_type='contract_rescission_window' and s.id<>new.source_signature_id)
    and not exists(select 1 from public.resident_regulatory_actions d join public.resident_agreement_signatures s on s.id=d.source_signature_id
     where d.id=nullif(new.details->>'corrects_action_id','')::uuid and s.agreement_id=v_agreement
      and d.action_type='contract_rescission_window' and d.anchor_at>v_anchor))) then
   raise exception 'A later signer cannot restart the original contract rescission window; an earlier documented signature requires a linked correction' using errcode='23514'; end if;$new$);

 select pg_get_functiondef('app_private.seed_agreement_regulatory_duties()'::regprocedure) into body;
 body:=replace(body,'declare v_type text; v_initial integer;','declare v_type text; v_initial integer; prior_duty public.resident_regulatory_actions; correction_id uuid;');
 marker:=$old$  if v_initial=1 and not exists(select 1 from public.resident_agreement_signatures where agreement_id=new.agreement_id and outcome='signed' and id<>new.id) then
   insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,source_signature_id)
   values(new.organization_id,new.facility_id,new.resident_id,'contract_rescission_window',new.signed_at,'Initial dated contract signature; written rescission right',new.id);
  end if;$old$;
 if position(marker in body)=0 then raise exception 'Original rescission seed marker changed'; end if;
 execute replace(body,marker,$new$  if v_initial=1 and not exists(select 1 from public.resident_agreement_signatures where agreement_id=new.agreement_id and outcome='signed' and id<>new.id and signed_at<=new.signed_at) then
   select d.* into prior_duty from public.resident_regulatory_actions d
    join public.resident_agreement_signatures s on s.id=d.source_signature_id
    where s.agreement_id=new.agreement_id and d.action_type='contract_rescission_window'
    order by d.anchor_at,d.created_at,d.id limit 1;
   insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,source_signature_id,details)
   values(new.organization_id,new.facility_id,new.resident_id,'contract_rescission_window',new.signed_at,
    case when prior_duty.id is null then 'Initial dated contract signature; written rescission right'
      else 'Earlier documented signature corrects the rescission anchor; original evidence retained' end,new.id,
    case when prior_duty.id is null then '{}'::jsonb else jsonb_build_object('corrects_action_id',prior_duty.id,'signed_document_id',new.signed_document_id) end)
    returning id into correction_id;
   update public.resident_regulatory_actions d set status='not_applicable',
    exception_basis=concat_ws(E'\n',nullif(d.exception_basis,''),'Superseded by earlier documented signature; correction '||correction_id||'; signed document '||coalesce(new.signed_document_id::text,'unavailable'))
    where d.action_type='contract_rescission_window' and d.status='pending' and d.anchor_at>new.signed_at
     and exists(select 1 from public.resident_agreement_signatures s where s.id=d.source_signature_id and s.agreement_id=new.agreement_id);
  end if;$new$);
end $$;

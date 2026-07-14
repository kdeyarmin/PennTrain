-- Priority 12: versioned resident agreements and resident/designated-person
-- e-signatures. These records are separate from workforce policy attestations.

create table public.resident_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  agreement_type text not null check (agreement_type in (
    'resident_home_contract', 'fee_schedule', 'service_addendum', 'resident_rights',
    'privacy_acknowledgement', 'consent_form', 'support_plan_acknowledgement',
    'assessment_participation', 'personal_property_inventory',
    'transportation_authorization', 'photograph_authorization',
    'emergency_contact_authorization', 'financial_responsibility_agreement'
  )),
  title text not null check (length(btrim(title)) between 3 and 240),
  status text not null default 'pending_signature' check (status in (
    'pending_signature', 'partially_executed', 'executed', 'refused',
    'unable_to_sign', 'voided'
  )),
  current_version_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resident_agreements_resident_idx
  on public.resident_agreements(resident_id, status, agreement_type);

create table public.resident_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  agreement_id uuid not null references public.resident_agreements(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  version_label text not null check (length(btrim(version_label)) between 1 and 80),
  content_text text not null check (length(btrim(content_text)) between 10 and 50000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  document_id uuid references public.resident_documents(id) on delete restrict,
  effective_at timestamptz not null default now(),
  required_signer_roles text[] not null default array['resident']::text[],
  status text not null default 'active' check (status in ('active', 'superseded', 'voided')),
  supersedes_version_id uuid references public.resident_agreement_versions(id) on delete restrict,
  amendment_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (agreement_id, version_number),
  check (
    cardinality(required_signer_roles) between 1 and 2
    and required_signer_roles <@ array['resident', 'designated_person']::text[]
  ),
  check (version_number = 1 or length(btrim(coalesce(amendment_reason, ''))) >= 5)
);
create unique index resident_agreement_versions_active_idx
  on public.resident_agreement_versions(agreement_id) where status = 'active';
create index resident_agreement_versions_resident_idx
  on public.resident_agreement_versions(resident_id, status, effective_at desc);

alter table public.resident_agreements
  add constraint resident_agreements_current_version_fkey
  foreign key (current_version_id) references public.resident_agreement_versions(id) on delete restrict;

create table public.resident_agreement_guest_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  guest_label text not null check (length(btrim(guest_label)) between 2 and 160),
  allowed_version_ids uuid[] not null,
  expires_at timestamptz not null,
  terms_version text not null,
  accepted_at timestamptz,
  accepted_device_hash text check (accepted_device_hash is null or accepted_device_hash ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz,
  revocation_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (cardinality(allowed_version_ids) > 0),
  check (expires_at > created_at)
);
create index resident_agreement_guest_grants_resident_idx
  on public.resident_agreement_guest_grants(resident_id, expires_at desc);

create table public.resident_agreement_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  agreement_id uuid not null references public.resident_agreements(id) on delete restrict,
  agreement_version_id uuid not null references public.resident_agreement_versions(id) on delete restrict,
  outcome text not null check (outcome in ('signed', 'refused', 'unable_to_sign')),
  signer_name text not null check (length(btrim(signer_name)) between 2 and 200),
  signer_role text not null check (signer_role in (
    'resident', 'designated_person', 'guardian', 'power_of_attorney', 'other'
  )),
  relationship text not null check (length(btrim(relationship)) between 2 and 160),
  legal_authority text,
  authentication_method text not null check (authentication_method in (
    'staff_session', 'external_link', 'resident_portal', 'wet_signature_import'
  )),
  attestation text not null check (length(btrim(attestation)) between 5 and 2000),
  reason text,
  witness_name text,
  witness_relationship text,
  signed_at timestamptz not null default now(),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  device_hash text check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$'),
  guest_grant_id uuid references public.resident_agreement_guest_grants(id) on delete restrict,
  copy_delivered_at timestamptz,
  copy_delivery_method text check (copy_delivery_method is null or copy_delivery_method in (
    'email', 'portal', 'printed', 'mail', 'in_person', 'other'
  )),
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (outcome = 'signed' or length(btrim(coalesce(reason, ''))) >= 5),
  check ((copy_delivered_at is null) = (copy_delivery_method is null))
);
create index resident_agreement_signatures_version_idx
  on public.resident_agreement_signatures(agreement_version_id, signed_at);
create index resident_agreement_signatures_resident_idx
  on public.resident_agreement_signatures(resident_id, signed_at desc);

create table public.resident_agreement_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  agreement_id uuid references public.resident_agreements(id) on delete restrict,
  agreement_version_id uuid references public.resident_agreement_versions(id) on delete restrict,
  signature_id uuid references public.resident_agreement_signatures(id) on delete restrict,
  guest_grant_id uuid references public.resident_agreement_guest_grants(id) on delete restrict,
  event_type text not null check (event_type in (
    'created', 'version_published', 'amended', 'signed', 'refused',
    'unable_to_sign', 'copy_delivered', 'external_link_issued',
    'external_terms_accepted', 'external_link_revoked'
  )),
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id),
  occurred_at timestamptz not null default now()
);
create index resident_agreement_history_resident_idx
  on public.resident_agreement_history(resident_id, occurred_at desc);

create table public.resident_agreement_guest_access_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  guest_grant_id uuid not null references public.resident_agreement_guest_grants(id) on delete restrict,
  agreement_version_id uuid references public.resident_agreement_versions(id) on delete restrict,
  signature_id uuid references public.resident_agreement_signatures(id) on delete restrict,
  event_type text not null check (event_type in (
    'terms_accepted', 'viewed', 'signed', 'refused', 'unable_to_sign', 'revoked'
  )),
  device_hash text check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default now()
);
create index resident_agreement_guest_events_grant_idx
  on public.resident_agreement_guest_access_events(guest_grant_id, occurred_at desc);

create or replace function app_private.protect_resident_agreement_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Resident agreement versions are immutable' using errcode = '55000';
  end if;
  if new.status not in ('superseded', 'voided') or old.status <> 'active'
    or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Resident agreement version content is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_resident_agreement_signature()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Resident agreement signatures are immutable' using errcode = '55000';
  end if;
  if old.copy_delivered_at is not null or new.copy_delivered_at is null
    or new.copy_delivery_method is null
    or (to_jsonb(new) - array['copy_delivered_at','copy_delivery_method','updated_at'])
       is distinct from
       (to_jsonb(old) - array['copy_delivered_at','copy_delivery_method','updated_at']) then
    raise exception 'Resident agreement signature evidence is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger protect_resident_agreement_version
before update or delete on public.resident_agreement_versions
for each row execute function app_private.protect_resident_agreement_version();
create trigger protect_resident_agreement_signature
before update or delete on public.resident_agreement_signatures
for each row execute function app_private.protect_resident_agreement_signature();
create trigger protect_resident_agreement_history
before update or delete on public.resident_agreement_history
for each row execute function app_private.prevent_phase5_evidence_mutation();
create trigger protect_resident_agreement_guest_events
before update or delete on public.resident_agreement_guest_access_events
for each row execute function app_private.prevent_phase5_evidence_mutation();

create or replace function app_private.refresh_resident_agreement_status(p_agreement_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_agreement public.resident_agreements%rowtype;
  v_version public.resident_agreement_versions%rowtype;
  v_status text;
  v_signed_at timestamptz;
begin
  select * into v_agreement from public.resident_agreements where id = p_agreement_id for update;
  select * into v_version from public.resident_agreement_versions where id = v_agreement.current_version_id;
  if exists (select 1 from public.resident_agreement_signatures s where s.agreement_version_id = v_version.id and s.outcome = 'refused') then
    v_status := 'refused';
  elsif exists (select 1 from public.resident_agreement_signatures s where s.agreement_version_id = v_version.id and s.outcome = 'unable_to_sign') then
    v_status := 'unable_to_sign';
  elsif not exists (
    select 1 from unnest(v_version.required_signer_roles) role
    where (role = 'resident' and not exists (
      select 1 from public.resident_agreement_signatures s
      where s.agreement_version_id = v_version.id and s.outcome = 'signed' and s.signer_role = 'resident'
    )) or (role = 'designated_person' and not exists (
      select 1 from public.resident_agreement_signatures s
      where s.agreement_version_id = v_version.id and s.outcome = 'signed'
        and s.signer_role in ('designated_person', 'guardian', 'power_of_attorney')
    ))
  ) then
    v_status := 'executed';
  elsif exists (select 1 from public.resident_agreement_signatures s where s.agreement_version_id = v_version.id and s.outcome = 'signed') then
    v_status := 'partially_executed';
  else
    v_status := 'pending_signature';
  end if;

  update public.resident_agreements set status = v_status, updated_at = now() where id = v_agreement.id;
  if v_status = 'executed' then
    select max(s.signed_at) into v_signed_at
    from public.resident_agreement_signatures s where s.agreement_version_id = v_version.id and s.outcome = 'signed';
    if v_agreement.agreement_type = 'resident_home_contract' then
      update public.residents set contract_status = case when v_version.version_number > 1 then 'amended' else 'executed' end,
        contract_effective_date = v_version.effective_at::date,
        contract_document_id = coalesce(v_version.document_id, contract_document_id), updated_at = now()
      where id = v_agreement.resident_id;
    elsif v_agreement.agreement_type = 'resident_rights' then
      update public.residents set resident_rights_acknowledged_at = v_signed_at,
        resident_rights_document_id = coalesce(v_version.document_id, resident_rights_document_id), updated_at = now()
      where id = v_agreement.resident_id;
    end if;
    update public.move_in_tasks t set
      signature_evidence = jsonb_build_object(
        'agreementId', v_agreement.id, 'agreementVersionId', v_version.id,
        'versionLabel', v_version.version_label, 'contentSha256', v_version.content_sha256,
        'executedAt', v_signed_at
      ),
      state = case when t.state in ('open', 'in_progress') then 'submitted' else t.state end,
      updated_at = now()
    from public.move_in_workspaces w
    where t.workspace_id = w.id and w.resident_id = v_agreement.resident_id
      and w.state in ('active', 'ready') and t.task_key = 'resident_agreement';
  end if;
  return v_status;
end;
$$;

create or replace function public.publish_resident_agreement_version(
  p_resident_id uuid,
  p_agreement_type text,
  p_title text,
  p_version_label text,
  p_content_text text,
  p_effective_at timestamptz,
  p_required_signer_roles text[],
  p_agreement_id uuid default null,
  p_document_id uuid default null,
  p_amendment_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_agreement public.resident_agreements%rowtype;
  v_prior public.resident_agreement_versions%rowtype;
  v_version_id uuid;
  v_number integer;
  v_hash text;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);
  if p_agreement_type not in (
    'resident_home_contract', 'fee_schedule', 'service_addendum', 'resident_rights',
    'privacy_acknowledgement', 'consent_form', 'support_plan_acknowledgement',
    'assessment_participation', 'personal_property_inventory',
    'transportation_authorization', 'photograph_authorization',
    'emergency_contact_authorization', 'financial_responsibility_agreement'
  ) or length(btrim(coalesce(p_title, ''))) < 3
    or length(btrim(coalesce(p_content_text, ''))) < 10
    or cardinality(p_required_signer_roles) not between 1 and 2
    or not (p_required_signer_roles <@ array['resident', 'designated_person']::text[])
    or cardinality(array(select distinct x from unnest(p_required_signer_roles) x)) <> cardinality(p_required_signer_roles)
  then raise exception 'Resident agreement version is invalid' using errcode = '22023'; end if;
  if p_document_id is not null and not exists (
    select 1 from public.resident_documents d where d.id = p_document_id and d.resident_id = v_resident.id
  ) then raise exception 'Agreement document is outside resident record' using errcode = '23514'; end if;

  if p_agreement_id is null then
    insert into public.resident_agreements(
      organization_id, facility_id, resident_id, agreement_type, title, created_by
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_resident.id,
      p_agreement_type, btrim(p_title), auth.uid()
    ) returning * into v_agreement;
    v_number := 1;
  else
    select * into v_agreement from public.resident_agreements
    where id = p_agreement_id and resident_id = v_resident.id for update;
    if not found then raise exception 'Resident agreement not found' using errcode = 'P0002'; end if;
    if v_agreement.agreement_type <> p_agreement_type
      or length(btrim(coalesce(p_amendment_reason, ''))) < 5 then
      raise exception 'Agreement amendment is invalid' using errcode = '22023';
    end if;
    select * into v_prior from public.resident_agreement_versions where id = v_agreement.current_version_id;
    v_number := v_prior.version_number + 1;
    update public.resident_agreement_versions set status = 'superseded' where id = v_prior.id;
  end if;

  v_hash := encode(extensions.digest(
    convert_to(btrim(p_content_text) || '|' || coalesce(p_document_id::text, ''), 'utf8'), 'sha256'
  ), 'hex');
  insert into public.resident_agreement_versions(
    organization_id, facility_id, resident_id, agreement_id, version_number,
    version_label, content_text, content_sha256, document_id, effective_at,
    required_signer_roles, supersedes_version_id, amendment_reason, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_agreement.id,
    v_number, btrim(p_version_label), btrim(p_content_text), v_hash, p_document_id,
    coalesce(p_effective_at, now()), p_required_signer_roles, v_prior.id,
    nullif(btrim(p_amendment_reason), ''), auth.uid()
  ) returning id into v_version_id;
  update public.resident_agreements set current_version_id = v_version_id,
    title = btrim(p_title), status = 'pending_signature', updated_at = now()
  where id = v_agreement.id;
  if p_agreement_type = 'resident_home_contract' and v_number > 1 then
    update public.residents set contract_status = 'amended', updated_at = now() where id = v_resident.id;
  end if;
  insert into public.resident_agreement_history(
    organization_id, facility_id, resident_id, agreement_id, agreement_version_id,
    event_type, summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    v_agreement.id, v_version_id, case when v_number = 1 then 'created' else 'amended' end,
    case when v_number = 1 then 'Resident agreement created' else 'Resident agreement amended' end,
    jsonb_build_object('versionNumber', v_number, 'versionLabel', btrim(p_version_label),
      'contentSha256', v_hash, 'amendmentReason', nullif(btrim(p_amendment_reason), '')),
    auth.uid()
  );
  return jsonb_build_object('agreementId', v_agreement.id, 'versionId', v_version_id,
    'versionNumber', v_number, 'contentSha256', v_hash);
end;
$$;

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
  insert into public.resident_agreement_signatures(
    organization_id, facility_id, resident_id, agreement_id, agreement_version_id,
    outcome, signer_name, signer_role, relationship, legal_authority,
    authentication_method, attestation, reason, witness_name, witness_relationship,
    ip_hash, device_hash, guest_grant_id, copy_delivered_at, copy_delivery_method, recorded_by
  ) values (
    v_version.organization_id, v_version.facility_id, v_version.resident_id, v_version.agreement_id,
    v_version.id, p_outcome, btrim(p_signer_name), p_signer_role, btrim(p_relationship),
    nullif(btrim(p_legal_authority), ''), p_authentication_method, btrim(p_attestation),
    nullif(btrim(p_reason), ''), nullif(btrim(p_witness_name), ''),
    nullif(btrim(p_witness_relationship), ''),
    case when nullif(p_ip_evidence, '') is null then null else encode(extensions.digest(convert_to(p_ip_evidence, 'utf8'), 'sha256'), 'hex') end,
    case when nullif(p_device_evidence, '') is null then null else encode(extensions.digest(convert_to(p_device_evidence, 'utf8'), 'sha256'), 'hex') end,
    p_guest_grant_id, p_copy_delivered_at, p_copy_delivery_method, p_recorded_by
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
      'witnessRecorded', nullif(btrim(p_witness_name), '') is not null
    ), p_recorded_by
  );
  perform app_private.refresh_resident_agreement_status(v_version.agreement_id);
  return v_id;
end;
$$;

create or replace function public.record_resident_agreement_outcome(
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
  p_device_evidence text default null,
  p_copy_delivered_at timestamptz default null,
  p_copy_delivery_method text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.resident_agreement_versions%rowtype;
begin
  select * into v from public.resident_agreement_versions where id = p_version_id;
  if not found then raise exception 'Agreement version not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if p_authentication_method not in ('staff_session', 'resident_portal', 'wet_signature_import') then
    raise exception 'Internal authentication method is invalid' using errcode = '22023';
  end if;
  return app_private.insert_resident_agreement_outcome(
    p_version_id, p_outcome, p_signer_name, p_signer_role, p_relationship,
    p_legal_authority, p_authentication_method, p_attestation, p_reason,
    p_witness_name, p_witness_relationship, null, p_device_evidence,
    null, auth.uid(), p_copy_delivered_at, p_copy_delivery_method
  );
end;
$$;

create or replace function public.issue_resident_agreement_guest_grant(
  p_resident_id uuid,
  p_guest_label text,
  p_version_ids uuid[],
  p_expires_at timestamptz,
  p_terms_version text default 'resident-esign-v1'
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_id uuid;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);
  if length(btrim(coalesce(p_guest_label, ''))) < 2 or p_expires_at <= now()
    or p_expires_at > now() + interval '30 days' or cardinality(p_version_ids) = 0
    or exists (
      select 1 from unnest(p_version_ids) id
      where not exists (
        select 1 from public.resident_agreement_versions v
        where v.id = id and v.resident_id = v_resident.id and v.status = 'active'
      )
    ) then raise exception 'Resident agreement guest scope is invalid' using errcode = '22023'; end if;
  insert into public.resident_agreement_guest_grants(
    organization_id, facility_id, resident_id, token_sha256, guest_label,
    allowed_version_ids, expires_at, terms_version, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex'),
    btrim(p_guest_label), p_version_ids, p_expires_at, p_terms_version, auth.uid()
  ) returning id into v_id;
  insert into public.resident_agreement_history(
    organization_id, facility_id, resident_id, guest_grant_id, event_type,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_id,
    'external_link_issued', 'External resident agreement signing link issued',
    jsonb_build_object('versionCount', cardinality(p_version_ids), 'expiresAt', p_expires_at), auth.uid()
  );
  return jsonb_build_object('grantId', v_id, 'token', v_token);
end;
$$;

create or replace function public.accept_resident_agreement_guest_terms(
  p_token text,
  p_device_evidence text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.resident_agreement_guest_grants%rowtype; v_hash text;
begin
  select * into v from public.resident_agreement_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex') for update;
  if not found or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'Resident agreement link is invalid or expired' using errcode = '42501';
  end if;
  v_hash := case when nullif(p_device_evidence, '') is null then null
    else encode(extensions.digest(convert_to(p_device_evidence, 'utf8'), 'sha256'), 'hex') end;
  update public.resident_agreement_guest_grants set accepted_at = coalesce(accepted_at, now()),
    accepted_device_hash = coalesce(accepted_device_hash, v_hash) where id = v.id;
  insert into public.resident_agreement_guest_access_events(
    organization_id, facility_id, resident_id, guest_grant_id, event_type, device_hash
  ) values (v.organization_id, v.facility_id, v.resident_id, v.id, 'terms_accepted', v_hash);
  insert into public.resident_agreement_history(
    organization_id, facility_id, resident_id, guest_grant_id, event_type, summary
  ) values (v.organization_id, v.facility_id, v.resident_id, v.id,
    'external_terms_accepted', 'External signer accepted resident e-sign terms');
  return true;
end;
$$;

create or replace function public.get_resident_agreement_guest_workspace(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.resident_agreement_guest_grants%rowtype; v_resident public.residents%rowtype;
begin
  select * into v from public.resident_agreement_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if not found or v.revoked_at is not null or v.expires_at <= now() or v.accepted_at is null then
    raise exception 'Resident agreement access denied' using errcode = '42501';
  end if;
  select * into v_resident from public.residents where id = v.resident_id;
  insert into public.resident_agreement_guest_access_events(
    organization_id, facility_id, resident_id, guest_grant_id, event_type
  ) values (v.organization_id, v.facility_id, v.resident_id, v.id, 'viewed');
  return jsonb_build_object(
    'guestLabel', v.guest_label,
    'residentName', coalesce(v_resident.preferred_name, v_resident.first_name) || ' ' || left(v_resident.last_name, 1) || '.',
    'expiresAt', v.expires_at,
    'termsVersion', v.terms_version,
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'agreementId', a.id, 'versionId', av.id, 'agreementType', a.agreement_type,
        'title', a.title, 'versionLabel', av.version_label, 'contentText', av.content_text,
        'contentSha256', av.content_sha256, 'effectiveAt', av.effective_at,
        'requiredSignerRoles', av.required_signer_roles,
        'documentLabel', coalesce(d.document_label, d.file_name),
        'responded', exists(select 1 from public.resident_agreement_signatures s
          where s.agreement_version_id = av.id and s.guest_grant_id = v.id)
      ) order by av.effective_at, a.title)
      from public.resident_agreement_versions av
      join public.resident_agreements a on a.id = av.agreement_id
      left join public.resident_documents d on d.id = av.document_id
      where av.id = any(v.allowed_version_ids) and av.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.respond_to_resident_agreement_guest(
  p_token text,
  p_version_id uuid,
  p_outcome text,
  p_signer_name text,
  p_signer_role text,
  p_relationship text,
  p_legal_authority text,
  p_attestation text,
  p_reason text,
  p_witness_name text,
  p_witness_relationship text,
  p_device_evidence text default null,
  p_ip_evidence text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.resident_agreement_guest_grants%rowtype; v_id uuid;
begin
  select * into v from public.resident_agreement_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex') for update;
  if not found or v.revoked_at is not null or v.expires_at <= now() or v.accepted_at is null
    or not (p_version_id = any(v.allowed_version_ids))
    or exists(select 1 from public.resident_agreement_signatures s
      where s.agreement_version_id = p_version_id and s.guest_grant_id = v.id) then
    raise exception 'Resident agreement signing denied' using errcode = '42501';
  end if;
  v_id := app_private.insert_resident_agreement_outcome(
    p_version_id, p_outcome, p_signer_name, p_signer_role, p_relationship,
    p_legal_authority, 'external_link', p_attestation, p_reason,
    p_witness_name, p_witness_relationship, p_ip_evidence, p_device_evidence,
    v.id, null, null, null
  );
  insert into public.resident_agreement_guest_access_events(
    organization_id, facility_id, resident_id, guest_grant_id,
    agreement_version_id, signature_id, event_type, device_hash
  ) values (
    v.organization_id, v.facility_id, v.resident_id, v.id, p_version_id, v_id,
    p_outcome, case when nullif(p_device_evidence, '') is null then null
      else encode(extensions.digest(convert_to(p_device_evidence, 'utf8'), 'sha256'), 'hex') end
  );
  return v_id;
end;
$$;

create or replace function public.mark_resident_agreement_copy_delivered(
  p_signature_id uuid,
  p_delivered_at timestamptz,
  p_delivery_method text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.resident_agreement_signatures%rowtype;
begin
  select * into v from public.resident_agreement_signatures where id = p_signature_id for update;
  if not found then raise exception 'Agreement signature not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.copy_delivered_at is not null or p_delivered_at is null
    or p_delivery_method not in ('email','portal','printed','mail','in_person','other') then
    raise exception 'Copy delivery is invalid or already recorded' using errcode = '22023';
  end if;
  update public.resident_agreement_signatures set copy_delivered_at = p_delivered_at,
    copy_delivery_method = p_delivery_method, updated_at = now() where id = v.id;
  insert into public.resident_agreement_history(
    organization_id, facility_id, resident_id, agreement_id, agreement_version_id,
    signature_id, event_type, summary, evidence, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.resident_id, v.agreement_id,
    v.agreement_version_id, v.id, 'copy_delivered', 'Executed agreement copy delivered',
    jsonb_build_object('deliveredAt', p_delivered_at, 'method', p_delivery_method), auth.uid()
  );
  return true;
end;
$$;

create or replace function public.revoke_resident_agreement_guest_grant(
  p_grant_id uuid,
  p_reason text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.resident_agreement_guest_grants%rowtype;
begin
  select * into v from public.resident_agreement_guest_grants where id = p_grant_id for update;
  if not found then raise exception 'Resident agreement guest grant not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.revoked_at is not null or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Revocation reason is required' using errcode = '22023';
  end if;
  update public.resident_agreement_guest_grants set revoked_at = now(),
    revocation_reason = btrim(p_reason) where id = v.id;
  insert into public.resident_agreement_guest_access_events(
    organization_id, facility_id, resident_id, guest_grant_id, event_type
  ) values (v.organization_id, v.facility_id, v.resident_id, v.id, 'revoked');
  insert into public.resident_agreement_history(
    organization_id, facility_id, resident_id, guest_grant_id, event_type,
    summary, evidence, actor_profile_id
  ) values (v.organization_id, v.facility_id, v.resident_id, v.id,
    'external_link_revoked', 'External resident agreement link revoked',
    jsonb_build_object('reason', btrim(p_reason)), auth.uid());
  return true;
end;
$$;

alter table public.resident_agreements enable row level security;
alter table public.resident_agreement_versions enable row level security;
alter table public.resident_agreement_guest_grants enable row level security;
alter table public.resident_agreement_signatures enable row level security;
alter table public.resident_agreement_history enable row level security;
alter table public.resident_agreement_guest_access_events enable row level security;

create policy resident_agreements_select on public.resident_agreements
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy resident_agreement_versions_select on public.resident_agreement_versions
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy resident_agreement_guest_grants_select on public.resident_agreement_guest_grants
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy resident_agreement_signatures_select on public.resident_agreement_signatures
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy resident_agreement_history_select on public.resident_agreement_history
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy resident_agreement_guest_events_select on public.resident_agreement_guest_access_events
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));

revoke all on table public.resident_agreements, public.resident_agreement_versions,
  public.resident_agreement_guest_grants, public.resident_agreement_signatures,
  public.resident_agreement_history, public.resident_agreement_guest_access_events
from public, anon, authenticated, service_role;
grant select on table public.resident_agreements, public.resident_agreement_versions,
  public.resident_agreement_guest_grants, public.resident_agreement_signatures,
  public.resident_agreement_history, public.resident_agreement_guest_access_events
to authenticated;
grant all on table public.resident_agreements, public.resident_agreement_versions,
  public.resident_agreement_guest_grants, public.resident_agreement_signatures,
  public.resident_agreement_history, public.resident_agreement_guest_access_events
to service_role;

revoke all on function app_private.protect_resident_agreement_version(),
  app_private.protect_resident_agreement_signature(),
  app_private.refresh_resident_agreement_status(uuid),
  app_private.insert_resident_agreement_outcome(uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz,text)
from public, anon, authenticated, service_role;

revoke all on function public.publish_resident_agreement_version(uuid,text,text,text,text,timestamptz,text[],uuid,uuid,text),
  public.record_resident_agreement_outcome(uuid,text,text,text,text,text,text,text,text,text,text,text,timestamptz,text),
  public.issue_resident_agreement_guest_grant(uuid,text,uuid[],timestamptz,text),
  public.mark_resident_agreement_copy_delivered(uuid,timestamptz,text),
  public.revoke_resident_agreement_guest_grant(uuid,text)
from public, anon, authenticated, service_role;
grant execute on function public.publish_resident_agreement_version(uuid,text,text,text,text,timestamptz,text[],uuid,uuid,text),
  public.record_resident_agreement_outcome(uuid,text,text,text,text,text,text,text,text,text,text,text,timestamptz,text),
  public.issue_resident_agreement_guest_grant(uuid,text,uuid[],timestamptz,text),
  public.mark_resident_agreement_copy_delivered(uuid,timestamptz,text),
  public.revoke_resident_agreement_guest_grant(uuid,text)
to authenticated;

revoke all on function public.accept_resident_agreement_guest_terms(text,text),
  public.get_resident_agreement_guest_workspace(text),
  public.respond_to_resident_agreement_guest(text,uuid,text,text,text,text,text,text,text,text,text,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.accept_resident_agreement_guest_terms(text,text),
  public.get_resident_agreement_guest_workspace(text),
  public.respond_to_resident_agreement_guest(text,uuid,text,text,text,text,text,text,text,text,text,text,text)
to anon, authenticated;

-- Extend the Priority 11 reusable packet without duplicating its established fields.
alter function public.get_resident_administrative_packet(uuid)
  rename to get_resident_administrative_packet_base;
revoke all on function public.get_resident_administrative_packet_base(uuid)
from public, anon, authenticated, service_role;

create or replace function public.get_resident_administrative_packet(p_resident_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_packet jsonb;
begin
  v_packet := public.get_resident_administrative_packet_base(p_resident_id);
  return v_packet || jsonb_build_object(
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'type', a.agreement_type, 'title', a.title, 'status', a.status,
        'currentVersion', jsonb_build_object(
          'id', v.id, 'number', v.version_number, 'label', v.version_label,
          'contentSha256', v.content_sha256, 'effectiveAt', v.effective_at,
          'requiredSignerRoles', v.required_signer_roles, 'documentId', v.document_id,
          'supersedesVersionId', v.supersedes_version_id, 'amendmentReason', v.amendment_reason
        ),
        'signatures', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'outcome', s.outcome, 'signerName', s.signer_name,
          'signerRole', s.signer_role, 'relationship', s.relationship,
          'legalAuthority', s.legal_authority, 'authenticationMethod', s.authentication_method,
          'signedAt', s.signed_at, 'witnessName', s.witness_name, 'reason', s.reason,
          'copyDeliveredAt', s.copy_delivered_at, 'copyDeliveryMethod', s.copy_delivery_method
        ) order by s.signed_at) from public.resident_agreement_signatures s
          where s.agreement_version_id = v.id), '[]'::jsonb)
      ) order by a.created_at)
      from public.resident_agreements a
      join public.resident_agreement_versions v on v.id = a.current_version_id
      where a.resident_id = p_resident_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_resident_administrative_packet(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_resident_administrative_packet(uuid) to authenticated;

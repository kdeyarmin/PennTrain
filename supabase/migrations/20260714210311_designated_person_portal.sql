-- Narrow, consent-gated designated-person access. Raw access tokens are
-- returned once and never stored. Portal callers receive only explicitly
-- permissioned summaries; authenticated managers retain normal tenant scope.

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (notification_type in (
  'course_assigned', 'quiz_graded', 'certificate_issued',
  'training_due_soon', 'training_expired', 'competency_recorded',
  'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
  'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
  'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
  'support_ticket_update', 'workforce_lifecycle_changed', 'training_registration_changed',
  'open_shift_claim_changed', 'shift_swap_changed', 'credential_renewal_changed',
  'qualification_changed', 'course_assignment_due_soon',
  'shift_handoff_assigned', 'shift_handoff_escalated', 'shift_handoff_resolved',
  'time_off_request_changed',
  'portal_message_received'
));

create table public.resident_portal_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  resident_id uuid not null references public.residents(id) on delete cascade,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  designated_person_name text not null check (length(btrim(designated_person_name)) between 2 and 160),
  relationship_label text not null check (length(btrim(relationship_label)) between 2 and 100),
  contact_email text,
  permissions text[] not null check (
    cardinality(permissions) between 1 and 4
    and permissions <@ array['schedule', 'finance', 'documents', 'messages']::text[]
  ),
  terms_version text not null default 'resident-portal-v1',
  accepted_terms_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revocation_reason text,
  last_accessed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '366 days'),
  check ((revoked_at is null) = (revoked_by is null))
);
create index resident_portal_grants_resident_idx
  on public.resident_portal_grants(resident_id, expires_at desc);
create index resident_portal_grants_active_idx
  on public.resident_portal_grants(token_sha256, expires_at) where revoked_at is null;

create table public.resident_portal_shared_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  grant_id uuid not null references public.resident_portal_grants(id) on delete cascade,
  resident_id uuid not null references public.residents(id) on delete cascade,
  document_id uuid not null references public.resident_documents(id) on delete restrict,
  display_label text not null check (length(btrim(display_label)) between 2 and 200),
  shared_by uuid references public.profiles(id) on delete set null,
  shared_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles(id) on delete set null,
  unique (grant_id, document_id),
  check ((withdrawn_at is null) = (withdrawn_by is null))
);
create index resident_portal_shared_documents_grant_idx
  on public.resident_portal_shared_documents(grant_id, withdrawn_at);

create table public.resident_portal_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  grant_id uuid not null references public.resident_portal_grants(id) on delete cascade,
  resident_id uuid not null references public.residents(id) on delete cascade,
  direction text not null check (direction in ('designated_person_to_facility', 'facility_to_designated_person')),
  body text not null check (length(btrim(body)) between 1 and 5000),
  sent_by_profile_id uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index resident_portal_messages_grant_idx
  on public.resident_portal_messages(grant_id, created_at desc);
create index resident_portal_messages_inbox_idx
  on public.resident_portal_messages(facility_id, read_at, created_at desc)
  where direction = 'designated_person_to_facility';

create table public.resident_portal_access_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  grant_id uuid not null references public.resident_portal_grants(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  event_type text not null check (event_type in (
    'terms_accepted', 'view', 'message_sent', 'document_list_viewed', 'denied', 'revoked'
  )),
  request_fingerprint_sha256 text check (
    request_fingerprint_sha256 is null or request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  ),
  occurred_at timestamptz not null default now()
);
create index resident_portal_access_events_grant_idx
  on public.resident_portal_access_events(grant_id, occurred_at desc);

create or replace function app_private.prevent_resident_portal_access_event_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Resident portal access evidence is append-only' using errcode = '55000';
end;
$$;
revoke all on function app_private.prevent_resident_portal_access_event_mutation() from public, anon, authenticated;
create trigger prevent_resident_portal_access_event_mutation
before update or delete on public.resident_portal_access_events
for each row execute function app_private.prevent_resident_portal_access_event_mutation();

create trigger set_updated_at before update on public.resident_portal_grants
for each row execute function public.set_updated_at();

create or replace function app_private.assert_resident_portal_manager(p_resident_id uuid)
returns public.residents language plpgsql stable security definer set search_path = '' as $$
declare v_resident public.residents%rowtype;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if v_resident.id is null then raise exception 'Resident not found'; end if;
  if not public.is_platform_admin() and (
    public.current_org_id() is distinct from v_resident.organization_id
    or not public.is_assigned_to_facility(v_resident.facility_id)
    or public.current_role() not in ('org_admin', 'facility_manager')
  ) then
    raise exception 'Resident portal management denied' using errcode = '42501';
  end if;
  return v_resident;
end;
$$;
revoke all on function app_private.assert_resident_portal_manager(uuid) from public, anon, authenticated;

create or replace function app_private.find_active_resident_portal_grant(p_token text)
returns public.resident_portal_grants language sql stable security definer set search_path = '' as $$
  select g
  from public.resident_portal_grants g
  where g.token_sha256 = encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex')
    and g.revoked_at is null and g.expires_at > now()
  limit 1;
$$;
revoke all on function app_private.find_active_resident_portal_grant(text) from public, anon, authenticated;

create or replace function public.create_resident_portal_grant(
  p_resident_id uuid,
  p_designated_person_name text,
  p_relationship_label text,
  p_contact_email text,
  p_permissions text[],
  p_expires_at timestamptz
) returns table(grant_id uuid, access_token text)
language plpgsql security definer set search_path = '' as $$
declare v_resident public.residents%rowtype; v_token text; v_grant_id uuid;
begin
  v_resident := app_private.assert_resident_portal_manager(p_resident_id);
  if cardinality(p_permissions) < 1
     or not p_permissions <@ array['schedule', 'finance', 'documents', 'messages']::text[]
     or p_expires_at <= now() or p_expires_at > now() + interval '365 days' then
    raise exception 'Invalid portal permissions or expiration' using errcode = '22023';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.resident_portal_grants(
    organization_id, facility_id, resident_id, token_sha256,
    designated_person_name, relationship_label, contact_email,
    permissions, expires_at, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
    btrim(p_designated_person_name), btrim(p_relationship_label), nullif(btrim(p_contact_email), ''),
    array(select distinct value from unnest(p_permissions) value order by value),
    p_expires_at, auth.uid()
  ) returning id into v_grant_id;
  return query select v_grant_id, v_token;
end;
$$;

create or replace function public.revoke_resident_portal_grant(p_grant_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_grant public.resident_portal_grants%rowtype;
begin
  select * into v_grant from public.resident_portal_grants where id = p_grant_id;
  if v_grant.id is null then raise exception 'Portal grant not found'; end if;
  perform app_private.assert_resident_portal_manager(v_grant.resident_id);
  if v_grant.revoked_at is null then
    update public.resident_portal_grants set revoked_at = now(), revoked_by = auth.uid(),
      revocation_reason = coalesce(nullif(btrim(p_reason), ''), 'Revoked by facility') where id = p_grant_id;
    insert into public.resident_portal_access_events(
      organization_id, facility_id, grant_id, resident_id, event_type
    ) values (v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id, 'revoked');
  end if;
end;
$$;

create or replace function public.share_resident_portal_document(
  p_grant_id uuid, p_document_id uuid, p_display_label text, p_share boolean default true
) returns void language plpgsql security definer set search_path = '' as $$
declare v_grant public.resident_portal_grants%rowtype; v_document public.resident_documents%rowtype;
begin
  select * into v_grant from public.resident_portal_grants where id = p_grant_id;
  select * into v_document from public.resident_documents where id = p_document_id;
  if v_grant.id is null or v_document.id is null or v_document.resident_id <> v_grant.resident_id
     or not ('documents' = any(v_grant.permissions)) then
    raise exception 'Document is not eligible for this portal grant' using errcode = '42501';
  end if;
  perform app_private.assert_resident_portal_manager(v_grant.resident_id);
  if p_share then
    insert into public.resident_portal_shared_documents(
      organization_id, facility_id, grant_id, resident_id, document_id, display_label, shared_by
    ) values (
      v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
      v_document.id, btrim(p_display_label), auth.uid()
    ) on conflict (grant_id, document_id) do update set
      display_label = excluded.display_label, withdrawn_at = null, withdrawn_by = null,
      shared_by = auth.uid(), shared_at = now();
  else
    update public.resident_portal_shared_documents set withdrawn_at = now(), withdrawn_by = auth.uid()
    where grant_id = p_grant_id and document_id = p_document_id and withdrawn_at is null;
  end if;
end;
$$;

create or replace function public.accept_resident_portal_terms(
  p_token text, p_terms_version text, p_request_fingerprint_sha256 text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_grant public.resident_portal_grants%rowtype;
begin
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null or v_grant.terms_version <> p_terms_version then return false; end if;
  if p_request_fingerprint_sha256 is not null and p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request fingerprint' using errcode = '22023';
  end if;
  update public.resident_portal_grants set accepted_terms_at = coalesce(accepted_terms_at, now()),
    last_accessed_at = now() where id = v_grant.id;
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'terms_accepted', p_request_fingerprint_sha256
  );
  return true;
end;
$$;

create or replace function public.get_resident_portal_snapshot(
  p_token text, p_request_fingerprint_sha256 text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_grant public.resident_portal_grants%rowtype;
  v_resident public.residents%rowtype;
  v_facility public.facilities%rowtype;
  v_schedule jsonb := '[]'::jsonb;
  v_finance jsonb := 'null'::jsonb;
  v_documents jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
begin
  if p_request_fingerprint_sha256 is not null and p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request fingerprint' using errcode = '22023';
  end if;
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null then return jsonb_build_object('accessStatus', 'invalid'); end if;
  if v_grant.accepted_terms_at is null then
    return jsonb_build_object(
      'accessStatus', 'terms_required', 'termsVersion', v_grant.terms_version,
      'expiresAt', v_grant.expires_at
    );
  end if;
  select * into v_resident from public.residents where id = v_grant.resident_id;
  select * into v_facility from public.facilities where id = v_grant.facility_id;
  if 'schedule' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(to_jsonb(s) order by s."startsAt"), '[]'::jsonb) into v_schedule
    from (
      select e.id, e.event_type as "eventType", e.title, e.starts_at as "startsAt",
        e.ends_at as "endsAt", e.location_name as "locationName",
        e.transportation_mode as "transportationMode", e.preparation_instructions as "preparationInstructions"
      from public.resident_service_calendar_events e
      where e.resident_id = v_grant.resident_id and e.status = 'scheduled'
        and e.starts_at >= now() and e.starts_at < now() + interval '90 days'
      order by e.starts_at limit 25
    ) s;
  end if;
  if 'finance' = any(v_grant.permissions) then
    select coalesce(to_jsonb(s), 'null'::jsonb) into v_finance from (
      select f.statement_number as "statementNumber", f.issued_on as "issuedOn",
        f.due_date as "dueDate", f.balance_due as "balanceDue",
        f.delinquent_amount as "delinquentAmount"
      from public.resident_financial_statements f where f.resident_id = v_grant.resident_id
      order by f.issued_on desc, f.created_at desc limit 1
    ) s;
  end if;
  if 'documents' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(to_jsonb(d) order by d."sharedAt" desc), '[]'::jsonb) into v_documents
    from (
      select sd.id, sd.display_label as "displayLabel", rd.file_name as "fileName",
        rd.file_type as "fileType", sd.shared_at as "sharedAt"
      from public.resident_portal_shared_documents sd
      join public.resident_documents rd on rd.id = sd.document_id
      where sd.grant_id = v_grant.id and sd.withdrawn_at is null
    ) d;
  end if;
  if 'messages' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(to_jsonb(m) order by m."createdAt"), '[]'::jsonb) into v_messages
    from (
      select pm.id, pm.direction, pm.body, pm.created_at as "createdAt"
      from public.resident_portal_messages pm where pm.grant_id = v_grant.id
      order by pm.created_at desc limit 50
    ) m;
  end if;
  update public.resident_portal_grants set last_accessed_at = now() where id = v_grant.id;
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    case when 'documents' = any(v_grant.permissions) then 'document_list_viewed' else 'view' end,
    p_request_fingerprint_sha256
  );
  return jsonb_build_object(
    'accessStatus', 'active',
    'expiresAt', v_grant.expires_at,
    'designatedPersonName', v_grant.designated_person_name,
    'relationship', v_grant.relationship_label,
    'permissions', to_jsonb(v_grant.permissions),
    'resident', jsonb_build_object(
      'displayName', v_resident.first_name || ' ' || v_resident.last_name,
      'room', v_resident.room
    ),
    'facility', jsonb_build_object(
      'name', v_facility.name, 'phone', v_facility.phone,
      'address', concat_ws(', ', v_facility.address, v_facility.city, v_facility.state, v_facility.zip)
    ),
    'schedule', v_schedule, 'finance', v_finance,
    'documents', v_documents, 'messages', v_messages
  );
end;
$$;

create or replace function public.post_resident_portal_message(
  p_token text, p_body text, p_request_fingerprint_sha256 text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_grant public.resident_portal_grants%rowtype;
begin
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null or v_grant.accepted_terms_at is null
     or not ('messages' = any(v_grant.permissions)) then return false; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Message must be between 1 and 5000 characters' using errcode = '22023';
  end if;
  insert into public.resident_portal_messages(
    organization_id, facility_id, grant_id, resident_id, direction, body
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'designated_person_to_facility', btrim(p_body)
  );
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'message_sent', p_request_fingerprint_sha256
  );
  insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
  select distinct v_grant.organization_id, p.id, 'portal_message_received',
    'Designated-person portal message', 'A new designated-person message needs review.',
    '/app/residents/' || v_grant.resident_id
  from public.profiles p
  left join public.facility_assignments fa on fa.profile_id = p.id and fa.facility_id = v_grant.facility_id
  where p.organization_id = v_grant.organization_id and p.is_active
    and (p.role = 'org_admin' or (p.role = 'facility_manager' and fa.id is not null));
  return true;
end;
$$;

create or replace function public.reply_resident_portal_message(p_grant_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_grant public.resident_portal_grants%rowtype; v_id uuid;
begin
  select * into v_grant from public.resident_portal_grants where id = p_grant_id;
  if v_grant.id is null or not ('messages' = any(v_grant.permissions)) then
    raise exception 'Portal messaging is unavailable' using errcode = '42501';
  end if;
  perform app_private.assert_resident_portal_manager(v_grant.resident_id);
  if length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Message must be between 1 and 5000 characters' using errcode = '22023';
  end if;
  insert into public.resident_portal_messages(
    organization_id, facility_id, grant_id, resident_id, direction, body, sent_by_profile_id
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'facility_to_designated_person', btrim(p_body), auth.uid()
  ) returning id into v_id;
  update public.resident_portal_messages
  set read_at = coalesce(read_at, now())
  where grant_id = v_grant.id
    and direction = 'designated_person_to_facility'
    and read_at is null;
  return v_id;
end;
$$;

alter table public.resident_portal_grants enable row level security;
alter table public.resident_portal_shared_documents enable row level security;
alter table public.resident_portal_messages enable row level security;
alter table public.resident_portal_access_events enable row level security;

create policy resident_portal_grants_manager_read on public.resident_portal_grants
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  )
);
create policy resident_portal_documents_manager_read on public.resident_portal_shared_documents
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  )
);
create policy resident_portal_messages_manager_read on public.resident_portal_messages
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  )
);
create policy resident_portal_access_manager_read on public.resident_portal_access_events
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  )
);

revoke all on table public.resident_portal_grants, public.resident_portal_shared_documents,
  public.resident_portal_messages, public.resident_portal_access_events from public, anon;
grant select on table public.resident_portal_grants, public.resident_portal_shared_documents,
  public.resident_portal_messages, public.resident_portal_access_events to authenticated;
grant select, insert, update on table public.resident_portal_grants, public.resident_portal_shared_documents,
  public.resident_portal_messages to service_role;
grant select, insert on table public.resident_portal_access_events to service_role;

revoke all on function public.create_resident_portal_grant(uuid, text, text, text, text[], timestamptz),
  public.revoke_resident_portal_grant(uuid, text),
  public.share_resident_portal_document(uuid, uuid, text, boolean),
  public.reply_resident_portal_message(uuid, text) from public, anon, authenticated;
grant execute on function public.create_resident_portal_grant(uuid, text, text, text, text[], timestamptz),
  public.revoke_resident_portal_grant(uuid, text),
  public.share_resident_portal_document(uuid, uuid, text, boolean),
  public.reply_resident_portal_message(uuid, text) to authenticated;

revoke all on function public.accept_resident_portal_terms(text, text, text),
  public.get_resident_portal_snapshot(text, text),
  public.post_resident_portal_message(text, text, text) from public, anon, authenticated;
grant execute on function public.accept_resident_portal_terms(text, text, text),
  public.get_resident_portal_snapshot(text, text),
  public.post_resident_portal_message(text, text, text) to anon, authenticated;

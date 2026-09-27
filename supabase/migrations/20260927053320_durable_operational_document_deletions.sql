-- Commit authorized metadata removal and a durable cleanup receipt together before
-- asking the Storage API to remove bytes. Retry survives a lost response/parent deletion.
create table app_private.document_deletions (
  document_kind text not null check (document_kind in ('training','maintenance','credential','incident','violation','compliance')),
  document_id uuid not null,
  organization_id uuid not null,
  facility_id uuid not null,
  storage_bucket text not null,
  storage_path text,
  storage_path_sha256 text not null check (storage_path_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  pending_organization_id uuid generated always as (case when completed_at is null then organization_id end) stored,
  pending_facility_id uuid generated always as (case when completed_at is null then facility_id end) stored,
  primary key (document_kind, document_id),
  foreign key (pending_organization_id) references public.organizations(id) on delete restrict,
  foreign key (pending_facility_id) references public.facilities(id) on delete restrict,
  check ((completed_at is null and storage_path is not null and file_name is not null)
      or (completed_at is not null and storage_path is null and file_name is null))
);
alter table app_private.document_deletions enable row level security;
revoke all on app_private.document_deletions from public, anon, authenticated, service_role;
create index document_deletions_pending_idx on app_private.document_deletions(facility_id, requested_at, document_kind, document_id) where completed_at is null;
create index document_deletions_path_idx on app_private.document_deletions(storage_bucket, storage_path_sha256);
create index document_deletions_pending_org_idx on app_private.document_deletions(pending_organization_id) where pending_organization_id is not null;
create index document_deletions_pending_facility_idx on app_private.document_deletions(pending_facility_id) where pending_facility_id is not null;

create function app_private.document_deletion_kind(p_table text)
returns text language sql immutable set search_path = '' as $$
  select case p_table when 'training_documents' then 'training' when 'maintenance_documents' then 'maintenance'
    when 'employee_credential_documents' then 'credential' when 'incident_documents' then 'incident'
    when 'violation_documents' then 'violation' when 'compliance_requirement_documents' then 'compliance' end;
$$;

-- Path locks use the same namespace/order as resident document deletion and Storage writes.
create function app_private.lock_operational_document_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_resident_document_paths(old.storage_bucket, old.storage_path);
  return old;
end;
$$;
create function app_private.record_operational_document_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.document_deletions(document_kind, document_id, organization_id, facility_id,
    storage_bucket, storage_path, storage_path_sha256, file_name)
  values(app_private.document_deletion_kind(tg_table_name), old.id, old.organization_id, old.facility_id,
    old.storage_bucket, old.storage_path, pg_catalog.encode(extensions.digest(old.storage_path, 'sha256'), 'hex'), old.file_name);
  return old;
exception when foreign_key_violation then
  raise exception 'Finish document file deletion before deleting its facility or organization.' using errcode = '23503';
end;
$$;

create function app_private.protect_operational_document_path()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    perform app_private.lock_resident_document_paths(new.storage_bucket, new.storage_path, old.storage_bucket, old.storage_path);
  else
    perform app_private.lock_resident_document_paths(new.storage_bucket, new.storage_path);
  end if;
  if exists (select 1 from app_private.document_deletions d where d.document_kind = app_private.document_deletion_kind(tg_table_name) and d.document_id = new.id)
    or exists (select 1 from app_private.document_deletions d where d.storage_bucket = new.storage_bucket
      and d.storage_path_sha256 = pg_catalog.encode(extensions.digest(new.storage_path, 'sha256'), 'hex')) then
    raise exception 'This document identifier or file path has been deleted. Upload a new file.' using errcode = '23514';
  end if;
  -- A removal that won the path lock must not be followed by registration of missing bytes.
  if current_setting('role', true) in ('authenticated','service_role') and not exists (
    select 1 from storage.objects o where o.bucket_id = new.storage_bucket and o.name = new.storage_path
  ) then
    raise exception 'The document file is not in Storage. Upload it before saving the document.' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['training_documents','maintenance_documents','employee_credential_documents','incident_documents','violation_documents','compliance_requirement_documents'] loop
    execute format('create trigger lock_document_storage_before_delete before delete on public.%I for each row execute function app_private.lock_operational_document_deletion()', t);
    execute format('create trigger record_storage_cleanup after delete on public.%I for each row execute function app_private.record_operational_document_deletion()', t);
    execute format('create trigger zz_protect_operational_document_path before insert or update of id, storage_bucket, storage_path on public.%I for each row execute function app_private.protect_operational_document_path()', t);
    execute format('create index if not exists %I on public.%I(storage_bucket, storage_path)', t || '_deletion_path_idx', t);
  end loop;
end;
$$;

-- Definer visibility is necessary: hidden metadata still protects shared bytes. Existing
-- permissive Storage role/path policies and restrictive MFA/module policies remain required.
create function app_private.operational_document_path_registered(p_bucket text, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.training_documents where storage_bucket = p_bucket and storage_path = p_path)
    or exists(select 1 from public.maintenance_documents where storage_bucket = p_bucket and storage_path = p_path)
    or exists(select 1 from public.employee_credential_documents where storage_bucket = p_bucket and storage_path = p_path)
    or exists(select 1 from public.incident_documents where storage_bucket = p_bucket and storage_path = p_path)
    or exists(select 1 from public.violation_documents where storage_bucket = p_bucket and storage_path = p_path)
    or exists(select 1 from public.compliance_requirement_documents where storage_bucket = p_bucket and storage_path = p_path);
$$;
create function app_private.operational_document_object_removable(p_bucket text, p_path text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  perform app_private.lock_resident_document_paths(p_bucket, p_path);
  return not app_private.operational_document_path_registered(p_bucket, p_path);
end;
$$;
create policy operational_document_bytes_retained on storage.objects as restrictive for delete to authenticated
  using(app_private.operational_document_object_removable(bucket_id, name));

create function app_private.operational_document_path_available(p_bucket text, p_path text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  perform app_private.lock_resident_document_paths(p_bucket, p_path);
  return not exists(select 1 from app_private.document_deletions d where d.storage_bucket = p_bucket
    and d.storage_path_sha256 = pg_catalog.encode(extensions.digest(p_path, 'sha256'), 'hex'));
end;
$$;
create policy operational_document_deleted_path_insert on storage.objects as restrictive for insert to authenticated
  with check(app_private.operational_document_path_available(bucket_id, name));
create policy operational_document_deleted_path_update on storage.objects as restrictive for update to authenticated
  using(app_private.operational_document_path_available(bucket_id, name))
  with check(app_private.operational_document_path_available(bucket_id, name));

-- Storage finalizes uploads with a privileged writer after its initial RLS transaction.
-- Enforce reservations on that final writer too; never delete Storage rows directly.
create function app_private.protect_operational_document_storage_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.bucket_id is not distinct from old.bucket_id and new.name is not distinct from old.name
      and new.version is not distinct from old.version then return new; end if;
    perform app_private.lock_resident_document_paths(new.bucket_id, new.name, old.bucket_id, old.name);
    if app_private.operational_document_path_registered(old.bucket_id, old.name) or exists (
      select 1 from app_private.document_deletions d where d.storage_bucket = old.bucket_id
        and d.storage_path_sha256 = pg_catalog.encode(extensions.digest(old.name, 'sha256'), 'hex')) then
      raise exception 'A registered or deleted document file cannot be replaced or moved. Upload a new file.' using errcode = '23514';
    end if;
  else
    perform app_private.lock_resident_document_paths(new.bucket_id, new.name);
  end if;
  if exists(select 1 from app_private.document_deletions d where d.storage_bucket = new.bucket_id
    and d.storage_path_sha256 = pg_catalog.encode(extensions.digest(new.name, 'sha256'), 'hex')) then
    raise exception 'A deleted document file path cannot be reused.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger zz_protect_operational_document_storage_write before insert or update of bucket_id, name, version on storage.objects
  for each row execute function app_private.protect_operational_document_storage_write();

-- Preserve each family's DELETE scope after its parent row is gone. Catalog-driven
-- module checks retain the intentional unclassified credential resource semantics.
create function app_private.can_manage_document_deletion(p_kind text, p_org uuid, p_facility uuid, p_bucket text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.current_session_unlocked()
    and public.current_impersonation_session_live() and public.current_sms_mfa_satisfied()
    and app_private.has_product_module_for_bucket(p_bucket)
    and (p_bucket <> 'course-documents' or public.is_platform_admin())
    and (p_bucket <> 'learning-packages' or public.is_platform_admin() or public.current_role() = 'org_admin')
    and not exists(select 1 from app_private.product_module_resources r where r.resource_schema = 'public'
      and app_private.document_deletion_kind(r.resource_name) = p_kind and not app_private.has_product_module(r.module_key))
    and (public.is_platform_admin() or (public.current_org_id() = p_org and (
      (p_kind in ('credential','incident','violation') and public.current_role() = 'org_admin')
      or (p_kind in ('training','maintenance') and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(p_facility))
      or (p_kind = 'compliance' and (public.current_role() = 'org_admin' or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(p_facility))))
    )));
$$;

-- Credential and external-upload Storage access originally depends on the live metadata row. The Storage
-- API also needs SELECT when removing an object, so a matching authorized receipt keeps
-- only this narrow cleanup access alive. A forged legacy path cannot cross tenant/facility.
create function app_private.operational_cleanup_object_visible(p_bucket text, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from app_private.document_deletions d where d.completed_at is null
      and ((d.document_kind = 'credential' and p_bucket = 'credential-documents')
        or (d.document_kind = 'training' and p_bucket = 'external-uploads'))
      and d.storage_bucket = p_bucket and d.storage_path = p_path
      and position(d.organization_id::text || '/' || d.facility_id::text || '/' in p_path) = 1
      and app_private.can_manage_document_deletion(d.document_kind, d.organization_id, d.facility_id, d.storage_bucket));
$$;
create policy operational_pending_cleanup_select on storage.objects for select to authenticated
  using(app_private.operational_cleanup_object_visible(bucket_id, name));
create policy operational_pending_cleanup_delete on storage.objects for delete to authenticated
  using(app_private.operational_cleanup_object_visible(bucket_id, name));

-- Lock the evidence row before reading its count/audit inputs. Concurrent attempts cannot
-- both decrement the occurrence or emit removal events for a single document.
create or replace function public.remove_compliance_evidence(p_document_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare d public.compliance_requirement_documents%rowtype;
begin
  select * into d from public.compliance_requirement_documents where id = p_document_id for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform app_private.assert_compliance_manager(d.organization_id, d.facility_id);
  delete from public.compliance_requirement_documents where id = d.id;
  if d.instance_id is not null then
    update public.compliance_requirement_instances set evidence_count = greatest(evidence_count - 1, 0) where id = d.instance_id;
  end if;
  insert into public.compliance_requirement_events
    (organization_id, facility_id, requirement_id, instance_id, event_type, actor_profile_id, note, metadata)
  values (d.organization_id, d.facility_id, d.requirement_id, d.instance_id, 'evidence_removed', (select auth.uid()),
    coalesce(d.document_label, d.file_name), jsonb_build_object('storage_path', d.storage_path));
  return true;
end;
$$;

create function public.list_pending_document_deletions(p_document_kind text default null, p_facility_id uuid default null)
returns table(document_kind text, document_id uuid, facility_id uuid, storage_bucket text, storage_path text, file_name text, requested_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.document_kind, d.document_id, d.facility_id, d.storage_bucket, d.storage_path, d.file_name, d.requested_at
  from app_private.document_deletions d where d.completed_at is null
    and (p_document_kind is null or d.document_kind = p_document_kind)
    and (p_facility_id is null or d.facility_id = p_facility_id)
    and app_private.can_manage_document_deletion(d.document_kind, d.organization_id, d.facility_id, d.storage_bucket)
  order by d.requested_at, d.document_kind, d.document_id;
$$;

create function public.begin_document_deletion(p_document_kind text, p_document_id uuid)
returns table(document_kind text, document_id uuid, storage_bucket text, storage_path text)
language plpgsql security invoker set search_path = '' as $$
begin
  case p_document_kind
    when 'training' then return query delete from public.training_documents d where d.id = p_document_id and app_private.has_product_module_for_bucket(d.storage_bucket) and (d.storage_bucket <> 'course-documents' or public.is_platform_admin()) and (d.storage_bucket <> 'learning-packages' or public.is_platform_admin() or public.current_role() = 'org_admin') returning p_document_kind, d.id, d.storage_bucket, d.storage_path;
    when 'maintenance' then return query delete from public.maintenance_documents d where d.id = p_document_id and app_private.has_product_module_for_bucket(d.storage_bucket) and (d.storage_bucket <> 'course-documents' or public.is_platform_admin()) and (d.storage_bucket <> 'learning-packages' or public.is_platform_admin() or public.current_role() = 'org_admin') returning p_document_kind, d.id, d.storage_bucket, d.storage_path;
    when 'credential' then return query delete from public.employee_credential_documents d where d.id = p_document_id and app_private.has_product_module_for_bucket(d.storage_bucket) and (d.storage_bucket <> 'course-documents' or public.is_platform_admin()) and (d.storage_bucket <> 'learning-packages' or public.is_platform_admin() or public.current_role() = 'org_admin') returning p_document_kind, d.id, d.storage_bucket, d.storage_path;
    when 'incident' then return query delete from public.incident_documents d where d.id = p_document_id and app_private.has_product_module_for_bucket(d.storage_bucket) and (d.storage_bucket <> 'course-documents' or public.is_platform_admin()) and (d.storage_bucket <> 'learning-packages' or public.is_platform_admin() or public.current_role() = 'org_admin') returning p_document_kind, d.id, d.storage_bucket, d.storage_path;
    when 'violation' then return query delete from public.violation_documents d where d.id = p_document_id and app_private.has_product_module_for_bucket(d.storage_bucket) and (d.storage_bucket <> 'course-documents' or public.is_platform_admin()) and (d.storage_bucket <> 'learning-packages' or public.is_platform_admin() or public.current_role() = 'org_admin') returning p_document_kind, d.id, d.storage_bucket, d.storage_path;
    when 'compliance' then
      -- Keep the workflow's authoritative manager check, evidence count and audit event.
      perform public.remove_compliance_evidence(p_document_id);
      return query select d.document_kind, d.document_id, d.storage_bucket, d.storage_path
        from public.list_pending_document_deletions('compliance') d where d.document_id = p_document_id;
    else raise exception 'Unsupported document kind.' using errcode = '22023';
  end case;
  if not found then raise exception 'The document could not be deleted. Refresh the list and pending deletions before retrying.' using errcode = 'P0002'; end if;
end;
$$;

create function public.confirm_document_deletion(p_document_kind text, p_document_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r app_private.document_deletions%rowtype;
begin
  select * into r from app_private.document_deletions d where d.document_kind = p_document_kind and d.document_id = p_document_id for update;
  if not found or not coalesce(app_private.can_manage_document_deletion(r.document_kind, r.organization_id, r.facility_id, r.storage_bucket), false) then
    raise exception 'Document deletion is not available.' using errcode = '42501';
  end if;
  if r.completed_at is not null then return true; end if;
  if exists(select 1 from storage.objects o where o.bucket_id = r.storage_bucket and o.name = r.storage_path) then return false; end if;
  update app_private.document_deletions set completed_at = now(), storage_path = null, file_name = null
    where document_kind = p_document_kind and document_id = p_document_id;
  return true;
end;
$$;

revoke all on function app_private.document_deletion_kind(text), app_private.lock_operational_document_deletion(),
  app_private.record_operational_document_deletion(), app_private.protect_operational_document_path(),
  app_private.operational_document_path_registered(text,text), app_private.operational_document_object_removable(text,text),
  app_private.operational_document_path_available(text,text), app_private.protect_operational_document_storage_write(),
  app_private.can_manage_document_deletion(text,uuid,uuid,text), app_private.operational_cleanup_object_visible(text,text), public.begin_document_deletion(text,uuid),
  public.list_pending_document_deletions(text,uuid), public.confirm_document_deletion(text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.operational_cleanup_object_visible(text,text), app_private.operational_document_object_removable(text,text), app_private.operational_document_path_available(text,text),
  public.begin_document_deletion(text,uuid), public.list_pending_document_deletions(text,uuid), public.confirm_document_deletion(text,uuid) to authenticated;

comment on table app_private.document_deletions is 'Durable cleanup for operational document bytes. Parent removal preserves discoverable facility-scoped pending work; completed receipts redact paths and retain reservations against stale retries. Storage API owns physical deletion.';

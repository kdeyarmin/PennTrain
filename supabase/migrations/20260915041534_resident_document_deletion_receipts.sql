-- Metadata must commit its retention checks before the Storage API removes bytes.
-- A receipt is committed by the same DELETE, so a disconnected browser cannot lose
-- the remaining cleanup work. Receipts retain the path reservation after completion:
-- an old retry must never delete a different file subsequently uploaded at that path.
create table app_private.resident_document_deletions (
  document_id uuid primary key,
  organization_id uuid not null,
  resident_id uuid not null,
  storage_bucket text not null,
  storage_path text,
  storage_path_sha256 text not null check (storage_path_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((completed_at is null and storage_path is not null and file_name is not null)
      or (completed_at is not null and storage_path is null and file_name is null))
);
alter table app_private.resident_document_deletions enable row level security;
revoke all on app_private.resident_document_deletions from public, anon, authenticated, service_role;
create index resident_document_deletions_pending_idx
  on app_private.resident_document_deletions (resident_id, requested_at, document_id)
  where completed_at is null;
create index resident_document_deletions_path_idx
  on app_private.resident_document_deletions (storage_bucket, storage_path_sha256);
create index resident_documents_storage_path_idx
  on public.resident_documents (storage_bucket, storage_path);

create function app_private.record_resident_document_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize re-registration of this path with recording its deletion. This runs
  -- only AFTER the normal DELETE RLS, evidence triggers and foreign keys succeed.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.storage_bucket || '/' || old.storage_path, 0));
  insert into app_private.resident_document_deletions
    (document_id, organization_id, resident_id, storage_bucket, storage_path, storage_path_sha256, file_name)
  values (old.id, old.organization_id, old.resident_id, old.storage_bucket, old.storage_path,
    pg_catalog.encode(extensions.digest(old.storage_path, 'sha256'), 'hex'), old.file_name);
  return old;
end;
$$;
create trigger record_storage_cleanup after delete on public.resident_documents
  for each row execute function app_private.record_resident_document_deletion();

create function app_private.protect_deleted_resident_document_path()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.storage_bucket || '/' || new.storage_path, 0));
  if exists (select 1 from app_private.resident_document_deletions d where d.document_id = new.id) then
    raise exception 'This document identifier has been deleted. Upload the document again with a new identifier.'
      using errcode = '23514';
  end if;
  if exists (select 1 from app_private.resident_document_deletions d
             where d.storage_bucket = new.storage_bucket
               and d.storage_path_sha256 = pg_catalog.encode(extensions.digest(new.storage_path, 'sha256'), 'hex')) then
    raise exception 'This document path has been deleted. Upload the document again with a new path.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger protect_deleted_storage_path before insert or update of id, storage_bucket, storage_path
  on public.resident_documents for each row execute function app_private.protect_deleted_resident_document_path();

-- SECURITY DEFINER is necessary here: a caller's RLS visibility must not hide a
-- live document that protects the object. It returns only a boolean, is private,
-- and grants no additional Storage access; all existing policies still apply.
create function app_private.resident_document_object_removable(p_bucket text, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not exists (
    select 1 from public.resident_documents d where d.storage_bucket = p_bucket and d.storage_path = p_path
  );
$$;
create policy resident_document_bytes_retained on storage.objects as restrictive for delete to authenticated
  using (app_private.resident_document_object_removable(bucket_id, name));

create function app_private.resident_document_path_available(p_bucket text, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not exists (
    select 1 from app_private.resident_document_deletions d where d.storage_bucket = p_bucket
      and d.storage_path_sha256 = pg_catalog.encode(extensions.digest(p_path, 'sha256'), 'hex')
  );
$$;
create policy resident_document_deleted_path_insert on storage.objects as restrictive for insert to authenticated
  with check (app_private.resident_document_path_available(bucket_id, name));
create policy resident_document_deleted_path_update on storage.objects as restrictive for update to authenticated
  using (app_private.resident_document_path_available(bucket_id, name))
  with check (app_private.resident_document_path_available(bucket_id, name));

create function app_private.can_manage_resident_document_deletion(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and public.current_impersonation_session_live()
    and public.current_sms_mfa_satisfied()
    and app_private.has_product_module('modules.carebase')
    and (public.is_platform_admin() or
      (public.current_role() = 'org_admin' and public.current_org_id() = p_organization_id));
$$;

create function public.list_pending_resident_document_deletions(p_resident_id uuid)
returns table (document_id uuid, resident_id uuid, storage_bucket text, storage_path text, file_name text, requested_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.document_id, d.resident_id, d.storage_bucket, d.storage_path, d.file_name, d.requested_at
  from app_private.resident_document_deletions d
  where d.resident_id = p_resident_id and d.completed_at is null
    and app_private.can_manage_resident_document_deletion(d.organization_id)
  order by d.requested_at, d.document_id;
$$;

-- The frontend calls this new endpoint before touching Storage. If the frontend
-- deploys ahead of this migration, a missing RPC fails before deleting anything.
-- SECURITY INVOKER deliberately keeps all existing table RLS and retention checks.
create function public.begin_resident_document_deletion(p_document_id uuid)
returns table (document_id uuid, resident_id uuid, storage_bucket text, storage_path text)
language plpgsql security invoker set search_path = '' as $$
begin
  return query delete from public.resident_documents d where d.id = p_document_id
    returning d.id, d.resident_id, d.storage_bucket, d.storage_path;
  if not found then
    raise exception 'The document could not be deleted. Refresh the list and try again.' using errcode = 'P0002';
  end if;
end;
$$;

create function public.confirm_resident_document_deletion(p_document_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_receipt app_private.resident_document_deletions%rowtype;
begin
  select * into v_receipt from app_private.resident_document_deletions d where d.document_id = p_document_id for update;
  if not found or not coalesce(app_private.can_manage_resident_document_deletion(v_receipt.organization_id), false) then
    raise exception 'Document deletion is not available.' using errcode = '42501';
  end if;
  if v_receipt.completed_at is not null then return true; end if;
  -- Storage remove() may return success with zero rows if its RLS hides the object.
  -- Never mark cleanup complete based on that response alone. Storage metadata is
  -- read here, never deleted directly: the Storage API owns physical object deletion.
  if exists (select 1 from storage.objects o
             where o.bucket_id = v_receipt.storage_bucket and o.name = v_receipt.storage_path) then
    return false;
  end if;
  update app_private.resident_document_deletions set completed_at = now(), storage_path = null, file_name = null
    where document_id = p_document_id;
  return true;
end;
$$;

revoke all on function app_private.record_resident_document_deletion(),
  app_private.protect_deleted_resident_document_path(),
  app_private.resident_document_object_removable(text,text),
  app_private.resident_document_path_available(text,text),
  app_private.can_manage_resident_document_deletion(uuid),
  public.begin_resident_document_deletion(uuid), public.list_pending_resident_document_deletions(uuid), public.confirm_resident_document_deletion(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.resident_document_object_removable(text,text),
  app_private.resident_document_path_available(text,text),
  public.begin_resident_document_deletion(uuid), public.list_pending_resident_document_deletions(uuid), public.confirm_resident_document_deletion(uuid)
  to authenticated;

comment on table app_private.resident_document_deletions is
  'Durable Storage cleanup receipts. Created atomically after authorized metadata deletion; pending work is visible in resident Documents and retried through the Storage API. Completion removes filenames/raw paths and retains a hashed path reservation against late retries. Pending cleanup must finish before a separate tenant Storage purge.';

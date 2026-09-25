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
  pending_resident_id uuid generated always as (case when completed_at is null then resident_id end) stored,
  constraint resident_document_cleanup_requires_resident foreign key (pending_resident_id)
    references public.residents(id) on delete restrict,
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
create index resident_document_deletions_pending_resident_idx
  on app_private.resident_document_deletions (pending_resident_id) where pending_resident_id is not null;
create index resident_documents_storage_path_idx
  on public.resident_documents (storage_bucket, storage_path);

-- All metadata registration/deletion and Storage writes use this lock order.
-- PL/pgSQL callers are VOLATILE so the SELECT after waiting obtains a fresh
-- READ COMMITTED snapshot instead of reusing the permission-check snapshot.
create function app_private.lock_resident_document_paths(
  p_bucket text, p_path text, p_other_bucket text default null, p_other_path text default null
) returns void language plpgsql set search_path = '' as $$
declare v_key text;
begin
  for v_key in select distinct k from unnest(array[p_bucket || '/' || p_path, p_other_bucket || '/' || p_other_path]) k
    where k is not null order by k
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
  end loop;
end;
$$;

create function app_private.lock_resident_document_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.lock_resident_document_paths(old.storage_bucket, old.storage_path);
  return old;
end;
$$;
create trigger lock_document_storage_before_delete before delete on public.resident_documents
  for each row execute function app_private.lock_resident_document_deletion();

create function app_private.record_resident_document_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The BEFORE trigger holds the path lock already. The pending-only resident FK
  -- refuses cascades that would strand work after deleting its resident/organization.
  insert into app_private.resident_document_deletions
    (document_id, organization_id, resident_id, storage_bucket, storage_path, storage_path_sha256, file_name)
  values (old.id, old.organization_id, old.resident_id, old.storage_bucket, old.storage_path,
    pg_catalog.encode(extensions.digest(old.storage_path, 'sha256'), 'hex'), old.file_name);
  return old;
exception when foreign_key_violation then
  raise exception 'Delete the resident document files from Documents before deleting the resident.' using errcode = '23503';
end;
$$;
create trigger record_storage_cleanup after delete on public.resident_documents
  for each row execute function app_private.record_resident_document_deletion();

create function app_private.require_resident_document_cleanup_before_purge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from app_private.resident_document_deletions d where d.pending_resident_id = old.id) then
    raise exception 'Finish the pending file deletions in Documents before deleting this resident.' using errcode = '23503';
  end if;
  return old;
end;
$$;
create trigger require_document_cleanup_before_purge before delete on public.residents
  for each row execute function app_private.require_resident_document_cleanup_before_purge();

create function app_private.protect_deleted_resident_document_path()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    perform app_private.lock_resident_document_paths(new.storage_bucket, new.storage_path, old.storage_bucket, old.storage_path);
  else
    perform app_private.lock_resident_document_paths(new.storage_bucket, new.storage_path);
  end if;
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
  -- If Storage removal won the lock first, the object is now absent. API callers
  -- cannot register metadata after that removal. SET ROLE survives SECURITY DEFINER;
  -- direct trusted SQL migration/fixture loading keeps its historical metadata path.
  if current_setting('role', true) in ('authenticated', 'service_role') and not exists (
    select 1 from storage.objects o where o.bucket_id = new.storage_bucket and o.name = new.storage_path
  ) then
    raise exception 'The document file is no longer in Storage. Upload it again before saving the document.' using errcode = '23514';
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
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  perform app_private.lock_resident_document_paths(p_bucket, p_path);
  return not exists (
    select 1 from public.resident_documents d where d.storage_bucket = p_bucket and d.storage_path = p_path
  );
end;
$$;
create policy resident_document_bytes_retained on storage.objects as restrictive for delete to authenticated
  using (app_private.resident_document_object_removable(bucket_id, name));

create function app_private.resident_document_path_available(p_bucket text, p_path text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  perform app_private.lock_resident_document_paths(p_bucket, p_path);
  return not exists (
    select 1 from app_private.resident_document_deletions d where d.storage_bucket = p_bucket
      and d.storage_path_sha256 = pg_catalog.encode(extensions.digest(p_path, 'sha256'), 'hex')
  );
end;
$$;
create policy resident_document_deleted_path_insert on storage.objects as restrictive for insert to authenticated
  with check (app_private.resident_document_path_available(bucket_id, name));
create policy resident_document_deleted_path_update on storage.objects as restrictive for update to authenticated
  using (app_private.resident_document_path_available(bucket_id, name))
  with check (app_private.resident_document_path_available(bucket_id, name));

-- Storage uploads check RLS in a short permission transaction, upload versioned
-- backend bytes, then finalize with a privileged database writer. RLS alone cannot
-- reject a path retired between those transactions. This narrow invariant trigger
-- also runs for that final writer; it never modifies Storage rows or backend bytes.
-- https://github.com/supabase/storage/blob/v1.62.5/src/storage/uploader.ts
create function app_private.protect_resident_document_storage_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.bucket_id is not distinct from old.bucket_id and new.name is not distinct from old.name
       and new.version is not distinct from old.version then return new; end if;
    perform app_private.lock_resident_document_paths(new.bucket_id, new.name, old.bucket_id, old.name);
    if exists (select 1 from public.resident_documents d where d.storage_bucket = old.bucket_id and d.storage_path = old.name) then
      raise exception 'A registered resident document cannot be replaced or moved. Upload a new document instead.' using errcode = '23514';
    end if;
    if exists (select 1 from app_private.resident_document_deletions d where d.storage_bucket = old.bucket_id
      and d.storage_path_sha256 = pg_catalog.encode(extensions.digest(old.name, 'sha256'), 'hex')) then
      raise exception 'A deleted resident document path cannot be reused.' using errcode = '23514';
    end if;
  else
    perform app_private.lock_resident_document_paths(new.bucket_id, new.name);
  end if;
  if exists (select 1 from app_private.resident_document_deletions d where d.storage_bucket = new.bucket_id
    and d.storage_path_sha256 = pg_catalog.encode(extensions.digest(new.name, 'sha256'), 'hex')) then
    raise exception 'A deleted resident document path cannot be reused.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger protect_resident_document_storage_write before insert or update of bucket_id, name, version on storage.objects
  for each row execute function app_private.protect_resident_document_storage_write();

create function app_private.can_manage_resident_document_deletion(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and public.current_impersonation_session_live()
    and public.current_sms_mfa_satisfied()
    and app_private.has_product_module('modules.carebase')
    and (public.is_platform_admin() or
      (public.current_role() = 'org_admin' and public.current_org_id() = p_organization_id));
$$;

create function public.list_pending_resident_document_deletions(p_resident_id uuid default null)
returns table (document_id uuid, resident_id uuid, storage_bucket text, storage_path text, file_name text, requested_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.document_id, d.resident_id, d.storage_bucket, d.storage_path, d.file_name, d.requested_at
  from app_private.resident_document_deletions d
  where (p_resident_id is null or d.resident_id = p_resident_id) and d.completed_at is null
    and (p_resident_id is not null or d.organization_id = public.current_org_id())
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
  app_private.require_resident_document_cleanup_before_purge(),
  app_private.lock_resident_document_paths(text,text,text,text),
  app_private.lock_resident_document_deletion(),
  app_private.protect_deleted_resident_document_path(),
  app_private.protect_resident_document_storage_write(),
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

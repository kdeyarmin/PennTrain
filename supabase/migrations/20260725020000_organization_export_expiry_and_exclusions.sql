-- PT-006B residuals: make the organization export archive lifecycle verifiable
-- end to end.
--
-- 1) Expiry is now ENFORCED at download time. organization_export_jobs has
--    always stamped expires_at (+7 days) on success, but the storage download
--    policy never checked it, so an "expired" archive stayed downloadable
--    forever. The recreated policy joins the job row and rejects archives whose
--    expires_at has passed -- for org admins AND platform admins alike (an
--    expired compliance archive is expired for everyone; a fresh export can
--    always be requested).
--
-- 2) Expired archives are actually PURGED. Storage objects can only be removed
--    through the Storage API, so the sweep itself lives in the run-data-lifecycle
--    edge function (documented step "lifecycle.organization_export_archives"),
--    driven by the two service_role RPCs below: list_expired_organization_exports
--    (respecting active data_lifecycle_holds, the lifecycle framework's legal-hold
--    model) and purge_expired_organization_exports (deletes the job rows and
--    writes an audit trail after the worker has removed the objects).
--
-- 3) get_organization_export_exclusions lets the export worker declare its scope
--    honestly: get_organization_export_catalog can only see tables WITH an
--    organization_id column, so the archive now ships an exclusions.json naming
--    every public table the catalog cannot cover, computed at run time.

-- ---------------------------------------------------------------------------
-- 1) Expiry-enforcing download policy
-- ---------------------------------------------------------------------------

drop policy if exists organization_exports_download on storage.objects;
create policy organization_exports_download on storage.objects
  for select to authenticated using (
    bucket_id = 'organization-exports'
    and (
      (select public.is_platform_admin())
      or (
        (select public.current_role()) = 'org_admin'
        and (storage.foldername(name))[1] = (select public.current_org_id())::text
      )
    )
    -- The archive is only downloadable while its job row says it is current.
    -- Orphaned objects (job row purged or missing) default to not downloadable.
    and exists (
      select 1 from public.organization_export_jobs j
      where j.storage_bucket = 'organization-exports'
        and j.storage_path = objects.name
        and j.status = 'succeeded'
        and j.expires_at > now()
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Expired-archive purge RPCs (called by run-data-lifecycle)
-- ---------------------------------------------------------------------------

create or replace function public.list_expired_organization_exports(
  p_limit integer default 200
)
returns table (job_id uuid, storage_bucket text, storage_path text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only the trusted lifecycle worker may list expired exports' using errcode = '42501';
  end if;
  if p_limit not between 1 and 1000 then
    raise exception 'Expired export batch limit is invalid' using errcode = '22023';
  end if;
  return query
  select j.id, j.storage_bucket, j.storage_path
  from public.organization_export_jobs j
  where j.status = 'succeeded'
    and j.expires_at <= now()
    -- Respect the lifecycle framework's legal holds: an active hold on
    -- organization_export_jobs (or an all-table hold) for this organization
    -- keeps the archive and its row untouched until the hold is released.
    and not exists (
      select 1 from public.data_lifecycle_holds h
      where h.released_at is null
        and (h.source_table is null or h.source_table = 'organization_export_jobs')
        and (h.organization_id is null or h.organization_id = j.organization_id)
        and j.completed_at between h.starts_at and h.ends_at
    )
  order by j.expires_at
  limit p_limit;
end;
$function$;

create or replace function public.purge_expired_organization_exports(
  p_job_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_purged integer := 0;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only the trusted lifecycle worker may purge expired exports' using errcode = '42501';
  end if;
  if p_job_ids is null or coalesce(array_length(p_job_ids, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(p_job_ids, 1) > 1000 then
    raise exception 'Expired export purge batch is too large' using errcode = '22023';
  end if;
  -- The worker removes the storage objects FIRST and only passes the job ids
  -- whose objects were removed; expiry and holds are re-checked here so a stale
  -- worker cannot purge a job that regained protection in the meantime.
  with deleted as (
    delete from public.organization_export_jobs j
    where j.id = any(p_job_ids)
      and j.status = 'succeeded'
      and j.expires_at <= now()
      and not exists (
        select 1 from public.data_lifecycle_holds h
        where h.released_at is null
          and (h.source_table is null or h.source_table = 'organization_export_jobs')
          and (h.organization_id is null or h.organization_id = j.organization_id)
          and j.completed_at between h.starts_at and h.ends_at
      )
    returning j.id, j.organization_id, j.storage_path, j.expires_at
  ), audited as (
    insert into public.audit_logs (
      organization_id, actor_profile_id, entity_type, entity_id, action, new_values
    )
    select d.organization_id, null, 'organization_export', d.id::text, 'expired_purged',
      jsonb_build_object('storagePath', d.storage_path, 'expiredAt', d.expires_at)
    from deleted d
    returning 1
  )
  select count(*)::integer into v_purged from deleted;
  return v_purged;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Run-time exclusions catalog (mirror of get_organization_export_catalog,
--    inverted): every public table WITHOUT an organization_id column, so the
--    export archive can declare exactly what it does not contain.
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_export_exclusions()
returns table (table_name text)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p')
    and not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = c.oid and a.attname = 'organization_id'
        and a.attnum > 0 and not a.attisdropped
    )
  order by c.relname;
$function$;

revoke all on function
  public.list_expired_organization_exports(integer),
  public.purge_expired_organization_exports(uuid[]),
  public.get_organization_export_exclusions()
  from public, anon, authenticated, service_role;
grant execute on function
  public.list_expired_organization_exports(integer),
  public.purge_expired_organization_exports(uuid[]),
  public.get_organization_export_exclusions()
  to service_role;

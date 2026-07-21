begin;
select plan(8);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'enforce_administrator_profile_tenant_match'
      and p.pronargs = 0
  ),
  'administrator profile tenant/profile consistency trigger function exists'
);
select ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'administrator_profiles'
      and t.tgname = 'enforce_administrator_profile_tenant_match'
      and not t.tgisinternal
  ),
  'administrator profile tenant/profile consistency trigger is attached'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'administrator_profiles'
      and policyname = 'administrator_profiles_insert'
      and coalesce(with_check, '') like '%profile_id%auth.uid%'
      and coalesce(with_check, '') like '%organization_id%current_org_id%'
  ),
  'administrator profile self-service insert binds profile and current organization'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'administrator_profiles'
      and policyname = 'administrator_profiles_update'
      and coalesce(qual, '') like '%profile_id%auth.uid%'
      and coalesce(qual, '') like '%organization_id%current_org_id%'
      and coalesce(with_check, '') like '%profile_id%auth.uid%'
      and coalesce(with_check, '') like '%organization_id%current_org_id%'
  ),
  'administrator profile self-service update binds profile and current organization'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'administrator_ce_entries'
      and policyname = 'administrator_ce_entries_insert'
      and coalesce(with_check, '') like '%ap.profile_id%auth.uid%'
      and coalesce(with_check, '') like '%ap.organization_id%current_org_id%'
  ),
  'administrator CE self-service insert follows a tenant-bound parent profile'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'administrator-documents write'
      and coalesce(with_check, '') like '%foldername(name)%[1]%current_org_id%'
      and coalesce(with_check, '') like '%foldername(name)%[2]%auth.uid%'
  ),
  'administrator document self-service writes bind both tenant and profile path segments'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'administrator-documents read'
      and coalesce(qual, '') like '%foldername(name)%[1]%current_org_id%'
      and coalesce(qual, '') like '%foldername(name)%[2]%auth.uid%'
  ),
  'administrator document self-service reads bind both tenant and profile path segments'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'administrator-documents delete'
      and coalesce(qual, '') like '%foldername(name)%[1]%current_org_id%'
      and coalesce(qual, '') like '%foldername(name)%[2]%auth.uid%'
  ),
  'administrator document self-service deletes bind both tenant and profile path segments'
);

select * from finish();
rollback;

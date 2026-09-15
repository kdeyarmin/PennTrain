begin;
select no_plan();

-- These Storage rows are test metadata only. SQL DELETE below exercises RLS;
-- application code always uses the Storage API for real object bytes.
select set_config('storage.allow_delete_query', 'true', true);
insert into public.organizations(id, name, slug, subscription_status) values
  ('d7000000-0000-4000-8000-000000000001', 'Deletion A', 'deletion-a', 'active'),
  ('d7000000-0000-4000-8000-000000000002', 'Deletion B', 'deletion-b', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('d7000000-0000-4000-8000-000000000011', 'd7000000-0000-4000-8000-000000000001', 'Deletion A', 'PCH'),
  ('d7000000-0000-4000-8000-000000000012', 'd7000000-0000-4000-8000-000000000002', 'Deletion B', 'PCH');
insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000'::uuid, ('d7000000-0000-4000-8000-00000000002' || i)::uuid,
  'authenticated', 'authenticated', 'deletion-' || i || '@test.local', 'x', now(), '{}', '{}', now(), now(),
  '', '', '', '', '', '', false, false from generate_series(1,3) i;
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
select ('d7000000-0000-4000-8000-00000000002' || i)::uuid,
  ('d7000000-0000-4000-8000-00000000000' || case when i = 2 then 2 else 1 end)::uuid,
  'deletion-' || i || '@test.local', 'Deletion', i::text,
  case when i = 3 then 'facility_manager' else 'org_admin' end, true
from generate_series(1,3) i
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
insert into public.residents(id, organization_id, facility_id, first_name, last_name, status, admission_date) values
  ('d7000000-0000-4000-8000-000000000031', 'd7000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000011', 'Rowan', 'A', 'active', current_date - 30),
  ('d7000000-0000-4000-8000-000000000032', 'd7000000-0000-4000-8000-000000000002', 'd7000000-0000-4000-8000-000000000012', 'Rowan', 'B', 'active', current_date - 30);
insert into public.resident_documents(id, organization_id, facility_id, resident_id, storage_path, file_name, file_type)
select ('d7000000-0000-4000-8000-00000000004' || i)::uuid,
  'd7000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000011', 'd7000000-0000-4000-8000-000000000031',
  'd7000000-0000-4000-8000-000000000001/d7000000-0000-4000-8000-000000000011/file-' || i || '.pdf',
  'file-' || i || '.pdf', 'application/pdf' from generate_series(1,3) i;
update public.residents set photo_document_id = 'd7000000-0000-4000-8000-000000000042'
  where id = 'd7000000-0000-4000-8000-000000000031';
-- A real FK reproduces the same non-deferrable RESTRICT constraint used by
-- portal releases, agreement versions and financial receipts without unrelated fixtures.
create temporary table deletion_reference(document_id uuid references public.resident_documents(id) on delete restrict);
insert into deletion_reference values ('d7000000-0000-4000-8000-000000000043');
insert into storage.objects(bucket_id, name)
  select storage_bucket, storage_path from public.resident_documents where resident_id = 'd7000000-0000-4000-8000-000000000031';
insert into storage.objects(bucket_id, name) values
  ('resident-documents', 'd7000000-0000-4000-8000-000000000001/d7000000-0000-4000-8000-000000000011/failed-upload.pdf'),
  ('org-branding', 'd7000000-0000-4000-8000-000000000001/logo.png');
select set_config('app.privileged_write', 'off', true);

create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
end;
$$;

select ok(not has_function_privilege('anon', 'public.begin_resident_document_deletion(uuid)', 'EXECUTE'), 'anonymous users cannot begin deletion');
select ok(not has_function_privilege('anon', 'public.list_pending_resident_document_deletions(uuid)', 'EXECUTE'), 'anonymous users cannot enumerate receipts');
select ok(not has_function_privilege('anon', 'public.confirm_resident_document_deletion(uuid)', 'EXECUTE'), 'anonymous users cannot confirm deletion');
select ok(not has_table_privilege('authenticated', 'app_private.resident_document_deletions', 'SELECT'), 'receipt table is private');
select ok(not (select prosecdef from pg_proc where oid = 'public.begin_resident_document_deletion(uuid)'::regprocedure), 'begin deletion preserves invoker RLS');

select pg_temp.act_as('d7000000-0000-4000-8000-000000000021');
select ok(public.has_effective_entitlement('d7000000-0000-4000-8000-000000000001', 'modules.carebase'),
  'active fixture organization has the CareBase entitlement required by document operations');
with removed as (delete from storage.objects where bucket_id = 'resident-documents'
  and name like '%/file-1.pdf' returning 1)
select is(count(*)::integer, 0, 'an old frontend cannot remove bytes while their document metadata remains') from removed;
select throws_ok($$select * from public.begin_resident_document_deletion('d7000000-0000-4000-8000-000000000042')$$,
  '23503', null, 'a referenced photo fails before any cleanup receipt can commit');
select throws_ok($$select * from public.begin_resident_document_deletion('d7000000-0000-4000-8000-000000000043')$$,
  '23503', null, 'a retained document with a RESTRICT foreign key cannot be deleted');
select is((select count(*)::integer from public.list_pending_resident_document_deletions('d7000000-0000-4000-8000-000000000031')), 0,
  'failed retention checks leave no pending receipt');
select is((select count(*)::integer from storage.objects where bucket_id = 'resident-documents' and name like '%/file-%.pdf'), 3,
  'all live and retained files remain present');

select is((select count(*)::integer from public.begin_resident_document_deletion('d7000000-0000-4000-8000-000000000041')), 1,
  'authorized unreferenced metadata deletion returns exactly one cleanup target');
select is((select count(*)::integer from public.resident_documents where id = 'd7000000-0000-4000-8000-000000000041'), 0,
  'deleted metadata is no longer selectable as clinical evidence');
select is((select count(*)::integer from public.list_pending_resident_document_deletions('d7000000-0000-4000-8000-000000000031')), 1,
  'cleanup remains discoverable after a disconnected browser reloads');
select is(public.confirm_resident_document_deletion('d7000000-0000-4000-8000-000000000041'), false,
  'a success-with-zero-rows Storage response cannot falsely complete cleanup');
select throws_ok($$select * from public.begin_resident_document_deletion('d7000000-0000-4000-8000-000000000041')$$,
  'P0002', null, 'zero-row metadata deletion is an explicit failure');

select pg_temp.act_as('d7000000-0000-4000-8000-000000000022');
select is((select count(*)::integer from public.list_pending_resident_document_deletions('d7000000-0000-4000-8000-000000000031')), 0,
  'another organization cannot enumerate filenames or storage paths');
select throws_ok($$select public.confirm_resident_document_deletion('d7000000-0000-4000-8000-000000000041')$$,
  '42501', null, 'another organization cannot complete a known receipt');
select throws_ok($$select * from public.begin_resident_document_deletion('d7000000-0000-4000-8000-000000000042')$$,
  'P0002', null, 'begin RPC cannot bypass ordinary cross-organization DELETE RLS');
select pg_temp.act_as('d7000000-0000-4000-8000-000000000023');
select is((select count(*)::integer from public.list_pending_resident_document_deletions('d7000000-0000-4000-8000-000000000031')), 0,
  'facility managers cannot read administrative deletion receipts');
select throws_ok($$select public.confirm_resident_document_deletion('d7000000-0000-4000-8000-000000000041')$$,
  '42501', null, 'facility manager cannot finish an org-admin-only deletion');

reset role;
insert into public.organization_entitlement_grants(id,organization_id,feature_key,decision,reason) values
  ('d7000000-0000-4000-8000-000000000061','d7000000-0000-4000-8000-000000000001','modules.carebase','deny','Deletion regression');
select pg_temp.act_as('d7000000-0000-4000-8000-000000000021');
select is((select count(*)::integer from public.list_pending_resident_document_deletions('d7000000-0000-4000-8000-000000000031')), 0,
  'the definer receipt list does not bypass a revoked module entitlement');
select throws_ok($$select public.confirm_resident_document_deletion('d7000000-0000-4000-8000-000000000041')$$,
  '42501', null, 'the confirmation RPC does not bypass a revoked module entitlement');
reset role;
delete from public.organization_entitlement_grants where id = 'd7000000-0000-4000-8000-000000000061';
insert into app_private.sms_mfa_accounts(profile_id) values ('d7000000-0000-4000-8000-000000000021');
select pg_temp.act_as('d7000000-0000-4000-8000-000000000021');
select is((select count(*)::integer from public.list_pending_resident_document_deletions('d7000000-0000-4000-8000-000000000031')), 0,
  'a caller missing required SMS verification cannot enumerate cleanup receipts');
select throws_ok($$select public.confirm_resident_document_deletion('d7000000-0000-4000-8000-000000000041')$$,
  '42501', null, 'required SMS verification is enforced by the definer confirmation RPC');
reset role;
delete from app_private.sms_mfa_accounts where profile_id = 'd7000000-0000-4000-8000-000000000021';

select pg_temp.act_as('d7000000-0000-4000-8000-000000000021');
with removed as (delete from storage.objects where bucket_id = 'resident-documents'
  and name like '%/failed-upload.pdf' returning 1)
select is(count(*)::integer, 1, 'rollback of an unregistered failed upload remains permitted') from removed;
with removed as (delete from storage.objects where bucket_id = 'org-branding'
  and name = 'd7000000-0000-4000-8000-000000000001/logo.png' returning 1)
select is(count(*)::integer, 1, 'unrelated bucket deletion retains its existing permissions') from removed;
with removed as (delete from storage.objects where bucket_id = 'resident-documents'
  and name like '%/file-1.pdf' returning 1)
select is(count(*)::integer, 1, 'Storage cleanup is permitted after metadata deletion commits its receipt') from removed;
select is(public.confirm_resident_document_deletion('d7000000-0000-4000-8000-000000000041'), true,
  'confirmed absent object completes the pending receipt');
select is(public.confirm_resident_document_deletion('d7000000-0000-4000-8000-000000000041'), true,
  'lost-response confirmation retry is idempotent');
select is((select count(*)::integer from public.list_pending_resident_document_deletions('d7000000-0000-4000-8000-000000000031')), 0,
  'completed deletions leave the retry list');
select throws_ok($$insert into storage.objects(bucket_id,name) values
  ('resident-documents','d7000000-0000-4000-8000-000000000001/d7000000-0000-4000-8000-000000000011/file-1.pdf')$$,
  '42501', null, 'completed deletion path cannot be reused by a new upload and erased by a late retry');
select throws_ok($$insert into public.resident_documents(id,organization_id,facility_id,resident_id,storage_path,file_name,file_type)
  values('d7000000-0000-4000-8000-000000000045','d7000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000011',
  'd7000000-0000-4000-8000-000000000031','d7000000-0000-4000-8000-000000000001/d7000000-0000-4000-8000-000000000011/file-1.pdf','file.pdf','application/pdf')$$,
  '23514', null, 'metadata cannot re-register a retired path');
select throws_ok($$insert into public.resident_documents(id,organization_id,facility_id,resident_id,storage_path,file_name,file_type)
  values('d7000000-0000-4000-8000-000000000041','d7000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000011',
  'd7000000-0000-4000-8000-000000000031','d7000000-0000-4000-8000-000000000001/d7000000-0000-4000-8000-000000000011/new-file.pdf','file.pdf','application/pdf')$$,
  '23514', null, 'a deleted document UUID cannot be reused and collide with the durable receipt');

reset role;
select is((select count(*)::integer from app_private.resident_document_deletions where document_id in
  ('d7000000-0000-4000-8000-000000000042','d7000000-0000-4000-8000-000000000043')), 0,
  'the transaction rolled back all receipts for failed retention checks');
select ok((select completed_at is not null from app_private.resident_document_deletions where document_id = 'd7000000-0000-4000-8000-000000000041'),
  'completion evidence and path reservation remain durable');
select ok((select storage_path is null and file_name is null and length(storage_path_sha256) = 64
  from app_private.resident_document_deletions where document_id = 'd7000000-0000-4000-8000-000000000041'),
  'completed receipts retain a hash reservation without filenames or raw storage paths');

select * from finish();
rollback;

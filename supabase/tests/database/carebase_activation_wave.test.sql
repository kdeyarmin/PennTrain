begin;
select plan(28);

select has_table('public', 'user_invitation_lifecycle', 'invitation lifecycle ledger exists');
select has_table('public', 'data_import_jobs', 'import jobs table exists');
select has_table('public', 'data_import_rows', 'import row ledger exists');
select has_table('public', 'data_import_events', 'import event ledger exists');
select has_table('public', 'employee_lifecycle_cases', 'employee lifecycle cases table exists');

select has_function('public', 'record_user_invitation_sent',
  array['uuid','text','text','text','text','uuid','uuid','text','uuid'],
  'trusted invitation receipt function exists');
select has_function('public', 'reconcile_user_invitation_lifecycle',
  'invitation reconciliation function exists');
select has_function('public', 'start_data_import_job',
  array['text','text','text','integer','text','uuid','uuid'],
  'resumable import starter exists');
select has_function('public', 'record_data_import_chunk',
  array['uuid','jsonb','text','text'],
  'row-level import receipt function exists');
select has_function('public', 'finalize_data_import_job', array['uuid'],
  'import finalization function exists');
select has_function('public', 'rollback_employee_import_job', array['uuid'],
  'safe employee import rollback function exists');
select has_function('public', 'create_employee_lifecycle_case',
  array['uuid','text','date','uuid','text'],
  'guided employee lifecycle case creator exists');
select has_function('public', 'apply_employee_lifecycle_case', array['uuid'],
  'guided employee lifecycle case apply function exists');

select is(
  (select count(*)::int from app_private.audit_entity_manifest
   where table_name in (
     'user_invitation_lifecycle','data_import_jobs','data_import_rows',
     'data_import_events','employee_lifecycle_cases'
   ) and contains_regulated_data),
  5,
  'all activation control-plane tables are classified as regulated audit entities'
);
select is(
  (select count(*)::int from app_private.audit_entity_manifest
   where table_name in ('data_import_jobs','data_import_rows','data_import_events')
     and audit_mode = 'row_trigger'),
  3,
  'every import control-plane table has row-level audit evidence'
);

-- Privilege contract for the import control plane:
-- service_role may read job/row/event state, but mutations stay on SECURITY DEFINER RPCs.
select ok(
  has_table_privilege('service_role', 'public.data_import_jobs', 'SELECT')
  and has_table_privilege('service_role', 'public.data_import_rows', 'SELECT')
  and has_table_privilege('service_role', 'public.data_import_events', 'SELECT'),
  'service_role can read import control-plane state'
);
select ok(
  not has_table_privilege('service_role', 'public.data_import_jobs', 'INSERT')
  and not has_table_privilege('service_role', 'public.data_import_jobs', 'UPDATE')
  and not has_table_privilege('service_role', 'public.data_import_jobs', 'DELETE')
  and not has_table_privilege('service_role', 'public.data_import_rows', 'INSERT')
  and not has_table_privilege('service_role', 'public.data_import_rows', 'UPDATE')
  and not has_table_privilege('service_role', 'public.data_import_rows', 'DELETE')
  and not has_table_privilege('service_role', 'public.data_import_events', 'INSERT')
  and not has_table_privilege('service_role', 'public.data_import_events', 'UPDATE')
  and not has_table_privilege('service_role', 'public.data_import_events', 'DELETE'),
  'service_role has no direct mutation grants on import control-plane tables'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('ca000000-0000-4000-8000-000000000001', 'Activation Org', 'activation-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000001', 'Activation Facility', 'PCH');
set local role service_role;

select lives_ok(
  $$select public.record_user_invitation_sent(
    'ca000000-0000-4000-8000-000000000201',
    'pending@example.com','Pending','User','employee',
    'ca000000-0000-4000-8000-000000000001',
    null,
    'https://cmcarebase.com/reset-password',
    null
  )$$,
  'service role records a scoped invitation receipt'
);
select is(
  (select status from public.user_invitation_lifecycle
   where invited_user_id = 'ca000000-0000-4000-8000-000000000201'),
  'sent',
  'new invitation receipts begin in sent status'
);
update public.user_invitation_lifecycle
set expires_at = now() - interval '1 minute'
where invited_user_id = 'ca000000-0000-4000-8000-000000000201';
select public.reconcile_user_invitation_lifecycle();
select is(
  (select status from public.user_invitation_lifecycle
   where invited_user_id = 'ca000000-0000-4000-8000-000000000201'),
  'expired',
  'unaccepted invitations become visibly expired'
);

select lives_ok(
  $$select public.start_data_import_job(
    'employees','activation-employees.csv',repeat('a',64),1,'create',
    'ca000000-0000-4000-8000-000000000011',
    'ca000000-0000-4000-8000-000000000001'
  )$$,
  'trusted import workers can start an explicitly scoped job'
);
select is(
  public.start_data_import_job(
    'employees','activation-employees.csv',repeat('a',64),1,'create',
    'ca000000-0000-4000-8000-000000000011',
    'ca000000-0000-4000-8000-000000000001'
  ),
  (select id from public.data_import_jobs
   where organization_id = 'ca000000-0000-4000-8000-000000000001'
     and original_file_sha256 = repeat('a',64)),
  'repeating the same unfinished file resumes the existing job'
);
insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, email, status
) values (
  'ca000000-0000-4000-8000-000000000101', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'Imported', 'Employee', 'Caregiver',
  'imported@example.com', 'active'
);

select public.record_data_import_chunk(
  (select id from public.data_import_jobs
   where organization_id = 'ca000000-0000-4000-8000-000000000001'
     and original_file_sha256 = repeat('a',64)),
  jsonb_build_array(jsonb_build_object(
    'rowNumber', 2,
    'sourceRow', jsonb_build_object('first_name','Imported','last_name','Employee'),
    'normalizedRow', jsonb_build_object('first_name','Imported','last_name','Employee'),
    'proposedAction', 'create',
    'status', 'applied',
    'targetTable', 'employees',
    'targetId', 'ca000000-0000-4000-8000-000000000101',
    'beforeSnapshot', null,
    'errors', '[]'::jsonb,
    'warnings', '[]'::jsonb
  )),
  'applied',
  null
);
select is(
  (select applied_rows from public.data_import_jobs
   where original_file_sha256 = repeat('a',64)),
  1,
  'applied import rows are durably counted on the job'
);
select lives_ok(
  $$select public.rollback_employee_import_job(
    (select id from public.data_import_jobs
     where original_file_sha256 = repeat('a',64))
  )$$,
  'an unfinalized employee create batch can be rolled back'
);
select ok(
  not exists (select 1 from public.employees where id = 'ca000000-0000-4000-8000-000000000101'),
  'rollback deletes only the untouched employee created by the batch'
);
select is(
  (select status from public.data_import_jobs where original_file_sha256 = repeat('a',64)),
  'rolled_back',
  'a fully reverted batch is marked rolled back'
);

select public.start_data_import_job(
  'employees','validated-employees.csv',repeat('b',64),1,'skip',
  'ca000000-0000-4000-8000-000000000011',
  'ca000000-0000-4000-8000-000000000001'
);
select public.record_data_import_chunk(
  (select id from public.data_import_jobs where original_file_sha256 = repeat('b',64)),
  jsonb_build_array(jsonb_build_object(
    'rowNumber', 2,
    'sourceRow', jsonb_build_object('first_name','Validated','last_name','Row'),
    'normalizedRow', jsonb_build_object('first_name','Validated','last_name','Row'),
    'proposedAction', 'skip',
    'status', 'valid',
    'targetTable', 'employees',
    'targetId', null,
    'beforeSnapshot', null,
    'errors', '[]'::jsonb,
    'warnings', '[]'::jsonb
  )),
  'ready',
  null
);
select lives_ok(
  $$select public.finalize_data_import_job(
    (select id from public.data_import_jobs where original_file_sha256 = repeat('b',64))
  )$$,
  'a fully validated error-free import can be finalized'
);
select is(
  (select status from public.data_import_jobs where original_file_sha256 = repeat('b',64)),
  'finalized',
  'finalization permanently closes the import job'
);

select * from finish();
rollback;

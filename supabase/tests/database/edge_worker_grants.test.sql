-- pgTAP coverage for 20260905090000: every table and function an Edge worker touches directly.
--
-- THE CLASS OF BUG THIS EXISTS FOR. A migration narrows a grant. Nothing fails: the app's own
-- paths go through RLS as an authenticated user and are unaffected, the pgTAP suite passes, the
-- deploy is green. Months later a worker that runs on a cron -- or, worse, a worker that has never
-- run in production yet -- reaches for a table the service role no longer holds, and fails at the
-- first write. That is exactly what happened here: `process-data-import-jobs` could not write its
-- own ledger, so every employees, residents and assessments import failed before touching a single
-- record, and nobody found out because production has never run an import.
--
-- Each assertion below names the FUNCTION that needs the privilege, so a future narrowing has to
-- decide about that function rather than about an anonymous grant. Adding a table access to a
-- worker means adding a line here; taking one away means deleting one.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(20);

-- ---------------------------------------------------------------------------------------
-- process-data-import-jobs
-- ---------------------------------------------------------------------------------------
-- Reads: the ledger, and the rows it checks scope against.
select ok(
  has_table_privilege('service_role', 'public.data_import_jobs', 'SELECT')
  and has_table_privilege('service_role', 'public.data_import_rows', 'SELECT')
  and has_table_privilege('service_role', 'public.facilities', 'SELECT')
  and has_table_privilege('service_role', 'public.profiles', 'SELECT')
  and has_table_privilege('service_role', 'public.employees', 'SELECT')
  and has_table_privilege('service_role', 'public.residents', 'SELECT')
  and has_table_privilege('service_role', 'public.resident_assessment_forms', 'SELECT'),
  'process-data-import-jobs can read the ledger and the rows it scope-checks against'
);

-- The read that was missing: the worker will not let a rescued row reach a facility the job's
-- creating manager has since lost, and it needs to see the assignments to know.
select ok(
  has_table_privilege('service_role', 'public.facility_assignments', 'SELECT'),
  'process-data-import-jobs can read facility_assignments to enforce the creator''s facility scope'
);

-- Writes: all of them, through functions. The contract carebase_activation_wave.test.sql states
-- in words -- "mutations stay on SECURITY DEFINER RPCs" -- is only real if the RPCs exist and the
-- worker can execute them.
select ok(
  has_function_privilege('service_role', 'public.import_mark_row(uuid,text,text,uuid,text[])', 'EXECUTE'),
  'process-data-import-jobs records a row outcome through import_mark_row'
);
select ok(
  has_function_privilege('service_role', 'public.import_recount_job(uuid,boolean)', 'EXECUTE'),
  'and persists the job counters through import_recount_job'
);
select ok(
  has_function_privilege('service_role', 'public.import_apply_employee(uuid,uuid,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.import_apply_resident(uuid,uuid,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.import_apply_resident_assessment(uuid,uuid,jsonb)', 'EXECUTE'),
  'and applies employees, residents and assessments through their own RPCs'
);
select ok(
  has_function_privilege('service_role', 'public.import_apply_resident_contact(uuid,uuid,jsonb,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.import_apply_employee_credential(uuid,uuid,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.import_apply_training_record(uuid,uuid,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.import_apply_incident(uuid,uuid,text,timestamptz,uuid,text,text,text,text,text)', 'EXECUTE'),
  'and every other domain''s apply RPC, including contacts -- which was granted to authenticated only'
);
select ok(
  has_function_privilege('service_role', 'public.claim_data_import_jobs(integer,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.release_data_import_job_claim(uuid,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finalize_data_import_job(uuid)', 'EXECUTE'),
  'and claims, releases and finalizes a job through the control plane'
);

-- The other half of the contract: the RPCs exist so the direct writes do NOT.
select ok(
  not has_any_column_privilege('service_role', 'public.data_import_jobs', 'UPDATE')
  and not has_any_column_privilege('service_role', 'public.data_import_rows', 'UPDATE')
  and not has_any_column_privilege('service_role', 'public.residents', 'UPDATE')
  and not has_any_column_privilege('service_role', 'public.residents', 'INSERT')
  and not has_any_column_privilege('service_role', 'public.resident_assessment_forms', 'UPDATE')
  and not has_any_column_privilege('service_role', 'public.resident_assessment_forms', 'INSERT'),
  'and still cannot write any of those tables directly -- the RPCs are the only door'
);

-- ---------------------------------------------------------------------------------------
-- The four smaller functions, one privilege each.
-- ---------------------------------------------------------------------------------------
select ok(
  has_table_privilege('service_role', 'public.employee_credential_documents', 'SELECT'),
  'process-credential-renewals can read the document it is about to OCR'
);
select ok(
  has_table_privilege('service_role', 'public.violation_documents', 'UPDATE'),
  'generate-poc-document can rewrite the stored plan when it is amended'
);
select ok(
  has_column_privilege('service_role', 'public.employees', 'profile_id', 'UPDATE'),
  'invite-user can detach the employee it linked when the invitation email fails'
);
select ok(
  has_table_privilege('service_role', 'public.packages', 'SELECT'),
  'create-billing-session can confirm the plan it is selling is still sold'
);

-- invite-user's compensation touches ONE column. A column grant rather than a table grant is the
-- difference between "detach the employee" and "rewrite the employee".
select ok(
  not has_column_privilege('service_role', 'public.employees', 'first_name', 'UPDATE')
  and not has_column_privilege('service_role', 'public.employees', 'status', 'UPDATE')
  and not has_column_privilege('service_role', 'public.employees', 'facility_id', 'UPDATE'),
  'and cannot rewrite anything else about that employee -- the grant is on profile_id alone'
);

-- ---------------------------------------------------------------------------------------
-- The line that has not moved.
-- ---------------------------------------------------------------------------------------
select ok(
  not has_table_privilege('anon', 'public.data_import_rows', 'SELECT')
  and not has_function_privilege('anon', 'public.import_mark_row(uuid,text,text,uuid,text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.import_mark_row(uuid,text,text,uuid,text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.import_apply_employee(uuid,uuid,jsonb)', 'EXECUTE'),
  'none of the worker''s write RPCs is reachable from a browser -- they take an already-validated payload'
);

-- ---------------------------------------------------------------------------------------
-- The ledger RPCs, actually run.
-- ---------------------------------------------------------------------------------------
-- Not just "the grant exists". `db lint` caught import_mark_row assigning a text[] to the jsonb
-- `errors` column, which no grant assertion could see and which would have failed on the first
-- row of the first import. Running them is what closes that gap.
insert into public.organizations(id, name, slug) values
  ('9e000000-0000-4000-8000-000000000001', 'Ledger Org', 'ledger-rpc-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('9e000000-0000-4000-8000-000000000011', '9e000000-0000-4000-8000-000000000001', 'Ledger Facility', 'PCH');

select set_config('app.privileged_write', 'on', true);
insert into public.data_import_jobs(
  id, organization_id, facility_id, domain, original_file_name, original_file_sha256,
  total_rows, status
) values (
  '9e000000-0000-4000-8000-000000000021', '9e000000-0000-4000-8000-000000000001',
  '9e000000-0000-4000-8000-000000000011', 'employees', 'staff.csv', repeat('a', 64), 3, 'applying'
);
insert into public.data_import_rows(id, organization_id, job_id, row_number, normalized_row, status) values
  ('9e000000-0000-4000-8000-000000000031', '9e000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000021', 2, '{}'::jsonb, 'valid'),
  ('9e000000-0000-4000-8000-000000000032', '9e000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000021', 3, '{}'::jsonb, 'valid'),
  ('9e000000-0000-4000-8000-000000000033', '9e000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000021', 4, '{}'::jsonb, 'valid');
select set_config('app.privileged_write', 'off', true);

select lives_ok(
  $$ select public.import_mark_row(
       '9e000000-0000-4000-8000-000000000031', 'failed', 'employees', null,
       array['Row 2: hire_date is not a date']) $$,
  'a failed row records its message -- into a jsonb column, from a text[] parameter'
);

select is(
  (select errors from public.data_import_rows where id = '9e000000-0000-4000-8000-000000000031'),
  '["Row 2: hire_date is not a date"]'::jsonb,
  'and the message is readable back'
);

select is(
  (select applied_at from public.data_import_rows where id = '9e000000-0000-4000-8000-000000000031'),
  null,
  'a failure keeps no applied_at -- the row did not land anywhere'
);

select lives_ok(
  $$ select public.import_mark_row(
       '9e000000-0000-4000-8000-000000000032', 'applied', 'employees',
       '9e000000-0000-4000-8000-000000000099', array[]::text[]) $$,
  'an applied row records where it landed'
);

select is(
  (select public.import_recount_job('9e000000-0000-4000-8000-000000000021', false)),
  jsonb_build_object('appliedRows', 1, 'skippedRows', 0, 'validRows', 1, 'errorRows', 1),
  'and the recount counts what is actually in the ledger'
);

select is(
  (select array[applied_rows, error_rows, valid_rows] from public.data_import_jobs
   where id = '9e000000-0000-4000-8000-000000000021'),
  array[1, 1, 1],
  'persisting the counters onto the job, which is the write the worker could not make at all'
);

select * from finish();
rollback;

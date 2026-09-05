-- pgTAP coverage for 20260905340000: a malware verdict nobody reached (I23).
--
-- process-credential-renewals recorded scan_status = 'clean' on every submission, with evidence
-- naming a mime_size_gate that lived INSIDE the extraction branch -- so on a deployment with no
-- OCR provider (which is every deployment today) nothing opened the file and the record still said
-- clean. The storage bucket has no allowed_mime_types and no file_size_limit either, so the claim
-- was not true anywhere. And CredentialRenewalInbox gated its Review button on that same label, so
-- telling the truth without also widening the gate would have made every submission unreviewable.
-- Run with: supabase test db.

begin;
select plan(9);

select is(
  (select count(*)::int from pg_constraint
   where conrelid = 'public.credential_renewal_submissions'::regclass
     and conname = 'credential_renewal_submissions_scan_status_check'
     and pg_get_constraintdef(oid) like '%not_scanned%'),
  1,
  'the scan vocabulary can say "nothing looked at this"'
);
select matches(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.credential_renewal_submissions'::regclass
     and conname = 'credential_renewal_submissions_scan_status_check'),
  'clean',
  'and still carries clean and malicious, reserved for a scanner that does not exist yet'
);

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('1b000000-0000-4000-8000-000000000001', 'Renewal Scan Org', 'renewal-scan-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('1b000000-0000-4000-8000-000000000011', '1b000000-0000-4000-8000-000000000001',
   'Renewal Scan Facility', 'PCH');
insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, status
) values (
  '1b000000-0000-4000-8000-000000000031', '1b000000-0000-4000-8000-000000000001',
  '1b000000-0000-4000-8000-000000000011', 'Renewing', 'Employee', 'Nurse', 'active'
);
insert into public.employee_credentials(
  id, organization_id, facility_id, employee_id, credential_type, status
) values (
  '1b000000-0000-4000-8000-000000000041', '1b000000-0000-4000-8000-000000000001',
  '1b000000-0000-4000-8000-000000000011', '1b000000-0000-4000-8000-000000000031',
  'rn_license', 'missing'
);

create or replace function pg_temp.new_submission(p_id uuid, p_doc uuid) returns void language plpgsql as $$
begin
  insert into public.employee_credential_documents(
    id, organization_id, facility_id, employee_id, credential_id,
    storage_bucket, storage_path, file_name, file_type
  ) values (
    p_doc, '1b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000011',
    '1b000000-0000-4000-8000-000000000031', '1b000000-0000-4000-8000-000000000041',
    'credential-documents', 'renewals/' || p_doc::text || '.pdf', 'license.pdf', 'application/pdf'
  );
  insert into public.credential_renewal_submissions(
    id, organization_id, facility_id, employee_id, credential_id, credential_document_id,
    credential_type, status, scan_status
  ) values (
    p_id, '1b000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-000000000011',
    '1b000000-0000-4000-8000-000000000031', '1b000000-0000-4000-8000-000000000041', p_doc,
    'rn_license', 'uploaded', 'pending'
  );
end $$;

-- The recorder is service-role only, which is the point: only the trusted worker writes a scan
-- verdict. The phase3 suite reaches it the same way.
create or replace function pg_temp.act_as_processor() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'service_role',
      'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role service_role;
end $$;

select pg_temp.new_submission('1b000000-0000-4000-8000-000000000051', '1b000000-0000-4000-8000-000000000061');
select pg_temp.new_submission('1b000000-0000-4000-8000-000000000052', '1b000000-0000-4000-8000-000000000062');

------------------------------------------------------------------------------------------------
-- not_scanned is a reviewable state, because the human review is the scan
------------------------------------------------------------------------------------------------
select pg_temp.act_as_processor();
select lives_ok(
  $$ select public.record_credential_renewal_extraction(
       '1b000000-0000-4000-8000-000000000051', 'not_scanned', 'carebase-renewal-worker',
       '{"method":"mime_size_gate","malware_scanner":"none configured","byte_length":42}'::jsonb,
       'none', 'none',
       '{"issuingAuthority":"State Board"}'::jsonb, '{"overall":0}'::jsonb
     ) $$,
  'the worker can record that it gated the file and scanned nothing'
);
reset role;
select is(
  (select scan_status from public.credential_renewal_submissions
   where id = '1b000000-0000-4000-8000-000000000051'),
  'not_scanned',
  'and the record says so, rather than claiming clean'
);
select is(
  (select status from public.credential_renewal_submissions
   where id = '1b000000-0000-4000-8000-000000000051'),
  'needs_review',
  'the submission reaches a human -- quarantining it would make every submission unreviewable'
);
select is(
  (select extracted_fields->>'issuingAuthority' from public.credential_renewal_submissions
   where id = '1b000000-0000-4000-8000-000000000051'),
  'State Board',
  'keeping any extraction suggestions for that human to confirm'
);

------------------------------------------------------------------------------------------------
-- A file the gate refused is quarantined, and says why
------------------------------------------------------------------------------------------------
select pg_temp.act_as_processor();
select lives_ok(
  $$ select public.record_credential_renewal_extraction(
       '1b000000-0000-4000-8000-000000000052', 'failed', 'carebase-renewal-worker',
       '{"method":"mime_size_gate","gate_failure":"The uploaded file is empty."}'::jsonb,
       'none', 'none', '{"notes":"The uploaded file is empty."}'::jsonb, '{"overall":0}'::jsonb
     ) $$,
  'a file the type-and-size gate refuses is recorded as failed'
);
reset role;
select is(
  (select status from public.credential_renewal_submissions
   where id = '1b000000-0000-4000-8000-000000000052'),
  'quarantined',
  'and quarantined rather than queued for review'
);
select is(
  (select extracted_fields from public.credential_renewal_submissions
   where id = '1b000000-0000-4000-8000-000000000052'),
  '{}'::jsonb,
  'with no extraction carried forward from a file nothing could read'
);

select * from finish();
rollback;

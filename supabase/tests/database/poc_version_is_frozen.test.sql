-- pgTAP coverage for 20260905170000: an immutable version with nothing frozen in it (I18).
--
-- plan_of_correction_versions has carried pdf_storage_bucket, pdf_storage_path and pdf_sha256
-- since 20260801021000 and nothing ever wrote one of them; the rows themselves could be rewritten
-- by anything holding the service role. Alongside it: a DHS deadline column that was nullable, so
-- a violation recorded without one was invisible to every escalation that reads it; and a
-- recurring policy campaign that still opened a cycle with nobody on it, one targeting mode
-- further along than 20260805120000 reached. Run with: supabase test db.

begin;
select plan(16);

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('b7000000-0000-4000-8000-000000000001', 'Frozen Org', 'frozen-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('b7000000-0000-4000-8000-000000000011', 'b7000000-0000-4000-8000-000000000001', 'Frozen PCH', 'PCH');

------------------------------------------------------------------------------------------------
-- 1-3. The deadline is not optional
------------------------------------------------------------------------------------------------
select col_not_null(
  'public', 'dhs_violations', 'poc_due_date',
  'poc_due_date is NOT NULL -- every escalation over it is written "is not null", so a null one was a deadline nothing watched'
);
select throws_ok(
  $$insert into public.dhs_violations(
      organization_id, facility_id, inspection_date, description, severity, status
    ) values (
      'b7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000011',
      current_date - 10, 'A citation with no deadline', 'moderate', 'open'
    )$$,
  '23502',
  null,
  'and a violation cannot be recorded without one'
);

insert into public.dhs_violations(
  id, organization_id, facility_id, citation_ref, inspection_date, description, severity, status, poc_due_date
) values (
  'b7000000-0000-4000-8000-000000000021', 'b7000000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000011', '2600.132(a)', current_date - 10,
  'Fire drills not held in every month', 'high', 'open', current_date + 20
);
insert into public.corrective_actions(
  id, organization_id, facility_id, violation_id, description, due_date, status
) values (
  'b7000000-0000-4000-8000-000000000031', 'b7000000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000011', 'b7000000-0000-4000-8000-000000000021',
  'Post the drill calendar and assign an owner per month', current_date + 10, 'open'
);
select lives_ok(
  $$select public.submit_plan_of_correction('b7000000-0000-4000-8000-000000000021')$$,
  'the plan of correction submits'
);

------------------------------------------------------------------------------------------------
-- 4-6. The digest exists the instant the version does, and it is the digest of the record
------------------------------------------------------------------------------------------------
select isnt(
  (select snapshot_sha256 from public.plan_of_correction_versions
   where violation_id = 'b7000000-0000-4000-8000-000000000021'),
  null,
  'the frozen version carries a digest -- it does not wait on a PDF render that may never happen'
);
select is(
  (select snapshot_sha256 from public.plan_of_correction_versions
   where violation_id = 'b7000000-0000-4000-8000-000000000021'),
  (select encode(sha256(convert_to(snapshot::text, 'UTF8')), 'hex')
   from public.plan_of_correction_versions
   where violation_id = 'b7000000-0000-4000-8000-000000000021'),
  'and it is the digest of the snapshot itself, recomputable by anyone holding the row'
);
select is(
  (select pdf_sha256 from public.plan_of_correction_versions
   where violation_id = 'b7000000-0000-4000-8000-000000000021'),
  null,
  'the document digest is separate and still empty -- the render has not run'
);

------------------------------------------------------------------------------------------------
-- 7-10. Frozen means frozen
------------------------------------------------------------------------------------------------
select throws_ok(
  $$update public.plan_of_correction_versions
    set snapshot = '{"violation": {"description": "something else"}}'::jsonb
    where violation_id = 'b7000000-0000-4000-8000-000000000021'$$,
  '55000',
  null,
  'the snapshot of a submitted plan cannot be rewritten'
);
select throws_ok(
  $$update public.plan_of_correction_versions set amendment_reason = 'retconned'
    where violation_id = 'b7000000-0000-4000-8000-000000000021'$$,
  '55000',
  null,
  'nor its amendment reason'
);
select throws_ok(
  $$delete from public.plan_of_correction_versions
    where violation_id = 'b7000000-0000-4000-8000-000000000021'$$,
  '55000',
  null,
  'and it cannot be deleted -- it is what the facility filed with DHS'
);

select lives_ok(
  $$select public.record_plan_of_correction_version_pdf(
      (select id from public.plan_of_correction_versions
       where violation_id = 'b7000000-0000-4000-8000-000000000021'),
      'violation-documents',
      'b7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000011/b7000000-0000-4000-8000-000000000021/v1.pdf',
      repeat('f', 64))$$,
  'the render stamps the version''s document path and digest'
);
select is(
  (select pdf_storage_path from public.plan_of_correction_versions
   where violation_id = 'b7000000-0000-4000-8000-000000000021'),
  'b7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000011/b7000000-0000-4000-8000-000000000021/v1.pdf',
  'at <organization>/<facility>/<violation>/v<N>.pdf, one file per version rather than one per violation'
);
-- A second render of the same version is a duplicate, not an amendment. The RPC returns the row it
-- already has; a direct write of a different digest is refused outright.
select is(
  (select (public.record_plan_of_correction_version_pdf(
      (select id from public.plan_of_correction_versions
       where violation_id = 'b7000000-0000-4000-8000-000000000021'),
      'violation-documents', 'somewhere/else.pdf', repeat('a', 64))).pdf_sha256),
  repeat('f', 64),
  'a second render returns the stamp already on file rather than replacing it'
);
select throws_ok(
  $$update public.plan_of_correction_versions set pdf_sha256 = repeat('b', 64)
    where violation_id = 'b7000000-0000-4000-8000-000000000021'$$,
  '55000',
  null,
  'and the digest of a rendered document cannot be restated'
);

-- Deleting the violation still works: the versions go with it, because blocking the cascade would
-- make a violation undeletable rather than making its versions immutable.
select lives_ok(
  $$delete from public.dhs_violations where id = 'b7000000-0000-4000-8000-000000000021'$$,
  'deleting the violation cascades to its versions without tripping the guard'
);

------------------------------------------------------------------------------------------------
-- 15-16. An empty cycle is not a cycle, part two
------------------------------------------------------------------------------------------------
insert into public.policy_documents (id, organization_id, title)
values ('b7000000-0000-4000-8000-000000000041', 'b7000000-0000-4000-8000-000000000001', 'Elopement Response');
insert into public.policy_document_versions (
  id, policy_document_id, organization_id, version_number, storage_path,
  file_name, file_type, content_hash, status, published_at
) values (
  'b7000000-0000-4000-8000-000000000051', 'b7000000-0000-4000-8000-000000000041',
  'b7000000-0000-4000-8000-000000000001', 1, 'frozen/v1.pdf', 'v1.pdf', 'application/pdf',
  repeat('c', 64), 'published', now()
);
update public.policy_documents set current_version_id = 'b7000000-0000-4000-8000-000000000051'
where id = 'b7000000-0000-4000-8000-000000000041';

-- Declarative, recurring, due to spawn -- and targeting a job title nobody at this organization
-- holds. That is the live shape: a rule that matched when it was written and stopped matching.
insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name, due_date,
  recurrence_months, next_occurrence_on, targeting_mode, target_job_title_pattern
) values (
  'b7000000-0000-4000-8000-000000000061', 'b7000000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000041', 'b7000000-0000-4000-8000-000000000051',
  'Annual elopement review', current_date - 340,
  12, current_date + 20, 'declarative', '%Chief Astronaut%'
);

select is(
  public.spawn_due_policy_campaign_cycles(),
  0,
  'a cycle that would enrol nobody is not opened, and is not counted as spawned'
);
select ok(
  not exists (
    select 1 from public.policy_attestation_campaigns
    where recurrence_parent_id = 'b7000000-0000-4000-8000-000000000061'
  )
  and (select next_occurrence_on from public.policy_attestation_campaigns
       where id = 'b7000000-0000-4000-8000-000000000061') = current_date + 20
  and (select last_spawn_skipped_reason from public.policy_attestation_campaigns
       where id = 'b7000000-0000-4000-8000-000000000061') like '%targeting rule matched no active employee%',
  'no child cycle exists, the recurrence date has not moved so tomorrow tries again, and the campaign says why'
);

select * from finish();
rollback;

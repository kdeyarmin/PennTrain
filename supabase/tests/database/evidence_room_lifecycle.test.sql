begin;
select plan(39);

-- Evidence room lifecycle: staff create/promote/publish/withdraw/revoke over the Phase 5
-- evidence schema, binder-export promotion under the checksum contract, and the anon
-- token-scoped guest surface (terms acceptance + room view), all fail-closed.

insert into public.organizations(id,name,slug,subscription_status) values
  ('1e000000-0000-4000-8000-000000000001','Evidence Org M','evidence-org-m','active'),
  ('1e000000-0000-4000-8000-000000000002','Evidence Org N','evidence-org-n','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('1e000000-0000-4000-8000-000000000011','1e000000-0000-4000-8000-000000000001','Evidence Facility M1','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('1e000000-0000-4000-8000-000000000021'::uuid,'ev-admin-m@test.local'),
  ('1e000000-0000-4000-8000-000000000022'::uuid,'ev-manager-m@test.local'),
  ('1e000000-0000-4000-8000-000000000023'::uuid,'ev-employee-m@test.local'),
  ('1e000000-0000-4000-8000-000000000024'::uuid,'ev-admin-n@test.local')
) as v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('1e000000-0000-4000-8000-000000000021','1e000000-0000-4000-8000-000000000001','ev-admin-m@test.local','Evidence','Admin M','org_admin',true),
  ('1e000000-0000-4000-8000-000000000022','1e000000-0000-4000-8000-000000000001','ev-manager-m@test.local','Evidence','Manager M','facility_manager',true),
  ('1e000000-0000-4000-8000-000000000023','1e000000-0000-4000-8000-000000000001','ev-employee-m@test.local','Evidence','Employee M','employee',true),
  ('1e000000-0000-4000-8000-000000000024','1e000000-0000-4000-8000-000000000002','ev-admin-n@test.local','Evidence','Admin N','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.facility_assignments(profile_id,facility_id) values
  ('1e000000-0000-4000-8000-000000000022','1e000000-0000-4000-8000-000000000011');

-- Completed binder exports to promote: one correctly facility-scoped with a checksum,
-- one org-wide (scope leak guard), one predating checksum recording, one second
-- facility-scoped export, and one still-pending job for the worker finish test.
insert into public.binder_export_jobs(id,organization_id,requested_by,facility_ids,status,completed_at,storage_bucket,storage_path,content_sha256,byte_size) values
  ('1e000000-0000-4000-8000-000000000031','1e000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000021',array['1e000000-0000-4000-8000-000000000011'::uuid],'succeeded',now(),'binder-exports','1e000000-0000-4000-8000-000000000001/job31.pdf',repeat('a',64),12345),
  ('1e000000-0000-4000-8000-000000000032','1e000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000021','{}','succeeded',now(),'binder-exports','1e000000-0000-4000-8000-000000000001/job32.pdf',repeat('b',64),12345),
  ('1e000000-0000-4000-8000-000000000033','1e000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000021',array['1e000000-0000-4000-8000-000000000011'::uuid],'succeeded',now(),'binder-exports','1e000000-0000-4000-8000-000000000001/job33.pdf',null,null),
  ('1e000000-0000-4000-8000-000000000034','1e000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000021',array['1e000000-0000-4000-8000-000000000011'::uuid],'succeeded',now(),'binder-exports','1e000000-0000-4000-8000-000000000001/job34.pdf',repeat('d',64),54321);
insert into public.binder_export_jobs(id,organization_id,requested_by,facility_ids) values
  ('1e000000-0000-4000-8000-000000000035','1e000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000021',array['1e000000-0000-4000-8000-000000000011'::uuid]);

create or replace function pg_temp.act_as(p_id uuid,p_role text default 'authenticated') returns void language plpgsql as $$begin reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',p_role,'aal','aal2','iat',extract(epoch from now())::bigint)::text,true);if p_role='service_role' then set local role service_role;else set local role authenticated;end if;end$$;
create temp table ev_ids(key text primary key, id uuid, value text) on commit drop;
grant all on ev_ids to authenticated, anon, service_role;

-- Anon surface is exactly the two token-scoped guest functions.
select ok(has_function_privilege('anon','public.get_evidence_guest_room(text,text)','EXECUTE'),
  'guests can call the room view without a session');
select ok(has_function_privilege('anon','public.accept_evidence_guest_terms(text,text)','EXECUTE'),
  'guests can accept terms without a session');
select ok(not has_function_privilege('anon','public.add_binder_export_to_evidence_collection(uuid,uuid,text)','EXECUTE'),
  'anonymous callers cannot manage collections');
-- The evidence-guest-download edge function authorizes through a service-role client before
-- signing the object, so service_role must be able to execute the authorization RPC.
select ok(has_function_privilege('service_role','public.authorize_evidence_guest_artifact(text,uuid,text,text)','EXECUTE'),
  'the trusted download backend can authorize a guest artifact');

-- Worker finish now records the PDF checksum alongside the storage location.
insert into ev_ids(key,id)
select 'run', run_id from public.claim_binder_export_jobs(gen_random_uuid(),'1e000000-0000-4000-8000-000000000035',1);
select is(
  public.finish_binder_export_job(
    p_job_id => '1e000000-0000-4000-8000-000000000035',
    p_run_id => (select id from ev_ids where key='run'),
    p_bucket => 'binder-exports',
    p_path => '1e000000-0000-4000-8000-000000000001/job35.pdf',
    p_content_sha256 => repeat('c',64),
    p_byte_size => 4321),
  true, 'the finish RPC accepts the checksum parameters');
select results_eq(
  $$ select status, content_sha256, byte_size from public.binder_export_jobs
     where id='1e000000-0000-4000-8000-000000000035' $$,
  $$ values ('succeeded'::text, repeat('c',64), 4321::bigint) $$,
  'a finished export records its content checksum and size');

-- Collection creation is manager-gated and validated.
select pg_temp.act_as('1e000000-0000-4000-8000-000000000023');
select throws_ok(
  $$ select public.create_evidence_collection('1e000000-0000-4000-8000-000000000011','Survey room','DHS survey') $$,
  '42501', null, 'employees cannot create evidence collections');

select pg_temp.act_as('1e000000-0000-4000-8000-000000000022');
insert into ev_ids(key,id)
select 'col', (public.create_evidence_collection(
  '1e000000-0000-4000-8000-000000000011','2026 DHS Survey','Annual state survey evidence')).id;
select results_eq(
  $$ select name, status, terms_version from public.evidence_collections
     where id=(select id from ev_ids where key='col') $$,
  $$ values ('2026 DHS Survey'::text, 'draft'::text, 'v1'::text) $$,
  'a facility manager creates a draft collection for an assigned facility');
select throws_ok(
  $$ select public.create_evidence_collection('1e000000-0000-4000-8000-000000000011','ab','DHS survey') $$,
  '22023', null, 'collection names are validated');

-- Publish requires content; promotion enforces scope and checksum.
select throws_ok(
  $$ select public.set_evidence_collection_status((select id from ev_ids where key='col'),'published') $$,
  '22023', null, 'an empty collection cannot be published');
select throws_ok(
  $$ select public.add_binder_export_to_evidence_collection(
       (select id from ev_ids where key='col'),'1e000000-0000-4000-8000-000000000032','Org-wide binder') $$,
  '22023', null, 'an org-wide export cannot enter a facility-scoped collection');
select throws_ok(
  $$ select public.add_binder_export_to_evidence_collection(
       (select id from ev_ids where key='col'),'1e000000-0000-4000-8000-000000000033','Unchecksummed binder') $$,
  '22023', null, 'an export without a recorded checksum cannot be promoted');

insert into ev_ids(key,id)
select 'art1', (public.add_binder_export_to_evidence_collection(
  (select id from ev_ids where key='col'),'1e000000-0000-4000-8000-000000000031','July compliance binder')).id;
select results_eq(
  $$ select a.display_name, sa.content_sha256, sa.storage_bucket, sa.artifact_type
     from public.evidence_collection_artifacts a
     join public.report_snapshot_artifacts sa on sa.id = a.snapshot_artifact_id
     where a.id=(select id from ev_ids where key='art1') $$,
  $$ values ('July compliance binder'::text, repeat('a',64), 'binder-exports'::text, 'binder'::text) $$,
  'promotion snapshots the export under the checksum contract');
select is(
  (public.add_binder_export_to_evidence_collection(
    (select id from ev_ids where key='col'),'1e000000-0000-4000-8000-000000000031','July compliance binder')).id,
  (select id from ev_ids where key='art1'),
  'promoting the same export twice is idempotent');
insert into ev_ids(key,id)
select 'art2', (public.add_binder_export_to_evidence_collection(
  (select id from ev_ids where key='col'),'1e000000-0000-4000-8000-000000000034','June compliance binder')).id;

select lives_ok(
  $$ select public.set_evidence_collection_status((select id from ev_ids where key='col'),'published') $$,
  'a collection with artifacts publishes');
select results_eq(
  $$ select status, (published_at is not null) from public.evidence_collections
     where id=(select id from ev_ids where key='col') $$,
  $$ values ('published'::text, true) $$,
  'publishing stamps the published timestamp');

-- Guest grant + RLS visibility for the issuing facility manager.
insert into ev_ids(key,id,value)
select 'grant1', (x->>'grantId')::uuid, x->>'token'
from public.issue_evidence_guest_grant(
  (select id from ev_ids where key='col'), 'State surveyor', null,
  array[(select id from ev_ids where key='art1'),(select id from ev_ids where key='art2')],
  now()+interval '7 days', false) x;
select results_eq(
  $$ select count(*)::int from public.evidence_guest_grants
     where id=(select id from ev_ids where key='grant1') $$,
  array[1],
  'the issuing facility manager can see the grant they minted');

-- Guest flow: terms gate, then the room lists only allowed active artifacts.
reset role; set local role anon;
select results_eq(
  $$ select (r->>'authorized')::boolean, (r->>'needsTerms')::boolean
     from (select public.get_evidence_guest_room((select value from ev_ids where key='grant1'))) t(r) $$,
  $$ values (false, true) $$,
  'the room withholds artifacts until terms are accepted');
select is(
  (public.accept_evidence_guest_terms((select value from ev_ids where key='grant1'))->>'accepted')::boolean,
  true, 'the guest can accept terms with only the token');
reset role;
select results_eq(
  $$ select count(*)::int from public.evidence_guest_access_events
     where guest_grant_id=(select id from ev_ids where key='grant1') and event_type='terms_accepted' $$,
  array[1],
  'terms acceptance is logged');
reset role; set local role anon;
select results_eq(
  $$ select (r->>'authorized')::boolean, jsonb_array_length(r->'artifacts')
     from (select public.get_evidence_guest_room((select value from ev_ids where key='grant1'))) t(r) $$,
  $$ values (true, 2) $$,
  'an accepted guest sees the allowed artifacts');
select is(
  (public.authorize_evidence_guest_artifact(
    (select value from ev_ids where key='grant1'),
    (select id from ev_ids where key='art1'),'download',null)->>'authorized')::boolean,
  true, 'an accepted guest can authorize a download');
select is(
  public.get_evidence_guest_room('not-a-real-token')->>'reason',
  'access_denied', 'an unknown token fails closed');
reset role;

-- Withdrawal removes the artifact from the room and cannot be undone by re-adding.
select pg_temp.act_as('1e000000-0000-4000-8000-000000000023');
select throws_ok(
  $$ select public.revoke_evidence_guest_grant((select id from ev_ids where key='grant1'),'not allowed') $$,
  '42501', null, 'employees cannot revoke guest grants');
select pg_temp.act_as('1e000000-0000-4000-8000-000000000022');
select lives_ok(
  $$ select public.withdraw_evidence_collection_artifact(
       (select id from ev_ids where key='art2'),'Superseded by the July export') $$,
  'a manager can withdraw an artifact with a reason');
reset role; set local role anon;
select results_eq(
  $$ select jsonb_array_length(r->'artifacts')
     from (select public.get_evidence_guest_room((select value from ev_ids where key='grant1'))) t(r) $$,
  array[1],
  'withdrawn artifacts leave the guest room immediately');
select is(
  (public.authorize_evidence_guest_artifact(
    (select value from ev_ids where key='grant1'),
    (select id from ev_ids where key='art2'),'view',null)->>'authorized')::boolean,
  false, 'a withdrawn artifact fails closed for guests');
reset role;
select results_eq(
  $$ select count(*)::int from public.evidence_guest_access_events
     where artifact_id=(select id from ev_ids where key='art2') and event_type='withdrawn' $$,
  array[1],
  'artifact withdrawal is logged');
select pg_temp.act_as('1e000000-0000-4000-8000-000000000022');
select throws_ok(
  $$ select public.add_binder_export_to_evidence_collection(
       (select id from ev_ids where key='col'),'1e000000-0000-4000-8000-000000000034','June again') $$,
  '22023', null, 'a withdrawn artifact cannot be silently re-added');

-- Revocation fails closed immediately.
select lives_ok(
  $$ select public.revoke_evidence_guest_grant(
       (select id from ev_ids where key='grant1'),'Survey visit concluded') $$,
  'a manager can revoke a grant with a reason');
reset role; set local role anon;
select is(
  (public.authorize_evidence_guest_artifact(
    (select value from ev_ids where key='grant1'),
    (select id from ev_ids where key='art1'),'view',null)->>'authorized')::boolean,
  false, 'a revoked grant fails closed');
reset role;

-- Closing the room revokes outstanding grants and shuts the guest surface.
select pg_temp.act_as('1e000000-0000-4000-8000-000000000021');
insert into ev_ids(key,id,value)
select 'grant2', (x->>'grantId')::uuid, x->>'token'
from public.issue_evidence_guest_grant(
  (select id from ev_ids where key='col'), 'Second surveyor', null,
  array[(select id from ev_ids where key='art1')], now()+interval '7 days', false) x;
select is(
  (public.set_evidence_collection_status((select id from ev_ids where key='col'),'closed')).status,
  'closed', 'the collection closes after the survey');
reset role;
select results_eq(
  $$ select (revoked_at is not null), revocation_reason from public.evidence_guest_grants
     where id=(select id from ev_ids where key='grant2') $$,
  $$ values (true, 'Collection closed'::text) $$,
  'closing the room revokes outstanding guest grants');
reset role; set local role anon;
select is(
  public.get_evidence_guest_room((select value from ev_ids where key='grant2'))->>'reason',
  'access_denied', 'a closed room is inaccessible to guests');
reset role;

-- Legal hold is an org_admin decision; cross-tenant management fails closed.
select pg_temp.act_as('1e000000-0000-4000-8000-000000000022');
select throws_ok(
  $$ select public.set_evidence_collection_legal_hold((select id from ev_ids where key='col'),true) $$,
  '42501', null, 'facility managers cannot toggle legal hold');
select pg_temp.act_as('1e000000-0000-4000-8000-000000000021');
select is(
  (public.set_evidence_collection_legal_hold((select id from ev_ids where key='col'),true)).legal_hold,
  true, 'an org admin can place a legal hold');
select pg_temp.act_as('1e000000-0000-4000-8000-000000000024');
select throws_ok(
  $$ select public.set_evidence_collection_status((select id from ev_ids where key='col'),'withdrawn') $$,
  '42501', null, 'another organization''s admin cannot manage the collection');

select pg_temp.act_as('1e000000-0000-4000-8000-000000000021');
select is(
  (public.get_evidence_collection_list_summary(null) ->> 'total')::integer,
  (select count(*)::integer from public.evidence_collections),
  'evidence collection summary total matches the RLS-visible count'
);
select is(
  (public.get_evidence_collection_list_summary(null) ->> 'legalHolds')::integer,
  (select count(*)::integer from public.evidence_collections where legal_hold),
  'evidence collection summary legal-hold count matches direct count'
);

select * from finish();
rollback;

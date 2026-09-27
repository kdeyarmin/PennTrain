begin;
select plan(26);

select ok(to_regprocedure('public.record_organization_signup(text,text,timestamptz,text)') is not null,
  'the deployed four-argument signup caller survives the database-first rollout');
select ok(not has_function_privilege('anon','public.record_organization_signup(text,text,timestamptz,text)','EXECUTE'),
  'anonymous callers cannot use the legacy rollout signature');
select ok(not has_function_privilege('authenticated','public.record_organization_signup(text,text,timestamptz,text)','EXECUTE'),
  'authenticated callers cannot use the legacy rollout signature');
select ok(has_function_privilege('service_role','public.record_organization_signup(text,text,timestamptz,text)','EXECUTE'),
  'the deployed Edge function retains its legacy service-role grant');
select results_eq($$select pronargs::integer,pronargdefaults::integer from pg_proc where oid in (
  'public.record_organization_signup(text,text,timestamptz,text)'::regprocedure,
  'public.record_organization_signup(text,text,timestamptz,text,text)'::regprocedure) order by pronargs$$,
  $$select * from (values(4,0),(5,0)) as expected(argument_count,default_count)$$,
  'both named argument sets resolve exactly, with no optional license argument');
set local role service_role;
select lives_ok($$select public.record_organization_signup(p_name=>'Legacy signup',p_slug=>'legacy-signup-rollout',
  p_trial_ends_at=>now()+interval '30 days',p_baa_version=>'accepted')$$,
  'the old named RPC payload still works after the new overload is installed');
reset role;
select results_eq($$select o.baa_version,s.email_notifications_enabled,s.sms_notifications_enabled
  from public.organizations o join public.organization_settings s on s.organization_id=o.id
  where o.slug='legacy-signup-rollout'$$,$$select 'accepted'::text,true,true$$,
  'legacy signup preserves the organization, BAA and notification settings behavior');
select is((select count(*)::integer from public.facilities f join public.organizations o on o.id=f.organization_id
  where o.slug='legacy-signup-rollout'),0,'legacy compatibility never silently chooses a facility license');
select throws_ok($$select public.record_organization_signup('Missing type','missing-license-type',now()+interval '30 days','accepted',null)$$,
  '22023',null,'missing type is rejected');
select throws_ok($$select public.record_organization_signup('Blank type','blank-license-type',now()+interval '30 days','accepted','')$$,
  '22023',null,'blank type is rejected');
select throws_ok($$select public.record_organization_signup('Other type','other-license-type',now()+interval '30 days','accepted','NH')$$,
  '22023',null,'unrelated license type cannot select PA PCH/ALF signup rules');
select is((select count(*)::integer from public.organizations where slug in ('missing-license-type','blank-license-type','other-license-type')),0,
  'invalid selection leaves no organization behind');
select lives_ok($$select public.record_organization_signup(p_name=>'Signup PCH',p_slug=>'typed-signup-pch',
  p_trial_ends_at=>now()+interval '30 days',p_baa_version=>'accepted',p_facility_type=>'PCH')$$,
  'PCH signup succeeds');
select lives_ok($$select public.record_organization_signup(p_name=>'Signup ALF',p_slug=>'typed-signup-alf',
  p_trial_ends_at=>now()+interval '30 days',p_baa_version=>'accepted',p_facility_type=>'ALR')$$,
  'ALF signup succeeds using the stored ALR code');
select results_eq($$select f.facility_type,f.state from public.facilities f join public.organizations o on o.id=f.organization_id where o.slug='typed-signup-pch'$$,
  $$select 'PCH'::text,'PA'::text$$,'PCH signup creates exactly one Pennsylvania PCH');
select results_eq($$select f.facility_type,f.state from public.facilities f join public.organizations o on o.id=f.organization_id where o.slug='typed-signup-alf'$$,
  $$select 'ALR'::text,'PA'::text$$,'ALF signup creates exactly one Pennsylvania ALF');
select throws_ok($$insert into public.facilities(organization_id,name) select id,'Unspecified facility' from public.organizations where slug='typed-signup-pch'$$,
  '23502',null,'direct facility creation also requires an explicit type');
select throws_ok($$update public.facilities set facility_type='ALR' where name='Signup PCH'$$,
  '23514',null,'a label edit cannot leave old-chapter rules attached to a different license');
select lives_ok($$update public.facilities set name='Renamed PCH',facility_type='PCH' where name='Signup PCH'$$,
  'ordinary facility edits retain the chosen chapter');
insert into public.facilities(organization_id,name,facility_type)
select id,'Other market facility','NH' from public.organizations where slug='typed-signup-pch';
select lives_ok($$update public.facilities set facility_type='HHA' where name='Other market facility'$$,
  'the PCH/ALF license guard does not freeze unrelated markets');
select throws_ok($$update public.facilities set facility_type='PCH' where name='Other market facility'$$,
  '23514',null,'an unrelated facility cannot inherit a chapter by relabeling existing evidence');
select throws_ok($$update public.facilities set facility_type='NH' where name='Renamed PCH'$$,
  '23514',null,'a PCH cannot escape its chapter by relabeling');
select lives_ok($$select public.rollback_organization_signup((select id from public.organizations where slug='typed-signup-alf'))$$,
  'failed invitation can roll back the facility, seeded rules and organization');
select is((select count(*)::integer from public.facilities where name='Signup ALF'),0,
  'signup rollback leaves no orphaned facility');
select lives_ok($$select public.rollback_organization_signup((select id from public.organizations where slug='legacy-signup-rollout'))$$,
  'rollout compatibility retains rollback for the old organization-only signup');
select is((select count(*)::integer from public.organizations where slug='legacy-signup-rollout'),0,
  'legacy signup rollback leaves no organization behind');
select * from finish();
rollback;

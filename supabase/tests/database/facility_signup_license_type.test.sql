begin;
select plan(17);

select ok(to_regprocedure('public.record_organization_signup(text,text,timestamptz,text)') is null,
  'signup cannot bypass facility selection through the old overload');
select throws_ok($$select public.record_organization_signup('Missing type','missing-license-type',now()+interval '30 days','accepted',null)$$,
  '22023',null,'missing type is rejected');
select throws_ok($$select public.record_organization_signup('Blank type','blank-license-type',now()+interval '30 days','accepted','')$$,
  '22023',null,'blank type is rejected');
select throws_ok($$select public.record_organization_signup('Other type','other-license-type',now()+interval '30 days','accepted','NH')$$,
  '22023',null,'unrelated license type cannot select PA PCH/ALF signup rules');
select is((select count(*)::integer from public.organizations where slug in ('missing-license-type','blank-license-type','other-license-type')),0,
  'invalid selection leaves no organization behind');
select lives_ok($$select public.record_organization_signup('Signup PCH','typed-signup-pch',now()+interval '30 days','accepted','PCH')$$,
  'PCH signup succeeds');
select lives_ok($$select public.record_organization_signup('Signup ALF','typed-signup-alf',now()+interval '30 days','accepted','ALR')$$,
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
select * from finish();
rollback;

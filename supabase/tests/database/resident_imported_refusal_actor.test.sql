begin;
select plan(5);
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('d2280000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.organizations(id,name,slug,subscription_status) values(pg_temp.id(1),'Medication service actor','medication-service-actor','active');
insert into public.facilities(id,organization_id,name,facility_type) values(pg_temp.id(11),pg_temp.id(1),'PCH medication source','PCH');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date) values(pg_temp.id(101),pg_temp.id(1),pg_temp.id(11),'Imported','Resident',public.pa_today()-30);
insert into public.medication_integration_sources(id,organization_id,facility_id,name,vendor_name,external_facility_id)
 values(pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),'Refusal import','Test eMAR','external-pch');
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-0000-0000-000000000000','role','service_role')::text,true);
set local role service_role;
select lives_ok($$insert into public.external_medication_administration_events(id,organization_id,facility_id,source_id,resident_id,external_event_id,administration_status,occurred_at,raw_record_sha256)
 values(pg_temp.id(202),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(101),'service-refusal','refused',now()-interval '2 hours',repeat('a',64))$$,'service principal without a staff profile can import a refused administration');
reset role;
select is((select count(*)::integer from public.external_medication_administration_events where id=pg_temp.id(202)),1,'actual imported administration is retained');
select is((select count(*)::integer from public.resident_regulatory_actions where action_type='medication_refusal_notice' and details->>'external_event_id'=pg_temp.id(202)::text),1,'service import creates exactly one independent prescriber duty');
select is((select due_at from public.resident_regulatory_actions where details->>'external_event_id'=pg_temp.id(202)::text),now()+interval '22 hours','prescriber notice keeps its actual refusal plus 24-hour deadline');
select is((select created_by from public.resident_regulatory_actions where details->>'external_event_id'=pg_temp.id(202)::text),null::uuid,'service-created duty does not fabricate a human recorder');
select * from finish();
rollback;

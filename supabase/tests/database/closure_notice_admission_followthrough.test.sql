begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('d2270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.organizations(id,name,slug) values(pg_temp.id(1),'Closure admission tests','closure-admission-tests');
insert into public.facilities(id,organization_id,name,facility_type) values
 (pg_temp.id(11),pg_temp.id(1),'Planned closure PCH','PCH'),(pg_temp.id(12),pg_temp.id(1),'Other PCH','PCH');
select ok(not has_function_privilege('authenticated','app_private.seed_admission_closure_notices()','EXECUTE'),'browser cannot invoke the definer admission producer');
select ok(not has_function_privilege('authenticated','app_private.protect_closure_admission_context()','EXECUTE'),'admission evidence guard is not a browser RPC');
insert into public.resident_regulatory_events(id,organization_id,facility_id,event_type,event_at,reason,evidence)
 values(pg_temp.id(301),pg_temp.id(1),pg_temp.id(11),'facility_closure_plan',now()+interval '90 days','Planned licensed closure','Approved closure decision');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status)
 values(pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),'Later','Admission',public.pa_today(),'active');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(201)),3,'direct active admission creates all three closure recipient notices');
select is((select array_agg(recipient_role order by recipient_role) from public.resident_regulatory_actions where resident_id=pg_temp.id(201)),array['designated_person','referral_agent','resident']::text[],'new resident, designated person and referral agent are tracked independently');
select ok((select bool_and(source_event_id=pg_temp.id(301) and anchor_at=now()+interval '90 days' and due_at=(((now()+interval '90 days') at time zone 'America/New_York')-interval '30 days') at time zone 'America/New_York') from public.resident_regulatory_actions where resident_id=pg_temp.id(201)),'notice deadline keeps exact closure plan anchor instead of admission or creation time');
select ok((select bool_and(status='pending' and completed_at is null and evidence is null) from public.resident_regulatory_actions where resident_id=pg_temp.id(201)),'admission does not fabricate notice delivery');
select ok((select bool_and(details->'admission_context'->>'kind'='resident_record' and details->'admission_context'->>'admission_date'=public.pa_today()::text and (details->'admission_context'->>'resident_created_at')::timestamptz=(select created_at from public.residents where id=pg_temp.id(201))) from public.resident_regulatory_actions where resident_id=pg_temp.id(201)),'direct admission retains the actual recorded admission and resident creation evidence');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status)
 values(pg_temp.id(202),pg_temp.id(1),pg_temp.id(11),'Reserved','Admission',public.pa_today(),'reserved'),
       (pg_temp.id(203),pg_temp.id(1),pg_temp.id(12),'Other','Facility',public.pa_today(),'active');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id in (pg_temp.id(202),pg_temp.id(203))),0,'unadmitted reservations and another facility do not inherit closure duties');
-- The completed move-in command writes this immutable census transition after
-- activating the resident. Exercise the producer with that stored event shape.
update public.residents set status='active' where id=pg_temp.id(202);
insert into public.resident_census_events(id,organization_id,facility_id,resident_id,event_type,prior_status,resulting_status,effective_at,reason)
 values(pg_temp.id(401),pg_temp.id(1),pg_temp.id(11),pg_temp.id(202),'admitted','reserved','active',now()-interval '2 hours','Completed move-in admission');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(202)),3,'completed move-in census admission creates closure notices');
select ok((select bool_and(details->'admission_context'->>'census_event_id'=pg_temp.id(401)::text and (details->'admission_context'->>'census_effective_at')::timestamptz=now()-interval '2 hours' and anchor_at=now()+interval '90 days') from public.resident_regulatory_actions where resident_id=pg_temp.id(202)),'census admission retains its actual event time separately from planned closure');
insert into public.resident_census_events(id,organization_id,facility_id,resident_id,event_type,prior_status,resulting_status,reason)
 values(pg_temp.id(402),pg_temp.id(1),pg_temp.id(11),pg_temp.id(202),'returned','hospital_leave','active','Returned from hospital');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(202)),3,'temporary return does not duplicate existing closure recipient duties');
select ok((select bool_and(details->'admission_context'->>'census_event_id'=pg_temp.id(401)::text) from public.resident_regulatory_actions where resident_id=pg_temp.id(202)),'temporary return preserves original admission evidence');
select throws_ok($$update public.resident_regulatory_actions set details=details-'admission_context' where resident_id=pg_temp.id(202)$$,'23514',null,'even pending notices cannot discard admission source evidence');
select throws_ok($$update public.resident_regulatory_actions set details=jsonb_set(details,'{admission_context,admission_date}','"2099-01-01"') where resident_id=pg_temp.id(202)$$,'23514',null,'pending notice admission date cannot be rewritten');
select lives_ok($$update public.resident_regulatory_actions set status='completed',completed_at=now(),evidence='Written closure notice delivery receipt retained' where resident_id=pg_temp.id(202) and recipient_role='resident'$$,'actual delivery remains recordable with immutable plan and admission anchors');
update public.residents set status='discharged',discharge_date=public.pa_today() where facility_id=pg_temp.id(11);
insert into public.resident_regulatory_events(id,organization_id,facility_id,event_type,event_at,reason,evidence)
 values(pg_temp.id(302),pg_temp.id(1),pg_temp.id(11),'facility_closed',now(),'Actual licensed closure','Closure confirmation');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status)
 values(pg_temp.id(204),pg_temp.id(1),pg_temp.id(11),'After','Closed plan',public.pa_today(),'active');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(204)),0,'actual closure ends the old plan for later resident records');
insert into public.resident_regulatory_events(id,organization_id,facility_id,event_type,event_at,reason,evidence)
 values(pg_temp.id(303),pg_temp.id(1),pg_temp.id(11),'facility_closure_plan',now()+interval '120 days','Newly recorded closure plan','New closure decision');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status)
 values(pg_temp.id(205),pg_temp.id(1),pg_temp.id(11),'New','Plan admission',public.pa_today(),'active');
select ok((select count(*)=3 and bool_and(source_event_id=pg_temp.id(303) and anchor_at=now()+interval '120 days') from public.resident_regulatory_actions where resident_id=pg_temp.id(205)),'a new plan recorded after closure in the same transaction governs later admissions');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(201) and source_event_id=pg_temp.id(301)),3,'new plan does not erase historical notice duties');
select * from finish();
rollback;

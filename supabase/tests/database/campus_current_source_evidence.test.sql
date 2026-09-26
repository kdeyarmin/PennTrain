begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$ select ('b2280000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into public.organizations(id,name,slug,subscription_status) values(pg_temp.id(1),'Campus current records','campus-current-records','active');
insert into public.facilities(id,organization_id,name,facility_type,campus_identifier) values
 (pg_temp.id(11),pg_temp.id(1),'Campus source','ALR','same-campus'),(pg_temp.id(12),pg_temp.id(1),'Campus receiving','ALR','same-campus');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,admission_date,status) values
 (pg_temp.id(101),pg_temp.id(1),pg_temp.id(11),'Campus','Person','1940-01-01',public.pa_today()-1000,'active'),
 (pg_temp.id(102),pg_temp.id(1),pg_temp.id(12),'Campus','Person','1940-01-01',public.pa_today(),'active');
update public.residents set status='discharged',discharge_date=public.pa_today() where id=pg_temp.id(101);
update public.resident_compliance_items set status='compliant',completed_date=public.pa_today()-700 where resident_id=pg_temp.id(101) and item_type in ('medical_evaluation','initial_assessment_15day','support_plan_30day');
-- Existing signed records can be old; their overdue successors cannot be reset by a move.
insert into public.resident_compliance_items(id,organization_id,facility_id,resident_id,item_type,due_date,status,completed_date) values
 (pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),pg_temp.id(101),'annual_medical_evaluation',public.pa_today()-60,'compliant',public.pa_today()-60),
 (pg_temp.id(202),pg_temp.id(1),pg_temp.id(11),pg_temp.id(101),'significant_change_reassessment',public.pa_today()-400,'compliant',public.pa_today()-400),
 (pg_temp.id(203),pg_temp.id(1),pg_temp.id(11),pg_temp.id(101),'support_plan_30day',public.pa_today()-400,'compliant',public.pa_today()-400),
 (pg_temp.id(204),pg_temp.id(1),pg_temp.id(11),pg_temp.id(101),'support_plan_quarterly_review',public.pa_today()-200,'compliant',public.pa_today()-200),
 (pg_temp.id(205),pg_temp.id(1),pg_temp.id(11),pg_temp.id(101),'support_plan_quarterly_review',public.pa_today()-120,'compliant',public.pa_today()-120);
update public.resident_compliance_items set due_date=public.pa_today()-20 where resident_id=pg_temp.id(101) and item_type='annual_reassessment' and completed_date is null;
insert into public.resident_compliance_items(organization_id,facility_id,resident_id,item_type,due_date)
select pg_temp.id(1),pg_temp.id(11),pg_temp.id(101),'annual_reassessment',public.pa_today()-20 where not exists(select 1 from public.resident_compliance_items where resident_id=pg_temp.id(101) and item_type='annual_reassessment' and completed_date is null);
update public.resident_compliance_items set due_date=public.pa_today()-5 where resident_id=pg_temp.id(101) and item_type='annual_medical_evaluation' and completed_date is null;
insert into public.resident_compliance_items(organization_id,facility_id,resident_id,item_type,due_date)
select pg_temp.id(1),pg_temp.id(11),pg_temp.id(101),'annual_medical_evaluation',public.pa_today()-5 where not exists(select 1 from public.resident_compliance_items where resident_id=pg_temp.id(101) and item_type='annual_medical_evaluation' and completed_date is null);
create function pg_temp.doc(n integer,r uuid,i uuid default null) returns uuid language plpgsql as $$
declare v public.residents%rowtype;
begin select * into v from public.residents where id=r;
 insert into public.resident_documents(id,organization_id,facility_id,resident_id,compliance_item_id,file_name,file_type,storage_path,is_state_form,state_form_source_label)
 values(pg_temp.id(n),v.organization_id,v.facility_id,r,i,'signed.pdf','application/pdf',v.organization_id||'/'||v.facility_id||'/'||pg_temp.id(n)||'-signed.pdf',true,'PA DHS completed signed form');
 return pg_temp.id(n); end $$;
do $$declare x record; n integer:=300; begin
 for x in select id,resident_id from public.resident_compliance_items where resident_id=pg_temp.id(101) and completed_date is not null or resident_id=pg_temp.id(102) and item_type in ('medical_evaluation','initial_assessment_15day','support_plan_30day') order by id loop
 n:=n+1; perform pg_temp.doc(n,x.resident_id,x.id); end loop;
end $$;
select pg_temp.doc(390,pg_temp.id(102));
select pg_temp.doc(391,pg_temp.id(102));
create function pg_temp.payload() returns jsonb language sql as $$
 select jsonb_object_agg(t.item_type,jsonb_build_object('source_item_id',case t.item_type when 'medical_evaluation' then pg_temp.id(201) when 'initial_assessment_15day' then pg_temp.id(202) else pg_temp.id(203) end,'document_id',d.id))
 from public.resident_compliance_items t join public.resident_documents d on d.compliance_item_id=t.id where t.resident_id=pg_temp.id(102) and t.item_type in ('medical_evaluation','initial_assessment_15day','support_plan_30day')
$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(not has_function_privilege('authenticated','app_private.carry_campus_resident_evidence_core(uuid,uuid,uuid,jsonb)','EXECUTE'),'the older carry path cannot bypass current source selection');
select throws_ok($$select public.carry_campus_resident_evidence(pg_temp.id(102),pg_temp.id(101),pg_temp.id(390),jsonb_set(pg_temp.payload(),'{initial_assessment_15day,source_item_id}',to_jsonb((select id from public.resident_compliance_items where resident_id=pg_temp.id(101) and item_type='initial_assessment_15day'))))$$,'23514',null,'cannot choose an older initial assessment after a significant-change assessment');
select throws_ok($$select public.carry_campus_resident_evidence(pg_temp.id(102),pg_temp.id(101),pg_temp.id(390),jsonb_set(pg_temp.payload(),'{support_plan_30day,source_item_id}',to_jsonb((select id from public.resident_compliance_items where resident_id=pg_temp.id(101) and item_type='support_plan_30day' and id<>pg_temp.id(203)))))$$,'23514',null,'cannot choose an older support plan after its revision');
select throws_ok($$select public.carry_campus_resident_evidence(pg_temp.id(102),pg_temp.id(101),pg_temp.id(390),pg_temp.payload())$$,'23514',null,'documented quarterly review needs a receiving signed copy');
select throws_ok($$select public.carry_campus_resident_evidence(pg_temp.id(102),pg_temp.id(101),pg_temp.id(390),pg_temp.payload()||jsonb_build_object('support_plan_quarterly_review',jsonb_build_object('source_item_id',pg_temp.id(204),'document_id',pg_temp.id(391))))$$,'23514',null,'cannot substitute an older quarterly review');
select lives_ok($$select public.carry_campus_resident_evidence(pg_temp.id(102),pg_temp.id(101),pg_temp.id(390),pg_temp.payload()||jsonb_build_object('support_plan_quarterly_review',jsonb_build_object('source_item_id',pg_temp.id(205),'document_id',pg_temp.id(391))))$$,'latest existing assessment and plan carry with current quarterly evidence despite overdue cycles');
select is((select completed_date from public.resident_compliance_items where resident_id=pg_temp.id(102) and item_type='initial_assessment_15day'),public.pa_today()-400,'old latest assessment keeps its actual date without an invented age cutoff');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(102) and item_type='annual_reassessment' and completed_date is null),public.pa_today()-20,'overdue annual assessment remains overdue after move');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(102) and item_type='annual_medical_evaluation' and completed_date is null),public.pa_today()-5,'a later examination cannot reset the existing annual DME cycle');
select is((select carried_from_item_id from public.resident_compliance_items where resident_id=pg_temp.id(102) and item_type='support_plan_quarterly_review' and completed_date is not null),pg_temp.id(205),'receiving quarterly record keeps the latest source provenance');
select is((select completed_date from public.resident_compliance_items where resident_id=pg_temp.id(102) and item_type='support_plan_quarterly_review' and completed_date is not null),public.pa_today()-120,'quarterly completion is the real source review date');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(102) and item_type='support_plan_quarterly_review' and completed_date is null),((public.pa_today()-120)+interval '3 months')::date,'quarterly successor continues from source review and stays overdue');
select is((select compliance_item_id from public.resident_documents where id=pg_temp.id(391)),(select id from public.resident_compliance_items where resident_id=pg_temp.id(102) and carried_from_item_id=pg_temp.id(205)),'signed receiving copy is attached to the carried review item');
select is((select campus_transfer_evidence->'items'->'support_plan_quarterly_review'->>'document_id' from public.residents where id=pg_temp.id(102)),pg_temp.id(391)::text,'immutable transfer provenance includes the receiving quarterly copy');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(101) and item_type='annual_reassessment' and completed_date is null),public.pa_today()-20,'source overdue history stays unchanged');
select * from finish();
rollback;

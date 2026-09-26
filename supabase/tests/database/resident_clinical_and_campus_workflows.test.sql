begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$ select ('b2260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into public.organizations(id,name,slug,subscription_status,is_demo) values(pg_temp.id(1),'Clinical workflow tests','clinical-workflow-tests','active',true);
insert into public.facilities(id,organization_id,name,facility_type,campus_identifier) values
 (pg_temp.id(11),pg_temp.id(1),'Campus PCH A','PCH','shared-campus'),
 (pg_temp.id(12),pg_temp.id(1),'Campus PCH B','PCH','shared-campus'),
 (pg_temp.id(13),pg_temp.id(1),'ALF special care','ALR','other-campus');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,admission_date,status) values
 (pg_temp.id(101),pg_temp.id(1),pg_temp.id(11),'Campus','Resident','1940-01-01',public.pa_today()-200,'active'),
 (pg_temp.id(102),pg_temp.id(1),pg_temp.id(12),'Campus','Resident','1940-01-01',public.pa_today(),'active'),
 (pg_temp.id(103),pg_temp.id(1),pg_temp.id(13),'ALF','Resident','1940-01-01',public.pa_today()-3,'active');
create function pg_temp.doc(n integer,r uuid,i uuid default null) returns uuid language plpgsql as $$
declare v public.residents%rowtype;
begin select * into v from public.residents where id=r;
 insert into public.resident_documents(id,organization_id,facility_id,resident_id,compliance_item_id,file_name,file_type,storage_path,is_state_form,state_form_source_label)
 values(pg_temp.id(n),v.organization_id,v.facility_id,r,i,'signed.pdf','application/pdf',v.organization_id||'/'||v.facility_id||'/'||pg_temp.id(n)||'-signed.pdf',true,'PA DHS completed form');
 return pg_temp.id(n); end $$;
select pg_temp.doc(201,pg_temp.id(103));

select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(103) and action_type='resident_tb_test'),1,'ALF admission seeds TB evidence review');
select is((select due_at from public.resident_regulatory_actions where resident_id=pg_temp.id(103) and action_type='resident_tb_test'),public.pa_midnight(public.pa_today()-3)+interval '15 days','initial TB has the explicit 141(a)(11) 15-day window');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(101) and action_type='resident_tb_test'),0,'Chapter 2600 does not acquire the ALF TB requirement');
select throws_ok($$update public.resident_regulatory_actions set status='completed',completed_at=now(),evidence='Test result retained' where resident_id=pg_temp.id(103) and action_type='resident_tb_test'$$,'23514',null,'TB completion needs a linked test result');
update public.resident_regulatory_actions set status='completed',completed_at=now()-interval '1 year',evidence='Negative test report',details=details||jsonb_build_object('document_id',pg_temp.id(201),'tb_result','negative')
 where resident_id=pg_temp.id(103) and action_type='resident_tb_test';
select is((select due_at from public.resident_regulatory_actions where resident_id=pg_temp.id(103) and action_type='resident_tb_test' and status='pending'),now()+interval '1 year','TB successor runs from the actual test date, not its upload date');
select throws_ok($$update public.resident_regulatory_actions set evidence='Changed completed evidence' where resident_id=pg_temp.id(103) and action_type='resident_tb_test' and status='completed'$$,'23514',null,'completed TB evidence is immutable');

select throws_ok($$insert into public.residents(organization_id,facility_id,first_name,last_name,admission_date,admission_track) values(pg_temp.id(1),pg_temp.id(13),'No','Basis',public.pa_today(),'expedited')$$,'23514',null,'expedited admission cannot omit its qualifying condition and source');
select lives_ok($$insert into public.residents(organization_id,facility_id,first_name,last_name,admission_date,admission_track,expedited_admission_basis,expedited_admission_evidence) values(pg_temp.id(1),pg_temp.id(13),'Valid','Basis',public.pa_today(),'expedited','acute_care_hospital','Acute hospital discharge summary on record')$$,'expedited hospital admission records its evidence');

select is((select resident_regulatory_policy->>'alf_admission_grace_days' from public.facilities where id=pg_temp.id(13)),'0','default ALF admission policy remains strict');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.save_resident_regulatory_policy(pg_temp.id(13),'{"alf_admission_grace_days":15,"alf_contract_timing":"within_24_hours","revision_grace_days":5,"medication_reportability":"statutory_errors"}', 'Recorded facility policy decision following review','other-campus');
select is((select grace_period_days from public.resident_compliance_items where resident_id=pg_temp.id(103) and item_type='medical_evaluation'),15,'selected ALF policy updates the open admission duty');
select is((select resident_regulatory_policy->>'decision_reason' from public.facilities where id=pg_temp.id(13)),'Recorded facility policy decision following review','policy keeps the recorded decision');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.save_resident_regulatory_policy(pg_temp.id(13),'{}','Unauthorized policy change')$$,'42501',null,'anonymous caller cannot change policy');
select ok(not has_function_privilege('authenticated','app_private.complete_move_in_admission_core(uuid,text,date)','EXECUTE'),'new contract-time wrapper cannot be bypassed');

-- SCU exact-hour clocks, qualified screening evidence and real recurrence.
insert into public.resident_regulatory_actions(id,organization_id,facility_id,resident_id,action_type,anchor_at,reason,status,completed_at,evidence,details)
values(pg_temp.id(301),pg_temp.id(1),pg_temp.id(13),pg_temp.id(103),'scu_admission',now()-interval '2 days','Documented dementia unit admission','completed',now()-interval '2 days','Signed unit admission and screening',
 jsonb_build_object('unit_type','dementia','document_id',pg_temp.id(201),'screened_at',now()-interval '3 days','screening_collaborator','Physician and assessment team','screening_collaborator_role','physician','medical_provider_role','crnp','admission_agreement','Signed resident and designated-person agreement','alternatives_considered','Other less restrictive arrangements assessed','medical_evaluated_on',public.pa_today()-10,'medical_evaluation_evidence','DHS DME diagnosis and need for dementia unit'));
select is((select due_at from public.resident_regulatory_actions where resident_id=pg_temp.id(103) and action_type='scu_support_plan'),now()+interval '1 day','unit plan is due exactly 72 hours from unit admission');
select is((select due_at from public.resident_regulatory_actions where resident_id=pg_temp.id(103) and action_type='scu_continuing_need'),(((now()-interval '2 days') at time zone 'America/New_York')+interval '3 months') at time zone 'America/New_York','ALF dementia continuing need recurs quarterly');
update public.resident_regulatory_actions set status='completed',completed_at=now()-interval '1 day',evidence='Implemented signed support plan with resident participation',details=details||jsonb_build_object('document_id',pg_temp.id(201)) where resident_id=pg_temp.id(103) and action_type='scu_support_plan';
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(103) and action_type='scu_plan_review' and status='pending'),1,'completed initial unit plan opens its recurring review');
select throws_ok($$insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,status,completed_at,evidence,details)
select organization_id,facility_id,resident_id,action_type,anchor_at,reason,status,completed_at,evidence,details||jsonb_build_object('screened_at',now()-interval '6 days') from public.resident_regulatory_actions where id=pg_temp.id(301)$$,'23514',null,'a cognitive screening outside the 72-hour look-back cannot satisfy unit admission');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.end_resident_special_care(pg_temp.id(103),now(),'Returned to general assisted living','Recorded move and handoff to the general unit');
select is((select sdcu from public.residents where id=pg_temp.id(103)),false,'unit departure clears special-care census status');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(103) and action_type in ('scu_plan_review','scu_continuing_need') and status='pending'),0,'unit departure closes future unit duties with evidence');
select set_config('request.jwt.claims','{}',true);

insert into public.medication_integration_sources(id,organization_id,facility_id,name,vendor_name,external_facility_id)
values(pg_temp.id(401),pg_temp.id(1),pg_temp.id(13),'Medication source','Test eMAR','test-site');
insert into public.external_medication_administration_events(id,organization_id,facility_id,source_id,resident_id,external_event_id,administration_status,occurred_at,raw_record_sha256)
values(pg_temp.id(402),pg_temp.id(1),pg_temp.id(13),pg_temp.id(401),pg_temp.id(103),'refusal-1','refused',now()-interval '2 hours',repeat('a',64));
select is((select due_at from public.resident_regulatory_actions where action_type='medication_refusal_notice' and details->>'external_event_id'=pg_temp.id(402)::text),now()+interval '22 hours','imported medication refusal opens its prescriber deadline from occurrence');
select throws_ok($$update public.resident_regulatory_actions set status='not_applicable',exception_basis='Routine subsequent refusal' where action_type='medication_refusal_notice' and details->>'external_event_id'=pg_temp.id(402)::text$$,'23514',null,'a refusal cannot be dismissed without the prescriber instruction');

insert into public.incidents(id,organization_id,facility_id,incident_type,occurred_at,narrative,pathway_key,pathway_answers)
values(pg_temp.id(501),pg_temp.id(1),pg_temp.id(13),'medication_error',now(),'Intercepted near miss without resident exposure','medication_event','{"event_kind":"near_miss","administration_by":"staff","error_category":"wrong_dose"}');
select is((select reportability_status from public.incidents where id=pg_temp.id(501)),'pending_review','statutory policy sends a near miss to a recorded determination');
select is((select count(*)::integer from public.incident_notifications where incident_id=pg_temp.id(501) and notification_type='state_hotline'),0,'near miss does not automatically start a Department deadline');
update public.incidents set pathway_answers='{"event_kind":"actual_error","administration_by":"staff","error_category":"wrong_route"}' where id=pg_temp.id(501);
select is((select reportability_status from public.incidents where id=pg_temp.id(501)),'reportable','documented staff wrong-route prescription error starts reportability');
select is((select count(*)::integer from public.incident_notifications where incident_id=pg_temp.id(501) and notification_type='state_hotline'),1,'statutory error creates the Department report duty');

-- Campus carry requires distinct homes on one campus, real signed source evidence,
-- receiving copies and the dated addendum. It never substitutes today's date.
update public.residents set status='discharged',discharge_date=public.pa_today() where id=pg_temp.id(101);
update public.resident_compliance_items set status='compliant',completed_date=public.pa_today()-120 where resident_id=pg_temp.id(101) and item_type in ('medical_evaluation','initial_assessment_15day','support_plan_30day');
do $$declare x record; n integer:=600; begin for x in select id,resident_id from public.resident_compliance_items where resident_id in (pg_temp.id(101),pg_temp.id(102)) and item_type in ('medical_evaluation','initial_assessment_15day','support_plan_30day') order by id loop n:=n+1; perform pg_temp.doc(n,x.resident_id,x.id); end loop; end $$;
select pg_temp.doc(699,pg_temp.id(102));
create function pg_temp.campus_payload() returns jsonb language sql as $$
 select jsonb_object_agg(t.item_type,jsonb_build_object('source_item_id',s.id,'document_id',d.id))
 from public.resident_compliance_items t join public.resident_compliance_items s on s.item_type=t.item_type and s.resident_id=pg_temp.id(101)
 join public.resident_documents d on d.compliance_item_id=t.id where t.resident_id=pg_temp.id(102) and t.item_type in ('medical_evaluation','initial_assessment_15day','support_plan_30day')
$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.carry_campus_resident_evidence(pg_temp.id(102),pg_temp.id(101),pg_temp.id(201),pg_temp.campus_payload())$$,'23514',null,'campus addendum must belong to the receiving resident');
select lives_ok($$select public.carry_campus_resident_evidence(pg_temp.id(102),pg_temp.id(101),pg_temp.id(699),pg_temp.campus_payload())$$,'eligible campus move carries evidence through the dedicated RPC');
select is((select count(*)::integer from public.resident_compliance_items where resident_id=pg_temp.id(102) and carried_from_item_id is not null and completed_date=public.pa_today()-120),3,'all three carried forms preserve actual old completion dates');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(102) and item_type='annual_medical_evaluation' and completed_date is null),((public.pa_today()-120)+interval '1 year')::date,'campus transfer retains the old DME annual cycle');
select is(public.resident_compliance_backdate_days('initial_assessment_15day','PCH'),0,'ordinary PCH initial assessment uses the post-admission floor');
select throws_ok($$select public.carry_campus_resident_evidence(pg_temp.id(102),pg_temp.id(101),pg_temp.id(699),pg_temp.campus_payload())$$,'23514',null,'completed campus provenance cannot be overwritten');

-- Exact admission time controls contract due time, while the pre-admission
-- certification remains a blocker. Refreshes preserve the recorded event time.
insert into public.move_in_templates(id,organization_id,name,version,definition) values(pg_temp.id(801),pg_temp.id(1),'Clinical policy fixture',1,'{}');
insert into public.move_in_workspaces(id,organization_id,facility_id,resident_id,template_id,target_move_in_date)
 values(pg_temp.id(802),pg_temp.id(1),pg_temp.id(13),pg_temp.id(103),pg_temp.id(801),public.pa_today());
insert into public.move_in_tasks(id,organization_id,facility_id,workspace_id,task_key,title,depends_on_task_keys) values
 (pg_temp.id(803),pg_temp.id(1),pg_temp.id(13),pg_temp.id(802),'resident_agreement','Resident contract','{}'),
 (pg_temp.id(804),pg_temp.id(1),pg_temp.id(13),pg_temp.id(802),'guest_signing','Contract guest signing',array['resident_agreement']);
select is((public.refresh_move_in_readiness(pg_temp.id(802))->>'blockers')::integer,1,'24-hour policy defers only contract tasks; needs certification still blocks admission');
select throws_ok($$select public.complete_move_in_admission(pg_temp.id(802),'Actual arrival recorded',public.pa_today())$$,'23514',null,'24-hour policy never invents actual admission time');
update public.move_in_tasks set state='approved',document_id=pg_temp.id(201),signature_evidence=jsonb_build_object('signerName','Dr Certifier','canMeetNeeds',true,'priorToAdmission',true,'certifierRole','physician','signedAt',now()-interval '1 hour')
 where workspace_id=pg_temp.id(802) and task_key='alf_needs_certification';
select throws_ok($$select public.complete_move_in_admission(pg_temp.id(802),'Actual arrival recorded',(now()-interval '2 hours')::date,now()-interval '2 hours')$$,'23514',null,'a later same-day certification cannot satisfy prior-to-admission certification');
select is((public.refresh_move_in_readiness(pg_temp.id(802))->>'blockers')::integer,0,'qualified needs certification allows readiness with a pending deferred contract');
update public.move_in_workspaces set readiness_snapshot=readiness_snapshot||jsonb_build_object('actualAdmissionAt',now()-interval '1 hour') where id=pg_temp.id(802);
select public.refresh_move_in_readiness(pg_temp.id(802));
select is((select (readiness_snapshot->>'actualAdmissionAt')::timestamptz from public.move_in_workspaces where id=pg_temp.id(802)),now()-interval '1 hour','readiness refresh retains actual admission timestamp');
update public.move_in_tasks set state='in_progress' where id=pg_temp.id(803);
select is((select due_at from public.move_in_tasks where id=pg_temp.id(803)),now()+interval '23 hours','contract duty is anchored to actual admission plus 24 hours');
select throws_ok($$update public.move_in_tasks set state='approved' where id=pg_temp.id(803)$$,'23514',null,'contract completion requires its actual signature time');
select throws_ok($$update public.facilities set resident_regulatory_policy=jsonb_set(resident_regulatory_policy,'{revision_grace_days}','null') where id=pg_temp.id(13)$$,'23514',null,'JSON null cannot disable a deadline policy');

-- INRBI has a six-month need review and a distinct monthly support-plan review.
insert into public.resident_regulatory_actions(id,organization_id,facility_id,resident_id,action_type,anchor_at,reason,status,completed_at,evidence,details)
select pg_temp.id(810),organization_id,facility_id,resident_id,action_type,now()-interval '1 hour','Qualified INRBI admission','completed',now()-interval '1 hour','Signed CPB assessment and unit agreement',
 details||jsonb_build_object('unit_type','inrbi','screened_at',now()-interval '2 hours','screening_collaborator_role','neuropsychologist') from public.resident_regulatory_actions where id=pg_temp.id(301);
select is((select due_at from public.resident_regulatory_actions where resident_id=pg_temp.id(103) and action_type='scu_continuing_need' and status='pending'),(((now()-interval '1 hour') at time zone 'America/New_York')+interval '6 months') at time zone 'America/New_York','INRBI need review is six calendar months');
update public.resident_regulatory_actions set status='completed',completed_at=now(),evidence='Signed INRBI support plan',details=details||jsonb_build_object('document_id',pg_temp.id(201)) where resident_id=pg_temp.id(103) and action_type='scu_support_plan' and status='pending';
select is((select due_at from public.resident_regulatory_actions where resident_id=pg_temp.id(103) and action_type='scu_plan_review' and status='pending'),((now() at time zone 'America/New_York')+interval '1 month') at time zone 'America/New_York','INRBI plan review is monthly, not six months');
select throws_ok($$update public.resident_regulatory_actions set action_type='refund_due' where resident_id=pg_temp.id(103) and action_type='scu_plan_review' and status='pending'$$,'23514',null,'clinical duty cannot be retyped as a financial notice');
update public.resident_regulatory_actions set anchor_at=now() where action_type='medication_refusal_notice' and details->>'external_event_id'=pg_temp.id(402)::text;
select is((select due_at from public.resident_regulatory_actions where action_type='medication_refusal_notice' and details->>'external_event_id'=pg_temp.id(402)::text),now()+interval '22 hours','editing a refusal duty cannot extend the original notification clock');

insert into public.resident_regulatory_actions(id,organization_id,facility_id,resident_id,action_type,recipient_role,anchor_at,reason,details)
 values(pg_temp.id(820),pg_temp.id(1),pg_temp.id(13),pg_temp.id(103),'alf_exception_request','department',now()-interval '7 days','Excludable condition request',
 '{"condition":"Continuous skilled nursing need","request_evidence":"Written DHS request filed","supporting_evidence":"Staff skills, accommodations and proposed care plan","certifier":"Qualified physician signed certification","request_decision":"submitted"}');
select throws_ok($$update public.resident_regulatory_actions set status='completed',completed_at=now(),evidence='Written denial retained',details=details||'{"determination":"denied","determination_evidence":"Written DHS denial","resident_decision":"retain"}' where id=pg_temp.id(820)$$,'23514',null,'denied excludable-condition exception cannot approve resident retention');
select lives_ok($$update public.resident_regulatory_actions set status='completed',completed_at=now(),evidence='Written approval retained',details=details||'{"determination":"approved","determination_evidence":"Written DHS approval with conditions","resident_decision":"retain"}' where id=pg_temp.id(820)$$,'approved exception records the written determination and disposition');

select lives_ok($$select public.record_protected_identity_supplement(pg_temp.id(103),'Emergency vault / resident folder','Nursing supervisor','Obtain protected supplement through emergency-transfer procedure',now()-interval '1 hour','Verified required identifying information in protected record')$$,'face sheet records external supplement verification without the identifier');
select is((select protected_identity_supplement->>'external_reference' from public.residents where id=pg_temp.id(103)),'Emergency vault / resident folder','protected external reference persists');
select throws_ok($$select public.record_protected_identity_supplement(pg_temp.id(103),'123-45-6789','Nursing supervisor','Obtain protected supplement through emergency-transfer procedure',now(),'Verified actual protected identifying record')$$,'23514',null,'supplement metadata rejects an SSN-shaped identifier');
select throws_ok($$select public.record_protected_identity_supplement(pg_temp.id(103),'Emergency vault / resident folder','Nursing supervisor','Obtain protected supplement through emergency-transfer procedure',now()+interval '1 hour','Verified actual protected identifying record')$$,'23514',null,'supplement cannot claim future verification');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.record_protected_identity_supplement(pg_temp.id(103),'Emergency vault / resident folder','Nursing supervisor','Obtain protected supplement through emergency-transfer procedure',now(),'Verified actual protected identifying record')$$,'42501',null,'supplement verification requires an authorized resident manager');

reset role;
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status) values(pg_temp.id(104),pg_temp.id(1),pg_temp.id(13),'Positive','TB',public.pa_today(),'active');
select pg_temp.doc(204,pg_temp.id(104));
select lives_ok($$update public.resident_regulatory_actions set status='completed',completed_at=now()-interval '5 years',evidence='Positive tuberculin result and chest X-ray retained',details=details||jsonb_build_object('document_id',pg_temp.id(204),'tb_result','positive_with_chest_xray','chest_xray_result','Dated chest X-ray report retained in the attached evidence') where resident_id=pg_temp.id(104) and action_type='resident_tb_test'$$,'positive TB evidence uses the chest X-ray alternative rather than a recent negative test');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(104) and action_type='resident_tb_test' and status='pending'),0,'positive TB result does not impose an unsupported repeated tuberculin test');
select * from finish();
rollback;

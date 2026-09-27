begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('b9280000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into public.organizations(id,name,slug,subscription_status)
values(pg_temp.id(1),'Resident calendar tests','resident-calendar-tests','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  (pg_temp.id(11),pg_temp.id(1),'Calendar PCH','PCH'),
  (pg_temp.id(12),pg_temp.id(1),'Calendar ALF','ALR');
select is(app_private.resident_cycle_next_due('2023-03-01','annual_reassessment',365,pg_temp.id(1),'PCH','standard'),
  '2024-03-01'::date,'annual reassessment spans the leap day as a calendar year');
select is(app_private.resident_cycle_next_due('2023-03-01','annual_medical_evaluation',365,pg_temp.id(1),'ALR','standard'),
  '2024-03-01'::date,'annual DME is a calendar year');
select is(app_private.resident_cycle_next_due('2026-01-31','support_plan_quarterly_review',90,pg_temp.id(1),'ALR','standard'),
  '2026-04-30'::date,'quarterly review clips to the final calendar day');
select is(app_private.resident_cycle_next_due('2026-03-01','support_plan_quarterly_review',90,pg_temp.id(1),'ALR','standard'),
  '2026-06-01'::date,'a quarter can exceed ninety days');
select is(app_private.resident_cycle_next_due('2026-03-01','initial_assessment_15day',15,pg_temp.id(1),'PCH','standard'),
  '2026-03-16'::date,'the explicit PCH fifteen-day admission deadline stays fixed days');

insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status) values
  (pg_temp.id(21),pg_temp.id(1),pg_temp.id(11),'Calendar','PCH','2023-03-01','active'),
  (pg_temp.id(22),pg_temp.id(1),pg_temp.id(12),'Calendar','ALF','2023-03-01','active');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(21) and item_type='annual_reassessment'),
  '2024-03-01'::date,'admission instantiation uses a calendar year');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values('00000000-0000-0000-0000-000000000000',pg_temp.id(101),'authenticated','authenticated','resident-calendar@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
values(pg_temp.id(101),pg_temp.id(1),'resident-calendar@test.local','Calendar','Admin','platform_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(101),'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);

create function pg_temp.attach(n integer,r uuid,kind text,equivalent boolean) returns uuid language plpgsql as $$
declare v public.resident_compliance_items%rowtype;
begin
  select * into v from public.resident_compliance_items where resident_id=r and item_type=kind and completed_date is null order by due_date,id limit 1;
  insert into public.resident_documents(id,organization_id,facility_id,resident_id,compliance_item_id,file_name,file_type,storage_path,is_state_form,state_form_source_label,equivalent_form_review)
  values(pg_temp.id(n),v.organization_id,v.facility_id,r,v.id,'completed.pdf','application/pdf',v.organization_id||'/'||v.facility_id||'/'||pg_temp.id(n)||'.pdf',not equivalent,
    case when not equivalent then 'PA DHS completed form' end,
    case when equivalent then '{"all_required_information":true,"reviewer_name":"Pat Reviewer","review_reference":"Signed comparison of each required DHS field retained with form"}'::jsonb end);
  return pg_temp.id(n);
end $$;
select pg_temp.attach(201,pg_temp.id(21),'initial_assessment_15day',true);
select is((select is_state_form from public.resident_documents where id=pg_temp.id(201)),false,'equivalent form is not falsely marked as an official DHS form');
select is((select equivalent_form_review->>'recorded_by' from public.resident_documents where id=pg_temp.id(201)),pg_temp.id(101)::text,'equivalence review records its actual actor');
select throws_ok($$update public.resident_documents set equivalent_form_review='{"all_required_information":true}' where id=pg_temp.id(201)$$,
  '23514',null,'equivalence review needs reviewer and comparison evidence');
select throws_ok($$select pg_temp.attach(202,pg_temp.id(21),'medical_evaluation',true)$$,
  '23514',null,'the assessment equivalent permission cannot bypass the DME prescribed form');
select throws_ok($$update public.resident_documents set compliance_item_id=(select id from public.resident_compliance_items where resident_id=pg_temp.id(22) and item_type='initial_assessment_15day') where id=pg_temp.id(201)$$,
  '23514',null,'a review cannot be linked to another resident item');
select lives_ok($$select public.complete_resident_compliance_item((select compliance_item_id from public.resident_documents where id=pg_temp.id(201)),pg_temp.id(201),'2023-03-10')$$,
  'a documented equivalent PCH assessment completes through the authorized RPC');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(21) and item_type='annual_reassessment' and completed_date is null),
  '2024-03-10'::date,'first annual assessment uses the actual initial assessment date');
select pg_temp.attach(204,pg_temp.id(22),'initial_assessment_15day',true);
select lives_ok($$select public.complete_resident_compliance_item((select compliance_item_id from public.resident_documents where id=pg_temp.id(204)),pg_temp.id(204),'2023-02-10')$$,
  'ALF equivalent initial assessment can be dated in its thirty-day preadmission window');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(22) and item_type='annual_reassessment' and completed_date is null),
  '2024-02-10'::date,'ALF first annual cycle starts from its preadmission initial assessment');

select pg_temp.attach(203,pg_temp.id(22),'medical_evaluation',false);
select lives_ok($$select public.complete_resident_compliance_item((select compliance_item_id from public.resident_documents where id=pg_temp.id(203)),pg_temp.id(203),'2023-03-01')$$,
  'the ordinary DME completion path still accepts the official form');
select is((select due_date from public.resident_compliance_items where resident_id=pg_temp.id(22) and item_type='annual_medical_evaluation' and completed_date is null),
  '2024-03-01'::date,'actual DME completion creates its successor with calendar arithmetic');

insert into public.resident_compliance_items(id,organization_id,facility_id,resident_id,item_type,due_date,grace_period_days)
values(pg_temp.id(301),pg_temp.id(1),pg_temp.id(11),pg_temp.id(21),'significant_change_reassessment',public.pa_today()+14,7);
select is((select due_date from public.resident_compliance_items where id=pg_temp.id(301)),null::date,'a product target is not recorded as a statutory due date');
select is((select internal_target_date from public.resident_compliance_items where id=pg_temp.id(301)),public.pa_today()+14,'the operational follow-up target remains visible');
select is((select grace_period_days from public.resident_compliance_items where id=pg_temp.id(301)),0,'no invented significant-change grace remains');
select public.recalculate_resident_compliance_statuses();
select is((select status from public.resident_compliance_items where id=pg_temp.id(301)),'missing','assessment remains required without a false statutory overdue date');
select public.register_outstanding_work_items();
select matches((select description from public.work_items where deduplication_key='resident-compliance:'||pg_temp.id(301)::text),
  'internal follow-up target, not a statutory deadline','work queue explains the operational target');

-- A campus PCH destination does not inherit the source ALF quarterly requirement.
update public.facilities set campus_identifier='calendar-campus' where id in(pg_temp.id(11),pg_temp.id(12));
insert into public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,admission_date,status) values
  (pg_temp.id(31),pg_temp.id(1),pg_temp.id(12),'Campus','Calendar','1940-01-01',public.pa_today()-180,'active'),
  (pg_temp.id(32),pg_temp.id(1),pg_temp.id(11),'Campus','Calendar','1940-01-01',public.pa_today(),'active');
select pg_temp.attach(401,pg_temp.id(31),'medical_evaluation',false);
select pg_temp.attach(402,pg_temp.id(31),'initial_assessment_15day',true);
select pg_temp.attach(403,pg_temp.id(31),'support_plan_30day',true);
select pg_temp.attach(404,pg_temp.id(32),'medical_evaluation',false);
select pg_temp.attach(405,pg_temp.id(32),'initial_assessment_15day',true);
select pg_temp.attach(406,pg_temp.id(32),'support_plan_30day',true);
update public.resident_compliance_items set completed_date=public.pa_today()-120,status='compliant'
where resident_id=pg_temp.id(31) and item_type in('medical_evaluation','initial_assessment_15day','support_plan_30day');
insert into public.resident_compliance_items(id,organization_id,facility_id,resident_id,item_type,due_date,completed_date,status)
values(pg_temp.id(410),pg_temp.id(1),pg_temp.id(12),pg_temp.id(31),'support_plan_quarterly_review',public.pa_today()-30,public.pa_today()-30,'compliant');
insert into public.resident_documents(id,organization_id,facility_id,resident_id,file_name,file_type,storage_path)
values(pg_temp.id(411),pg_temp.id(1),pg_temp.id(11),pg_temp.id(32),'addendum.pdf','application/pdf',pg_temp.id(1)||'/'||pg_temp.id(11)||'/addendum.pdf');
update public.residents set status='discharged',discharge_date=public.pa_today() where id=pg_temp.id(31);
create function pg_temp.campus_payload() returns jsonb language sql as $$
  select jsonb_object_agg(t.item_type,jsonb_build_object('source_item_id',s.id,'document_id',d.id))
  from public.resident_compliance_items t join public.resident_compliance_items s on s.item_type=t.item_type and s.resident_id=pg_temp.id(31)
  join public.resident_documents d on d.compliance_item_id=t.id
  where t.resident_id=pg_temp.id(32) and t.item_type in('medical_evaluation','initial_assessment_15day','support_plan_30day')
$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.carry_campus_resident_evidence(pg_temp.id(32),pg_temp.id(31),pg_temp.id(411),pg_temp.campus_payload())$$,
  'PCH campus admission accepts eligible equivalent evidence without an ALF quarterly copy');
select is((select count(*)::integer from public.resident_compliance_items where resident_id=pg_temp.id(32) and item_type='support_plan_quarterly_review'),
  0,'PCH destination does not acquire an ALF quarterly cycle');

-- An ALF destination must carry the latest quarter. The receiving review is
-- validated atomically when the previously generic copy is linked to its item.
insert into public.facilities(id,organization_id,name,facility_type,campus_identifier)
values(pg_temp.id(13),pg_temp.id(1),'Second campus ALF','ALR','calendar-campus');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,admission_date,status)
values(pg_temp.id(33),pg_temp.id(1),pg_temp.id(13),'Campus','Calendar','1940-01-01',public.pa_today(),'active');
select pg_temp.attach(421,pg_temp.id(33),'medical_evaluation',false);
select pg_temp.attach(422,pg_temp.id(33),'initial_assessment_15day',true);
select pg_temp.attach(423,pg_temp.id(33),'support_plan_30day',true);
insert into public.resident_documents(id,organization_id,facility_id,resident_id,compliance_item_id,file_name,file_type,storage_path,is_state_form,state_form_source_label)
values(pg_temp.id(424),pg_temp.id(1),pg_temp.id(12),pg_temp.id(31),pg_temp.id(410),'quarter.pdf','application/pdf',pg_temp.id(1)||'/'||pg_temp.id(12)||'/source-quarter.pdf',true,'PA DHS completed ASP');
insert into public.resident_documents(id,organization_id,facility_id,resident_id,file_name,file_type,storage_path)
values(pg_temp.id(425),pg_temp.id(1),pg_temp.id(13),pg_temp.id(33),'quarter.pdf','application/pdf',pg_temp.id(1)||'/'||pg_temp.id(13)||'/quarter.pdf'),
  (pg_temp.id(426),pg_temp.id(1),pg_temp.id(13),pg_temp.id(33),'addendum.pdf','application/pdf',pg_temp.id(1)||'/'||pg_temp.id(13)||'/addendum.pdf');
create function pg_temp.alf_payload(review jsonb) returns jsonb language sql as $$
  select jsonb_object_agg(t.item_type,jsonb_build_object('source_item_id',s.id,'document_id',d.id))
    ||jsonb_build_object('support_plan_quarterly_review',jsonb_build_object('source_item_id',pg_temp.id(410),'document_id',pg_temp.id(425),'equivalent_form_review',review))
  from public.resident_compliance_items t join public.resident_compliance_items s on s.item_type=t.item_type and s.resident_id=pg_temp.id(31)
  join public.resident_documents d on d.compliance_item_id=t.id
  where t.resident_id=pg_temp.id(33) and t.item_type in('medical_evaluation','initial_assessment_15day','support_plan_30day')
$$;
select throws_ok($$select public.carry_campus_resident_evidence(pg_temp.id(33),pg_temp.id(31),pg_temp.id(426),pg_temp.alf_payload('{"all_required_information":true}'))$$,
  '23514',null,'incomplete deferred review cannot bypass validation in the campus transaction');
select is((select campus_transfer_evidence from public.residents where id=pg_temp.id(33)),null::jsonb,'invalid quarterly evidence rolls back the full carry');
select lives_ok($$select public.carry_campus_resident_evidence(pg_temp.id(33),pg_temp.id(31),pg_temp.id(426),pg_temp.alf_payload('{"all_required_information":true,"reviewer_name":"Pat Reviewer","review_reference":"Compared every required ASP field with signed receiving copy"}'))$$,
  'complete deferred review is accepted through atomic quarterly linking');
select ok((select compliance_item_id is not null and equivalent_form_review->>'recorded_at' is not null and not is_state_form from public.resident_documents where id=pg_temp.id(425)),
  'quarterly equivalent evidence is linked and stamped without becoming an official form');

-- A saved tenant rule is not silently reinterpreted as a statutory default.
insert into public.resident_compliance_rule_packs(organization_id,state,facility_type,admission_track,item_type,offset_basis,offset_days,renewal_interval_days,grace_period_days,warning_days,is_active,instantiate_on_admission)
values(pg_temp.id(1),'PA','ALR','standard','support_plan_quarterly_review','after_admission',90,90,5,14,true,false);
select is(app_private.resident_cycle_next_due('2026-03-01','support_plan_quarterly_review',90,pg_temp.id(1),'ALR','standard'),
  '2026-05-30'::date,'an explicit tenant ninety-day rule keeps its saved interval');
select * from finish();
rollback;

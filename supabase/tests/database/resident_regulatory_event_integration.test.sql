begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('d2260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.organizations(id,name,slug,subscription_status,trial_ends_at,package_id)
 select pg_temp.id(1),'Regulatory event test','regulatory-event-test','trial',now()-interval '1 day',id from public.packages where name='CareMetric Train';
insert into public.organizations(id,name,slug) values(pg_temp.id(2),'Other event tenant','regulatory-event-other');
insert into public.facilities(id,organization_id,name,facility_type) values
 (pg_temp.id(11),pg_temp.id(1),'Scoped PCH','PCH'),(pg_temp.id(12),pg_temp.id(1),'Unassigned PCH','PCH'),(pg_temp.id(13),pg_temp.id(2),'Other tenant PCH','PCH');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(pg_temp.id(101),'authenticated','authenticated','regulatory-events@test.local','x',now(),'{}','{}',now(),now());
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active)
 values(pg_temp.id(101),pg_temp.id(1),'regulatory-events@test.local','Event','Manager','facility_manager',true)
 on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.facility_assignments(profile_id,facility_id) values(pg_temp.id(101),pg_temp.id(11));
insert into app_private.module_access_terms(organization_id,module_key,source,reason) values(pg_temp.id(1),'modules.train','complimentary','Regulatory event boundary fixture');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status,date_of_birth)
 select pg_temp.id(n),pg_temp.id(1),pg_temp.id(11),'Resident',n::text,public.pa_today()-60,'active','1940-01-01'::date from generate_series(201,207)n;
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status)
 values(pg_temp.id(208),pg_temp.id(1),pg_temp.id(12),'Other','Facility',public.pa_today()-60,'active');
create function pg_temp.act_as(p_aal text default 'aal2') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(101),'role','authenticated','aal',p_aal,'iat',extract(epoch from now())::bigint)::text,true); set local role authenticated; end $$;
create temporary table event_ids(key text primary key,id uuid) on commit drop;
grant all on event_ids to authenticated;
select pg_temp.act_as();
select throws_ok($$select public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>pg_temp.id(201),p_event_type=>'departure_plan',p_event_at=>now()+interval '40 days',p_reason=>'Facility initiated move',p_evidence=>'Case review record',p_details=>'{"initiator":"facility","destination":"Receiving home"}')$$,'42501',null,'Train-only caller cannot create resident regulatory events');
reset role;
insert into app_private.module_access_terms(organization_id,module_key,source,reason) values(pg_temp.id(1),'modules.carebase','contract','Resident event positive control');
select pg_temp.act_as('aal1');
select throws_ok($$select public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>pg_temp.id(201),p_event_type=>'departure_plan',p_event_at=>now()+interval '40 days',p_reason=>'Facility initiated move',p_evidence=>'Case review record',p_details=>'{"initiator":"facility","destination":"Receiving home"}')$$,'42501',null,'regulatory command requires current privileged assurance');
select pg_temp.act_as();
select throws_ok($$select public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(12),p_resident_id=>pg_temp.id(208),p_event_type=>'departure_plan',p_event_at=>now()+interval '40 days',p_reason=>'Facility initiated move',p_evidence=>'Case review record',p_details=>'{"initiator":"facility","destination":"Receiving home"}')$$,'42501',null,'facility manager cannot operate an unassigned home');
select throws_ok($$select public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>pg_temp.id(208),p_event_type=>'departure_plan',p_event_at=>now()+interval '40 days',p_reason=>'Facility initiated move',p_evidence=>'Case review record',p_details=>'{"initiator":"facility","destination":"Receiving home"}')$$,'23514',null,'event cannot associate a different facility resident');
insert into event_ids values('plan',public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>pg_temp.id(201),p_event_type=>'departure_plan',p_event_at=>now()+interval '40 days',p_reason=>'Facility initiated move',p_evidence=>'Case review and proposed written notices',p_details=>'{"initiator":"facility","destination":"Receiving home"}'));
select is((select count(*)::integer from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='plan')),3,'planned facility departure creates independently completable recipient duties');
select is((select array_agg(recipient_role order by recipient_role) from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='plan')),array['designated_person','referral_agent','resident']::text[],'resident, designated person and referral agent each get a notice');
select is((select count(*)::integer from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='plan') and status='pending' and completed_at is null),3,'planning a departure never invents delivery');
select throws_ok($$update public.resident_regulatory_actions set anchor_at=anchor_at+interval '1 day' where source_event_id=(select id from event_ids where key='plan')$$,'23514',null,'pending source-backed deadline cannot be moved');
select throws_ok($$update public.resident_regulatory_actions set source_event_id=null where source_event_id=(select id from event_ids where key='plan')$$,'23514',null,'source evidence cannot be disconnected');
select throws_ok($$update public.resident_regulatory_events set reason='Changed trigger' where id=(select id from event_ids where key='plan')$$,'42501',null,'browser cannot mutate immutable regulatory events');
insert into event_ids values('voluntary',public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>pg_temp.id(202),p_event_type=>'departure_plan',p_event_at=>now(),p_reason=>'Resident requested departure',p_evidence=>'Signed voluntary departure request',p_details=>'{"initiator":"resident","destination":"Family home"}'));
select is((select count(*)::integer from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='voluntary')),0,'documented voluntary departure does not create facility-initiated advance notices');
select lives_ok($$select public.transition_resident_census(pg_temp.id(202),'discharged',null,'Voluntary resident departure')$$,'actual departure remains recordable');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(202) and action_type='discharge_notice'),0,'voluntary census exit uses its recorded plan');
select lives_ok($$select public.transition_resident_census(pg_temp.id(203),'discharged',null,'Actual departure without a recorded plan')$$,'missing advance notice does not prevent truthful census exit');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(203) and action_type='discharge_notice' and details->>'initiator'='unknown'),3,'unknown basis creates three duties for explicit notice applicability review');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(203) and action_type in ('itemized_funds_account','refund_due','personal_needs_refund') and status='pending'),3,'census departure produces financial duties without assuming payment');
select is((select status from public.resident_regulatory_actions where resident_id=pg_temp.id(203) and action_type='transfer_record'),'completed','actual census departure records its dated transfer evidence');
select public.transition_resident_census(pg_temp.id(204),'hospital_leave',null,'Temporary hospital visit');
select throws_ok($$insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,source_census_event_id)
 select organization_id,facility_id,resident_id,'refund_due',effective_at,'Attempt to use temporary absence as departure',id from public.resident_census_events where resident_id=pg_temp.id(204) and resulting_status='hospital_leave'$$,'23514',null,'temporary census absence cannot be presented as a discharge refund source');
select public.transition_resident_census(pg_temp.id(204),'active',null,'Returned from temporary hospital visit');

-- Contract version/signature integration exercises the actual publishing commands.
insert into event_ids select 'agreement',(public.publish_resident_agreement_version(pg_temp.id(204),'resident_home_contract','Resident home contract','Original','Complete canonical contract terms for the resident and designated person.',now(),array['resident','designated_person'])->>'agreementId')::uuid;
insert into event_ids select 'version1',current_version_id from public.resident_agreements where id=(select id from event_ids where key='agreement');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(204) and action_type='contract_change_notice'),0,'initial contract publication is not an amendment');
select throws_ok($$insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,source_agreement_version_id)
 select organization_id,facility_id,resident_id,'contract_change_notice',effective_at,'Attempt to treat initial terms as amendment',id from public.resident_agreement_versions where id=(select id from event_ids where key='version1')$$,'23514',null,'initial contract version cannot be used as an amendment notice source');
insert into event_ids values('refused_signature',public.record_resident_agreement_outcome((select id from event_ids where key='version1'),'refused','Other Observer','other','Observer',null,'staff_session','I decline to sign this contract version.','Observer declined signature','Witness Staff','Staff witness','event-test-device',null,null));
select throws_ok($$insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,source_signature_id)
 select organization_id,facility_id,resident_id,'contract_rescission_window',signed_at,'Attempt to start a right from a refusal',id from public.resident_agreement_signatures where id=(select id from event_ids where key='refused_signature')$$,'23514',null,'a refusal is not a signed contract rescission source');
insert into event_ids values('signature1',public.record_resident_agreement_outcome((select id from event_ids where key='version1'),'signed','Resident Four','resident','Self',null,'staff_session','I reviewed and sign this exact contract version.',null,'Witness Staff','Staff witness','event-test-device',null,null));
select is((select due_at from public.resident_regulatory_actions where source_signature_id=(select id from event_ids where key='signature1')),now()+interval '72 hours','first actual signature starts the 72-hour rescission window');
insert into event_ids values('signature2',public.record_resident_agreement_outcome((select id from event_ids where key='version1'),'signed','Designated Person','designated_person','Family','Authorized designated person','staff_session','I reviewed and sign this exact contract version.',null,'Witness Staff','Staff witness','event-test-device',null,null));
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(204) and action_type='contract_rescission_window'),1,'a second signer does not reset or duplicate the original rescission clock');
select throws_ok($$insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,source_signature_id)
 select organization_id,facility_id,resident_id,'contract_rescission_window',signed_at,'Attempt to restart clock using second signer',id from public.resident_agreement_signatures where id=(select id from event_ids where key='signature2')$$,'23514',null,'direct action inserts cannot reset rescission through a second signer');
select public.publish_resident_agreement_version(pg_temp.id(204),'resident_home_contract','Resident home contract','Amended','Amended canonical contract terms with the planned rate and service changes.',now()+interval '40 days',array['resident'],(select id from event_ids where key='agreement'),null,'Documented revised service arrangement');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(204) and action_type='contract_change_notice' and source_agreement_version_id is not null),1,'publishing an amended contract opens its source-linked advance notice');
insert into event_ids select 'version2',current_version_id from public.resident_agreements where id=(select id from event_ids where key='agreement');
select public.publish_resident_agreement_version(pg_temp.id(204),'resident_home_contract','Resident home contract','Third revision','Further revised canonical contract terms for a later planned change.',now()+interval '60 days',array['resident'],(select id from event_ids where key='agreement'),null,'Later revised service arrangement');
select lives_ok($$update public.resident_regulatory_actions set status='completed',completed_at=now(),evidence='Written delivery receipt retained for this historical amendment'
 where source_agreement_version_id=(select id from event_ids where key='version2')$$,'superseded contract version retains a completable historical notice');
select lives_ok($$update public.resident_regulatory_actions set reason='Initial signed contract reviewed after the later amendments'
 where source_signature_id=(select id from event_ids where key='signature1')$$,'original rescission source remains editable after another signer and later agreement revisions');
insert into event_ids select 'privacy_agreement',(public.publish_resident_agreement_version(pg_temp.id(204),'privacy_acknowledgement','Privacy acknowledgement','Original','Privacy acknowledgement terms are separate from the resident home contract.',now(),array['resident'])->>'agreementId')::uuid;
insert into event_ids select 'privacy_version',current_version_id from public.resident_agreements where id=(select id from event_ids where key='privacy_agreement');
insert into event_ids values('privacy_signature',public.record_resident_agreement_outcome((select id from event_ids where key='privacy_version'),'signed','Resident Four','resident','Self',null,'staff_session','I acknowledge these privacy terms.',null,'Witness Staff','Staff witness','event-test-device',null,null));
select throws_ok($$insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,source_signature_id)
 select organization_id,facility_id,resident_id,'contract_rescission_window',signed_at,'Attempt to use a privacy acknowledgement signature',id from public.resident_agreement_signatures where id=(select id from event_ids where key='privacy_signature')$$,'23514',null,'a signed non-contract acknowledgement cannot start contract rescission');

-- Settlements are connected whichever evidence is recorded first.
select public.open_resident_personal_fund_account(pg_temp.id(205),public.pa_today()-30,25,true,null);
select public.transition_resident_census(pg_temp.id(205),'discharged',null,'Resident moved to another home');
select public.close_resident_personal_fund_account(pg_temp.id(205),'Final personal funds return','Resident recipient',now(),null);
insert into event_ids values('cleared_early',public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>pg_temp.id(205),p_event_type=>'room_cleared',p_event_at=>now(),p_reason=>'Belongings collected',p_evidence=>'Property release receipt retained'));
select is((select status from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='cleared_early')),'completed','previously recorded actual settlement satisfies the later-recorded room clearance duty');
select is((select completed_at from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='cleared_early')),now(),'settlement uses actual transaction time');
select public.open_resident_personal_fund_account(pg_temp.id(206),public.pa_today()-30,35,true,null);
select public.transition_resident_census(pg_temp.id(206),'discharged',null,'Resident moved to family home');
insert into event_ids values('cleared_late',public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>pg_temp.id(206),p_event_type=>'room_cleared',p_event_at=>now(),p_reason=>'Belongings collected',p_evidence=>'Property release receipt retained'));
select is((select status from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='cleared_late')),'pending','room clearance does not itself assert funds were returned');
select public.close_resident_personal_fund_account(pg_temp.id(206),'Final personal funds return','Resident recipient',now(),null);
select is((select status from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='cleared_late')),'completed','later settlement closes the previously pending managed-funds duty');
select is((select status from public.resident_regulatory_actions where resident_id=pg_temp.id(206) and action_type='itemized_funds_account'),'pending','settlement does not pretend that the itemized statement was sent');
select public.transition_resident_census(pg_temp.id(207),'deceased',null,'Resident death documented');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(207) and action_type in ('refund_due','personal_needs_refund')),0,'death does not start the discharge refund clocks');
select throws_ok($$insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,source_census_event_id)
 select organization_id,facility_id,resident_id,'refund_due',effective_at,'Attempt to use death as a discharge refund trigger',id from public.resident_census_events where resident_id=pg_temp.id(207) and resulting_status='deceased'$$,'23514',null,'death cannot be relabeled as the discharge-based refund clock');
insert into event_ids values('death_room',public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>pg_temp.id(207),p_event_type=>'room_cleared',p_event_at=>now(),p_reason=>'Personal property released to estate',p_evidence=>'Estate property handoff receipt retained'));
select is((select recipient_role from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='death_room')),'estate','death refund is addressed to the estate');
select is((select due_at from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='death_room')),((now() at time zone 'America/New_York')+interval '30 days') at time zone 'America/New_York','death refund is due 30 calendar days after actual room clearance');

insert into event_ids values('closure_plan',public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>null,p_event_type=>'facility_closure_plan',p_event_at=>now()+interval '90 days',p_reason=>'Planned facility closure',p_evidence=>'Closure plan and relocation evidence'));
select is((select count(*)::integer from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='closure_plan') and action_type='closure_resident_notice'),6,'closure plan opens three notices for each of the two remaining residents');
select is((select count(*)::integer from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='closure_plan') and action_type='closure_department_notice'),1,'closure plan separately requires the Department notice');
select throws_ok($$select public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>null,p_event_type=>'facility_closed',p_event_at=>now(),p_reason=>'Actual facility closure',p_evidence=>'License return and closure record')$$,'23514',null,'actual closure requires recorded resident relocation');
select public.transition_resident_census(pg_temp.id(201),'discharged',null,'Closure relocation completed');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(201) and action_type='discharge_notice' and source_census_event_id is not null and status='pending'),3,'an earlier actual departure opens review duties on the actual timeline while preserving original planned notices');
select is((select count(*)::integer from public.resident_regulatory_actions where resident_id=pg_temp.id(201) and action_type='discharge_notice' and source_event_id=(select id from event_ids where key='plan')),3,'actual-date review retains the original planned notice evidence');
select public.transition_resident_census(pg_temp.id(204),'discharged',null,'Closure relocation completed');
insert into event_ids values('closed',public.record_resident_regulatory_event(p_facility_id=>pg_temp.id(11),p_resident_id=>null,p_event_type=>'facility_closed',p_event_at=>now(),p_reason=>'Actual facility closure',p_evidence=>'All residents relocated and license return arranged'));
select is((select action_type from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='closed')),'closure_license_return','actual closure creates its separately tracked license return');
select is((select completed_at from public.resident_regulatory_actions where source_event_id=(select id from event_ids where key='closed')),null::timestamptz,'closure never fabricates license return completion');
reset role;
select ok(exists(select 1 from public.audit_logs where entity_type='resident_regulatory_events' and entity_id=(select id::text from event_ids where key='plan')),'event creation is included in immutable audit history');
insert into public.resident_regulatory_events(organization_id,facility_id,event_type,event_at,reason,evidence) values(pg_temp.id(2),pg_temp.id(13),'facility_closure_plan',now()+interval '90 days','Other tenant closure','Separate tenant source evidence');
select pg_temp.act_as();
select is((select count(*)::integer from public.resident_regulatory_events where organization_id=pg_temp.id(2)),0,'event RLS excludes another tenant');
select is((select count(*)::integer from public.resident_regulatory_events where facility_id=pg_temp.id(12)),0,'event RLS excludes unassigned facilities');
reset role;
select * from finish();
rollback;

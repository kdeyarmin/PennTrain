begin;
select plan(26);
insert into public.organizations(id,name,slug) values('e3900000-0000-4000-8000-000000001001','Site Lifecycle','site-lifecycle');
insert into public.facilities(id,organization_id,name,facility_type) values
('e3900000-0000-4000-8000-000000001011','e3900000-0000-4000-8000-000000001001','Site PCH','PCH'),
('e3900000-0000-4000-8000-000000001012','e3900000-0000-4000-8000-000000001001','Site ALF','ALR');
insert into public.inspection_items(id,organization_id,facility_id,item_kind,item_type,label,inspection_interval_days) values
('e3900000-0000-4000-8000-000000001101','e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','procedural','fire_drill_program','Drills',30),
('e3900000-0000-4000-8000-000000001102','e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','procedural','fire_safety_approval','Approval',365),
('e3900000-0000-4000-8000-000000001103','e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','equipment','bedside_mobility_device','Bed rail',30),
('e3900000-0000-4000-8000-000000001104','e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','procedural','voice_controlled_device_policy','Voice device',30);
insert into public.inspection_events(id,inspection_item_id,performed_date,performed_by,result,drill_time,alarm_sounded,alarm_or_detector_operative,evacuation_duration_seconds)
values('e3900000-0000-4000-8000-000000001201','e3900000-0000-4000-8000-000000001101',public.pa_today(),'Fire trainer','fail','14:00',true,true,200);
select is((select last_inspected_date from public.inspection_items where id='e3900000-0000-4000-8000-000000001101'),null::date,'strict default does not count failed drills');
insert into public.facility_site_policies(facility_id,organization_id,count_unsuccessful_pch_drills,inspection_grace,rationale)
values('e3900000-0000-4000-8000-000000001011','e3900000-0000-4000-8000-000000001001',true,'rcg','PCH RCG policy reviewed by administrator');
select is((select last_inspected_date from public.inspection_items where id='e3900000-0000-4000-8000-000000001101'),public.pa_today(),'explicit PCH counting policy rolls frequency forward');
select ok((select evacuation_time_exceeded from public.inspection_events where id='e3900000-0000-4000-8000-000000001201'),'counting a drill does not erase the evacuation violation');
select is(app_private.site_inspection_grace('e3900000-0000-4000-8000-000000001011','furnace_inspection'),15,'annual eligible inspection grace is 15 days');
select is(app_private.site_inspection_grace('e3900000-0000-4000-8000-000000001011','smoke_detector'),5,'subannual eligible grace is five days');
select is(app_private.site_inspection_grace('e3900000-0000-4000-8000-000000001011','fire_extinguisher'),0,'extinguisher has no grace');
select is(app_private.site_inspection_grace('e3900000-0000-4000-8000-000000001011','fire_drill_program'),0,'monthly drill has no grace');
select throws_ok($$insert into public.facility_site_policies(facility_id,organization_id,count_unsuccessful_pch_drills,rationale) values('e3900000-0000-4000-8000-000000001012','e3900000-0000-4000-8000-000000001001',true,'PCH wording cannot be silently applied to ALF')$$,'23514',null,'PCH unsuccessful interpretation cannot apply to ALF');
select throws_ok($$delete from public.inspection_items where id='e3900000-0000-4000-8000-000000001101'$$,'23503',null,'deleting the program cannot cascade away drill evidence');

insert into public.facility_site_reviews(id,organization_id,facility_id,review_type,inspection_item_id,event_kind,occurred_at,evidence)
values('e3900000-0000-4000-8000-000000001301','e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','fire_approval','e3900000-0000-4000-8000-000000001102','restricted',now()-interval '3 days','Fire authority restricted west wing; notices pending');
select throws_ok($$update public.facility_site_reviews set evidence='Replace recorded evidence' where id='e3900000-0000-4000-8000-000000001301'$$,'23514',null,'site evidence cannot be rewritten');
select throws_ok($$delete from public.facility_site_reviews where id='e3900000-0000-4000-8000-000000001301'$$,'23514',null,'site evidence cannot be deleted even by the table owner');
select throws_ok($$truncate public.facility_site_reviews$$,'23514',null,'site evidence refuses TRUNCATE as well as row deletion');
select ok(not has_table_privilege('authenticated','public.facility_site_reviews','DELETE'),'browser cannot delete site history');
select throws_ok($$insert into public.facility_site_reviews(organization_id,facility_id,review_type,inspection_item_id,event_kind,occurred_at,evidence,supersedes_id)
values('e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','fire_approval','e3900000-0000-4000-8000-000000001102','restricted',now(),'Moving the deadline is not a correction','e3900000-0000-4000-8000-000000001301')$$,'23514',null,'notice follow-up cannot reset its event clock');
select throws_ok($$insert into public.facility_site_reviews(organization_id,facility_id,review_type,inspection_item_id,event_kind,occurred_at,evidence,supersedes_id)
values('e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','fire_approval','e3900000-0000-4000-8000-000000001102','renewed',now(),'Renewal must not conceal pending notices','e3900000-0000-4000-8000-000000001301')$$,'23514',null,'later approval cannot hide pending notices');
select lives_ok($$insert into public.facility_site_reviews(organization_id,facility_id,review_type,inspection_item_id,event_kind,occurred_at,evidence,supersedes_id,details)
select organization_id,facility_id,review_type,inspection_item_id,event_kind,occurred_at,'Oral and written notices delivered; late written notice retained',id,jsonb_build_object('oral_notified_at',occurred_at,'oral_notified_at_evidence','Called DHS licensing office','written_notified_at',now(),'written_notified_at_evidence','Sent signed letter to licensing office') from public.facility_site_reviews where id='e3900000-0000-4000-8000-000000001301'$$,'actual late completion may be appended without erasing original deadline');
select throws_ok($$insert into public.facility_site_reviews(organization_id,facility_id,review_type,inspection_item_id,occurred_at,evidence)
values('e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001012','fire_approval','e3900000-0000-4000-8000-000000001102',now(),'Cross facility evidence must be rejected')$$,'23514',null,'inspection evidence cannot cross facilities');
select throws_ok($$insert into public.facility_site_reviews(organization_id,facility_id,review_type,inspection_item_id,occurred_at,evidence)
values('e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','bedside_device','e3900000-0000-4000-8000-000000001103',now(),'An unlinked checklist does not prove a support plan')$$,'23514',null,'bedside review requires an actual resident and approved support plan');
select throws_ok($$insert into public.facility_site_reviews(organization_id,facility_id,review_type,inspection_item_id,occurred_at,evidence,details)
values('e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','voice_device','e3900000-0000-4000-8000-000000001104',now(),'No resident contract linked',jsonb_build_object('ownership','resident','policy_notice','written notice','consent_privacy','consent reviewed','contract_terms','terms stated','review_procedure','annual policy review'))$$,'23514',null,'resident-owned voice device requires a resident contract link');
select throws_ok($$insert into public.facility_site_reviews(organization_id,facility_id,review_type,inspection_item_id,occurred_at,evidence,details,next_review_on)
values('e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','voice_device','e3900000-0000-4000-8000-000000001104',now(),'Missing facility safeguards',jsonb_build_object('ownership','facility','policy_notice','written notice','consent_privacy','consent reviewed','contract_terms','terms stated','review_procedure','annual policy review'),public.pa_today()+30)$$,'23514',null,'facility voice device requires administrators, notice, deletion and disclosure safeguards');
select lives_ok($$insert into public.facility_site_reviews(organization_id,facility_id,review_type,inspection_item_id,occurred_at,evidence,details,next_review_on)
values('e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001011','voice_device','e3900000-0000-4000-8000-000000001104',now(),'Facility voice policy reviewed',jsonb_build_object('ownership','facility','policy_notice','written notice','consent_privacy','consent reviewed','contract_terms','terms stated','review_procedure','annual policy review','administrators','Administrator Jane','posted_notice','Notice posted at entrance','history_deletion','History deleted weekly','disclosure_policy','No disclosure except required by law'),public.pa_today()+30)$$,'complete facility voice safeguard review is recorded');
select is((select count(*)::integer from app_private.product_module_resources where resource_name in ('facility_site_reviews','facility_site_policies') and module_key='modules.carebase'),2,'both new resources enforce CareBase entitlement');
select is((select count(*)::integer from app_private.audit_entity_manifest where table_name in ('facility_site_reviews','facility_site_policies') and audit_mode='row_trigger'),2,'both resources register their row audit coverage');
insert into public.inspection_items(id,organization_id,facility_id,item_kind,item_type,label,inspection_interval_days)
values('e3900000-0000-4000-8000-000000001105','e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001012','procedural','fire_safety_approval','ALF approval',365);
insert into public.training_documents(id,organization_id,facility_id,file_name,storage_bucket,storage_path,file_type)
values('e3900000-0000-4000-8000-000000001401','e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001012','Approval.pdf','external-uploads','e3900000-0000-4000-8000-000000001001/e3900000-0000-4000-8000-000000001012/approval.pdf','application/pdf');
select throws_ok($$insert into public.facility_site_reviews(organization_id,facility_id,review_type,inspection_item_id,occurred_at,evidence,details)
values('e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001012','fire_approval','e3900000-0000-4000-8000-000000001105',now(),'Reviewed the existing fire approval',jsonb_build_object('approval_document_id','e3900000-0000-4000-8000-000000001401'))$$,'23514',null,'review date cannot substitute for actual approval issue date');
select lives_ok($$insert into public.facility_site_reviews(id,organization_id,facility_id,review_type,inspection_item_id,occurred_at,evidence,details)
values('e3900000-0000-4000-8000-000000001302','e3900000-0000-4000-8000-000000001001','e3900000-0000-4000-8000-000000001012','fire_approval','e3900000-0000-4000-8000-000000001105',now(),'Reviewed actual issued approval',jsonb_build_object('approval_document_id','e3900000-0000-4000-8000-000000001401','approval_issued_on',(public.pa_today()-interval '2 years')::date))$$,'approval can be reviewed against its actual issue date');
select is((select next_review_on from public.facility_site_reviews where id='e3900000-0000-4000-8000-000000001302'),((public.pa_today()-interval '2 years')::date+interval '3 years')::date,'three-year term begins at issue date, not today review date');
select * from finish();
rollback;

begin;
select plan(41);
select is(public.inspection_item_next_due_date('furnace_inspection',365,date '2027-03-01',date '2027-01-01'),date '2028-03-01','annual site review spans leap day without a premature deadline');
select is(public.inspection_item_next_due_date('smoke_detector',30,date '2026-07-01',date '2026-01-01'),date '2026-08-31','a July test permits the next test anywhere in August');
select is(public.inspection_item_next_due_date('fire_alarm_system',31,date '2026-01-01',date '2026-01-01'),date '2026-02-28','alarm testing follows each calendar month including February');
select is(public.inspection_item_next_due_date('smoke_detector',30,null,date '2026-07-01'),date '2026-07-31','initial monthly test is due in the anchor month');
select is(public.inspection_item_next_due_date('smoke_detector',14,date '2026-07-01',date '2026-01-01'),date '2026-07-15','a deliberately shorter facility test schedule remains intact');
select is(public.inspection_item_next_due_date('private_water_coliform_test',90,date '2026-05-01',date '2026-01-01'),date '2026-08-01','quarterly water baseline means three calendar months');
select is(public.inspection_item_next_due_date('furnace_inspection',180,date '2026-01-01',date '2026-01-01'),date '2026-06-30','an explicitly shorter facility inspection interval stays intact');
select is(public.inspection_item_next_due_date('other_equipment',365,date '2027-03-01',date '2027-01-01'),date '2028-02-29','unrelated fixed-day schedules are not converted to regulatory calendar periods');
insert into public.organizations(id,name,slug) values('e9270000-0000-4000-8000-000000000001','Chapter Site Defaults','chapter-site-defaults');
insert into public.facilities(id,organization_id,name,facility_type) values
('e9270000-0000-4000-8000-000000000011','e9270000-0000-4000-8000-000000000001','PCH baseline','PCH'),
('e9270000-0000-4000-8000-000000000012','e9270000-0000-4000-8000-000000000001','ALF baseline','ALR'),
('e9270000-0000-4000-8000-000000000013','e9270000-0000-4000-8000-000000000001','Unrelated nursing home license','NH'),
('e9270000-0000-4000-8000-000000000014','e9270000-0000-4000-8000-000000000001','Unrelated home health license','HHA'),
('e9270000-0000-4000-8000-000000000015','e9270000-0000-4000-8000-000000000001','Unrelated hospice license','HOS'),
('e9270000-0000-4000-8000-000000000016','e9270000-0000-4000-8000-000000000001','Unrelated group home license','GH');
select is(app_private.site_inspection_grace('e9270000-0000-4000-8000-000000000011','furnace_inspection'),15,'unsaved PCH uses annual RCG grace');
select is(app_private.site_inspection_grace('e9270000-0000-4000-8000-000000000012','smoke_detector'),5,'unsaved ALF uses applicable shorter-interval grace');
select is(app_private.site_inspection_grace('e9270000-0000-4000-8000-000000000011','fire_drill_program'),0,'monthly PCH drill never receives general grace');
select is(app_private.site_inspection_grace('e9270000-0000-4000-8000-000000000012','fire_extinguisher'),0,'ALF extinguisher never receives general grace');
select is(app_private.site_inspection_grace('e9270000-0000-4000-8000-000000000013','furnace_inspection'),0,'PCH/ALF grace does not leak to unrelated licenses');
select lives_ok($$insert into public.inspection_items(organization_id,facility_id,item_type,item_kind,label,inspection_interval_days)
  values('e9270000-0000-4000-8000-000000000001','e9270000-0000-4000-8000-000000000011','fireplace_chimney_service','equipment','Voluntary PCH chimney service',730)$$,
  'a voluntary PCH chimney schedule does not inherit the ALF annual maximum');
select lives_ok($$insert into public.inspection_items(organization_id,facility_id,item_type,item_kind,label,inspection_interval_days)
  values('e9270000-0000-4000-8000-000000000001','e9270000-0000-4000-8000-000000000012','fireplace_chimney_service','equipment','ALF chimney service',365)$$,
  'the ALF annual chimney baseline is accepted');
select throws_ok($$update public.inspection_items set inspection_interval_days=730 where label='ALF chimney service'$$,
  '23514',null,'the ALF annual chimney maximum remains enforced on updates');
select throws_ok($$insert into public.inspection_items(organization_id,facility_id,item_type,item_kind,label,inspection_interval_days)
  values('e9270000-0000-4000-8000-000000000001','e9270000-0000-4000-8000-000000000012','fireplace_chimney_service','equipment','Overlong ALF chimney service',730)$$,
  '23514',null,'the ALF annual chimney maximum remains enforced on inserts');
select lives_ok($$update public.inspection_items set inspection_interval_days=1095 where label='Voluntary PCH chimney service'$$,
  'a voluntary PCH chimney interval can also be updated without an ALF maximum');
-- The PCH exception must not weaken unrelated markets through direct writes.
select throws_ok(format($$insert into public.inspection_items(organization_id,facility_id,item_type,item_kind,label,inspection_interval_days)
  values(%L,%L,'fireplace_chimney_service','equipment',%L,730)$$,organization_id,id,facility_type||' overlong chimney service'),
  '23514',null,facility_type||' retains the existing chimney maximum on inserts')
from public.facilities where organization_id='e9270000-0000-4000-8000-000000000001' and facility_type in ('NH','HHA','HOS','GH');
select lives_ok(format($$insert into public.inspection_items(organization_id,facility_id,item_type,item_kind,label,inspection_interval_days)
  values(%L,%L,'fireplace_chimney_service','equipment',%L,365)$$,organization_id,id,facility_type||' chimney service'),
  facility_type||' still accepts the existing 365-day chimney interval')
from public.facilities where organization_id='e9270000-0000-4000-8000-000000000001' and facility_type in ('NH','HHA','HOS','GH');
select throws_ok(format($$update public.inspection_items set inspection_interval_days=730 where facility_id=%L and item_type='fireplace_chimney_service'$$,id),
  '23514',null,facility_type||' retains the existing chimney maximum on updates')
from public.facilities where organization_id='e9270000-0000-4000-8000-000000000001' and facility_type in ('NH','HHA','HOS','GH');
select is(app_private.site_inspection_grace('e9270000-0000-4000-8000-000000000011','fireplace_chimney_service'),0,
  'a voluntary PCH chimney schedule does not inherit Chapter 2800 grace');
insert into public.inspection_items(id,organization_id,facility_id,item_type,item_kind,label,inspection_interval_days,install_date)
values('e9270000-0000-4000-8000-000000000021','e9270000-0000-4000-8000-000000000001','e9270000-0000-4000-8000-000000000011','fire_drill_program','procedural','Recorded drills only',30,public.pa_today()-400);
insert into public.inspection_events(id,inspection_item_id,performed_date,performed_by,result,notes)
values('e9270000-0000-4000-8000-000000000031','e9270000-0000-4000-8000-000000000021',public.pa_today(),'Site staff','fail','Maintenance issue; no drill was conducted');
select is((select last_inspected_date from public.inspection_items where id='e9270000-0000-4000-8000-000000000021'),null::date,
  'a bare issue or maintenance event does not count as an unsuccessful drill');
select is((select status from public.inspection_items where id='e9270000-0000-4000-8000-000000000021'),'expired',
  'the monthly drill remains overdue without a recorded drill');
insert into public.inspection_events(id,inspection_item_id,performed_date,performed_by,result,drill_time,exit_route_used,residents_present_count,residents_evacuated_count,staff_participating_count,problems_encountered,alarm_sounded,alarm_or_detector_operative)
values('e9270000-0000-4000-8000-000000000032','e9270000-0000-4000-8000-000000000021',public.pa_today(),'Site staff','fail','14:00','Front exit',6,0,1,'Drill stopped because evacuation was unsafe; corrective action remains pending',true,true);
select is((select last_inspected_date from public.inspection_items where id='e9270000-0000-4000-8000-000000000021'),public.pa_today(),
  'an actual recorded unsuccessful drill counts even when stopped before an evacuation time exists');
select ok((select result='fail' and follow_up_required from public.inspection_events where id='e9270000-0000-4000-8000-000000000032'),
  'frequency credit preserves the unsuccessful result and required follow-up');
insert into public.facility_site_policies(facility_id,organization_id,rationale) values
('e9270000-0000-4000-8000-000000000011','e9270000-0000-4000-8000-000000000001','Use this chapter regulatory baseline'),
('e9270000-0000-4000-8000-000000000012','e9270000-0000-4000-8000-000000000001','Use this chapter regulatory baseline');
select is((select count_unsuccessful_pch_drills from public.facility_site_policies where facility_id='e9270000-0000-4000-8000-000000000011'),true,'omitted drill preference resolves to the PCH baseline');
select is((select count_unsuccessful_pch_drills from public.facility_site_policies where facility_id='e9270000-0000-4000-8000-000000000012'),false,'PCH-only unsuccessful-drill interpretation does not apply to ALF');
select is((select inspection_grace from public.facility_site_policies where facility_id='e9270000-0000-4000-8000-000000000011'),'rcg','saved baseline does not silently remove grace');
select is((select alf_approval_renewal from public.facility_site_policies where facility_id='e9270000-0000-4000-8000-000000000012'),'changed_use','ALF baseline follows the DHS changed-use interpretation');
update public.facility_site_policies set inspection_grace='strict',count_unsuccessful_pch_drills=false,rationale='Explicitly stricter facility procedure'
  where facility_id='e9270000-0000-4000-8000-000000000011';
select is(app_private.site_inspection_grace('e9270000-0000-4000-8000-000000000011','furnace_inspection'),0,'an explicit additional facility policy is preserved');
select is((select count_unsuccessful_pch_drills from public.facility_site_policies where facility_id='e9270000-0000-4000-8000-000000000011'),false,'explicit false is not replaced by the PCH default');
select * from finish();
rollback;

begin;
select plan(23);
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
('e9270000-0000-4000-8000-000000000013','e9270000-0000-4000-8000-000000000001','Unrelated license','NH');
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
select is(app_private.site_inspection_grace('e9270000-0000-4000-8000-000000000011','fireplace_chimney_service'),0,
  'a voluntary PCH chimney schedule does not inherit Chapter 2800 grace');
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

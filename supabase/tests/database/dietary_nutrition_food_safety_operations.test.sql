begin;
select plan(65);

select has_table('public', 'resident_dietary_profiles', 'resident dietary profiles are structured');
select has_table('public', 'resident_dietary_profile_history', 'dietary profile versions retain history');
select has_table('public', 'dietary_menu_cycles', 'menu cycles are first-class records');
select has_table('public', 'dietary_menu_entries', 'menu cycle meals are structured');
select has_table('public', 'resident_meal_records', 'meal attendance and intake are recorded');
select has_table('public', 'resident_hydration_rounds', 'hydration rounds are structured');
select has_table('public', 'weight_monitoring_assignments', 'weight monitoring has owned assignments');
select has_table('public', 'resident_weight_readings', 'weight readings retain review evidence');
select has_table('public', 'nutrition_risk_reviews', 'nutrition risk and referrals are structured');
select has_table('public', 'food_safety_control_points', 'food-safety controls are configurable');
select has_table('public', 'food_safety_logs', 'food-safety observations retain corrective evidence');
select has_table('public', 'food_service_employee_qualifications', 'food-service employee qualifications are tracked');
select has_table('public', 'dietary_exception_patterns', 'repetitive exceptions have an aggregate pattern record');
select has_table('public', 'dietary_operations_history', 'dietary operational history is append-only');
select ok(has_table_privilege('authenticated', 'public.resident_dietary_profiles', 'SELECT'), 'authenticated users can read scoped dietary data');
select ok(not has_table_privilege('authenticated', 'public.resident_dietary_profiles', 'INSERT'), 'browser roles cannot bypass dietary commands');
select ok(not has_table_privilege('anon', 'public.food_safety_logs', 'SELECT'), 'anonymous users have no food-safety table access');

insert into public.organizations(id, name, slug, subscription_status) values
  ('73000000-0000-4000-8000-000000000001', 'Dietary Org', 'dietary-org', 'active'),
  ('73000000-0000-4000-8000-000000000002', 'Other Dietary Org', 'other-dietary-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('73000000-0000-4000-8000-000000000011', '73000000-0000-4000-8000-000000000001', 'Dietary Facility', 'PCH'),
  ('73000000-0000-4000-8000-000000000012', '73000000-0000-4000-8000-000000000001', 'Unassigned Facility', 'ALR'),
  ('73000000-0000-4000-8000-000000000013', '73000000-0000-4000-8000-000000000002', 'Other Dietary Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'dietary-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'dietary-employee@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'dietary-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'other-dietary-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('73000000-0000-4000-8000-000000000101', '73000000-0000-4000-8000-000000000001', 'dietary-admin@test.local', 'Dietary', 'Admin', 'org_admin', true),
  ('73000000-0000-4000-8000-000000000102', '73000000-0000-4000-8000-000000000001', 'dietary-employee@test.local', 'Dietary', 'Employee', 'employee', true),
  ('73000000-0000-4000-8000-000000000103', '73000000-0000-4000-8000-000000000001', 'dietary-auditor@test.local', 'Dietary', 'Auditor', 'auditor', true),
  ('73000000-0000-4000-8000-000000000104', '73000000-0000-4000-8000-000000000002', 'other-dietary-admin@test.local', 'Other', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.facility_assignments(profile_id, facility_id) values
  ('73000000-0000-4000-8000-000000000102', '73000000-0000-4000-8000-000000000011');
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('73000000-0000-4000-8000-000000000201', '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000011', 'Jordan', 'Resident', current_date - 30, 'active'),
  ('73000000-0000-4000-8000-000000000202', '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000012', 'Unassigned', 'Resident', current_date - 20, 'active'),
  ('73000000-0000-4000-8000-000000000203', '73000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000013', 'Other', 'Resident', current_date - 10, 'active');
insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, department, status
) values (
  '73000000-0000-4000-8000-000000000301', '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000011', '73000000-0000-4000-8000-000000000102',
  'Dietary', 'Employee', 'Food Service Associate', 'Dining', 'active'
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'anon' then set local role anon;
  elsif p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;
create temporary table dietary_ids(key text primary key, id uuid) on commit drop;
grant all on dietary_ids to authenticated, anon, service_role;

select pg_temp.act_as('73000000-0000-4000-8000-000000000101');
select lives_ok($$
  insert into dietary_ids values ('profile', public.upsert_resident_dietary_profile(
    '73000000-0000-4000-8000-000000000201',
    '{"dietOrder":"Low sodium","prescribedDiet":"Provider-directed low sodium plan","orderedByName":"Alex Provider","orderedAt":"2026-07-13T12:00:00Z","effectiveDate":"2026-07-13","reviewDueDate":"2026-08-13","foodAllergies":["Peanut"],"textureConsistency":"soft_and_bite_sized","liquidConsistency":"thin","fluidPlanType":"restriction","fluidTargetMl":1500,"adaptiveEquipment":["Built-up utensil"],"feedingAssistance":"cueing","residentPreferences":"Warm breakfast","culturalReligiousPreferences":"No pork","nutritionRisk":"moderate","riskFactors":["Recent low intake"],"notes":"Monitor meal acceptance"}'::jsonb,
    'Initial dietary operations profile'
  ))
$$, 'manager creates a complete resident dietary profile');
select is((select version from public.resident_dietary_profiles where id = (select id from dietary_ids where key = 'profile')), 1, 'initial dietary profile starts at version one');
select is((select food_allergies from public.residents where id = '73000000-0000-4000-8000-000000000201'), array['Peanut']::text[], 'dietary profile synchronizes resident master allergies');
select is(public.get_resident_administrative_packet('73000000-0000-4000-8000-000000000201') #>> '{dietaryProfile,textureConsistency}', 'soft_and_bite_sized', 'administrative packet reuses the dietary profile');
select lives_ok($$
  select public.upsert_resident_dietary_profile(
    '73000000-0000-4000-8000-000000000201',
    '{"dietOrder":"Low sodium","prescribedDiet":"Provider-directed low sodium plan","orderedByName":"Alex Provider","effectiveDate":"2026-07-13","reviewDueDate":"2026-08-13","foodAllergies":["Peanut","Shellfish"],"textureConsistency":"soft_and_bite_sized","liquidConsistency":"thin","fluidPlanType":"restriction","fluidTargetMl":1500,"adaptiveEquipment":["Built-up utensil"],"feedingAssistance":"cueing","residentPreferences":"Warm breakfast","culturalReligiousPreferences":"No pork","nutritionRisk":"high","riskFactors":["Recent low intake"],"notes":"Escalated risk review"}'::jsonb,
    'Nutrition risk and allergy review updated'
  )
$$, 'manager versions an updated dietary profile');
select is((select version from public.resident_dietary_profiles where id = (select id from dietary_ids where key = 'profile')), 2, 'profile update increments the version');
select is((select count(*)::integer from public.resident_dietary_profile_history where profile_id = (select id from dietary_ids where key = 'profile')), 2, 'each dietary profile version retains a snapshot');
set local role service_role;
select throws_ok($$
  update public.resident_dietary_profile_history set change_reason = 'Rewritten'
  where profile_id = (select id from dietary_ids where key = 'profile')
$$, '55000', null, 'dietary profile history is immutable');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '73000000-0000-4000-8000-000000000101', 'role', 'authenticated')::text, true);

select lives_ok($$
  insert into dietary_ids values ('menu1', public.create_dietary_menu_cycle(
    '73000000-0000-4000-8000-000000000011', 'Summer cycle A', current_date, 7, 'active',
    '[{"dayNumber":1,"mealPeriod":"breakfast","menuDescription":"Oatmeal, fruit, milk","substitutions":"Cream of wheat","textureAlternatives":{"pureed":"Pureed oatmeal and fruit"},"declaredAllergens":["Milk"]},{"dayNumber":1,"mealPeriod":"lunch","menuDescription":"Chicken, rice, green beans","substitutions":"Baked fish","textureAlternatives":{},"declaredAllergens":[]}]'::jsonb
  ))
$$, 'manager publishes a menu cycle with substitutions and texture alternatives');
select is((select count(*)::integer from public.dietary_menu_entries where menu_cycle_id = (select id from dietary_ids where key = 'menu1')), 2, 'menu cycle retains meal entries');
select lives_ok($$
  insert into dietary_ids values ('menu2', public.create_dietary_menu_cycle(
    '73000000-0000-4000-8000-000000000011', 'Summer cycle B', current_date + 7, 7, 'active',
    '[{"dayNumber":1,"mealPeriod":"breakfast","menuDescription":"Eggs and toast","textureAlternatives":{},"declaredAllergens":["Egg","Wheat"]}]'::jsonb
  ))
$$, 'manager activates a replacement menu cycle');
select is((select status from public.dietary_menu_cycles where id = (select id from dietary_ids where key = 'menu1')), 'retired', 'activating a new menu retires the prior active cycle');

select pg_temp.act_as('73000000-0000-4000-8000-000000000102');
select lives_ok($$
  insert into dietary_ids values ('meal_normal', public.record_resident_meal(
    '73000000-0000-4000-8000-000000000201', now() - interval '2 hours', 'breakfast',
    'attended', 'accepted', 75, null, 'Cueing provided', null, null
  ))
$$, 'assigned food-service employee records ordinary meal intake');
select ok((select work_item_id is null from public.resident_meal_records where id = (select id from dietary_ids where key = 'meal_normal')), 'ordinary meal intake does not create corrective work');
select lives_ok($$
  insert into dietary_ids values ('meal_refusal', public.record_resident_meal(
    '73000000-0000-4000-8000-000000000201', now() - interval '1 hour', 'lunch',
    'attended', 'refused', 0, 'Soup offered', 'Encouragement provided',
    'Resident declined the meal and offered substitution', null
  ))
$$, 'employee records a meal refusal with response details');
select ok((select work_item_id is not null from public.resident_meal_records where id = (select id from dietary_ids where key = 'meal_refusal')), 'meal refusal automatically enters Operational Work');
select throws_ok($$
  select public.record_resident_meal(
    '73000000-0000-4000-8000-000000000202', now(), 'dinner',
    'attended', 'accepted', 100, null, null, null, null
  )
$$, '42501', null, 'employee cannot record a resident outside assigned facilities');

select lives_ok($$
  insert into dietary_ids values ('hydration', public.record_resident_hydration_round(
    '73000000-0000-4000-8000-000000000201', now(), 240, 0, 'refused', true,
    'Resident declined fluids during the scheduled round'
  ))
$$, 'employee records hydration refusal and offered amount');
select ok((select work_item_id is not null from public.resident_hydration_rounds where id = (select id from dietary_ids where key = 'hydration')), 'hydration exception automatically enters Operational Work');

select pg_temp.act_as('73000000-0000-4000-8000-000000000101');
select lives_ok($$
  insert into dietary_ids values ('weight_assignment', public.assign_resident_weight_monitoring(
    '73000000-0000-4000-8000-000000000201', 'weekly', current_date, 5,
    '73000000-0000-4000-8000-000000000102', 'Weekly nutrition-risk monitoring'
  ))
$$, 'manager assigns weight monitoring with a review threshold');
select pg_temp.act_as('73000000-0000-4000-8000-000000000102');
select lives_ok($$
  insert into dietary_ids values ('weight1', public.record_resident_weight(
    (select id from dietary_ids where key = 'weight_assignment'), now() - interval '7 days', 150, 'Baseline'
  ))
$$, 'employee records baseline weight');
select is((select review_required from public.resident_weight_readings where id = (select id from dietary_ids where key = 'weight1')), false, 'baseline weight does not infer a review');
select lives_ok($$
  insert into dietary_ids values ('weight2', public.record_resident_weight(
    (select id from dietary_ids where key = 'weight_assignment'), now(), 156, 'Repeat measurement confirmed'
  ))
$$, 'employee records follow-up weight');
select is((select review_required from public.resident_weight_readings where id = (select id from dietary_ids where key = 'weight2')), true, 'configured change threshold marks review required without diagnosing');
select ok((select work_item_id is not null from public.resident_weight_readings where id = (select id from dietary_ids where key = 'weight2')), 'weight review automatically enters Operational Work');

select pg_temp.act_as('73000000-0000-4000-8000-000000000101');
select lives_ok($$
  insert into dietary_ids values ('review', public.record_nutrition_risk_review(
    '73000000-0000-4000-8000-000000000201', now(), 'high',
    'Repeated low intake and configured weight-change threshold require follow-up.',
    'Send current records to dietitian and track recommendations.',
    'dietitian', 'Community Dietitian', 'pending', current_date + 3
  ))
$$, 'manager records nutrition-risk review and pending referral');
select ok((select work_item_id is not null from public.nutrition_risk_reviews where id = (select id from dietary_ids where key = 'review')), 'pending nutrition referral automatically creates follow-up work');

select lives_ok($$
  insert into dietary_ids values ('fridge', public.upsert_food_safety_control_point(
    '73000000-0000-4000-8000-000000000011', null, 'refrigerator_temperature',
    'Walk-in refrigerator', 'Main kitchen', 'fahrenheit', null, 41, 'Every shift', true
  ))
$$, 'manager configures a refrigerator control point with a policy threshold');
select pg_temp.act_as('73000000-0000-4000-8000-000000000102');
select lives_ok($$
  insert into dietary_ids values ('food_ok', public.record_food_safety_log(
    (select id from dietary_ids where key = 'fridge'), now() - interval '4 hours', 39,
    '{}'::jsonb, 'compliant', 'Temperature within configured limit', null, null
  ))
$$, 'employee records a compliant refrigerator temperature');
select is((select result from public.food_safety_logs where id = (select id from dietary_ids where key = 'food_ok')), 'compliant', 'in-range temperature remains compliant');
select lives_ok($$
  insert into dietary_ids values ('food_exception1', public.record_food_safety_log(
    (select id from dietary_ids where key = 'fridge'), now() - interval '3 hours', 45,
    '{}'::jsonb, 'compliant', 'Temperature above configured maximum',
    'Moved food to alternate refrigerator and notified supervisor', null
  ))
$$, 'database records an out-of-range temperature');
select is((select result from public.food_safety_logs where id = (select id from dietary_ids where key = 'food_exception1')), 'exception', 'configured threshold cannot be bypassed by a compliant label');
select ok((select work_item_id is not null from public.food_safety_logs where id = (select id from dietary_ids where key = 'food_exception1')), 'food-safety exception automatically creates corrective work');
select lives_ok($$
  select public.record_food_safety_log(
    (select id from dietary_ids where key = 'fridge'), now() - interval '2 hours', 44,
    '{}'::jsonb, 'exception', 'Repeat temperature exception',
    'Protected food and requested equipment inspection', null
  )
$$, 'second similar food-safety exception is recorded');
select lives_ok($$
  select public.record_food_safety_log(
    (select id from dietary_ids where key = 'fridge'), now() - interval '1 hour', 43,
    '{}'::jsonb, 'exception', 'Third temperature exception',
    'Stopped using the refrigerator pending verification', null
  )
$$, 'third similar food-safety exception is recorded');
select pg_temp.act_as('73000000-0000-4000-8000-000000000101');
select ok((select qapi_project_id is not null from public.dietary_exception_patterns where pattern_key = 'food-safety:' || (select id from dietary_ids where key = 'fridge')), 'three similar exceptions automatically feed a QAPI project');
select is((public.get_qapi_source_metrics('73000000-0000-4000-8000-000000000011', current_date - 7, current_date)->>'foodSafetyExceptions')::integer, 3, 'QAPI metrics count authoritative food-safety exceptions');
select lives_ok($$
  select public.verify_food_safety_log(
    (select id from dietary_ids where key = 'food_exception1'),
    'Refrigerator serviced and temperature stabilized', now() - interval '30 minutes',
    'Follow-up reading met the configured maximum and food remained protected'
  )
$$, 'manager verifies the corrective action without silently closing work');
select is((select verified_by from public.food_safety_logs where id = (select id from dietary_ids where key = 'food_exception1')), '73000000-0000-4000-8000-000000000101'::uuid, 'food-safety verification retains manager identity');

select lives_ok($$
  insert into dietary_ids values ('equipment', public.upsert_food_safety_control_point(
    '73000000-0000-4000-8000-000000000011', null, 'kitchen_equipment',
    'Dish machine', 'Main kitchen', 'checklist', null, null, 'Before service', true
  ))
$$, 'manager configures kitchen equipment checks');
select pg_temp.act_as('73000000-0000-4000-8000-000000000102');
select lives_ok($$
  insert into dietary_ids values ('equipment_log', public.record_food_safety_log(
    (select id from dietary_ids where key = 'equipment'), now(), null,
    '{"operational":false,"leakObserved":true}'::jsonb, 'exception',
    'Dish machine leaking and unavailable', 'Stopped use and switched to approved alternate process', 'DM-01'
  ))
$$, 'equipment failure creates a kitchen work-order record');
select is((
  select t.template_key from public.food_safety_logs l
  join public.work_items w on w.id = l.work_item_id
  join public.work_item_templates t on t.id = w.template_id
  where l.id = (select id from dietary_ids where key = 'equipment_log')
), 'food_safety.equipment', 'kitchen equipment failure routes to the dedicated work-order template');

select pg_temp.act_as('73000000-0000-4000-8000-000000000101');
select lives_ok($$
  insert into dietary_ids values ('qualification', public.upsert_food_service_qualification(
    '73000000-0000-4000-8000-000000000301', 'food_handler_certification',
    'County food handler certificate', current_date - 30, current_date + 335,
    'compliant', 'County Health Department', 'Certificate FH-1001', 'Verified original'
  ))
$$, 'manager records food-service employee qualification evidence');
select is((select status from public.food_service_employee_qualifications where id = (select id from dietary_ids where key = 'qualification')), 'compliant', 'qualification status is retained');

select pg_temp.act_as('73000000-0000-4000-8000-000000000103');
select is((select count(*)::integer from public.resident_dietary_profiles where facility_id = '73000000-0000-4000-8000-000000000011'), 1, 'auditor can inspect tenant-scoped dietary evidence');
select throws_ok($$
  select public.upsert_resident_dietary_profile(
    '73000000-0000-4000-8000-000000000201', '{}'::jsonb, 'Auditor attempted update'
  )
$$, '42501', null, 'auditor cannot change resident dietary profiles');

select pg_temp.act_as('73000000-0000-4000-8000-000000000104');
select is((select count(*)::integer from public.food_safety_logs where facility_id = '73000000-0000-4000-8000-000000000011'), 0, 'tenant RLS hides another organization food-safety logs');
select throws_ok($$
  select public.record_nutrition_risk_review(
    '73000000-0000-4000-8000-000000000201', now(), 'low',
    'Cross-tenant review must fail', null, null, null, null, null
  )
$$, '42501', null, 'cross-tenant dietary command is denied');

select * from finish();
rollback;

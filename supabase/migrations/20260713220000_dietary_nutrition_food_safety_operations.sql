-- Priority 13: dietary, nutrition, hydration, and food-safety operations.
-- Source records remain authoritative; exceptions are routed to Operational Work
-- and repeated patterns create governed QAPI projects.

alter table public.work_item_templates drop constraint work_item_templates_source_type_check;
alter table public.work_item_templates add constraint work_item_templates_source_type_check
  check (source_type in (
    'violation', 'inspection', 'incident', 'near_miss', 'training_gap',
    'exclusion_match', 'credential', 'policy', 'rule_exception', 'move_in',
    'complaint', 'support_plan', 'qapi', 'change_of_condition',
    'dietary_exception', 'food_safety'
  ));

insert into public.work_item_templates(
  template_key, name, source_type, default_priority, due_interval,
  approval_required, escalation_after, default_owner_role
) values
  ('dietary.meal_exception', 'Resident meal exception', 'dietary_exception', 'high', interval '1 day', false, interval '4 hours', 'facility_manager'),
  ('dietary.hydration_exception', 'Resident hydration exception', 'dietary_exception', 'high', interval '4 hours', false, interval '2 hours', 'facility_manager'),
  ('dietary.weight_review', 'Resident weight review', 'dietary_exception', 'high', interval '1 day', true, interval '4 hours', 'facility_manager'),
  ('dietary.referral_followup', 'Nutrition referral follow-up', 'dietary_exception', 'high', interval '3 days', true, interval '1 day', 'facility_manager'),
  ('food_safety.exception', 'Food-safety corrective action', 'food_safety', 'urgent', interval '4 hours', true, interval '1 hour', 'facility_manager'),
  ('food_safety.equipment', 'Kitchen equipment work order', 'food_safety', 'urgent', interval '4 hours', true, interval '1 hour', 'facility_manager')
on conflict (organization_id, template_key) do nothing;

create table public.resident_dietary_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  diet_order text,
  prescribed_diet text,
  ordered_by_name text,
  ordered_at timestamptz,
  effective_date date not null default current_date,
  review_due_date date,
  food_allergies text[] not null default array[]::text[],
  texture_consistency text not null default 'regular' check (texture_consistency in (
    'regular', 'soft_and_bite_sized', 'minced_and_moist', 'pureed', 'liquidized', 'other'
  )),
  liquid_consistency text not null default 'thin' check (liquid_consistency in (
    'thin', 'slightly_thick', 'mildly_thick', 'moderately_thick', 'extremely_thick', 'other'
  )),
  fluid_plan_type text not null default 'none' check (fluid_plan_type in (
    'none', 'restriction', 'encouragement', 'target'
  )),
  fluid_target_ml integer check (fluid_target_ml is null or fluid_target_ml between 0 and 10000),
  adaptive_equipment text[] not null default array[]::text[],
  feeding_assistance text not null default 'independent' check (feeding_assistance in (
    'independent', 'setup', 'cueing', 'partial_assistance', 'full_assistance', 'two_person_assistance'
  )),
  resident_preferences text,
  cultural_religious_preferences text,
  nutrition_risk text not null default 'low' check (nutrition_risk in ('low', 'moderate', 'high')),
  risk_factors text[] not null default array[]::text[],
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resident_id),
  check (review_due_date is null or review_due_date >= effective_date),
  check (fluid_plan_type = 'none' or fluid_target_ml is not null)
);
create index resident_dietary_profiles_scope_idx
  on public.resident_dietary_profiles(organization_id, facility_id, nutrition_risk);

create table public.resident_dietary_profile_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  profile_id uuid not null references public.resident_dietary_profiles(id) on delete restrict,
  version integer not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  change_reason text not null check (length(btrim(change_reason)) >= 5),
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  unique (profile_id, version)
);

create table public.dietary_menu_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  name text not null check (length(btrim(name)) >= 3),
  starts_on date not null,
  ends_on date,
  cycle_length_days integer not null check (cycle_length_days between 1 and 42),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, name),
  check (ends_on is null or ends_on >= starts_on)
);
create unique index dietary_menu_cycles_one_active_idx
  on public.dietary_menu_cycles(facility_id) where status = 'active';

create table public.dietary_menu_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  menu_cycle_id uuid not null references public.dietary_menu_cycles(id) on delete cascade,
  day_number integer not null check (day_number between 1 and 42),
  meal_period text not null check (meal_period in (
    'breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'
  )),
  menu_description text not null check (length(btrim(menu_description)) >= 2),
  substitutions text,
  texture_alternatives jsonb not null default '{}'::jsonb check (jsonb_typeof(texture_alternatives) = 'object'),
  declared_allergens text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  unique (menu_cycle_id, day_number, meal_period)
);

create table public.resident_meal_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  menu_entry_id uuid references public.dietary_menu_entries(id) on delete set null,
  served_at timestamptz not null,
  meal_period text not null check (meal_period in (
    'breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'
  )),
  attendance text not null check (attendance in ('attended', 'absent', 'offsite', 'not_scheduled')),
  outcome text not null check (outcome in ('accepted', 'refused', 'missed', 'not_applicable')),
  intake_percent integer check (intake_percent is null or intake_percent between 0 and 100),
  substitution text,
  assistance_provided text,
  exception_type text check (exception_type is null or exception_type in (
    'meal_refusal', 'missed_meal', 'low_intake', 'attendance_exception', 'other'
  )),
  exception_reason text,
  work_item_id uuid references public.work_items(id) on delete set null,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  check (exception_type is null or length(btrim(coalesce(exception_reason, ''))) >= 5)
);
create index resident_meal_records_resident_idx
  on public.resident_meal_records(resident_id, served_at desc);
create index resident_meal_records_exception_idx
  on public.resident_meal_records(facility_id, exception_type, served_at desc)
  where exception_type is not null;

create table public.resident_hydration_rounds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  scheduled_at timestamptz not null,
  offered_ml integer not null check (offered_ml between 0 and 3000),
  consumed_ml integer not null check (consumed_ml between 0 and offered_ml),
  outcome text not null check (outcome in ('accepted', 'refused', 'unavailable', 'not_applicable')),
  exception_recorded boolean not null default false,
  exception_reason text,
  work_item_id uuid references public.work_items(id) on delete set null,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  check (not exception_recorded or length(btrim(coalesce(exception_reason, ''))) >= 5)
);
create index resident_hydration_rounds_resident_idx
  on public.resident_hydration_rounds(resident_id, scheduled_at desc);

create table public.weight_monitoring_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  frequency text not null check (frequency in ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly')),
  next_due_date date not null,
  change_threshold_lbs numeric(7,2) not null default 5 check (change_threshold_lbs > 0),
  assigned_profile_id uuid references public.profiles(id),
  reason text not null check (length(btrim(reason)) >= 5),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index weight_monitoring_assignments_one_active_idx
  on public.weight_monitoring_assignments(resident_id) where active;

create table public.resident_weight_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  assignment_id uuid references public.weight_monitoring_assignments(id) on delete set null,
  measured_at timestamptz not null,
  weight_lbs numeric(7,2) not null check (weight_lbs between 1 and 1500),
  prior_weight_lbs numeric(7,2),
  change_lbs numeric(7,2),
  review_required boolean not null default false,
  notes text,
  work_item_id uuid references public.work_items(id) on delete set null,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now()
);
create index resident_weight_readings_resident_idx
  on public.resident_weight_readings(resident_id, measured_at desc);

create table public.nutrition_risk_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  reviewed_at timestamptz not null,
  risk_level text not null check (risk_level in ('low', 'moderate', 'high')),
  findings text not null check (length(btrim(findings)) >= 5),
  action_plan text,
  referral_type text check (referral_type is null or referral_type in ('provider', 'dietitian', 'speech_therapy', 'other')),
  referral_recipient text,
  referral_status text check (referral_status is null or referral_status in ('not_needed', 'pending', 'scheduled', 'completed', 'declined')),
  follow_up_due_date date,
  completed_at timestamptz,
  work_item_id uuid references public.work_items(id) on delete set null,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((referral_type is null) = (referral_status is null)),
  check (referral_status <> 'pending' or follow_up_due_date is not null)
);

create table public.food_safety_control_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  control_type text not null check (control_type in (
    'refrigerator_temperature', 'freezer_temperature', 'cooking_temperature',
    'holding_temperature', 'dish_machine_temperature', 'food_storage_round',
    'expiration_check', 'sanitation_round', 'kitchen_equipment'
  )),
  label text not null check (length(btrim(label)) >= 2),
  location_detail text not null check (length(btrim(location_detail)) >= 2),
  measurement_unit text not null default 'fahrenheit' check (measurement_unit in ('fahrenheit', 'celsius', 'checklist')),
  minimum_value numeric(8,2),
  maximum_value numeric(8,2),
  frequency text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, label),
  check (minimum_value is null or maximum_value is null or minimum_value <= maximum_value),
  check (measurement_unit = 'checklist' or minimum_value is not null or maximum_value is not null)
);

create table public.food_safety_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  control_point_id uuid not null references public.food_safety_control_points(id) on delete restrict,
  observed_at timestamptz not null,
  observed_value numeric(8,2),
  checklist jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist) = 'object'),
  result text not null check (result in ('compliant', 'exception')),
  observation text,
  immediate_action text,
  equipment_reference text,
  work_item_id uuid references public.work_items(id) on delete set null,
  corrected_at timestamptz,
  corrective_action text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  verification_notes text,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  check (result <> 'exception' or length(btrim(coalesce(immediate_action, ''))) >= 5),
  check ((verified_at is null) = (verified_by is null))
);
create index food_safety_logs_control_idx
  on public.food_safety_logs(control_point_id, observed_at desc);
create index food_safety_logs_exception_idx
  on public.food_safety_logs(facility_id, observed_at desc) where result = 'exception';

create table public.food_service_employee_qualifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete cascade,
  qualification_type text not null check (qualification_type in (
    'food_handler_certification', 'sanitation_training', 'allergen_awareness',
    'manager_certification', 'therapeutic_diet_training', 'other'
  )),
  qualification_label text,
  issued_on date,
  expires_on date,
  status text not null check (status in ('compliant', 'due_soon', 'expired', 'missing', 'not_applicable')),
  issuing_authority text,
  evidence_reference text,
  notes text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, qualification_type),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

create table public.dietary_exception_patterns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid references public.residents(id) on delete cascade,
  pattern_kind text not null check (pattern_kind in (
    'meal_refusal', 'missed_meal', 'low_intake', 'hydration_exception',
    'weight_review', 'food_safety_exception', 'kitchen_equipment'
  )),
  pattern_key text not null,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  window_started_at timestamptz not null default now(),
  last_occurrence_at timestamptz not null default now(),
  qapi_project_id uuid references public.qapi_projects(id) on delete set null,
  unique (organization_id, facility_id, pattern_key)
);

create table public.dietary_operations_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid references public.residents(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id),
  occurred_at timestamptz not null default now()
);
create index dietary_operations_history_scope_idx
  on public.dietary_operations_history(organization_id, facility_id, occurred_at desc);

create trigger resident_dietary_profiles_updated_at before update on public.resident_dietary_profiles
for each row execute function public.set_updated_at();
create trigger dietary_menu_cycles_updated_at before update on public.dietary_menu_cycles
for each row execute function public.set_updated_at();
create trigger weight_monitoring_assignments_updated_at before update on public.weight_monitoring_assignments
for each row execute function public.set_updated_at();
create trigger food_safety_control_points_updated_at before update on public.food_safety_control_points
for each row execute function public.set_updated_at();
create trigger food_service_qualifications_updated_at before update on public.food_service_employee_qualifications
for each row execute function public.set_updated_at();

create trigger protect_dietary_profile_history before update or delete on public.resident_dietary_profile_history
for each row execute function app_private.prevent_phase5_evidence_mutation();
create trigger protect_dietary_operations_history before update or delete on public.dietary_operations_history
for each row execute function app_private.prevent_phase5_evidence_mutation();

create or replace function app_private.dietary_row_visible(p_org uuid, p_fac uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
    or (
      p_org = public.current_org_id()
      and (
        public.current_role() in ('org_admin', 'auditor')
        or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(p_fac))
        or (public.current_role() = 'employee' and public.is_assigned_to_facility(p_fac))
      )
    )
$$;

create or replace function app_private.assert_dietary_contributor(p_org uuid, p_fac uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' or public.is_platform_admin() then return; end if;
  if auth.uid() is null or public.current_org_id() <> p_org
    or public.current_role() not in ('org_admin', 'facility_manager', 'employee')
    or (public.current_role() <> 'org_admin' and not public.is_assigned_to_facility(p_fac)) then
    raise exception 'Dietary operation is outside caller scope' using errcode = '42501';
  end if;
end
$$;

create or replace function app_private.track_dietary_exception_pattern(
  p_org uuid, p_fac uuid, p_resident uuid, p_kind text,
  p_pattern_key text, p_label text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pattern public.dietary_exception_patterns%rowtype;
  v_project_id uuid;
  v_project_number text;
begin
  insert into public.dietary_exception_patterns(
    organization_id, facility_id, resident_id, pattern_kind, pattern_key
  ) values (p_org, p_fac, p_resident, p_kind, p_pattern_key)
  on conflict (organization_id, facility_id, pattern_key) do update set
    resident_id = excluded.resident_id,
    pattern_kind = excluded.pattern_kind,
    occurrence_count = case
      when public.dietary_exception_patterns.last_occurrence_at < now() - interval '30 days' then 1
      else public.dietary_exception_patterns.occurrence_count + 1 end,
    window_started_at = case
      when public.dietary_exception_patterns.last_occurrence_at < now() - interval '30 days' then now()
      else public.dietary_exception_patterns.window_started_at end,
    last_occurrence_at = now()
  returning * into v_pattern;

  if v_pattern.occurrence_count >= 3 and v_pattern.qapi_project_id is null then
    perform pg_advisory_xact_lock(hashtext('qapi_project_numbering'), hashtext(p_org::text));
    v_project_number := 'QAPI-' || to_char(current_date, 'YYYY') || '-' || lpad((
      select (count(*) + 1)::text from public.qapi_projects where organization_id = p_org
    ), 4, '0');
    insert into public.qapi_projects(
      organization_id, facility_id, project_number, title, problem_statement,
      source_of_concern, source_type, source_id, baseline_data,
      measurable_objective, target_description, target_value,
      target_completion_date, created_by
    ) values (
      p_org, p_fac, v_project_number,
      'Repeated ' || p_label,
      'Three or more similar dietary or food-safety exceptions occurred within 30 days and require governed review.',
      'Automated dietary and food-safety exception trend', 'dietary_exception_pattern', v_pattern.id,
      v_pattern.occurrence_count || ' occurrences since ' || v_pattern.window_started_at::date,
      'Review the pattern, identify contributing factors, and verify corrective actions.',
      'Reduce recurrence and sustain verified controls.', 0, current_date + 30, auth.uid()
    ) returning id into v_project_id;
    update public.dietary_exception_patterns set qapi_project_id = v_project_id where id = v_pattern.id;
    insert into public.qapi_project_history(
      organization_id, facility_id, project_id, event_type,
      resulting_status, reason, actor_profile_id, evidence
    ) values (
      p_org, p_fac, v_project_id, 'created', 'proposed',
      'Repeated dietary or food-safety exceptions automatically fed QAPI', auth.uid(),
      jsonb_build_object('patternId', v_pattern.id, 'occurrenceCount', v_pattern.occurrence_count)
    );
  end if;
  return v_pattern.id;
end
$$;

create or replace function public.upsert_resident_dietary_profile(
  p_resident_id uuid, p_profile jsonb, p_change_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_profile public.resident_dietary_profiles%rowtype;
  v_id uuid;
  v_version integer;
  v_allergies text[];
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);
  if jsonb_typeof(coalesce(p_profile, '{}'::jsonb)) <> 'object'
    or length(btrim(coalesce(p_change_reason, ''))) < 5 then
    raise exception 'Dietary profile change is invalid' using errcode = '22023';
  end if;
  v_allergies := array(
    select distinct btrim(value)
    from jsonb_array_elements_text(coalesce(p_profile->'foodAllergies', '[]'::jsonb))
    where btrim(value) <> '' order by btrim(value)
  );
  select * into v_profile from public.resident_dietary_profiles where resident_id = v_resident.id for update;
  v_version := coalesce(v_profile.version, 0) + 1;
  insert into public.resident_dietary_profiles(
    organization_id, facility_id, resident_id, version, diet_order, prescribed_diet,
    ordered_by_name, ordered_at, effective_date, review_due_date, food_allergies,
    texture_consistency, liquid_consistency, fluid_plan_type, fluid_target_ml,
    adaptive_equipment, feeding_assistance, resident_preferences,
    cultural_religious_preferences, nutrition_risk, risk_factors, notes,
    created_by, updated_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_version,
    nullif(btrim(p_profile->>'dietOrder'), ''), nullif(btrim(p_profile->>'prescribedDiet'), ''),
    nullif(btrim(p_profile->>'orderedByName'), ''), nullif(p_profile->>'orderedAt', '')::timestamptz,
    coalesce(nullif(p_profile->>'effectiveDate', '')::date, current_date),
    nullif(p_profile->>'reviewDueDate', '')::date, v_allergies,
    coalesce(nullif(p_profile->>'textureConsistency', ''), 'regular'),
    coalesce(nullif(p_profile->>'liquidConsistency', ''), 'thin'),
    coalesce(nullif(p_profile->>'fluidPlanType', ''), 'none'),
    nullif(p_profile->>'fluidTargetMl', '')::integer,
    array(select distinct btrim(value) from jsonb_array_elements_text(coalesce(p_profile->'adaptiveEquipment', '[]'::jsonb)) where btrim(value) <> ''),
    coalesce(nullif(p_profile->>'feedingAssistance', ''), 'independent'),
    nullif(btrim(p_profile->>'residentPreferences'), ''),
    nullif(btrim(p_profile->>'culturalReligiousPreferences'), ''),
    coalesce(nullif(p_profile->>'nutritionRisk', ''), 'low'),
    array(select distinct btrim(value) from jsonb_array_elements_text(coalesce(p_profile->'riskFactors', '[]'::jsonb)) where btrim(value) <> ''),
    nullif(btrim(p_profile->>'notes'), ''), auth.uid(), auth.uid()
  )
  on conflict (resident_id) do update set
    version = excluded.version, diet_order = excluded.diet_order,
    prescribed_diet = excluded.prescribed_diet, ordered_by_name = excluded.ordered_by_name,
    ordered_at = excluded.ordered_at, effective_date = excluded.effective_date,
    review_due_date = excluded.review_due_date, food_allergies = excluded.food_allergies,
    texture_consistency = excluded.texture_consistency, liquid_consistency = excluded.liquid_consistency,
    fluid_plan_type = excluded.fluid_plan_type, fluid_target_ml = excluded.fluid_target_ml,
    adaptive_equipment = excluded.adaptive_equipment, feeding_assistance = excluded.feeding_assistance,
    resident_preferences = excluded.resident_preferences,
    cultural_religious_preferences = excluded.cultural_religious_preferences,
    nutrition_risk = excluded.nutrition_risk, risk_factors = excluded.risk_factors,
    notes = excluded.notes, updated_by = auth.uid(), updated_at = now()
  returning id into v_id;
  insert into public.resident_dietary_profile_history(
    organization_id, facility_id, resident_id, profile_id, version,
    snapshot, change_reason, changed_by
  ) select profile.organization_id, profile.facility_id, profile.resident_id, profile.id, profile.version,
    to_jsonb(profile) - 'created_by' - 'updated_by',
    btrim(p_change_reason), auth.uid()
  from public.resident_dietary_profiles profile where profile.id = v_id;
  update public.residents set
    dietary_requirements = concat_ws('; ', nullif(btrim(p_profile->>'dietOrder'), ''),
      'Texture: ' || replace(coalesce(nullif(p_profile->>'textureConsistency', ''), 'regular'), '_', ' '),
      case when coalesce(nullif(p_profile->>'fluidPlanType', ''), 'none') <> 'none'
        then 'Fluid plan: ' || replace(p_profile->>'fluidPlanType', '_', ' ') else null end),
    food_allergies = v_allergies, updated_at = now()
  where id = v_resident.id;
  insert into public.dietary_operations_history(
    organization_id, facility_id, resident_id, entity_type, entity_id,
    event_type, summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'resident_dietary_profile', v_id, 'profile_updated',
    'Resident dietary profile updated', jsonb_build_object('version', v_version), auth.uid()
  );
  return v_id;
end
$$;

create or replace function public.create_dietary_menu_cycle(
  p_facility_id uuid, p_name text, p_starts_on date,
  p_cycle_length_days integer, p_status text, p_entries jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_fac public.facilities%rowtype;
  v_id uuid;
  v_entry jsonb;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);
  if length(btrim(coalesce(p_name, ''))) < 3 or p_starts_on is null
    or p_cycle_length_days not between 1 and 42 or p_status not in ('draft', 'active')
    or jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) = 0 then
    raise exception 'Menu cycle is invalid' using errcode = '22023';
  end if;
  if p_status = 'active' then
    update public.dietary_menu_cycles set status = 'retired', updated_at = now()
    where facility_id = v_fac.id and status = 'active';
  end if;
  insert into public.dietary_menu_cycles(
    organization_id, facility_id, name, starts_on, cycle_length_days, status, created_by
  ) values (v_fac.organization_id, v_fac.id, btrim(p_name), p_starts_on, p_cycle_length_days, p_status, auth.uid())
  returning id into v_id;
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    if coalesce((v_entry->>'dayNumber')::integer, 0) not between 1 and p_cycle_length_days
      or v_entry->>'mealPeriod' not in ('breakfast','morning_snack','lunch','afternoon_snack','dinner','evening_snack')
      or length(btrim(coalesce(v_entry->>'menuDescription', ''))) < 2 then
      raise exception 'Menu entry is invalid' using errcode = '22023';
    end if;
    insert into public.dietary_menu_entries(
      organization_id, facility_id, menu_cycle_id, day_number, meal_period,
      menu_description, substitutions, texture_alternatives, declared_allergens
    ) values (
      v_fac.organization_id, v_fac.id, v_id, (v_entry->>'dayNumber')::integer,
      v_entry->>'mealPeriod', btrim(v_entry->>'menuDescription'),
      nullif(btrim(v_entry->>'substitutions'), ''),
      coalesce(v_entry->'textureAlternatives', '{}'::jsonb),
      array(select distinct btrim(value) from jsonb_array_elements_text(coalesce(v_entry->'declaredAllergens', '[]'::jsonb)) where btrim(value) <> '')
    );
  end loop;
  insert into public.dietary_operations_history(
    organization_id, facility_id, entity_type, entity_id, event_type,
    summary, evidence, actor_profile_id
  ) values (
    v_fac.organization_id, v_fac.id, 'menu_cycle', v_id, 'menu_cycle_created',
    'Dietary menu cycle created', jsonb_build_object('status', p_status, 'entryCount', jsonb_array_length(p_entries)), auth.uid()
  );
  return v_id;
end
$$;

create or replace function public.record_resident_meal(
  p_resident_id uuid, p_served_at timestamptz, p_meal_period text,
  p_attendance text, p_outcome text, p_intake_percent integer,
  p_substitution text, p_assistance_provided text, p_exception_reason text,
  p_menu_entry_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_id uuid;
  v_work uuid;
  v_exception text;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_dietary_contributor(v_resident.organization_id, v_resident.facility_id);
  if p_served_at is null or p_served_at > now() + interval '1 hour'
    or p_meal_period not in ('breakfast','morning_snack','lunch','afternoon_snack','dinner','evening_snack')
    or p_attendance not in ('attended','absent','offsite','not_scheduled')
    or p_outcome not in ('accepted','refused','missed','not_applicable')
    or (p_intake_percent is not null and p_intake_percent not between 0 and 100)
    or (p_menu_entry_id is not null and not exists(
      select 1 from public.dietary_menu_entries where id = p_menu_entry_id and facility_id = v_resident.facility_id
    )) then raise exception 'Meal record is invalid' using errcode = '22023'; end if;
  v_exception := case
    when p_outcome = 'refused' then 'meal_refusal'
    when p_outcome = 'missed' then 'missed_meal'
    when p_attendance = 'absent' then 'attendance_exception'
    when p_intake_percent is not null and p_intake_percent < 25 then 'low_intake'
    when nullif(btrim(p_exception_reason), '') is not null then 'other'
    else null end;
  if v_exception is not null and length(btrim(coalesce(p_exception_reason, ''))) < 5 then
    raise exception 'Meal exception reason is required' using errcode = '22023';
  end if;
  insert into public.resident_meal_records(
    organization_id, facility_id, resident_id, menu_entry_id, served_at,
    meal_period, attendance, outcome, intake_percent, substitution,
    assistance_provided, exception_type, exception_reason, recorded_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, p_menu_entry_id,
    p_served_at, p_meal_period, p_attendance, p_outcome, p_intake_percent,
    nullif(btrim(p_substitution), ''), nullif(btrim(p_assistance_provided), ''),
    v_exception, nullif(btrim(p_exception_reason), ''), auth.uid()
  ) returning id into v_id;
  if v_exception is not null then
    v_work := app_private.create_automatic_work_item(
      v_resident.organization_id, v_resident.facility_id, 'dietary.meal_exception',
      'dietary_exception', v_id, 'Review ' || replace(v_exception, '_', ' ') || ' for ' ||
        v_resident.first_name || ' ' || v_resident.last_name,
      btrim(p_exception_reason), 'high', now() + interval '1 day'
    );
    update public.resident_meal_records set work_item_id = v_work where id = v_id;
    perform app_private.track_dietary_exception_pattern(
      v_resident.organization_id, v_resident.facility_id, v_resident.id, v_exception,
      'resident:' || v_resident.id || ':meal:' || v_exception,
      replace(v_exception, '_', ' ')
    );
  end if;
  return v_id;
end
$$;

create or replace function public.record_resident_hydration_round(
  p_resident_id uuid, p_scheduled_at timestamptz, p_offered_ml integer,
  p_consumed_ml integer, p_outcome text, p_exception_recorded boolean,
  p_exception_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_id uuid;
  v_work uuid;
  v_exception boolean;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_dietary_contributor(v_resident.organization_id, v_resident.facility_id);
  v_exception := coalesce(p_exception_recorded, false) or p_outcome in ('refused', 'unavailable');
  if p_scheduled_at is null or p_offered_ml not between 0 and 3000
    or p_consumed_ml not between 0 and p_offered_ml
    or p_outcome not in ('accepted','refused','unavailable','not_applicable')
    or (v_exception and length(btrim(coalesce(p_exception_reason, ''))) < 5) then
    raise exception 'Hydration round is invalid' using errcode = '22023';
  end if;
  insert into public.resident_hydration_rounds(
    organization_id, facility_id, resident_id, scheduled_at, offered_ml,
    consumed_ml, outcome, exception_recorded, exception_reason, recorded_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    p_scheduled_at, p_offered_ml, p_consumed_ml, p_outcome, v_exception,
    nullif(btrim(p_exception_reason), ''), auth.uid()
  ) returning id into v_id;
  if v_exception then
    v_work := app_private.create_automatic_work_item(
      v_resident.organization_id, v_resident.facility_id, 'dietary.hydration_exception',
      'dietary_exception', v_id, 'Review hydration exception for ' ||
        v_resident.first_name || ' ' || v_resident.last_name,
      btrim(p_exception_reason), 'high', now() + interval '4 hours'
    );
    update public.resident_hydration_rounds set work_item_id = v_work where id = v_id;
    perform app_private.track_dietary_exception_pattern(
      v_resident.organization_id, v_resident.facility_id, v_resident.id,
      'hydration_exception', 'resident:' || v_resident.id || ':hydration', 'hydration exceptions'
    );
  end if;
  return v_id;
end
$$;

create or replace function public.assign_resident_weight_monitoring(
  p_resident_id uuid, p_frequency text, p_next_due_date date,
  p_change_threshold_lbs numeric, p_assigned_profile_id uuid, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_resident public.residents%rowtype; v_id uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);
  if p_frequency not in ('daily','weekly','biweekly','monthly','quarterly')
    or p_next_due_date is null or p_change_threshold_lbs <= 0
    or length(btrim(coalesce(p_reason, ''))) < 5
    or (p_assigned_profile_id is not null and not exists(
      select 1 from public.profiles where id = p_assigned_profile_id
        and organization_id = v_resident.organization_id and is_active
    )) then raise exception 'Weight monitoring assignment is invalid' using errcode = '22023'; end if;
  update public.weight_monitoring_assignments set active = false, updated_at = now()
  where resident_id = v_resident.id and active;
  insert into public.weight_monitoring_assignments(
    organization_id, facility_id, resident_id, frequency, next_due_date,
    change_threshold_lbs, assigned_profile_id, reason, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    p_frequency, p_next_due_date, p_change_threshold_lbs,
    p_assigned_profile_id, btrim(p_reason), auth.uid()
  ) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.record_resident_weight(
  p_assignment_id uuid, p_measured_at timestamptz, p_weight_lbs numeric, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.weight_monitoring_assignments%rowtype;
  v_prior numeric;
  v_change numeric;
  v_review boolean;
  v_id uuid;
  v_work uuid;
begin
  select * into v_assignment from public.weight_monitoring_assignments where id = p_assignment_id and active for update;
  if not found then raise exception 'Active weight assignment not found' using errcode = 'P0002'; end if;
  perform app_private.assert_dietary_contributor(v_assignment.organization_id, v_assignment.facility_id);
  if p_measured_at is null or p_measured_at > now() + interval '1 hour' or p_weight_lbs not between 1 and 1500 then
    raise exception 'Weight reading is invalid' using errcode = '22023';
  end if;
  select weight_lbs into v_prior from public.resident_weight_readings
  where resident_id = v_assignment.resident_id order by measured_at desc limit 1;
  v_change := case when v_prior is null then null else round(p_weight_lbs - v_prior, 2) end;
  v_review := v_change is not null and abs(v_change) >= v_assignment.change_threshold_lbs;
  insert into public.resident_weight_readings(
    organization_id, facility_id, resident_id, assignment_id, measured_at,
    weight_lbs, prior_weight_lbs, change_lbs, review_required, notes, recorded_by
  ) values (
    v_assignment.organization_id, v_assignment.facility_id, v_assignment.resident_id,
    v_assignment.id, p_measured_at, p_weight_lbs, v_prior, v_change, v_review,
    nullif(btrim(p_notes), ''), auth.uid()
  ) returning id into v_id;
  update public.weight_monitoring_assignments set next_due_date = case frequency
    when 'daily' then p_measured_at::date + 1
    when 'weekly' then p_measured_at::date + 7
    when 'biweekly' then p_measured_at::date + 14
    when 'monthly' then (p_measured_at::date + interval '1 month')::date
    else (p_measured_at::date + interval '3 months')::date end,
    updated_at = now() where id = v_assignment.id;
  if v_review then
    v_work := app_private.create_automatic_work_item(
      v_assignment.organization_id, v_assignment.facility_id, 'dietary.weight_review',
      'dietary_exception', v_id, 'Review resident weight change',
      'Recorded change of ' || v_change || ' lb meets the configured review threshold.',
      'high', now() + interval '1 day'
    );
    update public.resident_weight_readings set work_item_id = v_work where id = v_id;
    perform app_private.track_dietary_exception_pattern(
      v_assignment.organization_id, v_assignment.facility_id, v_assignment.resident_id,
      'weight_review', 'resident:' || v_assignment.resident_id || ':weight', 'weight review exceptions'
    );
  end if;
  return v_id;
end
$$;

create or replace function public.record_nutrition_risk_review(
  p_resident_id uuid, p_reviewed_at timestamptz, p_risk_level text,
  p_findings text, p_action_plan text, p_referral_type text,
  p_referral_recipient text, p_referral_status text, p_follow_up_due_date date
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_resident public.residents%rowtype; v_id uuid; v_work uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);
  if p_reviewed_at is null or p_risk_level not in ('low','moderate','high')
    or length(btrim(coalesce(p_findings, ''))) < 5
    or ((p_referral_type is null) <> (p_referral_status is null))
    or (p_referral_type is not null and p_referral_type not in ('provider','dietitian','speech_therapy','other'))
    or (p_referral_status is not null and p_referral_status not in ('not_needed','pending','scheduled','completed','declined'))
    or (p_referral_status = 'pending' and p_follow_up_due_date is null) then
    raise exception 'Nutrition review is invalid' using errcode = '22023';
  end if;
  insert into public.nutrition_risk_reviews(
    organization_id, facility_id, resident_id, reviewed_at, risk_level,
    findings, action_plan, referral_type, referral_recipient, referral_status,
    follow_up_due_date, reviewed_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, p_reviewed_at,
    p_risk_level, btrim(p_findings), nullif(btrim(p_action_plan), ''), p_referral_type,
    nullif(btrim(p_referral_recipient), ''), p_referral_status, p_follow_up_due_date, auth.uid()
  ) returning id into v_id;
  update public.resident_dietary_profiles set nutrition_risk = p_risk_level,
    updated_by = auth.uid(), updated_at = now() where resident_id = v_resident.id;
  if p_referral_status = 'pending' then
    v_work := app_private.create_automatic_work_item(
      v_resident.organization_id, v_resident.facility_id, 'dietary.referral_followup',
      'dietary_exception', v_id, 'Complete ' || replace(p_referral_type, '_', ' ') || ' referral',
      coalesce(nullif(btrim(p_action_plan), ''), btrim(p_findings)), 'high', p_follow_up_due_date::timestamptz
    );
    update public.nutrition_risk_reviews set work_item_id = v_work where id = v_id;
  end if;
  return v_id;
end
$$;

create or replace function public.upsert_food_safety_control_point(
  p_facility_id uuid, p_control_id uuid, p_control_type text, p_label text,
  p_location_detail text, p_measurement_unit text, p_minimum_value numeric,
  p_maximum_value numeric, p_frequency text, p_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_fac public.facilities%rowtype; v_id uuid;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);
  if p_control_type not in ('refrigerator_temperature','freezer_temperature','cooking_temperature','holding_temperature','dish_machine_temperature','food_storage_round','expiration_check','sanitation_round','kitchen_equipment')
    or length(btrim(coalesce(p_label, ''))) < 2 or length(btrim(coalesce(p_location_detail, ''))) < 2
    or p_measurement_unit not in ('fahrenheit','celsius','checklist')
    or length(btrim(coalesce(p_frequency, ''))) < 2
    or (p_measurement_unit <> 'checklist' and p_minimum_value is null and p_maximum_value is null)
    or (p_minimum_value is not null and p_maximum_value is not null and p_minimum_value > p_maximum_value) then
    raise exception 'Food-safety control point is invalid' using errcode = '22023';
  end if;
  if p_control_id is null then
    insert into public.food_safety_control_points(
      organization_id, facility_id, control_type, label, location_detail,
      measurement_unit, minimum_value, maximum_value, frequency, active, created_by
    ) values (
      v_fac.organization_id, v_fac.id, p_control_type, btrim(p_label), btrim(p_location_detail),
      p_measurement_unit, p_minimum_value, p_maximum_value, btrim(p_frequency), coalesce(p_active, true), auth.uid()
    ) returning id into v_id;
  else
    update public.food_safety_control_points set control_type = p_control_type,
      label = btrim(p_label), location_detail = btrim(p_location_detail),
      measurement_unit = p_measurement_unit, minimum_value = p_minimum_value,
      maximum_value = p_maximum_value, frequency = btrim(p_frequency),
      active = coalesce(p_active, true), updated_at = now()
    where id = p_control_id and facility_id = v_fac.id returning id into v_id;
    if v_id is null then raise exception 'Food-safety control point not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end
$$;

create or replace function public.record_food_safety_log(
  p_control_point_id uuid, p_observed_at timestamptz, p_observed_value numeric,
  p_checklist jsonb, p_result text, p_observation text,
  p_immediate_action text, p_equipment_reference text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_control public.food_safety_control_points%rowtype;
  v_result text;
  v_id uuid;
  v_work uuid;
  v_template text;
  v_kind text;
begin
  select * into v_control from public.food_safety_control_points where id = p_control_point_id and active;
  if not found then raise exception 'Active food-safety control point not found' using errcode = 'P0002'; end if;
  perform app_private.assert_dietary_contributor(v_control.organization_id, v_control.facility_id);
  if p_observed_at is null or p_observed_at > now() + interval '1 hour'
    or p_result not in ('compliant','exception')
    or jsonb_typeof(coalesce(p_checklist, '{}'::jsonb)) <> 'object'
    or (v_control.measurement_unit = 'checklist' and coalesce(p_checklist, '{}'::jsonb) = '{}'::jsonb)
    or (v_control.measurement_unit <> 'checklist' and p_observed_value is null) then
    raise exception 'Food-safety log is invalid' using errcode = '22023';
  end if;
  v_result := case
    when p_result = 'exception'
      or (v_control.minimum_value is not null and p_observed_value < v_control.minimum_value)
      or (v_control.maximum_value is not null and p_observed_value > v_control.maximum_value)
      then 'exception' else 'compliant' end;
  if v_result = 'exception' and length(btrim(coalesce(p_immediate_action, ''))) < 5 then
    raise exception 'Immediate protective action is required for an exception' using errcode = '22023';
  end if;
  insert into public.food_safety_logs(
    organization_id, facility_id, control_point_id, observed_at, observed_value,
    checklist, result, observation, immediate_action, equipment_reference, recorded_by
  ) values (
    v_control.organization_id, v_control.facility_id, v_control.id, p_observed_at,
    p_observed_value, coalesce(p_checklist, '{}'::jsonb), v_result,
    nullif(btrim(p_observation), ''), nullif(btrim(p_immediate_action), ''),
    nullif(btrim(p_equipment_reference), ''), auth.uid()
  ) returning id into v_id;
  if v_result = 'exception' then
    v_template := case when v_control.control_type = 'kitchen_equipment'
      then 'food_safety.equipment' else 'food_safety.exception' end;
    v_kind := case when v_control.control_type = 'kitchen_equipment'
      then 'kitchen_equipment' else 'food_safety_exception' end;
    v_work := app_private.create_automatic_work_item(
      v_control.organization_id, v_control.facility_id, v_template,
      'food_safety', v_id, 'Correct ' || v_control.label || ' exception',
      concat_ws(' - ', v_control.location_detail, nullif(btrim(p_observation), ''), btrim(p_immediate_action)),
      'urgent', now() + interval '4 hours'
    );
    update public.food_safety_logs set work_item_id = v_work where id = v_id;
    perform app_private.track_dietary_exception_pattern(
      v_control.organization_id, v_control.facility_id, null, v_kind,
      'food-safety:' || v_control.id, lower(v_control.label) || ' exceptions'
    );
  end if;
  return v_id;
end
$$;

create or replace function public.verify_food_safety_log(
  p_log_id uuid, p_corrective_action text, p_corrected_at timestamptz,
  p_verification_notes text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.food_safety_logs%rowtype;
begin
  select * into v from public.food_safety_logs where id = p_log_id for update;
  if not found then raise exception 'Food-safety log not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.result <> 'exception' or v.verified_at is not null or p_corrected_at is null
    or length(btrim(coalesce(p_corrective_action, ''))) < 5
    or length(btrim(coalesce(p_verification_notes, ''))) < 5 then
    raise exception 'Food-safety verification is invalid' using errcode = '22023';
  end if;
  update public.food_safety_logs set corrected_at = p_corrected_at,
    corrective_action = btrim(p_corrective_action), verified_by = auth.uid(),
    verified_at = now(), verification_notes = btrim(p_verification_notes)
  where id = v.id;
  insert into public.dietary_operations_history(
    organization_id, facility_id, entity_type, entity_id, event_type,
    summary, evidence, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, 'food_safety_log', v.id, 'verified',
    'Food-safety corrective action verified',
    jsonb_build_object('workItemId', v.work_item_id, 'correctedAt', p_corrected_at), auth.uid()
  );
  return true;
end
$$;

create or replace function public.upsert_food_service_qualification(
  p_employee_id uuid, p_qualification_type text, p_qualification_label text,
  p_issued_on date, p_expires_on date, p_status text, p_issuing_authority text,
  p_evidence_reference text, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_employee public.employees%rowtype; v_id uuid;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_employee.organization_id, v_employee.facility_id);
  if p_qualification_type not in ('food_handler_certification','sanitation_training','allergen_awareness','manager_certification','therapeutic_diet_training','other')
    or p_status not in ('compliant','due_soon','expired','missing','not_applicable')
    or (p_expires_on is not null and p_issued_on is not null and p_expires_on < p_issued_on) then
    raise exception 'Food-service qualification is invalid' using errcode = '22023';
  end if;
  insert into public.food_service_employee_qualifications(
    organization_id, facility_id, employee_id, qualification_type,
    qualification_label, issued_on, expires_on, status, issuing_authority,
    evidence_reference, notes, verified_by, verified_at
  ) values (
    v_employee.organization_id, v_employee.facility_id, v_employee.id,
    p_qualification_type, nullif(btrim(p_qualification_label), ''), p_issued_on,
    p_expires_on, p_status, nullif(btrim(p_issuing_authority), ''),
    nullif(btrim(p_evidence_reference), ''), nullif(btrim(p_notes), ''), auth.uid(), now()
  ) on conflict (employee_id, qualification_type) do update set
    qualification_label = excluded.qualification_label, issued_on = excluded.issued_on,
    expires_on = excluded.expires_on, status = excluded.status,
    issuing_authority = excluded.issuing_authority,
    evidence_reference = excluded.evidence_reference, notes = excluded.notes,
    verified_by = auth.uid(), verified_at = now(), updated_at = now()
  returning id into v_id;
  return v_id;
end
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'resident_dietary_profiles', 'resident_dietary_profile_history',
    'dietary_menu_cycles', 'dietary_menu_entries', 'resident_meal_records',
    'resident_hydration_rounds', 'weight_monitoring_assignments',
    'resident_weight_readings', 'nutrition_risk_reviews',
    'food_safety_control_points', 'food_safety_logs',
    'food_service_employee_qualifications', 'dietary_exception_patterns',
    'dietary_operations_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app_private.dietary_row_visible(organization_id, facility_id))',
      t || '_select', t
    );
  end loop;
end
$$;

revoke all on function app_private.dietary_row_visible(uuid,uuid),
  app_private.assert_dietary_contributor(uuid,uuid),
  app_private.track_dietary_exception_pattern(uuid,uuid,uuid,text,text,text)
from public, anon, authenticated, service_role;
grant execute on function app_private.dietary_row_visible(uuid,uuid) to authenticated;

revoke all on function public.upsert_resident_dietary_profile(uuid,jsonb,text),
  public.create_dietary_menu_cycle(uuid,text,date,integer,text,jsonb),
  public.record_resident_meal(uuid,timestamptz,text,text,text,integer,text,text,text,uuid),
  public.record_resident_hydration_round(uuid,timestamptz,integer,integer,text,boolean,text),
  public.assign_resident_weight_monitoring(uuid,text,date,numeric,uuid,text),
  public.record_resident_weight(uuid,timestamptz,numeric,text),
  public.record_nutrition_risk_review(uuid,timestamptz,text,text,text,text,text,text,date),
  public.upsert_food_safety_control_point(uuid,uuid,text,text,text,text,numeric,numeric,text,boolean),
  public.record_food_safety_log(uuid,timestamptz,numeric,jsonb,text,text,text,text),
  public.verify_food_safety_log(uuid,text,timestamptz,text),
  public.upsert_food_service_qualification(uuid,text,text,date,date,text,text,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.upsert_resident_dietary_profile(uuid,jsonb,text),
  public.create_dietary_menu_cycle(uuid,text,date,integer,text,jsonb),
  public.record_resident_meal(uuid,timestamptz,text,text,text,integer,text,text,text,uuid),
  public.record_resident_hydration_round(uuid,timestamptz,integer,integer,text,boolean,text),
  public.assign_resident_weight_monitoring(uuid,text,date,numeric,uuid,text),
  public.record_resident_weight(uuid,timestamptz,numeric,text),
  public.record_nutrition_risk_review(uuid,timestamptz,text,text,text,text,text,text,date),
  public.upsert_food_safety_control_point(uuid,uuid,text,text,text,text,numeric,numeric,text,boolean),
  public.record_food_safety_log(uuid,timestamptz,numeric,jsonb,text,text,text,text),
  public.verify_food_safety_log(uuid,text,timestamptz,text),
  public.upsert_food_service_qualification(uuid,text,text,date,date,text,text,text,text)
to authenticated;

-- Extend QAPI snapshots with authoritative dietary and food-safety signals.
create or replace function public.get_qapi_source_metrics(p_facility_id uuid, p_from date, p_through date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_fac public.facilities%rowtype; v_complaints jsonb;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found or not app_private.admission_row_visible(v_fac.organization_id, v_fac.id) then
    raise exception 'QAPI metrics outside scope' using errcode = '42501';
  end if;
  if p_from is null or p_through is null or p_from > p_through then
    raise exception 'QAPI metric period is invalid' using errcode = '22023';
  end if;
  v_complaints := public.get_complaint_trends(v_fac.id, p_from, p_through);
  return jsonb_build_object(
    'falls', (select count(*) from public.resident_change_events where facility_id=v_fac.id and category='fall' and identified_at::date between p_from and p_through),
    'medicationIncidents', (select count(*) from public.incidents where facility_id=v_fac.id and incident_type='medication_error' and occurred_at::date between p_from and p_through),
    'hospitalTransfers', (select count(*) from public.resident_change_events where facility_id=v_fac.id and (category in('emergency_department_visit','hospital_return') or emergency_transfer) and identified_at::date between p_from and p_through),
    'missedServices', (select count(*) from public.resident_service_task_instances where facility_id=v_fac.id and status='not_completed' and scheduled_start::date between p_from and p_through),
    'lateServices', (select count(*) from public.resident_service_task_instances where facility_id=v_fac.id and status='completed_late' and scheduled_start::date between p_from and p_through),
    'lateAssessments', (select count(*) from public.resident_compliance_items where facility_id=v_fac.id and status='expired' and item_type in('initial_assessment_15day','annual_reassessment','significant_change_reassessment','support_plan_30day')),
    'trainingGaps', (select count(*) from public.employee_training_records where facility_id=v_fac.id and status in('missing','expired')),
    'citationRecurrence', (select count(*) from (select citation_topic_id from public.dhs_violations where facility_id=v_fac.id and inspection_date between p_from and p_through group by citation_topic_id having count(*)>1)x),
    'inspectionDeficiencies', (select count(*) from public.inspection_events where facility_id=v_fac.id and result in('fail','deficiency_noted') and performed_date between p_from and p_through),
    'nutritionExceptions', (
      (select count(*) from public.resident_meal_records where facility_id=v_fac.id and exception_type is not null and served_at::date between p_from and p_through)
      + (select count(*) from public.resident_hydration_rounds where facility_id=v_fac.id and exception_recorded and scheduled_at::date between p_from and p_through)
      + (select count(*) from public.resident_weight_readings where facility_id=v_fac.id and review_required and measured_at::date between p_from and p_through)
    ),
    'mealRefusals', (select count(*) from public.resident_meal_records where facility_id=v_fac.id and exception_type='meal_refusal' and served_at::date between p_from and p_through),
    'hydrationExceptions', (select count(*) from public.resident_hydration_rounds where facility_id=v_fac.id and exception_recorded and scheduled_at::date between p_from and p_through),
    'weightReviews', (select count(*) from public.resident_weight_readings where facility_id=v_fac.id and review_required and measured_at::date between p_from and p_through),
    'foodSafetyExceptions', (select count(*) from public.food_safety_logs where facility_id=v_fac.id and result='exception' and observed_at::date between p_from and p_through),
    'openNutritionReferrals', (select count(*) from public.nutrition_risk_reviews where facility_id=v_fac.id and referral_status in('pending','scheduled')),
    'currentInactiveStaff', (select count(*) from public.employees where facility_id=v_fac.id and status<>'active'),
    'complaints', (v_complaints->>'total')::integer,
    'highRiskComplaints', (v_complaints->>'highRisk')::integer,
    'residentRightsComplaints', (v_complaints->>'residentRights')::integer,
    'appointmentFailures', jsonb_build_object('available',false,'count',0),
    'periodStart', p_from, 'periodEnd', p_through
  );
end
$$;
revoke all on function public.get_qapi_source_metrics(uuid,date,date)
from public, anon, authenticated, service_role;
grant execute on function public.get_qapi_source_metrics(uuid,date,date) to authenticated;

-- Reuse the administrative packet instead of introducing another resident data silo.
alter function public.get_resident_administrative_packet(uuid)
  rename to get_resident_administrative_packet_before_dietary;
revoke all on function public.get_resident_administrative_packet_before_dietary(uuid)
from public, anon, authenticated, service_role;

create or replace function public.get_resident_administrative_packet(p_resident_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_packet jsonb;
begin
  v_packet := public.get_resident_administrative_packet_before_dietary(p_resident_id);
  return v_packet || jsonb_build_object(
    'dietaryProfile', (
      select jsonb_build_object(
        'id', p.id, 'version', p.version, 'dietOrder', p.diet_order,
        'prescribedDiet', p.prescribed_diet, 'foodAllergies', p.food_allergies,
        'textureConsistency', p.texture_consistency,
        'liquidConsistency', p.liquid_consistency,
        'fluidPlanType', p.fluid_plan_type, 'fluidTargetMl', p.fluid_target_ml,
        'adaptiveEquipment', p.adaptive_equipment,
        'feedingAssistance', p.feeding_assistance,
        'residentPreferences', p.resident_preferences,
        'culturalReligiousPreferences', p.cultural_religious_preferences,
        'nutritionRisk', p.nutrition_risk, 'reviewDueDate', p.review_due_date
      ) from public.resident_dietary_profiles p where p.resident_id = p_resident_id
    ),
    'weightMonitoring', (
      select jsonb_build_object(
        'assignmentId', a.id, 'frequency', a.frequency, 'nextDueDate', a.next_due_date,
        'changeThresholdLbs', a.change_threshold_lbs,
        'latestWeight', (select jsonb_build_object('weightLbs', r.weight_lbs, 'measuredAt', r.measured_at, 'reviewRequired', r.review_required)
          from public.resident_weight_readings r where r.resident_id = p_resident_id order by r.measured_at desc limit 1)
      ) from public.weight_monitoring_assignments a where a.resident_id = p_resident_id and a.active
    )
  );
end
$$;
revoke all on function public.get_resident_administrative_packet(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_resident_administrative_packet(uuid) to authenticated;

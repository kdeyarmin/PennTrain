-- The database's calendar day is not the facility's calendar day.
--
-- Hosted Supabase runs with TimeZone = UTC, so `current_date` is the UTC day. Every facility this
-- product serves is in Pennsylvania (America/New_York), which is UTC-4 or UTC-5. From 19:00 or 20:00
-- local until midnight -- the evening documentation window and the whole start of the night shift --
-- `current_date` is already TOMORROW in Pennsylvania terms.
--
-- Observed, not theorised. At 20:56 ET on 2026-07-26, against a stack with nothing special done to
-- it:
--
--     select app_private.service_effective_date(null::public.resident_assessment_forms);  -- 2026-07-27
--     select (now() at time zone 'America/New_York')::date;                               -- 2026-07-26
--
-- so an assessment form finalised that evening dated its services to a day that had not started yet.
--
-- The same one-day skew ran through 59 live functions in three shapes, each with its own failure:
--
--   * DATES WE RECORD. complete_resident_compliance_item stamps completed_date, complete_course_-
--     assignment stamps completion_date, save_employee_credential stamps last_verified_date,
--     transition_resident_census stamps discharge_date, complete_move_in_admission stamps
--     admission_date, apply_scim_change and apply_hris_import_batch stamp lifecycle event dates,
--     record_citation_verification stamps verified_on. Work done at 21:00 on the 26th is filed as
--     having happened on the 27th. These are the dates a DHS inspector reads back.
--
--   * DATES WE VALIDATE AGAINST. save_resident_assessment_review rejects a review dated in the
--     future, record_support_plan_participation rejects future participation, create_qapi_project
--     rejects a target completion date in the past, preview_employee_lifecycle_transition rejects a
--     future effective date. Each guard was a day out, in whichever direction did the wrong thing:
--     after 20:00 ET a review could be post-dated to tomorrow and accepted, and a QAPI project
--     targeted at today was refused as already past.
--
--   * TODAY'S SCHEDULE. decide_open_shift_claim, request_shift_swap and list_shift_swap_candidates
--     all refuse to act on a shift whose shift_date < current_date, and get_my_shift_workspace lists
--     only shifts with shift_date >= current_date. After 20:00 ET, tonight's 23:00-07:00 shift is
--     dated "yesterday": it disappears from the workspace, its open claims cannot be approved, and
--     it cannot be swapped -- at exactly the hour a facility is scrambling to cover it.
--
-- The convention this adopts is not new. 20260724160000 already fixed this for the compliance recalc
-- path, with `(now() at time zone 'America/New_York')::date` written inline in six places, and its
-- header notes that near midnight ET the two disagree "and the UTC value silently won". This
-- finishes that job and gives the convention a name so it stops being re-derived.
--
-- WHY public AND NOT app_private. It was drafted in app_private, which is where a helper like this
-- belongs, and that failed immediately: `authenticated` holds no USAGE on app_private (the schema
-- grants it to postgres and service_role only), so every SECURITY INVOKER caller -- get_org_dashboard_-
-- summary, get_operations_command_center, generate_paged_compliance_report and the rest -- raised
-- "permission denied for schema app_private". The fix for that is NOT to widen the schema grant: the
-- narrowness of app_private is a real control and handing it to `authenticated` to place a helper
-- would trade a security boundary for tidiness. pa_today() takes no argument, reads nothing, and
-- returns a date, so exposing it in public costs nothing -- the extra PostgREST endpoint discloses
-- what a wall clock discloses.
--
-- HOW THIS FILE WAS WRITTEN. The bodies below are not retyped. Each is `pg_get_functiondef` of the
-- LIVE function with exactly one substitution applied -- the token `current_date` (word-bounded, so
-- `v_current_date` and friends are untouched) replaced by `public.pa_today()`. Generating from the
-- live catalogue rather than from an older migration is deliberate: a `create or replace` rebased on
-- a stale copy silently deletes every change made to that function since, which has already happened
-- twice in this program. Nothing else in any body was edited, and the migration was verified by
-- re-extracting all 59 definitions after applying it and diffing them against the pre-migration
-- definitions under the same substitution -- the diff is empty.
--
-- WHAT KEEPS IT FIXED. Re-introducing `current_date` is a one-token mistake and would be invisible,
-- so pa_day_is_the_facility_day.test.sql asserts that no function, column default, constraint, view,
-- index or policy references it at all, and names the offenders when one does. That assertion is the
-- actual deliverable here; the 59 function bodies and 10 column defaults below are what make it pass
-- today.
--
-- NOT DONE HERE. There is no per-facility timezone in the schema -- no column on facilities or
-- organizations models one -- and inventing one is a data-model decision, not a bug fix. pa_today()
-- is honest about that: it is the Pennsylvania calendar day, for a Pennsylvania product. If the
-- product ever serves a facility outside ET, this function is the single place that has to grow a
-- facility argument, and the assertion above is what will point every caller at it.

create or replace function public.pa_today()
returns date
language sql
stable
as $$
  -- No `set search_path`: this references nothing outside pg_catalog, and leaving it off keeps the
  -- function inlinable, which matters because it is called inside per-row filters.
  select (now() at time zone 'America/New_York')::date
$$;

comment on function public.pa_today() is
  'The facility calendar day (America/New_York). Use instead of current_date, which is the UTC day '
  'on hosted Supabase and is therefore one day ahead every evening after 20:00 ET.';

-- Not granted to anon. The first draft did grant it, on the theory that a guest/portal path
-- might need it; checked, and none does -- no SECURITY INVOKER function reachable by anon calls
-- these helpers, and anon holds INSERT on none of the tables whose defaults now evaluate one.
-- Inside a SECURITY DEFINER function the grant is irrelevant anyway: the body runs as the owner.
grant execute on function public.pa_today() to authenticated, service_role;


-- Column defaults ---------------------------------------------------------------------------------
--
-- These were nearly missed, and the way they were nearly missed is worth recording. The first sweep
-- for `current_date` outside function bodies used a case-SENSITIVE regex and came back empty, so
-- this migration was briefly written as "functions were the only place it appeared". They were not:
-- pg_get_expr renders the default as `CURRENT_DATE`, in capitals, and the sweep could not see its
-- own blind spot. What surfaced them was the pgTAP suite failing afterwards -- support_plan_-
-- assessment_mapping_rules.effective_from defaulted to the UTC day while match_support_plan_rules
-- had just started asking for the Pennsylvania day, so `pa_today() between effective_from and ...`
-- was false for every rule created that evening and no rule fired at all.
--
-- That is the more dangerous half of this bug, because a default has no code to grep: a review row
-- inserted at 21:00 ET gets review_date = tomorrow with nothing in any function body to blame. The
-- assertion in pa_day_is_the_facility_day.test.sql matches case-insensitively for exactly this
-- reason.

alter table public.admission_prospects alter column inquiry_date set default public.pa_today();
alter table public.compliance_profile_definitions alter column effective_from set default public.pa_today();
alter table public.compliance_profile_mapping_rules alter column effective_from set default public.pa_today();
alter table public.employee_compliance_profile_assignments alter column effective_from set default public.pa_today();
alter table public.mock_inspection_runs alter column as_of_date set default public.pa_today();
alter table public.qapi_projects alter column start_date set default public.pa_today();
alter table public.resident_assessment_reviews alter column review_date set default public.pa_today();
alter table public.resident_dietary_profiles alter column effective_date set default public.pa_today();
alter table public.resident_financial_statements alter column issued_on set default public.pa_today();
alter table public.support_plan_assessment_mapping_rules alter column effective_from set default public.pa_today();

-- app_private.activate_support_plan
CREATE OR REPLACE FUNCTION app_private.activate_support_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.resident_support_plans%rowtype;
  svc jsonb;
  v_kind text;
  v_responses text[];
begin
  select * into v from public.resident_support_plans where id = p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode='P0002'; end if;
  if v.state = 'active' then return; end if;

  perform set_config('app.allow_support_plan_history_update','true',true);
  update public.resident_support_plans set state='superseded', updated_at=now()
    where resident_id=v.resident_id and state='active' and id<>v.id;
  update public.resident_support_plans set state='active', staff_notified_at=now(), updated_at=now()
    where id=v.id;
  update public.resident_service_requirements set status='superseded', superseded_at=now(), updated_at=now()
    where resident_id=v.resident_id and status='active';

  for svc in select * from jsonb_array_elements(coalesce(v.services,'[]'::jsonb)) loop
    -- Explicit opt-out only; see the note above.
    continue when coalesce((svc->>'generate_service')::boolean, true) = false;

    v_kind := coalesce(nullif(btrim(svc->>'task_kind'), ''), 'scheduled_care');
    if v_kind not in ('scheduled_care','shift_task','weekly_task','as_needed','observation','manager_review','documentation_requirement') then
      v_kind := 'scheduled_care';
    end if;

    if svc ? 'acceptable_completion_responses'
      and jsonb_typeof(svc->'acceptable_completion_responses') = 'array'
      and jsonb_array_length(svc->'acceptable_completion_responses') > 0 then
      select array_agg(value) into v_responses
        from jsonb_array_elements_text(svc->'acceptable_completion_responses') as value
        where value = any(array[
          'completed_as_planned','completed_with_more_assistance','partially_completed',
          'resident_refused','resident_unavailable','not_completed','concern_observed']);
    else
      v_responses := null;
    end if;
    -- An entry that listed only unrecognized responses falls back to the kind's defaults rather
    -- than producing a service nobody can close.
    v_responses := coalesce(nullif(v_responses, array[]::text[]), app_private.default_completion_responses(v_kind));

    insert into public.resident_service_requirements(
      organization_id, facility_id, resident_id, source_assessment_form_id, source_plan_version,
      source_section, source_key, service_code, service_name, need_description, special_instructions,
      frequency, frequency_detail, time_window_start, time_window_end, responsible_role,
      requires_two_staff, documentation_mode, effective_from, expires_on,
      task_kind, required_qualification_key, acceptable_completion_responses,
      refusal_handling, escalation_conditions, escalate_after_exceptions
    )
    values (
      v.organization_id, v.facility_id, v.resident_id,
      coalesce(v.assessment_form_id, (select id from public.resident_assessment_forms where resident_id=v.resident_id order by created_at desc limit 1)),
      v.version_number, 'support_plan_services',
      (v.id::text || ':' || coalesce(svc->>'key', svc->>'service_code', extensions.gen_random_uuid()::text)),
      coalesce(svc->>'service_code','support_plan_service'),
      coalesce(svc->>'service_name', svc->>'name','Support-plan service'),
      svc->>'need',
      coalesce(svc->>'staff_instructions', v.staff_instructions, ''),
      coalesce(nullif(svc->>'frequency',''),'daily'),
      svc->>'frequency_detail',
      coalesce((svc->>'time_window_start')::time,'09:00'::time),
      coalesce((svc->>'time_window_end')::time,'11:00'::time),
      coalesce(svc->>'responsible_role','employee'),
      coalesce((svc->>'requires_two_staff')::boolean,false),
      coalesce(svc->>'documentation_mode','every_task'),
      coalesce(v.effective_date, public.pa_today()),
      nullif(svc->>'expires_on','')::date,
      v_kind,
      nullif(btrim(coalesce(svc->>'required_qualification_key','')), ''),
      v_responses,
      nullif(btrim(coalesce(svc->>'refusal_handling','')), ''),
      nullif(btrim(coalesce(svc->>'escalation_conditions','')), ''),
      nullif(svc->>'escalate_after_exceptions','')::integer
    )
    on conflict (source_assessment_form_id, source_section, source_key) do nothing;
  end loop;
  perform set_config('app.allow_support_plan_history_update','false',true);

  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values)
  values(v.organization_id,auth.uid(),'resident_support_plan',v.id::text,'support_plan.active',
    jsonb_build_object('effectiveDate',v.effective_date,'reviewDueDate',v.review_due_date));
end $function$
;

-- app_private.ensure_compliance_instances
CREATE OR REPLACE FUNCTION app_private.ensure_compliance_instances(p_requirement_id uuid, p_through date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.compliance_requirements%rowtype;
  v_interval interval;
  v_last_due date;
  v_next date;
  v_prev date;
  v_count integer := 0;
  v_guard integer := 0;
begin
  select * into r from public.compliance_requirements where id = p_requirement_id;
  if not found or r.is_template or not r.is_active or r.facility_id is null then
    return 0;
  end if;

  v_interval := app_private.compliance_interval(r.recurrence, r.custom_interval_days);
  select max(due_date) into v_last_due from public.compliance_requirement_instances where requirement_id = r.id;

  -- First occurrence (always created, even if its due date is beyond the horizon, so a new
  -- requirement is immediately visible in the register).
  if v_last_due is null then
    v_next := coalesce(r.anchor_date, public.pa_today());
    insert into public.compliance_requirement_instances
      (organization_id, facility_id, building_id, requirement_id, period_start, due_date, responsible_profile_id)
    values (r.organization_id, r.facility_id, r.building_id, r.id, v_next, v_next, r.responsible_profile_id)
    on conflict (requirement_id, due_date) do nothing;
    if found then
      insert into public.compliance_requirement_events
        (organization_id, facility_id, requirement_id, instance_id, event_type, new_status, metadata)
      select r.organization_id, r.facility_id, r.id, i.id, 'instance_generated', i.status,
             jsonb_build_object('due_date', v_next)
      from public.compliance_requirement_instances i
      where i.requirement_id = r.id and i.due_date = v_next;
      v_count := v_count + 1;
    end if;
    v_last_due := v_next;
  end if;

  -- Roll forward recurring occurrences within the horizon. Derive each due date from the original
  -- anchor (anchor + n*interval) rather than chaining interval additions, so month-end and leap-day
  -- schedules do not drift (Jan 31 -> Feb 28 -> Mar 31, not -> Mar 28).
  if v_interval is not null then
    declare
      v_base date := coalesce(r.anchor_date,
        (select min(due_date) from public.compliance_requirement_instances where requirement_id = r.id));
      v_n integer := 0;
    begin
      loop
        v_guard := v_guard + 1;
        exit when v_guard > 1200;
        v_n := v_n + 1;
        v_prev := (v_base + (v_interval * (v_n - 1)))::date;
        v_next := (v_base + (v_interval * v_n))::date;
        continue when v_next <= v_last_due;  -- already generated; skip
        exit when v_next > p_through;
        insert into public.compliance_requirement_instances
          (organization_id, facility_id, building_id, requirement_id, period_start, due_date, responsible_profile_id)
        values (r.organization_id, r.facility_id, r.building_id, r.id, v_prev, v_next, r.responsible_profile_id)
        on conflict (requirement_id, due_date) do nothing;
        if found then
          insert into public.compliance_requirement_events
            (organization_id, facility_id, requirement_id, instance_id, event_type, new_status, metadata)
          select r.organization_id, r.facility_id, r.id, i.id, 'instance_generated', i.status,
                 jsonb_build_object('due_date', v_next)
          from public.compliance_requirement_instances i
          where i.requirement_id = r.id and i.due_date = v_next;
          v_count := v_count + 1;
        end if;
      end loop;
    end;
  end if;

  return v_count;
end $function$
;

-- app_private.match_support_plan_rules
CREATE OR REPLACE FUNCTION app_private.match_support_plan_rules(p_organization_id uuid, p_facility_id uuid, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_rule record;
  v_answer jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  for v_rule in
    select r.*
    from public.support_plan_assessment_mapping_rules r
    where r.is_active
      and (r.organization_id is null or r.organization_id = p_organization_id)
      and (r.facility_id is null or r.facility_id = p_facility_id)
      and public.pa_today() between r.effective_from and coalesce(r.effective_to, public.pa_today())
    order by r.rule_key, r.version desc
  loop
    v_answer := p_answers -> v_rule.assessment_item_key;
    if app_private.mapping_rule_condition_matches(v_rule.condition, v_answer) then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'ruleKey', v_rule.rule_key,
        'ruleVersion', v_rule.version,
        'assessmentItemKey', v_rule.assessment_item_key,
        'answer', v_answer,
        'rationale', v_rule.rationale,
        -- The rule's own object is on the RIGHT of ||, so a rule that curates its own key keeps it.
        -- The seeded PA rules do exactly this, and two rules deliberately sharing a key must stay
        -- one plan entry.
        'need', case when v_rule.proposed_need <> '{}'::jsonb
                then jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_need end,
        'service', case when v_rule.proposed_service <> '{}'::jsonb
                   then jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_service end,
        'intervention', case when v_rule.proposed_intervention <> '{}'::jsonb
                        then jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_intervention end,
        'dme', case when v_rule.proposed_dme <> '{}'::jsonb
               then jsonb_build_object('key', v_rule.rule_key) || v_rule.proposed_dme end
      ));
    end if;
  end loop;
  return v_items;
end $function$
;

-- app_private.seed_demo_clinical_data
CREATE OR REPLACE FUNCTION app_private.seed_demo_clinical_data(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org public.organizations%rowtype;
  v_facility public.facilities%rowtype;
  v_resident_id uuid;
  v_actor_id uuid;
  v_source_id uuid;
  v_plan_id uuid;
begin
  -- Only ever touch demo tenants.
  select * into v_org from public.organizations where id = p_organization_id and is_demo;
  if v_org.id is null then
    return;
  end if;

  -- Anchor facility (same selection the operational seed uses) and the anchor resident.
  select * into v_facility
  from public.facilities
  where organization_id = v_org.id and is_active
  order by case facility_type when 'PCH' then 0 when 'ALR' then 1 else 2 end, created_at, id
  limit 1;
  if v_facility.id is null then
    return;
  end if;

  select id into v_resident_id from public.residents
  where organization_id = v_org.id and first_name = 'Evelyn' and last_name = 'Brooks'
  order by created_at limit 1;
  if v_resident_id is null then
    return;
  end if;

  -- A manager/admin profile to attribute authored records to (nullable columns tolerate none).
  select p.id into v_actor_id from public.profiles p
  where p.organization_id = v_org.id and p.role in ('facility_manager', 'org_admin')
  order by case p.role when 'facility_manager' then 0 else 1 end, p.created_at
  limit 1;

  -- Clinical capability is on by default; make the demo tenant's posture explicit.
  update public.residents
  set clinical_data_consent = 'granted', updated_at = now()
  where id = v_resident_id and clinical_data_consent = 'not_recorded';
  update public.facilities
  set clinical_enabled = true, updated_at = now()
  where id = v_facility.id and clinical_enabled is distinct from true;

  -- ---------------------------------------------------------------------------------------------
  -- Lane B (native): vitals, care plan + goal, assessment, signed progress note.
  -- ---------------------------------------------------------------------------------------------

  -- Vitals trend (shows a blood-pressure improvement + normal supporting vitals).
  insert into public.clinical_observations (
    organization_id, facility_id, resident_id, observation_type, loinc_code,
    value_numeric, value_secondary, value_text, unit, observed_at,
    recorded_by_profile_id, recorded_by_name, abnormal_flag, source, note
  )
  select v_org.id, v_facility.id, v_resident_id, s.otype, s.loinc,
    s.vnum, s.vsec, null, s.unit, now() - s.ago,
    v_actor_id, 'CareBase Demo', s.flag, 'native', s.note
  from (values
    ('blood_pressure', '85354-9', 148::numeric, 90::numeric, 'mm[Hg]', interval '3 days', 'high',    'Recheck after rest; resident asymptomatic'),
    ('blood_pressure', '85354-9', 138::numeric, 84::numeric, 'mm[Hg]', interval '2 days', 'high',    null),
    ('blood_pressure', '85354-9', 126::numeric, 78::numeric, 'mm[Hg]', interval '6 hours', 'normal', 'Improved on morning meds'),
    ('heart_rate',     '8867-4',  74::numeric,  null,        '/min',   interval '6 hours', 'normal', null),
    ('spo2',           '59408-5', 97::numeric,  null,        '%',      interval '6 hours', 'normal', null),
    ('weight',         '29463-7', 69.4::numeric, null,       'kg',     interval '1 day',  'normal', null),
    ('pain_score',     '72514-3', 2::numeric,   null,        '{score}', interval '6 hours', 'normal', 'Mild left-knee discomfort with activity')
  ) as s(otype, loinc, vnum, vsec, unit, ago, flag, note)
  where not exists (
    select 1 from public.clinical_observations o
    where o.resident_id = v_resident_id and o.recorded_by_name = 'CareBase Demo'
  );

  -- Care plan + goal.
  insert into public.clinical_care_plans (
    organization_id, facility_id, resident_id, title, category, status,
    period_start, authored_by_profile_id
  )
  select v_org.id, v_facility.id, v_resident_id, 'Fall risk reduction', 'safety', 'active',
    public.pa_today() - 30, v_actor_id
  where not exists (
    select 1 from public.clinical_care_plans c
    where c.resident_id = v_resident_id and c.title = 'Fall risk reduction'
  )
  returning id into v_plan_id;
  if v_plan_id is null then
    select id into v_plan_id from public.clinical_care_plans
    where resident_id = v_resident_id and title = 'Fall risk reduction'
    order by created_at limit 1;
  end if;

  insert into public.clinical_care_plan_goals (
    organization_id, facility_id, care_plan_id, description, target_measure, status
  )
  select v_org.id, v_facility.id, v_plan_id,
    'Remain free of falls with injury through the next 90 days',
    'Zero falls with injury; walker used for all ambulation', 'active'
  where v_plan_id is not null and not exists (
    select 1 from public.clinical_care_plan_goals g where g.care_plan_id = v_plan_id
  );

  -- Assessment (finalized Morse fall-risk score).
  insert into public.clinical_assessments (
    organization_id, facility_id, resident_id, assessment_type, instrument_loinc,
    score, risk_band, responses, assessed_at, assessed_by_profile_id, assessed_by_name,
    status, finalized_at
  )
  select v_org.id, v_facility.id, v_resident_id, 'morse_fall', '59461-8',
    45, 'moderate',
    jsonb_build_object(
      'historyOfFalling', 25, 'secondaryDiagnosis', 15, 'ambulatoryAid', 0,
      'ivHeplock', 0, 'gait', 10, 'mentalStatus', 0),
    now() - interval '2 days', v_actor_id, 'CareBase Demo', 'final', now() - interval '2 days'
  where not exists (
    select 1 from public.clinical_assessments a
    where a.resident_id = v_resident_id and a.assessed_by_name = 'CareBase Demo'
  );

  -- Signed nursing progress note.
  insert into public.clinical_progress_notes (
    organization_id, facility_id, resident_id, note_type, authored_at,
    author_profile_id, author_name, body, status, signed_at, signed_by_profile_id, care_plan_id
  )
  select v_org.id, v_facility.id, v_resident_id, 'nursing', now() - interval '1 day',
    v_actor_id, 'CareBase Demo',
    'Resident alert and oriented. Ambulating with rolling walker and standby assist. Blood '
    || 'pressure trending down on current regimen; no orthostatic symptoms reported. Continues '
    || 'on fall-risk precautions per care plan. Tolerating heart-healthy diet well.',
    'signed', now() - interval '1 day', v_actor_id, v_plan_id
  where not exists (
    select 1 from public.clinical_progress_notes n
    where n.resident_id = v_resident_id and n.author_name = 'CareBase Demo'
  );

  -- ---------------------------------------------------------------------------------------------
  -- Lane A (FHIR ingestion boundary): source, patient mapping, sample medications/allergy/problems.
  -- ---------------------------------------------------------------------------------------------

  insert into public.fhir_integration_sources (
    organization_id, facility_id, name, vendor_name, fhir_base_url, external_facility_id,
    supported_resources, status, last_sync_completed_at, created_by
  ) values (
    v_org.id, v_facility.id, 'Demo EHR Connection', 'Demo FHIR Sandbox',
    'https://fhir.demo.invalid/r4', 'demo-facility-1',
    array['MedicationRequest', 'MedicationAdministration', 'AllergyIntolerance', 'Condition']::text[],
    'active', now() - interval '20 minutes', v_actor_id
  )
  on conflict (organization_id, vendor_name, external_facility_id) do nothing;

  select id into v_source_id from public.fhir_integration_sources
  where organization_id = v_org.id and vendor_name = 'Demo FHIR Sandbox'
    and external_facility_id = 'demo-facility-1';
  if v_source_id is null then
    return;
  end if;

  insert into public.fhir_patient_mappings (
    organization_id, facility_id, source_id, resident_id, fhir_patient_id,
    fhir_patient_identifier, mapped_by
  ) values (
    v_org.id, v_facility.id, v_source_id, v_resident_id, 'demo-patient-evelyn',
    jsonb_build_object('system', 'urn:oid:2.16.840.1.113883.4.1', 'value', 'MRN-100101'), v_actor_id
  )
  on conflict (source_id, resident_id) do nothing;

  -- Active medication orders.
  insert into public.fhir_medication_requests (
    organization_id, facility_id, source_id, resident_id, fhir_resource_id, rxnorm_code,
    medication_display, dosage_text, request_status, intent, authored_on, requester_display,
    source_updated_at, raw_resource, raw_record_sha256
  )
  select v_org.id, v_facility.id, v_source_id, v_resident_id, m.rid, m.rxnorm, m.disp, m.dose,
    'active', 'order', now() - interval '30 days', 'Dr. Elena Park', now() - interval '20 minutes',
    m.raw, encode(extensions.digest(convert_to(m.raw::text, 'UTF8'), 'sha256'), 'hex')
  from (values
    ('demo-medreq-lisinopril', '314076', 'Lisinopril 10 MG Oral Tablet', '10 mg by mouth once daily',
      jsonb_build_object('resourceType', 'MedicationRequest', 'id', 'demo-medreq-lisinopril',
        'status', 'active', 'intent', 'order',
        'medicationCodeableConcept', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://www.nlm.nih.gov/research/umls/rxnorm', 'code', '314076',
          'display', 'Lisinopril 10 MG Oral Tablet'))),
        'subject', jsonb_build_object('reference', 'Patient/demo-patient-evelyn'))),
    ('demo-medreq-atorvastatin', '617311', 'Atorvastatin 20 MG Oral Tablet', '20 mg by mouth at bedtime',
      jsonb_build_object('resourceType', 'MedicationRequest', 'id', 'demo-medreq-atorvastatin',
        'status', 'active', 'intent', 'order',
        'medicationCodeableConcept', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://www.nlm.nih.gov/research/umls/rxnorm', 'code', '617311',
          'display', 'Atorvastatin 20 MG Oral Tablet'))),
        'subject', jsonb_build_object('reference', 'Patient/demo-patient-evelyn')))
  ) as m(rid, rxnorm, disp, dose, raw)
  on conflict (source_id, fhir_resource_id) do nothing;

  -- One recent administration event.
  insert into public.fhir_medication_administrations (
    organization_id, facility_id, source_id, resident_id, fhir_resource_id, fhir_request_id,
    administration_status, medication_display, effective_at, performer_display,
    raw_resource, raw_record_sha256
  )
  select v_org.id, v_facility.id, v_source_id, v_resident_id, a.rid, a.req,
    'completed', a.disp, now() - interval '5 hours', 'Nurse J. Rivera, LPN',
    a.raw, encode(extensions.digest(convert_to(a.raw::text, 'UTF8'), 'sha256'), 'hex')
  from (values
    ('demo-medadmin-lisinopril', 'demo-medreq-lisinopril', 'Lisinopril 10 MG Oral Tablet',
      jsonb_build_object('resourceType', 'MedicationAdministration', 'id', 'demo-medadmin-lisinopril',
        'status', 'completed',
        'subject', jsonb_build_object('reference', 'Patient/demo-patient-evelyn')))
  ) as a(rid, req, disp, raw)
  on conflict (source_id, fhir_resource_id) do nothing;

  -- Allergy (medication class -- distinct from the administrative food-allergy field).
  insert into public.fhir_allergy_intolerances (
    organization_id, facility_id, source_id, resident_id, fhir_resource_id, substance_display,
    substance_code, substance_system, clinical_status, verification_status, criticality,
    category, reaction_manifestations, recorded_date, source_updated_at, raw_resource, raw_record_sha256
  )
  select v_org.id, v_facility.id, v_source_id, v_resident_id, x.rid, x.disp, x.code,
    'http://www.nlm.nih.gov/research/umls/rxnorm', 'active', 'confirmed', 'high',
    array['medication']::text[],
    jsonb_build_array(jsonb_build_object('manifestation', 'Hives', 'severity', 'moderate')),
    now() - interval '200 days', now() - interval '20 minutes',
    x.raw, encode(extensions.digest(convert_to(x.raw::text, 'UTF8'), 'sha256'), 'hex')
  from (values
    ('demo-allergy-penicillin', 'Penicillin G', '7980',
      jsonb_build_object('resourceType', 'AllergyIntolerance', 'id', 'demo-allergy-penicillin',
        'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', 'code', 'active'))),
        'criticality', 'high',
        'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://www.nlm.nih.gov/research/umls/rxnorm', 'code', '7980', 'display', 'Penicillin G'))),
        'patient', jsonb_build_object('reference', 'Patient/demo-patient-evelyn')))
  ) as x(rid, disp, code, raw)
  on conflict (source_id, fhir_resource_id) do nothing;

  -- Problem list (active confirmed conditions).
  insert into public.fhir_conditions (
    organization_id, facility_id, source_id, resident_id, fhir_resource_id, code_display, code,
    code_system, clinical_status, verification_status, category, onset_date, recorded_date,
    source_updated_at, raw_resource, raw_record_sha256
  )
  select v_org.id, v_facility.id, v_source_id, v_resident_id, c.rid, c.disp, c.code,
    'http://hl7.org/fhir/sid/icd-10-cm', 'active', 'confirmed', 'problem-list-item',
    now() - c.onset_ago, now() - interval '200 days', now() - interval '20 minutes',
    c.raw, encode(extensions.digest(convert_to(c.raw::text, 'UTF8'), 'sha256'), 'hex')
  from (values
    ('demo-condition-htn', 'Essential (primary) hypertension', 'I10', interval '900 days',
      jsonb_build_object('resourceType', 'Condition', 'id', 'demo-condition-htn',
        'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://terminology.hl7.org/CodeSystem/condition-clinical', 'code', 'active'))),
        'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://hl7.org/fhir/sid/icd-10-cm', 'code', 'I10',
          'display', 'Essential (primary) hypertension'))),
        'subject', jsonb_build_object('reference', 'Patient/demo-patient-evelyn'))),
    ('demo-condition-hlp', 'Hyperlipidemia, unspecified', 'E78.5', interval '700 days',
      jsonb_build_object('resourceType', 'Condition', 'id', 'demo-condition-hlp',
        'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://terminology.hl7.org/CodeSystem/condition-clinical', 'code', 'active'))),
        'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://hl7.org/fhir/sid/icd-10-cm', 'code', 'E78.5',
          'display', 'Hyperlipidemia, unspecified'))),
        'subject', jsonb_build_object('reference', 'Patient/demo-patient-evelyn')))
  ) as c(rid, disp, code, onset_ago, raw)
  on conflict (source_id, fhir_resource_id) do nothing;
end;
$function$
;

-- app_private.seed_demo_organization
CREATE OR REPLACE FUNCTION app_private.seed_demo_organization(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org public.organizations%rowtype;
  v_facility public.facilities%rowtype;
  v_second_facility public.facilities%rowtype;
  v_actor_id uuid;
  v_employee_id uuid;
  v_learner_id uuid;
  v_trainer_id uuid;
  v_training_type_id uuid;
  v_class_id uuid;
  v_resident_id uuid;
  v_second_resident_id uuid;
  v_unit_id uuid;
  v_building_id uuid;
  v_room_id uuid;
  v_shift_id uuid;
  v_schedule_id uuid;
  v_inspection_item_id uuid;
  v_location_id uuid;
  v_plan_id uuid;
  v_plan_version_id uuid;
  v_form_id uuid;
begin
  select * into v_org
  from public.organizations
  where id = p_organization_id and is_demo
  for update;
  if v_org.id is null then
    raise exception 'Demo organization not found' using errcode = 'P0002';
  end if;

  select * into v_facility
  from public.facilities
  where organization_id = v_org.id and is_active
  order by case facility_type when 'PCH' then 0 when 'ALR' then 1 else 2 end,
    created_at, id
  limit 1;
  if v_facility.id is null then
    insert into public.facilities (
      organization_id, name, facility_type, address, city, state, zip,
      administrator_name, administrator_email
    ) values (
      v_org.id, 'Sunrise Manor', 'PCH', '100 Demo Lane', 'Philadelphia', 'PA', '19103',
      'Robert Chen', 'demo-admin@example.invalid'
    ) returning * into v_facility;
  end if;

  select * into v_second_facility
  from public.facilities
  where organization_id = v_org.id and is_active and id <> v_facility.id
  order by created_at, id
  limit 1;
  if v_second_facility.id is null then
    insert into public.facilities (
      organization_id, name, facility_type, address, city, state, zip
    ) values (
      v_org.id, 'Sunrise Gardens', 'ALR', '200 Demo Lane', 'Philadelphia', 'PA', '19103'
    ) returning * into v_second_facility;
  end if;

  select id into v_actor_id
  from public.profiles
  where organization_id = v_org.id and role = 'org_admin' and is_active
  order by created_at, id
  limit 1;

  insert into public.facility_units (organization_id, facility_id, name, sort_order)
  values (v_org.id, v_facility.id, 'Personal Care - East', 1)
  on conflict (facility_id, name) do update set is_active = true, updated_at = now()
  returning id into v_unit_id;

  insert into public.facility_buildings (
    organization_id, facility_id, name, licensed_capacity
  ) values (v_org.id, v_facility.id, 'Main Building', 24)
  on conflict (facility_id, name) do update
    set licensed_capacity = excluded.licensed_capacity, is_active = true, updated_at = now()
  returning id into v_building_id;

  insert into public.residential_units (
    organization_id, facility_id, building_id, name, description
  ) values (
    v_org.id, v_facility.id, v_building_id, 'East Wing', 'Synthetic demo residential unit'
  ) on conflict (building_id, name) do update
    set description = excluded.description, is_active = true, updated_at = now()
  returning id into v_unit_id;

  insert into public.facility_rooms (
    organization_id, facility_id, building_id, residential_unit_id, room_number, room_type
  ) values (v_org.id, v_facility.id, v_building_id, v_unit_id, '101', 'private')
  on conflict (facility_id, room_number) do update
    set residential_unit_id = excluded.residential_unit_id, is_active = true, updated_at = now()
  returning id into v_room_id;

  insert into public.employees (
    organization_id, facility_id, employee_number, first_name, last_name, email,
    hire_date, job_title, department, status, administers_medications,
    scheduled_hours_per_week, worker_type, cleared_for_unsupervised_duty, is_synthetic
  ) select v_org.id, seed.facility_id, seed.employee_number, seed.first_name,
    seed.last_name, seed.email, seed.hire_date, seed.job_title, seed.department,
    'active', seed.administers_medications, seed.scheduled_hours_per_week,
    'regular', seed.cleared_for_unsupervised_duty, true
  from (values
    (v_facility.id, 'DEMO-101', 'Morgan', 'Lee', 'morgan.lee@example.invalid',
      public.pa_today() - 420, 'Medication Technician', 'Resident Care', 'active', true, 40, 'regular', true, true),
    (v_facility.id, 'DEMO-102', 'Taylor', 'Rivera', 'taylor.rivera@example.invalid',
      public.pa_today() - 210, 'Direct Care Staff', 'Resident Care', 'active', false, 36, 'regular', true, true),
    (v_facility.id, 'DEMO-103', 'Jamie', 'Okafor', 'jamie.okafor@example.invalid',
      public.pa_today() - 75, 'Activities Coordinator', 'Resident Services', 'active', false, 32, 'regular', true, true),
    (v_second_facility.id, 'DEMO-104', 'Riley', 'Martinez', 'riley.martinez@example.invalid',
      public.pa_today() - 35, 'Personal Care Aide', 'Resident Care', 'active', false, 24, 'regular', false, true)
  ) seed(facility_id,employee_number,first_name,last_name,email,hire_date,job_title,department,status,administers_medications,scheduled_hours_per_week,worker_type,cleared_for_unsupervised_duty,is_synthetic)
  where not exists (
    select 1 from public.employees e
    where e.organization_id = v_org.id and e.employee_number = seed.employee_number
  );

  update public.employees
  set status = 'active', termination_date = null, is_synthetic = true, updated_at = now()
  where organization_id = v_org.id and employee_number like 'DEMO-%';

  select id into v_employee_id
  from public.employees
  where organization_id = v_org.id and employee_number = 'DEMO-101';

  insert into public.residents (
    organization_id, facility_id, first_name, last_name, preferred_name, room,
    admission_date, date_of_birth, admission_track, status, primary_physician_name,
    designated_person_name, dietary_requirements, food_allergies, mobility_summary,
    supervision_requirements, communication_preferences, preferred_language,
    advance_directive_status, contract_status, contract_effective_date, is_synthetic
  ) select v_org.id, v_facility.id, seed.first_name, seed.last_name, seed.preferred_name,
    seed.room, seed.admission_date, seed.date_of_birth, seed.admission_track, 'active',
    'Dr. Elena Park', seed.designated_person_name, seed.dietary_requirements,
    seed.food_allergies, seed.mobility_summary, seed.supervision_requirements,
    seed.communication_preferences, 'English', 'on_file', 'executed', seed.admission_date, true
  from (values
    ('Evelyn','Brooks','Evie','101',public.pa_today() - 180,date '1943-04-18','standard','Marcus Brooks','Heart healthy',array['Shellfish']::text[],'Uses a rolling walker','Routine safety checks','Prefers written appointment reminders'),
    ('Samuel','Green','Sam','102',public.pa_today() - 62,date '1938-11-02','standard','Priya Green','Consistent carbohydrate',array[]::text[],'Independent with cane','Evening cueing','Speak clearly and allow response time'),
    ('Nora','Wilson','Nora','201',public.pa_today() - 21,date '1946-07-09','expedited','Lena Wilson','Regular diet',array['Peanuts']::text[],'Standby assist for transfers','Two-hour checks overnight','Prefers family included in planning')
  ) as seed(first_name,last_name,preferred_name,room,admission_date,date_of_birth,admission_track,designated_person_name,dietary_requirements,food_allergies,mobility_summary,supervision_requirements,communication_preferences)
  where not exists (
    select 1 from public.residents r
    where r.organization_id = v_org.id and r.first_name = seed.first_name
      and r.last_name = seed.last_name and r.is_synthetic
  );

  select id into v_resident_id from public.residents
  where organization_id = v_org.id and first_name = 'Evelyn' and last_name = 'Brooks'
  order by created_at limit 1;
  select id into v_second_resident_id from public.residents
  where organization_id = v_org.id and first_name = 'Samuel' and last_name = 'Green'
  order by created_at limit 1;

  insert into public.facility_beds (
    organization_id, facility_id, room_id, bed_label, status, occupied_by_resident_id
  ) values (v_org.id, v_facility.id, v_room_id, 'A', 'occupied', v_resident_id)
  on conflict (room_id, bed_label) do update
    set status = 'occupied', occupied_by_resident_id = excluded.occupied_by_resident_id,
      reserved_for_prospect_id = null, updated_at = now();

  insert into public.employee_credentials (
    organization_id, facility_id, employee_id, credential_type, credential_label,
    issuing_authority, credential_number, issue_date, expiration_date,
    last_verified_date, status, verification_method, verified_by_profile_id, verified_at
  ) select v_org.id, v_facility.id, v_employee_id, 'act34_criminal_history',
    'PA Criminal History Clearance', 'Pennsylvania State Police', 'DEMO-ACT34-101',
    public.pa_today() - 700, public.pa_today() + 26, public.pa_today() - 30, 'due_soon',
    'Synthetic demo verification', v_actor_id, now()
  where v_employee_id is not null and not exists (
    select 1 from public.employee_credentials
    where employee_id = v_employee_id and credential_number = 'DEMO-ACT34-101'
  );

  select e.id into v_learner_id
  from public.employees e
  join public.profiles p on p.id = e.profile_id
  where e.organization_id = v_org.id and p.role = 'employee' and p.is_active
  order by e.created_at, e.id
  limit 1;
  v_learner_id := coalesce(v_learner_id, v_employee_id);

  insert into public.course_assignments (
    organization_id, facility_id, employee_id, course_id, course_version_id,
    assigned_by, due_date, status
  ) select v_org.id, e.facility_id, e.id, c.id, c.current_version_id,
    v_actor_id, public.pa_today() + row_number() over (order by c.catalog_code)::integer * 7,
    case when row_number() over (order by c.catalog_code) = 1 then 'in_progress' else 'assigned' end
  from public.employees e
  cross join lateral (
    select id, current_version_id, catalog_code
    from public.courses
    where status = 'published' and current_version_id is not null
      and catalog_code in (
        'PA-PCH-ANNUAL-ASSESSED-NEEDS',
        'PA-PCH-ANNUAL-PERSONAL-CARE-SERVICES',
        'PA-PCH-2600-236-DEMENTIA-FOUNDATIONS'
      )
    order by catalog_code
  ) c
  where e.id = v_learner_id
    and not exists (
      select 1 from public.course_assignments a
      where a.employee_id = e.id and a.course_id = c.id and a.status <> 'canceled'
    );

  select p.id into v_trainer_id
  from public.profiles p
  where p.organization_id = v_org.id and p.role = 'trainer' and p.is_active
  order by p.created_at, p.id
  limit 1;
  select id into v_training_type_id from public.training_types
  where name = 'Abuse, Neglect, and Exploitation Reporting' and is_active
  limit 1;
  if v_trainer_id is not null and v_training_type_id is not null then
    select id into v_class_id from public.training_classes
    where organization_id = v_org.id and class_name = 'Demo: Abuse Reporting Refresher'
    order by created_at limit 1;
    if v_class_id is null then
      insert into public.training_classes (
        organization_id, facility_id, trainer_profile_id, training_type_id,
        class_name, class_date, location, duration_hours, status, notes,
        capacity, starts_at, ends_at, room_name
      ) values (
        v_org.id, v_facility.id, v_trainer_id, v_training_type_id,
        'Demo: Abuse Reporting Refresher', public.pa_today() + 5, 'Sunrise Manor', 1.5,
        'scheduled', 'Synthetic scheduled class for the public demo.', 12,
        date_trunc('day', now() + interval '5 days') + interval '13 hours',
        date_trunc('day', now() + interval '5 days') + interval '14 hours 30 minutes',
        'Training Room A'
      ) returning id into v_class_id;
    else
      update public.training_classes
      set class_date = public.pa_today() + 5, status = 'scheduled',
        starts_at = date_trunc('day', now() + interval '5 days') + interval '13 hours',
        ends_at = date_trunc('day', now() + interval '5 days') + interval '14 hours 30 minutes',
        updated_at = now()
      where id = v_class_id and status <> 'completed';
    end if;
    insert into public.training_class_attendees (class_id, employee_id, attended)
    select v_class_id, v_learner_id, true
    where v_learner_id is not null
    on conflict (class_id, employee_id) do nothing;
  end if;

  insert into public.shift_definitions (
    organization_id, facility_id, name, start_time, end_time, color, sort_order
  ) values (v_org.id, v_facility.id, 'Day', '07:00', '15:00', '#2563eb', 1)
  on conflict (facility_id, name) do update
    set start_time = excluded.start_time, end_time = excluded.end_time,
      color = excluded.color, is_active = true, updated_at = now()
  returning id into v_shift_id;
  insert into public.shift_definitions (
    organization_id, facility_id, name, start_time, end_time, color, sort_order
  ) values
    (v_org.id, v_facility.id, 'Evening', '15:00', '23:00', '#7c3aed', 2),
    (v_org.id, v_facility.id, 'Overnight', '23:00', '07:00', '#334155', 3)
  on conflict (facility_id, name) do update
    set start_time = excluded.start_time, end_time = excluded.end_time,
      color = excluded.color, is_active = true, updated_at = now();

  select id into v_schedule_id from public.schedules
  where organization_id = v_org.id and title = 'Demo staffing schedule'
  order by created_at limit 1;
  if v_schedule_id is null then
    insert into public.schedules (
      organization_id, facility_id, title, period_start, period_end,
      status, created_by, published_at
    ) values (
      v_org.id, v_facility.id, 'Demo staffing schedule', public.pa_today(),
      public.pa_today() + 13, 'published', v_actor_id, now()
    ) returning id into v_schedule_id;
  else
    update public.schedules set period_start = public.pa_today(), period_end = public.pa_today() + 13,
      status = 'published', published_at = now(), updated_at = now()
    where id = v_schedule_id;
    delete from public.shift_assignments where schedule_id = v_schedule_id;
  end if;

  insert into public.shift_assignments (
    organization_id, schedule_id, facility_id, employee_id, shift_definition_id,
    shift_date, start_time, end_time, status, source, notes
  ) select v_org.id, v_schedule_id, v_facility.id, e.id, v_shift_id,
    public.pa_today() + day_offset::integer, '07:00', '15:00', 'confirmed', 'manual', 'Synthetic demo shift'
  from (
    select id, row_number() over (order by employee_number) - 1 as day_offset
    from public.employees
    where organization_id = v_org.id and facility_id = v_facility.id
      and status = 'active' and is_synthetic
    order by employee_number limit 4
  ) e;

  insert into public.admission_prospects (
    organization_id, facility_id, first_name, last_name, inquiry_date, stage,
    clinical_review_status, financial_review_status, expected_move_in_date,
    primary_contact_name, primary_contact_relationship, primary_contact_phone, notes, created_by
  ) select v_org.id, v_facility.id, seed.first_name, seed.last_name, public.pa_today() - seed.age,
    seed.stage, seed.clinical, seed.financial, public.pa_today() + seed.move_in,
    seed.contact, 'Daughter', '215-555-01' || seed.age::text,
    'Synthetic prospect for demo workflow.', v_actor_id
  from (values
    ('Arthur','Miles',3,'applicant','in_review','approved',18,'Denise Miles'),
    ('Helen','Sato',8,'approved','approved','approved',7,'Mina Sato'),
    ('George','King',1,'prospect','not_started','not_started',30,'Amelia King')
  ) seed(first_name,last_name,age,stage,clinical,financial,move_in,contact)
  where not exists (
    select 1 from public.admission_prospects p
    where p.organization_id = v_org.id and p.first_name = seed.first_name and p.last_name = seed.last_name
  );

  insert into public.incidents (
    organization_id, facility_id, incident_type, occurred_at, reported_at,
    reported_by_profile_id, resident_id, resident_identifier, location_detail,
    narrative, severity, status, investigator_name, investigation_started_at,
    idempotency_key
  ) select v_org.id, v_facility.id, 'significant_injury', now() - interval '3 days',
    now() - interval '3 days' + interval '20 minutes', v_actor_id, v_resident_id,
    'Evelyn Brooks (synthetic)', 'Dining room',
    'Synthetic resident had a witnessed fall with no apparent injury. Monitoring and follow-up are in progress.',
    'moderate', 'investigating', 'Dana Brooks', now() - interval '2 days',
    'demo-significant-injury-001'
  where not exists (
    select 1 from public.incidents where organization_id = v_org.id
      and idempotency_key = 'demo-significant-injury-001'
  );

  insert into public.inspection_items (
    organization_id, facility_id, item_kind, item_type, label, location_detail,
    manufacturer, model_number, serial_number, install_date, inspection_interval_days,
    last_inspected_date, next_due_date, status, notes
  ) select
    v_org.id, v_facility.id, 'equipment', 'generator', 'Emergency generator',
    'Rear utility room', 'Demo Power Systems', 'GEN-20', 'SYNTHETIC-001',
    public.pa_today() - 900, 30, public.pa_today() - 24, public.pa_today() + 6, 'due_soon',
    'Synthetic inspection asset for the public demo.'
  where not exists (
    select 1 from public.inspection_items i
    where i.organization_id = v_org.id and i.facility_id = v_facility.id
      and i.label = 'Emergency generator'
  );
  select id into v_inspection_item_id from public.inspection_items
  where organization_id = v_org.id and facility_id = v_facility.id
    and label = 'Emergency generator' order by created_at limit 1;
  insert into public.inspection_events (
    organization_id, facility_id, inspection_item_id, performed_date,
    performed_by, performed_by_profile_id, result, follow_up_required, notes
  ) select v_org.id, v_facility.id, v_inspection_item_id, public.pa_today() - 24,
    'Dana Brooks', v_actor_id, 'pass', false, 'Synthetic monthly generator inspection.'
  where v_inspection_item_id is not null and not exists (
    select 1 from public.inspection_events e
    where e.inspection_item_id = v_inspection_item_id and e.notes = 'Synthetic monthly generator inspection.'
  );

  insert into public.maintenance_locations (
    organization_id, facility_id, label, room_number, location_detail
  ) values (v_org.id, v_facility.id, 'Dining room', 'DR-1', 'Main building, first floor')
  on conflict (facility_id, label) do update set is_active = true, updated_at = now()
  returning id into v_location_id;
  insert into public.work_orders (
    organization_id, facility_id, work_order_number, maintenance_location_id,
    location_detail, problem_description, safety_risk, priority,
    temporary_protective_action, assigned_employee_id, target_completion_at,
    estimated_cost, resident_impact, status, created_by_profile_id
  ) select
    v_org.id, v_facility.id, 'DEMO-WO-1001', v_location_id, 'Dining room window',
    'Window latch does not close securely.', 'moderate', 'urgent',
    'Window secured and area marked pending repair.', v_employee_id,
    now() + interval '2 days', 185, 'Dining room seating moved away from window.',
    'assigned', v_actor_id
  where not exists (
    select 1 from public.work_orders w
    where w.organization_id = v_org.id
      and w.problem_description = 'Window latch does not close securely.'
  );
  update public.work_orders
  set status = 'assigned', target_completion_at = now() + interval '2 days', updated_at = now()
  where organization_id = v_org.id
    and problem_description = 'Window latch does not close securely.';

  insert into public.resident_service_calendar_events (
    organization_id, facility_id, resident_id, event_type, title, provider_name,
    provider_contact, location_name, starts_at, ends_at, status,
    transportation_mode, transportation_vendor, required_records,
    preparation_instructions, notes, created_by
  ) select v_org.id, v_facility.id, v_second_resident_id, 'medical_appointment',
    'Cardiology follow-up', 'Dr. Elena Park', '215-555-0188', 'Penn Cardiology',
    date_trunc('day', now() + interval '4 days') + interval '10 hours',
    date_trunc('day', now() + interval '4 days') + interval '11 hours',
    'scheduled', 'vendor', 'Demo Transit', array['Medication list','Insurance card']::text[],
    'Bring current medication list and arrive 15 minutes early.',
    'Synthetic appointment for the public demo.', v_actor_id
  where v_second_resident_id is not null and not exists (
    select 1 from public.resident_service_calendar_events e
    where e.organization_id = v_org.id and e.resident_id = v_second_resident_id
      and e.title = 'Cardiology follow-up' and e.status = 'scheduled'
  );

  insert into public.complaints (
    organization_id, facility_id, complaint_number, date_received, method_received,
    complainant_type, complainant_name, resident_id, category, description,
    immediate_risk, acknowledgement_date, assigned_investigator_profile_id,
    investigation_notes, status, created_by
  ) values (
    v_org.id, v_facility.id, 'DEMO-CMP-1001', now() - interval '5 days', 'phone',
    'family', 'Marcus Brooks (synthetic)', v_resident_id, 'service',
    'Family requested more consistent communication about appointment schedule changes.',
    'low', now() - interval '4 days', v_actor_id,
    'Reviewing handoff and family notification workflow.', 'investigating', v_actor_id
  ) on conflict (organization_id, complaint_number) do update
    set status = 'investigating', updated_at = now();

  insert into public.qapi_projects (
    organization_id, facility_id, project_number, title, problem_statement,
    source_of_concern, baseline_data, measurable_objective, target_description,
    target_value, start_date, target_completion_date, project_lead_profile_id,
    team_members, root_cause_method, planned_interventions,
    measurement_frequency, status, created_by
  ) values (
    v_org.id, v_facility.id, 'DEMO-QAPI-2026-01', 'Improve appointment handoff reliability',
    'Appointment changes are not always acknowledged during shift handoff.',
    'Synthetic complaint trend', 'Baseline acknowledgment rate: 72 percent.',
    'Reach a 95 percent documented acknowledgment rate.', 'Acknowledgment rate', 95,
    public.pa_today() - 14, public.pa_today() + 60, v_actor_id,
    '[{"name":"Dana Brooks","role":"Project lead"},{"name":"Jamie Okafor","role":"Resident services"}]'::jsonb,
    'five_whys', 'Use a standard handoff checklist and audit five records weekly.',
    'Weekly', 'active', v_actor_id
  ) on conflict (organization_id, project_number) do update
    set status = 'active', target_completion_date = public.pa_today() + 60, updated_at = now();

  if v_actor_id is not null then
    insert into public.emergency_plans (
      organization_id, facility_id, title, created_by
    ) values (v_org.id, v_facility.id, 'Sunrise Manor Emergency Operations Plan', v_actor_id)
    on conflict (facility_id) do update set title = excluded.title, updated_at = now()
    returning id into v_plan_id;

    insert into public.emergency_plan_versions (
      organization_id, facility_id, plan_id, version_number, effective_date,
      change_summary, plan_snapshot, approved_by, approved_at
    ) values (
      v_org.id, v_facility.id, v_plan_id, 1, public.pa_today() - 120,
      'Synthetic baseline emergency plan.',
      '{"assemblyPoint":"East parking lot","incidentCommand":"Administrator on duty","residentAccountability":"Printed census and room sweep"}'::jsonb,
      v_actor_id, now() - interval '120 days'
    ) on conflict (plan_id, version_number) do nothing;
    select id into v_plan_version_id
    from public.emergency_plan_versions
    where plan_id = v_plan_id and version_number = 1;
    update public.emergency_plans set current_version_id = v_plan_version_id where id = v_plan_id;

    insert into public.emergency_events (
      organization_id, facility_id, event_number, event_mode, event_type, status,
      plan_version_id, incident_commander_profile_id, started_at, ended_at,
      location_description, assembly_point, summary, declared_by
    ) values (
      v_org.id, v_facility.id, 'DEMO-DRILL-1001', 'drill', 'fire', 'closed',
      v_plan_version_id, v_actor_id, now() - interval '20 days',
      now() - interval '20 days' + interval '11 minutes', 'Main building',
      'East parking lot', 'Synthetic fire drill completed with all residents accounted for.',
      v_actor_id
    ) on conflict (organization_id, event_number) do update
      set plan_version_id = excluded.plan_version_id, status = 'closed', updated_at = now();
  end if;

  insert into public.evidence_collections (
    organization_id, facility_id, name, purpose, status, legal_hold,
    terms_version, created_by
  ) select v_org.id, v_facility.id, '2026 DHS Survey Readiness',
    'Synthetic workspace for assembling survey-readiness reports and supporting records.',
    'draft', false, 'demo-1', v_actor_id
  where not exists (
    select 1 from public.evidence_collections c
    where c.organization_id = v_org.id and c.name = '2026 DHS Survey Readiness'
  );

  if v_resident_id is not null and not exists (
    select 1 from public.resident_assessment_forms f
    where f.resident_id = v_resident_id and f.form_type = 'ASP' and f.version_number = 1
  ) then
    insert into public.resident_assessment_forms (
      organization_id, facility_id, resident_id, form_type, reason, version_number,
      status, content, prepared_by_profile_id, prepared_by_name, prepared_by_title,
      prepared_date
    ) values (
      v_org.id, v_facility.id, v_resident_id, 'ASP', 'initial', 1, 'draft',
      jsonb_build_object(
        'assessmentInfo', jsonb_build_object('lastSupportPlanDate', public.pa_today()::text),
        'section1', jsonb_build_object('items', jsonb_build_object(
          'morning_personal_care', jsonb_build_object(
            'planDescription','Offer setup and standby assistance with morning personal care.',
            'planFrequency','daily','planResponsibleParty','DCS',
            'serviceNeedDescription','Standby support with morning routine.'
          )
        ))
      ),
      v_actor_id, 'Dana Brooks', 'Facility Administrator', public.pa_today()
    ) returning id into v_form_id;
    update public.resident_assessment_forms
    set status = 'finalized', finalized_at = now(), updated_at = now()
    where id = v_form_id;
  end if;

  perform public.generate_resident_service_tasks(public.pa_today(), public.pa_today() + 14, null);
  perform public.recalculate_compliance_core(v_org.id);

  update public.organizations
  set demo_seed_version = 1, demo_reset_at = now(), updated_at = now()
  where id = v_org.id;

  return jsonb_build_object(
    'organizationId', v_org.id,
    'seedVersion', 1,
    'resetAt', now(),
    'facilities', (select count(*) from public.facilities where organization_id = v_org.id),
    'employees', (select count(*) from public.employees where organization_id = v_org.id),
    'residents', (select count(*) from public.residents where organization_id = v_org.id),
    'schedules', (select count(*) from public.schedules where organization_id = v_org.id),
    'courseAssignments', (select count(*) from public.course_assignments where organization_id = v_org.id),
    'admissionProspects', (select count(*) from public.admission_prospects where organization_id = v_org.id),
    'incidents', (select count(*) from public.incidents where organization_id = v_org.id),
    'workOrders', (select count(*) from public.work_orders where organization_id = v_org.id)
  );
end;
$function$
;

-- app_private.seed_sandbox_facility
CREATE OR REPLACE FUNCTION app_private.seed_sandbox_facility(p_facility_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_facility public.facilities%rowtype;
  v_employees integer;
  v_residents integer;
begin
  select * into v_facility from public.facilities
  where id = p_facility_id and is_sandbox for update;
  if v_facility.id is null then
    raise exception 'Sandbox facility not found' using errcode = 'P0002';
  end if;

  delete from public.residents where facility_id = v_facility.id and is_synthetic;
  delete from public.employees where facility_id = v_facility.id and is_synthetic;

  insert into public.employees (
    organization_id, facility_id, employee_number, first_name, last_name,
    email, hire_date, job_title, department, status, is_synthetic
  ) values
    (v_facility.organization_id, v_facility.id, 'SANDBOX-001', 'Avery', 'Jordan',
      'avery.jordan@example.invalid', public.pa_today() - 420, 'Direct Care Worker', 'Resident Care', 'active', true),
    (v_facility.organization_id, v_facility.id, 'SANDBOX-002', 'Morgan', 'Lee',
      'morgan.lee@example.invalid', public.pa_today() - 75, 'Medication Technician', 'Resident Care', 'active', true),
    (v_facility.organization_id, v_facility.id, 'SANDBOX-003', 'Taylor', 'Rivera',
      'taylor.rivera@example.invalid', public.pa_today() - 18, 'Activities Aide', 'Resident Services', 'active', true);
  get diagnostics v_employees = row_count;

  insert into public.residents (
    organization_id, facility_id, first_name, last_name, room,
    admission_date, status, is_synthetic
  ) values
    (v_facility.organization_id, v_facility.id, 'Sample', 'Resident One', '101', public.pa_today() - 180, 'active', true),
    (v_facility.organization_id, v_facility.id, 'Sample', 'Resident Two', '102', public.pa_today() - 45, 'active', true);
  get diagnostics v_residents = row_count;

  update public.facilities set sandbox_reset_at = now(), updated_at = now()
  where id = v_facility.id;
  return jsonb_build_object(
    'facilityId', v_facility.id,
    'employeesSeeded', v_employees,
    'residentsSeeded', v_residents,
    'resetAt', now()
  );
end;
$function$
;

-- app_private.service_effective_date
CREATE OR REPLACE FUNCTION app_private.service_effective_date(p_form resident_assessment_forms)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_candidate text := p_form.content #>> '{assessmentInfo,lastSupportPlanDate}';
begin
  begin
    if nullif(v_candidate, '') is not null then return v_candidate::date; end if;
  exception when others then
    null;
  end;
  return coalesce(p_form.finalized_at::date, public.pa_today());
end;
$function$
;

-- app_private.track_dietary_exception_pattern
CREATE OR REPLACE FUNCTION app_private.track_dietary_exception_pattern(p_org uuid, p_fac uuid, p_resident uuid, p_kind text, p_pattern_key text, p_label text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    v_project_number := 'QAPI-' || to_char(public.pa_today(), 'YYYY') || '-' || lpad((
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
      'Reduce recurrence and sustain verified controls.', 0, public.pa_today() + 30, auth.uid()
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
end;
$function$
;

-- public.activate_due_support_plan
CREATE OR REPLACE FUNCTION public.activate_due_support_plan(p_plan_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.resident_support_plans%rowtype;
begin
  select * into v from public.resident_support_plans where id = p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);

  if v.state = 'active' then
    -- Already promoted, most likely by the scheduled job between the page loading and the click.
    -- Idempotent rather than an error: the caller's intent is satisfied.
    return true;
  end if;
  if v.state <> 'approved' then
    raise exception 'Only an approved support plan can be activated' using errcode = '55000';
  end if;
  -- The line that keeps this a repair and not an override. A plan effective next Monday must not
  -- become active today because somebody found a button.
  if v.effective_date is null or v.effective_date > public.pa_today() then
    raise exception 'This plan is not due to take effect yet' using errcode = '22023';
  end if;

  perform app_private.activate_support_plan(v.id);

  insert into public.audit_logs(
    organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v.organization_id, auth.uid(), 'resident_support_plan', v.id::text,
    'support_plan.activated_manually',
    jsonb_build_object('state', v.state),
    -- Recorded as manual on purpose: a run of these is evidence the scheduled promotion is not
    -- working, which is the thing an operator needs to find.
    jsonb_build_object('state', 'active', 'effectiveDate', v.effective_date,
      'reason', 'Scheduled activation had not run'));
  return true;
end $function$
;

-- public.activate_due_support_plans
CREATE OR REPLACE FUNCTION public.activate_due_support_plans()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_count integer := 0;
begin
  for v_id in
    select id from public.resident_support_plans
    where state = 'approved' and effective_date is not null and effective_date <= public.pa_today()
    order by resident_id, version_number
  loop
    perform app_private.activate_support_plan(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $function$
;

-- public.apply_hris_import_batch
CREATE OR REPLACE FUNCTION public.apply_hris_import_batch(p_import_run_id uuid, p_batch_size integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.hris_import_runs%rowtype;
  v_row public.hris_import_rows%rowtype;
  v_employee public.employees%rowtype;
  v_employee_id uuid;
  v_person_id uuid;
  v_event_id uuid;
  v_status text;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('hris-import:' || p_import_run_id::text, 0));
  select * into v_run from public.hris_import_runs where id = p_import_run_id for update;
  if not found then raise exception 'HRIS run not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(v_run.organization_id, 'workforce.import.manage');
  if exists (
    select 1 from public.hris_import_rows
    where import_run_id = v_run.id and validation_status <> 'valid'
  ) or exists (
    select 1 from public.hris_import_rows
    where import_run_id = v_run.id and merge_decision is null
  ) then
    raise exception 'Every valid HRIS row requires a deterministic decision' using errcode = '55000';
  end if;
  update public.hris_import_runs set status = 'applying' where id = v_run.id;
  for v_row in
    select * from public.hris_import_rows
    where import_run_id = v_run.id and apply_status = 'pending'
    order by row_number
    limit least(greatest(p_batch_size, 1), 1000)
    for update skip locked
  loop
    begin
      v_event_id := null;
      if v_row.merge_decision in ('skip', 'reject') then
        update public.hris_import_rows set
          apply_status = case when v_row.merge_decision = 'skip' then 'skipped' else 'rejected' end,
          applied_at = now()
        where id = v_row.id;
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if v_row.merge_decision = 'create' then
        insert into public.employees(
          organization_id, facility_id, employee_number, first_name, last_name,
          email, phone, hire_date, job_title, department, status
        ) values (
          v_run.organization_id, (v_row.normalized_payload->>'facilityId')::uuid,
          nullif(v_row.normalized_payload->>'employeeNumber', ''),
          btrim(v_row.normalized_payload->>'firstName'), btrim(v_row.normalized_payload->>'lastName'),
          nullif(v_row.normalized_payload->>'email', ''), nullif(v_row.normalized_payload->>'phone', ''),
          nullif(v_row.normalized_payload->>'hireDate', '')::date,
          btrim(v_row.normalized_payload->>'jobTitle'), nullif(v_row.normalized_payload->>'department', ''),
          case when v_row.normalized_payload->>'status' in ('active','inactive','terminated','on_leave')
            then v_row.normalized_payload->>'status' else 'active' end
        ) returning id into v_employee_id;
      else
        v_employee_id := v_row.decided_employee_id;
        select * into v_employee from public.employees where id = v_employee_id for update;
        if v_employee.organization_id <> v_run.organization_id then
          raise exception 'HRIS decision crossed tenant boundary' using errcode = '42501';
        end if;
        update public.employees set
          employee_number = coalesce(nullif(v_row.normalized_payload->>'employeeNumber', ''), employee_number),
          first_name = btrim(v_row.normalized_payload->>'firstName'),
          last_name = btrim(v_row.normalized_payload->>'lastName'),
          email = coalesce(nullif(v_row.normalized_payload->>'email', ''), email),
          phone = coalesce(nullif(v_row.normalized_payload->>'phone', ''), phone),
          job_title = btrim(v_row.normalized_payload->>'jobTitle'),
          department = coalesce(nullif(v_row.normalized_payload->>'department', ''), department)
        where id = v_employee_id;
        if v_employee.facility_id <> (v_row.normalized_payload->>'facilityId')::uuid then
          v_event_id := public.apply_employee_lifecycle_transition(
            v_employee_id, 'transfer', public.pa_today(),
            (v_row.normalized_payload->>'facilityId')::uuid,
            'HRIS import ' || v_run.request_id
          );
        end if;
        v_status := coalesce(v_row.normalized_payload->>'status', v_employee.status);
        if v_status = 'terminated' and v_employee.status <> 'terminated' then
          v_event_id := public.apply_employee_lifecycle_transition(
            v_employee_id, 'terminate', public.pa_today(), null,
            'HRIS import ' || v_run.request_id
          );
        elsif v_status = 'on_leave' and v_employee.status = 'active' then
          v_event_id := public.apply_employee_lifecycle_transition(
            v_employee_id, 'leave', public.pa_today(), null,
            'HRIS import ' || v_run.request_id
          );
        elsif v_status = 'active' and v_employee.status = 'on_leave' then
          v_event_id := public.apply_employee_lifecycle_transition(
            v_employee_id, 'return', public.pa_today(), null,
            'HRIS import ' || v_run.request_id
          );
        end if;
      end if;
      select person_id into v_person_id from public.workforce_employee_links
      where employee_id = v_employee_id and effective_to is null
      order by effective_from desc limit 1;
      insert into public.hris_identity_links(
        organization_id, source_system_id, external_person_id,
        external_employment_id, person_id, employee_id, source_checksum_sha256
      ) values (
        v_run.organization_id, v_run.source_system_id,
        coalesce(v_row.external_person_id, 'row-person:' || v_row.id),
        coalesce(v_row.external_employment_id, 'row-employment:' || v_row.id),
        v_person_id, v_employee_id, v_row.source_payload_sha256
      ) on conflict do nothing;
      update public.hris_import_rows set
        apply_status = 'applied', applied_employee_id = v_employee_id,
        applied_lifecycle_event_id = v_event_id, applied_at = now()
      where id = v_row.id;
      v_applied := v_applied + 1;
    exception when others then
      update public.hris_import_rows set
        apply_status = 'failed', error_detail = sqlstate || ': ' || sqlerrm
      where id = v_row.id;
      v_failed := v_failed + 1;
    end;
  end loop;
  update public.hris_import_runs r set
    applied_count = (select count(*) from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status = 'applied'),
    rejected_count = (select count(*) from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status in ('rejected','failed')),
    resume_after_row = coalesce((select max(x.row_number) from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status <> 'pending'), 0),
    status = case
      when exists (select 1 from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status = 'pending') then 'applying'
      when exists (select 1 from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status = 'failed') then 'failed'
      else 'applied' end,
    completed_at = case when not exists (
      select 1 from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status = 'pending'
    ) then now() else null end
  where r.id = v_run.id;
  return jsonb_build_object('runId', v_run.id, 'applied', v_applied, 'skipped', v_skipped, 'failed', v_failed);
end;
$function$
;

-- public.apply_scim_change
CREATE OR REPLACE FUNCTION public.apply_scim_change(p_connection_id uuid, p_request_id text, p_payload_sha256 text, p_operation text, p_external_subject_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_connection public.scim_connections;
  v_receipt public.scim_request_receipts;
  v_link public.scim_subject_links;
  v_employee public.employees;
  v_mapping public.scim_group_mappings;
  v_groups text[] := array[]::text[];
  v_user_name text;
  v_email_domain text;
  v_first_name text;
  v_last_name text;
  v_job_title text;
  v_employee_number text;
  v_facility_id uuid;
  v_role text := 'employee';
  v_profile_id uuid;
  v_response jsonb;
  v_lifecycle_event_id uuid;
  v_error_code text;
  v_error_message text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'SCIM changes require the trusted service role'
      using errcode = '42501';
  end if;
  if p_operation not in ('create', 'update', 'suspend', 'deprovision') then
    raise exception 'unsupported SCIM operation' using errcode = '22023';
  end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid SCIM payload checksum' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_request_id, ''))) not between 8 and 200 then
    raise exception 'invalid SCIM request id' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_external_subject_id, ''))) = 0 then
    raise exception 'external SCIM subject is required' using errcode = '22023';
  end if;

  select * into v_connection
  from public.scim_connections where id = p_connection_id for update;
  if v_connection.id is null or v_connection.status not in ('pilot', 'active') then
    raise exception 'SCIM connection is unavailable' using errcode = '42501';
  end if;

  insert into public.scim_request_receipts (
    scim_connection_id, organization_id, request_id, payload_sha256,
    operation, external_subject_id
  ) values (
    p_connection_id, v_connection.organization_id, btrim(p_request_id),
    p_payload_sha256, p_operation, btrim(p_external_subject_id)
  ) on conflict (scim_connection_id, request_id) do nothing
  returning * into v_receipt;

  if v_receipt.id is null then
    select * into v_receipt from public.scim_request_receipts
    where scim_connection_id = p_connection_id and request_id = btrim(p_request_id)
    for update;
    if v_receipt.payload_sha256 <> p_payload_sha256
       or v_receipt.operation <> p_operation
       or v_receipt.external_subject_id <> btrim(p_external_subject_id) then
      raise exception 'SCIM replay key was reused with a different request'
        using errcode = '23505';
    end if;
    if v_receipt.status in ('applied', 'rejected') then
      return coalesce(v_receipt.response_body, '{}'::jsonb) || jsonb_build_object(
        'replayed', true, 'receiptId', v_receipt.id
      );
    end if;
  end if;

  begin
    v_user_name := lower(btrim(p_payload ->> 'userName'));
    v_first_name := btrim(coalesce(
      p_payload -> 'name' ->> 'givenName', p_payload ->> 'firstName', ''
    ));
    v_last_name := btrim(coalesce(
      p_payload -> 'name' ->> 'familyName', p_payload ->> 'lastName', ''
    ));
    v_job_title := btrim(coalesce(p_payload ->> 'jobTitle', 'Employee'));
    v_employee_number := nullif(btrim(p_payload ->> 'employeeNumber'), '');
    if v_user_name !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
      raise exception 'SCIM userName must be an email on a verified tenant domain'
        using errcode = '22023';
    end if;
    v_email_domain := split_part(v_user_name, '@', 2);
    if not exists (
      select 1 from public.organization_identity_domains d
      where d.organization_id = v_connection.organization_id
        and d.domain = v_email_domain
        and d.verification_status = 'verified'
    ) then
      raise exception 'SCIM userName domain is not verified for this organization'
        using errcode = '42501';
    end if;
    if p_operation in ('create', 'update') and (
      length(v_first_name) = 0 or length(v_last_name) = 0
    ) then
      raise exception 'SCIM create/update requires givenName and familyName'
        using errcode = '22023';
    end if;

    if jsonb_typeof(coalesce(p_payload -> 'groups', '[]'::jsonb)) <> 'array' then
      raise exception 'SCIM groups must be an array' using errcode = '22023';
    end if;
    select coalesce(array_agg(group_id), array[]::text[]) into v_groups
    from (
      select case jsonb_typeof(value)
        when 'string' then value #>> '{}'
        when 'object' then coalesce(value ->> 'value', value ->> 'id')
        else null
      end as group_id
      from jsonb_array_elements(coalesce(p_payload -> 'groups', '[]'::jsonb))
    ) groups where group_id is not null;

    select mapping.* into v_mapping
    from public.scim_group_mappings mapping
    where mapping.scim_connection_id = p_connection_id
      and mapping.external_group_id = any(v_groups)
    order by mapping.priority, mapping.external_group_id
    limit 1;
    v_facility_id := coalesce(v_mapping.facility_id, v_connection.default_facility_id);
    v_role := coalesce(v_mapping.app_role, 'employee');
    v_job_title := coalesce(nullif(v_mapping.job_title, ''), v_job_title);

    select * into v_link
    from public.scim_subject_links
    where scim_connection_id = p_connection_id
      and external_subject_id = btrim(p_external_subject_id)
    for update;

    if p_operation = 'create' and v_link.identity_id is null then
      insert into public.employees (
        organization_id, facility_id, employee_number, first_name, last_name,
        email, hire_date, job_title, status
      ) values (
        v_connection.organization_id, v_facility_id, v_employee_number,
        v_first_name, v_last_name, v_user_name, public.pa_today(), v_job_title, 'active'
      ) returning * into v_employee;

      insert into public.scim_subject_links (
        organization_id, scim_connection_id, external_subject_id, user_name,
        employee_id, profile_id, lifecycle_state, last_request_id
      ) values (
        v_connection.organization_id, p_connection_id, btrim(p_external_subject_id),
        v_user_name, v_employee.id,
        app_private.resolve_scim_link_profile_id(
          v_connection.organization_id, v_employee.id, v_user_name
        ),
        'active', btrim(p_request_id)
      ) returning * into v_link;
    elsif v_link.identity_id is null then
      raise exception 'SCIM subject does not exist; create it before %', p_operation
        using errcode = 'P0002';
    end if;

    if p_operation in ('create', 'update') then
      update public.employees
      set first_name = v_first_name,
          last_name = v_last_name,
          email = v_user_name,
          employee_number = coalesce(v_employee_number, employee_number),
          job_title = v_job_title
      where id = v_link.employee_id
      returning * into v_employee;

      if v_employee.status = 'terminated' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'rehire', public.pa_today(), v_facility_id,
          'SCIM provider reactivated the authoritative subject'
        );
      elsif v_employee.status = 'on_leave' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'return', public.pa_today(), v_facility_id,
          'SCIM provider returned the authoritative subject from leave'
        );
      elsif v_employee.status = 'inactive' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'hire', public.pa_today(), v_facility_id,
          'SCIM provider activated an authoritative subject without an active episode'
        );
      elsif v_link.lifecycle_state = 'suspended' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'restore_access', public.pa_today(), null,
          'SCIM provider restored the authoritative subject access'
        );
        if v_employee.facility_id is distinct from v_facility_id then
          v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
            v_employee.id, 'transfer', public.pa_today(), v_facility_id,
            'SCIM group mapping changed the authoritative facility scope'
          );
        end if;
      elsif v_employee.facility_id is distinct from v_facility_id then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'transfer', public.pa_today(), v_facility_id,
          'SCIM group mapping changed the authoritative facility scope'
        );
      end if;
      update public.scim_subject_links
      set user_name = v_user_name, lifecycle_state = 'active',
          suspended_at = null, deprovisioned_at = null,
          last_request_id = btrim(p_request_id)
      where identity_id = v_link.identity_id returning * into v_link;
    elsif p_operation = 'suspend' then
      v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
        v_link.employee_id, 'suspend_access', public.pa_today(), null,
        'SCIM provider suspended the authoritative subject'
      );
      update public.scim_subject_links
      set lifecycle_state = 'suspended', suspended_at = now(),
          last_request_id = btrim(p_request_id)
      where identity_id = v_link.identity_id returning * into v_link;
    elsif p_operation = 'deprovision' then
      v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
        v_link.employee_id, 'terminate', public.pa_today(), null,
        'SCIM provider deprovisioned the authoritative subject'
      );
      update public.scim_subject_links
      set lifecycle_state = 'deprovisioned', deprovisioned_at = now(),
          last_request_id = btrim(p_request_id)
      where identity_id = v_link.identity_id returning * into v_link;
    end if;

    -- PT-008: resolve the governed login for this subject and keep the link
    -- current before acting on it, so the block below is live for every
    -- operation. A resolution miss never clears a previously recorded profile
    -- (the link keeps its revocation target even if the employee row was
    -- unlinked later).
    select * into v_employee from public.employees where id = v_link.employee_id;
    v_profile_id := coalesce(
      app_private.resolve_scim_link_profile_id(
        v_connection.organization_id, v_link.employee_id, v_link.user_name
      ),
      v_link.profile_id
    );
    if v_profile_id is distinct from v_link.profile_id then
      update public.scim_subject_links
      set profile_id = v_profile_id
      where identity_id = v_link.identity_id
      returning * into v_link;
    end if;

    if v_link.profile_id is not null then
      if p_operation in ('suspend', 'deprovision') then
        -- Both effects, atomically: revoke_identity_sessions with
        -- p_deactivate_profile => true deletes auth.sessions AND sets
        -- profiles.is_active = false, retaining revocation evidence.
        perform public.revoke_identity_sessions(
          v_link.profile_id,
          format('SCIM %s for external subject %s', p_operation, p_external_subject_id),
          'scim',
          p_connection_id::text || ':' || btrim(p_request_id),
          true
        );
      else
        perform public.admin_update_profile(
          p_user_id => v_link.profile_id,
          p_role => v_role,
          -- Re-enable login only when the employee row is actually active
          -- again; otherwise leave is_active untouched.
          p_is_active => case when v_employee.status = 'active' then true else null end,
          p_email => v_user_name,
          p_first_name => v_first_name,
          p_last_name => v_last_name
        );
        delete from public.facility_assignments where profile_id = v_link.profile_id;
        if v_role in ('facility_manager', 'trainer', 'employee') then
          insert into public.facility_assignments(profile_id, facility_id)
          values (v_link.profile_id, v_facility_id)
          on conflict (profile_id, facility_id) do nothing;
        end if;
      end if;
    end if;

    v_response := jsonb_build_object(
      'ok', true,
      'replayed', false,
      'receiptId', v_receipt.id,
      'identityId', v_link.identity_id,
      'employeeId', v_link.employee_id,
      'profileId', v_link.profile_id,
      'lifecycleEventId', v_lifecycle_event_id,
      'status', v_link.lifecycle_state
    );
    perform set_config('app.identity_evidence_write', 'on', true);
    update public.scim_request_receipts
    set status = 'applied', response_body = v_response,
        identity_id = v_link.identity_id, employee_id = v_link.employee_id,
        completed_at = now()
    where id = v_receipt.id;
    return v_response;
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate, v_error_message = message_text;
    v_response := jsonb_build_object(
      'ok', false,
      'replayed', false,
      'receiptId', v_receipt.id,
      'errorCode', v_error_code,
      'error', v_error_message
    );
    perform set_config('app.identity_evidence_write', 'on', true);
    update public.scim_request_receipts
    set status = 'rejected', response_body = v_response,
        error_code = v_error_code, completed_at = now()
    where id = v_receipt.id;
    return v_response;
  end;
end;
$function$
;

-- public.approve_support_plan
CREATE OR REPLACE FUNCTION public.approve_support_plan(p_plan_id uuid, p_effective_date date, p_review_due_date date, p_staff_signature jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.resident_support_plans%rowtype;
begin
  select * into v from public.resident_support_plans where id=p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  -- 'awaiting_signature' is accepted so a facility that records the signature and approves in one
  -- action is not forced through a second round trip; 'approved' stays re-enterable so a corrected
  -- effective date can be applied before the plan goes in force.
  if v.state not in ('awaiting_signature','approved') or p_effective_date is null or p_review_due_date < p_effective_date then
    raise exception 'Invalid support plan approval request' using errcode='22023';
  end if;
  if v.participation_date is null then
    raise exception 'Record resident/designated-person participation before approving the plan' using errcode='22023';
  end if;

  perform set_config('app.allow_support_plan_history_update','true',true);
  update public.resident_support_plans set
    state='approved', effective_date=p_effective_date, review_due_date=p_review_due_date,
    approved_by=auth.uid(), approved_at=now(),
    staff_controlled_signature=coalesce(p_staff_signature,'{}'::jsonb),
    printable_snapshot=jsonb_build_object('planId',v.id,'version',v.version_number,'effectiveDate',p_effective_date,'needs',v.needs,'goals',v.goals,'services',v.services,'interventions',v.interventions),
    updated_at=now()
  where id=v.id;
  perform set_config('app.allow_support_plan_history_update','false',true);

  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values)
  values(v.organization_id,auth.uid(),'resident_support_plan',v.id::text,'support_plan.approved',
    jsonb_build_object('effectiveDate',p_effective_date,'reviewDueDate',p_review_due_date));

  -- Same-day approval still goes in force immediately, so the common case stays one action.
  if p_effective_date <= public.pa_today() then
    perform app_private.activate_support_plan(v.id);
  end if;
  return true;
end $function$
;

-- public.complete_course_assignment
CREATE OR REPLACE FUNCTION public.complete_course_assignment(p_assignment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_assignment public.course_assignments%rowtype;
  v_is_self boolean;
  v_was_completed boolean;
  v_course record;
  v_progress record;
  v_record_id uuid;
  v_certificate_id uuid;
  v_min_seconds numeric;
begin
  -- This row lock is the concurrency boundary: only one transaction can transition and
  -- issue for an assignment at a time. Replays wait, then reuse the committed certificate.
  select ca.* into v_assignment
  from public.course_assignments ca
  where ca.id = p_assignment_id
  for update of ca;

  if v_assignment.id is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = 'no_data_found';
  end if;

  v_is_self := public.owns_employee(v_assignment.employee_id);
  if not (
    public.is_platform_admin()
    or (
      v_assignment.organization_id = public.current_org_id()
      and (
        public."current_role"() = 'org_admin'
        or (
          public."current_role"() in ('facility_manager', 'trainer')
          and public.is_assigned_to_facility(v_assignment.facility_id)
        )
      )
    )
    or v_is_self
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  v_was_completed := v_assignment.status = 'completed';
  select * into v_course from public.courses where id = v_assignment.course_id;

  -- Integrity gates apply only to an employee's first transition. A replay of an already-valid
  -- completion must be able to repair a missing certificate without rewriting evidence dates.
  if v_is_self and not v_was_completed then
    select * into v_progress
    from public.course_progress
    where assignment_id = p_assignment_id;

    v_min_seconds := greatest(
      60,
      round(coalesce(v_course.estimated_duration_minutes, 0)::numeric * 60 * 0.10)
    );

    if v_progress.started_at is null then
      raise exception 'This course has not been started yet -- open it and work through at least one lesson before marking it complete.'
        using errcode = 'check_violation';
    end if;

    if extract(epoch from (now() - v_progress.started_at)) < v_min_seconds then
      raise exception 'This course needs to stay open for at least % minute(s) before it can be marked complete -- % minute(s) have elapsed so far.',
        ceil(v_min_seconds / 60.0),
        floor(extract(epoch from (now() - v_progress.started_at)) / 60.0)
        using errcode = 'check_violation', hint = 'Continue through the training content, then try again.';
    end if;

    if exists (
      select 1
      from public.course_blocks cb
      where cb.course_version_id = v_assignment.course_version_id
        and cb.block_type = 'quiz'
        and not exists (
          select 1
          from public.quizzes qz
          join public.quiz_attempts qa on qa.quiz_id = qz.id
          where qz.course_block_id = cb.id
            and qa.assignment_id = p_assignment_id
            and qa.passed = true
        )
    ) then
      raise exception 'This course has one or more quizzes that must be passed before it can be marked complete.'
        using errcode = 'check_violation', hint = 'Take (and pass) every quiz in this course, then try again.';
    end if;
  end if;

  perform set_config('app.privileged_write', 'on', true);

  if not v_was_completed then
    update public.course_assignments
    set status = 'completed', completed_at = now()
    where id = p_assignment_id;

    -- The compliance bridge is transition-only. A retry must never move the evidence's
    -- completion date forward or add annual hours a second time.
    if v_course.training_type_id is not null then
      select id into v_record_id
      from public.employee_training_records
      where employee_id = v_assignment.employee_id
        and training_type_id = v_course.training_type_id
      order by due_date desc nulls last, completion_date desc nulls last, created_at desc
      limit 1
      for update;

      if v_record_id is not null then
        update public.employee_training_records
        set completion_date = public.pa_today(),
            status = 'compliant',
            completion_method = 'online',
            training_provider = 'CareMetric CareBase Training Suite',
            hours = round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
            notes = 'Auto-recorded on completion of course "' || v_course.title || '".'
        where id = v_record_id;
      else
        insert into public.employee_training_records (
          organization_id, facility_id, employee_id, training_type_id,
          completion_date, status, hours, completion_method, training_provider, notes
        )
        values (
          v_assignment.organization_id,
          v_assignment.facility_id,
          v_assignment.employee_id,
          v_course.training_type_id,
          public.pa_today(),
          'compliant',
          round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
          'online',
          'CareMetric CareBase Training Suite',
          'Auto-recorded on completion of course "' || v_course.title || '".'
        );
      end if;
    end if;
  end if;

  insert into public.certificates (
    organization_id, facility_id, employee_id, course_id, course_assignment_id,
    issued_at, expires_at
  )
  values (
    v_assignment.organization_id,
    v_assignment.facility_id,
    v_assignment.employee_id,
    v_assignment.course_id,
    v_assignment.id,
    coalesce(v_assignment.completed_at, now()),
    null
  )
  on conflict (course_assignment_id) do nothing
  returning id into v_certificate_id;

  if v_certificate_id is null then
    select id into v_certificate_id
    from public.certificates
    where course_assignment_id = p_assignment_id;
  end if;

  if v_certificate_id is null then
    raise exception 'certificate reconciliation failed for assignment %', p_assignment_id;
  end if;

  if not v_was_completed then
    perform public.recalculate_compliance_core(v_assignment.organization_id);
  end if;
end;
$function$
;

-- public.complete_move_in_admission
CREATE OR REPLACE FUNCTION public.complete_move_in_admission(p_workspace_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.move_in_workspaces%rowtype;
  v_resident public.residents%rowtype;
  v_prospect public.admission_prospects%rowtype;
  v_bed public.facility_beds%rowtype;
begin
  select * into v from public.move_in_workspaces where id = p_workspace_id for update;
  if not found then raise exception 'Move-in workspace not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  perform public.refresh_move_in_readiness(v.id);
  select * into v from public.move_in_workspaces where id = p_workspace_id;
  if v.state <> 'ready' or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Workspace is not ready to admit' using errcode = '55000';
  end if;
  select * into v_resident from public.residents where id = v.resident_id for update;
  select * into v_prospect from public.admission_prospects where resident_id = v.resident_id for update;
  select * into v_bed from public.facility_beds where id = v_resident.bed_id for update;
  if v_bed.status <> 'reserved' or v_bed.reserved_for_prospect_id <> v_prospect.id then
    raise exception 'Reserved bed is no longer available' using errcode = '55000';
  end if;
  update public.facility_beds
  set status = 'occupied', occupied_by_resident_id = v_resident.id,
      reserved_for_prospect_id = null, updated_at = now()
  where id = v_bed.id;
  update public.residents
  set status = 'active', admission_date = public.pa_today(), discharge_date = null,
      updated_at = now()
  where id = v_resident.id;
  update public.admission_prospects set stage = 'admitted', updated_at = now()
  where id = v_prospect.id;
  update public.move_in_workspaces
  set state = 'completed',
      readiness_snapshot = readiness_snapshot || jsonb_build_object(
        'admittedAt', now(), 'admittedBy', auth.uid(), 'admissionReason', btrim(p_reason)
      ),
      updated_at = now()
  where id = v.id;
  insert into public.resident_census_events(
    organization_id, facility_id, resident_id, event_type, prior_status,
    resulting_status, prior_bed_id, resulting_bed_id, reason, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v_resident.id, 'admitted',
    v_resident.status, 'active', v_resident.bed_id, v_resident.bed_id,
    btrim(p_reason), auth.uid()
  );
  return v_resident.id;
end;
$function$
;

-- public.complete_resident_compliance_item
CREATE OR REPLACE FUNCTION public.complete_resident_compliance_item(p_item_id uuid, p_document_id uuid)
 RETURNS resident_compliance_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item public.resident_compliance_items;
  v_document public.resident_documents;
  v_completed_date date := public.pa_today();
  v_updated public.resident_compliance_items;
  v_facility_type text;
  v_support_plan_citation_ref text;
begin
  select * into v_item from public.resident_compliance_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'resident compliance item % not found', p_item_id using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_item.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_item.facility_id))
  ) then
    raise exception 'not authorized to complete this resident compliance item' using errcode = 'insufficient_privilege';
  end if;

  if v_item.status = 'compliant' and v_item.completed_date is not null then
    return v_item;
  end if;

  -- The document must exist, belong to the same resident, be linked to THIS item specifically
  -- (not just any state form on file for the resident), and be flagged as the actual state form.
  -- IS DISTINCT FROM (not <>) so a document with a null compliance_item_id -- e.g. uploaded via the
  -- generic per-resident Documents uploader without picking an item -- is correctly rejected instead
  -- of silently passing through three-valued-logic NULL comparison.
  select * into v_document from public.resident_documents where id = p_document_id;
  if v_document.id is null
     or v_document.resident_id is distinct from v_item.resident_id
     or v_document.compliance_item_id is distinct from p_item_id
     or v_document.is_state_form is not true then
    raise exception 'the state-approved DHS form for this item must be uploaded and attached before it can be marked complete -- no exception'
      using errcode = 'check_violation';
  end if;

  update public.resident_compliance_items
  set completed_date = v_completed_date, status = 'compliant'
  where id = p_item_id
  returning * into v_updated;

  if v_item.renewal_interval_days is not null then
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, v_item.item_type,
       v_completed_date + v_item.renewal_interval_days, v_item.renewal_interval_days, v_item.warning_days, v_item.grace_period_days);
  end if;

  if v_item.item_type in ('annual_reassessment', 'significant_change_reassessment')
     and not exists (select 1 from public.resident_compliance_items where triggered_by_item_id = p_item_id) then
    select facility_type into v_facility_type from public.facilities where id = v_item.facility_id;
    v_support_plan_citation_ref := case when v_facility_type = 'ALR' then '2800.224' else '2600.227' end;

    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id, triggered_by_item_id)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'support_plan_30day',
       v_completed_date + 30, null, 14, 0,
       (select id from public.dhs_citation_topics where citation_ref = v_support_plan_citation_ref),
       p_item_id);
  end if;

  return v_updated;
end;
$function$
;

-- public.copy_compliance_requirement
CREATE OR REPLACE FUNCTION public.copy_compliance_requirement(p_template_id uuid, p_facility_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t public.compliance_requirements%rowtype;
  v_fac uuid;
  v_new public.compliance_requirements%rowtype;
  v_count integer := 0;
begin
  select * into t from public.compliance_requirements where id = p_template_id;
  if not found then raise exception 'Template not found' using errcode = 'P0002'; end if;
  perform app_private.assert_compliance_manager(t.organization_id, null);
  if coalesce(array_length(p_facility_ids, 1), 0) = 0 then
    raise exception 'Select at least one facility' using errcode = '22023';
  end if;

  foreach v_fac in array p_facility_ids loop
    if not exists (select 1 from public.facilities f where f.id = v_fac and f.organization_id = t.organization_id) then
      raise exception 'Facility is not in this organization' using errcode = '23514';
    end if;
    perform app_private.assert_compliance_manager(t.organization_id, v_fac);
    -- Idempotent anti-duplicate deploy: the partial unique index on (source_template_id, facility_id)
    -- makes concurrent double-deploys safe -- ON CONFLICT skips the duplicate insert atomically rather
    -- than relying on a read-then-insert that two managers could both pass at once.
    insert into public.compliance_requirements (
      organization_id, facility_id, category, title, description, regulation_citation,
      regulation_chapter, responsible_profile_id, recurrence, custom_interval_days, anchor_date,
      warning_days, requires_evidence, requires_review, is_template, source_template_id, created_by
    ) values (
      t.organization_id, v_fac, t.category, t.title, t.description, t.regulation_citation,
      t.regulation_chapter, t.responsible_profile_id, t.recurrence, t.custom_interval_days,
      coalesce(t.anchor_date, public.pa_today()), t.warning_days, t.requires_evidence, t.requires_review,
      false, t.id, (select auth.uid())
    )
    on conflict (source_template_id, facility_id) where source_template_id is not null do nothing
    returning * into v_new;
    if not found then
      continue;  -- already deployed to this facility
    end if;

    insert into public.compliance_requirement_events
      (organization_id, facility_id, requirement_id, event_type, actor_profile_id, note, metadata)
    values (v_new.organization_id, v_new.facility_id, v_new.id, 'template_copied', (select auth.uid()),
      v_new.title, jsonb_build_object('template_id', t.id));

    perform app_private.ensure_compliance_instances(v_new.id, public.pa_today() + greatest(v_new.warning_days, 30));
    v_count := v_count + 1;
  end loop;

  return v_count;
end $function$
;

-- public.create_qapi_project
CREATE OR REPLACE FUNCTION public.create_qapi_project(p_facility_id uuid, p_title text, p_problem_statement text, p_source_of_concern text, p_baseline_data text, p_measurable_objective text, p_target_description text, p_target_value numeric, p_target_completion_date date, p_project_lead uuid, p_source_type text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid, p_pattern_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fac public.facilities%rowtype;
  v_id uuid;
  v_num text;
  v_pattern text := nullif(btrim(coalesce(p_pattern_key, '')), '');
begin
  select * into v_fac from public.facilities where id=p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);

  -- From 20260726000400. The lead runs the project at this facility, so it must be an active member
  -- of the org who can access the facility: an org/platform admin (org-wide) or a facility manager
  -- assigned here.
  if p_project_lead is not null and not exists (
    select 1 from public.profiles p
    where p.id=p_project_lead and p.is_active and p.organization_id=v_fac.organization_id
      and (p.role in ('org_admin','platform_admin')
           or (p.role='facility_manager' and exists (
             select 1 from public.facility_assignments fa where fa.profile_id=p.id and fa.facility_id=v_fac.id)))
  ) then
    raise exception 'The QAPI lead must be an active manager with access to this facility' using errcode='23514';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_fac.organization_id::text));
  if length(btrim(p_title))<3 or length(btrim(p_problem_statement))<10 or p_target_completion_date<public.pa_today() then
    raise exception 'Invalid QAPI project' using errcode='22023';
  end if;

  if p_source_type is not null and p_source_id is not null then
    select id into v_id from public.qapi_projects
    where organization_id=v_fac.organization_id and source_type=p_source_type and source_id=p_source_id;
    if v_id is not null then return v_id; end if;
  end if;

  -- Same idempotency posture as the source lookup above: acting on a recommendation twice returns
  -- the project that already exists rather than raising, because the second click is not an error.
  if v_pattern is not null then
    select id into v_id from public.qapi_projects
    where organization_id=v_fac.organization_id and facility_id=v_fac.id and pattern_key=v_pattern;
    if v_id is not null then return v_id; end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('qapi_project_numbering'), hashtext(v_fac.organization_id::text));
  v_num:='QAPI-'||to_char(public.pa_today(),'YYYY')||'-'||lpad((select (count(*)+1)::text from public.qapi_projects where organization_id=v_fac.organization_id),4,'0');
  insert into public.qapi_projects(
    organization_id,facility_id,project_number,title,problem_statement,source_of_concern,
    source_type,source_id,pattern_key,baseline_data,measurable_objective,target_description,
    target_value,target_completion_date,project_lead_profile_id,created_by)
  values(
    v_fac.organization_id,v_fac.id,v_num,btrim(p_title),btrim(p_problem_statement),btrim(p_source_of_concern),
    p_source_type,p_source_id,v_pattern,p_baseline_data,p_measurable_objective,p_target_description,
    p_target_value,p_target_completion_date,p_project_lead,auth.uid())
  returning id into v_id;
  insert into public.qapi_project_history(organization_id,facility_id,project_id,event_type,resulting_status,reason,actor_profile_id)
  values(v_fac.organization_id,v_fac.id,v_id,'created','proposed','QAPI project created',auth.uid()) on conflict do nothing;
  return v_id;
end$function$
;

-- public.create_resident_change_event
CREATE OR REPLACE FUNCTION public.create_resident_change_event(p_resident_id uuid, p_category text, p_identified_at timestamp with time zone, p_immediate_observations text, p_immediate_action_taken text, p_provider_notification_status text, p_designated_person_notification_status text, p_emergency_transfer boolean, p_emergency_transfer_destination text, p_monitoring_instructions text, p_monitoring_frequency text, p_monitoring_duration_hours integer, p_assigned_profile_id uuid, p_follow_up_due_at timestamp with time zone, p_incident_decision text, p_reassessment_required boolean, p_support_plan_revision_required boolean, p_source_service_alert_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_resident public.residents%rowtype;
  v_facility_type text;
  v_assigned uuid;
  v_event uuid;
  v_item uuid;
  v_incident uuid;
  v_citation uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_change_event_contributor(
    v_resident.organization_id, v_resident.facility_id, p_assigned_profile_id, false
  );
  select facility_type into v_facility_type from public.facilities where id = v_resident.facility_id;
  if v_facility_type not in ('PCH', 'ALR') then
    raise exception 'Change-of-condition workflow is not supported for this facility type'
      using errcode = '0A000';
  end if;
  if p_category not in (
    'fall', 'emergency_department_visit', 'hospital_return', 'mobility_decline',
    'skin_concern', 'appetite_intake_change', 'weight_concern',
    'mental_status_change', 'behavioral_change', 'infection_symptoms',
    'continence_change', 'new_supervision_concern',
    'hospice_end_of_life_change', 'other_significant_change'
  ) or length(btrim(coalesce(p_immediate_observations, ''))) < 3
    or length(btrim(coalesce(p_immediate_action_taken, ''))) < 3
    or p_provider_notification_status not in ('not_required', 'pending', 'completed', 'unable_to_reach')
    or p_designated_person_notification_status not in ('not_required', 'pending', 'completed', 'unable_to_reach')
    or p_incident_decision not in ('pending', 'required', 'not_required')
    or p_follow_up_due_at < p_identified_at
    or (p_emergency_transfer and length(btrim(coalesce(p_emergency_transfer_destination, ''))) < 2)
    or (p_monitoring_duration_hours is not null and p_monitoring_duration_hours not between 1 and 720) then
    raise exception 'Invalid change-of-condition event' using errcode = '22023';
  end if;
  v_assigned := coalesce(p_assigned_profile_id, auth.uid());
  if v_assigned is not null and not exists (
    select 1 from public.profiles p
    where p.id = v_assigned and p.organization_id = v_resident.organization_id and p.is_active
  ) then raise exception 'Assigned staff is outside organization' using errcode = '22023'; end if;
  if p_source_service_alert_id is not null and not exists (
    select 1 from public.service_task_alerts a
    where a.id = p_source_service_alert_id
      and a.resident_id = v_resident.id
      and a.facility_id = v_resident.facility_id
  ) then raise exception 'Service alert is outside resident scope' using errcode = '22023'; end if;

  if p_reassessment_required then
    select id into v_citation from public.dhs_citation_topics
    where citation_ref = case when v_facility_type = 'ALR' then '2800.225' else '2600.225' end
    limit 1;
    insert into public.resident_compliance_items(
      organization_id, facility_id, resident_id, item_type, due_date,
      renewal_interval_days, warning_days, grace_period_days, notes, citation_topic_id
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_resident.id,
      'significant_change_reassessment', public.pa_today(), null, 2, 0,
      btrim(p_immediate_observations), v_citation
    ) returning id into v_item;
  end if;
  if p_incident_decision = 'required' then
    insert into public.incidents(
      organization_id, facility_id, incident_type, occurred_at,
      reported_by_profile_id, resident_identifier, narrative, severity
    ) values (
      v_resident.organization_id, v_resident.facility_id, 'other', p_identified_at,
      auth.uid(), v_resident.id::text,
      'Change-of-condition event: ' || btrim(p_immediate_observations)
        || E'\nImmediate action: ' || btrim(p_immediate_action_taken),
      case when p_emergency_transfer then 'major' else 'moderate' end
    ) returning id into v_incident;
  end if;
  insert into public.resident_change_events(
    organization_id, facility_id, resident_id, category, identified_at,
    identified_by_profile_id, identified_by_name,
    immediate_observations, immediate_action_taken,
    provider_notification_status, designated_person_notification_status,
    emergency_transfer, emergency_transfer_at, emergency_transfer_destination,
    monitoring_instructions, monitoring_frequency, monitoring_duration_hours,
    monitoring_ends_at, assigned_profile_id, follow_up_due_at,
    incident_decision, incident_id, reassessment_required, compliance_item_id,
    support_plan_revision_required, source_service_alert_id, status
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, p_category,
    p_identified_at, auth.uid(),
    (select p.first_name || ' ' || p.last_name from public.profiles p where p.id = auth.uid()),
    btrim(p_immediate_observations), btrim(p_immediate_action_taken),
    p_provider_notification_status, p_designated_person_notification_status,
    p_emergency_transfer, case when p_emergency_transfer then p_identified_at else null end,
    nullif(btrim(p_emergency_transfer_destination), ''),
    nullif(btrim(p_monitoring_instructions), ''), nullif(btrim(p_monitoring_frequency), ''),
    p_monitoring_duration_hours,
    case when p_monitoring_duration_hours is null then null
      else p_identified_at + make_interval(hours => p_monitoring_duration_hours) end,
    v_assigned, p_follow_up_due_at, p_incident_decision, v_incident,
    p_reassessment_required, v_item, p_support_plan_revision_required,
    p_source_service_alert_id,
    case when nullif(btrim(p_monitoring_instructions), '') is not null then 'monitoring' else 'open' end
  ) returning id into v_event;
  insert into public.resident_change_follow_ups(
    organization_id, facility_id, event_id, assigned_profile_id, due_at
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_event, v_assigned, p_follow_up_due_at
  );
  insert into public.resident_change_event_history(
    organization_id, facility_id, event_id, event_type, resulting_status,
    reason, actor_profile_id, evidence
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_event, 'created',
    case when nullif(btrim(p_monitoring_instructions), '') is not null then 'monitoring' else 'open' end,
    'Structured change-of-condition event created', auth.uid(),
    jsonb_strip_nulls(jsonb_build_object(
      'complianceItemId', v_item, 'incidentId', v_incident,
      'sourceServiceAlertId', p_source_service_alert_id
    ))
  );
  perform app_private.create_automatic_work_item(
    v_resident.organization_id, v_resident.facility_id,
    'resident.change_of_condition', 'change_of_condition', v_event,
    'Follow up ' || replace(p_category, '_', ' ') || ' for '
      || v_resident.first_name || ' ' || v_resident.last_name,
    'Complete notifications, monitoring, follow-up, reassessment decision, and supervisor review.',
    case when p_emergency_transfer then 'urgent' else 'high' end,
    p_follow_up_due_at
  );
  if p_source_service_alert_id is not null then
    update public.service_task_alerts
    set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now()
    where id = p_source_service_alert_id and status = 'open';
  end if;
  return v_event;
end;
$function$
;

-- public.decide_open_shift_claim
CREATE OR REPLACE FUNCTION public.decide_open_shift_claim(p_claim_id uuid, p_approve boolean, p_reason text)
 RETURNS open_shift_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim public.open_shift_claims%rowtype;
  v_open public.open_shift_opportunities%rowtype;
  v_employee public.employees%rowtype;
  v_result jsonb;
  v_decision_id uuid;
  v_assignment_id uuid;
  v_approved_count integer;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('open-shift-claim:' || p_claim_id::text, 0));
  select * into v_claim from public.open_shift_claims where id = p_claim_id for update;
  if not found then raise exception 'Open-shift claim was not found' using errcode = 'P0002'; end if;
  select * into v_open from public.open_shift_opportunities where id = v_claim.opportunity_id for update;
  perform app_private.assert_phase3_admin(v_claim.organization_id, 'scheduling.self_service.manage', v_open.facility_id);
  select * into v_employee from public.employees where id = v_claim.employee_id;
  if not found then raise exception 'The employee was not found' using errcode = 'P0002'; end if;
  if v_claim.claim_status not in ('pending_approval','waitlisted') then
    raise exception 'The open-shift claim is not awaiting a decision' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'A decision reason is required' using errcode = '22023'; end if;

  if not p_approve then
    update public.open_shift_claims
    set claim_status = 'rejected', waitlist_position = null, decided_by = auth.uid(),
      decided_at = now(), decision_reason = btrim(p_reason)
    where id = v_claim.id returning * into v_claim;
  else
    if v_open.status not in ('open','filled') or v_open.shift_date < public.pa_today() then
      raise exception 'The open shift is no longer available' using errcode = '55000';
    end if;
    select count(*)::integer into v_approved_count
    from public.open_shift_claims c
    where c.opportunity_id = v_open.id and c.claim_status = 'approved' and c.id <> v_claim.id;
    if v_approved_count >= v_open.slots then
      raise exception 'All open-shift slots are already filled' using errcode = '23514';
    end if;
    if v_employee.status <> 'active' then raise exception 'The employee is no longer active' using errcode = '23514'; end if;
    v_starts := v_open.shift_date + v_open.start_time;
    v_ends := v_open.shift_date + v_open.end_time
      + case when v_open.end_time <= v_open.start_time then interval '1 day' else interval '0' end;
    v_result := public.evaluate_schedule_eligibility(
      v_employee.id, v_open.facility_id, v_starts, v_ends,
      v_open.required_qualification_keys, v_open.required_credential_types,
      v_open.required_training_type_ids, array[]::uuid[]
    );
    v_decision_id := app_private.persist_schedule_eligibility_decision(
      v_employee.id, v_open.facility_id, 'open_shift_claim', 'open_shift', v_open.id,
      v_starts, v_ends, v_result
    );
    if v_result->>'outcome' = 'blocked' then
      raise exception 'Open-shift approval blocked: %', v_result->'hardBlocks' using errcode = '23514';
    end if;
    insert into public.shift_assignments(
      organization_id, schedule_id, facility_id, employee_id, unit_id,
      shift_definition_id, shift_date, start_time, end_time, status, source, notes
    ) values (
      v_open.organization_id, v_open.schedule_id, v_open.facility_id, v_employee.id,
      v_open.unit_id, v_open.shift_definition_id, v_open.shift_date, v_open.start_time,
      v_open.end_time, 'confirmed', 'self_service', '[approved open-shift claim] ' || btrim(p_reason)
    ) returning id into v_assignment_id;
    update public.open_shift_claims
    set claim_status = 'approved', waitlist_position = null, eligibility_decision_id = v_decision_id,
      shift_assignment_id = v_assignment_id, decided_by = auth.uid(), decided_at = now(),
      decision_reason = btrim(p_reason)
    where id = v_claim.id returning * into v_claim;
    if v_approved_count + 1 >= v_open.slots then
      update public.open_shift_opportunities set status = 'filled' where id = v_open.id;
    end if;
  end if;

  insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
  values(v_claim.organization_id, v_employee.profile_id, 'open_shift_claim_changed',
    'Open shift claim ' || replace(v_claim.claim_status, '_', ' '),
    'A manager recorded a decision: ' || btrim(p_reason), '/me/schedule');
  return v_claim;
end;
$function$
;

-- public.generate_compliance_instances_now
CREATE OR REPLACE FUNCTION public.generate_compliance_instances_now(p_requirement_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.compliance_requirements%rowtype;
begin
  select * into r from public.compliance_requirements where id = p_requirement_id;
  if not found then raise exception 'Requirement not found' using errcode = 'P0002'; end if;
  perform app_private.assert_compliance_manager(r.organization_id, r.facility_id);
  return app_private.ensure_compliance_instances(r.id, public.pa_today() + greatest(r.warning_days, 30));
end $function$
;

-- public.generate_paged_compliance_report
CREATE OR REPLACE FUNCTION public.generate_paged_compliance_report(p_report_id text, p_facility_id uuid DEFAULT NULL::uuid, p_employee_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_headers jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_total_employees bigint := 0;
  v_compliant bigint := 0;
  v_expired bigint := 0;
  v_due_soon bigint := 0;
  v_missing bigint := 0;
  v_other bigint := 0;
  v_score integer := 100;
  v_current_year integer := extract(year from public.pa_today())::integer;
begin
  if p_report_id is null or p_report_id not in (
    'compliance-summary', 'facility-compliance', 'survey-readiness',
    'expired-training', 'due-soon', 'medication-administration',
    'training-matrix', 'practicum-status', 'annual-practicum',
    'annual-hours', 'training-hours', 'trainer-certification',
    'new-employee-training', 'employee-transcript',
    'expiring-certifications', 'missing-documents', 'document-audit',
    'overdue-training', 'credential-status', 'incident-log',
    'incident-notification-register', 'inspection-compliance'
  ) then
    raise exception 'Unsupported report id'
      using errcode = '22023';
  end if;

  if not public.current_profile_active()
     or public.current_role() not in ('org_admin', 'facility_manager', 'auditor') then
    raise exception 'Not authorized to generate compliance reports'
      using errcode = '42501';
  end if;

  -- Because this function is SECURITY INVOKER, this lookup also proves that the
  -- caller can see the requested facility through normal facilities RLS.
  if p_facility_id is not null and not exists (
    select 1
    from public.facilities f
    where f.id = p_facility_id
      and not f.is_sandbox
  ) then
    raise exception 'Facility is outside the caller scope'
      using errcode = '42501';
  end if;

  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'The report start date must be on or before the end date'
      using errcode = '22023';
  end if;

  if p_report_id = 'compliance-summary' then
    select count(*)
      into v_total_employees
    from public.employees e
    join public.facilities f on f.id = e.facility_id and not f.is_sandbox
    where e.status = 'active'
      and not e.is_synthetic
      and (p_facility_id is null or e.facility_id = p_facility_id);

    select
      count(*) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')),
      count(*) filter (where r.status = 'compliant'),
      count(*) filter (where r.status = 'expired'),
      count(*) filter (where r.status = 'due_soon')
      into v_total, v_compliant, v_expired, v_due_soon
    from public.employee_training_records r
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    v_score := case when v_total > 0 then round(v_compliant * 100.0 / v_total)::integer else 100 end;
    v_headers := '["Metric","Value"]'::jsonb;
    v_rows := jsonb_build_array(
      jsonb_build_array('Total Employees', v_total_employees::text),
      jsonb_build_array('Total Training Records', v_total::text),
      jsonb_build_array('Compliant Records', v_compliant::text),
      jsonb_build_array('Expired Records', v_expired::text),
      jsonb_build_array('Due Soon Records', v_due_soon::text),
      jsonb_build_array('Compliance Percentage', v_score::text || '%')
    );
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Employees', 'value', v_total_employees),
      jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Expired', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end),
      jsonb_build_object('label', 'Compliance', 'value', v_score::text || '%', 'variant', case when v_score >= 80 then 'success' when v_score >= 50 then 'warning' else 'danger' end)
    );
    v_total := 6;

  elsif p_report_id = 'facility-compliance' then
    with scored as (
      select
        f.id,
        f.name,
        f.facility_type,
        count(r.id) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')) as total,
        count(r.id) filter (where r.status = 'compliant') as compliant,
        count(r.id) filter (where r.status = 'expired') as expired,
        count(r.id) filter (where r.status = 'due_soon') as due_soon
      from public.facilities f
      left join public.employee_training_records r
        on r.facility_id = f.id
       and (p_date_from is null or r.due_date >= p_date_from)
       and (p_date_to is null or r.due_date <= p_date_to)
      where not f.is_sandbox
        and (p_facility_id is null or f.id = p_facility_id)
      group by f.id, f.name, f.facility_type
    ), paged as (
      select *, case when total > 0 then round(compliant * 100.0 / total)::integer else 100 end as score
      from scored
      order by name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scored),
      coalesce((
        select jsonb_agg(jsonb_build_array(
          name,
          case
            when facility_type = 'ALR' then 'ALF'
            else replace(facility_type, '_', ' ')
          end,
          total::text,
          compliant::text,
          expired::text,
          due_soon::text,
          score::text || '%'
        ) order by name, id)
        from paged
      ), '[]'::jsonb),
      coalesce((select round(avg(case when total > 0 then compliant * 100.0 / total else 100 end))::integer from scored), 100)
      into v_total, v_rows, v_score;
    v_headers := '["Facility","Type","Total Records","Compliant","Expired","Due Soon","Compliance %"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Facilities', 'value', v_total),
      jsonb_build_object('label', 'Avg Score', 'value', v_score::text || '%')
    );

  elsif p_report_id = 'survey-readiness' then
    select
      count(*) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')),
      count(*) filter (where r.status = 'compliant'),
      count(*) filter (where r.status = 'expired'),
      count(*) filter (where r.status = 'missing' and r.document_required)
      into v_total, v_compliant, v_expired, v_missing
    from public.employee_training_records r
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    v_score := case when v_total > 0 then round(v_compliant * 100.0 / v_total)::integer else 100 end;

    select count(*)
      into v_total_employees
    from public.employees e
    join public.facilities f on f.id = e.facility_id and not f.is_sandbox
    where e.status = 'active'
      and not e.is_synthetic
      and (p_facility_id is null or e.facility_id = p_facility_id);

    -- Reuse scratch counters for the remaining readiness checks:
    -- due_soon=med-admin gaps, other=trainer gaps.
    select count(*)
      into v_due_soon
    from public.employee_training_records r
    join public.employees e on e.id = r.employee_id and e.administers_medications and e.status = 'active' and not e.is_synthetic
    join public.training_types t on t.id = r.training_type_id and t.is_active and t.applies_to_administers_meds
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where r.status in ('expired', 'missing')
      and (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    select count(*)
      into v_other
    from public.employee_training_records r
    join public.employees e on e.id = r.employee_id and e.trainer_status and e.status = 'active' and not e.is_synthetic
    join public.training_types t on t.id = r.training_type_id and t.is_active and t.applies_to_trainers
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where r.status in ('expired', 'missing')
      and (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    declare
      v_pending_practicums bigint;
      v_year_practicums bigint;
      v_critical_alerts bigint;
      v_med_admin_staff bigint;
      v_passes integer := 0;
      v_readiness integer;
    begin
      select
        count(*) filter (where p.practicum_year = v_current_year),
        count(*) filter (where p.practicum_year = v_current_year and p.status <> 'compliant')
        into v_year_practicums, v_pending_practicums
      from public.practicums p
      join public.facilities f on f.id = p.facility_id and not f.is_sandbox
      where (p_facility_id is null or p.facility_id = p_facility_id)
        and (p_date_from is null or p.due_date >= p_date_from)
        and (p_date_to is null or p.due_date <= p_date_to);

      select count(*) into v_critical_alerts
      from public.alerts a
      left join public.facilities f on f.id = a.facility_id
      where a.status = 'open' and a.severity = 'critical'
        and (a.facility_id is null or not coalesce(f.is_sandbox, false))
        and (p_facility_id is null or a.facility_id = p_facility_id);

      select count(*) into v_med_admin_staff
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.status = 'active' and e.administers_medications and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id);

      v_passes :=
        (case when v_score >= 90 then 1 else 0 end) +
        (case when v_expired = 0 then 1 else 0 end) +
        (case when v_due_soon = 0 then 1 else 0 end) +
        (case when v_other = 0 then 1 else 0 end) +
        (case when v_pending_practicums = 0 then 1 else 0 end) +
        (case when v_missing = 0 then 1 else 0 end) +
        (case when v_critical_alerts = 0 then 1 else 0 end);
      v_readiness := round(v_passes * 100.0 / 7)::integer;

      v_headers := '["Check","Status","Detail"]'::jsonb;
      v_rows := jsonb_build_array(
        jsonb_build_array('Overall Training Compliance', case when v_score >= 90 then 'pass' when v_score >= 75 then 'warning' else 'fail' end, v_compliant::text || ' of ' || v_total::text || ' records compliant (' || v_score::text || '%)'),
        jsonb_build_array('Expired Training Records', case when v_expired = 0 then 'pass' else 'fail' end, v_expired::text || ' expired record(s) require immediate renewal'),
        jsonb_build_array('Medication Administration Training', case when v_due_soon = 0 then 'pass' else 'fail' end, v_due_soon::text || ' med admin training record(s) are expired or missing'),
        jsonb_build_array('Trainer Certification', case when v_other = 0 then 'pass' else 'fail' end, v_other::text || ' trainer certification record(s) are expired or missing'),
        jsonb_build_array('Annual Practicum Completion', case when v_pending_practicums = 0 then 'pass' else 'warning' end, v_pending_practicums::text || ' of ' || v_year_practicums::text || ' ' || v_current_year::text || ' practicums pending'),
        jsonb_build_array('Required Documentation', case when v_missing = 0 then 'pass' else 'warning' end, v_missing::text || ' record(s) missing required documentation'),
        jsonb_build_array('Open Critical Alerts', case when v_critical_alerts = 0 then 'pass' else 'fail' end, v_critical_alerts::text || ' open critical alert(s)')
      );
      v_summary := jsonb_build_array(
        jsonb_build_object('label', 'Readiness Score', 'value', v_readiness::text || '%', 'variant', case when v_readiness >= 80 then 'success' when v_readiness >= 50 then 'warning' else 'danger' end),
        jsonb_build_object('label', 'Compliance Score', 'value', v_score::text || '%', 'variant', case when v_score >= 80 then 'success' when v_score >= 50 then 'warning' else 'danger' end),
        jsonb_build_object('label', 'Active Staff', 'value', v_total_employees),
        jsonb_build_object('label', 'Med Admin Staff', 'value', v_med_admin_staff)
      );
      v_total := 7;
    end;

  elsif p_report_id in (
    'expired-training', 'due-soon', 'medication-administration',
    'trainer-certification', 'new-employee-training',
    'expiring-certifications', 'missing-documents'
  ) then
    with scoped as (
      select
        r.id,
        e.first_name,
        e.last_name,
        e.job_title,
        e.hire_date,
        t.name as training_type_name,
        r.completion_date,
        r.due_date,
        r.status
      from public.employee_training_records r
      join public.employees e on e.id = r.employee_id and not e.is_synthetic
      join public.training_types t on t.id = r.training_type_id
      join public.facilities f on f.id = r.facility_id and not f.is_sandbox
      where (p_facility_id is null or r.facility_id = p_facility_id)
        and (p_date_from is null or r.due_date >= p_date_from)
        and (p_date_to is null or r.due_date <= p_date_to)
        and case p_report_id
          when 'expired-training' then r.status = 'expired'
          when 'due-soon' then r.status = 'due_soon'
          when 'medication-administration' then e.status = 'active' and e.administers_medications and t.is_active and t.applies_to_administers_meds
          when 'trainer-certification' then e.status = 'active' and e.trainer_status and t.is_active and t.applies_to_trainers
          when 'new-employee-training' then e.status = 'active' and e.hire_date >= public.pa_today() - 90
          when 'expiring-certifications' then r.due_date between public.pa_today() and public.pa_today() + 90
          when 'missing-documents' then r.status = 'missing' and r.document_required
          else false
        end
    ), paged as (
      select * from scoped
      order by due_date nulls last, last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((
        select jsonb_agg(
          case when p_report_id in ('medication-administration', 'new-employee-training')
            then jsonb_build_array(first_name || ' ' || last_name, coalesce(job_title, ''), coalesce(hire_date::text, ''), training_type_name, coalesce(completion_date::text, ''), coalesce(due_date::text, ''), status)
            else jsonb_build_array(first_name || ' ' || last_name, coalesce(job_title, ''), training_type_name, coalesce(completion_date::text, ''), coalesce(due_date::text, ''), status)
          end
          order by due_date nulls last, last_name, first_name, id
        ) from paged
      ), '[]'::jsonb)
      into v_total, v_rows;

    v_headers := case when p_report_id in ('medication-administration', 'new-employee-training')
      then '["Employee","Job Title","Hire Date","Training Type","Completion","Due Date","Status"]'::jsonb
      else '["Employee","Job Title","Training Type","Completion Date","Due Date","Status"]'::jsonb
    end;
    v_summary := case p_report_id
      when 'expired-training' then jsonb_build_array(jsonb_build_object('label', 'Expired Records', 'value', v_total, 'variant', case when v_total > 0 then 'danger' else 'success' end))
      when 'due-soon' then jsonb_build_array(jsonb_build_object('label', 'Due Soon Records', 'value', v_total, 'variant', case when v_total > 0 then 'warning' else 'success' end))
      when 'expiring-certifications' then jsonb_build_array(jsonb_build_object('label', 'Expiring (90 days)', 'value', v_total, 'variant', case when v_total > 0 then 'warning' else 'success' end))
      when 'missing-documents' then jsonb_build_array(jsonb_build_object('label', 'Missing Documents', 'value', v_total, 'variant', case when v_total > 0 then 'warning' else 'success' end))
      when 'medication-administration' then jsonb_build_array(
        jsonb_build_object('label', 'Med Admin Staff', 'value', (select count(*) from public.employees e join public.facilities f on f.id=e.facility_id and not f.is_sandbox where e.status='active' and e.administers_medications and not e.is_synthetic and (p_facility_id is null or e.facility_id=p_facility_id))),
        jsonb_build_object('label', 'Training Records', 'value', v_total)
      )
      when 'trainer-certification' then jsonb_build_array(
        jsonb_build_object('label', 'Trainers', 'value', (select count(*) from public.employees e join public.facilities f on f.id=e.facility_id and not f.is_sandbox where e.status='active' and e.trainer_status and not e.is_synthetic and (p_facility_id is null or e.facility_id=p_facility_id))),
        jsonb_build_object('label', 'Training Records', 'value', v_total)
      )
      else jsonb_build_array(
        jsonb_build_object('label', 'New Employees', 'value', (select count(*) from public.employees e join public.facilities f on f.id=e.facility_id and not f.is_sandbox where e.status='active' and not e.is_synthetic and e.hire_date >= public.pa_today() - 90 and (p_facility_id is null or e.facility_id=p_facility_id))),
        jsonb_build_object('label', 'Training Records', 'value', v_total)
      )
    end;

  elsif p_report_id = 'training-matrix' then
    with matrix_types as materialized (
      select t.id, t.name, t.applies_to_facility_type, t.sort_order
      from public.training_types t
      where t.is_active
      order by t.sort_order, t.name, t.id
    ), scoped_employees as materialized (
      select e.id, e.first_name, e.last_name, e.job_title, f.facility_type
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.status = 'active'
        and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id)
    ), paged_employees as (
      select * from scoped_employees
      order by last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped_employees),
      jsonb_build_array('Employee', 'Job Title') || coalesce((
        select jsonb_agg(to_jsonb(t.name) order by t.sort_order, t.name, t.id)
        from matrix_types t
      ), '[]'::jsonb),
      coalesce((
        select jsonb_agg(
          jsonb_build_array(e.first_name || ' ' || e.last_name, coalesce(e.job_title, '')) ||
          coalesce((
            select jsonb_agg(
              to_jsonb(coalesce(
                latest.status,
                case
                  when t.applies_to_facility_type not in ('BOTH', e.facility_type) then 'not_applicable'
                  else 'no_record'
                end
              ))
              order by t.sort_order, t.name, t.id
            )
            from matrix_types t
            left join lateral (
              select r.status
              from public.employee_training_records r
              where r.employee_id = e.id
                and r.training_type_id = t.id
                and (p_facility_id is null or r.facility_id = p_facility_id)
              order by r.due_date desc nulls last, r.created_at desc, r.id desc
              limit 1
            ) latest on true
          ), '[]'::jsonb)
          order by e.last_name, e.first_name, e.id
        )
        from paged_employees e
      ), '[]'::jsonb),
      (select count(*) from matrix_types)
      into v_total, v_headers, v_rows, v_other;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Employees', 'value', v_total),
      jsonb_build_object('label', 'Training Types', 'value', v_other)
    );

  elsif p_report_id in ('practicum-status', 'annual-practicum') then
    with scoped as (
      select
        p.id,
        e.first_name,
        e.last_name,
        p.practicum_year,
        p.status,
        p.completion_date,
        p.due_date,
        p.observed_by,
        p.mar_review_completed,
        p.direct_observation_completed
      from public.practicums p
      join public.employees e on e.id = p.employee_id and not e.is_synthetic
      join public.facilities f on f.id = p.facility_id and not f.is_sandbox
      where (p_facility_id is null or p.facility_id = p_facility_id)
        and (p_date_from is null or p.due_date >= p_date_from)
        and (p_date_to is null or p.due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by due_date nulls last, last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      coalesce((
        select jsonb_agg(
          case when p_report_id = 'annual-practicum'
            then jsonb_build_array(
              first_name || ' ' || last_name,
              practicum_year::text,
              status,
              coalesce(completion_date::text, ''),
              coalesce(observed_by, ''),
              case when mar_review_completed then 'Yes' else 'No' end,
              case when direct_observation_completed then 'Yes' else 'No' end
            )
            else jsonb_build_array(first_name || ' ' || last_name, practicum_year::text, status, coalesce(completion_date::text, ''))
          end
          order by due_date nulls last, last_name, first_name, id
        ) from paged
      ), '[]'::jsonb)
      into v_total, v_compliant, v_rows;

    if p_report_id = 'annual-practicum' then
      v_headers := '["Employee","Year","Status","Completion Date","Observed By","MAR Review","Direct Observation"]'::jsonb;
      v_summary := jsonb_build_array(
        jsonb_build_object('label', 'Total Required', 'value', v_total),
        jsonb_build_object('label', 'Completed', 'value', v_compliant, 'variant', 'success'),
        jsonb_build_object('label', 'Pending', 'value', v_total - v_compliant, 'variant', case when v_total - v_compliant > 0 then 'warning' else 'success' end)
      );
    else
      select count(*) into v_total_employees
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.status = 'active' and e.administers_medications and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id);
      v_headers := '["Employee","Year","Status","Completion Date"]'::jsonb;
      v_summary := jsonb_build_array(
        jsonb_build_object('label', 'Med Admin Staff', 'value', v_total_employees),
        jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
        jsonb_build_object('label', 'Pending', 'value', v_total - v_compliant, 'variant', case when v_total - v_compliant > 0 then 'warning' else 'success' end)
      );
    end if;

  elsif p_report_id in ('annual-hours', 'training-hours') then
    with scoped as (
      select
        b.id,
        e.first_name,
        e.last_name,
        b.bucket_type,
        b.training_year,
        b.required_hours,
        b.completed_hours,
        b.status,
        b.employee_id
      from public.employee_training_hour_buckets b
      join public.employees e on e.id = b.employee_id and not e.is_synthetic
      join public.facilities f on f.id = b.facility_id and not f.is_sandbox
      where (p_facility_id is null or b.facility_id = p_facility_id)
        and (p_date_from is null or b.training_year >= extract(year from p_date_from)::integer)
        and (p_date_to is null or b.training_year <= extract(year from p_date_to)::integer)
        and (p_report_id <> 'annual-hours' or p_date_from is not null or p_date_to is not null or b.training_year = v_current_year)
    ), paged as (
      select * from scoped
      order by training_year desc, last_name, first_name, bucket_type, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      (select count(distinct employee_id) from scoped),
      coalesce((
        select jsonb_agg(jsonb_build_array(
          first_name || ' ' || last_name,
          case bucket_type when 'general_annual' then 'General Annual' when 'alr_dementia' then 'ALF Dementia (§2800.69)' when 'sdcu_dementia' then 'Secured Dementia Unit (§2600.236)' else bucket_type end,
          training_year::text,
          required_hours::text,
          completed_hours::text,
          greatest(0, required_hours - completed_hours)::text,
          status
        ) order by training_year desc, last_name, first_name, bucket_type, id)
        from paged
      ), '[]'::jsonb)
      into v_total, v_compliant, v_total_employees, v_rows;
    v_headers := '["Employee","Bucket","Year","Required Hours","Completed Hours","Remaining","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Staff Tracked', 'value', v_total_employees),
      jsonb_build_object('label', 'Compliant Buckets', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Incomplete Buckets', 'value', v_total - v_compliant, 'variant', case when v_total - v_compliant > 0 then 'warning' else 'success' end)
    );

  elsif p_report_id = 'employee-transcript' then
    if p_employee_id is null or not exists (
      select 1
      from public.employees e
      join public.facilities f on f.id = e.facility_id and not f.is_sandbox
      where e.id = p_employee_id and not e.is_synthetic
        and (p_facility_id is null or e.facility_id = p_facility_id)
    ) then
      raise exception 'An employee in the caller scope is required for this report'
        using errcode = '22023';
    end if;

    with scoped as (
      select
        r.id,
        t.name as training_type_name,
        r.completion_date,
        r.due_date,
        r.status,
        r.trainer_name,
        r.hours,
        r.completion_method
      from public.employee_training_records r
      join public.training_types t on t.id = r.training_type_id
      where r.employee_id = p_employee_id
        and (p_date_from is null or r.due_date >= p_date_from)
        and (p_date_to is null or r.due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by due_date desc nulls last, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((select jsonb_agg(jsonb_build_array(
        training_type_name,
        coalesce(completion_date::text, ''),
        coalesce(due_date::text, ''),
        status,
        coalesce(trainer_name, ''),
        coalesce(hours::text, ''),
        replace(coalesce(completion_method, ''), '_', ' ')
      ) order by due_date desc nulls last, id) from paged), '[]'::jsonb)
      into v_total, v_rows;

    select count(*) into v_other
    from public.practicums p
    where p.employee_id = p_employee_id
      and (p_date_from is null or p.due_date >= p_date_from)
      and (p_date_to is null or p.due_date <= p_date_to);

    select jsonb_build_array(
      jsonb_build_object('label', 'Employee', 'value', e.first_name || ' ' || e.last_name),
      jsonb_build_object('label', 'Training Records', 'value', v_total),
      jsonb_build_object('label', 'Practicums', 'value', v_other)
    ) into v_summary
    from public.employees e
    where e.id = p_employee_id;
    v_headers := '["Training Type","Completion Date","Due Date","Status","Trainer","Hours","Method"]'::jsonb;

  elsif p_report_id = 'document-audit' then
    with scoped as (
      select
        d.id,
        d.file_name,
        d.document_type,
        d.created_at,
        p.first_name as uploader_first_name,
        p.last_name as uploader_last_name,
        d.uploaded_by_profile_id
      from public.training_documents d
      join public.facilities f on f.id = d.facility_id and not f.is_sandbox
      left join public.profiles p on p.id = d.uploaded_by_profile_id
      where (p_facility_id is null or d.facility_id = p_facility_id)
        and (p_date_from is null or d.created_at >= p_date_from::timestamptz)
        and (p_date_to is null or d.created_at < (p_date_to + 1)::timestamptz)
    ), paged as (
      select * from scoped
      order by created_at desc, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((select jsonb_agg(jsonb_build_array(
        file_name,
        document_type,
        case when uploaded_by_profile_id is null then '' else trim(coalesce(uploader_first_name, '') || ' ' || coalesce(uploader_last_name, '')) end,
        created_at::text
      ) order by created_at desc, id) from paged), '[]'::jsonb)
      into v_total, v_rows;

    select count(*) into v_missing
    from public.employee_training_records r
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where r.status = 'missing' and r.document_required
      and (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);

    v_headers := '["File Name","Type","Uploaded By","Created"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Documents', 'value', v_total),
      jsonb_build_object('label', 'Records Need Docs', 'value', v_missing, 'variant', case when v_missing > 0 then 'warning' else 'success' end)
    );

  elsif p_report_id = 'overdue-training' then
    with scoped as (
      select
        'training:' || r.id::text as row_id,
        e.first_name,
        e.last_name,
        e.job_title,
        'Training'::text as item_kind,
        t.name as item_name,
        r.due_date,
        r.status
      from public.employee_training_records r
      join public.employees e on e.id = r.employee_id and not e.is_synthetic
      join public.training_types t on t.id = r.training_type_id
      join public.facilities f on f.id = r.facility_id and not f.is_sandbox
      where r.status = 'expired'
        and (p_facility_id is null or r.facility_id = p_facility_id)
        and (p_date_from is null or r.due_date >= p_date_from)
        and (p_date_to is null or r.due_date <= p_date_to)
      union all
      select
        'practicum:' || p.id::text,
        e.first_name,
        e.last_name,
        e.job_title,
        'Practicum',
        'Annual Practicum ' || p.practicum_year::text,
        p.due_date,
        p.status
      from public.practicums p
      join public.employees e on e.id = p.employee_id and not e.is_synthetic
      join public.facilities f on f.id = p.facility_id and not f.is_sandbox
      where p.status = 'expired'
        and (p_facility_id is null or p.facility_id = p_facility_id)
        and (p_date_from is null or p.due_date >= p_date_from)
        and (p_date_to is null or p.due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by due_date nulls last, last_name, first_name, row_id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      coalesce((select jsonb_agg(jsonb_build_array(
        first_name || ' ' || last_name,
        coalesce(job_title, ''),
        item_kind,
        item_name,
        coalesce(due_date::text, ''),
        status
      ) order by due_date nulls last, last_name, first_name, row_id) from paged), '[]'::jsonb)
      into v_total, v_rows;
    v_headers := '["Employee","Job Title","Type","Item","Due Date","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Overdue Items', 'value', v_total, 'variant', case when v_total > 0 then 'danger' else 'success' end)
    );

  elsif p_report_id = 'credential-status' then
    with scoped as (
      select
        c.id,
        e.first_name,
        e.last_name,
        c.credential_label,
        c.credential_type,
        c.credential_number,
        c.expiration_date,
        c.status
      from public.employee_credentials c
      join public.employees e on e.id = c.employee_id and not e.is_synthetic
      join public.facilities f on f.id = c.facility_id and not f.is_sandbox
      where (p_facility_id is null or c.facility_id = p_facility_id)
        and (p_date_from is null or c.expiration_date >= p_date_from)
        and (p_date_to is null or c.expiration_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by expiration_date nulls last, last_name, first_name, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      (select count(*) from scoped where status = 'expired'),
      (select count(*) from scoped where status = 'due_soon'),
      coalesce((select jsonb_agg(jsonb_build_array(
        last_name || ', ' || first_name,
        coalesce(nullif(credential_label, ''), replace(credential_type, '_', ' ')),
        coalesce(credential_number, '—'),
        coalesce(expiration_date::text, 'No expiration'),
        status
      ) order by expiration_date nulls last, last_name, first_name, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_due_soon, v_rows;
    v_headers := '["Employee","Credential","Number","Expiration","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Credentials', 'value', v_total),
      jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Expired', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end),
      jsonb_build_object('label', 'Due Soon', 'value', v_due_soon, 'variant', case when v_due_soon > 0 then 'warning' else 'success' end)
    );

  elsif p_report_id = 'incident-log' then
    with scoped as (
      select i.id, i.occurred_at, f.name as facility_name, i.incident_type, i.severity, i.status
      from public.incidents i
      join public.facilities f on f.id = i.facility_id and not f.is_sandbox
      where (p_facility_id is null or i.facility_id = p_facility_id)
        and (p_date_from is null or i.occurred_at >= p_date_from::timestamptz)
        and (p_date_to is null or i.occurred_at < (p_date_to + 1)::timestamptz)
    ), paged as (
      select * from scoped
      order by occurred_at desc, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status <> 'closed'),
      (select count(*) from scoped where severity = 'critical'),
      coalesce((select jsonb_agg(jsonb_build_array(
        occurred_at::text,
        facility_name,
        replace(incident_type, '_', ' '),
        severity,
        status
      ) order by occurred_at desc, id) from paged), '[]'::jsonb)
      into v_total, v_other, v_expired, v_rows;
    v_headers := '["Occurred","Facility","Type","Severity","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Incidents', 'value', v_total),
      jsonb_build_object('label', 'Open', 'value', v_other, 'variant', case when v_other > 0 then 'warning' else 'success' end),
      jsonb_build_object('label', 'Critical', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end)
    );

  elsif p_report_id = 'incident-notification-register' then
    with scoped as (
      select
        n.id,
        i.occurred_at,
        i.incident_type,
        f.name as facility_name,
        n.notification_type,
        n.due_at,
        n.completed_at,
        n.notification_method,
        n.recipient,
        n.reference_number,
        n.status
      from public.incident_notifications n
      join public.incidents i on i.id = n.incident_id
      join public.facilities f on f.id = i.facility_id and not f.is_sandbox
      where (p_facility_id is null or i.facility_id = p_facility_id)
        and (p_date_from is null or n.due_at >= p_date_from::timestamptz)
        and (p_date_to is null or n.due_at < (p_date_to + 1)::timestamptz)
    ), paged as (
      select * from scoped
      order by due_at desc, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'completed'),
      (select count(*) from scoped where status = 'overdue'),
      coalesce((select jsonb_agg(jsonb_build_array(
        replace(incident_type, '_', ' ') || ' (' || occurred_at::date::text || ')',
        facility_name,
        replace(notification_type, '_', ' '),
        due_at::text,
        coalesce(completed_at::text, ''),
        coalesce(notification_method, ''),
        coalesce(recipient, ''),
        coalesce(reference_number, ''),
        status
      ) order by due_at desc, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_rows;
    v_headers := '["Incident","Facility","Notification Type","Due","Completed","Method","Recipient","Reference #","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Notifications', 'value', v_total),
      jsonb_build_object('label', 'Completed', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Overdue', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end)
    );

  elsif p_report_id = 'inspection-compliance' then
    with scoped as (
      select i.id, f.name as facility_name, i.label, i.item_type, i.next_due_date, i.status
      from public.inspection_items i
      join public.facilities f on f.id = i.facility_id and not f.is_sandbox
      where i.is_active
        and (p_facility_id is null or i.facility_id = p_facility_id)
        and (p_date_from is null or i.next_due_date >= p_date_from)
        and (p_date_to is null or i.next_due_date <= p_date_to)
    ), paged as (
      select * from scoped
      order by next_due_date nulls last, facility_name, label, id
      limit v_limit offset v_offset
    )
    select
      (select count(*) from scoped),
      (select count(*) from scoped where status = 'compliant'),
      (select count(*) from scoped where status = 'expired'),
      (select count(*) from scoped where status = 'due_soon'),
      coalesce((select jsonb_agg(jsonb_build_array(
        facility_name,
        label,
        replace(item_type, '_', ' '),
        coalesce(next_due_date::text, '—'),
        status
      ) order by next_due_date nulls last, facility_name, label, id) from paged), '[]'::jsonb)
      into v_total, v_compliant, v_expired, v_due_soon, v_rows;
    v_headers := '["Facility","Item","Type","Next Due","Status"]'::jsonb;
    v_summary := jsonb_build_array(
      jsonb_build_object('label', 'Total Items', 'value', v_total),
      jsonb_build_object('label', 'Compliant', 'value', v_compliant, 'variant', 'success'),
      jsonb_build_object('label', 'Overdue', 'value', v_expired, 'variant', case when v_expired > 0 then 'danger' else 'success' end),
      jsonb_build_object('label', 'Due Soon', 'value', v_due_soon, 'variant', case when v_due_soon > 0 then 'warning' else 'success' end)
    );
  end if;

  return jsonb_build_object(
    'headers', v_headers,
    'rows', v_rows,
    'summaryCards', v_summary,
    'totalRows', v_total,
    'pageSize', v_limit,
    'pageOffset', v_offset,
    'hasMore', v_offset + jsonb_array_length(v_rows) < v_total,
    'generatedAt', now()
  );
end;
$function$
;

-- public.generate_resident_financial_statement
CREATE OR REPLACE FUNCTION public.generate_resident_financial_statement(p_resident_id uuid, p_period_start date, p_period_end date, p_due_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_resident public.residents%rowtype; v_account public.resident_financial_accounts%rowtype;
  v_opening numeric; v_debits numeric; v_credits numeric; v_ending numeric;
  v_delinquent numeric; v_delinquent_since date; v_snapshot jsonb; v_hash text;
  v_id uuid; v_number text; v_template uuid; v_work uuid;
begin
  v_resident := app_private.assert_resident_finance_manager(p_resident_id);
  v_account := app_private.ensure_resident_financial_account(v_resident.id);
  select * into v_account from public.resident_financial_accounts where id = v_account.id for update;
  if p_period_start is null
    or p_period_end is null
    or p_period_end < p_period_start
    or p_due_date is null
    or p_due_date < public.pa_today() then
    raise exception 'Statement period or due date is invalid' using errcode = '22023';
  end if;
  select coalesce(sum(case when entry_side='debit' then amount else -amount end),0)
    into v_opening from public.resident_financial_transactions
    where financial_account_id=v_account.id and effective_on < p_period_start;
  select coalesce(sum(amount) filter(where entry_side='debit'),0),
         coalesce(sum(amount) filter(where entry_side='credit'),0)
    into v_debits, v_credits from public.resident_financial_transactions
    where financial_account_id=v_account.id and effective_on between p_period_start and p_period_end;
  v_ending := v_opening + v_debits - v_credits;
  v_delinquent := greatest(v_opening, 0);
  if v_delinquent > 0 then
    select coalesce(min(due_date) filter(where balance_due > 0 and due_date < public.pa_today()), p_period_start)
      into v_delinquent_since from public.resident_financial_statements
      where financial_account_id = v_account.id;
  end if;
  v_number := 'ST-' || upper(left(replace(extensions.gen_random_uuid()::text, '-', ''), 12));
  v_snapshot := jsonb_build_object(
    'accountNumber', v_account.account_number, 'residentId', v_resident.id,
    'residentName', v_resident.first_name || ' ' || v_resident.last_name,
    'periodStart', p_period_start, 'periodEnd', p_period_end, 'dueDate', p_due_date,
    'openingBalance', v_opening, 'periodDebits', v_debits, 'periodCredits', v_credits,
    'endingBalance', v_ending, 'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'effectiveOn', t.effective_on, 'kind', t.transaction_kind,
        'side', t.entry_side, 'category', t.category, 'amount', t.amount,
        'memo', t.memo, 'paymentReference', t.payment_reference,
        'adjustsTransactionId', t.adjusts_transaction_id
      ) order by t.effective_on, t.posted_at, t.id)
      from public.resident_financial_transactions t where t.financial_account_id=v_account.id
        and t.effective_on between p_period_start and p_period_end
    ), '[]'::jsonb)
  );
  v_hash := encode(extensions.digest(convert_to(v_snapshot::text, 'utf8'), 'sha256'), 'hex');
  insert into public.resident_financial_statements(
    organization_id, facility_id, resident_id, financial_account_id,
    statement_number, period_start, period_end, due_date,
    opening_balance, period_debits, period_credits, ending_balance,
    balance_due, delinquent_amount, delinquent_since, snapshot, snapshot_sha256, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, v_account.id,
    v_number, p_period_start, p_period_end, p_due_date,
    v_opening, v_debits, v_credits, v_ending, greatest(v_ending,0),
    v_delinquent, v_delinquent_since, v_snapshot, v_hash, auth.uid()
  ) returning id into v_id;
  if v_delinquent > 0 then
    select id into v_template from public.work_item_templates
      where (organization_id=v_resident.organization_id or organization_id is null)
        and template_key='resident_finance.delinquency' and is_active
      order by organization_id nulls last limit 1;
    insert into public.work_items(
      organization_id, facility_id, template_id, source_type, source_id,
      deduplication_key, title, description, priority, due_at, created_by
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_template, 'resident_finance', v_id,
      'resident-finance-delinquency:' || v_id,
      'Resident account delinquency: ' || v_resident.first_name || ' ' || v_resident.last_name,
      'Review the prior unpaid balance shown on statement ' || v_number,
      'high', p_due_date::timestamptz, auth.uid()
    ) returning id into v_work;
    insert into public.work_item_history(
      organization_id, facility_id, work_item_id, event_type,
      resulting_state, actor_profile_id, reason
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_work,
      'created', 'open', auth.uid(), 'Resident statement carried a delinquent balance'
    );
  end if;
  insert into public.resident_financial_history(
    organization_id, facility_id, resident_id, event_type, related_record_id,
    summary, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'statement_generated', v_id, 'Immutable resident statement generated',
    jsonb_build_object('statementNumber', v_number, 'snapshotSha256', v_hash,
      'balanceDue', greatest(v_ending,0), 'delinquentAmount', v_delinquent,
      'workItemId', v_work), auth.uid()
  );
  return v_id;
end
$function$
;

-- public.get_admissions_intelligence_snapshot
CREATE OR REPLACE FUNCTION public.get_admissions_intelligence_snapshot(p_facility_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org uuid := public.current_org_id();
begin
  if not public.is_platform_admin() and (v_org is null or public.current_role() not in ('org_admin', 'facility_manager', 'auditor')) then
    raise exception 'Admissions intelligence access denied' using errcode = '42501';
  end if;
  if p_facility_id is not null and not public.is_platform_admin() and not public.is_assigned_to_facility(p_facility_id) then
    raise exception 'Facility is outside caller scope' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pipeline', jsonb_build_object(
      'active', (select count(*) from public.admission_prospects p where p.organization_id = v_org and (p_facility_id is null or p.facility_id = p_facility_id) and p.stage in ('prospect','applicant','approved','waitlisted','reserved')),
      'admitted30Days', (select count(*) from public.admission_prospects p where p.organization_id = v_org and (p_facility_id is null or p.facility_id = p_facility_id) and p.stage = 'admitted' and p.updated_at >= now() - interval '30 days'),
      'lost30Days', (select count(*) from public.admission_prospects p where p.organization_id = v_org and (p_facility_id is null or p.facility_id = p_facility_id) and p.stage in ('lost','declined') and p.updated_at >= now() - interval '30 days'),
      'expected30Days', (select count(*) from public.admission_prospects p where p.organization_id = v_org and (p_facility_id is null or p.facility_id = p_facility_id) and p.expected_move_in_date between public.pa_today() and public.pa_today() + 30)
    ),
    'occupancy', jsonb_build_object(
      'occupiedBeds', (select count(*) from public.facility_beds b where b.organization_id = v_org and (p_facility_id is null or b.facility_id = p_facility_id) and b.status = 'occupied'),
      'availableBeds', (select count(*) from public.facility_beds b where b.organization_id = v_org and (p_facility_id is null or b.facility_id = p_facility_id) and b.status = 'available'),
      'reservedBeds', (select count(*) from public.facility_beds b where b.organization_id = v_org and (p_facility_id is null or b.facility_id = p_facility_id) and b.status = 'reserved')
    ),
    'referralSources', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.admitted desc, x.inquiries desc) from (
        select coalesce(r.name, 'Direct inquiry') as source,
          count(*) as inquiries,
          count(*) filter (where p.stage = 'admitted') as admitted,
          round(100.0 * count(*) filter (where p.stage = 'admitted') / nullif(count(*), 0), 1) as conversion_percent
        from public.admission_prospects p
        left join public.referral_sources r on r.id = p.referral_source_id
        where p.organization_id = v_org and (p_facility_id is null or p.facility_id = p_facility_id)
        group by coalesce(r.name, 'Direct inquiry')
        order by admitted desc, inquiries desc limit 10
      ) x
    ), '[]'::jsonb),
    'generatedAt', now()
  );
end;
$function$
;

-- public.get_citation_governance_status
CREATE OR REPLACE FUNCTION public.get_citation_governance_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_reverify_days constant integer := 365;
begin
  return jsonb_build_object(
    'total', (select count(*) from public.dhs_citation_topics),
    'byStatus', coalesce((
      select jsonb_object_agg(status, count)
      from (
        select verification_status as status, count(*) as count
        from public.dhs_citation_topics group by verification_status
      ) s
    ), '{}'::jsonb),
    -- The number that matters: citations a user can be shown that nobody has checked.
    'displayableUnverified', (
      select count(*) from public.dhs_citation_topics
      where citation_ref is not null and verification_status <> 'verified'
    ),
    'reverificationIntervalDays', v_reverify_days,
    'staleVerified', (
      select count(*) from public.dhs_citation_topics
      where verification_status = 'verified'
        and verified_on is not null
        and verified_on < public.pa_today() - v_reverify_days
    ),
    'needsAttention', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'category', t.category,
        'citationRef', t.citation_ref,
        'status', t.verification_status,
        'verifiedOn', t.verified_on,
        'supersededByRef', t.superseded_by_ref
      ) order by t.sort_order)
      from public.dhs_citation_topics t
      where t.citation_ref is not null
        and (t.verification_status <> 'verified'
             or (t.verified_on is not null and t.verified_on < public.pa_today() - v_reverify_days))
    ), '[]'::jsonb)
  );
end $function$
;

-- public.get_facility_occupancy_board
CREATE OR REPLACE FUNCTION public.get_facility_occupancy_board(p_facility_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_facility public.facilities%rowtype;
  v_license public.facility_licenses%rowtype;
  v_buildings jsonb;
  v_rooms jsonb;
  v_census jsonb;
  v_reconciliation jsonb;
begin
  -- security invoker: the facilities, beds and residents RLS policies decide visibility.
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;

  -- The licence in force today. 'provisional' and 'conditional' still permit operation at a stated
  -- capacity, so they count; suspended, expired and closed do not.
  select * into v_license
  from public.facility_licenses l
  where l.facility_id = v_facility.id
    and l.status in ('active', 'provisional', 'conditional')
    and l.effective_from <= public.pa_today()
    and (l.expires_on is null or l.expires_on >= public.pa_today())
  order by l.effective_from desc
  limit 1;

  select jsonb_build_object(
    'activeResidents', count(*) filter (where r.status = 'active'),
    'temporarilyOut', count(*) filter (where r.status = 'temporarily_out'),
    'hospitalLeave', count(*) filter (where r.status = 'hospital_leave'),
    -- Residents in the building tonight. Someone on hospital leave still holds their bed, so they
    -- are counted against capacity; a discharged resident is not.
    'occupyingABed', count(*) filter (where r.status in ('active', 'temporarily_out', 'hospital_leave'))
  ) into v_census
  from public.residents r
  where r.facility_id = v_facility.id;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.name), '[]'::jsonb)
    into v_buildings
  from (
    select
      fb.id, fb.name,
      fb.licensed_capacity as building_allocated_capacity,
      count(bed.id)::integer as beds,
      count(bed.id) filter (where bed.status = 'available')::integer as available,
      count(bed.id) filter (where bed.status = 'reserved')::integer as reserved,
      count(bed.id) filter (where bed.status = 'occupied')::integer as occupied,
      count(bed.id) filter (where bed.status = 'maintenance_hold')::integer as maintenance_hold,
      count(bed.id) filter (where bed.status = 'temporarily_unavailable')::integer as temporarily_unavailable,
      count(bed.id) filter (
        where bed.status = 'occupied' and res.status in ('temporarily_out', 'hospital_leave')
      )::integer as occupied_but_away
    from public.facility_buildings fb
    left join public.facility_rooms fr on fr.building_id = fb.id and fr.is_active
    left join public.facility_beds bed on bed.room_id = fr.id
    left join public.residents res on res.id = bed.occupied_by_resident_id
    where fb.facility_id = v_facility.id and fb.is_active
    group by fb.id, fb.name, fb.licensed_capacity
  ) b;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.building_name, r.room_number), '[]'::jsonb)
    into v_rooms
  from (
    select
      fr.id, fr.room_number, fr.room_type, fr.gender_restriction,
      fb.name as building_name,
      ru.name as unit_name,
      coalesce(ru.secured, false) as secured,
      count(bed.id)::integer as beds,
      count(bed.id) filter (where bed.status = 'available')::integer as available_beds,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', bed.id,
        'label', bed.bed_label,
        'status', bed.status,
        'holdReason', bed.hold_reason,
        'expectedVacancyDate', bed.expected_vacancy_date,
        'residentId', bed.occupied_by_resident_id,
        'residentName', case when res.id is null then null
          else btrim(res.first_name || ' ' || res.last_name) end,
        'residentStatus', res.status,
        'reservedForProspectId', bed.reserved_for_prospect_id
      ) order by bed.bed_label) filter (where bed.id is not null), '[]'::jsonb) as bed_details
    from public.facility_rooms fr
    join public.facility_buildings fb on fb.id = fr.building_id
    left join public.residential_units ru on ru.id = fr.residential_unit_id
    left join public.facility_beds bed on bed.room_id = fr.id
    left join public.residents res on res.id = bed.occupied_by_resident_id
    where fr.facility_id = v_facility.id and fr.is_active
    group by fr.id, fr.room_number, fr.room_type, fr.gender_restriction, fb.name, ru.name, ru.secured
  ) r;

  -- The reconciliation the exit gate asks for. Both directions are reported: a resident with no bed
  -- and a bed pointing at somebody who is not resident are different problems with different fixes.
  select jsonb_build_object(
    'residentsWithoutABed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'residentId', res.id,
        'name', btrim(res.first_name || ' ' || res.last_name),
        'status', res.status
      ) order by res.last_name, res.first_name)
      from public.residents res
      where res.facility_id = v_facility.id
        and res.status in ('active', 'temporarily_out', 'hospital_leave')
        and not exists (
          select 1 from public.facility_beds bed where bed.occupied_by_resident_id = res.id
        )
    ), '[]'::jsonb),
    'bedsHeldByNonResidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bedId', bed.id,
        'bedLabel', bed.bed_label,
        'residentId', res.id,
        'residentStatus', res.status
      ) order by bed.bed_label)
      from public.facility_beds bed
      join public.residents res on res.id = bed.occupied_by_resident_id
      where bed.facility_id = v_facility.id
        and res.status in ('discharged', 'deceased')
    ), '[]'::jsonb)
  ) into v_reconciliation;

  return jsonb_build_object(
    'facilityId', v_facility.id,
    'facilityName', v_facility.name,
    'license', case when v_license.id is null then null else jsonb_build_object(
      'id', v_license.id,
      'licenseNumber', v_license.license_number,
      'status', v_license.status,
      'expiresOn', v_license.expires_on,
      'licensedCapacity', v_license.licensed_capacity
    ) end,
    -- Null, never a bed count. A facility with no licence on file must see that it has no licensed
    -- capacity recorded, not a physical number wearing a regulatory label.
    'licensedCapacity', v_license.licensed_capacity,
    'licensedCapacitySource', case
      when v_license.id is null then 'no_active_license_on_file'
      when v_license.licensed_capacity is null then 'license_records_no_capacity'
      else 'facility_license'
    end,
    'census', v_census,
    'buildings', v_buildings,
    'rooms', v_rooms,
    'reconciliation', v_reconciliation,
    'generatedAt', now()
  );
end $function$
;

-- public.get_my_shift_workspace
CREATE OR REPLACE FUNCTION public.get_my_shift_workspace()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_employee public.employees%rowtype; v_shift jsonb; v_result jsonb;
begin
  select * into v_employee from public.employees where profile_id = auth.uid() limit 1;
  if not found then return jsonb_build_object('employee', null, 'currentOrNextShift', null, 'handoffItems', '[]'::jsonb, 'residentServiceTasks', '[]'::jsonb, 'workItems', '[]'::jsonb, 'notifications', '[]'::jsonb, 'openShiftOffers', '[]'::jsonb, 'timeOffRequests', '[]'::jsonb, 'upcomingShifts', '[]'::jsonb); end if;
  select to_jsonb(s) into v_shift from (
    select sa.*, f.name as facility_name, u.name as unit_name, sd.name as shift_name
    from public.shift_assignments sa join public.facilities f on f.id=sa.facility_id left join public.facility_units u on u.id=sa.unit_id left join public.shift_definitions sd on sd.id=sa.shift_definition_id
    where sa.employee_id=v_employee.id
      and (sa.shift_date + sa.end_time + case when sa.end_time <= sa.start_time then interval '1 day' else interval '0' end) >= localtimestamp
      and sa.status in ('scheduled','confirmed') order by sa.shift_date, sa.start_time limit 1
  ) s;
  select jsonb_build_object(
    'employee', jsonb_build_object('id', v_employee.id, 'name', btrim(v_employee.first_name || ' ' || v_employee.last_name), 'status', v_employee.status),
    'currentOrNextShift', v_shift,
    'handoffItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.priority desc, x.created_at desc) from (select id, category, priority, narrative, requires_acknowledgement, status, created_at, linked_work_item_id from public.shift_report_entries where facility_id = coalesce((v_shift->>'facility_id')::uuid, v_employee.facility_id) and status in ('open','carried_forward') limit 20) x), '[]'::jsonb),
    'residentServiceTasks', coalesce((select jsonb_agg(to_jsonb(x) order by x.scheduled_start) from (select id, resident_id, service_name, scheduled_start, scheduled_end, status from public.resident_service_task_instances where assigned_employee_id = v_employee.id and scheduled_start >= now() - interval '4 hours' and scheduled_start < now() + interval '16 hours' and status not in ('completed','superseded') limit 20) x), '[]'::jsonb),
    'workItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.due_at) from (select id, title, priority, due_at, state, source_type, source_id from public.work_items where owner_profile_id = auth.uid() and state not in ('closed','canceled') order by due_at limit 20) x), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id, notification_type, title, body, link, created_at from public.notifications where profile_id=auth.uid() and read_at is null order by created_at desc limit 10) x), '[]'::jsonb),
    'openShiftOffers', coalesce((select jsonb_agg(to_jsonb(x) order by x.shift_date, x.start_time) from (select id, facility_id, shift_date, start_time, end_time, status from public.open_shift_opportunities where organization_id=v_employee.organization_id and status='open' and shift_date >= public.pa_today() order by shift_date, start_time limit 10) x), '[]'::jsonb),
    'timeOffRequests', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from (select id, request_type, starts_at, ends_at, status, absence_category from public.workforce_time_off_requests where employee_id=v_employee.id order by starts_at desc limit 10) x), '[]'::jsonb),
    'upcomingShifts', coalesce((select jsonb_agg(to_jsonb(x) order by x.shift_date, x.start_time) from (select sa.id, sa.shift_date, sa.start_time, sa.end_time, sa.status, f.name as facility_name, u.name as unit_name, sd.name as shift_name from public.shift_assignments sa join public.facilities f on f.id=sa.facility_id left join public.facility_units u on u.id=sa.unit_id left join public.shift_definitions sd on sd.id=sa.shift_definition_id where sa.employee_id=v_employee.id and sa.shift_date >= public.pa_today() order by sa.shift_date, sa.start_time limit 7) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$
;

-- public.get_operations_command_center
CREATE OR REPLACE FUNCTION public.get_operations_command_center(p_facility_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with scoped_facility as (
  select f.id, f.organization_id, f.name, f.facility_type
  from public.facilities f
  where f.id = p_facility_id
    and (
      (select public.is_platform_admin())
      or (
        f.organization_id = (select public.current_org_id())
        and (
          (select public.current_role()) in ('org_admin', 'auditor')
          or (
            (select public.current_role()) = 'facility_manager'
            and public.is_assigned_to_facility(f.id)
          )
        )
      )
    )
),
open_work as (
  select w.*
  from public.work_items w
  join scoped_facility f on f.id = w.facility_id
  where w.state not in ('closed', 'canceled')
),
work_summary as (
  select
    count(*)::integer as open_count,
    count(*) filter (where priority = 'urgent')::integer as urgent_count,
    count(*) filter (where due_at < now())::integer as overdue_count,
    count(*) filter (where owner_profile_id is null)::integer as unassigned_count,
    count(*) filter (where state = 'pending_approval')::integer as pending_approval_count
  from open_work
),
signal_summary as (
  select
    (select count(*)::integer from public.employee_training_records r join scoped_facility f on f.id = r.facility_id where r.status in ('missing','expired'))
      + (select count(*)::integer from public.employee_credentials c join scoped_facility f on f.id = c.facility_id where c.status in ('missing','expired')) as workforce_gaps,
    (select count(*)::integer from public.resident_compliance_items r join scoped_facility f on f.id = r.facility_id where r.status in ('missing','due_soon','expired')) as resident_readiness_gaps,
    (select count(*)::integer from public.incidents i join scoped_facility f on f.id = i.facility_id where i.incident_type = 'medication_error' and i.status <> 'closed') as medication_follow_ups,
    (select count(*)::integer from public.incidents i join scoped_facility f on f.id = i.facility_id where i.status <> 'closed')
      + (select count(*)::integer from public.complaints c join scoped_facility f on f.id = c.facility_id where c.status <> 'closed') as incident_complaint_open,
    (select count(*)::integer from public.corrective_actions c join scoped_facility f on f.id = c.facility_id where c.status not in ('completed','cancelled') and c.due_date < public.pa_today()) as overdue_corrective_actions,
    (select count(*)::integer from public.policy_attestations p join scoped_facility f on f.id = p.facility_id where p.status = 'pending' and p.due_date < public.pa_today()) as overdue_policy_attestations,
    (select count(*)::integer from public.emergency_events e join scoped_facility f on f.id = e.facility_id where e.status in ('active','stabilized')) as active_emergency_events,
    (select count(*)::integer
       from public.emergency_event_residents r
       join public.emergency_events e on e.id = r.emergency_event_id
       join scoped_facility f on f.id = e.facility_id
      where e.status in ('active','stabilized') and r.accountability_status in ('expected','unaccounted'))
      + (select count(*)::integer
           from public.emergency_event_staff s
           join public.emergency_events e on e.id = s.emergency_event_id
           join scoped_facility f on f.id = e.facility_id
          where e.status in ('active','stabilized') and s.accountability_status in ('expected','unaccounted')) as emergency_unaccounted,
    (select count(*)::integer from public.work_orders w join scoped_facility f on f.id = w.facility_id where w.status not in ('verified','canceled')) as open_work_orders,
    (select count(*)::integer from public.work_orders w join scoped_facility f on f.id = w.facility_id where w.status not in ('verified','canceled') and (w.priority = 'emergency' or w.safety_risk in ('high','immediate_danger'))) as high_risk_work_orders,
    (select count(*)::integer from public.residents r join scoped_facility f on f.id = r.facility_id where r.status = 'active') as active_residents
),
source_breakdown as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceType', grouped.source_type,
    'openCount', grouped.open_count,
    'urgentCount', grouped.urgent_count,
    'overdueCount', grouped.overdue_count,
    'unassignedCount', grouped.unassigned_count
  ) order by grouped.overdue_count desc, grouped.urgent_count desc, grouped.open_count desc, grouped.source_type), '[]'::jsonb) as value
  from (
    select source_type,
      count(*)::integer as open_count,
      count(*) filter (where priority = 'urgent')::integer as urgent_count,
      count(*) filter (where due_at < now())::integer as overdue_count,
      count(*) filter (where owner_profile_id is null)::integer as unassigned_count
    from open_work
    group by source_type
  ) grouped
),
attention_items as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ranked.id,
    'title', ranked.title,
    'sourceType', ranked.source_type,
    'state', ranked.state,
    'priority', ranked.priority,
    'dueAt', ranked.due_at,
    'ownerProfileId', ranked.owner_profile_id
  ) order by ranked.rank_group, ranked.due_at, ranked.created_at), '[]'::jsonb) as value
  from (
    select w.*,
      case
        when w.priority = 'urgent' then 0
        when w.due_at < now() then 1
        when w.owner_profile_id is null then 2
        else 3
      end as rank_group
    from open_work w
    order by rank_group, w.due_at, w.created_at
    limit 12
  ) ranked
)
select jsonb_build_object(
  'facility', jsonb_build_object(
    'id', f.id,
    'organizationId', f.organization_id,
    'name', f.name,
    'facilityType', f.facility_type
  ),
  'signals', jsonb_build_object(
    'workforceGaps', s.workforce_gaps,
    'residentReadinessGaps', s.resident_readiness_gaps,
    'medicationFollowUps', s.medication_follow_ups,
    'incidentComplaintOpen', s.incident_complaint_open,
    'overdueCorrectiveActions', s.overdue_corrective_actions,
    'overduePolicyAttestations', s.overdue_policy_attestations,
    'activeEmergencyEvents', s.active_emergency_events,
    'emergencyUnaccounted', s.emergency_unaccounted,
    'openWorkOrders', s.open_work_orders,
    'highRiskWorkOrders', s.high_risk_work_orders,
    'activeResidents', s.active_residents
  ),
  'workQueue', jsonb_build_object(
    'openCount', w.open_count,
    'urgentCount', w.urgent_count,
    'overdueCount', w.overdue_count,
    'unassignedCount', w.unassigned_count,
    'pendingApprovalCount', w.pending_approval_count
  ),
  'sourceBreakdown', b.value,
  'attentionItems', a.value,
  'generatedAt', now()
)
from scoped_facility f
cross join work_summary w
cross join signal_summary s
cross join source_breakdown b
cross join attention_items a;
$function$
;

-- public.get_org_dashboard_summary
CREATE OR REPLACE FUNCTION public.get_org_dashboard_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with current_training as (
  select distinct on (employee_id, training_type_id)
    id, facility_id, employee_id, training_type_id, status, due_date, document_required
  from public.employee_training_records
  -- Date ordering mirrors the app's selectCurrentTrainingRecords. The trailing
  -- (status = 'missing'), id tie-break matters when the rulepack engine's
  -- auto-instantiated 'missing' placeholder ties a real record on every date
  -- (e.g. rows created in the same transaction): the real record must win, and
  -- the pick must be deterministic.
  order by employee_id, training_type_id,
    due_date desc nulls last, completion_date desc nulls last, created_at desc,
    (status = 'missing'), id
),
current_practicums as (
  select distinct on (employee_id) facility_id, status, due_date
  from public.practicums
  -- The latest year is the live obligation. Within that year a row with actual
  -- completion evidence supersedes the engine's auto-instantiated 'missing'
  -- placeholder (save_practicum can insert a completed row alongside it), so
  -- completion_date outranks due_date here; the same missing-last + id
  -- tie-break keeps full-tie picks correct and deterministic.
  order by employee_id, practicum_year desc,
    completion_date desc nulls last, due_date desc nulls last, created_at desc,
    (status = 'missing'), id
),
tracked as (
  select facility_id, status, due_date
  from current_training
  where status in ('compliant', 'due_soon', 'expired', 'missing')
  union all
  select facility_id, status, due_date
  from current_practicums
  where status in ('compliant', 'due_soon', 'expired', 'missing')
),
compliance as (
  select
    count(*) filter (where status = 'compliant') as compliant,
    count(*) filter (where status = 'due_soon') as due_soon,
    count(*) filter (where status = 'due_soon' and due_date is not null and due_date <= public.pa_today() + 30) as due_soon_30,
    count(*) filter (where status = 'due_soon' and due_date is not null and due_date <= public.pa_today() + 90) as due_soon_90,
    count(*) filter (where status = 'expired') as expired,
    count(*) filter (where status = 'missing') as missing,
    count(*) as total
  from tracked
),
facility_rollup as (
  select facility_id,
    count(*) as relevant,
    count(*) filter (where status = 'compliant') as compliant
  from tracked
  group by facility_id
),
staff as (
  select
    count(*) filter (where status = 'active') as active_employees,
    count(*) filter (where status = 'active' and administers_medications) as med_admin
  from public.employees
),
trainer_due as (
  select count(*) as trainers_due
  from public.employees e
  where e.status = 'active'
    and e.trainer_status
    and exists (
      select 1
      from current_training r
      join public.training_types tt on tt.id = r.training_type_id
      where r.employee_id = e.id
        and r.status in ('due_soon', 'expired')
        and tt.applies_to_trainers
    )
),
open_alerts as (
  select
    count(*) as open_count,
    count(*) filter (where severity = 'critical') as critical_count
  from public.alerts
  where status = 'open'
),
upload_counts as (
  select count(*) as recent_count
  from public.training_documents
  where created_at >= now() - interval '14 days'
)
select jsonb_build_object(
  'compliance', jsonb_build_object(
    'compliantCount', c.compliant,
    'dueSoonCount', c.due_soon,
    'dueSoon30Count', c.due_soon_30,
    'dueSoon90Count', c.due_soon_90,
    'expiredCount', c.expired,
    'missingCount', c.missing,
    'missingDocumentCount', (
      select count(*) from current_training
      where status = 'missing' and document_required
    ),
    'totalTrackedCount', c.total,
    'compliancePercentage', case when c.total > 0 then round(c.compliant * 100.0 / c.total) else 100 end
  ),
  'staff', jsonb_build_object(
    'totalEmployees', s.active_employees,
    'totalMedAdminStaff', s.med_admin,
    'trainersDueForRecert', t.trainers_due
  ),
  'alerts', jsonb_build_object(
    'openCount', a.open_count,
    'criticalCount', a.critical_count,
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'message', x.message, 'severity', x.severity
      )), '[]'::jsonb)
      from (
        select id, title, message, severity
        from public.alerts
        where status = 'open'
        order by created_at desc
        limit 4
      ) x
    )
  ),
  'uploads', jsonb_build_object(
    'recentCount', u.recent_count,
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'fileName', x.file_name, 'documentType', x.document_type, 'createdAt', x.created_at
      )), '[]'::jsonb)
      from (
        select id, file_name, document_type, created_at
        from public.training_documents
        where created_at >= now() - interval '14 days'
        order by created_at desc
        limit 5
      ) x
    )
  ),
  'facilities', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'name', f.name,
      'facilityType', f.facility_type,
      'licenseNumber', f.license_number,
      'isActive', f.is_active,
      'complianceScore', case
        when coalesce(fr.relevant, 0) > 0 then round(fr.compliant * 100.0 / fr.relevant)
        else 100
      end
    ) order by f.name), '[]'::jsonb)
    from public.facilities f
    left join facility_rollup fr on fr.facility_id = f.id
  ),
  'generatedAt', now()
)
from compliance c, staff s, trainer_due t, open_alerts a, upload_counts u;
$function$
;

-- public.get_resident_care_delivery_analytics
CREATE OR REPLACE FUNCTION public.get_resident_care_delivery_analytics(p_facility_id uuid, p_from date, p_through date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_fac public.facilities%rowtype;
begin
  select * into v_fac from public.facilities where id=p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  -- coalesce(..., false): current_role()/current_org_id() are NULL for a deactivated profile, and
  -- `not NULL` is NULL, so without this the guard fails open for exactly that caller.
  if not coalesce(
    coalesce(auth.jwt()->>'role','')='service_role'
    or public.is_platform_admin()
    or (public.current_org_id()=v_fac.organization_id
        and (public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(v_fac.id))),
    false
  ) then raise exception 'Analytics outside caller scope' using errcode='42501'; end if;
  return jsonb_build_object(
    'scope', jsonb_build_object('organizationId',v_fac.organization_id,'facilityId',v_fac.id,'from',p_from,'through',p_through,'dateBasis','scheduled_start / event timestamps'),
    'serviceCompletion', jsonb_build_object('numerator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status in ('completed','completed_late','completed_by_other')),'denominator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status <> 'superseded'),'definition','Completed service tasks divided by non-superseded scheduled service tasks.'),
    'serviceExceptions', jsonb_build_object('count',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status in ('resident_refused','resident_unavailable','not_completed','completed_late')),'definition','Service tasks recorded with exception statuses.'),
    'repeatedRefusals', jsonb_build_object('count',(select count(*) from (select resident_id, service_name from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status='resident_refused' group by resident_id, service_name having count(*) >= 2) s),'definition','Resident/service pairs with two or more refusals in the reporting period.'),
    'changeOfConditionFrequency', jsonb_build_object('count',(select count(*) from public.resident_change_events c where c.facility_id=v_fac.id and c.identified_at::date between p_from and p_through),'definition','Change-of-condition events identified in the reporting period.'),
    'planReviewTimeliness', jsonb_build_object('overdue',(select count(*) from public.resident_support_plans p where p.facility_id=v_fac.id and p.state='active' and p.review_due_date < public.pa_today()),'definition','Support plans in force with review due dates before today.'),
    'dmeInspectionStatus', jsonb_build_object('due',(select count(*) from public.resident_dme_items d where d.facility_id=v_fac.id and d.status in ('in_use','needs_repair') and d.inspection_frequency_days is not null and not exists (select 1 from public.resident_dme_history h where h.dme_item_id=d.id and h.event_type='inspected' and h.occurred_at >= now() - (d.inspection_frequency_days || ' days')::interval)),'definition','In-use DME items without an inspection recorded inside their configured frequency window.'),
    'hospitalReturnsOpenFollowUp', jsonb_build_object('count',(select count(*) from public.hospital_transfer_episodes h left join public.work_items w on w.id=h.return_work_item_id where h.facility_id=v_fac.id and h.return_time::date between p_from and p_through and h.status='returned' and coalesce(w.state,'open') <> 'closed'),'definition','Returned transfer episodes whose generated follow-up work is not closed.')
  );
end $function$
;

-- public.get_resident_care_header
CREATE OR REPLACE FUNCTION public.get_resident_care_header(p_resident_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_resident public.residents%rowtype;
  v_facility public.facilities%rowtype;
  v_diet public.resident_dietary_profiles%rowtype;
  v_hospital public.hospital_transfer_episodes%rowtype;
  v_plan public.resident_support_plans%rowtype;
  v_pending public.resident_support_plans%rowtype;
  v_assessment_at date;
  v_assessment_label text;
  v_hospital_state text;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then
    raise exception 'Resident was not found or is outside caller scope' using errcode = 'P0002';
  end if;

  select * into v_facility from public.facilities where id = v_resident.facility_id;

  select * into v_diet from public.resident_dietary_profiles d
    where d.resident_id = v_resident.id
    order by d.effective_date desc, d.version desc limit 1;

  select * into v_hospital from public.hospital_transfer_episodes h
    where h.resident_id = v_resident.id and h.status <> 'canceled'
    order by h.transfer_time desc limit 1;

  select * into v_plan from public.resident_support_plans p
    where p.resident_id = v_resident.id
    order by (p.state = 'active') desc, p.version_number desc limit 1;

  -- The stalled one. The ordering above prefers the ACTIVE plan, which is right for "the plan in
  -- force" and is exactly why a newer approved-but-overdue plan was invisible on this surface.
  select * into v_pending from public.resident_support_plans p
    where p.resident_id = v_resident.id
      and p.state = 'approved'
      and p.effective_date is not null
      and p.effective_date <= public.pa_today()
    order by p.version_number desc limit 1;

  select c.completed_date,
         case c.item_type
           when 'preadmission_screening' then 'Preadmission screening'
           when 'initial_assessment_15day' then 'Initial assessment'
           when 'annual_reassessment' then 'Annual reassessment'
           when 'significant_change_reassessment' then 'Significant change reassessment'
           else c.item_type
         end
    into v_assessment_at, v_assessment_label
    from public.resident_compliance_items c
    where c.resident_id = v_resident.id
      and c.completed_date is not null
      and c.item_type in (
        'preadmission_screening', 'initial_assessment_15day',
        'annual_reassessment', 'significant_change_reassessment'
      )
    order by c.completed_date desc limit 1;

  if v_assessment_at is null then
    select f.finalized_at::date, 'Digital ' || f.form_type || ' (' || f.reason || ')'
      into v_assessment_at, v_assessment_label
      from public.resident_assessment_forms f
      where f.resident_id = v_resident.id and f.status = 'finalized' and f.finalized_at is not null
      order by f.finalized_at desc limit 1;
  end if;

  v_hospital_state := case
    when v_hospital.id is null then 'in_facility'
    when v_hospital.status = 'out' then 'out_at_hospital'
    when v_hospital.status = 'returned'
      and v_hospital.return_time >= now() - interval '30 days'
      and (
        v_hospital.medication_reconciliation_status = 'pending'
        or v_hospital.changed_order_ack_status = 'pending_review'
      ) then 'returned_reconciliation_incomplete'
    else 'in_facility'
  end;

  return jsonb_build_object(
    'generatedAt', now(),
    'resident', jsonb_build_object(
      'id', v_resident.id,
      'firstName', v_resident.first_name,
      'lastName', v_resident.last_name,
      'preferredName', v_resident.preferred_name,
      'photoDocumentId', v_resident.photo_document_id,
      'room', v_resident.room,
      'status', v_resident.status,
      'admissionDate', v_resident.admission_date,
      'dischargeDate', v_resident.discharge_date,
      'hospice', v_resident.hospice,
      'sdcu', v_resident.sdcu
    ),
    'facility', case when v_facility.id is null then null else jsonb_build_object(
      'id', v_facility.id, 'name', v_facility.name, 'facilityType', v_facility.facility_type
    ) end,
    'care', jsonb_build_object(
      'levelOfCare', v_resident.level_of_care,
      'transferAssistance', v_resident.transfer_assistance,
      'ambulationStatus', v_resident.ambulation_status,
      'fallRisk', v_resident.fall_risk,
      'elopementRisk', v_resident.elopement_risk,
      'cognitiveStatus', v_resident.cognitive_status,
      'codeStatus', v_resident.code_status,
      'advanceDirectiveStatus', v_resident.advance_directive_status,
      'allergies', to_jsonb(v_resident.allergies),
      'foodAllergies', to_jsonb(v_resident.food_allergies),
      'mobilitySummary', v_resident.mobility_summary,
      'supervisionRequirements', v_resident.supervision_requirements,
      'asOf', v_resident.care_profile_reviewed_at
    ),
    'diet', case when v_diet.id is null then null else jsonb_build_object(
      'dietOrder', coalesce(v_diet.diet_order, v_diet.prescribed_diet),
      'textureConsistency', v_diet.texture_consistency,
      'liquidConsistency', v_diet.liquid_consistency,
      'asOf', v_diet.effective_date
    ) end,
    'hospital', jsonb_build_object(
      'state', v_hospital_state,
      'episodeId', case when v_hospital_state = 'in_facility' then null else v_hospital.id end,
      'destination', case when v_hospital_state = 'in_facility' then null else v_hospital.destination end,
      'since', case
        when v_hospital_state = 'out_at_hospital' then v_hospital.transfer_time
        when v_hospital_state = 'returned_reconciliation_incomplete' then v_hospital.return_time
        else null end,
      'expectedReturnAt', case when v_hospital_state = 'out_at_hospital' then v_hospital.expected_return_at else null end
    ),
    'lastAssessment', case when v_assessment_at is null then null else jsonb_build_object(
      'completedOn', v_assessment_at, 'label', v_assessment_label
    ) end,
    'supportPlan', case when v_plan.id is null then null else jsonb_build_object(
      'id', v_plan.id,
      'versionNumber', v_plan.version_number,
      'state', v_plan.state,
      'effectiveDate', v_plan.effective_date,
      'reviewDueDate', v_plan.review_due_date
    ) end,
    -- Null in the normal case: the scheduled promotion ran and nothing is overdue.
    'pendingActivation', case when v_pending.id is null then null else jsonb_build_object(
      'id', v_pending.id,
      'versionNumber', v_pending.version_number,
      'effectiveDate', v_pending.effective_date
    ) end
  );
end;
$function$
;

-- public.get_workforce_compliance_control_plane
CREATE OR REPLACE FUNCTION public.get_workforce_compliance_control_plane()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or public.current_role() is null then
    raise exception 'An active authenticated profile is required'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'people', (
        select count(*) from public.workforce_people p
        where app_private.profile_has_effective_permission(
          auth.uid(), 'workforce.lifecycle.read', 'organization', p.organization_id, now()
        ) or p.profile_id = auth.uid()
      ),
      'activeEpisodes', (
        select count(*) from public.employment_episodes e
        where e.episode_status = 'active'
          and app_private.profile_has_effective_permission(
            auth.uid(), 'workforce.lifecycle.read', 'facility', e.facility_id, now()
          )
      ),
      'openAccessSuspensions', (
        select count(*) from public.employee_access_suspensions s
        where s.effective_to is null
          and app_private.profile_has_effective_permission(
            auth.uid(), 'workforce.lifecycle.read', 'facility', s.facility_id, now()
          )
      ),
      'activeComplianceAssignments', (
        select count(*) from public.employee_compliance_profile_assignments a
        where a.effective_from <= public.pa_today()
          and (a.effective_to is null or a.effective_to > public.pa_today())
          and app_private.profile_has_effective_permission(
            auth.uid(), 'workforce.compliance.read', 'facility', a.facility_id, now()
          )
      )
    ),
    'workforceExceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'employeeId', e.employee_id, 'code', e.exception_code,
        'details', e.details, 'status', e.status, 'createdAt', e.created_at
      ) order by e.created_at)
      from public.workforce_backfill_exceptions e
      join public.employees employee on employee.id = e.employee_id
      where e.status = 'open'
        and app_private.profile_has_effective_permission(
          auth.uid(), 'workforce.lifecycle.manage', 'facility', employee.facility_id, now()
        )
    ), '[]'::jsonb),
    'complianceExceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'employeeId', e.employee_id, 'code', e.exception_code,
        'details', e.details, 'status', e.status, 'createdAt', e.created_at
      ) order by e.created_at)
      from public.compliance_profile_resolution_exceptions e
      where e.status = 'open'
        and app_private.profile_has_effective_permission(
          auth.uid(), 'workforce.compliance.manage', 'facility', e.facility_id, now()
        )
    ), '[]'::jsonb),
    'recentTransitions', coalesce((
      select jsonb_agg(to_jsonb(recent) order by recent.created_at desc)
      from (
        select e.id, e.employee_id, e.event_type, e.from_status,
          e.to_status, e.effective_on, e.reason, e.created_at
        from public.employment_lifecycle_events e
        where app_private.profile_has_effective_permission(
          auth.uid(), 'workforce.evidence.read', 'facility', e.facility_id, now()
        )
        order by e.created_at desc limit 50
      ) recent
    ), '[]'::jsonb)
  );
end;
$function$
;

-- public.get_workforce_retention_metrics
CREATE OR REPLACE FUNCTION public.get_workforce_retention_metrics(p_facility_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org uuid := public.current_org_id(); v_result jsonb;
begin
  if not (public.is_platform_admin() or public.current_role() in ('org_admin','facility_manager','auditor')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_facility_id is not null and not exists (
    select 1 from public.facilities f where f.id = p_facility_id
      and (public.is_platform_admin() or f.organization_id = v_org)
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(f.id))
  ) then raise exception 'Facility not found or outside scope' using errcode = '42501'; end if;
  with scoped as (
    select ep.*, e.job_title
    from public.employment_episodes ep join public.employees e on e.id = ep.employee_id and not e.is_synthetic
    where ep.started_on <= public.pa_today()
      and (public.is_platform_admin() or ep.organization_id = v_org)
      and (p_facility_id is null or ep.facility_id = p_facility_id)
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(ep.facility_id))
  ), roles as (
    select coalesce(job_title, 'Unspecified') as role,
      count(*) filter (where ended_on between public.pa_today() - 364 and public.pa_today())::integer as separations,
      count(*) filter (where ended_on is null or ended_on >= public.pa_today())::integer as current_headcount,
      count(*) filter (where started_on <= public.pa_today() - 364 and (ended_on is null or ended_on >= public.pa_today() - 364))::integer as starting_headcount,
      count(*) filter (where started_on between public.pa_today() - 455 and public.pa_today() - 90)::integer as ninety_day_cohort,
      count(*) filter (where started_on between public.pa_today() - 455 and public.pa_today() - 90
        and (ended_on is null or ended_on >= started_on + 90))::integer as ninety_day_retained,
      avg((least(coalesce(ended_on, public.pa_today()), public.pa_today()) - started_on)::numeric) as average_tenure_days
    from scoped group by coalesce(job_title, 'Unspecified')
  ), total as (
    select 'All roles'::text as role,
      count(*) filter (where ended_on between public.pa_today() - 364 and public.pa_today())::integer as separations,
      count(*) filter (where ended_on is null or ended_on >= public.pa_today())::integer as current_headcount,
      count(*) filter (where started_on <= public.pa_today() - 364 and (ended_on is null or ended_on >= public.pa_today() - 364))::integer as starting_headcount,
      count(*) filter (where started_on between public.pa_today() - 455 and public.pa_today() - 90)::integer as ninety_day_cohort,
      count(*) filter (where started_on between public.pa_today() - 455 and public.pa_today() - 90
        and (ended_on is null or ended_on >= started_on + 90))::integer as ninety_day_retained,
      avg((least(coalesce(ended_on, public.pa_today()), public.pa_today()) - started_on)::numeric) as average_tenure_days
    from scoped
  ), combined as (select * from total union all select * from roles)
  select jsonb_build_object('asOf', public.pa_today(), 'facilityId', p_facility_id,
    'methodology', jsonb_build_object('turnoverWindowDays',365,'retentionWindowDays',90,
      'turnoverDenominator','average of starting and current headcount'),
    'segments', coalesce(jsonb_agg(jsonb_build_object(
      'role', role, 'separations', separations, 'currentHeadcount', current_headcount,
      'annualizedTurnoverRate', round(100 * separations / nullif((starting_headcount + current_headcount)::numeric / 2, 0), 1),
      'ninetyDayCohort', ninety_day_cohort,
      'ninetyDayRetentionRate', round(100 * ninety_day_retained / nullif(ninety_day_cohort,0)::numeric, 1),
      'averageTenureDays', round(average_tenure_days, 0)
    ) order by case when role = 'All roles' then 0 else 1 end, role), '[]'::jsonb)) into v_result
  from combined;
  return v_result;
end;
$function$
;

-- public.instantiate_missing_requirements
CREATE OR REPLACE FUNCTION public.instantiate_missing_requirements(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp record;
begin
  select e.id, e.organization_id, e.facility_id, e.status, e.administers_medications, e.trainer_status,
         f.facility_type, coalesce(f.state, 'PA') as facility_state
    into v_emp
  from public.employees e
  join public.facilities f on f.id = e.facility_id
  where e.id = p_employee_id;

  if v_emp.id is null or v_emp.status <> 'active' then
    return;
  end if;

  insert into public.employee_training_records (
    organization_id,
    facility_id,
    employee_id,
    training_type_id,
    status,
    document_required
  )
  select
    v_emp.organization_id,
    v_emp.facility_id,
    v_emp.id,
    tt.id,
    case when tt.audience_verification_required then 'pending_review' else 'missing' end,
    tt.document_required
  from public.training_types tt
  where tt.is_active
    and tt.state = v_emp.facility_state
    and (tt.organization_id is null or tt.organization_id = v_emp.organization_id)
    and (tt.applies_to_facility_type = 'BOTH' or tt.applies_to_facility_type = v_emp.facility_type)
    and (coalesce(tt.applies_to_administers_meds, false) = false or v_emp.administers_medications)
    and (coalesce(tt.applies_to_trainers, false) = false or v_emp.trainer_status)
    and not exists (
      select 1
      from public.employee_training_records r
      where r.employee_id = v_emp.id
        and r.training_type_id = tt.id
    );

  if v_emp.administers_medications then
    insert into public.practicums (
      organization_id,
      facility_id,
      employee_id,
      practicum_year,
      status
    )
    select
      v_emp.organization_id,
      v_emp.facility_id,
      v_emp.id,
      extract(year from public.pa_today())::integer,
      'missing'
    where not exists (
      select 1
      from public.practicums p
      where p.employee_id = v_emp.id
        and p.practicum_year = extract(year from public.pa_today())::integer
    );
  end if;

  insert into public.employee_credentials (
    organization_id,
    facility_id,
    employee_id,
    credential_type,
    status
  )
  select
    v_emp.organization_id,
    v_emp.facility_id,
    v_emp.id,
    ct.credential_type,
    'missing'
  from (values ('act34_criminal_history'), ('tb_screening')) as ct(credential_type)
  where not exists (
    select 1
    from public.employee_credentials c
    where c.employee_id = v_emp.id
      and c.credential_type = ct.credential_type
  );
end;
$function$
;

-- public.list_shift_swap_candidates
CREATE OR REPLACE FUNCTION public.list_shift_swap_candidates(p_requester_assignment_id uuid)
 RETURNS TABLE(assignment_id uuid, employee_name text, shift_date date, start_time time without time zone, end_time time without time zone, facility_name text, unit_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_requester public.shift_assignments%rowtype;
begin
  select sa.* into v_requester
  from public.shift_assignments sa
  join public.employees e on e.id = sa.employee_id
  where sa.id = p_requester_assignment_id
    and e.profile_id = auth.uid()
    and e.status = 'active';

  if not found or v_requester.status not in ('scheduled','confirmed') or v_requester.shift_date < public.pa_today() then
    raise exception 'The requester shift is outside employee scope' using errcode = '42501';
  end if;

  return query
  select sa.id, btrim(e.first_name || ' ' || e.last_name), sa.shift_date,
    sa.start_time, sa.end_time, f.name, u.name
  from public.shift_assignments sa
  join public.employees e on e.id = sa.employee_id and e.status = 'active'
  join public.facilities f on f.id = sa.facility_id
  left join public.facility_units u on u.id = sa.unit_id
  where sa.organization_id = v_requester.organization_id
    and sa.facility_id = v_requester.facility_id
    and sa.employee_id <> v_requester.employee_id
    and sa.status in ('scheduled','confirmed')
    and sa.shift_date >= public.pa_today()
    and not exists (
      select 1 from public.shift_swap_requests r
      where r.status = 'pending'
        and (r.requester_assignment_id in (v_requester.id, sa.id)
          or r.target_assignment_id in (v_requester.id, sa.id))
    )
  order by sa.shift_date, sa.start_time, e.last_name, e.first_name
  limit 100;
end;
$function$
;

-- public.materialize_service_requirements_from_assessment_form
CREATE OR REPLACE FUNCTION public.materialize_service_requirements_from_assessment_form(p_form_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_form public.resident_assessment_forms%rowtype;
  v_effective date;
  v_entry record;
  v_count integer;
begin
  select * into v_form
  from public.resident_assessment_forms
  where id = p_form_id
  for update;
  if not found or v_form.status <> 'finalized' then
    raise exception 'Only a finalized support plan can create service requirements' using errcode = '22023';
  end if;
  v_effective := app_private.service_effective_date(v_form);

  update public.resident_service_requirements
  set status = 'superseded',
      expires_on = greatest(effective_from, v_effective - 1),
      superseded_at = now(),
      updated_at = now()
  where resident_id = v_form.resident_id
    and source_assessment_form_id <> v_form.id
    and status = 'active';

  update public.resident_service_task_instances
  set status = 'superseded', updated_at = now()
  where resident_id = v_form.resident_id
    and source_assessment_form_id <> v_form.id
    and status = 'scheduled'
    and scheduled_start::date >= v_effective;

  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section1,items}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'personal_care', v_entry.key, v_entry.value, 'degree', v_effective);
  end loop;
  for v_entry in
    select key, value from jsonb_each(jsonb_build_object(
      'supervision', coalesce(v_form.content #> '{section1,supervision}', '{}'),
      'mobility', coalesce(v_form.content #> '{section1,mobility}', '{}'),
      'medications', coalesce(v_form.content #> '{section1,medications}', '{}')
    ))
  loop
    perform app_private.insert_service_requirement(v_form, 'personal_care', v_entry.key, v_entry.value, 'simple', v_effective);
  end loop;
  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section2,sensory}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'sensory', v_entry.key, v_entry.value, 'simple', v_effective);
  end loop;
  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section3,items}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'behavioral', v_entry.key, v_entry.value, 'degree', v_effective);
  end loop;
  for v_entry in select key, value from jsonb_each(coalesce(v_form.content #> '{section4,items}', '{}')) loop
    perform app_private.insert_service_requirement(v_form, 'social', v_entry.key, v_entry.value, 'simple', v_effective);
  end loop;
  for v_entry in
    select 'physical_' || (ordinality - 1)::text as key, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section2,physicalDiagnoses}', '[]')) with ordinality
    union all
    select 'dental_' || (ordinality - 1)::text, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section2,dental}', '[]')) with ordinality
    union all
    select 'dietary_' || (ordinality - 1)::text, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section2,dietary}', '[]')) with ordinality
    union all
    select 'behavioral_' || (ordinality - 1)::text, value
    from jsonb_array_elements(coalesce(v_form.content #> '{section3,psychologicalDiagnoses}', '[]')) with ordinality
  loop
    perform app_private.insert_service_requirement(v_form, 'resident_specific', v_entry.key, v_entry.value, 'diagnosis', v_effective);
  end loop;

  select count(*)::integer into v_count
  from public.resident_service_requirements
  where source_assessment_form_id = v_form.id;
  perform public.generate_resident_service_tasks(
    greatest(public.pa_today(), v_effective),
    greatest(public.pa_today(), v_effective) + 14,
    null
  );
  return v_count;
end;
$function$
;

-- public.preview_employee_lifecycle_transition
CREATE OR REPLACE FUNCTION public.preview_employee_lifecycle_transition(p_employee_id uuid, p_transition text, p_effective_on date DEFAULT CURRENT_DATE, p_facility_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_employee public.employees%rowtype;
  v_person_id uuid;
  v_episode public.employment_episodes%rowtype;
  v_target_facility uuid;
  v_allowed boolean := true;
  v_reasons text[] := array[]::text[];
  v_target_status text;
  v_is_service boolean := coalesce(auth.jwt()->>'role', '') = 'service_role';
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then
    raise exception 'employee % not found', p_employee_id using errcode = 'P0002';
  end if;

  v_target_facility := coalesce(p_facility_id, v_employee.facility_id);
  if not v_is_service and not app_private.profile_has_effective_permission(
    auth.uid(), 'workforce.lifecycle.manage', 'facility', v_target_facility, now()
  ) then
    raise exception 'Not authorized to manage this employee lifecycle'
      using errcode = '42501';
  end if;

  if p_transition = 'transfer' and not v_is_service
     and not app_private.profile_has_effective_permission(
       auth.uid(), 'workforce.lifecycle.manage', 'facility', v_employee.facility_id, now()
     ) then
    raise exception 'Transfer requires lifecycle permission at the source facility'
      using errcode = '42501';
  end if;

  if p_transition not in (
    'hire', 'rehire', 'transfer', 'leave', 'return', 'terminate',
    'suspend_access', 'restore_access'
  ) then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'unsupported_transition');
  end if;
  if p_effective_on is null then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'effective_date_required');
  elsif p_effective_on > public.pa_today() then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'future_effective_date_not_supported');
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'reason_required');
  end if;

  if not exists (
    select 1 from public.facilities f
    where f.id = v_target_facility
      and f.organization_id = v_employee.organization_id
      and f.is_active
  ) then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'target_facility_outside_organization_or_inactive');
  end if;

  select l.person_id into v_person_id
  from public.workforce_employee_links l
  where l.employee_id = p_employee_id
  order by (l.effective_to is null) desc, l.effective_from desc
  limit 1;
  if v_person_id is null then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'workforce_person_link_missing');
  end if;

  select * into v_episode
  from public.employment_episodes e
  where e.employee_id = p_employee_id and e.episode_status = 'active';

  case p_transition
    when 'hire' then
      v_target_status := 'active';
      if v_employee.status not in ('inactive', 'terminated') or v_episode.id is not null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'hire_requires_no_active_episode');
      end if;
    when 'rehire' then
      v_target_status := 'active';
      if v_employee.status <> 'terminated' or v_episode.id is not null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'rehire_requires_terminated_employee');
      end if;
    when 'transfer' then
      v_target_status := v_employee.status;
      if v_episode.id is null or v_employee.status not in ('active', 'on_leave') then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'transfer_requires_active_episode');
      elsif v_target_facility = v_employee.facility_id then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'transfer_requires_new_facility');
      end if;
    when 'leave' then
      v_target_status := 'on_leave';
      if v_employee.status <> 'active' or v_episode.id is null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'leave_requires_active_employment');
      end if;
    when 'return' then
      v_target_status := 'active';
      if v_employee.status <> 'on_leave' or v_episode.id is null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'return_requires_leave_state');
      end if;
    when 'terminate' then
      v_target_status := 'terminated';
      if v_employee.status = 'terminated' or v_episode.id is null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'terminate_requires_active_episode');
      end if;
    when 'suspend_access' then
      v_target_status := v_employee.status;
      if v_employee.profile_id is null then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'linked_profile_required');
      elsif exists (
        select 1 from public.employee_access_suspensions s
        where s.employee_id = p_employee_id
          and s.suspension_type = 'manual' and s.effective_to is null
      ) then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'manual_access_suspension_already_open');
      end if;
    when 'restore_access' then
      v_target_status := v_employee.status;
      if v_employee.status <> 'active' then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'access_restore_requires_active_employment');
      end if;
      if not exists (
        select 1 from public.employee_access_suspensions s
        where s.employee_id = p_employee_id
          and s.suspension_type = 'manual' and s.effective_to is null
      ) then
        v_allowed := false;
        v_reasons := array_append(v_reasons, 'no_manual_access_suspension');
      end if;
    else
      v_target_status := v_employee.status;
  end case;

  if v_episode.id is not null and p_effective_on < v_episode.started_on then
    v_allowed := false;
    v_reasons := array_append(v_reasons, 'effective_date_precedes_active_episode');
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'reasons', to_jsonb(v_reasons),
    'employeeId', v_employee.id,
    'personId', v_person_id,
    'organizationId', v_employee.organization_id,
    'facilityId', v_target_facility,
    'currentStatus', v_employee.status,
    'targetStatus', v_target_status,
    'activeEpisodeId', v_episode.id,
    'effectiveOn', p_effective_on
  );
end;
$function$
;

-- public.queue_course_assignment_due_reminders
CREATE OR REPLACE FUNCTION public.queue_course_assignment_due_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  select
    ca.organization_id, e.profile_id, 'course_assignment_due_soon',
    'Start your course',
    coalesce(co.title, 'A course') || ' is due ' || to_char(ca.due_date, 'Mon DD, YYYY')
      || ' and has not been started.',
    '/me/courses/' || ca.id
  from public.course_assignments ca
  join public.employees e on e.id = ca.employee_id
  join public.courses co on co.id = ca.course_id
  where ca.status = 'assigned'
    and e.profile_id is not null
    and ca.due_date is not null
    and ca.due_date >= public.pa_today()
    and ca.due_date <= public.pa_today() + 7
    and not exists (
      select 1 from public.notifications n
      where n.notification_type = 'course_assignment_due_soon'
        and n.link = '/me/courses/' || ca.id
    );
end;
$function$
;

-- public.queue_manager_weekly_digests
CREATE OR REPLACE FUNCTION public.queue_manager_weekly_digests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles%rowtype;
  v_facility_ids uuid[];
  v_credentials integer;
  v_training integer;
  v_incidents integer;
  v_alerts integer;
  v_classes integer;
  v_inserted integer := 0;
  v_body text;
  v_items jsonb;
  v_digest_id uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
     and current_user not in ('postgres','supabase_admin') then
    raise exception 'Only the trusted digest worker may queue manager digests'
      using errcode = '42501';
  end if;
  for v_profile in
    select p.* from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.is_active and p.role in ('org_admin','facility_manager')
      and o.subscription_status not in ('suspended','canceled')
  loop
    if exists (
      select 1 from public.notifications n
      where n.profile_id = v_profile.id
        and n.notification_type = 'manager_weekly_digest'
        and n.created_at >= date_trunc('week', now())
    ) then continue; end if;

    if v_profile.role = 'org_admin' then
      select coalesce(array_agg(f.id), '{}'::uuid[]) into v_facility_ids
      from public.facilities f
      where f.organization_id = v_profile.organization_id
        and f.is_active and not f.is_sandbox;
    else
      select coalesce(array_agg(f.id), '{}'::uuid[]) into v_facility_ids
      from public.facility_assignments fa
      join public.facilities f on f.id = fa.facility_id
      where fa.profile_id = v_profile.id and f.is_active and not f.is_sandbox;
    end if;
    if cardinality(v_facility_ids) = 0 then continue; end if;

    select count(*) into v_credentials from public.employee_credentials c
    where c.facility_id = any(v_facility_ids)
      and c.expiration_date between public.pa_today() and public.pa_today() + 30;
    select count(*) into v_training from (
      select distinct on (r.employee_id, r.training_type_id) r.status
      from public.employee_training_records r
      where r.facility_id = any(v_facility_ids)
      order by r.employee_id, r.training_type_id,
        r.due_date desc nulls last, r.completion_date desc nulls last, r.created_at desc,
        (r.status = 'missing'), r.id
    ) cur
    where cur.status in ('expired','missing');
    select count(*) into v_incidents from public.incidents i
    where i.facility_id = any(v_facility_ids) and i.status <> 'closed';
    select count(*) into v_alerts from public.alerts a
    where a.facility_id = any(v_facility_ids) and a.status = 'open';
    select count(*) into v_classes from public.training_classes c
    where c.facility_id = any(v_facility_ids)
      and c.class_date between public.pa_today() and public.pa_today() + 6
      and c.status <> 'cancelled';

    v_body := format(
      '%s credentials expiring; %s overdue or missing training items; %s open incidents; %s unacknowledged alerts; %s classes this week.',
      v_credentials, v_training, v_incidents, v_alerts, v_classes
    );
    v_items := jsonb_build_array(
      jsonb_build_object('key','credentials','label','Credentials expiring within 30 days','count',v_credentials,'path','/app/credentials?status=expiring&withinDays=30'),
      jsonb_build_object('key','training','label','Overdue or missing training items','count',v_training,'path','/app/training-matrix?status=overdue'),
      jsonb_build_object('key','incidents','label','Open incidents','count',v_incidents,'path','/app/incidents?status=open'),
      jsonb_build_object('key','alerts','label','Unacknowledged alerts','count',v_alerts,'path','/app/alerts?status=open'),
      jsonb_build_object('key','classes','label','Classes this week','count',v_classes,'path','/trainer/classes?range=this-week')
    );
    insert into public.manager_digest_snapshots (
      organization_id, profile_id, week_started_on, items
    ) values (
      v_profile.organization_id, v_profile.id, date_trunc('week', now())::date, v_items
    )
    on conflict (profile_id, week_started_on) do update set items = excluded.items
    returning id into v_digest_id;
    insert into public.notifications (
      organization_id, profile_id, notification_type, title, body, link
    ) values (
      v_profile.organization_id, v_profile.id, 'manager_weekly_digest',
      'Your weekly manager digest', v_body, '/account/manager-digest/' || v_digest_id
    );
    v_inserted := v_inserted + 1;
  end loop;
  return v_inserted;
end;
$function$
;

-- public.recalculate_course_assignment_statuses
CREATE OR REPLACE FUNCTION public.recalculate_course_assignment_statuses()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.course_assignments
  set status = 'overdue'
  where status in ('assigned', 'in_progress')
    and due_date is not null
    and due_date < public.pa_today();

  update public.course_assignments ca
  set status = case
    when exists (select 1 from public.course_progress cp where cp.assignment_id = ca.id) then 'in_progress'
    else 'assigned'
  end
  where ca.status = 'overdue'
    and (ca.due_date is null or ca.due_date >= public.pa_today());
end;
$function$
;

-- public.record_citation_verification
CREATE OR REPLACE FUNCTION public.record_citation_verification(p_topic_id uuid, p_citation_ref text, p_source_url text, p_effective_date date DEFAULT NULL::date, p_verified_on date DEFAULT NULL::date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_topic public.dhs_citation_topics%rowtype;
begin
  -- coalesce, not a bare `not (...)`: current_role() is NULL for a deactivated profile, and
  -- `not NULL` is NULL, which fails open.
  if not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only a platform administrator records citation verification'
      using errcode = '42501';
  end if;

  select * into v_topic from public.dhs_citation_topics where id = p_topic_id for update;
  if not found then
    raise exception 'Citation topic not found' using errcode = 'P0002';
  end if;

  if length(btrim(coalesce(p_citation_ref, ''))) = 0 then
    raise exception 'Verification requires the citation reference being verified'
      using errcode = '22023';
  end if;
  -- The source URL is what makes a verification checkable by the next person. Without it this is
  -- one person's recollection wearing a status badge.
  if length(btrim(coalesce(p_source_url, ''))) = 0 then
    raise exception 'Verification requires the source the citation was read from'
      using errcode = '22023';
  end if;

  update public.dhs_citation_topics set
    citation_ref = btrim(p_citation_ref),
    source_url = btrim(p_source_url),
    effective_date = coalesce(p_effective_date, effective_date),
    verification_status = 'verified',
    verified_by = auth.uid(),
    verified_on = coalesce(p_verified_on, public.pa_today()),
    last_checked_at = now()
  where id = v_topic.id;
  return true;
end $function$
;

-- public.record_mock_inspection_run
CREATE OR REPLACE FUNCTION public.record_mock_inspection_run(p_facility_id uuid, p_as_of_date date, p_checklist_version_sha256 text, p_evidence_snapshot jsonb, p_findings jsonb, p_model text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_facility public.facilities%rowtype;
  v_actor uuid;
  v_id uuid;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the mock-inspection worker may record a run' using errcode = '42501';
  end if;
  v_actor := nullif(auth.jwt()->>'sub', '')::uuid;
  if v_actor is null then
    v_actor := nullif(p_evidence_snapshot->>'requestedBy', '')::uuid;
  end if;
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found or v_actor is null then raise exception 'Facility or requesting actor is invalid' using errcode = '22023'; end if;
  if p_checklist_version_sha256 !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_evidence_snapshot) <> 'object'
     or jsonb_typeof(p_findings) <> 'array' then
    raise exception 'Mock inspection evidence is invalid' using errcode = '22023';
  end if;
  insert into public.mock_inspection_runs (
    organization_id, facility_id, status, as_of_date, checklist_version_sha256,
    evidence_snapshot, findings, passed_count, attention_count,
    indeterminate_count, model, created_by, completed_at
  ) values (
    v_facility.organization_id, v_facility.id, 'completed', coalesce(p_as_of_date, public.pa_today()),
    p_checklist_version_sha256, p_evidence_snapshot, p_findings,
    (select count(*) from jsonb_array_elements(p_findings) f where f->>'determination' = 'pass'),
    (select count(*) from jsonb_array_elements(p_findings) f where f->>'determination' = 'attention'),
    (select count(*) from jsonb_array_elements(p_findings) f where f->>'determination' = 'indeterminate'),
    p_model, v_actor, now()
  ) returning id into v_id;
  return v_id;
end;
$function$
;

-- public.record_regulatory_source_snapshot
CREATE OR REPLACE FUNCTION public.record_regulatory_source_snapshot(p_source_key text, p_http_status integer, p_source_checksum_sha256 text, p_normalized_content text, p_response_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source public.regulatory_update_sources%rowtype;
  v_previous_checksum text;
  v_snapshot_id uuid;
  v_pack public.regulatory_rule_packs%rowtype;
  v_active public.regulatory_rule_versions%rowtype;
  v_version_id uuid;
  v_changed boolean := false;
  v_content_hash text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the regulatory update worker may record source snapshots'
      using errcode = '42501';
  end if;
  select * into v_source from public.regulatory_update_sources
  where source_key = p_source_key and is_active for update;
  if not found then raise exception 'Regulatory source not found' using errcode = 'P0002'; end if;
  if p_http_status between 200 and 299 then
    if p_source_checksum_sha256 !~ '^[0-9a-f]{64}$' or length(coalesce(p_normalized_content, '')) < 40 then
      raise exception 'Successful regulatory snapshots require validated content and SHA-256'
        using errcode = '22023';
    end if;
    select source_checksum_sha256 into v_previous_checksum
    from public.regulatory_source_snapshots
    where source_id = v_source.id and fetch_succeeded
    order by fetched_at desc limit 1;
    v_changed := v_previous_checksum is not null and v_previous_checksum <> p_source_checksum_sha256;
  end if;
  insert into public.regulatory_source_snapshots (
    source_id, http_status, source_checksum_sha256, normalized_content,
    response_metadata, fetch_succeeded, changed_from_previous
  ) values (
    v_source.id, p_http_status, p_source_checksum_sha256,
    left(p_normalized_content, 500000), coalesce(p_response_metadata, '{}'::jsonb),
    p_http_status between 200 and 299, v_changed
  ) on conflict (source_id, source_checksum_sha256) do update
    set fetched_at = now(), http_status = excluded.http_status,
        response_metadata = excluded.response_metadata
  returning id into v_snapshot_id;
  update public.regulatory_update_sources set
    last_checked_at = now(),
    last_changed_at = case when v_changed then now() else last_changed_at end,
    consecutive_failures = case when p_http_status between 200 and 299 then 0 else consecutive_failures + 1 end
  where id = v_source.id;

  if v_changed then
    select * into v_pack from public.regulatory_rule_packs where rule_key = v_source.rule_key;
    if v_pack.id is not null then
      select * into v_active from public.regulatory_rule_versions
      where rule_pack_id = v_pack.id and state = 'active';
    end if;
    insert into public.regulatory_change_proposals (
      source_snapshot_id, rule_pack_id, state, change_summary
    ) values (
      v_snapshot_id, v_pack.id, 'detected',
      jsonb_build_object('sourceKey', v_source.source_key, 'previousChecksum', v_previous_checksum,
        'newChecksum', p_source_checksum_sha256, 'detectedAt', now(),
        'requiresHumanLegalReview', true)
    ) on conflict (source_snapshot_id) do nothing;

    -- Automation is intentionally permitted to create only a draft. The existing
    -- submit/review/fixture/shadow/activation functions remain the sole release path.
    if v_active.id is not null and not exists (
      select 1 from public.regulatory_rule_versions
      where automation_source_snapshot_id = v_snapshot_id
    ) then
      v_content_hash := encode(extensions.digest(convert_to(
        jsonb_build_object('baseline', v_active.content_checksum_sha256,
          'source', p_source_checksum_sha256, 'parameters', v_active.calculation_parameters)::text,
        'utf8'), 'sha256'), 'hex');
      insert into public.regulatory_rule_versions (
        rule_pack_id, version_number, state, jurisdiction_code, authority_name,
        citation, source_uri, source_checksum_sha256, applicability,
        calculation_parameters, effective_from, supersedes_version_id,
        content_checksum_sha256, release_notes, authored_by,
        automation_source_snapshot_id, authored_by_automation
      ) values (
        v_pack.id,
        (select coalesce(max(version_number), 0) + 1 from public.regulatory_rule_versions where rule_pack_id = v_pack.id),
        'draft', v_active.jurisdiction_code, v_active.authority_name, v_active.citation,
        v_source.source_uri, p_source_checksum_sha256, v_active.applicability,
        v_active.calculation_parameters, public.pa_today(), v_active.id, v_content_hash,
        'AUTOMATED DRAFT: an official source changed. Calculation parameters are copied from the active baseline and must be reconciled by a platform administrator before submission.',
        v_pack.owner_profile_id, v_snapshot_id, true
      ) returning id into v_version_id;
      update public.regulatory_change_proposals
      set state = 'drafted', drafted_rule_version_id = v_version_id
      where source_snapshot_id = v_snapshot_id;
    end if;
  end if;
  return jsonb_build_object('snapshotId', v_snapshot_id, 'changed', v_changed,
    'draftedRuleVersionId', v_version_id);
end;
$function$
;

-- public.record_support_plan_participation
CREATE OR REPLACE FUNCTION public.record_support_plan_participation(p_plan_id uuid, p_participation_date date, p_participation_record jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.resident_support_plans%rowtype;
begin
  select * into v from public.resident_support_plans where id = p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.state <> 'awaiting_participation' then
    raise exception 'Participation can only be recorded while a plan is awaiting participation' using errcode = '22023';
  end if;
  if p_participation_date is null or p_participation_date > public.pa_today() then
    raise exception 'Participation date must be a real date that is not in the future' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_participation_record, '{}'::jsonb)) <> 'object' then
    raise exception 'Participation record must be an object' using errcode = '22023';
  end if;

  perform set_config('app.allow_support_plan_history_update','true',true);
  update public.resident_support_plans set
    participation_date = p_participation_date,
    participation_record = coalesce(p_participation_record, '{}'::jsonb),
    state = 'awaiting_signature',
    updated_at = now()
  where id = v.id;
  perform set_config('app.allow_support_plan_history_update','false',true);

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'resident_support_plan', v.id::text, 'support_plan.participation_recorded',
    jsonb_build_object('participationDate', p_participation_date, 'participants', coalesce(p_participation_record, '{}'::jsonb)));
  return true;
end $function$
;

-- public.request_shift_swap
CREATE OR REPLACE FUNCTION public.request_shift_swap(p_requester_assignment_id uuid, p_target_assignment_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_requester public.shift_assignments%rowtype;
  v_target public.shift_assignments%rowtype;
  v_employee public.employees%rowtype;
  v_policy public.schedule_eligibility_policies%rowtype;
  v_id uuid;
begin
  select * into v_requester from public.shift_assignments where id = p_requester_assignment_id;
  select * into v_target from public.shift_assignments where id = p_target_assignment_id;
  select * into v_employee from public.employees where id = v_requester.employee_id;
  if v_requester.id is null or v_target.id is null or v_employee.profile_id <> auth.uid()
     or v_requester.organization_id <> v_target.organization_id
     or v_requester.facility_id <> v_target.facility_id
     or v_requester.shift_date < public.pa_today() or v_target.shift_date < public.pa_today() then
    raise exception 'Shift swap is outside employee scope' using errcode = '42501';
  end if;
  select * into v_policy from public.schedule_eligibility_policies where organization_id = v_requester.organization_id;
  if least(
    v_requester.shift_date + v_requester.start_time,
    v_target.shift_date + v_target.start_time
  ) <= now() + make_interval(hours => v_policy.swap_deadline_hours) then
    raise exception 'Shift swap deadline has passed' using errcode = '55000';
  end if;
  insert into public.shift_swap_requests(
    organization_id, facility_id, requester_employee_id, requester_assignment_id,
    target_employee_id, target_assignment_id, reason, expires_at
  ) values (
    v_requester.organization_id, v_requester.facility_id, v_requester.employee_id,
    v_requester.id, v_target.employee_id, v_target.id, btrim(p_reason),
    least(v_requester.shift_date + v_requester.start_time, v_target.shift_date + v_target.start_time)
      - make_interval(hours => v_policy.swap_deadline_hours)
  ) returning id into v_id;
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_requester.organization_id, e.profile_id, 'shift_swap_changed',
    'Shift swap requested', 'A coworker requested a governed shift swap.',
    '/me/schedule'
  from public.employees e where e.id = v_target.employee_id and e.profile_id is not null;
  return v_id;
end;
$function$
;

-- public.review_credential_renewal_submission
CREATE OR REPLACE FUNCTION public.review_credential_renewal_submission(p_submission_id uuid, p_decision text, p_confirmed_fields jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_submission public.credential_renewal_submissions%rowtype;
  v_credential_id uuid;
begin
  select * into v_submission from public.credential_renewal_submissions
  where id = p_submission_id for update;
  if not found then raise exception 'Credential renewal submission not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(
    v_submission.organization_id, 'credentials.renewal.review', v_submission.facility_id
  );
  if v_submission.status <> 'needs_review' or v_submission.scan_status <> 'clean'
     or p_decision not in ('approve', 'reject')
     or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Credential renewal is not ready for a human decision' using errcode = '55000';
  end if;
  if auth.uid() = v_submission.submitted_by then
    raise exception 'Credential renewal requires an independent reviewer' using errcode = '42501';
  end if;
  if p_decision = 'reject' then
    update public.credential_renewal_submissions set
      status = 'rejected', human_confirmed_fields = coalesce(p_confirmed_fields, '{}'::jsonb),
      reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason)
    where id = v_submission.id;
    return null;
  end if;
  if jsonb_typeof(p_confirmed_fields) <> 'object'
     or length(btrim(coalesce(p_confirmed_fields->>'issuingAuthority', ''))) = 0
     or coalesce(p_confirmed_fields->>'expirationDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Human-confirmed issuer and expiration date are required' using errcode = '22023';
  end if;
  if v_submission.credential_id is null then
    insert into public.employee_credentials(
      organization_id, facility_id, employee_id, credential_type,
      credential_label, issuing_authority, credential_number, issue_date,
      expiration_date, status, verification_method, verified_by_profile_id, verified_at
    ) values (
      v_submission.organization_id, v_submission.facility_id, v_submission.employee_id,
      v_submission.credential_type, nullif(p_confirmed_fields->>'credentialLabel', ''),
      btrim(p_confirmed_fields->>'issuingAuthority'), nullif(p_confirmed_fields->>'credentialNumber', ''),
      nullif(p_confirmed_fields->>'issueDate', '')::date,
      (p_confirmed_fields->>'expirationDate')::date,
      case when (p_confirmed_fields->>'expirationDate')::date > public.pa_today() then 'compliant' else 'expired' end,
      'human_reviewed_ocr', auth.uid(), now()
    ) returning id into v_credential_id;
  else
    update public.employee_credentials set
      issuing_authority = btrim(p_confirmed_fields->>'issuingAuthority'),
      credential_number = nullif(p_confirmed_fields->>'credentialNumber', ''),
      issue_date = nullif(p_confirmed_fields->>'issueDate', '')::date,
      expiration_date = (p_confirmed_fields->>'expirationDate')::date,
      status = case when (p_confirmed_fields->>'expirationDate')::date > public.pa_today() then 'compliant' else 'expired' end,
      verification_method = 'human_reviewed_ocr',
      verified_by_profile_id = auth.uid(), verified_at = now()
    where id = v_submission.credential_id and employee_id = v_submission.employee_id
    returning id into v_credential_id;
    if v_credential_id is null then
      raise exception 'Credential does not belong to the submitted employee' using errcode = '23514';
    end if;
  end if;
  update public.credential_renewal_submissions set
    status = 'approved', human_confirmed_fields = p_confirmed_fields,
    reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason),
    approved_credential_id = v_credential_id
  where id = v_submission.id;
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_submission.organization_id, e.profile_id, 'credential_renewal_changed',
    'Credential renewal approved', 'Your reviewed credential renewal is now effective.',
    '/app/credentials'
  from public.employees e where e.id = v_submission.employee_id and e.profile_id is not null;
  return v_credential_id;
end;
$function$
;

-- public.run_facility_license_due_evaluator
CREATE OR REPLACE FUNCTION public.run_facility_license_due_evaluator()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count integer := 0; v_record record; v_template uuid; v_work uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select id into v_template from public.work_item_templates where organization_id is null and template_key='facility.license_due' and is_active limit 1;
  for v_record in
    select organization_id,facility_id,id,'license'::text kind,expires_on due_on,'License '||license_number title from public.facility_licenses where status in ('active','provisional','conditional') and expires_on between public.pa_today() and public.pa_today()+90
    union all select organization_id,facility_id,id,'waiver',coalesce(renewal_due_on,expires_on),'Waiver '||regulation_citation from public.facility_regulatory_waivers where status in ('requested','active') and coalesce(renewal_due_on,expires_on) between public.pa_today() and public.pa_today()+90
    union all select organization_id,facility_id,id,'filing',due_on,title from public.facility_regulatory_filings where status in ('not_started','in_progress','rejected') and due_on <= public.pa_today()+90
  loop
    insert into public.work_items(organization_id,facility_id,template_id,source_type,source_id,deduplication_key,title,description,priority,due_at,created_by)
    values(v_record.organization_id,v_record.facility_id,v_template,'rule_exception',v_record.id,'facility-license:'||v_record.kind||':'||v_record.id,v_record.title,'Facility licensing lifecycle deadline',case when v_record.due_on < public.pa_today() then 'urgent' when v_record.due_on <= public.pa_today()+30 then 'high' else 'normal' end,v_record.due_on::timestamptz,null)
    on conflict (organization_id,deduplication_key) do update set due_at=excluded.due_at,priority=excluded.priority,state=case when public.work_items.state in ('closed','canceled') then 'open' else public.work_items.state end,updated_at=now()
    returning id into v_work;
    insert into public.work_item_history(organization_id,facility_id,work_item_id,event_type,resulting_state,actor_profile_id,reason) values(v_record.organization_id,v_record.facility_id,v_work,'deadline_evaluated','open',null,'Facility licensing deadline evaluator refreshed this work item');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;$function$
;

-- public.save_employee_credential
CREATE OR REPLACE FUNCTION public.save_employee_credential(p_credential_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS employee_credentials
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.employee_credentials%rowtype;
  v_employee public.employees%rowtype;
  v_result public.employee_credentials%rowtype;
  v_employee_id uuid;
  v_status text;
  v_type text;
begin
  if auth.uid() is null or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'A signed-in user and credential payload are required' using errcode = '42501';
  end if;

  if p_credential_id is not null then
    select * into v_existing from public.employee_credentials
    where id = p_credential_id for update;
    if not found then raise exception 'Credential not found' using errcode = 'P0002'; end if;
    if p_payload ? 'employee_id'
       and (p_payload ->> 'employee_id')::uuid is distinct from v_existing.employee_id then
      raise exception 'Credential cannot be reassigned' using errcode = '23514';
    end if;
    v_employee_id := v_existing.employee_id;
    v_type := case when p_payload ? 'credential_type'
      then p_payload ->> 'credential_type' else v_existing.credential_type end;
    v_status := case when p_payload ? 'status'
      then p_payload ->> 'status' else v_existing.status end;
  else
    v_employee_id := nullif(p_payload ->> 'employee_id', '')::uuid;
    v_type := nullif(btrim(p_payload ->> 'credential_type'), '');
    v_status := coalesce(nullif(p_payload ->> 'status', ''), 'missing');
  end if;

  select * into v_employee from public.employees where id = v_employee_id;
  if not found then raise exception 'Employee not found' using errcode = '23503'; end if;
  if not (
    public.is_platform_admin()
    or (
      v_employee.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(v_employee.facility_id)
    )
  ) then
    raise exception 'Not authorized to manage this credential' using errcode = '42501';
  end if;
  if v_type is null then raise exception 'Credential type is required' using errcode = '22023'; end if;
  if v_status not in ('compliant','due_soon','expired','missing','not_applicable') then
    raise exception 'Invalid credential status' using errcode = '22023';
  end if;

  if p_credential_id is null then
    insert into public.employee_credentials(
      organization_id, facility_id, employee_id, credential_type, credential_label,
      issuing_authority, credential_number, issue_date, expiration_date,
      last_verified_date, warning_days, status, verification_method,
      verified_by_profile_id, verified_at, notes, citation_topic_id
    ) values (
      v_employee.organization_id, v_employee.facility_id, v_employee.id, v_type,
      nullif(p_payload ->> 'credential_label', ''),
      nullif(p_payload ->> 'issuing_authority', ''),
      nullif(p_payload ->> 'credential_number', ''),
      nullif(p_payload ->> 'issue_date', '')::date,
      nullif(p_payload ->> 'expiration_date', '')::date,
      case when v_status = 'missing' then null else public.pa_today() end,
      coalesce(nullif(p_payload ->> 'warning_days', '')::integer, 90), v_status,
      case when v_status = 'missing' then null else nullif(p_payload ->> 'verification_method', '') end,
      case when v_status = 'missing' then null else auth.uid() end,
      case when v_status = 'missing' then null else now() end,
      nullif(p_payload ->> 'notes', ''),
      nullif(p_payload ->> 'citation_topic_id', '')::uuid
    ) returning * into v_result;
  else
    update public.employee_credentials c set
      credential_type = v_type,
      credential_label = case when p_payload ? 'credential_label' then nullif(p_payload ->> 'credential_label', '') else c.credential_label end,
      issuing_authority = case when p_payload ? 'issuing_authority' then nullif(p_payload ->> 'issuing_authority', '') else c.issuing_authority end,
      credential_number = case when p_payload ? 'credential_number' then nullif(p_payload ->> 'credential_number', '') else c.credential_number end,
      issue_date = case when p_payload ? 'issue_date' then nullif(p_payload ->> 'issue_date', '')::date else c.issue_date end,
      expiration_date = case when p_payload ? 'expiration_date' then nullif(p_payload ->> 'expiration_date', '')::date else c.expiration_date end,
      warning_days = case when p_payload ? 'warning_days' then (p_payload ->> 'warning_days')::integer else c.warning_days end,
      status = v_status,
      verification_method = case
        when v_status = 'missing' then null
        when p_payload ? 'verification_method' then nullif(p_payload ->> 'verification_method', '')
        else c.verification_method end,
      last_verified_date = case when v_status = 'missing' then null else public.pa_today() end,
      verified_by_profile_id = case when v_status = 'missing' then null else auth.uid() end,
      verified_at = case when v_status = 'missing' then null else now() end,
      notes = case when p_payload ? 'notes' then nullif(p_payload ->> 'notes', '') else c.notes end,
      citation_topic_id = case when p_payload ? 'citation_topic_id' then nullif(p_payload ->> 'citation_topic_id', '')::uuid else c.citation_topic_id end,
      updated_at = now()
    where c.id = p_credential_id
    returning * into v_result;
  end if;
  return v_result;
end;
$function$
;

-- public.save_resident_assessment_review
CREATE OR REPLACE FUNCTION public.save_resident_assessment_review(p_resident_id uuid, p_template_key text, p_template_version integer, p_answers jsonb, p_review_id uuid DEFAULT NULL::uuid, p_hospital_episode_id uuid DEFAULT NULL::uuid, p_review_date date DEFAULT NULL::date, p_incident_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_resident public.residents%rowtype;
  v_existing public.resident_assessment_reviews%rowtype;
  v_id uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v_resident.organization_id, v_resident.facility_id);

  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then
    raise exception 'Review answers must be an object' using errcode = '22023';
  end if;
  if p_review_date is not null and p_review_date > public.pa_today() then
    raise exception 'A review cannot be dated in the future' using errcode = '22023';
  end if;
  if p_hospital_episode_id is not null and not exists (
    select 1 from public.hospital_transfer_episodes h
    where h.id = p_hospital_episode_id and h.resident_id = p_resident_id
  ) then
    raise exception 'Hospital episode belongs to a different resident' using errcode = '23514';
  end if;
  if p_incident_id is not null and not exists (
    select 1 from public.incidents i
    where i.id = p_incident_id and i.resident_id = p_resident_id
  ) then
    raise exception 'Incident belongs to a different resident' using errcode = '23514';
  end if;

  if p_review_id is not null then
    select * into v_existing from public.resident_assessment_reviews
      where id = p_review_id and resident_id = p_resident_id for update;
    if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
    -- A finalized review is evidence. Correcting one means superseding it with a new review, not
    -- editing the record a signature already attests to.
    if v_existing.status <> 'draft' then
      raise exception 'Only a draft review can be edited; supersede the finalized one instead'
        using errcode = '55000';
    end if;
    update public.resident_assessment_reviews set
      answers = coalesce(p_answers, '{}'::jsonb),
      hospital_episode_id = coalesce(p_hospital_episode_id, hospital_episode_id),
      incident_id = coalesce(p_incident_id, incident_id),
      review_date = coalesce(p_review_date, review_date),
      updated_at = now()
    where id = v_existing.id;
    return v_existing.id;
  end if;

  insert into public.resident_assessment_reviews(
    organization_id, facility_id, resident_id, template_key, template_version,
    answers, hospital_episode_id, incident_id, review_date, created_by
  )
  values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, p_template_key,
    p_template_version, coalesce(p_answers, '{}'::jsonb), p_hospital_episode_id, p_incident_id,
    coalesce(p_review_date, public.pa_today()), auth.uid()
  )
  returning id into v_id;
  return v_id;
end $function$
;

-- public.send_policy_attestation_reminders
CREATE OR REPLACE FUNCTION public.send_policy_attestation_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  select
    pa.organization_id, e.profile_id, 'policy_attestation_due_soon',
    case when pa.due_date < public.pa_today() then 'Policy attestation overdue' else 'Policy attestation due soon' end,
    pd.title ||
      case
        when pa.due_date is null then ' requires your attestation.'
        when pa.due_date < public.pa_today() then ' was due ' || to_char(pa.due_date, 'Mon DD, YYYY') || ' and is now overdue.'
        else ' is due ' || to_char(pa.due_date, 'Mon DD, YYYY') || '.'
      end,
    '/me/attestations'
  from public.policy_attestations pa
  join public.employees e on e.id = pa.employee_id
  join public.policy_attestation_campaigns c on c.id = pa.campaign_id
  join public.policy_documents pd on pd.id = c.policy_document_id
  where pa.status = 'pending'
    and e.profile_id is not null
    and pa.due_date is not null
    and pa.due_date <= public.pa_today() + 7
    and (pa.reminder_sent_at is null or pa.reminder_sent_at < now() - interval '3 days');

  update public.policy_attestations pa
  set reminder_sent_at = now()
  where pa.status = 'pending'
    and pa.due_date is not null
    and pa.due_date <= public.pa_today() + 7
    and (pa.reminder_sent_at is null or pa.reminder_sent_at < now() - interval '3 days');
end;
$function$
;

-- public.set_compliance_requirement_active
CREATE OR REPLACE FUNCTION public.set_compliance_requirement_active(p_requirement_id uuid, p_active boolean, p_note text DEFAULT NULL::text)
 RETURNS compliance_requirements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.compliance_requirements%rowtype;
begin
  select * into r from public.compliance_requirements where id = p_requirement_id for update;
  if not found then raise exception 'Requirement not found' using errcode = 'P0002'; end if;
  perform app_private.assert_compliance_manager(r.organization_id, r.facility_id);
  if r.is_template then perform app_private.assert_compliance_org_admin(r.organization_id); end if;

  update public.compliance_requirements set is_active = coalesce(p_active, is_active)
  where id = r.id returning * into r;

  insert into public.compliance_requirement_events
    (organization_id, facility_id, requirement_id, event_type, actor_profile_id, note)
  values (r.organization_id, r.facility_id, r.id,
    case when p_active then 'requirement_reactivated' else 'requirement_archived' end,
    (select auth.uid()), nullif(btrim(coalesce(p_note, '')), ''));

  -- Archiving retires its still-open occurrences (the dashboard loads archived requirements and all
  -- their instances), so an obsolete requirement stops appearing as overdue and dragging the score
  -- down. They are marked not_applicable rather than deleted, preserving the record.
  if not p_active then
    update public.compliance_requirement_instances
    set status = 'not_applicable',
        na_reason = coalesce(na_reason, 'Requirement archived')
    where requirement_id = r.id
      and status in ('not_started', 'in_progress', 'overdue', 'awaiting_review');
  end if;

  if not r.is_template and r.is_active then
    perform app_private.ensure_compliance_instances(r.id, public.pa_today() + greatest(r.warning_days, 30));
  end if;
  return r;
end $function$
;

-- public.stamp_maintenance_scope
CREATE OR REPLACE FUNCTION public.stamp_maintenance_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  v_facility uuid;
begin
  if tg_table_name = 'maintenance_locations' then
    select f.organization_id, f.id into v_org, v_facility
    from public.facilities f where f.id = new.facility_id;
  elsif tg_table_name = 'preventive_maintenance_schedules' then
    if new.inspection_item_id is not null then
      select i.organization_id, i.facility_id into v_org, v_facility
      from public.inspection_items i where i.id = new.inspection_item_id;
    else
      select l.organization_id, l.facility_id into v_org, v_facility
      from public.maintenance_locations l where l.id = new.maintenance_location_id;
    end if;
  elsif tg_table_name = 'work_orders' then
    if new.source_inspection_event_id is not null then
      select e.organization_id, e.facility_id, e.inspection_item_id
        into v_org, v_facility, new.inspection_item_id
      from public.inspection_events e where e.id = new.source_inspection_event_id;
    elsif new.inspection_item_id is not null then
      select i.organization_id, i.facility_id into v_org, v_facility
      from public.inspection_items i where i.id = new.inspection_item_id;
    elsif new.maintenance_location_id is not null then
      select l.organization_id, l.facility_id into v_org, v_facility
      from public.maintenance_locations l where l.id = new.maintenance_location_id;
    else
      select f.organization_id, f.id into v_org, v_facility
      from public.facilities f where f.id = new.facility_id;
    end if;
    if tg_op = 'INSERT' then
      new.work_order_number := format(
        'WO-%s-%s', to_char(public.pa_today(), 'YYYY'),
        lpad(nextval('public.work_order_number_seq')::text, 6, '0')
      );
      new.created_by_profile_id := coalesce(new.created_by_profile_id, auth.uid());
      new.status := 'open';
    end if;
  elsif tg_table_name = 'maintenance_documents' then
    if new.work_order_id is not null then
      select w.organization_id, w.facility_id into v_org, v_facility
      from public.work_orders w where w.id = new.work_order_id;
    else
      select i.organization_id, i.facility_id into v_org, v_facility
      from public.inspection_items i where i.id = new.inspection_item_id;
    end if;
    new.uploaded_by_profile_id := coalesce(new.uploaded_by_profile_id, auth.uid());
  end if;

  if v_org is null or v_facility is null then
    raise exception 'Maintenance parent record was not found' using errcode = '23503';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_facility;

  if tg_table_name in ('preventive_maintenance_schedules','work_orders') then
    if new.assigned_employee_id is not null and not exists (
      select 1 from public.employees e
      where e.id = new.assigned_employee_id
        and e.organization_id = v_org
        and e.status = 'active'
    ) then
      raise exception 'Assigned maintenance employee must be active in this organization' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$
;

-- public.start_confidential_incident_intake
CREATE OR REPLACE FUNCTION public.start_confidential_incident_intake(p_facility_id uuid, p_report_type text, p_occurred_at timestamp with time zone, p_immediate_danger boolean, p_severity text, p_reporter_mode text, p_public_summary text, p_narrative text, p_resident_id uuid, p_encrypted_contact jsonb, p_resume_secret text, p_confirmation_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare v_fac public.facilities%rowtype;v_id uuid;v_number text;v_work uuid;begin select * into v_fac from public.facilities where id=p_facility_id;if not found or length(p_resume_secret)<24 or length(p_confirmation_token)<24 or length(btrim(coalesce(p_public_summary,'')))<5 or length(btrim(coalesce(p_narrative,'')))<10 then raise exception 'Confidential intake request is invalid' using errcode='22023';end if;insert into public.confidential_incident_intakes(organization_id,facility_id,report_type,occurred_at,immediate_danger,severity,reporter_mode,public_summary,status,resume_secret_sha256,confirmation_token_sha256,retention_until)values(v_fac.organization_id,v_fac.id,p_report_type,p_occurred_at,p_immediate_danger,p_severity,p_reporter_mode,btrim(p_public_summary),'submitted',encode(extensions.digest(convert_to(p_resume_secret,'utf8'),'sha256'),'hex'),encode(extensions.digest(convert_to(p_confirmation_token,'utf8'),'sha256'),'hex'),public.pa_today()+2555)returning id,intake_number into v_id,v_number;insert into public.confidential_incident_details(intake_id,organization_id,resident_id,narrative)values(v_id,v_fac.organization_id,p_resident_id,btrim(p_narrative));if p_reporter_mode='identified' then insert into public.confidential_reporter_identities(intake_id,organization_id,reporter_profile_id,encrypted_contact)values(v_id,v_fac.organization_id,auth.uid(),coalesce(p_encrypted_contact,'{}'));end if;if p_immediate_danger or p_severity in('high','critical') then insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,priority,due_at,state,created_by)values(v_fac.organization_id,v_fac.id,'incident',v_id,'confidential-intake:'||v_id,'Urgent confidential incident triage','Protected details available only to authorized investigators',case when p_severity='critical' then 'urgent' else 'high' end,now()+case when p_severity='critical' then interval '15 minutes' else interval '4 hours' end,'open',auth.uid()) returning id into v_work;update public.confidential_incident_intakes set triage_work_item_id=v_work where id=v_id;insert into public.work_item_history(organization_id,facility_id,work_item_id,event_type,resulting_state,actor_profile_id,reason)values(v_fac.organization_id,v_fac.id,v_work,'created','open',auth.uid(),'Urgent confidential intake created triage work');end if;return jsonb_build_object('intakeNumber',v_number,'confirmationToken',p_confirmation_token,'urgentRoutingCreated',v_work is not null);end$function$
;

-- public.start_resident_assessment_form
CREATE OR REPLACE FUNCTION public.start_resident_assessment_form(p_resident_id uuid, p_reason text, p_compliance_item_id uuid DEFAULT NULL::uuid)
 RETURNS resident_assessment_forms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_res record;
  v_facility_type text;
  v_form_type text;
  v_prior public.resident_assessment_forms;
  v_new public.resident_assessment_forms;
  v_profile record;
  v_next_version integer;
  v_content jsonb;
begin
  select id, organization_id, facility_id into v_res from public.residents where id = p_resident_id;
  if v_res.id is null then
    raise exception 'resident % not found', p_resident_id using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_res.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_res.facility_id))
  ) then
    raise exception 'not authorized to start an assessment form for this resident' using errcode = 'insufficient_privilege';
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  v_form_type := case when v_facility_type = 'ALR' then 'ASP' else 'RASP' end;

  select * into v_prior from public.resident_assessment_forms
  where resident_id = p_resident_id and form_type = v_form_type and status = 'finalized'
  order by version_number desc limit 1;

  select first_name, last_name, role into v_profile from public.profiles where id = auth.uid();
  v_next_version := coalesce(v_prior.version_number, 0) + 1;

  v_content := coalesce(v_prior.content, '{}'::jsonb);
  v_content := v_content || jsonb_build_object(
    'assessmentInfo',
    coalesce(v_content->'assessmentInfo', '{}'::jsonb)
      || jsonb_build_object('assessmentReason', p_reason, 'supportPlanReason', p_reason)
  );

  insert into public.resident_assessment_forms
    (organization_id, facility_id, resident_id, compliance_item_id, form_type, reason,
     version_number, cloned_from_id, status, content, prepared_by_profile_id, prepared_by_name, prepared_by_title, prepared_date)
  values (
    v_res.organization_id, v_res.facility_id, v_res.id, p_compliance_item_id, v_form_type, p_reason,
    v_next_version, v_prior.id, 'draft',
    v_content,
    auth.uid(), coalesce(v_profile.first_name || ' ' || v_profile.last_name, ''), coalesce(v_profile.role, ''),
    public.pa_today()
  )
  returning * into v_new;

  return v_new;
end;
$function$
;

-- public.transition_resident_census
CREATE OR REPLACE FUNCTION public.transition_resident_census(p_resident_id uuid, p_target_status text, p_bed_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.residents%rowtype;
  v_bed public.facility_beds%rowtype;
  v_event text;
begin
  select * into v from public.residents where id = p_resident_id for update;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if p_target_status not in ('active', 'temporarily_out', 'hospital_leave', 'discharged', 'deceased')
    or length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Invalid census transition' using errcode = '22023';
  end if;
  if p_bed_id is not null then
    select * into v_bed from public.facility_beds where id = p_bed_id for update;
    if v_bed.facility_id <> v.facility_id
      or (v_bed.status <> 'available' and v_bed.occupied_by_resident_id <> v.id) then
      raise exception 'Target bed is unavailable' using errcode = '55000';
    end if;
  end if;
  v_event := case
    when p_target_status = 'active' and v.status in ('temporarily_out', 'hospital_leave') then 'returned'
    when p_target_status = 'active' and v.status = 'reserved' then 'admitted'
    when p_target_status = 'active' and p_bed_id is not null and p_bed_id is distinct from v.bed_id then 'room_transfer'
    else p_target_status
  end;
  if p_target_status = v.status and p_bed_id is not distinct from v.bed_id then
    raise exception 'Census transition would not change resident state' using errcode = '22023';
  end if;
  if p_bed_id is not null and p_bed_id is distinct from v.bed_id then
    update public.facility_beds set status = 'available', occupied_by_resident_id = null,
      expected_vacancy_date = null, updated_at = now()
    where id = v.bed_id and occupied_by_resident_id = v.id;
    update public.facility_beds set status = 'occupied', occupied_by_resident_id = v.id,
      reserved_for_prospect_id = null, updated_at = now() where id = p_bed_id;
  end if;
  if p_target_status in ('discharged', 'deceased') then
    update public.facility_beds set status = 'available', occupied_by_resident_id = null,
      expected_vacancy_date = null, updated_at = now()
    where id = v.bed_id and occupied_by_resident_id = v.id;
  end if;
  update public.residents
  set status = p_target_status,
      bed_id = case when p_target_status in ('discharged', 'deceased') then null else coalesce(p_bed_id, bed_id) end,
      room = case
        when p_target_status in ('discharged', 'deceased') then room
        when p_bed_id is not null then (select room_number from public.facility_rooms where id = v_bed.room_id)
        else room end,
      discharge_date = case when p_target_status in ('discharged', 'deceased') then public.pa_today() else null end,
      updated_at = now()
  where id = v.id;
  insert into public.resident_census_events(
    organization_id, facility_id, resident_id, event_type, prior_status,
    resulting_status, prior_bed_id, resulting_bed_id, reason, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id, v_event, v.status,
    p_target_status, v.bed_id,
    case when p_target_status in ('discharged', 'deceased') then null else coalesce(p_bed_id, v.bed_id) end,
    btrim(p_reason), auth.uid()
  );
  return true;
end;
$function$
;

-- public.update_resident_service_requirement
CREATE OR REPLACE FUNCTION public.update_resident_service_requirement(p_requirement_id uuid, p_frequency text, p_frequency_detail text, p_time_window_start time without time zone, p_time_window_end time without time zone, p_responsible_role text, p_unit_id uuid, p_special_instructions text, p_requires_two_staff boolean, p_documentation_mode text, p_expires_on date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_requirement public.resident_service_requirements%rowtype;
begin
  select * into v_requirement
  from public.resident_service_requirements
  where id = p_requirement_id for update;
  if not found then raise exception 'Service requirement not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase5_manager(v_requirement.organization_id, v_requirement.facility_id);
  if v_requirement.status <> 'active'
    or p_frequency not in ('hourly', 'daily', 'weekly', 'monthly', 'other')
    or p_time_window_end <= p_time_window_start
    or length(btrim(coalesce(p_responsible_role, ''))) < 1
    or length(btrim(coalesce(p_special_instructions, ''))) < 1
    or p_documentation_mode not in ('every_task', 'exception_only')
    or (p_expires_on is not null and p_expires_on < v_requirement.effective_from) then
    raise exception 'Invalid service requirement configuration' using errcode = '22023';
  end if;
  if p_unit_id is not null and not exists (
    select 1 from public.facility_units u
    where u.id = p_unit_id and u.facility_id = v_requirement.facility_id
  ) then
    raise exception 'Unit is outside requirement facility' using errcode = '22023';
  end if;
  update public.resident_service_requirements
  set frequency = p_frequency,
      frequency_detail = nullif(btrim(p_frequency_detail), ''),
      time_window_start = p_time_window_start,
      time_window_end = p_time_window_end,
      responsible_role = btrim(p_responsible_role),
      unit_id = p_unit_id,
      special_instructions = btrim(p_special_instructions),
      requires_two_staff = p_requires_two_staff,
      documentation_mode = p_documentation_mode,
      expires_on = p_expires_on,
      updated_at = now()
  where id = p_requirement_id;
  update public.resident_service_task_instances
  set status = 'superseded', updated_at = now()
  where requirement_id = p_requirement_id
    and status = 'scheduled'
    and scheduled_start > now();
  perform public.generate_resident_service_tasks(public.pa_today(), public.pa_today() + 14, p_requirement_id);
  return true;
end;
$function$
;

-- public.upsert_compliance_requirement
CREATE OR REPLACE FUNCTION public.upsert_compliance_requirement(p_id uuid, p_facility_id uuid, p_building_id uuid, p_category text, p_title text, p_description text, p_regulation_citation text, p_regulation_chapter text, p_responsible_profile_id uuid, p_recurrence text, p_custom_interval_days integer, p_anchor_date date, p_warning_days integer, p_requires_evidence boolean, p_requires_review boolean, p_is_template boolean DEFAULT false, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS compliance_requirements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.compliance_requirements%rowtype;
  v_org uuid;
  v_is_new boolean := p_id is null;
begin
  if length(btrim(coalesce(p_title, ''))) < 1 then
    raise exception 'A title is required' using errcode = '22023';
  end if;

  if v_is_new then
    -- Derive org from the facility (authoritative) for live requirements; use the caller's org for
    -- templates. The scope guard then confirms the caller may write there.
    v_org := coalesce(
      (select f.organization_id from public.facilities f where f.id = p_facility_id),
      p_organization_id,
      (select public.current_org_id())
    );
    if v_org is null then
      raise exception 'An organization is required' using errcode = '22023';
    end if;
    perform app_private.assert_compliance_manager(v_org, p_facility_id);
    if p_is_template then perform app_private.assert_compliance_org_admin(v_org); end if;

    if p_building_id is not null and not exists (
      select 1 from public.facility_buildings b where b.id = p_building_id and b.facility_id = p_facility_id
    ) then
      raise exception 'The selected building is not in this facility' using errcode = '23514';
    end if;
    if p_responsible_profile_id is not null and not exists (
      select 1 from public.profiles p where p.id = p_responsible_profile_id and p.organization_id = v_org
    ) then
      raise exception 'The responsible person is not in this organization' using errcode = '23514';
    end if;

    insert into public.compliance_requirements (
      organization_id, facility_id, building_id, category, title, description,
      regulation_citation, regulation_chapter, responsible_profile_id, recurrence,
      custom_interval_days, anchor_date, warning_days, requires_evidence, requires_review,
      is_template, created_by
    ) values (
      v_org, case when p_is_template then null else p_facility_id end,
      case when p_is_template then null else p_building_id end,
      p_category, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
      nullif(btrim(coalesce(p_regulation_citation, '')), ''), p_regulation_chapter,
      p_responsible_profile_id, coalesce(p_recurrence, 'annual'),
      case when coalesce(p_recurrence, 'annual') = 'custom' then p_custom_interval_days else null end,
      p_anchor_date, coalesce(p_warning_days, 14), coalesce(p_requires_evidence, true),
      coalesce(p_requires_review, false), coalesce(p_is_template, false), (select auth.uid())
    ) returning * into r;

    insert into public.compliance_requirement_events
      (organization_id, facility_id, requirement_id, event_type, actor_profile_id, note)
    values (r.organization_id, r.facility_id, r.id, 'requirement_created', (select auth.uid()), r.title);
  else
    select * into r from public.compliance_requirements where id = p_id for update;
    if not found then raise exception 'Requirement not found' using errcode = 'P0002'; end if;
    perform app_private.assert_compliance_manager(r.organization_id, r.facility_id);
    if r.is_template then perform app_private.assert_compliance_org_admin(r.organization_id); end if;

    if p_building_id is not null and r.facility_id is not null and not exists (
      select 1 from public.facility_buildings b where b.id = p_building_id and b.facility_id = r.facility_id
    ) then
      raise exception 'The selected building is not in this facility' using errcode = '23514';
    end if;
    if p_responsible_profile_id is not null and not exists (
      select 1 from public.profiles p where p.id = p_responsible_profile_id and p.organization_id = r.organization_id
    ) then
      raise exception 'The responsible person is not in this organization' using errcode = '23514';
    end if;

    -- facility_id and is_template are immutable after creation (changing them would orphan instances).
    update public.compliance_requirements set
      building_id = case when r.facility_id is null then null else p_building_id end,
      category = p_category,
      title = btrim(p_title),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      regulation_citation = nullif(btrim(coalesce(p_regulation_citation, '')), ''),
      regulation_chapter = p_regulation_chapter,
      responsible_profile_id = p_responsible_profile_id,
      recurrence = coalesce(p_recurrence, recurrence),
      custom_interval_days = case when coalesce(p_recurrence, recurrence) = 'custom' then p_custom_interval_days else null end,
      anchor_date = p_anchor_date,
      warning_days = coalesce(p_warning_days, warning_days),
      requires_evidence = coalesce(p_requires_evidence, requires_evidence),
      requires_review = coalesce(p_requires_review, requires_review)
    where id = r.id returning * into r;

    insert into public.compliance_requirement_events
      (organization_id, facility_id, requirement_id, event_type, actor_profile_id, note)
    values (r.organization_id, r.facility_id, r.id, 'requirement_updated', (select auth.uid()), r.title);

    -- Reconcile future occurrences to the (possibly changed) cadence/anchor: drop unstarted,
    -- evidence-free future occurrences so the generator below re-materializes them on the current
    -- schedule. Started, past, and terminal occurrences are preserved. (Changing a monthly requirement
    -- to one_time or moving its anchor otherwise leaves stale future occurrences on the old schedule.)
    if not r.is_template then
      delete from public.compliance_requirement_instances
      where requirement_id = r.id and status = 'not_started' and evidence_count = 0 and due_date > public.pa_today();
    end if;
  end if;

  -- Materialize the current/next occurrence(s) for a live active requirement.
  if not r.is_template and r.is_active then
    perform app_private.ensure_compliance_instances(r.id, public.pa_today() + greatest(r.warning_days, 30));
  end if;

  return r;
end $function$
;

-- public.upsert_resident_dietary_profile
CREATE OR REPLACE FUNCTION public.upsert_resident_dietary_profile(p_resident_id uuid, p_profile jsonb, p_change_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform pg_advisory_xact_lock(hashtext('resident_dietary_profiles'), hashtext(v_resident.id::text));
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
    coalesce(nullif(p_profile->>'effectiveDate', '')::date, public.pa_today()),
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
end;
$function$
;

-- public.verify_work_order
CREATE OR REPLACE FUNCTION public.verify_work_order(p_work_order_id uuid, p_decision text, p_verification_notes text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.work_orders%rowtype;
  v_verifier_name text;
begin
  select * into v from public.work_orders where id = p_work_order_id for update;
  if not found then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  if v.status <> 'pending_verification' then
    raise exception 'Only work awaiting verification can be reviewed' using errcode = '55000';
  end if;
  if p_decision not in ('verified','reopened') or length(btrim(coalesce(p_verification_notes, ''))) < 3 then
    raise exception 'A valid verification decision and notes are required' using errcode = '22023';
  end if;
  if not (public.is_platform_admin() or (
    v.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager')
    and public.is_assigned_to_facility(v.facility_id)
  )) then raise exception 'Supervisor verification is required' using errcode = '42501'; end if;

  if p_decision = 'verified' then
    update public.work_orders set
      status = 'verified', verified_by_profile_id = auth.uid(), verified_at = now(),
      verification_notes = btrim(p_verification_notes)
    where id = v.id;
    if v.source_inspection_event_id is not null then
      update public.inspection_events set
        follow_up_required = false,
        notes = concat_ws(E'\n', nullif(notes, ''), format('%s repair verified: %s', v.work_order_number, btrim(p_verification_notes)))
      where id = v.source_inspection_event_id;
    end if;
    if v.inspection_item_id is not null then
      select concat_ws(' ', p.first_name, p.last_name) into v_verifier_name
      from public.profiles p where p.id = auth.uid();
      insert into public.inspection_events(
        organization_id, facility_id, inspection_item_id, performed_date,
        performed_by, performed_by_profile_id, result, follow_up_required, notes
      ) values (
        v.organization_id, v.facility_id, v.inspection_item_id, public.pa_today(),
        coalesce(nullif(v_verifier_name, ''), 'Maintenance supervisor'), auth.uid(),
        'pass', false, format('%s verified after repair: %s', v.work_order_number, btrim(p_verification_notes))
      );
      update public.inspection_items i set
        last_inspected_date = public.pa_today(),
        next_due_date = public.pa_today() + i.inspection_interval_days,
        status = 'compliant'
      where i.id = v.inspection_item_id;
    end if;
  else
    update public.work_orders set
      status = 'in_progress', completed_by_profile_id = null, completed_at = null,
      verified_by_profile_id = null, verified_at = null,
      verification_notes = btrim(p_verification_notes)
    where id = v.id;
  end if;
  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, prior_status,
    resulting_status, actor_profile_id, notes
  ) values (
    v.organization_id, v.facility_id, v.id,
    case when p_decision = 'verified' then 'verified' else 'reopened' end,
    v.status, case when p_decision = 'verified' then 'verified' else 'in_progress' end,
    auth.uid(), btrim(p_verification_notes)
  );
  return true;
end;
$function$
;


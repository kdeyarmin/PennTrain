-- Resident 360 care header (program plan Phase 1a).
--
-- The resident record already carries most of what an operational header needs -- photo
-- (`photo_document_id`), room, admission, hospice/SDCU, `mobility_summary`,
-- `supervision_requirements`, `food_allergies`, `advance_directive_status` -- and derivable facts
-- live in `resident_dietary_profiles`, `hospital_transfer_episodes`, `resident_assessment_forms`,
-- and `resident_support_plans`. What is missing is the small set of *coded* care attributes staff
-- need at a glance, and one read model that composes stored + derived so the header, the printable
-- face sheet, and (later) floor task cards all read the same source.
--
-- Placement decision. These columns go on `public.residents` rather than a new clinical-lane table,
-- matching the existing precedent: `food_allergies`, `dietary_requirements`, `mobility_summary`,
-- `supervision_requirements`, and `advance_directive_status` already live here under ordinary
-- resident RLS, and the same functional content already lives in `resident_assessment_forms`
-- (which its own schema comment acknowledges holds real functional-assessment content). Two of the
-- new columns are genuinely clinical in nature:
--
--   * `allergies` is the operational, staff-visible summary of NON-FOOD allergies. Food allergies
--     stay in `residents.food_allergies` / `resident_dietary_profiles.food_allergies`, which the
--     dietary module owns. Where a facility has clinical enablement and a connected FHIR allergy
--     lane (see docs/HIPAA_CLINICAL_DATA.md), that lane remains authoritative -- this column is a
--     posted summary, and the header labels it as such rather than implying reconciliation.
--   * `code_status` records resuscitation preference. It is deliberately distinct from the existing
--     `advance_directive_status`, which records whether a *document* is on file, not what it says.
--
-- `level_of_care` is the CLINICAL care level. It is deliberately NOT the billed level of care
-- (`resident_rate_agreements.level_of_care_charge`); careLevelReview.ts exists precisely to compare
-- assessed acuity against the billed level, and collapsing the two would delete that check. Its
-- values mirror the DHS RASP/ASP Section 1 degree codes (A-D) that PA facilities already assess
-- against, so an assessment answer maps onto it without a translation layer.

alter table public.residents
  add column level_of_care text not null default 'not_assessed'
    check (level_of_care in (
      'not_assessed', 'independent', 'prompting_cueing',
      'some_physical_assistance', 'total_physical_assistance'
    )),
  add column transfer_assistance text not null default 'not_assessed'
    check (transfer_assistance in (
      'not_assessed', 'independent', 'supervision', 'one_person', 'two_person', 'mechanical_lift'
    )),
  add column ambulation_status text not null default 'not_assessed'
    check (ambulation_status in (
      'not_assessed', 'independent', 'cane', 'walker', 'rollator', 'wheelchair', 'bedfast'
    )),
  add column fall_risk text not null default 'not_assessed'
    check (fall_risk in ('not_assessed', 'low', 'moderate', 'high')),
  add column elopement_risk text not null default 'not_assessed'
    check (elopement_risk in ('not_assessed', 'none', 'monitored', 'high')),
  add column cognitive_status text not null default 'not_assessed'
    check (cognitive_status in (
      'not_assessed', 'no_impairment', 'mild_impairment', 'moderate_impairment', 'severe_impairment'
    )),
  add column code_status text not null default 'not_documented'
    check (code_status in ('not_documented', 'full_code', 'dnr', 'dnr_dni', 'polst_on_file')),
  add column allergies text[] not null default array[]::text[],
  add column care_profile_reviewed_at timestamptz,
  add column care_profile_reviewed_by uuid references public.profiles(id) on delete set null;

comment on column public.residents.level_of_care is
  'Clinical care level (RASP/ASP Section 1 degree scale). Not the billed level of care -- see resident_rate_agreements.level_of_care_charge.';
comment on column public.residents.allergies is
  'Non-food allergies posted for staff visibility. Food allergies live in food_allergies; a connected FHIR allergy lane stays authoritative where enabled.';
comment on column public.residents.code_status is
  'Resuscitation preference. Distinct from advance_directive_status, which records whether a directive document is on file.';

-- Every column above defaults to an explicit "not assessed" / "not documented" value rather than
-- NULL so the header can never imply that an unanswered field means "no risk". Existing rows adopt
-- the defaults; nothing is backfilled from free-text `mobility_summary` or `supervision_requirements`,
-- because inferring a coded risk level from prose is exactly the kind of quiet guess a survey would
-- punish. Those free-text fields remain, and the header shows them alongside the coded values.

-- ---------------------------------------------------------------------------
-- Write path
-- ---------------------------------------------------------------------------

create or replace function public.save_resident_care_profile(
  p_resident_id uuid,
  p_profile jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resident public.residents%rowtype;
  v_actor uuid := auth.uid();
  v_allergies text[];
begin
  select * into v_resident from public.residents where id = p_resident_id for update;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);

  if jsonb_typeof(coalesce(p_profile, '{}'::jsonb)) <> 'object' then
    raise exception 'Care profile payload is invalid' using errcode = '22023';
  end if;

  if p_profile ? 'allergies' then
    if jsonb_typeof(p_profile -> 'allergies') <> 'array' then
      raise exception 'Care profile allergies must be an array' using errcode = '22023';
    end if;
    -- Drop blanks and duplicates server-side so the header never renders an empty allergy chip.
    select coalesce(array_agg(distinct btrim(value)) filter (where btrim(value) <> ''), array[]::text[])
      into v_allergies
      from jsonb_array_elements_text(p_profile -> 'allergies') as value;
  else
    v_allergies := v_resident.allergies;
  end if;

  update public.residents set
    level_of_care = case when p_profile ? 'level_of_care'
      then coalesce(nullif(btrim(p_profile ->> 'level_of_care'), ''), 'not_assessed') else level_of_care end,
    transfer_assistance = case when p_profile ? 'transfer_assistance'
      then coalesce(nullif(btrim(p_profile ->> 'transfer_assistance'), ''), 'not_assessed') else transfer_assistance end,
    ambulation_status = case when p_profile ? 'ambulation_status'
      then coalesce(nullif(btrim(p_profile ->> 'ambulation_status'), ''), 'not_assessed') else ambulation_status end,
    fall_risk = case when p_profile ? 'fall_risk'
      then coalesce(nullif(btrim(p_profile ->> 'fall_risk'), ''), 'not_assessed') else fall_risk end,
    elopement_risk = case when p_profile ? 'elopement_risk'
      then coalesce(nullif(btrim(p_profile ->> 'elopement_risk'), ''), 'not_assessed') else elopement_risk end,
    cognitive_status = case when p_profile ? 'cognitive_status'
      then coalesce(nullif(btrim(p_profile ->> 'cognitive_status'), ''), 'not_assessed') else cognitive_status end,
    code_status = case when p_profile ? 'code_status'
      then coalesce(nullif(btrim(p_profile ->> 'code_status'), ''), 'not_documented') else code_status end,
    allergies = v_allergies,
    mobility_summary = case when p_profile ? 'mobility_summary'
      then nullif(btrim(p_profile ->> 'mobility_summary'), '') else mobility_summary end,
    supervision_requirements = case when p_profile ? 'supervision_requirements'
      then nullif(btrim(p_profile ->> 'supervision_requirements'), '') else supervision_requirements end,
    care_profile_reviewed_at = now(),
    care_profile_reviewed_by = v_actor,
    updated_at = now()
  where id = p_resident_id;

  -- The check constraints above reject an unknown coded value, so an invalid payload fails the
  -- UPDATE rather than silently storing junk; the history row below is only reached on success.
  insert into public.resident_administrative_history (
    organization_id, facility_id, resident_id, event_type, summary, snapshot, actor_profile_id
  )
  select
    r.organization_id, r.facility_id, r.id, 'care_profile_reviewed',
    'Care header reviewed',
    jsonb_build_object(
      'level_of_care', r.level_of_care,
      'transfer_assistance', r.transfer_assistance,
      'ambulation_status', r.ambulation_status,
      'fall_risk', r.fall_risk,
      'elopement_risk', r.elopement_risk,
      'cognitive_status', r.cognitive_status,
      'code_status', r.code_status,
      'allergies', to_jsonb(r.allergies)
    ),
    v_actor
  from public.residents r where r.id = p_resident_id;

  return true;
end;
$$;

revoke all on function public.save_resident_care_profile(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_resident_care_profile(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read model
-- ---------------------------------------------------------------------------
--
-- security invoker: every table read below is RLS-protected, so a caller who cannot see the dietary
-- profile or the support plan gets a null block rather than a leak. The header renders those as
-- "not available" instead of asserting a value it did not read.
--
-- Every derived block carries its own `asOf` so the UI can show staleness rather than implying the
-- value is current.

create or replace function public.get_resident_care_header(p_resident_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_resident public.residents%rowtype;
  v_facility public.facilities%rowtype;
  v_diet public.resident_dietary_profiles%rowtype;
  v_hospital public.hospital_transfer_episodes%rowtype;
  v_plan public.resident_support_plans%rowtype;
  v_assessment_at date;
  v_assessment_label text;
  v_hospital_state text;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then
    raise exception 'Resident was not found or is outside caller scope' using errcode = 'P0002';
  end if;

  select * into v_facility from public.facilities where id = v_resident.facility_id;

  -- Latest dietary profile version wins; the dietary module versions rather than mutates.
  select * into v_diet from public.resident_dietary_profiles d
    where d.resident_id = v_resident.id
    order by d.effective_date desc, d.version desc limit 1;

  -- Most recent episode that still matters: either currently out, or returned recently enough that
  -- reconciliation could still be open.
  select * into v_hospital from public.hospital_transfer_episodes h
    where h.resident_id = v_resident.id and h.status <> 'canceled'
    order by h.transfer_time desc limit 1;

  -- Prefer the effective plan; fall back to the newest version so the header can say "draft v3"
  -- rather than going blank while a revision is in flight.
  select * into v_plan from public.resident_support_plans p
    where p.resident_id = v_resident.id
    order by (p.state = 'effective') desc, p.version_number desc limit 1;

  -- The legally meaningful assessment date is the completed state-form compliance item, not the
  -- in-app drafting record, so read that first and fall back to a finalized digital form.
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

  -- Reconciliation is "incomplete" only while a concrete return step is still pending. Anything
  -- older than 30 days stops driving the header so a long-abandoned episode cannot pin a resident
  -- to a permanent alarm state -- the open work item, not the header, is what chases stale returns.
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
    ) end
  );
end;
$$;

revoke all on function public.get_resident_care_header(uuid) from public, anon;
grant execute on function public.get_resident_care_header(uuid) to authenticated, service_role;

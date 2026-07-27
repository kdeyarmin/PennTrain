-- A support plan stuck in 'approved' past its effective date is visible, and a manager can fix it.
--
-- THE GAP, which the PR flagged as "worth a reviewer's eye" and which is worse than it reads.
--
-- 20260726020100 split approval from activation so a plan can be signed off today with an effective
-- date next Monday. Promotion is done by activate_due_support_plans(), scheduled with pg_cron behind
-- an extension check so a stack without pg_cron does not fail the migration.
--
-- On such a stack the promotion silently never happens. And the consequence is not cosmetic:
-- app_private.activate_support_plan() is what supersedes the prior plan AND regenerates
-- resident_service_requirements. A plan stuck in 'approved' means the resident's floor tasks keep
-- being generated from the OLD version -- staff deliver the previous plan's care while the record
-- says a newer one was approved.
--
-- Worse, there was no remedy. app_private.activate_support_plan is revoked from public, anon,
-- authenticated AND service_role; activate_due_support_plans is granted to service_role only. So a
-- facility that noticed could do nothing about it, and had no way to notice in the first place --
-- get_resident_care_header() orders by (state = 'active') desc, so it returns the OLD active plan
-- and the stalled newer one is invisible on the resident's page.
--
-- WHAT THIS ADDS.
--
--   1. public.activate_due_support_plan(plan_id) -- a care manager can promote a plan whose
--      effective date HAS ARRIVED. Deliberately not "activate any approved plan": future-dating is
--      a clinical decision someone made, and letting the UI override it would turn a safety
--      property into a button. A plan not yet due is refused.
--
--   2. get_resident_care_header() gains a `pendingActivation` block, so the condition is detectable
--      from the surface that already loads on every resident page.
--
-- Detection is by SYMPTOM, not by cause. It reports "an approved plan is past its effective date and
-- still not active" without asking why -- which covers pg_cron being absent, the job being
-- unscheduled later, and the job erroring, all of which look identical to the resident.
--
-- Rollback: drop activate_due_support_plan and restore get_resident_care_header from 20260726020100.

create or replace function public.activate_due_support_plan(p_plan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
  if v.effective_date is null or v.effective_date > current_date then
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
end $$;
revoke all on function public.activate_due_support_plan(uuid) from public, anon;
grant execute on function public.activate_due_support_plan(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Make the condition visible where the resident page already looks
-- ---------------------------------------------------------------------------

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
      and p.effective_date <= current_date
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
$$;
revoke all on function public.get_resident_care_header(uuid) from public, anon;
grant execute on function public.get_resident_care_header(uuid) to authenticated, service_role;

-- Hospital return reconciliation that actually produces work (program plan Phase 5b).
--
-- `hospital_transfer_episodes` already modelled the departure and the return in detail, including
-- `assessment_review_required` and `support_plan_review_required`. Nothing read those flags. A
-- return could record "yes, this needs a reassessment" and then produce no assessment, no owned
-- task, and no trace on the resident's timeline.
--
-- Three gaps closed here:
--   1. Hospital episodes and assessment reviews never appeared on the resident timeline, so the
--      single most consequential event in a resident's month was invisible on the record designed
--      to show their history.
--   2. `assessment_review_required` now seeds a draft hospital-return review (Phase 2b template)
--      linked to the episode, so the reassessment exists as a real, findable record rather than an
--      intention stored in a boolean.
--   3. Closing a return is gated: `complete_hospital_return_reconciliation` refuses while required
--      steps are outstanding, and closes the follow-up work item when they are done.

-- ---------------------------------------------------------------------------
-- 1. Seed the return review when the return says one is needed
-- ---------------------------------------------------------------------------

create or replace function public.complete_hospital_return(
  p_episode_id uuid,
  p_return_time timestamptz,
  p_discharge_document_id uuid default null,
  p_changed_order_ack_status text default 'pending_review',
  p_medication_reconciliation_status text default 'pending',
  p_condition_changes text default null,
  p_diet_changes text default null,
  p_mobility_changes text default null,
  p_skin_concerns text default null,
  p_dme_changes text default null,
  p_assessment_review_required boolean default true,
  p_support_plan_review_required boolean default true
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.hospital_transfer_episodes%rowtype; v_work uuid;
begin
  select * into v from public.hospital_transfer_episodes where id=p_episode_id for update;
  if not found then raise exception 'Transfer episode not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status <> 'out' or p_return_time < v.transfer_time then
    raise exception 'Invalid hospital return request' using errcode='22023';
  end if;

  insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,priority,due_at,state,created_by)
  values(v.organization_id,v.facility_id,'rule_exception',v.id,'hospital-return-follow-up:'||v.id,'Complete hospital-return follow-up','Review discharge documents, order acknowledgement status, assessment/support-plan needs, services, DME, and staff notifications.','high',p_return_time+interval '24 hours','open',auth.uid())
  on conflict (organization_id,deduplication_key) do update set updated_at=now()
  returning id into v_work;

  update public.hospital_transfer_episodes set
    status='returned', return_time=p_return_time, discharge_document_id=p_discharge_document_id,
    changed_order_ack_status=p_changed_order_ack_status,
    medication_reconciliation_status=p_medication_reconciliation_status,
    condition_changes=p_condition_changes, diet_changes=p_diet_changes,
    mobility_changes=p_mobility_changes, skin_concerns=p_skin_concerns, dme_changes=p_dme_changes,
    assessment_review_required=p_assessment_review_required,
    support_plan_review_required=p_support_plan_review_required,
    return_work_item_id=v_work, updated_at=now()
  where id=v.id;

  -- A boolean that nothing reads is not a requirement. When the return says a reassessment is
  -- needed, create the draft review now, linked to this episode, so it is a findable record with a
  -- template behind it rather than an intention. Pre-filled with what the return already recorded,
  -- because asking someone to retype it is how it gets skipped.
  if p_assessment_review_required and not exists (
    select 1 from public.resident_assessment_reviews r
    where r.hospital_episode_id = v.id and r.template_key = 'hospital_return_review'
  ) then
    insert into public.resident_assessment_reviews(
      organization_id, facility_id, resident_id, template_key, template_version,
      answers, hospital_episode_id, review_date, created_by
    )
    values (
      v.organization_id, v.facility_id, v.resident_id, 'hospital_return_review', 1,
      jsonb_strip_nulls(jsonb_build_object(
        'discharge_paperwork_received', p_discharge_document_id is not null,
        'new_restrictions', nullif(btrim(coalesce(p_condition_changes, '')), ''),
        'skin_findings', nullif(btrim(coalesce(p_skin_concerns, '')), ''),
        'support_plan_revision_required', p_support_plan_review_required
      )),
      v.id, p_return_time::date, auth.uid()
    )
    -- One draft per resident per template is enforced by a partial unique index; if the resident
    -- already has an open return review from a prior stay, leave it rather than failing the return.
    on conflict do nothing;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='shift_report_entries') then
    insert into public.shift_report_entries(organization_id,facility_id,resident_id,category,priority,shift_period_start,shift_period_end,narrative,author_profile_id,follow_up_owner_profile_id,requires_acknowledgement,linked_work_item_id,idempotency_key)
    values(v.organization_id,v.facility_id,v.resident_id,'hospital_transfer_return','high',p_return_time,p_return_time + interval '8 hours','Resident returned from hospital; complete discharge follow-up before closing.',auth.uid(),auth.uid(),true,v_work,'hospital-return:'||v.id)
    on conflict do nothing;
  end if;

  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values)
  values(v.organization_id,auth.uid(),'hospital_transfer_episode',v.id::text,'hospital_transfer.return_completed',
    jsonb_build_object('returnTime',p_return_time,'workItemId',v_work,'assessmentReviewRequired',p_assessment_review_required));
  return v_work;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Gated closure
-- ---------------------------------------------------------------------------

create or replace function public.complete_hospital_return_reconciliation(
  p_episode_id uuid,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.hospital_transfer_episodes%rowtype;
  v_outstanding text[] := array[]::text[];
  v_review_final boolean;
  v_plan_revised boolean;
begin
  select * into v from public.hospital_transfer_episodes where id = p_episode_id for update;
  if not found then raise exception 'Transfer episode not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status <> 'returned' then
    raise exception 'Only a returned episode can be reconciled' using errcode = '22023';
  end if;

  if v.discharge_document_id is null then
    v_outstanding := v_outstanding || 'discharge paperwork';
  end if;
  if v.medication_reconciliation_status not in ('completed', 'authorized_exception', 'not_applicable') then
    v_outstanding := v_outstanding || 'medication reconciliation';
  end if;
  if v.changed_order_ack_status not in ('acknowledged', 'not_applicable') then
    v_outstanding := v_outstanding || 'physician order acknowledgement';
  end if;

  if v.assessment_review_required then
    select exists (
      select 1 from public.resident_assessment_reviews r
      where r.hospital_episode_id = v.id and r.status = 'final'
    ) into v_review_final;
    if not coalesce(v_review_final, false) then
      v_outstanding := v_outstanding || 'hospital-return assessment review';
    end if;
  end if;

  if v.support_plan_review_required then
    -- Either a plan that took effect after the return, or one still in flight being revised because
    -- of it. Requiring an *active* plan would block closure while the revision is legitimately in
    -- clinical review.
    select exists (
      select 1 from public.resident_support_plans p
      where p.resident_id = v.resident_id
        and (
          (p.state = 'active' and p.effective_date >= v.return_time::date)
          or p.state in ('draft','awaiting_clinical_review','awaiting_participation','awaiting_signature','approved')
        )
    ) into v_plan_revised;
    if not coalesce(v_plan_revised, false) then
      v_outstanding := v_outstanding || 'support-plan revision';
    end if;
  end if;

  if cardinality(v_outstanding) > 0 then
    raise exception 'Hospital return cannot be closed while these remain outstanding: %',
      array_to_string(v_outstanding, ', ') using errcode = '22023';
  end if;

  update public.work_items set
    state = 'closed',
    closure_reason = left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Hospital-return reconciliation completed'), 1000),
    closed_at = now(),
    updated_at = now()
  where id = v.return_work_item_id and state not in ('closed', 'canceled');

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'hospital_transfer_episode', v.id::text,
    'hospital_transfer.reconciliation_completed',
    jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')));
  return true;
end $$;

revoke all on function public.complete_hospital_return_reconciliation(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_hospital_return_reconciliation(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Put hospital episodes and assessment reviews on the timeline
-- ---------------------------------------------------------------------------
--
-- The timeline unions incidents, condition changes, services, complaints, compliance items,
-- clinical records, medications, dietary, and finance -- but not the hospital stay, which is the
-- single most consequential event in most residents' months. Same signature and body plus two
-- unions.

create or replace function public.get_resident_timeline(
  p_resident_id uuid,
  p_limit integer default 100
)
returns table(
  occurred_at timestamptz, event_type text, title text, status text,
  detail text, href text, source_id uuid
)
language sql stable security invoker set search_path = '' as $function$
  select event.occurred_at, event.event_type, event.title, event.status,
    event.detail, event.href, event.source_id
  from (
    -- NEW in this migration: the hospital stay, the governed assessment reviews, and unscheduled
    -- care. Every other union below is carried forward verbatim from 20260725150000 -- dropping any
    -- of them would silently empty the clinical chart's timeline.
    select h.transfer_time, 'hospital_transfer'::text event_type,
      'Hospital transfer: ' || coalesce(h.destination, 'hospital') title,
      h.status,
      left(concat_ws(' · ',
        nullif(h.reason, ''),
        case when h.status = 'returned' then 'Returned ' || to_char(h.return_time, 'YYYY-MM-DD') end,
        nullif(h.condition_changes, ''),
        nullif(h.diet_changes, ''),
        nullif(h.mobility_changes, '')
      ), 500) detail,
      '/app/residents/' || h.resident_id::text || '?tab=timeline' href, h.id source_id
    from public.hospital_transfer_episodes h
    where h.resident_id = p_resident_id and h.status <> 'canceled'
    union all
    select coalesce(rr.assessor_signed_at, rr.created_at), 'assessment_review',
      'Review: ' || replace(rr.template_key, '_', ' '), rr.status,
      left(coalesce(rr.assessor_name, ''), 500),
      '/app/residents/' || rr.resident_id::text || '?tab=assessments', rr.id
    from public.resident_assessment_reviews rr where rr.resident_id = p_resident_id
    union all
    select us.occurred_at, 'unscheduled_service',
      'Extra care: ' || replace(us.service_kind, '_', ' '), null::text,
      left(coalesce(us.note, ''), 500), '/app/resident-care-delivery', us.id
    from public.resident_unscheduled_services us where us.resident_id = p_resident_id
    union all
    select i.occurred_at, 'incident',
      'Incident: ' || replace(i.incident_type, '_', ' '),
      i.status, left(i.narrative, 500),
      '/app/incidents/' || i.id::text, i.id
    from public.incidents i where i.resident_id = p_resident_id
    union all
    select c.identified_at, 'change_of_condition',
      'Condition change: ' || replace(c.category, '_', ' '), c.status,
      left(c.immediate_observations, 500), '/app/change-of-condition/' || c.id::text, c.id
    from public.resident_change_events c where c.resident_id = p_resident_id
    union all
    -- completion_response is preferred over status so the timeline shows what staff documented
    -- ("completed with more assistance") rather than only that the task closed.
    select coalesce(s.performed_at, s.scheduled_start), 'resident_service',
      'Service: ' || s.service_name, coalesce(s.completion_response, s.status),
      left(s.note, 500), '/app/services', s.id
    from public.resident_service_task_instances s where s.resident_id = p_resident_id
    union all
    select co.created_at, 'complaint', 'Complaint: ' || replace(co.category, '_', ' '),
      co.status, left(co.description, 500), '/app/complaints/' || co.id::text, co.id
    from public.complaints co where co.resident_id = p_resident_id
    union all
    select rc.updated_at, 'compliance', 'Compliance: ' || replace(rc.item_type, '_', ' '),
      rc.status, left(rc.notes, 500), '/app/residents/' || rc.resident_id::text, rc.id
    from public.resident_compliance_items rc where rc.resident_id = p_resident_id
    union all
    select d.occurred_at, 'dietary', 'Dietary: ' || replace(d.event_type, '_', ' '),
      null::text, left(d.summary, 500), '/app/dietary-operations?resident=' || d.resident_id::text, d.id
    from public.dietary_operations_history d where d.resident_id = p_resident_id
    union all
    select f.created_at, 'financial', 'Financial: ' || replace(f.event_type, '_', ' '),
      null::text, left(f.summary, 500), '/app/resident-finance?resident=' || f.resident_id::text, f.id
    from public.resident_financial_history f where f.resident_id = p_resident_id
    union all
    select a.occurred_at, 'external_medication',
      'External eMAR: ' || replace(a.administration_status, '_', ' '),
      a.administration_status,
      left(coalesce(o.medication_display, 'Medication administration evidence'), 500),
      '/app/medication-integration?resident=' || a.resident_id::text, a.id
    from public.external_medication_administration_events a
    left join public.external_medication_orders o
      on o.source_id = a.source_id and o.external_order_id = a.external_order_id
    where a.resident_id = p_resident_id
    union all
    select ob.observed_at, 'vital',
      'Vital: ' || replace(ob.observation_type, '_', ' '), ob.abnormal_flag,
      coalesce(ob.value_numeric::text, ob.value_text) || coalesce(' ' || ob.unit, ''),
      '/app/residents/' || ob.resident_id::text || '/chart', ob.id
    from public.clinical_observations ob
    where ob.resident_id = p_resident_id and not ob.entered_in_error
    union all
    select n.authored_at, 'progress_note',
      'Note: ' || replace(n.note_type, '_', ' '), n.status, left(n.body, 500),
      '/app/residents/' || n.resident_id::text || '/chart', n.id
    from public.clinical_progress_notes n where n.resident_id = p_resident_id
    union all
    select ca.assessed_at, 'assessment',
      'Assessment: ' || replace(ca.assessment_type, '_', ' '), ca.status,
      coalesce('Score ' || ca.score::text, '') || coalesce(' · ' || ca.risk_band, ''),
      '/app/residents/' || ca.resident_id::text || '/chart', ca.id
    from public.clinical_assessments ca where ca.resident_id = p_resident_id
    union all
    select coalesce(fc.recorded_date, fc.source_updated_at), 'diagnosis',
      'Diagnosis: ' || fc.code_display, fc.clinical_status, fc.code,
      '/app/residents/' || fc.resident_id::text || '/chart', fc.id
    from public.fhir_conditions fc where fc.resident_id = p_resident_id
    union all
    select coalesce(fm.authored_on, fm.source_updated_at), 'medication',
      'Medication: ' || fm.medication_display, fm.request_status, fm.dosage_text,
      '/app/residents/' || fm.resident_id::text || '/chart', fm.id
    from public.fhir_medication_requests fm where fm.resident_id = p_resident_id
  ) event
  where event.occurred_at is not null
  order by event.occurred_at desc, event.source_id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$;

revoke all on function public.get_resident_timeline(uuid, integer) from public, anon;
grant execute on function public.get_resident_timeline(uuid, integer) to authenticated, service_role;

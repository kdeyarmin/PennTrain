-- EHR M5: chart consolidation, unified timeline, and write-back reservation.
--
-- Ties the clinical domains together: the resident timeline now includes native and FHIR
-- clinical events, and a single consolidated chart-summary RPC returns the face-sheet view
-- (allergies, problems, active meds, latest vitals, recent notes) while writing a HIPAA
-- access-log entry. Outbound FHIR write-back is reserved but deliberately disabled.

-- 1. Reserve (disabled) write-back scope + permission. Native clinical data could later be
--    pushed back to an external FHIR endpoint as Observation/DocumentReference; that capability
--    is intentionally NOT enabled here -- the boundary stays read-only.
insert into public.integration_api_scope_definitions(scope_key, description, risk_level, is_active)
values ('clinical.writeback', 'Reserved (disabled): write native clinical data back to an external FHIR endpoint', 'write', false)
on conflict (scope_key) do update set description = excluded.description, is_active = false;

insert into public.permission_definitions(permission_key, description, risk_level)
values ('clinical.integration.writeback', 'Reserved (not yet enabled): push native clinical data to an external FHIR endpoint', 'privileged')
on conflict (permission_key) do nothing;

-- 2. Extend the resident timeline (security invoker -- RLS on each source governs visibility)
--    with native and FHIR clinical events. Preserves every existing union.
create or replace function public.get_resident_timeline(
  p_resident_id uuid,
  p_limit integer default 100
)
returns table(
  occurred_at timestamptz, event_type text, title text, status text,
  detail text, href text, source_id uuid
)
language sql stable security invoker set search_path = '' as $$
  select event.occurred_at, event.event_type, event.title, event.status,
    event.detail, event.href, event.source_id
  from (
    select i.occurred_at, 'incident'::text event_type,
      'Incident: ' || replace(i.incident_type, '_', ' ') title,
      i.status, left(i.narrative, 500) detail,
      '/app/incidents/' || i.id::text href, i.id source_id
    from public.incidents i where i.resident_id = p_resident_id
    union all
    select c.identified_at, 'change_of_condition',
      'Condition change: ' || replace(c.category, '_', ' '), c.status,
      left(c.immediate_observations, 500), '/app/change-of-condition/' || c.id::text, c.id
    from public.resident_change_events c where c.resident_id = p_resident_id
    union all
    select coalesce(s.performed_at, s.scheduled_start), 'resident_service',
      'Service: ' || s.service_name, s.status, left(s.note, 500), '/app/services', s.id
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
  order by event.occurred_at desc, event.source_id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- 3. Consolidated clinical face-sheet summary (SECURITY DEFINER + access logging).
create or replace function public.get_resident_clinical_chart(
  p_resident_id uuid,
  p_minimum_necessary_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_res public.residents%rowtype; v_result jsonb;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  if not app_private.clinical_record_visible(v_res.organization_id, v_res.facility_id) then
    raise exception 'Clinical access is outside caller scope' using errcode = '42501';
  end if;
  perform public.log_clinical_access(p_resident_id, 'view_chart', 'summary', p_minimum_necessary_reason, null);
  select jsonb_build_object(
    'resident', jsonb_build_object(
      'id', v_res.id, 'firstName', v_res.first_name, 'lastName', v_res.last_name,
      'room', v_res.room, 'clinicalDataConsent', v_res.clinical_data_consent
    ),
    'allergies', coalesce((
      select jsonb_agg(jsonb_build_object('substance', a.substance_display, 'criticality', a.criticality,
        'clinicalStatus', a.clinical_status) order by a.substance_display)
      from public.fhir_allergy_intolerances a
      where a.resident_id = p_resident_id and coalesce(a.clinical_status, 'active') not in ('inactive', 'resolved')
    ), '[]'::jsonb),
    'problems', coalesce((
      select jsonb_agg(jsonb_build_object('display', c.code_display, 'code', c.code,
        'clinicalStatus', c.clinical_status) order by c.source_updated_at desc)
      from public.fhir_conditions c
      where c.resident_id = p_resident_id and coalesce(c.clinical_status, 'active') not in ('inactive', 'resolved')
    ), '[]'::jsonb),
    'medications', coalesce((
      select jsonb_agg(jsonb_build_object('display', m.medication_display, 'status', m.request_status,
        'rxnorm', m.rxnorm_code) order by m.source_updated_at desc)
      from public.fhir_medication_requests m
      where m.resident_id = p_resident_id and m.request_status = 'active'
    ), '[]'::jsonb),
    'latestVitals', coalesce((
      select jsonb_agg(to_jsonb(latest))
      from (
        select distinct on (o.observation_type) o.observation_type, o.value_numeric, o.value_secondary,
          o.value_text, o.unit, o.abnormal_flag, o.observed_at
        from public.clinical_observations o
        where o.resident_id = p_resident_id and not o.entered_in_error
        order by o.observation_type, o.observed_at desc
      ) latest
    ), '[]'::jsonb),
    'recentNotes', coalesce((
      select jsonb_agg(jsonb_build_object('noteType', recent.note_type, 'status', recent.status,
        'authoredAt', recent.authored_at))
      from (
        select n.note_type, n.status, n.authored_at
        from public.clinical_progress_notes n
        where n.resident_id = p_resident_id and n.status <> 'entered_in_error'
        order by n.authored_at desc limit 5
      ) recent
    ), '[]'::jsonb),
    'recentAssessments', coalesce((
      select jsonb_agg(jsonb_build_object('assessmentType', ra.assessment_type, 'score', ra.score,
        'riskBand', ra.risk_band, 'status', ra.status, 'assessedAt', ra.assessed_at))
      from (
        select ca.assessment_type, ca.score, ca.risk_band, ca.status, ca.assessed_at
        from public.clinical_assessments ca
        where ca.resident_id = p_resident_id
        order by ca.assessed_at desc limit 5
      ) ra
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_resident_clinical_chart(uuid, text) from public, anon, service_role;
grant execute on function public.get_resident_clinical_chart(uuid, text) to authenticated;

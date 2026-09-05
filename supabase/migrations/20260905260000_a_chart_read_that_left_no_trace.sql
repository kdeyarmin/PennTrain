-- I15 residual: a chart read that left no trace.
--
-- app_private.clinical_access_log exists so a facility can answer "who looked at this resident's
-- record". Two functions wrote to it -- get_resident_clinical_chart and
-- get_resident_clinical_observations -- and those are not the surfaces staff actually use. The care
-- documentation tab, the FHIR half of the clinical chart and the resident timeline all read the
-- clinical tables straight through PostgREST, so opening a resident's care plans, progress notes,
-- assessments, diagnoses, allergies and medication list produced no log row at all. The log recorded
-- the two least-used doors into the record and none of the three busiest.
--
-- What this migration changes:
--
--   1. public.can_read_clinical_record(org, facility) -- one predicate for "may this caller read
--      this resident's clinical record", combining the scope test with the CareBase module
--      entitlement. Every clinical table's RLS is (clinical_record_visible AND
--      has_product_module('modules.carebase')), but the three definer functions checked only the
--      first half, so an organization whose CareBase entitlement had lapsed could still read a
--      chart through the RPC that the same read through PostgREST would have refused.
--   2. get_resident_clinical_care and get_resident_clinical_fhir -- logged readers for the two
--      per-resident surfaces that had none, returning the same shapes the hooks already built so
--      the pages above them are unchanged. Each writes one row per clinical domain it discloses,
--      in the vocabulary the log already uses, so a query for "who read the progress notes" finds
--      them.
--   3. get_resident_timeline keeps its invoker rights -- RLS governs all twenty of its branches and
--      that is worth more than a definer's single gate -- but becomes plpgsql so it can write the
--      log row before returning. Five of its branches are clinical: observations, progress notes
--      (500 characters of the body), assessments, diagnoses and medication names.
--   4. get_facility_fhir_ingestion_activity -- the FHIR integration console pulled every medication
--      request and administration in the facility, with select("*"), which includes the whole
--      raw_resource FHIR payload. It renders drug names across every resident on a page whose job
--      is to answer "is the feed working". That is a facility-wide clinical disclosure with no log
--      row and no clinical purpose, so this returns what the console is actually for: per-resident
--      ingestion counts, statuses and recency. No drug name, no dosage, no RxNorm code, no raw
--      payload. The content itself stays one click away on the resident's chart, where reading it
--      is logged. It is SECURITY INVOKER deliberately: the aggregation is then scoped by exactly
--      the same RLS as the reads it replaces, with no second predicate to drift.

------------------------------------------------------------------------------------------------
-- 1. One predicate for clinical readability
------------------------------------------------------------------------------------------------

create or replace function public.can_read_clinical_record(p_org uuid, p_fac uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  -- Both halves of every clinical table's RLS, in one place. app_private.clinical_record_visible is
  -- not reachable from an invoker-rights caller (authenticated has no USAGE on app_private), which
  -- is why this wrapper lives in public: get_resident_timeline runs as the caller and still has to
  -- ask the question before writing a log row.
  select app_private.clinical_record_visible(p_org, p_fac)
     and app_private.has_product_module('modules.carebase');
$function$;

comment on function public.can_read_clinical_record(uuid, uuid) is
  'True when the caller may read the clinical record for this organization/facility: in scope AND '
  'entitled to the CareBase module. Mirrors the two policies on every clinical table.';

revoke all on function public.can_read_clinical_record(uuid, uuid) from public, anon;
grant execute on function public.can_read_clinical_record(uuid, uuid) to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 2. The three existing clinical definers move onto that predicate
------------------------------------------------------------------------------------------------
-- Bodies extracted from the live catalog with pg_get_functiondef and patched at the gate, so
-- nothing else in them can drift.

CREATE OR REPLACE FUNCTION public.log_clinical_access(p_resident_id uuid, p_access_kind text, p_clinical_domain text DEFAULT NULL::text, p_minimum_necessary_reason text DEFAULT NULL::text, p_correlation_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_res public.residents%rowtype;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  if not public.can_read_clinical_record(v_res.organization_id, v_res.facility_id) then
    raise exception 'Clinical access is outside caller scope' using errcode = '42501';
  end if;
  if p_access_kind not in ('view_chart', 'view_domain', 'export', 'print') then
    raise exception 'Invalid clinical access kind' using errcode = '22023';
  end if;
  insert into app_private.clinical_access_log (
    organization_id, facility_id, resident_id, actor_profile_id, actor_role,
    access_kind, clinical_domain, minimum_necessary_reason, correlation_id
  ) values (
    v_res.organization_id, v_res.facility_id, v_res.id, auth.uid(), public.current_role(),
    p_access_kind, nullif(p_clinical_domain, ''),
    nullif(btrim(p_minimum_necessary_reason), ''), nullif(p_correlation_id, '')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_resident_clinical_chart(p_resident_id uuid, p_minimum_necessary_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_res public.residents%rowtype; v_result jsonb;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  if not public.can_read_clinical_record(v_res.organization_id, v_res.facility_id) then
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
$function$;

CREATE OR REPLACE FUNCTION public.get_resident_clinical_observations(p_resident_id uuid, p_observation_type text DEFAULT NULL::text, p_include_retracted boolean DEFAULT false, p_limit integer DEFAULT 200)
 RETURNS SETOF clinical_observations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_res public.residents%rowtype;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  if not public.can_read_clinical_record(v_res.organization_id, v_res.facility_id) then
    raise exception 'Clinical access is outside caller scope' using errcode = '42501';
  end if;
  perform public.log_clinical_access(p_resident_id, 'view_domain', 'vitals_observations', null, null);
  return query
  select o.* from public.clinical_observations o
  where o.resident_id = p_resident_id
    and (p_observation_type is null or o.observation_type = p_observation_type)
    and (p_include_retracted or not o.entered_in_error)
  order by o.observed_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$function$;

------------------------------------------------------------------------------------------------
-- 3. Logged readers for the two per-resident surfaces that had none
------------------------------------------------------------------------------------------------

create or replace function public.get_resident_clinical_care(
  p_resident_id uuid,
  p_minimum_necessary_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_res public.residents%rowtype; v_result jsonb;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  if not public.can_read_clinical_record(v_res.organization_id, v_res.facility_id) then
    raise exception 'Clinical access is outside caller scope' using errcode = '42501';
  end if;
  -- One row per domain, using the vocabulary app_private.clinical_access_log already carries. The
  -- log's job is to answer "who read this resident's progress notes", and a single composite word
  -- for the whole tab would not answer it. Three calls means three resident lookups and three
  -- visibility checks per page open, which is the price of the log saying something true.
  perform public.log_clinical_access(
    p_resident_id, 'view_domain', 'care_plans', p_minimum_necessary_reason, null);
  perform public.log_clinical_access(
    p_resident_id, 'view_domain', 'assessments', p_minimum_necessary_reason, null);
  perform public.log_clinical_access(
    p_resident_id, 'view_domain', 'progress_notes', p_minimum_necessary_reason, null);

  -- Shapes, ordering and limits are the ones useResidentClinicalCare already built client-side, so
  -- ResidentCareDocumentation renders the same rows it did before; only the door changed.
  select jsonb_build_object(
    'carePlans', coalesce((
      select jsonb_agg(to_jsonb(cp) order by cp.created_at desc)
      from public.clinical_care_plans cp where cp.resident_id = p_resident_id
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(to_jsonb(g))
      from public.clinical_care_plan_goals g
      join public.clinical_care_plans cp on cp.id = g.care_plan_id
      where cp.resident_id = p_resident_id
    ), '[]'::jsonb),
    'assessments', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.assessed_at desc)
      from (
        select * from public.clinical_assessments ca
        where ca.resident_id = p_resident_id
        order by ca.assessed_at desc limit 100
      ) a
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.authored_at desc)
      from (
        select * from public.clinical_progress_notes cn
        where cn.resident_id = p_resident_id
        order by cn.authored_at desc limit 100
      ) n
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

comment on function public.get_resident_clinical_care(uuid, text) is
  'Care plans, goals, assessments and progress notes for one resident. Writes a view_domain row per '
  'domain to app_private.clinical_access_log; the direct table reads it replaces wrote nothing.';

revoke all on function public.get_resident_clinical_care(uuid, text) from public, anon;
grant execute on function public.get_resident_clinical_care(uuid, text) to authenticated, service_role;

create or replace function public.get_resident_clinical_fhir(
  p_resident_id uuid,
  p_minimum_necessary_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_res public.residents%rowtype; v_result jsonb;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  if not public.can_read_clinical_record(v_res.organization_id, v_res.facility_id) then
    raise exception 'Clinical access is outside caller scope' using errcode = '42501';
  end if;
  -- Four domains disclosed, four log rows -- see the note in get_resident_clinical_care.
  perform public.log_clinical_access(
    p_resident_id, 'view_domain', 'medications', p_minimum_necessary_reason, null);
  perform public.log_clinical_access(
    p_resident_id, 'view_domain', 'allergies', p_minimum_necessary_reason, null);
  perform public.log_clinical_access(
    p_resident_id, 'view_domain', 'conditions', p_minimum_necessary_reason, null);
  perform public.log_clinical_access(
    p_resident_id, 'view_domain', 'orders', p_minimum_necessary_reason, null);

  -- raw_resource is the entire inbound FHIR resource and raw_record_sha256 is its digest. The chart
  -- renders neither, and select("*") was shipping both to the browser for every row.
  select jsonb_build_object(
    'medications', coalesce((
      select jsonb_agg((to_jsonb(m) - 'raw_resource' - 'raw_record_sha256') order by m.source_updated_at desc)
      from (
        select * from public.fhir_medication_requests fm
        where fm.resident_id = p_resident_id
        order by fm.source_updated_at desc limit 100
      ) m
    ), '[]'::jsonb),
    'allergies', coalesce((
      select jsonb_agg(to_jsonb(a) - 'raw_resource' - 'raw_record_sha256')
      from (
        select * from public.fhir_allergy_intolerances fa
        where fa.resident_id = p_resident_id limit 100
      ) a
    ), '[]'::jsonb),
    'conditions', coalesce((
      select jsonb_agg((to_jsonb(c) - 'raw_resource' - 'raw_record_sha256') order by c.source_updated_at desc)
      from (
        select * from public.fhir_conditions fc
        where fc.resident_id = p_resident_id
        order by fc.source_updated_at desc limit 100
      ) c
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg((to_jsonb(o) - 'raw_resource' - 'raw_record_sha256') order by o.source_updated_at desc)
      from (
        select * from public.fhir_service_requests fs
        where fs.resident_id = p_resident_id
        order by fs.source_updated_at desc limit 100
      ) o
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

comment on function public.get_resident_clinical_fhir(uuid, text) is
  'FHIR-ingested medications, allergies, diagnoses and orders for one resident, minus the raw '
  'inbound payloads. Writes one view_domain row per domain to app_private.clinical_access_log.';

revoke all on function public.get_resident_clinical_fhir(uuid, text) from public, anon;
grant execute on function public.get_resident_clinical_fhir(uuid, text) to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 4. The timeline logs what it discloses
------------------------------------------------------------------------------------------------
-- The timeline spans five clinical domains but shows a digest of each -- an event line, 500
-- characters of a note -- rather than the domain itself, so it gets one word of its own instead of
-- five rows claiming a depth of read that did not happen.

alter table app_private.clinical_access_log
  drop constraint clinical_access_log_clinical_domain_check;
alter table app_private.clinical_access_log
  add constraint clinical_access_log_clinical_domain_check check (
    clinical_domain = any (array[
      'summary', 'medications', 'allergies', 'conditions', 'orders', 'vitals_observations',
      'care_plans', 'assessments', 'progress_notes', 'timeline'
    ])
  );


CREATE OR REPLACE FUNCTION public.get_resident_timeline(p_resident_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(occurred_at timestamp with time zone, event_type text, title text, status text, detail text, href text, source_id uuid)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_res public.residents%rowtype;
begin
  -- Invoker rights, so this select is already scoped by the residents RLS policy; a resident the
  -- caller cannot see yields no row and no log entry, and the union below returns nothing either.
  select * into v_res from public.residents where id = p_resident_id;
  if found and public.can_read_clinical_record(v_res.organization_id, v_res.facility_id) then
    perform public.log_clinical_access(p_resident_id, 'view_domain', 'timeline', null, null);
  end if;
  return query
    select event.occurred_at, event.event_type, event.title, event.status,
      event.detail, event.href, event.source_id
    from (
      -- Every branch is carried forward unchanged from 20260726070100 and 20260828120000 -- dropping
      -- any of them would silently empty the clinical chart's timeline. This body was extracted from
      -- the live catalog with pg_get_functiondef and patched, not retyped.
      -- TRAP, carried forward: a UNION takes its column names from the FIRST branch, and the outer
      -- select references them by name (event.occurred_at). That branch must alias occurred_at
      -- explicitly -- which is why the appointment branch is appended rather than placed first.
      select h.transfer_time as occurred_at, 'hospital_transfer'::text event_type,
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
      union all
      -- An appointment is the most common reason a resident leaves the building, and the most common
      -- source of an order change the support plan does not yet reflect. It was the one resident-level
      -- record with no timeline entry at all.
      select ap.starts_at, 'appointment',
        'Appointment: ' || ap.appointment_type, ap.status,
        left(concat_ws(' · ',
          nullif(ap.provider_name, ''),
          nullif(ap.location, ''),
          case when ap.new_order_ack_status = 'pending_review' then 'New orders awaiting acknowledgement' end,
          nullif(ap.outcome_summary, '')
        ), 500),
        '/app/residents/' || ap.resident_id::text || '?tab=appointments', ap.id
      from public.resident_appointments ap where ap.resident_id = p_resident_id
    ) event
    where event.occurred_at is not null
    order by event.occurred_at desc, event.source_id
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$function$;

------------------------------------------------------------------------------------------------
-- 5. The integration console stops being a facility-wide medication list
------------------------------------------------------------------------------------------------

create or replace function public.get_facility_fhir_ingestion_activity(p_facility_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  -- SECURITY INVOKER: the rows counted here are exactly the rows the caller could already select,
  -- so RLS remains the only gate and there is no second predicate to drift away from it. What
  -- changes is what crosses the wire -- counts, statuses and timestamps rather than drug names,
  -- dosages, RxNorm codes and raw FHIR payloads for every resident in the building.
  select jsonb_build_object(
    'requestTotal', coalesce((
      select count(*) from public.fhir_medication_requests r where r.facility_id = p_facility_id), 0),
    'requestActiveTotal', coalesce((
      select count(*) from public.fhir_medication_requests r
      where r.facility_id = p_facility_id and r.request_status = 'active'), 0),
    'administrationTotal', coalesce((
      select count(*) from public.fhir_medication_administrations a
      where a.facility_id = p_facility_id), 0),
    'lastRequestAt', (
      select max(r.source_updated_at) from public.fhir_medication_requests r
      where r.facility_id = p_facility_id),
    'lastAdministrationAt', (
      select max(a.effective_at) from public.fhir_medication_administrations a
      where a.facility_id = p_facility_id),
    'residents', coalesce((
      select jsonb_agg(to_jsonb(per_resident) order by per_resident.last_activity_at desc nulls last)
      from (
        select
          activity.resident_id,
          sum(activity.request_count)::integer as request_count,
          sum(activity.active_request_count)::integer as active_request_count,
          sum(activity.administration_count)::integer as administration_count,
          max(activity.last_activity_at) as last_activity_at
        from (
          select r.resident_id, count(*)::integer as request_count,
            count(*) filter (where r.request_status = 'active')::integer as active_request_count,
            0 as administration_count,
            max(r.source_updated_at) as last_activity_at
          from public.fhir_medication_requests r
          where r.facility_id = p_facility_id
          group by r.resident_id
          union all
          select a.resident_id, 0, 0, count(*)::integer, max(a.effective_at)
          from public.fhir_medication_administrations a
          where a.facility_id = p_facility_id
          group by a.resident_id
        ) activity
        group by activity.resident_id
      ) per_resident
    ), '[]'::jsonb)
  );
$function$;

comment on function public.get_facility_fhir_ingestion_activity(uuid) is
  'Per-resident FHIR ingestion counts and recency for the integration console. Deliberately carries '
  'no medication name, dosage, code or raw payload -- reading those is a chart read and belongs on '
  'the resident chart, where public.log_clinical_access records it.';

revoke all on function public.get_facility_fhir_ingestion_activity(uuid) from public, anon;
grant execute on function public.get_facility_fhir_ingestion_activity(uuid) to authenticated, service_role;

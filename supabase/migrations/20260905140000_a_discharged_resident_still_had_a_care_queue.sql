-- Discharge did not stop care (BACKLOG.md I15, the documentation half).
--
-- `get_resident_service_task_queue` joins `residents` and never looks at `residents.status`. So the
-- day a resident is discharged, every service task already scheduled for the rest of the week stays
-- on the Floor queue, and an aide working that list documents care for somebody who is not in the
-- building. None of `record_service_task_response`, `record_unscheduled_service` or
-- `record_clinical_observation` checks either, and neither do the four offline appliers -- so a
-- draft written on a device for a resident discharged in the meantime synced `applied`, and the
-- resident's chart gained a service record dated after they left.
--
-- That is a false entry in a regulated care record, and at survey it is worse than a missing one:
-- a gap is an omission, an entry for a discharged resident is documentation of care that did not
-- happen.
--
-- IT IS ENFORCED ON THE TABLES, NOT IN THE SEVEN CALLERS. Three RPCs write this documentation
-- today and four offline appliers write it again on a different path; the eighth caller added
-- later would not know to check. The same reasoning as the one-open-assignment index in
-- 20260905060000: put the rule where the rows land. Every sync RPC already carries an exception
-- handler that maps a raise onto a draft outcome, so an offline draft for a discharged resident
-- comes back needing a human rather than retrying forever or landing silently.
--
-- WHICH STATUSES. `residents.status` runs prospect / applicant / approved / waitlisted / reserved /
-- active / temporarily_out / hospital_leave / discharged / deceased.
--
--   * Documentation is refused for `discharged` and `deceased` only. Those are terminal: the person
--     is not coming back, so nothing legitimately arrives afterwards.
--   * It is deliberately ALLOWED for `hospital_leave` and `temporarily_out`. An aide who documented
--     a 10:00 medication reminder on a device, and syncs at 16:00 after the resident left for
--     hospital at 14:00, is filing real care that really happened. Refusing it would lose the
--     record to protect a rule about the resident's state now, which is the wrong way round.
--   * The QUEUE is stricter than the write guard, and that is the point: it lists work still to do,
--     so it shows `active` and `temporarily_out` and nothing else. A resident in hospital has no
--     tasks to perform today; their scheduled instances stop appearing and come back on return.
--
-- AND THE TRANSFER RPCS NEVER MOVED THE STATUS. `start_hospital_transfer` opens an episode and
-- `complete_hospital_return` closes it, but neither touched `residents.status` -- so a resident in
-- hospital still read `active` everywhere, including in the queue predicate this migration adds,
-- which would have made that predicate useless for the most common case. They now set
-- `hospital_leave` and restore `active`.
--
-- NOT FIXED HERE, and left on the row: `useResidentClinicalCare`, `useFhirIntegration` and
-- `useCareLevelReview` select care plans, progress notes, medications, allergies, conditions and
-- assessments straight from the tables, so only `get_resident_clinical_chart` and
-- `get_resident_clinical_observations` write `clinical_access_log`. Closing that means routing
-- three hooks and their pages through logged RPCs -- a frontend change of a different shape and
-- size from this one, and mixing them would make both harder to review. The consent-scope items on
-- the same row are, as recorded, decisions for counsel rather than defects.
--
-- Rollback: drop the three triggers and the guard, and restore the three functions from
-- 20260726060100, 20260726070100 and 20260713170000.

create or replace function public.assert_resident_accepts_documentation()
returns trigger
-- SECURITY DEFINER because it has to read residents.status for a caller who often cannot: the
-- `employee` role is not admitted by residents_select at all, so an invoker-rights read would find
-- no row and the guard would pass exactly where it matters most.
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_name text;
begin
  select r.status, r.first_name || ' ' || r.last_name
    into v_status, v_name
  from public.residents r
  where r.id = new.resident_id;

  if v_status in ('discharged', 'deceased') then
    raise exception
      'Care cannot be documented for % because the resident is no longer at the facility. If this records care given before then, tell the administrator rather than filing it here.',
      coalesce(v_name, 'this resident')
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return new;
end;
$$;

revoke all on function public.assert_resident_accepts_documentation() from public, anon, authenticated;

comment on function public.assert_resident_accepts_documentation() is
  'Refuses care documentation for a discharged or deceased resident. On the tables rather than in '
  'the callers: three RPCs and four offline appliers write this documentation, and the next one '
  'would not know to check (BACKLOG.md I15).';

create trigger refuse_documentation_after_discharge
  before insert on public.clinical_observations
  for each row execute function public.assert_resident_accepts_documentation();

create trigger refuse_documentation_after_discharge
  before insert on public.resident_unscheduled_services
  for each row execute function public.assert_resident_accepts_documentation();

-- The task instance already exists when a discharge happens; what must not happen is somebody
-- recording a RESPONSE on it afterwards. Fires only on the transition into a completed-ish state,
-- so back-office corrections to an instance's schedule are untouched.
create or replace function public.assert_task_response_after_discharge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.completion_response is distinct from old.completion_response
     or (new.status is distinct from old.status and new.status in ('completed', 'refused', 'not_done')) then
    select r.status into v_status from public.residents r where r.id = new.resident_id;
    if v_status in ('discharged', 'deceased') then
      raise exception 'This service task cannot be answered: the resident is no longer at the facility.'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.assert_task_response_after_discharge() from public, anon, authenticated;

create trigger refuse_task_response_after_discharge
  before update on public.resident_service_task_instances
  for each row execute function public.assert_task_response_after_discharge();

comment on function public.assert_task_response_after_discharge() is
  'Refuses a service-task response for a discharged or deceased resident, without blocking '
  'schedule corrections on the same row (BACKLOG.md I15).';

-- The queue now asks whether the resident is still here. Otherwise byte-identical to the deployed
-- definition.
create or replace function public.get_resident_service_task_queue(
  p_from timestamptz default date_trunc('day', now()),
  p_through timestamptz default (date_trunc('day', now()) + interval '1 day'),
  p_facility_id uuid default null,
  p_status text default null
) returns table(
  id uuid, organization_id uuid, facility_id uuid, facility_name text, resident_id uuid,
  resident_name text, resident_room text, requirement_id uuid, source_assessment_form_id uuid,
  source_plan_version integer, service_name text, special_instructions text, responsible_role text,
  unit_name text, requires_two_staff boolean, documentation_mode text, task_kind text,
  acceptable_completion_responses text[], refusal_handling text, required_qualification_key text,
  scheduled_start timestamptz, scheduled_end timestamptz, assigned_employee_id uuid,
  assigned_employee_name text, status text, completion_response text, note text,
  supervisor_notified boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_employee public.employees%rowtype;
  v_role text := public.current_role();
begin
  if auth.uid() is null or p_through <= p_from or p_through > p_from + interval '45 days' then
    raise exception 'Invalid service queue request' using errcode = '22023';
  end if;
  select * into v_employee from public.employees e
  where e.profile_id = auth.uid() and e.status = 'active';
  return query
  select
    t.id, t.organization_id, t.facility_id, f.name,
    t.resident_id, r.first_name || ' ' || r.last_name, r.room,
    t.requirement_id, t.source_assessment_form_id, t.source_plan_version,
    t.service_name, req.special_instructions, t.responsible_role, u.name,
    req.requires_two_staff, req.documentation_mode,
    req.task_kind, req.acceptable_completion_responses, req.refusal_handling,
    req.required_qualification_key,
    t.scheduled_start, t.scheduled_end, t.assigned_employee_id,
    case when ae.id is null then null else ae.first_name || ' ' || ae.last_name end,
    t.status, t.completion_response, t.note, t.supervisor_notified
  from public.resident_service_task_instances t
  join public.resident_service_requirements req on req.id = t.requirement_id
  join public.residents r on r.id = t.resident_id
  join public.facilities f on f.id = t.facility_id
  left join public.facility_units u on u.id = t.unit_id
  left join public.employees ae on ae.id = t.assigned_employee_id
  where t.scheduled_start >= p_from
    -- The queue lists work still to do. A discharged, deceased or hospitalised resident has
    -- none; without this their already-scheduled instances stayed on the Floor list all week
    -- and an aide working that list documented care for somebody not in the building.
    and r.status in ('active', 'temporarily_out')
    and t.scheduled_start < p_through
    and (p_facility_id is null or t.facility_id = p_facility_id)
    and (p_status is null or t.status = p_status)
    and (
      public.is_platform_admin()
      or (
        t.organization_id = public.current_org_id()
        and (
          v_role in ('org_admin', 'auditor')
          or (v_role = 'facility_manager' and public.is_assigned_to_facility(t.facility_id))
          or (
            v_role = 'employee'
            and v_employee.facility_id = t.facility_id
            and (t.assigned_employee_id is null or t.assigned_employee_id = v_employee.id)
          )
        )
      )
    )
  order by t.scheduled_start, r.last_name, r.first_name, t.service_name;
end;
$fn$;

create or replace function public.start_hospital_transfer(
  p_resident_id uuid, p_reason text, p_destination text, p_transfer_time timestamptz,
  p_transport_method text, p_expected_return_at timestamptz default null,
  p_linked_change_event_id uuid default null, p_documents_sent text[] default array[]::text[],
  p_equipment_sent text[] default array[]::text[], p_notifications jsonb default '[]'::jsonb,
  p_belongings jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_res public.residents%rowtype; v_id uuid;
begin
  select * into v_res from public.residents where id=p_resident_id;
  if not found then raise exception 'Resident not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v_res.organization_id, v_res.facility_id);
  if exists (select 1 from public.hospital_transfer_episodes h where h.resident_id=v_res.id and h.status='out') then raise exception 'Resident already has an open transfer episode' using errcode='23505'; end if;
  insert into public.hospital_transfer_episodes(organization_id,facility_id,resident_id,reason,destination,transfer_time,transport_method,expected_return_at,linked_change_event_id,documents_sent,equipment_sent,notifications,belongings,responsible_profile_id,created_by)
  values(v_res.organization_id,v_res.facility_id,v_res.id,btrim(p_reason),btrim(p_destination),p_transfer_time,btrim(p_transport_method),p_expected_return_at,p_linked_change_event_id,coalesce(p_documents_sent,array[]::text[]),coalesce(p_equipment_sent,array[]::text[]),coalesce(p_notifications,'[]'::jsonb),coalesce(p_belongings,'{}'::jsonb),auth.uid(),auth.uid()) returning id into v_id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values) values(v_res.organization_id,auth.uid(),'hospital_transfer_episode',v_id::text,'hospital_transfer.started',jsonb_build_object('residentId',v_res.id,'destination',p_destination));
  -- The episode alone left residents.status reading 'active', so every surface -- the
  -- Floor queue included -- still treated a resident in hospital as present.
  update public.residents set status = 'hospital_leave'
  where id = p_resident_id and status in ('active', 'temporarily_out');

  return v_id;
end 
$fn$;

create or replace function public.complete_hospital_return(
  p_episode_id uuid, p_return_time timestamptz, p_discharge_document_id uuid default null,
  p_changed_order_ack_status text default 'pending_review',
  p_medication_reconciliation_status text default 'pending',
  p_condition_changes text default null, p_diet_changes text default null,
  p_mobility_changes text default null, p_skin_concerns text default null,
  p_dme_changes text default null, p_assessment_review_required boolean default true,
  p_support_plan_review_required boolean default true
) returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
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
      v.id, public.pa_day(p_return_time), auth.uid()
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
  -- Back in the building: restore the status the transfer moved off, and only from
  -- hospital_leave, so a resident discharged while away is not silently readmitted.
  update public.residents set status = 'active'
  where id = v.resident_id and status = 'hospital_leave';

  return v_work;
end 
$fn$;

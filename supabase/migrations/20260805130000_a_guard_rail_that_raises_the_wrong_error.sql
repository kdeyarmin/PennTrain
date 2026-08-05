-- Two guard rails that threw a Postgres internal error instead of the message they were written to give.
--
-- `text[] || 'some literal'` does not append in PL/pgSQL. With an untyped literal Postgres resolves
-- the operator to `anyarray || anyarray`, tries to parse the string as an array literal, and raises
--
--     malformed array literal: "what happened at the appointment"
--     DETAIL: Array value must start with "{" or dimension information.
--
-- Verified directly against the local stack, not inferred. `supabase db lint --level error` has
-- been reporting both of these; the finding stands on its own but the gate had already found it,
-- which is worth saying plainly -- `pnpm run check:database` runs that lint with `--fail-on error`,
-- so this pair has been failing the database gate.
--
-- What it costs, in both cases, is the validation path specifically:
--
--   * `public.complete_appointment_follow_up` builds a list of what is still outstanding and raises
--     'Appointment follow-up cannot be closed while these remain outstanding: ...'. The first append
--     throws, so a user closing a follow-up before recording the outcome gets a malformed-array
--     error rather than being told to record what happened at the appointment.
--   * `app_private.certification_attempt_blockers` builds the reasons an attempt cannot be recorded
--     (unpublished checklist version, self-assessment, unqualified assessor). Same shape: the
--     moment there IS a blocker to report, reporting it throws.
--
-- Both fail closed, so neither lets bad data through -- the damage is that the specific, actionable
-- refusal each was written to produce is replaced by an internal error. Fixed by casting the
-- literal, which resolves the operator to `anyarray || anyelement`.
--
-- The rest of the `v := v || ...` sites in the migration tree are jsonb or text concatenation and
-- are unaffected; these five lines are the whole set.

CREATE OR REPLACE FUNCTION app_private.certification_attempt_blockers(p_certification_version_id uuid, p_employee_id uuid, p_assessor_profile_id uuid, p_observed_at timestamp with time zone)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_version public.certification_definition_versions%rowtype;
  v_definition public.certification_definitions%rowtype;
  v_blockers text[] := array[]::text[];
begin
  select * into v_version from public.certification_definition_versions
  where id = p_certification_version_id;
  if not found then
    return array['the checklist version does not exist'];
  end if;
  select * into v_definition from public.certification_definitions
  where id = v_version.certification_definition_id;

  if v_version.lifecycle_state <> 'published'
     or v_version.effective_from is null
     or v_version.effective_from > p_observed_at
     or (v_version.effective_to is not null and v_version.effective_to <= p_observed_at) then
    v_blockers := v_blockers || 'the checklist version was not published and effective at the observation time'::text;
  end if;

  -- Self-assessment, where the definition forbids it. Checked here as well as at approval because
  -- discovering it afterwards means the whole observation is wasted.
  if v_definition.separation_of_duties and exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.profile_id = p_assessor_profile_id
  ) then
    v_blockers := v_blockers || 'this certification forbids assessing yourself'::text;
  end if;

  if not exists (
    select 1 from public.assessor_qualifications a
    where a.certification_definition_id = v_definition.id
      and a.assessor_profile_id = p_assessor_profile_id
      and a.effective_from <= p_observed_at
      and (a.effective_to is null or a.effective_to > p_observed_at)
  ) then
    v_blockers := v_blockers || 'you were not a qualified assessor for this certification at the observation time'::text;
  end if;

  return v_blockers;
end $function$;

CREATE OR REPLACE FUNCTION public.complete_appointment_follow_up(p_appointment_id uuid, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.resident_appointments%rowtype;
  v_outstanding text[] := array[]::text[];
begin
  select * into v from public.resident_appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status in ('scheduled', 'rescheduled') then
    raise exception 'Record the appointment outcome before closing its follow-up' using errcode = '22023';
  end if;
  if v.follow_up_completed_at is not null then
    raise exception 'This appointment follow-up is already closed' using errcode = '22023';
  end if;

  -- The outcome summary is what the follow-up work item's description was built from. Closing
  -- without one leaves a queue entry whose only content was "Appointment outcome requires staff
  -- follow-up" and a record that says nothing about what happened.
  if nullif(btrim(coalesce(v.outcome_summary, '')), '') is null then
    v_outstanding := v_outstanding || 'what happened at the appointment'::text;
  end if;
  if v.new_order_ack_status = 'pending_review' then
    v_outstanding := v_outstanding || 'acknowledgement of the new orders'::text;
  end if;

  if cardinality(v_outstanding) > 0 then
    raise exception 'Appointment follow-up cannot be closed while these remain outstanding: %',
      array_to_string(v_outstanding, ', ') using errcode = '22023';
  end if;

  update public.work_items set
    state = 'closed',
    closure_reason = left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Appointment follow-up completed'), 1000),
    closed_at = now(),
    updated_at = now()
  where id = v.follow_up_work_item_id and state not in ('closed', 'canceled');

  update public.resident_appointments set
    follow_up_completed_at = now(), follow_up_completed_by = auth.uid(), updated_at = now()
  where id = v.id;

  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action, new_values)
  values (v.organization_id, auth.uid(), 'resident_appointment', v.id::text,
    'appointment.follow_up_completed',
    jsonb_build_object('workItemId', v.follow_up_work_item_id,
      'note', nullif(btrim(coalesce(p_note, '')), '')));
  return true;
end $function$;

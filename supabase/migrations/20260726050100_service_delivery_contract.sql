-- Service delivery contract (program plan Phase 3c).
--
-- `resident_service_requirements` already said WHEN a service happens (frequency, time window,
-- effective/expiry) and WHO broadly (responsible_role, requires_two_staff). What it never said is
-- what KIND of task it is, what qualification it demands, what counts as completing it, what to do
-- when the resident refuses, or when to escalate. Without those, a generated task is an instruction
-- to "do the thing" and an aide has to invent the rest at the bedside.
--
-- The completion-response vocabulary here is the same seven the request names for exception-based
-- documentation. It is defined now, on the requirement that owns it, so the floor phase wires an
-- existing vocabulary into the task instance instead of inventing a second one.
--
-- All columns are additive with defaults that preserve today's behaviour: every existing
-- requirement becomes a 'scheduled_care' task accepting all seven responses, which is what the
-- current generator effectively produces.

alter table public.resident_service_requirements
  add column task_kind text not null default 'scheduled_care'
    check (task_kind in (
      'scheduled_care', 'shift_task', 'weekly_task', 'as_needed',
      'observation', 'manager_review', 'documentation_requirement'
    )),
  -- Matches certification_definitions.qualification_key's shape. Deliberately not a foreign key:
  -- qualification definitions can be organization-scoped or platform-wide, and a requirement must
  -- not break because an org has not defined its own row yet. The duty-eligibility phase resolves
  -- this key against the definitions the facility actually has.
  add column required_qualification_key text
    check (required_qualification_key is null or required_qualification_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  add column acceptable_completion_responses text[] not null
    default array[
      'completed_as_planned', 'completed_with_more_assistance', 'partially_completed',
      'resident_refused', 'resident_unavailable', 'not_completed', 'concern_observed'
    ]::text[],
  add column refusal_handling text,
  add column escalation_conditions text,
  add column escalate_after_exceptions integer
    check (escalate_after_exceptions is null or escalate_after_exceptions between 1 and 50),
  -- A service nobody can close is a service that will sit red forever.
  add constraint resident_service_requirements_responses_not_empty
    check (cardinality(acceptable_completion_responses) > 0),
  -- Every entry must be a known response; an unrecognized one would render as a blank button.
  add constraint resident_service_requirements_responses_known
    check (acceptable_completion_responses <@ array[
      'completed_as_planned', 'completed_with_more_assistance', 'partially_completed',
      'resident_refused', 'resident_unavailable', 'not_completed', 'concern_observed'
    ]::text[]);

comment on column public.resident_service_requirements.task_kind is
  'What kind of work this is. Only scheduled_care/shift_task/weekly_task have a due window; the rest must not raise missed-window alerts.';
comment on column public.resident_service_requirements.refusal_handling is
  'What staff should do when the resident refuses. Required in the UI whenever resident_refused is an accepted response.';
comment on column public.resident_service_requirements.acceptable_completion_responses is
  'The responses staff may record. Only completed_as_planned closes a task with nothing further to document.';

create index resident_service_requirements_kind_idx
  on public.resident_service_requirements(facility_id, task_kind, status)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Carry the contract through plan activation
-- ---------------------------------------------------------------------------
--
-- Two changes to app_private.activate_support_plan beyond the new columns:
--
--  * A service entry can opt OUT of generating a requirement with "generate_service": false. The
--    plan author opted IN by putting the entry in `services` at all, so the default stays generate;
--    flipping to opt-out-by-default would silently stop generating tasks for every existing plan.
--  * Responses default per task kind rather than always all seven: a manager review cannot be
--    refused by a resident, and offering that response invites recording something that did not
--    happen.

create or replace function app_private.default_completion_responses(p_task_kind text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_task_kind
    when 'manager_review' then array['completed_as_planned','partially_completed','not_completed']
    when 'documentation_requirement' then array['completed_as_planned','partially_completed','not_completed']
    when 'observation' then array['completed_as_planned','resident_unavailable','not_completed','concern_observed']
    else array[
      'completed_as_planned','completed_with_more_assistance','partially_completed',
      'resident_refused','resident_unavailable','not_completed','concern_observed'
    ]
  end::text[];
$$;

revoke all on function app_private.default_completion_responses(text) from public, anon, authenticated, service_role;

create or replace function app_private.activate_support_plan(p_plan_id uuid)
returns void language plpgsql security definer set search_path='' as $$
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
      coalesce(v.effective_date, current_date),
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
end $$;

revoke all on function app_private.activate_support_plan(uuid) from public, anon, authenticated, service_role;

-- Codex review of PR #504 (J130 / J131).
--
-- 1. post_unfilled_published_shift and record_shift_call_off treated an existing
--    open opportunity for the same schedule/date/start/unit as success. A second
--    coverage loss on that slot did not raise slots, so the first claim filled the
--    only opening while another assignment stayed uncovered. Distinct end times or
--    shift definitions that shared those four fields were also collapsed.
-- 2. The no-show producer never ran on the way back. A manager correcting
--    no_show to scheduled/confirmed/completed left the opportunity and the
--    unfilled-shift work item live, so a replacement could still claim a shift
--    that was covered again.

create or replace function app_private.ensure_published_open_shift_opportunity(
  p_shift_assignment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shift_assignments%rowtype;
  v_emp public.employees%rowtype;
  v_schedule public.schedules%rowtype;
  v_policy public.schedule_eligibility_policies%rowtype;
  v_open public.open_shift_opportunities%rowtype;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_claim_deadline timestamptz;
  v_created_by uuid;
  v_quals text[];
  v_creds text[];
  v_training uuid[];
begin
  select * into v_shift from public.shift_assignments where id = p_shift_assignment_id;
  if not found then return false; end if;
  select * into v_emp from public.employees where id = v_shift.employee_id;
  select * into v_schedule from public.schedules where id = v_shift.schedule_id;
  if coalesce(v_schedule.status, 'draft') <> 'published' then return false; end if;

  v_start_ts := public.pa_midnight(v_shift.shift_date) + v_shift.start_time;
  v_end_ts := public.pa_midnight(v_shift.shift_date) + v_shift.end_time
    + case when v_shift.end_time <= v_shift.start_time then interval '1 day' else interval '0' end;
  if v_end_ts < now() then return false; end if;

  v_created_by := coalesce(auth.uid(), v_emp.profile_id);
  if v_created_by is null then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'open-shift-slot:' || v_shift.schedule_id::text || ':' || v_shift.shift_date::text
    || ':' || v_shift.start_time::text || ':' || v_shift.end_time::text
    || ':' || coalesce(v_shift.shift_definition_id::text, '')
    || ':' || coalesce(v_shift.unit_id::text, ''),
    0
  ));

  select * into v_open
    from public.open_shift_opportunities o
   where o.schedule_id = v_shift.schedule_id
     and o.facility_id = v_shift.facility_id
     and o.shift_date = v_shift.shift_date
     and o.start_time = v_shift.start_time
     and o.end_time = v_shift.end_time
     and o.shift_definition_id is not distinct from v_shift.shift_definition_id
     and o.unit_id is not distinct from v_shift.unit_id
     and o.status in ('draft','open')
   order by o.created_at
   limit 1
   for update;

  if found then
    update public.open_shift_opportunities
       set slots = least(slots + 1, 100)
     where id = v_open.id;
    return true;
  end if;

  select
    coalesce(array_agg(distinct q) filter (where q is not null), array[]::text[]),
    coalesce(array_agg(distinct c) filter (where c is not null), array[]::text[]),
    coalesce(array_agg(distinct t) filter (where t is not null), array[]::uuid[])
  into v_quals, v_creds, v_training
  from public.shift_eligibility_requirements r
  left join lateral unnest(r.required_qualification_keys) q on true
  left join lateral unnest(r.required_credential_types) c on true
  left join lateral unnest(r.required_training_type_ids) t on true
  where r.facility_id = v_shift.facility_id
    and r.shift_definition_id = v_shift.shift_definition_id
    and r.is_active;

  select
    array(select distinct x from unnest(v_quals || coalesce(w.required_qualification_keys, array[]::text[])) x),
    array(select distinct x from unnest(v_creds || coalesce(w.required_credential_types, array[]::text[])) x)
  into v_quals, v_creds
  from public.service_workload_profiles w
  where w.facility_id = v_shift.facility_id
    and w.shift_definition_id = v_shift.shift_definition_id
    and w.unit_id is not distinct from v_shift.unit_id;

  select * into v_policy from public.schedule_eligibility_policies where organization_id = v_shift.organization_id;
  v_claim_deadline := least(
    v_end_ts,
    greatest(
      v_start_ts - coalesce(v_policy.claim_deadline_hours, 4) * interval '1 hour',
      now() + interval '30 minutes'
    )
  );

  insert into public.open_shift_opportunities(
    organization_id, schedule_id, facility_id, unit_id, shift_definition_id,
    shift_date, start_time, end_time, slots,
    required_qualification_keys, required_credential_types, required_training_type_ids,
    status, claim_deadline, created_by
  ) values (
    v_shift.organization_id, v_shift.schedule_id, v_shift.facility_id, v_shift.unit_id,
    v_shift.shift_definition_id, v_shift.shift_date, v_shift.start_time, v_shift.end_time, 1,
    coalesce(v_quals, array[]::text[]), coalesce(v_creds, array[]::text[]),
    coalesce(v_training, array[]::uuid[]),
    'open', v_claim_deadline, v_created_by
  );
  return true;
end;
$$;

comment on function app_private.ensure_published_open_shift_opportunity(uuid) is
  'Posts an open-shift opportunity for a published, not-yet-ended assignment, or increments '
  'slots on the matching draft/open row. Match includes end_time and shift_definition_id so '
  'two holes on the same unit and start are not collapsed across different shifts. Used by '
  'post_unfilled_published_shift and record_shift_call_off.';

revoke all on function app_private.ensure_published_open_shift_opportunity(uuid)
  from public, anon, authenticated;
grant execute on function app_private.ensure_published_open_shift_opportunity(uuid)
  to service_role;

create or replace function app_private.retract_unfilled_published_shift(
  p_shift_assignment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shift_assignments%rowtype;
  v_work public.work_items%rowtype;
  v_open public.open_shift_opportunities%rowtype;
  v_actor uuid;
  v_filled integer;
  v_new_slots integer;
begin
  select * into v_shift from public.shift_assignments where id = p_shift_assignment_id;
  if not found then return false; end if;

  v_actor := coalesce(
    auth.uid(),
    (select profile_id from public.employees where id = v_shift.employee_id)
  );

  select * into v_work
    from public.work_items
   where organization_id = v_shift.organization_id
     and deduplication_key = 'call-off:' || v_shift.id::text
     and state not in ('closed','canceled')
   for update;

  if found then
    update public.work_items
       set state = 'canceled',
           closed_at = coalesce(closed_at, now()),
           updated_at = now()
     where id = v_work.id;
    insert into public.work_item_history(
      organization_id, facility_id, work_item_id, event_type, prior_state, resulting_state,
      actor_profile_id, reason, evidence
    ) values (
      v_shift.organization_id, v_shift.facility_id, v_work.id, 'canceled', v_work.state, 'canceled',
      v_actor, 'Coverage restored; unfilled-shift work retracted',
      jsonb_build_object('shiftAssignmentId', v_shift.id)
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'open-shift-slot:' || v_shift.schedule_id::text || ':' || v_shift.shift_date::text
    || ':' || v_shift.start_time::text || ':' || v_shift.end_time::text
    || ':' || coalesce(v_shift.shift_definition_id::text, '')
    || ':' || coalesce(v_shift.unit_id::text, ''),
    0
  ));

  select * into v_open
    from public.open_shift_opportunities o
   where o.schedule_id = v_shift.schedule_id
     and o.facility_id = v_shift.facility_id
     and o.shift_date = v_shift.shift_date
     and o.start_time = v_shift.start_time
     and o.end_time = v_shift.end_time
     and o.shift_definition_id is not distinct from v_shift.shift_definition_id
     and o.unit_id is not distinct from v_shift.unit_id
     and o.status in ('draft','open')
   order by o.created_at
   limit 1
   for update;

  if not found then return v_work.id is not null; end if;

  select count(*)::integer into v_filled
    from public.open_shift_claims c
   where c.opportunity_id = v_open.id
     and c.claim_status in ('approved','pending_approval');

  if v_open.slots <= 1 then
    if v_filled = 0 then
      update public.open_shift_opportunities
         set status = 'canceled'
       where id = v_open.id;
      update public.open_shift_claims
         set claim_status = 'canceled'
       where opportunity_id = v_open.id
         and claim_status in ('waitlisted');
    end if;
    return true;
  end if;

  v_new_slots := v_open.slots - 1;
  update public.open_shift_opportunities
     set slots = v_new_slots,
         status = case when v_filled >= v_new_slots then 'filled' else status end
   where id = v_open.id;
  return true;
end;
$$;

comment on function app_private.retract_unfilled_published_shift(uuid) is
  'Cancels the unfilled-shift work item for this assignment and shrinks or cancels the matching '
  'open-shift opportunity when a published no-show or call-off is corrected back to covering.';

revoke all on function app_private.retract_unfilled_published_shift(uuid)
  from public, anon, authenticated;
grant execute on function app_private.retract_unfilled_published_shift(uuid)
  to service_role;

create or replace function app_private.post_unfilled_published_shift(
  p_shift_assignment_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shift_assignments%rowtype;
  v_emp public.employees%rowtype;
  v_schedule public.schedules%rowtype;
  v_work uuid;
  v_template uuid;
  v_end_ts timestamptz;
  v_created_by uuid;
begin
  select * into v_shift from public.shift_assignments where id = p_shift_assignment_id;
  if not found then return false; end if;
  select * into v_emp from public.employees where id = v_shift.employee_id;
  select * into v_schedule from public.schedules where id = v_shift.schedule_id;
  if coalesce(v_schedule.status, 'draft') <> 'published' then return false; end if;

  v_end_ts := public.pa_midnight(v_shift.shift_date) + v_shift.end_time
    + case when v_shift.end_time <= v_shift.start_time then interval '1 day' else interval '0' end;
  if v_end_ts < now() then return false; end if;

  v_created_by := coalesce(auth.uid(), v_emp.profile_id);

  select id into v_template
    from public.work_item_templates
   where (organization_id = v_shift.organization_id or organization_id is null)
     and template_key = 'daily_ops.unfilled_shift'
   order by organization_id nulls last
   limit 1;

  insert into public.work_items(
    organization_id, facility_id, template_id, source_type, source_id, deduplication_key,
    title, description, owner_profile_id, priority, due_at, created_by
  ) values (
    v_shift.organization_id, v_shift.facility_id, v_template, 'rule_exception', v_shift.id,
    'call-off:' || v_shift.id::text,
    'Unfilled shift after coverage loss',
    coalesce(nullif(btrim(p_reason), ''), 'Shift uncovered'),
    null, 'high', now() + interval '30 minutes', v_created_by
  )
  on conflict (organization_id, deduplication_key) do update
    set state = 'open',
        closed_at = null,
        description = excluded.description,
        due_at = excluded.due_at,
        updated_at = now()
  where public.work_items.state in ('canceled', 'closed')
  returning id into v_work;

  if v_work is not null then
    insert into public.work_item_history(
      organization_id, facility_id, work_item_id, event_type, prior_state, resulting_state,
      actor_profile_id, reason, evidence
    ) values (
      v_shift.organization_id, v_shift.facility_id, v_work, 'created',
      null, 'open',
      v_created_by, 'Coverage loss created unfilled-shift work',
      jsonb_build_object('shiftAssignmentId', v_shift.id, 'reason', p_reason)
    );
  end if;

  if v_created_by is null then return v_work is not null; end if;
  perform app_private.ensure_published_open_shift_opportunity(v_shift.id);
  return true;
end;
$$;

comment on function app_private.post_unfilled_published_shift(uuid, text) is
  'Opens the unfilled-shift work item and posts or expands an open-shift opportunity for a '
  'published shift that has not ended. Used when coverage is lost by a path other than '
  'record_shift_call_off (lifecycle disposition, published no-show). Idempotent on the '
  'call-off: assignment-id work-item dedup key. A second hole on the same slot raises slots.';

create or replace function app_private.post_coverage_on_published_no_show()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was boolean := old.status in ('called_off', 'no_show');
  v_is boolean := new.status in ('called_off', 'no_show');
begin
  if v_is and not v_was then
    if new.status = 'no_show' then
      perform app_private.post_unfilled_published_shift(new.id, 'No show');
    end if;
  elsif v_was and not v_is and new.status in ('scheduled', 'confirmed', 'completed') then
    perform app_private.retract_unfilled_published_shift(new.id);
  end if;
  return new;
end;
$$;

comment on function app_private.post_coverage_on_published_no_show() is
  'A published No Show is still a status PATCH (unlike Called Off, which needs a category). '
  'Entering no_show posts coverage; leaving called_off or no_show for a covering status '
  'retracts the work item and shrinks or cancels the opening.';

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef(
    'public.record_shift_call_off(uuid, text, text, timestamptz, timestamptz)'::regprocedure);
  v_old := $old$     and not exists (
       select 1 from public.open_shift_opportunities o
       where o.schedule_id = v_shift.schedule_id
         and o.facility_id = v_shift.facility_id
         and o.shift_date = v_shift.shift_date
         and o.start_time = v_shift.start_time
         and o.unit_id is not distinct from v_shift.unit_id
         and o.status in ('draft','open')
     )
  then$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'record_shift_call_off no longer skips an existing opening in the shape this migration patches';
  end if;
  v_new := $new$  then
    perform app_private.ensure_published_open_shift_opportunity(v_shift.id);
  elsif false then$new$;
  execute replace(v_def, v_old, v_new);
end
$do$;

comment on function public.record_shift_call_off(uuid, text, text, timestamptz, timestamptz) is
  'Records a call-off against a scheduled or confirmed shift that has not ended, on a published '
  'schedule when the caller is the employee. Marks the shift called_off, opens the unfilled-shift '
  'work item, and posts or expands an open-shift opportunity for a full-shift absence. A second '
  'call-off on the same slot raises slots instead of leaving the first claim to fill a one-slot '
  'opening. The absence row is pending when the employee filed it themselves and approved when a '
  'manager or platform admin filed it.';

-- Four leftovers of the same week-one scheduling hole J73/J112 closed for a manager
-- call-off, plus two eligibility bugs that keep a still-valid person off the roster.
--
-- 1. Leave / terminate / transfer still UPDATE shift_assignments to called_off inside
--    app_private.disposition_workforce_lifecycle_dependents. That is a trusted path, so
--    protect_shift_assignment_call_off (J112) does not fire, and nothing posted the opening
--    or the unfilled-shift work item. Ending employment with a published roster emptied coverage
--    the same way the manager dropdown did.
-- 2. Published No Show is still a direct status PATCH. Analytics treat it as non-covering;
--    nothing filled the claim queue. Unlike call-off it needs no category, so an AFTER
--    UPDATE trigger posts coverage when the shift is published and has not ended.
-- 3. evaluate_schedule_eligibility required employee_credentials.status = 'compliant'.
--    Recalc sets due_soon while expiration_date is still in the future, so a still-valid
--    license hard-blocked every credential-gated shift for the whole warning window.
--    Training records had the same status test against due_date.
-- 4. decide_time_off_request updated the request and wrote work-item history. Eligibility
--    reads employee_availability_windows. Approved PTO never created one, so auto-fill
--    scheduled over it. The wrapper already promotes outside_availability to a hard block.

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
  v_policy public.schedule_eligibility_policies%rowtype;
  v_work uuid;
  v_template uuid;
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
  on conflict (organization_id, deduplication_key) do nothing
  returning id into v_work;

  if v_work is not null then
    insert into public.work_item_history(
      organization_id, facility_id, work_item_id, event_type, resulting_state,
      actor_profile_id, reason, evidence
    ) values (
      v_shift.organization_id, v_shift.facility_id, v_work, 'created', 'open',
      v_created_by, 'Coverage loss created unfilled-shift work',
      jsonb_build_object('shiftAssignmentId', v_shift.id, 'reason', p_reason)
    );
  end if;

  if v_created_by is null then return v_work is not null; end if;
  if exists (
    select 1 from public.open_shift_opportunities o
     where o.schedule_id = v_shift.schedule_id
       and o.facility_id = v_shift.facility_id
       and o.shift_date = v_shift.shift_date
       and o.start_time = v_shift.start_time
       and o.unit_id is not distinct from v_shift.unit_id
       and o.status in ('draft','open')
  ) then
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

comment on function app_private.post_unfilled_published_shift(uuid, text) is
  'Opens the unfilled-shift work item and posts an open-shift opportunity for a published '
  'shift that has not ended. Used when coverage is lost by a path other than '
  'record_shift_call_off (lifecycle disposition, published no-show). Idempotent on the '
  'call-off: assignment-id dedup key. A draft or an already-ended shift is a no-op.';

revoke all on function app_private.post_unfilled_published_shift(uuid, text)
  from public, anon, authenticated;
grant execute on function app_private.post_unfilled_published_shift(uuid, text)
  to service_role;

create or replace function app_private.post_coverage_on_published_no_show()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'no_show' and old.status is distinct from 'no_show' then
    perform app_private.post_unfilled_published_shift(new.id, 'No show');
  end if;
  return new;
end;
$$;

comment on function app_private.post_coverage_on_published_no_show() is
  'A published No Show is still a status PATCH (unlike Called Off, which needs a category). '
  'The mark is the coverage loss; this trigger is the producer the claim queue was missing.';

revoke all on function app_private.post_coverage_on_published_no_show()
  from public, anon, authenticated;
drop trigger if exists post_coverage_on_published_no_show on public.shift_assignments;
create trigger post_coverage_on_published_no_show
after update of status on public.shift_assignments
for each row execute function app_private.post_coverage_on_published_no_show();

-- Lifecycle called_off writes. The live body is still the 20260711200634 definition.
do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef(
    'app_private.disposition_workforce_lifecycle_dependents(uuid, text, uuid, uuid, date, text)'::regprocedure);
  v_old := $old$      update public.shift_assignments
      set status = 'called_off',
          notes = concat_ws(E'\n', nullif(notes, ''),
            '[workforce lifecycle ' || p_transition || '] ' || trim(p_reason))
      where id = v_row.id;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'disposition_workforce_lifecycle_dependents no longer calls off shifts in the shape this migration patches';
  end if;
  v_new := $new$      update public.shift_assignments
      set status = 'called_off',
          notes = concat_ws(E'\n', nullif(notes, ''),
            '[workforce lifecycle ' || p_transition || '] ' || trim(p_reason))
      where id = v_row.id;
      perform app_private.post_unfilled_published_shift(
        v_row.id,
        concat('Workforce lifecycle ', p_transition, ': ', trim(p_reason))
      );$new$;
  execute replace(v_def, v_old, v_new);
end
$do$;

comment on function app_private.disposition_workforce_lifecycle_dependents(uuid, text, uuid, uuid, date, text) is
  'Dispositions shifts, courses and class roster rows for a workforce lifecycle event. A '
  'published future shift that is called off now also posts the unfilled-shift work item and '
  'the open-shift opportunity, the same producer a manager call-off uses.';

-- due_soon is a warning on a still-valid credential / training record. The date columns are
-- the authority for whether the person may work the requested interval.
do $do$
declare
  v_def text;
  v_patched text;
begin
  v_def := pg_get_functiondef(
    'public.evaluate_schedule_eligibility(uuid, uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[])'::regprocedure);
  if position($$c.status = 'compliant'$$ in v_def) = 0
     or position($$r.status = 'compliant' and r.approval_status = 'approved'$$ in v_def) = 0 then
    raise exception 'evaluate_schedule_eligibility no longer has the status gates this migration patches';
  end if;
  v_patched := regexp_replace(
    v_def,
    'c\.status = ''compliant''',
    'c.status in (''compliant'', ''due_soon'')'
  );
  v_patched := regexp_replace(
    v_patched,
    'r\.status = ''compliant'' and r.approval_status = ''approved''',
    'r.status in (''compliant'', ''due_soon'') and r.approval_status = ''approved'''
  );
  execute v_patched;
end
$do$;

comment on function public.evaluate_schedule_eligibility(uuid, uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Shift eligibility for one employee and interval. A due_soon credential or training record '
  'still counts while its expiration_date / due_date covers the shift; expired and missing '
  'do not. Recalc uses due_soon as a warning, not a bar.';

create or replace function public.decide_time_off_request(
  p_request_id uuid,
  p_status text,
  p_manager_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.workforce_time_off_requests%rowtype;
begin
  if p_status not in ('approved','denied','canceled') then
    raise exception 'Invalid decision' using errcode='22023';
  end if;
  select * into v_req from public.workforce_time_off_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode='P0002'; end if;
  perform app_private.assert_daily_ops_manager(v_req.facility_id);
  if v_req.status <> 'pending' then return true; end if;
  update public.workforce_time_off_requests
     set status = p_status,
         manager_reason = nullif(btrim(p_manager_reason), ''),
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_request_id;
  insert into public.work_item_history(
    organization_id, facility_id, work_item_id, event_type, actor_profile_id, reason, evidence
  )
  select w.organization_id, w.facility_id, w.id, 'time_off_decision', auth.uid(),
         coalesce(nullif(btrim(p_manager_reason), ''), 'Time off ' || p_status),
         jsonb_build_object('requestId', p_request_id, 'status', p_status)
    from public.work_items w
   where w.source_type in ('staffing','rule_exception')
     and w.source_id = p_request_id;
  if p_status = 'approved' and v_req.ends_at > v_req.starts_at then
    insert into public.employee_availability_windows(
      organization_id, facility_id, employee_id, availability_type,
      starts_at, ends_at, reason, created_by
    )
    select v_req.organization_id, v_req.facility_id, v_req.employee_id, 'unavailable',
           v_req.starts_at, v_req.ends_at,
           coalesce(nullif(btrim(p_manager_reason), ''), v_req.reason, 'Approved time off'),
           auth.uid()
     where not exists (
       select 1 from public.employee_availability_windows a
        where a.employee_id = v_req.employee_id
          and a.availability_type = 'unavailable'
          and a.starts_at = v_req.starts_at
          and a.ends_at = v_req.ends_at
     );
  end if;
  return true;
end;
$$;

comment on function public.decide_time_off_request(uuid, text, text) is
  'Approves, denies or cancels a pending time-off request. Approval writes an unavailable '
  'availability window for the requested interval so evaluate_shift_assignment_eligibility '
  'blocks auto-fill and claims over it. Denied and canceled leave no window.';

revoke all on function public.decide_time_off_request(uuid, text, text) from public, anon;
grant execute on function public.decide_time_off_request(uuid, text, text) to authenticated;

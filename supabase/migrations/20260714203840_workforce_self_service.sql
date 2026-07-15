-- Complete employee scheduling self-service and manager decision queues.

create or replace function public.list_shift_swap_candidates(p_requester_assignment_id uuid)
returns table(
  assignment_id uuid,
  employee_name text,
  shift_date date,
  start_time time,
  end_time time,
  facility_name text,
  unit_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_requester public.shift_assignments%rowtype;
begin
  select sa.* into v_requester
  from public.shift_assignments sa
  join public.employees e on e.id = sa.employee_id
  where sa.id = p_requester_assignment_id
    and e.profile_id = auth.uid()
    and e.status = 'active';

  if not found or v_requester.status not in ('scheduled','confirmed') or v_requester.shift_date < current_date then
    raise exception 'The requester shift is outside employee scope' using errcode = '42501';
  end if;

  return query
  select sa.id, btrim(e.first_name || ' ' || e.last_name), sa.shift_date,
    sa.start_time, sa.end_time, f.name, u.name
  from public.shift_assignments sa
  join public.employees e on e.id = sa.employee_id and e.status = 'active'
  join public.facilities f on f.id = sa.facility_id
  left join public.facility_units u on u.id = sa.unit_id
  where sa.organization_id = v_requester.organization_id
    and sa.facility_id = v_requester.facility_id
    and sa.employee_id <> v_requester.employee_id
    and sa.status in ('scheduled','confirmed')
    and sa.shift_date >= current_date
    and not exists (
      select 1 from public.shift_swap_requests r
      where r.status = 'pending'
        and (r.requester_assignment_id in (v_requester.id, sa.id)
          or r.target_assignment_id in (v_requester.id, sa.id))
    )
  order by sa.shift_date, sa.start_time, e.last_name, e.first_name
  limit 100;
end;
$function$;

create or replace function public.cancel_time_off_request(p_request_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.workforce_time_off_requests%rowtype;
begin
  select r.* into v_request
  from public.workforce_time_off_requests r
  join public.employees e on e.id = r.employee_id
  where r.id = p_request_id and e.profile_id = auth.uid()
  for update of r;
  if not found then raise exception 'Time-off request was not found' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then raise exception 'Only pending requests can be canceled' using errcode = '55000'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'A cancellation reason is required' using errcode = '22023'; end if;
  update public.workforce_time_off_requests
  set status = 'canceled', manager_reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now()
  where id = v_request.id;
  return true;
end;
$function$;

create or replace function public.cancel_shift_swap_request(p_request_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.shift_swap_requests%rowtype;
begin
  select r.* into v_request
  from public.shift_swap_requests r
  join public.employees e on e.id = r.requester_employee_id
  where r.id = p_request_id and e.profile_id = auth.uid()
  for update of r;
  if not found then raise exception 'Shift-swap request was not found' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then raise exception 'Only pending swaps can be canceled' using errcode = '55000'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'A cancellation reason is required' using errcode = '22023'; end if;
  update public.shift_swap_requests
  set status = 'canceled', decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason)
  where id = v_request.id;
  return true;
end;
$function$;

create or replace function public.decide_open_shift_claim(
  p_claim_id uuid,
  p_approve boolean,
  p_reason text
)
returns public.open_shift_claims
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim public.open_shift_claims%rowtype;
  v_open public.open_shift_opportunities%rowtype;
  v_employee public.employees%rowtype;
  v_result jsonb;
  v_decision_id uuid;
  v_assignment_id uuid;
  v_approved_count integer;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('open-shift-claim:' || p_claim_id::text, 0));
  select * into v_claim from public.open_shift_claims where id = p_claim_id for update;
  if not found then raise exception 'Open-shift claim was not found' using errcode = 'P0002'; end if;
  select * into v_open from public.open_shift_opportunities where id = v_claim.opportunity_id for update;
  perform app_private.assert_phase3_admin(v_claim.organization_id, 'scheduling.self_service.manage', v_open.facility_id);
  select * into v_employee from public.employees where id = v_claim.employee_id;
  if not found then raise exception 'The employee was not found' using errcode = 'P0002'; end if;
  if v_claim.claim_status not in ('pending_approval','waitlisted') then
    raise exception 'The open-shift claim is not awaiting a decision' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'A decision reason is required' using errcode = '22023'; end if;

  if not p_approve then
    update public.open_shift_claims
    set claim_status = 'rejected', waitlist_position = null, decided_by = auth.uid(),
      decided_at = now(), decision_reason = btrim(p_reason)
    where id = v_claim.id returning * into v_claim;
  else
    if v_open.status not in ('open','filled') or v_open.shift_date < current_date then
      raise exception 'The open shift is no longer available' using errcode = '55000';
    end if;
    select count(*)::integer into v_approved_count
    from public.open_shift_claims c
    where c.opportunity_id = v_open.id and c.claim_status = 'approved' and c.id <> v_claim.id;
    if v_approved_count >= v_open.slots then
      raise exception 'All open-shift slots are already filled' using errcode = '23514';
    end if;
    if v_employee.status <> 'active' then raise exception 'The employee is no longer active' using errcode = '23514'; end if;
    v_starts := v_open.shift_date + v_open.start_time;
    v_ends := v_open.shift_date + v_open.end_time
      + case when v_open.end_time <= v_open.start_time then interval '1 day' else interval '0' end;
    v_result := public.evaluate_schedule_eligibility(
      v_employee.id, v_open.facility_id, v_starts, v_ends,
      v_open.required_qualification_keys, v_open.required_credential_types,
      v_open.required_training_type_ids, array[]::uuid[]
    );
    v_decision_id := app_private.persist_schedule_eligibility_decision(
      v_employee.id, v_open.facility_id, 'open_shift_claim', 'open_shift', v_open.id,
      v_starts, v_ends, v_result
    );
    if v_result->>'outcome' = 'blocked' then
      raise exception 'Open-shift approval blocked: %', v_result->'hardBlocks' using errcode = '23514';
    end if;
    insert into public.shift_assignments(
      organization_id, schedule_id, facility_id, employee_id, unit_id,
      shift_definition_id, shift_date, start_time, end_time, status, source, notes
    ) values (
      v_open.organization_id, v_open.schedule_id, v_open.facility_id, v_employee.id,
      v_open.unit_id, v_open.shift_definition_id, v_open.shift_date, v_open.start_time,
      v_open.end_time, 'confirmed', 'self_service', '[approved open-shift claim] ' || btrim(p_reason)
    ) returning id into v_assignment_id;
    update public.open_shift_claims
    set claim_status = 'approved', waitlist_position = null, eligibility_decision_id = v_decision_id,
      shift_assignment_id = v_assignment_id, decided_by = auth.uid(), decided_at = now(),
      decision_reason = btrim(p_reason)
    where id = v_claim.id returning * into v_claim;
    if v_approved_count + 1 >= v_open.slots then
      update public.open_shift_opportunities set status = 'filled' where id = v_open.id;
    end if;
  end if;

  insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
  values(v_claim.organization_id, v_employee.profile_id, 'open_shift_claim_changed',
    'Open shift claim ' || replace(v_claim.claim_status, '_', ' '),
    'A manager recorded a decision: ' || btrim(p_reason), '/me/schedule');
  return v_claim;
end;
$function$;

revoke all on function public.list_shift_swap_candidates(uuid) from public, anon;
revoke all on function public.cancel_time_off_request(uuid,text) from public, anon;
revoke all on function public.cancel_shift_swap_request(uuid,text) from public, anon;
revoke all on function public.decide_open_shift_claim(uuid,boolean,text) from public, anon;
grant execute on function public.list_shift_swap_candidates(uuid) to authenticated;
grant execute on function public.cancel_time_off_request(uuid,text) to authenticated;
grant execute on function public.cancel_shift_swap_request(uuid,text) to authenticated;
grant execute on function public.decide_open_shift_claim(uuid,boolean,text) to authenticated;
grant execute on function public.list_shift_swap_candidates(uuid) to service_role;
grant execute on function public.cancel_time_off_request(uuid,text) to service_role;
grant execute on function public.cancel_shift_swap_request(uuid,text) to service_role;
grant execute on function public.decide_open_shift_claim(uuid,boolean,text) to service_role;

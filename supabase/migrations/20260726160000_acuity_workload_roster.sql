-- Acuity roster for advisory workload (program plan Phase 8b, request item 19).
--
-- WHAT THIS DOES AND DOES NOT DO. It hands over the roster: each active resident's recorded care
-- attributes, their scheduled service tasks and appointment escorts in the period, and each shift
-- with who is on it and what they hold. It computes no workload figure at all.
--
-- The arithmetic lives in `acuityWorkload.ts`, and that is the point rather than an accident: the
-- Phase 8 exit gate requires the output be reproducible from a fixture roster, and a pure function
-- over a plain object is reproducible by construction and testable without a database. Putting the
-- weights in SQL would make them unverifiable except by running a database, and they are exactly the
-- numbers a facility should be able to inspect and argue with.
--
-- `get_schedule_service_workload` (20260713221000) already reports census, two-person transfers,
-- escorts, safety checks and appointment demand against configured `service_workload_profiles`
-- minimums, and is untouched. This adds the acuity dimensions that arrived with the Phase 1 care
-- header -- level of care, transfers, mobility, fall and elopement risk, cognition -- plus recent
-- admissions and hospital returns.
--
-- Rollback: drop the function.

create or replace function public.get_schedule_acuity_roster(p_schedule_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_schedule public.schedules%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_residents jsonb;
  v_shifts jsonb;
begin
  -- security invoker: the schedules, residents and shift_assignments RLS policies decide what is
  -- visible, exactly as they would for a direct read. Nothing here needs widened privileges.
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if not found then raise exception 'Schedule not found' using errcode = 'P0002'; end if;

  v_start := v_schedule.period_start::timestamptz;
  v_end := (v_schedule.period_end + 1)::timestamptz;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.display_name), '[]'::jsonb)
    into v_residents
  from (
    select
      res.id,
      btrim(res.first_name || ' ' || res.last_name) as display_name,
      res.status,
      res.level_of_care,
      res.transfer_assistance,
      res.ambulation_status,
      res.fall_risk,
      res.elopement_risk,
      res.cognitive_status,
      res.admission_date,
      (
        select max(h.return_time)
        from public.hospital_transfer_episodes h
        where h.resident_id = res.id and h.status = 'returned'
      ) as last_hospital_return_at,
      (
        select count(*)
        from public.resident_service_task_instances t
        where t.resident_id = res.id
          and t.status <> 'superseded'
          and t.scheduled_start < v_end
          and t.scheduled_end > v_start
      )::integer as scheduled_service_tasks,
      (
        -- An escort is a staff member actually assigned to accompany or drive, not an inference
        -- from the transport mode: a family-driven appointment costs the facility no escort time,
        -- and a facility-vehicle appointment with nobody assigned yet is a scheduling gap rather
        -- than workload that exists.
        select count(distinct c.id)
        from public.resident_service_calendar_events c
        join public.resident_service_calendar_event_staff cs on cs.event_id = c.id
        where c.resident_id = res.id
          and c.starts_at < v_end
          and c.starts_at >= v_start
          and c.status = 'scheduled'
          and cs.assignment_role in ('driver', 'accompanying_staff')
      )::integer as appointment_escorts
    from public.residents res
    where res.facility_id = v_schedule.facility_id
      and res.status = 'active'
  ) r;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.label), '[]'::jsonb)
    into v_shifts
  from (
    select
      sd.id::text || ':' || coalesce(u.id::text, 'facility') as key,
      sd.name || coalesce(' — ' || u.name, '') as label,
      u.name as unit_name,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'employee_id', e.id,
          'display_name', btrim(e.first_name || ' ' || e.last_name),
          -- The qualifications the person actually holds right now, which is what a gap is measured
          -- against. An expired qualification is not a held one.
          'qualification_keys', coalesce((
            select jsonb_agg(distinct cd.qualification_key)
            from public.employee_qualifications eq
            join public.certification_definitions cd on cd.id = eq.certification_definition_id
            where eq.employee_id = e.id
              and eq.state = 'active'
              and eq.effective_from <= now()
              and (eq.expires_at is null or eq.expires_at > now())
              and (eq.effective_to is null or eq.effective_to > now())
          ), '[]'::jsonb)
        ))
        from public.shift_assignments sa
        join public.employees e on e.id = sa.employee_id
        where sa.facility_id = v_schedule.facility_id
          and sa.shift_definition_id = sd.id
          and sa.unit_id is not distinct from u.id
          and sa.shift_date between v_schedule.period_start and v_schedule.period_end
          and sa.status in ('scheduled', 'confirmed')
      ), '[]'::jsonb) as staff,
      coalesce(w.required_qualification_keys, array[]::text[]) as required_qualification_keys,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', req.service_name,
          'required_qualification_key', req.required_qualification_key
        ))
        from public.resident_service_requirements req
        where req.facility_id = v_schedule.facility_id
          and req.required_qualification_key is not null
          and req.status = 'active'
      ), '[]'::jsonb) as critical_services
    from public.service_workload_profiles w
    join public.shift_definitions sd on sd.id = w.shift_definition_id
    left join public.facility_units u on u.id = w.unit_id
    where w.facility_id = v_schedule.facility_id
  ) s;

  return jsonb_build_object(
    'scheduleId', v_schedule.id,
    'facilityId', v_schedule.facility_id,
    'periodStart', v_schedule.period_start,
    'periodEnd', v_schedule.period_end,
    'residents', v_residents,
    'shifts', v_shifts,
    -- Carried in the payload as well as the UI so an export or an API consumer cannot present these
    -- numbers as a staffing requirement without also carrying the sentence that says they are not.
    'advisoryNotice', 'Advisory only. These are estimated care minutes from recorded resident '
      || 'attributes, not a required staffing level, and no Pennsylvania regulation prescribes them.'
  );
end $$;
revoke all on function public.get_schedule_acuity_roster(uuid) from public, anon;
grant execute on function public.get_schedule_acuity_roster(uuid) to authenticated, service_role;

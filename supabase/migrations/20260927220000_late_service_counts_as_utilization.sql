-- Care-actually-delivered omitted late services.
--
-- get_resident_service_utilization builds its exceptions object from
-- completion_response, and a delivery after the due window keeps
-- completed_as_planned on that column. The late fact is status
-- completed_late. The support-plan card therefore said there were no
-- exceptions when the only exception was that the care was late.
-- A response that is already an exception stays on that response, so a late
-- extra-assistance note is not counted twice.

create or replace function public.get_resident_service_utilization(
  p_resident_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  v_since := now() - (v_days || ' days')::interval;
  return jsonb_build_object(
    'residentId', p_resident_id,
    'windowDays', v_days,
    'since', v_since,
    'unscheduled', coalesce((
      select jsonb_object_agg(service_kind, kind_count)
      from (
        select service_kind, count(*) as kind_count
        from public.resident_unscheduled_services u
        where u.resident_id = p_resident_id and u.occurred_at >= v_since
        group by service_kind
      ) kinds
    ), '{}'::jsonb),
    'unscheduledTotal', (
      select count(*) from public.resident_unscheduled_services u
      where u.resident_id = p_resident_id and u.occurred_at >= v_since
    ),
    'exceptions', coalesce((
      select jsonb_object_agg(response_key, response_count)
      from (
        select response_key, count(*) as response_count
        from (
          select t.completion_response as response_key
          from public.resident_service_task_instances t
          where t.resident_id = p_resident_id
            and t.completion_response is not null
            and t.completion_response <> 'completed_as_planned'
            and coalesce(t.performed_at, t.scheduled_start) >= v_since
          union all
          select 'completed_late'::text
          from public.resident_service_task_instances t
          where t.resident_id = p_resident_id
            and t.status = 'completed_late'
            and (t.completion_response is null or t.completion_response = 'completed_as_planned')
            and coalesce(t.performed_at, t.scheduled_start) >= v_since
        ) rows
        group by response_key
      ) responses
    ), '{}'::jsonb),
    'documentedAssistance', coalesce((
      select jsonb_object_agg(documented_assistance_level, level_count)
      from (
        select documented_assistance_level, count(*) as level_count
        from public.resident_service_task_instances t
        where t.resident_id = p_resident_id
          and t.documented_assistance_level is not null
          and coalesce(t.performed_at, t.scheduled_start) >= v_since
        group by documented_assistance_level
      ) levels
    ), '{}'::jsonb)
  );
end $$;

revoke all on function public.get_resident_service_utilization(uuid, integer) from public, anon;
grant execute on function public.get_resident_service_utilization(uuid, integer) to authenticated, service_role;

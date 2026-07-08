-- Include resident-assessment wellness-summary generations in the platform health AI counters.
-- The dashboard labels are intentionally generic (AI generations), so once the resident-summary
-- audit table exists these counts should cover both AI content tables rather than course drafts
-- alone.
create or replace function public.get_platform_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may read platform health' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'orgsByStatus', (
      select coalesce(jsonb_object_agg(subscription_status, cnt), '{}'::jsonb)
      from (select subscription_status, count(*) cnt from public.organizations group by subscription_status) s
    ),
    'notificationDeliveriesPending', (select count(*) from public.notification_deliveries where status = 'pending'),
    'notificationDeliveriesFailed', (select count(*) from public.notification_deliveries where status = 'failed'),
    'aiGenerationsPending', (
      (select count(*) from public.course_ai_generations where status = 'pending' and created_at > now() - interval '30 days')
      + (select count(*) from public.resident_assessment_ai_generations where status = 'pending' and created_at > now() - interval '30 days')
    ),
    'aiGenerationsFailed', (
      (select count(*) from public.course_ai_generations where status = 'failed' and created_at > now() - interval '30 days')
      + (select count(*) from public.resident_assessment_ai_generations where status = 'failed' and created_at > now() - interval '30 days')
    ),
    'heygenJobsInProgress', (
      select count(*) from public.course_blocks
      where body->'heygen'->>'status' is not null
        and body->'heygen'->>'status' not in ('completed', 'failed')
    ),
    'totalFacilities', (select count(*) from public.facilities),
    'totalEmployees', (select count(*) from public.employees),
    'totalCourses', (select count(*) from public.courses)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_platform_health() to authenticated;
revoke execute on function public.get_platform_health() from anon;

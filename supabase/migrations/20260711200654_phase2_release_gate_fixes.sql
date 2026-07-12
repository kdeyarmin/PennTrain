-- Keep the Phase 1 recovery control-plane return contract valid after the
-- retry-cost column was promoted to numeric storage. PostgreSQL validates all
-- RETURN QUERY branches even when no rows currently contain retry cost.
create or replace function public.get_system_job_recovery_state()
returns table (
  job_key text,
  latest_run_id uuid,
  kill_switch_enabled boolean,
  kill_switch_reason text,
  circuit_state text,
  circuit_open_until timestamptz,
  last_known_good_at timestamptz,
  last_known_good_result jsonb,
  cancellation_pending boolean,
  dead_letter_count bigint,
  latest_dead_letter_run_id uuid,
  queue_age_ms bigint,
  failure_rate_24h numeric,
  provider_latency_ms_24h bigint,
  retry_cost_units_24h bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may inspect job recovery state' using errcode = '42501';
  end if;

  return query
  select
    d.job_key,
    latest.id,
    d.kill_switch_enabled,
    d.kill_switch_reason,
    d.circuit_state,
    d.circuit_open_until,
    d.last_known_good_at,
    d.last_known_good_result,
    coalesce(latest.cancellation_requested_at is not null and latest.status = 'running', false),
    (select count(*) from app_private.system_job_runs dl
      where dl.job_key = d.job_key and dl.dead_lettered_at is not null),
    dead.id,
    case d.job_key
      when 'notification-dispatch' then (
        select (extract(epoch from (now() - min(n.created_at))) * 1000)::bigint
        from public.notification_deliveries n where n.status = 'pending'
      )
      when 'certificate-pdf-generation' then (
        select (extract(epoch from (now() - min(j.requested_at))) * 1000)::bigint
        from public.certificate_pdf_jobs j where j.status in ('pending', 'failed')
      )
      else null
    end,
    coalesce((
      select round(
        count(*) filter (where r.status in ('failed', 'partial'))::numeric
        / nullif(count(*), 0),
        4
      )
      from app_private.system_job_runs r
      where r.job_key = d.job_key and r.started_at >= now() - interval '24 hours'
    ), 0),
    case when d.job_key = 'notification-dispatch' then (
      select avg(extract(epoch from (e.received_at - a.started_at)) * 1000)::bigint
      from public.notification_provider_events e
      join public.notification_delivery_attempts a on a.id = e.attempt_id
      where e.received_at >= now() - interval '24 hours'
        and e.outcome is not null
    ) else (
      select avg(r.provider_latency_ms)::bigint
      from app_private.system_job_runs r
      where r.job_key = d.job_key
        and r.started_at >= now() - interval '24 hours'
        and r.provider_latency_ms is not null
    ) end,
    case when d.job_key = 'notification-dispatch' then (
      select count(*)::bigint
      from public.notification_delivery_attempts a
      where a.started_at >= now() - interval '24 hours' and a.attempt_number > 1
    ) else coalesce((
      select sum(r.retry_cost_units)::bigint
      from app_private.system_job_runs r
      where r.job_key = d.job_key and r.started_at >= now() - interval '24 hours'
    ), 0::bigint) end
  from app_private.system_job_definitions d
  left join lateral (
    select r.* from app_private.system_job_runs r
    where r.job_key = d.job_key order by r.started_at desc limit 1
  ) latest on true
  left join lateral (
    select r.id from app_private.system_job_runs r
    where r.job_key = d.job_key and r.dead_lettered_at is not null
    order by r.dead_lettered_at desc limit 1
  ) dead on true
  where d.is_active
  order by d.display_name;
end;
$function$;

revoke all on function public.get_system_job_recovery_state()
from public, anon;
grant execute on function public.get_system_job_recovery_state()
to authenticated;

-- Phase 2's early migrations can only check the JWT AAL because the identity
-- policy is installed later in the chain. Rebind their shared guard and the
-- small direct-write RLS surface now that session-age enforcement exists.
create or replace function app_private.assert_phase2_aal2()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' then
    return;
  end if;
  if auth.uid() is null then
    raise exception 'An authenticated administrator is required'
      using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('enterprise_scope_admin');
end;
$function$;

revoke all on function app_private.assert_phase2_aal2()
from public, anon, authenticated, service_role;

alter policy enterprise_scope_exceptions_update
on public.enterprise_scope_backfill_exceptions
using (
  (select public.identity_assurance_is_current('enterprise_scope_admin')) and (
    (organization_id is not null and public.has_effective_permission(
      'enterprise.scope.manage', 'organization', organization_id
    ))
    or public.has_effective_permission('enterprise.scope.manage', 'platform', null)
  )
)
with check (
  (select public.identity_assurance_is_current('enterprise_scope_admin')) and (
    (organization_id is not null and public.has_effective_permission(
      'enterprise.scope.manage', 'organization', organization_id
    ))
    or public.has_effective_permission('enterprise.scope.manage', 'platform', null)
  )
);

alter policy workforce_backfill_exceptions_update
on public.workforce_backfill_exceptions
using (
  (select public.identity_assurance_is_current('workforce_admin'))
  and public.has_effective_permission(
    'workforce.lifecycle.manage', 'organization', organization_id
  )
)
with check (
  (select public.identity_assurance_is_current('workforce_admin'))
  and public.has_effective_permission(
    'workforce.lifecycle.manage', 'organization', organization_id
  )
);

alter policy compliance_profile_definitions_insert
on public.compliance_profile_definitions
with check (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and organization_id is not null
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
  and not is_system_managed and not is_mandatory_baseline
);

alter policy compliance_profile_definitions_update
on public.compliance_profile_definitions
using (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and organization_id is not null
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
  and not is_system_managed
)
with check (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and organization_id is not null
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
  and not is_system_managed
);

alter policy compliance_profile_requirements_insert
on public.compliance_profile_requirements
with check (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and exists (
    select 1 from public.compliance_profile_definitions p
    where p.id = profile_definition_id
      and p.organization_id is not null and not p.is_system_managed
      and public.has_effective_permission(
        'workforce.compliance.manage', 'organization', p.organization_id
      )
  )
);

alter policy compliance_profile_requirements_update
on public.compliance_profile_requirements
using (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and exists (
    select 1 from public.compliance_profile_definitions p
    where p.id = profile_definition_id
      and p.organization_id is not null and not p.is_system_managed
      and public.has_effective_permission(
        'workforce.compliance.manage', 'organization', p.organization_id
      )
  )
)
with check (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and exists (
    select 1 from public.compliance_profile_definitions p
    where p.id = profile_definition_id
      and p.organization_id is not null and not p.is_system_managed
      and public.has_effective_permission(
        'workforce.compliance.manage', 'organization', p.organization_id
      )
  )
);

alter policy compliance_profile_mapping_rules_insert
on public.compliance_profile_mapping_rules
with check (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
);

alter policy compliance_profile_mapping_rules_update
on public.compliance_profile_mapping_rules
using (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
)
with check (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and public.has_effective_permission(
    'workforce.compliance.manage', 'organization', organization_id
  )
);

alter policy compliance_resolution_exceptions_update
on public.compliance_profile_resolution_exceptions
using (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and public.has_effective_permission(
    'workforce.compliance.manage', 'facility', facility_id
  )
)
with check (
  (select public.identity_assurance_is_current('compliance_profile_admin'))
  and public.has_effective_permission(
    'workforce.compliance.manage', 'facility', facility_id
  )
);

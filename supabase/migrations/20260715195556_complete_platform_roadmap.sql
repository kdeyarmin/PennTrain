-- Completes the A1-C3 roadmap after end-to-end acceptance review. This is a
-- forward-only follow-up so environments that exercised the original feature
-- migration can upgrade without rewriting applied migration history.

-- B2: add the roadmap's citation-topic aggregate and return the facility's own
-- comparable values. A topic is published only when that topic itself meets
-- the k-anonymity threshold, not merely when the overall cohort does.
create or replace function public.refresh_benchmark_snapshots(
  p_period_end date default current_date,
  p_k_threshold integer default 10
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare v_inserted integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the trusted analytics worker may refresh benchmarks' using errcode = '42501';
  end if;
  if p_k_threshold < 10 then raise exception 'Benchmark k threshold cannot be below 10' using errcode = '22023'; end if;
  -- Recompute the period atomically so a cohort that has fallen below k cannot
  -- remain queryable through a snapshot written by an earlier refresh.
  delete from public.benchmark_snapshots
  where period_start = p_period_end - 364 and period_end = p_period_end;
  with facility_metrics as (
    select f.id, f.organization_id, 'US-' || upper(coalesce(nullif(f.state,''), 'PA')) as jurisdiction_code,
      f.facility_type,
      coalesce((select 100.0 * count(*) filter (where r.status = 'compliant') / nullif(count(*),0)
        from public.employee_training_records r where r.facility_id = f.id), 0)::numeric as training_rate,
      coalesce((select percentile_cont(0.5) within group (order by greatest(0, c.expiration_date - p_period_end))
        from public.employee_credentials c where c.facility_id = f.id and c.status in ('compliant','due_soon')
          and c.expiration_date is not null), 0)::numeric as median_renewal_days,
      coalesce((select 100.0 * count(*) / nullif((select count(*) from public.residents r
        where r.facility_id = f.id and r.status = 'active'),0)
        from public.incidents i where i.facility_id = f.id
          and i.occurred_at >= p_period_end - interval '1 year'
          and i.occurred_at < p_period_end + interval '1 day'), 0)::numeric as incidents_per_100_beds
    from public.facilities f where f.is_active and f.facility_type in ('PCH','ALR')
  ), cohort_metrics as (
    select jurisdiction_code, facility_type, count(distinct organization_id)::integer as organization_count,
      count(*)::integer as facility_count,
      jsonb_build_object(
        'trainingComplianceRate', jsonb_build_object(
          'p25', percentile_cont(0.25) within group (order by training_rate),
          'p50', percentile_cont(0.50) within group (order by training_rate),
          'p75', percentile_cont(0.75) within group (order by training_rate)),
        'medianCredentialRenewalDays', jsonb_build_object(
          'p25', percentile_cont(0.25) within group (order by median_renewal_days),
          'p50', percentile_cont(0.50) within group (order by median_renewal_days),
          'p75', percentile_cont(0.75) within group (order by median_renewal_days)),
        'incidentsPer100OccupiedBeds', jsonb_build_object(
          'p25', percentile_cont(0.25) within group (order by incidents_per_100_beds),
          'p50', percentile_cont(0.50) within group (order by incidents_per_100_beds),
          'p75', percentile_cont(0.75) within group (order by incidents_per_100_beds))
      ) as metrics
    from facility_metrics group by jurisdiction_code, facility_type
    having count(distinct organization_id) >= p_k_threshold
  ), eligible_citation_topics as (
    select 'US-' || upper(coalesce(nullif(f.state,''), 'PA')) as jurisdiction_code,
      f.facility_type, ct.citation_ref, ct.title,
      count(distinct v.organization_id)::integer as organization_count,
      count(*)::integer as violation_count
    from public.dhs_violations v
    join public.facilities f on f.id = v.facility_id and f.is_active
      and f.facility_type in ('PCH','ALR')
    left join public.dhs_citation_topics ct on ct.id = v.citation_topic_id
    where v.inspection_date between p_period_end - 364 and p_period_end
    group by 'US-' || upper(coalesce(nullif(f.state,''), 'PA')),
      f.facility_type, ct.citation_ref, ct.title
    having count(distinct v.organization_id) >= p_k_threshold
  ), ranked_citation_topics as (
    select *, row_number() over (
      partition by jurisdiction_code, facility_type
      order by violation_count desc, coalesce(citation_ref, ''), coalesce(title, '')
    ) as topic_rank
    from eligible_citation_topics
  ), citation_topics as (
    select jurisdiction_code, facility_type,
      jsonb_agg(jsonb_build_object(
        'citationRef', citation_ref,
        'title', coalesce(title, 'Uncategorized citation'),
        'organizationCount', organization_count,
        'violationCount', violation_count
      ) order by topic_rank) as topics
    from ranked_citation_topics where topic_rank <= 5
    group by jurisdiction_code, facility_type
  ), cohorts as (
    select c.jurisdiction_code, c.facility_type, c.organization_count,
      c.facility_count, c.metrics || jsonb_build_object(
        'topCitationTopics', coalesce(t.topics, '[]'::jsonb)
      ) as metrics
    from cohort_metrics c
    left join citation_topics t using (jurisdiction_code, facility_type)
  ), written as (
    insert into public.benchmark_snapshots (
      jurisdiction_code, facility_type, period_start, period_end,
      organization_count, facility_count, k_threshold, metrics, cohort_checksum_sha256
    ) select jurisdiction_code, facility_type, p_period_end - 364, p_period_end,
      organization_count, facility_count, p_k_threshold, metrics,
      encode(extensions.digest(convert_to(jsonb_build_object(
        'jurisdiction', jurisdiction_code, 'facilityType', facility_type,
        'periodEnd', p_period_end, 'organizationCount', organization_count,
        'facilityCount', facility_count, 'metrics', metrics)::text, 'utf8'), 'sha256'), 'hex')
    from cohorts
    on conflict (jurisdiction_code, facility_type, period_start, period_end) do update
      set organization_count = excluded.organization_count,
          facility_count = excluded.facility_count, k_threshold = excluded.k_threshold,
          metrics = excluded.metrics, cohort_checksum_sha256 = excluded.cohort_checksum_sha256,
          generated_at = now()
    returning 1
  ) select count(*) into v_inserted from written;
  return v_inserted;
end;
$function$;
revoke all on function public.refresh_benchmark_snapshots(date,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.refresh_benchmark_snapshots(date,integer) to service_role;

create or replace function public.get_facility_benchmark_comparison(p_facility_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_facility public.facilities%rowtype;
  v_access jsonb;
  v_snapshot public.benchmark_snapshots%rowtype;
  v_training_rate numeric;
  v_renewal_days numeric;
  v_incidents_per_100 numeric;
  v_citation_topics jsonb;
begin
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  if not (public.is_platform_admin() or (
    v_facility.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','auditor')
    and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(v_facility.id)))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    v_access := public.evaluate_feature_access(v_facility.organization_id, 'analytics.cross_tenant_benchmarks');
    if coalesce((v_access->>'allowed')::boolean, false) is not true then
      raise exception 'Cross-tenant benchmarks are not released for this organization' using errcode = '42501';
    end if;
  end if;
  select * into v_snapshot from public.benchmark_snapshots
  where jurisdiction_code = 'US-' || upper(coalesce(nullif(v_facility.state,''), 'PA'))
    and facility_type = v_facility.facility_type
  order by period_end desc, generated_at desc limit 1;
  if not found then return jsonb_build_object('available', false, 'reason', 'cohort_below_k_or_not_generated'); end if;

  select coalesce(100.0 * count(*) filter (where r.status = 'compliant') / nullif(count(*),0), 0)
    into v_training_rate from public.employee_training_records r where r.facility_id = v_facility.id;
  select coalesce(percentile_cont(0.5) within group (
      order by greatest(0, c.expiration_date - v_snapshot.period_end)), 0)
    into v_renewal_days from public.employee_credentials c
    where c.facility_id = v_facility.id and c.status in ('compliant','due_soon') and c.expiration_date is not null;
  select coalesce(100.0 * count(*) / nullif((select count(*) from public.residents r
      where r.facility_id = v_facility.id and r.status = 'active'),0), 0)
    into v_incidents_per_100 from public.incidents i
    where i.facility_id = v_facility.id
      and i.occurred_at >= v_snapshot.period_end - interval '1 year'
      and i.occurred_at < v_snapshot.period_end + interval '1 day';
  select coalesce(jsonb_agg(jsonb_build_object(
      'citationRef', topic.citation_ref,
      'title', topic.title,
      'violationCount', topic.violation_count
    ) order by topic.violation_count desc, topic.title), '[]'::jsonb)
    into v_citation_topics
  from (
    select ct.citation_ref, coalesce(ct.title, 'Uncategorized citation') as title,
      count(*)::integer as violation_count
    from public.dhs_violations v
    left join public.dhs_citation_topics ct on ct.id = v.citation_topic_id
    where v.facility_id = v_facility.id
      and v.inspection_date between v_snapshot.period_start and v_snapshot.period_end
    group by ct.citation_ref, ct.title
    order by count(*) desc, coalesce(ct.title, 'Uncategorized citation')
    limit 5
  ) topic;

  return jsonb_build_object('available', true, 'facilityId', v_facility.id,
    'cohort', jsonb_build_object('jurisdictionCode', v_snapshot.jurisdiction_code,
      'facilityType', v_snapshot.facility_type, 'organizationCount', v_snapshot.organization_count,
      'facilityCount', v_snapshot.facility_count, 'kThreshold', v_snapshot.k_threshold,
      'periodStart', v_snapshot.period_start, 'periodEnd', v_snapshot.period_end),
    'metrics', v_snapshot.metrics,
    'facilityMetrics', jsonb_build_object(
      'trainingComplianceRate', round(v_training_rate, 1),
      'medianCredentialRenewalDays', round(v_renewal_days, 0),
      'incidentsPer100OccupiedBeds', round(v_incidents_per_100, 1),
      'topCitationTopics', v_citation_topics),
    'generatedAt', v_snapshot.generated_at);
end;
$function$;
revoke all on function public.get_facility_benchmark_comparison(uuid) from public, anon;
grant execute on function public.get_facility_benchmark_comparison(uuid) to authenticated;

-- B3: scheduled future terminations and future-dated employment episodes are
-- not historical turnover events.
create or replace function public.get_workforce_retention_metrics(p_facility_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_org uuid := public.current_org_id(); v_result jsonb;
begin
  if not (public.is_platform_admin() or public.current_role() in ('org_admin','facility_manager','auditor')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_facility_id is not null and not exists (
    select 1 from public.facilities f where f.id = p_facility_id
      and (public.is_platform_admin() or f.organization_id = v_org)
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(f.id))
  ) then raise exception 'Facility not found or outside scope' using errcode = '42501'; end if;
  with scoped as (
    select ep.*, e.job_title
    from public.employment_episodes ep join public.employees e on e.id = ep.employee_id
    where ep.started_on <= current_date
      and (public.is_platform_admin() or ep.organization_id = v_org)
      and (p_facility_id is null or ep.facility_id = p_facility_id)
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(ep.facility_id))
  ), roles as (
    select coalesce(job_title, 'Unspecified') as role,
      count(*) filter (where ended_on between current_date - 364 and current_date)::integer as separations,
      count(*) filter (where ended_on is null or ended_on >= current_date)::integer as current_headcount,
      count(*) filter (where started_on <= current_date - 364 and (ended_on is null or ended_on >= current_date - 364))::integer as starting_headcount,
      count(*) filter (where started_on between current_date - 455 and current_date - 90)::integer as ninety_day_cohort,
      count(*) filter (where started_on between current_date - 455 and current_date - 90
        and (ended_on is null or ended_on >= started_on + 90))::integer as ninety_day_retained,
      avg((least(coalesce(ended_on, current_date), current_date) - started_on)::numeric) as average_tenure_days
    from scoped group by coalesce(job_title, 'Unspecified')
  ), total as (
    select 'All roles'::text as role,
      count(*) filter (where ended_on between current_date - 364 and current_date)::integer as separations,
      count(*) filter (where ended_on is null or ended_on >= current_date)::integer as current_headcount,
      count(*) filter (where started_on <= current_date - 364 and (ended_on is null or ended_on >= current_date - 364))::integer as starting_headcount,
      count(*) filter (where started_on between current_date - 455 and current_date - 90)::integer as ninety_day_cohort,
      count(*) filter (where started_on between current_date - 455 and current_date - 90
        and (ended_on is null or ended_on >= started_on + 90))::integer as ninety_day_retained,
      avg((least(coalesce(ended_on, current_date), current_date) - started_on)::numeric) as average_tenure_days
    from scoped
  ), combined as (select * from total union all select * from roles)
  select jsonb_build_object('asOf', current_date, 'facilityId', p_facility_id,
    'methodology', jsonb_build_object('turnoverWindowDays',365,'retentionWindowDays',90,
      'turnoverDenominator','average of starting and current headcount'),
    'segments', coalesce(jsonb_agg(jsonb_build_object(
      'role', role, 'separations', separations, 'currentHeadcount', current_headcount,
      'annualizedTurnoverRate', round(100 * separations / nullif((starting_headcount + current_headcount)::numeric / 2, 0), 1),
      'ninetyDayCohort', ninety_day_cohort,
      'ninetyDayRetentionRate', round(100 * ninety_day_retained / nullif(ninety_day_cohort,0)::numeric, 1),
      'averageTenureDays', round(average_tenure_days, 0)
    ) order by case when role = 'All roles' then 0 else 1 end, role), '[]'::jsonb)) into v_result
  from combined;
  return v_result;
end;
$function$;
revoke all on function public.get_workforce_retention_metrics(uuid) from public, anon;
grant execute on function public.get_workforce_retention_metrics(uuid) to authenticated;

-- Preserve an already-selected web-push preference when an administrator or
-- the user edits unrelated profile fields from a different browser. A newly
-- selected web-push preference still requires an active server-side endpoint.
create or replace function public.update_profile_contact_preferences(
  p_profile_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_sms_opt_in boolean,
  p_preferred_notification_channel text
)
returns setof public.profiles
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_target public.profiles%rowtype;
  v_phone text := nullif(btrim(p_phone), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_profile_id for update;
  if v_target.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if not (
    auth.uid() = v_target.id
    or public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = v_target.organization_id
    )
    or (
      public.current_role() = 'facility_manager'
      and public.current_org_id() = v_target.organization_id
      and exists (
        select 1 from public.employees e
        where e.profile_id = v_target.id
          and e.organization_id = v_target.organization_id
          and public.is_assigned_to_facility(e.facility_id)
      )
    )
  ) then
    raise exception 'Profile is outside the caller scope' using errcode = '42501';
  end if;
  if nullif(btrim(p_first_name), '') is null
     or nullif(btrim(p_last_name), '') is null
     or p_sms_opt_in is null
     or p_preferred_notification_channel is null
     or p_preferred_notification_channel not in ('email', 'sms', 'web_push')
     or (p_sms_opt_in and v_phone is null)
     or (p_preferred_notification_channel = 'sms' and (not p_sms_opt_in or v_phone is null))
     or (p_preferred_notification_channel = 'web_push'
       and v_target.preferred_notification_channel is distinct from 'web_push'
       and not exists (
         select 1 from public.push_subscriptions s
         where s.profile_id = v_target.id and s.organization_id = v_target.organization_id
           and s.disabled_at is null
           and (s.expiration_time is null or s.expiration_time > now())
       )) then
    raise exception 'Invalid profile contact or notification preference' using errcode = '22023';
  end if;

  return query
  update public.profiles
  set first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      phone = v_phone,
      sms_opt_in = p_sms_opt_in,
      sms_consent_at = case
        when p_sms_opt_in and (
          not v_target.sms_opt_in
          or public.notification_phone_key(v_target.phone)
            is distinct from public.notification_phone_key(v_phone)
        ) then now()
        else v_target.sms_consent_at
      end,
      sms_opt_out_at = case
        when p_sms_opt_in then null
        when v_target.sms_opt_in and not p_sms_opt_in then now()
        else v_target.sms_opt_out_at
      end,
      preferred_notification_channel = p_preferred_notification_channel
  where id = p_profile_id
  returning *;
end;
$function$;
revoke all on function public.update_profile_contact_preferences(
  uuid, text, text, text, boolean, text
) from public, anon;
grant execute on function public.update_profile_contact_preferences(
  uuid, text, text, text, boolean, text
) to authenticated;

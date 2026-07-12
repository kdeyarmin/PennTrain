create or replace function public.match_exclusion_list_against_roster_core(p_source text, p_organization_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.exclusion_screening_matches (organization_id, facility_id, employee_id, exclusion_list_entry_id, source, match_score, matched_name)
  select e.organization_id, e.facility_id, e.id, l.id, l.source,
    least(similarity(upper(e.last_name), upper(l.last_name)), similarity(upper(e.first_name), upper(l.first_name))) as score,
    e.last_name || ', ' || e.first_name
  from public.employees e
  join public.exclusion_list_entries l
    on l.source = p_source
    and similarity(upper(e.last_name), upper(l.last_name)) > 0.6
    and similarity(upper(e.first_name), upper(l.first_name)) > 0.5
  where e.status = 'active'
    and (p_organization_id is null or e.organization_id = p_organization_id)
  on conflict (employee_id, exclusion_list_entry_id) do nothing;

  -- One alert per newly-created pending match -- dedup via "no existing alert points at this
  -- match row yet", the same style escalate_unactioned_alerts/notify_training_alert use.
  insert into public.alerts (organization_id, facility_id, employee_id, exclusion_screening_match_id, alert_type, title, message, severity)
  select m.organization_id, m.facility_id, m.employee_id, m.id, 'exclusion_match_found',
    'Possible exclusion-list match — ' || e.first_name || ' ' || e.last_name,
    'A ' || (case when m.source = 'oig_leie' then 'OIG LEIE' else 'SAM.gov' end) || ' exclusion-list entry closely matches this employee''s name. Review in the exclusion screening queue.',
    'critical'
  from public.exclusion_screening_matches m
  join public.employees e on e.id = m.employee_id
  where m.status = 'pending_review'
    and (p_organization_id is null or m.organization_id = p_organization_id)
    and not exists (select 1 from public.alerts a where a.exclusion_screening_match_id = m.id);
end;
$$;

revoke all on function public.match_exclusion_list_against_roster_core(text, uuid) from public, anon, authenticated;

-- Public wrapper for an admin's "Re-scan roster now" button -- same explicit-internal-auth-check
-- shape as recalculate_org_compliance(), scoped to just the caller's own org rather than the
-- full cross-org sweep the cron job runs after each fresh CSV import.
create or replace function public.rescan_org_exclusion_matches(p_organization_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not (
    public.is_platform_admin()
    or (p_organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager'))
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;
  perform public.match_exclusion_list_against_roster_core('oig_leie', p_organization_id);
  perform public.match_exclusion_list_against_roster_core('sam_exclusions', p_organization_id);
end;
$$;

revoke all on function public.rescan_org_exclusion_matches(uuid) from public;
grant execute on function public.rescan_org_exclusion_matches(uuid) to authenticated;

-- move_pg_trgm_out_of_public.sql relocated pg_trgm's functions (including similarity()) out of
-- public into the extensions schema. match_exclusion_list_against_roster_core() is SECURITY
-- DEFINER with `set search_path to 'public'` and called similarity() unqualified, so unqualified
-- calls now fail to resolve at runtime (verified: `set search_path to 'public'; select
-- similarity('foo','foo')` errors with "function similarity(unknown, unknown) does not exist").
-- This function is called by the screen-exclusions Edge Function (cron + post-CSV-import) and by
-- rescan_org_exclusion_matches() (org_admin/facility_manager's manual "Re-scan roster now"
-- button), so exclusion screening was broken until this fix. Qualify both similarity() calls
-- instead of widening search_path, matching the fully-qualified public.foo() style already used
-- throughout this function and the rest of the codebase's security definer functions.
create or replace function public.match_exclusion_list_against_roster_core(p_source text, p_organization_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.exclusion_screening_matches (organization_id, facility_id, employee_id, exclusion_list_entry_id, source, match_score, matched_name)
  select e.organization_id, e.facility_id, e.id, l.id, l.source,
    least(extensions.similarity(upper(e.last_name), upper(l.last_name)), extensions.similarity(upper(e.first_name), upper(l.first_name))) as score,
    e.last_name || ', ' || e.first_name
  from public.employees e
  join public.exclusion_list_entries l
    on l.source = p_source
    and extensions.similarity(upper(e.last_name), upper(l.last_name)) > 0.6
    and extensions.similarity(upper(e.first_name), upper(l.first_name)) > 0.5
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
grant execute on function public.match_exclusion_list_against_roster_core(text, uuid) to service_role;
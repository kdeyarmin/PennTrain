-- get_advisors (security, WARN) flags pg_trgm as installed in the public schema --
-- exclusion_screening_core.sql ran `create extension if not exists pg_trgm;` with no schema
-- clause, unlike pg_cron/pg_net (enable_extensions.sql), which were already installed into
-- `extensions`. Move the already-installed extension there instead: ALTER EXTENSION ... SET
-- SCHEMA relocates its operators/functions/opclasses by OID, so the existing
-- exclusion_list_entries_*_trgm_idx GIN indexes (bound to gin_trgm_ops by OID, not by name) keep
-- working unchanged.
alter extension pg_trgm set schema extensions;

-- match_exclusion_list_against_roster_core() pins `set search_path to 'public'` and calls
-- similarity() unqualified; with pg_trgm now in `extensions` that pinned path would no longer
-- resolve it. Supabase's own default search_path already includes `extensions` for this reason --
-- add it here explicitly rather than relying on the default, consistent with every other function
-- in this project pinning its own search_path for search-path-hijacking safety.
create or replace function public.match_exclusion_list_against_roster_core(p_source text, p_organization_id uuid default null)
returns void language plpgsql security definer set search_path to 'public, extensions' as $$
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

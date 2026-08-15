-- An excluded person with a hyphenated or compound surname screened clear.
--
-- Both matchers required whole-string trigram similarity(last_name) > 0.6, but pg_trgm
-- scores 'SMITH' vs 'SMITH-JONES' at exactly 0.5: the hyphen splits the padded string into
-- two words and the union of trigrams doubles. An employee whose exclusion-list entry
-- carries one component of their compound surname (a pre-marriage name is the common case)
-- therefore produced no pending_review row and no alert -- a silent false negative in the
-- one screen whose whole purpose is not to miss listed individuals.
--
-- The fix ORs in pg_trgm's word_similarity() at 0.85, which scores the best matching
-- contiguous extent -- an exact surname component is 1.0 -- in both directions (employee
-- compound vs list simple, and the reverse). The stored match_score takes the same
-- greatest() so reviewers see the component-match strength rather than the diluted
-- whole-string score. First-name thresholds are unchanged. Both the monthly
-- match_exclusion_list_against_roster_core() and the on-hire per-employee variant get the
-- identical predicate so a hire screened today and the same roster screened monthly agree.

create or replace function public.match_exclusion_list_against_roster_core(
  p_source text,
  p_organization_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.exclusion_screening_matches (
    organization_id, facility_id, employee_id, exclusion_list_entry_id, source,
    source_record_key, match_score, matched_name
  )
  select e.organization_id, e.facility_id, e.id, l.id, l.source,
    l.source_record_key,
    least(greatest(extensions.similarity(upper(e.last_name), upper(l.last_name)),
                   extensions.word_similarity(upper(e.last_name), upper(l.last_name)),
                   extensions.word_similarity(upper(l.last_name), upper(e.last_name))),
          extensions.similarity(upper(e.first_name), upper(l.first_name))) as score,
    e.last_name || ', ' || e.first_name
  from public.employees e
  join public.exclusion_source_state s
    on s.source = p_source
  join public.exclusion_list_entries l
    on l.snapshot_id = s.active_snapshot_id
    and l.source = p_source
    and (
      extensions.similarity(upper(e.last_name), upper(l.last_name)) > 0.6
      -- Component containment for hyphenated/compound surnames: whole-string trigram
      -- similarity('SMITH', 'SMITH-JONES') is exactly 0.5 -- under the 0.6 bar -- so an
      -- excluded "SMITH, ANA" screened clear against employee "Ana Smith-Jones" despite an
      -- exact surname-component match. word_similarity scores the best matching extent, so
      -- an exact component is 1.0; 0.85 keeps it near-exact in both directions.
      or extensions.word_similarity(upper(e.last_name), upper(l.last_name)) > 0.85
      or extensions.word_similarity(upper(l.last_name), upper(e.last_name)) > 0.85
    )
    and extensions.similarity(upper(e.first_name), upper(l.first_name)) > 0.5
  where e.status = 'active'
    and (p_organization_id is null or e.organization_id = p_organization_id)
  on conflict do nothing;

  insert into public.alerts (
    organization_id, facility_id, employee_id, exclusion_screening_match_id,
    alert_type, title, message, severity
  )
  select m.organization_id, m.facility_id, m.employee_id, m.id, 'exclusion_match_found',
    'Possible exclusion-list match — ' || e.first_name || ' ' || e.last_name,
    'A ' || (case when m.source = 'oig_leie' then 'OIG LEIE' else 'SAM.gov' end)
      || ' exclusion-list entry closely matches this employee''s name. Review in the exclusion screening queue.',
    'critical'
  from public.exclusion_screening_matches m
  join public.employees e on e.id = m.employee_id
  where m.status = 'pending_review'
    and m.source = p_source
    and (p_organization_id is null or m.organization_id = p_organization_id)
    and not exists (
      select 1 from public.alerts a where a.exclusion_screening_match_id = m.id
    );
end;
$$;

create or replace function app_private.screen_employee_against_active_exclusions(
  p_employee_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  insert into public.exclusion_screening_matches (
    organization_id, facility_id, employee_id, exclusion_list_entry_id, source,
    source_record_key, match_score, matched_name
  )
  select e.organization_id, e.facility_id, e.id, l.id, l.source,
    l.source_record_key,
    least(greatest(extensions.similarity(upper(e.last_name), upper(l.last_name)),
                   extensions.word_similarity(upper(e.last_name), upper(l.last_name)),
                   extensions.word_similarity(upper(l.last_name), upper(e.last_name))),
          extensions.similarity(upper(e.first_name), upper(l.first_name))) as score,
    e.last_name || ', ' || e.first_name
  from public.employees e
  join public.exclusion_source_state s
    on s.active_snapshot_id is not null
  join public.exclusion_list_entries l
    on l.snapshot_id = s.active_snapshot_id
    and l.source = s.source
    and (
      extensions.similarity(upper(e.last_name), upper(l.last_name)) > 0.6
      -- Component containment for hyphenated/compound surnames: whole-string trigram
      -- similarity('SMITH', 'SMITH-JONES') is exactly 0.5 -- under the 0.6 bar -- so an
      -- excluded "SMITH, ANA" screened clear against employee "Ana Smith-Jones" despite an
      -- exact surname-component match. word_similarity scores the best matching extent, so
      -- an exact component is 1.0; 0.85 keeps it near-exact in both directions.
      or extensions.word_similarity(upper(e.last_name), upper(l.last_name)) > 0.85
      or extensions.word_similarity(upper(l.last_name), upper(e.last_name)) > 0.85
    )
    and extensions.similarity(upper(e.first_name), upper(l.first_name)) > 0.5
  where e.id = p_employee_id
    and e.status = 'active'
  on conflict do nothing;

  insert into public.alerts (
    organization_id, facility_id, employee_id, exclusion_screening_match_id,
    alert_type, title, message, severity
  )
  select m.organization_id, m.facility_id, m.employee_id, m.id, 'exclusion_match_found',
    'Possible exclusion-list match — ' || e.first_name || ' ' || e.last_name,
    'A ' || (case when m.source = 'oig_leie' then 'OIG LEIE' else 'SAM.gov' end)
      || ' exclusion-list entry closely matches this employee''s name. Review in the exclusion screening queue.',
    'critical'
  from public.exclusion_screening_matches m
  join public.employees e on e.id = m.employee_id
  where m.employee_id = p_employee_id
    and m.status = 'pending_review'
    and not exists (
      select 1 from public.alerts a where a.exclusion_screening_match_id = m.id
    );
end;
$function$;

-- Re-assert the existing privilege posture for the replaced functions.
revoke all on function public.match_exclusion_list_against_roster_core(text, uuid)
  from public, anon, authenticated;
grant execute on function public.match_exclusion_list_against_roster_core(text, uuid) to service_role;
revoke all on function app_private.screen_employee_against_active_exclusions(uuid)
  from public, anon, authenticated, service_role;

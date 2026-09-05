-- I26 (5): three ways to be excluded and screen clear.
--
-- The exclusion matcher (20260815120000) compares an employee's name to an OIG LEIE or SAM.gov
-- entry with raw trigram similarity. Measured against the live extension, not reasoned about:
--
--   similarity('OBRIEN', 'O''BRIEN')        = 0.500   -- bar is 0.6, word_similarity 0.571/0.500
--   similarity('DELACRUZ', 'DELA CRUZ')     = 0.583   -- bar is 0.6, word_similarity 0.583 both ways
--   similarity('J', 'JOHN')                 = 0.167   -- bar is 0.5
--
-- So an excluded O'Brien screened clear against an employee recorded as Obrien; an excluded
-- Dela Cruz screened clear against Delacruz; and any LEIE record carrying only a first initial --
-- the list has many -- screened clear against every employee alive, however exact the surname.
-- Punctuation, a space, and an abbreviation are exactly the differences two clerks make while
-- typing the same person's name, and each of them read as "different person".
--
-- The cost of that direction of error is not symmetric. A false positive costs an administrator a
-- minute in the review queue. A false negative means a facility employs an excluded individual and
-- cannot bill Medicare or Medicaid for anything that person touches, plus civil monetary penalties
-- per claim. So the fix widens the net and leaves the human where they already were: every match
-- lands in pending_review, and nothing here auto-excludes anyone.
--
-- Also: the two copies of this join -- the roster sweep and the single-employee screen -- carried
-- the identical predicate and score, in two places. They now call one function.

------------------------------------------------------------------------------------------------
-- The normalised key
------------------------------------------------------------------------------------------------

create or replace function public.exclusion_name_key(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  -- Everything a clerk can vary without changing who the person is: case, apostrophes, hyphens,
  -- spaces, periods, and the accents that a system without them silently drops. unaccent is not
  -- installed and adding an extension for six letters is not worth the migration, so the Latin-1
  -- vowels and the two consonants that actually occur in Pennsylvania rosters are transliterated
  -- explicitly. What remains is A-Z and digits: O'BRIEN, O BRIEN and OBRIEN all become OBRIEN.
  select nullif(
    regexp_replace(
      translate(
        upper(coalesce(p_name, '')),
        'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÝÑÇ',
        'AAAAAAEEEEIIIIOOOOOUUUUYNC'
      ),
      '[^A-Z0-9]', '', 'g'
    ),
    ''
  );
$function$;

comment on function public.exclusion_name_key(text) is
  'Punctuation-, space- and accent-insensitive uppercase key for exclusion-list name comparison. '
  'Null for a name with no alphanumeric content.';

-- No client caller and no need for one: both screens are SECURITY DEFINER owned by postgres, and
-- the index expression is evaluated by the writer. Granting nothing to authenticated keeps the
-- screening rule off the surface a signed-in user can probe names against.
revoke all on function public.exclusion_name_key(text) from public, anon, authenticated;
grant execute on function public.exclusion_name_key(text) to service_role;

-- The equality branch below is a plain btree lookup once the planner has a reason to use one.
create index if not exists exclusion_list_entries_last_name_key_idx
  on public.exclusion_list_entries (public.exclusion_name_key(last_name));

-- And the trigram halves. Without these the candidate prefilter in the two screens below cannot
-- be answered by an index and the score runs on every (employee x entry) pair: on production that
-- is 19 active employees against 157,192 entries, ~3M calls at ~40us each, which saturated the
-- database and timed the deploy out twice before this was measured. See the prefilter comment.
create index if not exists exclusion_list_entries_last_name_trgm_idx
  on public.exclusion_list_entries using gin (pg_catalog.upper(last_name) extensions.gin_trgm_ops);
create index if not exists exclusion_list_entries_last_name_key_trgm_idx
  on public.exclusion_list_entries using gin (public.exclusion_name_key(last_name) extensions.gin_trgm_ops);

------------------------------------------------------------------------------------------------
-- One predicate and one score
------------------------------------------------------------------------------------------------

create or replace function public.exclusion_name_match_score(
  p_employee_first text,
  p_employee_last text,
  p_entry_first text,
  p_entry_last text
)
returns numeric
language plpgsql
immutable
parallel safe
set search_path = ''
as $function$
declare
  v_emp_last_key text := public.exclusion_name_key(p_employee_last);
  v_ent_last_key text := public.exclusion_name_key(p_entry_last);
  v_emp_first_key text := public.exclusion_name_key(p_employee_first);
  v_ent_first_key text := public.exclusion_name_key(p_entry_first);
  v_last numeric;
  v_first numeric;
begin
  -- A name with nothing alphanumeric in it is not evidence of anything.
  if v_emp_last_key is null or v_ent_last_key is null then return null; end if;

  -- Surname. The key comparison is the new half: it sees through punctuation and spacing. The
  -- word_similarity pair is carried forward from 20260815120000 and still earns its place --
  -- similarity('SMITH', 'SMITH-JONES') is 0.5, so component containment is what catches an
  -- excluded "SMITH, ANA" against an employee "Ana Smith-Jones".
  if v_emp_last_key = v_ent_last_key then
    v_last := 1.0;
  else
    v_last := greatest(
      extensions.similarity(upper(p_employee_last), upper(p_entry_last)),
      extensions.word_similarity(upper(p_employee_last), upper(p_entry_last)),
      extensions.word_similarity(upper(p_entry_last), upper(p_employee_last)),
      extensions.similarity(v_emp_last_key, v_ent_last_key)
    );
    if not (
      extensions.similarity(upper(p_employee_last), upper(p_entry_last)) > 0.6
      or extensions.word_similarity(upper(p_employee_last), upper(p_entry_last)) > 0.85
      or extensions.word_similarity(upper(p_entry_last), upper(p_employee_last)) > 0.85
      or extensions.similarity(v_emp_last_key, v_ent_last_key) > 0.6
    ) then
      return null;
    end if;
  end if;

  -- Given name. A missing given name on either side leaves the surname standing alone, which is
  -- not enough on its own -- there are a lot of Smiths.
  if v_emp_first_key is null or v_ent_first_key is null then return null; end if;

  if v_emp_first_key = v_ent_first_key then
    v_first := 1.0;
  elsif (length(v_emp_first_key) = 1 or length(v_ent_first_key) = 1)
        and left(v_emp_first_key, 1) = left(v_ent_first_key, 1) then
    -- An initial against a full given name. The LEIE publishes plenty of records with only one,
    -- and 'J' scores 0.167 against 'JOHN' -- far below any usable bar -- so without this branch
    -- those records match nobody. It is weak evidence, so it is admitted only behind a surname
    -- that is exact or near-exact, and scored to say so: a reviewer sorting by confidence sees it
    -- below every full-name match rather than mixed in with them.
    if v_last < 0.85 then return null; end if;
    v_first := 0.60;
  else
    v_first := greatest(
      extensions.similarity(upper(p_employee_first), upper(p_entry_first)),
      extensions.similarity(v_emp_first_key, v_ent_first_key)
    );
    if v_first <= 0.5 then return null; end if;
  end if;

  return least(v_last, v_first);
end;
$function$;

comment on function public.exclusion_name_match_score(text, text, text, text) is
  'Confidence that an employee name and an exclusion-list entry name are the same person, or NULL '
  'when they are not a candidate. The single definition of the screening rule: both the roster '
  'sweep and the single-employee screen call it for the predicate and for the stored score.';

revoke all on function public.exclusion_name_match_score(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.exclusion_name_match_score(text, text, text, text) to service_role;

------------------------------------------------------------------------------------------------
-- Both screens move onto it
------------------------------------------------------------------------------------------------
-- Bodies extracted from the live catalog with pg_get_functiondef and patched at the predicate and
-- the score, so nothing else in them can drift.

CREATE OR REPLACE FUNCTION public.match_exclusion_list_against_roster_core(p_source text, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET pg_trgm.similarity_threshold TO '0.30'
 SET pg_trgm.word_similarity_threshold TO '0.60'
AS $function$
begin
  insert into public.exclusion_screening_matches (
    organization_id, facility_id, employee_id, exclusion_list_entry_id, source,
    source_record_key, match_score, matched_name
  )
  select e.organization_id, e.facility_id, e.id, l.id, l.source,
    l.source_record_key,
    public.exclusion_name_match_score(e.first_name, e.last_name, l.first_name, l.last_name) as score,
    e.last_name || ', ' || e.first_name
  from public.employees e
  join public.exclusion_source_state s
    on s.source = p_source
  join public.exclusion_list_entries l
    on l.snapshot_id = s.active_snapshot_id
    and l.source = p_source
    -- A candidate prefilter the planner can answer from an index, ahead of the score. It must be
    -- strictly WIDER than the surname gate inside exclusion_name_match_score, or it silently
    -- reintroduces the false negatives that gate exists to remove -- so it mirrors that gate's
    -- four surviving routes exactly, at looser thresholds:
    --   score admits: keys equal | similarity > 0.6 | word_similarity > 0.85 either way
    --   filter keeps: keys equal | % (>= 0.30)     | <% (>= 0.60)        either way
    -- Both directions of <% are here because word_similarity is not symmetric, and a surname like
    -- LEE inside ANDERSON-LEE-WASHINGTON scores ~0.15 on similarity while word_similarity is 1.0 --
    -- exactly the containment case the score was widened to catch. The thresholds are pinned on
    -- the function (set pg_trgm.*) so a session GUC cannot narrow them underneath the screen.
    and (
      public.exclusion_name_key(l.last_name) = public.exclusion_name_key(e.last_name)
      or pg_catalog.upper(l.last_name) operator(extensions.%) pg_catalog.upper(e.last_name)
      or pg_catalog.upper(l.last_name) operator(extensions.<%) pg_catalog.upper(e.last_name)
      or pg_catalog.upper(e.last_name) operator(extensions.<%) pg_catalog.upper(l.last_name)
      or public.exclusion_name_key(l.last_name) operator(extensions.%)
         public.exclusion_name_key(e.last_name)
    )
    -- One predicate, one score, one function: the two copies of this join had drifted apart in
    -- their FROM clause already, and a screening rule that lives in two places is a screening rule
    -- that will differ in two places. See public.exclusion_name_match_score.
    and public.exclusion_name_match_score(e.first_name, e.last_name, l.first_name, l.last_name)
        is not null
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
$function$;

CREATE OR REPLACE FUNCTION app_private.screen_employee_against_active_exclusions(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET pg_trgm.similarity_threshold TO '0.30'
 SET pg_trgm.word_similarity_threshold TO '0.60'
AS $function$
begin
  insert into public.exclusion_screening_matches (
    organization_id, facility_id, employee_id, exclusion_list_entry_id, source,
    source_record_key, match_score, matched_name
  )
  select e.organization_id, e.facility_id, e.id, l.id, l.source,
    l.source_record_key,
    public.exclusion_name_match_score(e.first_name, e.last_name, l.first_name, l.last_name) as score,
    e.last_name || ', ' || e.first_name
  from public.employees e
  join public.exclusion_source_state s
    on s.active_snapshot_id is not null
  join public.exclusion_list_entries l
    on l.snapshot_id = s.active_snapshot_id
    and l.source = s.source
    -- A candidate prefilter the planner can answer from an index, ahead of the score. It must be
    -- strictly WIDER than the surname gate inside exclusion_name_match_score, or it silently
    -- reintroduces the false negatives that gate exists to remove -- so it mirrors that gate's
    -- four surviving routes exactly, at looser thresholds:
    --   score admits: keys equal | similarity > 0.6 | word_similarity > 0.85 either way
    --   filter keeps: keys equal | % (>= 0.30)     | <% (>= 0.60)        either way
    -- Both directions of <% are here because word_similarity is not symmetric, and a surname like
    -- LEE inside ANDERSON-LEE-WASHINGTON scores ~0.15 on similarity while word_similarity is 1.0 --
    -- exactly the containment case the score was widened to catch. The thresholds are pinned on
    -- the function (set pg_trgm.*) so a session GUC cannot narrow them underneath the screen.
    and (
      public.exclusion_name_key(l.last_name) = public.exclusion_name_key(e.last_name)
      or pg_catalog.upper(l.last_name) operator(extensions.%) pg_catalog.upper(e.last_name)
      or pg_catalog.upper(l.last_name) operator(extensions.<%) pg_catalog.upper(e.last_name)
      or pg_catalog.upper(e.last_name) operator(extensions.<%) pg_catalog.upper(l.last_name)
      or public.exclusion_name_key(l.last_name) operator(extensions.%)
         public.exclusion_name_key(e.last_name)
    )
    -- One predicate, one score, one function: the two copies of this join had drifted apart in
    -- their FROM clause already, and a screening rule that lives in two places is a screening rule
    -- that will differ in two places. See public.exclusion_name_match_score.
    and public.exclusion_name_match_score(e.first_name, e.last_name, l.first_name, l.last_name)
        is not null
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

------------------------------------------------------------------------------------------------
-- Re-screen what the old rule cleared
------------------------------------------------------------------------------------------------
-- Every roster already screened was screened under the narrow rule. Matches are idempotent
-- (on conflict do nothing) and the widened rule only adds candidates, so this is a re-run rather
-- than a reset: existing reviewed matches keep their status and their history.

do $$
declare v_source text;
begin
  if exists (select 1 from public.exclusion_source_state where active_snapshot_id is not null) then
    for v_source in
      select source from public.exclusion_source_state where active_snapshot_id is not null
    loop
      perform public.match_exclusion_list_against_roster_core(v_source, null);
    end loop;
    raise notice 'Re-screened the roster against every active exclusion snapshot under the widened rule.';
  else
    raise notice 'No active exclusion snapshot to re-screen; the next refresh applies the widened rule.';
  end if;
end $$;

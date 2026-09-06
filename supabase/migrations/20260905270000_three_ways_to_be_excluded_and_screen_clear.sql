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

-- Statistics for the three expressions above, inside this transaction. A brand-new expression
-- index carries none, and the re-screen at the bottom of this file runs before autovacuum could
-- ever supply them -- so without this the planner costs the prefilter on defaults and can fall
-- back to the scan these indexes exist to replace.
analyze public.exclusion_list_entries;

------------------------------------------------------------------------------------------------
-- The probe strings a surname offers the index
------------------------------------------------------------------------------------------------
-- gin_trgm_ops indexes exactly three operator shapes with the indexed expression on the LEFT:
-- `=`, `%`, and `%>`. It does NOT index `<%`. That matters, because the score's surname gate has
-- two word_similarity branches and they are not the same shape:
--
--   word_similarity(upper(employee), upper(entry)) > 0.85   -- employee inside entry
--       = upper(employee) <% upper(entry) = upper(entry) %> upper(employee)   INDEXABLE
--   word_similarity(upper(entry), upper(employee)) > 0.85   -- entry inside employee
--       = upper(entry) <% upper(employee)                                     NOT INDEXABLE
--
-- One non-indexable branch in an OR costs the whole prefilter: a BitmapOr needs every branch to
-- be an index qual, so a single `<%` sends the planner back to a full scan of the entry table and
-- the index build above buys nothing. Measured on 83,513 real LEIE rows: the OR as first written
-- planned a parallel seq scan at 645ms per employee; the same OR with only indexable branches
-- planned a BitmapOr over all three indexes at 4.4ms.
--
-- The second direction is still needed -- an excluded "SMITH, ANA" must be found against an
-- employee "Ana Smith-Jones" -- so it is expressed as a wider indexable predicate instead of a
-- narrower unindexable one. word_similarity(entry, employee) > 0.85 means the entry surname is
-- close to some continuous extent of the employee surname, and pg_trgm's extents are runs of
-- whole words; so testing `%` (0.30) against every contiguous run of the employee surname's
-- components admits every pair that branch admitted, and a good many more. A single-word surname
-- -- almost all of them -- yields exactly one probe and one lookup.
create or replace function public.exclusion_name_probes(p_name text)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $function$
declare
  v_parts text[];
  v_probes text[];
  i integer;
  j integer;
begin
  if nullif(pg_catalog.btrim(coalesce(p_name, '')), '') is null then
    return '{}'::text[];
  end if;

  v_probes := array[pg_catalog.btrim(p_name)];

  v_parts := pg_catalog.array_remove(
    pg_catalog.regexp_split_to_array(
      pg_catalog.translate(
        pg_catalog.upper(p_name),
        'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÝÑÇ',
        'AAAAAAEEEEIIIIOOOOOUUUUYNC'
      ),
      '[^A-Z0-9]+'
    ),
    ''
  );

  -- One component means the whole surname is the only extent there is.
  if coalesce(pg_catalog.array_length(v_parts, 1), 0) < 2 then
    return v_probes;
  end if;

  for i in 1 .. pg_catalog.array_length(v_parts, 1) loop
    for j in i .. pg_catalog.array_length(v_parts, 1) loop
      v_probes := v_probes || pg_catalog.array_to_string(v_parts[i:j], ' ');
    end loop;
  end loop;

  return (select pg_catalog.array_agg(distinct x) from pg_catalog.unnest(v_probes) as x);
end;
$function$;

comment on function public.exclusion_name_probes(text) is
  'The strings a surname offers a trigram index as candidate probes: the surname itself plus '
  'every contiguous run of its components. One probe for a single-word surname.';

revoke all on function public.exclusion_name_probes(text) from public, anon, authenticated;
grant execute on function public.exclusion_name_probes(text) to service_role;

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
declare
  v_snapshot_id uuid;
  v_employee record;
  v_probe text;
begin
  -- The snapshot is resolved into a variable rather than joined. That is not tidiness: while it
  -- was a join, the planner resolved (entries JOIN source_state) first and handed the whole
  -- 83k-row result to a nested loop over the roster, so no predicate on an entry could ever be
  -- an index qual. Measured that way, this sweep took 57 seconds on 83,513 rows and 19
  -- employees -- 1.59M pairs through the score -- and on production's 157,192 rows it saturated
  -- a single-core instance and took the database off the air twice. With the snapshot and the
  -- employee both constants, each probe below is a BitmapOr costing single-digit milliseconds.
  select s.active_snapshot_id into v_snapshot_id
  from public.exclusion_source_state s
  where s.source = p_source;

  -- Guarded rather than returned from: with no active snapshot the old join simply matched no
  -- entries and still ran the alert backfill below, and an early return here would quietly stop
  -- raising alerts for matches that already exist without one.
  if v_snapshot_id is not null then
  for v_employee in
    select e.id, e.organization_id, e.facility_id, e.first_name, e.last_name
    from public.employees e
    where e.status = 'active'
      and (p_organization_id is null or e.organization_id = p_organization_id)
  loop
    foreach v_probe in array public.exclusion_name_probes(v_employee.last_name)
    loop
      insert into public.exclusion_screening_matches (
        organization_id, facility_id, employee_id, exclusion_list_entry_id, source,
        source_record_key, match_score, matched_name
      )
      select v_employee.organization_id, v_employee.facility_id, v_employee.id, l.id, l.source,
        l.source_record_key,
        public.exclusion_name_match_score(
          v_employee.first_name, v_employee.last_name, l.first_name, l.last_name) as score,
        v_employee.last_name || ', ' || v_employee.first_name
      from public.exclusion_list_entries l
      where l.snapshot_id = v_snapshot_id
        and l.source = p_source
        and (
          -- Every branch is an index qual on l: `=` on the btree, `%` and `%>` on the two GIN
          -- trigram indexes. Keep it that way. One branch the opclass cannot answer turns the
          -- whole BitmapOr back into a scan of the entry table -- see the note above the probes.
          public.exclusion_name_key(l.last_name) = public.exclusion_name_key(v_probe)
          or pg_catalog.upper(l.last_name) operator(extensions.%) pg_catalog.upper(v_probe)
          or public.exclusion_name_key(l.last_name) operator(extensions.%)
             public.exclusion_name_key(v_probe)
          -- `%>` reads "v_probe occurs as a word inside l.last_name", which is the direction the
          -- score spells word_similarity(upper(employee), upper(entry)). The other direction is
          -- carried by the probe list, not by an operator.
          or pg_catalog.upper(l.last_name) operator(extensions.%>) pg_catalog.upper(v_probe)
        )
        -- One predicate, one score, one function: the two copies of this join had drifted apart
        -- in their FROM clause already, and a screening rule that lives in two places is a
        -- screening rule that will differ in two places. The probe is a candidate generator
        -- only -- the score always sees the employee's whole name, never the probe.
        and public.exclusion_name_match_score(
              v_employee.first_name, v_employee.last_name, l.first_name, l.last_name) is not null
      on conflict do nothing;
    end loop;
  end loop;
  end if;

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
declare
  v_employee record;
  v_state record;
  v_probe text;
begin
  -- Same shape as the roster sweep, and for the same reason: the employee and the snapshot are
  -- both resolved before the entry table is touched, so every predicate on an entry is an index
  -- qual. Screening one employee against 83,513 entries measured 3.1 seconds as a three-way join.
  select e.id, e.organization_id, e.facility_id, e.first_name, e.last_name
  into v_employee
  from public.employees e
  where e.id = p_employee_id
    and e.status = 'active';

  -- Guarded, not returned from, for the same reason as the sweep: the old three-way join matched
  -- no entries for an absent or inactive employee and still ran the alert backfill.
  if found then
  for v_state in
    select s.source, s.active_snapshot_id
    from public.exclusion_source_state s
    where s.active_snapshot_id is not null
  loop
    foreach v_probe in array public.exclusion_name_probes(v_employee.last_name)
    loop
      insert into public.exclusion_screening_matches (
        organization_id, facility_id, employee_id, exclusion_list_entry_id, source,
        source_record_key, match_score, matched_name
      )
      select v_employee.organization_id, v_employee.facility_id, v_employee.id, l.id, l.source,
        l.source_record_key,
        public.exclusion_name_match_score(
          v_employee.first_name, v_employee.last_name, l.first_name, l.last_name) as score,
        v_employee.last_name || ', ' || v_employee.first_name
      from public.exclusion_list_entries l
      where l.snapshot_id = v_state.active_snapshot_id
        and l.source = v_state.source
        and (
          public.exclusion_name_key(l.last_name) = public.exclusion_name_key(v_probe)
          or pg_catalog.upper(l.last_name) operator(extensions.%) pg_catalog.upper(v_probe)
          or public.exclusion_name_key(l.last_name) operator(extensions.%)
             public.exclusion_name_key(v_probe)
          or pg_catalog.upper(l.last_name) operator(extensions.%>) pg_catalog.upper(v_probe)
        )
        and public.exclusion_name_match_score(
              v_employee.first_name, v_employee.last_name, l.first_name, l.last_name) is not null
      on conflict do nothing;
    end loop;
  end loop;
  end if;

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

-- pgTAP coverage for 20260905270000: three ways to be excluded and screen clear (I26.5).
--
-- The matcher compared names with raw trigram similarity, and three ordinary spelling differences
-- fell under its bars: an apostrophe (O'BRIEN vs OBRIEN, 0.500 against a 0.6 bar), a space in a
-- compound surname (DELA CRUZ vs DELACRUZ, 0.583), and a LEIE record carrying only a first initial
-- (J vs JOHN, 0.167 against a 0.5 bar). Each of those is a difference two clerks make while typing
-- the same person's name, and each read as "different person" -- so the facility employed someone
-- it could not bill for. Run with: supabase test db.

begin;
select plan(28);

select has_function(
  'public', 'exclusion_name_key', array['text'],
  'the normalised name key exists'
);
select has_function(
  'public', 'exclusion_name_match_score', array['text', 'text', 'text', 'text'],
  'and one function holds the screening rule both screens use'
);
select ok(
  not has_function_privilege('authenticated', 'public.exclusion_name_match_score(text,text,text,text)', 'EXECUTE'),
  'which is not on the surface a signed-in user can probe names against'
);

------------------------------------------------------------------------------------------------
-- The three recorded false negatives, at the level of the rule
------------------------------------------------------------------------------------------------
select is(
  public.exclusion_name_key('O''Brien'), 'OBRIEN',
  'an apostrophe does not change who the person is'
);
select is(
  public.exclusion_name_key('Dela Cruz'), 'DELACRUZ',
  'nor does a space in a compound surname'
);
select is(
  public.exclusion_name_key('Peña'), 'PENA',
  'nor an accent the other system dropped'
);
select is(
  public.exclusion_name_key('  -- '), null,
  'a name with no alphanumeric content is not evidence of anything'
);

select ok(
  public.exclusion_name_match_score('John', 'Obrien', 'JOHN', 'O''BRIEN') is not null,
  'OBRIEN now matches O''BRIEN, which raw similarity scored 0.500 against a 0.6 bar'
);
select ok(
  public.exclusion_name_match_score('Maria', 'Delacruz', 'MARIA', 'DELA CRUZ') is not null,
  'DELACRUZ now matches DELA CRUZ, which scored 0.583'
);
select is(
  public.exclusion_name_match_score('John', 'Smith', 'J', 'SMITH'), 0.60,
  'an initial-only LEIE first name matches, and is scored below a full-name match to say so'
);
select is(
  public.exclusion_name_match_score('J', 'Smith', 'JOHN', 'SMITH'), 0.60,
  'in both directions -- the roster is as likely to hold the initial as the list is'
);

------------------------------------------------------------------------------------------------
-- What must still screen clear
------------------------------------------------------------------------------------------------
select is(
  public.exclusion_name_match_score('John', 'Smith', 'JOHN', 'WESSON'), null,
  'a different surname is still no match'
);
select is(
  public.exclusion_name_match_score('John', 'Smith', 'MARIA', 'SMITH'), null,
  'nor is a different given name behind the same surname'
);
select is(
  public.exclusion_name_match_score('John', 'Smyther', 'J', 'SMITH'), null,
  'an initial is admitted only behind a surname that is exact or near-exact, not merely similar'
);
select is(
  public.exclusion_name_match_score(null, 'Smith', 'JOHN', 'SMITH'), null,
  'and a surname standing alone is not enough -- there are a lot of Smiths'
);
-- Carried forward from 20260815120000: the component-containment case it was written for.
select ok(
  public.exclusion_name_match_score('Ana', 'Smith-Jones', 'ANA', 'SMITH') is not null,
  'the hyphenated-surname case the previous rule fixed still matches'
);

------------------------------------------------------------------------------------------------
-- End to end: the screen itself, not just the arithmetic
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('16000000-0000-4000-8000-000000000001', 'Name Variant Org', 'name-variant-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-000000000001',
   'Name Variant Facility', 'PCH');

create temp table variant_ids as
select public.begin_exclusion_source_refresh(
  '16000000-0000-4000-8000-000000000090', 'oig_leie'
) as refresh;
grant all on variant_ids to authenticated, service_role;

insert into public.exclusion_list_entries (
  snapshot_id, source_record_key, source, first_name, last_name, raw
)
select (refresh->>'snapshotId')::uuid, key, 'oig_leie', first_name, last_name, '{}'::jsonb
from variant_ids, (values
  ('oig-obrien', 'JOHN', 'O''BRIEN'),
  ('oig-delacruz', 'MARIA', 'DELA CRUZ'),
  ('oig-initial', 'J', 'KOWALCZYK'),
  ('oig-unrelated', 'HENRY', 'WESSON')
) as e(key, first_name, last_name);

select lives_ok(
  format(
    $sql$select public.complete_exclusion_source_refresh(%L::uuid, 4)$sql$,
    (select refresh->>'runId' from variant_ids)
  ),
  'the snapshot stages and activates'
);

-- Three employees whose names the old rule scored as different people, and one who is not on it.
insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, status
) values
  ('16000000-0000-4000-8000-000000000031', '16000000-0000-4000-8000-000000000001',
   '16000000-0000-4000-8000-000000000011', 'John', 'Obrien', 'Aide', 'active'),
  ('16000000-0000-4000-8000-000000000032', '16000000-0000-4000-8000-000000000001',
   '16000000-0000-4000-8000-000000000011', 'Maria', 'Delacruz', 'Aide', 'active'),
  ('16000000-0000-4000-8000-000000000033', '16000000-0000-4000-8000-000000000001',
   '16000000-0000-4000-8000-000000000011', 'Jozef', 'Kowalczyk', 'Aide', 'active'),
  ('16000000-0000-4000-8000-000000000034', '16000000-0000-4000-8000-000000000001',
   '16000000-0000-4000-8000-000000000011', 'Grace', 'Nakamura', 'Aide', 'active');

select lives_ok(
  $$ select public.match_exclusion_list_against_roster_core(
       'oig_leie', '16000000-0000-4000-8000-000000000001') $$,
  'the roster sweep runs under the widened rule'
);

select is(
  (select count(*)::int from public.exclusion_screening_matches
   where employee_id in (
     '16000000-0000-4000-8000-000000000031',
     '16000000-0000-4000-8000-000000000032',
     '16000000-0000-4000-8000-000000000033')
     and status = 'pending_review'),
  3,
  'all three name variants are now queued for review rather than cleared silently'
);
select is(
  (select count(*)::int from public.exclusion_screening_matches
   where employee_id = '16000000-0000-4000-8000-000000000034'),
  0,
  'and an employee who is not on the list is not swept up by the widening'
);
select is(
  (select count(*)::int from public.alerts
   where exclusion_screening_match_id in (
     select id from public.exclusion_screening_matches
     where organization_id = '16000000-0000-4000-8000-000000000001')
     and alert_type = 'exclusion_match_found' and severity = 'critical'),
  3,
  'each raises the critical alert an administrator acts on'
);


------------------------------------------------------------------------------------------------
-- The candidate prefilter must never exclude a pair the score admits
--
-- 20260905270000 originally applied exclusion_name_match_score to every (employee x entry) pair.
-- That is 19 active employees against 157,192 production entries -- ~3M calls at ~40us -- which
-- saturated the database and timed the production deploy out TWICE before anyone had measured it.
-- The fix is an index-answerable prefilter ahead of the score, and the only thing that makes it
-- safe is that it is strictly WIDER than the score's surname gate: if it were ever narrower it
-- would silently restore the false negatives this migration exists to remove, on the screen that
-- decides whether a facility may bill Medicare and Medicaid for a person's work.
--
-- The first version of that prefilter was wider but NOT answerable: it used `<%`, which
-- gin_trgm_ops does not index, and one such branch in an OR costs the entire BitmapOr. It read
-- as a fix, passed this file, and took production down a second time. The prefilter now uses only
-- `=`, `%` and `%>` -- the three shapes the opclass answers with the indexed expression on the
-- left -- and carries the containment direction `<%` used to express through the probe list
-- instead. Which means this assertion has TWO jobs now: the prefilter must stay wider than the
-- score, and it must stay expressible as index quals. exclusion_screen_scale.test.sql asserts
-- the second half against a table large enough for the planner to have a choice.
--
-- So this asserts the property directly rather than trusting the two to stay aligned by reading.
------------------------------------------------------------------------------------------------
set local pg_trgm.similarity_threshold = 0.30;
set local pg_trgm.word_similarity_threshold = 0.60;

select is(
  (with names(n) as (values
     ('SMITH'),('SMYTHE'),('SMITH-JONES'),('JONES'),('O''BRIEN'),('OBRIEN'),('O BRIEN'),
     ('MCDONALD'),('MACDONALD'),('ANDERSON-LEE-WASHINGTON'),('LEE'),('WASHINGTON'),
     ('DE LA CRUZ'),('DELACRUZ'),('CRUZ'),('NGUYEN'),('NGUYEN-TRAN'),('TRAN'),
     ('VAN DER BERG'),('VANDERBERG'),('BERG'),('MARTINEZ'),('MARTINES'),('MARTIN'),
     ('SCHMIDT'),('SCHMITT'),('LI'),('LIU'),('WU')
   ), firsts(f) as (values ('JOHN'),('J'),('JON'),('MARY'),('M'),('ROBERT'),('R'),('ANA'),('ANNA'))
   select count(*)::int from (
     select
       public.exclusion_name_match_score(ef.f, e.n, xf.f, x.n) as score,
       exists (
         -- Exactly the per-probe OR the two screens run, with x standing for the entry row and
         -- the probes coming from the employee surname.
         select 1 from pg_catalog.unnest(public.exclusion_name_probes(e.n)) as probe
         where public.exclusion_name_key(x.n) = public.exclusion_name_key(probe)
            or pg_catalog.upper(x.n) operator(extensions.%) pg_catalog.upper(probe)
            or public.exclusion_name_key(x.n) operator(extensions.%)
               public.exclusion_name_key(probe)
            or pg_catalog.upper(x.n) operator(extensions.%>) pg_catalog.upper(probe)
       ) as prefilter
     from names e cross join names x cross join firsts ef cross join firsts xf
   ) t
   where t.score is not null and not t.prefilter),
  0,
  'no name pair the score admits is dropped by the prefilter -- checked over every combination, including O''''BRIEN/OBRIEN, DE LA CRUZ/DELACRUZ and LEE inside ANDERSON-LEE-WASHINGTON'
);

-- And the indexes that make the prefilter answerable rather than merely correct. Without these
-- the planner falls back to the scan that caused the outage.
select is(
  (select count(*)::int from pg_indexes
   where tablename = 'exclusion_list_entries'
     and indexname in ('exclusion_list_entries_last_name_key_idx',
                       'exclusion_list_entries_last_name_trgm_idx',
                       'exclusion_list_entries_last_name_key_trgm_idx')),
  3,
  'the surname equality btree and both trigram indexes the prefilter needs are present'
);

-- The thresholds are pinned ON THE FUNCTIONS so a session GUC cannot narrow the prefilter
-- underneath a screen that is running.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname, p.proname) in
         (('public','match_exclusion_list_against_roster_core'),
          ('app_private','screen_employee_against_active_exclusions'))
     and p.proconfig @> array['pg_trgm.similarity_threshold=0.30']
     and p.proconfig @> array['pg_trgm.word_similarity_threshold=0.60']),
  2,
  'both screens pin the trigram thresholds, so the prefilter cannot be narrowed from outside'
);

------------------------------------------------------------------------------------------------
-- The probe list is what carries the containment direction the index cannot answer
------------------------------------------------------------------------------------------------

select is(
  public.exclusion_name_probes('Smith'),
  array['Smith'],
  'a single-word surname offers exactly one probe, so the common case is one index lookup'
);

select ok(
  public.exclusion_name_probes('Anderson-Lee-Washington') @> array['LEE', 'ANDERSON LEE'],
  'a hyphenated surname offers its components and their contiguous runs, which is how an entry '
  || 'contained in an employee surname still reaches an index qual'
);

-- The regression this file exists to prevent, stated as a property of the shipped bodies rather
-- than of a copy of the predicate: `<%` puts the indexed expression on the wrong side of an
-- operator gin_trgm_ops does not carry, and one of them anywhere in the OR restores the scan.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname, p.proname) in
         (('public','match_exclusion_list_against_roster_core'),
          ('app_private','screen_employee_against_active_exclusions'))
     and p.prosrc like '%<\%%'),
  0,
  'neither screen uses <%, which gin_trgm_ops cannot answer and which forces a full scan'
);

-- The other half of the same regression, and the reason the indexes went unused even where the
-- operators were right: while the sweep JOINED exclusion_list_entries to exclusion_source_state,
-- the planner resolved that pair first and handed the whole 157,192-row result to a nested loop
-- over the roster. With the big table on the OUTER side, no predicate on an entry can be
-- parameterised by an employee -- there is nothing for an index on entries to be an index FOR.
-- The snapshot is resolved into a variable before the entry table is touched now, and this is
-- what says so about the shipped bodies rather than about a copy of them.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname, p.proname) in
         (('public','match_exclusion_list_against_roster_core'),
          ('app_private','screen_employee_against_active_exclusions'))
     and p.prosrc like '%join public.exclusion_list_entries%'),
  0,
  'neither screen joins the entry table, which is what put it on the outer side of the loop'
);

select * from finish();
rollback;

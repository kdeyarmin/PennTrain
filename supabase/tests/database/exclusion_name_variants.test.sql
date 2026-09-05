-- pgTAP coverage for 20260905270000: three ways to be excluded and screen clear (I26.5).
--
-- The matcher compared names with raw trigram similarity, and three ordinary spelling differences
-- fell under its bars: an apostrophe (O'BRIEN vs OBRIEN, 0.500 against a 0.6 bar), a space in a
-- compound surname (DELA CRUZ vs DELACRUZ, 0.583), and a LEIE record carrying only a first initial
-- (J vs JOHN, 0.167 against a 0.5 bar). Each of those is a difference two clerks make while typing
-- the same person's name, and each read as "different person" -- so the facility employed someone
-- it could not bill for. Run with: supabase test db.

begin;
select plan(21);

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

select * from finish();
rollback;

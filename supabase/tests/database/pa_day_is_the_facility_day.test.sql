begin;
select plan(11);

-- The facility's calendar day, pinned.
--
-- Hosted Supabase runs TimeZone = UTC. Every facility this product serves is in Pennsylvania, so
-- from 19:00 or 20:00 local until midnight the database's `current_date` is already TOMORROW in the
-- terms the facility, the resident record, and the DHS inspector all use. 20260727010000 replaced
-- `current_date` with public.pa_today() in all 59 functions that had it; this is what keeps it
-- replaced.
--
-- The structural assertion at the bottom is the real deliverable. Re-introducing `current_date` is a
-- one-token mistake, it is silently correct for 19 hours a day, and the most likely way it happens
-- is not someone typing it fresh -- it is a future `create or replace` authored from a migration
-- file older than 20260727010000, which is a mistake this program has already made twice for other
-- reasons.

-- Does the helper ignore the session's timezone? -------------------------------------------------
--
-- Comparing pa_today() to `(now() at time zone 'America/New_York')::date` would restate its own body
-- and pass no matter what. So instead the two assertions below run a real caller under a session
-- timezone deliberately far from ET and require the ET day back. Pacific/Kiritimati is UTC+14 and
-- Pacific/Niue is UTC-11 -- 25 hours apart, so their calendar days ALWAYS differ, and ET therefore
-- always disagrees with at least one of them. A function still reading `current_date` returns the
-- session day and fails at least one of the two.
--
-- app_private.service_effective_date is the caller used because it needs no fixture at all: passed a
-- null form row it falls straight through to the "today" branch.

select ok(
  (now() at time zone 'Pacific/Kiritimati')::date <> (now() at time zone 'Pacific/Niue')::date,
  'the two probe timezones are far enough apart that their calendar days always differ'
);

set local timezone = 'Pacific/Kiritimati';
select is(
  app_private.service_effective_date(null::public.resident_assessment_forms),
  (now() at time zone 'America/New_York')::date,
  'a "today" reached through a caller is the Pennsylvania day, not the session day (UTC+14 probe)'
);

set local timezone = 'Pacific/Niue';
select is(
  app_private.service_effective_date(null::public.resident_assessment_forms),
  (now() at time zone 'America/New_York')::date,
  'a "today" reached through a caller is the Pennsylvania day, not the session day (UTC-11 probe)'
);

reset timezone;

-- pa_today() must stay STABLE, not IMMUTABLE. Marked immutable it would be constant-folded at plan
-- time and could be cached across a day boundary by a prepared statement or a cached plan, which is
-- the same class of wrongness this migration exists to remove. This also pins the schema: the helper
-- has to be in public, because `authenticated` holds no USAGE on app_private and the SECURITY
-- INVOKER callers cannot reach it there. A null here (function absent, or moved) fails the test.
select is(
  (select p.provolatile
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pa_today'),
  's'::"char",
  'public.pa_today() exists and is STABLE -- immutable would let a plan cache it across midnight'
);

-- The ratchet -------------------------------------------------------------------------------------
-- Named rather than counted: a count tells the next person the number moved, a name tells them which
-- function to look at.
select is(
  (select coalesce(string_agg(distinct n.nspname || '.' || p.proname, ', ' order by n.nspname || '.' || p.proname), '(none)')
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.prosrc ~* '\mcurrent_date\M'),
  '(none)',
  'no function in public or app_private reads current_date -- use public.pa_today()'
);

-- Ten column defaults were `CURRENT_DATE` -- and the first sweep for them, written `~` rather than
-- `~*`, reported none, because pg_get_expr renders the expression in capitals. Hence `~*` on every
-- branch below. A default is the worse half of this bug: it has no code to grep, so a review row
-- inserted at 21:00 ET carries tomorrow's review_date with nothing in any function body to blame.
-- Constraints, views, indexes and policies are swept too; none use it today, and a check constraint
-- rejecting "future" dates against the UTC day would reject a legitimate PA-today value all evening.
select is(
  (select coalesce(string_agg(where_found, ', ' order by where_found), '(none)') from (
     select 'default ' || c.relname || '.' || a.attname as where_found
     from pg_catalog.pg_attrdef ad
     join pg_catalog.pg_class c on c.oid = ad.adrelid
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     join pg_catalog.pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
     where n.nspname = 'public' and pg_get_expr(ad.adbin, ad.adrelid) ~* '\mcurrent_date\M'
     union all
     select 'constraint ' || conrelid::regclass::text || '.' || conname
     from pg_catalog.pg_constraint
     where connamespace = 'public'::regnamespace and pg_get_constraintdef(oid) ~* '\mcurrent_date\M'
     union all
     select 'view ' || c.relname
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm')
       and pg_get_viewdef(c.oid) ~* '\mcurrent_date\M'
     union all
     select 'index ' || i.indexrelid::regclass::text
     from pg_catalog.pg_index i
     join pg_catalog.pg_class c on c.oid = i.indrelid
     where c.relnamespace = 'public'::regnamespace
       and pg_get_indexdef(i.indexrelid) ~* '\mcurrent_date\M'
     union all
     select 'policy ' || p.polrelid::regclass::text || '.' || p.polname
     from pg_catalog.pg_policy p
     join pg_catalog.pg_class c on c.oid = p.polrelid
     where c.relnamespace = 'public'::regnamespace
       and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~* '\mcurrent_date\M'
   ) found),
  '(none)',
  'no default, constraint, view, index or policy reads current_date either'
);

-- The other direction: an instant cast to a day -------------------------------------------------
--
-- `some_timestamptz::date` is `at time zone TimeZone`, and TimeZone is UTC, so it answers "which day
-- did this happen on?" in the wrong calendar exactly as `current_date` answered "what day is it?" in
-- the wrong calendar. 20260727020000 replaced these with public.pa_day(); this keeps them replaced.
--
-- The operand list is derived from the catalogue rather than hard-coded, so a timestamptz column
-- added tomorrow is covered without anyone remembering to add it here.
--
-- Names that are timestamptz on one table and date on another (effective_from, effective_through,
-- effective_to today) are EXCLUDED, because from a function body's text alone this assertion cannot
-- tell which one a given `x::date` refers to, and guessing would make it cry wolf. That is a real
-- blind spot and it is named here rather than left to be discovered: a bare `effective_from::date`
-- on a timestamptz column would pass this test.
select is(
  (select coalesce(string_agg(distinct fn || ' (' || col || ')', ', ' order by fn || ' (' || col || ')'), '(none)')
   from (
     select n.nspname || '.' || p.proname as fn, tz.column_name as col
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     cross join (
       select distinct column_name from information_schema.columns
       where table_schema = 'public' and data_type = 'timestamp with time zone'
         and column_name not in (
           select column_name from information_schema.columns
           where table_schema = 'public' and data_type = 'date'
         )
     ) tz
     where n.nspname in ('public', 'app_private')
       and p.prosrc ~ ('\m' || tz.column_name || '::date')
   ) x),
  '(none)',
  'no function casts a timestamptz column straight to date -- use public.pa_day()'
);

-- The same, for a function's own timestamptz parameters. Read from proargnames/proargtypes, so this
-- needs no list at all.
select is(
  (select coalesce(string_agg(distinct fn || ' (' || nm || ')', ', ' order by fn || ' (' || nm || ')'), '(none)')
   from (
     select n.nspname || '.' || p.proname as fn,
            unnest(p.proargnames) as nm,
            unnest(p.proargtypes::oid[]) as ty,
            p.prosrc
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app_private')
   ) x
   where ty = 'timestamptz'::regtype and prosrc ~ ('\m' || nm || '::date')),
  '(none)',
  'no function casts a timestamptz parameter straight to date -- use public.pa_day()'
);

-- localtimestamp is the UTC wall clock, and it only ever appears where somebody wanted the local
-- one -- that is what the name promises. public.pa_now() is the local one.
select is(
  (select coalesce(string_agg(distinct n.nspname || '.' || p.proname, ', ' order by n.nspname || '.' || p.proname), '(none)')
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private') and p.prosrc ~* '\mlocaltimestamp\M'),
  '(none)',
  'no function reads localtimestamp -- it is the UTC wall clock; use public.pa_now()'
);

-- Reading a calendar day back as an instant. `d::timestamptz` and `d::timestamp at time zone ''UTC''`
-- both place the day at midnight UTC, which is 20:00 the previous evening in Pennsylvania.
--
-- Three functions use UTC on purpose and are listed by name, not pattern-matched, so that adding a
-- fourth is a decision somebody makes rather than a regex somebody widens:
--   * compute_audit_event_hash canonicalises a hash input -- changing its timezone would invalidate
--     every audit hash already written;
--   * the notification spend functions bound a monthly BILLING period, which is not a facility
--     calendar day, and all of them agree with each other.
select is(
  (select coalesce(string_agg(distinct n.nspname || '.' || p.proname, ', ' order by n.nspname || '.' || p.proname), '(none)')
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.prosrc ~* $q$at time zone 'UTC'$q$
     and p.proname not in (
       'compute_audit_event_hash',
       'begin_notification_delivery_attempt',
       'get_notification_delivery_operations',
       'raise_notification_spend_alerts'
     )),
  '(none)',
  'only the audit-hash and billing-period functions interpret anything in UTC'
);

-- A UTC week begins at 19:00 or 20:00 on Sunday in Pennsylvania, so a Sunday evening shift falls in
-- the following week. date_trunc over a value already converted to local time is fine and is what
-- the report-schedule functions do; this catches truncation of a raw instant.
select is(
  (select coalesce(string_agg(distinct n.nspname || '.' || p.proname, ', ' order by n.nspname || '.' || p.proname), '(none)')
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.prosrc ~ $q$date_trunc\('week', (now\(\)|p_[a-z_]*|[a-z_]+\.[a-z_]*_at)\)$q$),
  '(none)',
  'no function cuts a week on a raw instant -- use public.pa_week_start()'
);

select * from finish();
rollback;

-- The six day helpers resolved `now()` through the caller's search_path.
--
-- 20260727010100 and 20260727020000 added public.pa_today/pa_day/pa_clock/pa_now/pa_midnight/
-- pa_week_start and deliberately gave them no `set search_path`, with a comment saying the omission
-- keeps them inlinable. The inlining reasoning was right; the security consequence was not thought
-- through. `supabase db advisors` flagged all six as function_search_path_mutable -- six warnings
-- that did not exist before those migrations -- and the warning is not cosmetic:
--
--     create schema zz_evil;
--     create function zz_evil.now() returns timestamptz language sql immutable
--       as $$ select timestamptz '1999-01-01 00:00:00+00' $$;
--     set search_path = zz_evil, public, pg_catalog;
--     select public.pa_today();   -- 1998-12-31
--
-- Every "today" in the product, and the column defaults on ten tables, resolve through that call.
--
-- HOW REACHABLE IS IT. Not reachable by a tenant today: authenticated, anon and PUBLIC all hold
-- has_schema_privilege(..., 'public', 'create') = false, so no browser role can plant the shadowing
-- function anywhere these resolve. That is a reason to fix it calmly, not a reason to leave it --
-- the grant is one migration away from changing, and nothing would re-check this if it did.
--
-- WHY NOT JUST PIN search_path, which is what the advisor asks for. Because it is expensive here,
-- and the cost was measured rather than assumed. Over a 300,000-row scan on this machine:
--
--     where public.pa_day(occurred_at) between ... -- inlinable:  153 ms, 155 ms
--                                                 -- SET pinned: 1415 ms, 1317 ms
--     where d >= public.pa_today()                 -- inlinable:   94 ms,  95 ms
--                                                 -- SET pinned:  893 ms,  771 ms
--
-- roughly 9x, both for the argument-taking helpers and the zero-argument ones. A SQL function
-- carrying any SET clause cannot be inlined, and the planner then calls it per row instead of
-- folding it into the expression -- which also costs the zero-argument case, contrary to the
-- assumption that a STABLE no-argument function is evaluated once per query. get_qapi_source_metrics
-- alone calls pa_day() in twelve per-row filters.
--
-- WHAT THIS DOES INSTEAD. Fully schema-qualifies every name inside the bodies -- pg_catalog.now(),
-- pg_catalog.timezone(), pg_catalog.date_trunc(), and the cast target types, which are resolved
-- through search_path exactly like functions are. A qualified name cannot be shadowed by anything on
-- any search_path, and no SET clause means the functions stay inlinable. Re-measured after the
-- rewrite: 152 ms and 163 ms for pa_day, unchanged.
--
-- Equivalence was checked, not eyeballed: every rewritten body was compared against the shipped one
-- across 20,001 hourly instants spanning both 2025 DST transitions, and across the matching 20,001
-- calendar days for pa_midnight. Zero mismatches on all six.
--
-- The advisor will still report function_search_path_mutable for these six, because it reads
-- proconfig and not the body. That is a knowingly accepted warning, and
-- pa_day_is_the_facility_day.test.sql now asserts the property the warning is a proxy for -- each
-- helper returns the right answer under a deliberately hostile search_path -- which is the thing
-- that actually has to stay true.
--
-- WHICH THREE WERE ACTUALLY VULNERABLE. pa_today, pa_now and pa_week_start -- the ones that call a
-- function BY NAME: now() and date_trunc(). pa_day, pa_clock and pa_midnight were not, and the test
-- proves it: they return the right answer under the hostile path even against the pre-fix bodies.
-- `x at time zone z` is parser syntax that binds straight to pg_catalog.timezone rather than
-- resolving the name, so a `public.timezone(text, timestamptz)` sitting earlier on the path never
-- got a look in. The first draft of this header asserted the opposite -- that `at time zone` "had no
-- way to say which timezone() it meant" -- which sounded right and was wrong; writing the probe is
-- what settled it. All six are rewritten anyway, because the three safe ones are safe by an accident
-- of parser binding rather than by anything the body says, and the next edit could spend that.
--
-- `at time zone` is therefore gone from these bodies not because it was unsafe but because
-- pg_catalog.timezone() is the same thing said in a form that cannot be misread later.

create or replace function public.pa_today()
returns date
language sql
stable
as $$ select pg_catalog.timezone('America/New_York', pg_catalog.now())::pg_catalog.date $$;

create or replace function public.pa_day(p_at timestamptz)
returns date
language sql
stable
as $$
  -- Null in, null out, so this drops into `coalesce(x::date, ...)` unchanged.
  select pg_catalog.timezone('America/New_York', p_at)::pg_catalog.date
$$;

create or replace function public.pa_clock(p_at timestamptz)
returns time
language sql
stable
as $$ select pg_catalog.timezone('America/New_York', p_at)::pg_catalog.time $$;

create or replace function public.pa_now()
returns timestamp
language sql
stable
as $$ select pg_catalog.timezone('America/New_York', pg_catalog.now()) $$;

create or replace function public.pa_midnight(p_day date)
returns timestamptz
language sql
stable
as $$
  -- The instant a Pennsylvania calendar day begins. Note this is NOT p_day::timestamptz, which
  -- reads the day as midnight UTC -- 20:00 the previous evening here.
  select pg_catalog.timezone('America/New_York', p_day::pg_catalog.timestamp)
$$;

create or replace function public.pa_week_start(p_at timestamptz)
returns date
language sql
stable
as $$
  select pg_catalog.date_trunc('week', pg_catalog.timezone('America/New_York', p_at))::pg_catalog.date
$$;

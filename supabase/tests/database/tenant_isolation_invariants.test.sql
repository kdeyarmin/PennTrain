begin;
select plan(9);

-- Tenant isolation invariants, pinned.
--
-- These were originally run as one-off sweeps while hunting for the defect class this program keeps
-- finding: a check that structurally cannot see what is missing from it. Every sweep came back
-- clean -- which is exactly why they belong here. A one-off sweep proves the schema was sound on the
-- afternoon somebody ran it; these assertions prove it on every commit, and they are cheap.
--
-- The failure they guard against is a new table shipped without RLS, or a policy written permissive
-- and unscoped. Both are silent: the table works perfectly for the tenant who created the row, and
-- leaks to everyone else.

-- Row-level security ------------------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'every public table has row-level security enabled'
);

-- RLS with no policy denies everything, so it is safe -- but only if the table also grants nothing.
-- A table with RLS on, no policy, and a grant to authenticated is a table nobody can read yet, which
-- is a bug waiting to be "fixed" by adding a permissive policy under time pressure.
select is(
  (select count(*)::int
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_catalog.pg_policy p where p.polrelid = c.oid)
     and (has_table_privilege('authenticated', c.oid, 'select')
          or has_table_privilege('anon', c.oid, 'select'))),
  0,
  'no policy-less table is readable by authenticated or anon'
);

-- Unrestricted policies ---------------------------------------------------------------------------
-- A permissive policy whose governing expression is literally `true` grants every authenticated user
-- in every organization. That is correct for global catalogs the app must read to render, and a
-- tenant-data leak everywhere else -- so the exceptions are enumerated rather than pattern-matched.
--
-- INSERT is checked against WITH CHECK and everything else against USING: an INSERT policy has no
-- USING clause at all, and treating that absence as "unrestricted" flags every insert policy in the
-- schema. (It did, on the first attempt.)
select is(
  (select coalesce(string_agg(distinct c.relname, ', ' order by c.relname), '(none)')
   from pg_catalog.pg_policy p
   join pg_catalog.pg_class c on c.oid = p.polrelid
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and p.polpermissive
     and 'authenticated'::regrole = any(p.polroles)
     and coalesce(
           case when p.polcmd = 'a' then pg_get_expr(p.polwithcheck, p.polrelid)
                else pg_get_expr(p.polqual, p.polrelid) end, 'true') in ('true', '(true)')
     and c.relname not in (
       -- Global catalogs with no tenant data. Each is read by the app to render, and each was
       -- checked individually rather than waved through:
       'dhs_citation_topics',                -- PA regulation taxonomy
       'feature_definitions',                -- feature catalogue
       'incident_pathways',                  -- pathway question templates
       'integration_api_scope_definitions',  -- API scope catalogue
       'package_entitlements',               -- packaging catalogue
       'release_cohorts',                    -- cohort labels; MEMBERSHIP is org-scoped separately
       'release_flags',                      -- flag states
       'resident_compliance_rule_packs',     -- PA rule packs
       'work_item_source_types'              -- work-item taxonomy
     )),
  '(none)',
  'no unrestricted permissive policy outside the enumerated global catalogues'
);

-- The exception that needed its own check: release_cohorts is world-readable, so if membership were
-- also world-readable, which organizations are in a cohort would leak across tenants.
select ok(
  exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    where c.relname = 'organization_release_cohorts' and p.polcmd = 'r'
      and pg_get_expr(p.polqual, p.polrelid) like '%current_org_id%'
  ),
  'cohort MEMBERSHIP is org-scoped even though the cohort catalogue is not'
);

-- Storage -----------------------------------------------------------------------------------------
-- A public bucket serves objects to anyone with the URL, with no RLS in the path at all. Resident
-- documents, certificates and incident evidence all live in buckets.
select is(
  (select coalesce(string_agg(id, ', ' order by id), '(none)') from storage.buckets where public),
  '(none)',
  'no storage bucket is public'
);
select is(
  (select coalesce(string_agg(b.id, ', ' order by b.id), '(none)')
   from storage.buckets b
   where not exists (
     select 1 from pg_catalog.pg_policy p
     where p.polrelid = 'storage.objects'::regclass
       and pg_get_expr(p.polqual, p.polrelid) like '%' || b.id || '%'
   )),
  '(none)',
  'every storage bucket is named by at least one object policy'
);

-- Function exposure --------------------------------------------------------------------------------
--
-- Two assertions were drafted here first and both were WRONG about how this system has to work.
-- They are recorded because the corrections are the useful part:
--
--   * "no SECURITY DEFINER function in public is executable by anon" -- false by design. The guest
--     and resident-portal flows are reached by tokenised link with no account, so they must be
--     anon-executable; their security is the token each one validates, not the grant.
--   * "no app_private function is executable by authenticated or anon" -- impossible. Most of them
--     are RLS policy helpers (admission_row_visible, clinical_record_visible), and a policy cannot
--     evaluate a function the invoking role may not execute. app_private is protected by not being
--     an exposed PostgREST schema at all, which was confirmed by calling one over REST and getting
--     404 -- the grant is not the control.
--
-- What replaces them are invariants that are true and that can actually fail.

-- The anon-reachable SECURITY DEFINER surface is the guest/portal API. It is legitimate, but it
-- bypasses RLS by definition, so it must not GROW without someone deciding to grow it. A count is
-- the ratchet; adding a guest endpoint means updating this number deliberately.
select is(
  (select count(*)::int
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')),
  29,
  'the anon-reachable SECURITY DEFINER surface is exactly the 29 known guest/portal entry points (includes resolve_safety_report_facility)'
);

-- A SECURITY DEFINER function without a pinned search_path resolves unqualified names against the
-- CALLER's search_path while running with the owner's privileges -- the classic privilege-escalation
-- vector. Every one in this schema pins it today; this keeps it that way.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)')
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
     )),
  '(none)',
  'every SECURITY DEFINER function pins its search_path'
);

-- auth.uid() in a policy must be hoistable ---------------------------------------------------------
--
-- `(select auth.uid())` becomes an InitPlan the planner evaluates once; a bare `auth.uid()` can be
-- left as a function call in a per-row filter. Eighty-four of the eighty-five policies referencing it
-- already use the scalar-subquery form, and 20260727060000 fixed the eighty-fifth -- the convention
-- is what this pins, so the next policy written does not have to be caught by an external advisor.
--
-- This is a shape assertion, not a performance one. The actual cost of RLS in this schema lives in
-- public.is_assigned_to_facility(), which is called per row by 215 policies across 126 tables and is
-- unaffected by this; see docs/audits/RLS_ROW_FILTER_COST.md for the measurements and for why two
-- plausible-looking fixes to that were both wrong.
select is(
  (select coalesce(string_agg(c.relname || '.' || p.polname, ', '
                              order by c.relname || '.' || p.polname), '(none)')
   from pg_catalog.pg_policy p
   join pg_catalog.pg_class c on c.oid = p.polrelid
   where c.relnamespace = 'public'::regnamespace
     and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
          || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'auth\.uid\(\)'
     and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
          || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) !~ '\(\s*SELECT auth\.uid\(\)'),
  '(none)',
  'every policy reads auth.uid() through a scalar subquery so the planner can hoist it'
);

select * from finish();
rollback;

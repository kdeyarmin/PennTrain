-- Write grants production carries that the migration chain never creates.
--
-- HOW THIS WAS FOUND, because the method matters more than the count. Re-verifying this branch on
-- a Supabase CLI newer than the pinned 2.109.1 turned two assertions red in
-- `carebase_remediation_plan.test.sql` -- "browser roles cannot forge external medication orders"
-- and "browser roles cannot bypass portal grant commands". Neither is caused by anything on this
-- branch. The two CLI versions ship different base images, and their `alter default privileges`
-- for role `postgres` in schema `public` differ: 2.109.1 grants new tables nothing for `anon` or
-- `authenticated`, the newer one grants both `arwd`. So every table a migration creates inherits
-- write grants under one image and none under the other.
--
-- WHAT THAT MEANS FOR THIS DEPLOYMENT. Production was built by the hosted image, which grants.
-- Counted against production on 2026-09-04:
--
--   * `authenticated` holds 35 INSERT, 44 UPDATE and 41 DELETE grants on RLS-enabled public
--     tables for which no permissive policy of that command exists.
--   * `anon` -- the UNAUTHENTICATED browser role -- holds INSERT, UPDATE and DELETE on 87
--     RLS-enabled public tables, every single one with no permissive policy behind it.
--
-- The same query against a clean replay of this chain returns ZERO rows for both roles: `anon`
-- holds no grant at all on an RLS-enabled public table, and every `authenticated` grant is backed
-- by a policy that uses it. The chain is right; production carries 381 write grants it never
-- issued and no migration ever revoked, because dozens of migrations wrote
-- `revoke all ... from public, anon` -- which does not name `authenticated` -- against an image
-- whose defaults had already granted both.
--
-- NOTHING IS OPEN TODAY, AND THAT IS NOT THE POINT. RLS is enabled on every table in the set and
-- denies each of these writes, so the grant is inert: a table with RLS on and no permissive
-- policy for a command refuses that command regardless of the grant. What the drift removes is
-- the second lock. The day someone adds a policy scoped `to public`, or omits the role clause,
-- the grant is already sitting there -- and the suite that is supposed to catch it is green,
-- because the local image never created the grant in the first place. That is the same false
-- green as G270: a check that passes because it is asking the wrong database.
--
-- WHAT THIS MIGRATION DOES. For every RLS-enabled table in `public`, it revokes from `anon` and
-- `authenticated` exactly those INSERT/UPDATE/DELETE privileges that no permissive policy of that
-- command grants either role. Behaviour-preserving by construction: the only writes it can affect
-- are writes RLS already refuses. On a clean database it revokes nothing at all -- which also
-- means CI cannot exercise it, so the invariant it establishes is asserted separately in
-- `go_live_readiness_repairs.test.sql` and will catch any FUTURE migration that adds such a grant.
--
-- WHY NOT SELECT. RLS denies unpermitted reads identically, so revoking read grants buys no
-- security. It does risk something: a `security_invoker` view reads its base tables as the caller,
-- so a base-table SELECT revoke is the one that can silently empty a working screen. Write
-- commands carry the whole security value here and none of that risk.
--
-- DYNAMIC ON PURPOSE. A hand-written list would freeze one deployment's drift into the chain
-- forever and would be wrong for every other deployment, including a fresh one. This computes the
-- set at deploy time from the policies actually present, so it is correct wherever it runs.
--
-- Rollback: re-grant the named privileges from the notice this raises. There is no behavioural
-- reason to -- every revoked privilege was already unusable.

do $$
declare
  r record;
  v_revoked integer := 0;
  v_survived integer := 0;
begin
  for r in
    select c.oid, c.relname, x.priv, ro.role_name
    from pg_class c
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as x(priv)
    cross join (values ('anon'), ('authenticated')) as ro(role_name)
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and has_table_privilege(ro.role_name, c.oid, x.priv)
      and not exists (
        select 1
        from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = c.relname
          and p.permissive = 'PERMISSIVE'
          and p.cmd in (x.priv, 'ALL')
          and (ro.role_name = any(p.roles) or 'public' = any(p.roles))
      )
    order by c.relname, ro.role_name, x.priv
  loop
    execute format('revoke %s on table public.%I from %I', r.priv, r.relname, r.role_name);
    v_revoked := v_revoked + 1;
    -- A privilege that survives its own revoke came from somewhere this query did not model --
    -- a PUBLIC grant, or role membership. Production has neither (checked: zero PUBLIC grants on
    -- public tables), but reporting beats assuming.
    if has_table_privilege(r.role_name, r.oid, r.priv) then
      v_survived := v_survived + 1;
      raise warning 'grant survived its revoke: % on public.% for % -- check for a PUBLIC grant or role membership',
        r.priv, r.relname, r.role_name;
    end if;
  end loop;

  raise notice 'Revoked % write grant(s) that row-level security already denied.', v_revoked;
  if v_survived > 0 then
    raise warning 'ATTENTION: % of those grant(s) are still held after the revoke.', v_survived;
  end if;
end;
$$;

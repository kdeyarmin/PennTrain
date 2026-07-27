# What row-level security costs per row, and why the obvious fix is wrong

Measured 2026-07-27 against a local Supabase stack (`supabase db reset --no-seed`), 50,000 rows in
`public.resident_unscheduled_services`, one organisation, one facility, one active employee whose
profile role is `employee`. Numbers from this sandbox run roughly 5x slower than CI, so treat the
ratios rather than the absolutes as the finding.

This document exists because `supabase db advisors` points at the wrong thing here, and the fix it
suggests is a no-op. Someone reading the advisor output and acting on it would ship a confident
commit that changes nothing. The measurements below are so the next person starts from evidence.

## What the advisor says

One finding, `auth_rls_initplan`, on `resident_unscheduled_services_select`:

> re-evaluates current_setting() or auth.\<function\>() for each row … Resolve the issue by
> replacing `auth.<function>()` with `(select auth.<function>())`.

It is right that this is the only policy in the schema with a bare `auth.uid()` -- the other 84
policies that reference it already use the `(select …)` form. It is wrong that this is what costs
anything here.

## What it actually costs

| policy expression | `count(*)` over 50,000 rows | one 50-row page, indexed |
| --- | --- | --- |
| as shipped | 103,460 ms | 148 ms |
| with `(select auth.uid())` -- the advisor's fix | 101,155 ms | -- |
| baseline: same count as `postgres`, RLS not applied | 5 ms | -- |

The advisor's fix changes nothing, and `EXPLAIN` says why: the `employees` lookup was **already** a
`hashed SubPlan` running `loops=1`. It was never per-row. Wrapping an expression that the planner
had already hoisted does not hoist it twice.

Bisecting the rest of the policy, one branch at a time, over the same 50,000 rows:

| branch | time |
| --- | --- |
| `(select public.is_platform_admin())` | 7 ms |
| `organization_id = (select public.current_org_id())` | 10 ms |
| `(select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id)` | 10 ms |
| **`public.is_assigned_to_facility(facility_id)` alone** | **21,180 ms** |
| the `employees` EXISTS branch alone | 16 ms |

`public.is_assigned_to_facility(uuid)` costs about **0.42 ms per row**. Its body joins `profiles`,
`facilities` and `organizations` and then runs a nested `EXISTS` against `facility_assignments`, and
it is `SECURITY DEFINER` with `SET search_path TO ''` -- so Postgres will not and cannot inline it.
It is a black box called once per row, and it is reached through
`app_private.admission_row_visible()`, which is itself `SECURITY DEFINER` and takes the row's own
columns as arguments, so it too is per-row by construction.

**Reach: 215 policies across 126 tables call `is_assigned_to_facility`. 61 policies across 61 tables
call `admission_row_visible`.** This is the dominant cost of row-level security in this product, not
a property of one table.

## How much is on the table

Rewritten so the row-invariant parts are hoisted and the facility check becomes a hashed set
membership, the same queries ran:

| shape | as shipped | set-based | ratio |
| --- | --- | --- | --- |
| 50-row indexed page | 148 ms | 3.5 ms | ~40x |
| `count(*)` over 50,000 rows | 103,460 ms | 16 ms | ~6,500x |

So the prize is real. What follows is why it was **not** taken in the commit that measured it.

## Two rewrites that looked right and were not

**1. The fast one was permissive.** The obvious set-based policy inlines the visibility rule as
`organization_id = current_org_id() and role in (…) or facility_id in (select … facility_assignments
…)`. It drops `public.current_session_unlocked()`, `profiles.is_active`, `facilities.is_active` and
the `organizations.subscription_status not in ('suspended','canceled')` check, all of which live
inside `is_assigned_to_facility` and none of which are visible at the call site. It returns rows the
shipped policy denies -- a locked session, a deactivated user, a suspended tenant. It measured
beautifully. It is a data leak.

**2. The equivalent-by-construction one degrades at tenant scale.** Calling the same function from a
set-returning helper keeps semantics identical for free:

```sql
create function app_private.assigned_facility_ids() returns setof uuid
language sql stable security definer set search_path to ''
as $$ select f.id from public.facilities f where public.is_assigned_to_facility(f.id) $$;
```

Equivalence was checked and holds, including for NULL and for a facility id that does not exist. But
it scans **every facility in the database**, not the caller's -- this is a shared-schema multi-tenant
deployment. At 4 facilities (this fixture) it is free; at 10,000 across all tenants it is 10,000
calls at 0.42 ms, which is slower than the per-row form for any small result set. It has to be
bounded by the caller's organisation first, and proving that the bound cannot change the answer is a
separate argument about `current_org_id()` versus the `profiles.organization_id` the function joins
on internally.

## What that implies for whoever does this

- The unit of work is `is_assigned_to_facility`, not any individual policy.
- Every rewrite has to be proved to permit *exactly* the same rows, not merely to look equivalent.
  Both attempts above passed a casual reading.
- A per-policy equivalence test -- old predicate versus new predicate over a fixture matrix that
  includes a locked session, an inactive profile, an inactive facility and a suspended organisation
  -- is the thing that makes this safe. Without it this is a change to the tenant isolation boundary
  justified by a stopwatch.
- Practical severity is bounded by query shape, and should be stated honestly: the analytics that
  scan large row counts run inside `SECURITY DEFINER` functions, which bypass RLS entirely. The cost
  lands on direct PostgREST reads from the browser, where 148 ms per page is real but not fatal. The
  103-second full scan is a worst case the product may never issue.

## Aside: a once-a-night test flake found while measuring this

The pgTAP suite failed twice during this investigation, at 04:00 UTC -- which is midnight in
Pennsylvania -- and passed on a re-run a minute later. Worth recording because the diagnosis method
generalises.

`post_resident_personal_fund_transaction` rejects backdated entries, so
`resident_financial_operations.test.sql` nudges every fixture transaction to `now() + 3 minutes` to
stay safely ahead of the clock. For the last three minutes of each Pennsylvania day that nudge lands
the transaction on tomorrow, while `public.pa_today()` is still today, and
`reconcile_resident_personal_funds` sums `public.pa_day(transaction_at) <= p_period_end` -- so the
adjustment fell outside its own period and the reconciliation came out unbalanced. A roughly
0.2%-per-run flake, invisible except at night.

Rather than read the 21 test files that pair a future-dated fixture with `pa_today()`, the clock was
simulated: `pa_day` and `pa_today` were redefined with a baked-in offset placing "now" at 23:58 ET,
and the whole suite run against it. That named exactly one racy suite and cleared the other twenty.

Two mistakes in doing that, both worth avoiding next time:

- The first probe stored its offset in a **table**, which the audit-manifest and RLS invariants
  immediately failed on -- 30-odd failures that were all the probe's own footprint. A probe that
  changes the schema cannot be used against a suite that asserts on the schema.
- The offset is a fixed interval, so the simulated clock **drifts**. Ten minutes after it was
  created it no longer represented 23:58 but 00:08 the following day, and produced a fresh crop of
  meaningless failures. It has to be re-created immediately before each run.

And the fix itself needed a second pass: correcting the first reconciliation to name the day its
transactions landed on made it collide with the second one, which was still on `pa_today() + 1` --
reconciliations are `UNIQUE (personal_fund_account_id, period_end)`. The failure moved from
assertions 63-64 to 66-67 rather than disappearing, which is what the simulation was for.

## What the measuring commit did change

Only the thing that was provably safe: `resident_unscheduled_services_select` now uses
`(select auth.uid())` like the other 84 policies do. That is a consistency fix and clears the
advisor's only finding of this class; per the table above it buys no measurable time, and it is not
described as though it does. A pgTAP assertion keeps the convention from drifting again.

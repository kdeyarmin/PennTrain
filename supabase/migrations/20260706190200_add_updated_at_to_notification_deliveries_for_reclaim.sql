-- Forward-fix (Codex review on PR #43): the atomic-claim fix in dispatch-notifications/index.ts
-- (pending -> processing) has no reclaim path for a row that gets stuck in 'processing' -- if the
-- Edge Function times out, is redeployed mid-batch, or a per-row finalize update fails after the
-- claim, that row is claimed forever: future cron runs only ever look at status = 'pending', so a
-- training-reminder/escalation notification silently never goes out and never surfaces as failed.
--
-- Add `updated_at` (bumped by the same shared set_updated_at() trigger used elsewhere in this
-- schema) so the dispatch function can distinguish a freshly-claimed row from one that's been
-- sitting in 'processing' well past a single dispatch run and re-claim it.
alter table public.notification_deliveries
  add column updated_at timestamptz not null default now();

create trigger set_updated_at before update on public.notification_deliveries
  for each row execute function public.set_updated_at();

-- Replaces the pending-only partial index: the dispatch function's reclaim query now also needs to
-- find stale 'processing' rows efficiently, ordered by how long they've been stuck.
drop index public.notification_deliveries_status_idx;
create index notification_deliveries_status_idx on public.notification_deliveries(status, updated_at)
  where status in ('pending', 'processing');

-- Copilot review finding: dispatch-notifications previously claimed a batch via a plain
-- `.update(...).order(...).limit(...)` -- whether PostgREST's "Limited Update/Delete" feature
-- (limit/order actually bounding the rows an UPDATE affects, not just the rows it returns) applies
-- for a given deployment isn't something to leave to chance for a query that could otherwise flip
-- every pending row to 'processing' in one request. `FOR UPDATE SKIP LOCKED` is the standard,
-- unambiguous Postgres pattern for "atomically claim up to N rows from a work queue, safe under
-- concurrent callers": two overlapping invocations can never select the same row, no compare-and-
-- swap re-check needed after the fact. Also folds in the stale-'processing'-reclaim fix above (a
-- row stuck in 'processing' longer than p_stale_after_seconds -- an earlier invocation that timed
-- out, was redeployed mid-batch, or crashed before its per-row finalize update ran -- is claimable
-- again).
create or replace function public.claim_pending_notification_deliveries(
  p_batch_size integer,
  p_stale_after_seconds integer
)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
  with candidates as (
    select nd.id
    from public.notification_deliveries nd
    where nd.status = 'pending'
       or (nd.status = 'processing' and nd.updated_at < now() - make_interval(secs => p_stale_after_seconds))
    order by nd.created_at, nd.id
    limit p_batch_size
    for update skip locked
  )
  update public.notification_deliveries nd
  set status = 'processing'
  from candidates c
  where nd.id = c.id
  returning nd.*;
end;
$function$;

revoke all on function public.claim_pending_notification_deliveries(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_pending_notification_deliveries(integer, integer) to service_role;
